import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { existsSync } from 'node:fs'
import { DeckSpecError, compileDeck, parseDeckSpec, type DeckSpec } from '../pptx/deck.js'
import { LAYOUT_IDS } from '../pptx/layouts.js'
import { formatLint, lintDeck } from '../pptx/lint.js'
import { fixDiagramInk } from '../pptx/postpass.js'
import { findTheme, getTheme, inferTheme, themeToProps } from '../pptx/theme.js'
import { getTemplate, refreshTemplates } from '../pptx/templates.js'
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
function toDeck(input: unknown, cwd?: string): DeckSpec {
  // 用户模板随会话目录变化，且文件可能刚被编辑：每次生成前按需重载。
  refreshTemplates(cwd)
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
        '生成 PPT 前必读：返回模板清单（含用户自定义模板）、主题与自然语言的映射表、样式注入协议、' +
        '可用元素能力（原生图表/表格/配图/图示/演讲者备注/动画）、叙事与密度门禁、每类字段的字数红线、' +
        '版式契约（DeckSpec 结构）和生成后的视觉自检清单。' +
        '在调用 office_deck_create 之前先调用本工具，能显著降低返工率。',
      parameters: {
        section: {
          type: 'string',
          enum: ['all', 'templates', 'themes', 'style', 'custom', 'elements', 'story', 'limits', 'scale', 'spec', 'checklist'] as const,
          description:
            '只看某一节；缺省返回完整指南。custom = 如何写自定义模板文件；elements = 图表/配图/图示/备注/动画能力；' +
            'story = 叙事与密度门禁（必读）',
        },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => textCard((value as { guide: string }).guide),
      },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const section = args.section === 'all' ? undefined : args.section
        refreshTemplates(getSessionCwd(exec))
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
        '无需自己指定位置。可选 template（咨询简报/产品发布/学术答辩/极简/政务报告/年度报告/科技青主题演讲/数据复盘/暖橙营销/教学课件/自然绿ESG/融资路演，' +
        '以及用户的自定义模板）一键获得专业感；theme 支持中文说法甚至主色 hex（"科技蓝"、"政务红"、"#0F5EA6"）；' +
        '可选 style 注入整份样式（转场/背景/页码/元数据/配色/字体/字号缩放）。生成后用 office_screenshot 看效果并按自检清单修正。' +
        '首次使用请先调用 office_design_guide 了解 DeckSpec 结构与字数红线。',
      parameters: {
        filename: { type: 'string', required: true, description: '输出文件名，必须以 .pptx 结尾（如 ai-intro.pptx）。支持中文名。' },
        deck: {
          type: 'object',
          required: true,
          description:
            'DeckSpec 对象：{ template?, theme?, footer?, style?, slides: [{layout, ...内容}] }。' +
            'layout 取值：基础版式 cover/section/bullets/cards/kpi/steps/compare/timeline/quote/table/agenda/swot/pricing/roadmap/ending；' +
            '元素型版式 chart（原生图表+洞察）/image-split（一栏大图+一栏文字）/image-full（全幅底图+骑线文字）/diagram（mermaid 图示）。' +
            '每页还可带 notes（演讲者备注）与 animate（入场动画）。' +
            'theme 可直接写用户的话（"科技蓝风格"）或主色（"#0F5EA6"）；style.colors/fonts/typography 用于微调配色、字体与字号。详见 office_design_guide。',
          additionalProperties: true,
        },
        overwrite: { type: 'boolean', description: '文件已存在时是否覆盖，默认 false' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => {
          const v = value as {
            filename: string
            pageCount: number
            shapeCount: number
            layouts: string[]
            path: string
            template?: string
            theme: string
            note?: string
            elements?: Record<string, number>
            lint?: string
          }
          const el = v.elements ?? {}
          const elLine = Object.entries(el)
            .filter(([k]) => k !== 'shape')
            .map(([k, n]) => `${k}×${n}`)
            .join('  ')
          return textCard(
            `已生成 ${v.filename}：${v.pageCount} 页 / ${v.shapeCount} 个形状`,
            `模板: ${v.template ?? '（未指定，基础样式）'}  配色: ${v.theme}`,
            ...(v.note ? [v.note] : []),
            ...(elLine ? [`原生元素: ${elLine}`] : []),
            `版式: ${v.layouts.join(' → ')}`,
            `路径: ${v.path}`,
            '',
            ...(v.lint ? [v.lint, ''] : []),
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

        const spec = toDeck(args.deck, cwd)
        // 生成前体检：错误级问题（图表缺判断、图片文件不存在）直接拦下，
        // 别让模型产出一份用户一打开就发现缺图的稿子。
        const report = lintDeck(spec, cwd)
        const lintText = formatLint(report)
        if (report.errors.length > 0) {
          throw new DeckSpecError(
            `生成前体检未通过，已阻止生成：\n${lintText}\n\n请按下述条目修正 DeckSpec 后重试。`,
          )
        }
        const compiled = compileDeck(spec)

        // 创建（或复用）文件
        const createRes = await deps.cli.run(sessionId, ['create', abs, '--type', 'pptx', '--force'])
        if (!createRes.ok) throw cliError(createRes)

        await submitBatch(deps, sessionId, abs, compiled.commands)

        // 落盘：resident 模式下 batch 只写内存
        const saveRes = await deps.cli.run(sessionId, ['save', abs])
        if (!saveRes.ok && !/already saved/i.test(String(saveRes.error.error))) throw cliError(saveRes)

        // 批后修正：diagram 的 native 合成器给节点固定浅底且不设文字色，
        // 深色主题下会变成「浅底浅字」。组内形状 id 只有运行时才有，只能批后补。
        const elementCounts = compiled.commands.reduce<Record<string, number>>((acc, c) => {
          if (c.command === 'add' && c.type && c.type !== 'slide') {
            acc[c.type] = (acc[c.type] ?? 0) + 1
          }
          return acc
        }, {})
        if (elementCounts.diagram) {
          const ink = await fixDiagramInk(deps.cli, sessionId, abs)
          if (ink.fixed > 0) await deps.cli.run(sessionId, ['save', abs])
        }

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
          // 元素用量回执：让模型知道这版到底用了哪些原生元素
          elements: elementCounts,
          // 体检建议（错误级已在生成前拦下）
          lint: lintText ?? '',
          // 主题是被"翻译"过来的（用户口语/主色）时告诉模型一声，避免它以为填错了
          note: compiled.theme.id.startsWith('custom-')
            ? `按主色 ${compiled.theme.primary} 派生了整套配色（辅色/强调色同色轮推导）。`
            : compiled.theme.name,
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
            '追加的页面绝不应该换配色，除非你就是要重做整套视觉。同样支持中文说法与主色 hex。',
        },
        template: {
          type: 'string',
          description:
            '可选：沿用某个模板的内容页装饰与页码格式（如 consulting），让追加页与原 deck 的视觉外衣保持一致；缺省不带装饰。',
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

        // 主题：显式指定优先（同样支持口语与主色）；否则从文件读回配色沿用，
        // 保证追加页与原文件同源。
        const meta = await deps.cli.run<{ results?: Array<{ format?: Record<string, unknown> }> }>(
          sessionId,
          ['get', abs, '/'],
        )
        const inherited = meta.ok ? inferTheme(meta.data.results?.[0]?.format) : undefined
        const theme = findTheme(args.theme) ?? inherited ?? getTheme(undefined)
        const themeId = args.theme ?? theme.id
        const template = getTemplate(args.template)

        const commands: unknown[] = []
        // 只有显式换肤才改写 presentation 主题；继承时不动根主题，避免牵连已有页。
        if (args.theme) commands.push({ command: 'set', path: '/', props: themeToProps(theme) })

        const { renderSlide } = await import('../pptx/layouts.js')
        const { toProps } = await import('../pptx/shape.js')
        const { slideElementCommands, normalizeAnimEffect } = await import('../pptx/elements.js')
        const { pickAnimateTarget } = await import('../pptx/deck.js')
        const pageNumber = template?.pageNumber ?? true
        const transition = template?.transition

        const total = existCount + args.slides.length
        const elementTheme = { text: theme.text, muted: theme.muted, bg: theme.bg, fontBody: theme.fontBody }
        args.slides.forEach((raw, i) => {
          const slide = spec.slides[i]!
          const pageNo = insertAt + i
          const res = renderSlide(slide, theme, pageNo, { total, pageNumber, template })
          commands.push({
            command: 'add',
            path: '/',
            type: 'slide',
            index: pageNo - 1,
            props: { layout: 'blank' },
          })
          const emitElements = (): void => {
            for (const cmd of slideElementCommands(res.elements ?? [], pageNo, elementTheme)) {
              commands.push(cmd)
            }
          }
          if (res.elementsBehind) emitElements()
          for (const shape of res.shapes) {
            commands.push({
              command: 'add',
              path: `/slide[${pageNo}]`,
              type: 'shape',
              props: toProps(shape),
            })
          }
          if (!res.elementsBehind) emitElements()

          // 追加页同样支持演讲者备注与入场动画
          if (slide.notes) {
            commands.push({ command: 'add', path: `/slide[${pageNo}]`, type: 'notes', props: { text: slide.notes } })
          }
          if (slide.animate) {
            const target = pickAnimateTarget(res, pageNo)
            if (target) {
              commands.push({
                command: 'add',
                path: `/slide[${pageNo}]/${target.parent}[@name=${target.name}]`,
                type: 'animation',
                props: {
                  effect: normalizeAnimEffect(typeof slide.animate === 'string' ? slide.animate : undefined),
                  class: 'entrance',
                  trigger: 'afterPrevious',
                  duration: '600',
                },
              })
            }
          }
          // 追加页同样支持 per-slide 样式（背景/转场/隐藏）
          const sp: Record<string, string> = {}
          if (res.background) sp.background = res.background
          else if (slide.background) sp.background = slide.background
          if (slide.transition) sp.transition = slide.transition
          else if (transition) sp.transition = transition
          if (slide.hidden) sp.hidden = 'true'
          if (Object.keys(sp).length > 0) {
            commands.push({ command: 'set', path: `/slide[${pageNo}]`, props: sp })
          }
          void raw
        })

        await submitBatch(deps, sessionId, abs, commands)
        const saveRes = await deps.cli.run(sessionId, ['save', abs])
        if (!saveRes.ok && !/already saved/i.test(String(saveRes.error.error))) throw cliError(saveRes)

        // 同 office_deck_create：图示节点在深色主题下需要批后补深色墨
        if (args.slides.some((s) => (s as { layout?: string })?.layout === 'diagram')) {
          const ink = await fixDiagramInk(deps.cli, sessionId, abs)
          if (ink.fixed > 0) await deps.cli.run(sessionId, ['save', abs])
        }

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

  // -----------------------------------------------------------------------
  // office_deck_lint：生成前结构体检（不写文件）
  // -----------------------------------------------------------------------
  ctx.tools.register(
    defineTool({
      name: 'office_deck_lint',
      description:
        '在不生成文件的前提下体检一份 DeckSpec：检查密度下限（每页字数是否太薄）、版式多样性（相邻页重复、cards 用太多）、' +
        '非对称版式占比（是否 ≥30%）、数据页是否有洞察判断、配图文件是否真实存在、演讲者备注与动画覆盖情况。' +
        '返回错误（必须先修）与建议（可选改进）两级。office_deck_create 会自动跑这套检查并拦下错误级问题，' +
        '本工具适合在「先想清楚再生成」的流程里单独调用。',
      parameters: {
        deck: {
          type: 'object',
          required: true,
          description: '待体检的 DeckSpec 对象（与 office_deck_create 的 deck 参数同构）。',
          additionalProperties: true,
        },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => {
          const v = value as { report?: string; ok: boolean; errors: number; warnings: number }
          return textCard(
            v.ok
              ? `体检通过${v.warnings > 0 ? `（${v.warnings} 条建议）` : '，无问题'}`
              : `体检未通过：${v.errors} 项必须修复、${v.warnings} 条建议`,
            '',
            v.report ?? '',
          )
        },
      },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const spec = toDeck(args.deck, getSessionCwd(exec))
        const report = lintDeck(spec, getSessionCwd(exec))
        return {
          ok: report.errors.length === 0,
          errors: report.errors.length,
          warnings: report.warnings.length,
          stats: report.stats,
          report: formatLint(report) ?? '未发现结构性问题。',
        }
      },
    }),
  )

  /** 版式 id 列表，供工具描述复用。 */
  void LAYOUT_IDS
}
