'use client'

/**
 * 实验状态缓存 Hook — 自动保存/恢复实验状态
 *
 * 用法：
 *   const { state, setState } = useExperimentState('physical-polarimeter', defaultState)
 *
 * - 首次进入：返回 defaultState
 * - 切换模块后返回：自动恢复上次状态
 * - 状态变化：debounce 500ms 后写入 store（localStorage 持久化）
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useExperimentStore } from '@/lib/experiment-store'
import type { ViewId } from '@/lib/navigation'

export function useExperimentState<T extends Record<string, unknown>>(
  viewId: ViewId,
  defaultState: T
): {
  state: T
  setState: (next: T | ((prev: T) => T)) => void
  clearCache: () => void
  hasRestored: boolean
} {
  const saveExperimentState = useExperimentStore(s => s.saveExperimentState)
  const loadExperimentState = useExperimentStore(s => s.loadExperimentState)
  const clearExperimentState = useExperimentStore(s => s.clearExperimentState)

  // 初始化：从缓存恢复（useState 初始化器同步读取缓存）
  const [state, setStateInternal] = useState<T>(() => {
    if (typeof window === 'undefined') return defaultState
    const cached = loadExperimentState(viewId)
    if (cached) {
      // 合并默认值与缓存（确保新增字段有默认值）
      return { ...defaultState, ...(cached as Partial<T>) }
    }
    return defaultState
  })

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stateRef = useRef(state)
  useEffect(() => { stateRef.current = state }, [state])

  // 恢复标记：useState 初始化已从缓存读取，hasRestored 仅用于告知外部"已尝试恢复"
  const [hasRestored] = useState(true)

  // 防抖保存
  const setState = useCallback((next: T | ((prev: T) => T)) => {
    setStateInternal(prev => {
      const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        saveExperimentState(viewId, resolved as Record<string, unknown>)
      }, 500)
      return resolved
    })
  }, [saveExperimentState, viewId])

  const clearCache = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    clearExperimentState(viewId)
    setStateInternal(defaultState)
  }, [clearExperimentState, viewId, defaultState])

  // 卸载时立即保存（避免丢失最后 500ms 的变更）
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      saveExperimentState(viewId, stateRef.current as Record<string, unknown>)
    }
  }, [saveExperimentState, viewId])

  return { state, setState, clearCache, hasRestored }
}

/**
 * 仅在卸载时保存的轻量版本（用于不需要每次变更都缓存的场景）
 */
export function usePersistOnUnmount<T extends Record<string, unknown>>(
  viewId: ViewId,
  state: T
) {
  const saveExperimentState = useExperimentStore(s => s.saveExperimentState)
  const stateRef = useRef(state)
  useEffect(() => { stateRef.current = state }, [state])

  useEffect(() => {
    return () => {
      saveExperimentState(viewId, stateRef.current as Record<string, unknown>)
    }
  }, [saveExperimentState, viewId])
}
