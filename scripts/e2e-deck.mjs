/**
 * 功能级端到端：真实调用 office_design_guide → office_deck_create → office_list
 * → office_screenshot，覆盖中文文件名，并校验渲染出的 PNG。
 *
 * 与 smoke-deck.mjs 的区别：smoke 直接驱动 officecli 命令，本脚本走「插件工具」
 * 这一层，也就是模型实际会走的路径 —— 能捕获参数校验、DeckSpec 解析、
 * 会话工作区解析、attachments 降级等工具层问题。
 *
 * 运行：node scripts/e2e-deck.mjs [theme] [outDir]
 */

import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdtempSync, readdirSync, statSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const require = createRequire(import.meta.url)
const { Context } = require('@deepseek-ai/cordis')

const THEME = process.argv[2] ?? 'business-blue'
const OUT = process.argv[3] ?? mkdtempSync(join(tmpdir(), 'dsh-officecli-e2e-'))

const log = (s) => process.stdout.write(`${s}\n`)
let failures = 0
const check = (ok, label, detail = '') => {
  log(`${ok ? '  PASS' : '  FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures += 1
}

/** 模型实际会填的 DeckSpec：中文内容、7 页、覆盖 8 种版式。 */
const DECK = {
  theme: THEME,
  footer: '端到端验收 · dsh-officecli',
  slides: [
    {
      layout: 'cover',
      eyebrow: '技术验收报告',
      title: '插件生成 PPT 能力验证',
      subtitle: '从对话指令到成品演示文稿的完整链路',
      meta: '2026-09 · 设计层自检',
    },
    { layout: 'section', number: '01', title: '问题定位', subtitle: '工具未注册是第一性根因' },
    {
      layout: 'bullets',
      title: '根因分析',
      items: [
        { title: '路由重复注册', desc: 'routes.ts 出现 32 次 register，重复 path 直接抛错中断插件加载。' },
        { title: '工具因此未挂载', desc: 'apply() 中途抛出，12 个原语工具全部没有进入注册表。' },
        { title: '模型看不到工具', desc: '没有工具可用时，模型只能返回文字描述而非生成文件。' },
      ],
    },
    {
      layout: 'cards',
      title: '三层修复方案',
      cards: [
        { tag: 'P0', title: '加载链路', desc: '删除重复注册，恢复单一前缀路由。' },
        { tag: 'P1', title: '设计层', desc: '网格、主题、版式内置于插件。' },
        { tag: 'P2', title: '视觉自检', desc: '截图回传模型，闭环修正。' },
      ],
    },
    {
      layout: 'kpi',
      title: '验收指标',
      metrics: [
        { value: '15', label: '注册工具数', note: '12 原语 + 3 设计层' },
        { value: '38→0', label: '排版问题数', note: '文字溢出全部消除' },
        { value: '960×540', label: '画布（pt）', note: '16:9 标准' },
        { value: '7', label: '渲染页数', note: '逐页视觉合格' },
      ],
    },
    {
      layout: 'compare',
      title: '修复前 vs 修复后',
      left: { title: '修复前', points: ['模型只回文字', '侧边栏无预览', '工具不可见'] },
      right: { title: '修复后', points: ['直接产出 pptx', '侧边栏实时预览', '15 个工具可用'] },
    },
    { layout: 'ending', title: '谢谢', subtitle: '端到端链路已跑通' },
  ],
}

async function main() {
  log(`主题: ${THEME}\n输出目录: ${OUT}\n`)

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

  const config = {
    ...plugin.Config(),
    officecliPath: process.env.OFFICECLI_BIN ?? 'officecli',
    workspaceDir: OUT,
    watchPort: 0,
    commandTimeoutMs: 60_000,
    batchTimeoutMs: 120_000,
  }
  ctx.plugin(plugin, config)
  await new Promise((r) => setTimeout(r, 50))

  const exec = { agent: { session: { id: 'e2e-session' } }, signal: undefined }
  const call = async (name, args) => {
    const def = defs.get(name)
    if (!def) throw new Error(`工具未注册: ${name}`)
    return await def.execute(args, exec)
  }

  // 1) 设计指南
  log('[1] office_design_guide')
  const guide = await call('office_design_guide', { section: 'spec' })
  check(typeof guide.guide === 'string' && guide.guide.length > 100, '返回 DeckSpec 说明', `${guide.guide.length} 字符`)

  // 2) 一步成稿（中文文件名）
  log('\n[2] office_deck_create（中文文件名）')
  const filename = '端到端验收-演示文稿.pptx'
  const created = await call('office_deck_create', { filename, deck: DECK, overwrite: true })
  check(
    created?.pageCount === DECK.slides.length && Number(created?.shapeCount) > 0,
    `生成 ${created?.pageCount ?? '?'} 页 / ${created?.shapeCount ?? '?'} 个形状`,
    `版式: ${(created?.layouts ?? []).join(',')}`,
  )

  // 3) 文件确实落在会话工作区
  log('\n[3] office_list')
  const listed = await call('office_list', {})
  const files = Array.isArray(listed.files) ? listed.files : []
  const hit = files.find((f) => (f.name ?? f) === filename)
  check(hit !== undefined, '工作区可见该中文名文件', `共 ${files.length} 个文件`)

  const abs = join(OUT, 'e2e-session', filename)
  check(statSync(abs).size > 10000, '文件体积合理', `${(statSync(abs).size / 1024).toFixed(0)}KB`)

  // 4) 结构性问题检查
  log('\n[4] officecli view issues')
  const issues = execFileSync(
    process.env.OFFICECLI_BIN ?? 'officecli',
    ['view', abs, 'issues', '--json'],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  )
  const issuesData = JSON.parse(issues)
  const list = Array.isArray(issuesData.data) ? issuesData.data : []
  check(list.length === 0, '无排版结构问题', `${list.length} 条`)

  // 4.5) 真实 PowerPoint 能否打开 —— officecli 自己的 issues 检不出「文件损坏」级
  // 问题（adj guide 名写错时 issues 仍为 0，但 PowerPoint 拒开），必须真开一次。
  log('\n[4.5] PowerPoint COM 打开校验')
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
  const comOut = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {
    encoding: 'utf8',
    timeout: 120_000,
  }).trim()
  const opened = /^OPEN slides=(\d+)$/m.exec(comOut)
  check(opened !== undefined, 'PowerPoint 可打开成品', comOut.split('\n')[0]?.slice(0, 120))
  if (opened) check(Number(opened[1]) === DECK.slides.length, '页数一致', `${opened[1]} 页`)

  // 5) 逐页截图（走工具层，attachments 未挂载时应优雅降级）
  log('\n[5] office_screenshot 逐页')
  const pageCount = DECK.slides.length
  let shotOk = 0
  for (let p = 1; p <= pageCount; p += 1) {
    const res = await call('office_screenshot', { filename, page: p })
    const path = res.savedPath
    if (typeof path === 'string' && statSync(path).size > 5000) {
      // PNG 魔数校验
      const head = readFileSync(path).subarray(0, 8)
      const isPng = head.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      if (isPng) shotOk += 1
      log(`      p${p}: ${(statSync(path).size / 1024).toFixed(0)}KB ${isPng ? 'PNG✓' : '非PNG✗'} image=${res.image ? '回传' : '降级(无 attachments)'}`)
    } else {
      log(`      p${p}: 截图缺失或过小`)
    }
  }
  check(shotOk === pageCount, `全部 ${pageCount} 页渲染成功`, `${shotOk}/${pageCount}`)

  // 6) render() 输出内容块结构
  log('\n[6] office_screenshot 的 render 输出')
  const renderRes = await call('office_screenshot', { filename, page: 1 })
  const blocks = defs.get('office_screenshot').output.render({ filename, page: 1 }, renderRes)
  const types = blocks.map((b) => b.type)
  check(types.includes('text'), '含文本块（自检清单）', types.join(','))
  if (renderRes.image) {
    const img = blocks.find((b) => b.type === 'image')
    check(img?.attachment?.attachmentId !== undefined, '含图片块且带 attachmentId')
  } else {
    log('      （无 attachments 服务，按预期降级为纯文本 + 磁盘路径）')
  }

  log(`\nRESULT: ${failures === 0 ? 'PASS' : `FAIL (${failures} 项)`}`)
  log(`输出目录: ${OUT}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  log(`\nRESULT: FAIL ${err instanceof Error ? err.stack : String(err)}`)
  process.exit(1)
})
