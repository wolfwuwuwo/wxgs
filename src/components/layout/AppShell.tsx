'use client'

import { useState, useCallback, useSyncExternalStore, type ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { StatusBar } from './StatusBar'
import { GuideFloatingBall } from './GuideFloatingBall'
import { useIsMobile } from '@/hooks/use-mobile'
import type { ViewId } from '@/lib/navigation'
import { useExperimentStore } from '@/lib/experiment-store'
import { captureCurrentSnapshot, subscribeSnapshotRegistry, getCurrentSnapshotViewId } from '@/lib/snapshot-registry'
import { findBranch, findExperiment } from '@/lib/navigation'
import { SnapshotGallery } from '@/components/simulations/shared/SnapshotGallery'
import { TearOffPanelRenderer } from '@/components/simulations/shared/TearOffPanel'
import { toast } from 'sonner'

interface AppShellProps {
  currentView: ViewId
  onNavigate: (id: ViewId) => void
  footerText: string
  children: ReactNode
}

// 订阅 snapshot registry 变化的 hook（用于触发 StatusBar 重渲染）
function useSnapshotRegistryVersion() {
  return useSyncExternalStore(
    subscribeSnapshotRegistry,
    () => getCurrentSnapshotViewId(),
    () => null
  )
}

export function AppShell({ currentView, onNavigate, footerText, children }: AppShellProps) {
  const isMobile = useIsMobile()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [galleryOpen, setGalleryOpen] = useState(false)

  // 实验数据 store
  const snapshotCount = useExperimentStore(s => s.snapshots.length)
  const tearOffPanels = useExperimentStore(s => s.tearOffPanels)
  const addSnapshot = useExperimentStore(s => s.addSnapshot)
  const clearAllTearOffPanels = useExperimentStore(s => s.clearAllTearOffPanels)

  // 订阅 snapshot registry 变化
  useSnapshotRegistryVersion()

  const navigate = useCallback((id: ViewId) => {
    onNavigate(id)
    setSearchQuery('')
  }, [onNavigate])

  /* ── 快照捕获 ── */
  const handleSnapshot = useCallback(() => {
    const result = captureCurrentSnapshot()
    if (!result) {
      toast.error('当前页面无可截取的实验视图', {
        description: '请进入具体实验模块后再截取快照',
      })
      return
    }
    const viewId = getCurrentSnapshotViewId()
    const exp = viewId ? findExperiment(viewId) : null
    const branch = viewId ? findBranch(viewId) : null

    addSnapshot({
      viewId: viewId || 'home',
      experimentTitle: exp?.title || '实验',
      title: result.title,
      timestamp: new Date().toISOString(),
      image: result.image,
      width: result.width,
      height: result.height,
      params: result.params,
    })

    toast.success(`快照已保存：${result.title}`, {
      description: `${branch?.shortTitle || ''} ${exp?.shortTitle || ''} · ${result.width}×${result.height}px`,
    })
  }, [addSnapshot])

  const handleClearTearOff = useCallback(() => {
    if (tearOffPanels.length === 0) return
    if (confirm(`确定清除全部 ${tearOffPanels.length} 个对比面板？`)) {
      clearAllTearOffPanels()
    }
  }, [tearOffPanels.length, clearAllTearOffPanels])

  return (
    <div className="flex flex-col" style={{ height: '100vh', backgroundColor: '#FFFFFF', overflow: 'hidden' }}>
      {/* 顶部标题栏 */}
      <TopBar
        currentView={currentView}
        onNavigate={navigate}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onOpenMobileSidebar={() => setMobileSidebarOpen(true)}
      />

      {/* 主体：侧边栏 + 内容 */}
      <div className="flex flex-1" style={{ minHeight: 0 }}>
        <Sidebar
          currentView={currentView}
          onNavigate={navigate}
          searchQuery={searchQuery}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(c => !c)}
          mobileOpen={mobileSidebarOpen && isMobile}
          onCloseMobile={() => setMobileSidebarOpen(false)}
        />

        {/* 内容区 */}
        <main className="flex-1 flex flex-col" style={{ minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
          <div className="flex-1" style={{ minHeight: 0, overflow: 'hidden' }}>
            {children}
          </div>
        </main>
      </div>

      {/* 底部状态栏 */}
      <StatusBar
        text={footerText}
        onSnapshot={handleSnapshot}
        snapshotCount={snapshotCount}
        onOpenGallery={() => setGalleryOpen(true)}
        tearOffCount={tearOffPanels.length}
        onClearTearOff={handleClearTearOff}
      />

      {/* 全局撕下面板渲染器（跨模块持久化） */}
      <TearOffPanelRenderer />

      {/* 快照记录区抽屉 */}
      <SnapshotGallery open={galleryOpen} onClose={() => setGalleryOpen(false)} />

      {/* 全局导学悬浮球（各模块实验原理 + 使用教程） */}
      <GuideFloatingBall currentView={currentView} onNavigate={navigate} />
    </div>
  )
}
