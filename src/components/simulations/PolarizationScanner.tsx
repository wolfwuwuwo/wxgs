'use client'

import { useState, useRef, useEffect, useCallback } from 'react'

const FONT = 'var(--font-ibm-plex-sans), system-ui, sans-serif'

type DemoPattern = 'disk' | 'plate' | 'beam' | 'residual'

const DEMO_PATTERN_LABELS: Record<DemoPattern, string> = {
  disk: '圆盘压缩',
  plate: '方板拉伸',
  beam: '梁弯曲',
  residual: '残余应力',
}

const DEMO_PATTERN_DESC: Record<DemoPattern, string> = {
  disk: '同心彩色环 — 受压玻璃盘在正交偏光镜下的干涉图样',
  plate: '对角等色线 — 单轴拉伸板的应力双折射条纹',
  beam: '中性轴 + 弯曲条纹 — 梁弯曲时的应力分布',
  residual: '不规则图样 — 钢化玻璃的残余应力分布',
}

/* ─── Stress-optical standard color map ─── */
// Maps retardation (in nm) to color using Michel-Lévy chart approximation
function stressColorMap(retardationNm: number): [number, number, number] {
  const r = Math.max(0, Math.min(255,
    retardationNm < 200 ? retardationNm * 1.2 :
    retardationNm < 400 ? 240 - (retardationNm - 200) * 0.8 :
    retardationNm < 550 ? 80 + (retardationNm - 400) * 1.1 :
    245 - (retardationNm - 550) * 0.5
  ))
  const g = Math.max(0, Math.min(255,
    retardationNm < 150 ? retardationNm * 0.6 :
    retardationNm < 300 ? 90 + (retardationNm - 150) * 0.5 :
    retardationNm < 500 ? 165 - (retardationNm - 300) * 0.5 :
    65 + (retardationNm - 500) * 0.3
  ))
  const b = Math.max(0, Math.min(255,
    retardationNm < 100 ? retardationNm * 1.5 :
    retardationNm < 250 ? 150 - (retardationNm - 100) * 0.3 :
    retardationNm < 450 ? 105 + (retardationNm - 250) * 0.5 :
    205 - (retardationNm - 450) * 0.6
  ))
  return [Math.round(r), Math.round(g), Math.round(b)]
}

/* ─── Demo pattern retardation generators ─── */
// Each returns retardation in nm for a given pixel coordinate
// cx, cy: center of canvas; x, y: pixel position; w, h: canvas dimensions

function diskCompressionRetardation(
  x: number, y: number, cx: number, cy: number, w: number, h: number,
  stressFactor: number, birefringenceCoeff: number, rotation: number
): number {
  // Rotate coordinates
  const cosR = Math.cos(rotation)
  const sinR = Math.sin(rotation)
  const dx = x - cx
  const dy = y - cy
  const rx = dx * cosR - dy * sinR
  const ry = dx * sinR + dy * cosR

  const maxR = Math.min(w, h) * 0.45
  const dist = Math.sqrt(rx * rx + ry * ry)

  if (dist > maxR) return 0 // outside the disk

  // Normalized radius [0, 1]
  const rn = dist / maxR

  // Retardation for disk compression:
  // σ_r - σ_θ proportional to (1 - r²/a²), so retardation ∝ (1 - r²)
  // Creates concentric isochromatic fringes
  const stressDiff = (1 - rn * rn) * stressFactor * birefringenceCoeff

  // Modulate with cos² to create fringe orders
  const retardation = stressDiff * 300 * (0.5 + 0.5 * Math.cos(Math.PI * stressDiff * 2.5))

  // Add slight radial variation for realism
  const fringeDetail = 20 * Math.sin(rn * Math.PI * stressFactor * 3) * birefringenceCoeff

  return Math.max(0, retardation + fringeDetail)
}

function plateTensionRetardation(
  x: number, y: number, cx: number, cy: number, w: number, h: number,
  stressFactor: number, birefringenceCoeff: number, rotation: number
): number {
  // Rotate coordinates
  const cosR = Math.cos(rotation)
  const sinR = Math.sin(rotation)
  const dx = x - cx
  const dy = y - cy
  const rx = dx * cosR - dy * sinR
  const ry = dx * sinR + dy * cosR

  const halfW = w * 0.45
  const halfH = h * 0.45

  // Check if within plate bounds
  if (Math.abs(rx) > halfW || Math.abs(ry) > halfH) return 0

  // Plate under uniaxial tension along y-axis
  // σ_y - σ_x = A * stressFactor (uniform in ideal case)
  // Near edges and holes, stress concentration creates fringes
  const edgeDistX = (halfW - Math.abs(rx)) / halfW
  const edgeDistY = (halfH - Math.abs(ry)) / halfH

  // Base stress (uniform tension)
  let stressDiff = stressFactor * birefringenceCoeff

  // Stress concentration near edges (St. Venant effect)
  stressDiff *= (0.7 + 0.3 * Math.min(edgeDistX, 1))

  // Add fringe pattern from stress variation
  const ny = ry / halfH
  const fringePattern = Math.cos(Math.PI * ny * stressFactor * 2)

  // Near hole at center (simulated stress concentrator)
  const holeR = Math.min(w, h) * 0.08
  const distFromHole = Math.sqrt(rx * rx + ry * ry)
  if (distFromHole < holeR * 1.1) return 0 // hole itself
  const holeStressConcentration = distFromHole < holeR * 3
    ? (holeR / distFromHole) * stressFactor * 0.5
    : 0

  const retardation = (stressDiff * 250 * fringePattern + holeStressConcentration * 200)

  return Math.max(0, retardation)
}

function beamBendingRetardation(
  x: number, y: number, cx: number, cy: number, w: number, h: number,
  stressFactor: number, birefringenceCoeff: number, rotation: number
): number {
  // Rotate coordinates
  const cosR = Math.cos(rotation)
  const sinR = Math.sin(rotation)
  const dx = x - cx
  const dy = y - cy
  const rx = dx * cosR - dy * sinR
  const ry = dx * sinR + dy * cosR

  const beamHalfH = h * 0.12
  const beamHalfW = w * 0.45

  // Check if within beam bounds
  if (Math.abs(rx) > beamHalfW || Math.abs(ry) > beamHalfH) return 0

  // Beam under 3-point bending
  // Bending moment M varies along beam: triangular distribution
  // M(x) = M_max * (1 - |x|/L) for center loading
  const mx = Math.abs(rx) / beamHalfW
  const bendingMoment = (1 - mx) * stressFactor

  // σ = M * y / I, where I is constant
  // Neutral axis at y = 0
  const ny = ry / beamHalfH // [-1, 1]

  // Stress proportional to y and bending moment
  const stressDiff = bendingMoment * ny * birefringenceCoeff * 2

  // Retardation proportional to stress difference
  // cos²(π * δ/λ) creates isochromatic fringes
  const retardation = Math.abs(stressDiff) * 300

  // Add fringe detail
  const fringeOrder = Math.abs(stressDiff) * stressFactor * 1.5
  const fringeMod = 0.5 + 0.5 * Math.cos(Math.PI * fringeOrder * 2)
  const detailedRetardation = retardation * fringeMod

  // Neutral axis (y ≈ 0) should be dark
  const neutralAxisFade = Math.abs(ny)

  return Math.max(0, detailedRetardation * neutralAxisFade)
}

function residualStressRetardation(
  x: number, y: number, cx: number, cy: number, w: number, h: number,
  stressFactor: number, birefringenceCoeff: number, rotation: number
): number {
  // Rotate coordinates
  const cosR = Math.cos(rotation)
  const sinR = Math.sin(rotation)
  const dx = x - cx
  const dy = y - cy
  const rx = dx * cosR - dy * sinR
  const ry = dx * sinR + dy * cosR

  const halfW = w * 0.45
  const halfH = h * 0.45

  // Check if within plate bounds (rectangular piece of tempered glass)
  if (Math.abs(rx) > halfW || Math.abs(ry) > halfH) return 0

  const nx = rx / halfW
  const ny = ry / halfH

  // Residual stress in tempered glass is a combination of:
  // 1. Surface compression (parabolic through thickness → varies near edges)
  // 2. Internal tension (center region)
  // 3. Non-uniform cooling patterns (sinusoidal)

  // Surface compression near edges
  const edgeX = (1 - Math.abs(nx)) * 4
  const edgeY = (1 - Math.abs(ny)) * 4
  const surfaceStress = (1 / (1 + edgeX * edgeX) + 1 / (1 + edgeY * edgeY)) * stressFactor * 0.3

  // Non-uniform cooling pattern - multiple sinusoidal components
  const cooling1 = Math.sin(nx * Math.PI * 2.3 + ny * Math.PI * 1.7) * 0.4
  const cooling2 = Math.cos(nx * Math.PI * 3.1 - ny * Math.PI * 2.1) * 0.3
  const cooling3 = Math.sin((nx + ny) * Math.PI * 1.5) * 0.2
  const cooling4 = Math.cos(nx * Math.PI * 4.7) * Math.sin(ny * Math.PI * 3.3) * 0.15

  const coolingPattern = (cooling1 + cooling2 + cooling3 + cooling4) * stressFactor * birefringenceCoeff

  // Central tension zone
  const centralDist = Math.sqrt(nx * nx + ny * ny)
  const centralTension = Math.exp(-centralDist * centralDist * 2) * stressFactor * 0.5 * birefringenceCoeff

  // Combine all contributions
  const totalStress = surfaceStress + coolingPattern + centralTension

  // Convert to retardation with fringe pattern
  const retardation = Math.abs(totalStress) * 350

  // Add fine fringe detail
  const fineFringes = 15 * Math.sin(totalStress * Math.PI * stressFactor * 2) * birefringenceCoeff

  return Math.max(0, retardation + fineFringes)
}

/* ─── Main Component ─── */
export default function PolarizationVisionScanner({ onBack }: { onBack: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [cameraActive, setCameraActive] = useState(false)
  const [retardationScale, setRetardationScale] = useState(500) // nm max
  const [stream, setStream] = useState<MediaStream | null>(null)

  // Demo mode state
  const [demoPattern, setDemoPattern] = useState<DemoPattern>('disk')
  const [stressMagnitude, setStressMagnitude] = useState(3) // 1-10
  const [birefringenceCoeff, setBirefringenceCoeff] = useState(1.5) // 0.1-3.0
  const [rotationAngle, setRotationAngle] = useState(0) // 0-360

  // Refs for demo rendering to avoid stale closures
  const demoPatternRef = useRef(demoPattern)
  const stressMagRef = useRef(stressMagnitude)
  const birefCoeffRef = useRef(birefringenceCoeff)
  const rotationRef = useRef(rotationAngle)
  const retardationScaleRef = useRef(retardationScale)

  useEffect(() => { demoPatternRef.current = demoPattern }, [demoPattern])
  useEffect(() => { stressMagRef.current = stressMagnitude }, [stressMagnitude])
  useEffect(() => { birefCoeffRef.current = birefringenceCoeff }, [birefringenceCoeff])
  useEffect(() => { rotationRef.current = rotationAngle }, [rotationAngle])
  useEffect(() => { retardationScaleRef.current = retardationScale }, [retardationScale])

  const startCamera = useCallback(async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: 640, height: 480 }
      })
      setStream(mediaStream)
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream
        videoRef.current.play()
      }
      setCameraActive(true)
    } catch {
      // Camera not available - stay in demo mode
      setCameraActive(false)
    }
  }, [])

  const stopCamera = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach(t => t.stop())
      setStream(null)
    }
    setCameraActive(false)
  }, [stream])

  // Process video frames for stress birefringence visualization (camera mode)
  useEffect(() => {
    if (!cameraActive || !videoRef.current || !canvasRef.current) return

    const video = videoRef.current
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animId: number

    const processFrame = () => {
      if (video.readyState < 2) {
        animId = requestAnimationFrame(processFrame)
        return
      }

      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      ctx.drawImage(video, 0, 0)

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const data = imageData.data

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i]
        const g = data[i + 1]
        const b = data[i + 2]

        const diff = Math.abs(r - g) + Math.abs(g - b) + Math.abs(r - b)
        const retardation = (diff / (3 * 255)) * retardationScale

        if (retardation > 5) {
          const [cr, cg, cb] = stressColorMap(retardation)
          const alpha = Math.min(1, retardation / (retardationScale * 0.3))
          data[i] = Math.round(r * (1 - alpha) + cr * alpha)
          data[i + 1] = Math.round(g * (1 - alpha) + cg * alpha)
          data[i + 2] = Math.round(b * (1 - alpha) + cb * alpha)
        }
      }

      ctx.putImageData(imageData, 0, 0)
      animId = requestAnimationFrame(processFrame)
    }

    animId = requestAnimationFrame(processFrame)
    return () => cancelAnimationFrame(animId)
  }, [cameraActive, retardationScale])

  // Demo mode rendering
  useEffect(() => {
    if (cameraActive || !canvasRef.current) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const W = 400
    const H = 300
    canvas.width = W
    canvas.height = H

    const cx = W / 2
    const cy = H / 2
    const rotRad = () => (rotationRef.current * Math.PI) / 180

    let animId: number

    const renderDemo = () => {
      const pattern = demoPatternRef.current
      const sf = stressMagRef.current
      const bc = birefCoeffRef.current
      const rot = rotRad()
      const scale = retardationScaleRef.current

      const imageData = ctx.createImageData(W, H)
      const data = imageData.data

      // Select pattern generator
      let getRetardation: typeof diskCompressionRetardation
      switch (pattern) {
        case 'disk':
          getRetardation = diskCompressionRetardation
          break
        case 'plate':
          getRetardation = plateTensionRetardation
          break
        case 'beam':
          getRetardation = beamBendingRetardation
          break
        case 'residual':
          getRetardation = residualStressRetardation
          break
      }

      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const idx = (y * W + x) * 4
          const ret = getRetardation(x, y, cx, cy, W, H, sf, bc, rot)

          // Scale retardation relative to the max scale
          const scaledRet = (ret / 1000) * scale

          if (scaledRet > 2) {
            const [cr, cg, cb] = stressColorMap(scaledRet)
            data[idx] = cr
            data[idx + 1] = cg
            data[idx + 2] = cb
            data[idx + 3] = 255
          } else {
            // Background for zero-stress regions - dark as in crossed polarizers
            const brightness = 15 + Math.round(scaledRet * 4)
            data[idx] = brightness
            data[idx + 1] = brightness
            data[idx + 2] = brightness
            data[idx + 3] = 255
          }
        }
      }

      ctx.putImageData(imageData, 0, 0)

      // Draw pattern label on canvas
      ctx.font = `10px ${FONT.replace(/var\(--font-ibm-plex-sans\)/, 'IBM Plex Sans, sans-serif')}`
      ctx.fillStyle = '#AAAAAA'
      ctx.textAlign = 'right'
      ctx.fillText(DEMO_PATTERN_LABELS[pattern], W - 8, H - 8)

      animId = requestAnimationFrame(renderDemo)
    }

    animId = requestAnimationFrame(renderDemo)
    return () => cancelAnimationFrame(animId)
  }, [cameraActive])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach(t => t.stop())
      }
    }
  }, [stream])

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
          偏振视觉扫描仪
        </h1>
        {!cameraActive && (
          <span style={{
            marginLeft: '12px', fontSize: '10px', color: '#888888',
            fontFamily: FONT, backgroundColor: '#F0F3F6',
            padding: '2px 8px', borderRadius: '2px', border: '1px solid #E8ECF0',
          }}>
            演示模式
          </span>
        )}
      </div>

      <div className="flex flex-1" style={{ minHeight: 0 }}>
        {/* Left: Camera / Demo view */}
        <div className="flex-1 dot-grid" style={{
          display: 'flex', flexDirection: 'column', padding: '16px',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{ position: 'relative', maxWidth: '640px', width: '100%' }}>
            {/* Hidden video element */}
            <video ref={videoRef} style={{ display: 'none' }} playsInline muted />
            {/* Output canvas - used by both camera and demo mode */}
            <canvas ref={canvasRef} style={{
              width: '100%', maxWidth: '640px', border: '1px solid #D0D0D0',
              backgroundColor: '#0F0F0F', display: 'block',
            }} />

            {/* Camera-only placeholder overlay - only when camera was never started */}
            {cameraActive && (
              <div style={{
                position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                backgroundColor: '#FAFAFA', border: '1px solid #D0D0D0',
                pointerEvents: 'none',
              }}>
                <div style={{ fontSize: '10px', color: '#888888', fontFamily: FONT }}>
                  正在处理摄像头画面...
                </div>
              </div>
            )}
          </div>

          {/* Color scale bar */}
          <div style={{ marginTop: '12px', width: '100%', maxWidth: '640px' }}>
            <div style={{ fontSize: '10px', color: '#555555', fontFamily: FONT, marginBottom: '4px' }}>
              应力光学延迟量色标 (nm)
            </div>
            <svg width="100%" height="16" viewBox="0 0 600 16" preserveAspectRatio="none">
              {Array.from({ length: 600 }, (_, i) => {
                const ret = (i / 600) * retardationScale
                const [r, g, b] = stressColorMap(ret)
                return <rect key={i} x={i} y="0" width="1" height="16" fill={`rgb(${r},${g},${b})`} />
              })}
            </svg>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '7px', color: '#888888', fontFamily: FONT }}>
              <span className="tabular-nums">0</span>
              <span className="tabular-nums">{Math.round(retardationScale / 4)}</span>
              <span className="tabular-nums">{Math.round(retardationScale / 2)}</span>
              <span className="tabular-nums">{Math.round(retardationScale * 3 / 4)}</span>
              <span className="tabular-nums">{retardationScale}</span>
            </div>
          </div>
        </div>

        {/* Right: Controls */}
        <div className="custom-scrollbar" style={{
          width: '280px', flexShrink: 0, backgroundColor: '#FAFAFA',
          borderLeft: '1px solid #D0D0D0', overflowY: 'auto', padding: '16px',
        }}>
          {/* Camera control */}
          <div style={{ marginBottom: '16px' }}>
            <SectionTitle>摄像头控制</SectionTitle>
            <button onClick={cameraActive ? stopCamera : startCamera} style={{
              width: '100%', fontSize: '10px', padding: '8px',
              borderRadius: '2px',
              border: `1px solid ${cameraActive ? '#CC0000' : '#333333'}`,
              backgroundColor: cameraActive ? '#FFF0F0' : '#F0F3F6',
              color: cameraActive ? '#CC0000' : '#1A1A1A',
              cursor: 'pointer', fontFamily: FONT,
              transition: 'border-color 200ms ease-out',
            }}>
              {cameraActive ? '✕ 关闭摄像头' : '◉ 启动摄像头'}
            </button>
            {!cameraActive && (
              <div style={{
                marginTop: '6px', fontSize: '9px', color: '#888888', fontFamily: FONT,
                backgroundColor: '#F0F3F6', padding: '4px 8px', borderRadius: '2px',
                border: '1px solid #E8ECF0',
              }}>
                无摄像头时自动进入演示模式
              </div>
            )}
          </div>

          {/* Demo mode controls - only when camera is NOT active */}
          {!cameraActive && (
            <>
              {/* Pattern selector */}
              <div style={{ marginBottom: '16px' }}>
                <SectionTitle>演示模式</SectionTitle>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                  {(Object.keys(DEMO_PATTERN_LABELS) as DemoPattern[]).map(key => (
                    <button key={key} onClick={() => setDemoPattern(key)} style={{
                      fontSize: '10px', padding: '6px 4px', borderRadius: '2px',
                      border: `1px solid ${demoPattern === key ? '#333333' : '#D0D0D0'}`,
                      backgroundColor: demoPattern === key ? '#E8ECF0' : '#FFFFFF',
                      color: demoPattern === key ? '#1A1A1A' : '#555555',
                      cursor: 'pointer', fontFamily: FONT,
                      transition: 'all 150ms ease-out',
                    }}>
                      {DEMO_PATTERN_LABELS[key]}
                    </button>
                  ))}
                </div>
                <div style={{
                  marginTop: '8px', fontSize: '9px', color: '#888888',
                  fontFamily: FONT, lineHeight: '1.5',
                }}>
                  {DEMO_PATTERN_DESC[demoPattern]}
                </div>
              </div>

              {/* Stress magnitude slider */}
              <div style={{ marginBottom: '16px' }}>
                <SectionTitle>应力大小</SectionTitle>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input type="range" min="1" max="10" step="0.5" value={stressMagnitude}
                    onChange={e => setStressMagnitude(Number(e.target.value))}
                    style={{ flex: 1, accentColor: '#333333' }}
                  />
                  <span className="tabular-nums" style={{ fontSize: '10px', color: '#1A1A1A', fontFamily: FONT, minWidth: '24px' }}>
                    {stressMagnitude}
                  </span>
                </div>
                <div style={{ fontSize: '8px', color: '#AAAAAA', fontFamily: FONT, marginTop: '2px' }}>
                  控制条纹级次/密度
                </div>
              </div>

              {/* Birefringence coefficient slider */}
              <div style={{ marginBottom: '16px' }}>
                <SectionTitle>双折射系数</SectionTitle>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input type="range" min="0.1" max="3.0" step="0.1" value={birefringenceCoeff}
                    onChange={e => setBirefringenceCoeff(Number(e.target.value))}
                    style={{ flex: 1, accentColor: '#333333' }}
                  />
                  <span className="tabular-nums" style={{ fontSize: '10px', color: '#1A1A1A', fontFamily: FONT, minWidth: '28px' }}>
                    {birefringenceCoeff.toFixed(1)}
                  </span>
                </div>
                <div style={{ fontSize: '8px', color: '#AAAAAA', fontFamily: FONT, marginTop: '2px' }}>
                  控制颜色偏移量
                </div>
              </div>

              {/* Rotation angle slider */}
              <div style={{ marginBottom: '16px' }}>
                <SectionTitle>旋转角度</SectionTitle>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input type="range" min="0" max="360" step="5" value={rotationAngle}
                    onChange={e => setRotationAngle(Number(e.target.value))}
                    style={{ flex: 1, accentColor: '#333333' }}
                  />
                  <span className="tabular-nums" style={{ fontSize: '10px', color: '#1A1A1A', fontFamily: FONT, minWidth: '30px' }}>
                    {rotationAngle}°
                  </span>
                </div>
                <div style={{ fontSize: '8px', color: '#AAAAAA', fontFamily: FONT, marginTop: '2px' }}>
                  旋转样品/图案方向
                </div>
              </div>
            </>
          )}

          {/* Retardation scale - always visible */}
          <div style={{ marginBottom: '16px' }}>
            <SectionTitle>延迟量范围</SectionTitle>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input type="range" min="100" max="2000" step="50" value={retardationScale}
                onChange={e => setRetardationScale(Number(e.target.value))}
                style={{ flex: 1, accentColor: '#333333' }}
              />
              <span className="tabular-nums" style={{ fontSize: '10px', color: '#1A1A1A', fontFamily: FONT, minWidth: '40px' }}>
                {retardationScale}nm
              </span>
            </div>
          </div>

          {/* Instructions */}
          <div style={{ marginBottom: '16px' }}>
            <SectionTitle>使用说明</SectionTitle>
            <div style={{
              fontSize: '9px', color: '#888888', fontFamily: FONT, lineHeight: '1.7',
            }}>
              {!cameraActive ? (
                <>
                  <div style={{ fontWeight: 500, color: '#555555', marginBottom: '4px' }}>
                    演示模式
                  </div>
                  <div>1. 选择预设应力图样</div>
                  <div>2. 调节应力大小、双折射系数和旋转角度</div>
                  <div>3. 观察应力双折射伪彩色分布变化</div>
                  <div>4. 启动摄像头可切换为实时模式</div>
                  <div style={{ marginTop: '8px', borderTop: '1px solid #E8ECF0', paddingTop: '6px' }}>
                    应力集中处颜色更鲜艳
                  </div>
                  <div>零应力区域呈暗灰色</div>
                </>
              ) : (
                <>
                  <div>1. 将样品置于正交偏光镜之间</div>
                  <div>2. 启动摄像头对准样品</div>
                  <div>3. 系统自动提取应力双折射图案</div>
                  <div>4. 伪彩色显示延迟量分布</div>
                  <div style={{ marginTop: '8px', borderTop: '1px solid #E8ECF0', paddingTop: '6px' }}>
                    适用对象: 透明塑料、玻璃、晶体等
                  </div>
                  <div>应力集中处颜色更鲜艳</div>
                  <div>零应力区域呈暗灰色</div>
                </>
              )}
            </div>
          </div>

          {/* Color chart legend */}
          <div>
            <SectionTitle>Michel-Lévy色谱</SectionTitle>
            <div style={{
              fontSize: '9px', color: '#888888', fontFamily: FONT, lineHeight: '1.8',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ width: '12px', height: '12px', backgroundColor: '#1A1A1A', borderRadius: '1px' }} />
                0 nm - 零延迟
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ width: '12px', height: '12px', backgroundColor: '#888888', borderRadius: '1px' }} />
                ~50 nm - 灰
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ width: '12px', height: '12px', backgroundColor: '#FFFFFF', border: '1px solid #D0D0D0', borderRadius: '1px' }} />
                ~200 nm - 白
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ width: '12px', height: '12px', backgroundColor: '#E8D050', borderRadius: '1px' }} />
                ~300 nm - 淡黄
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ width: '12px', height: '12px', backgroundColor: '#CC4444', borderRadius: '1px' }} />
                ~500 nm - 红
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ width: '12px', height: '12px', backgroundColor: '#4455AA', borderRadius: '1px' }} />
                ~600 nm - 蓝
              </div>
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
