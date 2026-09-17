/**
 * 回归总跑：按顺序执行全部 smoke / e2e 脚本，汇总结果。
 *
 * 为什么需要它：这些脚本分散在 scripts/ 下，单跑要记名字、要一条条看输出；
 * 在 PowerShell 里串跑又会被子进程的 stderr 误判成错误而中断链路。用 node 驱动
 * 一次跑完，结尾给一张 PASS/FAIL 表。
 *
 * 用法：
 *   node scripts/regress.mjs                  # 跑全部
 *   node scripts/regress.mjs styles e2e-deck  # 只跑名字含这些片段的
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const LOG_DIR = join(root, '.smoke', 'regress')

/** 顺序有讲究：单元级在前，越往后越贵（端到端要开 PowerPoint）。 */
const SUITE = [
  ['smoke-style.mjs', '主题/模板/样式注入协议'],
  ['smoke-styles.mjs', '风格库 + 色彩推导自检'],
  ['probe-lint.mjs', '审美层体检（假阳性/真问题）'],
  ['smoke-templates.mjs', '模板 + 样式协议端到端'],
  ['smoke-deck.mjs', '版本式编译 + 溢出体检'],
  ['smoke-elements.mjs', 'chart/diagram/image/table/notes'],
  ['e2e-deck.mjs', '工具层端到端 + PowerPoint 开验'],
  ['e2e-design.mjs', '设计层（预设/方向/评审）+ PowerPoint 开验'],
]

const filters = process.argv.slice(2)
const picked = filters.length > 0 ? SUITE.filter(([f]) => filters.some((q) => f.includes(q))) : SUITE
if (picked.length === 0) {
  console.error(`没有匹配的脚本。可用：${SUITE.map(([f]) => f).join(', ')}`)
  process.exit(2)
}
if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true })

const results = []
for (const [file, desc] of picked) {
  const abs = join(here, file)
  if (!existsSync(abs)) {
    results.push({ file, desc, code: -1, note: '脚本不存在' })
    continue
  }
  process.stdout.write(`\n${'='.repeat(78)}\n▶ ${file} — ${desc}\n${'='.repeat(78)}\n`)
  const r = spawnSync(process.execPath, [abs], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  const body = `${r.stdout ?? ''}${r.stderr ?? ''}`
  process.stdout.write(body)
  writeFileSync(join(LOG_DIR, `${file.replace(/\.mjs$/, '')}.log`), body, 'utf8')
  const code = r.status ?? -1
  // 脚本自报的 RESULT 行优先于退出码，便于定位「跑完但断言失败」的情况
  const m = /RESULT: (PASS|FAIL[^\n]*)/.exec(body)
  results.push({ file, desc, code, note: m ? m[1] : '' })
}

process.stdout.write(`\n${'='.repeat(78)}\n回归汇总\n${'='.repeat(78)}\n`)
for (const r of results) {
  const ok = r.code === 0 && !r.note.startsWith('FAIL')
  process.stdout.write(`${ok ? '  ✅' : '  ❌'} ${r.file.padEnd(22)} exit=${r.code}  ${r.note || r.desc}\n`)
}
const bad = results.filter((r) => r.code !== 0 || r.note.startsWith('FAIL'))
process.stdout.write(
  `\n${bad.length === 0 ? '✅ 全部通过' : `❌ ${bad.length}/${results.length} 项未通过`}\n日志: ${LOG_DIR}\n`,
)
process.exit(bad.length === 0 ? 0 : 1)
