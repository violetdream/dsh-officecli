import { CANVAS_H, CANVAS_W } from './grid.js'
import { LAYOUT_IDS, renderSlide, type SlideSpec } from './layouts.js'
import { toProps } from './shape.js'
import { getTheme, themeToProps, type Theme } from './theme.js'

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

/** 模型填写的整份 PPT 描述。 */
export interface DeckSpec {
  /** 主题 id，见 `office_design_guide` 返回的列表。缺省用商务蓝。 */
  theme?: string
  /** 页脚左侧文字，缺省为空。 */
  footer?: string
  slides: SlideSpec[]
}

/** 编译结果。 */
export interface CompiledDeck {
  commands: BatchCommand[]
  pageCount: number
  theme: Theme
  /** 每页的版式，用于回执。 */
  layouts: string[]
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
    throw new DeckSpecError('deck 必须是一个对象，形如 {"theme":"business-blue","slides":[...]}')
  }
  const raw = input as Record<string, unknown>
  const slides = raw.slides
  if (!Array.isArray(slides) || slides.length === 0) {
    throw new DeckSpecError('slides 必须是非空数组。')
  }
  if (slides.length > MAX_SLIDES) {
    throw new DeckSpecError(`页数过多：${slides.length} 页，上限 ${MAX_SLIDES} 页。请拆分或精简。`)
  }

  const parsed = slides.map((item, i) => parseSlide(item, i))
  return {
    theme: typeof raw.theme === 'string' ? raw.theme : undefined,
    footer: typeof raw.footer === 'string' ? raw.footer : undefined,
    slides: parsed,
  }
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

  switch (layout) {
    case 'cover':
      return {
        layout,
        title: title(),
        eyebrow: str(s.eyebrow, 'eyebrow', false),
        subtitle: str(s.subtitle, 'subtitle', false),
        meta: str(s.meta, 'meta', false),
      }
    case 'section':
      return {
        layout,
        title: title(),
        number: str(s.number, 'number', false),
        subtitle: str(s.subtitle, 'subtitle', false),
      }
    case 'bullets':
      return {
        layout,
        title: title(),
        items: list(s.items, 'items', 1).map((it, j) => {
          const o = it as Record<string, unknown>
          return { title: String(o.title ?? `要点 ${j + 1}`), desc: o.desc ? String(o.desc) : undefined }
        }),
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
      }
    case 'steps':
      return {
        layout,
        title: title(),
        steps: list(s.steps, 'steps', 1).map((it, j) => {
          const o = it as Record<string, unknown>
          return { title: String(o.title ?? `步骤 ${j + 1}`), desc: o.desc ? String(o.desc) : undefined }
        }),
      }
    case 'compare': {
      const side = (v: unknown, name: string) => {
        const o = (v ?? {}) as Record<string, unknown>
        const points = Array.isArray(o.points) ? o.points.map(String) : []
        if (points.length === 0) throw new DeckSpecError(`${at}（compare）：${name}.points 至少 1 项。`)
        return { title: String(o.title ?? ''), points }
      }
      return { layout, title: title(), left: side(s.left, 'left'), right: side(s.right, 'right') }
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
      }
    case 'quote':
      return {
        layout,
        quote: str(s.quote, 'quote', true)!,
        author: str(s.author, 'author', false),
        role: str(s.role, 'role', false),
      }
    case 'table': {
      const headers = Array.isArray(s.headers) ? s.headers.map(String) : []
      if (headers.length === 0) throw new DeckSpecError(`${at}（table）：headers 至少 1 列。`)
      const rows = Array.isArray(s.rows) ? s.rows.map((r) => (Array.isArray(r) ? r.map(String) : [])) : []
      if (rows.length === 0) throw new DeckSpecError(`${at}（table）：rows 至少 1 行。`)
      return { layout, title: title(), headers, rows }
    }
    case 'ending':
      return { layout, title: str(s.title, 'title', false), subtitle: str(s.subtitle, 'subtitle', false) }
  }
  throw new DeckSpecError(`${at}：版式 "${layout}" 未实现。`)
}

/** 编译成 batch 命令序列。 */
export function compileDeck(spec: DeckSpec): CompiledDeck {
  const theme = getTheme(spec.theme)
  const commands: BatchCommand[] = [
    { command: 'set', path: '/', props: { ...themeToProps(theme), slideWidth: `${CANVAS_W}pt`, slideHeight: `${CANVAS_H}pt` } },
  ]
  const layouts: string[] = []

  spec.slides.forEach((slide, i) => {
    const pageNo = i + 1
    const res = renderSlide(slide, theme, pageNo)
    layouts.push(slide.layout)
    commands.push({ command: 'add', path: '/', type: 'slide', props: { layout: 'blank' } })
    for (const shape of res.shapes) {
      // 页脚文字用 deck 级 footer 覆盖
      if (spec.footer && (shape.name.endsWith('-foot-l') || shape.name.endsWith('-foot-r'))) {
        if (shape.name.endsWith('-foot-l')) shape.text = spec.footer
      }
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
  })

  return { commands, pageCount: spec.slides.length, theme, layouts }
}

/** 给模型看的 DeckSpec 速查（塞进工具 description）。 */
export const DECK_SPEC_HELP = `DeckSpec 结构：
{
  "theme": "主题id，可选，默认 business-blue",
  "footer": "页脚左文字，可选",
  "slides": [ ... ]   // 1-40 页
}

slides[i].layout 取值与必填字段：
  cover    { title, subtitle?, eyebrow?, meta? }
  section  { title, number?, subtitle? }
  bullets  { title, items:[{title, desc?}] }              1-6 条
  cards    { title, cards:[{title, desc?, tag?}], columns? } 1-6 张，columns 缺省自动（≤3 用 n 列，4 用 2×2，更多 3 列）
  kpi      { title, metrics:[{value, label, note?}] }      1-4 个巨型数字
  steps    { title, steps:[{title, desc?}] }               1-5 步
  compare  { title, left:{title, points:[]}, right:{...} } 每边 1-6 点
  timeline { title, events:[{date, title, desc?}] }        1-5 个节点
  quote    { quote, author?, role? }
  table    { title, headers:[], rows:[[],[]] }
  ending   { title?, subtitle? }                          默认 "谢谢"`
