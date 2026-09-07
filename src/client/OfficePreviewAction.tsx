import { useState } from 'react'
import { createPortal } from 'react-dom'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { PreviewPanel } from './PreviewPanel.tsx'

export function OfficePreviewAction({ ctx, wide }: { ctx: ClientContext; wide: boolean }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Office 预览"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: wide ? '8px 12px' : '8px',
          fontSize: '13px',
          background: 'none',
          border: 'none',
          color: 'var(--dsh-fg-primary, #e0e0e0)',
          cursor: 'pointer',
          borderRadius: '6px',
          transition: 'background 0.15s',
        }}
        onMouseOver={(e) => e.currentTarget.style.background = 'var(--dsh-bg-hover, #2d2d44)'}
        onMouseOut={(e) => e.currentTarget.style.background = 'none'}
      >
        <span style={{ fontSize: '16px' }}>📄</span>
        {wide && <span>Office 预览</span>}
      </button>
      {open && createPortal(<PreviewPanel ctx={ctx} onClose={() => setOpen(false)} wide={wide} />, document.body)}
    </>
  )
}