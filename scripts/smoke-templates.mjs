/**
 * 模板 + 样式协议冒烟测试：用编译后的 lib 生成一份 8 页 PPT，覆盖
 *   - deck.template（consulting：左色轨 + "n / total" 页码 + fade 转场）
 *   - deck.style（元数据、默认转场、页码格式）
 *   - 新版式 agenda / pricing（含 highlight 渐变头部）/ swot / roadmap
 *   - hero 页 slide background 渐变（cover/section/ending）
 *   - 单页级 background / transition 覆盖
 *
 * 用法：
 *   node scripts/smoke-templates.mjs [输出目录] [模板id]
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const OUT_DIR = resolve(process.argv[2] ?? join(process.cwd(), '.smoke', 'tpl'))
const TEMPLATE = process.argv[3] ?? 'consulting'
const FILE = join(OUT_DIR, 'smoke-templates.pptx')

const { compileDeck, parseDeckSpec } = await import(
  pathToFileURL(join(process.cwd(), 'lib', 'pptx', 'deck.js')).href
)

const SPEC = {
  template: TEMPLATE,
  style: {
    meta: {
      title: '2026 年度能力报告',
      author: '技术中台',
      keywords: 'AI, office, 自动化',
      description: '模板库 + 样式协议冒烟验证',
      category: '内部汇报',
    },
    transition: 'fade',
    pageNumber: '{n} / {total}',
    footer: '技术中台 · 2026',
  },
  slides: [
    {
      layout: 'cover',
      eyebrow: 'CAPABILITY REPORT 2026',
      title: '把「专业感」\n沉淀成模板',
      subtitle: '模板 · 版式 · 样式协议三层解耦，换皮不换骨',
      meta: '技术中台 · 2026年9月',
    },
    {
      layout: 'section',
      number: '01',
      title: '报告结构',
      subtitle: '先说结论，再看数据',
    },
    {
      layout: 'agenda',
      title: '本次汇报目录',
      items: [
        { title: '核心成效', desc: '四项关键指标与去年同期对比' },
        { title: '能力矩阵', desc: '四类核心能力与覆盖范围' },
        { title: '方案对比', desc: '三档套餐与适用场景' },
        { title: 'SWOT 分析', desc: '优势、劣势、机会与威胁' },
        { title: '路线图', desc: '未来三个阶段的推进计划' },
      ],
    },
    {
      layout: 'kpi',
      title: '核心成效一览',
      metrics: [
        { value: '3.2x', label: '文档产出效率', note: '相较人工排版' },
        { value: '92%', label: '一次通过率', note: '无需人工返工' },
        { value: '18min', label: '平均交付时长', note: '从需求到成稿' },
        { value: '0', label: '格式错误', note: '近三个月累计' },
      ],
    },
    {
      layout: 'bullets',
      title: '落地要点',
      columns: 2,
      items: [
        { title: '模板与版式正交', desc: '换肤不动版式，换版式不动配色' },
        { title: '命令批量化', desc: '一次 batch 原子落盘，全程可回滚' },
        { title: '事件驱动预览', desc: '保存即通知，预览面板自动刷新' },
        { title: '深色主题校验', desc: '对比度红线逐页回归，0 问题通过' },
        { title: '密度可调', desc: '两栏 bullets 承载书稿级信息量' },
        { title: '文件名中文安全', desc: '中文名直接解析，不依赖编码假设' },
        { title: '工作区落盘', desc: '产物写入 DSH 会话工作区目录' },
        { title: '模板库可扩展', desc: '新增模板 = 主题 + 装饰 + 页码格式' },
      ],
    },
    {
      layout: 'pricing',
      title: '方案对比',
      plans: [
        { name: '基础版', price: '¥9,900/年', features: ['在线文档', '基础模板', '邮件支持'], highlight: false },
        { name: '专业版', price: '¥29,900/年', tag: '最受欢迎', features: ['全部模板库', '团队协作', '实时预览', '优先支持'], highlight: true },
        { name: '旗舰版', price: '¥59,900/年', features: ['私有化部署', '定制主题', '专属顾问'], highlight: false },
      ],
    },
    {
      layout: 'swot',
      title: 'SWOT 分析',
      s: ['模板体系完整', '渲染质量稳定', '接入成本低'],
      w: ['版式数量有限', '深色主题较少'],
      o: ['AI 生成市场扩容', '模板可交易化'],
      t: ['同类工具竞争', '用户审美疲劳'],
      background: 'F6F8FA',
    },
    {
      layout: 'roadmap',
      title: '推进路线图',
      phases: [
        { phase: '阶段一', title: '模板库落地', desc: '接入 6 套专业模板' },
        { phase: '阶段二', title: '边改边看', desc: '事件驱动实时预览' },
        { phase: '阶段三', title: '生态开放', desc: '模板市场与自定义主题' },
      ],
    },
    {
      layout: 'ending',
      title: '谢谢',
      subtitle: '欢迎提问与讨论',
    },
  ],
}

function run(args, opts = {}) {
  return new Promise((res, rej) => {
    const child = spawn('officecli', [...args, '--json'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      ...opts,
    })
    let out = ''
    let err = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    if (opts.stdin !== undefined) {
      child.stdin.on('error', () => {})
      child.stdin.end(opts.stdin)
    } else child.stdin.end()
    child.on('error', rej)
    child.on('close', (code) => res({ code, out, err }))
  })
}

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })
if (existsSync(FILE)) rmSync(FILE, { force: true })

const spec = parseDeckSpec(SPEC)
const compiled = compileDeck(spec)
console.log(`模板: ${compiled.template}  主题: ${compiled.theme.id} (${compiled.theme.name})`)
console.log(`页数: ${compiled.pageCount}  命令数: ${compiled.commands.length}`)
console.log(`版式: ${compiled.layouts.join(' → ')}`)

// 抽查关键 --prop 注入：slide background 渐变、转场、元数据
const slideSets = compiled.commands.filter((c) => c.command === 'set' && /^\/slide\[/.test(c.path ?? ''))
console.log(`slide 级 set: ${slideSets.length} 条`)
for (const s of slideSets) console.log(`  ${s.path}: ${JSON.stringify(s.props)}`)
const rootSet = compiled.commands.find((c) => c.command === 'set' && c.path === '/')
console.log(`根 set 含元数据: ${Boolean(rootSet?.props && (rootSet.props.title || rootSet.props.author))}`)

let r = await run(['create', FILE, '--type', 'pptx', '--force'])
if (r.code !== 0) {
  console.error('create 失败:', r.out || r.err)
  process.exit(1)
}

r = await run(['batch', FILE], { stdin: JSON.stringify(compiled.commands) })
let parsed = null
try {
  parsed = JSON.parse(r.out)
} catch {
  /* ignore */
}
if (!parsed?.success) {
  console.error('batch 失败:\n', r.out || r.err)
  process.exit(1)
}
const failed = (parsed.data?.results ?? []).filter((x) => x.success === false)
if (failed.length) {
  console.error(`batch 中 ${failed.length} 条失败:`)
  for (const f of failed.slice(0, 10)) console.error(`  #${f.index}: ${f.error ?? f.output}`)
  process.exit(1)
}
console.log(`batch 全部成功 (${parsed.data.results.length} 条)`)

r = await run(['save', FILE])
if (r.code !== 0) console.warn('save 警告:', r.out || r.err)

r = await run(['view', FILE, 'outline'])
const outline = JSON.parse(r.out)
console.log(`\n实际页数: ${outline.data?.totalSlides}`)

r = await run(['view', FILE, 'issues'])
const issues = JSON.parse(r.out)
const list = issues.data?.issues ?? issues.data ?? []
console.log(`结构问题: ${Array.isArray(list) ? list.length : 0}`)
if (Array.isArray(list) && list.length) {
  for (const i of list.slice(0, 10)) console.log('  -', typeof i === 'string' ? i : JSON.stringify(i))
}

// 渲染 6 页截图（1 封面渐变 / 3 目录 / 4 KPI / 5 方案对比 / 6 SWOT / 7 路线图）
const SHOT_DIR = join(OUT_DIR, 'shots')
if (!existsSync(SHOT_DIR)) mkdirSync(SHOT_DIR, { recursive: true })
for (const page of [1, 3, 4, 5, 6, 7]) {
  const png = join(SHOT_DIR, `page-${page}.png`)
  r = await run(['view', FILE, 'screenshot', '-o', png, '--page', String(page)])
  if (r.code !== 0) console.warn(`截图 page ${page} 失败:`, r.out || r.err)
  else console.log(`截图 page ${page} -> ${png}`)
}

r = await run(['close', FILE])
console.log(`\n产物: ${FILE}`)
