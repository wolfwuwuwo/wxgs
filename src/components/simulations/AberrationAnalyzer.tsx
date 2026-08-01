'use client'

/* ═══════════════════════════════════════════════════════════════════
   AberrationAnalyzer — 光学像差分析仿真
   5 种 Seidel 初级像差：球差 / 彗差 / 像散 / 场曲 / 畸变
   3 种实验模式：波像差分析 · 点列图 · 光扇图
   ═══════════════════════════════════════════════════════════════════ */

import { useState, useRef, useEffect, useMemo } from 'react'
import { Slider } from '@/components/ui/slider'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useIsMobile } from '@/hooks/use-mobile'
import { ControlPanel, MobilePanelToggle } from './shared/ControlPanel'
import { TearOffButton } from './shared/TearOffPanel'
import { useSnapshotTarget } from '@/hooks/use-snapshot-target'
import { blitImageData } from '@/lib/utils'

const FONT = "system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif"
const MONO = 'var(--font-geist-mono), ui-monospace, monospace'
const VIEW_ID = 'geometric-aberration' as const

type ExperimentMode = 'wavefront' | 'spot-diagram' | 'fan-plot'

const MODE_LABELS: Record<ExperimentMode, string> = {
  'wavefront': '波像差分析',
  'spot-diagram': '点列图',
  'fan-plot': '光扇图',
}

type AberrationType = 'spherical' | 'coma' | 'astigmatism' | 'fieldCurvature' | 'distortion'

const ABERRATION_INFO: Record<AberrationType, { name: string; symbol: string; coeff: string; desc: string }> = {
  spherical: { name: '球差', symbol: 'W040', coeff: 'W₀₄₀', desc: 'ρ⁴ · 与视场无关。轴上点像差，边缘光线与近轴光线焦点不同。' },
  coma: { name: '彗差', symbol: 'W131', coeff: 'W₁₃₁', desc: 'ρ³cosθ·H · 偏轴。彗星状光斑，大小与视场成正比。' },
  astigmatism: { name: '像散', symbol: 'W222', coeff: 'W₂₂₂', desc: 'ρ²cos²θ·H² · 子午与弧矢焦点分离。' },
  fieldCurvature: { name: '场曲', symbol: 'W220', coeff: 'W₂₂₀', desc: 'ρ²·H² · Petzval 曲面。像面弯曲。' },
  distortion: { name: '畸变', symbol: 'W111', coeff: 'W₁₁₁', desc: 'ρcosθ·H³ · 像点径向位移。桶形/枕形畸变。' },
}

const ABERRATION_ORDER: AberrationType[] = ['spherical', 'coma', 'astigmatism', 'fieldCurvature', 'distortion']

/* ─── 波像差计算 W(ρ, θ) ─── */
function wavefrontError(
  rho: number, theta: number, H: number,
  W040: number, W131: number, W222: number, W220: number, W111: number
): number {
  const ct = Math.cos(theta)
  return (
    W040 * Math.pow(rho, 4) +
    W131 * Math.pow(rho, 3) * ct * H +
    W222 * Math.pow(rho, 2) * ct * ct * H * H +
    W220 * Math.pow(rho, 2) * H * H +
    W111 * rho * ct * H * H * H
  )
}

/* ─── 横向像差（偏导数） ─── */
function transverseAberration(
  rhoX: number, rhoY: number, H: number,
  W040: number, W131: number, W222: number, W220: number, W111: number
): { ex: number; ey: number } {
  // 数值偏导：ε_x = -∂W/∂ρx, ε_y = -∂W/∂ρy
  const dr = 0.001
  const rho = Math.sqrt(rhoX * rhoX + rhoY * rhoY)
  const theta = Math.atan2(rhoY, rhoX)
  const W = wavefrontError(rho, theta, H, W040, W131, W222, W220, W111)
  const rhoX2 = rhoX + dr
  const rho2 = Math.sqrt(rhoX2 * rhoX2 + rhoY * rhoY)
  const theta2 = Math.atan2(rhoY, rhoX2)
  const Wx = wavefrontError(rho2, theta2, H, W040, W131, W222, W220, W111)
  const rhoY2 = rhoY + dr
  const rho3 = Math.sqrt(rhoX * rhoX + rhoY2 * rhoY2)
  const theta3 = Math.atan2(rhoY2, rhoX)
  const Wy = wavefrontError(rho3, theta3, H, W040, W131, W222, W220, W111)
  return {
    ex: -(Wx - W) / dr,
    ey: -(Wy - W) / dr,
  }
}

/* ─── 波像差颜色映射（发散色图，避免亮蓝） ─── */
function wavefrontColor(W: number, Wmax: number): [number, number, number] {
  const t = Math.max(-1, Math.min(1, W / (Wmax || 1)))
  // 蓝→白→红，但用柔和色调
  if (t >= 0) {
    // 白 → 红
    return [255, 255 - t * 180, 255 - t * 200]
  } else {
    // 白 → 蓝
    const a = -t
    return [255 - a * 180, 255 - a * 100, 255 - a * 30]
  }
}

/* ═══════════════════════════════════════════════════════════════════
   子组件：波像差 2D 色图
   ═══════════════════════════════════════════════════════════════════ */
function WavefrontMap({
  H, W040, W131, W222, W220, W111, size = 280,
}: {
  H: number
  W040: number; W131: number; W222: number; W220: number; W111: number
  size?: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = size * dpr
    canvas.height = size * dpr
    canvas.style.width = `${size}px`
    canvas.style.height = `${size}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const cx = size / 2
    const cy = size / 2
    const R = size / 2 - 2

    // 先求 Wmax
    let Wmax = 0
    const samples = 64
    const Wdata: number[] = []
    for (let iy = 0; iy < samples; iy++) {
      for (let ix = 0; ix < samples; ix++) {
        const rhoX = ((ix + 0.5) / samples - 0.5) * 2
        const rhoY = ((iy + 0.5) / samples - 0.5) * 2
        const rho = Math.sqrt(rhoX * rhoX + rhoY * rhoY)
        if (rho > 1) { Wdata.push(NaN); continue }
        const theta = Math.atan2(rhoY, rhoX)
        const W = wavefrontError(rho, theta, H, W040, W131, W222, W220, W111)
        Wdata.push(W)
        if (Math.abs(W) > Wmax) Wmax = Math.abs(W)
      }
    }

    // 绘制
    const cellW = size / samples
    for (let iy = 0; iy < samples; iy++) {
      for (let ix = 0; ix < samples; ix++) {
        const W = Wdata[iy * samples + ix]
        if (isNaN(W)) continue
        const [r, g, b] = wavefrontColor(W, Wmax)
        ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`
        ctx.fillRect(ix * cellW, iy * cellW, cellW + 0.5, cellW + 0.5)
      }
    }

    // 圆形光瞳边界
    ctx.strokeStyle = '#333333'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(cx, cy, R, 0, Math.PI * 2)
    ctx.stroke()

    // 中心十字
    ctx.strokeStyle = '#888888'
    ctx.lineWidth = 0.5
    ctx.beginPath()
    ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy)
    ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R)
    ctx.stroke()

    // 色标
    const barW = 12
    const barH = size - 20
    const barX = size - barW - 4
    const barY = 10
    for (let i = 0; i < barH; i++) {
      const t = 1 - i / barH // 1→-1
      const [r, g, b] = wavefrontColor(t * Wmax, Wmax)
      ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`
      ctx.fillRect(barX, barY + i, barW, 1)
    }
    ctx.strokeStyle = '#333'
    ctx.lineWidth = 0.5
    ctx.strokeRect(barX, barY, barW, barH)
    ctx.fillStyle = '#333'
    ctx.font = '8px monospace'
    ctx.fillText(`+${Wmax.toFixed(1)}λ`, barX - 28, barY + 6)
    ctx.fillText(`-${Wmax.toFixed(1)}λ`, barX - 28, barY + barH)
  }, [H, W040, W131, W222, W220, W111, size])

  return <canvas ref={canvasRef} className="bg-white" style={{ maxWidth: '100%', height: 'auto', border: '1px solid #D0D0D0' }} />
}

/* ═══════════════════════════════════════════════════════════════════
   子组件：干涉图（带像差的 Twyman-Green）
   ═══════════════════════════════════════════════════════════════════ */
function InterferogramCanvas({
  H, W040, W131, W222, W220, W111, size = 280, tiltFringes = 3,
}: {
  H: number
  W040: number; W131: number; W222: number; W220: number; W111: number
  size?: number
  tiltFringes?: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = size * dpr
    canvas.height = size * dpr
    canvas.style.width = `${size}px`
    canvas.style.height = `${size}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const cx = size / 2
    const cy = size / 2
    const R = size / 2 - 2
    const imageData = ctx.createImageData(size, size)
    const data = imageData.data

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const rhoX = (x + 0.5 - cx) / R
        const rhoY = (y + 0.5 - cy) / R
        const rho = Math.sqrt(rhoX * rhoX + rhoY * rhoY)
        const idx = (y * size + x) * 4
        if (rho > 1) {
          data[idx + 3] = 0  // 透明，与背景对齐
          continue
        }
        const theta = Math.atan2(rhoY, rhoX)
        const W = wavefrontError(rho, theta, H, W040, W131, W222, W220, W111)
        // 加入倾斜条纹（参考波前）
        const phase = 2 * Math.PI * (W + tiltFringes * rhoX)
        const I = 0.5 * (1 + Math.cos(phase))
        const v = I * 255
        data[idx] = v; data[idx + 1] = v; data[idx + 2] = v; data[idx + 3] = 255
      }
    }
    blitImageData(ctx, imageData, size, size)

    // 圆形边界
    ctx.strokeStyle = '#333333'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(cx, cy, R, 0, Math.PI * 2)
    ctx.stroke()
  }, [H, W040, W131, W222, W220, W111, size, tiltFringes])

  return <canvas ref={canvasRef} className="bg-white" style={{ maxWidth: '100%', height: 'auto', borderRadius: '50%', border: '1px solid #333333' }} />
}

/* ═══════════════════════════════════════════════════════════════════
   子组件：点列图
   ═══════════════════════════════════════════════════════════════════ */
function SpotDiagram({
  H, W040, W131, W222, W220, W111, size = 280, sampling = 32,
}: {
  H: number
  W040: number; W131: number; W222: number; W220: number; W111: number
  size?: number
  sampling?: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = size * dpr
    canvas.height = size * dpr
    canvas.style.width = `${size}px`
    canvas.style.height = `${size}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    // 白底
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(0, 0, size, size)

    const cx = size / 2
    const cy = size / 2
    const scale = size / 4 // 1 单位横向像差 = scale 像素

    // 三视场点：0, 0.7H, 1.0H
    const fieldPoints = [0, 0.7, 1.0]
    const subSize = size / 3

    fieldPoints.forEach((h, fi) => {
      const subCx = (fi + 0.5) * subSize
      const subCy = cy

      // 子图边框
      ctx.strokeStyle = '#CCCCCC'
      ctx.lineWidth = 0.5
      ctx.strokeRect(fi * subSize + 0.5, (size - subSize) / 2 + 0.5, subSize - 1, subSize - 1)

      // Airy 斑参考圆（假设 λ=632.8nm, f=100mm, D=20mm → Airy半径 ~3.86μm, 此处用相对值）
      ctx.strokeStyle = '#FFAA00'
      ctx.lineWidth = 0.6
      ctx.setLineDash([2, 2])
      ctx.beginPath()
      ctx.arc(subCx, subCy, 6, 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])

      // 光线点
      ctx.fillStyle = '#1A1A1A'
      for (let iy = 0; iy < sampling; iy++) {
        for (let ix = 0; ix < sampling; ix++) {
          const rhoX = ((ix + 0.5) / sampling - 0.5) * 2
          const rhoY = ((iy + 0.5) / sampling - 0.5) * 2
          const rho = Math.sqrt(rhoX * rhoX + rhoY * rhoY)
          if (rho > 1) continue
          const { ex, ey } = transverseAberration(rhoX, rhoY, h * H, W040, W131, W222, W220, W111)
          const px = subCx + ex * scale * 0.05
          const py = subCy - ey * scale * 0.05
          ctx.fillRect(px - 0.3, py - 0.3, 0.8, 0.8)
        }
      }

      // 标签
      ctx.fillStyle = '#555'
      ctx.font = '9px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(`H=${h.toFixed(1)}`, subCx, (size + subSize) / 2 + 14)
    })

    // 顶部标签
    ctx.fillStyle = '#333'
    ctx.font = '10px sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText('点列图 (Spot Diagram)', 8, 14)
    ctx.fillStyle = '#FFAA00'
    ctx.fillText('○ Airy 斑参考', 8, size - 6)
  }, [H, W040, W131, W222, W220, W111, size, sampling])

  return <canvas ref={canvasRef} className="border border-[#d4d8e0] bg-white" style={{ maxWidth: '100%', height: 'auto' }} />
}

/* ═══════════════════════════════════════════════════════════════════
   子组件：光扇图
   ═══════════════════════════════════════════════════════════════════ */
function FanPlotSVG({
  H, W040, W131, W222, W220, W111, width = 480, height = 200,
}: {
  H: number
  W040: number; W131: number; W222: number; W220: number; W111: number
  width?: number
  height?: number
}) {
  const padding = { left: 44, right: 12, top: 30, bottom: 28 }
  const plotW = width - padding.left - padding.right
  const plotH = height - padding.top - padding.bottom

  // 子午光扇（ρ_y 扫描，ρ_x=0）与弧矢光扇（ρ_x 扫描，ρ_y=0）
  const samples = 80
  const tangential: string[] = []
  const sagittal: string[] = []
  let maxErr = 0
  const tangData: number[] = []
  const sagData: number[] = []
  for (let i = 0; i <= samples; i++) {
    const rho = (i / samples - 0.5) * 2
    const t = transverseAberration(0, rho, H, W040, W131, W222, W220, W111)
    const s = transverseAberration(rho, 0, H, W040, W131, W222, W220, W111)
    tangData.push(t.ey)
    sagData.push(s.ex)
    if (Math.abs(t.ey) > maxErr) maxErr = Math.abs(t.ey)
    if (Math.abs(s.ex) > maxErr) maxErr = Math.abs(s.ex)
  }
  maxErr = Math.max(maxErr, 0.1)
  for (let i = 0; i <= samples; i++) {
    const rho = (i / samples - 0.5) * 2
    const px = padding.left + (rho + 1) / 2 * plotW
    const ty = padding.top + (1 - (tangData[i] / maxErr + 1) / 2) * plotH
    const sy = padding.top + (1 - (sagData[i] / maxErr + 1) / 2) * plotH
    tangential.push(`${px},${ty}`)
    sagittal.push(`${px},${sy}`)
  }

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ maxWidth: '100%', height: 'auto' }}>
      {/* 标题 */}
      <text x={padding.left} y={14} fontSize="11" fontWeight="600" fill="#1A1A1A" fontFamily={FONT}>光扇图 (Ray Fan Plot)</text>

      {/* 网格 */}
      {[0.25, 0.5, 0.75].map(g => (
        <line key={g} x1={padding.left} y1={padding.top + g * plotH} x2={padding.left + plotW} y2={padding.top + g * plotH} stroke="#E8ECF0" strokeWidth="0.5" />
      ))}
      {[-1, -0.5, 0, 0.5, 1].map(r => (
        <line key={r} x1={padding.left + (r + 1) / 2 * plotW} y1={padding.top} x2={padding.left + (r + 1) / 2 * plotW} y2={padding.top + plotH} stroke="#E8ECF0" strokeWidth="0.5" />
      ))}

      {/* 0 线 */}
      <line x1={padding.left} y1={padding.top + plotH / 2} x2={padding.left + plotW} y2={padding.top + plotH / 2} stroke="#888" strokeWidth="0.6" />
      {/* 坐标轴 */}
      <line x1={padding.left} y1={padding.top + plotH} x2={padding.left + plotW} y2={padding.top + plotH} stroke="#888" strokeWidth="0.8" />
      <line x1={padding.left} y1={padding.top} x2={padding.left} y2={padding.top + plotH} stroke="#888" strokeWidth="0.8" />

      {/* 子午光扇 */}
      <polyline points={tangential.join(' ')} fill="none" stroke="#CC3333" strokeWidth="1.4" />
      {/* 弧矢光扇 */}
      <polyline points={sagittal.join(' ')} fill="none" stroke="#1A6BCC" strokeWidth="1.4" strokeDasharray="4 2" />

      {/* 图例 */}
      <line x1={padding.left + 10} y1={22} x2={padding.left + 24} y2={22} stroke="#CC3333" strokeWidth="1.4" />
      <text x={padding.left + 28} y={25} fontSize="9" fill="#333" fontFamily={FONT}>子午 T_y(ρ_y)</text>
      <line x1={padding.left + 130} y1={22} x2={padding.left + 144} y2={22} stroke="#1A6BCC" strokeWidth="1.4" strokeDasharray="4 2" />
      <text x={padding.left + 148} y={25} fontSize="9" fill="#333" fontFamily={FONT}>弧矢 S_x(ρ_x)</text>

      {/* 标签 */}
      <text x={padding.left} y={padding.top - 4} fontSize="9" fill="#666" fontFamily={FONT}>横向像差</text>
      <text x={padding.left + plotW} y={height - 6} fontSize="9" fill="#888" fontFamily={FONT} textAnchor="end">归一化光瞳坐标 ρ</text>
      <text x={padding.left - 4} y={padding.top + plotH / 2} fontSize="8" fill="#888" fontFamily={MONO} textAnchor="end">0</text>
      <text x={padding.left - 4} y={padding.top + 4} fontSize="8" fill="#888" fontFamily={MONO} textAnchor="end">+{maxErr.toFixed(2)}</text>
      <text x={padding.left - 4} y={padding.top + plotH - 2} fontSize="8" fill="#888" fontFamily={MONO} textAnchor="end">-{maxErr.toFixed(2)}</text>
    </svg>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   主组件
   ═══════════════════════════════════════════════════════════════════ */
export default function AberrationAnalyzer({ onBack }: { onBack: () => void }) {
  const isMobile = useIsMobile()
  const [panelOpen, setPanelOpen] = useState(false)

  const cachedState = typeof window !== 'undefined'
    ? (() => { try { return JSON.parse(localStorage.getItem('ops-lab-v3') || '{}')?.state?.[VIEW_ID]?.state || null } catch { return null } })()
    : null

  const [mode, setMode] = useState<ExperimentMode>(cachedState?.mode ?? 'wavefront')
  const [W040, setW040] = useState(cachedState?.W040 ?? 2) // 球差
  const [W131, setW131] = useState(cachedState?.W131 ?? 0) // 彗差
  const [W222, setW222] = useState(cachedState?.W222 ?? 0) // 像散
  const [W220, setW220] = useState(cachedState?.W220 ?? 0) // 场曲
  const [W111, setW111] = useState(cachedState?.W111 ?? 0) // 畸变
  const [H, setH] = useState(cachedState?.H ?? 0.5) // 归一化视场高度
  const [showInterferogram, setShowInterferogram] = useState(true)

  const vizRef = useRef<HTMLDivElement>(null)

  // 计算活跃的像差类型
  const activeAberrations = useMemo(() => {
    const arr: AberrationType[] = []
    if (Math.abs(W040) > 0.01) arr.push('spherical')
    if (Math.abs(W131) > 0.01) arr.push('coma')
    if (Math.abs(W222) > 0.01) arr.push('astigmatism')
    if (Math.abs(W220) > 0.01) arr.push('fieldCurvature')
    if (Math.abs(W111) > 0.01) arr.push('distortion')
    return arr
  }, [W040, W131, W222, W220, W111])

  useSnapshotTarget(VIEW_ID, {
    targetRef: vizRef,
    getTitle: () => `像差分析 · ${MODE_LABELS[mode]} · ${activeAberrations.length ? activeAberrations.map(a => ABERRATION_INFO[a].name).join('+') : '无像差'}`,
    getParams: () => [
      { key: '模式', value: MODE_LABELS[mode] },
      { key: 'H', value: H.toFixed(2) },
      ...(Math.abs(W040) > 0.01 ? [{ key: 'W₀₄₀', value: `${W040.toFixed(2)}λ` }] : []),
      ...(Math.abs(W131) > 0.01 ? [{ key: 'W₁₃₁', value: `${W131.toFixed(2)}λ` }] : []),
      ...(Math.abs(W222) > 0.01 ? [{ key: 'W₂₂₂', value: `${W222.toFixed(2)}λ` }] : []),
      ...(Math.abs(W220) > 0.01 ? [{ key: 'W₂₂₀', value: `${W220.toFixed(2)}λ` }] : []),
      ...(Math.abs(W111) > 0.01 ? [{ key: 'W₁₁₁', value: `${W111.toFixed(2)}λ` }] : []),
    ],
  })

  useEffect(() => {
    return () => {
      try {
        const store = JSON.parse(localStorage.getItem('ops-lab-v3') || '{}')
        if (!store.state) store.state = {}
        store.state[VIEW_ID] = {
          viewId: VIEW_ID,
          state: { mode, W040, W131, W222, W220, W111, H },
          updatedAt: new Date().toISOString(),
        }
        localStorage.setItem('ops-lab-v3', JSON.stringify(store))
      } catch { /* ignore */ }
    }
  }, [mode, W040, W131, W222, W220, W111, H])

  // 计算 RMS 与 Strehl 比
  const { rms, pv, strehl } = useMemo(() => {
    let sum = 0, sum2 = 0, n = 0, max = 0, min = 0
    const samples = 32
    for (let iy = 0; iy < samples; iy++) {
      for (let ix = 0; ix < samples; ix++) {
        const rhoX = (ix / (samples - 1) - 0.5) * 2
        const rhoY = (iy / (samples - 1) - 0.5) * 2
        const rho = Math.sqrt(rhoX * rhoX + rhoY * rhoY)
        if (rho > 1) continue
        const theta = Math.atan2(rhoY, rhoX)
        const W = wavefrontError(rho, theta, H, W040, W131, W222, W220, W111)
        sum += W
        sum2 += W * W
        n++
        if (W > max) max = W
        if (W < min) min = W
      }
    }
    const mean = sum / n
    const variance = sum2 / n - mean * mean
    const r = Math.sqrt(Math.max(0, variance))
    const s = Math.exp(-Math.pow(2 * Math.PI * r, 2))
    return { rms: r, pv: max - min, strehl: s }
  }, [H, W040, W131, W222, W220, W111])

  const diffractionLimited = rms < 1 / 14

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
          光学像差分析
        </h1>
        {!isMobile && (
          <span style={{ marginLeft: '4px', fontSize: '9px', color: '#888888',
            border: '1px solid #D0D0D0', borderRadius: '2px', padding: '1px 6px', flexShrink: 0 }}>
            Seidel 像差
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
          title={`像差分析 · ${MODE_LABELS[mode]} · σ=${rms.toFixed(2)}λ`}
          params={[
            { key: '模式', value: MODE_LABELS[mode] },
            { key: 'σ_RMS', value: `${rms.toFixed(3)}λ` },
            { key: 'Strehl', value: strehl.toFixed(3) },
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
                {mode === 'wavefront' && '波像差 W(ρ,θ) 的 2D 色图 + 干涉图。直接观察像差对波前的畸变。'}
                {mode === 'spot-diagram' && '3 个视场点 (0/0.7/1.0 H) 的光线在像面的分布。RMS 评价成像质量。'}
                {mode === 'fan-plot' && '子午与弧矢光扇图。横向像差 vs 光瞳坐标，是光学设计的标准诊断工具。'}
              </div>
            </div>

            {/* 视场高度 H */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-[12px] text-[#2d3142]">视场高度 H</Label>
                <span className="tabular-nums text-[11px] text-[#6b7280]" style={{ fontFamily: MONO }}>{H.toFixed(2)}</span>
              </div>
              <Slider value={[H]} min={0} max={1} step={0.05} onValueChange={([v]) => setH(v)} />
              <div className="flex justify-between text-[9px] text-[#aaa]">
                <span>0 (轴上)</span><span>1 (边缘)</span>
              </div>
            </div>

            {/* 5 种像差系数 */}
            <div style={{ borderTop: '1px solid #E8ECF0', paddingTop: '12px' }}>
              <div style={{ fontFamily: FONT, fontSize: '10px', color: '#888', marginBottom: '8px', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                Seidel 像差系数
              </div>
              <div className="space-y-3">
                <AberrationSlider label={ABERRATION_INFO.spherical.name} coeff="W₀₄₀" value={W040} onChange={setW040} desc={ABERRATION_INFO.spherical.desc} />
                <AberrationSlider label={ABERRATION_INFO.coma.name} coeff="W₁₃₁" value={W131} onChange={setW131} desc={ABERRATION_INFO.coma.desc} />
                <AberrationSlider label={ABERRATION_INFO.astigmatism.name} coeff="W₂₂₂" value={W222} onChange={setW222} desc={ABERRATION_INFO.astigmatism.desc} />
                <AberrationSlider label={ABERRATION_INFO.fieldCurvature.name} coeff="W₂₂₀" value={W220} onChange={setW220} desc={ABERRATION_INFO.fieldCurvature.desc} />
                <AberrationSlider label={ABERRATION_INFO.distortion.name} coeff="W₁₁₁" value={W111} onChange={setW111} desc={ABERRATION_INFO.distortion.desc} />
              </div>
            </div>

            {/* 显示选项 */}
            {mode === 'wavefront' && (
              <div className="flex items-center justify-between" style={{ borderTop: '1px solid #E8ECF0', paddingTop: '12px' }}>
                <Label className="text-[12px] text-[#2d3142]">显示干涉图</Label>
                <Switch checked={showInterferogram} onCheckedChange={setShowInterferogram} />
              </div>
            )}

            {/* 预设 */}
            <div style={{ borderTop: '1px solid #E8ECF0', paddingTop: '12px' }}>
              <div style={{ fontFamily: FONT, fontSize: '10px', color: '#888', marginBottom: '6px' }}>快速预设</div>
              <div className="flex flex-wrap gap-1.5">
                <PresetBtn label="理想" onClick={() => { setW040(0); setW131(0); setW222(0); setW220(0); setW111(0) }} />
                <PresetBtn label="纯球差" onClick={() => { setW040(3); setW131(0); setW222(0); setW220(0); setW111(0) }} />
                <PresetBtn label="纯彗差" onClick={() => { setW040(0); setW131(3); setW222(0); setW220(0); setW111(0) }} />
                <PresetBtn label="纯像散" onClick={() => { setW040(0); setW131(0); setW222(3); setW220(0); setW111(0) }} />
                <PresetBtn label="组合" onClick={() => { setW040(2); setW131(1.5); setW222(1); setW220(0.5); setW111(0) }} />
              </div>
            </div>

            {/* 计算结果 */}
            <div style={{ borderTop: '1px solid #E8ECF0', paddingTop: '12px' }}>
              <div style={{ fontFamily: FONT, fontSize: '10px', color: '#888', marginBottom: '6px', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                像质评价
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
                <ResultItem label="PV 波像差" value={`${pv.toFixed(2)} λ`} />
                <ResultItem label="RMS 波像差 σ" value={`${rms.toFixed(3)} λ`} />
                <ResultItem label="Strehl 比" value={strehl.toFixed(3)} />
                <ResultItem label="Maréchal 判据" value={diffractionLimited ? '✓ 满足' : '✗ 不满足'} />
              </div>
              <div style={{
                marginTop: '8px', padding: '6px 8px',
                backgroundColor: diffractionLimited ? '#F0FAF0' : '#FAF0F0',
                border: `1px solid ${diffractionLimited ? '#C0E0C0' : '#E0C0C0'}`,
                borderRadius: '2px',
                fontFamily: FONT, fontSize: '9px',
                color: diffractionLimited ? '#2A6B2A' : '#8B2A2A',
              }}>
                {diffractionLimited
                  ? `✓ 衍射极限：σ < λ/14 (${(1/14).toFixed(3)}λ)，Strehl > 0.8`
                  : `✗ 非衍射极限：σ ≥ λ/14，需校正像差`}
              </div>
            </div>

            {/* 公式参考 */}
            <div style={{
              padding: '10px 12px', backgroundColor: '#FAFAFA',
              border: '1px solid #E8ECF0', borderRadius: '2px',
            }}>
              <div style={{ fontFamily: FONT, fontSize: '10px', color: '#888', marginBottom: '6px' }}>公式参考</div>
              <div style={{ fontFamily: MONO, fontSize: '9px', color: '#333', lineHeight: 1.8 }}>
                <div>W = W₀₄₀ρ⁴ + W₁₃₁ρ³cosθ·H</div>
                <div>　 + W₂₂₂ρ²cos²θ·H²</div>
                <div>　 + W₂₂₀ρ²H² + W₁₁₁ρcosθ·H³</div>
                <div style={{ marginTop: '4px' }}>σ² = &lt;W²&gt; - &lt;W&gt;²</div>
                <div>S ≈ exp(-(2πσ)²)</div>
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
          {mode === 'wavefront' && (
            <>
              <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', justifyContent: 'center' }}>
                <div>
                  <div style={{ fontFamily: FONT, fontSize: '11px', fontWeight: 600, color: '#1A1A1A', marginBottom: '6px', textAlign: 'center' }}>
                    波像差 W(ρ,θ)
                  </div>
                  <WavefrontMap H={H} W040={W040} W131={W131} W222={W222} W220={W220} W111={W111} size={isMobile ? 260 : 300} />
                </div>
                {showInterferogram && (
                  <div>
                    <div style={{ fontFamily: FONT, fontSize: '11px', fontWeight: 600, color: '#1A1A1A', marginBottom: '6px', textAlign: 'center' }}>
                      干涉图（Twyman-Green）
                    </div>
                    <InterferogramCanvas H={H} W040={W040} W131={W131} W222={W222} W220={W220} W111={W111} size={isMobile ? 260 : 300} />
                  </div>
                )}
              </div>

              {/* 活跃像差列表 */}
              <div style={{
                width: '100%', maxWidth: '620px',
                padding: '10px 12px', backgroundColor: '#FAFAFA',
                border: '1px solid #E8ECF0', borderRadius: '2px',
              }}>
                <div style={{ fontFamily: FONT, fontSize: '10px', color: '#888', marginBottom: '6px', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                  活跃像差 ({activeAberrations.length})
                </div>
                {activeAberrations.length === 0 ? (
                  <div style={{ fontFamily: FONT, fontSize: '11px', color: '#2A6B2A' }}>✓ 无像差（理想系统）</div>
                ) : (
                  activeAberrations.map(a => (
                    <div key={a} style={{ marginBottom: '6px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontFamily: FONT, fontSize: '11px', fontWeight: 600, color: '#1A1A1A' }}>{ABERRATION_INFO[a].name}</span>
                        <span style={{ fontFamily: MONO, fontSize: '10px', color: '#555' }}>{ABERRATION_INFO[a].coeff}</span>
                        <span style={{ fontFamily: MONO, fontSize: '10px', color: '#CC3333' }}>
                          = {a === 'spherical' ? W040.toFixed(2) : a === 'coma' ? W131.toFixed(2) : a === 'astigmatism' ? W222.toFixed(2) : a === 'fieldCurvature' ? W220.toFixed(2) : W111.toFixed(2)}λ
                        </span>
                      </div>
                      <div style={{ fontFamily: FONT, fontSize: '9px', color: '#888', marginTop: '2px' }}>{ABERRATION_INFO[a].desc}</div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}

          {mode === 'spot-diagram' && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: FONT, fontSize: '11px', fontWeight: 600, color: '#1A1A1A', marginBottom: '6px' }}>
                点列图 · 三视场点 (H = 0 / 0.7 / 1.0)
              </div>
              <SpotDiagram H={H} W040={W040} W131={W131} W222={W222} W220={W220} W111={W111} size={isMobile ? 300 : 480} />
              <div style={{
                marginTop: '12px', padding: '10px 12px', backgroundColor: '#FAFAFA',
                border: '1px solid #E8ECF0', borderRadius: '2px',
                fontFamily: FONT, fontSize: '10px', color: '#666', lineHeight: 1.7, maxWidth: '500px', textAlign: 'left',
              }}>
                <b style={{ color: '#333' }}>读图：</b>每个子图显示一个视场点的光线分布。橙色虚线圆为 Airy 衍射斑参考。若点列图小于 Airy 斑，则系统受衍射限制；否则受像差限制。
              </div>
            </div>
          )}

          {mode === 'fan-plot' && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: FONT, fontSize: '11px', fontWeight: 600, color: '#1A1A1A', marginBottom: '6px' }}>
                光扇图 · 子午 + 弧矢
              </div>
              <FanPlotSVG H={H} W040={W040} W131={W131} W222={W222} W220={W220} W111={W111} width={isMobile ? 320 : 520} height={220} />
              <div style={{
                marginTop: '12px', padding: '10px 12px', backgroundColor: '#FAFAFA',
                border: '1px solid #E8ECF0', borderRadius: '2px',
                fontFamily: FONT, fontSize: '10px', color: '#666', lineHeight: 1.7, maxWidth: '500px', textAlign: 'left',
              }}>
                <b style={{ color: '#333' }}>读图：</b>横轴为归一化光瞳坐标 ρ，纵轴为横向像差。曲线斜率与形状反映不同像差类型：球差为 S 形、彗差为抛物线、像散使子午与弧矢曲线分离。
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ─── 像差系数滑块 ─── */
function AberrationSlider({
  label, coeff, value, onChange, desc,
}: {
  label: string
  coeff: string
  value: number
  onChange: (v: number) => void
  desc: string
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span style={{ fontFamily: "system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif", fontSize: '11px', fontWeight: 500, color: '#1A1A1A' }}>
          {label} <span style={{ fontFamily: 'var(--font-geist-mono), ui-monospace, monospace', fontSize: '9px', color: '#888' }}>{coeff}</span>
        </span>
        <span className="tabular-nums" style={{ fontFamily: 'var(--font-geist-mono), ui-monospace, monospace', fontSize: '11px', color: value === 0 ? '#CCC' : '#CC3333', fontWeight: 600 }}>
          {value.toFixed(2)}λ
        </span>
      </div>
      <Slider value={[value]} min={-5} max={5} step={0.1} onValueChange={([v]) => onChange(v)} />
      <div style={{ fontFamily: "system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif", fontSize: '9px', color: '#999', lineHeight: 1.4 }}>
        {desc}
      </div>
    </div>
  )
}

function PresetBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontFamily: "system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif", fontSize: '10px', fontWeight: 500,
        padding: '3px 8px', minHeight: '28px',
        border: '1px solid #D0D0D0', backgroundColor: '#FFFFFF',
        color: '#555', cursor: 'pointer', borderRadius: '2px',
        transition: 'all 120ms ease-out',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = '#1A1A1A'; e.currentTarget.style.color = '#1A1A1A' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = '#D0D0D0'; e.currentTarget.style.color = '#555' }}
    >
      {label}
    </button>
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
