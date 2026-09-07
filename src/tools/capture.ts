import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type JsonValue, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import { mkdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { cliError, getSessionId, notify, requireFile, textCard } from './common.js'
import type { PluginDeps } from '../routes.js'
import { VISUAL_CHECKLIST } from '../pptx/checklist.js'

type ImageInfo = {
  attachmentId: string
  mediaType: ImageMediaType
  bytes: number
  width: number
  height: number
  name?: string
}

/** 模型在对话里看到的内容块：文字说明 + 可选图片。 */
type Block = { type: 'text'; text: string } | { type: 'image'; attachment: ImageAttachmentRef }

/**
 * 把持久化后的图片引用包装成模型可见的内容块（文字清单 + 图片本身）。
 * 参考 @deepseek-ai/dsh-tool-fs 的 read_image：图片必须先经 attachments 服务
 * 持久化成 ImageAttachmentRef，工具结果才能引用（结果会进会话历史并随每个后续
 * 模型请求发送）。拿不到图片时 `note` 说明具体原因（模型不支持图像输入 /
 * 附件服务未挂载），不能笼统说"服务不可用"。
 */
function imageBlock(value: { image?: ImageInfo | null; note?: string } | undefined): Block[] {
  const image = value?.image ?? undefined
  const heading = textCard(
    `截图 ${image?.name ?? ''}（${image?.width ?? 0}×${image?.height ?? 0}, ${((image?.bytes ?? 0) / 1024).toFixed(0)}KB）`,
    '',
    '请对照下面的清单逐条自查；任一条不通过就用 office_batch 修正后重新截图，最多 3 轮：',
    VISUAL_CHECKLIST,
  )
  if (!image?.attachmentId) {
    return [
      ...heading,
      ...textCard(
        value?.note ?? '（图片附件不可用，无法在对话中回看截图；文件已保存到磁盘，可在侧边栏预览。）',
      ),
    ]
  }
  return [
    ...heading,
    {
      type: 'image',
      attachment: {
        attachmentId: image.attachmentId,
        mediaType: image.mediaType,
        bytes: image.bytes,
        width: image.width,
        height: image.height,
        ...image.name === undefined ? {} : { name: image.name },
      },
    },
  ]
}

/**
 * 探测当前模型路由是否声明了图像输入能力。参考 tool-fs read_image 的
 * assertImageCapableRoute，但这里是软探测：拿不到路由信息返回 unknown（放行）。
 */
async function imageRouteCapability(ctx: Context, exec: ToolRunContext): Promise<'capable' | 'unsupported' | 'unknown'> {
  try {
    const routed = exec.agent?.session.requestHeader()?.config
    const provider = routed?.provider ?? exec.agent?.options.provider
    const model = routed?.model ?? exec.agent?.options.model
    const llm = ctx.get('llm')
    if (provider === undefined || model === undefined || llm === undefined) return 'unknown'
    const active = await llm.resolveModelInfo(provider, model, exec.signal)
    if (active.inputModalities === undefined || !active.inputModalities.includes('image')) return 'unsupported'
    return 'capable'
  } catch {
    return 'unknown'
  }
}

/**
 * office_screenshot。把 PPT/文档某一页渲染成 PNG，并把图片本身回传到对话里 ——
 * 模型能直接看到渲染效果做视觉自检。attachments 服务由宿主提供，运行时通过
 * `ctx.get('attachments')` 获取（缺失时优雅降级为仅返回路径）。
 */
export function registerCaptureTools(ctx: Context, deps: PluginDeps): void {
  ctx.tools.register(
    defineTool({
      name: 'office_screenshot',
      description:
        '把 Office 文档某一页渲染成 PNG 图片，并把图片本身回传到对话里 —— 你（模型）能直接看到渲染效果。' +
        'PPT 生成后务必调用本工具自查排版（文字溢出/越界/对比度/对齐），有问题用 office_batch 修正，最多 3 轮。',
      parameters: {
        filename: { type: 'string', required: true, description: '文件名' },
        page: { type: 'number', description: '页码/幻灯片号（从 1 开始），缺省第 1 页' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) =>
        imageBlock(value as { image?: ImageInfo | null; note?: string }),
      },
      isConcurrencySafe: () => false,
      async execute(args, exec): Promise<Record<string, JsonValue>> {
        const sessionId = getSessionId(exec)
        const abs = requireFile(deps.workspace, sessionId, args.filename)
        const snapsDir = join(deps.workspace.sessionDir(sessionId), '.snaps')
        mkdirSync(snapsDir, { recursive: true })
        const page = args.page !== undefined ? Math.max(1, Math.floor(args.page)) : 1
        const out = join(snapsDir, `p${page}-${Date.now()}.png`)
        const res = await deps.cli.run(sessionId, ['view', abs, 'screenshot', '-o', out, '--page', String(page)])
        if (!res.ok) throw cliError(res)
        notify(deps, sessionId, { file: args.filename, tool: 'office_screenshot' })

        // 读回字节并交给 attachments 服务持久化
        let data: Buffer
        try {
          data = readFileSync(out)
        } catch {
          return { savedPath: out, image: null }
        }
        const attachments = ctx.get('attachments')
        if (!attachments) return { savedPath: out, image: null }

        // 模型不支持图像输入时不要写入图片附件（会被历史带着重发，还可能被
        // provider 拒收），改为明确告知模型改用结构化校验，避免"假装看过图"。
        if (await imageRouteCapability(ctx, exec) === 'unsupported') {
          return {
            savedPath: out,
            image: null,
            note:
              `当前模型 ${String(exec.agent?.options.model ?? '')} 不支持图像输入，截图已保存到 ${out} 但你（模型）无法直接查看。` +
              '请改用结构化校验：office_view 查 issues / office_get 检查坐标与文本，逐条核对设计约束。' +
              '不要声称"已看到截图"——那是幻觉。若需要视觉自检，请用户切换到支持视觉的模型（如 glm-4.6v、glm-4.5v）。',
          }
        }

        const mediaType: ImageMediaType = 'image/png'
        if (!attachments.imageLimits.mediaTypes.includes(mediaType)) {
          return { savedPath: out, image: null, note: '部署不接受 PNG 截图回看' }
        }
        const byteCap = Math.min(attachments.imageLimits.maxImageBytes, attachments.imageLimits.maxMessageImageBytes)
        if (byteCap > 0 && data.byteLength > byteCap) {
          return { savedPath: out, image: null, note: `截图 ${(data.byteLength / 1024).toFixed(0)}KB 超出图片上限 ${(byteCap / 1024).toFixed(0)}KB，仅返回路径` }
        }

        const ref = await attachments.saveImage({ data: new Uint8Array(data), mediaType, name: `${basename(args.filename)}-p${page}.png` })
        const image: ImageInfo = {
          attachmentId: String(ref.attachmentId),
          mediaType: ref.mediaType,
          bytes: ref.bytes,
          width: ref.width,
          height: ref.height,
          name: `${basename(args.filename)} 第 ${page} 页`,
        }
        return { savedPath: out, image }
      },
    }),
  )
}
