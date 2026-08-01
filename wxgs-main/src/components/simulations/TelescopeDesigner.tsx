'use client'

/* ═══════════════════════════════════════════════════════════════════
   TelescopeDesigner — 望远镜系统设计器
   4 种望远镜：伽利略 · 开普勒 · 牛顿 · 卡塞格林
   主光线追迹 SVG，放大率/出瞳/遮拦比分析
   ═══════════════════════════════════════════════════════════════════ */

import { useState, useRef, useMemo } from 'react'
import { Slider } from '@/components/ui/slider'
import { Label } from '@/components/ui/label'
import { useIsMobile } from '@/hooks/use-mobile'
import { ControlPanel, MobilePanelToggle } from './shared/ControlPanel'
import { TearOffButton } from './shared/TearOffPanel'
import { useSnapshotTarget } from '@/hooks/use-snapshot-target'

const FONT = "system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif"
const MONO = 'var(--font-geist-mono), ui-monospace, monospace'
const VIEW_ID = 'geometric-telescope' as const

type TelescopeType = 'galilean' | 'keplerian' | 'newtonian' | 'cassegrain'

const TYPE_LABELS: Record<TelescopeType, string> = {
  galilean: '伽利略望远镜',
  keplerian: '开普勒望远镜',
  newtonian: '牛顿反射望远镜',
  cassegrain: '卡塞格林望远镜',
}

const TYPE_DESC: Record<TelescopeType, string> = {
  galilean: '凸物镜 + 凹目镜，成正立虚像。目镜在物镜成像前，缩短筒长。M = -f₁/f₂ (f₂<0)',
  keplerian: '凸物镜 + 凸目镜，成倒立实像。中间像面可放分划板。M = -f₁/f₂',
  newtonian: '抛物面主镜 + 平面副镜斜置 45°。折轴出射，无色差，副镜中心遮拦',
  cassegrain: '抛物面主镜 + 双曲面副镜。折轴出射，筒长紧凑，副镜中心遮拦',
}

const RAY_COLOR = '#CC0000'
const LENS_COLOR = '#1A1A1A'
const MIRROR_COLOR = '#1A1A1A'
const AXIS_COLOR = '#888888'
const IMAGE_COLOR = '#0066CC'

/* ─── 望远镜光学参数 ─── */
interface TelescopeParams {
  f1: number // 物镜(主镜)焦距 mm
  f2: number // 目镜(副镜)焦距 mm
  D: number // 入瞳直径 mm
}

/* ─── 计算望远镜系统参数 ─── */
function computeTelescope(type: TelescopeType, p: TelescopeParams) {
  const { f1, f2, D } = p
  // 角放大率（折射式负号表示倒像）
  const sign = type === 'galilean' ? +1 : -1
  const M = type === 'galilean' ? (f1 / Math.abs(f2)) : (f1 / f2)
  // 出瞳直径
  const exitPupil = D / Math.abs(M)
  // 出瞳距（目镜到出瞳）
  // 折射式：d_eye = f2 * (1 + f2/f1) ≈ f2 (近似)
  const eyeRelief = Math.abs(f2) * (1 + Math.abs(f2) / f1)
  // 筒长（物镜到目镜距离）
  let tubeLength: number
  if (type === 'galilean') {
    tubeLength = f1 - Math.abs(f2) // 凹目镜在中间像前
  } else if (type === 'keplerian') {
    tubeLength = f1 + f2 // 中间像在两镜之间
  } else if (type === 'newtonian') {
    tubeLength = f1 // 主镜到焦点
  } else {
    // cassegrain: 副镜在主镜焦点前 d 处，折轴穿主镜中心孔
    tubeLength = f1 * 0.65 // 等效筒长缩短
  }
  // 遮拦比（反射式副镜遮挡）
  let obstruction = 0
  if (type === 'newtonian') {
    obstruction = 0.18 // 平面副镜典型遮拦
  } else if (type === 'cassegrain') {
    obstruction = 0.32 // 双曲面副镜典型遮拦
  }
  // 有效通光面积
  const effectiveArea = (1 - obstruction * obstruction) * Math.PI * (D / 2) ** 2
  const collectingArea = Math.PI * (D / 2) ** 2
  // 衍射极限角分辨率 (λ=550nm): θ = 1.22 λ/D
  const lambda = 550e-6 // mm
  const diffractionLimit = 1.22 * lambda / D * 206265 // arcsec
  // 视场（估算）
  const fov = 60 / Math.abs(M) // 估算视场角 (分)
  return {
    M: sign * M, signed_M: M, exitPupil, eyeRelief, tubeLength,
    obstruction, effectiveArea, collectingArea,
    diffractionLimit, fov,
  }
}

/* ═══════════════════════════════════════════════════════════════════
   主光线追迹 SVG
   ═══════════════════════════════════════════════════════════════════ */
function RayTraceSVG({
  type, p, width, height,
}: {
  type: TelescopeType
  p: TelescopeParams
  width: number
  height: number
}) {
  const { f1, f2, D } = p
  const cy = height / 2
  const margin = 30

  // 视图坐标：x ∈ [0, width]
  // 物镜在 x_lens1，目镜/副镜在 x_lens2，焦点在 x_focus
  // 将光学系统映射到 SVG 坐标
  const totalLen = (() => {
    if (type === 'galilean') return f1 - Math.abs(f2)
    if (type === 'keplerian') return f1 + f2
    if (type === 'newtonian') return f1
    return f1 * 0.65
  })()
  const scale = (width - 2 * margin) / Math.max(totalLen, 1)

  const x_obj = margin + 10 // 物镜/主镜位置
  const x_focus_obj = x_obj + f1 * scale // 物镜焦点

  let x_eye: number, x_intermediate: number | null, x_final_focus: number
  if (type === 'galilean') {
    x_eye = x_obj + (f1 - Math.abs(f2)) * scale
    x_intermediate = null
    x_final_focus = x_obj + f1 * scale // 虚焦点（在目镜后）
  } else if (type === 'keplerian') {
    x_intermediate = x_obj + f1 * scale
    x_eye = x_intermediate + f2 * scale
    x_final_focus = x_eye + f2 * scale
  } else if (type === 'newtonian') {
    x_intermediate = null
    // 平面副镜在主镜焦点前
    const x_flat = x_obj + (f1 - 50) * scale
    x_eye = x_flat
    x_final_focus = x_flat + 50 * scale // 折向侧面
  } else {
    // cassegrain: 副镜在主镜焦点前 d1，最终焦点穿主镜孔
    const d1 = f1 * 0.35
    x_eye = x_obj + (f1 - d1) * scale
    x_intermediate = null
    x_final_focus = x_obj + (f1 * 0.65) * scale
  }

  // 入射光线：3 条平行光（远场物），不同高度
  const rayHeights = [D / 2 * 0.6, 0, -D / 2 * 0.6]
  const lensRadius = D / 2 * scale * 0.15 // 镜片半径（视觉夸张）

  // 光线在物镜处汇聚到焦点，再发散
  function refractRefractor(h_in: number): string {
    // 折射式（伽利略/开普勒）
    // 物镜处 (x_obj, h_in) → 物镜焦点 (x_focus_obj, 0)
    // 然后到目镜
    const dx_obj_to_focus = x_focus_obj - x_obj
    const slope1 = (0 - h_in) / dx_obj_to_focus
    // 目镜处光线高度
    const h_at_eye = h_in + slope1 * (x_eye - x_obj)
    if (type === 'galilean') {
      // 凹目镜让光线发散，仿佛来自虚焦点
      // 出射光线斜率：使其反向延长线经过虚焦点
      const slope_out = -h_at_eye / (x_final_focus - x_eye)
      const x_end = width - margin
      const h_end = h_at_eye + slope_out * (x_end - x_eye)
      return `M ${x_obj} ${cy + h_in} L ${x_eye} ${cy + h_at_eye} L ${x_end} ${cy + h_end}`
    } else {
      // 开普勒：凸目镜，出射平行光（望远镜调焦无穷远）
      // 平行光斜率 = -h_at_eye / f2
      const slope_out = -h_at_eye / f2
      const x_end = width - margin
      const h_end = h_at_eye + slope_out * (x_end - x_eye) * scale
      return `M ${x_obj} ${cy + h_in} L ${x_eye} ${cy + h_at_eye} L ${x_end} ${cy + h_end}`
    }
  }

  function reflectorRays(h_in: number): string {
    if (type === 'newtonian') {
      // 平行光入射 → 抛物面主镜反射 → 汇聚到焦点 → 平面副镜折 90°
      const slope1 = (0 - h_in) / (x_focus_obj - x_obj)
      const h_at_flat = h_in + slope1 * (x_eye - x_obj)
      // 副镜折向下方 (因为副镜斜置 45°)
      const y_focus = cy + 60
      return `M ${x_obj} ${cy + h_in} L ${x_obj} ${cy - h_in} M ${x_obj} ${cy + h_in} L ${x_eye} ${cy + h_at_flat} L ${x_eye} ${y_focus}`
    } else {
      // 卡塞格林：平行光 → 主镜反射 → 副镜反射 → 穿主镜孔出射
      const slope1 = (0 - h_in) / (x_focus_obj - x_obj)
      const h_at_secondary = h_in + slope1 * (x_eye - x_obj)
      // 副镜反射：发散回主镜中心孔
      const slope2 = (0 - h_at_secondary) / (x_final_focus - x_eye)
      const h_at_hole = h_at_secondary + slope2 * (x_obj - x_eye)
      return `M ${x_obj} ${cy + h_in} L ${x_eye} ${cy + h_at_secondary} L ${x_obj} ${cy + h_at_hole} L ${x_final_focus} ${cy}`
    }
  }

  const rayPaths = rayHeights.map(h => type === 'galilean' || type === 'keplerian' ? refractRefractor(h) : reflectorRays(h))

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
      {/* 网格背景 */}
      <defs>
        <pattern id="tel-grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <circle cx="0" cy="0" r="0.6" fill="#E8ECF0" />
        </pattern>
      </defs>
      <rect width={width} height={height} fill="url(#tel-grid)" />

      {/* 光轴 */}
      <line x1={0} y1={cy} x2={width} y2={cy} stroke={AXIS_COLOR} strokeWidth="0.6" strokeDasharray="6,3,2,3" />

      {/* 物镜/主镜 */}
      {type === 'galilean' || type === 'keplerian' ? (
        // 折射式物镜（双凸透镜符号）
        <g>
          <ellipse cx={x_obj} cy={cy} rx="4" ry={lensRadius} fill="none" stroke={LENS_COLOR} strokeWidth="1.4" />
          <line x1={x_obj - 6} y1={cy - lensRadius} x2={x_obj + 6} y2={cy - lensRadius} stroke={LENS_COLOR} strokeWidth="0.8" />
          <line x1={x_obj - 6} y1={cy + lensRadius} x2={x_obj + 6} y2={cy + lensRadius} stroke={LENS_COLOR} strokeWidth="0.8" />
          <text x={x_obj} y={cy + lensRadius + 14} textAnchor="middle" fontSize="10" fill="#666" fontFamily={FONT}>物镜</text>
          {/* 目镜 */}
          {type === 'keplerian' ? (
            <g>
              <ellipse cx={x_eye} cy={cy} rx="3" ry={lensRadius * 0.5} fill="none" stroke={LENS_COLOR} strokeWidth="1.4" />
              <text x={x_eye} y={cy + lensRadius * 0.5 + 14} textAnchor="middle" fontSize="10" fill="#666" fontFamily={FONT}>目镜</text>
            </g>
          ) : (
            <g>
              {/* 凹目镜 */}
              <path d={`M ${x_eye - 3} ${cy - lensRadius * 0.4} L ${x_eye} ${cy - lensRadius * 0.3} L ${x_eye + 3} ${cy - lensRadius * 0.4}`} fill="none" stroke={LENS_COLOR} strokeWidth="1.4" />
              <path d={`M ${x_eye - 3} ${cy + lensRadius * 0.4} L ${x_eye} ${cy + lensRadius * 0.3} L ${x_eye + 3} ${cy + lensRadius * 0.4}`} fill="none" stroke={LENS_COLOR} strokeWidth="1.4" />
              <line x1={x_eye - 4} y1={cy - lensRadius * 0.4} x2={x_eye - 4} y2={cy + lensRadius * 0.4} stroke={LENS_COLOR} strokeWidth="0.8" />
              <line x1={x_eye + 4} y1={cy - lensRadius * 0.4} x2={x_eye + 4} y2={cy + lensRadius * 0.4} stroke={LENS_COLOR} strokeWidth="0.8" />
              <text x={x_eye} y={cy + lensRadius * 0.4 + 14} textAnchor="middle" fontSize="10" fill="#666" fontFamily={FONT}>目镜</text>
            </g>
          )}
        </g>
      ) : (
        // 反射式主镜
        <g>
          {/* 主镜（凹面） */}
          <path d={`M ${x_obj} ${cy - lensRadius} Q ${x_obj + 8} ${cy} ${x_obj} ${cy + lensRadius}`} fill="none" stroke={MIRROR_COLOR} strokeWidth="1.8" />
          <line x1={x_obj} y1={cy - lensRadius} x2={x_obj - 6} y2={cy - lensRadius} stroke={MIRROR_COLOR} strokeWidth="0.8" />
          <line x1={x_obj} y1={cy + lensRadius} x2={x_obj - 6} y2={cy + lensRadius} stroke={MIRROR_COLOR} strokeWidth="0.8" />
          {/* 镜面阴影线表示反射面 */}
          {Array.from({ length: 6 }).map((_, i) => (
            <line key={i} x1={x_obj - 4} y1={cy - lensRadius + 4 + i * (lensRadius * 2 - 8) / 5} x2={x_obj} y2={cy - lensRadius + 4 + i * (lensRadius * 2 - 8) / 5 - 3} stroke={MIRROR_COLOR} strokeWidth="0.6" />
          ))}
          <text x={x_obj} y={cy + lensRadius + 14} textAnchor="middle" fontSize="10" fill="#666" fontFamily={FONT}>主镜</text>

          {type === 'newtonian' ? (
            <g>
              {/* 平面副镜 45° */}
              <line x1={x_eye - 8} y1={cy - 8} x2={x_eye + 8} y2={cy + 8} stroke={MIRROR_COLOR} strokeWidth="1.8" />
              <text x={x_eye + 4} y={cy - 14} textAnchor="middle" fontSize="10" fill="#666" fontFamily={FONT}>副镜</text>
              {/* 焦点 */}
              <circle cx={x_eye} cy={cy + 60} r="2.5" fill={IMAGE_COLOR} />
              <text x={x_eye + 8} y={cy + 64} fontSize="9" fill={IMAGE_COLOR} fontFamily={FONT}>焦点</text>
            </g>
          ) : (
            <g>
              {/* 双曲面副镜（凸面） */}
              <path d={`M ${x_eye} ${cy - lensRadius * 0.4} Q ${x_eye - 5} ${cy} ${x_eye} ${cy + lensRadius * 0.4}`} fill="none" stroke={MIRROR_COLOR} strokeWidth="1.6" />
              <text x={x_eye + 6} y={cy - lensRadius * 0.4 - 4} textAnchor="middle" fontSize="10" fill="#666" fontFamily={FONT}>副镜</text>
              {/* 主镜中心孔 */}
              <line x1={x_obj} y1={cy - 4} x2={x_obj} y2={cy + 4} stroke="#FFFFFF" strokeWidth="3" />
              {/* 最终焦点 */}
              <circle cx={x_final_focus} cy={cy} r="2.5" fill={IMAGE_COLOR} />
              <text x={x_final_focus + 8} y={cy + 4} fontSize="9" fill={IMAGE_COLOR} fontFamily={FONT}>焦点</text>
            </g>
          )}
        </g>
      )}

      {/* 中间像（仅开普勒） */}
      {type === 'keplerian' && x_intermediate !== null && (
        <g>
          <line x1={x_intermediate} y1={cy - 6} x2={x_intermediate} y2={cy + 6} stroke={IMAGE_COLOR} strokeWidth="1.2" />
          <text x={x_intermediate} y={cy - 12} textAnchor="middle" fontSize="9" fill={IMAGE_COLOR} fontFamily={FONT}>中间像</text>
        </g>
      )}

      {/* 光线 */}
      {rayPaths.map((d, i) => (
        <path key={i} d={d} fill="none" stroke={RAY_COLOR} strokeWidth="1.4" opacity={i === 1 ? 0.5 : 0.85} />
      ))}

      {/* 入瞳标记 */}
      <g>
        <line x1={x_obj - 14} y1={cy - lensRadius} x2={x_obj - 14} y2={cy + lensRadius} stroke="#888" strokeWidth="0.6" />
        <text x={x_obj - 18} y={cy - lensRadius - 4} textAnchor="middle" fontSize="9" fill="#888" fontFamily={FONT}>D</text>
      </g>

      {/* 焦距标注 f₁ */}
      <g>
        <line x1={x_obj} y1={cy + lensRadius + 22} x2={x_focus_obj} y2={cy + lensRadius + 22} stroke="#888" strokeWidth="0.5" />
        <line x1={x_obj} y1={cy + lensRadius + 19} x2={x_obj} y2={cy + lensRadius + 25} stroke="#888" strokeWidth="0.5" />
        <line x1={x_focus_obj} y1={cy + lensRadius + 19} x2={x_focus_obj} y2={cy + lensRadius + 25} stroke="#888" strokeWidth="0.5" />
        {(type === 'galilean' || type === 'keplerian' || type === 'newtonian') && (
          <text x={(x_obj + x_focus_obj) / 2} y={cy + lensRadius + 34} textAnchor="middle" fontSize="9" fill="#888" fontFamily={MONO}>f₁ = {f1}mm</text>
        )}
      </g>

      {/* 出瞳方向箭头 */}
      {(type === 'galilean' || type === 'keplerian') && (
        <g>
          <polygon points={`${width - margin - 8},${cy - 4} ${width - margin},${cy} ${width - margin - 8},${cy + 4}`} fill={RAY_COLOR} opacity="0.6" />
          <text x={width - margin - 4} y={cy - 10} textAnchor="end" fontSize="9" fill="#888" fontFamily={FONT}>出瞳</text>
        </g>
      )}
    </svg>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   主组件
   ═══════════════════════════════════════════════════════════════════ */
interface Props {
  onBack: () => void
}

export default function TelescopeDesigner({ onBack }: Props) {
  const isMobile = useIsMobile()
  const [panelOpen, setPanelOpen] = useState(false)
  const [type, setType] = useState<TelescopeType>('keplerian')
  const [f1, setF1] = useState(800) // mm
  const [f2, setF2] = useState(25) // mm
  const [D, setD] = useState(80) // mm

  const vizRef = useRef<HTMLDivElement>(null)

  const params: TelescopeParams = { f1, f2, D }
  const result = useMemo(() => computeTelescope(type, params), [type, f1, f2, D])

  useSnapshotTarget(VIEW_ID, {
    targetRef: vizRef,
    getTitle: () => `${TYPE_LABELS[type]} · M=${result.M.toFixed(0)}× · D=${D}mm`,
    getParams: () => [
      { key: '型', value: TYPE_LABELS[type] },
      { key: 'f₁', value: `${f1}mm` },
      { key: 'f₂', value: `${f2}mm` },
      { key: 'D', value: `${D}mm` },
      { key: 'M', value: `${result.M.toFixed(0)}×` },
      { key: '出瞳', value: `${result.exitPupil.toFixed(1)}mm` },
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
          望远镜系统设计器
        </h1>
        {!isMobile && (
          <span style={{ marginLeft: '4px', fontSize: '9px', color: '#888888',
            border: '1px solid #D0D0D0', borderRadius: '2px', padding: '1px 6px', flexShrink: 0 }}>
            M = −f₁/f₂
          </span>
        )}

        <div className={isMobile ? 'flex overflow-x-auto mobile-x-scroll flex-1 min-w-0' : 'flex'} style={{
          marginLeft: isMobile ? '8px' : 'auto', gap: '2px', flexWrap: 'nowrap' as const,
        }}>
          {(Object.keys(TYPE_LABELS) as TelescopeType[]).map(t => (
            <button
              key={t}
              onClick={() => setType(t)}
              style={{
                fontFamily: FONT, fontSize: isMobile ? '11px' : '12px', fontWeight: 500,
                padding: '4px 10px', minHeight: '44px',
                border: '1px solid ' + (type === t ? '#1A1A1A' : '#D0D0D0'),
                backgroundColor: type === t ? '#1A1A1A' : '#FFFFFF',
                color: type === t ? '#FFFFFF' : '#555555',
                cursor: 'pointer', borderRadius: '2px',
                transition: 'all 120ms ease-out',
                whiteSpace: 'nowrap', flexShrink: 0,
              }}
            >
              {TYPE_LABELS[t]}
            </button>
          ))}
        </div>

        {isMobile && <MobilePanelToggle onClick={() => setPanelOpen(true)} label="参数" />}
        <TearOffButton
          viewId={VIEW_ID}
          title={`${TYPE_LABELS[type]} · M=${result.M.toFixed(0)}×`}
          params={[
            { key: 'f₁', value: `${f1}mm` },
            { key: 'f₂', value: `${f2}mm` },
            { key: 'D', value: `${D}mm` },
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
          title="望远镜参数"
          desktopWidth="w-80"
        >
          <div className="space-y-5">
            {/* 模式说明 */}
            <div style={{
              padding: '8px 10px', backgroundColor: '#FAFAFA',
              border: '1px solid #E8ECF0', borderRadius: '2px',
            }}>
              <div style={{ fontFamily: FONT, fontSize: '10px', color: '#888', marginBottom: '3px', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                当前望远镜
              </div>
              <div style={{ fontFamily: FONT, fontSize: '12px', fontWeight: 600, color: '#1A1A1A', marginBottom: '4px' }}>
                {TYPE_LABELS[type]}
              </div>
              <div style={{ fontFamily: FONT, fontSize: '10px', color: '#666', lineHeight: 1.5 }}>
                {TYPE_DESC[type]}
              </div>
            </div>

            {/* 物镜焦距 f1 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-[12px] text-[#2d3142]">物镜焦距 f₁</Label>
                <span className="tabular-nums text-[11px] text-[#6b7280]" style={{ fontFamily: MONO }}>{f1} mm</span>
              </div>
              <Slider value={[f1]} min={100} max={2000} step={10} onValueChange={([v]) => setF1(v)} />
              <div className="flex justify-between text-[9px] text-[#aaa]">
                <span>100mm</span><span>2000mm</span>
              </div>
            </div>

            {/* 目镜焦距 f2 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-[12px] text-[#2d3142]">目镜焦距 f₂</Label>
                <span className="tabular-nums text-[11px] text-[#6b7280]" style={{ fontFamily: MONO }}>{f2} mm</span>
              </div>
              <Slider value={[f2]} min={5} max={100} step={1} onValueChange={([v]) => setF2(v)} />
              <div className="flex justify-between text-[9px] text-[#aaa]">
                <span>5mm</span><span>100mm</span>
              </div>
            </div>

            {/* 入瞳直径 D */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-[12px] text-[#2d3142]">入瞳直径 D</Label>
                <span className="tabular-nums text-[11px] text-[#6b7280]" style={{ fontFamily: MONO }}>{D} mm</span>
              </div>
              <Slider value={[D]} min={20} max={300} step={5} onValueChange={([v]) => setD(v)} />
              <div className="flex justify-between text-[9px] text-[#aaa]">
                <span>20mm</span><span>300mm</span>
              </div>
            </div>

            {/* 关键输出 */}
            <div style={{
              padding: '10px 12px', backgroundColor: '#FFFFFF',
              border: '1px solid #1A1A1A', borderRadius: '2px',
            }}>
              <div style={{ fontFamily: FONT, fontSize: '10px', fontWeight: 600, color: '#1A1A1A', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '8px' }}>
                系统参数
              </div>
              <div className="space-y-1.5" style={{ fontFamily: FONT, fontSize: '11px' }}>
                <Row label="角放大率 M" value={`${result.M.toFixed(0)}×`} highlight />
                <Row label="出瞳直径" value={`${result.exitPupil.toFixed(1)} mm`} />
                <Row label="出瞳距" value={`${result.eyeRelief.toFixed(1)} mm`} />
                <Row label="筒长" value={`${result.tubeLength.toFixed(0)} mm`} />
                {result.obstruction > 0 && (
                  <>
                    <Row label="遮拦比" value={`${(result.obstruction * 100).toFixed(0)}%`} />
                    <Row label="有效通光" value={`${(result.effectiveArea / result.collectingArea * 100).toFixed(0)}%`} />
                  </>
                )}
                <Row label="衍射极限" value={`${result.diffractionLimit.toFixed(2)}″`} />
                <Row label="估算视场" value={`${result.fov.toFixed(1)}′`} />
              </div>
            </div>

            {/* 提示 */}
            <div style={{
              padding: '8px 10px', backgroundColor: '#FAFAFA',
              border: '1px solid #E8ECF0', borderRadius: '2px',
              fontFamily: FONT, fontSize: '10px', color: '#888', lineHeight: 1.6,
            }}>
              💡 出瞳直径应 ≤ 人眼瞳孔（~7mm暗适应）以充分利用光线；衍射极限由 D 决定，与放大率无关。
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
                光路图 · 主光线追迹
              </div>
              <div style={{
                backgroundColor: '#FFFFFF', border: '1px solid #D0D0D0', borderRadius: '2px',
                padding: '8px',
              }}>
                <RayTraceSVG
                  type={type}
                  p={params}
                  width={isMobile ? 360 : 720}
                  height={320}
                />
              </div>
            </div>

            {/* 参数对比卡片 */}
            <div style={{ padding: isMobile ? '0 8px 16px' : '0 24px 24px' }}>
              <div style={{
                fontFamily: FONT, fontSize: '11px', fontWeight: 600, color: '#1A1A1A',
                marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px',
              }}>
                <span style={{ width: '4px', height: '12px', backgroundColor: '#1A1A1A', display: 'inline-block' }} />
                性能指标
              </div>
              <div className="grid" style={{
                gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)',
                gap: '8px',
              }}>
                <MetricCard label="角放大率" value={`${result.M.toFixed(0)}×`} unit="" accent="#CC0000" />
                <MetricCard label="出瞳直径" value={result.exitPupil.toFixed(1)} unit="mm" />
                <MetricCard label="出瞳距" value={result.eyeRelief.toFixed(0)} unit="mm" />
                <MetricCard label="筒长" value={result.tubeLength.toFixed(0)} unit="mm" />
                {result.obstruction > 0 && (
                  <MetricCard label="遮拦比" value={(result.obstruction * 100).toFixed(0)} unit="%" />
                )}
                <MetricCard label="衍射极限" value={result.diffractionLimit.toFixed(2)} unit="arcsec" />
                <MetricCard label="估算视场" value={result.fov.toFixed(1)} unit="arcmin" />
                <MetricCard label="集光面积" value={(result.collectingArea / Math.PI).toFixed(0)} unit="mm²/π" />
              </div>
            </div>

            {/* 类型对比表 */}
            {!isMobile && (
              <div style={{ padding: '0 24px 24px' }}>
                <div style={{
                  fontFamily: FONT, fontSize: '11px', fontWeight: 600, color: '#1A1A1A',
                  marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px',
                }}>
                  <span style={{ width: '4px', height: '12px', backgroundColor: '#1A1A1A', display: 'inline-block' }} />
                  望远镜类型对比
                </div>
                <div style={{
                  backgroundColor: '#FFFFFF', border: '1px solid #D0D0D0', borderRadius: '2px',
                  overflow: 'hidden',
                }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONT, fontSize: '11px' }}>
                    <thead>
                      <tr style={{ backgroundColor: '#FAFAFA', borderBottom: '1px solid #D0D0D0' }}>
                        <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: '#1A1A1A' }}>类型</th>
                        <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: '#1A1A1A' }}>目镜</th>
                        <th style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 600, color: '#1A1A1A' }}>成像方向</th>
                        <th style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 600, color: '#1A1A1A' }}>筒长</th>
                        <th style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 600, color: '#1A1A1A' }}>色差</th>
                        <th style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 600, color: '#1A1A1A' }}>遮拦</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { t: 'galilean' as TelescopeType, eye: '凹透镜', dir: '正立', tube: '短', chroma: '有', obs: '无' },
                        { t: 'keplerian' as TelescopeType, eye: '凸透镜', dir: '倒立', tube: '长', chroma: '有', obs: '无' },
                        { t: 'newtonian' as TelescopeType, eye: '平面副镜', dir: '倒立', tube: '长', chroma: '无', obs: '小' },
                        { t: 'cassegrain' as TelescopeType, eye: '双面副镜', dir: '倒立', tube: '短', chroma: '无', obs: '中' },
                      ].map((row, i) => (
                        <tr key={row.t} style={{
                          borderBottom: i < 3 ? '1px solid #E8ECF0' : 'none',
                          backgroundColor: type === row.t ? '#F0F3F6' : 'transparent',
                        }}>
                          <td style={{ padding: '8px 12px', fontWeight: type === row.t ? 600 : 400, color: '#1A1A1A' }}>{TYPE_LABELS[row.t]}</td>
                          <td style={{ padding: '8px 12px', color: '#666' }}>{row.eye}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'center', color: '#666' }}>{row.dir}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'center', color: '#666' }}>{row.tube}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'center', color: row.chroma === '无' ? '#00AA44' : '#CC0000' }}>{row.chroma}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'center', color: '#666' }}>{row.obs}</td>
                        </tr>
                      ))}
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
