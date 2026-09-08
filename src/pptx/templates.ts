import type { ShapeOp } from './shape.js'
import type { Theme } from './theme.js'
import { tint } from './grid.js'
import type { LayoutId } from './layouts.js'

/**
 * 模板库：把「专业感」沉淀为可复用的模板语义，而不是每次让模型从主题 + 版式
 * 自由拼装。一个模板 = 主题基调 + 内容页装饰 + 页脚/页码格式 + 默认转场。
 *
 * 设计原则：模板只管**视觉外衣**（色带、装饰、页码、转场），版式模板（layouts.ts）
 * 只管**内容排版**。两者正交组合 —— 换模板不动版式，换版式不动模板。
 */

export interface ContentDecor {
  /** 内容页左侧竖向色轨。 */
  rail?: boolean
  /** 内容页顶部细条。 */
  topbar?: boolean
  /** 内容页右上角装饰圆。 */
  corner?: boolean
}

export interface DeckTemplate {
  id: string
  name: string
  description: string
  /** 模板默认主题（deck.theme 可覆盖）。 */
  themeId: string
  /** 默认转场（slide 级可覆盖）。 */
  transition?: string
  /** 页码格式：true 纯数字、'{n} / {total}' 带总页数、false 隐藏。缺省 '{n}'。 */
  pageNumber?: boolean | string
  /** 内容页装饰。 */
  contentDecor?: ContentDecor
  /** 模板推荐版式（不强制，仅写入设计指南供模型参考）。 */
  layouts?: LayoutId[]
}

export const TEMPLATES: readonly DeckTemplate[] = [
  {
    id: 'consulting',
    name: '咨询简报',
    description: '左色轨 + "n / total" 页码，适合商业咨询、行业研究、战略汇报',
    themeId: 'business-blue',
    transition: 'fade',
    pageNumber: '{n} / {total}',
    contentDecor: { rail: true },
    layouts: ['cover', 'section', 'agenda', 'bullets', 'cards', 'kpi', 'compare', 'pricing', 'swot', 'timeline', 'roadmap', 'table', 'ending'],
  },
  {
    id: 'product-launch',
    name: '产品发布',
    description: '深色科技风 + 右上角装饰，适合新品发布、AI 产品、开发者大会',
    themeId: 'tech-cyan',
    transition: 'push',
    pageNumber: true,
    contentDecor: { corner: true },
    layouts: ['cover', 'section', 'agenda', 'kpi', 'cards', 'steps', 'compare', 'pricing', 'roadmap', 'quote', 'ending'],
  },
  {
    id: 'academic-defense',
    name: '学术答辩',
    description: '学术深红、零装饰干扰、"n / total" 页码，适合论文答辩、课题汇报',
    themeId: 'academic-crimson',
    transition: 'fade',
    pageNumber: '{n} / {total}',
    contentDecor: {},
    layouts: ['cover', 'section', 'bullets', 'cards', 'compare', 'table', 'timeline', 'roadmap', 'quote', 'ending'],
  },
  {
    id: 'minimal',
    name: '极简',
    description: '黑白灰大留白、无页码，适合设计提案、策略思考、内部评审',
    themeId: 'minimal-gray',
    transition: 'fade',
    pageNumber: false,
    contentDecor: {},
    layouts: ['cover', 'section', 'bullets', 'cards', 'kpi', 'quote', 'swot', 'roadmap', 'table', 'ending'],
  },
  {
    id: 'gov-report',
    name: '政务报告',
    description: '政务红 + 顶部细条，适合党政、政策解读、公告通报',
    themeId: 'gov-red',
    transition: 'wipe',
    pageNumber: '{n} / {total}',
    contentDecor: { topbar: true },
    layouts: ['cover', 'section', 'bullets', 'cards', 'table', 'timeline', 'roadmap', 'quote', 'ending'],
  },
  {
    id: 'annual-report',
    name: '年度报告',
    description: '黑金奢华 + 左色轨，适合年报、品牌活动、高端发布',
    themeId: 'luxury-black',
    transition: 'fade',
    pageNumber: '{n} / {total}',
    contentDecor: { rail: true },
    layouts: ['cover', 'section', 'agenda', 'kpi', 'cards', 'timeline', 'roadmap', 'quote', 'table', 'ending'],
  },
]

/** 按 id 取模板，未命中返回 undefined（调用方自行决定回退）。 */
export function getTemplate(id: string | undefined): DeckTemplate | undefined {
  if (!id) return undefined
  return TEMPLATES.find((t) => t.id === id)
}

/** 模板 id 列表（给工具描述与设计指南用）。 */
export function listTemplates(): { id: string; name: string; description: string }[] {
  return TEMPLATES.map((t) => ({ id: t.id, name: t.name, description: t.description }))
}

/**
 * 内容页装饰：模板给内容页加「外衣」。返回的形状必须在 bg 之后、正文之前
 * 加入（renderSlide 里 splice 到 shapes[1] 位置）。
 *
 * 色值用主题派生（rail/topbar 用主色；corner 用主色淡染），保证换主题不违和。
 */
export function contentDecorShapes(p: string, decor: ContentDecor | undefined, theme: Theme): ShapeOp[] {
  if (!decor) return []
  const out: ShapeOp[] = []
  if (decor.rail) {
    out.push({ name: `${p}-decor-rail`, x: 0, y: 0, w: 8, h: 540, fill: theme.primary, line: 'none' })
  }
  if (decor.topbar) {
    out.push({ name: `${p}-decor-topbar`, x: 0, y: 0, w: 960, h: 5, fill: theme.primary, line: 'none' })
  }
  if (decor.corner) {
    const fill = theme.dark ? tint(theme.primary, -0.62) : tint(theme.primary, 0.9)
    out.push({
      name: `${p}-decor-corner`,
      x: 876,
      y: -64,
      w: 176,
      h: 176,
      geometry: 'ellipse',
      fill,
      line: 'none',
    })
    out.push({
      name: `${p}-decor-corner-in`,
      x: 912,
      y: -28,
      w: 84,
      h: 84,
      geometry: 'ellipse',
      fill: theme.accent,
      line: 'none',
      opacity: 0.35,
    })
  }
  return out
}

/** 页脚页码格式：true/缺省 → 纯数字；字符串模板替换 {n}/{total}；false → 不显示。 */
export function formatPageNumber(
  fmt: boolean | string | undefined,
  pageNo: number,
  total: number | undefined,
): string | null {
  if (fmt === false) return null
  if (typeof fmt === 'string') {
    return fmt.replace(/\{n\}/g, String(pageNo)).replace(/\{total\}/g, String(total ?? pageNo))
  }
  return String(pageNo)
}
