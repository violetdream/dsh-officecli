import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { existsSync } from 'node:fs'
import { DeckSpecError, compileDeck, parseDeckSpec, type DeckSpec } from '../pptx/deck.js'
import { LAYOUT_IDS } from '../pptx/layouts.js'
import { getTheme, inferTheme, themeToProps } from '../pptx/theme.js'
import { listTemplates } from '../pptx/templates.js'
import { VISUAL_CHECKLIST, designGuide } from '../pptx/checklist.js'
import { cliError, getSessionCwd, getSessionId, notify, textCard, warmWatch } from './common.js'
import type { PluginDeps } from '../routes.js'

/**
 * 高层 PPT 工具：office_deck_create / office_slide_add / office_design_guide。
 *
 * 与底层 office_add / office_set 的区别：底层要求模型自己算坐标（officecli 没有
 * 布局引擎，模型几乎必然摆歪）；这三个工具把排版数学放在插件里，模型只填内容。
 */

/** 模型的 deck 入参可能是对象，也可能是 JSON 字符串（部分模型会序列化）。 */
function toDeck(input: unknown): DeckSpec {
  if (typeof input === 'string') {
    let parsed: unknown
    try {
      parsed = JSON.parse(input)
    } catch {
      throw new DeckSpecError(
        'deck 是字符串但 JSON 解析失败。请检查是否漏了引号或多了尾随逗号。也可以直接传对象而不是 JSON 字符串。',
      )
    }
    return parseDeckSpec(parsed)
  }
  return parseDeckSpec(input)
}

/** 提交 batch 并把 officecli 的失败定位到具体命令。 */
async function submitBatch(
  deps: PluginDeps,
  sessionId: string,
  abs: string,
  commands: unknown[],
  timeoutMs?: number,
): Promise<void> {
  const res = await deps.cli.run<{ results?: Array<{ index: number; success: boolean; output?: string; error?: string }> }>(
    sessionId,
    ['batch', abs],
    { stdin: JSON.stringify(commands), timeoutMs: timeoutMs ?? 120_000 },
  )
  if (!res.ok) throw cliError(res)
  const failed = (res.data.results ?? []).filter((r) => r.success === false)
  if (failed.length > 0) {
    const detail = failed
      .slice(0, 3)
      .map((f) => `  第 ${f.index} 条: ${f.error ?? f.output ?? '未知错误'}`)
      .join('\n')
    throw new Error(`batch 中有 ${failed.length} 条命令失败：\n${detail}\n（officecli batch 是原子事务，文件未被修改）`)
  }
}

export function registerDeckTools(ctx: Context, deps: PluginDeps): void {
  // -----------------------------------------------------------------------
  // office_design_guide：把设计约束交给模型
  // -----------------------------------------------------------------------
  ctx.tools.register(
    defineTool({
      name: 'office_design_guide',
      description:
        '生成 PPT 前必读：返回主题清单、叙事结构建议、每类字段的字数红线、版式契约（DeckSpec 结构）和生成后的视觉自检清单。' +
        '在调用 office_deck_create 之前先调用本工具，能显著降低返工率。',
      parameters: {
        section: {
          type: 'string',
          enum: ['all', 'templates', 'themes', 'story', 'limits', 'scale', 'spec', 'checklist'] as const,
          description: '只看某一节；缺省返回完整指南',
        },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => textCard((value as { guide: string }).guide),
      },
      isConcurrencySafe: () => true,
      async execute(args) {
        const section = args.section === 'all' ? undefined : args.section
        return { guide: designGuide(section) }
      },
    }),
  )

  // -----------------------------------------------------------------------
  // office_deck_create：一次调用生成整份 PPT
  // -----------------------------------------------------------------------
  ctx.tools.register(
    defineTool({
      name: 'office_deck_create',
      description:
        '一步生成一份排版完整的 .pptx 演示文稿。你只需要提供内容（DeckSpec JSON），坐标、字号、配色、网格全部由插件内置的设计层计算，' +
        '无需自己指定位置。可选 template（咨询简报/产品发布/学术答辩/极简/政务报告/年度报告）一键获得专业感，' +
        '可选 style 注入整份样式（转场/背景/页码/元数据）。生成后用 office_screenshot 看效果并按自检清单修正。' +
        '首次使用请先调用 office_design_guide 了解 DeckSpec 结构与字数红线。',
      parameters: {
        filename: { type: 'string', required: true, description: '输出文件名，必须以 .pptx 结尾（如 ai-intro.pptx）。支持中文名。' },
        deck: {
          type: 'object',
          required: true,
          description:
            'DeckSpec 对象：{ template?, theme?, footer?, style?, slides: [{layout, ...内容}] }。layout 取值：cover/section/bullets/cards/kpi/steps/compare/timeline/quote/table/agenda/swot/pricing/roadmap/ending。详见 office_design_guide。',
          additionalProperties: true,
        },
        overwrite: { type: 'boolean', description: '文件已存在时是否覆盖，默认 false' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => {
          const v = value as { filename: string; pageCount: number; shapeCount: number; layouts: string[]; path: string; template?: string; theme: string }
          return textCard(
            `已生成 ${v.filename}：${v.pageCount} 页 / ${v.shapeCount} 个元素`,
            `模板: ${v.template ?? '（未指定，基础样式）'}  配色: ${v.theme}`,
            `版式: ${v.layouts.join(' → ')}`,
            `路径: ${v.path}`,
            '',
            '下一步: office_screenshot 查看渲染效果，逐条核对自检清单，需要修正用 office_batch。',
            VISUAL_CHECKLIST,
          )
        },
      },
      isConcurrencySafe: () => false,
      async execute(args, exec) {
        const sessionId = getSessionId(exec)
        const cwd = getSessionCwd(exec)
        if (!/\.pptx$/i.test(args.filename)) {
          throw new Error(`文件名必须以 .pptx 结尾，收到: ${args.filename}`)
        }
        const abs = deps.workspace.resolve(sessionId, args.filename, cwd)
        if (existsSync(abs) && !args.overwrite) {
          throw new Error(`文件已存在: ${args.filename}。传 overwrite=true 覆盖，或换一个文件名。`)
        }
        if (existsSync(abs)) {
          const del = await deps.cli.run(sessionId, ['close', abs])
          if (!del.ok) {
            // close 失败不影响后续，batch 会整体覆盖内容
          }
        }

        const spec = toDeck(args.deck)
        const compiled = compileDeck(spec)

        // 创建（或复用）文件
        const createRes = await deps.cli.run(sessionId, ['create', abs, '--type', 'pptx', '--force'])
        if (!createRes.ok) throw cliError(createRes)

        await submitBatch(deps, sessionId, abs, compiled.commands)

        // 落盘：resident 模式下 batch 只写内存
        const saveRes = await deps.cli.run(sessionId, ['save', abs])
        if (!saveRes.ok && !/already saved/i.test(String(saveRes.error.error))) throw cliError(saveRes)

        notify(deps, sessionId, {
          file: args.filename,
          tool: 'office_deck_create',
          detail: {
            layouts: compiled.layouts,
            pageCount: compiled.pageCount,
            theme: compiled.theme.id,
            template: compiled.template,
          },
        }, cwd)
        // 边改边看：预热 watch，预览面板可自动打开
        warmWatch(deps, sessionId, args.filename, cwd)
        return {
          filename: args.filename,
          pageCount: compiled.pageCount,
          shapeCount: compiled.commands.filter((c) => c.command === 'add' && c.type === 'shape').length,
          layouts: compiled.layouts,
          path: abs,
          theme: compiled.theme.id,
          template: compiled.template ?? '',
        }
      },
    }),
  )

  // -----------------------------------------------------------------------
  // office_slide_add：往已有 PPT 追加页面
  // -----------------------------------------------------------------------
  ctx.tools.register(
    defineTool({
      name: 'office_slide_add',
      description:
        '向已有的 .pptx 追加一页或多页，沿用与 office_deck_create 相同的版式模板（坐标自动计算）。' +
        '适合先生成主体再补充，或对某一页不满意时重做。',
      parameters: {
        filename: { type: 'string', required: true, description: '已存在的 .pptx 文件名' },
        slides: {
          type: 'array',
          required: true,
          description: '要追加的页面数组，每项是 {layout, ...内容}，结构与 office_deck_create 的 slides 一致',
          items: { type: 'object', additionalProperties: true },
        },
        at: { type: 'number', description: '插入位置（1-based）。省略则追加到末尾' },
        theme: {
          type: 'string',
          description:
            '指定主题 id（见 office_design_guide 的 themes 节）。省略时自动沿用原文件配色——' +
            '追加的页面绝不应该换配色，除非你就是要重做整套视觉。',
        },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => {
          const v = value as { filename: string; added: number; totalSlides: number; startPage: number; theme: string }
          return textCard(
            `已向 ${v.filename} 追加 ${v.added} 页（第 ${v.startPage}–${v.startPage + v.added - 1} 页），配色: ${v.theme}`,
            `当前共 ${v.totalSlides} 页`,
            '下一步: office_screenshot 查看新页效果。',
          )
        },
      },
      isConcurrencySafe: () => false,
      async execute(args, exec) {
        const sessionId = getSessionId(exec)
        const cwd = getSessionCwd(exec)
        const abs = deps.workspace.resolve(sessionId, args.filename, cwd)
        if (!existsSync(abs)) {
          throw new Error(`文件不存在: ${args.filename}。请先用 office_deck_create 或 office_create 创建。`)
        }

        // 读当前页数确定起始页号
        const stat = await deps.cli.run<{ totalSlides?: number; slides?: unknown[] }>(sessionId, ['view', abs, 'outline'])
        const existCount = stat.ok ? (stat.data.totalSlides ?? stat.data.slides?.length ?? 0) : 0
        const insertAt = args.at && args.at >= 1 && args.at <= existCount + 1 ? Math.floor(args.at) : existCount + 1

        const spec = parseDeckSpec({ slides: args.slides })

        // 主题：显式指定优先；否则从文件读回配色沿用，保证追加页与原文件同源。
        const meta = await deps.cli.run<{ results?: Array<{ format?: Record<string, unknown> }> }>(
          sessionId,
          ['get', abs, '/'],
        )
        const inherited = meta.ok ? inferTheme(meta.data.results?.[0]?.format) : undefined
        const theme = args.theme ? getTheme(args.theme) : inherited ?? getTheme(undefined)
        const themeId = args.theme ?? theme.id

        const commands: unknown[] = []
        // 只有显式换肤才改写 presentation 主题；继承时不动根主题，避免牵连已有页。
        if (args.theme) commands.push({ command: 'set', path: '/', props: themeToProps(theme) })

        const { renderSlide } = await import('../pptx/layouts.js')
        const { toProps } = await import('../pptx/shape.js')

        const total = existCount + args.slides.length
        args.slides.forEach((raw, i) => {
          const slide = spec.slides[i]!
          const pageNo = insertAt + i
          const res = renderSlide(slide, theme, pageNo, { total })
          commands.push({
            command: 'add',
            path: '/',
            type: 'slide',
            index: pageNo - 1,
            props: { layout: 'blank' },
          })
          for (const shape of res.shapes) {
            commands.push({
              command: 'add',
              path: `/slide[${pageNo}]`,
              type: 'shape',
              props: toProps(shape),
            })
          }
          if (res.table) {
            const { headers, rows } = res.table
            const data = [headers, ...rows].map((r) => r.join('|')).join(';')
            commands.push({
              command: 'add',
              path: `/slide[${pageNo}]`,
              type: 'table',
              props: {
                rows: String(rows.length + 1),
                cols: String(headers.length),
                data,
                x: `${res.table.x}pt`,
                y: `${res.table.y}pt`,
                width: `${res.table.w}pt`,
                height: `${res.table.h}pt`,
                headerRow: 'true',
                bandRow: 'true',
                fill: theme.bg,
                color: theme.text,
                size: '13',
                'font.ea': theme.fontBody.ea,
                font: theme.fontBody.latin,
                align: 'center',
                valign: 'middle',
              },
            })
          }
          // 追加页同样支持 per-slide 样式（背景/转场/隐藏）
          const sp: Record<string, string> = {}
          if (res.background) sp.background = res.background
          else if (slide.background) sp.background = slide.background
          if (slide.transition) sp.transition = slide.transition
          if (slide.hidden) sp.hidden = 'true'
          if (Object.keys(sp).length > 0) {
            commands.push({ command: 'set', path: `/slide[${pageNo}]`, props: sp })
          }
          void raw
        })

        await submitBatch(deps, sessionId, abs, commands)
        const saveRes = await deps.cli.run(sessionId, ['save', abs])
        if (!saveRes.ok && !/already saved/i.test(String(saveRes.error.error))) throw cliError(saveRes)

        notify(deps, sessionId, {
          file: args.filename,
          tool: 'office_slide_add',
          detail: { added: args.slides.length, totalSlides: existCount + args.slides.length, theme: themeId },
        }, cwd)
        warmWatch(deps, sessionId, args.filename, cwd)
        return {
          filename: args.filename,
          added: args.slides.length,
          totalSlides: existCount + args.slides.length,
          startPage: insertAt,
          theme: themeId,
        }
      },
    }),
  )

  /** 版式 id 列表，供工具描述复用。 */
  void LAYOUT_IDS
}
