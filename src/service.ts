import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { Config } from './index.js'
import type { WorkspaceManager } from './workspace.js'

export interface CliErrorInfo {
  error: string
  code?: string
  suggestion?: string
}

export type CliResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: CliErrorInfo; stderr: string }

export interface RunOptions {
  timeoutMs?: number
  signal?: AbortSignal
  stdin?: string
}

/** officecli 输出信封。 */
interface Envelope<T> {
  success?: boolean
  data?: T
  error?: CliErrorInfo
}

/**
 * 以参数数组安全执行 officecli（无 shell 拼接），全局追加 --json，
 * 解析输出信封。超时与 AbortSignal 均通过 kill 子进程实现。
 */
export class OfficeCLIService {
  constructor(private config: Config, private workspace: WorkspaceManager) {}

  /** 探测 officecli 可用性，返回版本号；失败抛带修复建议的错误。 */
  async probe(): Promise<string> {
    const res = await this.raw(['--version'], { timeoutMs: 10_000 })
    const m = res.stdout.match(/[\d.]+/)
    if (res.code === 0 && m) return m[0]
    throw new Error(
      `officecli 不可用（exit=${res.code}）: ${res.stderr || res.stdout || '无输出'}。` +
        `请确认已安装 OfficeCLI，或配置 officecliPath 为绝对路径（本机常见位置: C:\\Users\\<user>\\AppData\\Local\\OfficeCLI\\officecli.exe）。`,
    )
  }

  /**
   * 在会话目录中执行 officecli 命令并解析 --json 信封。
   * watch 子命令不走此方法（由 WatchManager 管理）。
   */
  async run<T = unknown>(sessionId: string, args: string[], opts: RunOptions = {}): Promise<CliResult<T>> {
    const cwd = this.workspace.sessionDir(sessionId)
    const res = await this.raw([...args, '--json'], { cwd, ...opts })
    if (res.signal === 'timeout') {
      return { ok: false, error: { error: `命令超时（>${opts.timeoutMs ?? this.config.commandTimeoutMs}ms）: officecli ${args.join(' ')}` }, stderr: res.stderr }
    }
    if (res.signal === 'aborted') {
      return { ok: false, error: { error: '命令已被取消' }, stderr: res.stderr }
    }
    const parsed = this.parse<T>(res.stdout)
    if (parsed) {
      if (parsed.success !== false) return { ok: true, data: (parsed.data ?? {}) as T }
      return { ok: false, error: parsed.error ?? { error: res.stderr || res.stdout || '未知错误' }, stderr: res.stderr }
    }
    // stdout 不是 JSON：成功时透传原始输出，失败时用 stderr 构造错误
    if (res.code === 0) return { ok: true, data: { raw: res.stdout.trim() } as T }
    return {
      ok: false,
      error: { error: (res.stderr || res.stdout || `officecli 退出码 ${res.code}`).trim() },
      stderr: res.stderr,
    }
  }

  /** 把 props 对象展开为 --prop k=v 参数（值 JSON 序列化，字符串保持原样）。 */
  static propArgs(props: Record<string, unknown>): string[] {
    const out: string[] = []
    for (const [k, v] of Object.entries(props)) {
      out.push('--prop', `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    }
    return out
  }

  /** 解析 stdout 中的 JSON 信封；容忍前导非 JSON 行。 */
  private parse<T>(stdout: string): Envelope<T> | undefined {
    const text = stdout.trim()
    if (!text) return undefined
    try {
      return JSON.parse(text) as Envelope<T>
    } catch {
      // 跳过前导非 JSON 行（提示/banner）
      const idx = text.indexOf('{"')
      if (idx > 0) {
        try {
          return JSON.parse(text.slice(idx)) as Envelope<T>
        } catch {
          return undefined
        }
      }
      return undefined
    }
  }

  private raw(
    args: string[],
    opts: { cwd?: string; timeoutMs?: number; signal?: AbortSignal; stdin?: string } = {},
  ): Promise<{ code: number; stdout: string; stderr: string; signal?: 'timeout' | 'aborted' }> {
    return new Promise((resolve, reject) => {
      const timeoutMs = opts.timeoutMs ?? this.config.commandTimeoutMs
      const child: ChildProcessWithoutNullStreams = spawn(this.config.officecliPath, args, {
        cwd: opts.cwd,
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      let stdout = ''
      let stderr = ''
      let settled = false
      let abortReason: 'timeout' | 'aborted' | undefined
      let timer: NodeJS.Timeout | undefined

      const kill = (reason: 'timeout' | 'aborted') => {
        abortReason = reason
        child.kill()
      }

      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (d: string) => { stdout += d })
      child.stderr.on('data', (d: string) => { stderr += d })

      if (opts.stdin !== undefined) {
        child.stdin.on('error', () => {})
        child.stdin.end(opts.stdin)
      } else {
        child.stdin.end()
      }

      if (timeoutMs > 0) timer = setTimeout(() => kill('timeout'), timeoutMs)
      const onAbort = () => kill('aborted')
      opts.signal?.addEventListener('abort', onAbort, { once: true })

      const finish = (code: number | null, signal?: NodeJS.Signals) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        opts.signal?.removeEventListener('abort', onAbort)
        resolve({ code: code ?? -1, stdout, stderr, signal: abortReason ?? (signal ? 'aborted' : undefined) })
      }
      child.on('error', (err: NodeJS.ErrnoException) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        opts.signal?.removeEventListener('abort', onAbort)
        if (err.code === 'ENOENT') {
          reject(new Error(`officecli 未找到（${this.config.officecliPath}）。请安装 OfficeCLI 或在插件配置中设置 officecliPath 绝对路径。`))
        } else {
          reject(err)
        }
      })
      child.on('close', (code, signal) => finish(code, signal ?? undefined))
    })
  }
}
