import { estimateLines, pt } from './grid.js'

// ---------------------------------------------------------------------------
// 文本高度经验公式
//
// officecli 的 `view issues` 会按「usable = h − 2×margin，need ≈ 1.19×size + 5.4」
// 判定文字溢出。这组系数来自实测标定（14 档字号 × 19 档高度共 266 个形状，
// 取首个不报警的高度做线性回归）。公式写死在这里，版式层就不用拍脑袋给高度了。
// ---------------------------------------------------------------------------

/**
 * 单行高度系数。实测标定 1.1893；一旦显式设置 lineSpacing，officecli 的
 * 判定变成 `size × 1.333 × lineSpacing`，所以统一取 1.35 并乘以 lineSpacing。
 */
const LINE_K = 1.35
/** 与字号无关的常量开销（行距/基线），实测 5.45，取 6 留余量。 */
const LINE_C = 6
/** 文本形状默认内边距（pt）。显式设置可避免 officecli 默认 inset 吃掉 7pt 可用高度。 */
export const TEXT_MARGIN = 2

/** 给定文本/字号/宽度，算出「不会触发溢出告警」的最小高度。 */
export function textHeight(
  text: string,
  size: number,
  width: number,
  margin = TEXT_MARGIN,
  lineSpacing = 1,
): number {
  const lines = Math.max(estimateLines(text, size, width), 1)
  return Math.ceil(lines * size * LINE_K * lineSpacing + LINE_C + margin * 2)
}

/** 在给定可用高度内自动缩字号，直到不溢出（保底 minSize）。 */
export function fitSize(
  text: string,
  size: number,
  width: number,
  availH: number,
  margin = TEXT_MARGIN,
  minSize = 9,
  lineSpacing = 1,
): number {
  let s = size
  while (s > minSize && textHeight(text, s, width, margin, lineSpacing) > availH) s -= 0.5
  return s
}

/**
 * 形状操作：设计层与 officecli 之间唯一的中间表示。
 *
 * 所有长度字段单位都是 **pt**（与画布 960×540pt 同坐标系），由 `toProps()`
 * 统一补上 `pt` 后缀。这一点是硬约束 —— 实测 officecli 对不带单位的裸数字
 * 一律按 EMU 解释（`x=32` 落出来是 0.0025pt），只有带单位才正确。
 */
export interface ShapeOp {
  /** 形状名。officecli 后续 `set` 定位必须靠 name（positional 索引会随 z-order 漂移）。 */
  name: string
  /** 文本内容。字面量 `\n` 会被 officecli 切成独立段落（真实换行符会残留 \\r，故统一用 \\n）。 */
  text?: string
  x: number
  y: number
  w: number
  h: number
  /** 字号（pt）。 */
  size?: number
  bold?: boolean
  italic?: boolean
  /** 文字颜色，6 位 hex 不带 `#`。 */
  color?: string
  /** 填充色，6 位 hex 或 `transparent`。 */
  fill?: string
  /** 描边，`HEX:宽度:线型`，如 `E1E4E8:1:solid`；`none` 表示无描边。 */
  line?: string
  align?: 'left' | 'center' | 'right'
  valign?: 'top' | 'middle' | 'bottom'
  /** OOXML 预设形状名，如 roundRect / ellipse / rightArrow。缺省为 rect。 */
  geometry?: string
  /**
   * 形状调节点，格式 `<guide名>:<值>`，如 `adj:4000`（取值 0–50000）。
   * guide 名由形状决定：roundRect 是 `adj`，多调节量形状才用 `adj1/adj2…`。
   * 优先用 {@link roundRectAdj} 生成，避免写错 guide 名。
   */
  adj?: string
  fontLatin?: string
  fontEa?: string
  /** 行距倍数。 */
  lineSpacing?: number
  /** 内边距（pt）。 */
  margin?: number
  /** 让 PowerPoint 在溢出时自动缩排。 */
  autoFit?: 'shrink' | 'normal'
}

/**
 * roundRect 的圆角调节点。
 *
 * OOXML 里 roundRect 的 guide 名是 **adj**（不是 adj1）。officecli 会把 adj 原样写进
 * `<a:gd name="...">`，写成 adj1 会产出 PowerPoint 判定为「文件损坏」的 pptx
 * （HRESULT 0x80070570），而 officecli 自己的 `view issues` 检查不出这个错误。
 */
export function roundRectAdj(value: number): string {
  const v = Math.max(0, Math.min(50000, Math.round(value)))
  return `adj:${v}`
}

/**
 * 修正 guide 名与形状不匹配。
 *
 * roundRect 只认 `adj`；误写成 `adj1` 会静默产出打不开的文件，所以在编译出口统一
 * 兜底，宁可纠正也不要让损坏文件落到用户手里。
 */
function normalizeAdj(adj: string, geometry: string | undefined): string {
  if (geometry !== 'roundRect') return adj
  return adj.replace(/^adj1:/, 'adj:')
}

/** 把 ShapeOp 编译成 officecli `--prop` 键值对。 */
export function toProps(op: ShapeOp): Record<string, string> {
  const p: Record<string, string> = {
    name: op.name,
    x: pt(op.x),
    y: pt(op.y),
    width: pt(op.w),
    height: pt(op.h),
  }
  if (op.text !== undefined) p.text = op.text
  if (op.size !== undefined) p.size = String(op.size)
  if (op.bold !== undefined) p.bold = op.bold ? 'true' : 'false'
  if (op.italic !== undefined) p.italic = op.italic ? 'true' : 'false'
  if (op.color) p.color = op.color
  if (op.fill) p.fill = op.fill
  if (op.line) p.line = op.line
  if (op.align) p.align = op.align
  if (op.valign) p.valign = op.valign
  if (op.geometry) p.geometry = op.geometry
  if (op.adj) p.adj = normalizeAdj(op.adj, op.geometry)
  if (op.fontLatin) p.font = op.fontLatin
  if (op.fontEa) p['font.ea'] = op.fontEa
  if (op.lineSpacing !== undefined) p.lineSpacing = String(op.lineSpacing)
  if (op.margin !== undefined) p.margin = pt(op.margin)
  if (op.autoFit) p.autoFit = op.autoFit
  return p
}

/**
 * 生成一个铺满画布的背景矩形。
 * 必须是本页第一个 add 的形状 —— 形状按插入顺序叠放（先加的在下），
 * 而 officecli 的 zorder 语义是反的（值越大越靠后），不能用来压背景。
 */
export function bgShape(name: string, fill: string): ShapeOp {
  return { name, x: 0, y: 0, w: 960, h: 540, fill, line: 'none' }
}

/** A 区标题 + 强调短横，内容页通用。 */
export function pageTitle(
  name: string,
  text: string,
  theme: { text: string; accent: string; fontTitle: { latin: string; ea: string } },
  size = 28,
): ShapeOp[] {
  return [
    {
      name: `${name}-title`,
      text,
      x: 32,
      y: 28,
      w: 896,
      h: textHeight(text, size, 896),
      size,
      bold: true,
      color: theme.text,
      fontLatin: theme.fontTitle.latin,
      fontEa: theme.fontTitle.ea,
      align: 'left',
      valign: 'middle',
      margin: TEXT_MARGIN,
    },
    {
      name: `${name}-rule`,
      x: 32,
      y: 84,
      w: 48,
      h: 4,
      fill: theme.accent,
      line: 'none',
    },
  ]
}

/** C 区页脚：左侧说明 + 右侧页码。 */
export function pageFooter(
  name: string,
  left: string,
  pageNo: number,
  theme: { muted: string; fontBody: { latin: string; ea: string } },
): ShapeOp[] {
  const size = 11
  const common = {
    size,
    color: theme.muted,
    fontLatin: theme.fontBody.latin,
    fontEa: theme.fontBody.ea,
    valign: 'middle' as const,
    margin: TEXT_MARGIN,
  }
  return [
    {
      name: `${name}-foot-l`,
      text: left,
      x: 32,
      y: 500,
      w: 700,
      h: textHeight(left, size, 700),
      align: 'left' as const,
      ...common,
    },
    {
      name: `${name}-foot-r`,
      text: String(pageNo),
      x: 732,
      y: 500,
      w: 196,
      h: textHeight(String(pageNo), size, 196),
      align: 'right' as const,
      ...common,
    },
  ]
}
