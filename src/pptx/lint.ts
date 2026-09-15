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
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { DeckSpec } from './deck.js'
import type { SlideSpec } from './layouts.js'

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
  }
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

  slides.forEach((slide, i) => {
    const page = i + 1
    layoutCounts[slide.layout] = (layoutCounts[slide.layout] ?? 0) + 1
    const words = countSlideWords(slide)
    wordCounts.push(words)

    // ① 密度下限
    const floor = WORD_FLOOR[slide.layout] ?? 60
    if (words < floor) {
      warnings.push({
        page,
        layout: slide.layout,
        message: `内容偏薄：约 ${words} 字，${slide.layout} 建议 ≥ ${floor} 字。宁可一页讲透，也不要半页空转。`,
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

  return {
    errors,
    warnings,
    stats: {
      pages: slides.length,
      asymmetric,
      asymmetricRatio,
      layoutCounts,
      wordCounts,
      withNotes,
      withAnimation,
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
  )
  return lines.join('\n')
}
