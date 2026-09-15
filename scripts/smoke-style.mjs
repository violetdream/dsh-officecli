/**
 * 三个优化方向的回归测试（脱离 DSH 运行时，直接跑编译后的 lib）。
 *
 *   方向一：自然语言/主色 → 主题，style.colors / fonts / typography 注入
 *   方向二：WatchManager 跟随模式把 watch 切到 Agent 刚改的文件
 *   方向三：内置模板扩充 + 用户自定义模板（JSON）加载与 `extends` 继承
 *
 * 用法：
 *   node scripts/smoke-style.mjs [输出目录]
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const OUT_DIR = resolve(process.argv[2] ?? join(process.cwd(), '.smoke'))
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })

const lib = (p) => import(pathToFileURL(join(process.cwd(), 'lib', ...p.split('/'))).href)
const { compileDeck, parseDeckSpec } = await lib('pptx/deck.js')
const { findTheme, normalizeHex } = await lib('pptx/theme.js')
const { allTemplates, refreshTemplates, getTemplate } = await lib('pptx/templates.js')
const { WatchManager } = await lib('watch.js')

let failures = 0
function check(name, cond, detail) {
  if (cond) console.log(`PASS ${name}`)
  else {
    failures++
    console.error(`FAIL ${name}`, detail ?? '')
  }
}

// ---------------------------------------------------------------------------
// 方向一：主题解析
// ---------------------------------------------------------------------------
console.log('\n== 方向一：自然语言 → 主题 ==')
{
  const cases = [
    ['tech-cyan', '科技蓝风格'],
    ['tech-cyan', '用科技蓝'],
    ['gov-red', '政务红'],
    ['gov-red', '党政机关那种中国红'],
    ['business-blue', '商务蓝'],
    ['academic-crimson', '学术深红'],
    ['warm-orange', '暖橙'],
    ['minimal-gray', '极简灰'],
    ['nature-green', '自然绿 ESG'],
    ['luxury-black', '黑金'],
    ['business-blue', 'business-blue'],
    ['business-blue', 'Business Blue'],
  ]
  for (const [expect, input] of cases) {
    const t = findTheme(input)
    check(`"${input}" → ${expect}`, t?.id === expect, t?.id)
  }
  const derived = findTheme('#0F5EA6')
  check('主色派生主题', derived?.id === 'custom-0F5EA6', derived?.id)
  check('主色派生出辅色且与主色不同', Boolean(derived && derived.secondary !== derived.primary), derived?.secondary)
  check('非法输入返回 undefined', findTheme('随便乱写一通xyz') === undefined)
  check('空输入返回 undefined', findTheme('') === undefined)
  check('3 位缩写展开', normalizeHex('#abc') === 'AABBCC', normalizeHex('#abc'))
}

// ---------------------------------------------------------------------------
// 方向三：模板库（内置 + 自定义）
// ---------------------------------------------------------------------------
console.log('\n== 方向三：模板库 ==')
const builtins = allTemplates().filter((t) => !t.custom)
check(`内置模板 ≥ 12 套（当前 ${builtins.length}）`, builtins.length >= 12)
for (const id of ['tech-keynote', 'data-report', 'warm-consumer', 'training-course', 'esg-green', 'startup-pitch']) {
  check(`新增模板 ${id}`, Boolean(getTemplate(id)))
}

const tplDir = join(tmpdir(), 'dsh-officecli-tpl-smoke')
if (!existsSync(tplDir)) mkdirSync(tplDir, { recursive: true })
const tplFile = join(tplDir, 'templates.json')
writeFileSync(
  tplFile,
  JSON.stringify(
    {
      templates: [
        {
          id: 'corp-vi',
          name: '公司标准汇报',
          description: '深蓝主色 + 底部金线',
          extends: 'consulting',
          theme: 'business-blue',
          contentDecor: { rail: true, footerRule: true, badge: true },
          layouts: ['cover', 'bullets', 'ending'],
          style: {
            colors: { primary: '0B4F9E', accent: 'C8A45C' },
            fonts: { title: '微软雅黑', body: '等线' },
            typography: { scale: 1.05 },
          },
        },
        { id: '###', name: '非法 id' },
      ],
    },
    null,
    2,
  ),
  'utf8',
)
process.env.DSH_OFFICECLI_TEMPLATES = tplFile
const res = refreshTemplates()
check('自定义模板已加载', Boolean(getTemplate('corp-vi')), res.errors)
check('非法 id 被拦下并记录错误', res.errors.some((e) => e.includes('合法 id')), res.errors)
{
  const t = getTemplate('corp-vi')
  check('extends 继承出了 themeId/装饰', t?.themeId === 'business-blue' && t?.contentDecor?.rail === true, t)
  check('自定义模板带样式覆盖', t?.style?.colors?.primary === '0B4F9E', t?.style)
  check('继承后不再残留 extends 链标记', t?.extends === undefined, t?.extends)
}

// ---------------------------------------------------------------------------
// 方向一（续）：样式注入真的进到 batch 命令里
// ---------------------------------------------------------------------------
console.log('\n== 方向一：样式注入落进 --prop ==')
const DSLIDE = {
  slides: [
    { layout: 'cover', title: '样式注入验证', subtitle: '副标题一行', meta: '2026' },
    {
      layout: 'cards',
      title: '三张卡片',
      cards: [
        { title: '卡片一', desc: '这里是一段用于验证字号缩放与配色的说明文字。', tag: 'A' },
        { title: '卡片二', desc: '第二段说明文字，长度适中，用于观察文本框高度是否重算。', tag: 'B' },
        { title: '卡片三', desc: '第三段说明文字，同样用于验证。', tag: 'C' },
      ],
    },
    { layout: 'ending' },
  ],
}
{
  const spec = parseDeckSpec({
    ...DSLIDE,
    template: 'corp-vi',
    style: { colors: { text: '111111' }, fonts: { body: '等线' }, typography: { scale: 1.2 } },
  })
  const compiled = compileDeck(spec)
  const setRoot = compiled.commands[0]
  check('自定义模板色值进根主题', setRoot.props['theme.color.accent1'] === '0B4F9E', setRoot.props['theme.color.accent1'])
  check('DeckSpec.style 覆盖模板色', setRoot.props['theme.color.dk1'] === '111111', setRoot.props['theme.color.dk1'])
  check('字体覆盖进根主题', setRoot.props['theme.font.minor.eastAsia'] === '等线', setRoot.props['theme.font.minor.eastAsia'])
  const sizes = compiled.commands
    .filter((c) => c.command === 'add' && c.type === 'shape' && c.props?.size)
    .map((c) => Number(c.props.size))
  check('字号按 1.2 倍缩放（页面标题 ≈ 33.6）', sizes.some((s) => Math.abs(s - 33.6) < 0.6), sizes.slice(0, 6))
  check('装饰形状含 badge/footerRule', compiled.commands.some((c) => String(c.props?.name ?? '').includes('decor-badge')))
}

// ---------------------------------------------------------------------------
// 端到端：真跑 officecli，落盘并用 view issues 校验无溢出
// ---------------------------------------------------------------------------
console.log('\n== 端到端：生成 pptx 并校验 ==')
function run(args, opts = {}) {
  return new Promise((res, rej) => {
    const child = spawn('officecli', [...args, '--json'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, ...opts })
    let out = ''
    let err = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.stdin.on('error', () => {})
    if (opts.stdin !== undefined) child.stdin.end(opts.stdin)
    else child.stdin.end()
    child.on('error', rej)
    child.on('close', (code) => res({ code, out, err }))
  })
}

async function build(file, deck) {
  // officecli 官方惯用法：close -> rm -> create -> batch -> save -> close。
  // 少了前置 close，文件可能被上一次运行留下的 resident 钉住，create 会因
  // 「无法移入回收站」而失败。
  if (existsSync(file)) {
    await run(['close', file])
    rmSync(file, { force: true })
  }
  const spec = parseDeckSpec(deck)
  const compiled = compileDeck(spec)
  let r = await run(['create', file, '--type', 'pptx', '--force'])
  if (r.code !== 0) throw new Error(`create 失败: ${r.out || r.err}`)
  r = await run(['batch', file], { stdin: JSON.stringify(compiled.commands) })
  let parsed = null
  try { parsed = JSON.parse(r.out) } catch { /* ignore */ }
  if (!parsed?.success) throw new Error(`batch 失败: ${r.out || r.err}`)
  const failed = (parsed.data?.results ?? []).filter((x) => x.success === false)
  if (failed.length) throw new Error(`batch ${failed.length} 条失败: ${JSON.stringify(failed.slice(0, 3))}`)
  await run(['save', file])
  await run(['close', file])
  return { compiled, batchCount: parsed.data.results.length }
}

async function issuesOf(file) {
  const r = await run(['view', file, 'issues'])
  try {
    const p = JSON.parse(r.out)
    return p.data?.issues ?? p.data ?? []
  } catch {
    return ['<无法解析>']
  }
}

const cases = [
  ['vibe-tech.pptx', { ...DSLIDE, style: { vibe: '科技蓝风格', typography: { scale: 1.2 } } }],
  ['vibe-gov.pptx', { ...DSLIDE, theme: '党政中国红', footer: '内部材料' }],
  ['hex-primary.pptx', { ...DSLIDE, theme: '#0F5EA6', style: { fonts: { title: '微软雅黑' } } }],
  ['custom-tpl.pptx', { ...DSLIDE, template: 'corp-vi' }],
  ['scale-small.pptx', { ...DSLIDE, theme: '极简灰', style: { typography: { scale: 0.85 } } }],
]

for (const [name, deck] of cases) {
  const file = join(OUT_DIR, name)
  try {
    const { compiled, batchCount } = await build(file, deck)
    const issues = await issuesOf(file)
    check(
      `${name}：${compiled.theme.id} / ${batchCount} 条命令 / 溢出类问题 ${issues.length}`,
      issues.length === 0,
      issues.slice(0, 5),
    )
  } catch (e) {
    check(`${name} 构建`, false, e instanceof Error ? e.message : String(e))
  }
}

// ---------------------------------------------------------------------------
// 方向二：watch 跟随
// ---------------------------------------------------------------------------
console.log('\n== 方向二：watch 跟随模式 ==')
{
  const a = join(OUT_DIR, 'vibe-tech.pptx')
  const b = join(OUT_DIR, 'custom-tpl.pptx')
  if (!existsSync(a) || !existsSync(b)) {
    check('跟随测试需要前一步的产物', false)
  } else {
    const mgr = new WatchManager({ officecliPath: 'officecli', watchPort: 0 })
    try {
      const port = await mgr.ensure('smoke-style', a)
      check(`watch 已启动 (port ${port})`, port > 0)
      check('未开启跟随时不抢焦', (await mgr.applyUpdate('smoke-style', b)) === undefined)
      mgr.setFollow('smoke-style', null)
      const r = await mgr.applyUpdate('smoke-style', b)
      check('开启跟随后切到目标文件', r?.switched === true, r)
      const st = mgr.status('smoke-style')
      check('status 反映跟随状态', st?.following === true && st.file === b, st)
      check('重复提醒同一文件不重复切换', (await mgr.applyUpdate('smoke-style', b))?.switched === false)
      check('同文件更新会原地重载', (await mgr.applyUpdate('smoke-style', b))?.refreshed === true)
      mgr.clearFollow('smoke-style')
      check('关闭跟随后不再切换', (await mgr.applyUpdate('smoke-style', a)) === undefined)
    } catch (e) {
      check('watch 跟随流程', false, e instanceof Error ? e.message : String(e))
    } finally {
      await mgr.dispose()
    }
  }
}

console.log(`\n${failures === 0 ? '✅ 全部通过' : `❌ ${failures} 项失败`}`)
process.exit(failures === 0 ? 0 : 1)
