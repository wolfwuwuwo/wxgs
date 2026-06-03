'use client'

import { useState, useMemo } from 'react'

/* ─── Gaussian Beam Physics ─── */
// Beam radius: w(z) = w0 * sqrt(1 + (z/zR)^2)
// Rayleigh range: zR = π * w0² / λ
// Radius of curvature: R(z) = z * (1 + (zR/z)^2)
// Gouy phase: ψ(z) = atan(z/zR)
// After thin lens f at position z_lens:
//   1/q2 = 1/q1 - 1/f where q = z + i*zR

interface LensElement {
  position: number // mm from start
  focalLength: number // mm, positive = converging
}

const FONT = 'var(--font-ibm-plex-sans), system-ui, sans-serif'

function computeBeamProfile(
  w0: number, // beam waist radius in μm
  wavelength: number, // nm
  totalLength: number, // mm
  lenses: LensElement[],
  resolution: number
) {
  const lambda = wavelength * 1e-6 // convert nm to mm
  const w0mm = w0 * 1e-3 // convert μm to mm
  const zR = Math.PI * w0mm * w0mm / lambda // Rayleigh range in mm

  const points: { z: number; w: number; R: number; psi: number }[] = []

  // Sort lenses by position
  const sortedLenses = [...lenses].sort((a, b) => a.position - b.position)

  // Compute beam through each segment
  let currentW0 = w0mm
  let currentZR = zR
  let waistPosition = 0 // position of current waist

  for (let i = 0; i < resolution; i++) {
    const z = (i / (resolution - 1)) * totalLength

    // Find which lens segment we're in
    let segmentW0 = currentW0
    let segmentZR = currentZR
    let segmentWaistPos = waistPosition

    for (const lens of sortedLenses) {
      if (z >= lens.position) {
        // Apply thin lens transformation up to this lens
        // Distance from current waist to lens
        const d = lens.position - segmentWaistPos
        // Beam q-parameter at lens
        const q_re = d
        const q_im = segmentZR
        // After thin lens: 1/q' = 1/q - 1/f
        // q' = q / (1 - q/f) = q*f / (f - q)
        const denom_re = lens.focalLength - q_re
        const denom_im = -q_im
        // q' = (q_re + i*q_im) * f / (denom_re + i*denom_im)
        const denom2 = denom_re * denom_re + denom_im * denom_im
        const newQ_re = (q_re * lens.focalLength * denom_re + q_im * lens.focalLength * denom_im) / denom2
        const newQ_im = (q_im * lens.focalLength * denom_re - q_re * lens.focalLength * denom_im) / denom2
        // New waist position is at position where Re(q') = 0 → newWaistPos = -newQ_re + lens.position
        segmentWaistPos = lens.position - newQ_re
        segmentZR = Math.abs(newQ_im)
        segmentW0 = Math.sqrt(segmentZR * lambda / Math.PI)
      }
    }

    // Distance from current effective waist
    const dz = z - segmentWaistPos
    const w = segmentW0 * Math.sqrt(1 + (dz / segmentZR) ** 2)
    const R = dz === 0 ? Infinity : dz * (1 + (segmentZR / dz) ** 2)
    const psi = Math.atan2(dz, segmentZR)

    points.push({ z, w: w * 1e3, R, psi }) // w in μm
  }

  return { points, zR: zR, w0mm }
}

/* ─── Main Component ─── */
export default function GaussianBeamTracer({ onBack }: { onBack: () => void }) {
  const [waistRadius, setWaistRadius] = useState(50) // μm
  const [wavelength, setWavelength] = useState(632.8) // nm
  const [totalLength, setTotalLength] = useState(500) // mm
  const [lensFocalLength, setLensFocalLength] = useState(100) // mm
  const [lensPosition, setLensPosition] = useState(200) // mm
  const [numLenses, setNumLenses] = useState(1)
  const [spotDisplayPos, setSpotDisplayPos] = useState(250) // mm

  const lenses = useMemo((): LensElement[] => {
    if (numLenses === 0) return []
    if (numLenses === 1) return [{ position: lensPosition, focalLength: lensFocalLength }]
    // Two lenses: second at position + separation
    return [
      { position: lensPosition, focalLength: lensFocalLength },
      { position: lensPosition + 150, focalLength: lensFocalLength * 0.8 },
    ]
  }, [numLenses, lensPosition, lensFocalLength])

  const resolution = 500
  const profile = useMemo(() =>
    computeBeamProfile(waistRadius, wavelength, totalLength, lenses, resolution),
    [waistRadius, wavelength, totalLength, lenses, resolution]
  )

  // Find beam radius at spot display position
  const spotRadius = useMemo(() => {
    const idx = Math.round((spotDisplayPos / totalLength) * (resolution - 1))
    const clampedIdx = Math.max(0, Math.min(resolution - 1, idx))
    return profile.points[clampedIdx]?.w ?? waistRadius
  }, [spotDisplayPos, totalLength, profile, waistRadius])

  // Beam profile SVG dimensions
  const svgW = 640
  const svgH = 200
  const padX = 40
  const padY = 20
  const plotW = svgW - padX * 2
  const plotH = svgH - padY * 2

  // Max beam radius for scaling
  const maxW = Math.max(...profile.points.map(p => p.w), 1)

  // Generate envelope path
  const upperPath = profile.points.map((p, i) => {
    const x = padX + (p.z / totalLength) * plotW
    const y = padY + plotH / 2 - (p.w / maxW) * (plotH / 2 - 5)
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')

  const lowerPath = profile.points.map((p, i) => {
    const x = padX + (p.z / totalLength) * plotW
    const y = padY + plotH / 2 + (p.w / maxW) * (plotH / 2 - 5)
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')

  // Spot display SVG
  const spotSvgSize = 120
  const spotScale = 50 / Math.max(spotRadius, 1) // fit spot in 50px radius view

  // Wavelength color
  const beamColor = wavelength < 500 ? '#4050B0' : wavelength < 580 ? '#00AA44' : '#CC0000'

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#FFFFFF' }}>
      {/* Header */}
      <div className="flex-shrink-0 flex items-center" style={{
        height: '48px', backgroundColor: '#FFFFFF',
        borderBottom: '1px solid #CCCCCC', paddingLeft: '24px', paddingRight: '24px',
      }}>
        <button onClick={onBack} style={{
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
          高斯光束追踪器
        </h1>
      </div>

      <div className="flex flex-1" style={{ minHeight: 0 }}>
        {/* Left: Visualization */}
        <div className="flex-1 dot-grid" style={{
          display: 'flex', flexDirection: 'column', padding: '16px',
          alignItems: 'center', justifyContent: 'center', gap: '20px',
          overflowY: 'auto',
        }}>
          {/* Beam envelope profile */}
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#1A1A1A', fontFamily: FONT, marginBottom: '8px' }}>
              光束宽度包络曲线 w(z)
            </div>
            <svg width={svgW} height={svgH} style={{ border: '1px solid #D0D0D0', backgroundColor: '#FFFFFF' }}>
              {/* Grid */}
              {[0.25, 0.5, 0.75].map(f => (
                <g key={f}>
                  <line x1={padX} y1={padY + plotH * f} x2={svgW - padX} y2={padY + plotH * f}
                    stroke="#E8ECF0" strokeWidth="0.5" />
                  <line x1={padX + plotW * f} y1={padY} x2={padX + plotW * f} y2={padY + plotH}
                    stroke="#E8ECF0" strokeWidth="0.5" />
                </g>
              ))}
              {/* Optical axis */}
              <line x1={padX} y1={padY + plotH / 2} x2={svgW - padX} y2={padY + plotH / 2}
                stroke="#888888" strokeWidth="0.6" strokeDasharray="6,3,2,3" />
              {/* Beam envelope fill */}
              <path d={`${upperPath} L${padX + plotW},${padY + plotH / 2} L${padX},${padY + plotH / 2} Z`}
                fill={beamColor} opacity="0.06" />
              {/* Upper envelope */}
              <path d={upperPath} fill="none" stroke={beamColor} strokeWidth="1.5" />
              {/* Lower envelope */}
              <path d={lowerPath} fill="none" stroke={beamColor} strokeWidth="1.5" />
              {/* Lens positions */}
              {lenses.map((lens, i) => {
                const x = padX + (lens.position / totalLength) * plotW
                return (
                  <g key={i}>
                    <line x1={x} y1={padY} x2={x} y2={padY + plotH}
                      stroke="#333333" strokeWidth="1" strokeDasharray="3,3" />
                    {/* Lens symbol */}
                    <path d={`M${x} ${padY + plotH * 0.2} Q${x + 4} ${padY + plotH / 2} ${x} ${padY + plotH * 0.8}`}
                      stroke="#333333" strokeWidth="1.2" fill="none" />
                    <path d={`M${x} ${padY + plotH * 0.2} Q${x - 4} ${padY + plotH / 2} ${x} ${padY + plotH * 0.8}`}
                      stroke="#333333" strokeWidth="1.2" fill="none" />
                    <text x={x} y={padY + plotH + 14} textAnchor="middle" fontSize="8" fill="#555555" fontFamily={FONT} className="tabular-nums">
                      f={lens.focalLength}mm
                    </text>
                  </g>
                )
              })}
              {/* Spot display position indicator */}
              {(() => {
                const x = padX + (spotDisplayPos / totalLength) * plotW
                return (
                  <line x1={x} y1={padY} x2={x} y2={padY + plotH}
                    stroke="#888888" strokeWidth="0.5" strokeDasharray="2,4" />
                )
              })()}
              {/* Axes */}
              <line x1={padX} y1={padY + plotH} x2={svgW - padX} y2={padY + plotH}
                stroke="#888888" strokeWidth="0.8" />
              <line x1={padX} y1={padY} x2={padX} y2={padY + plotH}
                stroke="#888888" strokeWidth="0.8" />
              {/* Labels */}
              <text x={svgW / 2} y={svgH - 2} textAnchor="middle" fontSize="8" fill="#555555" fontFamily={FONT}>z (mm)</text>
              <text x={8} y={svgH / 2} textAnchor="middle" fontSize="8" fill="#555555" fontFamily={FONT}
                transform={`rotate(-90, 8, ${svgH / 2})`}>w (μm)</text>
              {/* Scale labels */}
              <text x={padX} y={svgH - 8} textAnchor="middle" fontSize="6" fill="#888888" fontFamily={FONT} className="tabular-nums">0</text>
              <text x={svgW - padX} y={svgH - 8} textAnchor="middle" fontSize="6" fill="#888888" fontFamily={FONT} className="tabular-nums">{totalLength}</text>
              <text x={padX - 4} y={padY + plotH / 2 - 2} textAnchor="end" fontSize="6" fill="#888888" fontFamily={FONT} className="tabular-nums">0</text>
              <text x={padX - 4} y={padY + 6} textAnchor="end" fontSize="6" fill="#888888" fontFamily={FONT} className="tabular-nums">{maxW.toFixed(0)}</text>
            </svg>
          </div>

          {/* Spot display and info */}
          <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start', flexWrap: 'wrap', justifyContent: 'center' }}>
            {/* Spot visualization */}
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#1A1A1A', fontFamily: FONT, marginBottom: '8px' }}>
                截面光斑 (z={spotDisplayPos}mm)
              </div>
              <svg width={spotSvgSize} height={spotSvgSize} style={{ border: '1px solid #D0D0D0', backgroundColor: '#FFFFFF' }}>
                {/* Grid circles */}
                <circle cx={spotSvgSize / 2} cy={spotSvgSize / 2} r={20} fill="none" stroke="#E8ECF0" strokeWidth="0.5" />
                <circle cx={spotSvgSize / 2} cy={spotSvgSize / 2} r={40} fill="none" stroke="#E8ECF0" strokeWidth="0.5" />
                {/* Cross-hair */}
                <line x1={spotSvgSize / 2} y1="5" x2={spotSvgSize / 2} y2={spotSvgSize - 5} stroke="#E8ECF0" strokeWidth="0.5" />
                <line x1="5" y1={spotSvgSize / 2} x2={spotSvgSize - 5} y2={spotSvgSize / 2} stroke="#E8ECF0" strokeWidth="0.5" />
                {/* Gaussian intensity profile as filled circle */}
                {(() => {
                  const r = Math.min(50, Math.max(2, spotRadius * spotScale))
                  return (
                    <>
                      <circle cx={spotSvgSize / 2} cy={spotSvgSize / 2} r={r}
                        fill={beamColor} opacity="0.15" />
                      <circle cx={spotSvgSize / 2} cy={spotSvgSize / 2} r={r}
                        fill="none" stroke={beamColor} strokeWidth="1.5" />
                      {/* 1/e² radius markers */}
                      <line x1={spotSvgSize / 2 - r} y1={spotSvgSize / 2}
                        x2={spotSvgSize / 2 + r} y2={spotSvgSize / 2}
                        stroke="#555555" strokeWidth="0.5" strokeDasharray="2,2" />
                    </>
                  )
                })()}
                {/* Scale label */}
                <text x={spotSvgSize - 4} y={spotSvgSize - 4} textAnchor="end" fontSize="6" fill="#888888" fontFamily={FONT} className="tabular-nums">
                  w={spotRadius.toFixed(1)}μm
                </text>
              </svg>
            </div>

            {/* Beam parameters */}
            <div style={{
              backgroundColor: '#FAFAFA', border: '1px solid #D0D0D0',
              borderRadius: '2px', padding: '12px', minWidth: '200px',
            }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#1A1A1A', fontFamily: FONT, marginBottom: '8px', paddingBottom: '6px', borderBottom: '1px solid #E8ECF0' }}>
                光束参数
              </div>
              <div style={{ fontSize: '10px', fontFamily: FONT, lineHeight: '2' }}>
                <div style={{ color: '#555555' }}>束腰半径 w₀: <span className="tabular-nums" style={{ color: '#1A1A1A', fontWeight: 600 }}>{waistRadius} μm</span></div>
                <div style={{ color: '#555555' }}>瑞利长度 zR: <span className="tabular-nums" style={{ color: '#1A1A1A', fontWeight: 600 }}>{(profile.zR * 1e3).toFixed(2)} μm</span></div>
                <div style={{ color: '#555555' }}>远场发散角 θ: <span className="tabular-nums" style={{ color: '#1A1A1A', fontWeight: 600 }}>{(wavelength / (Math.PI * waistRadius) * 1e3).toFixed(3)} mrad</span></div>
                <div style={{ color: '#555555' }}>光斑半径 (z={spotDisplayPos}mm): <span className="tabular-nums" style={{ color: '#1A1A1A', fontWeight: 600 }}>{spotRadius.toFixed(1)} μm</span></div>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Control panel */}
        <div style={{
          width: '280px', flexShrink: 0, backgroundColor: '#FAFAFA',
          borderLeft: '1px solid #D0D0D0', overflowY: 'auto', padding: '16px',
          className: 'custom-scrollbar',
        }}>
          {/* Beam parameters */}
          <div style={{ marginBottom: '16px' }}>
            <SectionTitle>光束参数</SectionTitle>
            <ParamSlider label="束腰半径 w₀" value={waistRadius} min={10} max={200} step={1} unit="μm"
              onChange={setWaistRadius} />
            <ParamSlider label="波长 λ" value={wavelength} min={400} max={700} step={0.1} unit="nm"
              onChange={setWavelength} />
            <ParamSlider label="传输距离" value={totalLength} min={100} max={1000} step={10} unit="mm"
              onChange={setTotalLength} />
          </div>

          {/* Lens configuration */}
          <div style={{ marginBottom: '16px' }}>
            <SectionTitle>透镜系统</SectionTitle>
            <div style={{ display: 'flex', gap: '4px', marginBottom: '8px' }}>
              {([0, 1, 2] as const).map(n => (
                <button key={n} onClick={() => setNumLenses(n)} style={{
                  fontSize: '10px', padding: '3px 8px', borderRadius: '2px',
                  border: `1px solid ${numLenses === n ? '#333333' : '#D0D0D0'}`,
                  backgroundColor: numLenses === n ? '#F0F3F6' : '#FFFFFF',
                  color: '#1A1A1A', cursor: 'pointer', fontFamily: FONT,
                  transition: 'border-color 200ms ease-out',
                }}>
                  {n === 0 ? '无透镜' : n === 1 ? '单透镜' : '双透镜'}
                </button>
              ))}
            </div>
            {numLenses >= 1 && (
              <>
                <ParamSlider label="透镜位置" value={lensPosition} min={50} max={totalLength - 50} step={5} unit="mm"
                  onChange={setLensPosition} />
                <ParamSlider label="焦距 f" value={lensFocalLength} min={20} max={300} step={1} unit="mm"
                  onChange={setLensFocalLength} />
              </>
            )}
          </div>

          {/* Spot display position */}
          <div style={{ marginBottom: '16px' }}>
            <SectionTitle>光斑观测位置</SectionTitle>
            <ParamSlider label="观测点 z" value={spotDisplayPos} min={0} max={totalLength} step={5} unit="mm"
              onChange={setSpotDisplayPos} />
          </div>

          {/* Wavelength color indicator */}
          <div style={{ marginBottom: '16px' }}>
            <SectionTitle>波长指示</SectionTitle>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{
                width: '24px', height: '24px', borderRadius: '2px',
                backgroundColor: beamColor, border: '1px solid #D0D0D0',
              }} />
              <div style={{ fontSize: '10px', fontFamily: FONT }}>
                <div style={{ color: '#1A1A1A' }}>
                  {wavelength < 500 ? '蓝紫光' : wavelength < 580 ? '绿光' : '红光'}
                </div>
                <div className="tabular-nums" style={{ color: '#888888' }}>λ = {wavelength} nm</div>
              </div>
            </div>
          </div>

          {/* Equations */}
          <div>
            <SectionTitle>高斯光束公式</SectionTitle>
            <div style={{
              fontSize: '9px', color: '#888888', fontFamily: FONT, lineHeight: '1.8',
              backgroundColor: '#FFFFFF', border: '1px solid #D0D0D0',
              borderRadius: '2px', padding: '8px',
            }}>
              <div>w(z) = w₀√(1 + (z/zR)²)</div>
              <div>zR = πw₀²/λ</div>
              <div>θ = λ/(πw₀)</div>
              <div>1/q&apos; = 1/q - 1/f</div>
              <div style={{ marginTop: '4px', borderTop: '1px solid #E8ECF0', paddingTop: '4px' }}>
                q = z + izR (复束参量)
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: '12px', fontWeight: 600, color: '#1A1A1A',
      fontFamily: FONT, marginBottom: '8px', paddingBottom: '6px',
      borderBottom: '1px solid #E8ECF0',
    }}>
      {children}
    </div>
  )
}

function ParamSlider({ label, value, min, max, step, unit, onChange }: {
  label: string; value: number; min: number; max: number; step: number; unit?: string
  onChange: (v: number) => void
}) {
  return (
    <div style={{ marginBottom: '8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
        <span style={{ fontSize: '10px', color: '#555555', fontFamily: FONT }}>{label}</span>
        <span className="tabular-nums" style={{ fontSize: '10px', color: '#1A1A1A', fontFamily: FONT }}>
          {typeof step === 'number' && step < 1 ? value.toFixed(1) : value}{unit || ''}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: '#333333' }}
      />
    </div>
  )
}
