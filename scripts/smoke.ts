/**
 * P1 冒烟测试：不进 DSH，直接验证 WorkspaceManager + OfficeCLIService 链路。
 * 运行: npx tsx scripts/smoke.ts
 */
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkspaceManager } from '../src/workspace.ts'
import { OfficeCLIService } from '../src/service.ts'
import type { Config } from '../src/index.ts'

const config: Config = {
  officecliPath: 'officecli',
  workspaceDir: join(tmpdir(), 'dsh-officecli-smoke'),
  watchPort: 0,
  commandTimeoutMs: 30_000,
  batchTimeoutMs: 60_000,
}

try {
  rmSync(config.workspaceDir, { recursive: true, force: true })
} catch { /* 旧目录被占用则忽略 */ }
const workspace = new WorkspaceManager(config)
const cli = new OfficeCLIService(config, workspace)
const sid = 'smoke'

let failures = 0
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) console.log(`PASS ${name}`)
  else {
    failures++
    console.error(`FAIL ${name}`, detail ?? '')
  }
}

// 1. probe
const version = await cli.probe()
console.log('officecli version:', version)

// 2. create docx
const docx = workspace.resolve(sid, 'smoke.docx')
let r = await cli.run(sid, ['create', docx, '--type', 'docx'])
check('create docx', r.ok, r.ok ? undefined : r.error)

// 3. add heading（docx 标题 = paragraph + style）+ paragraph
r = await cli.run(sid, ['add', docx, '/body', '--type', 'paragraph', '--prop', 'text=测试标题', '--prop', 'style=Heading1'])
check('add heading', r.ok, r.ok ? undefined : r.error)

r = await cli.run(sid, ['add', docx, '/body', '--type', 'paragraph', '--prop', 'text=第一段内容。'])
check('add paragraph', r.ok, r.ok ? undefined : r.error)

// 4. view text
r = await cli.run<{ elements?: Array<{ text?: string }> }>(sid, ['view', docx, 'text'])
const text = r.ok ? (r.data.elements ?? []).map((e) => e.text ?? '').join('\n') : ''
check('view text contains 标题', r.ok && text.includes('测试标题'), text.slice(0, 200))

// 5. get
r = await cli.run(sid, ['get', docx, '/body', '--depth', '1'])
check('get /body', r.ok, r.ok ? undefined : r.error)

// 6. set
r = await cli.run(sid, ['set', docx, '/body/p[1]', '--prop', 'text=第一段已修改'])
check('set paragraph text', r.ok, r.ok ? undefined : r.error)

// 7. xlsx create + set cell
const xlsx = workspace.resolve(sid, 'smoke.xlsx')
r = await cli.run(sid, ['create', xlsx, '--type', 'xlsx'])
check('create xlsx', r.ok, r.ok ? undefined : r.error)
r = await cli.run(sid, ['set', xlsx, '/Sheet1/A1', '--prop', 'value=Hello'])
check('set cell A1', r.ok, r.ok ? undefined : r.error)
r = await cli.run(sid, ['get', xlsx, '/Sheet1/A1'])
check('get cell A1', r.ok, r.ok ? undefined : r.error)

// 8. batch（stdin）
r = await cli.run(sid, ['batch', docx], {
  timeoutMs: config.batchTimeoutMs,
  stdin: JSON.stringify([
    { command: 'add', parent: '/body', type: 'paragraph', props: { text: 'batch 第一条' } },
    { command: 'add', parent: '/body', type: 'paragraph', props: { text: 'batch 第二条' } },
  ]),
})
check('batch 2 commands', r.ok, r.ok ? undefined : r.error)

// 9. 注入防护: 非法文件名
try {
  workspace.resolve(sid, '../escape.docx')
  check('path escape rejected', false)
} catch {
  check('path escape rejected', true)
}
try {
  workspace.resolve(sid, 'a/b.docx')
  check('slash rejected', false)
} catch {
  check('slash rejected', true)
}
try {
  workspace.resolve(sid, 'evil.txt" && rm -rf /')
  check('injection rejected', false)
} catch {
  check('injection rejected', true)
}

// 10. listFiles
const files = workspace.listFiles(sid)
check('listFiles has 2 files', files.length === 2, files)

// 11. remove
r = await cli.run(sid, ['remove', docx, '/body/p[1]'])
check('remove p[1]', r.ok, r.ok ? undefined : r.error)

// 12. dump
r = await cli.run(sid, ['dump', docx])
check('dump', r.ok, r.ok ? undefined : r.error)

console.log(failures === 0 ? '\n全部通过 ✓' : `\n${failures} 项失败 ✗`)
process.exit(failures === 0 ? 0 : 1)
