/**
 * 预览面板样式 —— 全部使用 DSH 宿主主题变量（--dsw-*，与 DSH 客户端
 * dsh-client-ui-primitives 一致），不再自造色板。字体层级沿用宿主语义：
 * label-primary（正文）/ secondary（次要）/ tertiary（弱化）/ dimmed（占位）。
 */
export const styles = {
  panel: {
    position: 'fixed' as const,
    right: 0,
    top: 60,
    bottom: 0,
    width: 'calc(100% - 64px)',
    maxWidth: 480,
    backgroundColor: 'var(--dsw-alias-bg-layer-1)',
    borderLeft: '1px solid var(--dsw-alias-border-l2)',
    display: 'flex',
    flexDirection: 'column' as const,
    zIndex: 1000,
    color: 'var(--dsw-alias-label-primary)',
  },
  panelRail: {
    width: 'calc(100% - 60px)',
    right: 60,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 14px',
    borderBottom: '1px solid var(--dsw-alias-border-l1)',
    fontSize: '14px',
    fontWeight: 600,
    lineHeight: '22px',
  },
  headerTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  headerButtons: {
    display: 'flex',
    gap: 4,
  },
  iconButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
    border: 'none',
    borderRadius: 14,
    background: 'transparent',
    color: 'var(--dsw-alias-label-secondary)',
    cursor: 'pointer',
    padding: 0,
    transition: 'background 0.15s, color 0.15s',
  },
  iconButtonHover: {
    color: 'var(--dsw-alias-label-primary)',
    backgroundColor: 'var(--dsw-alias-interactive-bg-hover)',
  },
  fileList: {
    flexShrink: 0,
    borderBottom: '1px solid var(--dsw-alias-border-l1)',
  },
  fileListEmpty: {
    padding: '16px',
    textAlign: 'center' as const,
    color: 'var(--dsw-alias-label-tertiary)',
    fontSize: '13px',
  },
  fileItem: {
    padding: '9px 14px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: '13px',
    lineHeight: '18px',
    transition: 'background 0.15s',
  },
  fileItemHover: {
    backgroundColor: 'var(--dsw-alias-interactive-bg-hover)',
  },
  fileItemActive: {
    backgroundColor: 'var(--dsw-alias-interactive-bg-active)',
    color: 'var(--dsw-alias-label-primary)',
  },
  fileIcon: {
    display: 'flex',
    alignItems: 'center',
    color: 'var(--dsw-alias-label-secondary)',
  },
  fileMeta: {
    marginLeft: 'auto',
    fontSize: '11px',
    lineHeight: '16px',
    color: 'var(--dsw-alias-label-tertiary)',
  },
  fileUpdated: {
    animation: 'dshOfficecliFlash 1.2s ease-out',
  },
  sessionBar: {
    padding: '6px 14px',
    fontSize: '11px',
    lineHeight: '16px',
    color: 'var(--dsw-alias-label-tertiary)',
    borderBottom: '1px solid var(--dsw-alias-border-l1)',
  },
  busy: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '5px 14px',
    fontSize: '11px',
    lineHeight: '16px',
    color: 'var(--dsw-alias-label-secondary)',
    backgroundColor: 'var(--dsw-alias-bg-layer-2)',
    borderBottom: '1px solid var(--dsw-alias-border-l1)',
  },
  iframe: {
    flex: 1,
    border: 'none',
    backgroundColor: '#fff',
  },
  error: {
    padding: '14px',
    color: 'var(--dsw-alias-state-error-primary)',
    fontSize: '13px',
    lineHeight: '18px',
  },
  loading: {
    padding: '16px',
    color: 'var(--dsw-alias-label-secondary)',
    fontSize: '13px',
    lineHeight: '18px',
  },
} as const

/** 面板外操作按钮（侧栏 footer action）与宿主视觉一致。 */
export const actionButton = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '7px 10px',
  fontSize: '13px',
  lineHeight: '18px',
  background: 'transparent',
  border: 'none',
  borderRadius: 14,
  color: 'var(--dsw-alias-label-primary)',
  cursor: 'pointer',
  transition: 'background 0.15s',
} as const

export const actionButtonHover = {
  backgroundColor: 'var(--dsw-alias-interactive-bg-hover)',
} as const

export const actionIcon = {
  display: 'flex',
  alignItems: 'center',
  color: 'var(--dsw-alias-label-secondary)',
} as const
