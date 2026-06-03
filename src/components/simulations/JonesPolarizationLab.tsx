'use client'

import { useState, useMemo, useCallback, useRef, useEffect } from 'react'

/* ─── Complex number utilities ─── */
interface Complex { re: number; im: number }
const c = (re: number, im: number = 0): Complex => ({ re, im })
const cMul = (a: Complex, b: Complex): Complex => ({
  re: a.re * b.re - a.im * b.im,
  im: a.re * b.im + a.im * b.re,
})
const cAdd = (a: Complex, b: Complex): Complex => ({
  re: a.re + b.re,
  im: a.im + b.im,
})
const cAbs2 = (a: Complex): number => a.re * a.re + a.im * a.im
const cArg = (a: Complex): number => Math.atan2(a.im, a.re)

/* ─── 2x2 Complex Matrix ─── */
interface Mat2x2 { a: Complex; b: Complex; c: Complex; d: Complex }
const matMul = (m1: Mat2x2, m2: Mat2x2): Mat2x2 => ({
  a: cAdd(cMul(m1.a, m2.a), cMul(m1.b, m2.c)),
  b: cAdd(cMul(m1.a, m2.b), cMul(m1.b, m2.d)),
  c: cAdd(cMul(m1.c, m2.a), cMul(m1.d, m2.c)),
  d: cAdd(cMul(m1.c, m2.b), cMul(m1.d, m2.d)),
})
const matVec = (m: Mat2x2, v: [Complex, Complex]): [Complex, Complex] => [
  cAdd(cMul(m.a, v[0]), cMul(m.b, v[1])),
  cAdd(cMul(m.c, v[0]), cMul(m.d, v[1])),
]
const identityMat = (): Mat2x2 => ({ a: c(1), b: c(0), c: c(0), d: c(1) })

/* ─── Element Types ─── */
type ElementType = 'polarizer' | 'halfwave' | 'quarterwave'

interface OpticalElement {
  id: string
  type: ElementType
  angle: number // degrees
}

const ELEMENT_LABELS: Record<ElementType, string> = {
  polarizer: '偏振片',
  halfwave: '半波片',
  quarterwave: '1/4波片',
}

/* ─── Jones Matrix for element at angle θ ─── */
function jonesMatrix(type: ElementType, angleDeg: number): Mat2x2 {
  const θ = (angleDeg * Math.PI) / 180
  const cosθ = Math.cos(θ)
  const sinθ = Math.sin(θ)

  // Rotation matrix R(θ)
  const R: Mat2x2 = { a: c(cosθ), b: c(sinθ), c: c(-sinθ), d: c(cosθ) }
  // Inverse rotation R(-θ)
  const Ri: Mat2x2 = { a: c(cosθ), b: c(-sinθ), c: c(sinθ), d: c(cosθ) }

  // Element matrix in its own frame
  let M: Mat2x2
  switch (type) {
    case 'polarizer':
      M = { a: c(1), b: c(0), c: c(0), d: c(0) }
      break
    case 'halfwave':
      M = { a: c(1), b: c(0), c: c(0), d: c(-1) }
      break
    case 'quarterwave':
      M = { a: c(1), b: c(0), c: c(0), d: c(0, -1) }
      break
    default:
      M = identityMat()
  }

  // R(-θ) * M * R(θ)
  return matMul(Ri, matMul(M, R))
}

/* ─── Stokes parameters from Jones vector ─── */
function jonesToStokes(jv: [Complex, Complex]): [number, number, number, number] {
  const Ex = jv[0]
  const Ey = jv[1]
  const S0 = cAbs2(Ex) + cAbs2(Ey)
  const S1 = cAbs2(Ex) - cAbs2(Ey)
  const S2 = 2 * (Ex.re * Ey.re + Ex.im * Ey.im)
  const S3 = 2 * (Ex.re * Ey.im - Ex.im * Ey.re)
  return [S0, S1, S2, S3]
}

/* ─── Polarization ellipse parameters ─── */
function polarizationEllipse(jv: [Complex, Complex]) {
  const [S0, S1, S2, S3] = jonesToStokes(jv)
  if (S0 < 1e-12) return { a: 0, b: 0, ψ: 0, χ: 0, handedness: 'right' as const, intensity: 0 }

  const DOP = Math.sqrt(S1 * S1 + S2 * S2 + S3 * S3) / S0
  const ψ = 0.5 * Math.atan2(S2, S1) // orientation angle
  const χ = 0.5 * Math.asin(Math.max(-1, Math.min(1, S3 / (S0 * DOP + 1e-15)))) // ellipticity angle
  const a = Math.sqrt(S0) * Math.sqrt(1 + Math.cos(2 * χ)) / Math.SQRT2
  const b = Math.sqrt(S0) * Math.sqrt(1 - Math.cos(2 * χ)) / Math.SQRT2
  const handedness: 'right' | 'left' = S3 > 0 ? 'right' : 'left'

  return { a, b, ψ, χ, handedness, intensity: S0 }
}

/* ─── Input polarization presets ─── */
type InputPreset = 'horizontal' | 'vertical' | '45deg' | 'circularR' | 'circularL'

const INPUT_PRESETS: Record<InputPreset, { label: string; jones: [Complex, Complex] }> = {
  horizontal: { label: '水平线偏振', jones: [c(1), c(0)] },
  vertical: { label: '垂直线偏振', jones: [c(0), c(1)] },
  '45deg': { label: '45°线偏振', jones: [c(1 / Math.SQRT2), c(1 / Math.SQRT2)] },
  circularR: { label: '右旋圆偏振', jones: [c(1 / Math.SQRT2), c(0, 1 / Math.SQRT2)] },
  circularL: { label: '左旋圆偏振', jones: [c(1 / Math.SQRT2), c(0, -1 / Math.SQRT2)] },
}

/* ─── Polarization Ellipse SVG ─── */
function PolarizationEllipseSVG({
  jonesVector,
  size,
  label,
  showGrid = true,
}: {
  jonesVector: [Complex, Complex]
  size: number
  label: string
  showGrid?: boolean
}) {
  const ellipse = useMemo(() => polarizationEllipse(jonesVector), [jonesVector])
  const center = size / 2
  const scale = (size / 2 - 16)
  const maxVal = Math.max(ellipse.a, 0.001)

  // Generate ellipse path points
  const ellipsePoints = useMemo(() => {
    if (ellipse.intensity < 1e-10) return ''
    const points: string[] = []
    const steps = 120
    const sign = ellipse.handedness === 'right' ? 1 : -1
    for (let i = 0; i <= steps; i++) {
      const t = (2 * Math.PI * i) / steps
      // Parametric polarization ellipse
      const Ex = ellipse.a * Math.cos(t)
      const Ey = ellipse.b * Math.cos(t + sign * Math.PI / 2)
      // Rotate by ψ
      const cosψ = Math.cos(ellipse.ψ)
      const sinψ = Math.sin(ellipse.ψ)
      const x = center + (Ex * cosψ - Ey * sinψ) / maxVal * scale
      const y = center - (Ex * sinψ + Ey * cosψ) / maxVal * scale
      points.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
    }
    return points.join(' ')
  }, [ellipse, center, scale, maxVal])

  // E-field vector arrows at several phases
  const vectors = useMemo(() => {
    if (ellipse.intensity < 1e-10) return []
    const result: { x1: number; y1: number; x2: number; y2: number }[] = []
    const sign = ellipse.handedness === 'right' ? 1 : -1
    const cosψ = Math.cos(ellipse.ψ)
    const sinψ = Math.sin(ellipse.ψ)
    for (let i = 0; i < 8; i++) {
      const t = (2 * Math.PI * i) / 8
      const Ex = ellipse.a * Math.cos(t)
      const Ey = ellipse.b * Math.cos(t + sign * Math.PI / 2)
      const x = (Ex * cosψ - Ey * sinψ) / maxVal * scale
      const y = -(Ex * sinψ + Ey * cosψ) / maxVal * scale
      result.push({ x1: center, y1: center, x2: center + x, y2: center + y })
    }
    return result
  }, [ellipse, center, scale, maxVal])

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Grid */}
      {showGrid && (
        <g>
          {[0.25, 0.5, 0.75].map((f) => (
            <g key={f}>
              <line x1={size * f} y1="8" x2={size * f} y2={size - 8} stroke="#E8ECF0" strokeWidth="0.5" />
              <line x1="8" y1={size * f} x2={size - 8} y2={size * f} stroke="#E8ECF0" strokeWidth="0.5" />
            </g>
          ))}
          {/* Axes */}
          <line x1={center} y1="8" x2={center} y2={size - 8} stroke="#CCCCCC" strokeWidth="0.8" />
          <line x1="8" y1={center} x2={size - 8} y2={center} stroke="#CCCCCC" strokeWidth="0.8" />
          {/* Axis labels */}
          <text x={size - 14} y={center - 4} fontSize="8" fill="#888888" fontFamily="var(--font-ibm-plex-sans), system-ui">Eₓ</text>
          <text x={center + 4} y={14} fontSize="8" fill="#888888" fontFamily="var(--font-ibm-plex-sans), system-ui">Eᵧ</text>
        </g>
      )}
      {/* E-field vectors */}
      {vectors.map((v, i) => (
        <line key={i} x1={v.x1} y1={v.y1} x2={v.x2} y2={v.y2}
          stroke="#1A1A1A" strokeWidth="0.6" opacity={0.3 + 0.15 * (i % 3)}
        />
      ))}
      {/* Polarization ellipse */}
      {ellipsePoints && (
        <path d={ellipsePoints} fill="none" stroke="#1A1A1A" strokeWidth="1.5" />
      )}
      {/* Label */}
      <text x={center} y={size - 2} textAnchor="middle" fontSize="9" fill="#555555"
        fontFamily="var(--font-ibm-plex-sans), system-ui, sans-serif"
      >
        {label}
      </text>
    </svg>
  )
}

/* ─── Element SVG Icon ─── */
function ElementIcon({ type, angle, size = 60 }: { type: ElementType; angle: number; size?: number }) {
  const cx = size / 2
  const cy = size / 2
  const r = size / 2 - 4

  // Hatch lines for wave plates
  const hatchLines = useMemo(() => {
    if (type === 'polarizer') return null
    const lines: JSX.Element[] = []
    const spacing = type === 'halfwave' ? 6 : 8
    for (let i = -r; i <= r; i += spacing) {
      const x1 = cx + i
      const y1 = cy - r
      const x2 = cx + i + r
      const y2 = cy
      // Clip to circle
      const dx = i
      if (Math.abs(dx) < r) {
        const halfH = Math.sqrt(r * r - dx * dx)
        lines.push(
          <line key={i} x1={cx + i} y1={cy - halfH * 0.6} x2={cx + i} y2={cy + halfH * 0.6}
            stroke="#333333" strokeWidth="0.5" opacity="0.4"
          />
        )
      }
    }
    return lines
  }, [type, cx, cy, r])

  // Transmission axis line for polarizer
  const axisAngle = (angle * Math.PI) / 180
  const axisLen = r - 2

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Circle outline */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#333333" strokeWidth="1.2" />
      {/* Hatch for wave plates */}
      {hatchLines}
      {/* Transmission axis for polarizer */}
      {type === 'polarizer' && (
        <line
          x1={cx - axisLen * Math.cos(axisAngle)}
          y1={cy - axisLen * Math.sin(axisAngle)}
          x2={cx + axisLen * Math.cos(axisAngle)}
          y2={cy + axisLen * Math.sin(axisAngle)}
          stroke="#1A1A1A" strokeWidth="1.5"
        />
      )}
      {/* Fast axis indicator for wave plates */}
      {type !== 'polarizer' && (
        <>
          <line
            x1={cx - axisLen * Math.cos(axisAngle)}
            y1={cy - axisLen * Math.sin(axisAngle)}
            x2={cx + axisLen * Math.cos(axisAngle)}
            y2={cy + axisLen * Math.sin(axisAngle)}
            stroke="#1A1A1A" strokeWidth="1" strokeDasharray="3,2"
          />
          {/* Slow axis perpendicular */}
          <line
            x1={cx - axisLen * Math.cos(axisAngle + Math.PI / 2)}
            y1={cy - axisLen * Math.sin(axisAngle + Math.PI / 2)}
            x2={cx + axisLen * Math.cos(axisAngle + Math.PI / 2)}
            y2={cy + axisLen * Math.sin(axisAngle + Math.PI / 2)}
            stroke="#888888" strokeWidth="0.6" strokeDasharray="1,2"
          />
        </>
      )}
    </svg>
  )
}

/* ─── Angle Dial ─── */
function AngleDial({ angle, onChange, size = 64 }: { angle: number; onChange: (a: number) => void; size?: number }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const dragging = useRef(false)

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging.current || !svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    let a = Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI
    a = Math.round(a)
    if (a < 0) a += 360
    onChange(a)
  }, [onChange])

  const handleMouseUp = useCallback(() => {
    dragging.current = false
    window.removeEventListener('mousemove', handleMouseMove)
    window.removeEventListener('mouseup', handleMouseUp)
  }, [handleMouseMove])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }, [handleMouseMove, handleMouseUp])

  const center = size / 2
  const r = size / 2 - 8
  const angleRad = (angle * Math.PI) / 180

  return (
    <svg ref={svgRef} width={size} height={size} viewBox={`0 0 ${size} ${size}`}
      onMouseDown={handleMouseDown} style={{ cursor: 'grab' }}
    >
      {/* Dial background */}
      <circle cx={center} cy={center} r={r} fill="#FAFAFA" stroke="#D0D0D0" strokeWidth="0.8" />
      {/* Tick marks */}
      {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
        const rad = (deg * Math.PI) / 180
        return (
          <line key={deg}
            x1={center + (r - 4) * Math.cos(rad)} y1={center + (r - 4) * Math.sin(rad)}
            x2={center + r * Math.cos(rad)} y2={center + r * Math.sin(rad)}
            stroke="#888888" strokeWidth="0.6"
          />
        )
      })}
      {/* Angle indicator line */}
      <line x1={center} y1={center}
        x2={center + (r - 6) * Math.cos(angleRad)}
        y2={center + (r - 6) * Math.sin(angleRad)}
        stroke="#1A1A1A" strokeWidth="1.5"
      />
      {/* Center dot */}
      <circle cx={center} cy={center} r="2" fill="#1A1A1A" />
      {/* Angle text */}
      <text x={center} y={size - 1} textAnchor="middle" fontSize="8" fill="#555555"
        fontFamily="var(--font-ibm-plex-sans), system-ui, sans-serif"
        className="tabular-nums"
      >
        {angle}°
      </text>
    </svg>
  )
}

/* ─── Main Component ─── */
export default function JonesPolarizationLab({ onBack }: { onBack: () => void }) {
  const [elements, setElements] = useState<OpticalElement[]>([
    { id: 'el-1', type: 'polarizer', angle: 0 },
    { id: 'el-2', type: 'quarterwave', angle: 45 },
  ])
  const [inputPreset, setInputPreset] = useState<InputPreset>('horizontal')
  const [inputAngle, setInputAngle] = useState(0)

  const inputJones = useMemo((): [Complex, Complex] => {
    const preset = INPUT_PRESETS[inputPreset]
    if (inputPreset === 'horizontal' || inputPreset === 'vertical' || inputPreset === '45deg') {
      // For linear, allow angle adjustment
      const θ = (inputAngle * Math.PI) / 180
      return [c(Math.cos(θ)), c(Math.sin(θ))]
    }
    return preset.jones
  }, [inputPreset, inputAngle])

  // Compute total Jones matrix
  const totalMatrix = useMemo(() => {
    let M = identityMat()
    for (const el of elements) {
      M = matMul(jonesMatrix(el.type, el.angle), M)
    }
    return M
  }, [elements])

  // Compute output Jones vector
  const outputJones = useMemo(() => matVec(totalMatrix, inputJones), [totalMatrix, inputJones])

  // Compute intermediate Jones vectors for each element
  const intermediates = useMemo(() => {
    const results: [Complex, Complex][] = [inputJones]
    let M = identityMat()
    let current = inputJones
    for (const el of elements) {
      M = matMul(jonesMatrix(el.type, el.angle), M)
      current = matVec(M, inputJones)
      results.push(current)
    }
    return results
  }, [elements, inputJones])

  // Stokes for input and output
  const stokesIn = useMemo(() => jonesToStokes(inputJones), [inputJones])
  const stokesOut = useMemo(() => jonesToStokes(outputJones), [outputJones])

  // Element management
  const addElement = useCallback((type: ElementType) => {
    setElements(prev => [...prev, {
      id: `el-${Date.now()}`,
      type,
      angle: 0,
    }])
  }, [])

  const removeElement = useCallback((id: string) => {
    setElements(prev => prev.filter(el => el.id !== id))
  }, [])

  const updateElement = useCallback((id: string, updates: Partial<OpticalElement>) => {
    setElements(prev => prev.map(el => el.id === id ? { ...el, ...updates } : el))
  }, [])

  // Inter-element distance for SVG beam path
  const elSpacing = 120

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#FFFFFF' }}>
      {/* Header */}
      <div className="flex-shrink-0 flex items-center" style={{
        height: '48px', backgroundColor: '#FFFFFF',
        borderBottom: '1px solid #CCCCCC', paddingLeft: '24px', paddingRight: '24px',
      }}>
        <button onClick={onBack} style={{
          fontFamily: 'var(--font-ibm-plex-sans), system-ui, sans-serif',
          fontSize: '12px', fontWeight: 400, color: '#555555',
          background: 'none', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: '4px',
          transition: 'color 200ms ease-out',
        }} onMouseEnter={e => (e.currentTarget.style.color = '#1A1A1A')}
           onMouseLeave={e => (e.currentTarget.style.color = '#555555')}>
          ← 返回
        </button>
        <span style={{ margin: '0 12px', color: '#D0D0D0' }}>|</span>
        <h1 style={{
          fontFamily: 'var(--font-ibm-plex-sans), system-ui, sans-serif',
          fontSize: '20px', fontWeight: 600, color: '#1A1A1A', margin: 0,
        }}>
          偏振琼斯矩阵实验室
        </h1>
      </div>

      {/* Main content */}
      <div className="flex flex-1" style={{ minHeight: 0 }}>
        {/* Left: Visualization area */}
        <div className="flex-1 dot-grid" style={{ display: 'flex', flexDirection: 'column', padding: '16px' }}>
          {/* Beam path with elements */}
          <div style={{
            flex: '1 1 auto', minHeight: 200, overflowX: 'auto',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width={Math.max(600, (elements.length + 2) * elSpacing)} height="180"
              viewBox={`0 0 ${Math.max(600, (elements.length + 2) * elSpacing)} 180`}
            >
              {/* Optical axis */}
              <line x1="20" y1="90" x2={Math.max(600, (elements.length + 2) * elSpacing) - 20} y2="90"
                stroke="#888888" strokeWidth="0.8" strokeDasharray="8,3,2,3" />

              {/* Source */}
              <g transform={`translate(40, 90)`}>
                <rect x="-12" y="-12" width="24" height="24" fill="none" stroke="#333333" strokeWidth="1" />
                <text x="0" y="3" textAnchor="middle" fontSize="7" fill="#555555"
                  fontFamily="var(--font-ibm-plex-sans), system-ui, sans-serif">SRC</text>
              </g>

              {/* Elements along beam */}
              {elements.map((el, idx) => {
                const x = 40 + (idx + 1) * elSpacing
                return (
                  <g key={el.id} transform={`translate(${x}, 90)`}>
                    {/* Element circle */}
                    <circle cx="0" cy="0" r="26" fill="none" stroke="#333333" strokeWidth="1.2" />
                    {/* Hatch lines for wave plates */}
                    {el.type !== 'polarizer' && Array.from({ length: 7 }, (_, i) => {
                      const dx = -18 + i * 6
                      const halfH = Math.sqrt(Math.max(0, 26 * 26 - dx * dx)) * 0.7
                      return halfH > 2 ? (
                        <line key={i} x1={dx} y1={-halfH} x2={dx} y2={halfH}
                          stroke="#333333" strokeWidth="0.5" opacity="0.35" />
                      ) : null
                    })}
                    {/* Transmission/fast axis */}
                    {(() => {
                      const aRad = (el.angle * Math.PI) / 180
                      const len = 22
                      return el.type === 'polarizer' ? (
                        <line x1={-len * Math.cos(aRad)} y1={-len * Math.sin(aRad)}
                          x2={len * Math.cos(aRad)} y2={len * Math.sin(aRad)}
                          stroke="#1A1A1A" strokeWidth="1.5" />
                      ) : (
                        <>
                          <line x1={-len * Math.cos(aRad)} y1={-len * Math.sin(aRad)}
                            x2={len * Math.cos(aRad)} y2={len * Math.sin(aRad)}
                            stroke="#1A1A1A" strokeWidth="1" strokeDasharray="3,2" />
                          <line x1={-len * Math.cos(aRad + Math.PI / 2)} y1={-len * Math.sin(aRad + Math.PI / 2)}
                            x2={len * Math.cos(aRad + Math.PI / 2)} y2={len * Math.sin(aRad + Math.PI / 2)}
                            stroke="#888888" strokeWidth="0.6" strokeDasharray="1,2" />
                        </>
                      )
                    })()}
                    {/* Label */}
                    <text x="0" y="42" textAnchor="middle" fontSize="9" fill="#555555"
                      fontFamily="var(--font-ibm-plex-sans), system-ui, sans-serif">
                      {ELEMENT_LABELS[el.type]}
                    </text>
                    <text x="0" y="52" textAnchor="middle" fontSize="8" fill="#888888"
                      fontFamily="var(--font-ibm-plex-sans), system-ui, sans-serif" className="tabular-nums">
                      {el.angle}°
                    </text>
                    {/* Intermediate ellipse */}
                    {(() => {
                      const intJ = intermediates[idx + 1]
                      const ell = polarizationEllipse(intJ)
                      if (ell.intensity < 1e-10) return null
                      const sc = 18
                      const pts: string[] = []
                      const steps = 60
                      const sign = ell.handedness === 'right' ? 1 : -1
                      const cosψ = Math.cos(ell.ψ)
                      const sinψ = Math.sin(ell.ψ)
                      const mx = Math.max(ell.a, 0.001)
                      for (let i = 0; i <= steps; i++) {
                        const t = (2 * Math.PI * i) / steps
                        const Ex = ell.a * Math.cos(t) / mx * sc
                        const Ey = ell.b * Math.cos(t + sign * Math.PI / 2) / mx * sc
                        const px = -70 + (Ex * cosψ - Ey * sinψ)
                        const py = -(Ex * sinψ + Ey * cosψ)
                        pts.push(`${i === 0 ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`)
                      }
                      return <path d={pts.join(' ')} fill="none" stroke="#1A1A1A" strokeWidth="0.8" opacity="0.5" />
                    })()}
                  </g>
                )
              })}

              {/* Detector */}
              {(() => {
                const x = 40 + (elements.length + 1) * elSpacing
                return (
                  <g transform={`translate(${x}, 90)`}>
                    <rect x="-8" y="-14" width="16" height="28" fill="#333333" />
                    <text x="0" y="28" textAnchor="middle" fontSize="8" fill="#888888"
                      fontFamily="var(--font-ibm-plex-sans), system-ui, sans-serif">DET</text>
                  </g>
                )
              })()}

              {/* Beam segments */}
              {[0, ...elements.map((_, i) => i + 1)].map((idx) => {
                const x1 = 40 + idx * elSpacing + (idx === 0 ? 14 : 28)
                const x2 = 40 + (idx + 1) * elSpacing - 28
                if (x2 <= x1) return null
                const intJ = intermediates[idx]
                const ell = polarizationEllipse(intJ)
                const opacity = Math.max(0.15, Math.min(1, ell.intensity))
                return (
                  <line key={`beam-${idx}`} x1={x1} y1="90" x2={x2} y2="90"
                    stroke="#CC0000" strokeWidth="2" opacity={opacity} />
                )
              })}
            </svg>
          </div>

          {/* Polarization ellipses comparison */}
          <div style={{
            display: 'flex', justifyContent: 'center', gap: '40px',
            padding: '16px 0', borderTop: '1px solid #E8ECF0',
          }}>
            <div>
              <PolarizationEllipseSVG jonesVector={inputJones} size={180} label="输入偏振态" />
            </div>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <svg width="40" height="24">
                <line x1="4" y1="12" x2="28" y2="12" stroke="#888888" strokeWidth="1" />
                <polygon points="28,8 36,12 28,16" fill="#888888" />
              </svg>
            </div>
            <div>
              <PolarizationEllipseSVG jonesVector={outputJones} size={180} label="输出偏振态" />
            </div>
          </div>
        </div>

        {/* Right: Control panel */}
        <div style={{
          width: '300px', flexShrink: 0, backgroundColor: '#FAFAFA',
          borderLeft: '1px solid #D0D0D0', overflowY: 'auto',
          padding: '16px',
        }}>
          {/* Input polarization */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{
              fontSize: '12px', fontWeight: 600, color: '#1A1A1A',
              fontFamily: 'var(--font-ibm-plex-sans), system-ui, sans-serif',
              marginBottom: '8px', paddingBottom: '6px',
              borderBottom: '1px solid #E8ECF0',
            }}>
              输入偏振态
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px' }}>
              {Object.entries(INPUT_PRESETS).map(([key, val]) => (
                <button key={key} onClick={() => setInputPreset(key as InputPreset)} style={{
                  fontSize: '10px', padding: '3px 8px', borderRadius: '2px',
                  border: `1px solid ${inputPreset === key ? '#333333' : '#D0D0D0'}`,
                  backgroundColor: inputPreset === key ? '#F0F3F6' : '#FFFFFF',
                  color: '#1A1A1A', cursor: 'pointer',
                  fontFamily: 'var(--font-ibm-plex-sans), system-ui, sans-serif',
                  transition: 'border-color 200ms ease-out, background-color 200ms ease-out',
                }}>
                  {val.label}
                </button>
              ))}
            </div>
            {(inputPreset === 'horizontal' || inputPreset === 'vertical' || inputPreset === '45deg') && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '10px', color: '#555555',
                  fontFamily: 'var(--font-ibm-plex-sans), system-ui, sans-serif' }}>偏振角</span>
                <input type="range" min="0" max="180" step="1" value={inputAngle}
                  onChange={e => setInputAngle(Number(e.target.value))}
                  style={{ flex: 1, accentColor: '#333333' }}
                />
                <span className="tabular-nums" style={{ fontSize: '10px', color: '#1A1A1A',
                  fontFamily: 'var(--font-ibm-plex-sans), system-ui, sans-serif', minWidth: '28px' }}>
                  {inputAngle}°
                </span>
              </div>
            )}
          </div>

          {/* Element chain */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{
              fontSize: '12px', fontWeight: 600, color: '#1A1A1A',
              fontFamily: 'var(--font-ibm-plex-sans), system-ui, sans-serif',
              marginBottom: '8px', paddingBottom: '6px',
              borderBottom: '1px solid #E8ECF0',
            }}>
              光学元件链
            </div>
            {elements.map((el, idx) => (
              <div key={el.id} style={{
                backgroundColor: '#FFFFFF', border: '1px solid #D0D0D0',
                borderRadius: '2px', padding: '8px', marginBottom: '6px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{
                      fontSize: '9px', color: '#888888',
                      fontFamily: 'var(--font-ibm-plex-sans), system-ui, sans-serif',
                    }}>
                      #{idx + 1}
                    </span>
                    <select value={el.type} onChange={e => updateElement(el.id, { type: e.target.value as ElementType })}
                      style={{
                        fontSize: '11px', padding: '2px 4px', border: '1px solid #D0D0D0',
                        borderRadius: '2px', backgroundColor: '#FFFFFF', color: '#1A1A1A',
                        fontFamily: 'var(--font-ibm-plex-sans), system-ui, sans-serif',
                      }}
                    >
                      <option value="polarizer">偏振片</option>
                      <option value="halfwave">半波片</option>
                      <option value="quarterwave">1/4波片</option>
                    </select>
                  </div>
                  <button onClick={() => removeElement(el.id)} style={{
                    fontSize: '10px', color: '#888888', background: 'none', border: 'none',
                    cursor: 'pointer', padding: '2px',
                    fontFamily: 'var(--font-ibm-plex-sans), system-ui, sans-serif',
                  }}>
                    ✕
                  </button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <AngleDial angle={el.angle} onChange={a => updateElement(el.id, { angle: a })} size={56} />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px' }}>
                      <span style={{ fontSize: '9px', color: '#555555',
                        fontFamily: 'var(--font-ibm-plex-sans), system-ui, sans-serif' }}>角度</span>
                      <input type="range" min="0" max="360" step="1" value={el.angle}
                        onChange={e => updateElement(el.id, { angle: Number(e.target.value) })}
                        style={{ flex: 1, accentColor: '#333333' }}
                      />
                      <span className="tabular-nums" style={{ fontSize: '9px', color: '#1A1A1A',
                        fontFamily: 'var(--font-ibm-plex-sans), system-ui, sans-serif', minWidth: '28px' }}>
                        {el.angle}°
                      </span>
                    </div>
                    {/* Intermediate polarization state */}
                    {(() => {
                      const intJ = intermediates[idx + 1]
                      const ell = polarizationEllipse(intJ)
                      return (
                        <div style={{ fontSize: '9px', color: '#888888',
                          fontFamily: 'var(--font-ibm-plex-sans), system-ui, sans-serif' }}>
                          I = {ell.intensity.toFixed(3)}
                          {ell.intensity > 0.001 && (
                            <> · ψ = {(ell.ψ * 180 / Math.PI).toFixed(1)}° · ε = {ell.handedness === 'right' ? '+' : '-'}{(Math.abs(ell.b / ell.a) * 100).toFixed(0)}%</>
                          )}
                        </div>
                      )
                    })()}
                  </div>
                </div>
              </div>
            ))}
            {/* Add element buttons */}
            <div style={{ display: 'flex', gap: '4px', marginTop: '8px' }}>
              {(['polarizer', 'halfwave', 'quarterwave'] as ElementType[]).map(type => (
                <button key={type} onClick={() => addElement(type)} style={{
                  fontSize: '10px', padding: '4px 10px', borderRadius: '2px',
                  border: '1px solid #D0D0D0', backgroundColor: '#FFFFFF',
                  color: '#555555', cursor: 'pointer',
                  fontFamily: 'var(--font-ibm-plex-sans), system-ui, sans-serif',
                  transition: 'border-color 200ms ease-out',
                }}
                onMouseEnter={e => e.currentTarget.style.borderColor = '#333333'}
                onMouseLeave={e => e.currentTarget.style.borderColor = '#D0D0D0'}
                >
                  + {ELEMENT_LABELS[type]}
                </button>
              ))}
            </div>
          </div>

          {/* Stokes Parameters */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{
              fontSize: '12px', fontWeight: 600, color: '#1A1A1A',
              fontFamily: 'var(--font-ibm-plex-sans), system-ui, sans-serif',
              marginBottom: '8px', paddingBottom: '6px',
              borderBottom: '1px solid #E8ECF0',
            }}>
              斯托克斯参数
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px',
              fontFamily: 'var(--font-ibm-plex-sans), system-ui, sans-serif' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '2px 6px', color: '#888888', fontWeight: 400, borderBottom: '1px solid #E8ECF0' }}></th>
                  <th style={{ textAlign: 'right', padding: '2px 6px', color: '#555555', fontWeight: 600, borderBottom: '1px solid #E8ECF0' }}>输入</th>
                  <th style={{ textAlign: 'right', padding: '2px 6px', color: '#555555', fontWeight: 600, borderBottom: '1px solid #E8ECF0' }}>输出</th>
                </tr>
              </thead>
              <tbody>
                {(['S₀', 'S₁', 'S₂', 'S₃'] as const).map((label, i) => (
                  <tr key={label}>
                    <td style={{ padding: '2px 6px', color: '#555555' }}>{label}</td>
                    <td className="tabular-nums" style={{ textAlign: 'right', padding: '2px 6px', color: '#1A1A1A' }}>
                      {stokesIn[i].toFixed(4)}
                    </td>
                    <td className="tabular-nums" style={{ textAlign: 'right', padding: '2px 6px', color: '#1A1A1A' }}>
                      {stokesOut[i].toFixed(4)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Jones Matrix Display */}
          <div>
            <div style={{
              fontSize: '12px', fontWeight: 600, color: '#1A1A1A',
              fontFamily: 'var(--font-ibm-plex-sans), system-ui, sans-serif',
              marginBottom: '8px', paddingBottom: '6px',
              borderBottom: '1px solid #E8ECF0',
            }}>
              总琼斯矩阵
            </div>
            <div style={{
              backgroundColor: '#FFFFFF', border: '1px solid #D0D0D0',
              borderRadius: '2px', padding: '8px', fontSize: '10px',
              fontFamily: 'var(--font-ibm-plex-sans), system-ui, sans-serif',
              className: 'tabular-nums',
            }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px' }}>
                <span className="tabular-nums" style={{ color: '#1A1A1A' }}>
                  {totalMatrix.a.re.toFixed(3)}{totalMatrix.a.im >= 0 ? '+' : ''}{totalMatrix.a.im.toFixed(3)}i
                </span>
                <span className="tabular-nums" style={{ color: '#1A1A1A' }}>
                  {totalMatrix.b.re.toFixed(3)}{totalMatrix.b.im >= 0 ? '+' : ''}{totalMatrix.b.im.toFixed(3)}i
                </span>
                <span className="tabular-nums" style={{ color: '#1A1A1A' }}>
                  {totalMatrix.c.re.toFixed(3)}{totalMatrix.c.im >= 0 ? '+' : ''}{totalMatrix.c.im.toFixed(3)}i
                </span>
                <span className="tabular-nums" style={{ color: '#1A1A1A' }}>
                  {totalMatrix.d.re.toFixed(3)}{totalMatrix.d.im >= 0 ? '+' : ''}{totalMatrix.d.im.toFixed(3)}i
                </span>
              </div>
            </div>
          </div>

          {/* Output polarization description */}
          <div style={{ marginTop: '12px' }}>
            <div style={{
              fontSize: '12px', fontWeight: 600, color: '#1A1A1A',
              fontFamily: 'var(--font-ibm-plex-sans), system-ui, sans-serif',
              marginBottom: '8px', paddingBottom: '6px',
              borderBottom: '1px solid #E8ECF0',
            }}>
              输出偏振态描述
            </div>
            {(() => {
              const ell = polarizationEllipse(outputJones)
              const psiDeg = (ell.ψ * 180 / Math.PI)
              const chiDeg = (ell.χ * 180 / Math.PI)
              let typeStr = '无光'
              if (ell.intensity > 0.001) {
                if (Math.abs(ell.b / ell.a) < 0.02) typeStr = '线偏振'
                else if (Math.abs(1 - Math.abs(ell.b / ell.a)) < 0.02) typeStr = `${ell.handedness === 'right' ? '右' : '左'}旋圆偏振`
                else typeStr = `${ell.handedness === 'right' ? '右' : '左'}旋椭圆偏振`
              }
              return (
                <div style={{ fontSize: '10px', color: '#555555',
                  fontFamily: 'var(--font-ibm-plex-sans), system-ui, sans-serif', lineHeight: '1.8' }}>
                  <div>类型: <span style={{ color: '#1A1A1A' }}>{typeStr}</span></div>
                  <div>光强: <span className="tabular-nums" style={{ color: '#1A1A1A' }}>{ell.intensity.toFixed(4)}</span></div>
                  {ell.intensity > 0.001 && (
                    <>
                      <div>方位角 ψ: <span className="tabular-nums" style={{ color: '#1A1A1A' }}>{psiDeg.toFixed(1)}°</span></div>
                      <div>椭圆率角 χ: <span className="tabular-nums" style={{ color: '#1A1A1A' }}>{chiDeg.toFixed(1)}°</span></div>
                      <div>半长轴 a: <span className="tabular-nums" style={{ color: '#1A1A1A' }}>{ell.a.toFixed(4)}</span></div>
                      <div>半短轴 b: <span className="tabular-nums" style={{ color: '#1A1A1A' }}>{ell.b.toFixed(4)}</span></div>
                    </>
                  )}
                </div>
              )
            })()}
          </div>
        </div>
      </div>
    </div>
  )
}
