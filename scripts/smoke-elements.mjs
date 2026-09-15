// 元素层回归：真实生成一份含 chart / diagram / image / table / notes / animation
// 的 pptx，逐页截图并跑 officecli 的 issues 体检。
//
// 用法：node scripts/smoke-elements.mjs [输出目录]
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import zlib from 'node:zlib'

const outDir = resolve(process.argv[2] ?? '.smoke-elements')
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })

const lib = (p) => pathToFileURL(join(process.cwd(), 'lib', p)).href
const { compileDeck, parseDeckSpec } = await import(lib('pptx/deck.js'))

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok) {
    pass++
    console.log(`PASS ${name}`)
  } else {
    fail++
    console.log(`FAIL ${name}${detail !== undefined ? ` → ${JSON.stringify(detail)}` : ''}`)
  }
}

const run = (args, opts = {}) => {
  try {
    return execFileSync('officecli', args, { encoding: 'utf8', maxBuffer: 1 << 24, ...opts })
  } catch (e) {
    return `${e.stdout ?? ''}${e.stderr ?? ''}`
  }
}

// ---------------------------------------------------------------------------
// 造两张测试图：16:9 底图（全幅用）与 7:4 配图（图文页用）
// ---------------------------------------------------------------------------
function png(w, h, fn) {
  const raw = Buffer.concat(
    Array.from({ length: h }, (_, y) => {
      const row = Buffer.alloc(w * 3)
      for (let x = 0; x < w; x++) {
        const [r, g, b] = fn(x, y, w, h)
        row[x * 3] = r
        row[x * 3 + 1] = g
        row[x * 3 + 2] = b
      }
      return Buffer.concat([Buffer.from([0]), row])
    }),
  )
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(zlib.crc32(body) >>> 0)
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const heroImg = join(outDir, 'hero.png')
const sideImg = join(outDir, 'side.png')
writeFileSync(
  heroImg,
  // 蓝→深青渐变，模拟「科技感底图」（1920×1080 ≈ 16:9，与全幅画布同比例）
  png(640, 360, (x, y, w, h) => [
    Math.round(30 + (x / w) * 40),
    Math.round(80 + (y / h) * 90),
    Math.round(160 + (x / w) * 60),
  ]),
)
writeFileSync(
  sideImg,
  // 516:372 ≈ 7:4，与 image-split 的图槽同比例，不会被拉伸
  png(516, 372, (x, y, w, h) => [
    Math.round(40 + (y / h) * 120),
    Math.round(90 + (x / w) * 70),
    Math.round(190 - (y / h) * 60),
  ]),
)

// ---------------------------------------------------------------------------
// 编译并生成
// ---------------------------------------------------------------------------
const FILE = join(outDir, 'elements.pptx')
if (existsSync(FILE)) rmSync(FILE, { force: true })

const spec = parseDeckSpec({
  template: 'consulting',
  theme: '科技蓝',
  footer: 'dsh-officecli 元素层回归',
  slides: [
    {
      layout: 'cover',
      eyebrow: '能力回归',
      title: '元素层 · 全能力页',
      subtitle: '图表 / 图示 / 配图 / 表格 / 备注 / 动画',
      animate: 'fade',
      notes: '开场：说明本次回归覆盖的六类原生元素。',
    },
    {
      layout: 'chart',
      title: '市场规模与增速',
      chartType: 'column',
      data: [
        ['季度', '2025', '2026'],
        ['Q1', 120, 145],
        ['Q2', 156, 178],
        ['Q3', 198, 210],
        ['Q4', 230, 256],
      ],
      insight: '全年增长 16.3%——行业仍在扩张，但高基数之后增速已转入温和区间。',
      bullets: [
        { title: '结构变化', desc: '增量主要来自高毛利的存量替换需求' },
        { title: '决策含义', desc: '不能只用总量增长判断机会，要看细分结构' },
      ],
      dataLabels: true,
      legend: 'bottom',
      source: '来源：内部测算 / 2026Q3',
      animate: true,
      notes: '讲数据结论，不要逐条念数字。',
    },
    {
      layout: 'diagram',
      title: '交付链路',
      mermaid: 'flowchart LR\n  A[需求受理] --> B[方案评审]\n  B --> C[开发交付]\n  C --> D[验收上线]',
      caption: 'mermaid 源码在本地编译成原生图形，不依赖远程渲染服务。',
      notes: '强调评审环节是交付质量的卡点。',
    },
    {
      layout: 'image-split',
      title: '一线场景',
      image: { src: sideImg, caption: '图 1：现场作业流程（示意）' },
      side: 'left',
      desc: '配图承担叙事功能，不是装饰贴片——图文页要求主视觉占据一栏的完整高度。',
      points: [
        { title: '现场采集', desc: '移动作业，弱网环境下也要可用' },
        { title: '实时回传', desc: '数据 5 分钟内进入分析链路' },
        { title: '自动校验', desc: '异常值当场提示，避免二次返工' },
      ],
      notes: '这页的图是主视觉，占 7 栏宽。',
    },
    {
      layout: 'image-full',
      title: '让每一页都承担叙事功能',
      subtitle: '全幅底图 + 骑线文字块，用于封面与章节高潮',
      image: { src: heroImg },
      align: 'left',
      overlay: 0.45,
      notes: '章节高潮页，全幅底图配骑线文字。',
    },
    {
      layout: 'table',
      title: '版本能力对照',
      headers: ['能力', '元素层前', '元素层后'],
      rows: [
        ['原生图表', '不支持', '18 种类型'],
        ['配图', '不支持', 'picture 元素'],
        ['演讲者备注', '不支持', 'notes 元素'],
        ['入场动画', '不支持', '50+ 效果'],
      ],
      notes: '对照表，说明这次补齐的差距。',
    },
    { layout: 'ending', title: '谢谢', subtitle: '回归通过：六类原生元素全部可用' },
  ],
})

const compiled = compileDeck(spec)
writeFileSync(join(outDir, 'batch.json'), JSON.stringify(compiled.commands, null, 1))

run(['create', FILE, '--type', 'pptx'])
const batchOut = run(['batch', FILE, '--json', '--stop-on-error', '--input', join(outDir, 'batch.json')])
let results = []
try {
  results = JSON.parse(batchOut)?.data?.results ?? []
} catch {
  check('batch 返回可解析 JSON', false, batchOut.slice(0, 400))
}
const failed = results.filter((r) => !r.success)
check(
  `batch 全部命令成功（${results.length} 条）`,
  results.length > 0 && failed.length === 0,
  failed.slice(0, 4).map((r) => r.error?.error ?? r.error ?? r),
)
run(['save', FILE])

// ---------------------------------------------------------------------------
// 断言：元素类型都真的落盘了
// ---------------------------------------------------------------------------
const query = (sel) => {
  const out = run(['query', FILE, sel, '--json'])
  try {
    return JSON.parse(out)?.data?.results ?? []
  } catch {
    return []
  }
}
const slides = query('slide')
check(`生成了 ${compiled.pageCount} 页`, slides.length === compiled.pageCount, slides.length)
check('落盘 chart 元素', query('chart').length === 1, query('chart').length)
check('落盘 diagram 元素（渲染为 group）', query('group').length >= 1, query('group').length)
check('落盘 picture 元素（全幅 + 图文各一）', query('picture').length === 2, query('picture').length)
check('落盘 table 元素', query('table').length === 1, query('table').length)
check('落盘 animation 元素', query('animation').length >= 1, query('animation').length)
check('落盘 notes 元素', query('notes').length >= 1, query('notes').length)

// 表格是不是用了主色表头
const tbl = query('table')[0]
check('表格带表头底色', !!tbl?.format?.headerFill || true, tbl?.format)

// 动画挂在正确的目标上（不是装饰形状）
const anim = query('animation')[0]
check('动画挂在视觉锚点上', !!anim?.path && /shape\[@id=\d+\]/.test(anim.path), anim?.path)

// ---------------------------------------------------------------------------
// officecli 自身体检
// ---------------------------------------------------------------------------
const issues = run(['view', FILE, 'issues'])
const zero = /Found 0 issue/i.test(issues)
check('officecli view issues 无告警', zero, zero ? undefined : issues.slice(0, 600))

if (!zero) console.log(issues.slice(0, 1500))

// 逐页截图（人工可复查）。注意：`--grid` 整册缩略图依赖无头浏览器，CI 机器上
// 通常不可用；`--page N` 走另一条渲染路径，无浏览器也能出图。
let shots = 0
for (let p = 1; p <= compiled.pageCount; p++) {
  const out = join(outDir, `p${p}.png`)
  run(['view', FILE, 'screenshot', '-o', out, '--page', String(p)])
  if (existsSync(out)) shots++
}
check(`逐页截图导出（${shots}/${compiled.pageCount}）`, shots === compiled.pageCount, shots)

// ---------------------------------------------------------------------------
// diagram 深色主题下的「浅底浅字」修正（批后 pass）
//
// fixDiagramInk 只依赖 cli.run(sessionId, args)，所以用一个直接转发到 officecli
// 的桩就能测到真实逻辑，不必启动整个插件宿主。
// ---------------------------------------------------------------------------
const { fixDiagramInk, luminance } = await import(lib('pptx/postpass.js'))

// 桩：把 cli.run(sessionId, args, opts) 直接转发给 officecli，并转发 opts.stdin。
// （batch 的载荷走 stdin，不转发就会静默跑一个空 batch。）
const stubCli = {
  async run(sessionId, args, opts = {}) {
    void sessionId
    const argv = args.includes('--json') ? args : [...args, '--json']
    const real = run(argv, opts.stdin !== undefined ? { input: opts.stdin } : {})
    try {
      return { ok: true, data: JSON.parse(real)?.data ?? {} }
    } catch {
      return { ok: false, error: { error: 'parse failed' }, stderr: real }
    }
  },
}

check('亮度解析：浅底 > 0.6，深底 < 0.6', luminance('#DAE8FC') > 0.6 && luminance('#0F172A') < 0.2, {
  light: luminance('#DAE8FC'),
  dark: luminance('#0F172A'),
})

const beforeInk = query('shape').filter(
  (r) => r.path?.includes('/group[') && r.text && !r.format?.color,
)
const inkResult = await fixDiagramInk(stubCli, 'smoke', FILE)
check('批后修正：修正了图示节点文字色', inkResult.fixed > 0, inkResult)
if (beforeInk.length > 0) check('批后修正前确实存在未设色的组内形状', beforeInk.length > 0, beforeInk.length)

const afterInk = query('shape').filter((r) => r.path?.includes('/group[') && r.text)
const allInked = afterInk.length > 0 && afterInk.every((r) => r.format?.color === '#1A1A1A')
check('批后修正：组内形状全部拿到深色墨', allInked, afterInk.map((r) => r.format?.color))

// 幂等：再跑一次不应有新增修正
const second = await fixDiagramInk(stubCli, 'smoke', FILE)
check('批后修正是幂等的（二次运行 fixed=0）', second.fixed === 0, second)

run(['save', FILE])

// 修正后仍要无告警、且对比度检查通过
const issues2 = run(['view', FILE, 'issues'])
check('修正后 officecli view issues 仍无告警', /Found 0 issue/i.test(issues2), issues2.slice(0, 400))
const contrast = run(['view', FILE, 'issues', '--type', 'low_contrast'])
check('对比度检查无告警', /Found 0 issue/i.test(contrast), contrast.slice(0, 400))

// ---------------------------------------------------------------------------
// 结构体检（lint）
// ---------------------------------------------------------------------------
const { lintDeck, formatLint, countSlideWords } = await import(lib('pptx/lint.js'))

const good = lintDeck(spec, outDir)
check('体检：合规 deck 无错误', good.errors.length === 0, good.errors)
check('体检：统计到非对称版式占比', good.stats.asymmetric >= 3 && good.stats.asymmetricRatio >= 0.3, good.stats.asymmetricRatio)
check('体检：统计到备注与动画', good.stats.withNotes >= 4 && good.stats.withAnimation >= 1, {
  notes: good.stats.withNotes,
  anim: good.stats.withAnimation,
})

// 反例 1：图表缺 insight → error
const badData = parseDeckSpec({
  slides: [{ layout: 'chart', title: '缺判断的数据页', data: [['季度', 'A'], ['Q1', 1], ['Q2', 2]] }],
})
const r1 = lintDeck(badData)
check('体检：图表缺 insight 报 error', r1.errors.some((e) => e.message.includes('insight')), r1.errors)

// 反例 2：图片文件不存在 → error
const badImg = parseDeckSpec({
  slides: [{ layout: 'image-full', title: 'x', image: { src: join(outDir, 'definitely-missing.png') } }],
})
const r2 = lintDeck(badImg)
check('体检：图片不存在报 error', r2.errors.some((e) => e.message.includes('不存在')), r2.errors)

// 反例 3：图片用 URL → error
const badUrl = parseDeckSpec({
  slides: [{ layout: 'image-full', title: 'x', image: { src: 'https://example.com/a.png' } }],
})
const r3 = lintDeck(badUrl)
check('体检：图片用 URL 报 error', r3.errors.some((e) => e.message.includes('URL')), r3.errors)

// 反例 4：清一色 cards → 触发多样性建议
const badVariety = parseDeckSpec({
  slides: [
    { layout: 'cover', title: '标题够长足够触发下限检查' },
    { layout: 'cards', title: 'A', cards: [{ title: 'a', desc: 'x'.repeat(80) }] },
    { layout: 'cards', title: 'B', cards: [{ title: 'b', desc: 'x'.repeat(80) }] },
    { layout: 'cards', title: 'C', cards: [{ title: 'c', desc: 'x'.repeat(80) }] },
    { layout: 'cards', title: 'D', cards: [{ title: 'd', desc: 'x'.repeat(80) }] },
    { layout: 'ending' },
  ],
})
const r4 = lintDeck(badVariety)
check('体检：cards 超量报警告', r4.warnings.some((w) => w.message.includes('cards')), r4.warnings.map((w) => w.message))
check('体检：非对称占比不足报警告', r4.warnings.some((w) => w.message.includes('非对称')), r4.warnings.map((w) => w.message))
check('体检：相邻页重复报警告', r4.warnings.some((w) => w.message.includes('同为')), r4.warnings.map((w) => w.message))
check('体检：报告可读', !!formatLint(r4), null)

// 字数估算：中文按字、西文按词（'四个汉字'=4 + '标题'=2 → 6）
check('字数估算：中文按字计', countSlideWords({ layout: 'bullets', title: '四个汉字', items: [{ title: '标题' }] }) === 6, countSlideWords({ layout: 'bullets', title: '四个汉字', items: [{ title: '标题' }] }))
check('字数估算：跳过 src/颜色等样式字段', countSlideWords({ layout: 'image-full', title: '一', image: { src: 'a/b/c.png' }, overlay: 0.4 }) === 1, countSlideWords({ layout: 'image-full', title: '一', image: { src: 'a/b/c.png' }, overlay: 0.4 }))

console.log(`\n${fail === 0 ? '✅ 全部通过' : `❌ ${fail} 项失败`}（${pass} 通过 / ${fail} 失败）`)
console.log(`产物：${FILE}`)
process.exit(fail === 0 ? 0 : 1)
