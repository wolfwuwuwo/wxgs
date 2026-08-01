'use client'

/* ═══════════════════════════════════════════════════════════════════
   PhotonicCrystal — 光子晶体带隙仿真
   3 种晶格：1D 多层膜 · 2D 正方 · 2D 三角
   带隙图 · 缺陷态 · 透射谱
   ═══════════════════════════════════════════════════════════════════ */

import { useState, useRef, useMemo, useEffect } from 'react'
import { Slider } from '@/components/ui/slider'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useIsMobile } from '@/hooks/use-mobile'
import { ControlPanel, MobilePanelToggle } from './shared/ControlPanel'
import { TearOffButton } from './shared/TearOffPanel'
import { useSnapshotTarget } from '@/hooks/use-snapshot-target'

const FONT = "system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif"
const MONO = 'var(--font-geist-mono), ui-monospace, monospace'
const VIEW_ID = 'modern-photonic' as const

type LatticeType = '1d-multilayer' | '2d-square' | '2d-triangular'

const LATTICE_LABELS: Record<LatticeType, string> = {
  '1d-multilayer': '1D 多层膜',
  '2d-square': '2D 正方晶格',
  '2d-triangular': '2D 三角晶格',
}

const LATTICE_DESC: Record<LatticeType, string> = {
  '1d-multilayer': '高低折射率交替周期结构 (Bragg 镜)。沿周期方向有带隙，垂直方向无。',
  '2d-square': '正方排列介电柱。Γ-X 方向带隙较窄，全方向带隙需较大对比度。',
  '2d-triangular': '三角排列介电柱。具有更宽的全方向带隙，是光子晶体光纤的基础。',
}

const HIGH_N_COLOR = '#1A1A1A'
const LOW_N_COLOR = '#FAFAFA'
const BAND_COLOR = '#CC0000'
const TRANS_COLOR = '#0066CC'

/* ─── 1D 多层膜透射率计算 (传输矩阵法) ─── */
function compute1DBandStructure(n1: number, n2: number, d1: number, d2: number, N: number) {
  // 周期 = d1 + d2
  const a = d1 + d2 // 周期
  // 归一化频率 ωa/(2πc) 范围 [0, 0.5]
  const numFreq = 200
  const freqs: number[] = []
  const transmissions: number[] = []
  const bandGaps: { start: number; end: number }[] = []

  let inGap = false
  let gapStart = 0

  for (let i = 0; i < numFreq; i++) {
    const omega_norm = (i / numFreq) * 0.5 // ωa/(2πc)
    const f_phys = omega_norm // 简化
    // 光在每层中的相位
    const k1 = (2 * Math.PI * n1 * f_phys) / a
    const k2 = (2 * Math.PI * n2 * f_phys) / a
    // 每层传输矩阵 M_i = [cos(ki*di), -sin(ki*di)/ki; ki*sin(ki*di), cos(ki*di)]
    const M1 = {
      a: Math.cos(k1 * d1),
      b: Math.sin(k1 * d1) / k1,
      c: -k1 * Math.sin(k1 * d1),
      d: Math.cos(k1 * d1),
    }
    const M2 = {
      a: Math.cos(k2 * d2),
      b: Math.sin(k2 * d2) / k2,
      c: -k2 * Math.sin(k2 * d2),
      d: Math.cos(k2 * d2),
    }
    // 一个周期
    const Mc = matMul(M2, M1)
    // N 个周期
    let MN = { a: 1, b: 0, c: 0, d: 1 }
    for (let p = 0; p < N; p++) MN = matMul(MN, Mc)
    // 透射率 T = 1 / (1 + 0.5 * |M[0,0]|² - 0.5 * |M[0,1]|² * k² - Re(M[0,0] * M[1,0]*) / k * ...)
    // 简化：T = |t|², t = 2 / (M[0,0] + M[0,1]*k0 + M[1,0]/k0 + M[1,1])
    // 假设两侧都是空气 k0 = 2π·f/c
    const k0 = (2 * Math.PI * f_phys) / a
    if (Math.abs(k0) < 1e-10) {
      freqs.push(omega_norm)
      transmissions.push(1)
      if (inGap) { bandGaps.push({ start: gapStart, end: omega_norm }); inGap = false }
      continue
    }
    const denom = MN.a + MN.b * k0 + MN.c / k0 + MN.d
    const t = 2 / denom
    const T = Math.min(1, Math.abs(t) * Math.abs(t))
    freqs.push(omega_norm)
    transmissions.push(T)
    // 带隙检测
    if (T < 0.01) {
      if (!inGap) { inGap = true; gapStart = omega_norm }
    } else {
      if (inGap) { bandGaps.push({ start: gapStart, end: omega_norm }); inGap = false }
    }
  }
  if (inGap) bandGaps.push({ start: gapStart, end: 0.5 })

  return { freqs, transmissions, bandGaps, a }
}

interface Matrix2x2 { a: number; b: number; c: number; d: number }
function matMul(m1: Matrix2x2, m2: Matrix2x2): Matrix2x2 {
  return {
    a: m1.a * m2.a + m1.b * m2.c,
    b: m1.a * m2.b + m1.b * m2.d,
    c: m1.c * m2.a + m1.d * m2.c,
    d: m1.c * m2.b + m1.d * m2.d,
  }
}

/* ─── 2D 正方/三角晶格带隙近似（基于平面波展开法的简化模型） ─── */
function compute2DBandStructure(lattice: '2d-square' | '2d-triangular', n_high: number, n_low: number, r_ratio: number) {
  // 简化模型：基于有效折射率和周期性，估算第一带隙
  // 实际平面波展开法需要矩阵本征值求解，此处用近似
  const n_eff = Math.sqrt(n_high * n_high * r_ratio + n_low * n_low * (1 - r_ratio))
  const contrast = n_high / n_low
  // 第一带隙中心位置 (归一化频率 ωa/2πc)
  // 正方：中心约 0.3-0.4，宽度 ~0.05-0.15 * contrast
  // 三角：中心约 0.25-0.35，宽度更宽
  const center = lattice === '2d-square' ? 0.35 : 0.28
  const width = lattice === '2d-square' ? 0.06 * (contrast - 1) : 0.12 * (contrast - 1)
  // 生成 3 条带
  const bands: { freqs: number[]; kPoints: string[] } = {
    freqs: [],
    kPoints: ['Γ', 'X', 'M', 'Γ'],
  }
  // 沿 Γ-X-M-Γ 高对称路径
  const N = 60
  for (let i = 0; i <= N; i++) {
    const t = i / N
    let kpath: number
    if (t < 0.33) {
      kpath = t / 0.33 // Γ to X
      bands.freqs.push(0.05 + kpath * 0.15)
    } else if (t < 0.66) {
      kpath = (t - 0.33) / 0.33 // X to M
      bands.freqs.push(0.2 + kpath * 0.12 + 0.05)
    } else {
      kpath = (t - 0.66) / 0.34 // M to Γ
      bands.freqs.push(0.37 - kpath * 0.32)
    }
  }
  // 第二条带
  const band2 = bands.freqs.map(f => f + 0.15 + width * 0.5)
  // 第三条带
  const band3 = band2.map(f => f + 0.12)

  // 带隙：band2 最低 - band1 最高
  const band1Max = Math.max(...bands.freqs)
  const band2Min = Math.min(...band2)
  const gapWidth = band2Min - band1Max

  return {
    band1: bands.freqs,
    band2,
    band3,
    kLabels: bands.kPoints,
    gapCenter: (band1Max + band2Min) / 2,
    gapWidth: Math.max(0, gapWidth),
    gapRatio: Math.max(0, gapWidth / band1Max),
  }
}

/* ═══════════════════════════════════════════════════════════════════
   1D 多层膜结构 SVG
   ═══════════════════════════════════════════════════════════════════ */
function MultilayerSVG({
  n1, n2, d1, d2, N, width, height, hasDefect,
}: {
  n1: number; n2: number; d1: number; d2: number; N: number
  width: number; height: number; hasDefect: boolean
}) {
  const cy = height / 2
  const totalLayers = hasDefect ? N * 2 + 1 + N * 2 : N * 2
  const layerWidth = (width - 40) / totalLayers
  const x0 = 20
  const layers: { x: number; w: number; n: number; isDefect?: boolean }[] = []
  let x = x0
  for (let i = 0; i < N; i++) {
    layers.push({ x, w: layerWidth, n: n1 })
    x += layerWidth
    layers.push({ x, w: layerWidth, n: n2 })
    x += layerWidth
  }
  if (hasDefect) {
    // 缺陷层：宽度为 2 倍，折射率居中
    const defectN = (n1 + n2) / 2
    layers.push({ x, w: layerWidth * 2, n: defectN, isDefect: true })
    x += layerWidth * 2
    for (let i = 0; i < N; i++) {
      layers.push({ x, w: layerWidth, n: n2 })
      x += layerWidth
      layers.push({ x, w: layerWidth, n: n1 })
      x += layerWidth
    }
  }

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
      <rect width={width} height={height} fill="#FFFFFF" />
      {/* 层 */}
      {layers.map((l, i) => (
        <g key={i}>
          <rect x={l.x} y={20} width={l.w} height={height - 40} fill={l.isDefect ? '#CC0000' : l.n > 1.5 ? HIGH_N_COLOR : LOW_N_COLOR} stroke={l.isDefect ? '#1A1A1A' : '#D0D0D0'} strokeWidth="0.5" />
          {l.isDefect && (
            <text x={l.x + l.w / 2} y={14} textAnchor="middle" fontSize="9" fill="#CC0000" fontFamily={FONT} fontWeight="600">缺陷层</text>
          )}
        </g>
      ))}
      {/* 标签 */}
      <text x={x0} y={height - 6} fontSize="9" fill="#888" fontFamily={FONT}>n₂={n2}</text>
      <text x={x0 + layerWidth} y={height - 6} fontSize="9" fill="#888" fontFamily={FONT}>n₁={n1}</text>
      <text x={width - 60} y={height - 6} fontSize="9" fill="#888" fontFamily={FONT}>N={N}</text>
      {/* 光线方向 */}
      <g>
        <line x1={4} y1={cy} x2={x0 - 4} y2={cy} stroke={TRANS_COLOR} strokeWidth="1" markerEnd="url(#arrow-phot)" />
        <defs>
          <marker id="arrow-phot" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <polygon points="0,0 6,3 0,6" fill={TRANS_COLOR} />
          </marker>
        </defs>
        <text x={4} y={cy - 6} fontSize="9" fill={TRANS_COLOR} fontFamily={FONT}>入射光</text>
      </g>
    </svg>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   2D 晶格结构 SVG
   ═══════════════════════════════════════════════════════════════════ */
function Lattice2DSVG({
  type, n_high, n_low, r_ratio, width, height, hasDefect,
}: {
  type: '2d-square' | '2d-triangular'
  n_high: number
  n_low: number
  r_ratio: number
  width: number
  height: number
  hasDefect: boolean
}) {
  const a = 36 // 晶格常数 (像素)
  const r = a * r_ratio
  const cols = Math.floor(width / a)
  const rows = Math.floor(height / a)

  const positions: { cx: number; cy: number; isDefect?: boolean }[] = []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      let cx = col * a + a / 2
      let cy = row * a + a / 2
      if (type === '2d-triangular') {
        cx += (row % 2) * a / 2
      }
      // 中心缺陷
      const centerCol = cols / 2
      const centerRow = rows / 2
      const isCenter = type === '2d-triangular'
        ? Math.abs(cx - width / 2) < a / 2 && Math.abs(cy - height / 2) < a / 2
        : col === Math.floor(centerCol) && row === Math.floor(centerRow)
      if (isCenter && hasDefect) {
        positions.push({ cx, cy, isDefect: true })
      } else {
        positions.push({ cx, cy })
      }
    }
  }

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
      <rect width={width} height={height} fill={n_low > 1 ? '#F0F3F6' : '#FFFFFF'} />
      {/* 晶格常数标注 */}
      <g>
        <line x1={4} y1={height - 16} x2={4 + a} y2={height - 16} stroke="#888" strokeWidth="0.8" />
        <line x1={4} y1={height - 19} x2={4} y2={height - 13} stroke="#888" strokeWidth="0.8" />
        <line x1={4 + a} y1={height - 19} x2={4 + a} y2={height - 13} stroke="#888" strokeWidth="0.8" />
        <text x={4 + a / 2} y={height - 4} textAnchor="middle" fontSize="9" fill="#888" fontFamily={MONO}>a</text>
      </g>
      {/* 介电柱 */}
      {positions.map((p, i) => (
        <g key={i}>
          {p.isDefect ? (
            <circle cx={p.cx} cy={p.cy} r={r} fill="#CC0000" stroke="#1A1A1A" strokeWidth="0.8" />
          ) : (
            <circle cx={p.cx} cy={p.cy} r={r} fill={HIGH_N_COLOR} stroke="none" />
          )}
        </g>
      ))}
      {/* 缺陷标记 */}
      {hasDefect && (
        <g>
          <circle cx={width / 2} cy={height / 2} r={r * 2.5} fill="none" stroke="#CC0000" strokeWidth="1" strokeDasharray="3,2" />
          <text x={width / 2} y={height / 2 + r * 2.5 + 14} textAnchor="middle" fontSize="10" fill="#CC0000" fontFamily={FONT} fontWeight="600">缺陷态</text>
        </g>
      )}
    </svg>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   透射谱 Canvas
   ═══════════════════════════════════════════════════════════════════ */
function TransmissionCanvas({
  data, width, height, hasDefect,
}: {
  data: ReturnType<typeof compute1DBandStructure>
  width: number
  height: number
  hasDefect: boolean
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

    // 背景
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(0, 0, width, height)

    const padding = { top: 20, right: 20, bottom: 30, left: 40 }
    const plotW = width - padding.left - padding.right
    const plotH = height - padding.top - padding.bottom

    // 坐标轴
    ctx.strokeStyle = '#888'
    ctx.lineWidth = 0.6
    ctx.beginPath()
    ctx.moveTo(padding.left, padding.top)
    ctx.lineTo(padding.left, padding.top + plotH)
    ctx.lineTo(padding.left + plotW, padding.top + plotH)
    ctx.stroke()

    // 网格
    ctx.strokeStyle = '#E8ECF0'
    ctx.lineWidth = 0.4
    for (let i = 1; i <= 5; i++) {
      const y = padding.top + plotH - (i / 5) * plotH
      ctx.beginPath()
      ctx.moveTo(padding.left, y)
      ctx.lineTo(padding.left + plotW, y)
      ctx.stroke()
    }

    // 带隙区域填充
    data.bandGaps.forEach(gap => {
      const x1 = padding.left + (gap.start / 0.5) * plotW
      const x2 = padding.left + (gap.end / 0.5) * plotW
      ctx.fillStyle = 'rgba(204, 0, 0, 0.08)'
      ctx.fillRect(x1, padding.top, x2 - x1, plotH)
      // 带隙标注
      ctx.fillStyle = '#CC0000'
      ctx.font = "9px system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif"
      ctx.textAlign = 'center'
      ctx.fillText('带隙', (x1 + x2) / 2, padding.top + 12)
    })

    // 透射率曲线
    ctx.strokeStyle = hasDefect ? '#0066CC' : BAND_COLOR
    ctx.lineWidth = 1.4
    ctx.beginPath()
    data.freqs.forEach((f, i) => {
      const x = padding.left + (f / 0.5) * plotW
      const y = padding.top + plotH - data.transmissions[i] * plotH
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()

    // 轴标签
    ctx.fillStyle = '#888'
    ctx.font = '9px var(--font-geist-mono), monospace'
    ctx.textAlign = 'center'
    for (let i = 0; i <= 5; i++) {
      const x = padding.left + (i / 5) * plotW
      ctx.fillText((i / 10).toFixed(1), x, padding.top + plotH + 14)
    }
    ctx.textAlign = 'right'
    for (let i = 0; i <= 5; i++) {
      const y = padding.top + plotH - (i / 5) * plotH
      ctx.fillText((i / 5).toFixed(1), padding.left - 4, y + 3)
    }
    // 标题
    ctx.fillStyle = '#1A1A1A'
    ctx.font = "10px system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif"
    ctx.textAlign = 'left'
    ctx.fillText('透射率 T', padding.left, padding.top - 6)
    ctx.textAlign = 'right'
    ctx.fillText('归一化频率 ωa/2πc', padding.left + plotW, padding.top + plotH + 24)
  }, [data, width, height, hasDefect])

  return <canvas ref={canvasRef} />
}

/* ═══════════════════════════════════════════════════════════════════
   2D 能带图 Canvas
   ═══════════════════════════════════════════════════════════════════ */
function BandStructureCanvas({
  data, width, height,
}: {
  data: ReturnType<typeof compute2DBandStructure>
  width: number
  height: number
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

    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(0, 0, width, height)

    const padding = { top: 20, right: 20, bottom: 30, left: 40 }
    const plotW = width - padding.left - padding.right
    const plotH = height - padding.top - padding.bottom

    // 带隙填充
    const band1Max = Math.max(...data.band1)
    const band2Min = Math.min(...data.band2)
    if (band2Min > band1Max) {
      ctx.fillStyle = 'rgba(204, 0, 0, 0.1)'
      ctx.fillRect(padding.left, padding.top + plotH - band2Min * plotH / 0.6, plotW, (band2Min - band1Max) * plotH / 0.6)
    }

    // 坐标轴
    ctx.strokeStyle = '#888'
    ctx.lineWidth = 0.6
    ctx.beginPath()
    ctx.moveTo(padding.left, padding.top)
    ctx.lineTo(padding.left, padding.top + plotH)
    ctx.lineTo(padding.left + plotW, padding.top + plotH)
    ctx.stroke()

    // 三条能带
    const bands = [data.band1, data.band2, data.band3]
    const colors = ['#1A1A1A', '#0066CC', '#00AA44']
    bands.forEach((band, idx) => {
      ctx.strokeStyle = colors[idx]
      ctx.lineWidth = 1.6
      ctx.beginPath()
      band.forEach((f, i) => {
        const x = padding.left + (i / (band.length - 1)) * plotW
        const y = padding.top + plotH - (f / 0.6) * plotH
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.stroke()
    })

    // 高对称点
    const labels = data.kLabels
    labels.forEach((label, i) => {
      const x = padding.left + (i / (labels.length - 1)) * plotW
      ctx.strokeStyle = '#E8ECF0'
      ctx.lineWidth = 0.4
      ctx.beginPath()
      ctx.moveTo(x, padding.top)
      ctx.lineTo(x, padding.top + plotH)
      ctx.stroke()
      ctx.fillStyle = '#1A1A1A'
      ctx.font = "10px system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif"
      ctx.textAlign = 'center'
      ctx.fillText(label, x, padding.top + plotH + 14)
    })

    // 轴标签
    ctx.fillStyle = '#888'
    ctx.font = '9px var(--font-geist-mono), monospace'
    ctx.textAlign = 'right'
    for (let i = 0; i <= 6; i++) {
      const y = padding.top + plotH - (i / 6) * plotH
      ctx.fillText((i / 10).toFixed(1), padding.left - 4, y + 3)
    }
    ctx.fillStyle = '#1A1A1A'
    ctx.font = "10px system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif"
    ctx.textAlign = 'left'
    ctx.fillText('频率 ωa/2πc', padding.left, padding.top - 6)

    // 带隙标注
    if (data.gapWidth > 0) {
      const gapY = padding.top + plotH - data.gapCenter * plotH / 0.6
      ctx.fillStyle = '#CC0000'
      ctx.font = "9px system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif"
      ctx.textAlign = 'left'
      ctx.fillText(`Δω = ${data.gapWidth.toFixed(3)}`, padding.left + plotW - 80, gapY + 4)
    }
  }, [data, width, height])

  return <canvas ref={canvasRef} />
}

/* ═══════════════════════════════════════════════════════════════════
   主组件
   ═══════════════════════════════════════════════════════════════════ */
interface Props {
  onBack: () => void
}

export default function PhotonicCrystal({ onBack }: Props) {
  const isMobile = useIsMobile()
  const [panelOpen, setPanelOpen] = useState(false)
  const [lattice, setLattice] = useState<LatticeType>('1d-multilayer')
  const [n1, setN1] = useState(2.5) // 高折射率 (TiO2)
  const [n2, setN2] = useState(1.5) // 低折射率 (SiO2)
  const [N, setN] = useState(8) // 周期数
  const [r_ratio, setR_ratio] = useState(0.25) // 2D 填充比
  const [hasDefect, setHasDefect] = useState(false)
  const vizRef = useRef<HTMLDivElement>(null)

  const is1D = lattice === '1d-multilayer'
  const data1D = useMemo(() => is1D ? compute1DBandStructure(n1, n2, 0.5, 0.5, N) : null, [is1D, n1, n2, N])
  const data2D = useMemo(() => !is1D ? compute2DBandStructure(lattice as '2d-square' | '2d-triangular', n1, n2, r_ratio) : null, [is1D, lattice, n1, n2, r_ratio])

  // 缺陷态：在带隙中引入一个透射峰
  const defectData1D = useMemo(() => {
    if (!is1D || !data1D) return null
    if (!hasDefect) return data1D
    // 缺陷态：在带隙中心加一个窄透射峰
    const newTrans = data1D.transmissions.map((t, i) => {
      const f = data1D.freqs[i]
      // 在第一个带隙中心加 Lorentzian 峰
      if (data1D.bandGaps.length > 0) {
        const gap = data1D.bandGaps[0]
        const center = (gap.start + gap.end) / 2
        const width = (gap.end - gap.start) * 0.1
        const peak = 1 / (1 + Math.pow((f - center) / width, 2))
        return Math.max(t, peak)
      }
      return t
    })
    return { ...data1D, transmissions: newTrans }
  }, [is1D, data1D, hasDefect])

  useSnapshotTarget(VIEW_ID, {
    targetRef: vizRef,
    getTitle: () => `${LATTICE_LABELS[lattice]} · n₁=${n1} n₂=${n2}${hasDefect ? ' · 含缺陷态' : ''}`,
    getParams: () => [
      { key: '晶格', value: LATTICE_LABELS[lattice] },
      { key: 'n₁', value: String(n1) },
      { key: 'n₂', value: String(n2) },
      ...(is1D ? [{ key: 'N', value: String(N) }] : [{ key: 'r/a', value: r_ratio.toFixed(2) }]),
      ...(hasDefect ? [{ key: '缺陷', value: '有' }] : []),
    ],
  })

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
          光子晶体带隙仿真
        </h1>
        {!isMobile && (
          <span style={{ marginLeft: '4px', fontSize: '9px', color: '#888888',
            border: '1px solid #D0D0D0', borderRadius: '2px', padding: '1px 6px', flexShrink: 0 }}>
            Bragg: 2n₁d₁ = mλ
          </span>
        )}

        <div className={isMobile ? 'flex overflow-x-auto mobile-x-scroll flex-1 min-w-0' : 'flex'} style={{
          marginLeft: isMobile ? '8px' : 'auto', gap: '2px', flexWrap: 'nowrap' as const,
        }}>
          {(Object.keys(LATTICE_LABELS) as LatticeType[]).map(l => (
            <button
              key={l}
              onClick={() => setLattice(l)}
              style={{
                fontFamily: FONT, fontSize: isMobile ? '11px' : '12px', fontWeight: 500,
                padding: '4px 10px', minHeight: '44px',
                border: '1px solid ' + (lattice === l ? '#1A1A1A' : '#D0D0D0'),
                backgroundColor: lattice === l ? '#1A1A1A' : '#FFFFFF',
                color: lattice === l ? '#FFFFFF' : '#555555',
                cursor: 'pointer', borderRadius: '2px',
                transition: 'all 120ms ease-out',
                whiteSpace: 'nowrap', flexShrink: 0,
              }}
            >
              {LATTICE_LABELS[l]}
            </button>
          ))}
        </div>

        {isMobile && <MobilePanelToggle onClick={() => setPanelOpen(true)} label="参数" />}
        <TearOffButton
          viewId={VIEW_ID}
          title={`${LATTICE_LABELS[lattice]} · n₁=${n1} n₂=${n2}`}
          params={[
            { key: 'n₁', value: String(n1) },
            { key: 'n₂', value: String(n2) },
            ...(is1D ? [{ key: 'N', value: String(N) }] : []),
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
          title="光子晶体参数"
          desktopWidth="w-80"
        >
          <div className="space-y-5">
            {/* 模式说明 */}
            <div style={{
              padding: '8px 10px', backgroundColor: '#FAFAFA',
              border: '1px solid #E8ECF0', borderRadius: '2px',
            }}>
              <div style={{ fontFamily: FONT, fontSize: '10px', color: '#888', marginBottom: '3px', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                当前晶格
              </div>
              <div style={{ fontFamily: FONT, fontSize: '12px', fontWeight: 600, color: '#1A1A1A', marginBottom: '4px' }}>
                {LATTICE_LABELS[lattice]}
              </div>
              <div style={{ fontFamily: FONT, fontSize: '10px', color: '#666', lineHeight: 1.5 }}>
                {LATTICE_DESC[lattice]}
              </div>
            </div>

            {/* 高折射率 n1 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-[12px] text-[#2d3142]">高折射率 n₁</Label>
                <span className="tabular-nums text-[11px] text-[#6b7280]" style={{ fontFamily: MONO }}>{n1.toFixed(2)}</span>
              </div>
              <Slider value={[n1 * 100]} min={150} max={400} step={5} onValueChange={([v]) => setN1(v / 100)} />
              <div className="flex justify-between text-[9px] text-[#aaa]">
                <span>1.50</span><span>4.00</span>
              </div>
              {/* 常用材料 */}
              <div className="flex gap-1 flex-wrap" style={{ marginTop: '4px' }}>
                {[
                  { n: 1.5, label: 'SiO₂' },
                  { n: 2.0, label: '玻璃' },
                  { n: 2.5, label: 'TiO₂' },
                  { n: 3.5, label: 'Si' },
                ].map(m => (
                  <button key={m.label} onClick={() => setN1(m.n)} style={{
                    fontFamily: MONO, fontSize: '9px', color: n1 === m.n ? '#1A1A1A' : '#888',
                    background: n1 === m.n ? '#F0F3F6' : 'none',
                    border: `1px solid ${n1 === m.n ? '#1A1A1A' : '#D0D0D0'}`,
                    borderRadius: '2px', padding: '1px 5px', cursor: 'pointer',
                  }}>{m.label}</button>
                ))}
              </div>
            </div>

            {/* 低折射率 n2 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-[12px] text-[#2d3142]">低折射率 n₂</Label>
                <span className="tabular-nums text-[11px] text-[#6b7280]" style={{ fontFamily: MONO }}>{n2.toFixed(2)}</span>
              </div>
              <Slider value={[n2 * 100]} min={100} max={250} step={5} onValueChange={([v]) => setN2(v / 100)} />
              <div className="flex justify-between text-[9px] text-[#aaa]">
                <span>1.00 (空气)</span><span>2.50</span>
              </div>
            </div>

            {/* 1D: 周期数 / 2D: 填充比 */}
            {is1D ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-[12px] text-[#2d3142]">周期数 N</Label>
                  <span className="tabular-nums text-[11px] text-[#6b7280]" style={{ fontFamily: MONO }}>{N}</span>
                </div>
                <Slider value={[N]} min={2} max={30} step={1} onValueChange={([v]) => setN(v)} />
                <div className="flex justify-between text-[9px] text-[#aaa]">
                  <span>2</span><span>30</span>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-[12px] text-[#2d3142]">填充比 r/a</Label>
                  <span className="tabular-nums text-[11px] text-[#6b7280]" style={{ fontFamily: MONO }}>{r_ratio.toFixed(2)}</span>
                </div>
                <Slider value={[r_ratio * 100]} min={5} max={45} step={1} onValueChange={([v]) => setR_ratio(v / 100)} />
                <div className="flex justify-between text-[9px] text-[#aaa]">
                  <span>0.05</span><span>0.45</span>
                </div>
              </div>
            )}

            {/* 缺陷态开关 */}
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-[12px] text-[#2d3142]">引入缺陷态</Label>
                <p style={{ fontFamily: FONT, fontSize: '9px', color: '#888', margin: '2px 0 0 0' }}>在带隙中形成窄透射峰</p>
              </div>
              <Switch checked={hasDefect} onCheckedChange={setHasDefect} />
            </div>

            {/* 带隙信息 */}
            <div style={{
              padding: '10px 12px', backgroundColor: '#FFFFFF',
              border: '1px solid #1A1A1A', borderRadius: '2px',
            }}>
              <div style={{ fontFamily: FONT, fontSize: '10px', fontWeight: 600, color: '#1A1A1A', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '8px' }}>
                带隙信息
              </div>
              {is1D && data1D && (
                <div className="space-y-1.5" style={{ fontFamily: FONT, fontSize: '11px' }}>
                  {data1D.bandGaps.length > 0 ? (
                    <>
                      <Row label="带隙数" value={`${data1D.bandGaps.length}`} />
                      {data1D.bandGaps.slice(0, 3).map((g, i) => (
                        <Row key={i} label={`第${i + 1}带隙`} value={`${g.start.toFixed(3)} - ${g.end.toFixed(3)}`} highlight={i === 0} />
                      ))}
                      <Row label="对比度 n₁/n₂" value={(n1 / n2).toFixed(2)} />
                    </>
                  ) : (
                    <div style={{ color: '#888', fontSize: '10px' }}>当前参数下无完整带隙</div>
                  )}
                </div>
              )}
              {!is1D && data2D && (
                <div className="space-y-1.5" style={{ fontFamily: FONT, fontSize: '11px' }}>
                  <Row label="带隙中心" value={data2D.gapCenter.toFixed(3)} highlight />
                  <Row label="带隙宽度" value={data2D.gapWidth.toFixed(3)} highlight />
                  <Row label="带隙比例 Δω/ω" value={`${(data2D.gapRatio * 100).toFixed(1)}%`} />
                  <Row label="对比度 n₁/n₂" value={(n1 / n2).toFixed(2)} />
                </div>
              )}
            </div>

            {/* 提示 */}
            <div style={{
              padding: '8px 10px', backgroundColor: '#FAFAFA',
              border: '1px solid #E8ECF0', borderRadius: '2px',
              fontFamily: FONT, fontSize: '10px', color: '#888', lineHeight: 1.6,
            }}>
              💡 增大折射率对比度可展宽带隙；三角晶格比正方晶格更易形成全方向带隙。缺陷态可在带隙中引入局域光子态。
            </div>
          </div>
        </ControlPanel>

        {/* 可视化区 */}
        <div className="flex-1 flex flex-col" style={{ minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
          <div ref={vizRef} className="flex-1 flex flex-col custom-scrollbar dot-grid" style={{ minHeight: 0, overflow: 'auto' }}>
            {/* 晶格结构 */}
            <div style={{ padding: isMobile ? '12px 8px' : '20px 24px' }}>
              <div style={{
                fontFamily: FONT, fontSize: '11px', fontWeight: 600, color: '#1A1A1A',
                marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px',
              }}>
                <span style={{ width: '4px', height: '12px', backgroundColor: '#1A1A1A', display: 'inline-block' }} />
                晶格结构 · n₁={n1} n₂={n2}
              </div>
              <div style={{
                backgroundColor: '#FFFFFF', border: '1px solid #D0D0D0', borderRadius: '2px',
                padding: '8px', display: 'flex', justifyContent: 'center',
              }}>
                {is1D ? (
                  <MultilayerSVG n1={n1} n2={n2} d1={0.5} d2={0.5} N={N} width={isMobile ? 344 : 744} height={100} hasDefect={hasDefect} />
                ) : (
                  <Lattice2DSVG
                    type={lattice as '2d-square' | '2d-triangular'}
                    n_high={n1} n_low={n2} r_ratio={r_ratio}
                    width={isMobile ? 320 : 360}
                    height={isMobile ? 280 : 320}
                    hasDefect={hasDefect}
                  />
                )}
              </div>
            </div>

            {/* 透射谱 / 能带图 */}
            <div style={{ padding: isMobile ? '0 8px 16px' : '0 24px 24px' }}>
              <div style={{
                fontFamily: FONT, fontSize: '11px', fontWeight: 600, color: '#1A1A1A',
                marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px',
              }}>
                <span style={{ width: '4px', height: '12px', backgroundColor: '#1A1A1A', display: 'inline-block' }} />
                {is1D ? `透射谱 · ${hasDefect ? '含缺陷态（蓝线）' : '完整周期（红线）'}` : '能带结构 · Γ-X-M-Γ'}
              </div>
              <div style={{
                backgroundColor: '#FFFFFF', border: '1px solid #D0D0D0', borderRadius: '2px',
                padding: '8px', display: 'flex', justifyContent: 'center',
              }}>
                {is1D && defectData1D && (
                  <TransmissionCanvas
                    data={defectData1D}
                    width={isMobile ? 344 : 744}
                    height={isMobile ? 180 : 220}
                    hasDefect={hasDefect}
                  />
                )}
                {!is1D && data2D && (
                  <BandStructureCanvas
                    data={data2D}
                    width={isMobile ? 344 : 744}
                    height={isMobile ? 220 : 260}
                  />
                )}
              </div>
            </div>

            {/* 性能卡片 */}
            <div style={{ padding: isMobile ? '0 8px 16px' : '0 24px 24px' }}>
              <div className="grid" style={{
                gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)',
                gap: '8px',
              }}>
                <MetricCard label="折射率对比" value={(n1 / n2).toFixed(2)} unit="×" accent="#CC0000" />
                {is1D && data1D ? (
                  <>
                    <MetricCard label="带隙数" value={String(data1D.bandGaps.length)} unit="" />
                    {data1D.bandGaps[0] && (
                      <MetricCard label="第一带隙宽" value={(data1D.bandGaps[0].end - data1D.bandGaps[0].start).toFixed(3)} unit="" accent="#0066CC" />
                    )}
                    <MetricCard label="周期数" value={String(N)} unit="" />
                  </>
                ) : data2D ? (
                  <>
                    <MetricCard label="带隙宽度" value={data2D.gapWidth.toFixed(3)} unit="" accent="#0066CC" />
                    <MetricCard label="带隙比例" value={(data2D.gapRatio * 100).toFixed(1)} unit="%" />
                    <MetricCard label="带隙中心" value={data2D.gapCenter.toFixed(3)} unit="" />
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── 小组件 ─── */
function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <span style={{ color: '#666' }}>{label}</span>
      <span className="tabular-nums" style={{
        fontFamily: MONO, fontWeight: highlight ? 600 : 500,
        color: highlight ? '#1A1A1A' : '#333',
      }}>
        {value}
      </span>
    </div>
  )
}

function MetricCard({ label, value, unit, accent }: { label: string; value: string; unit: string; accent?: string }) {
  return (
    <div style={{
      backgroundColor: '#FFFFFF', border: '1px solid #D0D0D0', borderRadius: '2px',
      padding: '10px 12px',
    }}>
      <div style={{ fontFamily: FONT, fontSize: '9px', color: '#888', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '4px' }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '3px' }}>
        <span className="tabular-nums" style={{
          fontFamily: MONO, fontSize: '18px', fontWeight: 600,
          color: accent || '#1A1A1A',
        }}>
          {value}
        </span>
        {unit && <span style={{ fontFamily: FONT, fontSize: '10px', color: '#888' }}>{unit}</span>}
      </div>
    </div>
  )
}
