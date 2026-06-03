'use client'

import { useState, useMemo, useCallback } from 'react'

/* ─── Physics Constants ─── */
interface SamplePreset {
  name: string
  specificRotation: number // °/(dm·g/mL)
  concentration: number   // g/mL
  tubeLength: number      // dm
  color: string           // display color
}

const SAMPLE_PRESETS: SamplePreset[] = [
  { name: '葡萄糖', specificRotation: 52.7, concentration: 0.1, tubeLength: 2, color: '#F0E8D0' },
  { name: '蔗糖', specificRotation: 66.5, concentration: 0.1, tubeLength: 2, color: '#F0E8D0' },
  { name: '果糖', specificRotation: -92.4, concentration: 0.1, tubeLength: 2, color: '#F0E8D0' },
  { name: '酒石酸', specificRotation: 14.0, concentration: 0.1, tubeLength: 2, color: '#F0ECD8' },
  { name: '自定义', specificRotation: 0, concentration: 0.1, tubeLength: 2, color: '#F0F0F0' },
]

/* ─── Wavelength options ─── */
const WAVELENGTHS = [
  { label: 'Na D线 589.3nm', value: 589.3, color: '#FFB800' },
  { label: 'Hg绿 546.1nm', value: 546.1, color: '#00AA44' },
  { label: 'He-Ne 632.8nm', value: 632.8, color: '#CC0000' },
]

const FONT = 'var(--font-ibm-plex-sans), system-ui, sans-serif'

/* ─── Main Component ─── */
export default function PolarimeterExperiment({ onBack }: { onBack: () => void }) {
  const [analyzerAngle, setAnalyzerAngle] = useState(90) // degrees from polarizer axis
  const [sampleInserted, setSampleInserted] = useState(false)
  const [selectedPreset, setSelectedPreset] = useState(0)
  const [customSpecRotation, setCustomSpecRotation] = useState(0)
  const [customConcentration, setCustomConcentration] = useState(0.1)
  const [customTubeLength, setCustomTubeLength] = useState(2)
  const [wavelengthIdx, setWavelengthIdx] = useState(0)
  const [zeroAngle, setZeroAngle] = useState<number | null>(null) // recorded zero position
  const [measurementAngle, setMeasurementAngle] = useState<number | null>(null) // recorded measurement position

  // Current sample parameters
  const sample = useMemo(() => {
    if (selectedPreset < SAMPLE_PRESETS.length - 1) {
      return SAMPLE_PRESETS[selectedPreset]
    }
    return {
      name: '自定义',
      specificRotation: customSpecRotation,
      concentration: customConcentration,
      tubeLength: customTubeLength,
      color: '#F0F0F0',
    }
  }, [selectedPreset, customSpecRotation, customConcentration, customTubeLength])

  // Optical rotation angle α = [α]λ^t × l × c
  const rotationAngle = useMemo(() => {
    if (!sampleInserted) return 0
    return sample.specificRotation * sample.tubeLength * sample.concentration
  }, [sampleInserted, sample])

  // Light intensity: Malus's law I = I0 * cos²(θ - α)
  // θ is analyzer angle, α is rotation angle from sample
  // With crossed polarizers (zero at 90°), the intensity is cos²(θ - α)
  const intensity = useMemo(() => {
    const effectiveAngle = analyzerAngle - rotationAngle
    const rad = (effectiveAngle * Math.PI) / 180
    return Math.cos(rad) ** 2
  }, [analyzerAngle, rotationAngle])

  // Specific rotation calculation from measurement
  const calculatedRotation = useMemo(() => {
    if (zeroAngle === null || measurementAngle === null) return null
    const alpha = measurementAngle - zeroAngle
    if (sample.tubeLength === 0 || sample.concentration === 0) return null
    const specRot = alpha / (sample.tubeLength * sample.concentration)
    return { alpha, specRot }
  }, [zeroAngle, measurementAngle, sample])

  // Generate I-θ curve data
  const curveData = useMemo(() => {
    const points: { angle: number; intensity: number }[] = []
    for (let θ = 0; θ <= 360; θ += 1) {
      const effectiveAngle = θ - rotationAngle
      const rad = (effectiveAngle * Math.PI) / 180
      points.push({ angle: θ, intensity: Math.cos(rad) ** 2 })
    }
    return points
  }, [rotationAngle])

  // Find extinction angle (where I ≈ 0)
  const extinctionAngle = useMemo(() => {
    // cos²(θ - α) = 0 when θ - α = 90° or 270°
    const angles = []
    for (const offset of [90, 270]) {
      let a = rotationAngle + offset
      while (a > 360) a -= 360
      while (a < 0) a += 360
      angles.push(Math.round(a * 10) / 10)
    }
    return angles
  }, [rotationAngle])

  const handleRecordZero = useCallback(() => {
    setZeroAngle(analyzerAngle)
  }, [analyzerAngle])

  const handleRecordMeasurement = useCallback(() => {
    setMeasurementAngle(analyzerAngle)
  }, [analyzerAngle])

  const handleReset = useCallback(() => {
    setZeroAngle(null)
    setMeasurementAngle(null)
  }, [])

  // SVG dimensions for the I-θ curve
  const curveW = 520
  const curveH = 140
  const pad = 28

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
          旋光仪实验
        </h1>
      </div>

      <div className="flex flex-1" style={{ minHeight: 0 }}>
        {/* Left: Visualization */}
        <div className="flex-1 dot-grid" style={{
          display: 'flex', flexDirection: 'column', padding: '16px', overflowY: 'auto',
        }}>
          {/* Optical path SVG */}
          <div style={{ textAlign: 'center', marginBottom: '16px' }}>
            <svg width="700" height="120" viewBox="0 0 700 120" style={{ maxWidth: '100%' }}>
              {/* Optical axis */}
              <line x1="20" y1="60" x2="680" y2="60" stroke="#888888" strokeWidth="0.6" strokeDasharray="6,3,2,3" />

              {/* Na lamp source */}
              <g transform="translate(50, 60)">
                <rect x="-16" y="-20" width="32" height="40" fill="none" stroke="#333333" strokeWidth="1.2" rx="2" />
                <text x="0" y="4" textAnchor="middle" fontSize="7" fill="#888888" fontFamily={FONT}>Na</text>
                <text x="0" y="32" textAnchor="middle" fontSize="7" fill="#555555" fontFamily={FONT}>光源</text>
              </g>

              {/* Lens group */}
              <g transform="translate(130, 60)">
                <path d="M-4 -18 Q0 0 -4 18" stroke="#333333" strokeWidth="1.2" fill="none" />
                <path d="M4 -18 Q0 0 4 18" stroke="#333333" strokeWidth="1.2" fill="none" />
                <text x="0" y="32" textAnchor="middle" fontSize="7" fill="#555555" fontFamily={FONT}>透镜组</text>
              </g>

              {/* Fixed polarizer (起偏器) */}
              <g transform="translate(220, 60)">
                <circle cx="0" cy="0" r="22" fill="none" stroke="#333333" strokeWidth="1.2" />
                <line x1="-18" y1="0" x2="18" y2="0" stroke="#1A1A1A" strokeWidth="1.5" />
                <text x="0" y="36" textAnchor="middle" fontSize="7" fill="#555555" fontFamily={FONT}>起偏器</text>
                <text x="0" y="45" textAnchor="middle" fontSize="6" fill="#888888" fontFamily={FONT}>0°固定</text>
              </g>

              {/* Light beam after polarizer */}
              <line x1="242" y1="60" x2="350" y2="60" stroke={WAVELENGTHS[wavelengthIdx].color} strokeWidth="2" />

              {/* Sample tube */}
              <g transform="translate(400, 60)">
                {/* Tube outline */}
                <rect x="-50" y="-16" width="100" height="32" fill={sampleInserted ? sample.color : 'none'}
                  fillOpacity={sampleInserted ? 0.1 : 0} stroke="#333333" strokeWidth="1.2" rx="4" />
                {/* Cylinder lines for 3D effect */}
                <line x1="-50" y1="-12" x2="-50" y2="12" stroke="#333333" strokeWidth="0.6" strokeDasharray="2,2" />
                <line x1="50" y1="-12" x2="50" y2="12" stroke="#333333" strokeWidth="0.6" strokeDasharray="2,2" />
                <ellipse cx="-50" cy="0" rx="4" ry="12" fill="none" stroke="#333333" strokeWidth="0.8" />
                <ellipse cx="50" cy="0" rx="4" ry="12" fill="none" stroke="#333333" strokeWidth="0.8" />
                {sampleInserted && (
                  <text x="0" y="3" textAnchor="middle" fontSize="7" fill="#555555" fontFamily={FONT}>{sample.name}</text>
                )}
                <text x="0" y="36" textAnchor="middle" fontSize="7" fill="#555555" fontFamily={FONT}>
                  {sampleInserted ? '样品管' : '（空）'}
                </text>
              </g>

              {/* Light beam after sample */}
              <line x1="450" y1="60" x2="530" y2="60"
                stroke={WAVELENGTHS[wavelengthIdx].color}
                strokeWidth="2"
                opacity={sampleInserted ? 0.7 : 1}
              />

              {/* Analyzer (检偏器) with rotation */}
              <g transform="translate(560, 60)">
                <circle cx="0" cy="0" r="22" fill="none" stroke="#333333" strokeWidth="1.2" />
                {/* Transmission axis at analyzerAngle */}
                {(() => {
                  const aRad = (analyzerAngle * Math.PI) / 180
                  return (
                    <line x1={-18 * Math.cos(aRad)} y1={-18 * Math.sin(aRad)}
                      x2={18 * Math.cos(aRad)} y2={18 * Math.sin(aRad)}
                      stroke="#1A1A1A" strokeWidth="1.5" />
                  )
                })()}
                {/* Vernier tick */}
                <circle cx="0" cy="-26" r="1.5" fill="#1A1A1A" />
                <text x="0" y="36" textAnchor="middle" fontSize="7" fill="#555555" fontFamily={FONT}>检偏器</text>
                <text x="0" y="45" textAnchor="middle" fontSize="6" fill="#888888" className="tabular-nums" fontFamily={FONT}>{analyzerAngle}°</text>
              </g>

              {/* Light beam after analyzer */}
              {intensity > 0.01 && (
                <line x1="582" y1="60" x2="660" y2="60"
                  stroke={WAVELENGTHS[wavelengthIdx].color}
                  strokeWidth="2" opacity={intensity}
                />
              )}

              {/* Detector */}
              <g transform="translate(670, 60)">
                <rect x="-8" y="-14" width="16" height="28" fill="#333333" />
                <text x="0" y="26" textAnchor="middle" fontSize="7" fill="#555555" fontFamily={FONT}>探测</text>
              </g>
            </svg>
          </div>

          {/* Analyzer dial with vernier */}
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
            <AnalyzerDial angle={analyzerAngle} onChange={setAnalyzerAngle} />
          </div>

          {/* Detector readout */}
          <div style={{
            textAlign: 'center', marginBottom: '16px',
            padding: '8px', border: '1px solid #D0D0D0', borderRadius: '2px',
            backgroundColor: '#FAFAFA', maxWidth: '240px', margin: '0 auto 16px auto',
          }}>
            <div style={{ fontSize: '10px', color: '#555555', fontFamily: FONT, marginBottom: '2px' }}>归一化光强</div>
            <div className="tabular-nums" style={{
              fontSize: '28px', fontWeight: 600, color: '#1A1A1A', fontFamily: FONT,
            }}>
              {intensity.toFixed(4)}
            </div>
            <div style={{ width: '100%', height: '4px', backgroundColor: '#E8ECF0', marginTop: '4px', borderRadius: '1px' }}>
              <div style={{
                width: `${intensity * 100}%`, height: '100%',
                backgroundColor: WAVELENGTHS[wavelengthIdx].color,
                borderRadius: '1px',
                transition: 'width 100ms ease-out',
              }} />
            </div>
          </div>

          {/* I-θ Curve */}
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#1A1A1A', fontFamily: FONT, marginBottom: '8px' }}>
              光强-角度曲线 I(θ)
            </div>
            <svg width={curveW} height={curveH} style={{ border: '1px solid #D0D0D0', backgroundColor: '#FFFFFF' }}>
              {/* Grid */}
              {[0.25, 0.5, 0.75].map(f => (
                <g key={f}>
                  <line x1={pad} y1={pad + (curveH - pad * 2) * f} x2={curveW - pad} y2={pad + (curveH - pad * 2) * f}
                    stroke="#E8ECF0" strokeWidth="0.5" />
                </g>
              ))}
              {[0.25, 0.5, 0.75].map(f => (
                <line key={f} x1={pad + (curveW - pad * 2) * f} y1={pad} x2={pad + (curveW - pad * 2) * f} y2={curveH - pad}
                  stroke="#E8ECF0" strokeWidth="0.5" />
              ))}
              {/* Axes */}
              <line x1={pad} y1={curveH - pad} x2={curveW - pad} y2={curveH - pad} stroke="#888888" strokeWidth="0.8" />
              <line x1={pad} y1={pad} x2={pad} y2={curveH - pad} stroke="#888888" strokeWidth="0.8" />
              {/* Curve */}
              {(() => {
                const plotW = curveW - pad * 2
                const plotH = curveH - pad * 2
                const pts = curveData.map((d, i) => {
                  const x = pad + (d.angle / 360) * plotW
                  const y = pad + plotH - d.intensity * plotH
                  return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
                })
                return <path d={pts.join(' ')} fill="none" stroke="#1A1A1A" strokeWidth="1" />
              })()}
              {/* Current position marker */}
              {(() => {
                const plotW = curveW - pad * 2
                const plotH = curveH - pad * 2
                const x = pad + (analyzerAngle / 360) * plotW
                const y = pad + plotH - intensity * plotH
                return <circle cx={x} cy={y} r="3" fill="#CC0000" />
              })()}
              {/* Axis labels */}
              <text x={pad + (curveW - pad * 2) / 2} y={curveH - 4} textAnchor="middle" fontSize="8" fill="#555555" fontFamily={FONT}>θ (°)</text>
              <text x={6} y={curveH / 2} textAnchor="middle" fontSize="8" fill="#555555" fontFamily={FONT}
                transform={`rotate(-90, 6, ${curveH / 2})`}>I/I₀</text>
              {/* Tick labels */}
              <text x={pad} y={curveH - pad + 10} textAnchor="middle" fontSize="6" fill="#888888" fontFamily={FONT} className="tabular-nums">0</text>
              <text x={pad + (curveW - pad * 2) / 4} y={curveH - pad + 10} textAnchor="middle" fontSize="6" fill="#888888" fontFamily={FONT} className="tabular-nums">90</text>
              <text x={pad + (curveW - pad * 2) / 2} y={curveH - pad + 10} textAnchor="middle" fontSize="6" fill="#888888" fontFamily={FONT} className="tabular-nums">180</text>
              <text x={pad + (curveW - pad * 2) * 3 / 4} y={curveH - pad + 10} textAnchor="middle" fontSize="6" fill="#888888" fontFamily={FONT} className="tabular-nums">270</text>
              <text x={curveW - pad} y={curveH - pad + 10} textAnchor="middle" fontSize="6" fill="#888888" fontFamily={FONT} className="tabular-nums">360</text>
            </svg>
          </div>
        </div>

        {/* Right: Control panel */}
        <div style={{
          width: '300px', flexShrink: 0, backgroundColor: '#FAFAFA',
          borderLeft: '1px solid #D0D0D0', overflowY: 'auto', padding: '16px',
          className: 'custom-scrollbar',
        }}>
          {/* Wavelength selection */}
          <div style={{ marginBottom: '16px' }}>
            <SectionTitle>光源波长</SectionTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              {WAVELENGTHS.map((wl, i) => (
                <button key={i} onClick={() => setWavelengthIdx(i)} style={{
                  fontSize: '10px', padding: '4px 8px', borderRadius: '2px',
                  border: `1px solid ${wavelengthIdx === i ? '#333333' : '#D0D0D0'}`,
                  backgroundColor: wavelengthIdx === i ? '#F0F3F6' : '#FFFFFF',
                  color: '#1A1A1A', cursor: 'pointer', fontFamily: FONT,
                  display: 'flex', alignItems: 'center', gap: '6px',
                  transition: 'border-color 200ms ease-out',
                }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: wl.color, border: '1px solid #D0D0D0' }} />
                  {wl.label}
                </button>
              ))}
            </div>
          </div>

          {/* Sample selection */}
          <div style={{ marginBottom: '16px' }}>
            <SectionTitle>样品选择</SectionTitle>
            <select value={selectedPreset} onChange={e => setSelectedPreset(Number(e.target.value))} style={{
              width: '100%', fontSize: '11px', padding: '4px 6px', border: '1px solid #D0D0D0',
              borderRadius: '2px', backgroundColor: '#FFFFFF', color: '#1A1A1A', fontFamily: FONT,
            }}>
              {SAMPLE_PRESETS.map((s, i) => (
                <option key={i} value={i}>{s.name}</option>
              ))}
            </select>

            {/* Custom parameters */}
            {selectedPreset === SAMPLE_PRESETS.length - 1 && (
              <div style={{ marginTop: '8px' }}>
                <ParamSlider label="比旋光度 [α]" value={customSpecRotation} min={-100} max={100} step={0.1} unit="°/(dm·g/mL)"
                  onChange={setCustomSpecRotation} />
                <ParamSlider label="浓度 c" value={customConcentration} min={0.01} max={0.5} step={0.01} unit="g/mL"
                  onChange={setCustomConcentration} />
                <ParamSlider label="管长 l" value={customTubeLength} min={0.5} max={4} step={0.1} unit="dm"
                  onChange={setCustomTubeLength} />
              </div>
            )}

            {/* Insert/remove sample */}
            <button onClick={() => setSampleInserted(!sampleInserted)} style={{
              marginTop: '8px', width: '100%', fontSize: '10px', padding: '6px',
              borderRadius: '2px',
              border: `1px solid ${sampleInserted ? '#CC0000' : '#333333'}`,
              backgroundColor: sampleInserted ? '#FFF0F0' : '#F0F3F6',
              color: sampleInserted ? '#CC0000' : '#1A1A1A', cursor: 'pointer', fontFamily: FONT,
              transition: 'border-color 200ms ease-out, background-color 200ms ease-out',
            }}>
              {sampleInserted ? '✕ 移除样品管' : '↓ 放入样品管'}
            </button>
          </div>

          {/* Analyzer angle control */}
          <div style={{ marginBottom: '16px' }}>
            <SectionTitle>检偏器角度</SectionTitle>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input type="range" min="0" max="360" step="0.1" value={analyzerAngle}
                onChange={e => setAnalyzerAngle(Number(e.target.value))}
                style={{ flex: 1, accentColor: '#333333' }}
              />
              <span className="tabular-nums" style={{ fontSize: '10px', color: '#1A1A1A', fontFamily: FONT, minWidth: '36px' }}>
                {analyzerAngle.toFixed(1)}°
              </span>
            </div>
          </div>

          {/* Zero method controls */}
          <div style={{ marginBottom: '16px' }}>
            <SectionTitle>零位法操作</SectionTitle>
            <div style={{ fontSize: '9px', color: '#888888', fontFamily: FONT, lineHeight: '1.6', marginBottom: '8px' }}>
              1. 不放样品，调至消光 → 记录零位<br />
              2. 放入样品，再调至消光 → 记录测量值<br />
              3. 自动计算旋光度 α = θ₂ - θ₁
            </div>
            <div style={{ display: 'flex', gap: '4px', marginBottom: '8px' }}>
              <button onClick={handleRecordZero} disabled={sampleInserted} style={{
                flex: 1, fontSize: '9px', padding: '5px 4px', borderRadius: '2px',
                border: `1px solid ${zeroAngle !== null ? '#333333' : '#D0D0D0'}`,
                backgroundColor: zeroAngle !== null ? '#F0F3F6' : '#FFFFFF',
                color: sampleInserted ? '#CCCCCC' : '#1A1A1A', cursor: sampleInserted ? 'not-allowed' : 'pointer',
                fontFamily: FONT,
              }}>
                记录零位 {zeroAngle !== null ? `(${zeroAngle.toFixed(1)}°)` : ''}
              </button>
              <button onClick={handleRecordMeasurement} disabled={!sampleInserted} style={{
                flex: 1, fontSize: '9px', padding: '5px 4px', borderRadius: '2px',
                border: `1px solid ${measurementAngle !== null ? '#333333' : '#D0D0D0'}`,
                backgroundColor: measurementAngle !== null ? '#F0F3F6' : '#FFFFFF',
                color: !sampleInserted ? '#CCCCCC' : '#1A1A1A', cursor: !sampleInserted ? 'not-allowed' : 'pointer',
                fontFamily: FONT,
              }}>
                记录测量 {measurementAngle !== null ? `(${measurementAngle.toFixed(1)}°)` : ''}
              </button>
            </div>
            <button onClick={handleReset} style={{
              fontSize: '9px', padding: '3px 8px', borderRadius: '2px',
              border: '1px solid #D0D0D0', backgroundColor: '#FFFFFF',
              color: '#555555', cursor: 'pointer', fontFamily: FONT,
            }}>
              重置测量
            </button>
          </div>

          {/* Results */}
          <div style={{ marginBottom: '16px' }}>
            <SectionTitle>测量结果</SectionTitle>
            <div style={{
              backgroundColor: '#FFFFFF', border: '1px solid #D0D0D0',
              borderRadius: '2px', padding: '8px', fontSize: '10px',
              fontFamily: FONT, lineHeight: '1.8',
            }}>
              <div style={{ color: '#555555' }}>旋光度 α: <span className="tabular-nums" style={{ color: '#1A1A1A', fontWeight: 600 }}>
                {rotationAngle.toFixed(2)}°
              </span></div>
              <div style={{ color: '#555555' }}>消光位置: <span className="tabular-nums" style={{ color: '#1A1A1A' }}>
                {extinctionAngle.join('°, ')}°
              </span></div>
              {calculatedRotation && (
                <>
                  <div style={{ borderTop: '1px solid #E8ECF0', marginTop: '4px', paddingTop: '4px' }}>
                    <span style={{ color: '#555555' }}>实测旋光度: </span>
                    <span className="tabular-nums" style={{ color: '#1A1A1A', fontWeight: 600 }}>{calculatedRotation.alpha.toFixed(2)}°</span>
                  </div>
                  <div style={{ color: '#555555' }}>实测比旋光度: <span className="tabular-nums" style={{ color: '#1A1A1A', fontWeight: 600 }}>
                    {calculatedRotation.specRot.toFixed(2)}°/(dm·g/mL)
                  </span></div>
                </>
              )}
            </div>
          </div>

          {/* Sample info */}
          {sampleInserted && (
            <div>
              <SectionTitle>样品参数</SectionTitle>
              <div style={{
                backgroundColor: '#FFFFFF', border: '1px solid #D0D0D0',
                borderRadius: '2px', padding: '8px', fontSize: '10px',
                fontFamily: FONT, lineHeight: '1.8',
              }}>
                <div style={{ color: '#555555' }}>物质: <span style={{ color: '#1A1A1A' }}>{sample.name}</span></div>
                <div style={{ color: '#555555' }}>比旋光度 [α]: <span className="tabular-nums" style={{ color: '#1A1A1A' }}>{sample.specificRotation}°/(dm·g/mL)</span></div>
                <div style={{ color: '#555555' }}>浓度 c: <span className="tabular-nums" style={{ color: '#1A1A1A' }}>{sample.concentration} g/mL</span></div>
                <div style={{ color: '#555555' }}>管长 l: <span className="tabular-nums" style={{ color: '#1A1A1A' }}>{sample.tubeLength} dm</span></div>
                <div style={{ color: '#555555' }}>公式: α = [α] × l × c</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ─── Analyzer Dial with Vernier ─── */
function AnalyzerDial({ angle, onChange }: { angle: number; onChange: (a: number) => void }) {
  const size = 140
  const cx = size / 2
  const cy = size / 2
  const r = size / 2 - 12

  return (
    <svg width={size} height={size + 16} viewBox={`0 0 ${size} ${size + 16}`}>
      {/* Dial background */}
      <circle cx={cx} cy={cy} r={r} fill="#FFFFFF" stroke="#333333" strokeWidth="1" />
      {/* Degree markings */}
      {Array.from({ length: 72 }, (_, i) => {
        const deg = i * 5
        const rad = (deg * Math.PI) / 180
        const isMajor = deg % 30 === 0
        const isMid = deg % 10 === 0
        const innerR = isMajor ? r - 10 : isMid ? r - 6 : r - 3
        return (
          <g key={deg}>
            <line x1={cx + innerR * Math.cos(rad)} y1={cy - innerR * Math.sin(rad)}
              x2={cx + (r - 1) * Math.cos(rad)} y2={cy - (r - 1) * Math.sin(rad)}
              stroke={isMajor ? '#1A1A1A' : '#888888'} strokeWidth={isMajor ? 1 : 0.5}
            />
            {isMajor && (
              <text x={cx + (r - 16) * Math.cos(rad)} y={cy - (r - 16) * Math.sin(rad) + 3}
                textAnchor="middle" fontSize="7" fill="#555555" fontFamily={FONT} className="tabular-nums"
              >
                {deg}°
              </text>
            )}
          </g>
        )
      })}
      {/* Pointer */}
      {(() => {
        const aRad = (angle * Math.PI) / 180
        return (
          <line x1={cx} y1={cy} x2={cx + (r - 18) * Math.cos(aRad)} y2={cy - (r - 18) * Math.sin(aRad)}
            stroke="#CC0000" strokeWidth="1.5" />
        )
      })()}
      <circle cx={cx} cy={cy} r="3" fill="#333333" />
      {/* Vernier scale text */}
      <text x={cx} y={size + 12} textAnchor="middle" fontSize="9" fill="#555555" fontFamily={FONT} className="tabular-nums">
        θ = {angle.toFixed(1)}°
      </text>
    </svg>
  )
}

/* ─── Helper Components ─── */
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
          {value}{unit || ''}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: '#333333' }}
      />
    </div>
  )
}
