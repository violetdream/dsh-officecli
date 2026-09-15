/**
 * 批后修正（post-pass）。
 *
 * 有些 officecli 元素的最终属性**只有在写完盘之后才知道**，batch 阶段无法预先
 * 拼出路径。目前只有一类：
 *
 *   `--type diagram` 的 native 合成器（无头浏览器缺失时的默认路径）给流程节点
 *   固定浅蓝底 `#DAE8FC`，并且**不写显式文字色** —— 于是文字颜色继承演示文稿
 *   主题。浅色主题下没问题（深色字），但**深色主题下文字会变成浅色，浅底浅字
 *   直接不可读**（实测：#DAE8FC 底 + 主题继承来的白字）。
 *
 *   组内形状的 `@id` 由 officecli 在插入时分配，编译期拿不到，所以只能在 batch
 *   之后扫一遍 `query shape`，把「浅底 + 未显式设色」的组内形状补一个深色墨。
 *
 * 这一趟是**幂等**的：已经设过色的形状不会被再次修改。
 */

import type { OfficeCLIService } from '../service.js'

/** 组内形状的查询结果。 */
interface ShapeRow {
  path?: string
  text?: string
  format?: Record<string, unknown>
}

/** 浅色底之上统一用这个墨色 —— 对 officecli 合成器产出的所有 pastel 底色都够对比。 */
export const DIAGRAM_INK = '1A1A1A'

/**
 * 判断一个颜色是否「浅」。
 * @returns 相对亮度（0–1）；解析失败返回 undefined。
 */
export function luminance(hex: string): number | undefined {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim())
  if (!m) return undefined
  let h = m[1]!
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const n = parseInt(h, 16)
  const r = ((n >> 16) & 0xff) / 255
  const g = ((n >> 8) & 0xff) / 255
  const b = (n & 0xff) / 255
  // Rec. 709 亮度
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * 把 diagram 合成的组内形状补上深色墨，避免深色主题下「浅底浅字」。
 *
 * @returns 实际修正的形状数；查询失败时返回 0（不影响主流程）。
 */
export async function fixDiagramInk(
  cli: OfficeCLIService,
  sessionId: string,
  abs: string,
): Promise<{ fixed: number; scanned: number }> {
  const res = await cli.run<{ results?: ShapeRow[] }>(sessionId, ['query', abs, 'shape'])
  if (!res.ok) return { fixed: 0, scanned: 0 }
  const rows = res.data.results ?? []

  const targets: string[] = []
  for (const row of rows) {
    const path = row.path
    if (!path || !row.text || !path.includes('/group[')) continue
    const fmt = row.format ?? {}
    const fill = typeof fmt.fill === 'string' ? fmt.fill : undefined
    const color = fmt.color
    if (!fill) continue
    // 已有显式文字色的（我方版式产出的形状）不动
    if (color !== undefined && color !== null && color !== '') continue
    const lum = luminance(fill)
    if (lum === undefined || lum < 0.6) continue
    targets.push(path)
  }
  if (targets.length === 0) return { fixed: 0, scanned: rows.length }

  const commands = targets.map((path) => ({
    command: 'set',
    path,
    props: { color: DIAGRAM_INK },
  }))
  const batch = await cli.run<{ results?: Array<{ success?: boolean }> }>(sessionId, ['batch', abs], {
    stdin: JSON.stringify(commands),
  })
  if (!batch.ok) return { fixed: 0, scanned: rows.length }
  // 按**实际成功条数**统计：空 stdin 或部分失败时不能谎报 fixed
  const results = batch.data.results
  const fixed = Array.isArray(results)
    ? results.filter((r) => r.success !== false).length
    : targets.length
  return { fixed, scanned: rows.length }
}
