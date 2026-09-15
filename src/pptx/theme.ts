import { tint } from './grid.js'

/**
 * 主题令牌。
 *
 * 结构对齐 WorkBuddy 的 `DESIGN.md` 设计契约（canvas / colors / typography /
 * spacing），但落成 TS 常量，运行时零查表开销。所有颜色为 **6 位 hex、不带 `#`**，
 * 与 officecli 的 `fill` / `color` / `line` 属性一致。
 *
 * 字体一律取 Windows 必装项（已在本机 Fonts 目录核实存在），避免出现
 * 思源黑体 / 方正小标宋这类常见但未安装的字体导致 PPT 打开后回退成宋体。
 */
export interface Theme {
  id: string
  name: string
  /** 深色底主题：前景文字需要反转。 */
  dark: boolean
  /** 页面背景。 */
  bg: string
  /** 主色：背景、大色块、标题栏底色（面积 ≤60%）。 */
  primary: string
  /** 辅色：卡片背景、第二系列（≤30%）。 */
  secondary: string
  /** 强调色：巨型数字、CTA、核心标注（≤10%，hero 页可到 20%）。 */
  accent: string
  /** 正文主色。 */
  text: string
  /** 弱化文字（页脚、说明）。 */
  muted: string
  /** 第二点缀色（小标签、次级强调，≤5%）。 */
  accent5: string
  /** 第三点缀色（警示/反差色，≤3%）。 */
  accent6: string
  /** 超链接色。 */
  hyperlink: string
  /**
   * hero 页（cover/section/ending）渐变底：`C1-C2[-ANGLE]`（officecli 的
   * `slide background` 渐变语法）。缺省由 primary 向深色 25% 生成 135° 渐变。
   */
  heroGradient?: string
  /** hero 页装饰风格。 */
  coverDecor: 'circles' | 'grid' | 'band' | 'none'
  /** 标题字体：latin 走西文，ea 走中文。 */
  fontTitle: { latin: string; ea: string }
  /** 正文字体。 */
  fontBody: { latin: string; ea: string }
}

/** 内置主题。 */
export const THEMES: readonly Theme[] = [
  {
    id: 'business-blue',
    name: '商务蓝（通用汇报、SaaS、金融）',
    dark: false,
    bg: 'FFFFFF',
    primary: '1F6FEB',
    secondary: '06B6D4',
    accent: 'F59E0B',
    text: '1A1A1A',
    muted: '6B7280',
    accent5: '2563EB',
    accent6: '475569',
    hyperlink: '1D4ED8',
    heroGradient: '1F6FEB-0E5AC8-135',
    coverDecor: 'circles',
    fontTitle: { latin: 'Segoe UI', ea: '微软雅黑' },
    fontBody: { latin: 'Segoe UI', ea: '微软雅黑' },
  },
  {
    id: 'academic-crimson',
    name: '学术深红（论文答辩、人文、文化）',
    dark: false,
    bg: 'F7F4EC',
    primary: '8B1A1A',
    secondary: 'A8351A',
    accent: 'D4AF37',
    text: '3F4A55',
    muted: '7A828B',
    accent5: '6D1515',
    accent6: 'B45309',
    hyperlink: '7F1D1D',
    heroGradient: '8B1A1A-5F0F0F-135',
    coverDecor: 'none',
    fontTitle: { latin: 'Georgia', ea: '宋体' },
    fontBody: { latin: 'Georgia', ea: '等线' },
  },
  {
    id: 'tech-cyan',
    name: '科技青（深色底，AI、芯片、数据）',
    dark: true,
    bg: '0F172A',
    primary: '3B82F6',
    secondary: '22D3EE',
    accent: 'A78BFA',
    text: 'F1F5F9',
    muted: '94A3B8',
    accent5: '60A5FA',
    accent6: 'F472B6',
    hyperlink: '93C5FD',
    heroGradient: '0F172A-1E3A8A-135',
    coverDecor: 'grid',
    fontTitle: { latin: 'Segoe UI', ea: '微软雅黑' },
    fontBody: { latin: 'Segoe UI', ea: '等线' },
  },
  {
    id: 'warm-orange',
    name: '暖橙（教育、消费、生活）',
    dark: false,
    bg: 'FAF7F2',
    primary: 'EA580C',
    secondary: 'EC4899',
    accent: '0D9488',
    text: '1A1A1A',
    muted: '78716C',
    accent5: 'C2410C',
    accent6: '047857',
    hyperlink: 'B45309',
    heroGradient: 'EA580C-BF4A0B-135',
    coverDecor: 'band',
    fontTitle: { latin: 'Segoe UI', ea: '微软雅黑' },
    fontBody: { latin: 'Segoe UI', ea: '微软雅黑' },
  },
  {
    id: 'gov-red',
    name: '政务红（党政、法律、正式公文）',
    dark: false,
    bg: 'FFFFFF',
    primary: 'C8102E',
    secondary: 'D4AF37',
    accent: '8B1A1A',
    text: '1A1A1A',
    muted: '5A5A5A',
    accent5: 'A00E24',
    accent6: '7F1D1D',
    hyperlink: '8B0F22',
    heroGradient: 'C8102E-8B0F22-135',
    coverDecor: 'none',
    fontTitle: { latin: 'Times New Roman', ea: '黑体' },
    fontBody: { latin: 'Times New Roman', ea: '宋体' },
  },
  {
    id: 'minimal-gray',
    name: '极简灰（设计提案、策略思考）',
    dark: false,
    bg: 'FFFFFF',
    primary: '1F2937',
    secondary: '4B5563',
    accent: '111827',
    text: '111827',
    muted: '9CA3AF',
    accent5: '374151',
    accent6: '6B7280',
    hyperlink: '1F2937',
    heroGradient: '111827-374151-135',
    coverDecor: 'none',
    fontTitle: { latin: 'Segoe UI', ea: '微软雅黑' },
    fontBody: { latin: 'Segoe UI', ea: '微软雅黑' },
  },
  {
    id: 'nature-green',
    name: '自然绿（ESG、农业、健康）',
    dark: false,
    bg: 'F6F8F4',
    primary: '166534',
    secondary: '65A30D',
    accent: '0F766E',
    text: '1C1917',
    muted: '78716C',
    accent5: '15803D',
    accent6: 'A16207',
    hyperlink: '14532D',
    heroGradient: '166534-0E4F26-135',
    coverDecor: 'band',
    fontTitle: { latin: 'Segoe UI', ea: '微软雅黑' },
    fontBody: { latin: 'Segoe UI', ea: '微软雅黑' },
  },
  {
    id: 'luxury-black',
    name: '奢华黑金（年度报告、高端发布）',
    dark: true,
    bg: '0B0B0F',
    primary: '1C1C22',
    secondary: '2A2A33',
    accent: 'D4AF37',
    text: 'F5F5F4',
    muted: '8A8A93',
    accent5: 'B8912F',
    accent6: '6B7280',
    hyperlink: 'D4AF37',
    heroGradient: '0B0B0F-1C1C22-135',
    coverDecor: 'circles',
    fontTitle: { latin: 'Segoe UI', ea: '微软雅黑' },
    fontBody: { latin: 'Segoe UI', ea: '微软雅黑' },
  },
]

/** 默认主题。 */
export const DEFAULT_THEME_ID = 'business-blue'

/** 按 id 取主题，未命中回落到默认主题。 */
export function getTheme(id: string | undefined): Theme {
  if (!id) return THEMES[0]!
  return THEMES.find((t) => t.id === id) ?? THEMES[0]!
}

/**
 * 主题的别名 / 关键词表：`resolveTheme` 的二级索引。
 *
 * 键是主题 id，值是别名数组，命中规则为**最长子串优先** —— 这样"科技蓝"会命中
 * tech-cyan 的 `科技蓝`，而不是 business-blue 的单字 `蓝`。所有别名都小写，
 * 匹配前会把输入同样小写化。
 */
export const THEME_ALIASES: Record<string, string[]> = {
  'business-blue': ['商务蓝', '商务', '汇报蓝', '经典蓝', '企业蓝', '蓝色', '蓝', 'business', 'corporate', 'blue'],
  'tech-cyan': ['科技蓝', '科技青', '科技感', '科技风', '科技', '深色', '暗色', '深色底', '深色科技', '赛博', 'ai', '芯片', 'tech', 'cyan', 'dark'],
  'academic-crimson': ['学术深红', '深红', '酒红', '学术', '答辩', '论文', '人文', 'crimson', 'maroon', 'academic', 'wine'],
  'warm-orange': ['暖橙', '橙色', '橙', '教育', '消费', '生活', 'orange', 'warm'],
  'gov-red': ['政务红', '中国红', '党政', '政府', '政务', '红旗', '公文', '红色', '红', 'gov', 'government', 'china red'],
  'minimal-gray': ['极简灰', '极简', '简约', '黑白', '灰色', '灰', 'minimal', 'mono', 'swiss'],
  'nature-green': ['自然绿', '绿色', '绿', 'esg', '农业', '健康', 'green', 'nature', 'eco'],
  'luxury-black': ['黑金', '奢华', '奢华黑金', '高端', '黑金风', 'gold', 'luxury', 'black gold', 'premium'],
}

/** 色值归一化：去 `#`、大写、3 位缩写展开成 6 位。非法返回 undefined。 */
export function normalizeHex(input: string): string | undefined {
  let s = input.trim().replace(/^#/, '')
  if (/^[0-9a-fA-F]{3}$/.test(s)) s = s.split('').map((c) => c + c).join('')
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return undefined
  return s.toUpperCase()
}

// ---------------------------------------------------------------------------
// 自然语言 → 主题
// ---------------------------------------------------------------------------

/** 归一化查询串：小写、去空白与常见分隔符。 */
function normalizeQuery(input: string): string {
  return input.toLowerCase().replace(/[\s_\-+·、,，。/\\()（）【】"']/g, '')
}

/**
 * 解析主题：id → 别名/关键词 → 十六进制主色派生，三步递进。
 *
 * 用户说"生成一份科技蓝风格的 PPT"时，模型大概率会原样把"科技蓝风格"塞进
 * `deck.theme`。过去这会让 getTheme 静默回落到商务蓝 —— 用户以为指定了配色，
 * 实际没生效。现在按最长别名子串打分，并在完全无法识别时返回一个忠告式结果。
 *
 * @param input - 主题 id、中文别名、自然语言描述或十六进制主色（如 `#1F6FEB`）。
 * @returns 命中的主题；无法识别时返回 undefined（调用方自行决定回退策略）。
 */
export function findTheme(input: string | undefined | null): Theme | undefined {
  if (input === undefined || input === null) return undefined
  const raw = input.trim()
  if (!raw) return undefined

  // 1) 精确 id
  const exact = THEMES.find((t) => t.id === raw)
  if (exact) return exact

  const q = normalizeQuery(raw)

  // 2) id 归一化后相等（"Business Blue" / "business_blue"）
  const byId = THEMES.find((t) => normalizeQuery(t.id) === q)
  if (byId) return byId

  // 3) 别名：完全相等优先
  for (const [id, aliases] of Object.entries(THEME_ALIASES)) {
    if (aliases.some((a) => normalizeQuery(a) === q)) {
      return THEMES.find((t) => t.id === id)
    }
  }

  // 4) 别名子串：长度 × 出现次数打分，最长匹配优先（科技蓝 胜过 蓝）
  let best: { id: string; score: number } | undefined
  for (const [id, aliases] of Object.entries(THEME_ALIASES)) {
    for (const alias of aliases) {
      const a = normalizeQuery(alias)
      // 单字/双字中文别名要求长度 ≥2 才参与子串匹配，避免"蓝"到处命中
      if (a.length < 2 || !q.includes(a)) continue
      const score = a.length * 10
      if (!best || score > best.score) best = { id, score }
    }
  }
  if (best) return THEMES.find((t) => t.id === best!.id)

  // 5) 十六进制主色：当场派生一套完整配色
  const hex = normalizeHex(raw)
  if (hex) return themeFromPrimary(hex)

  return undefined
}

/**
 * 按输入解析主题，识别失败回落到 fallback（缺省默认主题）。
 * 与 {@link findTheme} 的区别是永不返回 undefined，适合工具入参场景。
 */
export function resolveTheme(input: string | undefined | null, fallback?: Theme): Theme {
  return findTheme(input) ?? fallback ?? getTheme(undefined)
}

/** 列出每个主题会被自动识别的说法，供设计指南展示，也便于模型反向对齐措辞。 */
export function themeAliasCatalog(): string {
  const lines = THEMES.map((t) => {
    const aliases = (THEME_ALIASES[t.id] ?? []).slice(0, 8).join('、')
    return `  ${t.id.padEnd(16)} ${t.name}\n      说法: ${aliases}`
  })
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// 由单一主色派生完整配色
// ---------------------------------------------------------------------------

interface Hsl {
  h: number
  s: number
  l: number
}

function hexToHsl(hex: string): Hsl {
  const h = hex.replace('#', '').padStart(6, '0')
  const r = parseInt(h.slice(0, 2), 16) / 255
  const g = parseInt(h.slice(2, 4), 16) / 255
  const b = parseInt(h.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0, l }
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let hue: number
  if (max === r) hue = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) hue = ((b - r) / d + 2) / 6
  else hue = ((r - g) / d + 4) / 6
  return { h: hue * 360, s, l }
}

function hslToHex({ h, s, l }: Hsl): string {
  const hh = ((h % 360) + 360) % 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1))
  const m = l - c / 2
  let rgb: [number, number, number]
  if (hh < 60) rgb = [c, x, 0]
  else if (hh < 120) rgb = [x, c, 0]
  else if (hh < 180) rgb = [0, c, x]
  else if (hh < 240) rgb = [0, x, c]
  else if (hh < 300) rgb = [x, 0, c]
  else rgb = [c, 0, x]
  return rgb
    .map((v) => Math.round(Math.max(0, Math.min(1, v + m)) * 255).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

/** 在 HSL 空间旋转色相并微调明度，得到同源色。 */
function rotate(base: string, dHue: number, dSat = 0, dLight = 0): string {
  const c = hexToHsl(base)
  return hslToHex({
    h: c.h + dHue,
    s: Math.max(0.08, Math.min(1, c.s + dSat)),
    l: Math.max(0.06, Math.min(0.94, c.l + dLight)),
  })
}

/**
 * 由一个主色派生整套主题。
 *
 * 用户只说"用我们公司的主色 #0F5EA6"时也能拿到一份协调的 PPT 配色：辅色取
 * 邻近色（+32°），强调色取接近补色（-155°，并提到足够饱和度）保证对比度，
 * 背景/文字按明暗模式取极值。
 */
export function themeFromPrimary(hex: string, opts: { dark?: boolean; name?: string } = {}): Theme {
  const primary = normalizeHex(hex) ?? '1F6FEB'
  const dark = opts.dark ?? hexToHsl(primary).l < 0.28
  const bg = dark ? tint(primary, -0.92) : 'FFFFFF'
  const text = dark ? tint(primary, 0.9) : '1A1A1A'
  return {
    id: `custom-${primary}`,
    name: opts.name ?? `自定义主色 #${primary}`,
    dark,
    bg,
    primary,
    secondary: rotate(primary, 32, -0.05, dark ? 0.08 : -0.02),
    accent: rotate(primary, -155, 0.15, dark ? 0.06 : 0.02),
    text,
    muted: dark ? tint(primary, 0.52) : '6B7280',
    accent5: rotate(primary, 60, -0.02, -0.04),
    accent6: rotate(primary, -60, -0.02, -0.04),
    hyperlink: dark ? tint(primary, 0.35) : tint(primary, -0.18),
    heroGradient: `${primary}-${tint(primary, dark ? 0.35 : -0.28)}-135`,
    coverDecor: dark ? 'grid' : 'circles',
    fontTitle: { latin: 'Segoe UI', ea: '微软雅黑' },
    fontBody: { latin: 'Segoe UI', ea: '微软雅黑' },
  }
}

// ---------------------------------------------------------------------------
// 样式覆盖：DeckStyle.colors / fonts 落到主题上
// ---------------------------------------------------------------------------

/** 可被覆盖的色槽。值支持 `#RRGGBB` / `RRGGBB` / `#RGB`。 */
export type ColorOverrides = Partial<
  Pick<Theme, 'primary' | 'secondary' | 'accent' | 'bg' | 'text' | 'muted' | 'accent5' | 'accent6' | 'hyperlink'>
>

/** 可被覆盖的字体槽。`title` / `body` 同时作用于 latin 与 eastAsia。 */
export interface FontOverrides {
  title?: string
  body?: string
  titleLatin?: string
  titleEa?: string
  bodyLatin?: string
  bodyEa?: string
}

const COLOR_SLOTS: (keyof ColorOverrides)[] = [
  'primary', 'secondary', 'accent', 'bg', 'text', 'muted', 'accent5', 'accent6', 'hyperlink',
]

/**
 * 把办公室民主党要求的样式覆盖合并到主题上。
 *
 * 色值一律过 {@link normalizeHex}（顺手也把模型爱写的 `#xxx` 前缀摘掉），非法值
 * **静默忽略** —— 宁可少一处覆盖，也不要把 `PANTONE 286` 这种东西写进 OOXML
 * 让 PowerPoint 判定文件损坏。
 */
export function applyThemeOverrides(theme: Theme, colors?: ColorOverrides, fonts?: FontOverrides): Theme {
  const next: Theme = {
    ...theme,
    fontTitle: { ...theme.fontTitle },
    fontBody: { ...theme.fontBody },
  }
  if (colors) {
    for (const slot of COLOR_SLOTS) {
      const v = colors[slot]
      if (typeof v !== 'string') continue
      const hex = normalizeHex(v)
      if (hex) next[slot] = hex
    }
    // 背景换了就重判明暗：白底配深蓝字与黑底配浅字走不同的前景公式
    if (colors.bg && normalizeHex(colors.bg)) next.dark = isDarkColor(next.bg)
  }
  if (fonts) {
    if (fonts.title) {
      next.fontTitle = { latin: fonts.title, ea: fonts.title }
    }
    if (fonts.titleLatin) next.fontTitle.latin = fonts.titleLatin
    if (fonts.titleEa) next.fontTitle.ea = fonts.titleEa
    if (fonts.body) {
      next.fontBody = { latin: fonts.body, ea: fonts.body }
    }
    if (fonts.bodyLatin) next.fontBody.latin = fonts.bodyLatin
    if (fonts.bodyEa) next.fontBody.ea = fonts.bodyEa
  }
  return next
}

/** 列出主题摘要（给 office_design_guide 用）。 */
export function listThemes(): { id: string; name: string; dark: boolean }[] {
  return THEMES.map((t) => ({ id: t.id, name: t.name, dark: t.dark }))
}

/** 相对亮度（0–1），用于判断底色明暗。 */
function luminance(hex: string): number {
  const h = hex.replace('#', '').padStart(6, '0')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

/** 6 位 hex 字符串是否代表深色底。 */
export function isDarkColor(hex: string): boolean {
  return luminance(hex) < 0.5
}

/**
 * 从 `office_get <f> /` 的 `format` 属性表里还原主题。
 *
 * office_slide_add 往已有 PPT 追加页面时必须沿用原文件的配色，否则新页面会
 * 突然换一套颜色。先按一组色值精确匹配内置主题，匹配不上就按读回的色值现场
 * 构造一个主题，保证新页至少与原文件用的是同一组色号。
 * @param format - presentation 节点的属性表（键如 `theme.color.accent1`，值如 `#1F6FEB`）。
 * @returns 还原出的主题；读不到主色时返回 undefined。
 */
export function inferTheme(format: Record<string, unknown> | undefined): Theme | undefined {
  /** 取某个 theme 属性并归一化成 6 位大写 hex（无 `#`）。 */
  const color = (key: string): string | undefined => {
    const v = format?.[`theme.color.${key}`]
    return typeof v === 'string' ? v.replace('#', '').toUpperCase() : undefined
  }
  const font = (key: string): string | undefined => {
    const v = format?.[`theme.font.${key}`]
    return typeof v === 'string' && v ? v : undefined
  }

  const primary = color('accent1')
  if (primary === undefined) return undefined

  const bg = color('lt1') ?? 'FFFFFF'
  const theme: Theme = {
    id: 'inherited',
    name: '继承原文件配色',
    dark: isDarkColor(bg),
    bg,
    primary,
    secondary: color('accent2') ?? primary,
    accent: color('accent3') ?? primary,
    text: color('dk1') ?? '1A1A1A',
    muted: color('accent4') ?? color('dk2') ?? '6B7280',
    accent5: color('accent5') ?? color('dk2') ?? primary,
    accent6: color('accent6') ?? color('dk2') ?? primary,
    hyperlink: color('hyperlink') ?? primary,
    coverDecor: 'none',
    fontTitle: { latin: font('major.latin') ?? 'Segoe UI', ea: font('major.eastAsia') ?? '微软雅黑' },
    fontBody: { latin: font('minor.latin') ?? 'Segoe UI', ea: font('minor.eastAsia') ?? '微软雅黑' },
  }

  // 色值完全命中某个内置主题时直接用它，让后续的消息/版式与整份文件保持一致。
  return THEMES.find((t) =>
    t.primary === theme.primary &&
    t.secondary === theme.secondary &&
    t.accent === theme.accent &&
    t.bg === theme.bg &&
    t.text === theme.text,
  ) ?? theme
}

/**
 * 主色块之上的前景色。深色底主题用文字色，浅色底用白色。
 * 用于封面、章节页、结束页这类整幅主色铺底的版式。
 */
export function onPrimary(theme: Theme): string {
  return theme.dark ? theme.text : 'FFFFFF'
}

/** 主色块之上的弱化前景色。 */
export function onPrimaryMuted(theme: Theme): string {
  return theme.dark ? theme.muted : tint(theme.primary, 0.7)
}

/**
 * 卡片/容器底色：浅色主题用主色向白 92% 的淡染，深色主题用主色向黑 78% 的暗染。
 * 保证卡片与页面背景有区分度，又不抢主色的视觉权重。
 */
export function surfaceOf(theme: Theme): string {
  return theme.dark ? tint(theme.primary, -0.78) : tint(theme.primary, 0.92)
}

/** 分隔线 / 边框色。 */
export function hairlineOf(theme: Theme): string {
  return theme.dark ? tint(theme.primary, -0.45) : tint(theme.text, 0.82)
}

/**
 * hero 页渐变底。优先主题声明的 heroGradient，缺省由 primary 向深色 25%
 * 生成 135° 线性渐变（officecli slide background 的 `C1-C2-ANGLE` 语法）。
 */
export function heroBackground(theme: Theme): string {
  if (theme.heroGradient) return theme.heroGradient
  return `${theme.primary}-${tint(theme.primary, theme.dark ? -0.18 : -0.25)}-135`
}

/**
 * 把主题编译成 officecli 的 `set <file> / --prop ...` 属性表。
 * 落到 PPT 的 theme part 上，之后所有沿用主题色的形状会自动继承。
 */
export function themeToProps(theme: Theme): Record<string, string> {
  return {
    slideSize: 'widescreen',
    'theme.color.lt1': theme.bg,
    'theme.color.dk1': theme.text,
    'theme.color.accent1': theme.primary,
    'theme.color.accent2': theme.secondary,
    'theme.color.accent3': theme.accent,
    'theme.color.accent4': theme.muted,
    'theme.color.accent5': theme.accent5,
    'theme.color.accent6': theme.accent6,
    'theme.color.hyperlink': theme.hyperlink,
    'theme.font.major.latin': theme.fontTitle.latin,
    'theme.font.major.eastAsia': theme.fontTitle.ea,
    'theme.font.minor.latin': theme.fontBody.latin,
    'theme.font.minor.eastAsia': theme.fontBody.ea,
  }
}
