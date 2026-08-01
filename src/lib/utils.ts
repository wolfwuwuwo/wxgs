import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * 将 ImageData 按 CSS 尺寸绘制到已启用 dpr 缩放的 canvas 上。
 *
 * 背景：putImageData 不受 ctx 变换影响，若在高 DPI（devicePixelRatio > 1）
 * 下直接把 ImageData 写入 (0,0)，图案只会落在放大后的位图左上角，
 * 而后续描边（圆形边框/十字线等）随 dpr 变换保持居中，导致图案与边框
 * 发生位移（偏左上角）。通过临时画布 + drawImage 以 CSS 尺寸绘制，
 * 可让图案始终铺满画布并与描边对齐。
 */
export function blitImageData(
  ctx: CanvasRenderingContext2D,
  imageData: ImageData,
  width: number,
  height: number,
) {
  if (window.devicePixelRatio <= 1) {
    ctx.putImageData(imageData, 0, 0)
    return
  }
  const tmp = document.createElement('canvas')
  tmp.width = width
  tmp.height = height
  const tctx = tmp.getContext('2d')
  if (!tctx) return
  tctx.putImageData(imageData, 0, 0)
  ctx.clearRect(0, 0, width, height)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(tmp, 0, 0, width, height)
}
