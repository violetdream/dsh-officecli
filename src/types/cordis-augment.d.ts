/**
 * cordis 服务增强（模块级，合并式）。
 *
 * 必须放在独立的「模块」文件里（顶层 `export {}` 使其成为模块），这样
 * `declare module '@deepseek-ai/cordis'` 会被当作对真实 cordis 的**合并增强**，
 * 而不会像脚本级 `declare module` 那样覆盖掉 Context 上既有的 `logger`/`effect`/
 * `get` 等成员。
 *
 * `@deepseek-ai/dsh-attachment` 的类型由同目录 `dsh-attachment.d.ts`（脚本级）声明，
 * 这里通过内联 `import(...)` 引用其 `AttachmentStore`。
 */
export {}

declare module '@deepseek-ai/cordis' {
  interface Context {
    attachments: import('@deepseek-ai/dsh-attachment').AttachmentStore
  }
}
