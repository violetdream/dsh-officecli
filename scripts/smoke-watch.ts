/**
 * P3 冒烟测试：WatchManager + HTTP 代理 + SSE + HTML 改写，不进 DSH。
 * 运行: npx tsx scripts/smoke-watch.ts
 */
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkspaceManager } from '../src/workspace.ts'
import { OfficeCLIService } from '../src/service.ts'
import { WatchManager } from '../src/watch.ts'
import { EventBus } from '../src/events.ts'
import { registerRoutes, type PluginDeps } from '../src/routes.ts'
import { Config } from '../src/index.js'
import type { Context } from '@deepseek-ai/cordis'

const config: Config = {
  officecliPath: 'officecli',
  workspaceDir: join(tmpdir(), 'dsh-officecli-smoke-watch'),
  watchPort: 0,
  commandTimeoutMs: 30_000,
  batchTimeoutMs: 60_000,
} as Config

const workspace = new WorkspaceManager(config)
const cli = new OfficeCLIService(config, workspace)
const watch = new WatchManager(config)
const events = new EventBus()
events.bindSnapshot((s) => workspace.listFiles(s))
const deps: PluginDeps = { config, workspace, cli, watch, events }

// 模拟 cordis Context（只用 webServer.register 与 logger）
const registered: Array<{ kind: string; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void }> = []
const fakeCtx = {
  webServer: { register: (r: { kind: string; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void }) => registered.push(r) },
  logger: { warn: (m: string) => console.warn('[warn]', m), info: () => {} },
  tools: { register: () => () => {} },
} as unknown as Context

registerRoutes(fakeCtx, deps)
if (registered.length !== 1 || registered[0].path !== '/api/officecli') {
  throw new Error(`路由注册异常: ${JSON.stringify(registered.map((r) => r.path))}`)
}
const handler = registered[0].handler

const server = createServer((req, res) => handler(req, res))
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const dshPort = (server.address() as { port: number }).port
const base = `http://127.0.0.1:${dshPort}`

let failures = 0
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) console.log(`PASS ${name}`)
  else {
    failures++
    console.error(`FAIL ${name}`, detail ?? '')
  }
}

const sid = 'smoke'
// 1. 创建文档
let r = await cli.run(sid, ['create', workspace.resolve(sid, 'w.docx'), '--type', 'docx'])
check('create w.docx', r.ok)

// 2. GET /files
let res = await fetch(`${base}/api/officecli/files?session=${sid}`)
check('GET /files 200', res.status === 200)
const files = (await res.json()) as { files: Array<{ name: string }> }
check('files list has w.docx', files.files.some((f) => f.name === 'w.docx'), files)

// 3. GET /watch → ensure
res = await fetch(`${base}/api/officecli/watch?session=${sid}&file=w.docx`)
const watchInfo = (await res.json()) as { url?: string; port?: number }
check('GET /watch ok', res.status === 200 && !!watchInfo.url, watchInfo)
check('watch url 不含文件名', watchInfo.url === `/api/officecli/watch/${sid}`, watchInfo)

// 4. 代理 HTML 首页（含根相对 URL 改写）
res = await fetch(`${base}/api/officecli/watch/${sid}`)
const html = await res.text()
check('proxy HTML 200', res.status === 200)
check('HTML 改写 EventSource', html.includes(`new EventSource('/api/officecli/watch/${sid}/events')`), html.slice(0, 300))
check('HTML 改写 fetch /api/', html.includes(`fetch('/api/officecli/watch/${sid}/api/`))

// 5. SSE 事件通道
const ac = new AbortController()
const sseRes = await fetch(`${base}/api/officecli/events?session=${sid}`, { signal: ac.signal })
check('SSE 200', sseRes.status === 200)
const reader = sseRes.body!.getReader()
const dec = new TextDecoder()
let sseText = ''
const readSome = async (): Promise<void> => {
  const { value } = await reader.read()
  sseText += dec.decode(value ?? new Uint8Array())
}
await readSome()
check('SSE 收到 connected + 快照', sseText.includes(': connected') && sseText.includes('files-changed'), sseText.slice(0, 200))

// 6. 工具编辑后 SSE 广播
r = await cli.run(sid, ['add', workspace.resolve(sid, 'w.docx'), '/body', '--type', 'paragraph', '--prop', 'text=SSE 测试段落'])
check('add paragraph', r.ok)
events.broadcast(sid, {
  type: 'file-updated',
  session: sid,
  file: 'w.docx',
  tool: 'office_add',
})
await readSome()
check('SSE 收到 file-updated', sseText.includes('file-updated'), sseText.slice(-300))

// 7. watch 页面 events SSE 透传
const watchSse = await fetch(`${base}/api/officecli/watch/${sid}/events`, { signal: ac.signal })
check('watch SSE 透传 200', watchSse.status === 200 && (watchSse.headers.get('content-type') ?? '').includes('text/event-stream'))

// 8. 再次 ensure（同文件）应复用，切换到新文件走 /api/switch
res = await fetch(`${base}/api/officecli/watch?session=${sid}&file=w.docx`)
check('ensure 复用同端口', (await res.json()).port === watchInfo.port)

// 9. 创建第二个文档并切换
await cli.run(sid, ['create', workspace.resolve(sid, 'w2.xlsx'), '--type', 'xlsx'])
res = await fetch(`${base}/api/officecli/watch?session=${sid}&file=w2.xlsx`)
const switchInfo = (await res.json()) as { port?: number }
check('switch 后端口不变', switchInfo.port === watchInfo.port, switchInfo)
res = await fetch(`${base}/api/officecli/watch/${sid}`)
const html2 = await res.text()
check('切换后代理仍可用', res.status === 200 && html2.length > 0)

// 10. watch status
const st = watch.status(sid)
check('WatchManager status', !!st && st.file.endsWith('w2.xlsx'), st)

// 清理
ac.abort()
await watch.dispose()
events.dispose()
server.close()

console.log(failures === 0 ? '\n全部通过 ✓' : `\n${failures} 项失败 ✗`)
process.exit(failures === 0 ? 0 : 1)
