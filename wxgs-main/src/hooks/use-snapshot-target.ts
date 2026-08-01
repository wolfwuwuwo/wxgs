'use client'

/**
 * useSnapshotTarget — 实验组件注册快照捕获函数
 *
 * 用法：
 *   const vizRef = useRef<HTMLDivElement>(null)
 *   useSnapshotTarget(viewId, {
 *     capture: () => {
 *       // 从 vizRef 截图并返回数据
 *       return { image, width, height, params, title }
 *     },
 *     // 也可提供标题与参数的便捷函数
 *     getTitle: () => `偏振椭圆 - ${angle}°`,
 *     getParams: () => [{ key: 'λ', value: '632.8nm' }, ...],
 *   })
 */

import { useEffect, useRef } from 'react'
import {
  registerSnapshotTarget,
  unregisterSnapshotTarget,
  type SnapshotCaptureResult,
} from '@/lib/snapshot-registry'
import type { ViewId } from '@/lib/navigation'
import { smartCapture } from '@/lib/capture'

interface UseSnapshotTargetOptions {
  /** 捕获函数（自定义）。不提供则使用默认的 smartCapture(targetRef) */
  capture?: () => SnapshotCaptureResult | null
  /** 目标容器 ref（默认 capture 时使用） */
  targetRef?: React.RefObject<HTMLElement | null>
  /** 快照标题 */
  getTitle?: () => string
  /** 关键参数 */
  getParams?: () => { key: string; value: string }[]
}

export function useSnapshotTarget(
  viewId: ViewId,
  options: UseSnapshotTargetOptions
) {
  const optionsRef = useRef(options)
  useEffect(() => { optionsRef.current = options })

  useEffect(() => {
    const capture = (): SnapshotCaptureResult | null => {
      const opts = optionsRef.current
      // 优先用自定义 capture
      if (opts.capture) return opts.capture()
      // 默认：用 smartCapture 截取 targetRef
      if (opts.targetRef?.current) {
        const result = smartCapture(opts.targetRef.current)
        if (result) {
          return {
            ...result,
            params: opts.getParams?.() ?? [],
            title: opts.getTitle?.() ?? '实验快照',
          }
        }
      }
      return null
    }

    registerSnapshotTarget(viewId, capture)
    return () => unregisterSnapshotTarget(viewId)
  }, [viewId])
}
