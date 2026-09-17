/**
 * 设计层端到端：真实调用新增的设计流程工具，生成 pptx 并用 PowerPoint 真开一次。
 *
 * 覆盖（对应用户诉求「把方法层和风格层抄过来」）：
 *   [1] office_design_guide 新节：styles / form / slop / review，且 review 不进全量
 *   [2] office_deck_create 带 style.preset → 主题真的换成 style-<id>，色彩论证非空
 *   [3] 品牌色 + preset 同时给 → 色相迁移（主题 id 带 hex）
 *   [4] 未知 preset → 回退但不报错，回执里 presetMissed 有值
 *   [5] office_deck_directions → 3 个方向初稿落盘（中文后缀文件名）+ PowerPoint 可开
 *   [6] office_deck_review → 机械维度打分 + 风格 anti-pattern 清单
 *
 * 运行：node scripts/e2e-design.mjs [outDir]
 */

import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync, mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const require = createRequire(import.meta.url)
const { Context } = require('@deepseek-ai/cordis')

const OUT = process.argv[2] ?? mkdtempSync(join(tmpdir(), 'dsh-officecli-design-'))
const SESSION = 'design-session'

const log = (s) => process.stdout.write(`${s}\n`)
let failures = 0
const check = (ok, label, detail = '') => {
  log(`${ok ? '  PASS' : '  FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures += 1
}

/** PowerPoint COM 真开一次：officecli 的 issues 检不出「文件损坏」级问题。 */
function openWithPowerPoint(abs) {
  const ps = [
    `$ErrorActionPreference='Stop'`,
    `try {`,
    `  $app = New-Object -ComObject PowerPoint.Application`,
    `  $p = $app.Presentations.Open("${abs.replace(/\\/g, '\\\\')}", $true, $false, $false)`,
    `  Write-Output ("OPEN slides=" + $p.Slides.Count)`,
    `  $p.Close(); $app.Quit()`,
    `} catch {`,
    `  Write-Output ("FAIL " + $_.Exception.Message)`,
    `  try { $app.Quit() } catch {}`,
    `}`,
  ].join('\n')
  const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {
    encoding: 'utf8',
    timeout: 180_000,
  }).trim()
  const m = /^OPEN slides=(\d+)$/m.exec(out)
  return { ok: m !== undefined, slides: m ? Number(m[1]) : 0, raw: out.split('\n')[0] ?? '' }
}

const DECK = {
  footer: '设计层验收 · dsh-officecli',
  slides: [
    { layout: 'cover', eyebrow: 'DESIGN LAYER', title: '原生生成的视觉系统', subtitle: '方法层与风格层移植后的整链路验证', meta: '2026-09' },
    { layout: 'section', number: '01', title: '风格库', subtitle: '17 套流派，各带 anti-pattern' },
    {
      layout: 'cards',
      title: '三档温度',
      cards: [
        { tag: '大胆', title: '打破沉闷', desc: '高对比、超大字号、版面张力优先。' },
        { tag: '中性', title: '稳妥主力', desc: '信息量与秩序兼顾，通用场景首选。' },
        { tag: '安静', title: '克制留白', desc: '低饱和、细字重，阅读型稿件适用。' },
      ],
    },
    {
      layout: 'kpi',
      title: '硬约束',
      metrics: [
        { value: '17', label: '风格预设', note: '大胆 6 / 中性 6 / 安静 5' },
        { value: '3.0', label: 'hero 对比度下限', note: '大字号 WCAG' },
        { value: '4.5', label: '正文对比度下限', note: 'normal text' },
        { value: '≥60°', label: '色相最小间隔', note: 'OKLCH ΔH' },
      ],
    },
    { layout: 'ending', title: '谢谢', subtitle: '设计层已接入原生生成链路' },
  ],
}

async function main() {
  log(`输出目录: ${OUT}\n`)
  const plugin = await import(pathToFileURL(join(root, 'lib', 'index.js')).href)

  const defs = new Map()
  const routes = new Map()
  const ctx = new Context()
  ctx.provide('tools', { register: (d) => defs.set(d.name, d) })
  ctx.provide('webServer', {
    register: (r) => {
      if (r?.path !== undefined) {
        if (routes.has(r.path)) throw new Error(`duplicate route: ${r.path}`)
        routes.set(r.path, r)
      }
    },
  })

  ctx.plugin(plugin, {
    ...plugin.Config(),
    officecliPath: process.env.OFFICECLI_BIN ?? 'officecli',
    workspaceDir: OUT,
    watchPort: 0,
    commandTimeoutMs: 60_000,
    batchTimeoutMs: 120_000,
  })
  await new Promise((r) => setTimeout(r, 50))

  const exec = { agent: { session: { id: SESSION } }, signal: undefined }
  const call = async (name, args) => {
    const def = defs.get(name)
    if (!def) throw new Error(`工具未注册: ${name}`)
    return await def.execute(args, exec)
  }
  const render = (name, args, value) => defs.get(name).output.render(args, value)

  // ---- [0] 新工具已注册 ----
  log('[0] 工具注册')
  for (const n of ['office_deck_directions', 'office_deck_review']) {
    check(defs.has(n), `${n} 已注册`)
  }

  // ---- [1] 指南新节 ----
  log('\n[1] office_design_guide 新节')
  const want = {
    styles: ['风格', 'anti-pattern'],
    form: ['form 推导五问', '视觉母题'],
    slop: ['反 AI slop', '色彩推导'],
    review: ['一票否决'],
  }
  for (const [sec, marks] of Object.entries(want)) {
    const r = await call('office_design_guide', { section: sec })
    const g = r.guide ?? ''
    const miss = marks.filter((m) => !g.includes(m))
    check(g.length > 300 && miss.length === 0, `section=${sec}`, `${g.length} 字符${miss.length ? `，缺 ${miss.join('/')}` : ''}`)
  }
  const full = await call('office_design_guide', {})
  const fg = full.guide ?? ''
  check(fg.includes('form 推导五问') && fg.includes('反 AI slop'), '全量含 form + slop', `${fg.length} 字符`)
  check(!fg.includes('一票否决'), '全量**不含** review（按需索取）')

  const one = await call('office_design_guide', { style: '大字报风格' })
  check(one.style === 'neo-swiss' && /anti-pattern/.test(one.guide), 'style 参数取单套详情（中文别名）', one.style)
  let threw = false
  try {
    await call('office_design_guide', { style: '根本不存在的风格' })
  } catch (e) {
    threw = /可用 id/.test(String(e.message))
  }
  check(threw, '未知风格名给出可用 id 提示')

  // ---- [2] preset 生效 ----
  log('\n[2] office_deck_create 带 style.preset')
  const presetFile = '风格验收-bento.pptx'
  const c1 = await call('office_deck_create', {
    filename: presetFile,
    deck: { ...DECK, style: { preset: 'bento', colorRationale: '内容讲设计系统，选便当格：格子本身即"系统"的隐喻。' } },
    overwrite: true,
  })
  check(c1.theme === 'style-bento', '主题切换为风格预设', c1.theme)
  check(c1.preset === 'bento', '回执 preset', String(c1.preset))
  check(c1.presetMissed === '', '无 presetMissed', String(c1.presetMissed))
  check(/系统|便当/.test(c1.colorRationale ?? ''), '色彩论证透传', (c1.colorRationale ?? '').slice(0, 40))
  check(c1.pageCount === DECK.slides.length, `生成 ${c1.pageCount} 页`)
  const p1 = join(OUT, SESSION, presetFile)
  const opened1 = openWithPowerPoint(p1)
  check(opened1.ok, 'PowerPoint 可打开预设稿', opened1.raw)
  if (opened1.ok) check(opened1.slides === DECK.slides.length, '页数一致', `${opened1.slides} 页`)

  // ---- [3] preset + 品牌主色 → 色相迁移 ----
  log('\n[3] preset + 品牌主色（色相迁移）')
  const brandFile = '风格验收-品牌色.pptx'
  const c2 = await call('office_deck_create', {
    filename: brandFile,
    deck: { ...DECK, style: { preset: 'bento', colors: { primary: '#0B4F9E' } } },
    overwrite: true,
  })
  check(c2.theme === 'style-bento-0B4F9E', '主题 id 带品牌色', c2.theme)
  check(/0B4F9E/.test(c2.colorRationale ?? ''), '论证记录品牌色替换')
  check(openWithPowerPoint(join(OUT, SESSION, brandFile)).ok, 'PowerPoint 可打开品牌色稿')

  // ---- [4] 未知 preset 回退 ----
  log('\n[4] 未知 preset 优雅回退')
  const c3 = await call('office_deck_create', {
    filename: '风格验收-回退.pptx',
    deck: { ...DECK, style: { preset: '根本不存在的风格' } },
    overwrite: true,
  })
  check(c3.presetMissed === '根本不存在的风格', '回执 presetMissed 有值', String(c3.presetMissed))
  check(c3.pageCount === DECK.slides.length, '仍正常生成', `${c3.pageCount} 页`)

  // ---- [5] 三方向初稿 ----
  log('\n[5] office_deck_directions 三方向初稿')
  const dirFile = '方向验收.pptx'
  const d = await call('office_deck_directions', { filename: dirFile, deck: DECK, overwrite: true })
  const temps = d.files.map((f) => f.temp)
  check(d.files.length === 3, '产出 3 个方向', d.files.map((f) => `${f.temp}:${f.style}`).join('  '))
  check(new Set(temps).size === 3, '三个方向温度档不重复', temps.join('/'))
  check(d.files.every((f) => f.rationale && f.rationale.length > 20), '每个方向都有色彩论证')
  const paths = d.files.map((f) => join(OUT, SESSION, f.filename))
  const sizes = paths.map((p) => (existsSync(p) ? statSync(p).size : 0))
  check(sizes.every((s) => s > 10_000), '三个文件都已落盘且体积合理', sizes.map((s) => `${(s / 1024).toFixed(0)}KB`).join(' '))
  check(paths.every((p) => /方向[abc]\.pptx$/.test(p)), '中文方向后缀文件名被接受', paths.map((p) => p.split(SESSION)[1]).join(' '))
  const openedD = openWithPowerPoint(paths[0])
  check(openedD.ok, 'PowerPoint 可打开方向初稿', `${openedD.raw} · ${paths[0].split(SESSION)[1]}`)
  const dirRender = render('office_deck_directions', { filename: dirFile, deck: DECK }, d)
  check(dirRender[0].text.includes('office_screenshot'), 'render 引导先截图给用户看')

  // ---- [6] 评审 ----
  log('\n[6] office_deck_review 设计评审')
  const rv = await call('office_deck_review', {
    deck: { ...DECK, style: { preset: 'bento' } },
    observations: '第 3 页三张卡片等高，标题层级清晰。',
  })
  check(typeof rv.score === 'number' && rv.score > 0 && rv.score <= 10, `评分 ${rv.score}`, rv.band)
  check(rv.mechanical?.length === 3, '返回 3 个机械维度', (rv.mechanical ?? []).map((m) => m.name).join('/'))
  check(rv.report.includes('一票否决') && rv.report.includes('anti-pattern'), '报告含否决规则与风格 anti-pattern')
  check(rv.report.includes('第 3 页'), '观察已并入报告')
  check(/投屏/.test(rv.report) && /投屏/.test(rv.mechanical[2].name + rv.mechanical[2].basis), 'auto 推定按投屏稿评（5 页）')
  const rvReading = await call('office_deck_review', { deck: { ...DECK, style: { preset: 'bento' } }, focus: 'reading' })
  check(/阅读/.test(rvReading.report) && /阅读/.test(rvReading.mechanical[2].name), 'focus=reading 切换判定口径')

  log(`\nRESULT: ${failures === 0 ? 'PASS' : `FAIL (${failures} 项)`}`)
  log(`输出目录: ${OUT}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  log(`\nRESULT: FAIL ${err instanceof Error ? err.stack : String(err)}`)
  process.exit(1)
})
