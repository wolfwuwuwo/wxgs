'use client'

import { useState, useMemo } from 'react'

/* ═══════════════════════════════════════════════
   GEOMETRIC OPTICS RAY TRACING LAB
   ═══════════════════════════════════════════════ */

const FONT = 'var(--font-ibm-plex-sans), system-ui, sans-serif'

type OpticsElement = 'convex' | 'concave' | 'convexMirror' | 'concaveMirror'
type ExpMode = 'thinLens' | 'dualLens' | 'mirror' | 'prism'

// ─── Thin Lens Image Calculation ───
// Sign convention: distances left of lens negative, right positive
// 1/v - 1/u = 1/f  where u is object distance (negative for real object)
// For standard form: 1/v = 1/f + 1/u

interface ImageResult {
  v: number           // image distance (mm), positive = right of lens
  magnification: number
  isReal: boolean
  isUpright: boolean
  isMagnified: boolean
  imageHeight: number  // mm
  atInfinity: boolean
}

function computeThinLensImage(objDist: number, focalLength: number, objHeight: number): ImageResult {
  if (Math.abs(focalLength) < 0.5) {
    return { v: Infinity, magnification: Infinity, isReal: false, isUpright: true, isMagnified: true, imageHeight: objHeight, atInfinity: true }
  }
  // u is negative for real object (left of lens)
  const u = -Math.abs(objDist)
  const f = focalLength

  // 1/v = 1/f - 1/|u| ... wait, let's use: 1/v = 1/f + 1/u
  // With u negative: 1/v = 1/f + 1/u = 1/f - 1/|u|
  const invV = 1 / f + 1 / u  // since u is already negative

  if (Math.abs(invV) < 1e-10) {
    return { v: Infinity, magnification: Infinity, isReal: false, isUpright: true, isMagnified: true, imageHeight: objHeight, atInfinity: true }
  }

  const v = 1 / invV
  const m = v / u  // since u is negative, m = v/u
  const imageHeight = m * objHeight

  return {
    v,
    magnification: m,
    isReal: v > 0,
    isUpright: m > 0,
    isMagnified: Math.abs(m) > 1,
    imageHeight,
    atInfinity: false,
  }
}

// ─── Mirror Image Calculation ───
function computeMirrorImage(objDist: number, focalLength: number, objHeight: number): ImageResult {
  // Mirror: 1/v + 1/u = 1/f = R/2
  // u negative for real object, f positive for concave
  const u = -Math.abs(objDist)
  const f = focalLength // positive for concave, negative for convex

  const invV = 1 / f - 1 / u  // 1/v = 1/f - 1/u
  if (Math.abs(invV) < 1e-10) {
    return { v: Infinity, magnification: Infinity, isReal: false, isUpright: true, isMagnified: true, imageHeight: objHeight, atInfinity: true }
  }

  const v = 1 / invV
  const m = -v / u  // mirror magnification
  const imageHeight = m * objHeight

  return {
    v,
    magnification: m,
    isReal: v < 0,  // mirror: real image on same side as object (v < 0)
    isUpright: m > 0,
    isMagnified: Math.abs(m) > 1,
    imageHeight,
    atInfinity: false,
  }
}

// ─── Prism Refraction ───
function snellAngle(n1: number, n2: number, theta1: number): number | null {
  const sinTheta2 = (n1 / n2) * Math.sin(theta1)
  if (Math.abs(sinTheta2) > 1) return null // total internal reflection
  return Math.asin(sinTheta2)
}

function computePrismDeviation(apexAngle: number, n: number, incidenceAngle: number): {
  deviation: number
  exitAngle: number
  totalInternalReflection: boolean
} {
  const A = (apexAngle * Math.PI) / 180
  const i1 = (incidenceAngle * Math.PI) / 180

  const r1 = snellAngle(1, n, i1)
  if (r1 === null) return { deviation: 0, exitAngle: 0, totalInternalReflection: true }

  const r2 = A - r1
  if (r2 < 0) return { deviation: 0, exitAngle: 0, totalInternalReflection: true }

  const i2 = snellAngle(n, 1, r2)
  if (i2 === null) return { deviation: 0, exitAngle: 0, totalInternalReflection: true }

  const deviation = i1 + i2 - A
  return { deviation, exitAngle: (i2 * 180) / Math.PI, totalInternalReflection: false }
}

// Minimum deviation angle
function computeMinDeviation(apexAngle: number, n: number): number {
  const A = (apexAngle * Math.PI) / 180
  const sinVal = n * Math.sin(A / 2)
  if (Math.abs(sinVal) > 1) return 0
  const iMin = Math.asin(sinVal)
  return 2 * iMin - A
}

/* ═══════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════ */

export default function RayTracingLab({ onBack }: { onBack: () => void }) {
  const [expMode, setExpMode] = useState<ExpMode>('thinLens')

  // Thin lens params
  const [objDist, setObjDist] = useState(120)    // mm, positive = left of lens
  const [objHeight, setObjHeight] = useState(25)  // mm
  const [focalLength, setFocalLength] = useState(60) // mm, positive = converging

  // Dual lens params
  const [f1, setF1] = useState(80)
  const [f2, setF2] = useState(60)
  const [lensSep, setLensSep] = useState(150)  // separation between lenses

  // Mirror params
  const [mirrorFocal, setMirrorFocal] = useState(60)

  // Prism params
  const [prismAngle, setPrismAngle] = useState(60)
  const [prismN, setPrismN] = useState(1.5)
  const [incAngle, setIncAngle] = useState(45)

  // Ray count
  const [rayCount, setRayCount] = useState(5)

  // Scale: pixels per mm
  const SCALE = 1.8
  const SVG_W = 700
  const SVG_H = 380
  const AXIS_Y = 190  // optical axis y-position
  const LENS_X = 350  // lens x-position

  // ─── Thin Lens Computation ───
  const imageResult = useMemo(() => {
    if (expMode === 'mirror') {
      return computeMirrorImage(objDist, mirrorFocal, objHeight)
    }
    return computeThinLensImage(objDist, focalLength, objHeight)
  }, [expMode, objDist, focalLength, objHeight, mirrorFocal])

  // ─── Dual Lens Computation ───
  const dualLensResult = useMemo(() => {
    if (expMode !== 'dualLens') return null
    // First lens forms intermediate image
    const img1 = computeThinLensImage(objDist, f1, objHeight)
    if (img1.atInfinity) return { img1, img2: null }
    // Second lens: object distance = lensSep - img1.v
    const obj2Dist = lensSep - img1.v
    const img2 = computeThinLensImage(obj2Dist, f2, img1.imageHeight)
    return { img1, img2 }
  }, [expMode, objDist, f1, f2, lensSep, objHeight])

  // ─── Prism Computation ───
  const prismResult = useMemo(() => {
    if (expMode !== 'prism') return null
    const deviation = computePrismDeviation(prismAngle, prismN, incAngle)
    const minDev = computeMinDeviation(prismAngle, prismN)
    return { deviation, minDev, incidenceDeg: incAngle }
  }, [expMode, prismAngle, prismN, incAngle])

  // ─── SVG Coordinate Helpers ───
  const mmToX = (mmFromLens: number) => LENS_X + mmFromLens * SCALE
  const mmToY = (mmFromAxis: number) => AXIS_Y - mmFromAxis * SCALE

  // Object position
  const objX = LENS_X - objDist * SCALE
  const objTipY = AXIS_Y - objHeight * SCALE

  // ─── Ray Paths (thin lens) ───
  const principalRays = useMemo(() => {
    if (expMode !== 'thinLens') return []
    const rays: { points: [number, number][]; dashed: boolean; color: string }[] = []
    const f = focalLength
    const fX = mmToX(f)
    const fXneg = mmToX(-f)

    // Ray 1: Parallel to axis → through F'
    {
      const entry: [number, number] = [objX, objTipY]
      const atLens: [number, number] = [LENS_X, objTipY]
      let exitY = objTipY
      // After lens, ray goes through F'
      // Slope after lens: from (LENS_X, objTipY) toward F' at (fX, AXIS_Y)
      const slope = f !== 0 ? (AXIS_Y - objTipY) / (fX - LENS_X) : 0
      const farX = SVG_W + 50
      const farY = objTipY + slope * (farX - LENS_X)
      const exit: [number, number] = [farX, farY]

      rays.push({ points: [entry, atLens, exit], dashed: false, color: '#CC0000' })

      // Virtual extension (if image is virtual)
      if (imageResult.v < 0) {
        const vImgX = mmToX(imageResult.v)
        const vImgY = mmToY(imageResult.imageHeight)
        rays.push({ points: [atLens, [vImgX, vImgY]], dashed: true, color: '#CC0000' })
      }
    }

    // Ray 2: Through center of lens (undeviated)
    {
      const entry: [number, number] = [objX, objTipY]
      const slope = (AXIS_Y - objTipY) / (LENS_X - objX)
      const farX = SVG_W + 50
      const farY = objTipY + slope * (farX - objX)
      const exit: [number, number] = [farX, farY]
      rays.push({ points: [entry, exit], dashed: false, color: '#00AA44' })
    }

    // Ray 3: Through F → parallel after lens
    {
      const entry: [number, number] = [objX, objTipY]
      // Ray from object tip toward F on same side
      const slopeToF = f !== 0 ? (AXIS_Y - objTipY) / (fXneg - objX) : 0
      const atLensY = objTipY + slopeToF * (LENS_X - objX)
      const atLens: [number, number] = [LENS_X, atLensY]
      // After lens: parallel to axis
      const farX = SVG_W + 50
      const exit: [number, number] = [farX, atLensY]
      rays.push({ points: [entry, atLens, exit], dashed: false, color: '#4050B0' })
    }

    return rays
  }, [expMode, objDist, objHeight, focalLength, imageResult, objX, objTipY])

  // ─── Additional Parallel Rays ───
  const additionalRays = useMemo(() => {
    if (expMode !== 'thinLens' || rayCount <= 3) return []
    const rays: { points: [number, number][]; dashed: boolean; color: string }[] = []
    const f = focalLength
    const fX = mmToX(f)
    const nExtra = rayCount - 3
    const hRange = objHeight * 1.5

    for (let i = 0; i < nExtra; i++) {
      const frac = (i + 1) / (nExtra + 1)
      const h = -hRange + 2 * hRange * frac
      const y = AXIS_Y - h * SCALE
      const entry: [number, number] = [0, y]
      const atLens: [number, number] = [LENS_X, y]
      // After lens → through F'
      const slope = f !== 0 ? (AXIS_Y - y) / (fX - LENS_X) : 0
      const farY = y + slope * (SVG_W - LENS_X)
      const exit: [number, number] = [SVG_W, farY]
      rays.push({ points: [entry, atLens, exit], dashed: false, color: '#CC000080' })
    }
    return rays
  }, [expMode, rayCount, objHeight, focalLength])

  // ─── Mirror Rays ───
  const mirrorRays = useMemo(() => {
    if (expMode !== 'mirror') return []
    const rays: { points: [number, number][]; dashed: boolean; color: string }[] = []
    const f = mirrorFocal
    const fX = mmToX(-f) // focal point on same side as object for concave mirror

    // Ray 1: Parallel → through F
    {
      const entry: [number, number] = [objX, objTipY]
      const atMirror: [number, number] = [LENS_X, objTipY]
      // After reflection: through F at (fX, AXIS_Y)
      const slope = f !== 0 ? (AXIS_Y - objTipY) / (fX - LENS_X) : 0
      // Reflected ray goes to the left
      const farX = -50
      const farY = objTipY + slope * (farX - LENS_X)
      rays.push({ points: [entry, atMirror, [farX, farY]], dashed: false, color: '#CC0000' })
    }

    // Ray 2: Through center of curvature → back on itself
    {
      const entry: [number, number] = [objX, objTipY]
      const atMirror: [number, number] = [LENS_X, objTipY * 1.0] // simplified
      // Through C (=2F)
      const cX = mmToX(-2 * f)
      const slope = (AXIS_Y - objTipY) / (cX - objX)
      const hitY = objTipY + slope * (LENS_X - objX)
      const reflectedSlope = -slope // reflects back
      const farX = -50
      const farY = hitY + reflectedSlope * (farX - LENS_X)
      rays.push({ points: [entry, [LENS_X, hitY], [farX, farY]], dashed: false, color: '#00AA44' })
    }

    // Ray 3: Through F → parallel after reflection
    {
      const entry: [number, number] = [objX, objTipY]
      const slope = f !== 0 ? (AXIS_Y - objTipY) / (fX - objX) : 0
      const hitY = objTipY + slope * (LENS_X - objX)
      // After reflection: parallel to axis
      const farX = -50
      rays.push({ points: [entry, [LENS_X, hitY], [farX, hitY]], dashed: false, color: '#4050B0' })
    }

    return rays
  }, [expMode, objDist, objHeight, mirrorFocal, objX, objTipY])

  // ─── Prism Rays ───
  const prismSVG = useMemo(() => {
    if (expMode !== 'prism') return null
    const cx = 350
    const cy = 190
    const size = 80
    const A = (prismAngle * Math.PI) / 180
    const halfA = A / 2

    // Prism triangle vertices
    const topY = cy - size * Math.cos(halfA)
    const leftX = cx - size * Math.sin(halfA)
    const rightX = cx + size * Math.sin(halfA)
    const bottomY = cy + size * Math.cos(halfA) * 0.3

    return { cx, cy, size, A, topY, leftX, rightX, bottomY }
  }, [expMode, prismAngle])

  // ─── Image arrow position ───
  const imgX = !imageResult.atInfinity ? mmToX(imageResult.v) : SVG_W + 200
  const imgTipY = !imageResult.atInfinity ? mmToY(imageResult.imageHeight) : 0

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
          光线追迹与透镜成像
        </h1>
      </div>

      <div className="flex flex-1" style={{ minHeight: 0 }}>
        {/* Left: Visualization */}
        <div className="flex-1 dot-grid custom-scrollbar" style={{
          display: 'flex', flexDirection: 'column', padding: '16px', overflowY: 'auto',
          alignItems: 'center',
        }}>
          {/* Mode tabs */}
          <div style={{
            display: 'flex', gap: '2px', marginBottom: '16px',
            borderBottom: '1px solid #E8ECF0', paddingBottom: '8px', width: '100%',
            justifyContent: 'center',
          }}>
            {([
              ['thinLens', '薄透镜成像'],
              ['dualLens', '透镜组合'],
              ['mirror', '球面镜成像'],
              ['prism', '棱镜分光'],
            ] as [ExpMode, string][]).map(([key, label]) => (
              <button key={key} onClick={() => setExpMode(key)} style={{
                fontSize: '10px', padding: '4px 10px', borderRadius: '2px',
                border: `1px solid ${expMode === key ? '#333333' : '#D0D0D0'}`,
                backgroundColor: expMode === key ? '#F0F3F6' : '#FFFFFF',
                color: '#1A1A1A', cursor: 'pointer', fontFamily: FONT,
                transition: 'border-color 200ms ease-out, background-color 200ms ease-out',
              }}>
                {label}
              </button>
            ))}
          </div>

          {/* ─── Thin Lens SVG ─── */}
          {(expMode === 'thinLens' || expMode === 'mirror') && (
            <svg width={SVG_W} height={SVG_H} viewBox={`0 0 ${SVG_W} ${SVG_H}`}
              style={{ border: '1px solid #D0D0D0', backgroundColor: '#FFFFFF' }}>
              {/* Optical axis */}
              <line x1="0" y1={AXIS_Y} x2={SVG_W} y2={AXIS_Y}
                stroke="#888888" strokeWidth="0.6" strokeDasharray="8,3,2,3" />

              {/* Focal points */}
              {(() => {
                const f = expMode === 'mirror' ? -mirrorFocal : focalLength
                if (Math.abs(f) < 1) return null
                const f1x = mmToX(-f)
                const f2x = mmToX(f)
                return (
                  <g>
                    {/* F (object side) */}
                    {f1x > 10 && f1x < SVG_W - 10 && (
                      <g>
                        <circle cx={f1x} cy={AXIS_Y} r="3" fill="#555555" />
                        <text x={f1x} y={AXIS_Y + 16} textAnchor="middle" fontSize="9"
                          fill="#555555" fontFamily={FONT}>F</text>
                      </g>
                    )}
                    {/* F' (image side) */}
                    {f2x > 10 && f2x < SVG_W - 10 && (
                      <g>
                        <circle cx={f2x} cy={AXIS_Y} r="3" fill="#555555" />
                        <text x={f2x} y={AXIS_Y + 16} textAnchor="middle" fontSize="9"
                          fill="#555555" fontFamily={FONT}>F&apos;</text>
                      </g>
                    )}
                    {/* 2F points */}
                    {mmToX(-2 * f) > 10 && mmToX(-2 * f) < SVG_W - 10 && (
                      <g>
                        <rect x={mmToX(-2 * f) - 3} y={AXIS_Y - 3} width="6" height="6"
                          fill="none" stroke="#888888" strokeWidth="0.8" />
                        <text x={mmToX(-2 * f)} y={AXIS_Y + 16} textAnchor="middle" fontSize="8"
                          fill="#888888" fontFamily={FONT}>2F</text>
                      </g>
                    )}
                    {mmToX(2 * f) > 10 && mmToX(2 * f) < SVG_W - 10 && (
                      <g>
                        <rect x={mmToX(2 * f) - 3} y={AXIS_Y - 3} width="6" height="6"
                          fill="none" stroke="#888888" strokeWidth="0.8" />
                        <text x={mmToX(2 * f)} y={AXIS_Y + 16} textAnchor="middle" fontSize="8"
                          fill="#888888" fontFamily={FONT}>2F&apos;</text>
                      </g>
                    )}
                  </g>
                )
              })()}

              {/* Lens or Mirror */}
              {expMode === 'thinLens' ? (
                <g transform={`translate(${LENS_X}, ${AXIS_Y})`}>
                  {/* Converging lens symbol */}
                  {focalLength > 0 ? (
                    <g>
                      <path d={`M0,${-70} Q8,0 0,70`} fill="none" stroke="#333333" strokeWidth="1.5" />
                      <path d={`M0,${-70} Q-8,0 0,70`} fill="none" stroke="#333333" strokeWidth="1.5" />
                      {/* Arrowheads at top and bottom */}
                      <polygon points="-4,-66 0,-74 4,-66" fill="#333333" />
                      <polygon points="-4,66 0,74 4,66" fill="#333333" />
                    </g>
                  ) : (
                    <g>
                      <path d={`M0,${-70} Q-8,0 0,70`} fill="none" stroke="#333333" strokeWidth="1.5" />
                      <path d={`M0,${-70} Q8,0 0,70`} fill="none" stroke="#333333" strokeWidth="1.5" />
                      <polygon points="-4,-66 0,-74 4,-66" fill="none" stroke="#333333" strokeWidth="1" />
                      <polygon points="-4,66 0,74 4,66" fill="none" stroke="#333333" strokeWidth="1" />
                    </g>
                  )}
                  <text x="0" y="90" textAnchor="middle" fontSize="8" fill="#555555" fontFamily={FONT}>
                    {focalLength > 0 ? '凸透镜' : '凹透镜'}
                  </text>
                </g>
              ) : (
                /* Mirror symbol */
                <g transform={`translate(${LENS_X}, ${AXIS_Y})`}>
                  <line x1="0" y1={-70} x2="0" y2={70} stroke="#333333" strokeWidth="2.5" />
                  {/* Hatching on back side */}
                  {Array.from({ length: 12 }).map((_, i) => {
                    const y = -60 + i * 10
                    return <line key={i} x1="0" y1={y} x2="-8" y2={y + 8}
                      stroke="#888888" strokeWidth="0.6" />
                  })}
                  <text x="0" y="90" textAnchor="middle" fontSize="8" fill="#555555" fontFamily={FONT}>
                    {mirrorFocal > 0 ? '凹面镜' : '凸面镜'}
                  </text>
                </g>
              )}

              {/* Object arrow */}
              <g>
                <line x1={objX} y1={AXIS_Y} x2={objX} y2={objTipY}
                  stroke="#CC0000" strokeWidth="2" />
                <polygon points={`${objX - 4},${objTipY + 8} ${objX},${objTipY} ${objX + 4},${objTipY + 8}`}
                  fill="#CC0000" />
                <text x={objX} y={AXIS_Y + 16} textAnchor="middle" fontSize="8"
                  fill="#CC0000" fontFamily={FONT}>物</text>
              </g>

              {/* Image arrow */}
              {!imageResult.atInfinity && imgX > 10 && imgX < SVG_W - 10 && (
                <g>
                  <line x1={imgX} y1={AXIS_Y} x2={imgX} y2={imgTipY}
                    stroke={imageResult.isReal ? '#4050B0' : '#4050B0'}
                    strokeWidth="2"
                    strokeDasharray={imageResult.isReal ? 'none' : '4,3'} />
                  <polygon
                    points={`${imgX - 4},${imgTipY + (imageResult.isUpright ? 8 : -8)} ${imgX},${imgTipY} ${imgX + 4},${imgTipY + (imageResult.isUpright ? 8 : -8)}`}
                    fill={imageResult.isReal ? '#4050B0' : '#4050B0'}
                    fillOpacity={imageResult.isReal ? 1 : 0.5} />
                  <text x={imgX} y={AXIS_Y + 16} textAnchor="middle" fontSize="8"
                    fill="#4050B0" fontFamily={FONT}>{imageResult.isReal ? '实像' : '虚像'}</text>
                </g>
              )}

              {/* At-infinity indicator */}
              {imageResult.atInfinity && (
                <text x={SVG_W - 60} y={AXIS_Y - 20} textAnchor="middle" fontSize="10"
                  fill="#CC0000" fontFamily={FONT}>→ ∞</text>
              )}

              {/* Principal rays */}
              {(expMode === 'thinLens' ? principalRays : mirrorRays).map((ray, idx) => (
                <polyline key={idx}
                  points={ray.points.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')}
                  fill="none" stroke={ray.color}
                  strokeWidth={ray.dashed ? '1' : '1.5'}
                  strokeDasharray={ray.dashed ? '5,3' : 'none'}
                  opacity={ray.dashed ? 0.4 : 0.8}
                />
              ))}

              {/* Additional parallel rays */}
              {additionalRays.map((ray, idx) => (
                <polyline key={`extra-${idx}`}
                  points={ray.points.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')}
                  fill="none" stroke={ray.color}
                  strokeWidth="0.8" opacity="0.3"
                />
              ))}

              {/* Distance labels */}
              <g>
                <text x={(objX + LENS_X) / 2} y={AXIS_Y + 35} textAnchor="middle" fontSize="8"
                  fill="#888888" fontFamily={FONT} className="tabular-nums">
                  u = {objDist}mm
                </text>
                {!imageResult.atInfinity && imgX > 10 && imgX < SVG_W - 10 && (
                  <text x={(LENS_X + imgX) / 2} y={AXIS_Y + 35} textAnchor="middle" fontSize="8"
                    fill="#888888" fontFamily={FONT} className="tabular-nums">
                    v = {imageResult.atInfinity ? '∞' : `${imageResult.v.toFixed(1)}mm`}
                  </text>
                )}
              </g>
            </svg>
          )}

          {/* ─── Dual Lens SVG ─── */}
          {expMode === 'dualLens' && dualLensResult && (
            <svg width={SVG_W} height={SVG_H} viewBox={`0 0 ${SVG_W} ${SVG_H}`}
              style={{ border: '1px solid #D0D0D0', backgroundColor: '#FFFFFF' }}>
              <line x1="0" y1={AXIS_Y} x2={SVG_W} y2={AXIS_Y}
                stroke="#888888" strokeWidth="0.6" strokeDasharray="8,3,2,3" />

              {/* Lens 1 */}
              <g transform={`translate(${LENS_X}, ${AXIS_Y})`}>
                {f1 > 0 ? (
                  <g>
                    <path d={`M0,${-50} Q6,0 0,50`} fill="none" stroke="#333333" strokeWidth="1.2" />
                    <path d={`M0,${-50} Q-6,0 0,50`} fill="none" stroke="#333333" strokeWidth="1.2" />
                    <polygon points="-3,-46 0,-52 3,-46" fill="#333333" />
                    <polygon points="-3,46 0,52 3,46" fill="#333333" />
                  </g>
                ) : (
                  <g>
                    <path d={`M0,${-50} Q-6,0 0,50`} fill="none" stroke="#333333" strokeWidth="1.2" />
                    <path d={`M0,${-50} Q6,0 0,50`} fill="none" stroke="#333333" strokeWidth="1.2" />
                  </g>
                )}
                <text x="0" y="65" textAnchor="middle" fontSize="8" fill="#555555" fontFamily={FONT}>L₁</text>
              </g>

              {/* Lens 2 */}
              {(() => {
                const l2x = LENS_X + lensSep * SCALE
                return l2x < SVG_W - 20 ? (
                  <g transform={`translate(${l2x}, ${AXIS_Y})`}>
                    {f2 > 0 ? (
                      <g>
                        <path d={`M0,${-50} Q6,0 0,50`} fill="none" stroke="#333333" strokeWidth="1.2" />
                        <path d={`M0,${-50} Q-6,0 0,50`} fill="none" stroke="#333333" strokeWidth="1.2" />
                        <polygon points="-3,-46 0,-52 3,-46" fill="#333333" />
                        <polygon points="-3,46 0,52 3,46" fill="#333333" />
                      </g>
                    ) : (
                      <g>
                        <path d={`M0,${-50} Q-6,0 0,50`} fill="none" stroke="#333333" strokeWidth="1.2" />
                        <path d={`M0,${-50} Q6,0 0,50`} fill="none" stroke="#333333" strokeWidth="1.2" />
                      </g>
                    )}
                    <text x="0" y="65" textAnchor="middle" fontSize="8" fill="#555555" fontFamily={FONT}>L₂</text>
                  </g>
                ) : null
              })()}

              {/* Object */}
              <g>
                <line x1={objX} y1={AXIS_Y} x2={objX} y2={objTipY} stroke="#CC0000" strokeWidth="2" />
                <polygon points={`${objX - 4},${objTipY + 8} ${objX},${objTipY} ${objX + 4},${objTipY + 8}`} fill="#CC0000" />
                <text x={objX} y={AXIS_Y + 16} textAnchor="middle" fontSize="8" fill="#CC0000" fontFamily={FONT}>物</text>
              </g>

              {/* Intermediate image (if real) */}
              {dualLensResult.img1 && !dualLensResult.img1.atInfinity && (() => {
                const ix = mmToX(dualLensResult.img1.v)
                const iy = mmToY(dualLensResult.img1.imageHeight)
                return ix > 10 && ix < SVG_W - 10 ? (
                  <g>
                    <line x1={ix} y1={AXIS_Y} x2={ix} y2={iy}
                      stroke="#888888" strokeWidth="1.5" strokeDasharray="4,3" />
                    <text x={ix} y={AXIS_Y + 16} textAnchor="middle" fontSize="7"
                      fill="#888888" fontFamily={FONT}>中间像</text>
                  </g>
                ) : null
              })()}

              {/* Final image */}
              {dualLensResult.img2 && !dualLensResult.img2.atInfinity && (() => {
                const fx = mmToX(lensSep + dualLensResult.img2.v)
                const fy = mmToY(dualLensResult.img2.imageHeight)
                return fx > 10 && fx < SVG_W - 10 ? (
                  <g>
                    <line x1={fx} y1={AXIS_Y} x2={fx} y2={fy}
                      stroke="#4050B0" strokeWidth="2" />
                    <polygon points={`${fx - 4},${fy + 8} ${fx},${fy} ${fx + 4},${fy + 8}`} fill="#4050B0" />
                    <text x={fx} y={AXIS_Y + 16} textAnchor="middle" fontSize="8"
                      fill="#4050B0" fontFamily={FONT}>像</text>
                  </g>
                ) : null
              })()}

              {/* Separation label */}
              <text x={LENS_X + (lensSep * SCALE) / 2} y={AXIS_Y + 45} textAnchor="middle"
                fontSize="8" fill="#888888" fontFamily={FONT} className="tabular-nums">
                d = {lensSep}mm
              </text>
            </svg>
          )}

          {/* ─── Prism SVG ─── */}
          {expMode === 'prism' && prismSVG && prismResult && (() => {
            const { cx, cy, size, A, topY, leftX, rightX, bottomY } = prismSVG
            const halfA = A / 2

            // Incident ray
            const incRad = (incAngle * Math.PI) / 180
            // Refracted ray inside prism
            const r1 = snellAngle(1, prismN, incRad)
            const r2Rad = r1 !== null ? A - r1 : 0
            const i2 = r1 !== null ? snellAngle(prismN, 1, r2Rad) : null
            const devRad = prismResult.deviation.totalInternalReflection ? 0 : prismResult.deviation.deviation

            return (
              <svg width={SVG_W} height={SVG_H} viewBox={`0 0 ${SVG_W} ${SVG_H}`}
                style={{ border: '1px solid #D0D0D0', backgroundColor: '#FFFFFF' }}>
                {/* Prism triangle */}
                <polygon
                  points={`${cx},${topY} ${leftX},${bottomY} ${rightX},${bottomY}`}
                  fill="#E8F4FF" fillOpacity="0.3" stroke="#333333" strokeWidth="1.5" />

                {/* Incident ray */}
                {(() => {
                  // Hit point on left face
                  const hitX = cx - size * Math.sin(halfA) * 0.6
                  const hitY = cy - size * Math.cos(halfA) * 0.3
                  const startX = hitX - 120 * Math.cos(incRad - halfA)
                  const startY = hitY - 120 * Math.sin(incRad - halfA)
                  return (
                    <line x1={startX} y1={startY} x2={hitX} y2={hitY}
                      stroke="#CC0000" strokeWidth="2" />
                  )
                })()}

                {/* Internal ray (if no TIR) */}
                {!prismResult.deviation.totalInternalReflection && r1 !== null && (() => {
                  const hitX = cx - size * Math.sin(halfA) * 0.6
                  const hitY = cy - size * Math.cos(halfA) * 0.3
                  // Internal direction
                  const exitX = cx + size * Math.sin(halfA) * 0.6
                  const exitY = hitY + (exitX - hitX) * Math.tan(r1 - halfA + A / 2)
                  return (
                    <g>
                      <line x1={hitX} y1={hitY} x2={exitX} y2={exitY}
                        stroke="#CC0000" strokeWidth="1.5" strokeDasharray="4,2" />
                      {/* Exit ray */}
                      {i2 !== null && (() => {
                        const exitAngle = i2 - halfA + devRad
                        const farX = exitX + 150
                        const farY = exitY + 150 * Math.tan(exitAngle)
                        return (
                          <line x1={exitX} y1={exitY} x2={farX} y2={farY}
                            stroke="#CC0000" strokeWidth="2" />
                        )
                      })()}
                    </g>
                  )
                })()}

                {/* TIR indicator */}
                {prismResult.deviation.totalInternalReflection && (
                  <text x={cx} y={cy + 60} textAnchor="middle" fontSize="11"
                    fill="#CC0000" fontFamily={FONT}>全内反射</text>
                )}

                {/* Dispersion rays (colored) */}
                {!prismResult.deviation.totalInternalReflection && (() => {
                  const colors = [
                    { nm: 656, color: '#CC0000', n: prismN - 0.008 },
                    { nm: 589, color: '#DD8800', n: prismN - 0.003 },
                    { nm: 550, color: '#00AA44', n: prismN },
                    { nm: 486, color: '#3355BB', n: prismN + 0.006 },
                    { nm: 434, color: '#4050B0', n: prismN + 0.012 },
                  ]
                  return colors.map((c, idx) => {
                    const dev = computePrismDeviation(prismAngle, c.n, incAngle)
                    if (dev.totalInternalReflection) return null
                    const hitX = cx - size * Math.sin(halfA) * 0.6
                    const hitY = cy - size * Math.cos(halfA) * 0.3
                    const exitX = cx + size * Math.sin(halfA) * 0.6
                    const baseY = hitY + (exitX - hitX) * 0.2
                    const exitAngle = (dev.deviation * 180 / Math.PI)
                    const farX = exitX + 140
                    const farY = baseY + 140 * Math.tan((exitAngle - 30) * Math.PI / 180)
                    return (
                      <line key={idx} x1={exitX} y1={baseY} x2={farX} y2={farY}
                        stroke={c.color} strokeWidth="1.5" opacity="0.6" />
                    )
                  })
                })()}

                {/* Normal lines */}
                <line x1={cx - size * Math.sin(halfA) * 0.6 - 20} y1={cy - size * Math.cos(halfA) * 0.3 - 20}
                  x2={cx - size * Math.sin(halfA) * 0.6 + 20} y2={cy - size * Math.cos(halfA) * 0.3 + 20}
                  stroke="#888888" strokeWidth="0.5" strokeDasharray="3,3" />

                {/* Apex angle label */}
                <text x={cx} y={topY + 20} textAnchor="middle" fontSize="9"
                  fill="#555555" fontFamily={FONT} className="tabular-nums">
                  A = {prismAngle}°
                </text>

                {/* Info */}
                <text x={cx} y={SVG_H - 20} textAnchor="middle" fontSize="9"
                  fill="#555555" fontFamily={FONT}>
                  {prismResult.deviation.totalInternalReflection
                    ? '全内反射 - 入射角过大'
                    : `偏向角 δ = ${(prismResult.deviation.deviation * 180 / Math.PI).toFixed(1)}° | 最小偏向角 δmin = ${(prismResult.minDev * 180 / Math.PI).toFixed(1)}°`
                  }
                </text>

                {/* Angle labels */}
                <text x={80} y={30} fontSize="9" fill="#555555" fontFamily={FONT}>
                  入射角 i = {incAngle}°
                </text>
                <text x={80} y={44} fontSize="9" fill="#555555" fontFamily={FONT}>
                  折射率 n = {prismN.toFixed(3)}
                </text>
              </svg>
            )
          })()}

          {/* ─── Readout Panel ─── */}
          <div style={{ display: 'flex', gap: '16px', marginTop: '16px', flexWrap: 'wrap', justifyContent: 'center' }}>
            {expMode !== 'prism' ? (
              <>
                <ReadoutBox label="物距 u" value={`${objDist} mm`} color="#CC0000" />
                <ReadoutBox label="像距 v" value={imageResult.atInfinity ? '∞' : `${imageResult.v.toFixed(1)} mm`} color="#4050B0" />
                <ReadoutBox label="放大率 m" value={imageResult.atInfinity ? '∞' : `${imageResult.magnification.toFixed(3)}×`} color="#333333" />
                <ReadoutBox label="像的性质" value={
                  imageResult.atInfinity ? '像在无穷远' :
                  `${imageResult.isReal ? '实像' : '虚像'}·${imageResult.isUpright ? '正立' : '倒立'}·${Math.abs(imageResult.magnification) > 1.02 ? '放大' : Math.abs(imageResult.magnification) < 0.98 ? '缩小' : '等大'}`
                } color="#555555" />
                <ReadoutBox label="焦距 f" value={`${expMode === 'mirror' ? mirrorFocal : focalLength} mm`} color="#00AA44" />
              </>
            ) : prismResult ? (
              <>
                <ReadoutBox label="偏向角 δ" value={prismResult.deviation.totalInternalReflection ? '全内反射' : `${(prismResult.deviation.deviation * 180 / Math.PI).toFixed(1)}°`} color="#CC0000" />
                <ReadoutBox label="最小偏向角" value={`${(prismResult.minDev * 180 / Math.PI).toFixed(1)}°`} color="#00AA44" />
                <ReadoutBox label="折射率 n" value={prismN.toFixed(3)} color="#4050B0" />
                <ReadoutBox label="顶角 A" value={`${prismAngle}°`} color="#555555" />
              </>
            ) : null}
          </div>

          {/* Formula card */}
          <div style={{
            marginTop: '12px', padding: '8px 16px', border: '1px solid #E8ECF0',
            borderRadius: '2px', backgroundColor: '#FAFAFA', fontSize: '10px',
            fontFamily: FONT, color: '#555555', lineHeight: '1.8',
          }}>
            {expMode === 'thinLens' && (
              <>
                <div>薄透镜公式: <span className="tabular-nums" style={{ fontWeight: 600, color: '#1A1A1A' }}>1/v - 1/u = 1/f</span></div>
                <div>1/{imageResult.atInfinity ? '∞' : imageResult.v.toFixed(1)} - 1/(-{objDist}) = 1/{focalLength}</div>
                <div>放大率: m = v/u = {imageResult.atInfinity ? '∞' : imageResult.magnification.toFixed(3)}</div>
              </>
            )}
            {expMode === 'dualLens' && (
              <>
                <div>组合透镜: 逐次成像法</div>
                <div>L₁: 1/v₁ = 1/f₁ + 1/u₁ → v₁ = {dualLensResult.img1?.atInfinity ? '∞' : dualLensResult.img1?.v.toFixed(1)}</div>
                <div>L₂: u₂ = d - v₁ = {lensSep} - {dualLensResult.img1?.v.toFixed(1)} = {(lensSep - (dualLensResult.img1?.v || 0)).toFixed(1)}</div>
              </>
            )}
            {expMode === 'mirror' && (
              <>
                <div>球面镜公式: <span className="tabular-nums" style={{ fontWeight: 600, color: '#1A1A1A' }}>1/v + 1/u = 1/f = 2/R</span></div>
                <div>凹面镜 f &gt; 0, 凸面镜 f &lt; 0</div>
              </>
            )}
            {expMode === 'prism' && (
              <>
                <div>棱镜公式: <span style={{ fontWeight: 600, color: '#1A1A1A' }}>n = sin((A+δmin)/2) / sin(A/2)</span></div>
                <div>偏向角: δ = i₁ + i₂ - A</div>
                <div>最小偏向角时: i₁ = i₂, r₁ = r₂ = A/2</div>
              </>
            )}
          </div>
        </div>

        {/* Right: Control Panel */}
        <div className="custom-scrollbar" style={{
          width: '280px', flexShrink: 0, backgroundColor: '#FAFAFA',
          borderLeft: '1px solid #D0D0D0', overflowY: 'auto', padding: '16px',
        }}>
          {/* Object Distance */}
          <SectionTitle>物距</SectionTitle>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <input type="range" min="10" max="300" step="1" value={objDist}
              onChange={e => setObjDist(Number(e.target.value))}
              style={{ flex: 1, accentColor: '#333333' }}
            />
            <span className="tabular-nums" style={{ fontSize: '12px', fontWeight: 600, color: '#1A1A1A', fontFamily: FONT, minWidth: '52px' }}>
              {objDist}mm
            </span>
          </div>
          <div style={{ fontSize: '7px', color: '#888888', fontFamily: FONT, display: 'flex', justifyContent: 'space-between' }}>
            <span>10mm</span>
            <span>f={expMode === 'mirror' ? mirrorFocal : focalLength}mm</span>
            <span>300mm</span>
          </div>

          {/* Object Height */}
          <SectionTitle>物高</SectionTitle>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <input type="range" min="5" max="50" step="1" value={objHeight}
              onChange={e => setObjHeight(Number(e.target.value))}
              style={{ flex: 1, accentColor: '#333333' }}
            />
            <span className="tabular-nums" style={{ fontSize: '12px', fontWeight: 600, color: '#1A1A1A', fontFamily: FONT, minWidth: '44px' }}>
              {objHeight}mm
            </span>
          </div>

          {/* Focal Length (thin lens / mirror) */}
          {(expMode === 'thinLens' || expMode === 'mirror') && (
            <>
              <SectionTitle>{expMode === 'mirror' ? '焦距 (凹面镜+)' : '焦距 (凸透镜+)'}</SectionTitle>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <input type="range"
                  min={expMode === 'mirror' ? -200 : -200}
                  max="200" step="1"
                  value={expMode === 'mirror' ? mirrorFocal : focalLength}
                  onChange={e => {
                    const v = Number(e.target.value)
                    if (expMode === 'mirror') setMirrorFocal(v)
                    else setFocalLength(v)
                  }}
                  style={{ flex: 1, accentColor: '#333333' }}
                />
                <span className="tabular-nums" style={{ fontSize: '12px', fontWeight: 600, color: '#1A1A1A', fontFamily: FONT, minWidth: '52px' }}>
                  {expMode === 'mirror' ? mirrorFocal : focalLength}mm
                </span>
              </div>
              <div style={{ fontSize: '9px', color: '#888888', fontFamily: FONT, lineHeight: '1.5' }}>
                {expMode === 'thinLens'
                  ? '正=凸透镜(会聚), 负=凹透镜(发散)'
                  : '正=凹面镜(会聚), 负=凸面镜(发散)'}
              </div>
            </>
          )}

          {/* Dual Lens Controls */}
          {expMode === 'dualLens' && (
            <>
              <SectionTitle>透镜L₁</SectionTitle>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <input type="range" min="-200" max="200" step="1" value={f1}
                  onChange={e => setF1(Number(e.target.value))}
                  style={{ flex: 1, accentColor: '#333333' }}
                />
                <span className="tabular-nums" style={{ fontSize: '11px', fontWeight: 600, color: '#1A1A1A', fontFamily: FONT, minWidth: '48px' }}>
                  f₁={f1}mm
                </span>
              </div>

              <SectionTitle>透镜L₂</SectionTitle>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <input type="range" min="-200" max="200" step="1" value={f2}
                  onChange={e => setF2(Number(e.target.value))}
                  style={{ flex: 1, accentColor: '#333333' }}
                />
                <span className="tabular-nums" style={{ fontSize: '11px', fontWeight: 600, color: '#1A1A1A', fontFamily: FONT, minWidth: '48px' }}>
                  f₂={f2}mm
                </span>
              </div>

              <SectionTitle>透镜间距</SectionTitle>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <input type="range" min="20" max="300" step="1" value={lensSep}
                  onChange={e => setLensSep(Number(e.target.value))}
                  style={{ flex: 1, accentColor: '#333333' }}
                />
                <span className="tabular-nums" style={{ fontSize: '11px', fontWeight: 600, color: '#1A1A1A', fontFamily: FONT, minWidth: '44px' }}>
                  {lensSep}mm
                </span>
              </div>
            </>
          )}

          {/* Prism Controls */}
          {expMode === 'prism' && (
            <>
              <SectionTitle>棱镜顶角</SectionTitle>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <input type="range" min="10" max="90" step="1" value={prismAngle}
                  onChange={e => setPrismAngle(Number(e.target.value))}
                  style={{ flex: 1, accentColor: '#333333' }}
                />
                <span className="tabular-nums" style={{ fontSize: '12px', fontWeight: 600, color: '#1A1A1A', fontFamily: FONT, minWidth: '36px' }}>
                  {prismAngle}°
                </span>
              </div>

              <SectionTitle>折射率</SectionTitle>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <input type="range" min="1.3" max="2.0" step="0.01" value={prismN}
                  onChange={e => setPrismN(Number(e.target.value))}
                  style={{ flex: 1, accentColor: '#333333' }}
                />
                <span className="tabular-nums" style={{ fontSize: '12px', fontWeight: 600, color: '#1A1A1A', fontFamily: FONT, minWidth: '36px' }}>
                  {prismN.toFixed(2)}
                </span>
              </div>

              <SectionTitle>入射角</SectionTitle>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <input type="range" min="0" max="89" step="1" value={incAngle}
                  onChange={e => setIncAngle(Number(e.target.value))}
                  style={{ flex: 1, accentColor: '#333333' }}
                />
                <span className="tabular-nums" style={{ fontSize: '12px', fontWeight: 600, color: '#1A1A1A', fontFamily: FONT, minWidth: '36px' }}>
                  {incAngle}°
                </span>
              </div>
            </>
          )}

          {/* Ray Count */}
          {expMode === 'thinLens' && (
            <>
              <SectionTitle>光线数量</SectionTitle>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <input type="range" min="3" max="15" step="1" value={rayCount}
                  onChange={e => setRayCount(Number(e.target.value))}
                  style={{ flex: 1, accentColor: '#333333' }}
                />
                <span className="tabular-nums" style={{ fontSize: '12px', fontWeight: 600, color: '#1A1A1A', fontFamily: FONT, minWidth: '24px' }}>
                  {rayCount}
                </span>
              </div>
            </>
          )}

          {/* Quick presets */}
          <SectionTitle>快速设置</SectionTitle>
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            {expMode === 'thinLens' && [
              { label: '物在2F', u: focalLength * 2, f: focalLength },
              { label: '物在F', u: focalLength, f: focalLength },
              { label: '物在F内', u: Math.round(focalLength * 0.5), f: focalLength },
              { label: '凹透镜', u: 120, f: -60 },
            ].map(p => (
              <button key={p.label} onClick={() => { setObjDist(p.u); setFocalLength(p.f) }} style={{
                fontSize: '9px', padding: '3px 8px', borderRadius: '2px',
                border: '1px solid #D0D0D0', backgroundColor: '#FFFFFF',
                color: '#1A1A1A', cursor: 'pointer', fontFamily: FONT,
              }}>
                {p.label}
              </button>
            ))}
            {expMode === 'prism' && [
              { label: '等边棱镜', a: 60, n: 1.5 },
              { label: '高折射率', a: 60, n: 1.8 },
              { label: '小顶角', a: 30, n: 1.5 },
            ].map(p => (
              <button key={p.label} onClick={() => { setPrismAngle(p.a); setPrismN(p.n) }} style={{
                fontSize: '9px', padding: '3px 8px', borderRadius: '2px',
                border: '1px solid #D0D0D0', backgroundColor: '#FFFFFF',
                color: '#1A1A1A', cursor: 'pointer', fontFamily: FONT,
              }}>
                {p.label}
              </button>
            ))}
          </div>

          {/* Explanation */}
          <SectionTitle>原理说明</SectionTitle>
          <div style={{ fontSize: '9px', color: '#888888', fontFamily: FONT, lineHeight: '1.7' }}>
            {expMode === 'thinLens' && (
              <>
                <div>• 1/v - 1/u = 1/f（薄透镜公式）</div>
                <div>• u &gt; 2f: 缩小倒立实像</div>
                <div>• u = 2f: 等大倒立实像(m=-1)</div>
                <div>• f &lt; u &lt; 2f: 放大倒立实像</div>
                <div>• u = f: 像在无穷远</div>
                <div>• u &lt; f: 放大正立虚像</div>
                <div>• 三条主光线:</div>
                <div style={{ color: '#CC0000' }}>  红: 平行光线→过F&apos;</div>
                <div style={{ color: '#00AA44' }}>  绿: 过光心光线→直进</div>
                <div style={{ color: '#4050B0' }}>  蓝: 过F光线→平行出射</div>
              </>
            )}
            {expMode === 'dualLens' && (
              <>
                <div>• 逐次成像法：分别对L₁和L₂成像</div>
                <div>• L₁的像作为L₂的物</div>
                <div>• 组合焦距: 1/f = 1/f₁ + 1/f₂ - d/(f₁f₂)</div>
              </>
            )}
            {expMode === 'mirror' && (
              <>
                <div>• 1/v + 1/u = 1/f = 2/R</div>
                <div>• 凹面镜: f &gt; 0, 实焦点</div>
                <div>• 凸面镜: f &lt; 0, 虚焦点</div>
                <div>• 凹面镜可成实像或虚像</div>
                <div>• 凸面镜只能成缩小正立虚像</div>
              </>
            )}
            {expMode === 'prism' && (
              <>
                <div>• Snell定律: n₁sinθ₁ = n₂sinθ₂</div>
                <div>• 偏向角: δ = i₁ + i₂ - A</div>
                <div>• 最小偏向角: δmin时i₁=i₂</div>
                <div>• n = sin((A+δmin)/2) / sin(A/2)</div>
                <div>• 色散: 不同波长折射率不同</div>
                <div>• 短波长(蓝)折射率更大</div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 flex items-center mt-auto" style={{
        height: '24px', backgroundColor: '#FFFFFF',
        borderTop: '1px solid #CCCCCC', paddingLeft: '24px',
      }}>
        <span className="tabular-nums" style={{ fontFamily: FONT, fontSize: '10px', color: '#888888' }}>
          v1.0 · 几何光学 · 薄透镜成像 · 球面镜 · 棱镜分光
        </span>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════
   SUB-COMPONENTS
   ═══════════════════════════════════════════════ */

function ReadoutBox({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{
      padding: '8px 12px', border: '1px solid #D0D0D0', borderRadius: '2px',
      backgroundColor: '#FAFAFA', textAlign: 'center', minWidth: '100px',
    }}>
      <div style={{ fontSize: '9px', color: '#888888', fontFamily: FONT }}>{label}</div>
      <div className="tabular-nums" style={{ fontSize: '14px', fontWeight: 600, color, fontFamily: FONT }}>
        {value}
      </div>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: '12px', fontWeight: 600, color: '#1A1A1A',
      fontFamily: FONT, marginBottom: '8px', paddingBottom: '6px',
      borderBottom: '1px solid #E8ECF0', marginTop: '14px',
    }}>
      {children}
    </div>
  )
}
