'use client'

/**
 * 快照捕获注册表 — 连接 StatusBar 快照按钮与当前激活实验的可视化区域
 *
 * 工作原理：
 * - 每个实验组件 mount 时通过 registerSnapshotTarget 注册自己的捕获函数
 * - StatusBar 点击快照按钮时调用 captureCurrentSnapshot
 * - captureCurrentSnapshot 调用当前 viewId 对应的注册函数
 *
 * 注册函数职责：
 * - 截取实验主可视化区（canvas/svg）
 * - 返回 { image, width, height, params, title } 数据
 */

import type { ViewId } from '@/lib/navigation'

export interface SnapshotCaptureResult {
  image: string
  width: number
  height: number
  params: { key: string; value: string }[]
  title: string
}

type CaptureFn = () => SnapshotCaptureResult | null

interface RegistryEntry {
  viewId: ViewId
  capture: CaptureFn
}

// 模块级单例（不持久化，仅当前会话）
let currentEntry: RegistryEntry | null = null

const listeners = new Set<() => void>()

export function registerSnapshotTarget(viewId: ViewId, capture: CaptureFn) {
  currentEntry = { viewId, capture }
  listeners.forEach(l => l())
}

export function unregisterSnapshotTarget(viewId: ViewId) {
  if (currentEntry?.viewId === viewId) {
    currentEntry = null
    listeners.forEach(l => l())
  }
}

export function captureCurrentSnapshot(): SnapshotCaptureResult | null {
  if (!currentEntry) return null
  return currentEntry.capture()
}

export function getCurrentSnapshotViewId(): ViewId | null {
  return currentEntry?.viewId ?? null
}

export function subscribeSnapshotRegistry(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
