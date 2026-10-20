import type { Context as ClientContext } from '@deepseek-ai/cordis'
// 类型侧增补：ctx.slots（ui-renderer 提供）与 ctx.sessions（session-controller 提供）
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
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
