import type { ShapeOp } from './shape.js'
import type { Theme } from './theme.js'
import { tint } from './grid.js'
import type { LayoutId } from './layouts.js'
import { templateRegistry } from './custom-templates.js'

/** 用户模板注册表（转出，供设计指南取自定义模板与解析错误）。 */
export { templateRegistry }

/**
 * 模板库：把「专业感」沉淀为可复用的模板语义，而不是每次让模型从主题 + 版式
 * 自由拼装。一个模板 = 主题基调 + 内容页装饰 + 页脚/页码格式 + 默认转场（+
 * 可选的样式微调）。
 *
 * 设计原则：模板只管**视觉外衣**（色带、装饰、页码、转场、字号缩放），版式模板
 * （layouts.ts）只管**内容排版**。两者正交组合 —— 换模板不动版式，换版式不动模板。
 *
 * 模板有两级来源：
 *   - 内置：写死在 {@link BUILTIN_TEMPLATES}，覆盖常见汇报场景；
 *   - 自定义：用户/企业放在 `~/.dsh/officecli/templates.json` 或项目
 *     `.dsh/officecli/templates.json`，由 custom-templates.ts 装载后并入检索。
 */

export interface ContentDecor {
  /** 内容页左侧竖向色轨。 */
  rail?: boolean
  /** 内容页顶部细条。 */
  topbar?: boolean
  /** 内容页右上角装饰圆。 */
  corner?: boolean
  /** 内容页左上角页码徽章（实心圆 + 页码数字）。 */
  badge?: boolean
  /** 页脚上方的分隔细线。 */
  footerRule?: boolean
}

/**
 * 模板自带的样式微调：在主题之上再调一层。
 *
 * 与 `DeckSpec.style` 的差别是「谁能改」——模板样式由模板作者写死（企业 VI
 * 规范就落在这里），DeckSpec.style 是每次生成时模型/用户临时加的修正，后者优先。
 */
export interface TemplateStyle {
  /** 色槽覆盖，键为 primary/secondary/accent/bg/text/muted 等。 */
  colors?: Record<string, string>
  /** 字体覆盖：title/body 同时作用于 latin 与 eastAsia，另有细分槽。 */
  fonts?: Record<string, string>
  /** 字号阶梯：可为 `scale` 整体倍数，或 coverTitle/pageTitle/body… 绝对值。 */
  typography?: Record<string, number>
}

export interface DeckTemplate {
  id: string
  name: string
  description: string
  /** 模板默认主题（deck.theme 可覆盖）。空字符串表示「不指定，交给上层回落」。 */
  themeId: string
  /** 默认转场（slide 级可覆盖）。 */
  transition?: string
  /** 页码格式：true 纯数字、'{n} / {total}' 带总页数、false 隐藏。缺省 '{n}'。 */
  pageNumber?: boolean | string
  /** 内容页装饰。 */
  contentDecor?: ContentDecor
  /** 模板推荐版式（不强制，仅写入设计指南供模型参考）。 */
  layouts?: LayoutId[]
  /** 继承来源模板 id（仅用户模板使用，字段做并集覆盖）。 */
  extends?: string
  /** 来源文件路径（仅用户模板有）。 */
  source?: string
  /** 是否为外部加载的用户模板。 */
  custom?: boolean
  /** 模板自带的样式微调。 */
  style?: TemplateStyle
}

/** 内置模板。 */
export const BUILTIN_TEMPLATES: readonly DeckTemplate[] = [
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
  {
    id: 'tech-keynote',
    name: '科技青主题演讲',
    description: '深色底 + 右上装饰 + 页脚细线，适合 AI/芯片/大数据主题演讲、技术布道',
    themeId: 'tech-cyan',
    transition: 'push',
    pageNumber: true,
    contentDecor: { corner: true, footerRule: true },
    layouts: ['cover', 'section', 'kpi', 'cards', 'steps', 'timeline', 'roadmap', 'quote', 'ending'],
  },
  {
    id: 'data-report',
    name: '数据复盘',
    description: '商务蓝 + 顶部细条 + 页脚细线，适合季度复盘、经营分析、数据周报',
    themeId: 'business-blue',
    transition: 'fade',
    pageNumber: '{n} / {total}',
    contentDecor: { topbar: true, footerRule: true },
    layouts: ['cover', 'agenda', 'kpi', 'table', 'bullets', 'compare', 'swot', 'roadmap', 'ending'],
  },
  {
    id: 'warm-consumer',
    name: '暖橙营销',
    description: '暖橙 + 顶部色条 + 序号徽章，适合消费品牌、市场活动、渠道策略',
    themeId: 'warm-orange',
    transition: 'fade',
    pageNumber: '{n} / {total}',
    contentDecor: { topbar: true, badge: true },
    layouts: ['cover', 'section', 'kpi', 'cards', 'pricing', 'compare', 'quote', 'ending'],
  },
  {
    id: 'training-course',
    name: '教学课件',
    description: '暖橙 + 页码徽章 + 页脚细线，适合培训课程、内部教学、知识分享',
    themeId: 'warm-orange',
    transition: 'wipe',
    pageNumber: '{n} / {total}',
    contentDecor: { badge: true, footerRule: true },
    layouts: ['cover', 'agenda', 'bullets', 'steps', 'cards', 'table', 'quote', 'ending'],
  },
  {
    id: 'esg-green',
    name: '自然绿 ESG',
    description: '自然绿 + 左色轨 + 页脚细线，适合 ESG 报告、农业、医疗健康',
    themeId: 'nature-green',
    transition: 'fade',
    pageNumber: '{n} / {total}',
    contentDecor: { rail: true, footerRule: true },
    layouts: ['cover', 'section', 'kpi', 'cards', 'timeline', 'roadmap', 'table', 'ending'],
  },
  {
    id: 'startup-pitch',
    name: '融资路演',
    description: '极简灰 + 左色轨、无页码（投屏不显页码），适合 BP、种子/天使轮融资',
    themeId: 'minimal-gray',
    transition: 'push',
    pageNumber: false,
    contentDecor: { rail: true },
    layouts: ['cover', 'kpi', 'compare', 'cards', 'roadmap', 'timeline', 'pricing', 'quote', 'ending'],
  },
]

/** id 规范化：小写 + 非字母数字转 `-`（用户手写 id 时容错）。 */
export function slugifyId(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
}

/** 重新扫描用户模板目录。cwd 为会话工作区，缺省只扫全局路径。 */
export function refreshTemplates(cwd?: string): { count: number; errors: string[]; sources: string[] } {
  return templateRegistry.refresh(cwd)
}

/**
 * 内置 + 用户模板的全集（用户模板在后，同名 id 覆盖内置）。
 *
 * 注意 `extends` 的解析也在这里完成：用户模板可以 `{"id":"my-vi","extends":"consulting"}`
 * 只改两个字段就得到一套新模板。
 */
export function allTemplates(): DeckTemplate[] {
  const custom = templateRegistry.list()
  const byId = new Map<string, DeckTemplate>(BUILTIN_TEMPLATES.map((t) => [t.id, t]))
  for (const t of custom) byId.set(t.id, t)
  const merged = new Map<string, DeckTemplate>()
  for (const t of byId.values()) {
    merged.set(t.id, t.extends ? mergeDeer(t) : t)
  }
  return [...merged.values()]
}

function mergeDeer(t: DeckTemplate): DeckTemplate {
  const chain: DeckTemplate[] = []
  const seen = new Set<string>()
  let cur: DeckTemplate | undefined = t
  let hops = 0
  while (cur && hops < 8) {
    chain.push(cur)
    seen.add(cur.id)
    if (!cur.extends) break
    const parent = BUILTIN_TEMPLATES.find((b) => b.id === cur!.extends) ?? templateRegistry.list().find((c) => c.id === cur!.extends)
    if (!parent || seen.has(parent.id)) break
    cur = parent
    hops++
  }
  // 从最顶层祖先往下覆盖：注意 **id 永远取子模板的**，否则 corp-vi 会变成 consulting
  const out: DeckTemplate = { ...chain[chain.length - 1]! }
  for (let i = chain.length - 2; i >= 0; i--) {
    const src = chain[i]!
    out.id = src.id
    if (src.themeId) out.themeId = src.themeId
    if (src.transition !== undefined) out.transition = src.transition
    if (src.pageNumber !== undefined) out.pageNumber = src.pageNumber
    if (src.contentDecor) out.contentDecor = { ...out.contentDecor, ...src.contentDecor }
    if (src.layouts) out.layouts = src.layouts
    if (src.style) out.style = { ...out.style, ...src.style }
    out.name = src.name
    out.description = src.description
    out.source = src.source ?? out.source
    out.custom = src.custom ?? out.custom
    delete out.extends
  }
  return out
}

/** 按 id 取模板（含用户模板），未命中返回 undefined（调用方自行决定回退）。 */
export function getTemplate(id: string | undefined): DeckTemplate | undefined {
  if (!id) return undefined
  return allTemplates().find((t) => t.id === id)
}

/** 模板摘要列表（内置在前，用户模板在后并标注来源）。 */
export function listTemplates(): { id: string; name: string; description: string; custom?: boolean }[] {
  return allTemplates().map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    ...(t.custom ? { custom: true } : {}),
  }))
}

/** 内置模板 id 集合，用于 DeckSpec 校验时给出友好候选。 */
export function templateIds(): string[] {
  return allTemplates().map((t) => t.id)
}

/**
 * 内容页装饰：模板给内容页加「外衣」。返回的形状必须在 bg 之后、正文之前
 * 加入（renderSlide 里 splice 到 shapes[1] 位置）。
 *
 * 色值用主题派生（rail/topbar 用主色；corner 用主色淡染），保证换主题不违和。
 */
export function contentDecorShapes(
  p: string,
  decor: ContentDecor | undefined,
  theme: Theme,
  opts: { pageNo?: number } = {},
): ShapeOp[] {
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
  if (decor.badge) {
    // 左上角实心圆 + 页码：给"卡片式"内容页加一个视觉锚点
    out.push({
      name: `${p}-decor-badge`,
      x: 24,
      y: 22,
      w: 34,
      h: 34,
      geometry: 'ellipse',
      fill: theme.primary,
      line: 'none',
      text: String(opts.pageNo ?? ''),
      size: 15,
      bold: true,
      color: theme.dark ? theme.text : 'FFFFFF',
      fontLatin: theme.fontTitle.latin,
      fontEa: theme.fontTitle.ea,
      align: 'center',
      valign: 'middle',
      margin: 0,
    })
  }
  if (decor.footerRule) {
    const fill = theme.dark ? tint(theme.text, -0.72) : tint(theme.text, 0.82)
    out.push({ name: `${p}-decor-footrule`, x: 32, y: 490, w: 896, h: 1, fill, line: 'none' })
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
