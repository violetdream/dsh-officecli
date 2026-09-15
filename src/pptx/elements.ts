/**
 * 元素层：把 officecli 的**非 shape 元素**接进插件编译链。
 *
 * 背景：插件长期只下发 `add --type shape`，而 officecli 的 pptx 元素面远不止
 * shape —— 实测（1.0.149）支持 chart / table / picture / diagram / connector /
 * animation / notes / group / media / model3d / zoom / equation 等。缺的这些恰好
 * 是「PPT 像不像专业稿」的分水岭：数据页没有真图表、视觉页没有配图、流程页没有
 * 图示、演讲没有备注。
 *
 * 本文件定义统一的 {@link DeckElement} 联合类型与 {@link elementCommands} 编译器，
 * 版式层只负责产出元素对象，序列化细节（属性名、单位、路径）收在这里。
 *
 * 全部元素共用同一套坐标约定：**pt**，与画布 960×540pt 同坐标系。
 */

import { pt } from './grid.js'

/** officecli batch 记录。与 deck.ts 的 BatchCommand 结构一致（此处独立声明，避免循环依赖）。 */
export interface ElementCommand {
  command: string
  path?: string
  type?: string
  index?: number
  props?: Record<string, string>
}

/** 元素在画布上的位置与尺寸（pt）。 */
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

// ---------------------------------------------------------------------------
// 图表
// ---------------------------------------------------------------------------

/**
 * officecli chartType 词汇表。
 *
 * 基类型 18 种，可叠加修饰：`3d` / `stacked` / `percentStacked`。
 * 注意**与 OOXML / WorkBuddy SlideDSL 的写法都不同**：这里是 `column` 不是
 * `barChart`，`bar` 专指横向条形。写错的代价是整条命令失败。
 */
export const CHART_TYPES = [
  'column',
  'bar',
  'line',
  'pie',
  'doughnut',
  'area',
  'scatter',
  'bubble',
  'radar',
  'stock',
  'combo',
  'waterfall',
  'funnel',
  'treemap',
  'sunburst',
  'boxWhisker',
  'histogram',
  'pareto',
] as const

/** 友好的图表别名 → officecli 词汇。模型爱写 WorkBuddy 风格的名字，替它纠正。 */
const CHART_ALIASES: Record<string, string> = {
  barchart: 'column',
  columnchart: 'column',
  bar3dchart: 'bar3d',
  column3dchart: 'column3d',
  linechart: 'line',
  areachart: 'area',
  piechart: 'pie',
  doughnutchart: 'doughnut',
  donutchart: 'doughnut',
  scatterchart: 'scatter',
  bubblechart: 'bubble',
  radarchart: 'radar',
  funnelchart: 'funnel',
  waterfallchart: 'waterfall',
  treemapchart: 'treemap',
  stackedbar: 'stackedBar',
  stackedcolumn: 'stackedColumn',
  stackedarea: 'stackedArea',
  percentstackedbar: 'percentStackedBar',
  percentstackedcolumn: 'percentStackedColumn',
  horizontalbar: 'bar',
  verticalbar: 'column',
  horizontal: 'bar',
  vertical: 'column',
}

/**
 * 规范化图表类型。大小写不敏感，并接受 WorkBuddy SlideDSL 风格的别名。
 * @returns 规范化后的 officecli chartType；无法识别时回落到 column。
 */
export function normalizeChartType(raw: string | undefined): string {
  if (!raw) return 'column'
  const key = raw.trim().toLowerCase().replace(/[_\-\s]/g, '')
  if (CHART_ALIASES[key]) return CHART_ALIASES[key]!
  // 已命中基类型（保留原始大小写，boxWhisker 等是驼峰）
  const base = CHART_TYPES.find((t) => t.toLowerCase() === key)
  if (base) return base
  // 修饰型：stackedColumn / percentStackedBar / bar3d / column3d
  const m = /^(stacked|percentstacked|3d)?(.*?)(3d)?$/.exec(key)
  if (m) {
    const [, pre, core, post] = m
    const coreHit = CHART_TYPES.find((t) => t.toLowerCase() === core)
    if (coreHit) {
      const prefix = pre === 'percentstacked' ? 'percentStacked' : pre === 'stacked' ? 'stacked' : ''
      const suffix = pre === '3d' || post === '3d' ? '3d' : ''
      return `${prefix}${coreHit}${suffix}`
    }
  }
  return 'column'
}

/** 图表数据：officecli 的 `系列:值,值;系列:值,值` 串，或二维数组（首行认作表头）。 */
export type ChartData = string | (string | number)[][]

/**
 * 把二维数组转成 officecli 的 `series:values;series:values` 串。
 *
 * 传入形如 `[['季度','2025','2026'],['Q1',120,145],['Q2',156,178]]`：
 * **首行是表头**（第一格是分类轴标题，其余是系列名），**首列是分类值**。
 * officecli 的 series 串按「系列名:各分类值」组织，与「行=分类、列=系列」的
 * 表格直觉正好转置，这里做一次转置。
 *
 * 注意不要用「表头单元格是不是数字」来判断有无表头 —— 系列名常常就是
 * `'2025'` 这种数字样字符串，启发式会误判并产出一串非法系列名。
 * 约定优于猜测：**总是**按首行表头、首列分类解释。
 */
export function chartDataToSeries(data: ChartData): string {
  if (typeof data === 'string') return data
  if (data.length < 2) return ''
  const [head, ...rows] = data
  if (!head) return ''
  const seriesCount = head.length - 1
  const series: string[] = []
  for (let c = 1; c <= seriesCount; c++) {
    const name = String(head[c] ?? `系列${c}`).trim() || `系列${c}`
    const values = rows
      .map((r) => String(r[c] ?? '').trim())
      // officecli 只接受纯数字，空单元格直接跳过（会缩短该系列，但只要各系列
      // 齐全就不会错位；缺值请显式写 0）
      .filter((v) => v !== '' && Number.isFinite(Number(v)))
    if (values.length > 0) series.push(`${name}:${values.join(',')}`)
  }
  return series.join(';')
}

/** 图表的分类轴标签（officecli `categories=`）。 */
export function chartCategories(data: ChartData): string | undefined {
  if (typeof data === 'string') return undefined
  const rows = data.slice(1)
  if (rows.length === 0) return undefined
  const cats = rows.map((r) => String(r[0] ?? '')).filter((v) => v !== '')
  return cats.length > 0 ? cats.join(',') : undefined
}

export interface ChartElement extends Box {
  kind: 'chart'
  /** 图表类型（可用友好别名，编译时规范化）。 */
  chartType: string
  data: ChartData
  /** 系列配色（hex 数组，不带 `#`）。 */
  colors?: string[]
  /** 图表标题。 */
  title?: string
  /** 图例位置。 */
  legend?: 'bottom' | 'top' | 'left' | 'right' | 'none'
  /** 是否显示数据标签。 */
  dataLabels?: boolean
  /** 数值轴单位：hundreds/thousands/millions/... */
  displayUnits?: string
  /** 柱间距（0–500）。 */
  gapWidth?: number
  /** 是否显示网格线。 */
  gridlines?: boolean
  /** 分类轴标题（横向轴的业务含义）。 */
  categoryTitle?: string
  /** 数值轴标题。 */
  valueTitle?: string
  /** 圆周图起始角度（饼图/圆环）。 */
  firstSliceAngle?: number
  /** 饼图/圆环的洞径百分比（圆环用）。 */
  holeSize?: number
  /** 深度（3D 图）。 */
  name?: string
}

// ---------------------------------------------------------------------------
// 图片
// ---------------------------------------------------------------------------

export interface PictureElement extends Box {
  kind: 'picture'
  /** 本地文件绝对路径或工作区相对路径。禁止 http(s) URL。 */
  src: string
  name?: string
  /** 高亮描边 `HEX:宽度:线型`。 */
  line?: string
  /** 圆角（pt）。 */
  cornerRadius?: number
  /** 整体不透明度 0–1。 */
  opacity?: number
}

// ---------------------------------------------------------------------------
// 原生表格
// ---------------------------------------------------------------------------

export interface TableElement extends Box {
  kind: 'table'
  headers: string[]
  rows: string[][]
  name?: string
  /** 表头底色（hex，不带 `#`）。 */
  headerFill?: string
  /** 表体交替行底色。 */
  bandFill?: string
  /** 字号（pt）。 */
  size?: number
  /** 是否显示表头行样式。 */
  headerRow?: boolean
  /** 是否斑马纹。 */
  bandRow?: boolean
}

// ---------------------------------------------------------------------------
// Mermaid 图示
// ---------------------------------------------------------------------------

export interface DiagramElement extends Box {
  kind: 'diagram'
  /** 内联 mermaid 源码。 */
  text: string
  name?: string
}

// ---------------------------------------------------------------------------
// 连接线
// ---------------------------------------------------------------------------

export interface ConnectorElement {
  kind: 'connector'
  /** 线型。 */
  shape: 'straight' | 'elbow' | 'curve'
  /** 起点形状的 name（编译时转成 `/slide[N]/shape[@name=X]`）。 */
  from: string
  /** 终点形状的 name。 */
  to: string
  /** 描边 `HEX:宽度:线型`，如 `6B7280:1:solid`。 */
  line?: string
  /** 终点箭头。 */
  tailEnd?: string
  /** 起点箭头。 */
  headEnd?: string
  name?: string
}

// ---------------------------------------------------------------------------
// 动画
// ---------------------------------------------------------------------------

/**
 * 动画效果白名单（officecli 的 `effect`）。
 *
 * 实测 officecli 支持 50+ 效果，这里只暴露**中文汇报里真正用得上**的一小撮，
 * 并在设计指南里强约束「同一份 PPT 只用一种」——混用是廉价感的来源。
 */
export const ANIMATION_EFFECTS = [
  'appear',
  'fade',
  'fly',
  'zoom',
  'wipe',
  'bounce',
  'float',
  'split',
  'dissolve',
  'box',
  'circle',
  'diamond',
  'blinds',
  'wheel',
  'random',
  'grow',
  'spin',
  'pulse',
] as const

/** 效果的友好别名 → officecli 词汇。 */
const ANIM_ALIASES: Record<string, string> = {
  fadein: 'fade',
  fadeout: 'fade',
  flyin: 'fly',
  flyout: 'fly',
  zoomin: 'zoom',
  zoomout: 'zoom',
  wipein: 'wipe',
  pulse: 'pulse',
  spin: 'spin',
  grow: 'grow',
  floatin: 'float',
  disappear: 'appear',
}

export type AnimationClass = 'entrance' | 'emphasis' | 'exit'
export type AnimationTrigger = 'onClick' | 'withPrevious' | 'afterPrevious'

/** 规范化动画效果名；无法识别时回落到 fade。 */
export function normalizeAnimEffect(raw: string | undefined): string {
  if (!raw) return 'fade'
  const key = raw.trim().toLowerCase().replace(/[_\-\s]/g, '')
  if (ANIM_ALIASES[key]) return ANIM_ALIASES[key]!
  return ANIMATION_EFFECTS.find((e) => e === key) ?? 'fade'
}

/** 规范化触发方式；接受 WorkBuddy SlideDSL 的写法。 */
export function normalizeAnimTrigger(raw: string | undefined): AnimationTrigger {
  switch ((raw ?? '').trim().toLowerCase()) {
    case 'click':
    case 'onclick':
      return 'onClick'
    case 'withprevious':
    case 'with':
      return 'withPrevious'
    case 'afterprevious':
    case 'after':
      return 'afterPrevious'
    default:
      return 'afterPrevious'
  }
}

/**
 * 给某个已存在的元素挂入场动画。
 *
 * ⚠️ 实测限制：officecli 只允许把动画挂在**顶层 shape 或 chart** 上
 * （`/slide[N]/shape[M]` 或 `/slide[N]/chart[M]`）。picture 会被拒绝，
 * group 内部的形状也不能单独动画。所以 {@link parent} 必须与目标元素的实际
 * 类型一致，图表必须写 `'chart'`，否则命令会以 `No shape found with @name=...` 失败。
 */
export interface AnimationElement {
  kind: 'animation'
  /** 目标元素类型：决定路径段是 `shape` 还是 `chart`。 */
  parent: 'shape' | 'chart'
  /** 目标元素的 name。 */
  target: string
  effect: string
  animClass?: AnimationClass
  trigger?: AnimationTrigger
  /** 时长（毫秒）。 */
  duration?: number
  /** 延迟（毫秒）。 */
  delay?: number
}

// ---------------------------------------------------------------------------
// 演讲者备注
// ---------------------------------------------------------------------------

export interface NotesElement {
  kind: 'notes'
  text: string
}

// ---------------------------------------------------------------------------
// 联合类型
// ---------------------------------------------------------------------------

export type DeckElement =
  | ChartElement
  | PictureElement
  | TableElement
  | DiagramElement
  | ConnectorElement
  | AnimationElement
  | NotesElement

/** 需要页面路径（`/slide[N]`）的元素 kind。 */
const PAGE_LEVEL = new Set<DeckElement['kind']>(['chart', 'picture', 'table', 'diagram', 'connector', 'notes'])

/**
 * 把元素编译成 officecli batch 命令。
 *
 * @param el    元素
 * @param pageNo 页号（1-based），用于拼 `/slide[N]`
 * @param theme 主题（提供表格/图表的中性色与字体），可选
 */
export function elementCommands(
  el: DeckElement,
  pageNo: number,
  theme?: { text: string; muted: string; fontBody: { latin: string; ea: string }; bg: string },
): ElementCommand[] {
  const slide = `/slide[${pageNo}]`
  switch (el.kind) {
    case 'chart': {
      const props: Record<string, string> = {
        chartType: normalizeChartType(el.chartType),
        data: chartDataToSeries(el.data),
        x: pt(el.x),
        y: pt(el.y),
        width: pt(el.w),
        height: pt(el.h),
      }
      const cats = chartCategories(el.data)
      if (cats) props.categories = cats
      if (el.name) props.name = el.name
      if (el.title) props.title = el.title
      if (el.legend) props.legend = el.legend
      if (el.dataLabels) props.dataLabels = 'true'
      if (el.displayUnits) props.dispunits = el.displayUnits
      if (el.gapWidth !== undefined) props.gapwidth = String(el.gapWidth)
      if (el.gridlines !== undefined) props.gridlines = el.gridlines ? 'true' : 'false'
      if (el.categoryTitle) props.catTitle = el.categoryTitle
      if (el.valueTitle) props.axistitle = el.valueTitle
      if (el.firstSliceAngle !== undefined) props.firstSliceAngle = String(el.firstSliceAngle)
      if (el.holeSize !== undefined) props.holeSize = String(el.holeSize)
      if (el.colors && el.colors.length > 0) props.colors = el.colors.map((c) => stripHash(c)).join(',')
      if (theme) {
        props['font.ea'] = theme.fontBody.ea
        props.font = theme.fontBody.latin
        if (el.legend !== 'none') props.legendFont = `10:${theme.muted}:${theme.fontBody.latin}`
        props.axisfont = `10:${theme.muted}:${theme.fontBody.latin}`
      }
      return [{ command: 'add', path: slide, type: 'chart', props }]
    }

    case 'picture': {
      const props: Record<string, string> = {
        src: el.src,
        x: pt(el.x),
        y: pt(el.y),
        width: pt(el.w),
        height: pt(el.h),
      }
      if (el.name) props.name = el.name
      if (el.line) props.line = el.line
      if (el.cornerRadius !== undefined) props.cornerRadius = pt(el.cornerRadius)
      if (el.opacity !== undefined) props.opacity = String(el.opacity)
      return [{ command: 'add', path: slide, type: 'picture', props }]
    }

    case 'table': {
      const { headers, rows } = el
      const all = [headers, ...rows]
      const props: Record<string, string> = {
        rows: String(all.length),
        cols: String(headers.length),
        // officecli 的单元格分隔：列用 `|`，行用 `;`
        data: all.map((r) => r.map((c) => String(c).replace(/[|;]/g, ' ')).join('|')).join(';'),
        x: pt(el.x),
        y: pt(el.y),
        width: pt(el.w),
        height: pt(el.h),
        headerRow: el.headerRow === false ? 'false' : 'true',
        bandRow: el.bandRow === false ? 'false' : 'true',
        align: 'center',
        valign: 'middle',
      }
      if (el.name) props.name = el.name
      if (el.headerFill) props.headerFill = stripHash(el.headerFill)
      if (el.bandFill) props.bandFill = stripHash(el.bandFill)
      if (theme) {
        props.fill = theme.bg
        props.color = theme.text
        props['font.ea'] = theme.fontBody.ea
        props.font = theme.fontBody.latin
        // officecli 的表格字号默认偏大，压到 caption 级才不挤
        props.size = String(el.size ?? 11)
      } else if (el.size !== undefined) {
        props.size = String(el.size)
      }
      return [{ command: 'add', path: slide, type: 'table', props }]
    }

    case 'diagram': {
      // diagram 目前不接受 name（会回落到 group 的自动命名），只在有值时下发
      const props: Record<string, string> = {
        dsl: el.text,
        x: pt(el.x),
        y: pt(el.y),
        width: pt(el.w),
        height: pt(el.h),
      }
      return [{ command: 'add', path: slide, type: 'diagram', props }]
    }

    case 'connector': {
      const props: Record<string, string> = {
        shape: el.shape,
        from: `/slide[${pageNo}]/shape[@name=${el.from}]`,
        to: `/slide[${pageNo}]/shape[@name=${el.to}]`,
      }
      if (el.name) props.name = el.name
      if (el.line) props.line = el.line
      if (el.tailEnd) props.tailEnd = el.tailEnd
      if (el.headEnd) props.headEnd = el.headEnd
      return [{ command: 'add', path: slide, type: 'connector', props }]
    }

    case 'animation': {
      const props: Record<string, string> = {
        effect: normalizeAnimEffect(el.effect),
        class: el.animClass ?? 'entrance',
        trigger: normalizeAnimTrigger(el.trigger),
      }
      if (el.duration !== undefined) props.duration = String(el.duration)
      if (el.delay !== undefined) props.delay = String(el.delay)
      // 路径必须带 @name 才稳定（positional 索引会随 z-order 漂移），
      // 且父元素类型必须与目标一致：chart 走 chart，其余走 shape。
      return [
        {
          command: 'add',
          path: `/slide[${pageNo}]/${el.parent}[@name=${el.target}]`,
          type: 'animation',
          props,
        },
      ]
    }

    case 'notes':
      return [{ command: 'add', path: slide, type: 'notes', props: { text: el.text } }]
  }
}

/** 批量编译一页的全部元素。 */
export function slideElementCommands(
  elements: DeckElement[],
  pageNo: number,
  theme?: { text: string; muted: string; fontBody: { latin: string; ea: string }; bg: string },
): ElementCommand[] {
  return elements.flatMap((el) => elementCommands(el, pageNo, theme))
}

/** 元素是否为页级（非挂载在形状上的）。 */
export function isPageLevel(kind: DeckElement['kind']): boolean {
  return PAGE_LEVEL.has(kind)
}

/** 去掉 `#`，officecli 的 color/fill 属性一律不带井号。 */
export function stripHash(color: string): string {
  return color.replace(/^#/, '').toUpperCase()
}
