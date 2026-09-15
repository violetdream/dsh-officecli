import { existsSync } from 'node:fs'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { PluginDeps } from '../routes.js'
import type { WorkspaceManager } from '../workspace.js'

/** 统一的纯文本内容块。 */
export function textCard(...lines: string[]): Array<{ type: 'text'; text: string }> {
  return [{ type: 'text', text: lines.filter(Boolean).join('\n') }]
}

/** 截断超长文本并追加提示。 */
export function truncate(text: string, max = 2000): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n…（截断，共 ${text.length} 字符；可用 page/range 参数或 office_get 收窄范围）`
}

/** 从工具执行上下文取会话 ID。 */
export function getSessionId(exec: ToolRunContext): string {
  const id = exec.agent?.session.id
  return typeof id === 'string' && id ? id : 'default'
}

/**
 * 从工具执行上下文取会话工作区（DSH 会话创建时的 cwd）。
 * dsh-session 的 Session 不直接暴露 cwd，它在 session.header.cwd
 * （SessionHeader："Absolute working directory the session was created in (if any)"）。
 * 缺省（headless / agent-less）回退 undefined，由 WorkspaceManager 落到配置根。
 */
export function getSessionCwd(exec: ToolRunContext): string | undefined {
  const cwd = exec.agent?.session.header.cwd
  return typeof cwd === 'string' && cwd.length > 0 ? cwd : undefined
}

/** 解析文件名并要求文件已存在。cwd 为会话工作区（DSH 会话 cwd），缺省走配置根。 */
export function requireFile(
  workspace: WorkspaceManager,
  sessionId: string,
  filename: string,
  cwd?: string,
): string {
  const abs = workspace.resolve(sessionId, filename, cwd)
  if (!existsSync(abs)) {
    throw new Error(`文件不存在: ${filename}。请先 office_create 创建，或用 office_list 查看现有文件。`)
  }
  return abs
}

/** 工具成功后广播元事件（文件列表 + 编辑高亮 + 可选详情）。cwd 为会话工作区。 */
export function notify(
  deps: PluginDeps,
  sessionId: string,
  opts: { file?: string; tool?: string; detail?: Record<string, unknown> },
  cwd?: string,
): void {
  try {
    deps.events.broadcast(sessionId, {
      type: 'files-changed',
      session: sessionId,
      files: deps.workspace.listFiles(sessionId, cwd),
    })
    if (opts.file) {
      deps.events.broadcast(sessionId, {
        type: 'file-updated',
        session: sessionId,
        file: opts.file,
        tool: opts.tool ?? 'unknown',
        ...(opts.detail ? { detail: opts.detail } : {}),
      })
      // 跟随模式：让预览面板跟着 Agent 的笔走。这里刻意不等 await ——
      // 工具结果不应该被预览的 I/O 拖住，慢了最多是面板晚几百毫秒刷新。
      const file = opts.file
      const abs = deps.workspace.resolve(sessionId, file, cwd)
      void deps.watch.applyUpdate(sessionId, abs).then(
        (res) => {
          if (res) {
            deps.events.broadcast(sessionId, {
              type: 'watch-switched',
              session: sessionId,
              file,
              port: res.port,
            })
          }
        },
        () => {},
      )
    }
  } catch { /* 事件广播失败不影响工具结果 */ }
}

/**
 * 保存后预热 watch：会话尚无 watch 进程时立即启动（边改边看），
 * 已有进程则不切换目标，避免抢走用户正在预览的文件。失败静默 ——
 * 用户之后点选文件时 /api/officecli/watch 仍会按需启动。cwd 为会话工作区。
 */
export function warmWatch(deps: PluginDeps, sessionId: string, file: string, cwd?: string): void {
  const abs = deps.workspace.resolve(sessionId, file, cwd)
  void deps.watch.warmIfAbsent(sessionId, abs).then(
    (port) => {
      if (port !== undefined) {
        deps.events.broadcast(sessionId, { type: 'watch-started', session: sessionId, file, port })
      }
    },
    () => {},
  )
}

/** 把 officecli 的失败结果转换为带建议的 Error。 */
export function cliError(result: { ok: false; error: { error: string; suggestion?: string }; stderr: string }): Error {
  const parts = [result.error.error]
  if (result.error.suggestion) parts.push(`建议: ${result.error.suggestion}`)
  if (result.stderr && !result.error.error.includes(result.stderr.slice(0, 60))) {
    parts.push(`stderr: ${truncate(result.stderr, 400)}`)
  }
  return new Error(parts.join('\n'))
}

export type { PluginDeps }
