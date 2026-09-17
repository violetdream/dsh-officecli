/**
 * 画布与网格常量。
 *
 * 单位统一为 **pt**。这与 officecli 空白 pptx 的原生画布完全一致：
 * `create` 产出的画布是 12192000 × 6858000 EMU，即 960 × 540 pt（16:9）。
 * officecli 的 EmuConverter 原生接受 `xxpt` 写法，所以布局数学算出的 pt 值
 * 可以直接作为属性值下发，无需二次换算。
 *
 * 母版三区与字号阶梯直接沿用 WorkBuddy 的设计门禁（其画布为 1280×720px，
 * 本画布为 960×540pt，换算系数恰为 0.75）。
 */

/** 画布宽（pt）。 */
export const CANVAS_W = 960
/** 画布高（pt）。 */
export const CANVAS_H = 540

/** 左右页边距（pt）。 */
export const MARGIN = 32
/** 内容区宽度（pt）。 */
export const CONTENT_W = CANVAS_W - MARGIN * 2 // 896

/** 12 栏网格：栏宽 60pt、槽宽 16pt。12×60 + 11×16 = 896 ✓ */
export const COLS = 12
export const COL_W = 60
export const GUTTER = 16
/** 一栏加一个槽的步进。 */
export const COL_STEP = COL_W + GUTTER // 76

/** 基线网格：所有 y / h 对齐到 8pt。 */
export const BASELINE = 8

/** 母版 A 区（标题块）。 */
export const ZONE_A = { top: 0, bottom: 90 } as const
/** 母版 B 区（内容区）。 */
export const ZONE_B = { top: 90, bottom: 495 } as const
/** 母版 C 区（页脚条）。 */
export const ZONE_C = { top: 495, bottom: 540 } as const

/** 内容页标题（A 区内）。 */
export const TITLE = { x: MARGIN, y: 28, w: CONTENT_W, h: 46, size: 28 } as const
/** 内容区可用上下边界（B 区内留余量）。 */
export const BODY = { top: 106, bottom: 478 } as const
/** 页脚（C 区内）。 */
export const FOOTER = { x: MARGIN, y: 502, w: CONTENT_W, h: 20, size: 11 } as const

/**
 * 字号阶梯（pt）。由 WorkBuddy 的 1280×720px 阶梯 ×0.75 换算而来。
 *
 * 这是一份**只读基准**。`layouts.ts` 不直接读它，而是读 {@link typeScale}()
 * 的返回值 —— 后者可被 `style.typography` 临时替换，从而实现「整份 PPT 字号
 * 按比例缩放」而不必把缩放参数穿透到每个版式函数。
 */
export const FONT = {
  coverTitle: 54, // 45–72
  sectionTitle: 44, // 45–60，取略小以容纳中文
  anchor: 64, // 54–90 巨型数据锚点
  pageTitle: 28, // 24–30
  cardTitle: 18, // 18–22.5
  body: 16, // 16.5–21，中文取 16 更稳
  quote: 22, // 15–19.5 引文，中文放大到 22 才有分量
  caption: 13, // 脚注 / 页码 10.5–12
} as const

/** 字号阶梯类型：与 {@link FONT} 同构，但字段可变（可被样式缩放）。 */
export type TypeScale = { -readonly [K in keyof typeof FONT]: number }

/** 当前生效的字号阶梯（每次 0.5pt 量化，避免出现 12.3456 这种脏值）。 */
let currentScale: TypeScale = { ...FONT }

/** 取当前生效的字号阶梯。版式层一律走这里，不要直接读 FONT。 */
export function typeScale(): TypeScale {
  return currentScale
}

/**
 * 在 fn 执行期间替换字号阶梯，fn 结束后恢复。
 *
 * 编译是同步的，所以作用域式替换在并发会话间不会串台（renderSlide 内没有
 * await）。但仍通过 try/finally 保证异常路径一定能还原。
 *
 * @param scale - 覆盖项：数字表示绝对字号；也可传 `{ scale: 1.1 }` 整体缩放。
 */
export function withTypeScale<T>(scale: Partial<TypeScale> & { scale?: number }, fn: () => T): T {
  const prev = currentScale
  currentScale = resolveTypeScale(scale)
  try {
    return fn()
  } finally {
    currentScale = prev
  }
}

/**
 * 只算不换：给定覆盖项，算出届时会生效的字号阶梯。
 *
 * `withTypeScale` 的纯函数版。体检（lint）与评审需要知道「实际会用到多大字号」
 * 才能判断层级是否足够，但它们不能改全局状态 —— 所以这段逻辑必须独立出来，
 * 不能靠「先替换再读」。
 */
export function resolveTypeScale(scale: Partial<TypeScale> & { scale?: number }): TypeScale {
  const base = currentScale
  const factor = clampFactor(typeof scale.scale === 'number' ? scale.scale : 1)
  const next: TypeScale = { ...base }
  for (const key of Object.keys(FONT) as (keyof TypeScale)[]) {
    const override = scale[key]
    next[key] = typeof override === 'number' && Number.isFinite(override)
      ? quantize(override)
      : quantize(base[key] * factor)
  }
  return next
}

function clampFactor(f: number): number {
  return Math.max(0.6, Math.min(1.6, f))
}

/** 量化到 0.5pt，避免 officecli 拿到 13.799999 这类浮点脏值。 */
function quantize(v: number): number {
  return Math.round(v * 2) / 2
}

/** 跨 n 栏的宽度。 */
export function col(span: number): number {
  return span * COL_W + (span - 1) * GUTTER
}

/** 第 n 栏（1-based）的起始 x。 */
export function xOf(column: number): number {
  return MARGIN + (column - 1) * COL_STEP
}

/** 对齐到基线网格。 */
export function snap8(value: number): number {
  return Math.round(value / BASELINE) * BASELINE
}

/** 数值转 officecli 的 pt 字面量。 */
export function pt(value: number): string {
  return `${Math.round(value * 100) / 100}pt`
}

/**
 * 把 6 位 hex 颜色按 t 向白色（t>0）或黑色（t<0）混合，用于生成卡片底色等浅色变体。
 * 输入/输出均不带 `#`，与 officecli 的 color/fill 属性一致。
 */
export function tint(hex: string, t: number): string {
  const n = parseInt(hex, 16)
  const r = (n >> 16) & 0xff
  const g = (n >> 8) & 0xff
  const b = n & 0xff
  const target = t > 0 ? 255 : 0
  const k = Math.abs(t)
  const mix = (c: number) => Math.round(c + (target - c) * k)
  return [mix(r), mix(g), mix(b)]
    .map((c) => c.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

/**
 * 估算一段文本的显示行数，用于判断正文是否为卡片预留足够高度。
 * 中文按字宽 = 字号计算，西文按 0.55 倍；宽线宽比实际略保守。
 */
export function estimateLines(text: string, size: number, width: number): number {
  if (!text) return 0
  const w = Math.max(width, 1)
  let lines = 1
  let units = 0
  for (const ch of text) {
    if (ch === '\n') {
      lines += Math.max(1, Math.ceil(units / w))
      units = 0
      continue
    }
    units += /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch) ? size : size * 0.55
  }
  return lines + Math.max(1, Math.ceil(units / w)) - 1
}

/** 估算一块文本在给定宽度与字号下所需的行高总和（pt）。 */
export function estimateTextHeight(text: string, size: number, width: number, lineHeight = 1.25): number {
  const lines = estimateLines(text, size, width)
  return lines * size * lineHeight
}
