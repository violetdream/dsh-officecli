/**
 * 本地类型声明垫片（ambient module shim，脚本级）。
 *
 * `@deepseek-ai/dsh-attachment` 是宿主（DSH host）内部包，插件在离线/CI 构建时
 * 不会把它作为直接依赖安装。但 `office_screenshot` 需要把渲染出的 PNG 通过宿主的
 * `attachments` 服务持久化成 `ImageAttachmentRef`，才能让模型在对话里直接"看到"
 * 渲染结果做视觉自检。本垫片照抄宿主包 `lib/types` 中的真实类型，使 `tsc` 能正确
 * 解析（全部为 type-only，编译后会被擦除，无运行时依赖）。
 *
 * 注意：本文件刻意保持为「脚本」（无顶层 import/export），这样 `declare module`
 * 会被当作该未安装模块的完整环境声明。cordis 的 `attachments` 服务增强放在同目录
 * 的 `cordis-augment.d.ts`（模块级），以免覆盖 cordis 真实的 Context。
 *
 * 类型来源：node_modules/.pnpm 下的 @deepseek-ai/dsh-attachment 包的 lib/types 目录，
 * 与 `@deepseek-ai/dsh-tool-fs/src/read-image.ts` 的官方用法保持一致。
 */
declare module '@deepseek-ai/dsh-attachment' {
  export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
  export type AttachmentId = string
  export interface ImageAttachmentRef {
    attachmentId: AttachmentId
    mediaType: ImageMediaType
    bytes: number
    width: number
    height: number
    name?: string
  }
  export interface ImageAttachmentLimits {
    maxImageBytes: number
    maxImagesPerMessage: number
    maxMessageImageBytes: number
    maxImagePixels: number
    maxImageDimension: number
    mediaTypes: readonly ImageMediaType[]
  }
  export interface SaveImageAttachment {
    data: Uint8Array
    mediaType: ImageMediaType
    name?: string
  }
  export interface StoredImageAttachment {
    ref: ImageAttachmentRef
    data: Uint8Array
  }
  export interface EncodedImageAttachment {
    mediaType: ImageMediaType
    data: string
    name?: string
  }
  export interface AttachmentStore {
    readonly imageLimits: ImageAttachmentLimits
    validateImage(input: SaveImageAttachment): Promise<void>
    saveImages(inputs: readonly SaveImageAttachment[]): Promise<readonly ImageAttachmentRef[]>
    saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef>
    readImage(ref: ImageAttachmentRef, signal?: AbortSignal): Promise<StoredImageAttachment>
  }
}
