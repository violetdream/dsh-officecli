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
    fontTitle: { latin: 'Times New Roman', ea: '黑体' },
    fontBody: { latin: 'Times New Roman', ea: '宋体' },
  },
]

/** 默认主题。 */
export const DEFAULT_THEME_ID = 'business-blue'

/** 按 id 取主题，未命中回落到默认主题。 */
export function getTheme(id: string | undefined): Theme {
  if (!id) return THEMES[0]!
  return THEMES.find((t) => t.id === id) ?? THEMES[0]!
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
    'theme.font.major.latin': theme.fontTitle.latin,
    'theme.font.major.eastAsia': theme.fontTitle.ea,
    'theme.font.minor.latin': theme.fontBody.latin,
    'theme.font.minor.eastAsia': theme.fontBody.ea,
  }
}
