import { spawn } from 'node:child_process'
import { request as httpRequest } from 'node:http'
import type { ChildProcess } from 'node:child_process'
import type { Config } from './index.js'

interface WatchHandle {
  session: string
  port: number
  file: string
  child: ChildProcess
  ready: Promise<void>
}

const PORT_LINE_RE = /Watch: https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)/

/**
 * 每会话一个 `officecli watch` 子进程。
 * - 启动后从 stdout 解析实际端口（--port 0 时为 OS 分配）
 * - 切换文件用 watch 服务器自带的 POST /api/switch（SSE 连接不断）
 * - watch 有空闲超时自动退出：监听 child exit 并清 handle，按需重启
 */
export class WatchManager {
  private handles = new Map<string, WatchHandle>()
  private logger: { warn: (msg: string) => void } = { warn: () => {} }

  constructor(private config: Config) {}

  setLogger(logger: { warn: (msg: string) => void }): void {
    this.logger = logger
  }

  /** 确保该会话存在 watch 进程且指向 file；返回端口。 */
  async ensure(session: string, file: string): Promise<number> {
    const existing = this.handles.get(session)
    if (existing) {
      if (existing.file === file) return existing.port
      await this.switchFile(existing, file)
      return existing.port
    }
    return this.start(session, file)
  }

  private async start(session: string, file: string): Promise<number> {
    const child = spawn(this.config.officecliPath, ['watch', file, '--port', String(this.config.watchPort)], {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')

    let resolveReady: () => void
    let rejectReady: (err: Error) => void
    const ready = new Promise<void>((res, rej) => {
      resolveReady = res
      rejectReady = rej
    })

    let port = 0
    const onStdout = (chunk: string) => {
      stdout += chunk
      const m = stdout.match(PORT_LINE_RE)
      if (m && !port) {
        port = Number(m[1])
        resolveReady()
      }
    }
    child.stdout?.on('data', onStdout)
    child.stderr?.on('data', (d: string) => { stderr += d })

    const handle: WatchHandle = { session, port: 0, file, child, ready }
    this.handles.set(session, handle)

    child.on('exit', () => {
      // 空闲超时或异常退出：清除 handle 允许下次 ensure 重启
      if (this.handles.get(session) === handle) this.handles.delete(session)
    })
    child.on('error', (err) => {
      if (this.handles.get(session) === handle) this.handles.delete(session)
      rejectReady(new Error(`watch 进程启动失败: ${err.message}`))
    })

    const timeout = setTimeout(() => {
      if (!port) {
        child.kill()
        rejectReady(new Error(`watch 启动超时（5s 未报告端口）。stderr: ${stderr || '无'}；stdout: ${stdout || '无'}`))
      }
    }, 5000)

    try {
      await ready
    } finally {
      clearTimeout(timeout)
    }
    handle.port = port
    return port
  }

  /** 通过 watch 服务器的 /api/switch 原地切换目标文件。 */
  private async switchFile(handle: WatchHandle, file: string): Promise<void> {
    const ok = await this.postToWatch(handle.port, '/api/switch', JSON.stringify({ file }))
    if (!ok) {
      // switch 失败（进程可能已死）：重启
      await this.stop(handle.session)
      await this.start(handle.session, file)
      return
    }
    handle.file = file
  }

  private postToWatch(port: number, path: string, body: string): Promise<boolean> {
    return new Promise((resolve) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port,
          path,
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(body),
            // 绕过 watch 服务器的 Host 门与 Origin 门
            host: `127.0.0.1:${port}`,
            origin: `http://127.0.0.1:${port}`,
          },
        },
        (res) => {
          res.resume()
          res.on('end', () => resolve(res.statusCode !== undefined && res.statusCode < 400))
        },
      )
      req.on('error', () => resolve(false))
      req.end(body)
    })
  }

  /** 当前活跃的 watch 句柄信息（不存在则 undefined）。 */
  status(session: string): { file: string; port: number } | undefined {
    const h = this.handles.get(session)
    return h ? { file: h.file, port: h.port } : undefined
  }

  /** 停止某会话的 watch：优先 officecli unwatch，超时强杀进程树。 */
  async stop(session: string): Promise<void> {
    const handle = this.handles.get(session)
    if (!handle) return
    this.handles.delete(session)
    await this.stopProcess(this.config.officecliPath, handle.file, handle.child)
  }

  private async stopProcess(cliPath: string, file: string, child: ChildProcess): Promise<void> {
    const childExited = () => child.exitCode !== null || child.signalCode !== null
    if (childExited()) return
    // 1) 优雅关停：officecli unwatch <file>
    const waitExit = (ms: number) =>
      new Promise<boolean>((resolve) => {
        if (childExited()) return resolve(true)
        const t = setTimeout(() => resolve(false), ms)
        child.once('exit', () => { clearTimeout(t); resolve(true) })
      })
    try {
      const unwatch = spawn(cliPath, ['unwatch', file], { shell: false, windowsHide: true, stdio: 'ignore' })
      unwatch.on('error', () => {})
      await waitExit(4000)
    } catch { /* 忽略 */ }
    if (childExited()) return
    // 2) 强杀进程树（Windows 必须杀整棵树）
    if (process.platform === 'win32' && child.pid) {
      spawn('taskkill', ['/T', '/F', '/PID', String(child.pid)], { shell: false, windowsHide: true, stdio: 'ignore' })
    } else {
      child.kill('SIGKILL')
    }
  }

  async dispose(): Promise<void> {
    const sessions = [...this.handles.keys()]
    await Promise.all(sessions.map((s) => this.stop(s)))
  }
}
