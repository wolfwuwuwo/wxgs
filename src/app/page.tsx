'use client'

import { useState, useCallback } from 'react'

/* ─── SVG Icon: Geometric Optics ─── */
function GeometricOpticsIcon() {
  return (
    <svg width="200" height="140" viewBox="0 0 200 140" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Optical axis - dash-dot line */}
      <line x1="10" y1="70" x2="190" y2="70" stroke="#888888" strokeWidth="0.8" strokeDasharray="8,3,2,3" />

      {/* Biconvex lens */}
      <path d="M90 30 Q100 70 90 110" stroke="#333333" strokeWidth="1.5" fill="none" />
      <path d="M110 30 Q100 70 110 110" stroke="#333333" strokeWidth="1.5" fill="none" />

      {/* Top incoming ray */}
      <line x1="10" y1="40" x2="88" y2="40" stroke="#CC0000" strokeWidth="2" />
      <polygon points="88,36 88,44 94,40" fill="#CC0000" />
      {/* Top refracted ray to focus */}
      <line x1="112" y1="40" x2="160" y2="70" stroke="#CC0000" strokeWidth="2" />
      <polygon points="156,66 160,70 156,74" fill="#CC0000" className="icon-geometric-focus" style={{ transition: 'transform 200ms ease-out' }} />

      {/* Middle incoming ray (on axis) */}
      <line x1="10" y1="70" x2="88" y2="70" stroke="#CC0000" strokeWidth="2" />
      <polygon points="88,66 88,74 94,70" fill="#CC0000" />
      {/* Middle refracted ray continues on axis */}
      <line x1="112" y1="70" x2="160" y2="70" stroke="#CC0000" strokeWidth="2" />
      <polygon points="156,66 160,70 156,74" fill="#CC0000" />

      {/* Bottom incoming ray */}
      <line x1="10" y1="100" x2="88" y2="100" stroke="#CC0000" strokeWidth="2" />
      <polygon points="88,96 88,104 94,100" fill="#CC0000" />
      {/* Bottom refracted ray to focus */}
      <line x1="112" y1="100" x2="160" y2="70" stroke="#CC0000" strokeWidth="2" />
      <polygon points="156,66 160,70 156,74" fill="#CC0000" />

      {/* Focal point marker */}
      <circle cx="160" cy="70" r="3" fill="#CC0000" />
    </svg>
  )
}

/* ─── SVG Icon: Physical Optics ─── */
function PhysicalOpticsIcon() {
  return (
    <svg width="200" height="140" viewBox="0 0 200 140" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Double slit barrier */}
      <rect x="48" y="10" width="4" height="42" fill="#333333" />
      <rect x="48" y="58" width="4" height="24" fill="#333333" />
      <rect x="48" y="88" width="4" height="42" fill="#333333" />

      {/* Slit labels */}
      <line x1="44" y1="56" x2="56" y2="56" stroke="#888888" strokeWidth="0.5" />
      <line x1="44" y1="84" x2="56" y2="84" stroke="#888888" strokeWidth="0.5" />

      {/* Interference fringes on the right side */}
      <g className="icon-physical-fringes" style={{ transition: 'transform 200ms ease-out' }}>
        {/* Bright fringes (maxima) */}
        <rect x="70" y="62" width="50" height="2" fill="#1A1A1A" />
        <rect x="70" y="52" width="50" height="2" fill="#1A1A1A" opacity="0.85" />
        <rect x="70" y="72" width="50" height="2" fill="#1A1A1A" opacity="0.85" />
        <rect x="70" y="42" width="50" height="2" fill="#1A1A1A" opacity="0.6" />
        <rect x="70" y="82" width="50" height="2" fill="#1A1A1A" opacity="0.6" />
        <rect x="70" y="32" width="50" height="2" fill="#1A1A1A" opacity="0.35" />
        <rect x="70" y="92" width="50" height="2" fill="#1A1A1A" opacity="0.35" />
        <rect x="70" y="22" width="50" height="2" fill="#1A1A1A" opacity="0.15" />
        <rect x="70" y="102" width="50" height="2" fill="#1A1A1A" opacity="0.15" />

        {/* Observation screen line */}
        <line x1="125" y1="12" x2="125" y2="112" stroke="#888888" strokeWidth="0.5" strokeDasharray="3,3" />
      </g>

      {/* Diffraction rings below */}
      <g transform="translate(160, 100)">
        <circle cx="0" cy="0" r="6" stroke="#333333" strokeWidth="1" fill="none" />
        <circle cx="0" cy="0" r="12" stroke="#333333" strokeWidth="0.8" fill="none" />
        <circle cx="0" cy="0" r="18" stroke="#333333" strokeWidth="0.6" fill="none" />
        <circle cx="0" cy="0" r="24" stroke="#333333" strokeWidth="0.4" fill="none" />
        <circle cx="0" cy="0" r="2" fill="#1A1A1A" />
      </g>

      {/* Incoming plane wave indication */}
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
      {/* He-Ne laser tube */}
      <rect x="10" y="52" width="60" height="36" stroke="#333333" strokeWidth="1.5" fill="none" rx="3" />
      {/* Laser tube end caps */}
      <rect x="10" y="55" width="4" height="30" fill="#333333" />
      <rect x="66" y="55" width="4" height="30" fill="#333333" />
      {/* Laser tube internal marking */}
      <text x="30" y="74" fontSize="6" fill="#888888" fontFamily="var(--font-ibm-plex-sans), system-ui, sans-serif">He-Ne</text>
      {/* Laser aperture */}
      <rect x="70" y="66" width="3" height="8" fill="#333333" />

      {/* Red laser beam (#CC0000, solid 2px, no glow) */}
      <line x1="73" y1="70" x2="130" y2="70" stroke="#CC0000" strokeWidth="2" />
      <polygon points="126,66 130,70 126,74" fill="#CC0000" className="icon-modern-arrow" style={{ transition: 'transform 200ms ease-out' }} />

      {/* Lens (thin line frame) */}
      <path d="M130 45 Q138 70 130 95" stroke="#333333" strokeWidth="1.5" fill="none" />
      <path d="M140 45 Q132 70 140 95" stroke="#333333" strokeWidth="1.5" fill="none" />

      {/* Converging beam after lens */}
      <line x1="140" y1="70" x2="170" y2="70" stroke="#CC0000" strokeWidth="2" />
      <line x1="140" y1="55" x2="170" y2="67" stroke="#CC0000" strokeWidth="1.5" />
      <line x1="140" y1="85" x2="170" y2="73" stroke="#CC0000" strokeWidth="1.5" />

      {/* Focus point */}
      <circle cx="170" cy="70" r="2.5" fill="#CC0000" />

      {/* Fourier grid in background (very light) */}
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

      {/* Detector (black square) */}
      <rect x="180" y="62" width="12" height="16" fill="#333333" />
    </svg>
  )
}

/* ─── Card Data ─── */
const cards = [
  {
    id: 'geometric',
    title: '几何光学',
    description: '光线追迹、透镜成像、棱镜分光、光纤传光',
    icon: GeometricOpticsIcon,
  },
  {
    id: 'physical',
    title: '物理光学',
    description: '干涉、衍射、偏振、旋光、波前再现',
    icon: PhysicalOpticsIcon,
  },
  {
    id: 'modern',
    title: '现代光学',
    description: '激光传输、空间滤波、光纤模式、量子光学基础',
    icon: ModernOpticsIcon,
  },
]

/* ─── Main Page ─── */
export default function Home() {
  const [pressedCard, setPressedCard] = useState<string | null>(null)
  const [hoveredCard, setHoveredCard] = useState<string | null>(null)
  const [fadeOut, setFadeOut] = useState(false)

  const handleCardClick = useCallback((cardId: string) => {
    setFadeOut(true)
    // After fade-out, navigate to sub-module
    setTimeout(() => {
      // In production, navigate with router; for now, just reset
      // This is a placeholder for future sub-module routing
      console.log(`Navigating to ${cardId} module...`)
      setFadeOut(false)
    }, 300)
  }, [])

  return (
    <div
      className={`min-h-screen flex flex-col ${fadeOut ? 'page-fade-out' : ''}`}
      style={{ background: '#FFFFFF' }}
    >
      {/* ─── Header Bar ─── */}
      <header
        className="flex-shrink-0 flex items-center"
        style={{
          height: '48px',
          backgroundColor: '#FFFFFF',
          borderBottom: '1px solid #CCCCCC',
          paddingLeft: '24px',
        }}
      >
        <h1
          style={{
            fontFamily: 'var(--font-ibm-plex-sans), system-ui, sans-serif',
            fontSize: '20px',
            fontWeight: 600,
            color: '#1A1A1A',
            margin: 0,
            letterSpacing: '-0.01em',
          }}
        >
          光学仿真实验平台
        </h1>
      </header>

      {/* ─── Main Content with Dot Grid ─── */}
      <main
        className="flex-1 dot-grid flex items-center justify-center"
        style={{ padding: '40px 24px' }}
      >
        <div
          className="flex items-start justify-center gap-10 flex-wrap"
          style={{ maxWidth: '960px' }}
        >
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
                onMouseLeave={() => {
                  setHoveredCard(null)
                  setPressedCard(null)
                }}
                onMouseDown={() => setPressedCard(card.id)}
                onMouseUp={() => setPressedCard(null)}
                onClick={() => handleCardClick(card.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    handleCardClick(card.id)
                  }
                }}
                style={{
                  width: '280px',
                  height: '360px',
                  backgroundColor: isPressed ? '#E6E9EC' : isHovered ? '#F0F3F6' : '#FAFAFA',
                  border: `1px solid ${isHovered ? '#333333' : '#D0D0D0'}`,
                  borderRadius: '2px',
                  cursor: 'pointer',
                  transition: isPressed
                    ? 'transform 100ms ease-out, background-color 100ms ease-out, border-color 200ms ease-out'
                    : 'background-color 200ms ease-out, border-color 200ms ease-out',
                  transform: isPressed ? 'scale(0.97)' : 'scale(1)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  paddingTop: '40px',
                  userSelect: 'none',
                }}
              >
                {/* Icon Area */}
                <div
                  style={{
                    height: '160px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <IconComponent />
                </div>

                {/* Title */}
                <h2
                  style={{
                    fontFamily: 'var(--font-ibm-plex-sans), system-ui, sans-serif',
                    fontSize: '18px',
                    fontWeight: 600,
                    color: '#1A1A1A',
                    margin: '24px 0 0 0',
                    textAlign: 'center',
                  }}
                >
                  {card.title}
                </h2>

                {/* Description */}
                <p
                  style={{
                    fontFamily: 'var(--font-ibm-plex-sans), system-ui, sans-serif',
                    fontSize: '12px',
                    fontWeight: 400,
                    color: '#666666',
                    margin: '8px 0 0 0',
                    textAlign: 'center',
                    lineHeight: '1.6',
                    padding: '0 24px',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {card.description}
                </p>
              </div>
            )
          })}
        </div>
      </main>

      {/* ─── Footer Status Bar ─── */}
      <footer
        className="flex-shrink-0 flex items-center mt-auto"
        style={{
          height: '24px',
          backgroundColor: '#FFFFFF',
          borderTop: '1px solid #CCCCCC',
          paddingLeft: '24px',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-ibm-plex-sans), system-ui, sans-serif',
            fontSize: '10px',
            fontWeight: 400,
            color: '#888888',
          }}
          className="tabular-nums"
        >
          v1.0 · 高斯光束追踪 | 矢量衍射仿真 | 偏振琼斯分析
        </span>
      </footer>
    </div>
  )
}
