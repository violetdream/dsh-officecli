import type { ServerResponse } from 'node:http'
import type { SessionFile } from './workspace.js'

export type OfficeEvent =
  | { type: 'files-changed'; session: string; files: SessionFile[] }
  | { type: 'file-updated'; session: string; file: string; tool: string }

interface SseConnection {
  session: string
  res: ServerResponse
}

/**
 * 插件自有 SSE 通道：只广播元事件（文件列表变化、哪个文件被哪个工具修改）。
 * 文档内容的实时刷新由 officecli watch 页面自身的 SSE 完成，本通道不介入。
 */
export class EventBus {
  private connections = new Set<SseConnection>()
  private filesSnapshot: (session: string) => SessionFile[] = () => []

  /** 注入文件快照函数（用于连接时立即推送当前列表）。 */
  bindSnapshot(fn: (session: string) => SessionFile[]): void {
    this.filesSnapshot = fn
  }

  /** 接管一个响应为 SSE 连接。 */
  connect(res: ServerResponse, session: string): void {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    res.write(': connected\n\n')
    const conn: SseConnection = { session, res }
    this.connections.add(conn)
    // 连接即推当前快照
    this.write(conn, { type: 'files-changed', session, files: this.filesSnapshot(session) })
    res.on('close', () => this.connections.delete(conn))
  }

  /** 向指定会话的所有连接广播事件。 */
  broadcast(session: string, event: OfficeEvent): void {
    for (const conn of this.connections) {
      if (conn.session !== session) continue
      this.write(conn, event)
    }
  }

  private write(conn: SseConnection, event: OfficeEvent): void {
    try {
      conn.res.write(`data: ${JSON.stringify(event)}\n\n`)
    } catch {
      this.connections.delete(conn)
    }
  }

  dispose(): void {
    for (const conn of this.connections) {
      try { conn.res.end() } catch { /* 忽略 */ }
    }
    this.connections.clear()
  }
}
