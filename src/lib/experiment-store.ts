/**
 * 全局实验数据存储 — 步骤三：数据工作流与学术闭环
 *
 * 三大职责：
 * 1. 快照管理（Snapshot）—— 截取实验视图存入临时记录区，供 PDF 报告导出
 * 2. 浮动撕下面板（Tear-off Panel）—— 跨模块保持的对比面板，带对齐辅助
 * 3. 实验状态缓存（State Cache）—— 切换模块时保留每个实验的最后参数与图表
 *
 * 持久化策略：localStorage（键名 ops-lab-v3），刷新后保留
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ViewId } from './navigation'

/* ─── 类型定义 ─── */

export interface Snapshot {
  id: string
  /** 来源实验 ViewId */
  viewId: ViewId
  /** 实验标题 */
  experimentTitle: string
  /** 快照标题（用户可编辑） */
  title: string
  /** 截图时间戳 ISO */
  timestamp: string
  /** 图像 dataURL（PNG） */
  image: string
  /** 图像宽度 */
  width: number
  /** 图像高度 */
  height: number
  /** 关键参数键值对 */
  params: { key: string; value: string }[]
  /** 用户备注 */
  notes?: string
  /** 是否勾选用于导出 */
  selected: boolean
}

export interface TearOffPanel {
  id: string
  /** 来源实验 ViewId */
  viewId: ViewId
  /** 来源可视化标题（如"偏振椭圆""衍射图样"） */
  title: string
  /** 图像 dataURL */
  image: string
  /** 图像宽度 */
  width: number
  /** 图像高度 */
  height: number
  /** 关键参数 */
  params: { key: string; value: string }[]
  /** 截取时间戳 */
  timestamp: string
  /** 浮动位置 x */
  x: number
  /** 浮动位置 y */
  y: number
  /** 面板显示宽度 */
  panelWidth: number
}

export interface ExperimentStateCache {
  /** 实验 ViewId */
  viewId: ViewId
  /** 序列化的状态对象（任意结构） */
  state: Record<string, unknown>
  /** 最后更新时间 */
  updatedAt: string
}

interface ExperimentStoreState {
  /* 快照 */
  snapshots: Snapshot[]
  /* 撕下面板 */
  tearOffPanels: TearOffPanel[]
  /* 实验状态缓存（按 viewId 索引） */
  stateCache: Record<string, ExperimentStateCache>
  /* 是否显示对齐辅助线 */
  showAlignmentGuides: boolean

  /* ── 快照操作 ── */
  addSnapshot: (s: Omit<Snapshot, 'id' | 'selected'>) => string
  removeSnapshot: (id: string) => void
  toggleSnapshotSelected: (id: string) => void
  setSnapshotSelected: (id: string, selected: boolean) => void
  selectAllSnapshots: (selected: boolean) => void
  clearSnapshots: () => void
  updateSnapshotNotes: (id: string, notes: string) => void
  updateSnapshotTitle: (id: string, title: string) => void

  /* ── 撕下面板操作 ── */
  addTearOffPanel: (p: Omit<TearOffPanel, 'id'>) => string
  removeTearOffPanel: (id: string) => void
  updateTearOffPanelPosition: (id: string, x: number, y: number) => void
  clearTearOffPanelsByView: (viewId: ViewId) => void
  clearAllTearOffPanels: () => void

  /* ── 实验状态缓存 ── */
  saveExperimentState: (viewId: ViewId, state: Record<string, unknown>) => void
  loadExperimentState: (viewId: ViewId) => Record<string, unknown> | null
  clearExperimentState: (viewId: ViewId) => void

  /* ── 对齐辅助 ── */
  toggleAlignmentGuides: () => void
}

function genId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export const useExperimentStore = create<ExperimentStoreState>()(
  persist(
    (set, get) => ({
      snapshots: [],
      tearOffPanels: [],
      stateCache: {},
      showAlignmentGuides: true,

      /* ── 快照 ── */
      addSnapshot: (s) => {
        const id = genId()
        set(state => ({
          snapshots: [
            ...state.snapshots,
            { ...s, id, selected: true },
          ],
        }))
        return id
      },
      removeSnapshot: (id) => set(state => ({
        snapshots: state.snapshots.filter(s => s.id !== id),
      })),
      toggleSnapshotSelected: (id) => set(state => ({
        snapshots: state.snapshots.map(s =>
          s.id === id ? { ...s, selected: !s.selected } : s
        ),
      })),
      setSnapshotSelected: (id, selected) => set(state => ({
        snapshots: state.snapshots.map(s =>
          s.id === id ? { ...s, selected } : s
        ),
      })),
      selectAllSnapshots: (selected) => set(state => ({
        snapshots: state.snapshots.map(s => ({ ...s, selected })),
      })),
      clearSnapshots: () => set({ snapshots: [] }),
      updateSnapshotNotes: (id, notes) => set(state => ({
        snapshots: state.snapshots.map(s =>
          s.id === id ? { ...s, notes } : s
        ),
      })),
      updateSnapshotTitle: (id, title) => set(state => ({
        snapshots: state.snapshots.map(s =>
          s.id === id ? { ...s, title } : s
        ),
      })),

      /* ── 撕下面板 ── */
      addTearOffPanel: (p) => {
        const id = genId()
        set(state => ({
          tearOffPanels: [...state.tearOffPanels, { ...p, id }],
        }))
        return id
      },
      removeTearOffPanel: (id) => set(state => ({
        tearOffPanels: state.tearOffPanels.filter(p => p.id !== id),
      })),
      updateTearOffPanelPosition: (id, x, y) => set(state => ({
        tearOffPanels: state.tearOffPanels.map(p =>
          p.id === id ? { ...p, x, y } : p
        ),
      })),
      clearTearOffPanelsByView: (viewId) => set(state => ({
        tearOffPanels: state.tearOffPanels.filter(p => p.viewId !== viewId),
      })),
      clearAllTearOffPanels: () => set({ tearOffPanels: [] }),

      /* ── 实验状态缓存 ── */
      saveExperimentState: (viewId, state) => set(s => ({
        stateCache: {
          ...s.stateCache,
          [viewId]: {
            viewId,
            state,
            updatedAt: new Date().toISOString(),
          },
        },
      })),
      loadExperimentState: (viewId) => {
        const cached = get().stateCache[viewId]
        return cached ? cached.state : null
      },
      clearExperimentState: (viewId) => set(s => {
        const next = { ...s.stateCache }
        delete next[viewId]
        return { stateCache: next }
      }),

      /* ── 对齐辅助 ── */
      toggleAlignmentGuides: () => set(s => ({ showAlignmentGuides: !s.showAlignmentGuides })),
    }),
    {
      name: 'ops-lab-v3',
      // 仅持久化数据，不持久化函数
      partialize: (s) => ({
        snapshots: s.snapshots,
        tearOffPanels: s.tearOffPanels,
        stateCache: s.stateCache,
        showAlignmentGuides: s.showAlignmentGuides,
      }),
    }
  )
)

/* ─── 选择器便捷 hooks ─── */

export const useSnapshots = () => useExperimentStore(s => s.snapshots)
export const useTearOffPanels = () => useExperimentStore(s => s.tearOffPanels)
export const useSelectedSnapshots = () =>
  useExperimentStore(s => s.snapshots.filter(x => x.selected))
export const useSnapshotCount = () => useExperimentStore(s => s.snapshots.length)
