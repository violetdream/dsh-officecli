/**
 * Sidebar 插槽契约的本地镜像。
 *
 * dsh-officecli 的浏览器半只往 `sidebar.footer.action` 这一个座位注册，
 * 因此这里只声明该座位 —— 不引入 @deepseek-ai/dsh-client-ui-sidebar 依赖
 * （那个包的类型会连带拉进整棵 client 依赖树）。契约与
 * packages/client/ui-sidebar/src/client/contract/slots.ts 保持一致。
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** 侧边栏底部、设置按钮旁的自定义动作（列表座位，可并存多项）。 */
    'sidebar.footer.action': {
      kind: 'list'
      scope: 'root'
      owner: { wide: boolean }
    }
  }
}
