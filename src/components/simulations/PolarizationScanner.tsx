'use client'

import { useState, useRef, useEffect, useCallback } from 'react'

const FONT = 'var(--font-ibm-plex-sans), system-ui, sans-serif'

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

/* ─── Main Component ─── */
export default function PolarizationVisionScanner({ onBack }: { onBack: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [cameraActive, setCameraActive] = useState(false)
  const [retardationScale, setRetardationScale] = useState(500) // nm max
  const [stream, setStream] = useState<MediaStream | null>(null)

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
      // Camera not available - show demo mode
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

  // Process video frames for stress birefringence visualization
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

      // Simulate stress birefringence extraction
      // In real implementation, this would use cross-polarized images
      // Here we use color channel differences as a proxy for birefringence
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i]
        const g = data[i + 1]
        const b = data[i + 2]

        // Estimate retardation from color differences
        // This is a simplified model: actual birefringence needs crossed polarizers
        const diff = Math.abs(r - g) + Math.abs(g - b) + Math.abs(r - b)
        const retardation = (diff / (3 * 255)) * retardationScale

        if (retardation > 5) { // Only colorize if significant birefringence
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
      </div>

      <div className="flex flex-1" style={{ minHeight: 0 }}>
        {/* Left: Camera view */}
        <div className="flex-1 dot-grid" style={{
          display: 'flex', flexDirection: 'column', padding: '16px',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{ position: 'relative', maxWidth: '640px', width: '100%' }}>
            {/* Hidden video element */}
            <video ref={videoRef} style={{ display: 'none' }} playsInline muted />
            {/* Output canvas */}
            <canvas ref={canvasRef} style={{
              width: '100%', maxWidth: '640px', border: '1px solid #D0D0D0',
              backgroundColor: '#F0F3F6', display: 'block',
            }} />

            {!cameraActive && (
              <div style={{
                position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                backgroundColor: '#FAFAFA', border: '1px solid #D0D0D0',
              }}>
                <svg width="48" height="48" viewBox="0 0 48 48">
                  <rect x="4" y="10" width="40" height="28" fill="none" stroke="#333333" strokeWidth="1.5" rx="2" />
                  <circle cx="24" cy="24" r="8" fill="none" stroke="#333333" strokeWidth="1.2" />
                  <circle cx="38" cy="14" r="2" fill="#333333" />
                </svg>
                <div style={{ fontSize: '12px', color: '#555555', fontFamily: FONT, marginTop: '12px' }}>
                  点击下方按钮启动摄像头
                </div>
                <div style={{ fontSize: '10px', color: '#888888', fontFamily: FONT, marginTop: '4px' }}>
                  需要在正交偏光镜下拍摄才能获取应力双折射
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
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '7px', color: '#888888', fontFamily: FONT, className: 'tabular-nums' }}>
              <span>0</span>
              <span>{Math.round(retardationScale / 4)}</span>
              <span>{Math.round(retardationScale / 2)}</span>
              <span>{Math.round(retardationScale * 3 / 4)}</span>
              <span>{retardationScale}</span>
            </div>
          </div>
        </div>

        {/* Right: Controls */}
        <div style={{
          width: '280px', flexShrink: 0, backgroundColor: '#FAFAFA',
          borderLeft: '1px solid #D0D0D0', overflowY: 'auto', padding: '16px',
          className: 'custom-scrollbar',
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
          </div>

          {/* Retardation scale */}
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
              <div>1. 将样品置于正交偏光镜之间</div>
              <div>2. 启动摄像头对准样品</div>
              <div>3. 系统自动提取应力双折射图案</div>
              <div>4. 伪彩色显示延迟量分布</div>
              <div style={{ marginTop: '8px', borderTop: '1px solid #E8ECF0', paddingTop: '6px' }}>
                适用对象: 透明塑料、玻璃、晶体等
              </div>
              <div>应力集中处颜色更鲜艳</div>
              <div>零应力区域呈暗灰色</div>
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
