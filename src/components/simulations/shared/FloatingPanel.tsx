'use client'

import { useRef, useState, useCallback, type ReactNode } from 'react'

const FONT = "system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif"

interface FloatingPanelProps {
  title: string
  children: ReactNode
  /** 初始位置 */
  initialX?: number
  initialY?: number
  /** 初始宽度 */
  width?: number
  onClose?: () => void
  zIndex?: number
}

/**
 * 可拖拽浮动数据面板 — 基础版
 *
 * - 标题栏可拖拽移动
 * - 边框 1px #D0D0D0，无阴影
 * - 可关闭
 * - 触控友好（44px 标题栏）
 */
export function FloatingPanel({
  title, children, initialX = 80, initialY = 80, width = 320, onClose, zIndex = 30,
}: FloatingPanelProps) {
  const [pos, setPos] = useState({ x: initialX, y: initialY })
  const [dragging, setDragging] = useState(false)
  const dragStart = useRef({ x: 0, y: 0, px: 0, py: 0 })

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    dragStart.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y }
    setDragging(true)
  }, [pos.x, pos.y])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging) return
    e.preventDefault()
    const dx = e.clientX - dragStart.current.x
    const dy = e.clientY - dragStart.current.y
    setPos({
      x: dragStart.current.px + dx,
      y: dragStart.current.py + dy,
    })
  }, [dragging])

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    ;(e.target as Element).releasePointerCapture?.(e.pointerId)
    setDragging(false)
  }, [])

  return (
    <div
      style={{
        position: 'fixed',
        left: `${pos.x}px`,
        top: `${pos.y}px`,
        width: `${width}px`,
        zIndex,
        border: '1px solid #D0D0D0',
        borderRadius: '2px',
        backgroundColor: '#FFFFFF',
        boxShadow: 'none',
        overflow: 'hidden',
      }}
    >
      {/* 标题栏（可拖拽） */}
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 8px 0 10px', height: '32px', minHeight: '44px',
          backgroundColor: '#FAFAFA', borderBottom: '1px solid #E8ECF0',
          cursor: dragging ? 'grabbing' : 'grab',
          touchAction: 'none',
          userSelect: 'none',
        }}
      >
        <span style={{
          fontFamily: FONT, fontSize: '10px', fontWeight: 600, color: '#555555',
          letterSpacing: '0.02em', display: 'flex', alignItems: 'center', gap: '5px',
        }}>
          <svg width="9" height="9" viewBox="0 0 9 9" fill="none" style={{ color: '#AAAAAA' }}>
            <circle cx="2" cy="2" r="0.8" fill="currentColor" />
            <circle cx="7" cy="2" r="0.8" fill="currentColor" />
            <circle cx="2" cy="7" r="0.8" fill="currentColor" />
            <circle cx="7" cy="7" r="0.8" fill="currentColor" />
          </svg>
          {title}
        </span>
        {onClose && (
          <button
            onClick={onClose}
            aria-label="关闭浮动面板"
            style={{
              width: '20px', height: '20px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#999999', padding: 0,
            }}
            onMouseEnter={e => e.currentTarget.style.color = '#1A1A1A'}
            onMouseLeave={e => e.currentTarget.style.color = '#999999'}
          >
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
              <path d="M1.5 1.5L7.5 7.5M7.5 1.5L1.5 7.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>
      {/* 内容 */}
      <div style={{
        padding: '8px',
        maxHeight: '60vh', overflow: 'auto',
      }} className="custom-scrollbar">
        {children}
      </div>
    </div>
  )
}

/* ─── 浮动面板管理器：统一管理多个浮动面板 ─── */
export interface FloatingPanelState {
  id: string
  title: string
  content: ReactNode
  x?: number
  y?: number
  width?: number
}

export function FloatingPanelManager({
  panels, onClose,
}: {
  panels: FloatingPanelState[]
  onClose: (id: string) => void
}) {
  return (
    <>
      {panels.map((p, i) => (
        <FloatingPanel
          key={p.id}
          title={p.title}
          initialX={p.x ?? 80 + i * 30}
          initialY={p.y ?? 80 + i * 30}
          width={p.width}
          onClose={() => onClose(p.id)}
          zIndex={30 + i}
        >
          {p.content}
        </FloatingPanel>
      ))}
    </>
  )
}
