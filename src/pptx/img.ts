/**
 * 读图片的固有像素尺寸。
 *
 * 为什么需要：officecli 的 `picture` 不做等比缩放 —— 框的宽高比与原图不一致
 * 就会拉伸（1.0.158 起还会在 `view issues` 里报 P1）。版式只有图片路径、
 * 没有像素尺寸，所以在编译期读一次文件头，把框收敛成原图比例（contain），
 * 或者给整幅底图补一个 cover 裁切。
 *
 * 只解析文件头，不解码像素：PNG（IHDR）、JPEG（SOF）、GIF、WebP。
 * 读不出来时返回 undefined，调用方退回旧行为。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export interface ImageSize {
  width: number
  height: number
}

/** 解析 PNG：8 字节签名 + 4 字节长度 + "IHDR" 后紧跟宽高（各 4 字节，大端）。 */
function pngSize(b: Buffer): ImageSize | undefined {
  if (b.length < 24) return undefined
  if (b.readUInt32BE(0) !== 0x89504e47 || b.readUInt32BE(4) !== 0x0d0a1a0a) return undefined
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
}

/** 解析 JPEG：逐段跳 SOF0–SOF15（跳过 C4/C8/CC），段内前 5 字节是精度 + 高 + 宽。 */
function jpegSize(b: Buffer): ImageSize | undefined {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return undefined
  let i = 2
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i += 1
      continue
    }
    const marker = b[i + 1]!
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2
      continue
    }
    const len = b.readUInt16BE(i + 2)
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isSof) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) }
    i += 2 + len
  }
  return undefined
}

/** 解析 GIF：签名后 6 字节逻辑屏宽高（小端）。 */
function gifSize(b: Buffer): ImageSize | undefined {
  const sig = b.subarray(0, 6).toString('latin1')
  if (sig !== 'GIF87a' && sig !== 'GIF89a') return undefined
  if (b.length < 10) return undefined
  return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) }
}

/** 解析 WebP：VP8X / VP8 / VP8L 三种块头。 */
function webpSize(b: Buffer): ImageSize | undefined {
  if (b.length < 30) return undefined
  if (b.subarray(0, 4).toString('latin1') !== 'RIFF') return undefined
  if (b.subarray(8, 12).toString('latin1') !== 'WEBP') return undefined
  const chunk = b.subarray(12, 16).toString('latin1')
  if (chunk === 'VP8X') {
    return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) }
  }
  if (chunk === 'VP8 ') {
    return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff }
  }
  if (chunk === 'VP8L') {
    const bits = b.readUInt32LE(21)
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
  }
  return undefined
}

/**
 * 读图片的像素尺寸。
 * @param src - 绝对路径或相对当前工作目录的路径（与 officecli 的解析口径一致）。
 * @returns 宽高；文件不存在或格式不认识时 undefined。
 */
export function imageSize(src: string): ImageSize | undefined {
  try {
    const buf = readFileSync(resolve(src))
    return pngSize(buf) ?? jpegSize(buf) ?? gifSize(buf) ?? webpSize(buf)
  } catch {
    return undefined
  }
}

/**
 * 把框收敛成原图宽高比（contain）：宽高都不超过给定上限，居中返回。
 * 这样图片不会被拉伸，视觉上等于 `object-fit: contain`。
 * @param box - 原始图槽。
 * @param size - 原图像素尺寸。
 * @returns 收敛后的框；尺寸不可用时原样返回。
 */
export function containBox(
  box: { x: number; y: number; w: number; h: number },
  size: ImageSize | undefined,
): { x: number; y: number; w: number; h: number } {
  if (!size || size.width <= 0 || size.height <= 0) return box
  const ratio = size.width / size.height
  let w = box.w
  let h = w / ratio
  if (h > box.h) {
    h = box.h
    w = h * ratio
  }
  return {
    x: box.x + (box.w - w) / 2,
    y: box.y + (box.h - h) / 2,
    w,
    h,
  }
}

/**
 * 计算 cover 裁切参数：框比原图更宽就裁上下，更高就裁左右。
 * @param box - 目标框（宽高比即裁切目标）。
 * @param size - 原图像素尺寸。
 * @returns officecli 的四值裁切串 `left,top,right,bottom`（百分比，两位小数）；
 *          尺寸不可用或已同比例时 undefined。
 */
export function coverCrop(
  box: { w: number; h: number },
  size: ImageSize | undefined,
): string | undefined {
  if (!size || size.width <= 0 || size.height <= 0 || box.w <= 0 || box.h <= 0) return undefined
  const boxRatio = box.w / box.h
  const imgRatio = size.width / size.height
  const pct = (v: number) => Math.round(v * 10000) / 100
  if (Math.abs(boxRatio - imgRatio) < 1e-3) return undefined
  if (imgRatio > boxRatio) {
    // 图更宽：左右各裁掉一半差额
    const cut = pct((1 - boxRatio / imgRatio) / 2)
    return `${cut},0,${cut},0`
  }
  // 图更高：上下各裁掉一半差额
  const cut = pct((1 - imgRatio / boxRatio) / 2)
  return `0,${cut},0,${cut}`
}
