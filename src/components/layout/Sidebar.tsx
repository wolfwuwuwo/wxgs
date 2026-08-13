'use client'

import { useState, useMemo } from 'react'
import { NAV_TREE, ALL_EXPERIMENTS, type ViewId, type BranchId, type BranchNode, searchExperiments } from '@/lib/navigation'

const FONT = "system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif"

interface SidebarProps {
  currentView: ViewId
  onNavigate: (id: ViewId) => void
  searchQuery: string
  collapsed: boolean
  onToggleCollapse: () => void
  mobileOpen: boolean
  onCloseMobile: () => void
}

export function Sidebar({
  currentView, onNavigate, searchQuery, collapsed, onToggleCollapse,
  mobileOpen, onCloseMobile,
}: SidebarProps) {
  // 用户手动覆盖的展开状态：true=强制展开, false=强制折叠, undefined=默认(激活分支展开)
  const [manualState, setManualState] = useState<Partial<Record<BranchId, boolean>>>({})

  // 搜索结果
  const searchResults = useMemo(() => searchExperiments(searchQuery), [searchQuery])
  const isSearching = searchQuery.trim().length > 0

  // 派生：某分支是否展开 = 用户覆盖 ?? (该分支含当前激活项)
  const isBranchExpanded = (branch: BranchNode): boolean => {
    if (collapsed) return false
    const isActive = currentView === branch.hubId || branch.experiments.some(e => e.id === currentView)
    return manualState[branch.id] ?? isActive
  }

  const toggleBranch = (id: BranchId) => {
    if (collapsed) return
    const branch = NAV_TREE.find(b => b.id === id)!
    const current = isBranchExpanded(branch)
    setManualState(prev => ({ ...prev, [id]: !current }))
  }

  const handleNavigate = (id: ViewId) => {
    onNavigate(id)
    onCloseMobile()
  }

  const expandedWidth = 232
  const collapsedWidth = 52

  /* ─── 搜索模式：扁平结果列表 ─── */
  const renderSearchResults = () => (
    <div className="flex flex-col" style={{ padding: '8px 6px' }}>
      <div style={{ fontFamily: FONT, fontSize: '10px', fontWeight: 500, color: '#888888', padding: '6px 10px', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
        搜索结果 · {searchResults.length}
      </div>
      {searchResults.length === 0 && (
        <div style={{ fontFamily: FONT, fontSize: '12px', color: '#888888', padding: '16px 10px', lineHeight: 1.6 }}>
          未找到匹配的实验。<br />尝试关键词：偏振、衍射、高斯、光纤、棱镜……
        </div>
      )}
      {searchResults.map(exp => {
        const branch = NAV_TREE.find(b => b.experiments.some(e => e.id === exp.id))!
        const isActive = currentView === exp.id
        return (
          <button
            key={exp.id}
            onClick={() => handleNavigate(exp.id)}
            className="sidebar-item"
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
              width: '100%', padding: '9px 10px', minHeight: '44px',
              backgroundColor: isActive ? '#F0F3F6' : 'transparent',
              border: 'none', cursor: 'pointer', textAlign: 'left',
              transition: 'background-color 120ms ease-out',
              borderRadius: '3px',
            }}
            onMouseEnter={e => { if (!isActive) e.currentTarget.style.backgroundColor = '#FAFAFA' }}
            onMouseLeave={e => { if (!isActive) e.currentTarget.style.backgroundColor = 'transparent' }}
          >
            <span style={{ fontFamily: FONT, fontSize: '13px', fontWeight: 500, color: isActive ? '#1A1A1A' : '#333333' }}>
              {exp.shortTitle}
            </span>
            <span style={{ fontFamily: FONT, fontSize: '10px', fontWeight: 400, color: '#888888', marginTop: '2px' }}>
              {branch.title}
            </span>
          </button>
        )
      })}
    </div>
  )

  /* ─── 树状导航 ─── */
  const renderTree = () => (
    <div className="flex flex-col" style={{ padding: '8px 6px' }}>
      {/* 首页 */}
      <button
        onClick={() => handleNavigate('home')}
        className="sidebar-item"
        style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          width: '100%', padding: '0 10px', height: '40px', minHeight: '44px',
          backgroundColor: currentView === 'home' ? '#F0F3F6' : 'transparent',
          border: 'none', cursor: 'pointer', textAlign: 'left',
          transition: 'background-color 120ms ease-out',
          borderRadius: '3px', marginBottom: '4px', position: 'relative',
        }}
        onMouseEnter={e => { if (currentView !== 'home') e.currentTarget.style.backgroundColor = '#FAFAFA' }}
        onMouseLeave={e => { if (currentView !== 'home') e.currentTarget.style.backgroundColor = 'transparent' }}
        title={collapsed ? '首页' : undefined}
      >
        {/* 左侧激活指示条 */}
        {currentView === 'home' && !collapsed && (
          <span style={{
            position: 'absolute', left: '-6px', top: '8px', bottom: '8px',
            width: '3px', backgroundColor: '#1A1A1A', borderRadius: '2px',
          }} />
        )}
        <HomeIcon active={currentView === 'home'} />
        {!collapsed && (
          <span style={{
            fontFamily: FONT, fontSize: '13px',
            fontWeight: currentView === 'home' ? 600 : 500,
            color: currentView === 'home' ? '#1A1A1A' : '#333333',
          }}>
            首页
          </span>
        )}
      </button>

      {NAV_TREE.map(branch => {
        const isBranchActive = currentView === branch.hubId || branch.experiments.some(e => e.id === currentView)
        const isExpanded = isBranchExpanded(branch)

        return (
          <div key={branch.id} style={{ marginBottom: '2px' }}>
            {/* 分支标题（可点击进入 hub，也可展开） */}
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <button
                onClick={() => handleNavigate(branch.hubId)}
                onDoubleClick={() => toggleBranch(branch.id)}
                className="sidebar-item"
                style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  flex: 1, padding: '0 10px', height: '40px', minHeight: '44px',
                  backgroundColor: currentView === branch.hubId ? '#F0F3F6' : 'transparent',
                  border: 'none', cursor: 'pointer', textAlign: 'left',
                  transition: 'background-color 120ms ease-out',
                  borderRadius: '3px', position: 'relative',
                }}
                onMouseEnter={e => { if (currentView !== branch.hubId) e.currentTarget.style.backgroundColor = '#FAFAFA' }}
                onMouseLeave={e => { if (currentView !== branch.hubId) e.currentTarget.style.backgroundColor = 'transparent' }}
                title={collapsed ? branch.title : undefined}
              >
                {/* 左侧激活指示条 */}
                {currentView === branch.hubId && !collapsed && (
                  <span style={{
                    position: 'absolute', left: '-6px', top: '8px', bottom: '8px',
                    width: '3px', backgroundColor: '#1A1A1A', borderRadius: '2px',
                  }} />
                )}
                <BranchIcon glyph={branch.iconText} active={isBranchActive} />
                {!collapsed && (
                  <span style={{
                    fontFamily: FONT, fontSize: '13px',
                    fontWeight: isBranchActive ? 600 : 500,
                    color: isBranchActive ? '#1A1A1A' : '#333333',
                    flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {branch.title}
                  </span>
                )}
              </button>
              {!collapsed && (
                <button
                  onClick={() => toggleBranch(branch.id)}
                  aria-label={isExpanded ? '折叠' : '展开'}
                  style={{
                    width: '24px', height: '40px', minHeight: '44px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: '#888888', transition: 'transform 150ms ease-out, color 120ms ease-out',
                    transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                  }}
                  onMouseEnter={e => e.currentTarget.style.color = '#333333'}
                  onMouseLeave={e => e.currentTarget.style.color = '#888888'}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M3 1.5L7 5L3 8.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              )}
            </div>

            {/* 实验列表 */}
            {isExpanded && (
              <div style={{ marginTop: '2px', position: 'relative' }}>
                {branch.experiments.map(exp => {
                  const isActive = currentView === exp.id
                  return (
                    <button
                      key={exp.id}
                      onClick={() => handleNavigate(exp.id)}
                      className="sidebar-item"
                      style={{
                        display: 'flex', alignItems: 'center', gap: '8px',
                        width: '100%', padding: '0 10px 0 24px', height: '36px', minHeight: '44px',
                        backgroundColor: isActive ? '#F0F3F6' : 'transparent',
                        border: 'none', cursor: 'pointer', textAlign: 'left',
                        transition: 'background-color 120ms ease-out',
                        borderRadius: '3px', position: 'relative',
                      }}
                      onMouseEnter={e => { if (!isActive) e.currentTarget.style.backgroundColor = '#FAFAFA' }}
                      onMouseLeave={e => { if (!isActive) e.currentTarget.style.backgroundColor = 'transparent' }}
                    >
                      {/* 左侧激活指示条 */}
                      {isActive && (
                        <span style={{
                          position: 'absolute', left: '8px', top: '8px', bottom: '8px',
                          width: '2px', backgroundColor: '#1A1A1A', borderRadius: '2px',
                        }} />
                      )}
                      {/* 左侧树形连接线 */}
                      <span style={{
                        position: 'absolute', left: '14px', top: 0, bottom: '50%',
                        width: '1px', backgroundColor: '#D8DCE0',
                      }} />
                      <span style={{
                        position: 'absolute', left: '14px', top: '50%', width: '8px', height: '1px',
                        backgroundColor: '#D8DCE0',
                      }} />
                      <span style={{
                        width: '5px', height: '5px', borderRadius: '50%',
                        backgroundColor: isActive ? '#1A1A1A' : '#C0C4C8',
                        flexShrink: 0, transition: 'background-color 120ms ease-out, transform 120ms ease-out',
                        transform: isActive ? 'scale(1.15)' : 'scale(1)',
                      }} />
                      <span style={{
                        fontFamily: FONT, fontSize: '12px', fontWeight: isActive ? 600 : 400,
                        color: isActive ? '#1A1A1A' : '#555555',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {exp.shortTitle}
                      </span>
                      {exp.comingSoon && (
                        <span style={{
                          fontFamily: FONT, fontSize: '8px', color: '#AAAAAA',
                          border: '1px solid #D0D0D0', borderRadius: '2px', padding: '0 4px',
                          marginLeft: 'auto', letterSpacing: '0.04em', fontWeight: 500,
                        }}>
                          SOON
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )

  const sidebarContent = (
    <div className="flex flex-col h-full" style={{ backgroundColor: '#FAFBFC' }}>
      {/* 顶部：品牌 + 折叠按钮 */}
      <div style={{
        height: '44px', flexShrink: 0, display: 'flex', alignItems: 'center',
        padding: collapsed ? '0 8px' : '0 12px', justifyContent: collapsed ? 'center' : 'space-between',
        borderBottom: '1px solid #E8ECF0',
      }}>
        {!(collapsed || mobileOpen) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {/* 品牌 logo */}
            <img
              src="/logo.png"
              alt="logo"
              width={18}
              height={18}
              style={{ flexShrink: 0, objectFit: 'contain' }}
            />
            <span style={{
              fontFamily: 'var(--font-geist-mono), monospace', fontSize: '10px', fontWeight: 600,
              color: '#1A1A1A', letterSpacing: '0.12em',
            }}>
              NAVIGATION
            </span>
          </div>
        )}
        {mobileOpen ? (
          /* 移动端抽屉：显示关闭按钮 */
          <button
            onClick={onCloseMobile}
            aria-label="关闭导航"
            style={{
              width: '28px', height: '28px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'none', border: '1px solid #E0E4E8', cursor: 'pointer',
              color: '#666666', borderRadius: '3px', transition: 'all 120ms ease-out',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#888888'; e.currentTarget.style.color = '#1A1A1A' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = '#E0E4E8'; e.currentTarget.style.color = '#666666' }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2.5 2.5L9.5 9.5M9.5 2.5L2.5 9.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </button>
        ) : (
          /* 桌面端：折叠/展开按钮 */
          <button
            onClick={onToggleCollapse}
            aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
            style={{
              width: '28px', height: '28px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'none', border: '1px solid #E0E4E8', cursor: 'pointer',
              color: '#666666', borderRadius: '3px', transition: 'all 120ms ease-out',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#888888'; e.currentTarget.style.color = '#1A1A1A' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = '#E0E4E8'; e.currentTarget.style.color = '#666666' }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ transform: collapsed ? 'rotate(180deg)' : 'none', transition: 'transform 150ms ease-out' }}>
              <path d="M7.5 2L4 6L7.5 10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>

      {/* 导航内容（可滚动） */}
      <div className="flex-1 overflow-y-auto custom-scrollbar" style={{ minHeight: 0 }}>
        {isSearching ? renderSearchResults() : renderTree()}
      </div>

      {/* 底部：统计 */}
      {!collapsed && (
        <div style={{
          flexShrink: 0, padding: '8px 12px', borderTop: '1px solid #E8ECF0',
          fontFamily: FONT, fontSize: '9px', color: '#AAAAAA',
          display: 'flex', justifyContent: 'space-between',
        }} className="tabular-nums">
          <span>3 分支</span>
          <span>{ALL_EXPERIMENTS.length} 实验</span>
        </div>
      )}
    </div>
  )

  return (
    <>
      {/* 桌面端：固定侧边栏 */}
      <aside
        className="hidden md:flex flex-shrink-0"
        style={{
          width: collapsed ? collapsedWidth : expandedWidth,
          borderRight: '1px solid #E0E4E8',
          transition: 'width 180ms ease-out',
          overflow: 'hidden',
        }}
      >
        <div style={{ width: '100%' }}>
          {sidebarContent}
        </div>
      </aside>

      {/* 移动端：抽屉 */}
      {mobileOpen && (
        <>
          {/* 背景遮罩 */}
          <div
            onClick={onCloseMobile}
            style={{
              position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.25)',
              zIndex: 40, animation: 'mobile-fade-in 160ms ease-out',
            }}
          />
          {/* 抽屉 */}
          <aside
            style={{
              position: 'fixed', top: 0, left: 0, bottom: 0, width: '260px',
              backgroundColor: '#FAFBFC', borderRight: '1px solid #E0E4E8',
              zIndex: 50, animation: 'sidebar-slide-in 200ms ease-out',
            }}
          >
            {sidebarContent}
          </aside>
        </>
      )}

      <style>{`
        @keyframes sidebar-slide-in {
          from { transform: translateX(-100%); }
          to { transform: translateX(0); }
        }
        .sidebar-item {
          -webkit-tap-highlight-color: transparent;
        }
      `}</style>
    </>
  )
}

/* ─── 图标组件 ─── */
function HomeIcon({ active = false }: { active?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, color: active ? '#1A1A1A' : '#555555' }}>
      <path d="M2.5 7L8 2.5L13.5 7V13H9.5V9.5H6.5V13H2.5V7Z" stroke="currentColor" strokeWidth={active ? 1.4 : 1.2} strokeLinejoin="round" fill={active ? '#F0F3F6' : 'none'} />
    </svg>
  )
}

function BranchIcon({ glyph, active }: { glyph: string; active: boolean }) {
  return (
    <span style={{
      width: '22px', height: '22px', flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: FONT, fontSize: '13px', fontWeight: 600,
      color: active ? '#1A1A1A' : '#555555',
      border: `1px solid ${active ? '#1A1A1A' : '#C0C4C8'}`,
      borderRadius: '3px', backgroundColor: active ? '#FFFFFF' : 'transparent',
      transition: 'all 120ms ease-out',
    }}>
      {glyph}
    </span>
  )
}
