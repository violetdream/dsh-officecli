/**
 * DeckSpec 结构体检。
 *
 * 设计门禁（密度下限、版式多样性、非对称占比、数据落点、配图存在性）写在
 * 指南里只是「建议」——模型读没读、读了做没做，没人验证。这一层把可判定的部分
 * 变成**可执行检查**：生成前先跑一遍，把问题直接回给模型让它改，而不是等用户
 * 打开 PPT 才发现整份稿子清一色等宽卡片。
 *
 * 检查分两级：
 *   error   几乎一定会让成品不合格（图表缺判断、图片文件不存在）——建议先修再生成
 *   warn    风格与节奏问题（cards 用太多、没有非对称页、缺演讲者备注）
 *
 * 检查分三层：
 *   ── 结构层（页数、密度、版式分布）    模板和字号算不出来的东西
 *   ── 审美层（字号层级、字体数、配色数）huashu-design 的设计评审里可机械判定的部分
 *   ── 风格层（预设的 anti-pattern）    选了流派却不守它的规矩
 *
 * 审美层与风格层共用 `resolveDeckVisuals`，保证体检看到的主题/字号就是生成出来的
 * 那一套 —— 否则体检结论会与实际产物脱节。
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { resolveTypeScale, type TypeScale } from './grid.js'
import { resolveDeckVisuals, type DeckSpec, type TypographyOverride } from './deck.js'
import type { SlideSpec } from './layouts.js'
import { densityFactor, type PptStyle } from './styles.js'
import { hexToOklch, type Theme } from './theme.js'

export interface LintIssue {
  /** 涉及第几页（1-based）；全篇性问题为 undefined。 */
  page?: number
  layout?: string
  message: string
}

export interface LintReport {
  errors: LintIssue[]
  warnings: LintIssue[]
  stats: {
    pages: number
    /** 非对称版式（chart / image-split / image-full）的页数与占比。 */
    asymmetric: number
    asymmetricRatio: number
    layoutCounts: Record<string, number>
    /** 每页正文字数估计。 */
    wordCounts: number[]
    /** 有演讲者备注的页数。 */
    withNotes: number
    /** 有入场动画的页数。 */
    withAnimation: number
    /** 命中的风格预设（未指定为 undefined）。 */
    preset?: string
    /** 生效主题 id。 */
    theme: string
    /** 字号层级比：最大字号 ÷ 正文字号。 */
    typeRatio: number
    /** 全篇可分辨的字号层级数。 */
    typeLevels: number
    /** 字体家族数（西文 / 中文各计）。 */
    fontFamilies: { latin: number; ea: number }
    /** 有彩色令牌数（chroma ≥ 0.03 的色槽）。 */
    chromaticTokens: number
  }
  /** 色彩论证句（风格预设提供，或按主色推导得到）。 */
  colorRationale?: string
}

/** 非对称版式（一栏大图/图表 + 一栏文字，或全幅底图骑线）。 */
const ASYMMETRIC = new Set(['chart', 'image-split', 'image-full'])

/** 页面类型的字数下限。粗口径：够不够「一页讲透」。 */
const WORD_FLOOR: Record<string, number> = {
  cover: 20,
  section: 30,
  bullets: 120,
  cards: 180,
  kpi: 20,
  steps: 90,
  compare: 120,
  timeline: 80,
  quote: 30,
  table: 60,
  agenda: 60,
  swot: 80,
  pricing: 80,
  roadmap: 70,
  ending: 10,
  chart: 60,
  'image-split': 90,
  'image-full': 20,
  diagram: 20,
}

/**
 * 粗估一页的内容字数。
 *
 * 只统计「内容字段」，跳过纯样式字段（src / chartType / 颜色 / 版式名），
 * 否则把路径和 hex 计入会虚高。中文按字符计，西文按词计。
 */
export function countSlideWords(slide: SlideSpec): number {
  const SKIP = new Set([
    'layout',
    'src',
    'chartType',
    'legend',
    'displayUnits',
    'colors',
    'side',
    'align',
    'transition',
    'background',
    'animate',
    'overlay',
    'dataLabels',
    'hidden',
  ])
  let total = 0
  const walk = (v: unknown, key?: string): void => {
    if (key && SKIP.has(key)) return
    if (typeof v === 'string') {
      const cjk = (v.match(/[\u4e00-\u9fff]/g) ?? []).length
      const latin = (v.match(/[A-Za-z]+/g) ?? []).length
      total += cjk + latin
      return
    }
    if (typeof v === 'number' || typeof v === 'boolean' || v === null || v === undefined) return
    if (Array.isArray(v)) {
      for (const item of v) walk(item)
      return
    }
    if (typeof v === 'object') {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) walk(val, k)
    }
  }
  walk(slide)
  return total
}

/** 页面上引用的本地图片路径（用于存在性检查）。 */
function imagePaths(slide: SlideSpec): string[] {
  const s = slide as { image?: { src?: string } }
  return s.image?.src ? [s.image.src] : []
}

// ---------------------------------------------------------------------------
// 审美层：可机械判定的部分
// ---------------------------------------------------------------------------

/** 审美层算出的量化指标。 */
interface Aesthetic {
  typeRatio: number
  typeLevels: number
  fontFamilies: { latin: number; ea: number }
  chromaticTokens: number
}

/** 有彩色判定阈值：oklch chroma 低于此值视为中性灰（含主色的低饱和变体）。 */
const CHROMATIC_FLOOR = 0.05
/**
 * 色相聚类容差（度）。
 *
 * 取 45 而非 huashu 原文的 60：即便在 OKLCH 里，同一色系内部随明度/彩度变化也会有
 * 30–40° 的色相漂移 —— #D4AF37（金）落在 95° 而 #B45309（琥珀）落在 60°，
 * 肉眼是同一个色族。容差太紧会把「一套正常的配色」误判成「色太多」。
 */
const HUE_CLUSTER = 45

/**
 * 数「这份稿子到底用了几种颜色」。
 *
 * 不能按槽位个数算 —— `accent5` 往往是主色的同色相明度阶，把它算成独立颜色会
 * 让一套完全正常的配色被判成「色太多」。所以按色相聚类去重，且只统计 chroma
 * 达标的槽（更低的读起来就是中性灰的偏色，不构成一种颜色）。
 */
function countChromaticHues(theme: Theme, slots: readonly (keyof Theme)[]): { count: number; used: string[] } {
  const clusters: number[] = []
  const used: string[] = []
  for (const slot of slots) {
    const v = theme[slot]
    if (typeof v !== 'string') continue
    const o = hexToOklch(v)
    if (o.C < CHROMATIC_FLOOR) continue
    const near = clusters.some((c) => {
      const d = Math.abs(((o.h - c) % 360 + 540) % 360 - 180)
      return 180 - d <= HUE_CLUSTER
    })
    if (!near) {
      clusters.push(o.h)
      used.push(slot)
    }
  }
  return { count: clusters.length, used }
}

/** 参与「色彩数量」检查的槽位。 */
const HUE_SLOTS = ['primary', 'secondary', 'accent', 'accent5'] as const

/**
 * 「比正文明显大的层级」计数。
 *
 * 判据取 1.25× 而不是 1.1×：12pt 与 15pt 的差别在投屏上看不出来，把它算成一个
 * 层级只会让「层级充足」变成一句空话。
 */
function countTypeLevels(scale: TypeScale): number {
  const body = scale.body
  const levels = [scale.anchor, scale.coverTitle, scale.sectionTitle, scale.pageTitle, scale.cardTitle]
  return levels.filter((v) => v >= body * 1.25).length
}

/**
 * 审美层体检：字号层级 / 字体家族数 / 配色令牌数 / 审美禁区。
 *
 * 这些是 huashu-design 的设计评审里**可以机械判定**的部分（原本靠人眼打分），
 * 落成规则后就不必等用户说「不好看」才发现。
 */
function auditAesthetics(spec: DeckSpec, theme: Theme, typography: TypographyOverride): { issues: LintIssue[]; stats: Aesthetic } {
  const issues: LintIssue[] = []
  const scale = resolveTypeScale(typography)
  const body = scale.body
  const maxSize = Math.max(...Object.values(scale))
  const typeRatio = maxSize / body
  const typeLevels = countTypeLevels(scale)

  // ① 字号层级比：最大字号 ÷ 正文。原出处（huashu 的常见问题 Top 10 第 2 条）
  // 用的是 2.5 倍；PPT 里承担这个角色的是封面大标题或巨型数字锚点，不是页标题。
  if (typeRatio < 2.5) {
    issues.push({
      message:
        `字号层级不足：最大字号 ${maxSize}pt ÷ 正文 ${body}pt = ${typeRatio.toFixed(2)}（目标 ≥2.5）。` +
        `放大 coverTitle / anchor，或调小 body —— 层级不够时用户无法一眼找到重点。`,
    })
  }
  if (typeLevels < 3) {
    issues.push({
      message:
        `可分辨的字号层级只有 ${typeLevels} 个（目标 ≥3，以「比正文大 1.25 倍以上」计）。` +
        `全篇字都差不多大 = 没有层级。`,
    })
  }

  // ② 字体家族数：标题一个 + 正文一个，超了就是视觉噪音。
  const latin = new Set([theme.fontTitle.latin, theme.fontBody.latin])
  const ea = new Set([theme.fontTitle.ea, theme.fontBody.ea])
  if (latin.size > 2) {
    issues.push({
      message: `西文字体用了 ${latin.size} 个家族（${[...latin].join('、')}）。最多 2 个：标题一个 + 正文一个，其余靠字重与字号做变化。`,
    })
  }
  if (ea.size > 2) {
    issues.push({
      message: `中文字体用了 ${ea.size} 个家族（${[...ea].join('、')}）。最多 2 个：标题一个 + 正文一个。`,
    })
  }

  // ③ 色彩数量。
  //
  // 只在配色是**手填**的时候检查：内置主题、风格预设、按主色派生的配色都是受控的
  // （OKLCH 派生结果恒为 3 个有彩色 + 1 组中性），给它们做质检只会产生噪声。真正的
  // 风险是模型/用户逐个槽位手填出一堆互不相关的颜色。
  const handPicked = HUE_SLOTS.filter((slot) => typeof spec.style?.colors?.[slot] === 'string')
  const hues = countChromaticHues(theme, HUE_SLOTS)
  if (handPicked.length >= 3 && hues.count >= 4) {
    issues.push({
      message:
        `手填的配色里有 ${hues.count} 种互不相关的色相（${hues.used.join('、')}），超出「2–3 个有彩色 + 1 组中性色」的收敛要求。` +
        `色多必乱 —— 只保留主色，其余交给插件按主色派生（去掉 style.colors 里多余的槽），` +
        `或在 deck.style.colorRationale 里说明为什么需要这么多。`,
    })
  }

  // ④ 审美禁区：只管一种组合 —— 「均匀深蓝底 + 通用青/紫霓虹 glow」。
  // 这是 slop 清单里唯一被点名的具体组合，其余暗色（戏剧光影、暖色暗场）合法。
  const bgO = hexToOklch(theme.bg)
  const darkBlueBg = bgO.L < 0.24 && bgO.C >= 0.012 && bgO.h >= 205 && bgO.h <= 280
  if (darkBlueBg) {
    const neon = (['secondary', 'accent', 'accent5'] as const).filter((slot) => {
      const o = hexToOklch(theme[slot])
      const neonHue = (o.h >= 245 && o.h <= 330) || (o.h >= 155 && o.h <= 205)
      return o.C >= 0.17 && neonHue
    })
    if (neon.length > 0) {
      issues.push({
        message:
          `命中审美禁区：「均匀深蓝底（#${theme.bg}）+ 青/紫霓虹」（${neon.join('、')}）。` +
          `这是"GitHub-dark 偷懒解"，是训练语料里最烂大街的科技感组合。` +
          `改用中性近黑底（如 #0D0D0F）或换一套有作者意图的暗色方案；若用户品牌本身如此，可忽略本条。`,
      })
    }
  }
  // ⑤ 激进紫渐变万能公式：高饱和紫/粉占两个槽位。同样是「凭空发明颜色」的典型产物。
  const violentPurple = (['secondary', 'accent'] as const).filter((slot) => {
    const o = hexToOklch(theme[slot])
    return o.C >= 0.19 && o.h >= 265 && o.h <= 325
  })
  if (violentPurple.length >= 2) {
    issues.push({
      message: `配色接近「激进紫渐变万能公式」（${violentPurple.join('、')} 均为高饱和紫／粉）。若品牌本身不用紫，请在色彩论证里说明为什么是紫，否则换掉。`,
    })
  }

  return {
    issues,
    stats: {
      typeRatio,
      typeLevels,
      fontFamilies: { latin: latin.size, ea: ea.size },
      chromaticTokens: hues.count,
    },
  }
}

/**
 * 风格层体检：选了流派就要守它的规矩。
 *
 * `avoid` 是硬清单（这套风格下明显不成立的版式），可以机械判定；`anti` 是文字
 * 描述（这页不能怎么排），只能作为提醒附在后面。
 */
function auditPreset(preset: PptStyle, slides: SlideSpec[]): LintIssue[] {
  const issues: LintIssue[] = []
  const used = new Set(slides.map((s) => s.layout))
  const hit = preset.avoid.filter((l) => used.has(l))
  if (hit.length > 0) {
    const pages = slides
      .map((s, i) => (preset.avoid.includes(s.layout) ? i + 1 : 0))
      .filter((n) => n > 0)
    issues.push({
      message:
        `「${preset.name}」这套风格下不成立：${hit.join('、')}（第 ${pages.join('、')} 页）。` +
        `换到 ${preset.prefer.slice(0, 5).join(' / ')}，或换一套风格。`,
    })
  }
  if (preset.anti.length > 0) {
    issues.push({
      message: `「${preset.name}」的 anti-pattern 记得核对（截图时逐条看）：\n      · ${preset.anti.join('\n      · ')}`,
    })
  }
  return issues
}

/**
 * 体检一份 DeckSpec。
 *
 * @param spec - 已通过 parseDeckSpec 的规格
 * @param cwd  - 相对图片路径的基准目录（通常是会话工作目录）
 */
export function lintDeck(spec: DeckSpec, cwd?: string): LintReport {
  const errors: LintIssue[] = []
  const warnings: LintIssue[] = []
  const slides = spec.slides
  const layoutCounts: Record<string, number> = {}
  const wordCounts: number[] = []

  // 主题 / 字号 / 风格预设走与生成同一套解析，体检结论才与产物一致。
  const visuals = resolveDeckVisuals(spec)
  const preset = visuals.preset
  const density = densityFactor(preset)

  slides.forEach((slide, i) => {
    const page = i + 1
    layoutCounts[slide.layout] = (layoutCounts[slide.layout] ?? 0) + 1
    const words = countSlideWords(slide)
    wordCounts.push(words)

    // ① 密度下限（按风格密度档缩放：sparse 风格留白优先，dense 风格信息优先）
    const floor = Math.round((WORD_FLOOR[slide.layout] ?? 60) * density)
    if (words < floor) {
      warnings.push({
        page,
        layout: slide.layout,
        message:
          `内容偏薄：约 ${words} 字，${slide.layout} 建议 ≥ ${floor} 字` +
          `${density !== 1 && preset ? `（「${preset.name}」是${preset.density === 'sparse' ? '留白优先' : '信息优先'}的风格，下限已${density > 1 ? '上调' : '下调'}）` : ''}。` +
          `宁可一页讲透，也不要半页空转。`,
      })
    }

    // ② 数据必须落点
    if (slide.layout === 'chart') {
      const insight = (slide as { insight?: string }).insight
      if (!insight || insight.trim().length < 8) {
        errors.push({
          page,
          layout: 'chart',
          message: '数据页缺少 insight 判断。只摆数字不给结论是信息板，不是汇报稿——补一句「这个数字意味着什么」。',
        })
      }
    }

    // ③ 配图必须真实存在
    for (const src of imagePaths(slide)) {
      if (/^https?:\/\//i.test(src)) {
        errors.push({
          page,
          layout: slide.layout,
          message: `图片用了 URL（${src}）。officecli 不支持 http 图片，请先下载到本地再引用路径。`,
        })
        continue
      }
      const abs = resolve(cwd ?? process.cwd(), src)
      if (!existsSync(abs) && !existsSync(src)) {
        errors.push({
          page,
          layout: slide.layout,
          message: `图片文件不存在：${src}。请先准备好本地图片文件再生成。`,
        })
      }
    }

    // ④ 相邻页版式重复
    const prev = slides[i - 1]
    if (prev && prev.layout === slide.layout) {
      warnings.push({
        page,
        layout: slide.layout,
        message: `与上一页同为 ${slide.layout}。相邻页用不同版式，画面节奏才有起伏。`,
      })
    }
  })

  // ⑤ cards 用量上限
  if ((layoutCounts.cards ?? 0) > 2) {
    warnings.push({
      message: `cards 用了 ${layoutCounts.cards} 次（上限 2）。等宽卡片横排是「AI 味」最重的版式，换一些到 bullets 两栏 / compare / image-split。`,
    })
  }

  // ⑥ 非对称占比
  const asymmetric = slides.filter((s) => ASYMMETRIC.has(s.layout)).length
  const asymmetricRatio = slides.length > 0 ? asymmetric / slides.length : 0
  if (slides.length >= 5 && asymmetricRatio < 0.3) {
    warnings.push({
      message:
        `非对称版式只占 ${Math.round(asymmetricRatio * 100)}%（目标 ≥30%）。` +
        `把部分内容页换成 chart / image-split / image-full，避免全篇等宽排布带来流水线感。`,
    })
  }

  // ⑦ 连续同节奏
  let run = 1
  for (let i = 1; i < slides.length; i++) {
    run = slides[i]!.layout === slides[i - 1]!.layout ? run + 1 : 1
    if (run === 3) {
      warnings.push({
        page: i + 1,
        message: `连续 3 页都是 ${slides[i]!.layout}。连续同版式会让人失去方向感，中间插一页别的版式。`,
      })
    }
  }

  // ⑧ 演讲者备注
  const withNotes = slides.filter((s) => (s as { notes?: string }).notes).length
  if (slides.length >= 4 && withNotes === 0) {
    warnings.push({
      message: '全篇没有一页写了演讲者备注（slides[i].notes）。汇报稿建议每页都写「这页该说什么」，放映时演讲者可见。',
    })
  }

  const withAnimation = slides.filter((s) => (s as { animate?: unknown }).animate).length

  // ⑨ 审美层（字号层级 / 字体家族数 / 配色令牌数 / 审美禁区）
  const aesthetic = auditAesthetics(spec, visuals.theme, visuals.typography)
  warnings.push(...aesthetic.issues)

  // ⑩ 风格层：选了流派就要守它的规矩
  if (preset) warnings.push(...auditPreset(preset, slides))
  if (visuals.presetMissed) {
    warnings.push({
      message:
        `style.preset = "${visuals.presetMissed}" 无法识别，已按「无风格」生成。` +
        `用 office_design_guide({section:'styles'}) 查可用的流派 id（或中文别名）。`,
    })
  }

  return {
    errors,
    warnings,
    colorRationale: visuals.theme.colorRationale,
    stats: {
      pages: slides.length,
      asymmetric,
      asymmetricRatio,
      layoutCounts,
      wordCounts,
      withNotes,
      withAnimation,
      preset: preset?.id,
      theme: visuals.theme.id,
      ...aesthetic.stats,
    },
  }
}

/** 把体检结果渲染成给模型看的文本（无问题返回 null）。 */
export function formatLint(report: LintReport): string | null {
  const { errors, warnings, stats } = report
  if (errors.length === 0 && warnings.length === 0) return null
  const lines: string[] = []
  const at = (i: LintIssue): string => (i.page ? `第 ${i.page} 页` : '全篇') + `〔${i.layout ?? '-'}〕`
  if (errors.length > 0) {
    lines.push(`❌ 必须先修（${errors.length} 项）：`, ...errors.map((e) => `  · ${at(e)} ${e.message}`))
  }
  if (warnings.length > 0) {
    if (lines.length > 0) lines.push('')
    lines.push(`⚠️ 建议改进（${warnings.length} 项）：`, ...warnings.map((w) => `  · ${at(w)} ${w.message}`))
  }
  lines.push(
    '',
    `结构概览：${stats.pages} 页 · 非对称版式 ${stats.asymmetric} 页（${Math.round(stats.asymmetricRatio * 100)}%）` +
      ` · 有备注 ${stats.withNotes} 页 · 有动画 ${stats.withAnimation} 页`,
    `版式分布：${Object.entries(stats.layoutCounts).map(([k, v]) => `${k}×${v}`).join('  ')}`,
    `视觉系统：${stats.preset ? `风格「${stats.preset}」` : '未指定风格'} · 主题 ${stats.theme}` +
      ` · 字号层级比 ${stats.typeRatio.toFixed(2)}（${stats.typeLevels} 级）` +
      ` · 字体家族 ${stats.fontFamilies.latin}西/${stats.fontFamilies.ea}中` +
      ` · 有彩色 ${stats.chromaticTokens} 种`,
  )
  return lines.join('\n')
}
