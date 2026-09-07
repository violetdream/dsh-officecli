import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { styles } from './styles.ts'

interface SessionFile { name: string; type: 'docx'|'xlsx'|'pptx'; size: number; mtime: number }

const TYPE_ICON: Record<string, string> = { docx: '📘', xlsx: '📊', pptx: '📽️' }
const formatSize = (b: number) => (b < 1024 ? `${b}B` : b < 1048576 ? `${(b/1024).toFixed(1)}KB` : `${(b/1048576).toFixed(1)}MB`)
const formatTime = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** 订阅当前会话 id：sessions.list 快照里的 `current`（sessions 服务不可用时退化为 null，不崩）。 */
function useCurrentSession(ctx: ClientContext): string | null {
  const list = ctx.sessions?.list
  const subscribe = useCallback((onChange: () => void) => {
    if (!list) return () => {}
    return list.subscribe(onChange)
  }, [list])
  const getSnapshot = useCallback(() => list?.getSnapshot().current ?? null, [list])
  return useSyncExternalStore(subscribe, getSnapshot, () => null)
}

export function PreviewPanel({ ctx, onClose, wide }: { ctx: ClientContext; onClose: () => void; wide: boolean }) {
  const sessionId = useCurrentSession(ctx)
  const [files, setFiles] = useState<SessionFile[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [iframeUrl, setIframeUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [updated, setUpdated] = useState<Set<string>>(new Set())

  const panelStyle = useMemo(() => ({ ...(wide ? styles.panel : { ...styles.panel, ...styles.panelRail }) }), [wide])

  // 切换会话时重置面板状态
  useEffect(() => {
    setFiles([])
    setSelectedFile(null)
    setIframeUrl(null)
    setLoading(true)
    setError(null)
  }, [sessionId])

  // 拉取文件列表
  const loadFiles = useCallback(async (sid: string) => {
    try {
      const res = await fetch(`/api/officecli/files?session=${encodeURIComponent(sid)}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const { files: list }: { files: SessionFile[] } = await res.json()
      setFiles(list)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!sessionId) return
    void loadFiles(sessionId)
  }, [sessionId, loadFiles])

  // SSE 订阅：工具写文件后宿主广播，面板自动刷新
  useEffect(() => {
    if (!sessionId) return
    const es = new EventSource(`/api/officecli/events?session=${encodeURIComponent(sessionId)}`)
    es.onmessage = (ev) => {
      try {
        const event = JSON.parse(ev.data) as { type: string; files?: SessionFile[]; file?: string; tool?: string }
        if (event.type === 'files-changed' && event.files) {
          setFiles(event.files)
        } else if (event.type === 'file-updated' && event.file) {
          const name = event.file
          setUpdated((prev) => new Set(prev).add(name))
          window.setTimeout(() => setUpdated((prev) => { const next = new Set(prev); next.delete(name); return next }), 1200)
        }
      } catch { /* 忽略心跳等非 JSON 帧 */ }
    }
    es.onerror = () => es.close()
    return () => es.close()
  }, [sessionId])

  // 选中文件：向宿主申请 watch 会话（拿到预览 URL）
  const selectFile = async (name: string) => {
    if (!sessionId) return
    setSelectedFile(name)
    setError(null)
    try {
      const res = await fetch(`/api/officecli/watch?session=${encodeURIComponent(sessionId)}&file=${encodeURIComponent(name)}`)
      if (!res.ok) throw new Error(`预览服务启动失败: HTTP ${res.status}`)
      const { url }: { url: string } = await res.json()
      if (!url) throw new Error('预览服务未返回地址')
      // url 变化时重建 iframe；同一 url（/api/switch 原地切换）不重载，避免闪烁
      setIframeUrl((prev) => (prev === url ? prev : url))
    } catch (e) {
      setError((e as Error).message)
      setIframeUrl(null)
    }
  }

  const refresh = () => {
    if (sessionId) void loadFiles(sessionId)
  }

  return (
    <div style={panelStyle}>
      <style>{'@keyframes dshOfficecliFlash { from { background: rgba(99,102,241,0.35) } to { background: transparent } }'}</style>
      <div style={styles.header}>
        <span>📄 Office 预览</span>
        <div style={styles.headerButtons}>
          <button type="button" title="刷新" onClick={refresh} style={styles.iconButton}>↻</button>
          <button type="button" title="关闭" onClick={onClose} style={styles.iconButton}>×</button>
        </div>
      </div>
      <div style={styles.sessionBar}>{sessionId ? `会话 ${sessionId.slice(0, 20)}…` : '未连接到会话'}</div>
      <div style={styles.fileList}>
        {loading ? (
          <div style={styles.fileListEmpty}>加载中...</div>
        ) : !sessionId ? (
          <div style={styles.fileListEmpty}>当前无会话</div>
        ) : files.length === 0 ? (
          <div style={styles.fileListEmpty}>暂无文档 —— 让 Agent 用 office_create 创建</div>
        ) : (
          files.map((f) => {
            const isActive = selectedFile === f.name
            const isUpdated = updated.has(f.name)
            return (
              <div
                key={f.name}
                onClick={() => void selectFile(f.name)}
                onMouseOver={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--dsh-bg-hover, rgba(127,127,127,0.12))' }}
                onMouseOut={(e) => { if (!isActive) e.currentTarget.style.background = 'none' }}
                style={{
                  ...(isActive ? { ...styles.fileItem, ...styles.fileItemActive } : styles.fileItem),
                  ...(isUpdated ? styles.fileUpdated : {}),
                }}
              >
                <span style={styles.fileIcon}>{TYPE_ICON[f.type]}</span>
                <span>{f.name}</span>
                <span style={styles.fileMeta}>{formatSize(f.size)} · {formatTime(f.mtime)}</span>
              </div>
            )
          })
        )}
      </div>
      {error ? (
        <div style={styles.error}>错误: {error}</div>
      ) : iframeUrl && selectedFile ? (
        <iframe
          key={`${sessionId ?? ''}/${selectedFile}`}
          src={iframeUrl}
          title="Office 预览"
          style={styles.iframe}
          sandbox="allow-scripts allow-same-origin"
        />
      ) : (
        <div style={styles.loading}>{files.length > 0 ? '点击文件开始预览' : '等待 Agent 生成文档…'}</div>
      )}
    </div>
  )
}
