import { BODY, CANVAS_H, CANVAS_W, CONTENT_W, GUTTER, MARGIN, col, estimateLines, tint, typeScale, xOf } from './grid.js'
import type { Theme } from './theme.js'
import { hairlineOf, heroBackground, onPrimary, onPrimaryMuted, surfaceOf } from './theme.js'
import type { ContentDecor, DeckTemplate } from './templates.js'
import { contentDecorShapes, formatPageNumber } from './templates.js'
import type { ShapeOp } from './shape.js'
import { TEXT_MARGIN, bgShape, fitSize, pageFooter, pageTitle, roundRectAdj, textHeight } from './shape.js'
import type { ChartData, DeckElement } from './elements.js'

/**
 * 版式模板层。
 *
 * officecli 官方明确「Positioning is explicit — no layout engine, you own the
 * grid math」，所以这一层就是把排版数学写死。每个版式函数接收模型填写的内容 +
 * 主题，吐出一串 ShapeOp（坐标已算好），交给 deck 层编译成 officecli 命令。
 *
 * 三条落地铁律（都是实测踩出来的）：
 *  1. **不要用 zorder** —— officecli 的 zorder 语义是反的（值越大越靠后），
 *     给背景设 0 会把它排到最前面盖住所有文字。改为依赖插入顺序：先加的在下。
 *  2. **每个长度必须带单位** —— 裸数字会被当成 EMU（x=32 落出来是 0.0025pt）。
 *  3. **文本高度用 textHeight() 算** —— 拍脑袋给高度必然触发文字溢出告警。
 *
 * 母版三区（沿用 WorkBuddy 设计门禁，按 0.75 系数从 1280×720px 换算到本画布）：
 *   A 标题区   y   0 –  90
 *   B 内容区   y  90 – 495   （实际可用 110 – 478，上下各留 20 呼吸位）
 *   C 页脚区   y 495 – 540
 */

/** 单个版式产出的形状集合。 */
export interface LayoutResult {
  shapes: ShapeOp[]
  /**
   * 页面背景（officecli `set /slide[N] background=` 的语法：色值或渐变）。
   * 存在时 deck 层不再添加铺底矩形（用原生背景 + 装饰形状更干净）。
   */
  background?: string
  /**
   * 非 shape 元素（图表 / 图片 / 原生表格 / mermaid 图示 / 连接线）。
   *
   * 与 {@link shapes} 是两个独立的层：shapes 走 `add --type shape`，这些走各自
   * 的 `--type`。**插入顺序决定 z-order**，所以 deck 层会先铺 shapes 再放元素，
   * 保证「底图/卡片在下、图表配图在上」。
   */
  elements?: DeckElement[]
  /**
   * elements 的层序。默认 `'front'`（形状在下、元素在上，适合图表/配图/表格）；
   * `'behind'` 时元素先落盘，供全幅底图这类「图在最底层」的版式使用。
   */
  elementsBehind?: boolean
}

// ---------------------------------------------------------------------------
// 内容契约
// ---------------------------------------------------------------------------

export interface BulletItem {
  title: string
  desc?: string
}
export interface CardItem {
  title: string
  desc?: string
  tag?: string
}
export interface MetricItem {
  value: string
  label: string
  note?: string
}
export interface CompareSide {
  title: string
  points: string[]
}
export interface TimelineEvent {
  date: string
  title: string
  desc?: string
}
export interface AgendaItem {
  title: string
  desc?: string
}
export interface PlanItem {
  name: string
  price: string
  tag?: string
  features: string[]
  highlight?: boolean
}
export interface RoadmapPhase {
  phase: string
  title: string
  desc?: string
}
/** 配图引用。src 必须是本地文件路径（officecli 不支持 http URL）。 */
export interface ImageRef {
  /** 图片路径：绝对路径，或相对当前工作目录。 */
  src: string
  /** 图注（图下方一行小字）。 */
  caption?: string
}

/** 所有版式共有的页级字段。 */
export interface PageBase {
  transition?: string
  background?: string
  hidden?: boolean
  /**
   * 演讲者备注（PPT 的「备注」栏）。放映时只有演讲者看得到，
   * 是「这页我该说什么」的落点——生成汇报稿时强烈建议每页都写。
   */
  notes?: string
  /**
   * 本页入场动画。`true` 用默认 fade，也可给效果名（fade/fly/zoom/wipe/...）。
   *
   * 只对**本页的主视觉元素**（标题 / 巨型数字 / 主图）挂动画，不逐条挂列表，
   * 否则放映节奏拖沓。建议只给封面、章节页、关键数据页使用。
   */
  animate?: boolean | string
}

/** 版式专属字段；与 {@link PageBase} 取交集才是完整的 SlideSpec。 */
type SlideVariant =
  | { layout: 'cover'; eyebrow?: string; title: string; subtitle?: string; meta?: string }
  | { layout: 'section'; number?: string; title: string; subtitle?: string }
  | { layout: 'bullets'; title: string; items: BulletItem[]; columns?: 2 }
  | { layout: 'cards'; title: string; cards: CardItem[]; columns?: number }
  | { layout: 'kpi'; title: string; metrics: MetricItem[] }
  | { layout: 'steps'; title: string; steps: BulletItem[] }
  | { layout: 'compare'; title: string; left: CompareSide; right: CompareSide }
  | { layout: 'timeline'; title: string; events: TimelineEvent[] }
  | { layout: 'quote'; quote: string; author?: string; role?: string }
  | { layout: 'table'; title: string; headers: string[]; rows: string[][] }
  | { layout: 'ending'; title?: string; subtitle?: string }
  | { layout: 'agenda'; title: string; items: AgendaItem[]; number?: string }
  | { layout: 'swot'; title: string; s: string[]; w: string[]; o: string[]; t: string[] }
  | { layout: 'pricing'; title: string; plans: PlanItem[] }
  | { layout: 'roadmap'; title: string; phases: RoadmapPhase[] }
  // ---- 元素型版式（走 officecli 原生 chart / picture / diagram）----
  | {
      layout: 'chart'
      title: string
      /** 二维数组（首行表头、首列分类）或 officecli 的 `系列:值;系列:值` 串。 */
      data: ChartData
      /** 图表类型：column/bar/line/pie/doughnut/area/... 支持 stacked 等修饰。 */
      chartType?: string
      /** 右侧洞察结论（图表必须配判断，不能只摆数字）。 */
      insight?: string
      /** 洞察下方的补充要点。 */
      bullets?: BulletItem[]
      /** 图例位置，缺省 bottom；'none' 隐藏。 */
      legend?: 'bottom' | 'top' | 'left' | 'right' | 'none'
      /** 是否显示数据标签。 */
      dataLabels?: boolean
      /** 系列配色（hex 数组）。 */
      colors?: string[]
      /** 数值轴单位：thousands/millions/... */
      displayUnits?: string
      /** 数据来源（页脚上方一行小字）。 */
      source?: string
    }
  | {
      layout: 'image-split'
      title: string
      /** 主视觉图。 */
      image: ImageRef
      /** 图片在哪一侧，缺省 left。 */
      side?: 'left' | 'right'
      /** 图侧说明段。 */
      desc?: string
      /** 文字侧的要点。 */
      points?: BulletItem[]
    }
  | {
      layout: 'image-full'
      /** 全幅底图上的骑线大标题。 */
      title?: string
      subtitle?: string
      image: ImageRef
      /** 文字块靠哪边，缺省 left。 */
      align?: 'left' | 'right'
      /** 压暗蒙版强度 0–0.7，缺省 0.35（浅色图上白字必需）。 */
      overlay?: number
    }
  | {
      layout: 'diagram'
      title: string
      /** 内联 mermaid 源码（flowchart/graph/sequenceDiagram 等）。 */
      mermaid: string
      /** 图下方说明。 */
      caption?: string
    }

export type SlideSpec = PageBase & SlideVariant

export const LAYOUT_IDS = [
  'cover',
  'section',
  'bullets',
  'cards',
  'kpi',
  'steps',
  'compare',
  'timeline',
  'quote',
  'table',
  'ending',
  'agenda',
  'swot',
  'pricing',
  'roadmap',
  'chart',
  'image-split',
  'image-full',
  'diagram',
] as const

export type LayoutId = (typeof LAYOUT_IDS)[number]

// ---------------------------------------------------------------------------
// 内部小工具
// ---------------------------------------------------------------------------

/** 把 n 个等宽槽位铺满内容区。 */
function slots(n: number, gap: number, total = CONTENT_W, start = MARGIN): { x: number; w: number }[] {
  const w = (total - (n - 1) * gap) / n
  return Array.from({ length: n }, (_, i) => ({ x: start + i * (w + gap), w }))
}

const fg = (t: Theme) => onPrimary(t)
const fgMuted = (t: Theme) => onPrimaryMuted(t)

/** 主色底上的装饰圆：浅色主题提亮、深色主题压暗，有色差但不抢戏。 */
const decorTint = (t: Theme, amount: number) =>
  t.dark ? tint(t.primary, -amount) : tint(t.primary, amount)

/**
 * hero 页（cover/section/ending）装饰形状，按主题 coverDecor 生成。
 * 背景本身由 slide background 渐变承担，这些装饰只做「点缀」。
 */
function heroDecor(p: string, t: Theme): ShapeOp[] {
  switch (t.coverDecor) {
    case 'circles':
      return [
        {
          name: `${p}-decor1`,
          x: 700,
          y: 268,
          w: 460,
          h: 460,
          geometry: 'ellipse',
          fill: decorTint(t, 0.16),
          line: 'none',
        },
        {
          name: `${p}-decor2`,
          x: 852,
          y: -56,
          w: 220,
          h: 220,
          geometry: 'ellipse',
          fill: decorTint(t, 0.24),
          line: 'none',
        },
      ]
    case 'grid': {
      // 右下角 4×3 点阵，形成「科技感」的弱纹理
      const out: ShapeOp[] = []
      const size = 10
      const gapX = 34
      const gapY = 30
      const baseX = 760
      const baseY = 386
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 4; c++) {
          const k = r * 4 + c
          out.push({
            name: `${p}-decor-g${k}`,
            x: baseX + c * gapX,
            y: baseY + r * gapY,
            w: size,
            h: size,
            geometry: 'ellipse',
            fill: decorTint(t, r === 1 && c === 2 ? 0.5 : 0.22),
            line: 'none',
          })
        }
      }
      return out
    }
    case 'band': {
      // 底部斜切色带，增强「活动感」
      return [
        {
          name: `${p}-decor-band`,
          x: -40,
          y: 428,
          w: 1040,
          h: 120,
          geometry: 'roundRect',
          adj: roundRectAdj(0),
          fill: decorTint(t, 0.2),
          line: 'none',
        },
        {
          name: `${p}-decor-band2`,
          x: -40,
          y: 468,
          w: 1040,
          h: 84,
          geometry: 'roundRect',
          adj: roundRectAdj(0),
          fill: decorTint(t, 0.3),
          line: 'none',
        },
      ]
    }
    case 'none':
      return []
  }
}

/** 按内容块实际高度做垂直居中。 */
const centerBlock = (blockH: number) => Math.max(24, Math.round((0 + CANVAS_H) / 2 - blockH / 2))

/** 圆形徽标里的文字可用区是外接矩形的 71%×71%，需要额外放大直径。 */
const BADGE = 34

// ---------------------------------------------------------------------------
// 版式实现
// ---------------------------------------------------------------------------

function cover(s: Extract<SlideSpec, { layout: 'cover' }>, t: Theme, p: string): LayoutResult {
  const titleW = 720
  const size = typeScale().coverTitle
  const titleH = textHeight(s.title, size, titleW, TEXT_MARGIN, 1.12)
  const eyebrowH = s.eyebrow ? textHeight(s.eyebrow, 16, titleW) : 0
  const subH = s.subtitle ? textHeight(s.subtitle, 20, 700, TEXT_MARGIN, 1.35) : 0
  const metaH = s.meta ? textHeight(s.meta, 13, 700) : 0
  const blockH = eyebrowH + titleH + 30 + subH + metaH
  let y = centerBlock(blockH)

  // hero 页用原生渐变背景，铺底矩形交给 slide background；装饰按主题风格生成
  const shapes: ShapeOp[] = [...heroDecor(p, t)]

  if (s.eyebrow) {
    shapes.push({
      name: `${p}-eyebrow`,
      text: s.eyebrow,
      x: 64,
      y,
      w: titleW,
      h: eyebrowH,
      size: 16,
      bold: true,
      color: fgMuted(t),
      fontLatin: t.fontBody.latin,
      fontEa: t.fontBody.ea,
      align: 'left',
      valign: 'middle',
      margin: TEXT_MARGIN,
    })
    y += eyebrowH
  }
  shapes.push({
    name: `${p}-title`,
    text: s.title,
    x: 64,
    y,
    w: titleW,
    h: titleH,
    size,
    bold: true,
    color: fg(t),
    fontLatin: t.fontTitle.latin,
    fontEa: t.fontTitle.ea,
    align: 'left',
    valign: 'top',
    lineSpacing: 1.12,
    margin: TEXT_MARGIN,
  })
  y += titleH + 14
  shapes.push({ name: `${p}-rule`, x: 64, y, w: 72, h: 5, fill: t.accent, line: 'none' })
  y += 16
  if (s.subtitle) {
    shapes.push({
      name: `${p}-sub`,
      text: s.subtitle,
      x: 64,
      y,
      w: 700,
      h: subH,
      size: 20,
      color: fgMuted(t),
      fontLatin: t.fontBody.latin,
      fontEa: t.fontBody.ea,
      align: 'left',
      valign: 'top',
      lineSpacing: 1.35,
      margin: TEXT_MARGIN,
    })
    y += subH
  }
  if (s.meta) {
    shapes.push({
      name: `${p}-meta`,
      text: s.meta,
      x: 64,
      y,
      w: 700,
      h: metaH,
      size: 13,
      color: fgMuted(t),
      fontLatin: t.fontBody.latin,
      fontEa: t.fontBody.ea,
      align: 'left',
      valign: 'middle',
      margin: TEXT_MARGIN,
    })
  }
  return { shapes, background: heroBackground(t) }
}

function section(s: Extract<SlideSpec, { layout: 'section' }>, t: Theme, p: string): LayoutResult {
  const size = typeScale().sectionTitle
  const titleH = textHeight(s.title, size, 740, TEXT_MARGIN, 1.18)
  const numH = s.number ? textHeight(s.number, 84, 300) : 0
  const subH = s.subtitle ? textHeight(s.subtitle, 20, 700, TEXT_MARGIN, 1.35) : 0
  const blockH = numH + titleH + 30 + subH
  let y = centerBlock(blockH)

  const shapes: ShapeOp[] = [...heroDecor(p, t)]
  if (s.number) {    shapes.push({
      name: `${p}-num`,
      text: s.number,
      x: 64,
      y,
      w: 300,
      h: numH,
      size: 84,
      bold: true,
      color: fgMuted(t),
      fontLatin: t.fontTitle.latin,
      fontEa: t.fontTitle.ea,
      align: 'left',
      valign: 'middle',
      margin: TEXT_MARGIN,
    })
    y += numH
  }
  shapes.push({
    name: `${p}-title`,
    text: s.title,
    x: 64,
    y,
    w: 740,
    h: titleH,
    size,
    bold: true,
    color: fg(t),
    fontLatin: t.fontTitle.latin,
    fontEa: t.fontTitle.ea,
    align: 'left',
    valign: 'top',
    lineSpacing: 1.18,
    margin: TEXT_MARGIN,
  })
  y += titleH + 14
  shapes.push({ name: `${p}-rule`, x: 64, y, w: 64, h: 5, fill: t.accent, line: 'none' })
  y += 16
  if (s.subtitle) {
    shapes.push({
      name: `${p}-sub`,
      text: s.subtitle,
      x: 64,
      y,
      w: 700,
      h: subH,
      size: 20,
      color: fgMuted(t),
      fontLatin: t.fontBody.latin,
      fontEa: t.fontBody.ea,
      align: 'left',
      valign: 'top',
      margin: TEXT_MARGIN,
    })
  }
  return { shapes, background: heroBackground(t) }
}

/**
 * 要点列表。单栏：1–6 条、宽松；两栏（columns: 2）：1–8 条、紧凑，
 * 适合书稿/长文等「信息密度要求高」的页面 —— 每栏 4 行，标题 15pt + 说明 12pt。
 */
function bullets(s: Extract<SlideSpec, { layout: 'bullets' }>, t: Theme, p: string): LayoutResult {
  const twoCol = s.columns === 2
  const items = s.items.slice(0, twoCol ? 8 : 6)
  const n = Math.max(items.length, 1)
  const availH = BODY.bottom - BODY.top
  const gap = 20
  const colCount = twoCol ? 2 : 1
  const colW = (CONTENT_W - (colCount - 1) * gap) / colCount
  const badge = twoCol ? 26 : BADGE
  const titleSize = twoCol ? 15 : typeScale().cardTitle
  const descSize = twoCol ? typeScale().body - 4 : typeScale().body - 2
  const shapes: ShapeOp[] = [bgShape(`${p}-bg`, t.bg), ...pageTitle(p, s.title, t)]

  for (let c = 0; c < colCount; c++) {
    const colItems = items.slice(c * Math.ceil(n / colCount), (c + 1) * Math.ceil(n / colCount))
    const m = Math.max(colItems.length, 1)
    const rowH = availH / m
    const colX = MARGIN + c * (colW + gap)
    const textX = colX + badge + (twoCol ? 10 : 14)
    const textW = colW - badge - (twoCol ? 10 : 14)
    colItems.forEach((it, j) => {
      const i = c * Math.ceil(n / colCount) + j
      const rowY = BODY.top + j * rowH
      const hasDesc = Boolean(it.desc)
      const titleH = textHeight(it.title, titleSize, textW)
      const descH = hasDesc ? Math.max(rowH - titleH - (twoCol ? 6 : 8), twoCol ? 20 : 24) : 0
      const titleY = hasDesc ? rowY : rowY + (rowH - titleH) / 2
      shapes.push(
        {
          name: `${p}-b${i}-num`,
          text: String(i + 1),
          x: colX,
          y: rowY + (rowH - badge) / 2,
          w: badge,
          h: badge,
          geometry: 'ellipse',
          fill: t.primary,
          line: 'none',
          size: twoCol ? 10.5 : 12,
          bold: true,
          color: fg(t),
          align: 'center',
          valign: 'middle',
          margin: 0,
        },
        {
          name: `${p}-b${i}-t`,
          text: it.title,
          x: textX,
          y: titleY,
          w: textW,
          h: titleH,
          size: titleSize,
          bold: true,
          color: t.text,
          fontLatin: t.fontTitle.latin,
          fontEa: t.fontTitle.ea,
          align: 'left',
          valign: 'middle',
          margin: TEXT_MARGIN,
        },
      )
      if (hasDesc) {
        const size = fitSize(it.desc!, descSize, textW, descH, TEXT_MARGIN, 9, 1.35)
        shapes.push({
          name: `${p}-b${i}-d`,
          text: it.desc,
          x: textX,
          y: rowY + titleH + (twoCol ? 5 : 8),
          w: textW,
          h: descH,
          size,
          color: t.muted,
          fontLatin: t.fontBody.latin,
          fontEa: t.fontBody.ea,
          align: 'left',
          valign: 'top',
          lineSpacing: 1.35,
          margin: TEXT_MARGIN,
        })
      }
    })
  }
  return { shapes }
}

function cards(s: Extract<SlideSpec, { layout: 'cards' }>, t: Theme, p: string): LayoutResult {
  const items = s.cards.slice(0, 6)
  const n = Math.max(items.length, 1)
  const cols = s.columns ?? (n <= 3 ? n : n === 4 ? 2 : 3)
  const rows = Math.ceil(n / cols)
  const gap = 16
  const availH = BODY.bottom - BODY.top
  const cardW = (CONTENT_W - (cols - 1) * gap) / cols
  const cardH = (availH - (rows - 1) * gap) / rows
  const shapes: ShapeOp[] = [bgShape(`${p}-bg`, t.bg), ...pageTitle(p, s.title, t)]

  items.forEach((c, i) => {
    const r = Math.floor(i / cols)
    const col = i % cols
    const x = MARGIN + col * (cardW + gap)
    const y = BODY.top + r * (cardH + gap)
    const pad = 20
    const innerW = cardW - pad * 2
    shapes.push({
      name: `${p}-c${i}-bg`,
      x,
      y,
      w: cardW,
      h: cardH,
      geometry: 'roundRect',
      adj: roundRectAdj(4000),
      fill: surfaceOf(t),
      line: `${hairlineOf(t)}:1:solid`,
    })
    let cy = y + 18
    if (c.tag) {
      const tagH = textHeight(c.tag, 12, innerW)
      shapes.push({
        name: `${p}-c${i}-tag`,
        text: c.tag,
        x: x + pad,
        y: cy,
        w: innerW,
        h: tagH,
        size: 12,
        bold: true,
        color: t.accent,
        fontLatin: t.fontBody.latin,
        fontEa: t.fontBody.ea,
        align: 'left',
        valign: 'middle',
        margin: TEXT_MARGIN,
      })
      cy += tagH + 6
    }
    const titleH = textHeight(c.title, typeScale().cardTitle, innerW)
    shapes.push({
      name: `${p}-c${i}-t`,
      text: c.title,
      x: x + pad,
      y: cy,
      w: innerW,
      h: titleH,
      size: typeScale().cardTitle,
      bold: true,
      color: t.text,
      fontLatin: t.fontTitle.latin,
      fontEa: t.fontTitle.ea,
      align: 'left',
      valign: 'middle',
      margin: TEXT_MARGIN,
    })
    if (c.desc) {
      cy += titleH + 8
      const descH = Math.max(cardH - (cy - y) - 20, 24)
      const size = fitSize(c.desc, typeScale().body - 3, innerW, descH, TEXT_MARGIN, 9, 1.4)
      shapes.push({
        name: `${p}-c${i}-d`,
        text: c.desc,
        x: x + pad,
        y: cy,
        w: innerW,
        h: descH,
        size,
        color: t.muted,
        fontLatin: t.fontBody.latin,
        fontEa: t.fontBody.ea,
        align: 'left',
        valign: 'top',
        lineSpacing: 1.4,
        margin: TEXT_MARGIN,
      })
    }
  })
  return { shapes }
}

function kpi(s: Extract<SlideSpec, { layout: 'kpi' }>, t: Theme, p: string): LayoutResult {
  const items = s.metrics.slice(0, 4)
  const n = Math.max(items.length, 1)
  const cols = slots(n, 16)
  const midY = Math.round((BODY.top + BODY.bottom) / 2)
  const shapes: ShapeOp[] = [bgShape(`${p}-bg`, t.bg), ...pageTitle(p, s.title, t)]

  // 分隔线先加，避免压在数字上（形状按插入顺序叠放，先加的在下）
  items.forEach((_m, i) => {
    if (i === 0) return
    const { x } = cols[i]!
    shapes.push({ name: `${p}-k${i}-sep`, x: x - 8, y: midY - 84, w: 1, h: 132, fill: hairlineOf(t), line: 'none' })
  })

  items.forEach((m, i) => {
    const { x, w } = cols[i]!
    const valueSize = fitSize(m.value, typeScale().anchor, w, 92, 0, 24)
    const valueH = textHeight(m.value, valueSize, w, 0)
    shapes.push({
      name: `${p}-k${i}-v`,
      text: m.value,
      x,
      y: midY - 100,
      w,
      h: valueH,
      size: valueSize,
      bold: true,
      color: i % 2 === 0 ? t.primary : t.accent,
      fontLatin: t.fontTitle.latin,
      fontEa: t.fontTitle.ea,
      align: 'center',
      valign: 'bottom',
      margin: 0,
    })
    const labelH = textHeight(m.label, 16, w)
    shapes.push({
      name: `${p}-k${i}-l`,
      text: m.label,
      x,
      y: midY,
      w,
      h: labelH,
      size: 16,
      bold: true,
      color: t.text,
      fontLatin: t.fontBody.latin,
      fontEa: t.fontBody.ea,
      align: 'center',
      valign: 'middle',
      margin: TEXT_MARGIN,
    })
    if (m.note) {
      const noteH = textHeight(m.note, 12.5, w)
      shapes.push({
        name: `${p}-k${i}-n`,
        text: m.note,
        x,
        y: midY + labelH + 8,
        w,
        h: noteH,
        size: 12.5,
        color: t.muted,
        fontLatin: t.fontBody.latin,
        fontEa: t.fontBody.ea,
        align: 'center',
        valign: 'top',
        lineSpacing: 1.35,
        margin: TEXT_MARGIN,
      })
    }
  })
  return { shapes }
}

function steps(s: Extract<SlideSpec, { layout: 'steps' }>, t: Theme, p: string): LayoutResult {
  const items = s.steps.slice(0, 5)
  const n = Math.max(items.length, 1)
  const gap = 28
  const cols = slots(n, gap)
  const numY = 200
  const boxY = 244
  const boxH = 100
  const shapes: ShapeOp[] = [bgShape(`${p}-bg`, t.bg), ...pageTitle(p, s.title, t)]

  items.forEach((st, i) => {
    const { x, w } = cols[i]!
    shapes.push(
      {
        name: `${p}-s${i}-num`,
        text: String(i + 1),
        x: x + w / 2 - BADGE / 2,
        y: numY,
        w: BADGE,
        h: BADGE,
        geometry: 'ellipse',
        fill: t.accent,
        line: 'none',
        size: 13,
        bold: true,
        color: fg(t),
        align: 'center',
        valign: 'middle',
        margin: 0,
      },
      {
        name: `${p}-s${i}-box`,
        text: st.title,
        x,
        y: boxY,
        w,
        h: boxH,
        geometry: 'roundRect',
        adj: roundRectAdj(6000),
        fill: t.primary,
        line: 'none',
        size: fitSize(st.title, 16, w - 24, boxH - 16, 8, 11, 1.2),
        bold: true,
        color: fg(t),
        fontLatin: t.fontTitle.latin,
        fontEa: t.fontTitle.ea,
        align: 'center',
        valign: 'middle',
        margin: 8,
        lineSpacing: 1.2,
      },
    )
    if (st.desc) {
      const descH = Math.min(BODY.bottom - (boxY + boxH + 14), 110)
      const size = fitSize(st.desc, 12.5, w + 8, descH, TEXT_MARGIN, 9, 1.4)
      shapes.push({
        name: `${p}-s${i}-d`,
        text: st.desc,
        x: x - 4,
        y: boxY + boxH + 14,
        w: w + 8,
        h: descH,
        size,
        color: t.muted,
        fontLatin: t.fontBody.latin,
        fontEa: t.fontBody.ea,
        align: 'center',
        valign: 'top',
        lineSpacing: 1.4,
        margin: TEXT_MARGIN,
      })
    }
    if (i < n - 1) {
      shapes.push({
        name: `${p}-s${i}-arrow`,
        x: x + w + 4,
        y: boxY + boxH / 2 - 6,
        w: gap - 8,
        h: 12,
        geometry: 'rightArrow',
        fill: hairlineOf(t),
        line: 'none',
      })
    }
  })
  return { shapes }
}

function compare(s: Extract<SlideSpec, { layout: 'compare' }>, t: Theme, p: string): LayoutResult {
  const gap = 24
  const colW = (CONTENT_W - gap) / 2
  const headH = 48
  const bodyY = BODY.top + headH + 8
  const bodyH = BODY.bottom - bodyY
  const shapes: ShapeOp[] = [bgShape(`${p}-bg`, t.bg), ...pageTitle(p, s.title, t)]

  const sides: { side: typeof s.left; idx: number; color: string }[] = [
    { side: s.left, idx: 0, color: t.dark ? t.text : t.primary },
    { side: s.right, idx: 1, color: t.secondary },
  ]

  for (const { side, idx, color } of sides) {
    const x = MARGIN + idx * (colW + gap)
    shapes.push(
      {
        name: `${p}-col${idx}-bg`,
        x,
        y: bodyY,
        w: colW,
        h: bodyH,
        geometry: 'roundRect',
        adj: roundRectAdj(2500),
        fill: surfaceOf(t),
        line: `${hairlineOf(t)}:1:solid`,
      },
      {
        name: `${p}-col${idx}-head`,
        text: side.title,
        x,
        y: BODY.top,
        w: colW,
        h: headH,
        geometry: 'roundRect',
        adj: roundRectAdj(8000),
        fill: color,
        line: 'none',
        size: fitSize(side.title, 19, colW - 24, headH - 12, 4, 12),
        bold: true,
        color: fg(t),
        fontLatin: t.fontTitle.latin,
        fontEa: t.fontTitle.ea,
        align: 'center',
        valign: 'middle',
        margin: 6,
      },
    )
    const pts = side.points.slice(0, 6)
    const rowH = (bodyH - 32) / Math.max(pts.length, 1)
    pts.forEach((text, j) => {
      const ry = bodyY + 16 + j * rowH
      const size = fitSize(text, 14, colW - 62, rowH, TEXT_MARGIN, 9, 1.35)
      shapes.push(
        {
          name: `${p}-col${idx}-p${j}-dot`,
          x: x + 20,
          y: ry + 6,
          w: 8,
          h: 8,
          geometry: 'ellipse',
          fill: color,
          line: 'none',
        },
        {
          name: `${p}-col${idx}-p${j}-t`,
          text,
          x: x + 38,
          y: ry,
          w: colW - 62,
          h: rowH,
          size,
          color: t.text,
          fontLatin: t.fontBody.latin,
          fontEa: t.fontBody.ea,
          align: 'left',
          valign: 'top',
          lineSpacing: 1.35,
          margin: TEXT_MARGIN,
        },
      )
    })
  }
  return { shapes }
}

function timeline(s: Extract<SlideSpec, { layout: 'timeline' }>, t: Theme, p: string): LayoutResult {
  const events = s.events.slice(0, 5)
  const n = Math.max(events.length, 1)
  const slotW = CONTENT_W / n
  const axisY = 306
  const shapes: ShapeOp[] = [
    bgShape(`${p}-bg`, t.bg),
    ...pageTitle(p, s.title, t),
    { name: `${p}-axis`, x: MARGIN, y: axisY, w: CONTENT_W, h: 3, fill: hairlineOf(t), line: 'none' },
  ]

  events.forEach((e, i) => {
    const cx = MARGIN + slotW * i
    const dotColor = i === events.length - 1 ? t.accent : t.primary
    const innerW = slotW - 20
    const dateH = textHeight(e.date, 15, innerW)
    const titleH = textHeight(e.title, 16, innerW, TEXT_MARGIN, 1.2)
    shapes.push(
      {
        name: `${p}-t${i}-date`,
        text: e.date,
        x: cx + 10,
        y: 196,
        w: innerW,
        h: dateH,
        size: 15,
        bold: true,
        color: dotColor,
        fontLatin: t.fontTitle.latin,
        fontEa: t.fontTitle.ea,
        align: 'center',
        valign: 'middle',
        margin: TEXT_MARGIN,
      },
      {
        name: `${p}-t${i}-t`,
        text: e.title,
        x: cx + 10,
        y: 196 + dateH + 6,
        w: innerW,
        h: titleH,
        size: 16,
        bold: true,
        color: t.text,
        fontLatin: t.fontTitle.latin,
        fontEa: t.fontTitle.ea,
        align: 'center',
        valign: 'top',
        lineSpacing: 1.2,
        margin: TEXT_MARGIN,
      },
      {
        name: `${p}-t${i}-dot`,
        x: cx + slotW / 2 - 10,
        y: axisY - 8,
        w: 20,
        h: 20,
        geometry: 'ellipse',
        fill: dotColor,
        line: 'none',
      },
    )
    if (e.desc) {
      const descH = Math.min(BODY.bottom - (axisY + 24), 96)
      const size = fitSize(e.desc, 12.5, innerW, descH, TEXT_MARGIN, 9, 1.4)
      shapes.push({
        name: `${p}-t${i}-d`,
        text: e.desc,
        x: cx + 10,
        y: axisY + 24,
        w: innerW,
        h: descH,
        size,
        color: t.muted,
        fontLatin: t.fontBody.latin,
        fontEa: t.fontBody.ea,
        align: 'center',
        valign: 'top',
        lineSpacing: 1.4,
        margin: TEXT_MARGIN,
      })
    }
  })
  return { shapes }
}

function quote(s: Extract<SlideSpec, { layout: 'quote' }>, t: Theme, p: string): LayoutResult {
  const qw = 720
  const qSize = typeScale().quote
  const quoteH = textHeight(s.quote, qSize, qw, TEXT_MARGIN, 1.45)
  const authorH = s.author ? textHeight(s.author, 16, qw) : 0
  const roleH = s.role ? textHeight(s.role, 13, qw) : 0
  const blockH = quoteH + 30 + authorH + roleH
  let y = centerBlock(blockH)

  const shapes: ShapeOp[] = [
    bgShape(`${p}-bg`, t.bg),
    {
      name: `${p}-mark`,
      text: '\u201C',
      x: 96,
      y: y - 52,
      w: 130,
      h: 104,
      size: 104,
      bold: true,
      color: tint(t.primary, t.dark ? -0.5 : 0.62),
      fontLatin: 'Georgia',
      fontEa: 'Georgia',
      align: 'left',
      valign: 'middle',
      margin: 0,
    },
    {
      name: `${p}-text`,
      text: s.quote,
      x: 120,
      y,
      w: qw,
      h: quoteH,
      size: qSize,
      color: t.text,
      fontLatin: t.fontTitle.latin,
      fontEa: t.fontTitle.ea,
      align: 'center',
      valign: 'top',
      lineSpacing: 1.45,
      margin: TEXT_MARGIN,
    },
  ]
  y += quoteH + 14
  shapes.push({ name: `${p}-rule`, x: 444, y, w: 72, h: 5, fill: t.accent, line: 'none' })
  y += 16
  if (s.author) {
    shapes.push({
      name: `${p}-author`,
      text: s.author,
      x: 120,
      y,
      w: qw,
      h: authorH,
      size: 16,
      bold: true,
      color: t.text,
      fontLatin: t.fontBody.latin,
      fontEa: t.fontBody.ea,
      align: 'center',
      valign: 'middle',
      margin: TEXT_MARGIN,
    })
    y += authorH
  }
  if (s.role) {
    shapes.push({
      name: `${p}-role`,
      text: s.role,
      x: 120,
      y,
      w: qw,
      h: roleH,
      size: 13,
      color: t.muted,
      fontLatin: t.fontBody.latin,
      fontEa: t.fontBody.ea,
      align: 'center',
      valign: 'middle',
      margin: TEXT_MARGIN,
    })
  }
  return { shapes }
}

function table(s: Extract<SlideSpec, { layout: 'table' }>, t: Theme, p: string): LayoutResult {
  const rowH = 34
  const headH = 40
  return {
    shapes: [bgShape(`${p}-bg`, t.bg), ...pageTitle(p, s.title, t)],
    elements: [
      {
        kind: 'table',
        name: `${p}-table`,
        x: MARGIN,
        y: BODY.top,
        w: CONTENT_W,
        h: Math.min(BODY.bottom - BODY.top, headH + s.rows.length * rowH),
        headers: s.headers,
        rows: s.rows,
        headerFill: t.primary,
      },
    ],
  }
}

function ending(s: Extract<SlideSpec, { layout: 'ending' }>, t: Theme, p: string): LayoutResult {
  const title = s.title ?? '谢谢'
  const titleH = textHeight(title, typeScale().sectionTitle, 720, TEXT_MARGIN, 1.18)
  const subH = s.subtitle ? textHeight(s.subtitle, 16, 720) : 0
  const blockH = titleH + 30 + subH
  let y = centerBlock(blockH)

  const shapes: ShapeOp[] = [
    ...heroDecor(p, t),
    {
      name: `${p}-decor`,
      x: -110,
      y: 330,
      w: 380,
      h: 380,
      geometry: 'ellipse',
      fill: decorTint(t, 0.18),
      line: 'none',
    },
    {
      name: `${p}-title`,
      text: title,
      x: 120,
      y,
      w: 720,
      h: titleH,
      size: typeScale().sectionTitle,
      bold: true,
      color: fg(t),
      fontLatin: t.fontTitle.latin,
      fontEa: t.fontTitle.ea,
      align: 'center',
      valign: 'top',
      lineSpacing: 1.18,
      margin: TEXT_MARGIN,
    },
  ]
  y += titleH + 14
  shapes.push({ name: `${p}-rule`, x: 444, y, w: 72, h: 5, fill: t.accent, line: 'none' })
  if (s.subtitle) {
    shapes.push({
      name: `${p}-sub`,
      text: s.subtitle,
      x: 120,
      y: y + 16,
      w: 720,
      h: subH,
      size: 16,
      color: fgMuted(t),
      fontLatin: t.fontBody.latin,
      fontEa: t.fontBody.ea,
      align: 'center',
      valign: 'top',
      margin: TEXT_MARGIN,
    })
  }
  return { shapes }
}

// ---------------------------------------------------------------------------
// 分派
// ---------------------------------------------------------------------------

/** 目录页：编号芯片 + 标题 + 说明，适合汇报开篇交代结构。 */
function agenda(s: Extract<SlideSpec, { layout: 'agenda' }>, t: Theme, p: string): LayoutResult {
  const items = s.items.slice(0, 6)
  const n = Math.max(items.length, 1)
  const availH = BODY.bottom - BODY.top
  const rowH = availH / n
  const shapes: ShapeOp[] = [bgShape(`${p}-bg`, t.bg), ...pageTitle(p, s.title, t)]

  items.forEach((it, i) => {
    const rowY = BODY.top + i * rowH
    const hasDesc = Boolean(it.desc)
    const titleH = textHeight(it.title, typeScale().cardTitle, 640)
    const descH = hasDesc ? Math.max(rowH - titleH - 8, 20) : 0
    const titleY = hasDesc ? rowY : rowY + (rowH - titleH) / 2
    shapes.push(
      {
        name: `${p}-a${i}-num`,
        text: String(i + 1).padStart(2, '0'),
        x: MARGIN,
        y: rowY + (rowH - 40) / 2,
        w: 40,
        h: 40,
        geometry: 'roundRect',
        adj: roundRectAdj(4000),
        fill: i === 0 ? t.primary : surfaceOf(t),
        line: 'none',
        size: 16,
        bold: true,
        color: i === 0 ? fg(t) : t.dark ? t.text : t.primary,
        align: 'center',
        valign: 'middle',
        margin: 0,
      },
      {
        name: `${p}-a${i}-t`,
        text: it.title,
        x: MARGIN + 56,
        y: titleY,
        w: 640,
        h: titleH,
        size: typeScale().cardTitle,
        bold: true,
        color: t.text,
        fontLatin: t.fontTitle.latin,
        fontEa: t.fontTitle.ea,
        align: 'left',
        valign: 'middle',
        margin: TEXT_MARGIN,
      },
    )
    if (hasDesc) {
      shapes.push({
        name: `${p}-a${i}-d`,
        text: it.desc,
        x: MARGIN + 56,
        y: rowY + titleH + 4,
        w: 700,
        h: descH,
        size: 13,
        color: t.muted,
        fontLatin: t.fontBody.latin,
        fontEa: t.fontBody.ea,
        align: 'left',
        valign: 'top',
        margin: TEXT_MARGIN,
      })
    }
    if (i < n - 1) {
      shapes.push({
        name: `${p}-a${i}-line`,
        x: MARGIN + 20,
        y: rowY + rowH - 2,
        w: CONTENT_W - 40,
        h: 1,
        fill: hairlineOf(t),
        line: 'none',
      })
    }
  })
  return { shapes }
}

/** SWOT 2×2 矩阵：优势/劣势/机会/威胁四象限。 */
function swot(s: Extract<SlideSpec, { layout: 'swot' }>, t: Theme, p: string): LayoutResult {
  const quads: { key: 's' | 'w' | 'o' | 't'; label: string; color: string }[] = [
    { key: 's', label: '优势 Strengths', color: t.dark ? t.text : t.primary },
    { key: 'w', label: '劣势 Weaknesses', color: t.accent },
    { key: 'o', label: '机会 Opportunities', color: t.secondary },
    { key: 't', label: '威胁 Threats', color: t.dark ? t.muted : t.accent6 },
  ]
  const gap = 16
  const innerW = (CONTENT_W - gap) / 2
  const innerH = (BODY.bottom - BODY.top - gap) / 2
  const headH = 34
  const shapes: ShapeOp[] = [bgShape(`${p}-bg`, t.bg), ...pageTitle(p, s.title, t)]

  quads.forEach((q, i) => {
    const col = i % 2
    const row = Math.floor(i / 2)
    const x = MARGIN + col * (innerW + gap)
    const y = BODY.top + row * (innerH + gap)
    const items = ((s as unknown as Record<string, string[]>)[q.key] ?? []).slice(0, 4)
    shapes.push(
      {
        name: `${p}-q${i}-bg`,
        x,
        y,
        w: innerW,
        h: innerH,
        geometry: 'roundRect',
        adj: roundRectAdj(2000),
        fill: surfaceOf(t),
        line: `${hairlineOf(t)}:1:solid`,
      },
      {
        name: `${p}-q${i}-head`,
        text: q.label,
        x: x + 14,
        y: y + 12,
        w: innerW - 28,
        h: headH,
        size: 15,
        bold: true,
        color: q.color,
        fontLatin: t.fontTitle.latin,
        fontEa: t.fontTitle.ea,
        align: 'left',
        valign: 'middle',
        margin: TEXT_MARGIN,
      },
    )
    const listY = y + headH + 14
    const rowH = (innerH - headH - 24) / Math.max(items.length, 1)
    items.forEach((text, j) => {
      const size = fitSize(text, 13, innerW - 52, rowH, TEXT_MARGIN, 9, 1.3)
      shapes.push(
        {
          name: `${p}-q${i}-d${j}`,
          x: x + 18,
          y: listY + j * rowH + 4,
          w: 7,
          h: 7,
          geometry: 'ellipse',
          fill: q.color,
          line: 'none',
        },
        {
          name: `${p}-q${i}-t${j}`,
          text,
          x: x + 34,
          y: listY + j * rowH,
          w: innerW - 52,
          h: rowH,
          size,
          color: t.text,
          fontLatin: t.fontBody.latin,
          fontEa: t.fontBody.ea,
          align: 'left',
          valign: 'top',
          lineSpacing: 1.3,
          margin: TEXT_MARGIN,
        },
      )
    })
  })
  return { shapes }
}

/** 方案对比（定价）：2–4 张套餐卡，highlight 款主色描边强调。 */
function pricing(s: Extract<SlideSpec, { layout: 'pricing' }>, t: Theme, p: string): LayoutResult {
  const plans = s.plans.slice(0, 4)
  const n = Math.max(plans.length, 1)
  const gap = 16
  const cardW = (CONTENT_W - (n - 1) * gap) / n
  const top = BODY.top
  const cardH = BODY.bottom - top
  const pad = 18
  const shapes: ShapeOp[] = [bgShape(`${p}-bg`, t.bg), ...pageTitle(p, s.title, t)]

  plans.forEach((pl, i) => {
    const x = MARGIN + i * (cardW + gap)
    const hl = Boolean(pl.highlight)
    shapes.push({
      name: `${p}-pl${i}-bg`,
      x,
      y: top,
      w: cardW,
      h: cardH,
      geometry: 'roundRect',
      adj: roundRectAdj(3000),
      fill: hl ? (t.dark ? tint(t.primary, -0.7) : tint(t.primary, 0.96)) : surfaceOf(t),
      line: hl ? `${t.primary}:2:solid` : `${hairlineOf(t)}:1:solid`,
    })
    // 高亮款顶部渐变条（shape 级 gradient 注入：C1-C2-角度）
    let cy = top + (hl ? 58 : 18)
    if (hl) {
      shapes.push(
        {
          name: `${p}-pl${i}-hlbar`,
          x,
          y: top,
          w: cardW,
          h: 44,
          geometry: 'roundRect',
          adj: roundRectAdj(3000),
          gradient: `${t.primary}-${tint(t.primary, t.dark ? -0.35 : -0.2)}-90`,
          line: 'none',
        },
        {
          name: `${p}-pl${i}-hlbar-mask`,
          x,
          y: top + 32,
          w: cardW,
          h: 14,
          fill: t.dark ? tint(t.primary, -0.7) : tint(t.primary, 0.96),
          line: 'none',
        },
      )
    }
    if (pl.tag) {
      shapes.push({
        name: `${p}-pl${i}-tag`,
        text: pl.tag,
        x,
        y: cy,
        w: cardW,
        h: 20,
        size: 10.5,
        bold: true,
        color: t.accent,
        fontLatin: t.fontBody.latin,
        fontEa: t.fontBody.ea,
        align: 'center',
        valign: 'middle',
        margin: 0,
      })
      cy += 22
    }
    const nameH = textHeight(pl.name, 16, cardW - pad * 2)
    shapes.push({
      name: `${p}-pl${i}-name`,
      text: pl.name,
      x: x + pad,
      y: cy,
      w: cardW - pad * 2,
      h: nameH,
      size: 16,
      bold: true,
      color: hl ? (t.dark ? t.accent : t.primary) : t.text,
      fontLatin: t.fontTitle.latin,
      fontEa: t.fontTitle.ea,
      align: 'center',
      valign: 'middle',
      margin: TEXT_MARGIN,
    })
    cy += nameH + 4
    const priceSize = fitSize(pl.price, 44, cardW - pad * 2, 60, 0, 26)
    const priceH = textHeight(pl.price, priceSize, cardW - pad * 2, 0)
    shapes.push({
      name: `${p}-pl${i}-price`,
      text: pl.price,
      x: x + pad,
      y: cy,
      w: cardW - pad * 2,
      h: priceH,
      size: priceSize,
      bold: true,
      color: t.text,
      fontLatin: t.fontTitle.latin,
      fontEa: t.fontTitle.ea,
      align: 'center',
      valign: 'middle',
      margin: 0,
    })
    cy += priceH + 10
    shapes.push({
      name: `${p}-pl${i}-sep`,
      x: x + pad,
      y: cy,
      w: cardW - pad * 2,
      h: 1,
      fill: hairlineOf(t),
      line: 'none',
    })
    cy += 10
    const feats = pl.features.slice(0, 5)
    const featH = (cardH - (cy - top) - 26) / Math.max(feats.length, 1)
    feats.forEach((ft, j) => {
      const size = fitSize(ft, 12, cardW - pad * 2 - 18, featH, TEXT_MARGIN, 8.5, 1.25)
      shapes.push(
        {
          name: `${p}-pl${i}-f${j}-dot`,
          x: x + pad + 2,
          y: cy + 5,
          w: 6,
          h: 6,
          geometry: 'ellipse',
          fill: t.dark ? t.accent : t.primary,
          line: 'none',
        },
        {
          name: `${p}-pl${i}-f${j}-t`,
          text: ft,
          x: x + pad + 16,
          y: cy,
          w: cardW - pad * 2 - 18,
          h: featH,
          size,
          color: t.text,
          fontLatin: t.fontBody.latin,
          fontEa: t.fontBody.ea,
          align: 'left',
          valign: 'top',
          lineSpacing: 1.25,
          margin: TEXT_MARGIN,
        },
      )
      cy += featH
    })
  })
  return { shapes }
}

/** 纵向路线图：阶段节点 + 标题 + 说明，适合规划、路线图、演进路径。 */
function roadmap(s: Extract<SlideSpec, { layout: 'roadmap' }>, t: Theme, p: string): LayoutResult {
  const phases = s.phases.slice(0, 5)
  const n = Math.max(phases.length, 1)
  const availH = BODY.bottom - BODY.top
  const rowH = availH / n
  const axisX = MARGIN + 36
  const chipW = 72
  const shapes: ShapeOp[] = [
    bgShape(`${p}-bg`, t.bg),
    ...pageTitle(p, s.title, t),
    { name: `${p}-axis`, x: axisX + 1.5, y: BODY.top + 14, w: 3, h: availH - 28, fill: hairlineOf(t), line: 'none' },
  ]

  phases.forEach((ph, i) => {
    const rowY = BODY.top + i * rowH
    const cx = axisX + 3
    shapes.push(
      {
        name: `${p}-r${i}-dot`,
        x: cx - 10,
        y: rowY + 8,
        w: 24,
        h: 24,
        geometry: 'ellipse',
        fill: i === n - 1 ? t.accent : t.primary,
        line: 'none',
      },
      {
        name: `${p}-r${i}-phase`,
        text: ph.phase,
        x: axisX + 30,
        y: rowY + 4,
        w: chipW,
        h: 26,
        geometry: 'roundRect',
        adj: roundRectAdj(50000),
        fill: t.primary,
        line: 'none',
        size: 11.5,
        bold: true,
        color: fg(t),
        fontLatin: t.fontBody.latin,
        fontEa: t.fontBody.ea,
        align: 'center',
        valign: 'middle',
        margin: 2,
      },
    )
    const textX = axisX + 30 + chipW + 12
    const titleH = textHeight(ph.title, 16, 540)
    shapes.push({
      name: `${p}-r${i}-t`,
      text: ph.title,
      x: textX,
      y: rowY + 6,
      w: 540,
      h: titleH,
      size: 16,
      bold: true,
      color: t.text,
      fontLatin: t.fontTitle.latin,
      fontEa: t.fontTitle.ea,
      align: 'left',
      valign: 'top',
      margin: TEXT_MARGIN,
    })
    if (ph.desc) {
      const descH = Math.max(rowH - titleH - 14, 20)
      const size = fitSize(ph.desc, 12.5, 680, descH, TEXT_MARGIN, 9, 1.35)
      shapes.push({
        name: `${p}-r${i}-d`,
        text: ph.desc,
        x: textX,
        y: rowY + titleH + 6,
        w: 680,
        h: descH,
        size,
        color: t.muted,
        fontLatin: t.fontBody.latin,
        fontEa: t.fontBody.ea,
        align: 'left',
        valign: 'top',
        lineSpacing: 1.35,
        margin: TEXT_MARGIN,
      })
    }
  })
  return { shapes }
}

/**
 * 数据页：左图（officecli 原生 chart）+ 右洞察。
 *
 * 硬约束来自 WorkBuddy 的「数据必须落点」——只摆数字不给判断的是信息板，
 * 不是汇报稿。所以右侧留固定的结论位，`insight` 缺失时也占位，由设计门禁
 * 在生成前提示补齐。
 */
function chart(s: Extract<SlideSpec, { layout: 'chart' }>, t: Theme, p: string): LayoutResult {
  const top = BODY.top
  const h = BODY.bottom - BODY.top
  const chartW = col(7)
  const insX = xOf(8)
  const insW = CANVAS_W - MARGIN - insX
  const pad = 18

  const elements: DeckElement[] = [
    {
      kind: 'chart',
      name: `${p}-chart`,
      x: MARGIN,
      y: top,
      w: chartW,
      h,
      chartType: s.chartType ?? 'column',
      data: s.data,
      legend: s.legend ?? 'bottom',
      dataLabels: s.dataLabels,
      colors: s.colors ?? [t.primary, t.accent, t.secondary],
      displayUnits: s.displayUnits,
      categoryTitle: undefined,
    },
  ]

  const shapes: ShapeOp[] = [bgShape(`${p}-bg`, t.bg), ...pageTitle(p, s.title, t)]

  // ---- 右侧洞察卡 ----
  shapes.push({
    name: `${p}-icard`,
    x: insX,
    y: top,
    w: insW,
    h,
    geometry: 'roundRect',
    adj: roundRectAdj(6000),
    fill: surfaceOf(t),
    line: 'none',
  })
  let y = top + pad
  const iw = insW - pad * 2
  shapes.push({ name: `${p}-irule`, x: insX + pad, y, w: 3, h: 16, fill: t.accent, line: 'none' })
  const label = '关键结论'
  const labelH = textHeight(label, 11, iw)
  shapes.push({
    name: `${p}-ilabel`,
    text: label,
    x: insX + pad + 11,
    y,
    w: iw - 11,
    h: labelH,
    size: 11,
    bold: true,
    color: t.accent,
    fontLatin: t.fontBody.latin,
    fontEa: t.fontBody.ea,
    align: 'left',
    valign: 'middle',
    margin: TEXT_MARGIN,
  })
  y += Math.max(labelH, 16) + 12

  const insight = s.insight ?? '（此处写这页数据的判断：这个数字说明什么、对决策意味着什么）'
  const iSize = 14
  // ⚠️ 形状上设了 lineSpacing，textHeight 必须拿到同一个值：officecli 的溢出判定
  // 在设定行距后变成 size×1.333×lineSpacing，不传就会低估行高、触发溢出告警。
  const iH = textHeight(insight, iSize, iw, TEXT_MARGIN, 1.35)
  shapes.push({
    name: `${p}-itext`,
    text: insight,
    x: insX + pad,
    y,
    w: iw,
    h: iH,
    size: iSize,
    color: t.text,
    fontLatin: t.fontBody.latin,
    fontEa: t.fontBody.ea,
    align: 'left',
    valign: 'top',
    lineSpacing: 1.35,
    margin: TEXT_MARGIN,
  })
  y += iH + 16

  // 补充要点：用主色小方块 + 文字，比项目符号更稳（不依赖字体的 bullet 字形）
  for (const [i, b] of (s.bullets ?? []).slice(0, 3).entries()) {
    const text = b.desc ? `${b.title}——${b.desc}` : b.title
    const bh = textHeight(text, 12, iw - 14, TEXT_MARGIN, 1.3)
    if (y + bh > top + h - pad) break
    shapes.push({ name: `${p}-ib${i}`, x: insX + pad, y: y + 4, w: 6, h: 6, fill: t.primary, line: 'none' })
    shapes.push({
      name: `${p}-ibt${i}`,
      text,
      x: insX + pad + 14,
      y,
      w: iw - 14,
      h: bh,
      size: 12,
      color: t.muted,
      fontLatin: t.fontBody.latin,
      fontEa: t.fontBody.ea,
      align: 'left',
      valign: 'top',
      lineSpacing: 1.3,
      margin: TEXT_MARGIN,
    })
    y += bh + 8
  }

  if (s.source) {
    const sh = textHeight(s.source, 10, iw)
    shapes.push({
      name: `${p}-isrc`,
      text: s.source,
      x: insX + pad,
      y: top + h - pad - sh,
      w: iw,
      h: sh,
      size: 10,
      color: t.muted,
      fontLatin: t.fontBody.latin,
      fontEa: t.fontBody.ea,
      align: 'left',
      valign: 'bottom',
      margin: TEXT_MARGIN,
    })
  }

  return { shapes, elements }
}

/**
 * 图文页：一栏大图（officecli 原生 picture）+ 一栏文字。
 *
 * 图片不做裁切（officecli 的 picture 没有 objectFit），**原图宽高比必须接近
 * 图槽比例**，否则会拉伸：
 *   - 无图注：516 × 372 pt ≈ 1.39 : 1（接近 7:5）
 *   - 有图注：516 × 350 pt ≈ 1.47 : 1（接近 3:2）
 * 图注占用的空间是从图槽里让出来的，不是叠在图上——所以有图注时图会略矮一点。
 */
function imageSplit(s: Extract<SlideSpec, { layout: 'image-split' }>, t: Theme, p: string): LayoutResult {
  const top = BODY.top
  const imgW = col(7)
  const txtW = col(5)
  const right = s.side === 'right'
  const imgX = right ? MARGIN + txtW + GUTTER : MARGIN
  const txtX = right ? MARGIN : MARGIN + imgW + GUTTER

  // 图注从 B 区底部让位，避免与 C 区页脚相撞
  const capH = s.image.caption ? textHeight(s.image.caption, 10, imgW) : 0
  const h = BODY.bottom - BODY.top - (capH ? capH + 8 : 0)

  const shapes: ShapeOp[] = [bgShape(`${p}-bg`, t.bg), ...pageTitle(p, s.title, t)]

  // 图片外描边：浅色图上用极淡的边框界定边界，避免白底图「飘」在背景里
  shapes.push({
    name: `${p}-imgframe`,
    x: imgX,
    y: top,
    w: imgW,
    h,
    geometry: 'roundRect',
    adj: roundRectAdj(2000),
    fill: 'transparent',
    line: `${hairlineOf(t)}:1:solid`,
  })

  const elements: DeckElement[] = [
    { kind: 'picture', name: `${p}-img`, src: s.image.src, x: imgX, y: top, w: imgW, h },
  ]

  const pad = 4
  let y = top + pad
  if (s.desc) {
    const dh = textHeight(s.desc, 13, txtW, TEXT_MARGIN, 1.4)
    shapes.push({
      name: `${p}-desc`,
      text: s.desc,
      x: txtX,
      y,
      w: txtW,
      h: dh,
      size: 13,
      color: t.muted,
      fontLatin: t.fontBody.latin,
      fontEa: t.fontBody.ea,
      align: 'left',
      valign: 'top',
      lineSpacing: 1.4,
      margin: TEXT_MARGIN,
    })
    y += dh + 20
  }

  for (const [i, b] of (s.points ?? []).slice(0, 4).entries()) {
    const text = b.title
    const dh = b.desc ? textHeight(b.desc, 12, txtW - 20, TEXT_MARGIN, 1.35) : 0
    const th = textHeight(text, 15, txtW - 20)
    if (y + th + dh > top + h) break
    shapes.push({ name: `${p}-dot${i}`, x: txtX, y: y + 6, w: 8, h: 8, geometry: 'ellipse', fill: t.accent, line: 'none' })
    shapes.push({
      name: `${p}-pt${i}`,
      text,
      x: txtX + 20,
      y,
      w: txtW - 20,
      h: th,
      size: 15,
      bold: true,
      color: t.text,
      fontLatin: t.fontTitle.latin,
      fontEa: t.fontTitle.ea,
      align: 'left',
      valign: 'top',
      margin: TEXT_MARGIN,
    })
    y += th + 2
    if (b.desc) {
      shapes.push({
        name: `${p}-pd${i}`,
        text: b.desc,
        x: txtX + 20,
        y,
        w: txtW - 20,
        h: dh,
        size: 12,
        color: t.muted,
        fontLatin: t.fontBody.latin,
        fontEa: t.fontBody.ea,
        align: 'left',
        valign: 'top',
        lineSpacing: 1.35,
        margin: TEXT_MARGIN,
      })
      y += dh
    }
    y += 18
  }

  if (s.image.caption) {
    shapes.push({
      name: `${p}-cap`,
      text: s.image.caption,
      x: imgX,
      y: top + h + 8,
      w: imgW,
      h: capH,
      size: 10,
      color: t.muted,
      fontLatin: t.fontBody.latin,
      fontEa: t.fontBody.ea,
      align: 'left',
      valign: 'top',
      margin: TEXT_MARGIN,
    })
  }

  return { shapes, elements }
}

/**
 * 封面级全幅图页：整页底图 + 压暗蒙版 + 骑线文字块。
 *
 * 层序靠 `elementsBehind` 显式声明 —— 底图必须先于蒙版与文字落盘
 * （officecli 的 z-order 由插入顺序决定，见文件头铁律 1）。
 */
function imageFull(s: Extract<SlideSpec, { layout: 'image-full' }>, t: Theme, p: string): LayoutResult {
  const scrim = Math.max(0, Math.min(0.7, s.overlay ?? 0.35))
  const align = s.align ?? 'left'
  const blockW = 520
  const blockX = align === 'left' ? 56 : CANVAS_W - 56 - blockW

  const title = s.title ?? ''
  const titleSize = typeScale().coverTitle
  const titleH = title ? textHeight(title, titleSize, blockW, TEXT_MARGIN, 1.16) : 0
  const subSize = 16
  const subH = s.subtitle ? textHeight(s.subtitle, subSize, blockW, TEXT_MARGIN, 1.35) : 0
  const totalH = titleH + (subH ? subH + 18 : 0)
  let y = Math.max(BODY.top, (CANVAS_H - totalH) / 2 - 20)

  const shapes: ShapeOp[] = []
  // 蒙版：整页半透明黑，保证白字在任何底图上都可读
  shapes.push({
    name: `${p}-scrim`,
    x: 0,
    y: 0,
    w: CANVAS_W,
    h: CANVAS_H,
    fill: '000000',
    opacity: scrim,
    line: 'none',
  })
  if (title) {
    shapes.push({
      name: `${p}-title`,
      text: title,
      x: blockX,
      y,
      w: blockW,
      h: titleH,
      size: titleSize,
      bold: true,
      color: 'FFFFFF',
      fontLatin: t.fontTitle.latin,
      fontEa: t.fontTitle.ea,
      align: 'left',
      valign: 'top',
      lineSpacing: 1.16,
      margin: TEXT_MARGIN,
    })
    y += titleH + 14
    // 强调短横压在标题与副标之间
    shapes.push({ name: `${p}-rule`, x: blockX, y, w: 56, h: 4, fill: t.accent, line: 'none' })
    y += 18
  }
  if (s.subtitle) {
    shapes.push({
      name: `${p}-sub`,
      text: s.subtitle,
      x: blockX,
      y,
      w: blockW,
      h: subH,
      size: subSize,
      color: 'FFFFFF',
      fontLatin: t.fontBody.latin,
      fontEa: t.fontBody.ea,
      align: 'left',
      valign: 'top',
      lineSpacing: 1.35,
      margin: TEXT_MARGIN,
    })
  }

  const elements: DeckElement[] = [
    { kind: 'picture', name: `${p}-bgimg`, src: s.image.src, x: 0, y: 0, w: CANVAS_W, h: CANVAS_H },
  ]

  return { shapes, elements, elementsBehind: true }
}

/** 图示页：mermaid 源码编译成原生图形（officecli 的 diagram 走本地布局，不依赖远程渲染）。 */
function diagram(s: Extract<SlideSpec, { layout: 'diagram' }>, t: Theme, p: string): LayoutResult {
  const top = BODY.top
  const capH = s.caption ? textHeight(s.caption, 11, CONTENT_W) + 8 : 0
  const h = BODY.bottom - BODY.top - capH
  const shapes: ShapeOp[] = [bgShape(`${p}-bg`, t.bg), ...pageTitle(p, s.title, t)]
  if (s.caption) {
    shapes.push({
      name: `${p}-cap`,
      text: s.caption,
      x: MARGIN,
      y: top + h + 8,
      w: CONTENT_W,
      h: capH - 8,
      size: 11,
      color: t.muted,
      fontLatin: t.fontBody.latin,
      fontEa: t.fontBody.ea,
      align: 'center',
      valign: 'top',
      margin: TEXT_MARGIN,
    })
  }
  return {
    shapes,
    elements: [{ kind: 'diagram', name: `${p}-dia`, text: s.mermaid, x: MARGIN, y: top, w: CONTENT_W, h }],
  }
}

/** renderSlide 的上下文：总页数、页脚、页码格式与模板装饰。 */
export interface RenderContext {
  /** 总页数（页码格式 `{total}` 用）。 */
  total?: number
  /** 页脚左侧文字。 */
  footerText?: string
  /** 页码格式：true 纯数字、字符串模板、false 隐藏。缺省纯数字。 */
  pageNumber?: boolean | string
  /** 模板（提供内容页装饰）。 */
  template?: DeckTemplate
  /**
   * 内容页装饰的直接指定，优先级高于 `template.contentDecor`。
   *
   * 风格预设（`deck.style.preset`）声明了自己的装饰，而预设优先于模板 —— 比如
   * 「政务报告」的顶部色条遇上「黑底剧场」时，保留前者只会打架。调用方算好
   * 实际生效的装饰从这条路传进来。
   */
  contentDecor?: ContentDecor
}

/**
 * 渲染一页。`p` 是形状名前缀（形如 `s3`）—— officecli 的 `set` 靠 name 定位，
 * 跨页重名会让后续修正打错目标。
 */
export function renderSlide(spec: SlideSpec, theme: Theme, pageNo: number, ctx: RenderContext = {}): LayoutResult {
  const p = `s${pageNo}`
  const res = renderCore(spec, theme, p)
  const footed =
    spec.layout === 'cover' ||
    spec.layout === 'section' ||
    spec.layout === 'quote' ||
    spec.layout === 'ending' ||
    // 全幅底图页是 hero 页：蒙版上压页脚既不好读也破坏画面，一律不加
    spec.layout === 'image-full'
  if (!footed) {
    const right = formatPageNumber(ctx.pageNumber, pageNo, ctx.total)
    res.shapes.push(...pageFooter(p, ctx.footerText ?? '', pageNo, theme, right))
  }
  // 内容页模板装饰：插在 bg 之后、正文之前（形状按插入顺序叠放）
  if (!footed) {
    const decor = contentDecorShapes(p, ctx.contentDecor ?? ctx.template?.contentDecor, theme)
    if (decor.length > 0) res.shapes.splice(1, 0, ...decor)
  }
  return res
}

function renderCore(spec: SlideSpec, theme: Theme, p: string): LayoutResult {
  switch (spec.layout) {
    case 'cover':
      return cover(spec, theme, p)
    case 'section':
      return section(spec, theme, p)
    case 'bullets':
      return bullets(spec, theme, p)
    case 'cards':
      return cards(spec, theme, p)
    case 'kpi':
      return kpi(spec, theme, p)
    case 'steps':
      return steps(spec, theme, p)
    case 'compare':
      return compare(spec, theme, p)
    case 'timeline':
      return timeline(spec, theme, p)
    case 'quote':
      return quote(spec, theme, p)
    case 'table':
      return table(spec, theme, p)
    case 'ending':
      return ending(spec, theme, p)
    case 'agenda':
      return agenda(spec, theme, p)
    case 'swot':
      return swot(spec, theme, p)
    case 'pricing':
      return pricing(spec, theme, p)
    case 'roadmap':
      return roadmap(spec, theme, p)
    case 'chart':
      return chart(spec, theme, p)
    case 'image-split':
      return imageSplit(spec, theme, p)
    case 'image-full':
      return imageFull(spec, theme, p)
    case 'diagram':
      return diagram(spec, theme, p)
  }
}

export { CANVAS_W, CANVAS_H, estimateLines }
