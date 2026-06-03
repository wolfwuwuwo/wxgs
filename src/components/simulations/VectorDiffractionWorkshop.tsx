'use client'

import { useState, useMemo, useRef, useEffect } from 'react'

/* ─── 2D FFT Implementation (Cooley-Tukey) ─── */
function fft1d(re: Float64Array, im: Float64Array, invert: boolean) {
  const n = re.length
  if (n === 1) return

  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      let tmp = re[i]; re[i] = re[j]; re[j] = tmp
      tmp = im[i]; im[i] = im[j]; im[j] = tmp
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const ang = 2 * Math.PI / len * (invert ? -1 : 1)
    const wRe = Math.cos(ang)
    const wIm = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0
      for (let j = 0; j < len / 2; j++) {
        const uRe = re[i + j], uIm = im[i + j]
        const vRe = re[i + j + len / 2] * curRe - im[i + j + len / 2] * curIm
        const vIm = re[i + j + len / 2] * curIm + im[i + j + len / 2] * curRe
        re[i + j] = uRe + vRe
        im[i + j] = uIm + vIm
        re[i + j + len / 2] = uRe - vRe
        im[i + j + len / 2] = uIm - vIm
        const newCurRe = curRe * wRe - curIm * wIm
        const newCurIm = curRe * wIm + curIm * wRe
        curRe = newCurRe
        curIm = newCurIm
      }
    }
  }

  if (invert) {
    for (let i = 0; i < n; i++) {
      re[i] /= n
      im[i] /= n
    }
  }
}

function fft2d(re: Float64Array, im: Float64Array, N: number, invert: boolean) {
  const rowRe = new Float64Array(N)
  const rowIm = new Float64Array(N)
  const colRe = new Float64Array(N)
  const colIm = new Float64Array(N)

  // FFT rows
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      rowRe[x] = re[y * N + x]
      rowIm[x] = im[y * N + x]
    }
    fft1d(rowRe, rowIm, invert)
    for (let x = 0; x < N; x++) {
      re[y * N + x] = rowRe[x]
      im[y * N + x] = rowIm[x]
    }
  }

  // FFT columns
  for (let x = 0; x < N; x++) {
    for (let y = 0; y < N; y++) {
      colRe[y] = re[y * N + x]
      colIm[y] = im[y * N + x]
    }
    fft1d(colRe, colIm, invert)
    for (let y = 0; y < N; y++) {
      re[y * N + x] = colRe[y]
      im[y * N + x] = colIm[y]
    }
  }
}

/* ─── Aperture Types ─── */
type ApertureType = 'circle' | 'square' | 'doubleslit' | 'grating' | 'singleSlit' | 'ring'

interface ApertureParams {
  type: ApertureType
  radius: number      // for circle, ring
  width: number        // for square, single slit
  height: number       // for square
  slitWidth: number    // for double slit, grating
  slitSep: number      // for double slit, grating
  numSlits: number     // for grating
  innerRadius: number  // for ring
}

const APERTURE_LABELS: Record<ApertureType, string> = {
  circle: '圆孔',
  square: '方孔',
  singleSlit: '单缝',
  doubleslit: '双缝',
  grating: '光栅',
  ring: '圆环',
}

function generateAperture(params: ApertureParams, N: number): Float64Array {
  const aperture = new Float64Array(N * N)
  const cx = N / 2
  const cy = N / 2

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = x - cx
      const dy = y - cy
      let val = 0

      switch (params.type) {
        case 'circle': {
          const r = Math.sqrt(dx * dx + dy * dy)
          val = r <= params.radius ? 1 : 0
          break
        }
        case 'square': {
          val = (Math.abs(dx) <= params.width / 2 && Math.abs(dy) <= params.height / 2) ? 1 : 0
          break
        }
        case 'singleSlit': {
          val = (Math.abs(dx) <= params.slitWidth / 2) ? 1 : 0
          break
        }
        case 'doubleslit': {
          const inSlit1 = Math.abs(dx - params.slitSep / 2) <= params.slitWidth / 2
          const inSlit2 = Math.abs(dx + params.slitSep / 2) <= params.slitWidth / 2
          val = (inSlit1 || inSlit2) ? 1 : 0
          break
        }
        case 'grating': {
          for (let s = 0; s < params.numSlits; s++) {
            const slitCenter = -((params.numSlits - 1) * params.slitSep) / 2 + s * params.slitSep
            if (Math.abs(dx - slitCenter) <= params.slitWidth / 2) {
              val = 1
              break
            }
          }
          break
        }
        case 'ring': {
          const r = Math.sqrt(dx * dx + dy * dy)
          val = (r <= params.radius && r >= params.innerRadius) ? 1 : 0
          break
        }
      }
      aperture[y * N + x] = val
    }
  }
  return aperture
}

/* ─── Compute diffraction pattern ─── */
function computeDiffraction(aperture: Float64Array, N: number): Float64Array {
  const re = new Float64Array(N * N)
  const im = new Float64Array(N * N)

  // Copy aperture into complex array
  for (let i = 0; i < N * N; i++) {
    re[i] = aperture[i]
    im[i] = 0
  }

  // Forward FFT
  fft2d(re, im, N, false)

  // Compute intensity |E|^2 and fftshift
  const intensity = new Float64Array(N * N)
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const sy = (y + N / 2) % N
      const sx = (x + N / 2) % N
      const idx = sy * N + sx
      intensity[idx] = re[y * N + x] * re[y * N + x] + im[y * N + x] * im[y * N + x]
    }
  }

  return intensity
}

/* ─── Colormap: grayscale or blue-white ─── */
type ColormapType = 'grayscale' | 'blueWhite'

function mapColor(value: number, maxVal: number, colormap: ColormapType): [number, number, number] {
  const v = Math.min(1, Math.max(0, value / maxVal))
  if (colormap === 'grayscale') {
    const g = Math.round(v * 255)
    return [g, g, g]
  }
  // Blue-white: 0=#000000 → 0.5=#5060A0 → 1=#FFFFFF
  if (v < 0.5) {
    const t = v * 2
    return [
      Math.round(t * 80),
      Math.round(t * 96),
      Math.round(t * 160),
    ]
  }
  const t = (v - 0.5) * 2
  return [
    Math.round(80 + t * 175),
    Math.round(96 + t * 159),
    Math.round(160 + t * 95),
  ]
}

/* ─── N for FFT (must be power of 2) ─── */
const FFT_SIZE = 128

/* ─── Canvas for rendering diffraction pattern ─── */
function DiffractionCanvas({ intensity, N, colormap, displaySize }: {
  intensity: Float64Array; N: number; colormap: ColormapType; displaySize: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const imageData = ctx.createImageData(N, N)
    // Find max for normalization (use log scale for better visualization)
    let maxVal = 0
    for (let i = 0; i < N * N; i++) {
      const logVal = Math.log(intensity[i] + 1)
      if (logVal > maxVal) maxVal = logVal
    }
    maxVal = Math.max(maxVal, 1e-10)

    for (let i = 0; i < N * N; i++) {
      const logVal = Math.log(intensity[i] + 1) / maxVal
      const [r, g, b] = mapColor(logVal, 1, colormap)
      imageData.data[i * 4] = r
      imageData.data[i * 4 + 1] = g
      imageData.data[i * 4 + 2] = b
      imageData.data[i * 4 + 3] = 255
    }
    ctx.putImageData(imageData, 0, 0)
  }, [intensity, N, colormap])

  return (
    <canvas ref={canvasRef} width={N} height={N}
      style={{ width: displaySize, height: displaySize, imageRendering: 'pixelated', border: '1px solid #D0D0D0' }}
    />
  )
}

/* ─── Aperture Canvas ─── */
function ApertureCanvas({ aperture, N, displaySize }: { aperture: Float64Array; N: number; displaySize: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const imageData = ctx.createImageData(N, N)
    for (let i = 0; i < N * N; i++) {
      const v = aperture[i] > 0.5 ? 255 : 0
      imageData.data[i * 4] = v
      imageData.data[i * 4 + 1] = v
      imageData.data[i * 4 + 2] = v
      imageData.data[i * 4 + 3] = 255
    }
    ctx.putImageData(imageData, 0, 0)
  }, [aperture, N])

  return (
    <canvas ref={canvasRef} width={N} height={N}
      style={{ width: displaySize, height: displaySize, imageRendering: 'pixelated', border: '1px solid #D0D0D0' }}
    />
  )
}

/* ─── Cross-section Plot ─── */
function CrossSectionPlot({ intensity, N, width, height }: { intensity: Float64Array; N: number; width: number; height: number }) {
  const midY = Math.floor(N / 2)
  // Extract horizontal cross-section through center
  const crossSection = useMemo(() => {
    const data: number[] = []
    let maxVal = 0
    for (let x = 0; x < N; x++) {
      const val = intensity[midY * N + x]
      const logVal = Math.log(val + 1)
      data.push(logVal)
      if (logVal > maxVal) maxVal = logVal
    }
    maxVal = Math.max(maxVal, 1e-10)
    return { data, maxVal }
  }, [intensity, N, midY])

  const padding = 24
  const plotW = width - padding * 2
  const plotH = height - padding * 2

  const pathD = useMemo(() => {
    const pts = crossSection.data.map((v, i) => {
      const x = padding + (i / (N - 1)) * plotW
      const y = padding + plotH - (v / crossSection.maxVal) * plotH
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    return pts.join(' ')
  }, [crossSection, N, padding, plotW, plotH])

  return (
    <svg width={width} height={height} style={{ border: '1px solid #D0D0D0', backgroundColor: '#FFFFFF' }}>
      {/* Grid lines */}
      {[0.25, 0.5, 0.75].map(f => (
        <g key={f}>
          <line x1={padding} y1={padding + plotH * f} x2={width - padding} y2={padding + plotH * f}
            stroke="#E8ECF0" strokeWidth="0.5" />
          <line x1={padding + plotW * f} y1={padding} x2={padding + plotW * f} y2={height - padding}
            stroke="#E8ECF0" strokeWidth="0.5" />
        </g>
      ))}
      {/* Axes */}
      <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding}
        stroke="#888888" strokeWidth="0.8" />
      <line x1={padding} y1={padding} x2={padding} y2={height - padding}
        stroke="#888888" strokeWidth="0.8" />
      {/* Data line */}
      <path d={pathD} fill="none" stroke="#1A1A1A" strokeWidth="1" />
      {/* Labels */}
      <text x={width / 2} y={height - 4} textAnchor="middle" fontSize="8" fill="#555555"
        fontFamily="var(--font-ibm-plex-sans), system-ui, sans-serif">空间频率</text>
      <text x={8} y={height / 2} textAnchor="middle" fontSize="8" fill="#555555"
        fontFamily="var(--font-ibm-plex-sans), system-ui, sans-serif"
        transform={`rotate(-90, 8, ${height / 2})`}>ln(I)</text>
    </svg>
  )
}

/* ─── Main Component ─── */
export default function VectorDiffractionWorkshop({ onBack }: { onBack: () => void }) {
  const [apertureType, setApertureType] = useState<ApertureType>('circle')
  const [radius, setRadius] = useState(20)
  const [sqWidth, setSqWidth] = useState(30)
  const [sqHeight, setSqHeight] = useState(30)
  const [slitWidth, setSlitWidth] = useState(6)
  const [slitSep, setSlitSep] = useState(20)
  const [numSlits, setNumSlits] = useState(5)
  const [innerRadius, setInnerRadius] = useState(12)
  const [colormap, setColormap] = useState<ColormapType>('grayscale')

  const N = FFT_SIZE

  // Generate aperture
  const aperture = useMemo(() => {
    return generateAperture({
      type: apertureType,
      radius,
      width: sqWidth,
      height: sqHeight,
      slitWidth,
      slitSep,
      numSlits,
      innerRadius,
    }, N)
  }, [apertureType, radius, sqWidth, sqHeight, slitWidth, slitSep, numSlits, innerRadius, N])

  // Compute diffraction on parameter change via useMemo
  const computedIntensity = useMemo(() => {
    return computeDiffraction(aperture, N)
  }, [aperture, N])

  const isComputing = false

  const displaySize = 280

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
          全波前矢量衍射工坊
        </h1>
      </div>

      {/* Main content */}
      <div className="flex flex-1" style={{ minHeight: 0 }}>
        {/* Left: Visualization */}
        <div className="flex-1 dot-grid" style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', padding: '24px', gap: '24px',
        }}>
          {/* Aperture and Diffraction side by side */}
          <div style={{ display: 'flex', gap: '32px', alignItems: 'flex-start', flexWrap: 'wrap', justifyContent: 'center' }}>
            {/* Aperture */}
            <div style={{ textAlign: 'center' }}>
              <div style={{
                fontSize: '12px', fontWeight: 600, color: '#1A1A1A', marginBottom: '8px',
                fontFamily: 'var(--font-ibm-plex-sans), system-ui, sans-serif',
              }}>
                口径函数
              </div>
              <ApertureCanvas aperture={aperture} N={N} displaySize={displaySize} />
              <div style={{
                fontSize: '9px', color: '#888888', marginTop: '4px',
                fontFamily: 'var(--font-ibm-plex-sans), system-ui, sans-serif',
                className: 'tabular-nums',
              }}>
                {N}×{N} 采样
              </div>
            </div>

            {/* Arrow */}
            <div style={{ display: 'flex', alignItems: 'center', paddingTop: '20px' }}>
              <svg width="40" height="24">
                <line x1="4" y1="12" x2="28" y2="12" stroke="#888888" strokeWidth="1" />
                <polygon points="28,8 36,12 28,16" fill="#888888" />
                <text x="20" y="22" textAnchor="middle" fontSize="7" fill="#888888"
                  fontFamily="var(--font-ibm-plex-sans), system-ui, sans-serif">FFT</text>
              </svg>
            </div>

            {/* Diffraction pattern */}
            <div style={{ textAlign: 'center' }}>
              <div style={{
                fontSize: '12px', fontWeight: 600, color: '#1A1A1A', marginBottom: '8px',
                fontFamily: 'var(--font-ibm-plex-sans), system-ui, sans-serif',
              }}>
                夫琅禾费衍射图样
              </div>
              {computedIntensity ? (
                <DiffractionCanvas intensity={computedIntensity} N={N} colormap={colormap} displaySize={displaySize} />
              ) : (
                <div style={{
                  width: displaySize, height: displaySize,
                  border: '1px solid #D0D0D0', display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  fontSize: '11px', color: '#888888',
                  fontFamily: 'var(--font-ibm-plex-sans), system-ui, sans-serif',
                }}>
                  {isComputing ? '计算中...' : '选择口径参数'}
                </div>
              )}
              <div style={{
                fontSize: '9px', color: '#888888', marginTop: '4px',
                fontFamily: 'var(--font-ibm-plex-sans), system-ui, sans-serif',
              }}>
                对数强度映射
              </div>
            </div>
          </div>

          {/* Cross-section plot */}
          {computedIntensity && (
            <div style={{ textAlign: 'center' }}>
              <div style={{
                fontSize: '12px', fontWeight: 600, color: '#1A1A1A', marginBottom: '8px',
                fontFamily: 'var(--font-ibm-plex-sans), system-ui, sans-serif',
              }}>
                水平截面强度分布
              </div>
              <CrossSectionPlot intensity={computedIntensity} N={N} width={600} height={160} />
            </div>
          )}
        </div>

        {/* Right: Control panel */}
        <div style={{
          width: '280px', flexShrink: 0, backgroundColor: '#FAFAFA',
          borderLeft: '1px solid #D0D0D0', overflowY: 'auto',
          padding: '16px',
        }}>
          {/* Aperture type selection */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{
              fontSize: '12px', fontWeight: 600, color: '#1A1A1A',
              fontFamily: 'var(--font-ibm-plex-sans), system-ui, sans-serif',
              marginBottom: '8px', paddingBottom: '6px',
              borderBottom: '1px solid #E8ECF0',
            }}>
              口径类型
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {(Object.entries(APERTURE_LABELS) as [ApertureType, string][]).map(([key, label]) => (
                <button key={key} onClick={() => setApertureType(key)} style={{
                  fontSize: '10px', padding: '3px 8px', borderRadius: '2px',
                  border: `1px solid ${apertureType === key ? '#333333' : '#D0D0D0'}`,
                  backgroundColor: apertureType === key ? '#F0F3F6' : '#FFFFFF',
                  color: '#1A1A1A', cursor: 'pointer',
                  fontFamily: 'var(--font-ibm-plex-sans), system-ui, sans-serif',
                  transition: 'border-color 200ms ease-out, background-color 200ms ease-out',
                }}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Parameters */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{
              fontSize: '12px', fontWeight: 600, color: '#1A1A1A',
              fontFamily: 'var(--font-ibm-plex-sans), system-ui, sans-serif',
              marginBottom: '8px', paddingBottom: '6px',
              borderBottom: '1px solid #E8ECF0',
            }}>
              口径参数
            </div>

            {/* Circle / Ring params */}
            {(apertureType === 'circle' || apertureType === 'ring') && (
              <>
                <ParamSlider label="半径" value={radius} min={3} max={50} step={1} unit="px"
                  onChange={setRadius} />
                {apertureType === 'ring' && (
                  <ParamSlider label="内径" value={innerRadius} min={2} max={radius - 2} step={1} unit="px"
                    onChange={setInnerRadius} />
                )}
              </>
            )}

            {/* Square params */}
            {apertureType === 'square' && (
              <>
                <ParamSlider label="宽度" value={sqWidth} min={4} max={60} step={1} unit="px"
                  onChange={setSqWidth} />
                <ParamSlider label="高度" value={sqHeight} min={4} max={60} step={1} unit="px"
                  onChange={setSqHeight} />
              </>
            )}

            {/* Slit params */}
            {(apertureType === 'singleSlit' || apertureType === 'doubleslit' || apertureType === 'grating') && (
              <ParamSlider label="缝宽" value={slitWidth} min={2} max={20} step={1} unit="px"
                onChange={setSlitWidth} />
            )}
            {(apertureType === 'doubleslit' || apertureType === 'grating') && (
              <ParamSlider label="缝间距" value={slitSep} min={slitWidth + 2} max={50} step={1} unit="px"
                onChange={setSlitSep} />
            )}
            {apertureType === 'grating' && (
              <ParamSlider label="缝数" value={numSlits} min={2} max={12} step={1}
                onChange={setNumSlits} />
            )}
          </div>

          {/* Colormap */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{
              fontSize: '12px', fontWeight: 600, color: '#1A1A1A',
              fontFamily: 'var(--font-ibm-plex-sans), system-ui, sans-serif',
              marginBottom: '8px', paddingBottom: '6px',
              borderBottom: '1px solid #E8ECF0',
            }}>
              色彩映射
            </div>
            <div style={{ display: 'flex', gap: '4px' }}>
              {([['grayscale', '灰阶'], ['blueWhite', '蓝-白']] as [ColormapType, string][]).map(([key, label]) => (
                <button key={key} onClick={() => setColormap(key)} style={{
                  fontSize: '10px', padding: '3px 10px', borderRadius: '2px',
                  border: `1px solid ${colormap === key ? '#333333' : '#D0D0D0'}`,
                  backgroundColor: colormap === key ? '#F0F3F6' : '#FFFFFF',
                  color: '#1A1A1A', cursor: 'pointer',
                  fontFamily: 'var(--font-ibm-plex-sans), system-ui, sans-serif',
                  transition: 'border-color 200ms ease-out',
                }}>
                  {label}
                </button>
              ))}
            </div>
            {/* Colormap preview */}
            <div style={{ marginTop: '8px', height: '12px', border: '1px solid #D0D0D0' }}>
              <svg width="100%" height="12" viewBox="0 0 240 12" preserveAspectRatio="none">
                {Array.from({ length: 240 }, (_, i) => {
                  const v = i / 240
                  const [r, g, b] = mapColor(v, 1, colormap)
                  return <rect key={i} x={i} y="0" width="1" height="12" fill={`rgb(${r},${g},${b})`} />
                })}
              </svg>
            </div>
          </div>

          {/* Info */}
          <div style={{
            fontSize: '9px', color: '#888888', lineHeight: '1.6',
            fontFamily: 'var(--font-ibm-plex-sans), system-ui, sans-serif',
            borderTop: '1px solid #E8ECF0', paddingTop: '8px',
          }}>
            <div>FFT大小: <span className="tabular-nums">{N}×{N}</span></div>
            <div>远场近似: 夫琅禾费衍射</div>
            <div>强度映射: 对数尺度</div>
            <div style={{ marginTop: '6px' }}>
              圆孔→艾里斑 | 方孔→sinc² | 双缝→干涉条纹 | 光栅→多光束干涉
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── Parameter Slider Component ─── */
function ParamSlider({ label, value, min, max, step, unit, onChange }: {
  label: string; value: number; min: number; max: number; step: number; unit?: string
  onChange: (v: number) => void
}) {
  return (
    <div style={{ marginBottom: '8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
        <span style={{ fontSize: '10px', color: '#555555',
          fontFamily: 'var(--font-ibm-plex-sans), system-ui, sans-serif' }}>{label}</span>
        <span className="tabular-nums" style={{ fontSize: '10px', color: '#1A1A1A',
          fontFamily: 'var(--font-ibm-plex-sans), system-ui, sans-serif' }}>
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
