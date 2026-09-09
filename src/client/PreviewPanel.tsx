import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  IconCloseOutline16,
  IconDataOutline16,
  IconListPenOutline16,
  IconPlayOutline16,
  IconRefreshOutline16,
  StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { styles } from './styles.ts'

interface SessionFile { name: string; type: 'docx'|'xlsx'|'pptx'; size: number; mtime: number }

/** 文件类型图标：与 DSH 图标库一致（文档/数据表/演示），颜色走 currentColor。 */
const TYPE_ICON = {
  docx: IconListPenOutline16,
  xlsx: IconDataOutline16,
  pptx: IconPlayOutline16,
} as const
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
  // 边改边看：Agent 正在运行哪个 office_* 工具（忙碌指示）；每文件的生成详情（页数等）
  const [busy, setBusy] = useState<string | null>(null)
  const [detail, setDetail] = useState<Record<string, { pageCount?: number; layouts?: string[]; template?: string }>>({})
  // 当前选中文件的实时引用：SSE 回调里判断「是否已在预览」，避免抢走用户正在看的文件
  const selectedRef = useRef<string | null>(null)

  const panelStyle = useMemo(() => ({ ...(wide ? styles.panel : { ...styles.panel, ...styles.panelRail }) }), [wide])

  // 切换会话时重置面板状态
  useEffect(() => {
    setFiles([])
    setSelectedFile(null)
    selectedRef.current = null
    setIframeUrl(null)
    setLoading(true)
    setError(null)
    setBusy(null)
    setDetail({})
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
        const event = JSON.parse(ev.data) as {
          type: string
          files?: SessionFile[]
          file?: string
          tool?: string
          state?: 'running' | 'done' | 'failed'
          detail?: { pageCount?: number; layouts?: string[]; template?: string }
        }
        if (event.type === 'files-changed' && event.files) {
          setFiles(event.files)
        } else if (event.type === 'file-updated' && event.file) {
          const name = event.file
          setUpdated((prev) => new Set(prev).add(name))
          window.setTimeout(() => setUpdated((prev) => { const next = new Set(prev); next.delete(name); return next }), 1200)
          if (event.detail) {
            setDetail((prev) => ({ ...prev, [name]: event.detail ?? {} }))
          }
          // 边改边看：生成类工具（带页数详情）无条件打开预览；其他编辑仅在
          // 当前没在看任何文件时自动打开，绝不抢走用户正在预览的文件
          if (event.detail?.pageCount !== undefined || selectedRef.current === null) {
            void selectFile(name)
          }
        } else if (event.type === 'tool-state' && event.state && event.tool) {
          if (event.state === 'running') setBusy(event.tool)
          else if (event.state === 'done' || event.state === 'failed') setBusy((prev) => (prev === event.tool ? null : prev))
        } else if (event.type === 'watch-started' && event.file) {
          if (selectedRef.current === null) void selectFile(event.file)
        }
      } catch { /* 忽略心跳等非 JSON 帧 */ }
    }
    es.onerror = () => es.close()
    return () => es.close()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  // 选中文件：向宿主申请 watch 会话（拿到预览 URL）
  const selectFile = async (name: string) => {
    if (!sessionId) return
    selectedRef.current = name
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
      <style>{'@keyframes dshOfficecliFlash { from { background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 30%, transparent) } to { background: transparent } }'}</style>
      <div style={styles.header}>
        <span style={styles.headerTitle}><IconListPenOutline16 size={16} /> Office 预览</span>
        <div style={styles.headerButtons}>
          <button type="button" title="刷新" onClick={refresh} style={styles.iconButton}
            onMouseOver={(e) => { e.currentTarget.style.color = styles.iconButtonHover.color; e.currentTarget.style.backgroundColor = styles.iconButtonHover.backgroundColor }}
            onMouseOut={(e) => { e.currentTarget.style.color = ''; e.currentTarget.style.backgroundColor = '' }}>
            <IconRefreshOutline16 size={16} />
          </button>
          <button type="button" title="关闭" onClick={onClose} style={styles.iconButton}
            onMouseOver={(e) => { e.currentTarget.style.color = styles.iconButtonHover.color; e.currentTarget.style.backgroundColor = styles.iconButtonHover.backgroundColor }}
            onMouseOut={(e) => { e.currentTarget.style.color = ''; e.currentTarget.style.backgroundColor = '' }}>
            <IconCloseOutline16 size={16} />
          </button>
        </div>
      </div>
      <div style={styles.sessionBar}>{sessionId ? `会话 ${sessionId.slice(0, 20)}…` : '未连接到会话'}</div>
      {busy ? (
        <div style={styles.busy}>
          <StateDot state="ongoing" size={8} />
          Agent 正在运行 {busy} …
        </div>
      ) : null}
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
            const d = detail[f.name]
            const badge = d?.pageCount !== undefined ? `${d.pageCount} 页` : ''
            const tpl = d?.template ? ` · ${d.template}` : ''
            const FileIcon = TYPE_ICON[f.type] ?? IconListPenOutline16
            return (
              <div
                key={f.name}
                onClick={() => void selectFile(f.name)}
                onMouseOver={(e) => { if (!isActive) e.currentTarget.style.background = styles.fileItemHover.backgroundColor }}
                onMouseOut={(e) => { if (!isActive) e.currentTarget.style.background = 'none' }}
                style={{
                  ...(isActive ? { ...styles.fileItem, ...styles.fileItemActive } : styles.fileItem),
                  ...(isUpdated ? styles.fileUpdated : {}),
                }}
              >
                <span style={styles.fileIcon}><FileIcon size={16} /></span>
                <span>{f.name}</span>
                <span style={styles.fileMeta}>{badge || tpl ? `${badge}${tpl} · ` : ''}{formatSize(f.size)} · {formatTime(f.mtime)}</span>
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
