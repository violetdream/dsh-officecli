// 风格库与色彩推导的自检脚本。
// 用法: node scripts/smoke-styles.mjs
const S = await import('../lib/pptx/styles.js')
const T = await import('../lib/pptx/theme.js')

let fail = 0
const bad = (msg) => {
  console.log(`  ❌ ${msg}`)
  fail++
}

console.log(`\n风格库：${S.PPT_STYLES.length} 条\n${'='.repeat(78)}`)
for (const st of S.PPT_STYLES) {
  const p = st.palette
  const theme = S.applyStyle(st, { ...T.THEMES[0], dark: st.dark })
  const cBody = T.contrastRatio(p.text, p.bg)
  const cAccent = T.contrastRatio(p.accent, p.bg)
  const heroInk = T.onPrimary(theme)
  const cHero = T.contrastRatio(heroInk, p.primary)
  // 色板里至少要有一组能拉开的色（同色相多阶的"单色系统"因此也能通过）
  const dSec = T.deltaE(p.primary, p.secondary)
  const dAcc = T.deltaE(p.primary, p.accent)
  const spread = Math.max(dSec, dAcc)
  console.log(
    `\n${st.id.padEnd(21)} ${st.name}`,
    `\n  [${st.temp}/${st.density}] 正文/底 ${cBody.toFixed(1)}　强调/底 ${cAccent.toFixed(1)}${st.accentOnPlate ? '(压色块用)' : ''}　hero ${heroInk === 'FFFFFF' ? '白字' : '深字'} ${cHero.toFixed(1)}`,
    `\n  色差 ΔE 主-辅 ${dSec.toFixed(2)} 主-强调 ${dAcc.toFixed(2)} → 最大 ${spread.toFixed(2)}`,
    `\n  字号 封面${st.typography?.coverTitle ?? 54}/页${st.typography?.pageTitle ?? 28}/正文${st.typography?.body ?? 16}　推荐 ${st.prefer.length} 禁 ${st.avoid.length}`,
  )
  if (cBody < 4.5) bad(`正文对比度不足 ${cBody.toFixed(2)}（正文属 normal text，需 ≥4.5）`)
  if (!st.accentOnPlate && cAccent < 3) bad(`强调色对比度不足 ${cAccent.toFixed(2)}（需 ≥3）`)
  if (cHero < 3) bad(`hero 前景对比度不足 ${cHero.toFixed(2)}（需 ≥3，large text）`)
  if (spread < 0.15) bad(`色板内没有可分辨的一组色（最大 ΔE ${spread.toFixed(2)}，需 ≥0.15）`)
  const overlap = st.prefer.filter((l) => st.avoid.includes(l))
  if (overlap.length > 0) bad(`prefer 与 avoid 冲突：${overlap.join(',')}`)
  if (!st.rationale || st.rationale.length < 20) bad('缺少色彩论证')
}

console.log(`\n${'='.repeat(78)}\n别名解析抽查`)
for (const q of ['大字报风格', '黑底发布会', '便当格', '麦肯锡风', 'tufte', '纯文字宣言', '研报风', '不存在的风格']) {
  const hit = S.findStyle(q)
  console.log(`  ${q.padEnd(12)} → ${hit ? `${hit.id}（${hit.name}）` : '未命中（会回退到无风格）'}`)
}
if (S.findStyle('不存在的风格') !== undefined) bad('不存在的风格应当解析为 undefined')

console.log('\n三方向推荐（按内容关键词）')
for (const content of [
  '2026 年公司融资路演 BP，包含 TAM 分析、竞品对比与年度复盘数据',
  'AI 芯片技术架构与开发者 SDK 发布，包含性能指标与工程实践',
  '新员工文化价值观培训课件，讲公司的制度与宣言',
]) {
  const picks = S.pickDirections(content)
  console.log(`  「${content.slice(0, 20)}…」→ ${picks.map((d) => `${d.temp}:${d.style.id}`).join('  ')}`)
  if (picks.length < 3) bad(`三方向不足 3 条：${picks.length}`)
  if (new Set(picks.map((d) => d.style.id)).size !== picks.length) bad('三方向出现重复风格')
}

console.log('\nhero 渐变归属（风格必须接管封面，不得继承基底主题）')
for (const st of S.PPT_STYLES) {
  const t = S.applyStyle(st, { ...T.THEMES[0], dark: st.dark })
  const hero = T.heroBackground(t)
  const leaked = hero === T.THEMES[0].heroGradient
  console.log(`  ${st.id.padEnd(21)} ${hero}${leaked ? '  ⚠️ 来自基底 business-blue' : ''}`)
  if (leaked) bad(`${st.id} 的 hero 渐变继承了基底主题（封面会变成商务蓝）`)
  if (!hero.startsWith(t.primary) && hero !== st.heroGradient) {
    bad(`${st.id} 的 hero 渐变既不是本风格自带、也没从本风格主色派生`)
  }
}

console.log('\n品牌色迁移（Bento 风格 + 公司主色 #0B4F9E）')
const bento = S.getStyle('bento')
const reb = S.applyStyle(bento, { ...T.THEMES[0], dark: false }, { primary: '#0B4F9E' })
for (const k of ['primary', 'secondary', 'accent', 'bg', 'text', 'muted', 'accent5', 'accent6']) {
  console.log(`  ${k.padEnd(10)} #${reb[k]}${reb[k] === bento.palette[k] ? '  (中性，未迁移)' : ''}`)
}
for (const k of ['bg', 'muted', 'accent6']) {
  if (reb[k] !== bento.palette[k]) bad(`中性槽 ${k} 不该跟着主色迁移（#${bento.palette[k]} → #${reb[k]}）`)
}
if (reb.primary !== '0B4F9E') bad('品牌主色未落到 primary')
if (!reb.colorRationale?.includes('0B4F9E')) bad('品牌色迁移未写进色彩论证')

console.log(`\n${fail === 0 ? '✅ 风格库全部自检通过' : `❌ ${fail} 项未通过`}`)
process.exit(fail === 0 ? 0 : 1)
