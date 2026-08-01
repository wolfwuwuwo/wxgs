'use client'

import { useRef, useState, useCallback, useEffect } from 'react'

const FONT = "system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif"
const MONO = 'var(--font-geist-mono), ui-monospace, monospace'

export interface KnobProps {
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
  label?: string
  unit?: string
  size?: number
  precision?: number
  /** 标记"仪器到位"的特定值（如 0、90），到达时触发卡位反馈 */
  detentValues?: number[]
  /** 到达 detent 值时的回调（用于外部音效/反馈） */
  onDetent?: (value: number) => void
  disabled?: boolean
}

/**
 * 刻度旋钮控件 — 仪器感圆形刻度盘
 *
 * 交互：
 * - 鼠标滚轮：步进增减
 * - 拖拽（鼠标/触摸）：角度拖拽旋转
 * - 触摸转动：同拖拽
 *
 * 视觉：白底黑字细线框，刻度环，指针，灰色等宽数字
 * 反馈：步进咔哒感（subtle scale pulse），detent 值边框闪烁
 */
export function Knob({
  value, min, max, step, onChange, label, unit,
  size = 72, precision = 1, detentValues = [], onDetent, disabled = false,
}: KnobProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const dragState = useRef<{ startAngle: number; startValue: number; active: boolean }>({
    startAngle: 0, startValue: 0, active: false,
  })
  const [pulse, setPulse] = useState(false)
  const [detentFlash, setDetentFlash] = useState(false)
  const lastDetentRef = useRef<number | null>(null)

  const sweep = 270 // 总扫过角度
  const startAngle = -135 // 起始角度（左下）
  const radius = size / 2
  const cx = radius
  const cy = radius

  // 值 → 角度
  const valueToAngle = useCallback((v: number) => {
    const clamped = Math.max(min, Math.min(max, v))
    return startAngle + ((clamped - min) / (max - min)) * sweep
  }, [min, max, startAngle, sweep])

  // 角度 → 值
  const angleToValue = useCallback((a: number) => {
    const ratio = (a - startAngle) / sweep
    const raw = min + ratio * (max - min)
    return Math.max(min, Math.min(max, raw))
  }, [min, max, startAngle, sweep])

  // 取整到 step
  const snap = useCallback((v: number) => {
    const snapped = Math.round(v / step) * step
    return Math.max(min, Math.min(max, Number(snapped.toFixed(6))))
  }, [step, min, max])

  const currentAngle = valueToAngle(value)

  // 触发咔哒脉冲
  const triggerPulse = useCallback(() => {
    setPulse(true)
    window.setTimeout(() => setPulse(false), 90)
  }, [])

  // 检测 detent 到位
  const checkDetent = useCallback((v: number) => {
    if (detentValues.length === 0) return
    const hit = detentValues.find(d => Math.abs(d - v) < step * 0.5)
    if (hit !== undefined && lastDetentRef.current !== hit) {
      lastDetentRef.current = hit
      setDetentFlash(true)
      window.setTimeout(() => setDetentFlash(false), 100)
      onDetent?.(hit)
    } else if (hit === undefined) {
      lastDetentRef.current = null
    }
  }, [detentValues, step, onDetent])

  const updateValue = useCallback((v: number) => {
    const snapped = snap(v)
    onChange(snapped)
    triggerPulse()
    checkDetent(snapped)
  }, [snap, onChange, triggerPulse, checkDetent])

  // 计算指针相对中心的角度（atan2）
  const getPointerAngle = useCallback((clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return 0
    const px = clientX - rect.left - rect.width / 2
    const py = clientY - rect.top - rect.height / 2
    // atan2 返回弧度，0=右，顺时针为正（屏幕坐标 y 向下）
    return Math.atan2(py, px) * (180 / Math.PI)
  }, [])

  // 指针按下：开始角度拖拽
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (disabled) return
    e.preventDefault()
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    dragState.current = {
      startAngle: getPointerAngle(e.clientX, e.clientY),
      startValue: value,
      active: true,
    }
  }, [disabled, getPointerAngle, value])

  // 指针移动：角度差 → 值变化
  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragState.current.active || disabled) return
    e.preventDefault()
    const currentPointerAngle = getPointerAngle(e.clientX, e.clientY)
    let delta = currentPointerAngle - dragState.current.startAngle
    // 处理角度跳变（-180↔180）
    if (delta > 180) delta -= 360
    if (delta < -180) delta += 360
    // 角度差映射到值：拖拽 sweep 度 = 全范围
    const valueDelta = (delta / sweep) * (max - min)
    const newValue = dragState.current.startValue + valueDelta
    updateValue(newValue)
  }, [disabled, getPointerAngle, sweep, max, min, updateValue])

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragState.current.active) return
    e.preventDefault()
    ;(e.target as Element).releasePointerCapture?.(e.pointerId)
    dragState.current.active = false
  }, [])

  // 鼠标滚轮
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (disabled) return
    e.preventDefault()
    const direction = e.deltaY < 0 ? 1 : -1
    // 滚轮加速：按住 Shift 大步
    const mult = e.shiftKey ? 5 : 1
    updateValue(value + direction * step * mult)
  }, [disabled, value, step, updateValue])

  // 键盘：方向键调节
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (disabled) return
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      e.preventDefault()
      updateValue(value + step)
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      e.preventDefault()
      updateValue(value - step)
    } else if (e.key === 'Home') {
      e.preventDefault()
      updateValue(min)
    } else if (e.key === 'End') {
      e.preventDefault()
      updateValue(max)
    }
  }, [disabled, value, step, min, max, updateValue])

  // 生成刻度
  const tickCount = 36 // 每 7.5° 一根
  const majorEvery = 4 // 每 4 根一根长刻度
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => {
    const t = i / tickCount
    const angle = startAngle + t * sweep
    const rad = (angle - 90) * (Math.PI / 180) // -90 让 0° 朝上
    const isMajor = i % majorEvery === 0
    const r1 = radius - 2
    const r2 = isMajor ? radius - 9 : radius - 5
    return {
      x1: cx + Math.cos(rad) * r1,
      y1: cy + Math.sin(rad) * r1,
      x2: cx + Math.cos(rad) * r2,
      y2: cy + Math.sin(rad) * r2,
      isMajor,
      value: min + t * (max - min),
    }
  })

  // 指针端点
  const needleRad = (currentAngle - 90) * (Math.PI / 180)
  const needleLen = radius - 12
  const needleX = cx + Math.cos(needleRad) * needleLen
  const needleY = cy + Math.sin(needleRad) * needleLen

  const displayValue = value.toFixed(precision)

  return (
    <div className="flex flex-col items-center" style={{ userSelect: 'none' }}>
      {label && (
        <span style={{
          fontFamily: FONT, fontSize: '10px', fontWeight: 500, color: '#666666',
          marginBottom: '6px', letterSpacing: '0.02em', textAlign: 'center',
        }}>
          {label}
        </span>
      )}
      <div
        style={{
          position: 'relative',
          width: `${size}px`, height: `${size}px`,
          minHeight: '44px',
          cursor: disabled ? 'not-allowed' : 'grab',
          opacity: disabled ? 0.5 : 1,
          transform: pulse ? 'scale(0.96)' : 'scale(1)',
          transition: 'transform 80ms ease-out',
        }}
      >
        <svg
          ref={svgRef}
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          style={{
            display: 'block',
            touchAction: 'none',
            outline: 'none',
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onWheel={handleWheel}
          onKeyDown={handleKeyDown}
          tabIndex={0}
          role="slider"
          aria-label={label || '旋钮'}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          aria-valuetext={`${displayValue}${unit || ''}`}
        >
          {/* 外圈背景 */}
          <circle
            cx={cx} cy={cy} r={radius - 1}
            fill="#FFFFFF"
            stroke={detentFlash ? '#1A1A1A' : '#333333'}
            strokeWidth={detentFlash ? 1.5 : 1}
            style={{ transition: 'stroke 80ms ease-out, stroke-width 80ms ease-out' }}
          />
          {/* detent 闪烁边框 */}
          {detentFlash && (
            <circle cx={cx} cy={cy} r={radius + 1} fill="none" stroke="#1A1A1A" strokeWidth={1} opacity={0.4} />
          )}
          {/* 刻度 */}
          {ticks.map((t, i) => (
            <line
              key={i}
              x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2}
              stroke={t.isMajor ? '#333333' : '#C0C4C8'}
              strokeWidth={t.isMajor ? 1 : 0.6}
            />
          ))}
          {/* 中心圆盘 */}
          <circle cx={cx} cy={cy} r={radius - 14} fill="#FAFAFA" stroke="#D0D0D0" strokeWidth={0.8} />
          {/* 指针 */}
          <line
            x1={cx} y1={cy} x2={needleX} y2={needleY}
            stroke="#1A1A1A" strokeWidth={1.8} strokeLinecap="round"
          />
          {/* 中心轴 */}
          <circle cx={cx} cy={cy} r={2.5} fill="#1A1A1A" />
        </svg>
      </div>
      {/* 灰色等宽数字 */}
      <div style={{
        fontFamily: MONO, fontSize: '12px', fontWeight: 500,
        color: '#555555', marginTop: '4px',
        fontVariantNumeric: 'tabular-nums',
        display: 'flex', alignItems: 'baseline', gap: '2px',
      }}>
        <span>{displayValue}</span>
        {unit && <span style={{ fontSize: '9px', color: '#999999' }}>{unit}</span>}
      </div>
    </div>
  )
}

/* ─── 旋钮行布局：标签 + 旋钮 + 数值，用于控制面板内排列 ─── */
export function KnobRow({
  label, value, min, max, step, onChange, unit, precision, detentValues, onDetent, size = 64,
}: KnobProps & { size?: number }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '12px',
      padding: '8px 4px', minHeight: '44px',
    }}>
      <span style={{
        fontFamily: FONT, fontSize: '11px', fontWeight: 400, color: '#666666',
        flex: 1, lineHeight: 1.4,
      }}>
        {label}
      </span>
      <Knob
        value={value} min={min} max={max} step={step}
        onChange={onChange} unit={unit} precision={precision}
        detentValues={detentValues} onDetent={onDetent}
        size={size}
      />
    </div>
  )
}
