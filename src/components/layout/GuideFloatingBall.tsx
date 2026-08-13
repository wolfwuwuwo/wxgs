'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import {
  GUIDE_CONTENT,
  GUIDE_VIEW_IDS,
  getGuideForView,
  type GuideSection,
} from '@/lib/guide-content'
import { NAV_TREE, findBranch, findExperiment, type ViewId } from '@/lib/navigation'
import { useIsMobile } from '@/hooks/use-mobile'

const FONT = "system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif"
const MONO = 'var(--font-geist-mono), monospace'

type GuideTab = 'principle' | 'tutorial'

interface BallPos {
  x: number
  y: number
}

const BALL_POS_KEY = 'ops-lab-guide-ball-pos'

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max)

/** 读取本地保存的悬浮球位置（自动限制在视口内） */
function loadBallPos(): BallPos | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(BALL_POS_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as BallPos
    if (typeof p.x !== 'number' || typeof p.y !== 'number') return null
    const size = window.innerWidth < 768 ? 46 : 54
    const maxX = Math.max(8, window.innerWidth - size - 8)
    const maxY = Math.max(8, window.innerHeight - size - 8)
    return { x: clamp(p.x, 8, maxX), y: clamp(p.y, 8, maxY) }
  } catch {
    return null
  }
}

interface GuideFloatingBallProps {
  currentView: ViewId
  /** 可选：从导学中心直接进入某个模块 */
  onNavigate?: (id: ViewId) => void
}

/** 导学悬浮球：全局入口，点击打开「导学中心」面板 */
export function GuideFloatingBall({ currentView, onNavigate }: GuideFloatingBallProps) {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const [activeId, setActiveId] = useState<ViewId>('home')
  const [tab, setTab] = useState<GuideTab>('principle')
  const [query, setQuery] = useState('')
  const [ballPos, setBallPos] = useState<BallPos | null>(null)
  const [dragging, setDragging] = useState(false)

  const guide = getGuideForView(activeId)
  const activeExp = activeId !== 'home' ? findExperiment(activeId) : null
  const activeBranch = activeId !== 'home' ? findBranch(activeId) : null
  const ballSize = isMobile ? 46 : 54
  const moduleIndex = activeId === 'home'
    ? -1
    : GUIDE_VIEW_IDS.filter(id => id !== 'home').indexOf(activeId)

  /* 打开面板：自动定位到当前页面对应的导学内容 */
  const openPanel = useCallback(() => {
    const target: ViewId = getGuideForView(currentView) ? currentView : 'home'
    setActiveId(target)
    setTab('principle')
    setQuery('')
    setOpen(true)
  }, [currentView])

  /* Escape 关闭 + 记住滚动位置 */
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open])

  /* 打开时锁定背景滚动（面板自身滚动，页面主区不滚动） */
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  const selectGuide = useCallback((id: ViewId) => {
    setActiveId(id)
    setTab('principle')
  }, [])

  /* 列表数据：总览 + 三大分支 */
  const listGroups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const groups: { key: string; label: string; items: { id: ViewId; title: string }[] }[] = []
    groups.push({
      key: 'overview',
      label: '平台',
      items: [{ id: 'home', title: '平台总览与使用说明' }],
    })
    for (const branch of NAV_TREE) {
      const items = branch.experiments
        .filter(e => GUIDE_CONTENT[e.id])
        .filter(e => !q || e.title.toLowerCase().includes(q) || e.shortTitle.toLowerCase().includes(q))
        .map(e => ({ id: e.id, title: e.shortTitle }))
      if (items.length > 0) {
        groups.push({ key: branch.id, label: branch.title, items })
      }
    }
    return groups
  }, [query])

  const currentHasGuide = !!getGuideForView(currentView)

  /* ── 悬浮球拖动 ── */
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    origLeft: number
    origTop: number
    moved: boolean
  } | null>(null)
  const posRef = useRef<BallPos | null>(null)
  const suppressClickRef = useRef(false)

  /* 挂载后恢复上次位置（避免 SSR/水合不一致） */
  useEffect(() => {
    const saved = loadBallPos()
    if (saved) {
      setBallPos(saved)
      posRef.current = saved
    }
  }, [])

  const handleBallPointerDown = useCallback((e: ReactPointerEvent<HTMLButtonElement>) => {
    if (open) return
    suppressClickRef.current = false
    const rect = e.currentTarget.getBoundingClientRect()
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origLeft: rect.left,
      origTop: rect.top,
      moved: false,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }, [open])

  const handleBallPointerMove = useCallback((e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current
    if (!d || e.pointerId !== d.pointerId) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (!d.moved && Math.hypot(dx, dy) < 5) return
    if (!d.moved) {
      d.moved = true
      setDragging(true)
    }
    const size = window.innerWidth < 768 ? 46 : 54
    const x = clamp(d.origLeft + dx, 8, Math.max(8, window.innerWidth - size - 8))
    const y = clamp(d.origTop + dy, 8, Math.max(8, window.innerHeight - size - 8))
    const next = { x, y }
    posRef.current = next
    setBallPos(next)
  }, [])

  const handleBallPointerUp = useCallback((e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current
    if (!d || e.pointerId !== d.pointerId) return
    dragRef.current = null
    if (d.moved) {
      setDragging(false)
      suppressClickRef.current = true
      window.setTimeout(() => {
        suppressClickRef.current = false
      }, 0)
      try {
        window.localStorage.setItem(BALL_POS_KEY, JSON.stringify(posRef.current))
      } catch {
        /* 忽略存储失败 */
      }
    }
  }, [])

  return (
    <>
      {/* ── 悬浮球 ── */}
      <button
        onClick={() => {
          if (suppressClickRef.current) {
            suppressClickRef.current = false
            return
          }
          open ? setOpen(false) : openPanel()
        }}
        aria-label={open ? '关闭导学中心' : '打开导学中心'}
        title={open ? '关闭导学中心' : '导学：实验原理与使用教程（按住可拖动）'}
        onPointerDown={handleBallPointerDown}
        onPointerMove={handleBallPointerMove}
        onPointerUp={handleBallPointerUp}
        onPointerCancel={handleBallPointerUp}
        style={{
          position: 'fixed',
          ...(ballPos
            ? { left: ballPos.x, top: ballPos.y }
            : { right: isMobile ? '12px' : '16px', bottom: isMobile ? '40px' : '44px' }),
          width: ballSize,
          height: ballSize,
          borderRadius: '50%',
          backgroundColor: open ? '#1A1A1A' : '#FFFFFF',
          border: open ? '1px solid #1A1A1A' : '1.5px solid #1A1A1A',
          color: open ? '#FFFFFF' : '#1A1A1A',
          cursor: dragging ? 'grabbing' : 'grab',
          touchAction: 'none',
          userSelect: 'none',
          zIndex: 90,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '2px',
          transition: dragging
            ? 'none'
            : 'background-color 140ms ease-out, color 140ms ease-out, transform 140ms ease-out',
        }}
        onMouseEnter={e => {
          if (dragging) return
          if (!open) {
            e.currentTarget.style.backgroundColor = '#F0F3F6'
          }
          e.currentTarget.style.transform = 'scale(1.06)'
        }}
        onMouseLeave={e => {
          if (dragging) return
          if (!open) {
            e.currentTarget.style.backgroundColor = '#FFFFFF'
          }
          e.currentTarget.style.transform = 'scale(1)'
        }}
      >
        {open ? (
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M3 3L15 15M15 3L3 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        ) : (
          <>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ flexShrink: 0 }}>
              <path
                d="M3 5.2C5.2 4.4 7.4 4.4 10 5.2C12.6 4.4 14.8 4.4 17 5.2V15.2C14.8 14.4 12.6 14.4 10 15.2C7.4 14.4 5.2 14.4 3 15.2V5.2Z"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinejoin="round"
              />
              <path d="M10 5.2V15.2" stroke="currentColor" strokeWidth="1.1" />
            </svg>
            <span style={{ fontFamily: FONT, fontSize: isMobile ? '8px' : '9px', fontWeight: 600, letterSpacing: '0.02em', lineHeight: 1 }}>
              导学
            </span>
          </>
        )}
      </button>

      {/* ── 导学中心面板 ── */}
      {open && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: isMobile ? 'rgba(26,26,26,0.45)' : 'rgba(26,26,26,0.35)',
            animation: 'guide-overlay-in 160ms ease-out',
          }}
          onClick={e => {
            if (e.target === e.currentTarget) setOpen(false)
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="导学中心"
            style={{
              display: 'flex',
              flexDirection: 'column',
              backgroundColor: '#FFFFFF',
              border: isMobile ? 'none' : '1px solid #D0D0D0',
              borderRadius: isMobile ? '0' : '4px',
              width: isMobile ? '100%' : 'min(920px, calc(100vw - 32px))',
              height: isMobile ? '100%' : 'min(660px, calc(100vh - 80px))',
              maxHeight: '100vh',
              animation: isMobile ? 'guide-sheet-up 220ms ease-out' : 'guide-panel-in 180ms ease-out',
              overflow: 'hidden',
            }}
          >
            {/* 头部 */}
            <div
              style={{
                flexShrink: 0,
                height: '50px',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '0 14px 0 16px',
                borderBottom: '1px solid #E0E4E8',
                backgroundColor: '#FFFFFF',
              }}
            >
              <span
                style={{
                  width: '7px',
                  height: '7px',
                  borderRadius: '50%',
                  backgroundColor: '#CC0000',
                  flexShrink: 0,
                }}
              />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontFamily: FONT, fontSize: '13px', fontWeight: 600, color: '#1A1A1A', lineHeight: 1.2 }}>
                  导学中心
                </div>
                <div style={{ fontFamily: FONT, fontSize: '10px', color: '#888888', lineHeight: 1.3, marginTop: '1px' }}>
                  各模块实验原理 · 使用教程
                </div>
              </div>

              {/* 进入当前模块（仅在查看其他模块导学时显示） */}
              {onNavigate && activeId !== currentView && currentHasGuide && (
                <button
                  onClick={() => {
                    onNavigate(currentView)
                    setOpen(false)
                  }}
                  style={{
                    fontFamily: FONT,
                    fontSize: '11px',
                    fontWeight: 500,
                    color: '#1A1A1A',
                    backgroundColor: '#FFFFFF',
                    border: '1px solid #888888',
                    borderRadius: '3px',
                    padding: '5px 10px',
                    cursor: 'pointer',
                    transition: 'all 120ms ease-out',
                    flexShrink: 0,
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.backgroundColor = '#1A1A1A'
                    e.currentTarget.style.color = '#FFFFFF'
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.backgroundColor = '#FFFFFF'
                    e.currentTarget.style.color = '#1A1A1A'
                  }}
                >
                  回到当前实验
                </button>
              )}

              <button
                onClick={() => setOpen(false)}
                aria-label="关闭导学中心"
                style={{
                  width: '30px',
                  height: '30px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#666666',
                  borderRadius: '3px',
                  flexShrink: 0,
                  transition: 'background-color 120ms ease-out, color 120ms ease-out',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.backgroundColor = '#F0F3F6'
                  e.currentTarget.style.color = '#1A1A1A'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.backgroundColor = 'transparent'
                  e.currentTarget.style.color = '#666666'
                }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M2.5 2.5L11.5 11.5M11.5 2.5L2.5 11.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
              {/* 桌面：左侧模块列表 */}
              {!isMobile && (
                <aside
                  style={{
                    width: '264px',
                    flexShrink: 0,
                    borderRight: '1px solid #E0E4E8',
                    backgroundColor: '#FAFBFC',
                    display: 'flex',
                    flexDirection: 'column',
                    minHeight: 0,
                  }}
                >
                  {/* 搜索 */}
                  <div style={{ padding: '10px 12px', borderBottom: '1px solid #E8ECF0', flexShrink: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', backgroundColor: '#FFFFFF', border: '1px solid #D8DCE0', borderRadius: '3px', height: '30px' }}>
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ margin: '0 7px', flexShrink: 0, color: '#888888' }}>
                        <circle cx="5.2" cy="5.2" r="3.5" stroke="currentColor" strokeWidth="1.1" />
                        <path d="M8 8L10.5 10.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
                      </svg>
                      <input
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder="搜索模块…"
                        aria-label="搜索导学模块"
                        style={{
                          fontFamily: FONT,
                          fontSize: '11.5px',
                          color: '#1A1A1A',
                          background: 'none',
                          border: 'none',
                          outline: 'none',
                          flex: 1,
                          minWidth: 0,
                          padding: 0,
                          height: '100%',
                        }}
                      />
                      {query && (
                        <button
                          onClick={() => setQuery('')}
                          aria-label="清除搜索"
                          style={{
                            width: '24px',
                            height: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            color: '#888888',
                            flexShrink: 0,
                          }}
                        >
                          <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
                            <path d="M2 2L7 7M7 2L2 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* 模块分组列表 */}
                  <div className="flex-1 overflow-y-auto custom-scrollbar" style={{ minHeight: 0, padding: '6px 8px 12px' }}>
                    {listGroups.map(group => (
                      <div key={group.key} style={{ marginBottom: '4px' }}>
                        <div
                          style={{
                            fontFamily: FONT,
                            fontSize: '9.5px',
                            fontWeight: 500,
                            color: '#888888',
                            letterSpacing: '0.05em',
                            padding: '8px 8px 4px',
                            textTransform: 'uppercase',
                          }}
                        >
                          {group.label}
                        </div>
                        {group.items.map(item => {
                          const isActive = item.id === activeId
                          const isCurrent = item.id === currentView
                          return (
                            <button
                              key={item.id}
                              onClick={() => selectGuide(item.id)}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '7px',
                                width: '100%',
                                padding: '7px 9px',
                                minHeight: '36px',
                                backgroundColor: isActive ? '#EFF1F4' : 'transparent',
                                border: 'none',
                                borderRadius: '3px',
                                cursor: 'pointer',
                                textAlign: 'left',
                                transition: 'background-color 120ms ease-out',
                                position: 'relative',
                              }}
                              onMouseEnter={e => {
                                if (!isActive) e.currentTarget.style.backgroundColor = '#F3F5F7'
                              }}
                              onMouseLeave={e => {
                                if (!isActive) e.currentTarget.style.backgroundColor = 'transparent'
                              }}
                            >
                              {isActive && (
                                <span style={{ position: 'absolute', left: '-8px', top: '7px', bottom: '7px', width: '2.5px', backgroundColor: '#1A1A1A', borderRadius: '2px' }} />
                              )}
                              <span
                                style={{
                                  width: '5px',
                                  height: '5px',
                                  borderRadius: '50%',
                                  backgroundColor: isCurrent ? '#CC0000' : isActive ? '#1A1A1A' : '#C0C4C8',
                                  flexShrink: 0,
                                }}
                              />
                              <span
                                style={{
                                  fontFamily: FONT,
                                  fontSize: '12px',
                                  fontWeight: isActive ? 600 : 400,
                                  color: isActive ? '#1A1A1A' : '#555555',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {item.title}
                              </span>
                              {isCurrent && (
                                <span
                                  style={{
                                    fontFamily: FONT,
                                    fontSize: '8px',
                                    fontWeight: 500,
                                    color: '#CC0000',
                                    border: '1px solid #CC0000',
                                    borderRadius: '2px',
                                    padding: '0 4px',
                                    marginLeft: 'auto',
                                    flexShrink: 0,
                                  }}
                                >
                                  当前
                                </span>
                              )}
                            </button>
                          )
                        })}
                      </div>
                    ))}
                    {listGroups.every(g => g.items.length === 0) && (
                      <div style={{ fontFamily: FONT, fontSize: '12px', color: '#888888', padding: '20px 10px', lineHeight: 1.6 }}>
                        未找到匹配模块。
                        <br />
                        试试：偏振、衍射、高斯、光纤、棱镜……
                      </div>
                    )}
                  </div>
                </aside>
              )}

              {/* 右侧内容区 */}
              <section style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', backgroundColor: '#FFFFFF' }}>
                {/* 移动端：模块选择条 */}
                {isMobile && (
                  <div style={{ flexShrink: 0, borderBottom: '1px solid #E8ECF0', padding: '8px 0', backgroundColor: '#FAFBFC' }}>
                    <div className="flex overflow-x-auto custom-scrollbar" style={{ padding: '0 10px', gap: '6px', scrollbarWidth: 'thin' }}>
                      <Chip label="平台总览" active={activeId === 'home'} onClick={() => selectGuide('home')} />
                      {GUIDE_VIEW_IDS.filter(id => id !== 'home').map(id => {
                        const exp = findExperiment(id)
                        if (!exp) return null
                        return (
                          <Chip
                            key={id}
                            label={exp.shortTitle}
                            active={activeId === id}
                            current={currentView === id}
                            onClick={() => selectGuide(id)}
                          />
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* 内容标题 + Tab */}
                <div style={{ flexShrink: 0, padding: isMobile ? '12px 14px 0' : '16px 22px 0', borderBottom: '1px solid #E8ECF0' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '10px' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontFamily: FONT, fontSize: isMobile ? '14px' : '15px', fontWeight: 600, color: '#1A1A1A', lineHeight: 1.3 }}>
                        {activeId === 'home' ? '平台总览与使用说明' : activeExp?.title}
                      </div>
                      <div style={{ fontFamily: FONT, fontSize: '10.5px', color: '#888888', marginTop: '3px' }}>
                        {activeId === 'home' ? '开始使用前，先花 1 分钟了解平台操作' : `${activeBranch?.title || ''} · 模块 ${moduleIndex + 1} / ${GUIDE_VIEW_IDS.length - 1}`}
                      </div>
                    </div>
                  </div>

                  {/* Tab 切换 */}
                  <div style={{ display: 'flex', gap: '4px', marginTop: '10px' }}>
                    <TabButton active={tab === 'principle'} onClick={() => setTab('principle')} label="实验原理" icon={
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.1" />
                        <path d="M6 3.5V6L7.5 7.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
                      </svg>
                    } />
                    <TabButton active={tab === 'tutorial'} onClick={() => setTab('tutorial')} label="使用教程" icon={
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M2 3L4 2L6 3L8 2L10 3V9L8 8L6 9L4 8L2 9V3Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
                        <path d="M4 2V8M6 3V9M8 2V8" stroke="currentColor" strokeWidth="0.9" />
                      </svg>
                    } />
                  </div>
                </div>

                {/* 正文 */}
                <div className="flex-1 overflow-y-auto custom-scrollbar" style={{ minHeight: 0, padding: isMobile ? '16px 16px 32px' : '18px 24px 32px' }}>
                  {guide ? (
                    tab === 'principle' ? (
                      <PrincipleView guide={guide} />
                    ) : (
                      <TutorialView guide={guide} />
                    )
                  ) : (
                    <div style={{ fontFamily: FONT, fontSize: '12px', color: '#888888', padding: '40px 0', textAlign: 'center' }}>
                      该模块的导学内容整理中……
                    </div>
                  )}
                </div>
              </section>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes guide-overlay-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes guide-panel-in {
          from { opacity: 0; transform: scale(0.985) translateY(6px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes guide-sheet-up {
          from { transform: translateY(24px); opacity: 0.6; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </>
  )
}

/* ─── 原理视图 ─── */
function PrincipleView({ guide }: { guide: GuideSection }) {
  return (
    <div>
      {guide.principle.map((p, i) => (
        <p
          key={i}
          style={{
            fontFamily: FONT,
            fontSize: '13px',
            lineHeight: 1.85,
            color: '#333333',
            margin: '0 0 12px',
          }}
        >
          {p}
        </p>
      ))}

      {guide.formulas && guide.formulas.length > 0 && (
        <div style={{ marginTop: '6px' }}>
          <div
            style={{
              fontFamily: FONT,
              fontSize: '10.5px',
              fontWeight: 600,
              color: '#1A1A1A',
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              marginBottom: '8px',
            }}
          >
            核心公式
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {guide.formulas.map((f, i) => (
              <div
                key={i}
                style={{
                  fontFamily: MONO,
                  fontSize: '12px',
                  color: '#1A1A1A',
                  backgroundColor: '#FAFAFA',
                  border: '1px solid #E0E4E8',
                  borderLeft: '3px solid #1A1A1A',
                  borderRadius: '2px',
                  padding: '8px 12px',
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {f}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── 教程视图 ─── */
function TutorialView({ guide }: { guide: GuideSection }) {
  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {guide.tutorial.map((step, i) => (
        <li key={i} style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
          <span
            style={{
              width: '22px',
              height: '22px',
              flexShrink: 0,
              borderRadius: '50%',
              backgroundColor: '#1A1A1A',
              color: '#FFFFFF',
              fontFamily: MONO,
              fontSize: '10.5px',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginTop: '1px',
            }}
            className="tabular-nums"
          >
            {String(i + 1).padStart(2, '0')}
          </span>
          <div style={{ minWidth: 0 }}>
            {step.title && (
              <div style={{ fontFamily: FONT, fontSize: '13px', fontWeight: 600, color: '#1A1A1A', marginBottom: '3px', lineHeight: 1.5 }}>
                {step.title}
              </div>
            )}
            <div style={{ fontFamily: FONT, fontSize: '12.5px', color: '#555555', lineHeight: 1.8 }}>
              {step.text}
            </div>
          </div>
        </li>
      ))}
    </ol>
  )
}

/* ─── 移动端模块芯片 ─── */
function Chip({
  label,
  active,
  current,
  onClick,
}: {
  label: string
  active: boolean
  current?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        fontFamily: FONT,
        fontSize: '11px',
        fontWeight: active ? 600 : 400,
        color: active ? '#FFFFFF' : current ? '#CC0000' : '#555555',
        backgroundColor: active ? '#1A1A1A' : '#FFFFFF',
        border: `1px solid ${current && !active ? '#CC0000' : active ? '#1A1A1A' : '#D8DCE0'}`,
        borderRadius: '3px',
        padding: '5px 10px',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        flexShrink: 0,
        transition: 'all 120ms ease-out',
      }}
    >
      {label}
      {current && <span style={{ marginLeft: '4px', fontSize: '9px', opacity: 0.85 }}>●</span>}
    </button>
  )
}

/* ─── Tab 按钮 ─── */
function TabButton({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean
  onClick: () => void
  label: string
  icon: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        fontFamily: FONT,
        fontSize: '11.5px',
        fontWeight: active ? 600 : 400,
        color: active ? '#1A1A1A' : '#888888',
        backgroundColor: 'transparent',
        border: 'none',
        borderBottom: active ? '2px solid #1A1A1A' : '2px solid transparent',
        padding: '7px 8px 8px',
        cursor: 'pointer',
        marginBottom: '-1px',
        transition: 'color 120ms ease-out, border-color 120ms ease-out',
      }}
    >
      {icon}
      {label}
    </button>
  )
}
