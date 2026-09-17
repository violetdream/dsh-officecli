// 定位 smoke-templates 里 batch 崩溃到哪一条命令。
// officecli 在「写错误信息」时自身抛 .NET 异常，真实错误被吞掉，只能二分前缀。
// 用法: node scripts/probe-tpl.mjs
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const OUT_DIR = resolve('.smoke', 'probe-tpl')
const FILE = join(OUT_DIR, 'probe.pptx')

const { compileDeck, parseDeckSpec } = await import(
  pathToFileURL(join(process.cwd(), 'lib', 'pptx', 'deck.js')).href
)

const SPEC = {
  template: 'consulting',
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
    { layout: 'section', number: '01', title: '报告结构', subtitle: '先说结论，再看数据' },
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
    { layout: 'ending', title: '谢谢', subtitle: '欢迎提问与讨论' },
  ],
}

const run = (args, stdin) =>
  new Promise((res) => {
    const child = spawn('officecli', [...args, '--json'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    let out = ''
    let err = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.stdin.on('error', () => {})
    child.stdin.end(stdin ?? '')
    child.on('error', (e) => res({ code: -1, out: '', err: String(e) }))
    child.on('close', (code) => res({ code, out, err }))
  })

/** 提交 [0, n) 前缀，返回 true=全部成功。 */
async function tryPrefix(cmds, n) {
  rmSync(FILE, { force: true })
  const c = spawnSync('officecli', ['create', FILE, '--type', 'pptx', '--force', '--json'], { encoding: 'utf8' })
  if (c.status !== 0) return { ok: false, why: `create 失败: ${c.stdout || c.stderr}` }
  const r = await run(['batch', FILE], JSON.stringify(cmds.slice(0, n)))
  let parsed = null
  try {
    parsed = JSON.parse(r.out)
  } catch { /* ignore */ }
  if (!parsed?.success) {
    return { ok: false, why: (r.out || r.err || '').slice(0, 400) }
  }
  const failed = (parsed.data?.results ?? []).filter((x) => x.success === false)
  if (failed.length) {
    const f = failed[0]
    return { ok: false, why: `#${f.index}: ${f.error ?? f.output}` }
  }
  return { ok: true }
}

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })
const spec = parseDeckSpec(SPEC)
const compiled = compileDeck(spec)
const cmds = compiled.commands
console.log(`命令数: ${cmds.length}`)
writeFileSync(join(OUT_DIR, 'commands.json'), JSON.stringify(cmds, null, 2), 'utf8')

const all = await tryPrefix(cmds, cmds.length)
console.log(`全量: ${all.ok ? 'OK' : `FAIL — ${all.why}`}`)
if (all.ok) process.exit(0)

// 二分求最小失败前缀
let lo = 0 // 已知 OK
let hi = cmds.length // 已知 FAIL
while (hi - lo > 1) {
  const mid = Math.floor((lo + hi) / 2)
  const r = await tryPrefix(cmds, mid)
  console.log(`  前缀 ${mid}: ${r.ok ? 'OK' : 'FAIL'}`)
  if (r.ok) lo = mid
  else hi = mid
}
const bad = cmds[hi - 1]
console.log(`\n首条失败命令 #${hi}:`)
console.log(JSON.stringify(bad, null, 2))
const only = await tryPrefix([bad], 1)
console.log(`单独提交该命令: ${only.ok ? 'OK（说明是上下文相关）' : `FAIL — ${only.why}`}`)
