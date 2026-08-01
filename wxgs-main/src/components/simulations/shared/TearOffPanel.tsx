'use client'

/**
 * 撕下面板渲染器 — 跨模块持久化
 *
 * 功能：
 * - 渲染全局 store 中所有 tear-off 面板
 * - 面板可拖拽移动，位置写回 store（持久化）
 * - 拖拽时显示虚线对齐辅助（与视口边缘/其他面板对齐）
 * - 关闭面板：从 store 删除
 * - 面板内显示：缩略图 + 来源标签 + 参数
 *
 * 与 FloatingPanel 的区别：
 * - FloatingPanel 是组件内临时面板，不跨模块
 * - TearOffPanelRenderer 是全局持久化面板，跨模块保持
 */

import { useRef, useState, useCallback, useEffect, type ReactNode } from 'react'
import { useExperimentStore } from '@/lib/experiment-store'
import { findBranch, findExperiment } from '@/lib/navigation'

const FONT = "system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif"
const MONO = 'var(--font-geist-mono), ui-monospace, monospace'

interface DragState {
  panelId: string
  startClientX: number
  startClientY: number
  startPanelX: number
  startPanelY: number
}

interface AlignGuide {
  type: 'v' | 'h'
  position: number
}

export function TearOffPanelRenderer() {
  const panels = useExperimentStore(s => s.tearOffPanels)
  const removePanel = useExperimentStore(s => s.removeTearOffPanel)
  const updatePosition = useExperimentStore(s => s.updateTearOffPanelPosition)
  const showGuides = useExperimentStore(s => s.showAlignmentGuides)

  const [dragState, setDragState] = useState<DragState | null>(null)
  const [guides, setGuides] = useState<AlignGuide[]>([])
  const [viewport, setViewport] = useState({ w: 1280, h: 800 })

  useEffect(() => {
    const update = () => setViewport({ w: window.innerWidth, h: window.innerHeight })
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  /* ── 拖拽：计算对齐辅助线 ── */
  const handlePointerDown = useCallback(
    (e: React.PointerEvent, panelId: string, px: number, py: number) => {
      e.preventDefault()
      ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
      setDragState({
        panelId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startPanelX: px,
        startPanelY: py,
      })
    },
    []
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragState) return
      e.preventDefault()
      const dx = e.clientX - dragState.startClientX
      const dy = e.clientY - dragState.startClientY
      let nx = dragState.startPanelX + dx
      let ny = dragState.startPanelY + dy

      // 估算当前拖拽面板宽度
      const current = panels.find(p => p.id === dragState.panelId)
      const w = current?.panelWidth || 280
      const h = 180 // 估算

      // 计算对齐辅助线（与视口边缘、其他面板对齐）
      const activeGuides: AlignGuide[] = []
      const threshold = 6

      // 视口边缘
      if (Math.abs(nx) < threshold) { nx = 0; activeGuides.push({ type: 'v', position: 0 }) }
      if (Math.abs(ny) < threshold) { ny = 0; activeGuides.push({ type: 'h', position: 0 }) }
      if (Math.abs(nx + w - viewport.w) < threshold) {
        nx = viewport.w - w
        activeGuides.push({ type: 'v', position: viewport.w })
      }
      if (Math.abs(ny + h - viewport.h) < threshold) {
        ny = viewport.h - h
        activeGuides.push({ type: 'h', position: viewport.h })
      }

      // 视口中线
      if (Math.abs(nx + w / 2 - viewport.w / 2) < threshold) {
        nx = viewport.w / 2 - w / 2
        activeGuides.push({ type: 'v', position: viewport.w / 2 })
      }

      // 其他面板
      for (const other of panels) {
        if (other.id === dragState.panelId) continue
        // 左边对齐
        if (Math.abs(nx - other.x) < threshold) {
          nx = other.x
          activeGuides.push({ type: 'v', position: other.x })
        }
        // 右边对齐
        if (Math.abs(nx + w - (other.x + other.panelWidth)) < threshold) {
          nx = other.x + other.panelWidth - w
          activeGuides.push({ type: 'v', position: other.x + other.panelWidth })
        }
        // 顶对齐
        if (Math.abs(ny - other.y) < threshold) {
          ny = other.y
          activeGuides.push({ type: 'h', position: other.y })
        }
      }

      setGuides(showGuides ? activeGuides : [])
      updatePosition(dragState.panelId, nx, ny)
    },
    [dragState, panels, viewport, updatePosition, showGuides]
  )

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    ;(e.currentTarget as Element).releasePointerCapture?.(e.pointerId)
    setDragState(null)
    setGuides([])
  }, [])

  if (panels.length === 0) return null

  return (
    <div
      style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 35 }}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {/* 对齐辅助线 */}
      {guides.map((g, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            backgroundColor: '#FF4400',
            pointerEvents: 'none',
            ...(g.type === 'v'
              ? { left: g.position, top: 0, bottom: 0, width: '1px' }
              : { top: g.position, left: 0, right: 0, height: '1px' }),
            backgroundImage: 'linear-gradient(to right, #FF4400 50%, transparent 50%)',
            backgroundSize: g.type === 'v' ? '1px 4px' : '4px 1px',
            opacity: 0.7,
          }}
        />
      ))}

      {/* 撕下面板 */}
      {panels.map((p, idx) => (
        <TearOffPanelCard
          key={p.id}
          panel={p}
          zIndex={36 + idx}
          isDragging={dragState?.panelId === p.id}
          onPointerDown={handlePointerDown}
          onClose={() => removePanel(p.id)}
        />
      ))}
    </div>
  )
}

/* ─── 单个撕下面板 ─── */

interface TearOffPanelCardProps {
  panel: ReturnType<typeof useExperimentStore.getState>['tearOffPanels'][number]
  zIndex: number
  isDragging: boolean
  onPointerDown: (e: React.PointerEvent, id: string, px: number, py: number) => void
  onClose: () => void
}

function TearOffPanelCard({ panel, zIndex, isDragging, onPointerDown, onClose }: TearOffPanelCardProps) {
  const exp = findExperiment(panel.viewId)
  const branch = findBranch(panel.viewId)
  const [showParams, setShowParams] = useState(true)

  return (
    <div
      style={{
        position: 'absolute',
        left: panel.x,
        top: panel.y,
        width: panel.panelWidth,
        zIndex,
        border: '1px solid #D0D0D0',
        borderRadius: '2px',
        backgroundColor: '#FFFFFF',
        boxShadow: isDragging ? '0 4px 12px rgba(0,0,0,0.08)' : 'none',
        overflow: 'hidden',
        pointerEvents: 'auto',
        transition: isDragging ? 'none' : 'box-shadow 120ms ease-out',
      }}
    >
      {/* 标题栏 */}
      <div
        onPointerDown={(e) => onPointerDown(e, panel.id, panel.x, panel.y)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 8px 0 10px', minHeight: '36px',
          backgroundColor: '#FAFAFA', borderBottom: '1px solid #E8ECF0',
          cursor: isDragging ? 'grabbing' : 'grab',
          touchAction: 'none', userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, flex: 1 }}>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ color: '#AAAAAA', flexShrink: 0 }}>
            <circle cx="2" cy="2" r="0.8" fill="currentColor" />
            <circle cx="8" cy="2" r="0.8" fill="currentColor" />
            <circle cx="2" cy="8" r="0.8" fill="currentColor" />
            <circle cx="8" cy="8" r="0.8" fill="currentColor" />
          </svg>
          <span style={{
            fontFamily: FONT, fontSize: '10px', fontWeight: 600, color: '#333',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {panel.title}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
          <button
            onClick={(e) => { e.stopPropagation(); setShowParams(s => !s) }}
            aria-label={showParams ? '隐藏参数' : '显示参数'}
            title={showParams ? '隐藏参数' : '显示参数'}
            style={iconBtnStyle}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              {showParams ? (
                <path d="M1 2.5H9M1 5H9M1 7.5H9" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" />
              ) : (
                <path d="M2 2.5H8M2 7.5H8" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" />
              )}
            </svg>
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onClose() }}
            aria-label="关闭浮动面板"
            style={iconBtnStyle}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M1.5 1.5L8.5 8.5M8.5 1.5L1.5 8.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* 来源标签 */}
      <div
        style={{
          padding: '3px 10px',
          backgroundColor: '#FFFFFF',
          borderBottom: '1px solid #F0F2F5',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}
      >
        <span style={{ fontFamily: FONT, fontSize: '9px', color: '#888' }}>
          {branch?.shortTitle} · {exp?.shortTitle || panel.title}
        </span>
        <span style={{ fontFamily: MONO, fontSize: '8.5px', color: '#BBB' }}>
          {panel.timestamp.replace('T', ' ').slice(11, 16)}
        </span>
      </div>

      {/* 图像 */}
      <div style={{ backgroundColor: '#FFFFFF', padding: '6px' }}>
        <img
          src={panel.image}
          alt={panel.title}
          style={{
            width: '100%', height: 'auto', display: 'block',
            maxHeight: '200px', objectFit: 'contain',
          }}
        />
      </div>

      {/* 参数 */}
      {showParams && panel.params.length > 0 && (
        <div
          style={{
            padding: '6px 10px',
            backgroundColor: '#FAFAFA',
            borderTop: '1px solid #F0F2F5',
          }}
        >
          <div style={{
            fontFamily: FONT, fontSize: '8.5px', color: '#999', marginBottom: '3px',
            letterSpacing: '0.04em', textTransform: 'uppercase',
          }}>
            参数
          </div>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 8px',
            fontFamily: MONO, fontSize: '9px', color: '#555',
          }}>
            {panel.params.map((p, i) => (
              <span key={i} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {p.key}={p.value}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const iconBtnStyle: React.CSSProperties = {
  width: '22px', height: '22px', minHeight: '44px',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'none', border: '1px solid transparent', cursor: 'pointer',
  color: '#999', padding: 0, borderRadius: '1px',
  transition: 'all 100ms ease-out',
}

/* ─── 撕下按钮（供实验组件使用） ─── */

interface TearOffButtonProps {
  /** 撕下面板的标题 */
  title: string
  /** 来源实验 ViewId */
  viewId: ReturnType<typeof useExperimentStore.getState>['tearOffPanels'][number]['viewId']
  /** 关键参数 */
  params: { key: string; value: string }[]
  /** 要截取的容器 ref */
  targetRef: React.RefObject<HTMLElement | null>
  /** 初始浮动位置 x */
  initialX?: number
  /** 初始浮动位置 y */
  initialY?: number
  /** 面板宽度 */
  panelWidth?: number
  /** 按钮标签 */
  label?: string
  children?: ReactNode
}

export function TearOffButton({
  title, viewId, params, targetRef,
  initialX, initialY, panelWidth = 280, label = '撕下对比', children,
}: TearOffButtonProps) {
  const addPanel = useExperimentStore(s => s.addTearOffPanel)
  const panels = useExperimentStore(s => s.tearOffPanels)

  const handleTearOff = useCallback(() => {
    const container = targetRef.current
    if (!container) return

    // 智能捕获容器内所有 canvas
    const canvases = Array.from(container.querySelectorAll('canvas')) as HTMLCanvasElement[]
    const valid = canvases.filter(c => c.width > 0 && c.height > 0)

    let image = ''
    let width = 0
    let height = 0

    if (valid.length === 1) {
      try {
        image = valid[0].toDataURL('image/png')
        width = valid[0].width
        height = valid[0].height
      } catch { /* ignore */ }
    } else if (valid.length > 1) {
      // 拼接为 2 列网格
      const gap = 12
      const cols = Math.min(2, valid.length)
      const rows = Math.ceil(valid.length / cols)
      const colW: number[] = []
      const rowH: number[] = []
      for (let r = 0; r < rows; r++) {
        const rowC = valid.slice(r * cols, (r + 1) * cols)
        rowH.push(Math.max(...rowC.map(c => c.height)))
      }
      for (let c = 0; c < cols; c++) {
        const colC = valid.filter((_, i) => i % cols === c)
        colW.push(Math.max(...colC.map(c => c.width)))
      }
      width = colW.reduce((a, b) => a + b, 0) + gap * (cols - 1)
      height = rowH.reduce((a, b) => a + b, 0) + gap * (rows - 1)
      const out = document.createElement('canvas')
      out.width = width
      out.height = height
      const ctx = out.getContext('2d')
      if (ctx) {
        ctx.fillStyle = '#FFFFFF'
        ctx.fillRect(0, 0, width, height)
        let cy = 0
        for (let r = 0; r < rows; r++) {
          let cx = 0
          const rowC = valid.slice(r * cols, (r + 1) * cols)
          for (let c = 0; c < rowC.length; c++) {
            ctx.drawImage(rowC[c], cx, cy)
            cx += colW[c] + gap
          }
          cy += rowH[r] + gap
        }
        try {
          image = out.toDataURL('image/png')
        } catch { /* ignore */ }
      }
    }

    if (!image) {
      // 退化：尝试 svg
      const svg = container.querySelector('svg')
      if (svg) {
        try {
          const serializer = new XMLSerializer()
          const svgStr = serializer.serializeToString(svg)
          width = (svg as SVGSVGElement).viewBox.baseVal.width || 400
          height = (svg as SVGSVGElement).viewBox.baseVal.height || 300
          image = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgStr)))}`
        } catch { /* ignore */ }
      }
    }

    if (!image) return

    // 计算初始位置：错开已有面板
    const offset = panels.length * 30
    addPanel({
      viewId,
      title,
      image,
      width,
      height,
      params,
      timestamp: new Date().toISOString(),
      x: initialX ?? 80 + offset,
      y: initialY ?? 120 + offset,
      panelWidth,
    })
  }, [targetRef, viewId, title, params, addPanel, panels.length, initialX, initialY, panelWidth])

  return (
    <button
      onClick={handleTearOff}
      title={label}
      style={{
        fontFamily: FONT, fontSize: '10px', fontWeight: 500,
        padding: '4px 8px', height: '24px', minHeight: '44px',
        border: '1px solid #D0D0D0',
        backgroundColor: '#FFFFFF',
        color: '#555',
        cursor: 'pointer', borderRadius: '2px',
        transition: 'all 120ms ease-out',
        display: 'inline-flex', alignItems: 'center', gap: '4px',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = '#1A1A1A'
        e.currentTarget.style.color = '#1A1A1A'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = '#D0D0D0'
        e.currentTarget.style.color = '#555'
      }}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
        <path d="M1 1H4V2H2V8H8V6H9V9H1V1Z" fill="currentColor" />
        <path d="M5 1H9V5H8V2.7L4.5 6.2L3.8 5.5L7.3 2H5V1Z" fill="currentColor" />
      </svg>
      {label}
      {children}
    </button>
  )
}
