'use client'

import { useIsMobile } from '@/hooks/use-mobile'

const FONT = "system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif"
const MONO = 'var(--font-geist-mono), monospace'

interface StatusBarProps {
  text: string
  onSnapshot?: () => void
  snapshotCount?: number
  onOpenGallery?: () => void
  tearOffCount?: number
  onClearTearOff?: () => void
}

export function StatusBar({
  text, onSnapshot, snapshotCount = 0, onOpenGallery, tearOffCount = 0, onClearTearOff,
}: StatusBarProps) {
  const isMobile = useIsMobile()

  return (
    <footer
      className="flex-shrink-0 flex items-center"
      style={{
        height: '28px', backgroundColor: '#FFFFFF', borderTop: '1px solid #E0E4E8',
        paddingLeft: isMobile ? '12px' : '14px', paddingRight: '12px',
        gap: '10px',
      }}
    >
      {/* 状态指示灯 */}
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: '6px',
        flexShrink: 0,
      }}>
        <span style={{
          width: '6px', height: '6px', borderRadius: '50%',
          backgroundColor: '#00AA44',
          boxShadow: '0 0 0 2px rgba(0,170,68,0.15)',
        }} />
        {!isMobile && (
          <span style={{
            fontFamily: FONT, fontSize: '10px', fontWeight: 500, color: '#1A1A1A',
            letterSpacing: '0.04em',
          }}>
            READY
          </span>
        )}
      </span>

      {/* 分隔线 */}
      {!isMobile && (
        <span style={{ width: '1px', height: '14px', backgroundColor: '#E0E4E8', flexShrink: 0 }} />
      )}

      {/* 主状态文字 */}
      <span
        className="tabular-nums"
        style={{
          fontFamily: FONT, fontSize: isMobile ? '10px' : '10.5px', fontWeight: 400,
          color: '#666666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          flex: 1,
        }}
      >
        {isMobile ? text.split('—')[0].trim() : text}
      </span>

      {/* 撕下面板计数 */}
      {tearOffCount > 0 && (
        <button
          onClick={onClearTearOff}
          title="清除所有撕下对比面板"
          style={{
            display: 'flex', alignItems: 'center', gap: '5px',
            fontFamily: FONT, fontSize: '9.5px', color: '#666',
            background: '#FAFAFA', border: '1px solid #E0E4E8', borderRadius: '3px',
            padding: '0 8px', height: '20px', cursor: 'pointer',
            transition: 'all 120ms ease-out', fontWeight: 500,
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#1A1A1A'; e.currentTarget.style.color = '#1A1A1A'; e.currentTarget.style.backgroundColor = '#FFFFFF' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = '#E0E4E8'; e.currentTarget.style.color = '#666'; e.currentTarget.style.backgroundColor = '#FAFAFA' }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <rect x="1" y="2.5" width="5" height="4" stroke="currentColor" strokeWidth="0.8" fill="none" />
            <rect x="3" y="1" width="5" height="4" stroke="currentColor" strokeWidth="0.8" fill="#FFF" />
          </svg>
          {!isMobile && <span>对比</span>}
          <span style={{ fontWeight: 600, color: '#1A1A1A' }} className="tabular-nums">{tearOffCount}</span>
          {!isMobile && <span style={{ color: '#BBB', marginLeft: '1px' }}>×</span>}
        </button>
      )}

      {/* 快照按钮 */}
      {onSnapshot && (
        <button
          onClick={onSnapshot}
          aria-label="截取快照"
          title="截取当前实验视图快照（存入临时记录区）"
          style={{
            display: 'flex', alignItems: 'center', gap: '5px',
            fontFamily: FONT, fontSize: '9.5px',
            color: snapshotCount > 0 ? '#1A1A1A' : '#666666',
            background: snapshotCount > 0 ? '#FFFFFF' : '#FAFAFA',
            border: `1px solid ${snapshotCount > 0 ? '#888888' : '#E0E4E8'}`,
            borderRadius: '3px', padding: '0 8px', height: '20px', cursor: 'pointer',
            transition: 'all 120ms ease-out', fontWeight: 500,
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#1A1A1A'; e.currentTarget.style.color = '#1A1A1A' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = snapshotCount > 0 ? '#888888' : '#E0E4E8'; e.currentTarget.style.color = snapshotCount > 0 ? '#1A1A1A' : '#666666' }}
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <path d="M1.5 3.5H3L3.8 2.5H6.2L7 3.5H8.5V8H1.5V3.5Z" stroke="currentColor" strokeWidth="0.9" strokeLinejoin="round" />
            <circle cx="5" cy="5.5" r="1.3" stroke="currentColor" strokeWidth="0.9" />
          </svg>
          {!isMobile && <span>快照</span>}
          {snapshotCount > 0 && (
            <span style={{ fontWeight: 600 }} className="tabular-nums">{snapshotCount}</span>
          )}
        </button>
      )}

      {/* 打开快照画廊 */}
      {onOpenGallery && snapshotCount > 0 && (
        <button
          onClick={onOpenGallery}
          aria-label="打开快照记录区"
          title="打开快照记录区（查看/导出 PDF）"
          style={{
            display: 'flex', alignItems: 'center', gap: '4px',
            fontFamily: FONT, fontSize: '9.5px', color: '#FFFFFF',
            background: '#1A1A1A', border: '1px solid #1A1A1A',
            borderRadius: '3px', padding: '0 8px', height: '20px', cursor: 'pointer',
            transition: 'all 120ms ease-out', fontWeight: 500,
          }}
          onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#333333'; e.currentTarget.style.borderColor = '#333333' }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = '#1A1A1A'; e.currentTarget.style.borderColor = '#1A1A1A' }}
        >
          {!isMobile && <span>记录区</span>}
          <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
            <path d="M2 4.5L6 4.5M4.5 2.5L6 4.5L4.5 6.5" stroke="#FFF" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </footer>
  )
}
