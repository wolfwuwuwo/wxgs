'use client'

/* ═══════════════════════════════════════════════════════════════════
   YoungGratingExperiment — 双缝干涉与光栅衍射仿真
   3 种实验模式：杨氏双缝 · 多缝光栅 · 闪耀光栅
   ═══════════════════════════════════════════════════════════════════ */

import { useState, useRef, useEffect, useMemo } from 'react'
import { Slider } from '@/components/ui/slider'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useIsMobile } from '@/hooks/use-mobile'
import { ControlPanel, MobilePanelToggle } from './shared/ControlPanel'
import { TearOffButton } from './shared/TearOffPanel'
import { useSnapshotTarget } from '@/hooks/use-snapshot-target'

const FONT = "system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif"
const MONO = 'var(--font-geist-mono), ui-monospace, monospace'
const VIEW_ID = 'physical-young-grating' as const

type ExperimentMode = 'young-double-slit' | 'multi-slit-grating' | 'blazed-grating'

const MODE_LABELS: Record<ExperimentMode, string> = {
  'young-double-slit': '杨氏双缝',
  'multi-slit-grating': '多缝光栅',
  'blazed-grating': '闪耀光栅',
}

const MODE_DESC: Record<ExperimentMode, string> = {
  'young-double-slit': '两缝宽 a、间距 d。强度 = 单缝衍射包络 × 双缝干涉。I(θ)=I₀(sinβ/β)²·cos²α',
  'multi-slit-grating': 'N 条缝。I(θ)=I₀(sinβ/β)²·(sinNα/sinα)²。主极大锐化，分辨本领 R=mN',
  'blazed-grating': '锯齿槽形光栅。能量集中于特定级次，效率峰值由闪耀角决定',
}

const WAVELENGTH_OPTIONS = [
  { value: 632.8, label: '632.8 nm — He-Ne 红', color: '#CC0000' },
  { value: 532, label: '532 nm — Nd:YAG 绿', color: '#00AA00' },
  { value: 589.3, label: '589.3 nm — Na D 黄', color: '#DDAA00' },
  { value: 405, label: '405 nm — 蓝紫', color: '#5500CC' },
]

const WHITE_CHANNELS = [
  { wl: 650, color: [255, 30, 30] as [number, number, number] },
  { wl: 550, color: [30, 200, 30] as [number, number, number] },
  { wl: 450, color: [30, 60, 255] as [number, number, number] },
]

function wavelengthToColor(wl: number): string {
  return WAVELENGTH_OPTIONS.find(w => w.value === wl)?.color || '#CC0000'
}

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '')
  return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)]
}

/* ─── sinc 函数（数值稳定） ─── */
function sinc(x: number): number {
  if (Math.abs(x) < 1e-10) return 1
  return Math.sin(x) / x
}

/* ─── 单缝衍射包络 (sinβ/β)² ─── */
function singleSlitEnvelope(theta: number, a: number, lambda: number): number {
  const beta = Math.PI * a * Math.sin(theta) / lambda
  const s = sinc(beta)
  return s * s
}

/* ─── 多缝干涉因子 (sinNα/sinα)² ─── */
function multiSlitFactor(theta: number, d: number, lambda: number, N: number): number {
  const alpha = Math.PI * d * Math.sin(theta) / lambda
  if (Math.abs(Math.sin(alpha)) < 1e-10) {
    // 主极大位置：α = mπ，极限为 N²
    return N * N
  }
  const num = Math.sin(N * alpha)
  const den = Math.sin(alpha)
  return (num * num) / (den * den)
}

/* ─── 完整强度（归一化） ─── */
function intensity(theta: number, a: number, d: number, lambda: number, N: number): number {
  const env = singleSlitEnvelope(theta, a, lambda)
  const inter = multiSlitFactor(theta, d, lambda, N)
  return env * inter / (N * N)
}

/* ─── 闪耀光栅效率 ─── */
function blazedEfficiency(theta: number, d: number, lambda: number, blazeAngle: number, m: number): number {
  // 闪耀条件：sin(θ_m) + sin(θ_blaze) = mλ/d
  // 效率在满足闪耀条件的级次最高
  const blazeRad = blazeAngle * Math.PI / 180
  const blazeTheta = Math.asin(m * lambda / d - Math.sin(blazeRad))
  if (isNaN(blazeTheta)) return 0
  const delta = theta - blazeTheta
  // 近似效率曲线（sinc²）
  const width = 0.02
  const s = sinc(delta / width)
  return s * s
}

/* ═══════════════════════════════════════════════════════════════════
   子组件：干涉条纹画布（屏幕上的图样）
   ═══════════════════════════════════════════════════════════════════ */
function PatternCanvas({
  mode, a, d, N, wavelength, L, blazeAngle, useWhiteLight,
  width = 600, height = 120,
}: {
  mode: ExperimentMode
  a: number
  d: number
  N: number
  wavelength: number
  L: number
  blazeAngle: number
  useWhiteLight: boolean
  width?: number
  height?: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = height * dpr
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    // 白底
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(0, 0, width, height)

    const lambda_mm = wavelength / 1e6 // nm → mm
    const d_mm = d / 1000 // μm → mm
    const a_mm = a / 1000 // μm → mm
    const L_mm = L * 1000 // m → mm

    // 屏幕范围：对应 ±x_max mm
    const x_max = 20 // mm
    const m_order = mode === 'blazed-grating' ? 1 : 0

    for (let px = 0; px < width; px++) {
      const x = (px / width - 0.5) * 2 * x_max // mm
      const theta = Math.atan(x / L_mm)

      let I: number
      if (mode === 'blazed-grating') {
        I = blazedEfficiency(theta, d_mm, lambda_mm, blazeAngle, m_order) * singleSlitEnvelope(theta, a_mm, lambda_mm)
      } else {
        I = intensity(theta, a_mm, d_mm, lambda_mm, mode === 'young-double-slit' ? 2 : N)
      }

      if (useWhiteLight && mode !== 'blazed-grating') {
        // 白光：三通道叠加
        let R = 0, G = 0, B = 0
        WHITE_CHANNELS.forEach(ch => {
          const lam = ch.wl / 1e6
          const Ic = intensity(theta, a_mm, d_mm, lam, mode === 'young-double-slit' ? 2 : N)
          R += Ic * ch.color[0] / 255
          G += Ic * ch.color[1] / 255
          B += Ic * ch.color[2] / 255
        })
        R = Math.min(255, R * 255 / 3)
        G = Math.min(255, G * 255 / 3)
        B = Math.min(255, B * 255 / 3)
        ctx.fillStyle = `rgb(${R | 0},${G | 0},${B | 0})`
      } else {
        const beamColor = wavelengthToColor(wavelength)
        const [r, g, b] = hexToRgb(beamColor)
        const v = Math.max(0, Math.min(1, I))
        ctx.fillStyle = `rgb(${(r * v) | 0},${(g * v) | 0},${(b * v) | 0})`
      }
      ctx.fillRect(px, 0, 1, height)
    }

    // 边框
    ctx.strokeStyle = '#333333'
    ctx.lineWidth = 1
    ctx.strokeRect(0.5, 0.5, width - 1, height - 1)

    // 标尺：m 级次位置
    ctx.strokeStyle = '#999999'
    ctx.fillStyle = '#666666'
    ctx.font = '9px monospace'
    ctx.lineWidth = 0.5
    for (let m = -3; m <= 3; m++) {
      const sinTheta = m * lambda_mm / d_mm
      if (Math.abs(sinTheta) >= 1) continue
      const theta = Math.asin(sinTheta)
      const x = L_mm * Math.tan(theta)
      const px = (x / (2 * x_max) + 0.5) * width
      if (px < 0 || px > width) continue
      ctx.beginPath()
      ctx.moveTo(px, height - 8)
      ctx.lineTo(px, height)
      ctx.stroke()
      ctx.fillText(`m=${m}`, px - 10, height - 10)
    }
  }, [mode, a, d, N, wavelength, L, blazeAngle, useWhiteLight, width, height])

  return (
    <canvas
      ref={canvasRef}
      className="border border-[#d4d8e0] bg-white"
      style={{ maxWidth: '100%', height: 'auto' }}
    />
  )
}

/* ═══════════════════════════════════════════════════════════════════
   子组件：强度曲线 SVG
   ═══════════════════════════════════════════════════════════════════ */
function IntensityCurveSVG({
  mode, a, d, N, wavelength, L, blazeAngle,
  showEnvelope, showIndividual,
  width = 600, height = 180,
}: {
  mode: ExperimentMode
  a: number
  d: number
  N: number
  wavelength: number
  L: number
  blazeAngle: number
  showEnvelope: boolean
  showIndividual: boolean
  width?: number
  height?: number
}) {
  const padding = { left: 40, right: 12, top: 12, bottom: 24 }
  const plotW = width - padding.left - padding.right
  const plotH = height - padding.top - padding.bottom

  const lambda_mm = wavelength / 1e6
  const d_mm = d / 1000
  const a_mm = a / 1000
  const L_mm = L * 1000
  const x_max = 20 // mm
  const beamColor = wavelengthToColor(wavelength)

  const samples = 400
  const pts: string[] = []
  const envPts: string[] = []
  const interPts: string[] = []
  const maxI = mode === 'blazed-grating' ? 1 : 1

  for (let i = 0; i <= samples; i++) {
    const x = (i / samples - 0.5) * 2 * x_max
    const theta = Math.atan(x / L_mm)
    let I = 0
    if (mode === 'blazed-grating') {
      I = blazedEfficiency(theta, d_mm, lambda_mm, blazeAngle, 1) * singleSlitEnvelope(theta, a_mm, lambda_mm)
    } else {
      I = intensity(theta, a_mm, d_mm, lambda_mm, mode === 'young-double-slit' ? 2 : N)
    }
    const px = padding.left + (i / samples) * plotW
    const py = padding.top + (1 - I / maxI) * plotH
    pts.push(`${px},${py}`)

    if (showEnvelope && mode !== 'blazed-grating') {
      const env = singleSlitEnvelope(theta, a_mm, lambda_mm)
      envPts.push(`${px},${padding.top + (1 - env) * plotH}`)
    }
    if (showIndividual && mode === 'multi-slit-grating') {
      const inter = multiSlitFactor(theta, d_mm, lambda_mm, N) / (N * N)
      interPts.push(`${px},${padding.top + (1 - inter) * plotH}`)
    }
  }

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ maxWidth: '100%', height: 'auto' }}>
      {/* 网格 */}
      {[0.25, 0.5, 0.75].map(g => (
        <line key={g} x1={padding.left} y1={padding.top + g * plotH} x2={padding.left + plotW} y2={padding.top + g * plotH} stroke="#E8ECF0" strokeWidth="0.5" />
      ))}

      {/* 坐标轴 */}
      <line x1={padding.left} y1={padding.top + plotH} x2={padding.left + plotW} y2={padding.top + plotH} stroke="#888" strokeWidth="0.8" />
      <line x1={padding.left} y1={padding.top} x2={padding.left} y2={padding.top + plotH} stroke="#888" strokeWidth="0.8" />

      {/* 主极大标记 */}
      {[-3, -2, -1, 0, 1, 2, 3].map(m => {
        const sinT = m * lambda_mm / d_mm
        if (Math.abs(sinT) >= 1) return null
        const theta = Math.asin(sinT)
        const x = L_mm * Math.tan(theta)
        const px = padding.left + (x / (2 * x_max) + 0.5) * plotW
        if (px < padding.left || px > padding.left + plotW) return null
        return <line key={m} x1={px} y1={padding.top} x2={px} y2={padding.top + plotH} stroke="#E0E0E0" strokeWidth="0.4" strokeDasharray="2 2" />
      })}

      {/* 包络 */}
      {showEnvelope && envPts.length > 0 && (
        <polyline points={envPts.join(' ')} fill="none" stroke="#999999" strokeWidth="0.8" strokeDasharray="3 2" />
      )}
      {/* 干涉因子 */}
      {showIndividual && interPts.length > 0 && (
        <polyline points={interPts.join(' ')} fill="none" stroke="#CC8888" strokeWidth="0.8" strokeDasharray="2 2" />
      )}
      {/* 总强度 */}
      <polyline points={pts.join(' ')} fill="none" stroke={beamColor} strokeWidth="1.4" />

      {/* 标签 */}
      <text x={padding.left} y={padding.top - 3} fontSize="9" fill="#666" fontFamily={FONT}>I/I₀</text>
      <text x={padding.left + plotW} y={height - 4} fontSize="9" fill="#888" fontFamily={FONT} textAnchor="end">x (mm)</text>
      <text x={padding.left - 4} y={padding.top + plotH + 14} fontSize="8" fill="#888" fontFamily={MONO} textAnchor="end">-{x_max}</text>
      <text x={padding.left + plotW / 2} y={height - 4} fontSize="8" fill="#888" fontFamily={MONO} textAnchor="middle">0</text>
      <text x={padding.left + plotW + 4} y={padding.top + plotH + 14} fontSize="8" fill="#888" fontFamily={MONO}>+{x_max}</text>
    </svg>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   子组件：缝孔径示意图
   ═══════════════════════════════════════════════════════════════════ */
function SlitApertureSVG({
  a, d, N, mode, blazeAngle, width = 300, height = 120,
}: {
  a: number
  d: number
  N: number
  mode: ExperimentMode
  blazeAngle: number
  width?: number
  height?: number
}) {
  const cx = width / 2
  const cy = height / 2
  // a, d 按比例显示
  const scale = Math.min(40, (width - 40) / (N * d))
  const aPx = Math.max(2, a * scale / 20)
  const dPx = d * scale / 20

  const slits: number[] = []
  const totalW = (N - 1) * dPx
  const start = cx - totalW / 2
  for (let i = 0; i < N; i++) {
    slits.push(start + i * dPx)
  }

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ maxWidth: '100%', height: 'auto' }}>
      {/* 屏幕背景（不透明区） */}
      <rect x="0" y={cy - 20} width={width} height="40" fill="#333333" />

      {/* 缝（透明） */}
      {slits.map((x, i) => {
        if (mode === 'blazed-grating') {
          // 锯齿槽
          const blazeRad = blazeAngle * Math.PI / 180
          const h = dPx * Math.tan(blazeRad)
          return (
            <g key={i}>
              <polygon
                points={`${x - dPx / 2},${cy - 20} ${x + dPx / 2},${cy - 20} ${x + dPx / 2},${cy + 20 - h} ${x - dPx / 2},${cy + 20}`}
                fill="#FFFFFF"
                stroke="#666"
                strokeWidth="0.5"
              />
            </g>
          )
        }
        return (
          <rect key={i} x={x - aPx / 2} y={cy - 20} width={aPx} height="40" fill="#FFFFFF" />
        )
      })}

      {/* 标注 a（第一缝宽度） */}
      {slits.length > 0 && mode !== 'blazed-grating' && (
        <>
          <line x1={slits[0] - aPx / 2} y1={cy + 22} x2={slits[0] + aPx / 2} y2={cy + 22} stroke="#CC3333" strokeWidth="0.8" />
          <line x1={slits[0] - aPx / 2} y1={cy + 20} x2={slits[0] - aPx / 2} y2={cy + 24} stroke="#CC3333" strokeWidth="0.8" />
          <line x1={slits[0] + aPx / 2} y1={cy + 20} x2={slits[0] + aPx / 2} y2={cy + 24} stroke="#CC3333" strokeWidth="0.8" />
          <text x={slits[0]} y={cy + 34} fontSize="8" fill="#CC3333" fontFamily={MONO} textAnchor="middle">a={a}μm</text>
        </>
      )}

      {/* 标注 d（前两缝间距） */}
      {slits.length > 1 && (
        <>
          <line x1={slits[0]} y1={cy - 28} x2={slits[1]} y2={cy - 28} stroke="#1A6BCC" strokeWidth="0.8" />
          <line x1={slits[0]} y1={cy - 26} x2={slits[0]} y2={cy - 30} stroke="#1A6BCC" strokeWidth="0.8" />
          <line x1={slits[1]} y1={cy - 26} x2={slits[1]} y2={cy - 30} stroke="#1A6BCC" strokeWidth="0.8" />
          <text x={(slits[0] + slits[1]) / 2} y={cy - 32} fontSize="8" fill="#1A6BCC" fontFamily={MONO} textAnchor="middle">d={d}μm</text>
        </>
      )}

      {/* N 标注 */}
      <text x={width - 8} y={14} fontSize="9" fill="#666" fontFamily={FONT} textAnchor="end">N={N}</text>
      <text x={8} y={14} fontSize="9" fill="#666" fontFamily={FONT}>
        {mode === 'blazed-grating' ? `闪耀角 ${blazeAngle.toFixed(1)}°` : '缝孔径'}
      </text>
    </svg>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   主组件
   ═══════════════════════════════════════════════════════════════════ */
export default function YoungGratingExperiment({ onBack }: { onBack: () => void }) {
  const isMobile = useIsMobile()
  const [panelOpen, setPanelOpen] = useState(false)

  const cachedState = typeof window !== 'undefined'
    ? (() => { try { return JSON.parse(localStorage.getItem('ops-lab-v3') || '{}')?.state?.[VIEW_ID]?.state || null } catch { return null } })()
    : null

  const [mode, setMode] = useState<ExperimentMode>(cachedState?.mode ?? 'young-double-slit')
  const [wavelength, setWavelength] = useState(cachedState?.wavelength ?? 632.8)
  const [a, setA] = useState(cachedState?.a ?? 20) // μm 缝宽
  const [d, setD] = useState(cachedState?.d ?? 200) // μm 缝间距
  const [N, setN] = useState(cachedState?.N ?? 5)
  const [blazeAngle, setBlazeAngle] = useState(cachedState?.blazeAngle ?? 15)
  const [L, setL] = useState(cachedState?.L ?? 1) // m 屏距
  const [useWhiteLight, setUseWhiteLight] = useState(false)
  const [showEnvelope, setShowEnvelope] = useState(true)
  const [showIndividual, setShowIndividual] = useState(false)

  const vizRef = useRef<HTMLDivElement>(null)

  useSnapshotTarget(VIEW_ID, {
    targetRef: vizRef,
    getTitle: () => `${MODE_LABELS[mode]} · λ=${wavelength}nm · a=${a}μm · d=${d}μm · N=${N}`,
    getParams: () => [
      { key: 'λ', value: `${wavelength}nm` },
      { key: 'a', value: `${a}μm` },
      { key: 'd', value: `${d}μm` },
      { key: 'N', value: `${N}` },
      ...(mode === 'blazed-grating' ? [{ key: 'θ_blaze', value: `${blazeAngle.toFixed(1)}°` }] : []),
      { key: 'L', value: `${L}m` },
    ],
  })

  useEffect(() => {
    return () => {
      try {
        const store = JSON.parse(localStorage.getItem('ops-lab-v3') || '{}')
        if (!store.state) store.state = {}
        store.state[VIEW_ID] = {
          viewId: VIEW_ID,
          state: { mode, wavelength, a, d, N, blazeAngle, L },
          updatedAt: new Date().toISOString(),
        }
        localStorage.setItem('ops-lab-v3', JSON.stringify(store))
      } catch { /* ignore */ }
    }
  }, [mode, wavelength, a, d, N, blazeAngle, L])

  // 派生量
  const lambda_mm = wavelength / 1e6
  const d_mm = d / 1000
  const fringeSpacing = lambda_mm * L / d_mm // mm（杨氏条纹间距）
  const maxOrder = Math.floor(d_mm / lambda_mm)
  const resolvingPower = 1 * N // R = mN, m=1
  const freeSpectralRange = lambda_mm / (d_mm) // 一级自由光谱范围

  return (
    <div className="h-full flex flex-col" style={{ background: '#FFFFFF' }}>
      {/* Header */}
      <div className="flex-shrink-0 flex items-center" style={{
        height: isMobile ? '44px' : '48px', backgroundColor: '#FFFFFF',
        borderBottom: '1px solid #CCCCCC', paddingLeft: isMobile ? '16px' : '24px', paddingRight: isMobile ? '12px' : '24px',
        gap: '8px',
      }}>
        <button onClick={onBack} style={{
          fontSize: '12px', fontWeight: 400, color: '#555555',
          background: 'none', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: '4px',
          transition: 'color 200ms ease-out', flexShrink: 0,
        }} onMouseEnter={e => (e.currentTarget.style.color = '#1A1A1A')}
           onMouseLeave={e => (e.currentTarget.style.color = '#555555')}>
          ← 返回
        </button>
        <span style={{ margin: '0 4px', color: '#D0D0D0' }}>|</span>
        <h1 style={{ fontSize: isMobile ? '17px' : '20px', fontWeight: 600, color: '#1A1A1A', margin: 0, flexShrink: 0 }}>
          双缝干涉与光栅衍射
        </h1>
        {!isMobile && (
          <span style={{ marginLeft: '4px', fontSize: '9px', color: '#888888',
            border: '1px solid #D0D0D0', borderRadius: '2px', padding: '1px 6px', flexShrink: 0 }}>
            d·sinθ = mλ
          </span>
        )}

        <div className={isMobile ? 'flex overflow-x-auto mobile-x-scroll flex-1 min-w-0' : 'flex'} style={{
          marginLeft: isMobile ? '8px' : 'auto', gap: '2px', flexWrap: 'nowrap' as const,
        }}>
          {(Object.keys(MODE_LABELS) as ExperimentMode[]).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                fontFamily: FONT, fontSize: isMobile ? '11px' : '12px', fontWeight: 500,
                padding: '4px 10px', minHeight: '44px',
                border: '1px solid ' + (mode === m ? '#1A1A1A' : '#D0D0D0'),
                backgroundColor: mode === m ? '#1A1A1A' : '#FFFFFF',
                color: mode === m ? '#FFFFFF' : '#555555',
                cursor: 'pointer', borderRadius: '2px',
                transition: 'all 120ms ease-out',
                whiteSpace: 'nowrap', flexShrink: 0,
              }}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>

        {isMobile && <MobilePanelToggle onClick={() => setPanelOpen(true)} label="参数" />}
        <TearOffButton
          viewId={VIEW_ID}
          title={`${MODE_LABELS[mode]} · λ=${wavelength}nm · N=${N}`}
          params={[
            { key: 'λ', value: `${wavelength}nm` },
            { key: 'a', value: `${a}μm` },
            { key: 'd', value: `${d}μm` },
            { key: 'N', value: `${N}` },
          ]}
          targetRef={vizRef}
          panelWidth={300}
          label="撕下对比"
        />
      </div>

      {/* 主体 */}
      <div className="flex flex-1" style={{ minHeight: 0 }}>
        <ControlPanel
          open={panelOpen}
          onClose={() => setPanelOpen(false)}
          title="实验参数"
          desktopWidth="w-80"
        >
          <div className="space-y-5">
            {/* 模式说明 */}
            <div style={{
              padding: '8px 10px', backgroundColor: '#FAFAFA',
              border: '1px solid #E8ECF0', borderRadius: '2px',
            }}>
              <div style={{ fontFamily: FONT, fontSize: '10px', color: '#888', marginBottom: '3px', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                当前模式
              </div>
              <div style={{ fontFamily: FONT, fontSize: '12px', fontWeight: 600, color: '#1A1A1A', marginBottom: '4px' }}>
                {MODE_LABELS[mode]}
              </div>
              <div style={{ fontFamily: FONT, fontSize: '10px', color: '#666', lineHeight: 1.5 }}>
                {MODE_DESC[mode]}
              </div>
            </div>

            {/* 波长 */}
            <div>
              <Label className="text-[12px] text-[#2d3142] mb-2 block">波长 λ</Label>
              <Select value={String(wavelength)} onValueChange={v => setWavelength(Number(v))}>
                <SelectTrigger className="h-9 text-[12px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {WAVELENGTH_OPTIONS.map(w => (
                    <SelectItem key={w.value} value={String(w.value)}>
                      <span style={{ display: 'inline-block', width: '10px', height: '10px', backgroundColor: w.color, marginRight: '6px', verticalAlign: 'middle' }} />
                      {w.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 白光开关（仅双缝/多缝） */}
            {mode !== 'blazed-grating' && (
              <div className="flex items-center justify-between">
                <Label className="text-[12px] text-[#2d3142]">白光光源</Label>
                <Switch checked={useWhiteLight} onCheckedChange={setUseWhiteLight} />
              </div>
            )}

            {/* 缝宽 a */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-[12px] text-[#2d3142]">缝宽 a</Label>
                <span className="tabular-nums text-[11px] text-[#6b7280]" style={{ fontFamily: MONO }}>{a} μm</span>
              </div>
              <Slider value={[a]} min={5} max={100} step={1} onValueChange={([v]) => setA(v)} />
              <div className="flex justify-between text-[9px] text-[#aaa]">
                <span>5 μm</span><span>100 μm</span>
              </div>
            </div>

            {/* 缝间距 d */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-[12px] text-[#2d3142]">缝间距 d</Label>
                <span className="tabular-nums text-[11px] text-[#6b7280]" style={{ fontFamily: MONO }}>{d} μm</span>
              </div>
              <Slider value={[d]} min={50} max={1000} step={10} onValueChange={([v]) => setD(v)} />
              <div className="flex justify-between text-[9px] text-[#aaa]">
                <span>50 μm</span><span>1000 μm</span>
              </div>
            </div>

            {/* 缝数 N（光栅模式） */}
            {mode !== 'young-double-slit' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-[12px] text-[#2d3142]">缝数 N</Label>
                  <span className="tabular-nums text-[11px] text-[#6b7280]" style={{ fontFamily: MONO }}>{N}</span>
                </div>
                <Slider value={[N]} min={2} max={50} step={1} onValueChange={([v]) => setN(v)} />
                <div className="flex justify-between text-[9px] text-[#aaa]">
                  <span>2</span><span>50</span>
                </div>
              </div>
            )}

            {/* 闪耀角 */}
            {mode === 'blazed-grating' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-[12px] text-[#2d3142]">闪耀角 θ_b</Label>
                  <span className="tabular-nums text-[11px] text-[#6b7280]" style={{ fontFamily: MONO }}>{blazeAngle.toFixed(1)}°</span>
                </div>
                <Slider value={[blazeAngle]} min={0} max={30} step={0.5} onValueChange={([v]) => setBlazeAngle(v)} />
                <div className="flex justify-between text-[9px] text-[#aaa]">
                  <span>0°</span><span>30°</span>
                </div>
              </div>
            )}

            {/* 屏距 L */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-[12px] text-[#2d3142]">屏距 L</Label>
                <span className="tabular-nums text-[11px] text-[#6b7280]" style={{ fontFamily: MONO }}>{L.toFixed(1)} m</span>
              </div>
              <Slider value={[L]} min={0.5} max={5} step={0.1} onValueChange={([v]) => setL(v)} />
              <div className="flex justify-between text-[9px] text-[#aaa]">
                <span>0.5 m</span><span>5 m</span>
              </div>
            </div>

            {/* 显示选项 */}
            <div className="space-y-2" style={{ borderTop: '1px solid #E8ECF0', paddingTop: '12px' }}>
              <div className="flex items-center justify-between">
                <Label className="text-[12px] text-[#2d3142]">显示包络</Label>
                <Switch checked={showEnvelope} onCheckedChange={setShowEnvelope} />
              </div>
              {mode === 'multi-slit-grating' && (
                <div className="flex items-center justify-between">
                  <Label className="text-[12px] text-[#2d3142]">显示干涉因子</Label>
                  <Switch checked={showIndividual} onCheckedChange={setShowIndividual} />
                </div>
              )}
            </div>

            {/* 计算结果 */}
            <div style={{ borderTop: '1px solid #E8ECF0', paddingTop: '12px' }}>
              <div style={{ fontFamily: FONT, fontSize: '10px', color: '#888', marginBottom: '6px', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                计算结果
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
                <ResultItem label="条纹间距 Δx" value={`${(fringeSpacing * 10).toFixed(3)} mm`} />
                <ResultItem label="最大级次 m_max" value={`${maxOrder}`} />
                <ResultItem label="分辨本领 R=mN" value={`${resolvingPower}`} />
                <ResultItem label="自由光谱范围" value={`${(freeSpectralRange * 1e6).toFixed(1)} nm`} />
                <ResultItem label="d/a 比" value={`${(d / a).toFixed(1)}`} />
                <ResultItem label="缺级 m=n(d/a)" value={`${Math.round(d / a)}`} />
              </div>
            </div>

            {/* 公式参考 */}
            <div style={{
              padding: '10px 12px', backgroundColor: '#FAFAFA',
              border: '1px solid #E8ECF0', borderRadius: '2px',
            }}>
              <div style={{ fontFamily: FONT, fontSize: '10px', color: '#888', marginBottom: '6px' }}>公式参考</div>
              <div style={{ fontFamily: MONO, fontSize: '10px', color: '#333', lineHeight: 1.8 }}>
                <div>I(θ) = (sinβ/β)² · (sinNα/sinα)²</div>
                <div>β = πa·sinθ/λ,  α = πd·sinθ/λ</div>
                <div>主极大：d·sinθ = mλ</div>
                <div>分辨本领：R = mN</div>
                <div style={{ fontSize: '9px', color: '#888', marginTop: '4px' }}>
                  缺级：m = n(d/a)<br />
                  闪耀：sinθ_m = mλ/d - sinθ_b
                </div>
              </div>
            </div>
          </div>
        </ControlPanel>

        {/* 右：可视化 */}
        <div
          ref={vizRef}
          className="flex-1 custom-scrollbar min-w-0"
          style={{
            display: 'flex', flexDirection: 'column',
            padding: isMobile ? '12px 8px' : '16px 20px',
            overflowY: 'auto', alignItems: 'center', gap: '14px',
          }}
        >
          {/* 缝孔径图 */}
          <div style={{ width: '100%', maxWidth: '600px' }}>
            <div style={{ fontFamily: FONT, fontSize: '11px', fontWeight: 600, color: '#1A1A1A', marginBottom: '6px' }}>
              缝孔径示意
            </div>
            <SlitApertureSVG a={a} d={d} N={N} mode={mode} blazeAngle={blazeAngle} width={isMobile ? 300 : 500} height={120} />
          </div>

          {/* 干涉条纹 */}
          <div style={{ width: '100%', maxWidth: '600px' }}>
            <div style={{ fontFamily: FONT, fontSize: '11px', fontWeight: 600, color: '#1A1A1A', marginBottom: '6px' }}>
              屏幕干涉图样
            </div>
            <PatternCanvas
              mode={mode} a={a} d={d} N={N} wavelength={wavelength} L={L}
              blazeAngle={blazeAngle} useWhiteLight={useWhiteLight}
              width={isMobile ? 300 : 560} height={100}
            />
          </div>

          {/* 强度曲线 */}
          <div style={{ width: '100%', maxWidth: '600px' }}>
            <div style={{ fontFamily: FONT, fontSize: '11px', fontWeight: 600, color: '#1A1A1A', marginBottom: '4px' }}>
              强度分布 I(θ)
              {showEnvelope && <span style={{ fontSize: '9px', color: '#999', marginLeft: '8px' }}>— — 包络</span>}
              {showIndividual && <span style={{ fontSize: '9px', color: '#CC8888', marginLeft: '8px' }}>— — 干涉因子</span>}
            </div>
            <IntensityCurveSVG
              mode={mode} a={a} d={d} N={N} wavelength={wavelength} L={L}
              blazeAngle={blazeAngle} showEnvelope={showEnvelope} showIndividual={showIndividual}
              width={isMobile ? 300 : 560} height={180}
            />
          </div>

          {/* 说明 */}
          <div style={{
            width: '100%', maxWidth: '600px',
            padding: '10px 12px', backgroundColor: '#FAFAFA',
            border: '1px solid #E8ECF0', borderRadius: '2px',
            fontFamily: FONT, fontSize: '10px', color: '#666', lineHeight: 1.7,
          }}>
            {mode === 'young-double-slit' && (
              <><b style={{ color: '#333' }}>观察要点：</b>双缝图样 = 单缝包络 × 等间距干涉条纹。增大 d 使条纹变密；增大 a 使包络变窄（更多能量集中中央）。缺级出现在 m = d/a 整数倍处。</>
            )}
            {mode === 'multi-slit-grating' && (
              <><b style={{ color: '#333' }}>观察要点：</b>N 增大时主极大锐化、次极大减弱。分辨本领 R=mN，是光栅分光能力的关键指标。开启「显示干涉因子」可单独观察 (sinNα/sinα)² 项。</>
            )}
            {mode === 'blazed-grating' && (
              <><b style={{ color: '#333' }}>观察要点：</b>闪耀光栅将能量集中于特定级次（通常 m=1）。调节闪耀角 θ_b 使该级次满足闪耀条件 sinθ_m = mλ/d - sinθ_b。与振幅光栅相比效率显著提升。</>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function ResultItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontFamily: "system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif", fontSize: '9px', color: '#999' }}>{label}</div>
      <div className="tabular-nums" style={{ fontFamily: 'var(--font-geist-mono), ui-monospace, monospace', fontSize: '12px', fontWeight: 600, color: '#1A1A1A' }}>{value}</div>
    </div>
  )
}
