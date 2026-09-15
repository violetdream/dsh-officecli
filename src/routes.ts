import { existsSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver' // 拉入 ctx.webServer 类型声明
import type { Config } from './index.js'
import type { OfficeCLIService } from './service.js'
import type { WorkspaceManager } from './workspace.js'
import type { WatchManager } from './watch.js'
import type { EventBus } from './events.js'
import { proxyToWatch } from './proxy.js'

export interface PluginDeps {
  config: Config
  workspace: WorkspaceManager
  cli: OfficeCLIService
  watch: WatchManager
  events: EventBus
}

const PREFIX = '/api/officecli'
const SESSION_RE = /^[a-zA-Z0-9_-]+$/

/**
 * 注册 /api/officecli 前缀路由并分发。
 *
 * 调用方必须保证 webServer 已可用（用 `ctx.inject(['webServer'], ...)` 而非在
 * apply 里同步探测）—— 同步探测会漏掉"插件激活早于 webServer 提供"的时序，
 * 而那时补不回来，所有 /api/officecli/* 都会落进 SPA fallback 得到 404。
 *
 * @returns 注销函数；路由表与 fiber 生命周期解绑会破坏热重载，务必交给 ctx.effect。
 */
export function registerRoutes(ctx: Context, deps: PluginDeps): () => void {
  // webServer 是可选依赖（不在插件的 inject 里），必须用 ctx.get 访问——cordis
  // 会拦截未声明服务的属性读取。
  const webServer = ctx.get('webServer')
  if (webServer === undefined) {
    ctx.logger.warn('dsh-officecli: webServer 不可用，HTTP 预览接口未注册')
    return () => {}
  }
  return webServer.register({
    kind: 'prefix',
    path: PREFIX,
    handler: (req, res) => dispatch(req, res, deps, ctx),
  })
}

async function dispatch(
  req: IncomingMessage,
  res: ServerResponse,
  deps: PluginDeps,
  ctx: Context,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const pathname = url.pathname
  const sub = pathname.startsWith(PREFIX) ? pathname.slice(PREFIX.length) : pathname
  const session = sanitize(url.searchParams.get('session'))

  try {
    // ---- 元 API ----
    if (sub === '/files' && req.method === 'GET') {
      return json(res, 200, { files: deps.workspace.listFiles(session) })
    }

    if (sub === '/events' && req.method === 'GET') {
      deps.events.connect(res, session)
      return
    }

    if (sub === '/watch' && req.method === 'GET') {
      const file = url.searchParams.get('file') ?? ''
      const abs = deps.workspace.resolve(session, file)
      if (!existsSync(abs)) return json(res, 404, { error: `文件不存在: ${file}` })
      const port = await deps.watch.ensure(session, abs)
      return json(res, 200, { url: `${PREFIX}/watch/${session}`, file, port })
    }

    if (sub === '/watch-status' && req.method === 'GET') {
      const st = deps.watch.status(session)
      return json(res, 200, { running: Boolean(st), following: deps.watch.following(session), file: st?.file ?? null, port: st?.port ?? 0 })
    }

    // 预览跟随开关：开启后 Agent 每改一次文件，预览面板自动切到那个文件
    if (sub === '/follow' && (req.method === 'POST' || req.method === 'GET')) {
      if (req.method === 'POST') {
        const body = await readJson(req)
        const on = body.enable !== false
        if (on) {
          const file = typeof body.file === 'string' && body.file ? body.file : null
          const abs = file ? deps.workspace.resolve(session, file) : null
          deps.watch.setFollow(session, abs)
        } else {
          deps.watch.clearFollow(session)
        }
      }
      const st = deps.watch.status(session)
      return json(res, 200, {
        following: deps.watch.following(session),
        file: st?.file ?? null,
        port: st?.port ?? 0,
      })
    }

    // ---- watch 代理族: /watch/<session>/<upstream-path...> ----
    if (sub.startsWith('/watch/')) {
      const rest = sub.slice('/watch/'.length)
      const sid = rest.split('/')[0] ?? ''
      if (!SESSION_RE.test(sid)) return json(res, 400, { error: '非法会话标识' })
      const status = deps.watch.status(sid)
      if (!status) return json(res, 503, { error: 'watch not running' })
      // 代理路径下的 session 由 URL path 段决定
      const proxyBase = `${PREFIX}/watch/${sid}`
      proxyToWatch(req, res, status.port, proxyBase, { warn: (m) => ctx.logger.warn(m) })
      return
    }

    return json(res, 404, { error: `未知路由: ${req.method} ${pathname}` })
  } catch (err) {
    return json(res, 500, { error: err instanceof Error ? err.message : String(err) })
  }
}

function sanitize(session: string | null): string {
  return session && SESSION_RE.test(session) ? session : 'default'
}

/** 读取 JSON 请求体（解析失败返回空对象，交由调用方按缺省处理）。 */
async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = chunk as Buffer
    size += buf.length
    if (size > 64 * 1024) break
    chunks.push(buf)
  }
  if (chunks.length === 0) return {}
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function json(res: ServerResponse, code: number, body: unknown): void {
  const data = Buffer.from(JSON.stringify(body), 'utf8')
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': data.length })
  res.end(data)
}
