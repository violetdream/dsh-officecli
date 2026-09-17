// 审美检查的假阳性排查：内置主题 / 风格预设 / 主色派生 都不该报审美类警告。
const T = await import('../lib/pptx/theme.js')
const S = await import('../lib/pptx/styles.js')
const L = await import('../lib/pptx/lint.js')

/** 只保留「审美类」警告，节奏/备注类噪声不参与本次排查。 */
const AESTHETIC = ['字号层级', '可分辨的字号层级', '字体用了', '用色有', '审美禁区', '激进紫渐变']

const deckOf = (style, theme) => ({
  ...(theme ? { theme } : {}),
  style,
  slides: [
    { layout: 'cover', title: '一份用于验证的封面标题', subtitle: '副标题' },
    { layout: 'bullets', title: '内容页', items: [{ title: '要点一', desc: '说明' }] },
  ],
})

const ran = (label, spec) => {
  const r = L.lintDeck(spec)
  const hits = r.warnings.filter((w) => AESTHETIC.some((k) => w.message.includes(k)))
  console.log(
    `  ${label.padEnd(28)} 层级比 ${r.stats.typeRatio.toFixed(2)}　级数 ${r.stats.typeLevels}` +
      `　字体 ${r.stats.fontFamilies.latin}西/${r.stats.fontFamilies.ea}中　色相 ${r.stats.chromaticTokens} 种` +
      (hits.length ? `　❌ ${hits.map((h) => h.message.slice(0, 40)).join(' | ')}` : '　✓'),
  )
  return hits.length
}

let bad = 0
console.log('\n内置主题（不带风格预设）：')
for (const t of T.THEMES) bad += ran(t.id, deckOf({}, t.id))

console.log('\n风格预设：')
for (const st of S.PPT_STYLES) bad += ran(st.id, deckOf({ preset: st.id }))

console.log('\n主色派生：')
for (const hex of ['#0F5EA6', '#1F6FEB', '#7C3AED', '#00E676', '#FFE01B']) {
  bad += ran(hex, deckOf({}, hex))
}

console.log('\n应当被抓到的真问题：')
const traps = [
  ['字号层级不足（正文 40pt）', deckOf({ typography: { body: 40 } })],
  ['五种色相的配色', deckOf({ colors: { primary: '#E01B24', secondary: '#0EA5E9', accent: '#16A34A', accent5: '#7C3AED', accent6: '#F59E0B' } })],
  ['GitHub-dark 禁区', deckOf({ colors: { bg: '#0D1117', primary: '#0D1117', secondary: '#22D3EE', accent: '#A855F7', accent5: '#60A5FA' } })],
  ['选了黑底剧场却用卡片', { style: { preset: 'black-stage' }, slides: [{ layout: 'cover', title: 'x' }, { layout: 'cards', title: 't', cards: [{ title: 'a' }] }] }],
  ['无法识别的风格名', deckOf({ preset: '不存在的风格' })],
]
for (const [label, spec] of traps) {
  const r = L.lintDeck(spec)
  const hit = r.warnings.some((w) => AESTHETIC.some((k) => w.message.includes(k))) || r.warnings.length > 0
  console.log(`  ${label.padEnd(28)} ${hit ? '✓ 已抓到' : '❌ 漏了'}（${r.warnings.length} 条警告）`)
  if (!hit) bad++
}

console.log(`\n${bad === 0 ? '✅ 无假阳性、真问题全部命中' : `❌ ${bad} 项异常`}`)
process.exit(bad === 0 ? 0 : 1)
