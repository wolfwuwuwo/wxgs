'use client'

import { useState, useRef } from 'react'
import { NAV_TREE, ALL_EXPERIMENTS, type BranchId, type ViewId } from '@/lib/navigation'
import { useIsMobile } from '@/hooks/use-mobile'

const FONT = "system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif"
const MONO = 'var(--font-geist-mono), monospace'

/* ─── SVG Icons ─── */
function GeometricOpticsIcon() {
  return (
    <svg width="100%" height="100%" viewBox="0 0 200 140" fill="none" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
      <line x1="10" y1="70" x2="190" y2="70" stroke="#888888" strokeWidth="0.8" strokeDasharray="8,3,2,3" />
      <path d="M90 30 Q100 70 90 110" stroke="#333333" strokeWidth="1.5" fill="none" />
      <path d="M110 30 Q100 70 110 110" stroke="#333333" strokeWidth="1.5" fill="none" />
      <line x1="10" y1="40" x2="88" y2="40" stroke="#CC0000" strokeWidth="2" />
      <polygon points="88,36 88,44 94,40" fill="#CC0000" />
      <line x1="112" y1="40" x2="160" y2="70" stroke="#CC0000" strokeWidth="2" />
      <polygon points="156,66 160,70 156,74" fill="#CC0000" className="icon-geometric-focus" style={{ transition: 'transform 200ms ease-out' }} />
      <line x1="10" y1="70" x2="88" y2="70" stroke="#CC0000" strokeWidth="2" />
      <polygon points="88,66 88,74 94,70" fill="#CC0000" />
      <line x1="112" y1="70" x2="160" y2="70" stroke="#CC0000" strokeWidth="2" />
      <polygon points="156,66 160,70 156,74" fill="#CC0000" />
      <line x1="10" y1="100" x2="88" y2="100" stroke="#CC0000" strokeWidth="2" />
      <polygon points="88,96 88,104 94,100" fill="#CC0000" />
      <line x1="112" y1="100" x2="160" y2="70" stroke="#CC0000" strokeWidth="2" />
      <polygon points="156,66 160,70 156,74" fill="#CC0000" />
      <circle cx="160" cy="70" r="3" fill="#CC0000" />
    </svg>
  )
}

function PhysicalOpticsIcon() {
  return (
    <svg width="100%" height="100%" viewBox="0 0 200 140" fill="none" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
      <rect x="48" y="10" width="4" height="42" fill="#333333" />
      <rect x="48" y="58" width="4" height="24" fill="#333333" />
      <rect x="48" y="88" width="4" height="42" fill="#333333" />
      <line x1="44" y1="56" x2="56" y2="56" stroke="#888888" strokeWidth="0.5" />
      <line x1="44" y1="84" x2="56" y2="84" stroke="#888888" strokeWidth="0.5" />
      <g className="icon-physical-fringes" style={{ transition: 'transform 200ms ease-out' }}>
        <rect x="70" y="62" width="50" height="2" fill="#1A1A1A" />
        <rect x="70" y="52" width="50" height="2" fill="#1A1A1A" opacity="0.85" />
        <rect x="70" y="72" width="50" height="2" fill="#1A1A1A" opacity="0.85" />
        <rect x="70" y="42" width="50" height="2" fill="#1A1A1A" opacity="0.6" />
        <rect x="70" y="82" width="50" height="2" fill="#1A1A1A" opacity="0.6" />
        <rect x="70" y="32" width="50" height="2" fill="#1A1A1A" opacity="0.35" />
        <rect x="70" y="92" width="50" height="2" fill="#1A1A1A" opacity="0.35" />
        <rect x="70" y="22" width="50" height="2" fill="#1A1A1A" opacity="0.15" />
        <rect x="70" y="102" width="50" height="2" fill="#1A1A1A" opacity="0.15" />
        <line x1="125" y1="12" x2="125" y2="112" stroke="#888888" strokeWidth="0.5" strokeDasharray="3,3" />
      </g>
      <g transform="translate(160, 100)">
        <circle cx="0" cy="0" r="6" stroke="#333333" strokeWidth="1" fill="none" />
        <circle cx="0" cy="0" r="12" stroke="#333333" strokeWidth="0.8" fill="none" />
        <circle cx="0" cy="0" r="18" stroke="#333333" strokeWidth="0.6" fill="none" />
        <circle cx="0" cy="0" r="24" stroke="#333333" strokeWidth="0.4" fill="none" />
        <circle cx="0" cy="0" r="2" fill="#1A1A1A" />
      </g>
      <line x1="20" y1="30" x2="20" y2="110" stroke="#888888" strokeWidth="0.5" strokeDasharray="2,4" />
      <line x1="30" y1="25" x2="30" y2="115" stroke="#888888" strokeWidth="0.5" strokeDasharray="2,4" />
      <line x1="40" y1="28" x2="40" y2="112" stroke="#888888" strokeWidth="0.5" strokeDasharray="2,4" />
    </svg>
  )
}

function ModernOpticsIcon() {
  return (
    <svg width="100%" height="100%" viewBox="0 0 200 140" fill="none" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
      <rect x="10" y="52" width="60" height="36" stroke="#333333" strokeWidth="1.5" fill="none" rx="3" />
      <rect x="10" y="55" width="4" height="30" fill="#333333" />
      <rect x="66" y="55" width="4" height="30" fill="#333333" />
      <text x="30" y="74" fontSize="6" fill="#888888" fontFamily="system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif">He-Ne</text>
      <rect x="70" y="66" width="3" height="8" fill="#333333" />
      <line x1="73" y1="70" x2="130" y2="70" stroke="#CC0000" strokeWidth="2" />
      <polygon points="126,66 130,70 126,74" fill="#CC0000" className="icon-modern-arrow" style={{ transition: 'transform 200ms ease-out' }} />
      <path d="M130 45 Q138 70 130 95" stroke="#333333" strokeWidth="1.5" fill="none" />
      <path d="M140 45 Q132 70 140 95" stroke="#333333" strokeWidth="1.5" fill="none" />
      <line x1="140" y1="70" x2="170" y2="70" stroke="#CC0000" strokeWidth="2" />
      <line x1="140" y1="55" x2="170" y2="67" stroke="#CC0000" strokeWidth="1.5" />
      <line x1="140" y1="85" x2="170" y2="73" stroke="#CC0000" strokeWidth="1.5" />
      <circle cx="170" cy="70" r="2.5" fill="#CC0000" />
      <g opacity="0.12">
        <line x1="145" y1="40" x2="145" y2="100" stroke="#333333" strokeWidth="0.5" />
        <line x1="152" y1="40" x2="152" y2="100" stroke="#333333" strokeWidth="0.5" />
        <line x1="159" y1="40" x2="159" y2="100" stroke="#333333" strokeWidth="0.5" />
        <line x1="166" y1="40" x2="166" y2="100" stroke="#333333" strokeWidth="0.5" />
        <line x1="130" y1="45" x2="180" y2="45" stroke="#333333" strokeWidth="0.5" />
        <line x1="130" y1="55" x2="180" y2="55" stroke="#333333" strokeWidth="0.5" />
        <line x1="130" y1="65" x2="180" y2="65" stroke="#333333" strokeWidth="0.5" />
        <line x1="130" y1="75" x2="180" y2="75" stroke="#333333" strokeWidth="0.5" />
        <line x1="130" y1="85" x2="180" y2="85" stroke="#333333" strokeWidth="0.5" />
        <line x1="130" y1="95" x2="180" y2="95" stroke="#333333" strokeWidth="0.5" />
      </g>
      <rect x="180" y="62" width="12" height="16" fill="#333333" />
    </svg>
  )
}

const ICON_MAP: Record<BranchId, () => JSX.Element> = {
  geometric: GeometricOpticsIcon,
  physical: PhysicalOpticsIcon,
  modern: ModernOpticsIcon,
}

const BRANCH_NUM: Record<BranchId, string> = {
  geometric: '01',
  physical: '02',
  modern: '03',
}

interface HomeContentProps {
  onNavigate: (id: ViewId) => void
}

export function HomeContent({ onNavigate }: HomeContentProps) {
  const isMobile = useIsMobile()
  const [pressedCard, setPressedCard] = useState<string | null>(null)
  const [hoveredCard, setHoveredCard] = useState<string | null>(null)

  const totalExperiments = ALL_EXPERIMENTS.length

  return (
    <div className="dot-grid-hero h-full overflow-y-auto custom-scrollbar"
      style={{ padding: isMobile ? '24px 16px 32px' : '40px 32px 48px' }}>
      <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
        {/* ─── Hero Header ─── */}
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: isMobile ? 'flex-start' : 'center',
          textAlign: isMobile ? 'left' : 'center',
          marginBottom: isMobile ? '24px' : '40px',
          paddingTop: isMobile ? '0' : '16px',
        }}>
          {/* Brand + eyebrow */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '10px',
            marginBottom: '14px',
            justifyContent: isMobile ? 'flex-start' : 'center',
          }}>
            {!isMobile && (
              <img
                src="/logo.png"
                alt="logo"
                width={26}
                height={26}
                style={{ flexShrink: 0, objectFit: 'contain' }}
              />
            )}
            <span className="eyebrow">OPTICS LAB · v5.0</span>
            <span style={{
              width: '4px', height: '4px', borderRadius: '50%', backgroundColor: '#C0C4C8',
              display: 'inline-block',
            }} />
            <span style={{
              fontFamily: MONO, fontSize: '10px', color: '#888888',
              letterSpacing: '0.04em',
            }} className="tabular-nums">
              {new Date().getFullYear()} · INTERACTIVE
            </span>
          </div>

          {/* 主标题 */}
          <h1 style={{
            fontFamily: FONT, fontSize: isMobile ? '26px' : '34px', fontWeight: 600,
            color: '#1A1A1A', margin: 0, letterSpacing: '-0.02em', lineHeight: 1.15,
          }}>
            光学仿真实验平台
          </h1>
          <p style={{
            fontFamily: FONT, fontSize: isMobile ? '12px' : '13px', fontWeight: 400,
            color: '#666666', margin: '10px 0 0 0', lineHeight: 1.7,
            maxWidth: '560px',
          }}>
            面向大学基础物理光学课堂的交互式仿真——
            <span style={{ color: '#1A1A1A', fontWeight: 500 }}>光线追迹 · 矢量衍射 · 偏振琼斯 · 高斯光束</span>
            <br />在浏览器中实时复现经典实验，自由调参与可视化探索。
          </p>

          {/* 统计数据栏 */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '14px', marginTop: '18px',
            fontFamily: FONT, fontSize: '11px', color: '#888888',
            flexWrap: 'wrap', justifyContent: isMobile ? 'flex-start' : 'center',
          }}>
            <StatItem value="3" label="学科分支" />
            <StatDivider />
            <StatItem value={String(totalExperiments)} label="实验模块" />
            <StatDivider />
            <StatItem value="∞" label="参数组合" />
            <StatDivider />
            <StatItem value="60fps" label="实时渲染" mono />
          </div>

          {/* 分割线 */}
          <div style={{
            marginTop: '24px', height: '1px', width: '100%',
            background: 'linear-gradient(90deg, transparent 0%, #E0E4E8 20%, #E0E4E8 80%, transparent 100%)',
          }} />
        </div>

        {/* ─── 分支入口卡片 ─── */}
        <div className="flex items-start justify-center flex-wrap w-full"
          style={{ gap: isMobile ? '16px' : '24px' }}>
          {NAV_TREE.map((branch, index) => {
            const IconComponent = ICON_MAP[branch.id]
            const isHovered = hoveredCard === branch.id
            const isPressed = pressedCard === branch.id
            return (
              <div key={branch.id} className={`optics-card card-entrance${index === 1 ? '-delay-1' : index === 2 ? '-delay-2' : ''}`}>
                <BranchEntryCard
                  branch={branch}
                  branchNum={BRANCH_NUM[branch.id]}
                  isHovered={isHovered}
                  isPressed={isPressed}
                  isMobile={isMobile}
                  IconComponent={IconComponent}
                  onMouseEnter={() => setHoveredCard(branch.id)}
                  onMouseLeave={() => { setHoveredCard(null); setPressedCard(null) }}
                  onMouseDown={() => setPressedCard(branch.id)}
                  onMouseUp={() => setPressedCard(null)}
                  onClick={() => onNavigate(branch.hubId)}
                />
              </div>
            )
          })}
        </div>

        {/* ─── 提示信息 ─── */}
        <div style={{
          marginTop: isMobile ? '24px' : '32px',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '16px',
          fontFamily: FONT, fontSize: '11px', color: '#AAAAAA',
          flexWrap: 'wrap',
        }}>
          <HintItem>
            <Kbd>⌘K</Kbd>
            <span>快速搜索</span>
          </HintItem>
          <HintItem>
            <Kbd>↵</Kbd>
            <span>键盘导航</span>
          </HintItem>
          <HintItem>
            <Dot />
            <span>悬停 0.5s 查看分支详情</span>
          </HintItem>
        </div>
      </div>
    </div>
  )
}

/* ─── 统计项 ─── */
function StatItem({ value, label, mono }: { value: string; label: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
      <span style={{
        fontFamily: mono ? 'var(--font-geist-mono), monospace' : FONT,
        fontSize: '15px', fontWeight: 600, color: '#1A1A1A',
      }} className="tabular-nums">
        {value}
      </span>
      <span style={{ fontSize: '11px', color: '#888888' }}>{label}</span>
    </div>
  )
}

function StatDivider() {
  return <span style={{ width: '1px', height: '12px', backgroundColor: '#D8DCE0', display: 'inline-block' }} />
}

function HintItem({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>{children}</div>
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd style={{
      fontFamily: 'var(--font-geist-mono), monospace', fontSize: '10px', color: '#666666',
      border: '1px solid #D0D0D0', borderRadius: '3px', padding: '1px 5px',
      backgroundColor: '#FFFFFF', minWidth: '20px', textAlign: 'center', display: 'inline-block',
    }}>
      {children}
    </kbd>
  )
}

function Dot() {
  return <span style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: '#CC0000', display: 'inline-block' }} />
}

/* ─── 入口卡片（含长悬停说明弹出） ─── */
function BranchEntryCard({
  branch, branchNum, isHovered, isPressed, isMobile, IconComponent,
  onMouseEnter, onMouseLeave, onMouseDown, onMouseUp, onClick,
}: {
  branch: typeof NAV_TREE[number]
  branchNum: string
  isHovered: boolean
  isPressed: boolean
  isMobile: boolean
  IconComponent: () => JSX.Element
  onMouseEnter: () => void
  onMouseLeave: () => void
  onMouseDown: () => void
  onMouseUp: () => void
  onClick: () => void
}) {
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [showTooltip, setShowTooltip] = useState(false)

  const handleEnter = () => {
    onMouseEnter()
    if (isMobile) return // 移动端不弹说明
    hoverTimer.current = setTimeout(() => setShowTooltip(true), 550)
  }
  const handleLeave = () => {
    onMouseLeave()
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    setShowTooltip(false)
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`进入${branch.title}模块`}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onClick={onClick}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}
      className={`card-hover-lift focus-ring ${isPressed ? 'is-pressed' : ''}`}
      style={{
        position: 'relative',
        width: isMobile ? '100%' : '280px',
        maxWidth: isMobile ? '360px' : '280px',
        height: isMobile ? 'auto' : '372px',
        minHeight: isMobile ? '280px' : '372px',
        backgroundColor: isPressed ? '#E6E9EC' : isHovered ? '#FFFFFF' : '#FAFAFA',
        border: `1px solid ${isHovered ? '#1A1A1A' : '#D0D0D0'}`,
        borderRadius: '3px', cursor: 'pointer',
        display: 'flex', flexDirection: 'column',
        userSelect: 'none',
        overflow: 'visible',
      }}
    >
      {/* 顶部细线强调（hover 时显现） */}
      <div style={{
        position: 'absolute', top: -1, left: -1, right: -1, height: '2px',
        backgroundColor: '#1A1A1A',
        opacity: isHovered ? 1 : 0,
        transition: 'opacity 200ms ease-out',
        borderTopLeftRadius: '3px', borderTopRightRadius: '3px',
      }} />

      {/* 卡片头部：编号 + 分支图标徽章 */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 16px 0 16px',
      }}>
        <span className="num-badge" style={{
          fontFamily: MONO, fontSize: '11px', fontWeight: 500,
          color: isHovered ? '#1A1A1A' : '#AAAAAA',
          letterSpacing: '0.1em',
          transition: 'color 200ms ease-out',
        }}>
          {branchNum} / 03
        </span>
        <span style={{
          width: '24px', height: '24px', borderRadius: '3px',
          border: `1px solid ${isHovered ? '#1A1A1A' : '#C0C4C8'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: FONT, fontSize: '13px', fontWeight: 600,
          color: isHovered ? '#1A1A1A' : '#555555',
          backgroundColor: isHovered ? '#FFFFFF' : 'transparent',
          transition: 'all 200ms ease-out',
        }}>
          {branch.iconText}
        </span>
      </div>

      {/* 图标区 */}
      <div style={{
        height: isMobile ? '120px' : '150px',
        margin: isMobile ? '8px 8px 0 8px' : '4px 12px 0 12px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: '#FFFFFF',
        borderRadius: '2px',
        border: '1px solid #E8ECF0',
        padding: '8px',
      }}>
        <IconComponent />
      </div>

      {/* 标题 + 描述 */}
      <div style={{ padding: '16px 18px 0 18px', flex: 1 }}>
        <h2 style={{
          fontFamily: FONT, fontSize: isMobile ? '16px' : '17px', fontWeight: 600,
          color: '#1A1A1A', margin: 0, textAlign: 'left', letterSpacing: '-0.01em',
        }}>
          {branch.title}
        </h2>
        <p style={{
          fontFamily: FONT, fontSize: isMobile ? '11px' : '11.5px', fontWeight: 400, color: '#666666',
          margin: '6px 0 0 0', lineHeight: '1.6', textAlign: 'left',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {branch.description}
        </p>
      </div>

      {/* 底部信息栏：实验数 + 进入箭头 */}
      <div style={{
        margin: '12px 16px 14px 16px',
        paddingTop: '12px',
        borderTop: '1px solid #E8ECF0',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        fontFamily: FONT, fontSize: '10px',
      }}>
        <span style={{ color: '#888888' }} className="tabular-nums">
          {branch.experiments.length} 个实验
        </span>
        <span style={{
          display: 'flex', alignItems: 'center', gap: '4px',
          color: isHovered ? '#1A1A1A' : '#888888',
          fontWeight: 500,
          transition: 'color 200ms ease-out, transform 200ms ease-out',
          transform: isHovered ? 'translateX(2px)' : 'translateX(0)',
        }}>
          进入
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2 5H8M8 5L5 2M8 5L5 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </div>

      {/* 长悬停说明卡片（白底黑字细边框） */}
      {showTooltip && (
        <div
          role="tooltip"
          style={{
            position: 'absolute',
            bottom: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            marginBottom: '8px',
            width: '320px',
            backgroundColor: '#FFFFFF',
            border: '1px solid #1A1A1A',
            borderRadius: '3px',
            padding: '14px 16px',
            zIndex: 30,
            opacity: 0,
            animation: 'tooltip-fade-in 140ms ease-out forwards',
            boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
            pointerEvents: 'none',
          }}
        >
          <div style={{
            fontFamily: FONT, fontSize: '11px', fontWeight: 600, color: '#1A1A1A',
            marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px',
          }}>
            <span className="num-badge" style={{ color: '#888888' }}>{branchNum}</span>
            <span style={{
              width: '20px', height: '20px', border: '1px solid #333333', borderRadius: '3px',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '12px', fontWeight: 600,
            }}>{branch.iconText}</span>
            {branch.title} · 分支概览
          </div>
          <p style={{
            fontFamily: FONT, fontSize: '11px', fontWeight: 400, color: '#333333',
            lineHeight: 1.7, margin: '0 0 10px 0', textAlign: 'justify',
          }}>
            {branch.longDescription}
          </p>
          <div style={{
            fontFamily: FONT, fontSize: '9px', fontWeight: 500, color: '#888888',
            paddingTop: '8px', borderTop: '1px solid #E8ECF0',
            display: 'flex', justifyContent: 'space-between',
          }} className="tabular-nums">
            <span>{branch.experiments.length} 个实验 · 含子模块</span>
            <span>点击进入 →</span>
          </div>
          {/* 小三角 */}
          <div style={{
            position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)',
            width: 0, height: 0,
            borderLeft: '5px solid transparent',
            borderRight: '5px solid transparent',
            borderTop: '5px solid #1A1A1A',
          }} />
          <div style={{
            position: 'absolute', top: 'calc(100% - 1px)', left: '50%', transform: 'translateX(-50%)',
            width: 0, height: 0,
            borderLeft: '5px solid transparent',
            borderRight: '5px solid transparent',
            borderTop: '5px solid #FFFFFF',
          }} />
        </div>
      )}

      <style>{`
        @keyframes tooltip-fade-in {
          from { opacity: 0; transform: translateX(-50%) translateY(2px); }
          to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `}</style>
    </div>
  )
}
