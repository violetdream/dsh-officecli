/**
 * 风格对比 demo：同一份内容分别套 3 套风格（大胆 / 中性 / 安静），逐页截图。
 *
 * 用途是「看得见的验收」—— 风格层移植后，成品差异应该全部来自视觉系统本身，
 * 而不是内容不同。所以三份稿子的 slides 完全一致，只有 style.preset 不同。
 *
 * 用法：node scripts/demo-styles.mjs [输出目录]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const OUT = resolve(process.argv[2] ?? join('.smoke', 'demo'))
const SHOTS = join(OUT, 'shots')
for (const d of [OUT, SHOTS]) if (!existsSync(d)) mkdirSync(d, { recursive: true })

const { compileDeck, parseDeckSpec } = await import(
  pathToFileURL(join(process.cwd(), 'lib', 'pptx', 'deck.js')).href
)

/** 三套风格：温度档各取一条，其余内容完全一致。 */
const VARIANTS = [
  { preset: 'neo-swiss', label: '大胆 · 新瑞士大字报' },
  { preset: 'bento', label: '中性 · Bento 便当格' },
  { preset: 'institutional-swiss', label: '安静 · 瑞士机构极简' },
]

const SLIDES = [
  {
    layout: 'cover',
    eyebrow: 'DESIGN LAYER',
    title: '设计从内容\n长出来',
    subtitle: 'form 推导 → 风格选型 → 色彩论证，三步都在插件里完成',
    meta: '2026 · 原生 pptx 生成链路',
  },
  {
    layout: 'kpi',
    title: '硬约束一览',
    metrics: [
      { value: '17', label: '风格预设', note: '大胆 / 中性 / 安静三档' },
      { value: '4.5', label: '正文对比度', note: 'WCAG normal text 下限' },
      { value: '≥60°', label: '色相最小间隔', note: 'OKLCH 感知均匀空间' },
      { value: '12', label: '结构体检项', note: '审美 5 项 + 风格 3 项' },
    ],
  },
  {
    layout: 'cards',
    title: '三层各管什么',
    cards: [
      { tag: '方法', title: 'form 五问', desc: '版式为什么是这一版，由内容回答而不是由模板回答。' },
      { tag: '风格', title: '17 套流派', desc: '每套带配色锚点、字体策略与明确排除的 anti-pattern。' },
      { tag: '校验', title: '三层体检', desc: '结构层拦硬伤，审美层量层级，风格层对 anti-pattern。' },
    ],
  },
  { layout: 'ending', title: '同一份内容，三种气质', subtitle: '差异全部来自视觉系统' },
]

const run = (args) =>
  execFileSync('officecli', [...args, '--json'], { encoding: 'utf8', maxBuffer: 1 << 24 })

const results = []
for (const v of VARIANTS) {
  const file = join(OUT, `demo-${v.preset}.pptx`)
  rmSync(file, { force: true })
  const spec = parseDeckSpec({
    style: { preset: v.preset, footer: 'dsh-officecli · 风格对比' },
    slides: SLIDES,
  })
  const compiled = compileDeck(spec)
  run(['create', file, '--type', 'pptx', '--force'])
  const batch = execFileSync('officecli', ['batch', file, '--json'], {
    input: JSON.stringify(compiled.commands),
    encoding: 'utf8',
    maxBuffer: 1 << 24,
  })
  const parsed = JSON.parse(batch)
  if (!parsed?.success) throw new Error(`${v.preset} batch 失败: ${batch.slice(0, 400)}`)
  run(['save', file])

  const shots = []
  for (const page of [1, 2]) {
    const png = join(SHOTS, `${v.preset}-p${page}.png`)
    run(['view', file, 'screenshot', '-o', png, '--page', String(page)])
    shots.push(png)
  }
  results.push({ ...v, file, theme: compiled.theme.id, name: compiled.theme.name, shots })
  console.log(`${v.label}\n  theme=${compiled.theme.id} (${compiled.theme.name})\n  ${file}\n`)
}

console.log('截图:')
for (const r of results) for (const s of r.shots) console.log(`  ${s}`)
