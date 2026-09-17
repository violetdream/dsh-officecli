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
  /**
   * 色彩论证：为什么是这组色（一句话）。
   *
   * 由 {@link themeFromPrimary} 派生主题时自动生成；内置主题留空（它们的色是
   * 手工设计的，不需要自证）。这一字段存在的意义是**防 slop 的自检门** ——
   * 写不出「为什么是这个色」，说明调色板是从模型先验里抽的签，而不是从内容
   * 里采的样。
   */
  colorRationale?: string
  /**
   * 设计风格 id（见 `styles.ts`）：由 `deck.style.preset` 命中时回填，
   * 供回执与评审说明「这版用的是哪套视觉系统」。
   */
  styleId?: string
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

export interface Hsl {
  h: number
  s: number
  l: number
}

export function hexToHsl(hex: string): Hsl {
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

export function hslToHex({ h, s, l }: Hsl): string {
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

// ---------------------------------------------------------------------------
// OKLCH：感知均匀色空间的色彩推导
// ---------------------------------------------------------------------------

/**
 * OKLCH 色彩：L 明度（0–1，感知均匀）、C chroma（0–0.37+）、h 色相（度）。
 *
 * 为什么不用 HSL 推导配色：HSL 的 L 通道不是感知均匀的 —— 同一个 `l: 0.5`
 * 在黄色上是亮米色、在蓝色上是深墨蓝，于是「明度序列」在 HSL 里根本不成立，
 * 只能靠肉眼一个个试。色相也是同理：HSL 里等角度旋转出来的「邻近色」，
 * 落到屏幕上可能一个偏灰一个荧光。OKLCH 的 L 可以直接当层级用、h 可以当
 * 色相角用（拉开 60° 就是能看出来的两色），这是能写出「推导规则」而不是
 * 「猜色值」的前提。
 */
export interface Oklch {
  L: number
  C: number
  h: number
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
}

/** sRGB hex → OKLCH（Björn Ottosson 的 OKLab 变换链）。 */
export function hexToOklch(hex: string): Oklch {
  const h = hex.replace('#', '').padStart(6, '0')
  const r = srgbToLinear(parseInt(h.slice(0, 2), 16) / 255)
  const g = srgbToLinear(parseInt(h.slice(2, 4), 16) / 255)
  const b = srgbToLinear(parseInt(h.slice(4, 6), 16) / 255)

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)

  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return { L, C: Math.hypot(A, B), h: (Math.atan2(B, A) * 180) / Math.PI }
}

/** OKLCH → sRGB hex。超色域时按 0.002 步长降 chroma 收回，避免出现死板的高饱和荧光。 */
export function oklchToHex({ L, C, h }: Oklch): string {
  const rad = (h * Math.PI) / 180
  const lCap = Math.max(0, Math.min(1, L))
  let chroma = Math.max(0, C)
  for (let i = 0; i < 200; i++) {
    const a = Math.cos(rad) * chroma
    const b = Math.sin(rad) * chroma
    const l_ = lCap + 0.3963377774 * a + 0.2158037573 * b
    const m_ = lCap - 0.1055613458 * a - 0.0638541728 * b
    const s_ = lCap - 0.0894841775 * a - 1.291485548 * b
    const l3 = l_ * l_ * l_
    const m3 = m_ * m_ * m_
    const s3 = s_ * s_ * s_
    const rgb = [
      4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
      -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
      -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
    ]
    if (rgb.every((v) => v >= -0.0005 && v <= 1.0005)) {
      return rgb
        .map((v) => Math.round(Math.max(0, Math.min(1, linearToSrgb(Math.max(0, Math.min(1, v))))) * 255)
          .toString(16)
          .padStart(2, '0'))
        .join('')
        .toUpperCase()
    }
    chroma -= 0.002
    if (chroma <= 0) break
  }
  const gray = Math.round(Math.max(0, Math.min(1, linearToSrgb(lCap))) * 255)
    .toString(16)
    .padStart(2, '0')
  return `${gray}${gray}${gray}`.toUpperCase()
}

/** 色相移动 dH 度（结果落在 [0,360)）。 */
function spinHue(h: number, dH: number): number {
  return ((h + dH) % 360 + 360) % 360
}

/**
 * 两个颜色的 OKLab 感知色差（ΔE）。
 *
 * 判断「这两种色投屏上分不分得开」不能只比色相角 —— 近中性色（近黑、灰）的
 * 色相是无意义的坐标，两个灰的色相角可能差 120° 却看起来一样。ΔE 把明度、
 * 彩度、色相一起算进欧氏距离，是唯一的可靠判据。
 *
 * 经验阈值：ΔE ≥ 0.15 肉眼可分辨；< 0.10 基本是同一个色。
 */
export function deltaE(a: string, b: string): number {
  const x = hexToOklch(a)
  const y = hexToOklch(b)
  const ax = Math.cos((x.h * Math.PI) / 180) * x.C
  const bx = Math.sin((x.h * Math.PI) / 180) * x.C
  const ay = Math.cos((y.h * Math.PI) / 180) * y.C
  const by = Math.sin((y.h * Math.PI) / 180) * y.C
  return Math.hypot(x.L - y.L, ax - ay, bx - by)
}

/** WCAG 对比度（1–21）。用于校验文字压在其底色上是否读得出来。 */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** WCAG 相对亮度（线性化后的加权和），对比度公式的分量。 */
export function relativeLuminance(hex: string): number {
  const h = hex.replace('#', '').padStart(6, '0')
  const lin = (v: number): number => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return (
    0.2126 * lin(parseInt(h.slice(0, 2), 16)) +
    0.7152 * lin(parseInt(h.slice(2, 4), 16)) +
    0.0722 * lin(parseInt(h.slice(4, 6), 16))
  )
}

/** 夹取到区间。 */
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/**
 * 色相迁移：把 slot 从 `from` 的同源体系搬到 `to` 的同源体系。
 *
 * 这是「品牌色优先」的关键一步 —— 用户给了公司主色时，风格预设里那套**手工
 * 调过的关系**（哪个是邻近色、哪个是对比色、明度怎么排）必须保留，只把整体
 * 色相搬到新主色上。**中性色原样返回**：白/灰/黑不该跟着主色变色，否则
 * 「近黑底 + 中性灰阶」类的风格一换主色就整组发彩。
 */
export function rebaseColor(from: string, to: string, slot: string): string {
  const a = hexToOklch(from)
  const b = hexToOklch(to)
  const s = hexToOklch(slot)
  if (s.C < 0.03) return slot.replace('#', '').toUpperCase()
  return oklchToHex({ L: s.L, C: Math.min(s.C, 0.22), h: spinHue(s.h, b.h - a.h) })
}

/** 一组派生参数，便于 smoke 脚本与评审复算。 */
export interface DerivationStep {
  slot: string
  hex: string
  rule: string
}

/**
 * 落实「三步色彩推导协议」的后两步（第一步「采样」由调用方完成 —— 主色要么
 * 来自用户/品牌，要么来自内容，总之不该是本函数凭空发明的）。
 *
 * **收敛**：把主色压进有彩色 ≤3 个的体系 —— 1 个主色 + 1 个邻近辅色 + 1 个
 * 对比强调色，其余降为同色相明度阶（中性序列）。色相之间保证 ΔH ≥ 60°，或
 * 明度保证 ΔL ≥ 0.3，两者必居其一，否则在投屏上根本分不出是两种色。
 *
 * **论证**：返回的 {@link DerivationStep} 列表就是论证材料，{@link themeFromPrimary}
 * 会把它压成一句写进 `Theme.colorRationale`。
 */
export function derivePalette(hex: string, opts: { dark?: boolean } = {}): DerivationStep[] {
  const raw = normalizeHex(hex) ?? '1F6FEB'
  const p = hexToOklch(raw)
  // 收敛①：油墨感。屏幕色拉到满 chroma 会发荧光，PPT 投屏后尤其廉价；
  // 把主色 chroma 收进 0.06–0.16（对应印刷油墨的观感区间）。
  const pc = clamp(p.C, 0.06, 0.16)
  // 收敛②：明度也要收。极亮的主色（#FFE01B 这类荧光黄）压白底会糊成一片，
  // 极暗的主色则退化成黑 —— 收进 [0.20, 0.86] 之后才谈得上「可读的主色」。
  const pL = clamp(p.L, 0.2, 0.86)
  const primary = oklchToHex({ L: pL, C: pc, h: p.h })
  const dark = opts.dark ?? hexToHsl(primary).l < 0.28
  const clamped = [
    pc !== p.C ? `chroma ${p.C.toFixed(3)}→${pc.toFixed(3)}（印刷油墨感，避开屏幕荧光）` : null,
    pL !== p.L ? `明度 ${p.L.toFixed(3)}→${pL.toFixed(3)}（收进可读区间）` : null,
  ].filter(Boolean)
  const steps: DerivationStep[] = [
    {
      slot: 'primary',
      hex: primary,
      rule: clamped.length > 0 ? `采样主色 ${raw}，收敛：${clamped.join('，')}` : `采样主色 ${raw}，本身已在可用区间，原样保留`,
    },
  ]
  // 收敛③：辅色 = 邻近色（ΔH 42°），**明度不抬**，与主色同权重但可区分。
  const secC = clamp(pc * 0.82, 0.05, 0.13)
  const secondary = oklchToHex({ L: clamp(pL + (dark ? 0.1 : 0.05), 0.18, 0.86), C: secC, h: spinHue(p.h, 42) })
  steps.push({ slot: 'secondary', hex: secondary, rule: '邻近色 ΔH 42°，chroma 降至主色 82%（第二系列，不与主色抢权重）' })
  // 收敛④：强调色 = 对比色（ΔH 152° ≥ 60°，满足「看得出是两种色」的可分辨前提），
  // 明度按底色反向定 —— 浅底要够暗才压得住字，深底要够亮才浮得出来。
  const accL = dark ? 0.74 : 0.56
  const accent = oklchToHex({ L: accL, C: 0.15, h: spinHue(p.h, 152) })
  steps.push({ slot: 'accent', hex: accent, rule: `对比色 ΔH 152°、ΔL ${Math.abs(accL - pL).toFixed(2)}，明度按底色反向定（强调色要压得住前景）` })
  return [
    ...steps,
    { slot: 'bg', hex: dark ? oklchToHex({ L: 0.17, C: Math.min(pc * 0.2, 0.025), h: p.h }) : 'FFFFFF', rule: dark ? '深色底：主色相极低 chroma 的暗场' : '浅色底：纯白，让色彩全部让位给内容' },
    { slot: 'text', hex: dark ? 'F1F5F9' : oklchToHex({ L: 0.22, C: 0.015, h: p.h }), rule: '正文色：主色相去饱和到近乎中性，避免整页发彩' },
    { slot: 'muted', hex: oklchToHex({ L: dark ? 0.7 : 0.58, C: 0.02, h: p.h }), rule: '弱化色：同色相中性序列的中段' },
    { slot: 'accent5', hex: oklchToHex({ L: clamp(pL - 0.12, 0.22, 0.78), C: pc * 0.9, h: p.h }), rule: '点缀色 = 主色同色相降一级明度（不新增色相）' },
    { slot: 'accent6', hex: oklchToHex({ L: clamp(pL + 0.16, 0.28, 0.88), C: pc * 0.78, h: p.h }), rule: '反差色 = 主色同色相升一级明度（不新增色相）' },
  ]
}

/**
 * 由一个主色派生整套主题。
 *
 * 用户只说"用我们公司的主色 #0F5EA6"时也能拿到一份协调的 PPT 配色。走的是
 * {@link derivePalette} 的三步推导（采样 → 收敛 → 论证），而不是早期版本的
 * 「在 HSL 色轮上转 +32° 取辅色」—— 后者是凭空发明颜色：同一个输入换个色相
 * 起点，转出来的永远是那几个网红色，且 HSL 的明度不可比。
 *
 * 结果里的 `colorRationale` 是论证句，可被设计指南与评审直接引用。
 */
export function themeFromPrimary(hex: string, opts: { dark?: boolean; name?: string } = {}): Theme {
  const steps = derivePalette(hex, opts)
  const at = (slot: string): string => steps.find((s) => s.slot === slot)!.hex
  const primary = at('primary')
  return {
    id: `custom-${primary}`,
    name: opts.name ?? `自定义主色 #${primary}`,
    dark: opts.dark ?? hexToHsl(primary).l < 0.28,
    bg: at('bg'),
    primary,
    secondary: at('secondary'),
    accent: at('accent'),
    text: at('text'),
    muted: at('muted'),
    accent5: at('accent5'),
    accent6: at('accent6'),
    hyperlink: oklchToHex({
      ...hexToOklch(primary),
      L: clamp(hexToOklch(primary).L + (opts.dark ? 0.14 : -0.14), 0.2, 0.88),
    }),
    heroGradient: `${primary}-${tint(primary, (opts.dark ?? false) ? 0.35 : -0.28)}-135`,
    coverDecor: (opts.dark ?? false) ? 'grid' : 'circles',
    fontTitle: { latin: 'Segoe UI', ea: '微软雅黑' },
    fontBody: { latin: 'Segoe UI', ea: '微软雅黑' },
    colorRationale:
      `主色 ${primary} 为采样所得；` +
      `辅色取 ΔH42° 邻近色并压 chroma，强调色取 ΔH152° 对比色；` +
      `其余色槽不新增色相，只做同色相明度阶（accent5/accent6）与去饱和中性序列（bg/text/muted）。` +
      `全文有彩色 3 个 + 中性序列 1 组，符合「2–3 个有彩色 + 1 组中性色」的收敛要求。`,
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
    const touched: string[] = []
    for (const slot of COLOR_SLOTS) {
      const v = colors[slot]
      if (typeof v !== 'string') continue
      const hex = normalizeHex(v)
      if (hex) {
        // 只有**真的改变了取值**才算「显式覆盖」。风格预设已经用品牌主色做过
        // 色相迁移（并写下论证），这里若照旧记一笔，会把那条更具体的论证冲掉。
        if (hex !== next[slot]) touched.push(slot)
        next[slot] = hex
      }
    }
    // 背景换了就重判明暗：白底配深蓝字与黑底配浅字走不同的前景公式
    if (colors.bg && normalizeHex(colors.bg)) next.dark = isDarkColor(next.bg)
    // 覆盖之后原推导已部分失效，但未覆盖的槽仍成立 —— 追加说明而不是替换，
    // 免得把风格预设/主色派生写下的「为什么是这组色」整段抹掉。
    if (touched.length > 0) {
      const note = `色槽被显式指定：${touched.join(' / ')} —— 这些槽不再按基色推导，其余槽沿用原推导结果。`
      next.colorRationale = next.colorRationale ? `${next.colorRationale}\n  ⤷ ${note}` : note
    }
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

/** hero 页整幅主色铺底时，压在主色上的深色墨（亮主色场景用）。 */
const INK_ON_LIGHT_PRIMARY = '111827'

/**
 * hero 前景的最低对比度。
 *
 * 取 3.0 而不是正文的 4.5：封面/章节/结束页的字号 ≥48pt，属 WCAG 的 large text，
 * 3.0 是它对应的门槛。按 4.5 卡会把一批合法品牌色（暖橙、珊瑚红）误判成不可用。
 */
const HERO_MIN_CONTRAST = 3

/**
 * 主色块之上的前景色。用于封面、章节页、结束页这类整幅主色铺底的版式。
 *
 * 判据是**主色自身的明度**，不是主题的明暗模式 —— 早期版本写死「浅色主题就用
 * 白字」，遇到亮主色（Spotify 绿 #1ED760、Mailchimp 黄 #FFE01B 这类真实品牌
 * 色）会产出白字压亮绿 —— 实测对比度只有 1.9，投屏上完全读不出来。现在在明度
 * 判断之上再加一道对比度兜底：首选墨色达不到 large-text 门槛就换成另一种。
 */
export function onPrimary(theme: Theme): string {
  const first = luminance(theme.primary) < 0.5 ? 'FFFFFF' : INK_ON_LIGHT_PRIMARY
  // 明度判断之上再加一道对比度兜底：首选墨色达不到 large-text 门槛就换另一种。
  if (contrastRatio(theme.primary, first) >= HERO_MIN_CONTRAST) return first
  return first === 'FFFFFF' ? INK_ON_LIGHT_PRIMARY : 'FFFFFF'
}

/** 主色块之上的弱化前景色。 */
export function onPrimaryMuted(theme: Theme): string {
  if (onPrimary(theme) !== 'FFFFFF') return tint(INK_ON_LIGHT_PRIMARY, 0.42)
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
