import { request as httpRequest } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'

export interface ProxyLogger {
  warn: (msg: string) => void
}

/**
 * 把请求代理到本会话的 officecli watch 服务器。
 * - 显式改写 Host 头为 127.0.0.1:<port>（绕过反 DNS 绑定门）
 * - POST 追加 Origin 头（绕过 Origin 门）
 * - HTML 响应做根相对 URL 改写，使页面内嵌 JS 指回代理路径
 * - SSE（/events）以流式 pipe 透传，不缓冲
 */
export function proxyToWatch(
  req: IncomingMessage,
  res: ServerResponse,
  port: number,
  proxyBase: string,
  logger?: ProxyLogger,
): void {
  const upstream = httpRequest(
    {
      host: '127.0.0.1',
      port,
      path: stripBase(req.url ?? '/', proxyBase),
      method: req.method ?? 'GET',
      headers: rewriteHeaders(req.headers, port, req.method === 'POST'),
    },
    (upRes) => {
      const contentType = String(upRes.headers['content-type'] ?? '')
      const isHtml = contentType.includes('text/html')
      const isSse = contentType.includes('text/event-stream')

      if (isSse) {
        // SSE 流式透传
        res.writeHead(upRes.statusCode ?? 200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        })
        upRes.pipe(res)
        res.on('close', () => upRes.destroy())
        upRes.on('error', () => res.destroy())
        return
      }

      if (isHtml) {
        // 收集后做根相对 URL 改写
        const chunks: Buffer[] = []
        upRes.on('data', (c: Buffer) => chunks.push(c))
        upRes.on('end', () => {
          let html = Buffer.concat(chunks).toString('utf8')
          // 改写前统计 EventSource 根相对引用：为 0 说明 officecli 内嵌脚本结构
          // 变了，实时刷新会静默失效，必须告警（改写本身是通用的，不受影响）。
          const eventSourceHits = [...html.matchAll(/EventSource\(\s*(['"`])\//g)].length
          for (const [re, replacer] of htmlRewrites(proxyBase)) {
            html = html.replace(re, replacer)
          }
          if (eventSourceHits === 0 && logger) {
            logger.warn(
              'officecli watch 页面中未找到 EventSource 根相对 URL —— OfficeCLI 版本可能已变化，实时刷新可能失效。',
            )
          }
          const body = Buffer.from(html, 'utf8')
          res.writeHead(upRes.statusCode ?? 200, {
            'content-type': contentType,
            'content-length': body.length,
          })
          res.end(body)
        })
        upRes.on('error', () => res.destroy())
        return
      }

      // 其余：原样透传状态码与响应头
      res.writeHead(upRes.statusCode ?? 200, upRes.headers)
      upRes.pipe(res)
      res.on('close', () => upRes.destroy())
      upRes.on('error', () => res.destroy())
    },
  )
  upstream.on('error', (err) => {
    if (res.headersSent) return res.destroy()
    res.writeHead(503, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: `watch 服务器不可达: ${err.message}` }))
  })
  req.pipe(upstream)
}

function rewriteHeaders(headers: IncomingMessage['headers'], port: number, isPost: boolean): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  for (const [k, v] of Object.entries(headers)) {
    if (v !== undefined) out[k] = v
  }
  // Host 门：必须是回环名
  out.host = `127.0.0.1:${port}`
  if (isPost) out.origin = `http://127.0.0.1:${port}`
  delete out.referer
  return out
}

/** 把 /api/officecli/watch/<session>/xxx 还原为 watch 服务器的 /xxx。 */
function stripBase(url: string, proxyBase: string): string {
  let path = url.split('?')[0] ?? '/'
  if (path.startsWith(proxyBase)) path = path.slice(proxyBase.length)
  if (!path.startsWith('/')) path = '/' + path
  return path
}

/**
 * watch 页面内嵌 JS 使用根相对 URL（如 new EventSource('/events')），
 * 代理后必须改写为代理路径，否则打到 DSH 自身 origin 的错误路径。
 *
 * 必须"一条规则 + g 标志 + 函数替换"一次完成，不能拆成多条规则：
 * 1. 缺 g 时只替换第一处，后面的引用（如 fetch('/api/selection')）会原样漏出，
 *    浏览器请求 DSH 的 /api/selection 得到 404；
 * 2. 多条规则串行时，前一条的产物以 /api/ 开头，会被后一条的 `fetch('\/api\/`
 *    再次命中，拼出 `<base>/<base>/...` 双重前缀；
 * 3. 函数替换（而非字符串替换）避免 base 里的 `$&` 之类被当成替换模式。
 */
function htmlRewrites(base: string): [RegExp, (...args: string[]) => string][] {
  return [
    // fetch('/x') / EventSource('/x')：JS 发起的请求（含单/双/反引号三种引号）
    [/(fetch|EventSource)\(\s*(['"`])\//g, (_m, fn: string, q: string) => `${fn}(${q}${base}/`],
    // src="/x" href="/x" action="/x"：页面静态资源与表单目标
    [/\b(src|href|action)=(["'])\//g, (_m, attr: string, q: string) => `${attr}=${q}${base}/`],
  ]
}
