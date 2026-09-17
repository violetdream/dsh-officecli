import { CANVAS_H, CANVAS_W, typeScale, withTypeScale, type TypeScale } from './grid.js'
import { LAYOUT_IDS, renderSlide, type BulletItem, type LayoutResult, type SlideSpec } from './layouts.js'
import { isPageLevel, normalizeAnimEffect, slideElementCommands } from './elements.js'
import { toProps } from './shape.js'
import {
  applyThemeOverrides,
  findTheme,
  getTheme,
  normalizeHex,
  resolveTheme,
  themeToProps,
  type ColorOverrides,
  type FontOverrides,
  type Theme,
} from './theme.js'
import { allTemplates, getTemplate, templateIds, type ContentDecor, type DeckTemplate } from './templates.js'
import { applyStyle, findStyle, type PptStyle } from './styles.js'

/**
 * deck 编排层：把模型填写的 DeckSpec 编译成 officecli `batch` 命令序列。
 *
 * 一次 `batch` 提交全部命令，officecli 默认走原子事务（临时副本 → 全成功才
 * File.Replace），所以半成品不会落盘。70–100 个 shape 一次提交无压力。
 */

/** officecli batch 记录。字段名是硬约束，写错会直接抛错。 */
export interface BatchCommand {
  command: string
  path?: string
  type?: string
  index?: number
  props?: Record<string, string>
}

/** 演示文稿元数据（写入 docProps/core.xml + app.xml）。 */
export interface DeckMeta {
  title?: string
  author?: string
  keywords?: string
  description?: string
  category?: string
}

/**
 * 整份 PPT 的样式协议（对应 officecli presentation/slide 的 --prop 面）：
 * 元数据、默认转场、默认背景、页码格式、页脚，以及**视觉层覆盖**
 * （自然语言风格 → 主题、色槽、字体、字号阶梯）。
 */
export interface DeckStyle {
  meta?: DeckMeta
  /** 默认转场（slide 级可覆盖）：fade/push/wipe/morph 等。 */
  transition?: string
  /** 默认页面背景（slide 级可覆盖）：色值或渐变。 */
  background?: string
  /** 页码：true 纯数字、'{n} / {total}' 带总页数、false 隐藏。缺省 true。 */
  pageNumber?: boolean | string
  /** 页脚左文（优先级高于顶层 footer）。 */
  footer?: string
  /**
   * 自然语言风格描述，如"科技蓝""政务红""用我们公司的深蓝"。
   * 优先级低于 theme（theme 是精确 id 时直接用），高于模板默认主题。
   */
  vibe?: string
  /**
   * 视觉流派预设 id（见 `styles.ts`），如 `neo-swiss` / `bento` / `断言-证据`。
   *
   * 与 `template` 正交：template 管**场景**（开什么会用的稿子），preset 管**流派**
   * （这份稿子的视觉语言）。填了它，插件一次性落地配色 / 字体 / 字号策略 / 封面
   * 装饰 / 内容页装饰 / 转场 / 页码，优先级高于模板样式与 deck.theme。
   *
   * 用户给了品牌主色时（`colors.primary`），流派的有彩色会做**同源色相迁移**，
   * 中性灰阶不动 —— 而不是整组换掉。
   */
  preset?: string
  /**
   * 色彩论证：一句话说明「为什么是这组色」。
   *
   * 三步推导协议（采样 → 收敛 → 论证）的第三步，也是防 slop 的自检门。不写就
   * 沿用插件按 OKLCH 推导时自动生成的论证句；写了则覆盖它。
   */
  colorRationale?: string
  /** 色槽覆盖，值支持 `#RRGGBB` / `RRGGBB` / `#RGB`。 */
  colors?: ColorOverrides
  /** 字体覆盖。 */
  fonts?: FontOverrides
  /** 字号阶梯覆盖。 */
  typography?: TypographyOverride
}

/** 字号阶梯覆盖：`scale` 为整体倍数，其余为绝对 pt 值。 */
export type TypographyOverride = { scale?: number } & Partial<TypeScale>

/** 模型填写的整份 PPT 描述。 */
export interface DeckSpec {
  /**
   * 模板 id（见 office_design_guide 的 templates 节）。模板决定主题基调与装饰。
   * 内置模板之外，用户放在 `~/.dsh/officecli/templates.json` 的自定义模板同样可用。
   */
  template?: string
  /**
   * 主题 id（见 `office_design_guide` 的 themes 节）。缺省用模板主题或商务蓝。
   *
   * 支持的说法不止 id：中文别名（"科技蓝""政务红""极简灰"）、自然语言关键词
   * （"深色科技风"），甚至一个十六进制主色（"#0F5EA6"，会当场派生整套配色）
   * 都能命中。识别不了才回落到默认主题。
   */
  theme?: string
  /** 页脚左侧文字，缺省为空。 */
  footer?: string
  /** 整份样式协议（元数据/转场/背景/页码/配色/字体/字号）。 */
  style?: DeckStyle
  slides: SlideSpec[]
}

/** 编译结果。 */
export interface CompiledDeck {
  commands: BatchCommand[]
  pageCount: number
  theme: Theme
  /** 每页的版式，用于回执。 */
  layouts: string[]
  /** 使用的模板 id（未指定为 undefined）。 */
  template?: string
  /** 命中的风格预设 id（未指定或无法识别为 undefined）。 */
  preset?: string
  /** `style.preset` 给了但解析不出任何风格 —— 用于回执里提醒模型别以为生效了。 */
  presetMissed?: string
}

/** DeckSpec 校验失败时抛出的错误，带面向模型的可修正提示。 */
export class DeckSpecError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DeckSpecError'
  }
}

const MAX_SLIDES = 40

/** 校验并规范化 DeckSpec。所有错误信息都写成「模型看了能改」的形式。 */
export function parseDeckSpec(input: unknown): DeckSpec {
  if (!input || typeof input !== 'object') {
    throw new DeckSpecError('deck 必须是一个对象，形如 {"template":"consulting","theme":"business-blue","slides":[...]}')
  }
  const raw = input as Record<string, unknown>
  const slides = raw.slides
  if (!Array.isArray(slides) || slides.length === 0) {
    throw new DeckSpecError('slides 必须是非空数组。')
  }
  if (slides.length > MAX_SLIDES) {
    throw new DeckSpecError(`页数过多：${slides.length} 页，上限 ${MAX_SLIDES} 页。请拆分或精简。`)
  }

  const template = typeof raw.template === 'string' ? raw.template : undefined
  const known = templateIds()
  if (template !== undefined && !known.includes(template)) {
    throw new DeckSpecError(`未知模板 "${template}"。可选：${known.join(', ')}`)
  }
  const theme = typeof raw.theme === 'string' ? raw.theme : undefined
  const footer = typeof raw.footer === 'string' ? raw.footer : undefined

  const parsed = slides.map((item, i) => parseSlide(item, i))
  return {
    template,
    theme,
    footer,
    style: parseStyle(raw.style, template),
    slides: parsed,
  }
}

function parseStyle(input: unknown, template: string | undefined): DeckStyle | undefined {
  if (input === undefined || input === null) return undefined
  if (typeof input !== 'object') throw new DeckSpecError('style 必须是对象，形如 {"transition":"fade","pageNumber":"{n} / {total}"}')
  const s = input as Record<string, unknown>
  const meta = s.meta as Record<string, unknown> | undefined
  if (meta !== undefined && (typeof meta !== 'object' || meta === null)) {
    throw new DeckSpecError('style.meta 必须是对象（title/author/keywords/description/category）。')
  }
  const out: DeckStyle = {}
  if (meta) {
    const m: DeckMeta = {}
    for (const key of ['title', 'author', 'keywords', 'description', 'category'] as const) {
      const v = meta[key]
      if (typeof v === 'string' && v) m[key] = v
    }
    if (Object.keys(m).length) out.meta = m
  }
  if (typeof s.transition === 'string') out.transition = s.transition
  if (typeof s.background === 'string') out.background = s.background
  if (typeof s.pageNumber === 'boolean' || typeof s.pageNumber === 'string') out.pageNumber = s.pageNumber
  if (typeof s.footer === 'string') out.footer = s.footer
  if (typeof s.vibe === 'string' && s.vibe.trim()) out.vibe = s.vibe.trim()
  if (typeof s.preset === 'string' && s.preset.trim()) out.preset = s.preset.trim()
  if (typeof s.colorRationale === 'string' && s.colorRationale.trim()) {
    out.colorRationale = s.colorRationale.trim()
  }
  const colors = parseColors(s.colors)
  if (colors) out.colors = colors
  const fonts = parseFonts(s.fonts)
  if (fonts) out.fonts = fonts
  const typography = parseTypography(s.typography)
  if (typography) out.typography = typography
  // 模板已含默认值（transition/pageNumber）时，style 留空即可
  if (Object.keys(out).length === 0 && template === undefined) return undefined
  return out
}

const COLOR_KEYS = ['primary', 'secondary', 'accent', 'bg', 'text', 'muted', 'accent5', 'accent6', 'hyperlink'] as const
const FONT_KEYS = ['title', 'body', 'titleLatin', 'titleEa', 'bodyLatin', 'bodyEa'] as const
const FONT_ALIASES: Record<string, keyof FontOverrides> = {
  latin: 'bodyLatin',
  ea: 'bodyEa',
  eastAsia: 'bodyEa',
  title_cn: 'titleEa',
  标题: 'title',
  正文: 'body',
}
const TYPE_KEYS = ['coverTitle', 'sectionTitle', 'anchor', 'pageTitle', 'cardTitle', 'body', 'quote', 'caption'] as const
const TYPE_ALIASES: Record<string, keyof TypeScale> = {
  title: 'pageTitle',
  pageTitleSize: 'pageTitle',
  bodySize: 'body',
  cardTitleSize: 'cardTitle',
  coverTitleSize: 'coverTitle',
}

function parseColors(input: unknown): ColorOverrides | undefined {
  if (!input || typeof input !== 'object') return undefined
  const src = input as Record<string, unknown>
  const out: ColorOverrides = {}
  for (const key of COLOR_KEYS) {
    const v = src[key]
    if (typeof v !== 'string') continue
    const hex = normalizeHex(v)
    if (!hex) throw new DeckSpecError(`style.colors.${key} 不是合法颜色值: "${v}"（用 6 位或 3 位 hex，如 #1F6FEB）。`)
    out[key] = hex
  }
  return Object.keys(out).length ? out : undefined
}

function parseFonts(input: unknown): FontOverrides | undefined {
  if (!input || typeof input !== 'object') return undefined
  const src = input as Record<string, unknown>
  const out: FontOverrides = {}
  for (const [rawKey, rawValue] of Object.entries(src)) {
    if (typeof rawValue !== 'string' || !rawValue.trim()) continue
    const key = (FONT_KEYS as readonly string[]).includes(rawKey)
      ? (rawKey as keyof FontOverrides)
      : FONT_ALIASES[rawKey]
    if (!key) continue
    out[key] = rawValue.trim()
  }
  return Object.keys(out).length ? out : undefined
}

function parseTypography(input: unknown): TypographyOverride | undefined {
  if (!input || typeof input !== 'object') return undefined
  const src = input as Record<string, unknown>
  const out: TypographyOverride = {}
  if (typeof src.scale === 'number' && Number.isFinite(src.scale)) out.scale = src.scale
  for (const [rawKey, rawValue] of Object.entries(src)) {
    if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) continue
    const key = (TYPE_KEYS as readonly string[]).includes(rawKey)
      ? (rawKey as keyof TypeScale)
      : TYPE_ALIASES[rawKey]
    if (!key) continue
    out[key] = Math.max(8, Math.min(120, rawValue))
  }
  return Object.keys(out).length ? out : undefined
}

function parseSlide(item: unknown, i: number): SlideSpec {
  const at = `第 ${i + 1} 页`
  if (!item || typeof item !== 'object') throw new DeckSpecError(`${at}：必须是一个对象。`)
  const s = item as Record<string, unknown>
  const layout = s.layout
  if (typeof layout !== 'string') {
    throw new DeckSpecError(`${at}：缺少 layout 字段。可选值：${LAYOUT_IDS.join(', ')}`)
  }
  if (!(LAYOUT_IDS as readonly string[]).includes(layout)) {
    throw new DeckSpecError(`${at}：未知版式 "${layout}"。可选值：${LAYOUT_IDS.join(', ')}`)
  }

  const str = (v: unknown, field: string, required: boolean): string | undefined => {
    if (v === undefined || v === null || v === '') {
      if (required) throw new DeckSpecError(`${at}（${layout}）：缺少必填字段 ${field}。`)
      return undefined
    }
    if (typeof v !== 'string') throw new DeckSpecError(`${at}（${layout}）：${field} 必须是字符串。`)
    return v
  }
  const list = (v: unknown, field: string, min: number): unknown[] => {
    if (!Array.isArray(v) || v.length < min) {
      throw new DeckSpecError(`${at}（${layout}）：${field} 必须是至少 ${min} 项的数组。`)
    }
    return v
  }
  const title = () => str(s.title, 'title', true)!

  // 每页通用的可选字段（transition/background/hidden/notes/animate），任意版式均可带
  const slideExtras = (): {
    transition?: string
    background?: string
    hidden?: boolean
    notes?: string
    animate?: boolean | string
  } => {
    const out: {
      transition?: string
      background?: string
      hidden?: boolean
      notes?: string
      animate?: boolean | string
    } = {}
    if (typeof s.transition === 'string') out.transition = s.transition
    if (typeof s.background === 'string') out.background = s.background
    if (typeof s.hidden === 'boolean') out.hidden = s.hidden
    if (typeof s.notes === 'string' && s.notes.trim()) out.notes = s.notes
    // animate: true 用默认 fade；字符串按效果名（fade/fly/zoom/wipe/...）
    if (typeof s.animate === 'boolean') out.animate = s.animate
    else if (typeof s.animate === 'string' && s.animate.trim()) out.animate = s.animate
    return out
  }

  switch (layout) {
    case 'cover':
      return {
        layout,
        title: title(),
        eyebrow: str(s.eyebrow, 'eyebrow', false),
        subtitle: str(s.subtitle, 'subtitle', false),
        meta: str(s.meta, 'meta', false),
        ...slideExtras(),
      }
    case 'section':
      return {
        layout,
        title: title(),
        number: str(s.number, 'number', false),
        subtitle: str(s.subtitle, 'subtitle', false),
        ...slideExtras(),
      }
    case 'bullets':
      return {
        layout,
        title: title(),
        columns: s.columns === 2 ? 2 : undefined,
        items: list(s.items, 'items', 1).map((it, j) => {
          const o = it as Record<string, unknown>
          return { title: String(o.title ?? `要点 ${j + 1}`), desc: o.desc ? String(o.desc) : undefined }
        }),
        ...slideExtras(),
      }
    case 'cards':
      return {
        layout,
        title: title(),
        columns: typeof s.columns === 'number' ? s.columns : undefined,
        cards: list(s.cards, 'cards', 1).map((it, j) => {
          const o = it as Record<string, unknown>
          return {
            title: String(o.title ?? `卡片 ${j + 1}`),
            desc: o.desc ? String(o.desc) : undefined,
            tag: o.tag ? String(o.tag) : undefined,
          }
        }),
        ...slideExtras(),
      }
    case 'kpi':
      return {
        layout,
        title: title(),
        metrics: list(s.metrics, 'metrics', 1).map((it) => {
          const o = it as Record<string, unknown>
          return {
            value: String(o.value ?? '—'),
            label: String(o.label ?? ''),
            note: o.note ? String(o.note) : undefined,
          }
        }),
        ...slideExtras(),
      }
    case 'steps':
      return {
        layout,
        title: title(),
        steps: list(s.steps, 'steps', 1).map((it, j) => {
          const o = it as Record<string, unknown>
          return { title: String(o.title ?? `步骤 ${j + 1}`), desc: o.desc ? String(o.desc) : undefined }
        }),
        ...slideExtras(),
      }
    case 'compare': {
      const side = (v: unknown, name: string) => {
        const o = (v ?? {}) as Record<string, unknown>
        const points = Array.isArray(o.points) ? o.points.map(String) : []
        if (points.length === 0) throw new DeckSpecError(`${at}（compare）：${name}.points 至少 1 项。`)
        return { title: String(o.title ?? ''), points }
      }
      return { layout, title: title(), left: side(s.left, 'left'), right: side(s.right, 'right'), ...slideExtras() }
    }
    case 'timeline':
      return {
        layout,
        title: title(),
        events: list(s.events, 'events', 1).map((it) => {
          const o = it as Record<string, unknown>
          return {
            date: String(o.date ?? ''),
            title: String(o.title ?? ''),
            desc: o.desc ? String(o.desc) : undefined,
          }
        }),
        ...slideExtras(),
      }
    case 'quote':
      return {
        layout,
        quote: str(s.quote, 'quote', true)!,
        author: str(s.author, 'author', false),
        role: str(s.role, 'role', false),
        ...slideExtras(),
      }
    case 'table': {
      const headers = Array.isArray(s.headers) ? s.headers.map(String) : []
      if (headers.length === 0) throw new DeckSpecError(`${at}（table）：headers 至少 1 列。`)
      const rows = Array.isArray(s.rows) ? s.rows.map((r) => (Array.isArray(r) ? r.map(String) : [])) : []
      if (rows.length === 0) throw new DeckSpecError(`${at}（table）：rows 至少 1 行。`)
      return { layout, title: title(), headers, rows, ...slideExtras() }
    }
    case 'ending':
      return { layout, title: str(s.title, 'title', false), subtitle: str(s.subtitle, 'subtitle', false), ...slideExtras() }
    case 'agenda':
      return {
        layout,
        title: title(),
        items: list(s.items, 'items', 1).map((it, j) => {
          const o = it as Record<string, unknown>
          return { title: String(o.title ?? `章节 ${j + 1}`), desc: o.desc ? String(o.desc) : undefined }
        }),
        ...slideExtras(),
      }
    case 'swot': {
      const quad = (v: unknown, name: string) => {
        if (!Array.isArray(v) || v.length === 0) throw new DeckSpecError(`${at}（swot）：${name} 必须是非空数组。`)
        return v.map(String).slice(0, 4)
      }
      return {
        layout,
        title: title(),
        s: quad(s.s, 's'),
        w: quad(s.w, 'w'),
        o: quad(s.o, 'o'),
        t: quad(s.t, 't'),
        ...slideExtras(),
      }
    }
    case 'pricing':
      return {
        layout,
        title: title(),
        plans: list(s.plans, 'plans', 1).map((it, j) => {
          const o = it as Record<string, unknown>
          const features = Array.isArray(o.features) ? o.features.map(String) : []
          if (features.length === 0) throw new DeckSpecError(`${at}（pricing）：plans[${j}].features 至少 1 项。`)
          return {
            name: String(o.name ?? `方案 ${j + 1}`),
            price: String(o.price ?? '—'),
            tag: o.tag ? String(o.tag) : undefined,
            features: features.slice(0, 5),
            highlight: o.highlight === true,
          }
        }),
        ...slideExtras(),
      }
    case 'roadmap':
      return {
        layout,
        title: title(),
        phases: list(s.phases, 'phases', 1).map((it, j) => {
          const o = it as Record<string, unknown>
          return {
            phase: String(o.phase ?? `阶段 ${j + 1}`),
            title: String(o.title ?? ''),
            desc: o.desc ? String(o.desc) : undefined,
          }
        }),
        ...slideExtras(),
      }
    // ---- 元素型版式 ----
    case 'chart': {
      // data 支持二维数组或 officecli 的 `系列:值;系列:值` 串
      const raw = s.data
      let data: (string | number)[][] | string
      if (typeof raw === 'string') {
        if (!raw.trim()) throw new DeckSpecError(`${at}（chart）：data 为空。`)
        data = raw
      } else if (Array.isArray(raw) && raw.length >= 2) {
        data = raw.map((row) => {
          if (!Array.isArray(row)) throw new DeckSpecError(`${at}（chart）：data 的每一行都必须是数组。`)
          return row.map((c) => (typeof c === 'number' ? c : String(c)))
        })
      } else {
        throw new DeckSpecError(
          `${at}（chart）：data 需要二维数组（首行表头、首列分类）或 "系列:值,值;系列:值,值" 串，至少 2 行。`,
        )
      }
      const bt = (v: unknown, field: string): BulletItem[] | undefined =>
        Array.isArray(v)
          ? v.map((it, j) => {
              const o = it as Record<string, unknown>
              return { title: String(o.title ?? `要点 ${j + 1}`), desc: o.desc ? String(o.desc) : undefined }
            })
          : undefined
      return {
        layout,
        title: title(),
        data,
        chartType: str(s.chartType, 'chartType', false),
        insight: str(s.insight, 'insight', false),
        bullets: bt(s.bullets, 'bullets'),
        legend: ['bottom', 'top', 'left', 'right', 'none'].includes(String(s.legend))
          ? (s.legend as 'bottom' | 'top' | 'left' | 'right' | 'none')
          : undefined,
        dataLabels: typeof s.dataLabels === 'boolean' ? s.dataLabels : undefined,
        colors: Array.isArray(s.colors) ? s.colors.map((c) => String(c)) : undefined,
        displayUnits: str(s.displayUnits, 'displayUnits', false),
        source: str(s.source, 'source', false),
        ...slideExtras(),
      }
    }
    case 'image-split': {
      const img = s.image as Record<string, unknown> | undefined
      if (!img || typeof img.src !== 'string' || !img.src.trim()) {
        throw new DeckSpecError(
          `${at}（image-split）：缺少 image.src。图片必须是本地文件路径（officecli 不支持 http URL）。`,
        )
      }
      const pts = Array.isArray(s.points)
        ? s.points.map((it, j) => {
            const o = it as Record<string, unknown>
            return { title: String(o.title ?? `要点 ${j + 1}`), desc: o.desc ? String(o.desc) : undefined }
          })
        : undefined
      return {
        layout,
        title: title(),
        image: { src: img.src, caption: typeof img.caption === 'string' ? img.caption : undefined },
        side: s.side === 'right' ? 'right' : 'left',
        desc: str(s.desc, 'desc', false),
        points: pts,
        ...slideExtras(),
      }
    }
    case 'image-full': {
      const img = s.image as Record<string, unknown> | undefined
      if (!img || typeof img.src !== 'string' || !img.src.trim()) {
        throw new DeckSpecError(`${at}（image-full）：缺少 image.src。`)
      }
      return {
        layout,
        title: str(s.title, 'title', false),
        subtitle: str(s.subtitle, 'subtitle', false),
        image: { src: img.src, caption: typeof img.caption === 'string' ? img.caption : undefined },
        align: s.align === 'right' ? 'right' : 'left',
        overlay: typeof s.overlay === 'number' ? Math.max(0, Math.min(0.7, s.overlay)) : undefined,
        ...slideExtras(),
      }
    }
    case 'diagram': {
      const mermaid = str(s.mermaid, 'mermaid', true)!
      const head = mermaid.trim().split(/[\n;]/)[0]?.trim() ?? ''
      const kind = (head.split(/\s+/)[0] ?? '').toLowerCase()
      // officecli 的 diagram 有两套渲染路径：`render=auto` 优先走无头浏览器里的
      // 真 mermaid.js（支持全部类型），浏览器缺失时回落到内置 native 合成器。
      // native 只认 flowchart/graph 与 sequenceDiagram —— 本插件所处的运行环境
      // 通常没有浏览器，所以按 native 子集做前置拦截，避免生成到一半才报错。
      const NATIVE_OK = new Set(['flowchart', 'graph', 'sequencediagram'])
      const OTHER_TYPES = new Set([
        'gantt',
        'pie',
        'classdiagram',
        'statediagram',
        'erdiagram',
        'journey',
        'mindmap',
        'timeline',
        'gitgraph',
        'quadrantchart',
        'xychart-beta',
        'requirementdiagram',
        'c4context',
      ])
      if (OTHER_TYPES.has(kind)) {
        throw new DeckSpecError(
          `${at}（diagram）：mermaid 类型 "${kind}" 需要无头浏览器渲染，当前环境只支持 ` +
            `flowchart / graph / sequenceDiagram（officecli 的内置合成器子集）。` +
            `请改用 flowchart 表达，或把这张图拆成 steps / timeline 版式。`,
        )
      }
      if (!NATIVE_OK.has(kind)) {
        throw new DeckSpecError(
          `${at}（diagram）：无法识别的 mermaid 首行 "${head}"。` +
            `应以 flowchart / graph / sequenceDiagram 开头，如 "flowchart LR\\n A[开始] --> B[结束]"。`,
        )
      }
      return {
        layout,
        title: title(),
        mermaid,
        caption: str(s.caption, 'caption', false),
        ...slideExtras(),
      }
    }
  }
  throw new DeckSpecError(`${at}：版式 "${layout}" 未实现。`)
}

/** 把 style.meta 编译成 presentation 的 --prop（docProps 元数据）。 */
function metaToProps(meta: DeckMeta | undefined): Record<string, string> {
  if (!meta) return {}
  const out: Record<string, string> = {}
  if (meta.title) out.title = meta.title
  if (meta.author) out.author = meta.author
  if (meta.keywords) out.keywords = meta.keywords
  if (meta.description) out.description = meta.description
  if (meta.category) out.category = meta.category
  return out
}

/**
 * 主题取值的优先级：`deck.theme` → `style.vibe` → 模板默认 → 全局默认。
 *
 * 前两级都走 {@link findTheme} 的「别名 / 关键词 / 主色派生」解析，所以用户说
 * "科技蓝风格"时它能真的生效；识别不了（返回 undefined）才继续往下走，不会
 * 因为一句废话就把整份 PPT 打回商务蓝。
 */
function pickTheme(themeInput: string | undefined, vibe: string | undefined, fallback: string | undefined): Theme {
  return (
    findTheme(themeInput) ??
    findTheme(vibe) ??
    findTheme(fallback) ??
    resolveTheme(fallback) ??
    getTheme(undefined)
  )
}

/**
 * 合并字号阶梯，优先级 模板 → 风格预设 → 本次覆盖。
 *
 * 一个例外：模型显式给了 `scale` 就意味着「整体缩放」，此时必须丢掉模板与预设里
 * 烘焙的绝对 pt —— 否则 `withTypeScale` 会让绝对项压过 scale，用户说「字再大点」
 * 却发现标题纹丝不动。
 */
function mergeTypography(
  template: ReturnType<typeof getTemplate>,
  preset: PptStyle | undefined,
  own: TypographyOverride | undefined,
): TypographyOverride {
  const base = {
    ...(template?.style?.typography ?? {}),
    ...(preset?.typography ?? {}),
  } as TypographyOverride
  if (own && typeof own.scale === 'number') {
    for (const key of ['coverTitle', 'sectionTitle', 'anchor', 'pageTitle', 'cardTitle', 'body', 'quote', 'caption']) {
      delete base[key as keyof TypographyOverride]
    }
  }
  return { ...base, ...(own ?? {}) }
}

/**
 * 一份 DeckSpec 最终会落到的视觉系统（不生成任何命令）。
 *
 * lint（体检）、评审与 compileDeck 共用这一个解析入口 —— 否则「体检看到的配色/
 * 字号」和「实际生成出来的」会是两回事，体检结论就没意义了。
 */
export interface ResolvedVisuals {
  template?: DeckTemplate
  preset?: PptStyle
  /** `style.preset` 给了但解析不出任何风格（回执里要提醒模型别以为生效了）。 */
  presetMissed?: string
  theme: Theme
  typography: TypographyOverride
  pageNumber: boolean | string
  transition?: string
  footerText?: string
  contentDecor?: ContentDecor
}

/** 解析 DeckSpec 的主题 / 字号 / 装饰 / 转场 / 页码（优先级链的唯一实现处）。 */
export function resolveDeckVisuals(spec: DeckSpec): ResolvedVisuals {
  const template = getTemplate(spec.template)
  const style = spec.style ?? {}
  const preset = findStyle(style.preset)
  // 主题：模板自带的 style.colors/fonts 先落地（企业 VI），风格预设再整组覆盖，
  // 最后是本次 style 的显式配色/字体覆盖 —— 越靠后越接近「用户当场说的」。
  let theme = pickTheme(spec.theme, style.vibe, template?.themeId || undefined)
  theme = applyThemeOverrides(
    theme,
    template?.style?.colors as ColorOverrides | undefined,
    template?.style?.fonts as FontOverrides | undefined,
  )
  if (preset) theme = applyStyle(preset, theme, { primary: style.colors?.primary })
  theme = applyThemeOverrides(theme, style.colors, style.fonts)
  // 显式论证句优先于插件自动生成的（三步推导的第三步由使用者拍板）
  if (style.colorRationale) theme.colorRationale = style.colorRationale
  return {
    template,
    preset,
    presetMissed: style.preset && !preset ? style.preset : undefined,
    theme,
    typography: mergeTypography(template, preset, style.typography),
    // 装饰/转场/页码：风格预设优先于模板 —— 预设是更具体的艺术方向，
    // 「黑底剧场」与「政务顶部色条」同时指定时，保留前者才不打架。
    pageNumber: style.pageNumber ?? preset?.pageNumber ?? template?.pageNumber ?? true,
    transition: style.transition ?? preset?.transition ?? template?.transition,
    footerText: style.footer ?? spec.footer,
    contentDecor: preset?.decor ?? template?.contentDecor,
  }
}

/** 编译成 batch 命令序列。 */
export function compileDeck(spec: DeckSpec): CompiledDeck {
  const visuals = resolveDeckVisuals(spec)
  const { theme, typography, template, preset } = visuals
  const style = spec.style ?? {}
  const commands: BatchCommand[] = [
    {
      command: 'set',
      path: '/',
      props: {
        ...themeToProps(theme),
        slideWidth: `${CANVAS_W}pt`,
        slideHeight: `${CANVAS_H}pt`,
        ...metaToProps(style.meta),
      },
    },
  ]
  const layouts: string[] = []
  const total = spec.slides.length
  const pageNumber = visuals.pageNumber
  const transition = visuals.transition
  const footerText = visuals.footerText
  const decor = visuals.contentDecor

  // 用闭包而不是内联 IIFE：可读性之外也让 withTypeScale 的作用域一眼可见。
  const renderAll = (): void => {
    spec.slides.forEach((slide, i) => {
      const pageNo = i + 1
      const res = renderSlide(slide, theme, pageNo, { total, footerText, pageNumber, template, contentDecor: decor })
      layouts.push(slide.layout)
      commands.push({ command: 'add', path: '/', type: 'slide', props: { layout: 'blank' } })

      // 元素层（图表/图片/表格/图示/连接线）。officecli 的 z-order 由插入顺序决定，
      // 所以 elementsBehind 的版式（全幅底图）要先落盘，其余等 shapes 铺完再上。
      const elementTheme = {
        text: theme.text,
        muted: theme.muted,
        bg: theme.bg,
        fontBody: theme.fontBody,
      }
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

      // 演讲者备注：PPT 的「备注」栏，放映时演讲者可见
      if (slide.notes) {
        commands.push({
          command: 'add',
          path: `/slide[${pageNo}]`,
          type: 'notes',
          props: { text: slide.notes },
        })
      }

      // 入场动画：只挂在本页的视觉锚点上，不逐条挂列表
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

      // slide 级 --prop：背景（hero 渐变 / slide.background / style.background）、
      // 转场（slide.transition / 模板默认）、隐藏
      const sp: Record<string, string> = {}
      if (res.background) sp.background = res.background
      else if (slide.background) sp.background = slide.background
      else if (style.background) sp.background = style.background
      if (slide.transition) sp.transition = slide.transition
      else if (transition) sp.transition = transition
      if (slide.hidden) sp.hidden = 'true'
      if (Object.keys(sp).length > 0) {
        commands.push({ command: 'set', path: `/slide[${pageNo}]`, props: sp })
      }
    })
  }

  // 字号阶梯只在这段渲染期间替换（withTypeScale 内部同步 try/finally 还原）：
  // textHeight / fitSize 会按缩放后的字号重新算高度，所以放大字号不会就地溢出。
  withTypeScale(typography, renderAll)

  return {
    commands,
    pageCount: total,
    theme,
    layouts,
    template: template?.id,
    preset: preset?.id,
    presetMissed: visuals.presetMissed,
  }
}

/**
 * 选本页的「视觉锚点」作为动画目标。
 *
 * 优先级：图表（officecli 允许 chart 挂动画） > 页面大标题 > 首个巨型数字。
 * **配图与图示不能作动画目标** —— officecli 只接受顶层 shape/chart；
 * picture 会被直接拒绝，diagram 落成一个 group 且组内形状不可单独动画。
 * 找不到就返回 undefined（宁可不加动画，也不要给装饰形状挂动画）。
 */
export function pickAnimateTarget(
  res: LayoutResult,
  pageNo: number,
): { parent: 'shape' | 'chart'; name: string } | undefined {
  const p = `s${pageNo}`
  const chartEl = res.elements?.find((el) => el.kind === 'chart')
  if (chartEl?.name) return { parent: 'chart', name: chartEl.name }
  const title = res.shapes.find((s) => s.name === `${p}-title`)
  if (title) return { parent: 'shape', name: title.name }
  const kpi = res.shapes.find((s) => /-k\d+-v$/.test(s.name))
  if (kpi) return { parent: 'shape', name: kpi.name }
  const firstElement = res.elements?.find((el) => isPageLevel(el.kind) && 'name' in el && el.name)
  if (firstElement && 'name' in firstElement && firstElement.name) {
    return { parent: 'shape', name: firstElement.name }
  }
  return undefined
}

/** DeckSpec 速查里的模板候选串（内置前 6 个；完整清单在 design guide 里按次查）。 */
const TEMPLATE_HINT = 'consulting/product-launch/academic-defense/minimal/gov-report/annual-report 等'

/** 给模型看的 DeckSpec 速查（塞进工具 description）。 */
export const DECK_SPEC_HELP = `DeckSpec 结构：
{
  "template": "模板id，可选（${TEMPLATE_HINT}）—— 决定场景外衣",
  "theme": "主题id/中文说法/主色，可选：business-blue / 科技蓝 / #0F5EA6 都能识别，默认随模板",
           // 只决定颜色；要连字体/字号/装饰一起定，用 style.preset
  "footer": "页脚左文字，可选",
  "style": {                    // 整份样式协议，可选
    "preset": "视觉流派 id 或中文说法（见 styles 节），可选",
                                // 如 neo-swiss / 大字报风格 / bento / 断言-证据 / 黑底发布会
                                // 一次性落地配色+字体+字号策略+装饰+转场+页码；与 template 正交
    "meta": { "title": "...", "author": "...", "keywords": "...", "description": "...", "category": "..." },
    "transition": "fade",       // 默认转场：fade/push/wipe/morph 等
    "background": "#F5F5F5",    // 默认页背景（色值或渐变 C1-C2-角度）
    "pageNumber": "{n} / {total}",  // true 纯数字 / 字符串模板 / false 隐藏
    "footer": "页脚文字（优先级高于顶层 footer）",

    "vibe": "科技蓝风格",        // 自然语言风格：只映射主题（颜色），不影响流派
    "colorRationale": "为什么是这组色（一句话）",  // 色彩推导第三步，防 slop 的自检门
    "colors": {                 // 色槽覆盖，优先级最高（值支持 #RGB / #RRGGBB）
      "primary": "#0F5EA6", "secondary": "...", "accent": "...",
      "bg": "#FFFFFF", "text": "#1A1A1A", "muted": "#6B7280"
                                // 只填 primary 就够：其余按 OKLCH 同源派生；配 preset 时会做色相迁移
    },
    "fonts": {                  // 字体覆盖（Windows 必须装过该字体，否则 PPT 会回退）
      "title": "微软雅黑", "body": "等线",
      "titleLatin": "Segoe UI", "bodyLatin": "Segoe UI", "titleEa": "微软雅黑", "bodyEa": "等线"
    },
    "typography": {             // 字号阶梯：scale 为整体倍数（0.6–1.6），其余为绝对 pt
      "scale": 1.1,
      "pageTitle": 32, "body": 18, "cardTitle": 20, "coverTitle": 60
    }
  },
  "slides": [ ... ]   // 1-40 页
}

slides[i].layout 取值与必填字段：
  ── 基础版式 ──
  cover    { title, subtitle?, eyebrow?, meta? }
  section  { title, number?, subtitle? }
  bullets  { title, items:[{title, desc?}], columns? }   1-6 条；columns=2 两栏紧凑模式 1-8 条（书稿/长文推荐）
  cards    { title, cards:[{title, desc?, tag?}], columns? } 1-6 张，columns 缺省自动（≤3 用 n 列，4 用 2×2，更多 3 列）
  kpi      { title, metrics:[{value, label, note?}] }      1-4 个巨型数字
  steps    { title, steps:[{title, desc?}] }               1-5 步
  compare  { title, left:{title, points:[]}, right:{...} } 每边 1-6 点
  timeline { title, events:[{date, title, desc?}] }        1-5 个节点
  quote    { quote, author?, role? }
  table    { title, headers:[], rows:[[],[]] }             原生表格
  agenda   { title, items:[{title, desc?}] }               1-6 章节目录
  swot     { title, s:[], w:[], o:[], t:[] }               每象限 1-4 条
  pricing  { title, plans:[{name, price, tag?, features:[], highlight?}] } 1-4 个方案
  roadmap  { title, phases:[{phase, title, desc?}] }       1-5 个阶段
  ending   { title?, subtitle? }                          默认 "谢谢"

  ── 元素型版式（非对称，用于数据页与视觉页）──
  chart        { title, data, chartType?, insight, bullets?, legend?, dataLabels?, colors?, displayUnits?, source? }
               data 是二维数组（首行表头、首列分类），如 [["季度","2025","2026"],["Q1",120,145],["Q2",156,178]]
               chartType 见 design guide 的 elements 节；insight 必填（数据的判断，不能只摆数字）
  image-split  { title, image:{src, caption?}, side?, desc?, points? }   一栏大图 + 一栏文字
  image-full   { title?, subtitle?, image:{src}, align?, overlay? }      全幅底图 + 骑线文字（封面/章节高潮）
  diagram      { title, mermaid, caption? }                              mermaid 源码 → 原生图形（flowchart/sequenceDiagram）

每页可额外带：
  transition  覆盖默认转场；background  覆盖默认页背景；hidden  隐藏本页
  notes       演讲者备注（放映时演讲者可见）——汇报稿建议每页都写
  animate     本页入场动画：true 用默认 fade，也可给 fade/fly/zoom/wipe/bounce/... 
              只挂在视觉锚点上（图表/标题/巨型数字），全篇统一一种效果

推荐节奏：非对称版式（chart / image-split / image-full）应占全篇 ≥30%，cards 全篇最多 2 次，
相邻页不重复版式；数据页必须配 insight 判断；详见 design guide 的 story 节（叙事与密度）。

生成前先过 form 推导五问（design guide 的 form 节），再决定用哪套视觉流派（styles 节）。
拿不准选哪套 → 先调 office_deck_directions 出三个差异化方向的真实初稿让用户挑。
生成后想质检 → office_deck_review。`
