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

// 模拟 cordis Context。registerRoutes 用 ctx.get('webServer') 访问可选依赖
// （cordis 会拦截未声明服务的直接属性读取），所以这里必须同时提供 get。
const registered: Array<{ kind: string; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void }> = []
const webServer = {
  register: (r: { kind: string; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void }) => {
    registered.push(r)
    return () => {}
  },
}
const fakeCtx = {
  get: (name: string) => (name === 'webServer' ? webServer : undefined),
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
// 1. 创建文档。工作区在 tmp 里跨次复用，文件可能被上一次运行留下的 resident 钉住，
//    所以按 officecli 惯用法先 close 再 create --force。
const docx = workspace.resolve(sid, 'w.docx')
await cli.run(sid, ['close', docx])
let r = await cli.run(sid, ['create', docx, '--type', 'docx', '--force'])
check('create w.docx', r.ok, r.ok ? '' : r)

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
const xlsx = workspace.resolve(sid, 'w2.xlsx')
await cli.run(sid, ['close', xlsx])
await cli.run(sid, ['create', xlsx, '--type', 'xlsx', '--force'])
res = await fetch(`${base}/api/officecli/watch?session=${sid}&file=w2.xlsx`)
const switchInfo = (await res.json()) as { port?: number }
check('switch 后端口不变', switchInfo.port === watchInfo.port, switchInfo)
res = await fetch(`${base}/api/officecli/watch/${sid}`)
const html2 = await res.text()
check('切换后代理仍可用', res.status === 200 && html2.length > 0)

// 10. watch status
const st = watch.status(sid)
check('WatchManager status', !!st && st.file.endsWith('w2.xlsx'), st)
check('status 默认不跟随', st?.following === false, st)

// 11. 跟随开关 + watch-status 查询
res = await fetch(`${base}/api/officecli/follow?session=${sid}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ enable: true }),
})
const followOn = (await res.json()) as { following?: boolean }
check('POST /follow 开启跟随', res.status === 200 && followOn.following === true, followOn)

res = await fetch(`${base}/api/officecli/watch-status?session=${sid}`)
const st2 = (await res.json()) as { running: boolean; following: boolean; file: string | null }
check('GET /watch-status 反映跟随', st2.running && st2.following && st2.file?.endsWith('w2.xlsx'), st2)

// 跟随生效：applyUpdate 应把 watch 切回 w.docx
const applied = await watch.applyUpdate(sid, workspace.resolve(sid, 'w.docx'))
check('跟随：切到 Agent 刚改的文件', applied?.switched === true, applied)
res = await fetch(`${base}/api/officecli/watch/${sid}`)
check('跟随切换后代理仍可用', res.status === 200)

// 同文件：不切换但会原地重载
const refreshed = await watch.applyUpdate(sid, workspace.resolve(sid, 'w.docx'))
check('同文件：不切换但刷新', refreshed?.switched === false && refreshed?.refreshed === true, refreshed)

res = await fetch(`${base}/api/officecli/follow?session=${sid}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ enable: false }),
})
const followOff = (await res.json()) as { following?: boolean }
check('POST /follow 关闭跟随', followOff.following === false, followOff)
check('关闭后不再抢屏', (await watch.applyUpdate(sid, workspace.resolve(sid, 'w2.xlsx'))) === undefined)

// 清理
ac.abort()
await watch.dispose()
events.dispose()
server.close()

console.log(failures === 0 ? '\n全部通过 ✓' : `\n${failures} 项失败 ✗`)
process.exit(failures === 0 ? 0 : 1)
