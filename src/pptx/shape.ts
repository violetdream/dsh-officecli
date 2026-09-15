import { estimateLines, pt, typeScale } from './grid.js'

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

  // ---------------------------------------------------------------------------
  // 增强样式（officecli 1.0.x 实测支持的 --prop 面）
  // ---------------------------------------------------------------------------
  /** 渐变填充：`C1-C2[-ANGLE]`（角度为度，如 `-90` / `135`）。与 fill 二选一。 */
  gradient?: string
  /** 图案填充：`preset[:fg[:bg]]`，如 `diagBrick:FF0000:FFFFFF`。 */
  pattern?: string
  /** 填充不透明度 0–1（需配合 fill / gradient / pattern 使用）。 */
  opacity?: number
  /** 描边宽度（pt），与 line 的宽度段等价但可独立设置。 */
  lineWidth?: number
  /** 描边虚线：solid/dot/dash/dashDot/lgDash 等。 */
  lineDash?: string
  /** 线端样式：round/flat/square。 */
  lineCap?: string
  /** 拐角样式：round/bevel/miter。 */
  lineJoin?: string
  /** 复合线型：sng/dbl/thickThin/thinThick/tri。 */
  cmpd?: string
  /** 起点箭头：triangle/stealth/diamond/oval/arrow。 */
  headEnd?: string
  /** 终点箭头：triangle/stealth/diamond/oval/arrow。 */
  tailEnd?: string
  /** 文字字形填充（作用于字形本身，与 color 二选一；渐变/图案亦可用）。 */
  textFill?: string
  /** 文字高亮背景色，6 位 hex 不带 `#`。 */
  highlight?: string
  /** 大小写渲染：all（全大写）/ small（小型大写）。 */
  cap?: 'all' | 'small' | 'none'
  /** 字距（pt），负值收紧。 */
  spacing?: number
  /** 删除线：single/double。 */
  strike?: 'single' | 'double'
  /** 列表样式：bullet/numbered/alpha/roman/none/<char>。 */
  list?: string
  /** 点击跳转目标：绝对 URI / `slide[N]` / 命名动作。 */
  link?: string
  /** 悬浮提示（需与 link 同批设置）。 */
  tooltip?: string
  /** 段落前间距（pt）。 */
  spaceBefore?: number
  /** 段落后间距（pt）。 */
  spaceAfter?: number
  /** 形状文字方向：horizontal/vertical90/vertical270/stacked。 */
  textDirection?: string
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
  // 增强样式
  if (op.gradient !== undefined) p.gradient = op.gradient
  if (op.pattern !== undefined) p.pattern = op.pattern
  if (op.opacity !== undefined) p.opacity = String(op.opacity)
  if (op.lineWidth !== undefined) p.lineWidth = pt(op.lineWidth)
  if (op.lineDash !== undefined) p.lineDash = op.lineDash
  if (op.lineCap !== undefined) p.lineCap = op.lineCap
  if (op.lineJoin !== undefined) p.lineJoin = op.lineJoin
  if (op.cmpd !== undefined) p.cmpd = op.cmpd
  if (op.headEnd !== undefined) p.headEnd = op.headEnd
  if (op.tailEnd !== undefined) p.tailEnd = op.tailEnd
  if (op.textFill !== undefined) p.textFill = op.textFill
  if (op.highlight !== undefined) p.highlight = op.highlight
  if (op.cap !== undefined && op.cap !== 'none') p.cap = op.cap
  if (op.spacing !== undefined) p.spacing = String(op.spacing)
  if (op.strike !== undefined) p.strike = op.strike
  if (op.list !== undefined) p.list = op.list
  if (op.link !== undefined) p.link = op.link
  if (op.tooltip !== undefined) p.tooltip = op.tooltip
  if (op.spaceBefore !== undefined) p.spaceBefore = pt(op.spaceBefore)
  if (op.spaceAfter !== undefined) p.spaceAfter = pt(op.spaceAfter)
  if (op.textDirection !== undefined) p.textDirection = op.textDirection
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
  size = typeScale().pageTitle,
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

/**
 * C 区页脚：左侧说明 + 右侧页码。
 * @param right - 右侧页码文字；null 表示不显示页码（如「无页码」模板）。
 */
export function pageFooter(
  name: string,
  left: string,
  pageNo: number,
  theme: { muted: string; fontBody: { latin: string; ea: string } },
  right: string | null = String(pageNo),
): ShapeOp[] {
  // 2pt 差是因为页码要与左侧页脚在同一视觉重量上，又要保留数字的可辨识度
  const size = typeScale().caption
  const common = {
    size,
    color: theme.muted,
    fontLatin: theme.fontBody.latin,
    fontEa: theme.fontBody.ea,
    valign: 'middle' as const,
    margin: TEXT_MARGIN,
  }
  const out: ShapeOp[] = [
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
  ]
  if (right !== null) {
    out.push({
      name: `${name}-foot-r`,
      text: right,
      x: 732,
      y: 500,
      w: 196,
      h: textHeight(right, size, 196),
      align: 'right' as const,
      ...common,
    })
  }
  return out
}
