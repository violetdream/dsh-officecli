import { CANVAS_H, CANVAS_W } from './grid.js'
import { LAYOUT_IDS, renderSlide, type SlideSpec } from './layouts.js'
import { toProps } from './shape.js'
import { getTheme, themeToProps, type Theme } from './theme.js'
import { getTemplate, TEMPLATES } from './templates.js'

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
 * 元数据、默认转场、默认背景、页码格式与页脚。
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
}

/** 模型填写的整份 PPT 描述。 */
export interface DeckSpec {
  /** 模板 id（见 office_design_guide 的 templates 节）。模板决定主题基调与装饰。 */
  template?: string
  /** 主题 id，见 `office_design_guide` 返回的列表。缺省用模板主题或商务蓝。 */
  theme?: string
  /** 页脚左侧文字，缺省为空。 */
  footer?: string
  /** 整份样式协议（元数据/转场/背景/页码）。 */
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
  if (template !== undefined && !TEMPLATES.some((t) => t.id === template)) {
    throw new DeckSpecError(`未知模板 "${template}"。可选：${TEMPLATES.map((t) => t.id).join(', ')}`)
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
  // 模板已含默认值（transition/pageNumber）时，style 留空即可
  if (Object.keys(out).length === 0 && template === undefined) return undefined
  return out
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

  // 每页通用的可选样式字段（transition/background/hidden），任意版式均可带
  const slideExtras = (): { transition?: string; background?: string; hidden?: boolean } => {
    const out: { transition?: string; background?: string; hidden?: boolean } = {}
    if (typeof s.transition === 'string') out.transition = s.transition
    if (typeof s.background === 'string') out.background = s.background
    if (typeof s.hidden === 'boolean') out.hidden = s.hidden
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

/** 编译成 batch 命令序列。 */
export function compileDeck(spec: DeckSpec): CompiledDeck {
  const template = getTemplate(spec.template)
  const theme = getTheme(spec.theme ?? template?.themeId)
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
  const pageNumber = style.pageNumber ?? template?.pageNumber ?? true
  const transition = style.transition ?? template?.transition
  const footerText = style.footer ?? spec.footer

  spec.slides.forEach((slide, i) => {
    const pageNo = i + 1
    const res = renderSlide(slide, theme, pageNo, { total, footerText, pageNumber, template })
    layouts.push(slide.layout)
    commands.push({ command: 'add', path: '/', type: 'slide', props: { layout: 'blank' } })
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

  return { commands, pageCount: total, theme, layouts, template: template?.id }
}

/** 给模型看的 DeckSpec 速查（塞进工具 description）。 */
export const DECK_SPEC_HELP = `DeckSpec 结构：
{
  "template": "模板id，可选（consulting/product-launch/academic-defense/minimal/gov-report/annual-report）",
  "theme": "主题id，可选，默认随模板或 business-blue",
  "footer": "页脚左文字，可选",
  "style": {                    // 整份样式协议，可选
    "meta": { "title": "...", "author": "...", "keywords": "...", "description": "...", "category": "..." },
    "transition": "fade",       // 默认转场：fade/push/wipe/morph 等
    "background": "#F5F5F5",    // 默认页背景（色值或渐变 C1-C2-角度）
    "pageNumber": "{n} / {total}",  // true 纯数字 / 字符串模板 / false 隐藏
    "footer": "页脚文字（优先级高于顶层 footer）"
  },
  "slides": [ ... ]   // 1-40 页
}

slides[i].layout 取值与必填字段：
  cover    { title, subtitle?, eyebrow?, meta? }
  section  { title, number?, subtitle? }
  bullets  { title, items:[{title, desc?}], columns? }   1-6 条；columns=2 两栏紧凑模式 1-8 条（书稿/长文推荐）
  cards    { title, cards:[{title, desc?, tag?}], columns? } 1-6 张，columns 缺省自动（≤3 用 n 列，4 用 2×2，更多 3 列）
  kpi      { title, metrics:[{value, label, note?}] }      1-4 个巨型数字
  steps    { title, steps:[{title, desc?}] }               1-5 步
  compare  { title, left:{title, points:[]}, right:{...} } 每边 1-6 点
  timeline { title, events:[{date, title, desc?}] }        1-5 个节点
  quote    { quote, author?, role? }
  table    { title, headers:[], rows:[[],[]] }
  agenda   { title, items:[{title, desc?}] }               1-6 章节目录
  swot     { title, s:[], w:[], o:[], t:[] }               每象限 1-4 条
  pricing  { title, plans:[{name, price, tag?, features:[], highlight?}] } 1-4 个方案
  roadmap  { title, phases:[{phase, title, desc?}] }       1-5 个阶段
  ending   { title?, subtitle? }                          默认 "谢谢"

每页可额外带 transition/background/hidden（覆盖 style/模板默认）。`
