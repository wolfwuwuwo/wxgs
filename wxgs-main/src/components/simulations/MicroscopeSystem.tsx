'use client'

/* ═══════════════════════════════════════════════════════════════════
   MicroscopeSystem — 显微镜光学系统
   3 种物镜 (低倍/高倍/油浸)，物镜+目镜级联成像
   NA · Abbe 分辨率 · 放大率链 · 视场
   ═══════════════════════════════════════════════════════════════════ */

import { useState, useRef, useMemo, useEffect } from 'react'
import { Slider } from '@/components/ui/slider'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useIsMobile } from '@/hooks/use-mobile'
import { ControlPanel, MobilePanelToggle } from './shared/ControlPanel'
import { TearOffButton } from './shared/TearOffPanel'
import { useSnapshotTarget } from '@/hooks/use-snapshot-target'

const FONT = "system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif"
const MONO = 'var(--font-geist-mono), ui-monospace, monospace'
const VIEW_ID = 'geometric-microscope' as const

type ObjectiveType = 'low' | 'high' | 'oil'

const OBJECTIVES: Record<ObjectiveType, {
  label: string
  M_obj: number // 物镜放大率
  NA: number // 数值孔径
  f_obj: number // mm 物镜焦距
  wd: number // mm 工作距离
  immersion: string
  color: string
}> = {
  low:  { label: '低倍 10×', M_obj: 10,  NA: 0.25, f_obj: 16.5, wd: 7.0, immersion: '空气', color: '#888888' },
  high: { label: '高倍 40×', M_obj: 40,  NA: 0.65, f_obj: 4.5,  wd: 0.6, immersion: '空气', color: '#0066CC' },
  oil:  { label: '油浸 100×', M_obj: 100, NA: 1.25, f_obj: 1.8,  wd: 0.13, immersion: '香柏油 n=1.515', color: '#CC0000' },
}

const WAVELENGTH_OPTIONS = [
  { value: 550, label: '550 nm — 绿光 (视觉最敏感)', color: '#00AA00' },
  { value: 450, label: '450 nm — 蓝光 (高分辨率)', color: '#0066CC' },
  { value: 630, label: '630 nm — 红光', color: '#CC0000' },
  { value: 400, label: '400 nm — 紫光 (极限)', color: '#5500CC' },
]

const RAY_COLOR = '#CC0000'
const LENS_COLOR = '#1A1A1A'
const AXIS_COLOR = '#888888'
const IMAGE_COLOR = '#0066CC'

/* ─── 计算显微镜系统参数 ─── */
function computeMicroscope(obj: ObjectiveType, M_eye: number, wavelength: number, fovEyepiece: number) {
  const o = OBJECTIVES[obj]
  // 总放大率
  const M_total = o.M_obj * M_eye
  // Abbe 分辨率极限 (横向): d = 0.61 λ / NA  (Rayleigh 判据)
  const d_abbe = 0.61 * wavelength / 1000 / o.NA // μm
  // 光学分辨率（考虑人眼 1' 视角）
  // 人眼可分辨的最小距离 ≈ 0.1 mm @ 25cm
  // 有效放大率上限 ≈ 1000 × NA
  const M_max = 1000 * o.NA
  const M_useful = Math.min(M_total, M_max)
  const overMagnification = M_total > M_max
  // 视场（目镜视场数 FN 假设 20mm）
  const FN = 20 // mm 目镜视场数
  const fov_obj = FN / o.M_obj // mm 物方视场直径
  // 景深 (近似): DOF = λ / (NA²) + n e / (M·NA) （Berek 公式简化）
  const DOF = (wavelength / 1000) / (o.NA * o.NA) + 0.5 / (o.M_obj * o.NA) // μm
  // 筒长（标准 160mm）
  const tubeLength = 160 // mm
  // 物镜成像位置：物距 s_o = f_obj (1 + 1/M_obj) ≈ f_obj (物在焦点稍外)
  const s_obj = o.f_obj * (1 + 1 / o.M_obj) // mm
  return {
    M_total, M_obj: o.M_obj, M_eye,
    NA: o.NA, f_obj: o.f_obj, wd: o.wd,
    immersion: o.immersion,
    d_abbe, M_max, M_useful, overMagnification,
    fov_obj, DOF, tubeLength, s_obj,
    wavelength,
  }
}

/* ═══════════════════════════════════════════════════════════════════
   显微镜光路 SVG（横向布局：标本 → 物镜 → 中间像 → 目镜 → 眼）
   ═══════════════════════════════════════════════════════════════════ */
function MicroscopeSVG({
  obj, M_eye, wavelength, width, height,
}: {
  obj: ObjectiveType
  M_eye: number
  wavelength: number
  width: number
  height: number
}) {
  const o = OBJECTIVES[obj]
  const cy = height / 2
  const margin = 20

  // 光路从左到右：标本 → 物镜 → 中间像 → 目镜 → 眼
  // 筒长 160mm
  const x_specimen = margin + 30
  const x_objective = x_specimen + 8 // 物镜紧靠标本（工作距离短）
  const x_intermediate = x_objective + 200 // 中间像位置（筒长放大）
  const x_eyepiece = x_intermediate + 100
  const x_eye = x_eyepiece + 80

  // 物镜符号大小
  const objR = 18
  const eyeR = 14

  // 三条主光线：从标本顶点发出，经物镜成中间像，再经目镜成平行光入眼
  // 标本高度 h_obj (视觉化放大)
  const h_obj = 12
  // 中间像高度 = -M_obj * h_obj
  const h_intermediate = -o.M_obj * h_obj * 0.15 // 视觉缩小避免溢出

  // 光线 1: 标本顶点 → 物镜中心 → 中间像顶点
  // 光线 2: 标本顶点 → 物镜边缘 (NA 孔径) → 中间像顶点
  // 光线 3: 标本中心 → 物镜中心 → 中间像中心

  const rays_obj = [
    // 光线1：标本顶点 → 物镜中心 → 中间像顶点 (倒立放大)
    `M ${x_specimen} ${cy - h_obj} L ${x_objective} ${cy} L ${x_intermediate} ${cy - h_intermediate}`,
    // 光线2：标本顶点 → 物镜上边缘 → 中间像顶点 (孔径光线)
    `M ${x_specimen} ${cy - h_obj} L ${x_objective} ${cy - objR} L ${x_intermediate} ${cy - h_intermediate}`,
    // 光线3：标本顶点 → 物镜下边缘 → 中间像顶点 (孔径光线)
    `M ${x_specimen} ${cy - h_obj} L ${x_objective} ${cy + objR} L ${x_intermediate} ${cy - h_intermediate}`,
  ]

  // 目镜后光线：从中间像顶点 → 目镜 → 平行光 (虚像在无穷远)
  // 平行光斜率 = h_intermediate / f_eye
  const f_eye = 25 / (M_eye / 10) // 目镜焦距近似
  const slope_eye = -h_intermediate / f_eye * 0.3 // 视觉缩放
  const rays_eye = [
    `M ${x_intermediate} ${cy - h_intermediate} L ${x_eyepiece} ${cy - h_intermediate + slope_eye * (x_eyepiece - x_intermediate) * 0.1} L ${x_eye} ${cy - h_intermediate + slope_eye * (x_eye - x_intermediate) * 0.1}`,
  ]

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
      <defs>
        <pattern id="mic-grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <circle cx="0" cy="0" r="0.6" fill="#E8ECF0" />
        </pattern>
      </defs>
      <rect width={width} height={height} fill="url(#mic-grid)" />

      {/* 光轴 */}
      <line x1={0} y1={cy} x2={width} y2={cy} stroke={AXIS_COLOR} strokeWidth="0.6" strokeDasharray="6,3,2,3" />

      {/* 标本 */}
      <g>
        <rect x={x_specimen - 8} y={cy - 18} width="6" height="36" fill="#FAFAFA" stroke="#1A1A1A" strokeWidth="1" />
        {/* 标本细节 */}
        <circle cx={x_specimen - 5} cy={cy - 4} r="1.5" fill="#CC0000" opacity="0.7" />
        <circle cx={x_specimen - 5} cy={cy + 3} r="1" fill="#0066CC" opacity="0.7" />
        <circle cx={x_specimen - 5} cy={cy + 8} r="0.8" fill="#00AA44" opacity="0.7" />
        <text x={x_specimen - 12} y={cy + 30} textAnchor="middle" fontSize="9" fill="#666" fontFamily={FONT}>标本</text>
        <text x={x_specimen - 12} y={cy + 42} textAnchor="middle" fontSize="8" fill="#888" fontFamily={MONO}>f={o.f_obj}mm</text>
      </g>

      {/* 物镜（复合透镜组） */}
      <g>
        <ellipse cx={x_objective} cy={cy} rx="4" ry={objR} fill="none" stroke={LENS_COLOR} strokeWidth="1.4" />
        <ellipse cx={x_objective + 3} cy={cy} rx="3" ry={objR * 0.9} fill="none" stroke={LENS_COLOR} strokeWidth="1" />
        <line x1={x_objective - 6} y1={cy - objR} x2={x_objective + 6} y2={cy - objR} stroke={LENS_COLOR} strokeWidth="0.8" />
        <line x1={x_objective - 6} y1={cy + objR} x2={x_objective + 6} y2={cy + objR} stroke={LENS_COLOR} strokeWidth="0.8" />
        {/* NA 孔径光锥指示 */}
        <line x1={x_specimen} y1={cy} x2={x_objective} y2={cy - objR} stroke="#888" strokeWidth="0.4" strokeDasharray="2,2" />
        <line x1={x_specimen} y1={cy} x2={x_objective} y2={cy + objR} stroke="#888" strokeWidth="0.4" strokeDasharray="2,2" />
        <text x={x_objective} y={cy + objR + 14} textAnchor="middle" fontSize="10" fill="#1A1A1A" fontFamily={FONT} fontWeight="600">
          物镜 {o.M_obj}×
        </text>
        <text x={x_objective} y={cy + objR + 26} textAnchor="middle" fontSize="9" fill="#666" fontFamily={MONO}>
          NA={o.NA}
        </text>
      </g>

      {/* 浸油（油浸物镜） */}
      {obj === 'oil' && (
        <g>
          <path d={`M ${x_specimen} ${cy - 8} Q ${(x_specimen + x_objective) / 2} ${cy - 6} ${x_objective} ${cy - objR * 0.7}`} fill="rgba(204,170,0,0.15)" stroke="none" />
          <path d={`M ${x_specimen} ${cy + 8} Q ${(x_specimen + x_objective) / 2} ${cy + 6} ${x_objective} ${cy + objR * 0.7}`} fill="rgba(204,170,0,0.15)" stroke="none" />
        </g>
      )}

      {/* 中间像 */}
      <g>
        <line x1={x_intermediate} y1={cy + h_intermediate - 4} x2={x_intermediate} y2={cy + h_intermediate + 4} stroke={IMAGE_COLOR} strokeWidth="1.4" />
        <line x1={x_intermediate - 3} y1={cy - 4} x2={x_intermediate + 3} y2={cy - 4} stroke={IMAGE_COLOR} strokeWidth="1.4" />
        <line x1={x_intermediate - 2} y1={cy + 4} x2={x_intermediate + 2} y2={cy + 4} stroke={IMAGE_COLOR} strokeWidth="1.4" />
        <text x={x_intermediate} y={cy - 36} textAnchor="middle" fontSize="9" fill={IMAGE_COLOR} fontFamily={FONT}>中间像</text>
        <text x={x_intermediate} y={cy - 24} textAnchor="middle" fontSize="8" fill={IMAGE_COLOR} fontFamily={MONO}>{o.M_obj}× 倒立</text>
      </g>

      {/* 筒长标注 */}
      <g>
        <line x1={x_objective} y1={cy + objR + 38} x2={x_intermediate} y2={cy + objR + 38} stroke="#888" strokeWidth="0.5" />
        <line x1={x_objective} y1={cy + objR + 35} x2={x_objective} y2={cy + objR + 41} stroke="#888" strokeWidth="0.5" />
        <line x1={x_intermediate} y1={cy + objR + 35} x2={x_intermediate} y2={cy + objR + 41} stroke="#888" strokeWidth="0.5" />
        <text x={(x_objective + x_intermediate) / 2} y={cy + objR + 50} textAnchor="middle" fontSize="9" fill="#888" fontFamily={MONO}>160mm</text>
      </g>

      {/* 目镜 */}
      <g>
        <ellipse cx={x_eyepiece} cy={cy} rx="3.5" ry={eyeR} fill="none" stroke={LENS_COLOR} strokeWidth="1.4" />
        <ellipse cx={x_eyepiece + 2.5} cy={cy} rx="3" ry={eyeR * 0.9} fill="none" stroke={LENS_COLOR} strokeWidth="1" />
        <text x={x_eyepiece} y={cy + eyeR + 14} textAnchor="middle" fontSize="10" fill="#1A1A1A" fontFamily={FONT} fontWeight="600">
          目镜 {M_eye}×
        </text>
      </g>

      {/* 眼睛 */}
      <g>
        <ellipse cx={x_eye + 6} cy={cy} rx="8" ry="6" fill="#FFFFFF" stroke="#1A1A1A" strokeWidth="1.2" />
        <circle cx={x_eye + 6} cy={cy} r="2.5" fill="#1A1A1A" />
        <text x={x_eye + 6} y={cy + 18} textAnchor="middle" fontSize="9" fill="#666" fontFamily={FONT}>眼</text>
      </g>

      {/* 光线：物镜段 */}
      {rays_obj.map((d, i) => (
        <path key={`o${i}`} d={d} fill="none" stroke={RAY_COLOR} strokeWidth="1.2" opacity={i === 0 ? 0.85 : 0.55} />
      ))}

      {/* 光线：目镜段 */}
      {rays_eye.map((d, i) => (
        <path key={`e${i}`} d={d} fill="none" stroke={RAY_COLOR} strokeWidth="1.2" opacity="0.85" />
      ))}

      {/* 出瞳位置标记 */}
      <g>
        <line x1={x_eyepiece + 18} y1={cy - 6} x2={x_eyepiece + 18} y2={cy + 6} stroke="#888" strokeWidth="0.6" strokeDasharray="1,2" />
        <text x={x_eyepiece + 18} y={cy - 12} textAnchor="middle" fontSize="8" fill="#888" fontFamily={FONT}>出瞳</text>
      </g>

      {/* 放大率公式标注 */}
      <text x={width - margin} y={20} textAnchor="end" fontSize="10" fill="#888" fontFamily={MONO}>
        M = M_物 × M_目 = {o.M_obj}×{M_eye} = {o.M_obj * M_eye}×
      </text>
    </svg>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   分辨率极限可视化（Airy 斑）
   ═══════════════════════════════════════════════════════════════════ */
function ResolutionCanvas({
  NA, wavelength, width, height,
}: {
  NA: number
  wavelength: number
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

    // 两个 Airy 斑：可分辨 / 临界 / 不可分辨
    const d_abbe = 0.61 * wavelength / 1000 / NA // μm
    const cases = [
      { sep: d_abbe * 2, label: '清晰分辨', resolvable: true },
      { sep: d_abbe * 1.0, label: '瑞利判据 (临界)', resolvable: true },
      { sep: d_abbe * 0.6, label: '不可分辨', resolvable: false },
    ]

    const cellW = width / 3
    cases.forEach((c, i) => {
      const cx = i * cellW + cellW / 2
      const cy = height / 2
      // Airy 斑中心间距
      const sepPx = c.sep * 8 // 视觉放大
      // 画两个 Airy 斑
      const drawAiry = (centerX: number) => {
        const r_max = 24
        for (let px = -r_max; px <= r_max; px++) {
          for (let py = -r_max; py <= r_max; py++) {
            const r = Math.sqrt(px * px + py * py)
            if (r > r_max) continue
            // Airy 函数: [2J1(x)/x]^2, x = π D r / (λ f)
            const x = r * 0.4
            let intensity
            if (Math.abs(x) < 0.01) intensity = 1
            else {
              // 使用 Bessel J1 数值近似
              const J1 = (xv: number): number => {
                if (Math.abs(xv) < 1e-10) return 0
                if (xv < 8) {
                  // 级数近似
                  let s = 0
                  let term = xv / 2
                  for (let n = 0; n < 20; n++) {
                    s += term
                    term *= -xv * xv / (4 * (n + 1) * (n + 2))
                    if (Math.abs(term) < 1e-10) break
                  }
                  return s
                }
                return Math.sqrt(2 / (Math.PI * xv)) * Math.cos(xv - 3 * Math.PI / 4)
              }
              intensity = Math.pow(2 * J1(x) / x, 2)
              intensity = Math.max(0, Math.min(1, intensity))
            }
            const alpha = Math.floor(intensity * 255)
            ctx.fillStyle = `rgba(204, 0, 0, ${alpha / 255})`
            ctx.fillRect(centerX + px, cy + py, 1, 1)
          }
        }
      }
      drawAiry(cx - sepPx / 2)
      drawAiry(cx + sepPx / 2)

      // 标签
      ctx.fillStyle = c.resolvable ? '#00AA44' : '#CC0000'
      ctx.font = "10px system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif"
      ctx.textAlign = 'center'
      ctx.fillText(c.label, cx, height - 10)
      ctx.fillStyle = '#888'
      ctx.font = '9px monospace'
      ctx.fillText(`d = ${c.sep.toFixed(2)} μm`, cx, 14)
    })

    // 分隔线
    ctx.strokeStyle = '#E8ECF0'
    ctx.lineWidth = 1
    for (let i = 1; i < 3; i++) {
      ctx.beginPath()
      ctx.moveTo(i * cellW, 0)
      ctx.lineTo(i * cellW, height)
      ctx.stroke()
    }
  }, [NA, wavelength, width, height])

  return <canvas ref={canvasRef} />
}

/* ═══════════════════════════════════════════════════════════════════
   主组件
   ═══════════════════════════════════════════════════════════════════ */
interface Props {
  onBack: () => void
}

export default function MicroscopeSystem({ onBack }: Props) {
  const isMobile = useIsMobile()
  const [panelOpen, setPanelOpen] = useState(false)
  const [obj, setObj] = useState<ObjectiveType>('high')
  const [M_eye, setM_eye] = useState(10)
  const [wavelength, setWavelength] = useState(550)
  const vizRef = useRef<HTMLDivElement>(null)

  const result = useMemo(() => computeMicroscope(obj, M_eye, wavelength, 20), [obj, M_eye, wavelength])

  useSnapshotTarget(VIEW_ID, {
    targetRef: vizRef,
    getTitle: () => `${OBJECTIVES[obj].label} + ${M_eye}× 目镜 · 总 ${result.M_total}×`,
    getParams: () => [
      { key: '物镜', value: OBJECTIVES[obj].label },
      { key: 'NA', value: String(OBJECTIVES[obj].NA) },
      { key: '目镜', value: `${M_eye}×` },
      { key: 'λ', value: `${wavelength}nm` },
      { key: '总放大', value: `${result.M_total}×` },
      { key: '分辨率', value: `${result.d_abbe.toFixed(2)}μm` },
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
          显微镜光学系统
        </h1>
        {!isMobile && (
          <span style={{ marginLeft: '4px', fontSize: '9px', color: '#888888',
            border: '1px solid #D0D0D0', borderRadius: '2px', padding: '1px 6px', flexShrink: 0 }}>
            d = 0.61λ/NA
          </span>
        )}

        <div className={isMobile ? 'flex overflow-x-auto mobile-x-scroll flex-1 min-w-0' : 'flex'} style={{
          marginLeft: isMobile ? '8px' : 'auto', gap: '2px', flexWrap: 'nowrap' as const,
        }}>
          {(Object.keys(OBJECTIVES) as ObjectiveType[]).map(o => (
            <button
              key={o}
              onClick={() => setObj(o)}
              style={{
                fontFamily: FONT, fontSize: isMobile ? '11px' : '12px', fontWeight: 500,
                padding: '4px 10px', minHeight: '44px',
                border: '1px solid ' + (obj === o ? '#1A1A1A' : '#D0D0D0'),
                backgroundColor: obj === o ? '#1A1A1A' : '#FFFFFF',
                color: obj === o ? '#FFFFFF' : '#555555',
                cursor: 'pointer', borderRadius: '2px',
                transition: 'all 120ms ease-out',
                whiteSpace: 'nowrap', flexShrink: 0,
              }}
            >
              {OBJECTIVES[o].label}
            </button>
          ))}
        </div>

        {isMobile && <MobilePanelToggle onClick={() => setPanelOpen(true)} label="参数" />}
        <TearOffButton
          viewId={VIEW_ID}
          title={`${OBJECTIVES[obj].label} · 总${result.M_total}×`}
          params={[
            { key: '物镜', value: OBJECTIVES[obj].label },
            { key: 'NA', value: String(OBJECTIVES[obj].NA) },
            { key: '目镜', value: `${M_eye}×` },
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
          title="显微镜参数"
          desktopWidth="w-80"
        >
          <div className="space-y-5">
            {/* 物镜信息 */}
            <div style={{
              padding: '10px 12px', backgroundColor: '#FFFFFF',
              border: `1px solid ${OBJECTIVES[obj].color}`, borderRadius: '2px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ fontFamily: FONT, fontSize: '11px', fontWeight: 600, color: '#1A1A1A' }}>
                  当前物镜
                </span>
                <span style={{
                  fontFamily: FONT, fontSize: '9px', fontWeight: 500,
                  color: OBJECTIVES[obj].color, border: `1px solid ${OBJECTIVES[obj].color}`,
                  padding: '1px 5px', borderRadius: '2px',
                }}>
                  {OBJECTIVES[obj].label}
                </span>
              </div>
              <div className="space-y-1" style={{ fontFamily: FONT, fontSize: '10px', color: '#666' }}>
                <div className="flex justify-between"><span>数值孔径 NA</span><span className="tabular-nums" style={{ fontFamily: MONO, color: '#1A1A1A', fontWeight: 600 }}>{OBJECTIVES[obj].NA}</span></div>
                <div className="flex justify-between"><span>焦距</span><span className="tabular-nums" style={{ fontFamily: MONO }}>{OBJECTIVES[obj].f_obj}mm</span></div>
                <div className="flex justify-between"><span>工作距离</span><span className="tabular-nums" style={{ fontFamily: MONO }}>{OBJECTIVES[obj].wd}mm</span></div>
                <div className="flex justify-between"><span>浸没介质</span><span>{OBJECTIVES[obj].immersion}</span></div>
              </div>
            </div>

            {/* 目镜放大率 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-[12px] text-[#2d3142]">目镜放大率</Label>
                <span className="tabular-nums text-[11px] text-[#6b7280]" style={{ fontFamily: MONO }}>{M_eye}×</span>
              </div>
              <Slider value={[M_eye]} min={5} max={25} step={1} onValueChange={([v]) => setM_eye(v)} />
              <div className="flex justify-between text-[9px] text-[#aaa]">
                <span>5×</span><span>25×</span>
              </div>
            </div>

            {/* 波长 */}
            <div>
              <Label className="text-[12px] text-[#2d3142] mb-2 block">照明波长 λ</Label>
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

            {/* 关键性能 */}
            <div style={{
              padding: '10px 12px', backgroundColor: '#FFFFFF',
              border: '1px solid #1A1A1A', borderRadius: '2px',
            }}>
              <div style={{ fontFamily: FONT, fontSize: '10px', fontWeight: 600, color: '#1A1A1A', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '8px' }}>
                系统性能
              </div>
              <div className="space-y-1.5" style={{ fontFamily: FONT, fontSize: '11px' }}>
                <Row label="总放大率" value={`${result.M_total}×`} highlight />
                <Row label="Abbe 分辨率" value={`${result.d_abbe.toFixed(3)} μm`} highlight />
                <Row label="有效放大上限" value={`${result.M_max.toFixed(0)}×`} />
                <Row label="有用放大率" value={`${result.M_useful.toFixed(0)}×`} />
                {result.overMagnification && (
                  <div style={{
                    padding: '4px 6px', backgroundColor: '#FFF6F6',
                    border: '1px solid #CC0000', borderRadius: '2px',
                    fontSize: '10px', color: '#CC0000', marginTop: '4px',
                  }}>
                    ⚠ 超过有效放大率，空放大
                  </div>
                )}
                <Row label="物方视场" value={`${result.fov_obj.toFixed(2)} mm`} />
                <Row label="景深 (DOF)" value={`${result.DOF.toFixed(2)} μm`} />
              </div>
            </div>

            {/* 提示 */}
            <div style={{
              padding: '8px 10px', backgroundColor: '#FAFAFA',
              border: '1px solid #E8ECF0', borderRadius: '2px',
              fontFamily: FONT, fontSize: '10px', color: '#888', lineHeight: 1.6,
            }}>
              💡 提升分辨率途径：① 增大 NA（油浸物镜）② 减小波长（蓝光/紫外）③ 有效放大率 ≤ 1000·NA
            </div>
          </div>
        </ControlPanel>

        {/* 可视化区 */}
        <div className="flex-1 flex flex-col" style={{ minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
          <div ref={vizRef} className="flex-1 flex flex-col custom-scrollbar dot-grid" style={{ minHeight: 0, overflow: 'auto' }}>
            {/* 光路图 */}
            <div style={{ padding: isMobile ? '12px 8px' : '20px 24px' }}>
              <div style={{
                fontFamily: FONT, fontSize: '11px', fontWeight: 600, color: '#1A1A1A',
                marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px',
              }}>
                <span style={{ width: '4px', height: '12px', backgroundColor: '#1A1A1A', display: 'inline-block' }} />
                显微镜光路 · 标本 → 物镜 → 中间像 → 目镜 → 眼
              </div>
              <div style={{
                backgroundColor: '#FFFFFF', border: '1px solid #D0D0D0', borderRadius: '2px',
                padding: '8px',
              }}>
                <MicroscopeSVG
                  obj={obj}
                  M_eye={M_eye}
                  wavelength={wavelength}
                  width={isMobile ? 360 : 760}
                  height={280}
                />
              </div>
            </div>

            {/* Airy 斑分辨率 */}
            <div style={{ padding: isMobile ? '0 8px 16px' : '0 24px 24px' }}>
              <div style={{
                fontFamily: FONT, fontSize: '11px', fontWeight: 600, color: '#1A1A1A',
                marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px',
              }}>
                <span style={{ width: '4px', height: '12px', backgroundColor: '#1A1A1A', display: 'inline-block' }} />
                Airy 斑分辨率极限 · d = {result.d_abbe.toFixed(3)} μm
              </div>
              <div style={{
                backgroundColor: '#FFFFFF', border: '1px solid #D0D0D0', borderRadius: '2px',
                padding: '8px',
              }}>
                <ResolutionCanvas
                  NA={OBJECTIVES[obj].NA}
                  wavelength={wavelength}
                  width={isMobile ? 344 : 744}
                  height={140}
                />
              </div>
            </div>

            {/* 性能卡片 */}
            <div style={{ padding: isMobile ? '0 8px 16px' : '0 24px 24px' }}>
              <div className="grid" style={{
                gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)',
                gap: '8px',
              }}>
                <MetricCard label="总放大率" value={String(result.M_total)} unit="×" accent="#CC0000" />
                <MetricCard label="Abbe 分辨率" value={result.d_abbe.toFixed(3)} unit="μm" accent="#0066CC" />
                <MetricCard label="物方视场" value={result.fov_obj.toFixed(2)} unit="mm" />
                <MetricCard label="景深" value={result.DOF.toFixed(2)} unit="μm" />
              </div>
            </div>

            {/* 物镜对比表 */}
            {!isMobile && (
              <div style={{ padding: '0 24px 24px' }}>
                <div style={{
                  fontFamily: FONT, fontSize: '11px', fontWeight: 600, color: '#1A1A1A',
                  marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px',
                }}>
                  <span style={{ width: '4px', height: '12px', backgroundColor: '#1A1A1A', display: 'inline-block' }} />
                  物镜参数对比
                </div>
                <div style={{
                  backgroundColor: '#FFFFFF', border: '1px solid #D0D0D0', borderRadius: '2px',
                  overflow: 'hidden',
                }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONT, fontSize: '11px' }}>
                    <thead>
                      <tr style={{ backgroundColor: '#FAFAFA', borderBottom: '1px solid #D0D0D0' }}>
                        <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600 }}>物镜</th>
                        <th style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 600 }}>M</th>
                        <th style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 600 }}>NA</th>
                        <th style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 600 }}>f (mm)</th>
                        <th style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 600 }}>WD (mm)</th>
                        <th style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 600 }}>介质</th>
                        <th style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 600 }}>分辨率 (μm)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(Object.keys(OBJECTIVES) as ObjectiveType[]).map((o, i) => {
                        const objData = OBJECTIVES[o]
                        const d = 0.61 * wavelength / 1000 / objData.NA
                        return (
                          <tr key={o} style={{
                            borderBottom: i < 2 ? '1px solid #E8ECF0' : 'none',
                            backgroundColor: o === obj ? '#F0F3F6' : 'transparent',
                          }}>
                            <td style={{ padding: '8px 12px', fontWeight: o === obj ? 600 : 400, color: '#1A1A1A' }}>{objData.label}</td>
                            <td style={{ padding: '8px 12px', textAlign: 'center', color: '#666' }} className="tabular-nums">{objData.M_obj}×</td>
                            <td style={{ padding: '8px 12px', textAlign: 'center', color: '#666' }} className="tabular-nums">{objData.NA}</td>
                            <td style={{ padding: '8px 12px', textAlign: 'center', color: '#666' }} className="tabular-nums">{objData.f_obj}</td>
                            <td style={{ padding: '8px 12px', textAlign: 'center', color: '#666' }} className="tabular-nums">{objData.wd}</td>
                            <td style={{ padding: '8px 12px', textAlign: 'center', color: '#666' }}>{objData.immersion}</td>
                            <td style={{ padding: '8px 12px', textAlign: 'center', color: '#1A1A1A', fontWeight: 600 }} className="tabular-nums">{d.toFixed(3)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
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
