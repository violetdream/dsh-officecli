/**
 * 设计流程工具：三方向选型（office_deck_directions）与设计评审（office_deck_review）。
 *
 * 这两个工具对应 huashu-design 的「方向硬门」与「5 维度评审」，落进本插件时做了
 * 一处关键改造：**它们都基于真实产物，而不是文字描述**。方向门出的是可以直接截图
 * 给用户看的 .pptx 初稿（2 页代表页 × 3 个方向），评审拿到的是同一套解析链算出的
 * 真实主题与字号 —— 而不是让模型凭记忆复述一遍"应该注意什么"。
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { existsSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { compileDeck, DeckSpecError, parseDeckSpec, type DeckSpec } from '../pptx/deck.js'
import { formatLint, lintDeck } from '../pptx/lint.js'
import { pickDirections, PPT_STYLES, paletteSummary, type PptStyle } from '../pptx/styles.js'
import { cliError, getSessionCwd, getSessionId, notify, textCard, warmWatch } from './common.js'
import { submitBatch } from './deck.js'
import type { PluginDeps } from '../routes.js'

/** 夹取到区间（评审打分用）。 */
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/** DeckSpec → 参与「内容 → 风格」匹配的纯文本。 */
function deckText(spec: DeckSpec): string {
  const parts: string[] = []
  const walk = (v: unknown): void => {
    if (typeof v === 'string') {
      parts.push(v)
      return
    }
    if (Array.isArray(v)) {
      for (const item of v) walk(item)
      return
    }
    if (v && typeof v === 'object') {
      for (const val of Object.values(v as Record<string, unknown>)) walk(val)
    }
  }
  walk(spec.slides.map((s) => ({ ...s, layout: undefined })))
  walk(spec.style?.meta)
  return parts.join(' ')
}

/**
 * 从整份稿子里挑出「代表页」。
 *
 * 选首页（通常是封面）+ 第一个内容页 —— 这两个位置足以看出一个方向的配色、字阶、
 * 标题处理与信息密度。不必整份重做三遍：三方向的目的只是让用户在**看得见视觉的
 * 前提下做选择**，2 页足够，成本也可控。
 */
function representativeSlides(spec: DeckSpec): { slides: DeckSpec['slides']; note: string } {
  const cover = spec.slides.find((s) => s.layout === 'cover') ?? spec.slides[0]!
  const content =
    spec.slides.find((s) => s.layout !== 'cover' && s.layout !== 'section' && s.layout !== 'ending') ??
    spec.slides.find((s) => s !== cover) ??
    cover
  const picked = cover === content ? [cover] : [cover, content]
  return {
    slides: picked,
    note: picked.map((s) => s.layout).join(' + '),
  }
}

/** 输出文件名：`demo.pptx` + 方向 a → `demo-方向a.pptx`。 */
function directionPath(abs: string, suffix: string): string {
  const ext = extname(abs)
  const stem = basename(abs, ext)
  return join(dirname(abs), `${stem}-${suffix}${ext}`)
}

export function registerDesignTools(ctx: Context, deps: PluginDeps): void {
  // -----------------------------------------------------------------------
  // office_deck_directions：三方向真实初稿
  // -----------------------------------------------------------------------
  ctx.tools.register(
    defineTool({
      name: 'office_deck_directions',
      description:
        '在正式生成整份 PPT 之前，先用同一份内容做出 3 个差异化视觉方向的真实初稿（各 2 页代表页），供用户看着实物选择。' +
        '方向按「安静 / 中性 / 大胆」三个温度档各取一条，避免三个方向都落在「白底极简 + 一个点缀色」这种最常见的失败模式。' +
        '选定的 preset 可直接填回 office_deck_create 的 deck.style.preset。' +
        '适用：新任务、用户没说清要什么风格、用户在几套风格之间犹豫。用户已明确指定风格时不必调用。',
      parameters: {
        filename: { type: 'string', required: true, description: '基础文件名（.pptx）。实际产出会加方向后缀，如 demo-方向a.pptx。' },
        deck: {
          type: 'object',
          required: true,
          description:
            '完整的 DeckSpec（与 office_deck_create 同构）。插件只取其中的封面页与第一个内容页做三个方向，其余页面暂不生成。' +
            '如果 deck.style.preset 已有值，它会被三个方向覆盖。',
          additionalProperties: true,
        },
        presets: {
          type: 'array',
          description:
            '可选：手动指定 3 个风格 id（见 office_design_guide 的 styles 节）。省略时按稿件内容的关键词自动匹配，' +
            '并在安静/中性/大胆三档各取一条，保证方向之间真有差异。',
          items: { type: 'string' },
        },
        overwrite: { type: 'boolean', description: '同名文件已存在时是否覆盖，默认 true（初稿通常要反复出）' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => {
          const v = value as {
            files: { filename: string; path: string; style: string; styleName: string; temp: string; rationale: string; matched: string[] }[]
            pages: string
            brief: string
            failed?: string
          }
          return textCard(
            `已生成 ${v.files.length} 个方向初稿（每版 ${v.pages}）`,
            '',
            ...v.files.map(
              (f) =>
                `【${f.temp}派】${f.styleName}（${f.style}）\n` +
                `   文件: ${f.filename}\n` +
                `   内容命中: ${f.matched.length > 0 ? f.matched.join('、') : '（无关键词命中，按温度档兜底）'}\n` +
                `   为什么是这组色: ${f.rationale}`,
            ),
            '',
            v.failed ? `⚠️ ${v.failed}` : '',
            '下一步（必须做）：',
            '  1) 对每个文件调用 office_screenshot，把三张图都发给用户；',
            '  2) 让用户挑一个方向（也可以混搭），不要把三版直接当成最终稿；',
            '  3) 用户选定后，把它填进 office_deck_create 的 deck.style.preset 再生成整份。',
            '',
            v.brief,
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
        const spec = parseDeckSpec(args.deck)

        // 三方向：显式指定优先（按顺序取三个不同风格），否则按内容关键词在三档里各取一条
        let picks: { style: PptStyle; temp: string; matched: string[] }[]
        if (args.presets && args.presets.length > 0) {
          const wanted = args.presets.slice(0, 3)
          picks = wanted.map((id) => {
            const hit = PPT_STYLES.find((s) => s.id === id)
            if (!hit) {
              throw new DeckSpecError(
                `未知风格 "${id}"。可用：${PPT_STYLES.map((s) => s.id).join(', ')}（或 office_design_guide 的 styles 节）`,
              )
            }
            return { style: hit, temp: hit.temp, matched: [] }
          })
        } else {
          picks = pickDirections(deckText(spec))
        }
        if (picks.length === 0) throw new DeckSpecError('未能匹配到任何风格方向，请用 presets 参数显式指定。')

        const { slides, note } = representativeSlides(spec)
        const suffixes = ['方向a', '方向b', '方向c']
        const files: {
          filename: string
          path: string
          style: string
          styleName: string
          temp: string
          rationale: string
          matched: string[]
        }[] = []
        const failures: string[] = []

        for (const [i, pick] of picks.entries()) {
          const out = directionPath(abs, suffixes[i] ?? `方向${i + 1}`)
          const filename = basename(out)
          if (existsSync(out) && args.overwrite === false) {
            failures.push(`${filename} 已存在（未覆盖）`)
            continue
          }
          if (existsSync(out)) await deps.cli.run(sessionId, ['close', out])

          // 用同一份内容只换风格：这样三版之间的差异全部来自视觉系统，可以直接横向比。
          const mini: DeckSpec = {
            template: spec.template,
            style: { ...(spec.style ?? {}), preset: pick.style.id, colors: spec.style?.colors },
            footer: spec.footer,
            slides,
          }
          const compiled = compileDeck(mini)
          const createRes = await deps.cli.run(sessionId, ['create', out, '--type', 'pptx', '--force'])
          if (!createRes.ok) {
            failures.push(`${filename}: ${createRes.error.error}`)
            continue
          }
          try {
            await submitBatch(deps, sessionId, out, compiled.commands)
          } catch (e) {
            failures.push(`${filename}: ${(e as Error).message}`)
            continue
          }
          const saveRes = await deps.cli.run(sessionId, ['save', out])
          if (!saveRes.ok && !/already saved/i.test(String(saveRes.error.error))) {
            failures.push(`${filename}: ${cliError(saveRes).message}`)
            continue
          }
          files.push({
            filename,
            path: out,
            style: pick.style.id,
            styleName: pick.style.name,
            temp: pick.temp,
            rationale: pick.style.rationale,
            matched: pick.matched,
          })
        }

        if (files.length === 0) {
          throw new Error(`三个方向都没能生成：\n${failures.join('\n')}`)
        }
        notify(deps, sessionId, {
          file: files[0]!.filename,
          tool: 'office_deck_directions',
          detail: { files: files.length, styles: files.map((f) => f.style).join(','), pages: note },
        }, cwd)
        for (const f of files) warmWatch(deps, sessionId, f.filename, cwd)

        return {
          files,
          pages: `${slides.length} 页（${note}）`,
          failed: failures.length > 0 ? `有 ${failures.length} 个方向生成失败：${failures.join('；')}` : '',
          brief:
            '三方向应当有**温度梯度**：安静派当稳妥底盘、中性派作主力、大胆派用来打破沉闷。' +
            '把它们并排给用户看，请他挑一个或混搭；不要替用户决定，也不要在没看到视觉的情况下问"你喜欢什么风格"。',
        }
      },
    }),
  )

  // -----------------------------------------------------------------------
  // office_deck_review：设计评审
  // -----------------------------------------------------------------------
  ctx.tools.register(
    defineTool({
      name: 'office_deck_review',
      description:
        '对一份 DeckSpec 做设计评审：机械维度（视觉层级 / 细节执行 / 功能性）由结构自动打分并给出原始数值，' +
        '判断维度（概念立意 / 风格一致性 / 创新性）留给你结合截图来评，并附「概念一票否决」规则与报告模板。' +
        '用户提到「评审 / 好不好看 / 打分 / review」，或你想在交付前主动质检时调用。' +
        '建议先 office_screenshot 拿到图，再把观察写进 observations 参数。',
      parameters: {
        deck: {
          type: 'object',
          required: true,
          description: '待评审的 DeckSpec（与 office_deck_create 的 deck 参数同构）。',
          additionalProperties: true,
        },
        observations: {
          type: 'string',
          description:
            '可选：你从 office_screenshot 的图里看到的具体现象（如「第 3 页标题压住了图表」「封面主标题只占半行」）。' +
            '写进来会被并入报告，机械打分看不到这些。',
        },
        focus: {
          type: 'string',
          enum: ['auto', 'presentation', 'reading'] as const,
          description:
            '评审侧重，决定「密度」算优点还是缺点：presentation 投屏（每页一个观点，偏密要扣分）；' +
            'reading 阅读型（信息密度是优点，内容偏薄要扣分）。auto 按页数与版式自由度推定。',
        },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => {
          const v = value as { report: string; score: number; band: string }
          return textCard(`设计评审（结构推断）：${v.score.toFixed(1)}/10 —— ${v.band}`, '', v.report)
        },
      },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const spec = parseDeckSpec(args.deck)
        const cwd = getSessionCwd(exec)
        const report = lintDeck(spec, cwd)
        const s = report.stats
        const preset = PPT_STYLES.find((p) => p.id === s.preset)

        // 评审侧重决定「密度算优点还是缺点」。auto 按页数与版式自由度推定：
        // 页多且以对称版式为主 → 更像阅读型文档；否则按投屏稿对待。
        const focus =
          args.focus && args.focus !== 'auto'
            ? args.focus
            : s.pages >= 12 && s.asymmetricRatio < 0.5
              ? 'reading'
              : 'presentation'
        const avgWords = s.wordCounts.length > 0 ? s.wordCounts.reduce((a, b) => a + b, 0) / s.wordCounts.length : 0

        // ---- 机械维度打分（由结构推断，不是目视结论）----
        const dims: { name: string; score: number; basis: string }[] = []
        dims.push({
          name: '视觉层级',
          score: s.typeRatio >= 3 && s.typeLevels >= 3 ? 8 : s.typeRatio >= 2.5 && s.typeLevels >= 3 ? 7 : s.typeRatio >= 2.2 ? 5 : 3,
          basis: `最大字号/正文 = ${s.typeRatio.toFixed(2)}（目标 ≥2.5），可分辨层级 ${s.typeLevels} 个（目标 ≥3）`,
        })
        const craftPenalty =
          (s.fontFamilies.latin > 2 ? 2 : 0) + (s.fontFamilies.ea > 2 ? 2 : 0) + (s.chromaticTokens > 3 ? 1 : 0)
        dims.push({
          name: '细节执行',
          score: clamp(9 - craftPenalty, 3, 9),
          basis: `字体家族 ${s.fontFamilies.latin} 西 / ${s.fontFamilies.ea} 中（目标各 ≤2），不同色相 ${s.chromaticTokens} 种（目标 ≤3），版式与间距由 12 栏网格 + 8pt 基线保证`,
        })
        // 功能性按侧重判：投屏稿怕「太密」，阅读稿怕「太薄」。同一份稿子换侧重结论就该不同。
        const thin = s.wordCounts.filter((w) => w < 60).length
        const dense = s.wordCounts.filter((w) => w > 110).length
        dims.push(
          focus === 'presentation'
            ? {
                name: '功能性（投屏）',
                score: clamp(9 - (dense > 0 ? 2 : 0) - (s.withNotes === 0 && s.pages >= 4 ? 1 : 0), 4, 9),
                basis: `页均 ${Math.round(avgWords)} 字，偏密页 ${dense} 页（投屏稿每页只该有一个观点），有备注 ${s.withNotes}/${s.pages} 页`,
              }
            : {
                name: '功能性（阅读）',
                score: clamp(9 - (thin > 0 ? 2 : 0), 4, 9),
                basis: `页均 ${Math.round(avgWords)} 字，内容偏薄页 ${thin} 页（阅读稿可承载书稿级密度），有备注 ${s.withNotes}/${s.pages} 页`,
              },
        )

        const mechAvg = dims.reduce((a, d) => a + d.score, 0) / dims.length
        // 概念维度由人判定，此处给中性分并明确标注，不虚报
        const CONCEPT_PLACEHOLDER = 6
        const score = Math.min(10, (mechAvg * 3 + CONCEPT_PLACEHOLDER * 3) / 6)
        const band = score >= 8 ? '优秀' : score >= 6 ? '良好' : score >= 4 ? '需改进' : '不合格'

        const lines = [
          '## 设计评审报告',
          '',
          `**总体评分** ${score.toFixed(1)}/10（${band}）`,
          `**评审侧重** ${focus === 'presentation' ? '投屏（每页一个观点，密=缺点）' : '阅读（信息密度=优点）'}`,
          '⚠️ 这是**结构推断分**，未含目视结论：概念/风格一致性/创新性三维需要你结合截图判定；',
          '   概念维度适用**一票否决**：概念 ≤5 分时总评封顶 6.0，并按模板重写报告 —— 执行再精致，',
          '   立意是模板化的，整体就不是一个好设计。',
          '',
          '**机械维度**（已算好，可直接引用）',
          ...dims.map((d) => `- ${d.name}：${d.score}/10 —— ${d.basis}`),
          '',
          '**待你判定的维度**（0-10，各附一句话理由）',
          '- 概念/立意：?/10 —— 这个设计的 idea 是什么？盖住所有文字还认得出主题吗？换个客户名还成立吗（成立=模板，直接 ≤5）？',
          `- 风格一致性：?/10 —— 是否贯彻了「${preset?.name ?? '未指定风格'}」的标志性手法？有无自相矛盾的元素？`,
          '- 创新性：?/10 —— 是否避开了常见 cliché（紫渐变、emoji 图标、圆角卡片+左彩边）？有无意想不到但合理的决策？',
          '',
          '**结构体检原文**',
          formatLint(report) ?? '未发现结构性问题。',
        ]
        if (preset) {
          lines.push(
            '',
            `**所选风格「${preset.name}」的 anti-pattern（逐条核对）**`,
            ...preset.anti.map((a) => `- ${a}`),
            `- 色板 OKLCH 摘要：${paletteSummary(preset)}`,
          )
        }
        if (report.colorRationale) {
          lines.push('', '**色彩论证**', report.colorRationale)
        } else if (!s.preset) {
          lines.push(
            '',
            '**色彩论证：缺失**',
            '既没指定风格预设、也没有按主色派生，因此没有「为什么是这组色」的论证。',
            '色彩推导三步（采样 → 收敛 → 论证）的第三步不能跳 —— 建议补 deck.style.colorRationale。',
          )
        }
        if (args.observations) {
          lines.push('', '**你从截图里观察到的**（已并入）', args.observations)
        }
        lines.push(
          '',
          '**问题清单（Fix）**请按 ⚠️致命 / ⚡重要 / 💡优化 三级排序，每条写「当前 / 问题 / 修复（含具体数值）」，',
          '最后给「快速修复清单」：只有 5 分钟时优先做的 3 件事。',
        )

        return {
          score,
          band,
          mechanical: dims,
          report: lines.join('\n'),
        }
      },
    }),
  )
}
