'use client'

import { useState, useMemo } from 'react'

/* ─── Physics Model ─── */
// LC cell: In normally-white mode, zero voltage → 90° rotation → light passes
// Applied voltage → molecules tilt → rotation decreases → light blocked
// Threshold voltage Vth typically ~1V for common LC
// Rotation angle θ(V) = 90° × (1 - (V/Vsat)^2) for V < Vsat, else 0

type LCMode = 'normallyWhite' | 'normallyBlack'

const FONT = 'var(--font-ibm-plex-sans), system-ui, sans-serif'
const VTH = 1.0  // threshold voltage
const VSAT = 4.5 // saturation voltage

function rotationFromVoltage(voltage: number): number {
  if (voltage <= VTH) return 90
  if (voltage >= VSAT) return 0
  // Smooth S-curve between VTH and VSAT
  const t = (voltage - VTH) / (VSAT - VTH)
  return 90 * (1 - t * t)
}

function moleculeTiltAngle(voltage: number): number {
  if (voltage <= VTH) return 0
  if (voltage >= VSAT) return 90
  const t = (voltage - VTH) / (VSAT - VTH)
  return 90 * t
}

/* ─── Main Component ─── */
export default function LiquidCrystalValve({ onBack }: { onBack: () => void }) {
  const [voltage, setVoltage] = useState(0)
  const [mode, setMode] = useState<LCMode>('normallyWhite')
  const [showRGB, setShowRGB] = useState(false)

  const rotAngle = useMemo(() => rotationFromVoltage(voltage), [voltage])
  const tiltAngle = useMemo(() => moleculeTiltAngle(voltage), [voltage])

  // Light intensity through crossed polarizers with LC rotation
  // For normally-white: polarizer at 0°, LC rotates by rotAngle, analyzer at 90°
  // Output: cos²(90° - rotAngle) = sin²(rotAngle)
  // For normally-black: polarizer at 0°, LC rotates by rotAngle, analyzer at 0°
  // Output: cos²(rotAngle)
  const intensity = useMemo(() => {
    if (mode === 'normallyWhite') {
      return Math.sin((rotAngle * Math.PI) / 180) ** 2
    }
    return Math.cos((rotAngle * Math.PI) / 180) ** 2
  }, [rotAngle, mode])

  // I-V curve data
  const ivCurveData = useMemo(() => {
    const points: { v: number; i: number }[] = []
    for (let v = 0; v <= 5; v += 0.05) {
      const rot = rotationFromVoltage(v)
      const int = mode === 'normallyWhite'
        ? Math.sin((rot * Math.PI) / 180) ** 2
        : Math.cos((rot * Math.PI) / 180) ** 2
      points.push({ v, i: int })
    }
    return points
  }, [mode])

  // RGB sub-pixel demo
  const rgbIntensities = useMemo(() => {
    if (!showRGB) return null
    // Slightly different Vth for R, G, B sub-pixels (color shift effect)
    return {
      r: Math.sin((rotationFromVoltage(voltage * 0.92) * Math.PI) / 180) ** 2,
      g: Math.sin((rotationFromVoltage(voltage) * Math.PI) / 180) ** 2,
      b: Math.sin((rotationFromVoltage(voltage * 1.08) * Math.PI) / 180) ** 2,
    }
  }, [showRGB, voltage])

  const curveW = 280
  const curveH = 140
  const pad = 28

  // Generate LC molecule positions for visualization
  const molecules = useMemo(() => {
    const positions: { x: number; y: number; angle: number }[] = []
    const rows = 5
    const cols = 3
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        // Spiral arrangement with progressive tilt
        const baseAngle = mode === 'normallyWhite' ? 90 : 0
        positions.push({
          x: 12 + c * 14,
          y: 8 + r * 10,
          angle: baseAngle - (baseAngle - 90 + tiltAngle) * (1 - 0) + tiltAngle,
        })
      }
    }
    return positions
  }, [tiltAngle, mode])

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
          液晶旋光光阀实验台
        </h1>
      </div>

      <div className="flex flex-1" style={{ minHeight: 0 }}>
        {/* Left: Visualization */}
        <div className="flex-1 dot-grid" style={{
          display: 'flex', flexDirection: 'column', padding: '16px', overflowY: 'auto',
          alignItems: 'center', justifyContent: 'center',
        }}>
          {/* Optical path */}
          <div style={{ marginBottom: '24px' }}>
            <svg width="680" height="130" viewBox="0 0 680 130">
              {/* Axis */}
              <line x1="20" y1="65" x2="660" y2="65" stroke="#888888" strokeWidth="0.6" strokeDasharray="6,3,2,3" />

              {/* Light source */}
              <g transform="translate(50, 65)">
                <rect x="-14" y="-18" width="28" height="36" fill="none" stroke="#333333" strokeWidth="1.2" rx="2" />
                <text x="0" y="3" textAnchor="middle" fontSize="6" fill="#888888" fontFamily={FONT}>LED</text>
                <text x="0" y="30" textAnchor="middle" fontSize="7" fill="#555555" fontFamily={FONT}>单色光源</text>
              </g>

              {/* Polarizer */}
              <g transform="translate(160, 65)">
                <circle cx="0" cy="0" r="22" fill="none" stroke="#333333" strokeWidth="1.2" />
                <line x1="-18" y1="0" x2="18" y2="0" stroke="#1A1A1A" strokeWidth="1.5" />
                <text x="0" y="36" textAnchor="middle" fontSize="7" fill="#555555" fontFamily={FONT}>起偏器</text>
              </g>

              {/* Beam 1 */}
              <line x1="182" y1="65" x2="270" y2="65" stroke="#CC0000" strokeWidth="2" />

              {/* LC Cell */}
              <g transform="translate(370, 65)">
                <rect x="-90" y="-30" width="180" height="60" fill="none" stroke="#333333" strokeWidth="1.2" rx="2" />
                {/* Inner glass plates */}
                <line x1="-80" y1="-26" x2="-80" y2="26" stroke="#333333" strokeWidth="0.6" />
                <line x1="80" y1="-26" x2="80" y2="26" stroke="#333333" strokeWidth="0.6" />

                {/* LC molecules - short line segments showing orientation */}
                {molecules.map((mol, idx) => {
                  const aRad = (mol.angle * Math.PI) / 180
                  const len = 5
                  return (
                    <line key={idx}
                      x1={-60 + mol.x - len * Math.cos(aRad)}
                      y1={-18 + mol.y - len * Math.sin(aRad)}
                      x2={-60 + mol.x + len * Math.cos(aRad)}
                      y2={-18 + mol.y + len * Math.sin(aRad)}
                      stroke="#888888" strokeWidth="1"
                    />
                  )
                })}

                {/* Voltage electrodes */}
                <text x="-70" y="-22" fontSize="6" fill="#888888" fontFamily={FONT}>+</text>
                <text x="-70" y="28" fontSize="6" fill="#888888" fontFamily={FONT}>−</text>

                <text x="0" y="48" textAnchor="middle" fontSize="7" fill="#555555" fontFamily={FONT}>液晶盒</text>
              </g>

              {/* Beam 2 (after LC) */}
              <line x1="460" y1="65" x2="510" y2="65" stroke="#CC0000" strokeWidth="2" opacity={0.6} />

              {/* Analyzer (crossed) */}
              <g transform="translate(540, 65)">
                <circle cx="0" cy="0" r="22" fill="none" stroke="#333333" strokeWidth="1.2" />
                {/* Crossed with polarizer: at 90° for NW, 0° for NB */}
                {(() => {
                  const aAngle = mode === 'normallyWhite' ? 90 : 0
                  const aRad = (aAngle * Math.PI) / 180
                  return (
                    <line x1={-18 * Math.cos(aRad)} y1={-18 * Math.sin(aRad)}
                      x2={18 * Math.cos(aRad)} y2={18 * Math.sin(aRad)}
                      stroke="#1A1A1A" strokeWidth="1.5" />
                  )
                })()}
                <text x="0" y="36" textAnchor="middle" fontSize="7" fill="#555555" fontFamily={FONT}>正交检偏器</text>
              </g>

              {/* Beam 3 (output) */}
              {intensity > 0.01 && (
                <line x1="562" y1="65" x2="640" y2="65" stroke="#CC0000" strokeWidth="2" opacity={intensity} />
              )}

              {/* Detector */}
              <g transform="translate(650, 65)">
                <rect x="-8" y="-14" width="16" height="28" fill="#333333" />
                <text x="0" y="26" textAnchor="middle" fontSize="7" fill="#555555" fontFamily={FONT}>探测</text>
              </g>
            </svg>
          </div>

          {/* Detector output and RGB */}
          <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start', marginBottom: '24px' }}>
            {/* Intensity readout */}
            <div style={{
              padding: '12px', border: '1px solid #D0D0D0', borderRadius: '2px',
              backgroundColor: '#FAFAFA', textAlign: 'center', minWidth: '120px',
            }}>
              <div style={{ fontSize: '10px', color: '#555555', fontFamily: FONT }}>归一化光强</div>
              <div className="tabular-nums" style={{ fontSize: '28px', fontWeight: 600, color: '#1A1A1A', fontFamily: FONT }}>
                {intensity.toFixed(4)}
              </div>
              <div style={{ width: '100%', height: '6px', backgroundColor: '#E8ECF0', marginTop: '4px', borderRadius: '1px' }}>
                <div style={{
                  width: `${intensity * 100}%`, height: '100%',
                  backgroundColor: '#CC0000', borderRadius: '1px',
                  transition: 'width 100ms ease-out',
                }} />
              </div>
            </div>

            {/* RGB demo */}
            {showRGB && rgbIntensities && (
              <div style={{
                padding: '12px', border: '1px solid #D0D0D0', borderRadius: '2px',
                backgroundColor: '#FAFAFA', textAlign: 'center',
              }}>
                <div style={{ fontSize: '10px', color: '#555555', fontFamily: FONT, marginBottom: '6px' }}>RGB子像素</div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  {[
                    { label: 'R', val: rgbIntensities.r, color: '#CC0000' },
                    { label: 'G', val: rgbIntensities.g, color: '#00AA44' },
                    { label: 'B', val: rgbIntensities.b, color: '#4050B0' },
                  ].map(ch => (
                    <div key={ch.label} style={{ textAlign: 'center' }}>
                      <div style={{
                        width: '28px', height: '28px', borderRadius: '2px',
                        border: '1px solid #D0D0D0',
                        backgroundColor: ch.color, opacity: ch.val,
                      }} />
                      <div className="tabular-nums" style={{ fontSize: '8px', color: '#1A1A1A', fontFamily: FONT, marginTop: '2px' }}>
                        {ch.val.toFixed(2)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* I-V Curve */}
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#1A1A1A', fontFamily: FONT, marginBottom: '8px' }}>
              I-V 特性曲线
            </div>
            <svg width={curveW} height={curveH} style={{ border: '1px solid #D0D0D0', backgroundColor: '#FFFFFF' }}>
              {/* Grid */}
              {[0.25, 0.5, 0.75].map(f => (
                <g key={f}>
                  <line x1={pad} y1={pad + (curveH - pad * 2) * f} x2={curveW - pad} y2={pad + (curveH - pad * 2) * f}
                    stroke="#E8ECF0" strokeWidth="0.5" />
                  <line x1={pad + (curveW - pad * 2) * f} y1={pad} x2={pad + (curveW - pad * 2) * f} y2={curveH - pad}
                    stroke="#E8ECF0" strokeWidth="0.5" />
                </g>
              ))}
              {/* Axes */}
              <line x1={pad} y1={curveH - pad} x2={curveW - pad} y2={curveH - pad} stroke="#888888" strokeWidth="0.8" />
              <line x1={pad} y1={pad} x2={pad} y2={curveH - pad} stroke="#888888" strokeWidth="0.8" />
              {/* Curve */}
              {(() => {
                const plotW = curveW - pad * 2
                const plotH = curveH - pad * 2
                const pts = ivCurveData.map((d, i) => {
                  const x = pad + (d.v / 5) * plotW
                  const y = pad + plotH - d.i * plotH
                  return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
                })
                return <path d={pts.join(' ')} fill="none" stroke="#1A1A1A" strokeWidth="1" />
              })()}
              {/* Current point */}
              {(() => {
                const plotW = curveW - pad * 2
                const plotH = curveH - pad * 2
                const x = pad + (voltage / 5) * plotW
                const y = pad + plotH - intensity * plotH
                return <circle cx={x} cy={y} r="3.5" fill="#CC0000" />
              })()}
              {/* Labels */}
              <text x={curveW / 2} y={curveH - 4} textAnchor="middle" fontSize="8" fill="#555555" fontFamily={FONT}>V (V)</text>
              <text x={8} y={curveH / 2} textAnchor="middle" fontSize="8" fill="#555555" fontFamily={FONT}
                transform={`rotate(-90, 8, ${curveH / 2})`}>I/I₀</text>
              <text x={pad} y={curveH - pad + 12} textAnchor="middle" fontSize="6" fill="#888888" fontFamily={FONT} className="tabular-nums">0</text>
              <text x={pad + (curveW - pad * 2) / 2} y={curveH - pad + 12} textAnchor="middle" fontSize="6" fill="#888888" fontFamily={FONT} className="tabular-nums">2.5</text>
              <text x={curveW - pad} y={curveH - pad + 12} textAnchor="middle" fontSize="6" fill="#888888" fontFamily={FONT} className="tabular-nums">5.0</text>
            </svg>
          </div>
        </div>

        {/* Right: Control panel */}
        <div style={{
          width: '280px', flexShrink: 0, backgroundColor: '#FAFAFA',
          borderLeft: '1px solid #D0D0D0', overflowY: 'auto', padding: '16px',
          className: 'custom-scrollbar',
        }}>
          {/* Voltage control */}
          <div style={{ marginBottom: '16px' }}>
            <SectionTitle>驱动电压</SectionTitle>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <input type="range" min="0" max="5" step="0.01" value={voltage}
                onChange={e => setVoltage(Number(e.target.value))}
                style={{ flex: 1, accentColor: '#333333' }}
              />
              <span className="tabular-nums" style={{ fontSize: '12px', fontWeight: 600, color: '#1A1A1A', fontFamily: FONT, minWidth: '40px' }}>
                {voltage.toFixed(2)}V
              </span>
            </div>
            {/* Voltage markers */}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '7px', color: '#888888', fontFamily: FONT, className: 'tabular-nums' }}>
              <span>0V</span>
              <span>Vth={VTH}V</span>
              <span>Vsat={VSAT}V</span>
              <span>5V</span>
            </div>
          </div>

          {/* Mode selection */}
          <div style={{ marginBottom: '16px' }}>
            <SectionTitle>工作模式</SectionTitle>
            <div style={{ display: 'flex', gap: '4px' }}>
              {([['normallyWhite', '常白模式'], ['normallyBlack', '常黑模式']] as [LCMode, string][]).map(([key, label]) => (
                <button key={key} onClick={() => setMode(key)} style={{
                  fontSize: '10px', padding: '4px 10px', borderRadius: '2px',
                  border: `1px solid ${mode === key ? '#333333' : '#D0D0D0'}`,
                  backgroundColor: mode === key ? '#F0F3F6' : '#FFFFFF',
                  color: '#1A1A1A', cursor: 'pointer', fontFamily: FONT,
                  transition: 'border-color 200ms ease-out',
                }}>
                  {label}
                </button>
              ))}
            </div>
            <div style={{ fontSize: '9px', color: '#888888', fontFamily: FONT, marginTop: '6px', lineHeight: '1.5' }}>
              {mode === 'normallyWhite'
                ? '常白: 无压时旋光90°，光通过；加压旋光消失，光被阻断'
                : '常黑: 无压时无旋光，光被阻断；加压旋光增大，光通过'}
            </div>
          </div>

          {/* RGB toggle */}
          <div style={{ marginBottom: '16px' }}>
            <SectionTitle>RGB子像素演示</SectionTitle>
            <label style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              fontSize: '10px', color: '#555555', fontFamily: FONT, cursor: 'pointer',
            }}>
              <input type="checkbox" checked={showRGB} onChange={e => setShowRGB(e.target.checked)}
                style={{ accentColor: '#333333' }}
              />
              启用RGB彩色混合
            </label>
            {showRGB && (
              <div style={{ fontSize: '9px', color: '#888888', fontFamily: FONT, marginTop: '4px', lineHeight: '1.5' }}>
                模拟不同Vth的R/G/B子像素产生色彩偏移
              </div>
            )}
          </div>

          {/* Status readouts */}
          <div style={{ marginBottom: '16px' }}>
            <SectionTitle>实时参数</SectionTitle>
            <div style={{
              backgroundColor: '#FFFFFF', border: '1px solid #D0D0D0',
              borderRadius: '2px', padding: '8px', fontSize: '10px',
              fontFamily: FONT, lineHeight: '2',
            }}>
              <div style={{ color: '#555555' }}>驱动电压: <span className="tabular-nums" style={{ color: '#1A1A1A', fontWeight: 600 }}>{voltage.toFixed(2)} V</span></div>
              <div style={{ color: '#555555' }}>等效旋光角: <span className="tabular-nums" style={{ color: '#1A1A1A', fontWeight: 600 }}>{rotAngle.toFixed(1)}°</span></div>
              <div style={{ color: '#555555' }}>分子倾斜角: <span className="tabular-nums" style={{ color: '#1A1A1A', fontWeight: 600 }}>{tiltAngle.toFixed(1)}°</span></div>
              <div style={{ color: '#555555' }}>归一化光强: <span className="tabular-nums" style={{ color: '#1A1A1A', fontWeight: 600 }}>{intensity.toFixed(4)}</span></div>
            </div>
          </div>

          {/* Explanation */}
          <div>
            <SectionTitle>原理说明</SectionTitle>
            <div style={{
              fontSize: '9px', color: '#888888', fontFamily: FONT, lineHeight: '1.7',
            }}>
              <div>• 液晶分子在零电压下呈螺旋排列</div>
              <div>• 螺旋结构使偏振面旋转90°</div>
              <div>• 外加电场使分子沿场方向排列</div>
              <div>• 旋光能力随电压增大而消失</div>
              <div>• 阈值电压 Vth ≈ {VTH}V</div>
              <div>• 饱和电压 Vsat ≈ {VSAT}V</div>
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
