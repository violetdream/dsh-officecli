/**
 * 设计层冒烟测试：直接用编译后的 lib 生成一份 7 页 PPT，落盘到指定目录。
 *
 * 用法：
 *   node scripts/smoke-deck.mjs [输出目录] [主题id]
 *
 * 这是脱离 DSH 运行时验证设计层的方法 —— 插件工具里的编译逻辑与本脚本共用
 * 同一份 lib/pptx/*，所以这里生成正确就说明工具里也会正确。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const OUT_DIR = resolve(process.argv[2] ?? join(process.cwd(), '.smoke'))
const THEME = process.argv[3] ?? 'business-blue'
const FILE = join(OUT_DIR, 'smoke-deck.pptx')

const { compileDeck, parseDeckSpec } = await import(
  pathToFileURL(join(process.cwd(), 'lib', 'pptx', 'deck.js')).href
)

const SPEC = {
  theme: THEME,
  footer: 'AI 能力建设 · 2026',
  slides: [
    {
      layout: 'cover',
      eyebrow: '2026 ANNUAL REVIEW',
      title: '让 AI 真正\n走进日常办公',
      subtitle: '从文档自动化到设计级产出，一次讲清楚我们做了什么',
      meta: '技术中台 · 2026年9月',
    },
    {
      layout: 'section',
      number: '01',
      title: '我们解决了什么问题',
      subtitle: '现状、痛点与机会窗口',
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
      layout: 'cards',
      title: '四项核心能力',
      cards: [
        { tag: 'CAPABILITY 01', title: '语义化编辑', desc: '按文档结构而非坐标定位，改动不会牵一发动全身。' },
        { tag: 'CAPABILITY 02', title: '设计层编排', desc: '内置主题令牌与版式模板，坐标由插件计算，模型只填内容。' },
        { tag: 'CAPABILITY 03', title: '实时预览', desc: '文件变更后自动刷新侧边栏，所见即所得的编辑闭环。' },
        { tag: 'CAPABILITY 04', title: '视觉自检', desc: '渲染成图回传给模型自查，最多三轮自动修正排版问题。' },
      ],
    },
    {
      layout: 'steps',
      title: '落地路径',
      steps: [
        { title: '接入', desc: '打通文档读写通道' },
        { title: '抽象', desc: '沉淀版式与主题' },
        { title: '编排', desc: '一次成稿' },
        { title: '自检', desc: '看图自动修正' },
      ],
    },
    {
      layout: 'timeline',
      title: '里程碑',
      events: [
        { date: 'Q1', title: '原型验证', desc: '打通 docx/xlsx/pptx 读写' },
        { date: 'Q2', title: '设计层', desc: '主题令牌与版式模板' },
        { date: 'Q3', title: '预览闭环', desc: '侧边栏实时回显' },
        { date: 'Q4', title: '规模推广', desc: '全公司铺开' },
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
console.log(`主题: ${compiled.theme.id} (${compiled.theme.name})`)
console.log(`页数: ${compiled.pageCount}  命令数: ${compiled.commands.length}`)
console.log(`版式: ${compiled.layouts.join(' → ')}`)

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
  for (const f of failed.slice(0, 5)) console.error(`  #${f.index}: ${f.error ?? f.output}`)
  process.exit(1)
}
console.log(`batch 全部成功 (${parsed.data.results.length} 条)`)

r = await run(['save', FILE])
if (r.code !== 0) console.warn('save 警告:', r.out || r.err)

r = await run(['close', FILE])

// 结构校验
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

console.log(`\n产物: ${FILE}`)
