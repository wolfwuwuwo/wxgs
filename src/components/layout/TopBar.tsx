'use client'

import { useRef, useEffect, useState } from 'react'
import { getBreadcrumb, type ViewId, searchExperiments } from '@/lib/navigation'
import { useIsMobile } from '@/hooks/use-mobile'

const FONT = "system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif"
const MONO = 'var(--font-geist-mono), monospace'

interface TopBarProps {
  currentView: ViewId
  onNavigate: (id: ViewId) => void
  searchQuery: string
  onSearchChange: (q: string) => void
  onOpenMobileSidebar: () => void
}

export function TopBar({
  currentView, onNavigate, searchQuery, onSearchChange, onOpenMobileSidebar,
}: TopBarProps) {
  const isMobile = useIsMobile()
  const searchRef = useRef<HTMLInputElement>(null)
  const [searchFocused, setSearchFocused] = useState(false)
  const crumbs = getBreadcrumb(currentView)
  const matchCount = searchQuery.trim() ? searchExperiments(searchQuery).length : 0

  // 快捷键 / 聚焦搜索
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
      }
      if (e.key === 'Escape' && document.activeElement === searchRef.current) {
        onSearchChange('')
        searchRef.current?.blur()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onSearchChange])

  return (
    <header style={{
      flexShrink: 0, height: isMobile ? '44px' : '44px',
      backgroundColor: '#FFFFFF', borderBottom: '1px solid #E0E4E8',
      display: 'flex', alignItems: 'center', gap: '10px',
      paddingLeft: isMobile ? '10px' : '14px', paddingRight: '12px',
      position: 'relative',
    }}>
      {/* 移动端汉堡按钮 */}
      {isMobile && (
        <button
          onClick={onOpenMobileSidebar}
          aria-label="打开导航"
          style={{
            width: '40px', height: '40px', minHeight: '44px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'none', border: 'none', cursor: 'pointer', color: '#333333',
            flexShrink: 0,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M2.5 5H15.5M2.5 9H15.5M2.5 13H15.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      )}

      {/* 桌面端品牌标记 + 平台名 */}
      {!isMobile && (
        <button
          onClick={() => onNavigate('home')}
          aria-label="返回首页"
          style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            background: 'none', border: 'none', cursor: 'pointer',
            padding: '0', height: '100%',
            flexShrink: 0, marginRight: '4px',
          }}
          onMouseEnter={e => { e.currentTarget.style.opacity = '0.7' }}
          onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
        >
          <img
            src="/logo.png"
            alt="logo"
            width={20}
            height={20}
            style={{ flexShrink: 0, objectFit: 'contain' }}
          />
          <span style={{
            fontFamily: FONT, fontSize: '11px', fontWeight: 600, color: '#1A1A1A',
            letterSpacing: '0.04em',
          }}>
            OPTICS LAB
          </span>
        </button>
      )}

      {/* 分隔线 */}
      {!isMobile && (
        <div style={{
          width: '1px', height: '20px', backgroundColor: '#E0E4E8', flexShrink: 0,
        }} />
      )}

      {/* 面包屑 */}
      <nav className="flex items-center" style={{ flexShrink: 1, overflow: 'hidden', minWidth: 0 }} aria-label="路径">
        {crumbs.map((c, i) => {
          const isLast = i === crumbs.length - 1
          return (
            <span key={c.viewId} className="flex items-center" style={{ flexShrink: 0 }}>
              {i > 0 && (
                <span style={{
                  fontFamily: MONO, fontSize: '11px',
                  color: '#C0C4C8', margin: '0 8px',
                }}>
                  /
                </span>
              )}
              <button
                onClick={() => !isLast && onNavigate(c.viewId)}
                disabled={isLast}
                style={{
                  fontFamily: FONT,
                  fontSize: isMobile ? '12px' : '12.5px',
                  fontWeight: isLast ? 600 : 400,
                  color: isLast ? '#1A1A1A' : '#888888',
                  background: 'none', border: 'none', cursor: isLast ? 'default' : 'pointer',
                  padding: '4px 2px', minHeight: '44px',
                  transition: 'color 120ms ease-out',
                  whiteSpace: 'nowrap',
                }}
                onMouseEnter={e => { if (!isLast) e.currentTarget.style.color = '#1A1A1A' }}
                onMouseLeave={e => { if (!isLast) e.currentTarget.style.color = '#888888' }}
              >
                {c.label}
              </button>
            </span>
          )
        })}
      </nav>

      {/* 搜索框 */}
      <div style={{ marginLeft: 'auto', position: 'relative', display: 'flex', alignItems: 'center' }}>
        <div style={{
          display: 'flex', alignItems: 'center',
          backgroundColor: searchFocused ? '#FFFFFF' : '#FAFAFA',
          border: `1px solid ${searchFocused ? '#1A1A1A' : searchQuery ? '#888888' : '#D8DCE0'}`,
          borderRadius: '3px',
          transition: 'border-color 120ms ease-out, background-color 120ms ease-out, box-shadow 120ms ease-out',
          height: isMobile ? '32px' : '30px',
          width: isMobile ? '130px' : '240px',
          boxShadow: searchFocused ? '0 0 0 3px rgba(26,26,26,0.05)' : 'none',
        }}>
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ margin: '0 8px', flexShrink: 0, color: searchFocused ? '#1A1A1A' : '#888888', transition: 'color 120ms ease-out' }}>
            <circle cx="5.5" cy="5.5" r="3.8" stroke="currentColor" strokeWidth="1.2" />
            <path d="M8.5 8.5L11.5 11.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          <input
            ref={searchRef}
            type="text"
            value={searchQuery}
            onChange={e => onSearchChange(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            placeholder="搜索实验…"
            aria-label="搜索实验"
            style={{
              fontFamily: FONT, fontSize: '12px', color: '#1A1A1A',
              background: 'none', border: 'none', outline: 'none',
              flex: 1, minWidth: 0, padding: 0, height: '100%',
            }}
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange('')}
              aria-label="清除搜索"
              style={{
                width: '24px', height: '100%', minHeight: '44px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'none', border: 'none', cursor: 'pointer', color: '#888888',
                flexShrink: 0,
              }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M2 2L8 8M8 2L2 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </button>
          )}
          {!searchQuery && !isMobile && (
            <kbd style={{
              fontFamily: MONO, fontSize: '9px', color: '#888888',
              border: '1px solid #E0E4E8', borderRadius: '2px', padding: '1px 5px',
              margin: '0 6px', backgroundColor: '#FFFFFF', flexShrink: 0,
              fontWeight: 500,
            }}>
              ⌘K
            </kbd>
          )}
        </div>
        {searchQuery && (
          <span style={{
            position: 'absolute', top: '100%', right: 0, marginTop: '4px',
            fontFamily: FONT, fontSize: '9px', color: '#888888',
            backgroundColor: '#FFFFFF', padding: '2px 6px', border: '1px solid #E0E4E8',
            borderRadius: '2px', pointerEvents: 'none',
          }} className="tabular-nums">
            {matchCount} 项匹配
          </span>
        )}
      </div>
    </header>
  )
}
