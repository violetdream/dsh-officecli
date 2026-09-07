import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { OfficePreviewAction } from './OfficePreviewAction.tsx'

// sessions 用于读取当前会话 id（侧边栏面板按会话隔离拉取文件）
export const inject = ['slots', 'sessions']
export const name = 'dsh-officecli/client'

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register(
      { name: 'sidebar.footer.action', id: 'officecli-preview', label: 'Office 预览' },
      (props: { wide: boolean }) => <OfficePreviewAction ctx={ctx} wide={props.wide} />,
    )), 'dsh-officecli: sidebar action')
}
