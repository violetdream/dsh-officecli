// 临时探针：验证 OKLCH 色彩推导的明度关系与可读性。用后即删。
const m = await import('../lib/pptx/theme.js')

const rel = (hex) => {
  const n = parseInt(hex, 16)
  const f = (v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255)
}
const contrast = (a, b) => {
  const la = rel(a)
  const lb = rel(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}
const ok = (hex) => {
  const o = m.hexToOklch(hex)
  return `L${o.L.toFixed(3)} C${o.C.toFixed(3)} H${o.h.toFixed(0)}`
}
/** 色相夹角（0–180），不是朴素相减。 */
const dh = (a, b) => {
  const d = Math.abs(((a - b) % 360 + 360) % 360)
  return d > 180 ? 360 - d : d
}
const tint = (hex, t) => {
  const n = parseInt(hex, 16)
  const target = t > 0 ? 255 : 0
  const k = Math.abs(t)
  const mix = (c) => Math.round(c + (target - c) * k)
  return [mix((n >> 16) & 255), mix((n >> 8) & 255), mix(n & 255)]
    .map((c) => c.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

let bad = 0
for (const input of ['#1F6FEB', '#0F5EA6', '#E50914', '#1ED760', '#8B1A1A', '#00E676', '#7C3AED', '#F5F0E8', '#FFE01B']) {
  const t = m.themeFromPrimary(input)
  console.log(`\n=== ${input} → dark=${t.dark} ===`)
  console.log(
    `  primary #${t.primary} ${ok(t.primary)}\n` +
      `  secondary #${t.secondary} ${ok(t.secondary)}\n` +
      `  accent #${t.accent} ${ok(t.accent)}\n` +
      `  accent5 #${t.accent5} ${ok(t.accent5)}  accent6 #${t.accent6} ${ok(t.accent6)}\n` +
      `  bg #${t.bg}  text #${t.text} ${ok(t.text)}  muted #${t.muted}`,
  )
  const ps = m.hexToOklch(t.primary)
  const ss = m.hexToOklch(t.secondary)
  const as = m.hexToOklch(t.accent)
  const c1 = contrast(t.text, t.bg)
  const c2 = contrast(t.primary, t.bg)
  const heroInk = m.onPrimary(t)
  // hero 是 primary→加深 28% 的渐变，取中点当代表值
  const heroMid = tint(t.primary, -0.14)
  const c3 = contrast(heroInk, heroMid)
  console.log(
    `  ΔH 主-辅 ${dh(ss.h, ps.h).toFixed(0)}° | 主-强调 ${dh(as.h, ps.h).toFixed(0)}° | ΔL 主-强调 ${Math.abs(ps.L - as.L).toFixed(2)}  ` +
      `(${(dh(as.h, ps.h) >= 60 || Math.abs(ps.L - as.L) >= 0.3) ? '可分辨 ✓' : '不可分辨 ✗'})`,
  )
  console.log(`  对比度 text/bg ${c1.toFixed(2)}  primary/bg ${c2.toFixed(2)}  hero(${heroInk === 'FFFFFF' ? '白字' : '深字'})/主色块 ${c3.toFixed(2)}`)
  if (c1 < 7) { console.log('  ⚠️ 正文对比度不足'); bad++ }
  if (c3 < 4.5) { console.log('  ⚠️ hero 前景对比度不足'); bad++ }
}

console.log('\n=== 内置主题的 hero 前景色（回归检查）===')
for (const t of m.THEMES) {
  const heroMid = tint(t.primary, -0.14)
  console.log(`  ${t.id.padEnd(18)} primary #${t.primary} → ${m.onPrimary(t) === 'FFFFFF' ? '白字' : '深字'}  对比 ${contrast(m.onPrimary(t), heroMid).toFixed(2)}`)
}

console.log('\n=== rebaseColor：8B1A1A 体系 → 1F6FEB ===')
for (const slot of ['A8351A', 'D4AF37', 'FFFFFF', 'F7F4EC', '6B7280', '2A2A33']) {
  console.log(`  #${slot} → #${m.rebaseColor('8B1A1A', '1F6FEB', slot)}`)
}

console.log(`\n${bad === 0 ? 'ALL OK ✓' : `发现 ${bad} 处可读性问题`}`)
