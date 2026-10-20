import { useState } from 'react'
import { createPortal } from 'react-dom'
import { IconListPenOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { PreviewPanel } from './PreviewPanel.tsx'
import { actionButton, actionButtonHover, actionIcon } from './styles.ts'

export function OfficePreviewAction({ ctx, wide }: { ctx: ClientContext; wide: boolean }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Office 预览"
        style={actionButton}
        onMouseOver={(e) => e.currentTarget.style.backgroundColor = actionButtonHover.backgroundColor}
        onMouseOut={(e) => e.currentTarget.style.backgroundColor = ''}
      >
        <span style={actionIcon}><IconListPenOutlineRegular size={16} /></span>
        {wide && <span>Office 预览</span>}
      </button>
      {open && createPortal(<PreviewPanel ctx={ctx} onClose={() => setOpen(false)} wide={wide} />, document.body)}
    </>
  )
}
