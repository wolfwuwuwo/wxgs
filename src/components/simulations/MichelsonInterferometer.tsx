'use client'

/* ═══════════════════════════════════════════════════════════════════
   MichelsonInterferometer — 迈克尔逊干涉仪仿真
   4 种实验模式：等倾干涉 · 等厚干涉 · 白光干涉 · 条纹计数
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
import { blitImageData } from '@/lib/utils'

/* ─── 常量 ─── */
const FONT = "system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif"
const MONO = 'var(--font-geist-mono), ui-monospace, monospace'
const VIEW_ID = 'physical-michelson' as const

type ExperimentMode = 'equal-inclination' | 'equal-thickness' | 'white-light' | 'fringe-counting'

const MODE_LABELS: Record<ExperimentMode, string> = {
  'equal-inclination': '等倾干涉',
  'equal-thickness': '等厚干涉',
  'white-light': '白光干涉',
  'fringe-counting': '条纹计数',
}

interface WavelengthOption {
  value: number
  label: string
  color: string
}

const WAVELENGTH_OPTIONS: WavelengthOption[] = [
  { value: 632.8, label: '632.8 nm — He-Ne 红', color: '#CC0000' },
  { value: 532, label: '532 nm — Nd:YAG 绿', color: '#00AA00' },
  { value: 589.3, label: '589.3 nm — Na D 黄', color: '#DDAA00' },
  { value: 405, label: '405 nm — 蓝紫', color: '#5500CC' },
]

const WHITE_LIGHT_CHANNELS = [
  { wavelength: 650, color: [255, 30, 30] as [number, number, number] },
  { wavelength: 550, color: [30, 200, 30] as [number, number, number] },
  { wavelength: 450, color: [30, 60, 255] as [number, number, number] },
]

/* ─── 物理：波长 → 颜色 ─── */
function wavelengthToColor(wl: number): string {
  const opt = WAVELENGTH_OPTIONS.find(w => w.value === wl)
  return opt?.color || '#CC0000'
}

/* ─── 等倾干涉强度 ─── */
// I(r) = I0 * (1 + V * cos(2π * d * cos(θ) / λ))
// θ = arctan(r / f), f 为聚焦焦距（此处取经验值）
function inclinationIntensity(
  r: number, d: number, lambda: number, V = 0.95, f = 200
): number {
  const theta = Math.atan(r / f)
  const phase = (2 * Math.PI * 2 * d * Math.cos(theta)) / lambda
  return 0.5 * (1 + V * Math.cos(phase))
}

/* ─── 等厚干涉强度 ─── */
// I(x) = I0 * (1 + V * cos(2π * (2*α*x + d0) / λ))
function thicknessIntensity(
  x: number, d0: number, alpha: number, lambda: number, V = 0.95
): number {
  const phase = (2 * Math.PI * (2 * alpha * x + d0)) / lambda
  return 0.5 * (1 + V * Math.cos(phase))
}

/* ─── 白光干涉：三通道叠加 ─── */
function whiteLightIntensity(
  r: number, d: number, f = 200, V = 0.9
): [number, number, number] {
  const theta = Math.atan(r / f)
  return WHITE_LIGHT_CHANNELS.map(ch => {
    const phase = (2 * Math.PI * 2 * d * Math.cos(theta)) / ch.wavelength
    return 0.5 * (1 + V * Math.cos(phase)) * ch.color[i] / 255
  }).reduce((acc, c, i) => {
    acc[i] = c
    return acc
  }, [0, 0, 0] as [number, number, number]) as [number, number, number]
  // 上面的 reduce 写法有问题，下面用更清晰的实现
}

/* ─── 清晰版白光强度 ─── */
function whiteLightIntensityRGB(
  r: number, d: number, f = 200, V = 0.9
): [number, number, number] {
  const theta = Math.atan(r / f)
  const result: [number, number, number] = [0, 0, 0]
  WHITE_LIGHT_CHANNELS.forEach((ch, i) => {
    const phase = (2 * Math.PI * 2 * d * Math.cos(theta)) / ch.wavelength
    const I = 0.5 * (1 + V * Math.cos(phase))
    // 相干性随 |d| 衰减（相干长度 ~2μm）
    const coherence = Math.exp(-(d * d) / (2 * 2 * 2))
    result[i] = I * (ch.color[i] / 255) * (0.3 + 0.7 * coherence)
  })
  return result
}

/* ═══════════════════════════════════════════════════════════════════
   子组件：迈克尔逊干涉仪光路示意图
   ═══════════════════════════════════════════════════════════════════ */
function InstrumentSchematic({
  beamColor, d, tilt, mode,
}: {
  beamColor: string
  d: number
  tilt: number
  mode: ExperimentMode
}) {
  const W = 380
  const H = 220
  // 光路坐标
  const laser = { x: 20, y: H / 2 }
  const bs = { x: 140, y: H / 2 }       // 分束器
  const m1 = { x: 140, y: 30 }           // 反射镜 M1 (上方)
  const m2 = { x: 280, y: H / 2 }        // 反射镜 M2 (右方，可动)
  const detector = { x: 140, y: H - 30 } // 探测器/观察屏 (下方)

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ maxWidth: '100%', height: 'auto' }}>
      {/* 背景网格点（淡） */}
      <defs>
        <pattern id="mich-grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <circle cx="10" cy="10" r="0.4" fill="#E8ECF0" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="url(#mich-grid)" />

      {/* 光路：激光 → 分束器 */}
      <line x1={laser.x} y1={laser.y} x2={bs.x} y2={bs.y} stroke={beamColor} strokeWidth="2" opacity="0.85" />
      {/* 光路：分束器 → M1（向上）*/}
      <line x1={bs.x} y1={bs.y} x2={m1.x} y2={m1.y} stroke={beamColor} strokeWidth="2" opacity="0.85" />
      {/* 光路：分束器 → M2（向右）*/}
      <line x1={bs.x} y1={bs.y} x2={m2.x} y2={m2.y} stroke={beamColor} strokeWidth="2" opacity="0.85" />
      {/* 光路：M1 → 分束器（返回）*/}
      <line x1={m1.x} y1={m1.y} x2={bs.x} y2={bs.y} stroke={beamColor} strokeWidth="1.5" opacity="0.5" strokeDasharray="3 2" />
      {/* 光路：M2 → 分束器（返回）*/}
      <line x1={m2.x} y1={m2.y} x2={bs.x} y2={bs.y} stroke={beamColor} strokeWidth="1.5" opacity="0.5" strokeDasharray="3 2" />
      {/* 光路：分束器 → 探测器 */}
      <line x1={bs.x} y1={bs.y} x2={detector.x} y2={detector.y} stroke={beamColor} strokeWidth="2" opacity="0.85" />

      {/* 激光器 */}
      <g>
        <rect x={laser.x - 18} y={laser.y - 10} width="18" height="20" fill="#FFFFFF" stroke="#333" strokeWidth="1.2" />
        <rect x={laser.x - 18} y={laser.y - 10} width="5" height="20" fill={beamColor} opacity="0.3" />
        <text x={laser.x - 9} y={laser.y + 26} textAnchor="middle" fontSize="9" fill="#555" fontFamily={FONT}>激光器</text>
      </g>

      {/* 分束器 BS（45°倾斜方块）*/}
      <g>
        <line x1={bs.x - 12} y1={bs.y + 12} x2={bs.x + 12} y2={bs.y - 12} stroke="#333" strokeWidth="1.5" />
        <line x1={bs.x - 12} y1={bs.y + 12} x2={bs.x + 12} y2={bs.y + 12} stroke="#333" strokeWidth="0.6" opacity="0.4" />
        <line x1={bs.x + 12} y1={bs.y - 12} x2={bs.x + 12} y2={bs.y + 12} stroke="#333" strokeWidth="0.6" opacity="0.4" />
        <line x1={bs.x - 12} y1={bs.y - 12} x2={bs.x + 12} y2={bs.y - 12} stroke="#333" strokeWidth="0.6" opacity="0.4" />
        <line x1={bs.x - 12} y1={bs.y - 12} x2={bs.x - 12} y2={bs.y + 12} stroke="#333" strokeWidth="0.6" opacity="0.4" />
        <text x={bs.x - 18} y={bs.y - 18} fontSize="9" fill="#555" fontFamily={FONT}>BS</text>
      </g>

      {/* 反射镜 M1（上方固定）*/}
      <g>
        <line x1={m1.x - 18} y1={m1.y + 3} x2={m1.x + 18} y2={m1.y + 3} stroke="#333" strokeWidth="2.5" />
        <line x1={m1.x - 18} y1={m1.y + 6} x2={m1.x + 18} y2={m1.y + 6} stroke="#888" strokeWidth="0.8" strokeDasharray="2 1" />
        <text x={m1.x} y={m1.y - 6} textAnchor="middle" fontSize="9" fill="#555" fontFamily={FONT}>M₁ (固定)</text>
      </g>

      {/* 反射镜 M2（右方可动，带位置标记）*/}
      <g transform={`rotate(${tilt * 2} ${m2.x} ${m2.y})`}>
        <line x1={m2.x + 3} y1={m2.y - 18} x2={m2.x + 3} y2={m2.y + 18} stroke="#333" strokeWidth="2.5" />
        <line x1={m2.x + 6} y1={m2.y - 18} x2={m2.x + 6} y2={m2.y + 18} stroke="#888" strokeWidth="0.8" strokeDasharray="2 1" />
        <text x={m2.x + 14} y={m2.y - 22} fontSize="9" fill="#555" fontFamily={FONT}>M₂</text>
      </g>
      {/* M2 位置指示 */}
      <g>
        <line x1={m2.x} y1={m2.y + 24} x2={m2.x} y2={m2.y + 36} stroke="#CC3333" strokeWidth="0.8" />
        <polygon points={`${m2.x - 4},${m2.y + 36} ${m2.x + 4},${m2.y + 36} ${m2.x},${m2.y + 42}`} fill="#CC3333" />
        <text x={m2.x} y={m2.y + 54} textAnchor="middle" fontSize="8" fill="#CC3333" fontFamily={MONO}>
          d={d.toFixed(1)}μm
        </text>
      </g>

      {/* 探测器/观察屏 */}
      <g>
        <rect x={detector.x - 22} y={detector.y - 4} width="44" height="14" fill="#FFFFFF" stroke="#333" strokeWidth="1" />
        <line x1={detector.x - 22} y1={detector.y + 3} x2={detector.x + 22} y2={detector.y + 3} stroke={beamColor} strokeWidth="0.6" opacity="0.5" />
        <text x={detector.x} y={detector.y + 26} textAnchor="middle" fontSize="9" fill="#555" fontFamily={FONT}>
          {mode === 'fringe-counting' ? '光电探测器' : '观察屏'}
        </text>
      </g>

      {/* 光程标注 */}
      <text x={bs.x + 15} y={m1.y + 18} fontSize="8" fill="#888" fontFamily={MONO}>L₁</text>
      <text x={m2.x - 40} y={bs.y - 6} fontSize="8" fill="#888" fontFamily={MONO}>L₂</text>

      {/* 补偿板（虚线） */}
      <line x1={bs.x + 6} y1={bs.y - 12} x2={bs.x + 18} y2={bs.y - 24} stroke="#888" strokeWidth="0.8" strokeDasharray="1.5 1.5" />
      <text x={bs.x + 22} y={bs.y - 22} fontSize="7" fill="#888" fontFamily={FONT}>补偿板</text>
    </svg>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   子组件：干涉条纹画布
   ═══════════════════════════════════════════════════════════════════ */
function FringeCanvas({
  mode, d, tilt, wavelength, width = 360, height = 360,
}: {
  mode: ExperimentMode
  d: number
  tilt: number
  wavelength: number
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

    const imageData = ctx.createImageData(width, height)
    const data = imageData.data
    const cx = width / 2
    const cy = height / 2

    // d 转换为纳米（输入 μm）
    const d_nm = d * 1000

    if (mode === 'equal-inclination') {
      // 圆形条纹
      const beamColor = wavelengthToColor(wavelength)
      const [br, bg, bb] = hexToRgb(beamColor)
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const dx = x + 0.5 - cx
          const dy = y + 0.5 - cy
          const r = Math.sqrt(dx * dx + dy * dy)
          // 仅在圆内绘制，圆外透明（与背景对齐，无错位）
          if (r > width / 2) {
            const idx = (y * width + x) * 4
            data[idx + 3] = 0  // 透明，让 CSS bg-white 透过
            continue
          }
          const I = inclinationIntensity(r, d_nm, wavelength, 0.95, 250)
          const idx = (y * width + x) * 4
          data[idx] = br * I
          data[idx + 1] = bg * I
          data[idx + 2] = bb * I
          data[idx + 3] = 255
        }
      }
    } else if (mode === 'equal-thickness') {
      // 直条纹（带轻微弯曲）
      const beamColor = wavelengthToColor(wavelength)
      const [br, bg, bb] = hexToRgb(beamColor)
      const alpha_rad = tilt * Math.PI / 180
      // x 坐标尺度：画布宽度对应 ~2mm 物理尺度
      const scale = 2000 // nm per pixel
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const dx = x + 0.5 - cx
          const dy = y + 0.5 - cy
          // 仅在圆内，圆外透明
          if (Math.sqrt(dx * dx + dy * dy) > width / 2) {
            const idx = (y * width + x) * 4
            data[idx + 3] = 0
            continue
          }
          const x_nm = dx * scale
          const I = thicknessIntensity(x_nm, d_nm, alpha_rad, wavelength, 0.95)
          const idx = (y * width + x) * 4
          data[idx] = br * I
          data[idx + 1] = bg * I
          data[idx + 2] = bb * I
          data[idx + 3] = 255
        }
      }
    } else if (mode === 'white-light') {
      // 白光干涉：三通道
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const dx = x + 0.5 - cx
          const dy = y + 0.5 - cy
          const r = Math.sqrt(dx * dx + dy * dy)
          if (r > width / 2) {
            const idx = (y * width + x) * 4
            data[idx + 3] = 0
            continue
          }
          const [R, G, B] = whiteLightIntensityRGB(r, d_nm, 250, 0.9)
          const idx = (y * width + x) * 4
          data[idx] = R * 255
          data[idx + 1] = G * 255
          data[idx + 2] = B * 255
          data[idx + 3] = 255
        }
      }
    } else if (mode === 'fringe-counting') {
      // 条纹计数：显示当前圆形条纹 + 中心十字标
      const beamColor = wavelengthToColor(wavelength)
      const [br, bg, bb] = hexToRgb(beamColor)
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const dx = x + 0.5 - cx
          const dy = y + 0.5 - cy
          const r = Math.sqrt(dx * dx + dy * dy)
          if (r > width / 2) {
            const idx = (y * width + x) * 4
            data[idx + 3] = 0
            continue
          }
          const I = inclinationIntensity(r, d_nm, wavelength, 0.95, 250)
          const idx = (y * width + x) * 4
          data[idx] = br * I
          data[idx + 1] = bg * I
          data[idx + 2] = bb * I
          data[idx + 3] = 255
        }
      }
    }

    blitImageData(ctx, imageData, width, height)

    // 圆形边框（与 CSS border-radius 对齐，确保圆形图像与背景无缝衔接）
    ctx.strokeStyle = '#333333'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(cx, cy, width / 2 - 0.5, 0, Math.PI * 2)
    ctx.stroke()

    // 条纹计数模式：中心十字标
    if (mode === 'fringe-counting') {
      ctx.strokeStyle = '#FFFF00'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(cx - 8, cy); ctx.lineTo(cx + 8, cy)
      ctx.moveTo(cx, cy - 8); ctx.lineTo(cx, cy + 8)
      ctx.stroke()
    }
  }, [mode, d, tilt, wavelength, width, height])

  return (
    <canvas
      ref={canvasRef}
      className="bg-white"
      style={{ maxWidth: '100%', height: 'auto', borderRadius: '50%', border: '1px solid #333333' }}
    />
  )
}

/* ─── hex → rgb ─── */
function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '')
  return [
    parseInt(m.slice(0, 2), 16),
    parseInt(m.slice(2, 4), 16),
    parseInt(m.slice(4, 6), 16),
  ]
}

/* ═══════════════════════════════════════════════════════════════════
   子组件：强度截面图（1D）
   ═══════════════════════════════════════════════════════════════════ */
function IntensityProfileSVG({
  mode, d, tilt, wavelength, width = 360, height = 100,
}: {
  mode: ExperimentMode
  d: number
  tilt: number
  wavelength: number
  width?: number
  height?: number
}) {
  const padding = { left: 32, right: 8, top: 8, bottom: 18 }
  const plotW = width - padding.left - padding.right
  const plotH = height - padding.top - padding.bottom

  // 采样
  const samples = 120
  const points: string[] = []
  const d_nm = d * 1000
  const alpha_rad = tilt * Math.PI / 180
  const beamColor = wavelengthToColor(wavelength)

  for (let i = 0; i <= samples; i++) {
    const t = i / samples // 0..1
    const r = (t - 0.5) * 2 * 180 // -180..180 (像素)
    let I = 0
    if (mode === 'equal-inclination' || mode === 'fringe-counting') {
      I = inclinationIntensity(Math.abs(r), d_nm, wavelength, 0.95, 250)
    } else if (mode === 'equal-thickness') {
      const x_nm = r * 2000
      I = thicknessIntensity(x_nm, d_nm, alpha_rad, wavelength, 0.95)
    } else if (mode === 'white-light') {
      const [R, G, B] = whiteLightIntensityRGB(Math.abs(r), d_nm, 250, 0.9)
      I = (R + G + B) / 3
    }
    const px = padding.left + t * plotW
    const py = padding.top + (1 - I) * plotH
    points.push(`${px},${py}`)
  }

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ maxWidth: '100%', height: 'auto' }}>
      {/* 坐标轴 */}
      <line x1={padding.left} y1={padding.top + plotH} x2={padding.left + plotW} y2={padding.top + plotH} stroke="#888" strokeWidth="0.8" />
      <line x1={padding.left} y1={padding.top} x2={padding.left} y2={padding.top + plotH} stroke="#888" strokeWidth="0.8" />

      {/* 网格 */}
      {[0.25, 0.5, 0.75].map((g, i) => (
        <line key={i} x1={padding.left} y1={padding.top + g * plotH} x2={padding.left + plotW} y2={padding.top + g * plotH} stroke="#E8ECF0" strokeWidth="0.5" />
      ))}

      {/* 强度曲线 */}
      <polyline points={points.join(' ')} fill="none" stroke={mode === 'white-light' ? '#333333' : beamColor} strokeWidth="1.2" />

      {/* 标签 */}
      <text x={padding.left} y={padding.top - 2} fontSize="8" fill="#888" fontFamily={FONT}>I</text>
      <text x={padding.left + plotW} y={height - 4} fontSize="8" fill="#888" fontFamily={FONT} textAnchor="end">r / x</text>
      <text x={4} y={padding.top + plotH / 2} fontSize="8" fill="#888" fontFamily={MONO} transform={`rotate(-90 4 ${padding.top + plotH / 2})`}>强度</text>
    </svg>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   子组件：条纹计数 d-t 曲线
   ═══════════════════════════════════════════════════════════════════ */
function FringeCountChart({
  history, width = 360, height = 100,
}: {
  history: { t: number; d: number; count: number }[]
  width?: number
  height?: number
}) {
  const padding = { left: 36, right: 8, top: 10, bottom: 20 }
  const plotW = width - padding.left - padding.right
  const plotH = height - padding.top - padding.bottom

  if (history.length < 2) {
    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ maxWidth: '100%', height: 'auto' }}>
        <rect width={width} height={height} fill="#FAFAFA" />
        <text x={width / 2} y={height / 2} textAnchor="middle" fontSize="10" fill="#AAA" fontFamily={FONT}>
          点击「开始」启动 M₂ 扫描
        </text>
      </svg>
    )
  }

  const tMin = history[0].t
  const tMax = history[history.length - 1].t
  const tRange = Math.max(tMax - tMin, 1)
  const dMin = Math.min(...history.map(h => h.d))
  const dMax = Math.max(...history.map(h => h.d))
  const dRange = Math.max(dMax - dMin, 0.1)

  // d-t 曲线
  const dPoints = history.map(h => {
    const px = padding.left + ((h.t - tMin) / tRange) * plotW
    const py = padding.top + (1 - (h.d - dMin) / dRange) * plotH
    return `${px},${py}`
  }).join(' ')

  // 条纹计数阶跃
  const countMax = Math.max(...history.map(h => h.count), 1)

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ maxWidth: '100%', height: 'auto' }}>
      {/* 网格 */}
      {[0.25, 0.5, 0.75].map((g, i) => (
        <line key={i} x1={padding.left} y1={padding.top + g * plotH} x2={padding.left + plotW} y2={padding.top + g * plotH} stroke="#E8ECF0" strokeWidth="0.5" />
      ))}

      {/* 坐标轴 */}
      <line x1={padding.left} y1={padding.top + plotH} x2={padding.left + plotW} y2={padding.top + plotH} stroke="#888" strokeWidth="0.8" />
      <line x1={padding.left} y1={padding.top} x2={padding.left} y2={padding.top + plotH} stroke="#888" strokeWidth="0.8" />

      {/* d-t 曲线 */}
      <polyline points={dPoints} fill="none" stroke="#CC3333" strokeWidth="1.2" />

      {/* 条纹计数（右轴，阶跃） */}
      {history.filter(h => h.count > 0).map((h, i) => {
        const px = padding.left + ((h.t - tMin) / tRange) * plotW
        return <circle key={i} cx={px} cy={padding.top + (1 - h.count / countMax) * plotH} r="1.5" fill="#1A1A1A" />
      })}

      {/* 标签 */}
      <text x={padding.left} y={padding.top - 2} fontSize="8" fill="#CC3333" fontFamily={MONO}>d (μm)</text>
      <text x={padding.left + plotW} y={padding.top - 2} fontSize="8" fill="#1A1A1A" fontFamily={MONO} textAnchor="end">N</text>
      <text x={padding.left + plotW / 2} y={height - 4} fontSize="8" fill="#888" fontFamily={FONT} textAnchor="middle">t (s)</text>
    </svg>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   主组件
   ═══════════════════════════════════════════════════════════════════ */
export default function MichelsonInterferometer({ onBack }: { onBack: () => void }) {
  const isMobile = useIsMobile()
  const [panelOpen, setPanelOpen] = useState(false)

  // ─── 状态缓存恢复 ───
  const cachedState = typeof window !== 'undefined'
    ? (() => { try { return JSON.parse(localStorage.getItem('ops-lab-v3') || '{}')?.state?.['physical-michelson']?.state || null } catch { return null } })()
    : null

  const [mode, setMode] = useState<ExperimentMode>(cachedState?.mode ?? 'equal-inclination')
  const [wavelength, setWavelength] = useState(cachedState?.wavelength ?? 632.8)
  const [d, setD] = useState(cachedState?.d ?? 10) // μm
  const [tilt, setTilt] = useState(cachedState?.tilt ?? 0.5) // 度
  const [velocity, setVelocity] = useState(cachedState?.velocity ?? 2) // μm/s
  const [running, setRunning] = useState(false)
  const [fringeCount, setFringeCount] = useState(0)
  const [history, setHistory] = useState<{ t: number; d: number; count: number }[]>([])

  const vizRef = useRef<HTMLDivElement>(null)
  const startTimeRef = useRef<number | null>(null)
  const lastCountDRef = useRef<number>(d)

  // ─── 快照目标注册 ───
  useSnapshotTarget(VIEW_ID, {
    targetRef: vizRef,
    getTitle: () => `迈克尔逊 · ${MODE_LABELS[mode]} · d=${d.toFixed(1)}μm · λ=${wavelength}nm`,
    getParams: () => [
      { key: 'λ', value: `${wavelength}nm` },
      { key: 'd', value: `${d.toFixed(2)}μm` },
      { key: '模式', value: MODE_LABELS[mode] },
      ...(mode === 'equal-thickness' ? [{ key: 'α倾角', value: `${tilt.toFixed(2)}°` }] : []),
      ...(mode === 'fringe-counting' ? [{ key: 'N条纹', value: `${fringeCount}` }, { key: 'v', value: `${velocity}μm/s` }] : []),
    ],
  })

  // ─── 状态缓存：卸载时保存 ───
  useEffect(() => {
    return () => {
      try {
        const store = JSON.parse(localStorage.getItem('ops-lab-v3') || '{}')
        if (!store.state) store.state = {}
        store.state[VIEW_ID] = {
          viewId: VIEW_ID,
          state: { mode, wavelength, d, tilt, velocity },
          updatedAt: new Date().toISOString(),
        }
        localStorage.setItem('ops-lab-v3', JSON.stringify(store))
      } catch { /* ignore */ }
    }
  }, [mode, wavelength, d, tilt, velocity])

  // ─── 条纹计数：扫描动画 ───
  useEffect(() => {
    if (!running || mode !== 'fringe-counting') return
    let rafId: number
    const step = (ts: number) => {
      if (startTimeRef.current === null) startTimeRef.current = ts
      const t = (ts - startTimeRef.current) / 1000 // s
      // d 线性变化（从初始 d 向正方向扫描，最大 +80μm）
      const newD = Math.min(d + velocity * t, 80)
      // 条纹计数：每变化 λ/2 计一个条纹
      const lambda_um = wavelength / 1000
      const deltaD = newD - lastCountDRef.current
      if (Math.abs(deltaD) >= lambda_um / 2) {
        const n = Math.floor(Math.abs(deltaD) / (lambda_um / 2))
        setFringeCount(c => c + n)
        lastCountDRef.current += n * (lambda_um / 2) * Math.sign(deltaD)
      }
      setD(newD)
      setHistory(h => [...h, { t, d: newD, count: fringeCount }])
      if (newD < 80) {
        rafId = requestAnimationFrame(step)
      } else {
        setRunning(false)
      }
    }
    rafId = requestAnimationFrame(step)
    return () => cancelAnimationFrame(rafId)
  }, [running, mode, velocity, wavelength, d, fringeCount])

  // ─── 重置 ───
  const resetScan = () => {
    setRunning(false)
    setFringeCount(0)
    setHistory([])
    startTimeRef.current = null
    lastCountDRef.current = d
  }

  // ─── 派生量 ───
  const beamColor = wavelengthToColor(wavelength)
  const fringeOrder = (d * 1000) / wavelength // d/λ
  const visibility = 0.95
  const coherenceLength = mode === 'white-light' ? '~2 μm' : '>10 m'

  return (
    <div className="h-full flex flex-col" style={{ background: '#FFFFFF' }}>
      {/* ═══ Header ═══ */}
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
          迈克尔逊干涉仪
        </h1>
        {!isMobile && (
          <span style={{ marginLeft: '4px', fontSize: '9px', color: '#888888',
            border: '1px solid #D0D0D0', borderRadius: '2px', padding: '1px 6px', flexShrink: 0 }}>
            2d·cos θ = mλ
          </span>
        )}

        {/* 模式切换 tabs */}
        <div className={isMobile ? 'flex overflow-x-auto mobile-x-scroll flex-1 min-w-0' : 'flex'} style={{
          marginLeft: isMobile ? '8px' : 'auto', gap: '2px',
          ...(isMobile ? { flexWrap: 'nowrap' as const } : {}),
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
          title={`迈克尔逊 · ${MODE_LABELS[mode]} · d=${d.toFixed(1)}μm`}
          params={[
            { key: 'λ', value: `${wavelength}nm` },
            { key: 'd', value: `${d.toFixed(2)}μm` },
            { key: '模式', value: MODE_LABELS[mode] },
          ]}
          targetRef={vizRef}
          panelWidth={300}
          label="撕下对比"
        />
      </div>

      {/* ═══ 主体 ═══ */}
      <div className="flex flex-1" style={{ minHeight: 0 }}>
        {/* 左：控制面板 */}
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
                {mode === 'equal-inclination' && 'M₁⊥M₂，扩展光源。同心圆条纹，中心级次最高。d 增大时条纹从中心冒出。'}
                {mode === 'equal-thickness' && 'M₂ 微倾 α。等厚面处直条纹，d≈0 时条纹弯曲（牛按环）。'}
                {mode === 'white-light' && '白光（R+G+B）。仅在 d≈0 附近（相干长度~2μm）出现彩色条纹。'}
                {mode === 'fringe-counting' && 'M₂ 匀速移动，计数过中心条纹数。N = 2d/λ，可标定波长或位移。'}
              </div>
            </div>

            {/* 波长选择（白光模式禁用） */}
            <div>
              <Label className="text-[12px] text-[#2d3142] mb-2 block">
                波长 λ
                {mode === 'white-light' && (
                  <span style={{ fontSize: '10px', color: '#999', marginLeft: '6px' }}>(白光模式)</span>
                )}
              </Label>
              <Select
                value={String(wavelength)}
                onValueChange={v => setWavelength(Number(v))}
                disabled={mode === 'white-light'}
              >
                <SelectTrigger className="h-9 text-[12px]" disabled={mode === 'white-light'}>
                  <SelectValue />
                </SelectTrigger>
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

            {/* M2 位置 d */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-[12px] text-[#2d3142]">M₂ 位置 d</Label>
                <span className="tabular-nums text-[11px] text-[#6b7280]" style={{ fontFamily: MONO }}>
                  {d.toFixed(2)} μm
                </span>
              </div>
              <Slider
                value={[d]}
                min={-50}
                max={50}
                step={0.1}
                onValueChange={([v]) => setD(v)}
                disabled={running}
              />
              <div className="flex justify-between text-[9px] text-[#aaa]">
                <span>-50 μm</span>
                <span>0</span>
                <span>+50 μm</span>
              </div>
            </div>

            {/* M2 倾角（仅等厚模式） */}
            {mode === 'equal-thickness' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-[12px] text-[#2d3142]">M₂ 倾角 α</Label>
                  <span className="tabular-nums text-[11px] text-[#6b7280]" style={{ fontFamily: MONO }}>
                    {tilt.toFixed(3)}°
                  </span>
                </div>
                <Slider
                  value={[tilt]}
                  min={0}
                  max={5}
                  step={0.01}
                  onValueChange={([v]) => setTilt(v)}
                />
                <div className="flex justify-between text-[9px] text-[#aaa]">
                  <span>0°</span>
                  <span>5°</span>
                </div>
              </div>
            )}

            {/* 条纹计数控制 */}
            {mode === 'fringe-counting' && (
              <>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-[12px] text-[#2d3142]">M₂ 速度 v</Label>
                    <span className="tabular-nums text-[11px] text-[#6b7280]" style={{ fontFamily: MONO }}>
                      {velocity.toFixed(1)} μm/s
                    </span>
                  </div>
                  <Slider
                    value={[velocity]}
                    min={0.1}
                    max={10}
                    step={0.1}
                    onValueChange={([v]) => setVelocity(v)}
                    disabled={running}
                  />
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => { setRunning(r => !r); if (running) startTimeRef.current = null }}
                    style={{
                      flex: 1, fontFamily: FONT, fontSize: '12px', fontWeight: 500,
                      padding: '8px', minHeight: '44px',
                      border: '1px solid #1A1A1A', backgroundColor: running ? '#FFFFFF' : '#1A1A1A',
                      color: running ? '#1A1A1A' : '#FFFFFF', cursor: 'pointer', borderRadius: '2px',
                      transition: 'all 120ms ease-out',
                    }}
                  >
                    {running ? '■ 暂停' : '▶ 开始扫描'}
                  </button>
                  <button
                    onClick={resetScan}
                    style={{
                      fontFamily: FONT, fontSize: '12px', fontWeight: 500,
                      padding: '8px 12px', minHeight: '44px',
                      border: '1px solid #D0D0D0', backgroundColor: '#FFFFFF',
                      color: '#555', cursor: 'pointer', borderRadius: '2px',
                    }}
                  >
                    重置
                  </button>
                </div>

                {/* 条纹计数显示 */}
                <div style={{
                  padding: '10px 12px', backgroundColor: '#1A1A1A',
                  borderRadius: '2px', textAlign: 'center',
                }}>
                  <div style={{ fontFamily: FONT, fontSize: '9px', color: '#999', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                    条纹计数 N
                  </div>
                  <div className="tabular-nums" style={{
                    fontFamily: MONO, fontSize: '28px', fontWeight: 600, color: '#FFFFFF',
                    lineHeight: 1.2,
                  }}>
                    {fringeCount}
                  </div>
                  <div style={{ fontFamily: MONO, fontSize: '9px', color: '#888' }}>
                    预期 N = 2d/λ = {Math.round(2 * d * 1000 / wavelength)}
                  </div>
                </div>
              </>
            )}

            {/* 计算结果 */}
            <div style={{ borderTop: '1px solid #E8ECF0', paddingTop: '12px' }}>
              <div style={{ fontFamily: FONT, fontSize: '10px', color: '#888', marginBottom: '6px', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                计算结果
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
                <ResultItem label="光程差 2d" value={`${(2 * d).toFixed(2)} μm`} />
                <ResultItem label="条纹级次 m" value={fringeOrder.toFixed(2)} />
                <ResultItem label="可见度 V" value={visibility.toFixed(2)} />
                <ResultItem label="相干长度" value={coherenceLength} />
                <ResultItem label="条纹间距" value={mode === 'equal-inclination' ? `${(wavelength / (2 * Math.abs(d) || 0.1) * 250).toFixed(1)} px` : '—'} />
                <ResultItem label="d/λ" value={`${(d * 1000 / wavelength).toFixed(1)}`} />
              </div>
            </div>

            {/* 公式参考 */}
            <div style={{
              padding: '10px 12px', backgroundColor: '#FAFAFA',
              border: '1px solid #E8ECF0', borderRadius: '2px',
            }}>
              <div style={{ fontFamily: FONT, fontSize: '10px', color: '#888', marginBottom: '6px' }}>
                公式参考
              </div>
              <div style={{ fontFamily: MONO, fontSize: '10px', color: '#333', lineHeight: 1.8 }}>
                <div>Δ = 2d·cos θ</div>
                <div>I = I₀(1 + V·cos(2πΔ/λ))</div>
                <div style={{ fontSize: '9px', color: '#888', marginTop: '4px' }}>
                  等倾：同心圆，中心 θ=0<br />
                  等厚：Δ=2(d₀+αx)，直条纹<br />
                  白光：相干长度 ~2μm
                </div>
              </div>
            </div>
          </div>
        </ControlPanel>

        {/* 右：可视化区 */}
        <div
          ref={vizRef}
          className="flex-1 custom-scrollbar min-w-0"
          style={{
            display: 'flex', flexDirection: 'column',
            padding: isMobile ? '12px 8px' : '16px 20px',
            overflowY: 'auto', alignItems: 'center', gap: '14px',
          }}
        >
          {/* 光路示意图 */}
          <div style={{ width: '100%', maxWidth: '420px' }}>
            <div style={{
              fontFamily: FONT, fontSize: '11px', fontWeight: 600, color: '#1A1A1A',
              marginBottom: '6px', textAlign: 'center',
            }}>
              光路示意图（俯视）
            </div>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <InstrumentSchematic beamColor={beamColor} d={d} tilt={tilt} mode={mode} />
            </div>
          </div>

          {/* 干涉条纹 */}
          <div style={{ textAlign: 'center' }}>
            <div style={{
              fontFamily: FONT, fontSize: '11px', fontWeight: 600, color: '#1A1A1A',
              marginBottom: '6px',
            }}>
              {mode === 'equal-inclination' && '等倾干涉条纹（同心圆）'}
              {mode === 'equal-thickness' && '等厚干涉条纹'}
              {mode === 'white-light' && '白光干涉条纹（彩色）'}
              {mode === 'fringe-counting' && '实时干涉条纹（扫描中）'}
            </div>
            <FringeCanvas
              mode={mode}
              d={d}
              tilt={tilt}
              wavelength={wavelength}
              width={isMobile ? 300 : 360}
              height={isMobile ? 300 : 360}
            />
          </div>

          {/* 强度截面 */}
          <div style={{ width: '100%', maxWidth: '420px' }}>
            <div style={{
              fontFamily: FONT, fontSize: '11px', fontWeight: 600, color: '#1A1A1A',
              marginBottom: '4px',
            }}>
              强度截面 I(r)
            </div>
            <IntensityProfileSVG
              mode={mode}
              d={d}
              tilt={tilt}
              wavelength={wavelength}
              width={isMobile ? 300 : 380}
              height={100}
            />
          </div>

          {/* 条纹计数 d-t 曲线 */}
          {mode === 'fringe-counting' && (
            <div style={{ width: '100%', maxWidth: '420px' }}>
              <div style={{
                fontFamily: FONT, fontSize: '11px', fontWeight: 600, color: '#1A1A1A',
                marginBottom: '4px',
              }}>
                M₂ 位移-时间曲线
              </div>
              <FringeCountChart
                history={history}
                width={isMobile ? 300 : 380}
                height={100}
              />
            </div>
          )}

          {/* 说明文字 */}
          <div style={{
            width: '100%', maxWidth: '420px',
            padding: '10px 12px', backgroundColor: '#FAFAFA',
            border: '1px solid #E8ECF0', borderRadius: '2px',
            fontFamily: FONT, fontSize: '10px', color: '#666', lineHeight: 1.7,
          }}>
            {mode === 'equal-inclination' && (
              <><b style={{ color: '#333' }}>观察要点：</b>调节 d 观察条纹从中心「冒出」(d↑) 或「缩入」(d↓)。中心级次 m₀=2d/λ，每变化 λ/2 冒出/缩入一个条纹。</>
            )}
            {mode === 'equal-thickness' && (
              <><b style={{ color: '#333' }}>观察要点：</b>倾角 α 控制条纹密度，d≈0 时条纹变直，远离 d=0 时条纹弯曲（牛按环特征）。</>
            )}
            {mode === 'white-light' && (
              <><b style={{ color: '#333' }}>观察要点：</b>仅在 |d|&lt;2μm 时可见彩色条纹。移动 d 至 0 附近，可见「黑-紫-蓝-绿-黄-红」的彩色中心条纹，标志零光程差位置。</>
            )}
            {mode === 'fringe-counting' && (
              <><b style={{ color: '#333' }}>观察要点：</b>点击「开始扫描」使 M₂ 匀速移动。每经过中心一个条纹，计数器 +1。由 N=2d/λ 可反推波长或位移。这是迈克尔逊干涉仪用于长度/波长标定的基本原理。</>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── 小组件：计算结果项 ─── */
function ResultItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontFamily: "system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif", fontSize: '9px', color: '#999' }}>
        {label}
      </div>
      <div className="tabular-nums" style={{ fontFamily: 'var(--font-geist-mono), ui-monospace, monospace', fontSize: '12px', fontWeight: 600, color: '#1A1A1A' }}>
        {value}
      </div>
    </div>
  )
}
