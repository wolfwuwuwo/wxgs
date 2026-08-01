'use client'

/* ═══════════════════════════════════════════════════════════════════
   LaserResonator — 激光谐振腔设计器
   4 种腔型：对称共焦 · 平凹(半球) · 凹凸 · 平平(临界)
   稳定性图 g1·g2 · ABCD 往返传输 · Hermite-Gaussian 本征模
   ═══════════════════════════════════════════════════════════════════ */

import { useState, useRef, useMemo, useEffect } from 'react'
import { Slider } from '@/components/ui/slider'
import { Label } from '@/components/ui/label'
import { useIsMobile } from '@/hooks/use-mobile'
import { ControlPanel, MobilePanelToggle } from './shared/ControlPanel'
import { TearOffButton } from './shared/TearOffPanel'
import { useSnapshotTarget } from '@/hooks/use-snapshot-target'
import { blitImageData } from '@/lib/utils'

const FONT = "system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif"
const MONO = 'var(--font-geist-mono), ui-monospace, monospace'
const VIEW_ID = 'modern-resonator' as const

type ResonatorPreset = 'symmetric-confocal' | 'hemispherical' | 'concave-convex' | 'plane-plane'

const PRESET_LABELS: Record<ResonatorPreset, string> = {
  'symmetric-confocal': '对称共焦腔',
  'hemispherical': '半球腔 (平凹)',
  'concave-convex': '凹凸腔',
  'plane-plane': '平平腔 (临界)',
}

const PRESET_DESC: Record<ResonatorPreset, string> = {
  'symmetric-confocal': '两面曲率半径相同的凹面镜，距离 = R。g₁=g₂=0，共焦点，本征模半径最小',
  'hemispherical': '一面平面镜 + 一面凹面镜，距离 ≈ R。g₁=1, g₂≈0，常用于固体激光器',
  'concave-convex': '凹面镜 + 凸面镜，可形成稳定腔且束腰在凸面镜外，望远镜式扩束',
  'plane-plane': '两面平面镜，g₁=g₂=1，临界稳定。本征模由增益孔径决定，多模振荡',
}

const MIRROR_COLOR = '#1A1A1A'
const AXIS_COLOR = '#888888'
const BEAM_COLOR = '#CC0000'
const WAIST_COLOR = '#0066CC'
const STABLE_COLOR = '#00AA44'
const UNSTABLE_COLOR = '#CC0000'

/* ─── ABCD 矩阵类 ─── */
interface ABCD { a: number; b: number; c: number; d: number }
function matMul(m1: ABCD, m2: ABCD): ABCD {
  return {
    a: m1.a * m2.a + m1.b * m2.c,
    b: m1.a * m2.b + m1.b * m2.d,
    c: m1.c * m2.a + m1.d * m2.c,
    d: m1.c * m2.b + m1.d * m2.d,
  }
}

/* ─── 计算谐振腔参数 ─── */
function computeResonator(R1: number, R2: number, L: number, lambda: number) {
  // g 参数: g = 1 - L/R
  const g1 = 1 - L / R1
  const g2 = 1 - L / R2
  // 稳定性条件: 0 ≤ g1·g2 ≤ 1
  const g1g2 = g1 * g2
  const isStable = g1g2 > 0 && g1g2 < 1
  const isEdge = Math.abs(g1g2) < 0.01 || Math.abs(g1g2 - 1) < 0.01
  // 本征模束腰半径 (高斯光束)
  // w₀² = (λL/π) · √(g1·g2·(1-g1·g2)) / (g1+g2-2·g1·g2)
  let w0 = 0
  if (isStable) {
    const num = g1g2 * (1 - g1g2)
    const den = g1 + g2 - 2 * g1g2
    if (den > 0) {
      w0 = Math.sqrt((lambda * L / Math.PI) * Math.sqrt(num) / den) // mm
    }
  }
  // 镜面光斑半径
  // w1² = w0² · (1 + (λL/(π w0²))² · (g2/(g1·(1-g1·g2)))²)
  let w1 = 0, w2 = 0
  if (isStable && w0 > 0) {
    const z0 = Math.PI * w0 * w0 / lambda // 瑞利长度
    w1 = w0 * Math.sqrt(1 + Math.pow(L * g2 / (z0 * g1), 2) * (1 - g1g2))
    w2 = w0 * Math.sqrt(1 + Math.pow(L * g1 / (z0 * g2), 2) * (1 - g1g2))
  }
  // 共焦参数 b = 2·z0 = 2·π·w0²/λ
  const confocalParam = w0 > 0 ? 2 * Math.PI * w0 * w0 / lambda : 0
  // 等效菲涅尔数
  const N_eff = 1 // 简化
  // 往返 ABCD: M = M_free(L) · M_mirror(R2) · M_free(L) · M_mirror(R1)
  // 反射等效：穿过镜面 = 自由空间 L + 薄透镜 f=R/2 (反射等效)
  // 但更常用：反射镜面用 (1, 0, -2/R, 1) 矩阵
  const M_R1: ABCD = { a: 1, b: 0, c: -2 / R1, d: 1 }
  const M_R2: ABCD = { a: 1, b: 0, c: -2 / R2, d: 1 }
  const M_L: ABCD = { a: 1, b: L, c: 0, d: 1 }
  // 往返：从镜1出发 → L → 镜2 → L → 镜1
  const roundTrip = matMul(matMul(matMul(M_R1, M_L), M_R2), M_L)
  // 追迹复束参量 q
  // 1/q = 1/R - i λ/(π w²)
  // q_after = (A q + B) / (C q + D)
  return {
    g1, g2, g1g2, isStable, isEdge,
    w0, w1, w2, confocalParam,
    roundTrip,
  }
}

/* ═══════════════════════════════════════════════════════════════════
   稳定性图 g1·g2 (稳定性菇形)
   ═══════════════════════════════════════════════════════════════════ */
function StabilityDiagram({
  g1, g2, width, height,
}: {
  g1: number
  g2: number
  width: number
  height: number
}) {
  // 坐标范围 g ∈ [-1.5, 2.5]
  const gmin = -1.5, gmax = 2.5
  const x2g = (x: number) => gmin + (x / width) * (gmax - gmin)
  const g2x = (g: number) => (g - gmin) / (gmax - gmin) * width
  const g2y = (g: number) => height - (g - gmin) / (gmax - gmin) * height

  // 稳定区域：0 ≤ g1·g2 ≤ 1，即双曲线 g2 = 1/g1 与坐标轴之间
  // 绘制稳定区域填充
  const stablePath = (() => {
    // 第一象限稳定区：g1 > 0, g2 > 0, g1·g2 < 1
    // 第三象限稳定区：g1 < 0, g2 < 0, g1·g2 < 1 (always when both neg)
    const pts1: string[] = []
    // 第一象限
    for (let i = 0; i <= 100; i++) {
      const gg1 = 0.01 + (i / 100) * (gmax - 0.01)
      const gg2 = 1 / gg1
      if (gg2 <= gmax) pts1.push(`${g2x(gg1)},${g2y(gg2)}`)
    }
    const path1 = `M ${g2x(0)},${g2y(0)} L ${pts1.join(' L ')} L ${g2x(gmax)},${g2y(0)} Z`
    // 第三象限 (g1<0, g2<0, g1·g2 ≤ 1 自动满足)
    const path2 = `M ${g2x(0)},${g2y(0)} L ${g2x(gmin)},${g2y(0)} L ${g2x(gmin)},${g2y(gmin)} L ${g2x(0)},${g2y(gmin)} Z`
    return [path1, path2]
  })()

  const isStable = g1 * g2 > 0 && g1 * g2 < 1

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
      {/* 背景 */}
      <rect width={width} height={height} fill="#FFFFFF" />

      {/* 稳定区域填充 */}
      <path d={stablePath[0]} fill="rgba(0,170,68,0.08)" stroke="none" />
      <path d={stablePath[1]} fill="rgba(0,170,68,0.08)" stroke="none" />

      {/* 双曲线 g1·g2 = 1 边界 */}
      <path d={stablePath[0]} fill="none" stroke={STABLE_COLOR} strokeWidth="1.2" strokeDasharray="4,3" />
      {/* 坐标轴 g1=0 和 g2=0 也是边界 */}
      <line x1={g2x(0)} y1={0} x2={g2x(0)} y2={height} stroke={STABLE_COLOR} strokeWidth="1.2" strokeDasharray="4,3" />
      <line x1={0} y1={g2y(0)} x2={width} y2={g2y(0)} stroke={STABLE_COLOR} strokeWidth="1.2" strokeDasharray="4,3" />

      {/* 主坐标轴 */}
      <line x1={0} y1={g2y(0)} x2={width} y2={g2y(0)} stroke="#888" strokeWidth="0.6" />
      <line x1={g2x(0)} y1={0} x2={g2x(0)} y2={height} stroke="#888" strokeWidth="0.6" />
      {/* g1=1, g2=1 标记 */}
      <line x1={g2x(1)} y1={0} x2={g2x(1)} y2={height} stroke="#E0E4E8" strokeWidth="0.4" strokeDasharray="2,3" />
      <line x1={0} y1={g2y(1)} x2={width} y2={g2y(1)} stroke="#E0E4E8" strokeWidth="0.4" strokeDasharray="2,3" />

      {/* 坐标刻度 */}
      {[-1, 0, 1, 2].map(g => (
        <g key={`x${g}`}>
          <line x1={g2x(g)} y1={g2y(0) - 3} x2={g2x(g)} y2={g2y(0) + 3} stroke="#888" strokeWidth="0.6" />
          <text x={g2x(g)} y={g2y(0) + 14} textAnchor="middle" fontSize="9" fill="#888" fontFamily={MONO}>{g}</text>
        </g>
      ))}
      {[-1, 0, 1, 2].map(g => (
        <g key={`y${g}`}>
          <line x1={g2x(0) - 3} y1={g2y(g)} x2={g2x(0) + 3} y2={g2y(g)} stroke="#888" strokeWidth="0.6" />
          <text x={g2x(0) - 6} y={g2y(g) + 3} textAnchor="end" fontSize="9" fill="#888" fontFamily={MONO}>{g}</text>
        </g>
      ))}

      {/* 轴标签 */}
      <text x={width - 4} y={g2y(0) - 6} textAnchor="end" fontSize="11" fill="#1A1A1A" fontFamily={FONT} fontWeight="600">g₁</text>
      <text x={g2x(0) + 6} y={12} textAnchor="start" fontSize="11" fill="#1A1A1A" fontFamily={FONT} fontWeight="600">g₂</text>

      {/* 稳定区标签 */}
      <text x={g2x(0.5)} y={g2y(0.5)} textAnchor="middle" fontSize="10" fill={STABLE_COLOR} fontFamily={FONT} fontWeight="600">稳定区</text>
      <text x={g2x(-0.5)} y={g2y(-0.5)} textAnchor="middle" fontSize="10" fill={STABLE_COLOR} fontFamily={FONT} fontWeight="600">稳定区</text>

      {/* 特殊点标记 */}
      {/* 共焦腔 g1=g2=0 */}
      <circle cx={g2x(0)} cy={g2y(0)} r="3" fill="none" stroke="#888" strokeWidth="0.8" />
      <text x={g2x(0) + 6} y={g2y(0) - 4} fontSize="8" fill="#888" fontFamily={FONT}>共焦</text>
      {/* 平平腔 g1=g2=1 */}
      <circle cx={g2x(1)} cy={g2y(1)} r="3" fill="none" stroke="#888" strokeWidth="0.8" />
      <text x={g2x(1) + 6} y={g2y(1) - 4} fontSize="8" fill="#888" fontFamily={FONT}>平平</text>
      {/* 同心腔 g1=g2=-1 */}
      <circle cx={g2x(-1)} cy={g2y(-1)} r="3" fill="none" stroke="#888" strokeWidth="0.8" />
      <text x={g2x(-1) + 6} y={g2y(-1) - 4} fontSize="8" fill="#888" fontFamily={FONT}>同心</text>

      {/* 当前工作点 */}
      <g>
        <circle cx={g2x(g1)} cy={g2y(g2)} r="8" fill="none" stroke={isStable ? STABLE_COLOR : UNSTABLE_COLOR} strokeWidth="1" opacity="0.4" />
        <circle cx={g2x(g1)} cy={g2y(g2)} r="4" fill={isStable ? STABLE_COLOR : UNSTABLE_COLOR} />
        <text x={g2x(g1) + 8} y={g2y(g2) - 6} fontSize="10" fill={isStable ? STABLE_COLOR : UNSTABLE_COLOR} fontFamily={MONO} fontWeight="600">
          ({g1.toFixed(2)}, {g2.toFixed(2)})
        </text>
      </g>
    </svg>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   谐振腔光路 SVG（镜片 + 高斯本征模包络）
   ═══════════════════════════════════════════════════════════════════ */
function ResonatorSVG({
  R1, R2, L, w0, w1, w2, lambda, width, height,
}: {
  R1: number
  R2: number
  L: number
  w0: number
  w1: number
  w2: number
  lambda: number
  width: number
  height: number
}) {
  const cy = height / 2
  const margin = 40
  const x1 = margin
  const x2 = width - margin

  // 高斯光束包络点：在 z ∈ [0, L] 上计算 w(z)
  // w(z) = w0 · √(1 + ((z - z0)/zR)²)
  // 假设束腰在某位置 z_w (简化为 L/2 或镜面位置)
  // 对于一般腔，束腰位置由 R1, R2, L 决定
  // 双凹腔对称时束腰在 L/2
  // 简化：取束腰位置 z_w = L/2 - 不一定准确，但视觉合理
  const z_waist = L / 2 // 简化
  const zR = w0 > 0 ? Math.PI * w0 * w0 / lambda : 0

  const envelopePoints: string[] = []
  const N = 80
  for (let i = 0; i <= N; i++) {
    const z = (i / N) * L
    let w: number
    if (w0 > 0 && zR > 0) {
      w = w0 * Math.sqrt(1 + Math.pow((z - z_waist) / zR, 2))
    } else {
      w = 8 // 不稳定腔显示平行线
    }
    // 视觉缩放
    const w_scaled = Math.min(w * 40, height / 2 - 30)
    const x = x1 + (z / L) * (x2 - x1)
    envelopePoints.push(`${x},${cy - w_scaled}`)
  }
  for (let i = N; i >= 0; i--) {
    const z = (i / N) * L
    let w: number
    if (w0 > 0 && zR > 0) {
      w = w0 * Math.sqrt(1 + Math.pow((z - z_waist) / zR, 2))
    } else {
      w = 8
    }
    const w_scaled = Math.min(w * 40, height / 2 - 30)
    const x = x1 + (z / L) * (x2 - x1)
    envelopePoints.push(`${x},${cy + w_scaled}`)
  }
  const envelopePath = `M ${envelopePoints.join(' L ')} Z`

  // 镜片绘制
  const mirrorR = 22
  const drawMirror = (x: number, R: number, label: string) => {
    const isFlat = !isFinite(R) || Math.abs(R) > 1e6
    if (isFlat) {
      return (
        <g>
          <line x1={x} y1={cy - mirrorR} x2={x} y2={cy + mirrorR} stroke={MIRROR_COLOR} strokeWidth="2" />
          <line x1={x - 5} y1={cy - mirrorR} x2={x - 1} y2={cy - mirrorR} stroke={MIRROR_COLOR} strokeWidth="0.6" />
          <line x1={x - 5} y1={cy + mirrorR} x2={x - 1} y2={cy + mirrorR} stroke={MIRROR_COLOR} strokeWidth="0.6" />
          {Array.from({ length: 6 }).map((_, i) => (
            <line key={i} x1={x - 4} y1={cy - mirrorR + 3 + i * (mirrorR * 2 - 6) / 5} x2={x - 1} y2={cy - mirrorR + 3 + i * (mirrorR * 2 - 6) / 5 - 3} stroke={MIRROR_COLOR} strokeWidth="0.5" />
          ))}
        </g>
      )
    }
    const sign = R > 0 ? 1 : -1
    const convex = sign > 0
    const curveD = convex ? 6 : -6
    return (
      <g>
        <path d={`M ${x} ${cy - mirrorR} Q ${x + curveD} ${cy} ${x} ${cy + mirrorR}`} fill="none" stroke={MIRROR_COLOR} strokeWidth="2" />
        <line x1={x - 5} y1={cy - mirrorR} x2={x - 1} y2={cy - mirrorR} stroke={MIRROR_COLOR} strokeWidth="0.6" />
        <line x1={x - 5} y1={cy + mirrorR} x2={x - 1} y2={cy + mirrorR} stroke={MIRROR_COLOR} strokeWidth="0.6" />
        {Array.from({ length: 6 }).map((_, i) => (
          <line key={i} x1={x - 4} y1={cy - mirrorR + 3 + i * (mirrorR * 2 - 6) / 5} x2={x - 1} y2={cy - mirrorR + 3 + i * (mirrorR * 2 - 6) / 5 - 3} stroke={MIRROR_COLOR} strokeWidth="0.5" />
        ))}
        <text x={x} y={cy + mirrorR + 16} textAnchor="middle" fontSize="10" fill="#1A1A1A" fontFamily={FONT} fontWeight="600">{label}</text>
        <text x={x} y={cy + mirrorR + 28} textAnchor="middle" fontSize="9" fill="#666" fontFamily={MONO}>R={R > 1e6 ? '∞' : `${R.toFixed(0)}mm`}</text>
      </g>
    )
  }

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
      <rect width={width} height={height} fill="#FFFFFF" />

      {/* 光轴 */}
      <line x1={0} y1={cy} x2={width} y2={cy} stroke={AXIS_COLOR} strokeWidth="0.6" strokeDasharray="6,3,2,3" />

      {/* 高斯光束包络填充 */}
      <path d={envelopePath} fill="rgba(204,0,0,0.08)" stroke="none" />
      {/* 包络上下轮廓 */}
      <path d={`M ${envelopePoints.slice(0, N + 1).join(' L ')}`} fill="none" stroke={BEAM_COLOR} strokeWidth="1.2" />
      <path d={`M ${envelopePoints.slice(N + 1).join(' L ')}`} fill="none" stroke={BEAM_COLOR} strokeWidth="1.2" />

      {/* 中心光线 */}
      <line x1={x1} y1={cy} x2={x2} y2={cy} stroke={BEAM_COLOR} strokeWidth="0.6" opacity="0.5" />

      {/* 束腰标记 */}
      {w0 > 0 && (
        <g>
          <line x1={(x1 + x2) / 2} y1={cy - 14} x2={(x1 + x2) / 2} y2={cy + 14} stroke={WAIST_COLOR} strokeWidth="0.8" strokeDasharray="2,2" />
          <text x={(x1 + x2) / 2} y={cy - 18} textAnchor="middle" fontSize="9" fill={WAIST_COLOR} fontFamily={FONT} fontWeight="600">束腰 w₀</text>
          <text x={(x1 + x2) / 2} y={cy - 30} textAnchor="middle" fontSize="9" fill={WAIST_COLOR} fontFamily={MONO}>{w0.toFixed(3)} mm</text>
        </g>
      )}

      {/* 镜片 */}
      {drawMirror(x1, R1, 'M1')}
      {drawMirror(x2, -R2, 'M2')}

      {/* 腔长标注 */}
      <g>
        <line x1={x1} y1={cy + mirrorR + 40} x2={x2} y2={cy + mirrorR + 40} stroke="#888" strokeWidth="0.5" />
        <line x1={x1} y1={cy + mirrorR + 37} x2={x1} y2={cy + mirrorR + 43} stroke="#888" strokeWidth="0.5" />
        <line x1={x2} y1={cy + mirrorR + 37} x2={x2} y2={cy + mirrorR + 43} stroke="#888" strokeWidth="0.5" />
        <text x={(x1 + x2) / 2} y={cy + mirrorR + 52} textAnchor="middle" fontSize="9" fill="#888" fontFamily={MONO}>L = {L}mm</text>
      </g>

      {/* 光斑半径标注 */}
      {w0 > 0 && (
        <>
          <text x={x1 + 8} y={cy - 26} fontSize="9" fill={BEAM_COLOR} fontFamily={MONO}>w₁={w1.toFixed(3)}</text>
          <text x={x2 - 8} y={cy - 26} textAnchor="end" fontSize="9" fill={BEAM_COLOR} fontFamily={MONO}>w₂={w2.toFixed(3)}</text>
        </>
      )}
    </svg>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   Hermite-Gaussian 横模强度分布
   ═══════════════════════════════════════════════════════════════════ */
function HermiteModeCanvas({
  m, n, w0, lambda, width, height,
}: {
  m: number
  n: number
  w0: number
  lambda: number
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

    // Hermite 多项式 H_m(x)
    const hermite = (m: number, x: number): number => {
      if (m === 0) return 1
      if (m === 1) return 2 * x
      let h_prev = 1, h_curr = 2 * x
      for (let i = 2; i <= m; i++) {
        const h_next = 2 * x * h_curr - 2 * (i - 1) * h_prev
        h_prev = h_curr
        h_curr = h_next
      }
      return h_curr
    }

    // 模式强度 I(x,y) = |H_m(x/w) · H_n(y/w) · exp(-(x²+y²)/(2w²))|²
    const w = w0 * 200 // 视觉放大
    const cx = width / 2, cy = height / 2
    const imageData = ctx.createImageData(width, height)
    const data = imageData.data
    let maxI = 0
    const intensities: number[] = new Array(width * height)
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const x = (px + 0.5 - cx) / w
        const y = (py + 0.5 - cy) / w
        const Hm = hermite(m, x)
        const Hn = hermite(n, y)
        const gauss = Math.exp(-(x * x + y * y))
        const I = Hm * Hm * Hn * Hn * gauss * gauss
        intensities[py * width + px] = I
        if (I > maxI) maxI = I
      }
    }
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const I = intensities[py * width + px] / (maxI || 1)
        const idx = (py * width + px) * 4
        // 红光伪彩色
        data[idx] = Math.floor(I * 204)
        data[idx + 1] = 0
        data[idx + 2] = 0
        data[idx + 3] = Math.floor(I * 255)
      }
    }
    blitImageData(ctx, imageData, width, height)
  }, [m, n, w0, lambda, width, height])

  return <canvas ref={canvasRef} />
}

/* ═══════════════════════════════════════════════════════════════════
   主组件
   ═══════════════════════════════════════════════════════════════════ */
interface Props {
  onBack: () => void
}

export default function LaserResonator({ onBack }: Props) {
  const isMobile = useIsMobile()
  const [panelOpen, setPanelOpen] = useState(false)
  const [preset, setPreset] = useState<ResonatorPreset>('symmetric-confocal')
  const [R1, setR1] = useState(200) // mm
  const [R2, setR2] = useState(200) // mm
  const [L, setL] = useState(100) // mm
  const [lambda] = useState(0.6328) // μm (He-Ne)
  const [modeM, setModeM] = useState(0)
  const [modeN, setModeN] = useState(0)
  const vizRef = useRef<HTMLDivElement>(null)

  // 应用预设
  const applyPreset = (p: ResonatorPreset) => {
    setPreset(p)
    if (p === 'symmetric-confocal') { setR1(200); setR2(200); setL(100) }
    else if (p === 'hemispherical') { setR1(1e7); setR2(200); setL(180) }
    else if (p === 'concave-convex') { setR1(300); setR2(-150); setL(120) }
    else if (p === 'plane-plane') { setR1(1e7); setR2(1e7); setL(100) }
  }

  const result = useMemo(() => computeResonator(R1, R2, L, lambda), [R1, R2, L, lambda])

  useSnapshotTarget(VIEW_ID, {
    targetRef: vizRef,
    getTitle: () => `${PRESET_LABELS[preset]} · g₁=${result.g1.toFixed(2)} g₂=${result.g2.toFixed(2)} · ${result.isStable ? '稳定' : '不稳定'}`,
    getParams: () => [
      { key: '腔型', value: PRESET_LABELS[preset] },
      { key: 'R₁', value: R1 > 1e6 ? '∞' : `${R1}mm` },
      { key: 'R₂', value: R2 > 1e6 ? '∞' : `${R2}mm` },
      { key: 'L', value: `${L}mm` },
      { key: 'g₁g₂', value: result.g1g2.toFixed(3) },
      { key: 'w₀', value: `${result.w0.toFixed(3)}mm` },
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
          激光谐振腔设计器
        </h1>
        {!isMobile && (
          <span style={{ marginLeft: '4px', fontSize: '9px', color: '#888888',
            border: '1px solid #D0D0D0', borderRadius: '2px', padding: '1px 6px', flexShrink: 0 }}>
            0 ≤ g₁g₂ ≤ 1
          </span>
        )}

        <div className={isMobile ? 'flex overflow-x-auto mobile-x-scroll flex-1 min-w-0' : 'flex'} style={{
          marginLeft: isMobile ? '8px' : 'auto', gap: '2px', flexWrap: 'nowrap' as const,
        }}>
          {(Object.keys(PRESET_LABELS) as ResonatorPreset[]).map(p => (
            <button
              key={p}
              onClick={() => applyPreset(p)}
              style={{
                fontFamily: FONT, fontSize: isMobile ? '11px' : '12px', fontWeight: 500,
                padding: '4px 10px', minHeight: '44px',
                border: '1px solid ' + (preset === p ? '#1A1A1A' : '#D0D0D0'),
                backgroundColor: preset === p ? '#1A1A1A' : '#FFFFFF',
                color: preset === p ? '#FFFFFF' : '#555555',
                cursor: 'pointer', borderRadius: '2px',
                transition: 'all 120ms ease-out',
                whiteSpace: 'nowrap', flexShrink: 0,
              }}
            >
              {PRESET_LABELS[p]}
            </button>
          ))}
        </div>

        {isMobile && <MobilePanelToggle onClick={() => setPanelOpen(true)} label="参数" />}
        <TearOffButton
          viewId={VIEW_ID}
          title={`${PRESET_LABELS[preset]} · ${result.isStable ? '稳定' : '不稳定'}`}
          params={[
            { key: 'g₁g₂', value: result.g1g2.toFixed(3) },
            { key: 'w₀', value: `${result.w0.toFixed(3)}mm` },
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
          title="谐振腔参数"
          desktopWidth="w-80"
        >
          <div className="space-y-5">
            {/* 模式说明 */}
            <div style={{
              padding: '8px 10px', backgroundColor: '#FAFAFA',
              border: '1px solid #E8ECF0', borderRadius: '2px',
            }}>
              <div style={{ fontFamily: FONT, fontSize: '10px', color: '#888', marginBottom: '3px', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                当前腔型
              </div>
              <div style={{ fontFamily: FONT, fontSize: '12px', fontWeight: 600, color: '#1A1A1A', marginBottom: '4px' }}>
                {PRESET_LABELS[preset]}
              </div>
              <div style={{ fontFamily: FONT, fontSize: '10px', color: '#666', lineHeight: 1.5 }}>
                {PRESET_DESC[preset]}
              </div>
            </div>

            {/* 镜1曲率 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-[12px] text-[#2d3142]">镜1 曲率半径 R₁</Label>
                <span className="tabular-nums text-[11px] text-[#6b7280]" style={{ fontFamily: MONO }}>{R1 > 1e6 ? '∞ (平面)' : `${R1} mm`}</span>
              </div>
              <Slider value={[Math.min(R1, 2000)]} min={-500} max={2000} step={10} onValueChange={([v]) => setR1(v)} />
              <div className="flex justify-between text-[9px] text-[#aaa]">
                <span>-500mm (凸)</span><span>2000mm (凹)</span>
              </div>
              <button onClick={() => setR1(1e7)} style={{
                fontFamily: FONT, fontSize: '10px', color: '#888',
                background: 'none', border: '1px solid #D0D0D0', borderRadius: '2px',
                padding: '2px 8px', cursor: 'pointer', marginTop: '4px',
              }}>设为平面镜</button>
            </div>

            {/* 镜2曲率 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-[12px] text-[#2d3142]">镜2 曲率半径 R₂</Label>
                <span className="tabular-nums text-[11px] text-[#6b7280]" style={{ fontFamily: MONO }}>{R2 > 1e6 ? '∞ (平面)' : `${R2} mm`}</span>
              </div>
              <Slider value={[Math.min(R2, 2000)]} min={-500} max={2000} step={10} onValueChange={([v]) => setR2(v)} />
              <div className="flex justify-between text-[9px] text-[#aaa]">
                <span>-500mm (凸)</span><span>2000mm (凹)</span>
              </div>
              <button onClick={() => setR2(1e7)} style={{
                fontFamily: FONT, fontSize: '10px', color: '#888',
                background: 'none', border: '1px solid #D0D0D0', borderRadius: '2px',
                padding: '2px 8px', cursor: 'pointer', marginTop: '4px',
              }}>设为平面镜</button>
            </div>

            {/* 腔长 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-[12px] text-[#2d3142]">腔长 L</Label>
                <span className="tabular-nums text-[11px] text-[#6b7280]" style={{ fontFamily: MONO }}>{L} mm</span>
              </div>
              <Slider value={[L]} min={10} max={400} step={5} onValueChange={([v]) => setL(v)} />
              <div className="flex justify-between text-[9px] text-[#aaa]">
                <span>10mm</span><span>400mm</span>
              </div>
            </div>

            {/* 稳定性状态 */}
            <div style={{
              padding: '10px 12px', backgroundColor: '#FFFFFF',
              border: `1px solid ${result.isStable ? STABLE_COLOR : UNSTABLE_COLOR}`, borderRadius: '2px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ fontFamily: FONT, fontSize: '10px', fontWeight: 600, color: '#1A1A1A', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                  稳定性判据
                </span>
                <span style={{
                  fontFamily: FONT, fontSize: '10px', fontWeight: 600,
                  color: result.isStable ? STABLE_COLOR : UNSTABLE_COLOR,
                  display: 'flex', alignItems: 'center', gap: '4px',
                }}>
                  <span style={{
                    width: '6px', height: '6px', borderRadius: '50%',
                    backgroundColor: result.isStable ? STABLE_COLOR : UNSTABLE_COLOR,
                  }} />
                  {result.isStable ? '稳定' : result.isEdge ? '临界' : '不稳定'}
                </span>
              </div>
              <div className="space-y-1" style={{ fontFamily: FONT, fontSize: '11px' }}>
                <div className="flex justify-between"><span style={{ color: '#666' }}>g₁ = 1 - L/R₁</span><span className="tabular-nums" style={{ fontFamily: MONO, color: '#1A1A1A', fontWeight: 600 }}>{result.g1.toFixed(3)}</span></div>
                <div className="flex justify-between"><span style={{ color: '#666' }}>g₂ = 1 - L/R₂</span><span className="tabular-nums" style={{ fontFamily: MONO, color: '#1A1A1A', fontWeight: 600 }}>{result.g2.toFixed(3)}</span></div>
                <div className="flex justify-between"><span style={{ color: '#666' }}>g₁·g₂</span><span className="tabular-nums" style={{ fontFamily: MONO, color: result.isStable ? STABLE_COLOR : UNSTABLE_COLOR, fontWeight: 600 }}>{result.g1g2.toFixed(3)}</span></div>
              </div>
            </div>

            {/* 模式参数 */}
            {result.isStable && (
              <div style={{
                padding: '10px 12px', backgroundColor: '#FFFFFF',
                border: '1px solid #1A1A1A', borderRadius: '2px',
              }}>
                <div style={{ fontFamily: FONT, fontSize: '10px', fontWeight: 600, color: '#1A1A1A', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '8px' }}>
                  本征模参数
                </div>
                <div className="space-y-1.5" style={{ fontFamily: FONT, fontSize: '11px' }}>
                  <Row label="束腰 w₀" value={`${result.w0.toFixed(3)} mm`} highlight />
                  <Row label="镜1光斑 w₁" value={`${result.w1.toFixed(3)} mm`} />
                  <Row label="镜2光斑 w₂" value={`${result.w2.toFixed(3)} mm`} />
                  <Row label="共焦参数 b" value={`${result.confocalParam.toFixed(1)} mm`} />
                </div>
              </div>
            )}

            {/* Hermite 模式阶数 */}
            <div>
              <div style={{ fontFamily: FONT, fontSize: '11px', fontWeight: 600, color: '#1A1A1A', marginBottom: '8px' }}>
                Hermite-Gaussian 横模 TEMₘₙ
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-[11px] text-[#2d3142]">阶数 m (x)</Label>
                    <span className="tabular-nums text-[11px] text-[#6b7280]" style={{ fontFamily: MONO }}>{modeM}</span>
                  </div>
                  <Slider value={[modeM]} min={0} max={5} step={1} onValueChange={([v]) => setModeM(v)} />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-[11px] text-[#2d3142]">阶数 n (y)</Label>
                    <span className="tabular-nums text-[11px] text-[#6b7280]" style={{ fontFamily: MONO }}>{modeN}</span>
                  </div>
                  <Slider value={[modeN]} min={0} max={5} step={1} onValueChange={([v]) => setModeN(v)} />
                </div>
              </div>
            </div>

            {/* 提示 */}
            <div style={{
              padding: '8px 10px', backgroundColor: '#FAFAFA',
              border: '1px solid #E8ECF0', borderRadius: '2px',
              fontFamily: FONT, fontSize: '10px', color: '#888', lineHeight: 1.6,
            }}>
              💡 g₁g₂ = 0 (共焦/同心) 或 1 (平平/共心) 时为临界腔。实际激光器多工作在稳定区中部。
            </div>
          </div>
        </ControlPanel>

        {/* 可视化区 */}
        <div className="flex-1 flex flex-col" style={{ minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
          <div ref={vizRef} className="flex-1 flex flex-col custom-scrollbar dot-grid" style={{ minHeight: 0, overflow: 'auto' }}>
            {/* 谐振腔光路 */}
            <div style={{ padding: isMobile ? '12px 8px' : '20px 24px' }}>
              <div style={{
                fontFamily: FONT, fontSize: '11px', fontWeight: 600, color: '#1A1A1A',
                marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px',
              }}>
                <span style={{ width: '4px', height: '12px', backgroundColor: '#1A1A1A', display: 'inline-block' }} />
                谐振腔结构 · 高斯本征模包络
              </div>
              <div style={{
                backgroundColor: '#FFFFFF', border: '1px solid #D0D0D0', borderRadius: '2px',
                padding: '8px',
              }}>
                <ResonatorSVG
                  R1={R1} R2={R2} L={L}
                  w0={result.w0} w1={result.w1} w2={result.w2}
                  lambda={lambda / 1000}
                  width={isMobile ? 360 : 760}
                  height={220}
                />
              </div>
            </div>

            {/* 稳定性图 */}
            <div style={{ padding: isMobile ? '0 8px 16px' : '0 24px 24px' }}>
              <div style={{
                fontFamily: FONT, fontSize: '11px', fontWeight: 600, color: '#1A1A1A',
                marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px',
              }}>
                <span style={{ width: '4px', height: '12px', backgroundColor: '#1A1A1A', display: 'inline-block' }} />
                稳定性图 g₁·g₂
              </div>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' as const }}>
                <div style={{
                  backgroundColor: '#FFFFFF', border: '1px solid #D0D0D0', borderRadius: '2px',
                  padding: '8px',
                }}>
                  <StabilityDiagram
                    g1={result.g1}
                    g2={result.g2}
                    width={isMobile ? 320 : 380}
                    height={isMobile ? 320 : 380}
                  />
                </div>
                <div style={{ flex: 1, minWidth: '200px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{
                    backgroundColor: '#FAFAFA', border: '1px solid #E8ECF0', borderRadius: '2px',
                    padding: '10px 12px',
                  }}>
                    <div style={{ fontFamily: FONT, fontSize: '10px', fontWeight: 600, color: '#1A1A1A', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '6px' }}>
                      稳定性判据
                    </div>
                    <div style={{ fontFamily: FONT, fontSize: '11px', color: '#666', lineHeight: 1.7 }}>
                      谐振腔稳定条件为：
                      <div style={{ fontFamily: MONO, fontSize: '12px', color: '#1A1A1A', fontWeight: 600, margin: '6px 0', textAlign: 'center', padding: '6px', backgroundColor: '#FFFFFF', border: '1px solid #D0D0D0', borderRadius: '2px' }}>
                        0 ≤ g₁·g₂ ≤ 1
                      </div>
                      其中 gᵢ = 1 − L/Rᵢ。绿色区域为稳定区，红色为不稳定区。
                    </div>
                  </div>
                  <div style={{
                    backgroundColor: '#FFFFFF', border: `1px solid ${result.isStable ? STABLE_COLOR : UNSTABLE_COLOR}`, borderRadius: '2px',
                    padding: '10px 12px',
                  }}>
                    <div style={{ fontFamily: FONT, fontSize: '10px', fontWeight: 600, color: '#1A1A1A', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '6px' }}>
                      当前状态
                    </div>
                    <div className="space-y-1" style={{ fontFamily: FONT, fontSize: '11px' }}>
                      <Row label="g₁" value={result.g1.toFixed(3)} />
                      <Row label="g₂" value={result.g2.toFixed(3)} />
                      <Row label="g₁·g₂" value={result.g1g2.toFixed(3)} highlight />
                      <Row label="状态" value={result.isStable ? '✓ 稳定' : result.isEdge ? '○ 临界' : '✗ 不稳定'} highlight />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Hermite 横模 */}
            <div style={{ padding: isMobile ? '0 8px 16px' : '0 24px 24px' }}>
              <div style={{
                fontFamily: FONT, fontSize: '11px', fontWeight: 600, color: '#1A1A1A',
                marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px',
              }}>
                <span style={{ width: '4px', height: '12px', backgroundColor: '#1A1A1A', display: 'inline-block' }} />
                Hermite-Gaussian 横模 · TEM<sub>{modeM}{modeN}</sub>
              </div>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' as const }}>
                <div style={{
                  backgroundColor: '#FFFFFF', border: '1px solid #D0D0D0', borderRadius: '2px',
                  padding: '8px',
                }}>
                  <HermiteModeCanvas
                    m={modeM} n={modeN}
                    w0={result.w0 > 0 ? result.w0 : 0.3}
                    lambda={lambda / 1000}
                    width={isMobile ? 320 : 320}
                    height={isMobile ? 320 : 320}
                  />
                </div>
                <div style={{ flex: 1, minWidth: '200px' }}>
                  <div style={{
                    backgroundColor: '#FAFAFA', border: '1px solid #E8ECF0', borderRadius: '2px',
                    padding: '10px 12px',
                  }}>
                    <div style={{ fontFamily: FONT, fontSize: '10px', fontWeight: 600, color: '#1A1A1A', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '6px' }}>
                      横模说明
                    </div>
                    <div style={{ fontFamily: FONT, fontSize: '11px', color: '#666', lineHeight: 1.7 }}>
                      <p style={{ margin: '0 0 6px 0' }}>
                        <strong style={{ color: '#1A1A1A' }}>TEM₀₀</strong>：基模高斯光束，光斑为单一圆形亮斑，光束质量最好 (M²=1)
                      </p>
                      <p style={{ margin: '0 0 6px 0' }}>
                        <strong style={{ color: '#1A1A1A' }}>TEMₘₙ</strong>：高阶横模，光斑分裂为 (m+1)×(n+1) 个亮斑，m/n 为 x/y 方向节线数
                      </p>
                      <p style={{ margin: 0 }}>
                        模式频率：ν<sub>mnq</sub> = (c/2L)·[q + (m+n+1)·arccos(√(g₁g₂))/π]
                      </p>
                    </div>
                  </div>
                  {/* 模式频率间隔 */}
                  {result.isStable && (
                    <div style={{
                      marginTop: '8px',
                      backgroundColor: '#FFFFFF', border: '1px solid #1A1A1A', borderRadius: '2px',
                      padding: '10px 12px',
                    }}>
                      <div style={{ fontFamily: FONT, fontSize: '10px', fontWeight: 600, color: '#1A1A1A', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '6px' }}>
                        频率参数
                      </div>
                      <div className="space-y-1" style={{ fontFamily: FONT, fontSize: '11px' }}>
                        <Row label="纵模间隔 Δν" value={`${(3e8 / (2 * L * 1e-3) / 1e9).toFixed(2)} GHz`} />
                        <Row label="横模间距" value={`${(3e8 / (2 * L * 1e-3) * Math.acos(Math.sqrt(result.g1g2)) / Math.PI / 1e9).toFixed(2)} GHz`} />
                        <Row label="共焦参数 b" value={`${result.confocalParam.toFixed(1)} mm`} />
                      </div>
                    </div>
                  )}
                </div>
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
