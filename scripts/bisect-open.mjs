/**
 * 二分定位「哪些版式生成的 pptx 无法被 PowerPoint 打开」。
 *
 * 背景：officecli 基线文件（1 页 1 形状）能被 PowerPoint 正常打开，但设计层生成的
 * 多页 deck 打不开。逐个版式生成单页文件，再配合 scripts/open-check.ps1 用 COM
 * 逐个尝试打开，即可定位到具体版式/属性。
 *
 * 运行：node scripts/bisect-open.mjs <outDir>
 */

import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const OUT = process.argv[2] ?? 'C:\\temp\\bisect'
mkdirSync(OUT, { recursive: true })

const { compileDeck } = await import(pathToFileURL(join(root, 'lib', 'pptx', 'deck.js')).href)
const { LAYOUT_IDS } = await import(pathToFileURL(join(root, 'lib', 'pptx', 'layouts.js')).href)

/** 每个版式一份最小合法内容。 */
const SAMPLES = {
  cover: { layout: 'cover', eyebrow: '眉标', title: '主标题', subtitle: '副标题一行', meta: '2026' },
  section: { layout: 'section', number: '01', title: '章节标题', subtitle: '说明' },
  bullets: { layout: 'bullets', title: '要点页', items: [{ title: '要点一', desc: '描述文字描述文字' }, { title: '要点二', desc: '描述文字描述文字' }] },
  cards: { layout: 'cards', title: '卡片页', cards: [{ tag: 'A', title: '卡片一', desc: '描述' }, { tag: 'B', title: '卡片二', desc: '描述' }] },
  kpi: { layout: 'kpi', title: '指标页', metrics: [{ value: '92%', label: '占比', note: '备注' }, { value: '3.2x', label: '倍数' }] },
  steps: { layout: 'steps', title: '流程页', steps: [{ title: '第一步', desc: '说明' }, { title: '第二步', desc: '说明' }] },
  compare: { layout: 'compare', title: '对比页', left: { title: '左侧', points: ['甲', '乙'] }, right: { title: '右侧', points: ['丙', '丁'] } },
  timeline: { layout: 'timeline', title: '时间线', events: [{ date: 'Q1', title: '节点一', desc: '说明' }, { date: 'Q2', title: '节点二' }] },
  quote: { layout: 'quote', quote: '引文内容引文内容引文内容', author: '作者', role: '职务' },
  table: { layout: 'table', title: '表格页', headers: ['列一', '列二'], rows: [['甲', '乙'], ['丙', '丁']] },
  ending: { layout: 'ending', title: '谢谢', subtitle: '再见' },
}

const BIN = process.env.OFFICECLI_BIN ?? 'officecli'
const built = []

for (const id of LAYOUT_IDS) {
  const spec = SAMPLES[id]
  if (!spec) { process.stdout.write(`SKIP ${id}（无样例）\n`); continue }
  const file = join(OUT, `${id}.pptx`)
  try {
    const compiled = compileDeck({ theme: 'business-blue', slides: [spec] })
    execFileSync(BIN, ['create', file, '--type', 'pptx'], { stdio: 'pipe' })
    execFileSync(BIN, ['batch', file], { input: JSON.stringify(compiled.commands), stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 })
    built.push({ id, file, commands: compiled.commands.length })
    process.stdout.write(`BUILT ${id} (${compiled.commands.length} 命令)\n`)
  } catch (err) {
    process.stdout.write(`BUILD_FAIL ${id}: ${err.message?.slice(0, 200)}\n`)
  }
}

// 额外：完整 7 页 deck（含 cover+多种版式），用于判断是「单页问题」还是「多页累积」
process.stdout.write(`\n生成 ${built.length} 个单页文件，输出目录: ${OUT}\n`)
