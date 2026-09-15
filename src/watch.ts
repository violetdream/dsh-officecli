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
  /**
   * 跟随模式：键存在即为开启，值为锁定文件（null = 跟随 Agent 最近改动的文件）。
   * 用途是让预览面板在 Agent 改稿时自动切到那个文件 —— 「边改边看」的核心。
   */
  private followSessions = new Map<string, string | null>()
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

  /**
   * 会话尚无 watch 进程时启动并指向 file；已有进程则**不切换**（返回其端口，
   * 避免工具预热抢走用户正在预览的文件）。用于「边改边看」的主动预热。
   */
  async warmIfAbsent(session: string, file: string): Promise<number | undefined> {
    const existing = this.handles.get(session)
    if (existing) return existing.port
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

  /**
   * 「Agent 刚改了这个文件」时调用：跟随模式开启就把 watch 切过去。
   *
   * 没有 watch 进程时什么都不做（预览面板没打开，切换无意义）；已经指向该文件
   * 时也什么都不做 —— 内容刷新由 watch 自己的文件监听负责，再去 switch 反而
   * 会让页面闪一下。
   *
   * @returns 切换后的信息；未发生切换返回 undefined。
   */
  /**
   * 「Agent 刚改了这个文件」时调用，返回这次要不要让客户端重载预览。
   *
   * 三种情况：
   *   - 没有 watch 进程（预览面板没开）→ 什么都不做；
   *   - 正在看的就是这个文件 → 用 `/api/switch` 原地重读。officecli watch 自述
   *     「external edits are not detected」，而我们的工具是独立进程改盘写回的，
   *     等它自己发现并不可靠；实测 POST /api/switch 指向同一个文件会重新打开
   *     文档（status.version 归零并广播 update），等于一次确定的刷新；
   *   - 在看别的文件 → 跟随模式开启才切过去，否则不抢用户的屏。
   */
  async applyUpdate(
    session: string,
    file: string,
  ): Promise<{ file: string; port: number; switched: boolean; refreshed: boolean } | undefined> {
    const handle = this.handles.get(session)
    if (!handle) return undefined
    if (handle.file === file) {
      const ok = await this.postToWatch(handle.port, '/api/switch', JSON.stringify({ file }))
      return { file, port: handle.port, switched: false, refreshed: ok }
    }
    if (!this.followSessions.has(session)) return undefined
    try {
      await this.switchFile(handle, file)
      // switchFile 失败时会重启进程，handle 会被换成新对象 —— 重新取一次拿新端口
      const after = this.handles.get(session)
      return { file, port: after?.port ?? handle.port, switched: true, refreshed: true }
    } catch {
      return undefined
    }
  }

  /** 会话销毁时连同跟随状态一起清理。 */
  clearFollow(session: string): void {
    this.followSessions.delete(session)
  }

  /** 当前活跃的 watch 句柄信息（不存在则 undefined）。 */
  status(session: string): { file: string; port: number; following: boolean } | undefined {
    const h = this.handles.get(session)
    if (!h) return undefined
    return { file: h.file, port: h.port, following: this.followSessions.has(session) }
  }

  /** 开启/关闭跟随。file 为空表示跟随最近改动的文件。 */
  setFollow(session: string, file?: string | null): void {
    this.followSessions.set(session, file ?? null)
  }

  /** 是否处于跟随模式（客户端初值与开关状态同步用）。 */
  following(session: string): boolean {
    return this.followSessions.has(session)
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
