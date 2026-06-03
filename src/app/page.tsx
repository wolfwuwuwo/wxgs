'use client'

import { useState, useCallback } from 'react'
import dynamic from 'next/dynamic'

// Dynamic imports to avoid loading simulation code until needed
const JonesPolarizationLab = dynamic(
  () => import('@/components/simulations/JonesPolarizationLab'),
  { ssr: false }
)
const VectorDiffractionWorkshop = dynamic(
  () => import('@/components/simulations/VectorDiffractionWorkshop'),
  { ssr: false }
)

/* ─── View State ─── */
type ViewId =
  | 'home'
  | 'physical-hub'
  | 'physical-jones'
  | 'physical-diffraction'

/* ─── SVG Icon: Geometric Optics ─── */
function GeometricOpticsIcon() {
  return (
    <svg width="200" height="140" viewBox="0 0 200 140" fill="none" xmlns="http://www.w3.org/2000/svg">
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

/* ─── SVG Icon: Physical Optics ─── */
function PhysicalOpticsIcon() {
  return (
    <svg width="200" height="140" viewBox="0 0 200 140" fill="none" xmlns="http://www.w3.org/2000/svg">
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

/* ─── SVG Icon: Modern Optics ─── */
function ModernOpticsIcon() {
  return (
    <svg width="200" height="140" viewBox="0 0 200 140" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="10" y="52" width="60" height="36" stroke="#333333" strokeWidth="1.5" fill="none" rx="3" />
      <rect x="10" y="55" width="4" height="30" fill="#333333" />
      <rect x="66" y="55" width="4" height="30" fill="#333333" />
      <text x="30" y="74" fontSize="6" fill="#888888" fontFamily="var(--font-ibm-plex-sans), system-ui, sans-serif">He-Ne</text>
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

/* ─── Landing Card Data ─── */
const cards = [
  { id: 'geometric' as const, title: '几何光学', description: '光线追迹、透镜成像、棱镜分光、光纤传光', icon: GeometricOpticsIcon },
  { id: 'physical' as const, title: '物理光学', description: '干涉、衍射、偏振、旋光、波前再现', icon: PhysicalOpticsIcon },
  { id: 'modern' as const, title: '现代光学', description: '激光传输、空间滤波、光纤模式、量子光学基础', icon: ModernOpticsIcon },
]

/* ─── Sub-module entries for Physical Optics ─── */
const physicalSubModules = [
  {
    id: 'physical-jones' as ViewId,
    title: '偏振琼斯矩阵实验室',
    description: '自由组合偏振片、半波片、1/4波片，旋转元件角度，动态绘制偏振椭圆，追踪琼斯矩阵与斯托克斯参数',
    iconText: 'J',
  },
  {
    id: 'physical-diffraction' as ViewId,
    title: '全波前矢量衍射工坊',
    description: '选择口径类型与尺寸，2D FFT矢量衍射积分，即时生成菲涅耳与夫琅禾费衍射强度图',
    iconText: 'D',
  },
]

/* ─── Common styles ─── */
const FONT = 'var(--font-ibm-plex-sans), system-ui, sans-serif'

/* ─── Main Page ─── */
export default function Home() {
  const [currentView, setCurrentView] = useState<ViewId>('home')
  const [pressedCard, setPressedCard] = useState<string | null>(null)
  const [hoveredCard, setHoveredCard] = useState<string | null>(null)
  const [fadeOut, setFadeOut] = useState(false)
  const [fadeIn, setFadeIn] = useState(false)

  const navigateTo = useCallback((viewId: ViewId) => {
    setFadeOut(true)
    setTimeout(() => {
      setCurrentView(viewId)
      setFadeOut(false)
      setFadeIn(true)
      setTimeout(() => setFadeIn(false), 300)
    }, 200)
  }, [])

  const goHome = useCallback(() => {
    setFadeOut(true)
    setTimeout(() => {
      setCurrentView('home')
      setFadeOut(false)
      setFadeIn(true)
      setTimeout(() => setFadeIn(false), 300)
    }, 200)
  }, [])

  /* ─── Sub-module views ─── */
  if (currentView === 'physical-jones') {
    return (
      <div className={`min-h-screen flex flex-col ${fadeIn ? 'page-fade-in' : ''}`} style={{ background: '#FFFFFF' }}>
        <JonesPolarizationLab onBack={goHome} />
      </div>
    )
  }

  if (currentView === 'physical-diffraction') {
    return (
      <div className={`min-h-screen flex flex-col ${fadeIn ? 'page-fade-in' : ''}`} style={{ background: '#FFFFFF' }}>
        <VectorDiffractionWorkshop onBack={goHome} />
      </div>
    )
  }

  /* ─── Physical Optics sub-module selection hub ─── */
  if (currentView === 'physical-hub') {
    return (
      <div className={`min-h-screen flex flex-col ${fadeIn ? 'page-fade-in' : ''} ${fadeOut ? 'page-fade-out' : ''}`} style={{ background: '#FFFFFF' }}>
        <header className="flex-shrink-0 flex items-center" style={{
          height: '48px', backgroundColor: '#FFFFFF',
          borderBottom: '1px solid #CCCCCC', paddingLeft: '24px', paddingRight: '24px',
        }}>
          <button onClick={goHome} style={{
            fontFamily: FONT, fontSize: '12px', fontWeight: 400, color: '#555555',
            background: 'none', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: '4px',
            transition: 'color 200ms ease-out',
          }} onMouseEnter={e => (e.currentTarget.style.color = '#1A1A1A')}
             onMouseLeave={e => (e.currentTarget.style.color = '#555555')}>
            ← 返回
          </button>
          <span style={{ margin: '0 12px', color: '#D0D0D0' }}>|</span>
          <h1 style={{ fontFamily: FONT, fontSize: '20px', fontWeight: 600, color: '#1A1A1A', margin: 0 }}>
            物理光学
          </h1>
        </header>

        <main className="flex-1 dot-grid flex items-center justify-center" style={{ padding: '40px 24px' }}>
          <div className="flex items-start justify-center gap-10 flex-wrap" style={{ maxWidth: '760px' }}>
            {physicalSubModules.map((sub) => {
              const isHovered = hoveredCard === sub.id
              const isPressed = pressedCard === sub.id
              return (
                <div
                  key={sub.id}
                  className="optics-card card-entrance"
                  role="button"
                  tabIndex={0}
                  aria-label={`进入${sub.title}`}
                  onMouseEnter={() => setHoveredCard(sub.id)}
                  onMouseLeave={() => { setHoveredCard(null); setPressedCard(null) }}
                  onMouseDown={() => setPressedCard(sub.id)}
                  onMouseUp={() => setPressedCard(null)}
                  onClick={() => navigateTo(sub.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigateTo(sub.id) }
                  }}
                  style={{
                    width: '320px', minHeight: '240px',
                    backgroundColor: isPressed ? '#E6E9EC' : isHovered ? '#F0F3F6' : '#FAFAFA',
                    border: `1px solid ${isHovered ? '#333333' : '#D0D0D0'}`,
                    borderRadius: '2px', cursor: 'pointer',
                    transition: isPressed
                      ? 'transform 100ms ease-out, background-color 100ms ease-out, border-color 200ms ease-out'
                      : 'background-color 200ms ease-out, border-color 200ms ease-out',
                    transform: isPressed ? 'scale(0.97)' : 'scale(1)',
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    padding: '36px 28px', userSelect: 'none',
                  }}
                >
                  {/* Icon circle */}
                  <div style={{
                    width: '64px', height: '64px', borderRadius: '50%',
                    border: '1.5px solid #333333', display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                    fontSize: '24px', fontWeight: 600, color: '#333333',
                    fontFamily: FONT, marginBottom: '20px',
                  }}>
                    {sub.iconText}
                  </div>
                  <h2 style={{
                    fontFamily: FONT, fontSize: '18px', fontWeight: 600, color: '#1A1A1A',
                    margin: '0 0 10px 0', textAlign: 'center',
                  }}>
                    {sub.title}
                  </h2>
                  <p style={{
                    fontFamily: FONT, fontSize: '12px', fontWeight: 400, color: '#666666',
                    margin: 0, textAlign: 'center', lineHeight: '1.6',
                  }}>
                    {sub.description}
                  </p>
                </div>
              )
            })}
          </div>
        </main>

        <footer className="flex-shrink-0 flex items-center mt-auto" style={{
          height: '24px', backgroundColor: '#FFFFFF',
          borderTop: '1px solid #CCCCCC', paddingLeft: '24px',
        }}>
          <span style={{ fontFamily: FONT, fontSize: '10px', fontWeight: 400, color: '#888888' }} className="tabular-nums">
            v1.0 · 物理光学模块
          </span>
        </footer>
      </div>
    )
  }

  /* ─── Home Landing Page ─── */
  return (
    <div
      className={`min-h-screen flex flex-col ${fadeOut ? 'page-fade-out' : ''}`}
      style={{ background: '#FFFFFF' }}
    >
      <header className="flex-shrink-0 flex items-center" style={{
        height: '48px', backgroundColor: '#FFFFFF',
        borderBottom: '1px solid #CCCCCC', paddingLeft: '24px',
      }}>
        <h1 style={{
          fontFamily: FONT, fontSize: '20px', fontWeight: 600, color: '#1A1A1A',
          margin: 0, letterSpacing: '-0.01em',
        }}>
          光学仿真实验平台
        </h1>
      </header>

      <main className="flex-1 dot-grid flex items-center justify-center" style={{ padding: '40px 24px' }}>
        <div className="flex items-start justify-center gap-10 flex-wrap" style={{ maxWidth: '960px' }}>
          {cards.map((card, index) => {
            const IconComponent = card.icon
            const isHovered = hoveredCard === card.id
            const isPressed = pressedCard === card.id

            return (
              <div
                key={card.id}
                className={`optics-card card-entrance${index === 1 ? '-delay-1' : index === 2 ? '-delay-2' : ''}`}
                role="button"
                tabIndex={0}
                aria-label={`进入${card.title}模块`}
                onMouseEnter={() => setHoveredCard(card.id)}
                onMouseLeave={() => { setHoveredCard(null); setPressedCard(null) }}
                onMouseDown={() => setPressedCard(card.id)}
                onMouseUp={() => setPressedCard(null)}
                onClick={() => {
                  if (card.id === 'physical') {
                    navigateTo('physical-hub')
                  }
                  // geometric and modern: future modules
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    if (card.id === 'physical') {
                      navigateTo('physical-hub')
                    }
                  }
                }}
                style={{
                  width: '280px', height: '360px',
                  backgroundColor: isPressed ? '#E6E9EC' : isHovered ? '#F0F3F6' : '#FAFAFA',
                  border: `1px solid ${isHovered ? '#333333' : '#D0D0D0'}`,
                  borderRadius: '2px', cursor: 'pointer',
                  transition: isPressed
                    ? 'transform 100ms ease-out, background-color 100ms ease-out, border-color 200ms ease-out'
                    : 'background-color 200ms ease-out, border-color 200ms ease-out',
                  transform: isPressed ? 'scale(0.97)' : 'scale(1)',
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  paddingTop: '40px', userSelect: 'none',
                }}
              >
                <div style={{ height: '160px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <IconComponent />
                </div>
                <h2 style={{
                  fontFamily: FONT, fontSize: '18px', fontWeight: 600, color: '#1A1A1A',
                  margin: '24px 0 0 0', textAlign: 'center',
                }}>
                  {card.title}
                </h2>
                <p style={{
                  fontFamily: FONT, fontSize: '12px', fontWeight: 400, color: '#666666',
                  margin: '8px 0 0 0', textAlign: 'center', lineHeight: '1.6',
                  padding: '0 24px', display: '-webkit-box',
                  WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                }}>
                  {card.description}
                </p>
              </div>
            )
          })}
        </div>
      </main>

      <footer className="flex-shrink-0 flex items-center mt-auto" style={{
        height: '24px', backgroundColor: '#FFFFFF',
        borderTop: '1px solid #CCCCCC', paddingLeft: '24px',
      }}>
        <span style={{ fontFamily: FONT, fontSize: '10px', fontWeight: 400, color: '#888888' }} className="tabular-nums">
          v1.0 · 高斯光束追踪 | 矢量衍射仿真 | 偏振琼斯分析
        </span>
      </footer>
    </div>
  )
}
