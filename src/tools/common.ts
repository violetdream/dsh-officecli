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

/** 解析文件名并要求文件已存在。 */
export function requireFile(workspace: WorkspaceManager, sessionId: string, filename: string): string {
  const abs = workspace.resolve(sessionId, filename)
  if (!existsSync(abs)) {
    throw new Error(`文件不存在: ${filename}。请先 office_create 创建，或用 office_list 查看现有文件。`)
  }
  return abs
}

/** 工具成功后广播元事件（文件列表 + 编辑高亮）。 */
export function notify(deps: PluginDeps, sessionId: string, opts: { file?: string; tool?: string }): void {
  try {
    deps.events.broadcast(sessionId, {
      type: 'files-changed',
      session: sessionId,
      files: deps.workspace.listFiles(sessionId),
    })
    if (opts.file) {
      deps.events.broadcast(sessionId, {
        type: 'file-updated',
        session: sessionId,
        file: opts.file,
        tool: opts.tool ?? 'unknown',
      })
    }
  } catch { /* 事件广播失败不影响工具结果 */ }
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
