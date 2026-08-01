'use client'

import { ReactNode, useEffect } from 'react'
import { useIsMobile } from '@/hooks/use-mobile'

const FONT = "system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif"

/**
 * Unified control panel wrapper.
 *
 * - Desktop (>= 768px): renders an inline 320px (w-80) side panel with right border.
 * - Mobile (< 768px): renders a slide-in drawer from the left with a backdrop overlay.
 *
 * Usage in simulation components:
 *
 *   const isMobile = useIsMobile()
 *   const [panelOpen, setPanelOpen] = useState(false)
 *
 *   <ControlPanel open={panelOpen} onClose={() => setPanelOpen(false)} title="实验参数">
 *     { ...controls... }
 *   </ControlPanel>
 *
 * Then add a <MobilePanelToggle> to the header (mobile-only) to open the drawer.
 */
export function ControlPanel({
  open,
  onClose,
  children,
  title = '控制面板',
  desktopWidth = 'w-80',
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
  title?: string
  desktopWidth?: string
}) {
  const isMobile = useIsMobile()

  // Lock body scroll when drawer open on mobile
  useEffect(() => {
    if (isMobile && open) {
      const prev = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = prev
      }
    }
  }, [isMobile, open])

  if (!isMobile) {
    // Desktop inline panel
    return (
      <div
        className={`${desktopWidth} flex-shrink-0 bg-[#f8f9fb] border-r border-[#d4d8e0] overflow-y-auto p-4 space-y-4 custom-scrollbar`}
      >
        {children}
      </div>
    )
  }

  // Mobile drawer
  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          onClick={onClose}
          aria-hidden="true"
          style={{
            position: 'fixed',
            inset: 0,
            top: '44px',
            bottom: '24px',
            backgroundColor: 'rgba(26, 26, 26, 0.35)',
            zIndex: 40,
            animation: 'mobile-fade-in 200ms ease-out forwards',
          }}
        />
      )}
      {/* Drawer */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          position: 'fixed',
          left: 0,
          top: '44px',
          bottom: '24px',
          width: '86vw',
          maxWidth: '340px',
          backgroundColor: '#f8f9fb',
          borderRight: '1px solid #d4d8e0',
          zIndex: 50,
          overflowY: 'auto',
          transform: open ? 'translateX(0)' : 'translateX(-105%)',
          transition: 'transform 220ms ease-out',
          boxShadow: open ? '2px 0 12px rgba(0,0,0,0.08)' : 'none',
        }}
        className="custom-scrollbar"
      >
        {/* Drawer header */}
        <div
          style={{
            position: 'sticky',
            top: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 14px',
            backgroundColor: '#FFFFFF',
            borderBottom: '1px solid #e8eaef',
            zIndex: 2,
          }}
        >
          <span
            style={{
              fontFamily: FONT,
              fontSize: '12px',
              fontWeight: 600,
              color: '#1a1a2e',
              letterSpacing: '0.02em',
            }}
          >
            {title}
          </span>
          <button
            onClick={onClose}
            aria-label="关闭控制面板"
            style={{
              width: '28px',
              height: '28px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid #d4d8e0',
              borderRadius: '4px',
              backgroundColor: '#FFFFFF',
              cursor: 'pointer',
              color: '#555',
              fontSize: '16px',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
        <div className="p-4 space-y-4">{children}</div>
      </div>
    </>
  )
}

/**
 * Mobile-only toggle button for the control panel drawer.
 * Renders nothing on desktop.
 */
export function MobilePanelToggle({
  onClick,
  label = '参数',
}: {
  onClick: () => void
  label?: string
}) {
  const isMobile = useIsMobile()
  if (!isMobile) return null
  return (
    <button
      onClick={onClick}
      aria-label="打开控制面板"
      style={{
        fontFamily: FONT,
        fontSize: '11px',
        fontWeight: 500,
        color: '#1a1a2e',
        backgroundColor: '#FFFFFF',
        border: '1px solid #d4d8e0',
        borderRadius: '4px',
        padding: '5px 10px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        minHeight: '32px',
        marginLeft: 'auto',
      }}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="4" y1="6" x2="20" y2="6" />
        <line x1="4" y1="12" x2="14" y2="12" />
        <line x1="4" y1="18" x2="18" y2="18" />
      </svg>
      {label}
    </button>
  )
}

/**
 * Hook that bundles mobile panel state management.
 * Returns isMobile flag, panel open state, and setters.
 */
export function useMobilePanel() {
  const isMobile = useIsMobile()
  return { isMobile }
}
