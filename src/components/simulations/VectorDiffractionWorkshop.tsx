'use client'

import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Line, Text } from '@react-three/drei'
import * as THREE from 'three'
import { Slider } from '@/components/ui/slider'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import {
  generateAperture,
  generateComplementaryAperture,
  computeAngularSpectrum,
  computeVectorDiffraction,
  computeFraunhoferDiffraction,
  generateTwoPointAperture,
  generateFourierHologram,
  intensityToGrayscale,
  intensityToBlueWhite,
  intensityToWavelengthColor,
  wavelengthToRGB,
  computeFresnelNumber,
  classifyRegion,
  computeAiryDiskRadius,
  computeGratingOrders,
  computeAngularDispersion,
  computeResolvingPower,
  fftshift2d,
  type ApertureType,
  type ApertureParams,
  type VectorDiffractionResult,
} from '@/lib/optics/diffraction'

/* ═══════════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════════ */

const FONT = 'var(--font-ibm-plex-sans), system-ui, sans-serif'
const GRID_SIZE = 256
const SURFACE_SIZE = 80

type ExperimentMode = 'basic' | 'babinet' | 'grating_spectrometer' | 'rayleigh' | 'hologram'
type ColorMode = 'wavelength' | 'grayscale' | 'inverted' | 'blue-white'
type ApertureMode = 'circular' | 'rectangular' | 'single_slit' | 'double_slit' | 'grating' | 'annular' | 'triangle' | 'polygon'

const APERTURE_LABELS: Record<ApertureMode, string> = {
  circular: '圆孔',
  rectangular: '方孔',
  single_slit: '单缝',
  double_slit: '双缝',
  grating: '光栅',
  annular: '环形',
  triangle: '三角形',
  polygon: '手绘',
}

const MODE_LABELS: Record<ExperimentMode, string> = {
  basic: '基本衍射',
  babinet: '巴比涅原理',
  grating_spectrometer: '光栅光谱仪',
  rayleigh: '衍射极限',
  hologram: '全息再现',
}

const MODE_DESCRIPTIONS: Record<ExperimentMode, string> = {
  basic: '角谱衍射理论 + 矢量衍射，观察Ex/Ey/Ez分量',
  babinet: '互补屏衍射验证：圆孔 vs 圆盘，轴外强度相同',
  grating_spectrometer: '多缝光栅，改变缝数/间距/波长，角色散与分辨率',
  rayleigh: '两点源成像，调节间距至瑞利判据',
  hologram: '计算全息图光学再现，观察重建像',
}

// Wavelength presets (nm)
const WAVELENGTH_PRESETS = [
  { label: 'He-Ne 632.8nm', value: 632.8 },
  { label: 'Na D 589.3nm', value: 589.3 },
  { label: 'Nd:YAG 532nm', value: 532 },
  { label: 'Ar⁺ 488nm', value: 488 },
  { label: 'GaN 405nm', value: 405 },
]

/* ═══════════════════════════════════════════════
   Section Title Component
   ═══════════════════════════════════════════════ */

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 style={{
      fontSize: '10px', fontWeight: 600, color: '#6b7280',
      fontFamily: 'var(--font-ibm-plex-mono)',
      textTransform: 'uppercase', letterSpacing: '0.05em',
      margin: '12px 0 6px 0',
      borderTop: '1px solid #E8ECF0', paddingTop: '8px',
    }}>
      {children}
    </h3>
  )
}

/* ═══════════════════════════════════════════════
   3D Diffraction Surface
   ═══════════════════════════════════════════════ */

function DiffractionSurface3D({
  intensity,
  gridSize,
  wavelengthNm,
  heightScale,
}: {
  intensity: Float64Array
  gridSize: number
  wavelengthNm: number
  heightScale: number
}) {
  const { geometry, wireframeGeo } = useMemo(() => {
    const S = SURFACE_SIZE
    const vertexCount = S * S
    const indexCount = (S - 1) * (S - 1) * 6
    const positions = new Float32Array(vertexCount * 3)
    const colors = new Float32Array(vertexCount * 3)
    const indices = new Uint32Array(indexCount)
    const step = gridSize / S
    const baseColor = wavelengthToRGB(wavelengthNm)

    for (let j = 0; j < S; j++) {
      for (let i = 0; i < S; i++) {
        const idx = j * S + i
        const srcX = Math.min(Math.floor(i * step), gridSize - 1)
        const srcY = Math.min(Math.floor(j * step), gridSize - 1)
        const rawVal = intensity[srcY * gridSize + srcX]
        const linearVal = Math.max(0, Math.min(1, rawVal))
        const gammaVal = Math.pow(linearVal, 0.4)

        positions[idx * 3] = (i / (S - 1) - 0.5) * 4
        positions[idx * 3 + 1] = linearVal * heightScale
        positions[idx * 3 + 2] = (j / (S - 1) - 0.5) * 4

        // Wavelength-accurate monochrome color
        colors[idx * 3] = (baseColor.r / 255) * gammaVal
        colors[idx * 3 + 1] = (baseColor.g / 255) * gammaVal
        colors[idx * 3 + 2] = (baseColor.b / 255) * gammaVal
      }
    }

    let idxPtr = 0
    for (let j = 0; j < S - 1; j++) {
      for (let i = 0; i < S - 1; i++) {
        const a = j * S + i
        const b = a + 1
        const c = a + S
        const d = c + 1
        indices[idxPtr++] = a; indices[idxPtr++] = c; indices[idxPtr++] = b
        indices[idxPtr++] = b; indices[idxPtr++] = c; indices[idxPtr++] = d
      }
    }

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geo.setIndex(new THREE.BufferAttribute(indices, 1))
    geo.computeVertexNormals()

    const wGeo = new THREE.WireframeGeometry(geo)
    return { geometry: geo, wireframeGeo: wGeo }
  }, [intensity, gridSize, wavelengthNm, heightScale])

  return (
    <group>
      <mesh geometry={geometry}>
        <meshStandardMaterial vertexColors side={THREE.DoubleSide} roughness={0.6} metalness={0.1} />
      </mesh>
      <lineSegments geometry={wireframeGeo}>
        <lineBasicMaterial color="#2d3142" transparent opacity={0.06} />
      </lineSegments>
      {/* Base plane */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.005, 0]}>
        <planeGeometry args={[4, 4]} />
        <meshBasicMaterial color="#f8f9fb" transparent opacity={0.5} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

/* ═══════════════════════════════════════════════
   3D Axis Labels
   ═══════════════════════════════════════════════ */

function AxisLabels({ heightScale }: { heightScale: number }) {
  return (
    <group>
      <Line points={[new THREE.Vector3(-2.2, 0, 0), new THREE.Vector3(2.2, 0, 0)]} color="#9ca3af" lineWidth={0.8} />
      <Line points={[new THREE.Vector3(0, 0, -2.2), new THREE.Vector3(0, 0, 2.2)]} color="#9ca3af" lineWidth={0.8} />
      <Line points={[new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, heightScale + 0.3, 0)]} color="#9ca3af" lineWidth={0.8} />
      {[0.25, 0.5, 0.75, 1.0].map(v => {
        const y = v * heightScale
        if (y > heightScale + 0.1) return null
        return (
          <group key={`ytick-${v}`}>
            <Line points={[new THREE.Vector3(-0.08, y, 0), new THREE.Vector3(0.08, y, 0)]} color="#9ca3af" lineWidth={0.5} />
            <Text position={[-0.15, y, 0]} fontSize={0.07} color="#9ca3af" anchorX="right" anchorY="middle">
              {v.toFixed(2)}
            </Text>
          </group>
        )
      })}
      <Text position={[2.4, -0.1, 0]} fontSize={0.1} color="#4a4a5a" anchorX="center">x</Text>
      <Text position={[0.1, -0.1, 2.4]} fontSize={0.1} color="#4a4a5a" anchorX="left">y</Text>
      <Text position={[-0.2, heightScale + 0.35, 0]} fontSize={0.1} color="#cc0000" anchorX="center">I/I₀</Text>
    </group>
  )
}

/* ═══════════════════════════════════════════════
   3D Scene Grid
   ═══════════════════════════════════════════════ */

function SceneGrid() {
  const lines = useMemo(() => {
    const result: THREE.Vector3[][] = []
    const size = 2, divisions = 8
    const step = (size * 2) / divisions
    for (let i = 0; i <= divisions; i++) {
      const pos = -size + i * step
      result.push([new THREE.Vector3(-size, -0.005, pos), new THREE.Vector3(size, -0.005, pos)])
      result.push([new THREE.Vector3(pos, -0.005, -size), new THREE.Vector3(pos, -0.005, size)])
    }
    return result
  }, [])

  return (
    <group>
      {lines.map((pts, i) => (
        <Line key={i} points={pts} color="#ebeef2" lineWidth={0.3} />
      ))}
    </group>
  )
}

/* ═══════════════════════════════════════════════
   Polygon Drawing Canvas
   ═══════════════════════════════════════════════ */

function PolygonDrawCanvas({
  vertices,
  onVerticesChange,
  gridSize,
}: {
  vertices: { x: number; y: number }[]
  onVerticesChange: (v: { x: number; y: number }[]) => void
  gridSize: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [drawing, setDrawing] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const size = 200
    const dpr = window.devicePixelRatio || 1
    canvas.width = size * dpr
    canvas.height = size * dpr
    canvas.style.width = `${size}px`
    canvas.style.height = `${size}px`
    ctx.scale(dpr, dpr)

    // Background
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, size, size)

    // Grid
    ctx.strokeStyle = '#ebeef2'
    ctx.lineWidth = 0.5
    const step = size / 20
    for (let i = 0; i <= 20; i++) {
      ctx.beginPath(); ctx.moveTo(i * step, 0); ctx.lineTo(i * step, size); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(0, i * step); ctx.lineTo(size, i * step); ctx.stroke()
    }

    // Draw polygon
    if (vertices.length > 0) {
      ctx.beginPath()
      ctx.moveTo((vertices[0].x + 1) / 2 * size, (1 - (vertices[0].y + 1) / 2) * size)
      for (let i = 1; i < vertices.length; i++) {
        ctx.lineTo((vertices[i].x + 1) / 2 * size, (1 - (vertices[i].y + 1) / 2) * size)
      }
      if (vertices.length >= 3) {
        ctx.closePath()
        ctx.fillStyle = 'rgba(45, 49, 66, 0.15)'
        ctx.fill()
      }
      ctx.strokeStyle = '#2d3142'
      ctx.lineWidth = 1.5
      ctx.stroke()

      // Vertices
      vertices.forEach((v, idx) => {
        const px = (v.x + 1) / 2 * size
        const py = (1 - (v.y + 1) / 2) * size
        ctx.beginPath()
        ctx.arc(px, py, 3, 0, 2 * Math.PI)
        ctx.fillStyle = idx === 0 ? '#CC0000' : '#2d3142'
        ctx.fill()
      })
    }

    // Border
    ctx.strokeStyle = '#d4d8e0'
    ctx.lineWidth = 1
    ctx.strokeRect(0, 0, size, size)

    // Labels
    ctx.fillStyle = '#9ca3af'
    ctx.font = '9px IBM Plex Sans'
    ctx.textAlign = 'center'
    ctx.fillText('x', size / 2, size - 3)
    ctx.save()
    ctx.translate(8, size / 2)
    ctx.rotate(-Math.PI / 2)
    ctx.fillText('y', 0, 0)
    ctx.restore()
  }, [vertices])

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const size = 200
    const x = ((e.clientX - rect.left) / size) * 2 - 1
    const y = 1 - ((e.clientY - rect.top) / size) * 2
    onVerticesChange([...vertices, { x, y }])
  }, [vertices, onVerticesChange])

  return (
    <div>
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        style={{ cursor: 'crosshair', border: '1px solid #D0D0D0' }}
      />
      <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onVerticesChange([])}
          style={{ fontSize: '9px', height: '22px', padding: '0 8px' }}
        >
          清除
        </Button>
        <span style={{ fontSize: '9px', color: '#888888', lineHeight: '22px', fontFamily: FONT }}>
          {vertices.length}个顶点
        </span>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════
   Slice Profile Canvas (cross-section with Airy markers)
   ═══════════════════════════════════════════════ */

function SliceProfileCanvas({
  intensity,
  gridSize,
  fieldSizeM,
  wavelengthNm,
  distanceM,
  apertureRadiusNorm,
}: {
  intensity: Float64Array
  gridSize: number
  fieldSizeM: number
  wavelengthNm: number
  distanceM: number
  apertureRadiusNorm: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const w = 540, h = 160
    canvas.width = w * dpr
    canvas.height = h * dpr
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    ctx.scale(dpr, dpr)

    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)

    // Grid
    ctx.strokeStyle = '#ebeef2'
    ctx.lineWidth = 0.5
    for (let x = 0; x < w; x += 25) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke() }
    for (let y = 0; y < h; y += 25) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke() }

    // Normalize intensity
    let maxVal = 0
    for (let i = 0; i < intensity.length; i++) {
      if (intensity[i] > maxVal) maxVal = intensity[i]
    }

    const centerY = Math.floor(gridSize / 2)
    const margin = 35
    const plotW = w - 2 * margin
    const plotH = h - 2 * margin

    // Draw intensity profile
    const profilePoints: number[] = []
    ctx.beginPath()
    for (let i = 0; i < gridSize; i++) {
      const val = maxVal > 0 ? intensity[centerY * gridSize + i] / maxVal : 0
      profilePoints.push(val)
      const x = margin + (i / gridSize) * plotW
      const y = h - margin - val * plotH
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
    }
    ctx.strokeStyle = '#1a1a2e'
    ctx.lineWidth = 1.2
    ctx.stroke()

    // Fill under curve with wavelength color
    const baseColor = wavelengthToRGB(wavelengthNm)
    ctx.beginPath()
    ctx.moveTo(margin, h - margin)
    for (let i = 0; i < gridSize; i++) {
      const x = margin + (i / gridSize) * plotW
      const y = h - margin - profilePoints[i] * plotH
      ctx.lineTo(x, y)
    }
    ctx.lineTo(margin + plotW, h - margin)
    ctx.closePath()
    ctx.fillStyle = `rgba(${baseColor.r}, ${baseColor.g}, ${baseColor.b}, 0.08)`
    ctx.fill()

    // Airy disk first dark ring markers
    if (distanceM > 0 && apertureRadiusNorm > 0) {
      const apertureDiameterM = apertureRadiusNorm * 2 * fieldSizeM
      if (apertureDiameterM > 0) {
        const airyRadius = computeAiryDiskRadius(wavelengthNm * 1e-9, distanceM, apertureDiameterM)
        const airyRadiusNorm = airyRadius / fieldSizeM
        if (airyRadiusNorm < 0.5) {
          // Left marker
          const leftX = margin + (0.5 - airyRadiusNorm) * plotW
          const rightX = margin + (0.5 + airyRadiusNorm) * plotW

          ctx.setLineDash([3, 3])
          ctx.strokeStyle = '#CC0000'
          ctx.lineWidth = 0.8

          ctx.beginPath(); ctx.moveTo(leftX, margin); ctx.lineTo(leftX, h - margin); ctx.stroke()
          ctx.beginPath(); ctx.moveTo(rightX, margin); ctx.lineTo(rightX, h - margin); ctx.stroke()

          ctx.setLineDash([])
          ctx.fillStyle = '#CC0000'
          ctx.font = '8px IBM Plex Sans'
          ctx.textAlign = 'center'
          ctx.fillText('1st dark', (leftX + rightX) / 2, margin - 4)

          // Arrow between markers
          ctx.beginPath()
          ctx.moveTo(leftX + 2, margin + 8)
          ctx.lineTo(rightX - 2, margin + 8)
          ctx.strokeStyle = '#CC0000'
          ctx.lineWidth = 0.6
          ctx.stroke()
        }
      }
    }

    // Axes
    ctx.strokeStyle = '#9ca3af'
    ctx.lineWidth = 0.8
    ctx.beginPath(); ctx.moveTo(margin, h - margin); ctx.lineTo(w - margin, h - margin); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(margin, margin); ctx.lineTo(margin, h - margin); ctx.stroke()

    // Labels
    ctx.fillStyle = '#6b7280'
    ctx.font = '9px IBM Plex Sans'
    ctx.textAlign = 'center'
    ctx.fillText('位置 (x)', w / 2, h - 5)
    ctx.save()
    ctx.translate(8, h / 2)
    ctx.rotate(-Math.PI / 2)
    ctx.fillText('I/I₀', 0, 0)
    ctx.restore()

    // Title
    ctx.fillStyle = '#2d3142'
    ctx.font = '10px IBM Plex Sans'
    ctx.textAlign = 'left'
    ctx.fillText('水平截面强度分布 (剖切模式)', margin, margin - 6)
  }, [intensity, gridSize, fieldSizeM, wavelengthNm, distanceM, apertureRadiusNorm])

  return <canvas ref={canvasRef} />
}

/* ═══════════════════════════════════════════════
   Vector Component Display
   ═══════════════════════════════════════════════ */

function VectorComponentsPanel({ result }: { result: VectorDiffractionResult }) {
  // Compute peak values for each component
  const peaks = useMemo(() => {
    let maxTotal = 0, maxX = 0, maxY = 0, maxZ = 0
    for (let i = 0; i < result.intensity.length; i++) {
      if (result.intensity[i] > maxTotal) maxTotal = result.intensity[i]
      if (result.intensityX[i] > maxX) maxX = result.intensityX[i]
      if (result.intensityY[i] > maxY) maxY = result.intensityY[i]
      if (result.intensityZ[i] > maxZ) maxZ = result.intensityZ[i]
    }
    const zRatio = maxTotal > 0 ? maxZ / maxTotal : 0
    return { maxTotal, maxX, maxY, maxZ, zRatio }
  }, [result])

  return (
    <div style={{
      backgroundColor: '#FFFFFF', border: '1px solid #D0D0D0',
      borderRadius: '2px', padding: '8px', fontSize: '9px',
      fontFamily: FONT, lineHeight: '1.8',
    }}>
      <div style={{ color: '#555555', fontWeight: 600, marginBottom: '2px' }}>矢量衍射分量</div>
      <div style={{ color: '#555555' }}>|Ex|² 峰值: <span className="tabular-nums" style={{ color: '#1A1A1A', fontWeight: 600 }}>{peaks.maxX.toExponential(3)}</span></div>
      <div style={{ color: '#555555' }}>|Ey|² 峰值: <span className="tabular-nums" style={{ color: '#1A1A1A', fontWeight: 600 }}>{peaks.maxY.toExponential(3)}</span></div>
      <div style={{ color: '#555555' }}>|Ez|² 峰值: <span className="tabular-nums" style={{ color: '#1A1A1A', fontWeight: 600 }}>{peaks.maxZ.toExponential(3)}</span></div>
      <div style={{ color: '#555555' }}>Ez/I 比: <span className="tabular-nums" style={{ color: peaks.zRatio > 0.01 ? '#CC0000' : '#1A1A1A', fontWeight: 600 }}>{(peaks.zRatio * 100).toFixed(2)}%</span></div>
      {peaks.zRatio > 0.01 && (
        <div style={{ color: '#CC0000', fontSize: '8px', marginTop: '2px' }}>
          ⚠ 纵向分量显著，亚波长效应需关注
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════
   Region Indicator
   ═══════════════════════════════════════════════ */

function RegionIndicator({ fresnelNumber, region }: { fresnelNumber: number; region: string }) {
  const regionLabel = region === 'fraunhofer' ? '夫琅禾费区' : region === 'fresnel' ? '菲涅耳区' : '近场区'
  const regionColor = region === 'fraunhofer' ? '#2D7D46' : region === 'fresnel' ? '#B8860B' : '#CC0000'

  return (
    <div style={{
      backgroundColor: '#FFFFFF', border: '1px solid #D0D0D0',
      borderRadius: '2px', padding: '6px 8px', fontSize: '9px',
      fontFamily: FONT, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    }}>
      <div>
        <span style={{ color: '#555555' }}>N<sub>F</sub> = </span>
        <span className="tabular-nums" style={{ color: '#1A1A1A', fontWeight: 600 }}>{fresnelNumber.toFixed(2)}</span>
      </div>
      <div style={{
        padding: '2px 6px', borderRadius: '2px',
        border: `1px solid ${regionColor}`,
        color: regionColor, fontSize: '8px', fontWeight: 600,
      }}>
        {regionLabel}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════
   Babinet Comparison Panel
   ═══════════════════════════════════════════════ */

function BabinetPanel({
  aperture,
  compAperture,
  intensityOrig,
  intensityComp,
  gridSize,
  wavelengthNm,
}: {
  aperture: Float64Array
  compAperture: Float64Array
  intensityOrig: Float64Array
  intensityComp: Float64Array
  gridSize: number
  wavelengthNm: number
}) {
  const apertureCanvasRef = useRef<HTMLCanvasElement>(null)
  const compCanvasRef = useRef<HTMLCanvasElement>(null)
  const diffOrigCanvasRef = useRef<HTMLCanvasElement>(null)
  const compDiffCanvasRef = useRef<HTMLCanvasElement>(null)

  // Draw apertures
  useEffect(() => {
    [apertureCanvasRef, compCanvasRef].forEach((ref, idx) => {
      const canvas = ref.current
      if (!canvas) return
      const data = idx === 0 ? aperture : compAperture
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const dpr = window.devicePixelRatio || 1
      const size = 160
      canvas.width = size * dpr; canvas.height = size * dpr
      canvas.style.width = `${size}px`; canvas.style.height = `${size}px`
      ctx.scale(dpr, dpr)
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, size, size)
      const ps = size / gridSize
      for (let y = 0; y < gridSize; y++) {
        for (let x = 0; x < gridSize; x++) {
          if (data[y * gridSize + x] > 0.5) {
            ctx.fillStyle = '#2d3142'
            ctx.fillRect(x * ps, y * ps, Math.ceil(ps), Math.ceil(ps))
          }
        }
      }
      ctx.strokeStyle = '#d4d8e0'; ctx.lineWidth = 1
      ctx.strokeRect(0, 0, size, size)
    })
  }, [aperture, compAperture, gridSize])

  // Draw diffraction patterns
  useEffect(() => {
    [diffOrigCanvasRef, compDiffCanvasRef].forEach((ref, idx) => {
      const canvas = ref.current
      if (!canvas) return
      const data = idx === 0 ? intensityOrig : intensityComp
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const dpr = window.devicePixelRatio || 1
      const size = 160
      canvas.width = size * dpr; canvas.height = size * dpr
      canvas.style.width = `${size}px`; canvas.style.height = `${size}px`
      ctx.scale(dpr, dpr)

      const imageData = intensityToWavelengthColor(data, gridSize, wavelengthNm)
      const tempCanvas = document.createElement('canvas')
      tempCanvas.width = gridSize; tempCanvas.height = gridSize
      const tempCtx = tempCanvas.getContext('2d')!
      tempCtx.putImageData(imageData, 0, 0)
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(tempCanvas, 0, 0, size, size)
      ctx.strokeStyle = '#d4d8e0'; ctx.lineWidth = 1
      ctx.strokeRect(0, 0, size, size)
    })
  }, [intensityOrig, intensityComp, gridSize, wavelengthNm])

  // Compute sum verification
  const sumVerification = useMemo(() => {
    let maxOrig = 0, maxComp = 0
    for (let i = 0; i < intensityOrig.length; i++) {
      if (intensityOrig[i] > maxOrig) maxOrig = intensityOrig[i]
      if (intensityComp[i] > maxComp) maxComp = intensityComp[i]
    }
    // Babinet: I_orig + I_comp = I_undisturbed (constant on axis for complementary screens)
    const centerY = Math.floor(gridSize / 2)
    const onAxisOrig = maxOrig > 0 ? intensityOrig[centerY * gridSize + centerY] / maxOrig : 0
    const onAxisComp = maxComp > 0 ? intensityComp[centerY * gridSize + centerY] / maxComp : 0
    return { onAxisOrig, onAxisComp, sum: onAxisOrig + onAxisComp }
  }, [intensityOrig, intensityComp, gridSize])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
      <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', justifyContent: 'center' }}>
        {/* Original aperture */}
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '10px', fontWeight: 600, color: '#1A1A1A', fontFamily: FONT, marginBottom: '4px' }}>原始口径（圆孔）</div>
          <canvas ref={apertureCanvasRef} />
          <div style={{ fontSize: '10px', fontWeight: 600, color: '#6b7280', fontFamily: FONT, margin: '4px 0' }}>衍射图样</div>
          <canvas ref={diffOrigCanvasRef} />
        </div>
        {/* Complementary aperture */}
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '10px', fontWeight: 600, color: '#1A1A1A', fontFamily: FONT, marginBottom: '4px' }}>互补口径（圆盘）</div>
          <canvas ref={compCanvasRef} />
          <div style={{ fontSize: '10px', fontWeight: 600, color: '#6b7280', fontFamily: FONT, margin: '4px 0' }}>衍射图样</div>
          <canvas ref={compDiffCanvasRef} />
        </div>
      </div>
      {/* Babinet verification */}
      <div style={{
        backgroundColor: '#FFFFFF', border: '1px solid #D0D0D0',
        borderRadius: '2px', padding: '8px', fontSize: '9px',
        fontFamily: FONT, lineHeight: '1.8', maxWidth: '360px', width: '100%',
      }}>
        <div style={{ fontWeight: 600, color: '#1A1A1A', marginBottom: '4px' }}>巴比涅原理验证</div>
        <div style={{ color: '#555555' }}>圆孔轴上强度: <span className="tabular-nums" style={{ fontWeight: 600 }}>{sumVerification.onAxisOrig.toFixed(4)}</span></div>
        <div style={{ color: '#555555' }}>圆盘轴上强度: <span className="tabular-nums" style={{ fontWeight: 600 }}>{sumVerification.onAxisComp.toFixed(4)}</span></div>
        <div style={{ color: '#555555' }}>轴上强度之和: <span className="tabular-nums" style={{ fontWeight: 600, color: '#2D7D46' }}>{sumVerification.sum.toFixed(4)}</span></div>
        <div style={{ color: '#888888', fontSize: '8px', marginTop: '4px', lineHeight: '1.5' }}>
          巴比涅原理：互补屏的轴外衍射图样相同<br/>
          I<sub>孔</sub> + I<sub>盘</sub> = I<sub>无屏</sub>（轴上恒等）
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════
   Grating Spectrometer Panel
   ═══════════════════════════════════════════════ */

function GratingSpectrometerPanel({
  wavelengthNm,
  numSlits,
  gratingPeriodPx,
  slitWidth,
  fieldSizeM,
}: {
  wavelengthNm: number
  numSlits: number
  gratingPeriodPx: number
  slitWidth: number
  fieldSizeM: number
}) {
  // Compute grating parameters
  const gratingInfo = useMemo(() => {
    const periodM = gratingPeriodPx / 128 * fieldSizeM
    const orders = computeGratingOrders(periodM, wavelengthNm, 5)
    const dispersion = computeAngularDispersion(periodM, wavelengthNm, 1)
    const resolvingPower = computeResolvingPower(1, numSlits)
    const minResWavelength = wavelengthNm / resolvingPower
    return { orders, dispersion, resolvingPower, minResWavelength, periodM }
  }, [wavelengthNm, numSlits, gratingPeriodPx, fieldSizeM])

  return (
    <div style={{
      backgroundColor: '#FFFFFF', border: '1px solid #D0D0D0',
      borderRadius: '2px', padding: '10px', fontSize: '9px',
      fontFamily: FONT, lineHeight: '1.8',
    }}>
      <div style={{ fontWeight: 600, color: '#1A1A1A', marginBottom: '4px' }}>光栅参数分析</div>
      <div style={{ color: '#555555' }}>光栅周期 d: <span className="tabular-nums" style={{ fontWeight: 600 }}>{(gratingInfo.periodM * 1e6).toFixed(2)} μm</span></div>
      <div style={{ color: '#555555' }}>缝数 N: <span className="tabular-nums" style={{ fontWeight: 600 }}>{numSlits}</span></div>
      <div style={{ color: '#555555' }}>角色散 dθ/dλ: <span className="tabular-nums" style={{ fontWeight: 600 }}>{(gratingInfo.dispersion * 1e6).toFixed(4)} mrad/nm</span></div>
      <div style={{ color: '#555555' }}>分辨本领 R = mN: <span className="tabular-nums" style={{ fontWeight: 600 }}>{gratingInfo.resolvingPower}</span></div>
      <div style={{ color: '#555555' }}>最小可分辨 Δλ: <span className="tabular-nums" style={{ fontWeight: 600 }}>{gratingInfo.minResWavelength.toFixed(2)} nm</span></div>

      <div style={{ marginTop: '8px', fontWeight: 600, color: '#1A1A1A' }}>衍射级次</div>
      {gratingInfo.orders.filter(o => o.order !== 0).map(o => (
        <div key={o.order} style={{ color: '#555555' }}>
          m={o.order}: θ = <span className="tabular-nums" style={{ fontWeight: 600 }}>{o.angleDeg.toFixed(2)}°</span>
        </div>
      ))}
    </div>
  )
}

/* ═══════════════════════════════════════════════
   Rayleigh Criterion Panel
   ═══════════════════════════════════════════════ */

function RayleighPanel({
  separation,
  wavelengthNm,
  apertureRadiusNorm,
  fieldSizeM,
  distanceM,
}: {
  separation: number
  wavelengthNm: number
  apertureRadiusNorm: number
  fieldSizeM: number
  distanceM: number
}) {
  const rayleighInfo = useMemo(() => {
    const apertureDM = apertureRadiusNorm * 2 * fieldSizeM
    const airyRadius = computeAiryDiskRadius(wavelengthNm * 1e-9, distanceM, apertureDM)
    const separationM = separation * fieldSizeM
    const ratio = airyRadius > 0 ? separationM / airyRadius : 0
    const resolved = ratio > 1
    return { airyRadius, separationM, ratio, resolved }
  }, [separation, wavelengthNm, apertureRadiusNorm, fieldSizeM, distanceM])

  return (
    <div style={{
      backgroundColor: '#FFFFFF', border: '1px solid #D0D0D0',
      borderRadius: '2px', padding: '10px', fontSize: '9px',
      fontFamily: FONT, lineHeight: '1.8',
    }}>
      <div style={{ fontWeight: 600, color: '#1A1A1A', marginBottom: '4px' }}>瑞利判据分析</div>
      <div style={{ color: '#555555' }}>艾里斑半径: <span className="tabular-nums" style={{ fontWeight: 600 }}>{(rayleighInfo.airyRadius * 1e6).toFixed(2)} μm</span></div>
      <div style={{ color: '#555555' }}>点源间距: <span className="tabular-nums" style={{ fontWeight: 600 }}>{(rayleighInfo.separationM * 1e6).toFixed(2)} μm</span></div>
      <div style={{ color: '#555555' }}>间距/艾里半径: <span className="tabular-nums" style={{ fontWeight: 600, color: rayleighInfo.resolved ? '#2D7D46' : '#CC0000' }}>{rayleighInfo.ratio.toFixed(3)}</span></div>
      <div style={{
        marginTop: '6px', padding: '4px 8px', borderRadius: '2px',
        border: `1px solid ${rayleighInfo.resolved ? '#2D7D46' : '#CC0000'}`,
        color: rayleighInfo.resolved ? '#2D7D46' : '#CC0000',
        fontWeight: 600, textAlign: 'center',
      }}>
        {rayleighInfo.ratio < 0.85 ? '未分辨 (重叠)' : rayleighInfo.ratio < 1.15 ? '瑞利判据边界' : '已分辨 (清晰)'}
      </div>
      <div style={{ color: '#888888', fontSize: '8px', marginTop: '6px', lineHeight: '1.5' }}>
        瑞利判据：一个点源的艾里斑中心恰好落在<br/>
        另一个点源的第一暗环上时为可分辨极限<br/>
        即间距 = 1.22 λz/D
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════
   Hologram Panel
   ═══════════════════════════════════════════════ */

function HologramPanel({
  aperture,
  intensity,
  gridSize,
  wavelengthNm,
  pattern,
}: {
  aperture: Float64Array
  intensity: Float64Array
  gridSize: number
  wavelengthNm: number
  pattern: 'F' | 'cross' | 'circle'
}) {
  const holoCanvasRef = useRef<HTMLCanvasElement>(null)
  const reconCanvasRef = useRef<HTMLCanvasElement>(null)

  // Draw hologram
  useEffect(() => {
    const canvas = holoCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    const size = 160
    canvas.width = size * dpr; canvas.height = size * dpr
    canvas.style.width = `${size}px`; canvas.style.height = `${size}px`
    ctx.scale(dpr, dpr)

    let maxVal = 0
    for (let i = 0; i < aperture.length; i++) { if (aperture[i] > maxVal) maxVal = aperture[i] }
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, size, size)
    const ps = size / gridSize
    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        const val = maxVal > 0 ? aperture[y * gridSize + x] / maxVal : 0
        const c = Math.round(Math.pow(Math.max(0, Math.min(1, val)), 0.5) * 255)
        ctx.fillStyle = `rgb(${c},${c},${c})`
        ctx.fillRect(x * ps, y * ps, Math.ceil(ps), Math.ceil(ps))
      }
    }
    ctx.strokeStyle = '#d4d8e0'; ctx.lineWidth = 1
    ctx.strokeRect(0, 0, size, size)
  }, [aperture, gridSize])

  // Draw reconstruction
  useEffect(() => {
    const canvas = reconCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    const size = 160
    canvas.width = size * dpr; canvas.height = size * dpr
    canvas.style.width = `${size}px`; canvas.style.height = `${size}px`
    ctx.scale(dpr, dpr)

    const imageData = intensityToWavelengthColor(intensity, gridSize, wavelengthNm)
    const tempCanvas = document.createElement('canvas')
    tempCanvas.width = gridSize; tempCanvas.height = gridSize
    const tempCtx = tempCanvas.getContext('2d')!
    tempCtx.putImageData(imageData, 0, 0)
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(tempCanvas, 0, 0, size, size)
    ctx.strokeStyle = '#d4d8e0'; ctx.lineWidth = 1
    ctx.strokeRect(0, 0, size, size)
  }, [intensity, gridSize, wavelengthNm])

  return (
    <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '10px', fontWeight: 600, color: '#1A1A1A', fontFamily: FONT, marginBottom: '4px' }}>计算全息图 ({pattern === 'F' ? '字母F' : pattern === 'cross' ? '十字' : '圆形'})</div>
        <canvas ref={holoCanvasRef} />
      </div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '10px', fontWeight: 600, color: '#1A1A1A', fontFamily: FONT, marginBottom: '4px' }}>光学再现像</div>
        <canvas ref={reconCanvasRef} />
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════ */

export default function VectorDiffractionWorkshop({ onBack }: { onBack: () => void }) {
  /* ── Experiment Mode ────────────────────────────────────── */
  const [expMode, setExpMode] = useState<ExperimentMode>('basic')

  /* ── Aperture State ─────────────────────────────────────── */
  const [apertureMode, setApertureMode] = useState<ApertureMode>('circular')
  const [apertureSize, setApertureSize] = useState(30)
  const [apertureHeight, setApertureHeight] = useState(60)
  const [slitWidth, setSlitWidth] = useState(8)
  const [slitSeparation, setSlitSeparation] = useState(40)
  const [numGratingSlits, setNumGratingSlits] = useState(5)
  const [gratingPeriod, setGratingPeriod] = useState(30)
  const [annularInner, setAnnularInner] = useState(15)
  const [polygonVertices, setPolygonVertices] = useState<{ x: number; y: number }[]>([])
  const [apodizationWidth, setApodizationWidth] = useState(0)

  /* ── Physics State ──────────────────────────────────────── */
  const [wavelengthNm, setWavelengthNm] = useState(632.8)
  const [distanceMm, setDistanceMm] = useState(500) // mm
  const [fieldSizeUm, setFieldSizeUm] = useState(200) // μm
  const [polarizationAngle, setPolarizationAngle] = useState(0) // degrees
  const [useVectorDiffraction, setUseVectorDiffraction] = useState(false)
  const [colorMode, setColorMode] = useState<ColorMode>('wavelength')
  const [showSlice, setShowSlice] = useState(true)

  /* ── Rayleigh mode state ────────────────────────────────── */
  const [pointSeparation, setPointSeparation] = useState(0.08)

  /* ── Hologram mode state ────────────────────────────────── */
  const [holoPattern, setHoloPattern] = useState<'F' | 'cross' | 'circle'>('F')
  const [referenceAngle, setReferenceAngle] = useState(5)

  /* ── Canvas refs ────────────────────────────────────────── */
  const apertureCanvasRef = useRef<HTMLCanvasElement>(null)
  const diffractionCanvasRef = useRef<HTMLCanvasElement>(null)

  /* ── Derived physical parameters ────────────────────────── */
  const wavelengthM = wavelengthNm * 1e-9
  const distanceM = distanceMm * 1e-3
  const fieldSizeM = fieldSizeUm * 1e-6
  const toNorm = (px: number) => px / (GRID_SIZE / 2)

  /* ── Aperture radius (normalized) for Fresnel number ────── */
  const apertureRadiusNorm = useMemo(() => {
    switch (apertureMode) {
      case 'circular': case 'annular': case 'triangle': return toNorm(apertureSize)
      case 'rectangular': return Math.max(toNorm(apertureSize), toNorm(apertureHeight))
      case 'single_slit': return toNorm(slitWidth * 2)
      case 'double_slit': return toNorm(slitSeparation / 2 + slitWidth)
      case 'grating': return toNorm(gratingPeriod * numGratingSlits / 2)
      case 'polygon': return 0.4
      default: return 0.3
    }
  }, [apertureMode, apertureSize, apertureHeight, slitWidth, slitSeparation, numGratingSlits, gratingPeriod])

  /* ── Generate aperture ──────────────────────────────────── */
  const apertureParams: ApertureParams = useMemo(() => {
    const base: ApertureParams = {
      type: apertureMode === 'annular' ? 'annular' : apertureMode,
      gridSize: GRID_SIZE,
      apodizationWidth: apodizationWidth > 0 ? apodizationWidth / 100 : 0,
    }
    switch (apertureMode) {
      case 'circular': return { ...base, radius: toNorm(apertureSize) }
      case 'annular': return { ...base, radius: toNorm(apertureSize), innerRadius: toNorm(annularInner) }
      case 'triangle': return { ...base, radius: toNorm(apertureSize) }
      case 'rectangular': return { ...base, halfWidth: toNorm(apertureSize), halfHeight: toNorm(apertureHeight) }
      case 'single_slit': return { ...base, slitWidth: toNorm(slitWidth * 2) }
      case 'double_slit': return { ...base, slitWidth: toNorm(slitWidth * 2), slitSeparation: toNorm(slitSeparation) }
      case 'grating': return { ...base, gratingSlitWidth: toNorm(slitWidth), gratingPeriod: toNorm(gratingPeriod), numSlits: numGratingSlits }
      case 'polygon': return { ...base, polygonVertices }
      default: return base
    }
  }, [apertureMode, apertureSize, apertureHeight, slitWidth, slitSeparation, numGratingSlits, gratingPeriod, annularInner, polygonVertices, apodizationWidth])

  const aperture = useMemo(() => generateAperture(apertureParams), [apertureParams])

  /* ── Special apertures for different modes ──────────────── */
  const rayleighAperture = useMemo(() =>
    generateTwoPointAperture(GRID_SIZE, pointSeparation, 0.02),
    [pointSeparation])

  const holoAperture = useMemo(() =>
    generateFourierHologram(GRID_SIZE, holoPattern, referenceAngle),
    [holoPattern, referenceAngle])

  const compAperture = useMemo(() =>
    generateComplementaryAperture(aperture, GRID_SIZE),
    [aperture])

  /* ── Active aperture based on mode ──────────────────────── */
  const activeAperture = useMemo(() => {
    switch (expMode) {
      case 'rayleigh': return rayleighAperture
      case 'hologram': return holoAperture
      default: return aperture
    }
  }, [expMode, aperture, rayleighAperture, holoAperture])

  /* ── Compute diffraction ────────────────────────────────── */
  const vectorResult = useMemo(() => {
    if (useVectorDiffraction && expMode === 'basic') {
      return computeVectorDiffraction(
        activeAperture, GRID_SIZE, wavelengthM, distanceM, fieldSizeM,
        (polarizationAngle * Math.PI) / 180
      )
    }
    // Use angular spectrum method by default
    const result = computeAngularSpectrum(activeAperture, GRID_SIZE, wavelengthM, distanceM, fieldSizeM)
    const NF = computeFresnelNumber(apertureRadiusNorm * fieldSizeM, wavelengthM, distanceM)
    const region = classifyRegion(NF)

    // Normalize
    let maxVal = 0
    for (let i = 0; i < result.intensity.length; i++) {
      if (result.intensity[i] > maxVal) maxVal = result.intensity[i]
    }
    const normalizedIntensity = new Float64Array(result.intensity.length)
    if (maxVal > 0) {
      for (let i = 0; i < result.intensity.length; i++) {
        normalizedIntensity[i] = result.intensity[i] / maxVal
      }
    }

    return {
      intensity: normalizedIntensity,
      intensityX: new Float64Array(GRID_SIZE * GRID_SIZE),
      intensityY: new Float64Array(GRID_SIZE * GRID_SIZE),
      intensityZ: new Float64Array(GRID_SIZE * GRID_SIZE),
      fresnelNumber: NF,
      region,
      fieldSizeM,
    } as VectorDiffractionResult
  }, [activeAperture, wavelengthM, distanceM, fieldSizeM, polarizationAngle, useVectorDiffraction, expMode, apertureRadiusNorm])

  /* ── Complementary diffraction for Babinet ──────────────── */
  const compResult = useMemo(() => {
    if (expMode !== 'babinet') return null
    const result = computeFraunhoferDiffraction(compAperture, GRID_SIZE)
    return result.intensity
  }, [expMode, compAperture])

  /* ── Hologram reconstruction ────────────────────────────── */
  const holoResult = useMemo(() => {
    if (expMode !== 'hologram') return null
    // Reconstruction: FFT of the hologram
    const result = computeFraunhoferDiffraction(holoAperture, GRID_SIZE)
    return result.intensity
  }, [expMode, holoAperture])

  /* ── Fresnel number & region ────────────────────────────── */
  const fresnelNumber = vectorResult.fresnelNumber
  const region = vectorResult.region

  /* ── Normalized intensity for display ───────────────────── */
  const normalizedIntensity = useMemo(() => {
    const raw = expMode === 'hologram' && holoResult ? holoResult :
                expMode === 'babinet' && compResult ? vectorResult.intensity :
                vectorResult.intensity
    let maxVal = 0
    for (let i = 0; i < raw.length; i++) { if (raw[i] > maxVal) maxVal = raw[i] }
    const normalized = new Float64Array(raw.length)
    if (maxVal > 0) {
      for (let i = 0; i < raw.length; i++) { normalized[i] = raw[i] / maxVal }
    }
    return normalized
  }, [vectorResult.intensity, holoResult, compResult, expMode])

  /* ── Draw aperture canvas ───────────────────────────────── */
  useEffect(() => {
    const canvas = apertureCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const displaySize = 200
    canvas.width = displaySize * dpr; canvas.height = displaySize * dpr
    canvas.style.width = `${displaySize}px`; canvas.style.height = `${displaySize}px`
    ctx.scale(dpr, dpr)

    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, displaySize, displaySize)

    // Grid
    ctx.strokeStyle = '#ebeef2'; ctx.lineWidth = 0.5
    const step = displaySize / 20
    for (let i = 0; i <= 20; i++) {
      ctx.beginPath(); ctx.moveTo(i * step, 0); ctx.lineTo(i * step, displaySize); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(0, i * step); ctx.lineTo(displaySize, i * step); ctx.stroke()
    }

    // Draw aperture
    const pixelSize = displaySize / GRID_SIZE
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const val = activeAperture[y * GRID_SIZE + x]
        if (val > 0) {
          const alpha = Math.min(1, val)
          ctx.fillStyle = `rgba(45, 49, 66, ${alpha})`
          ctx.fillRect(x * pixelSize, y * pixelSize, Math.ceil(pixelSize), Math.ceil(pixelSize))
        }
      }
    }

    ctx.strokeStyle = '#d4d8e0'; ctx.lineWidth = 1
    ctx.strokeRect(0, 0, displaySize, displaySize)
    ctx.fillStyle = '#9ca3af'; ctx.font = '9px IBM Plex Sans'; ctx.textAlign = 'center'
    ctx.fillText('x', displaySize / 2, displaySize - 3)
    ctx.save(); ctx.translate(8, displaySize / 2); ctx.rotate(-Math.PI / 2); ctx.fillText('y', 0, 0); ctx.restore()
  }, [activeAperture])

  /* ── Draw diffraction pattern ───────────────────────────── */
  useEffect(() => {
    const canvas = diffractionCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const displaySize = 240
    canvas.width = displaySize * dpr; canvas.height = displaySize * dpr
    canvas.style.width = `${displaySize}px`; canvas.style.height = `${displaySize}px`
    ctx.scale(dpr, dpr)

    const displayIntensity = expMode === 'hologram' && holoResult ? holoResult :
                             vectorResult.intensity

    let imageData: ImageData
    switch (colorMode) {
      case 'wavelength':
        imageData = intensityToWavelengthColor(displayIntensity, GRID_SIZE, wavelengthNm)
        break
      case 'grayscale':
        imageData = intensityToGrayscale(displayIntensity, GRID_SIZE, false)
        break
      case 'inverted':
        imageData = intensityToGrayscale(displayIntensity, GRID_SIZE, true)
        break
      case 'blue-white':
        imageData = intensityToBlueWhite(displayIntensity, GRID_SIZE)
        break
    }

    const tempCanvas = document.createElement('canvas')
    tempCanvas.width = GRID_SIZE; tempCanvas.height = GRID_SIZE
    const tempCtx = tempCanvas.getContext('2d')!
    tempCtx.putImageData(imageData, 0, 0)
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(tempCanvas, 0, 0, displaySize, displaySize)
    ctx.strokeStyle = '#d4d8e0'; ctx.lineWidth = 1
    ctx.strokeRect(0, 0, displaySize, displaySize)
  }, [vectorResult.intensity, holoResult, colorMode, wavelengthNm, expMode])

  /* ── 3D Scene ───────────────────────────────────────────── */
  const render3D = useMemo(() => (
    <Canvas
      camera={{ position: [3, 2.5, 3], fov: 45, near: 0.1, far: 100 }}
      style={{ background: '#ffffff' }}
      gl={{ antialias: true, alpha: false }}
    >
      <ambientLight intensity={0.7} />
      <directionalLight position={[5, 8, 5]} intensity={0.4} />
      <directionalLight position={[-3, 4, -3]} intensity={0.15} />
      <DiffractionSurface3D intensity={normalizedIntensity} gridSize={GRID_SIZE} wavelengthNm={wavelengthNm} heightScale={2.0} />
      <AxisLabels heightScale={2.0} />
      <SceneGrid />
      <OrbitControls enableDamping dampingFactor={0.1} rotateSpeed={0.5} zoomSpeed={0.8} minDistance={2} maxDistance={15} />
    </Canvas>
  ), [normalizedIntensity, wavelengthNm])

  /* ══════════════════════════════════════════════════════════
     RENDER
     ══════════════════════════════════════════════════════════ */
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
          全波前矢量衍射工坊
        </h1>
        <span style={{
          marginLeft: '8px', fontSize: '8px', fontWeight: 400, color: '#888888',
          fontFamily: FONT, padding: '1px 5px',
          border: '1px solid #D0D0D0', borderRadius: '2px',
        }}>
          ASM + 矢量衍射
        </span>
      </div>

      {/* Main content */}
      <div className="flex flex-1" style={{ minHeight: 0 }}>
        {/* Left: Visualization Area */}
        <div className="flex-1 custom-scrollbar" style={{
          display: 'flex', flexDirection: 'column', padding: '16px', overflowY: 'auto',
          alignItems: 'center',
        }}>
          {/* Experiment mode tabs */}
          <div style={{
            display: 'flex', gap: '2px', marginBottom: '16px',
            borderBottom: '1px solid #E8ECF0', paddingBottom: '8px', width: '100%',
            justifyContent: 'center', flexWrap: 'wrap',
          }}>
            {(Object.entries(MODE_LABELS) as [ExperimentMode, string][]).map(([key, label]) => (
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

          {/* Mode description */}
          <div style={{
            fontSize: '9px', color: '#888888', fontFamily: FONT,
            marginBottom: '12px', textAlign: 'center',
          }}>
            {MODE_DESCRIPTIONS[expMode]}
          </div>

          {/* ─── Basic Mode ─── */}
          {expMode === 'basic' && (
            <>
              {/* Aperture + Diffraction side by side */}
              <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', justifyContent: 'center', marginBottom: '12px' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '10px', fontWeight: 600, color: '#1A1A1A', fontFamily: FONT, marginBottom: '4px' }}>口径函数</div>
                  <canvas ref={apertureCanvasRef} />
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '10px', fontWeight: 600, color: '#1A1A1A', fontFamily: FONT, marginBottom: '4px' }}>衍射图样 ({colorMode === 'wavelength' ? '波长着色' : colorMode === 'grayscale' ? '灰度' : colorMode === 'inverted' ? '反色' : '蓝白'})</div>
                  <canvas ref={diffractionCanvasRef} />
                </div>
              </div>

              {/* Region indicator */}
              <div style={{ maxWidth: '400px', width: '100%', marginBottom: '12px' }}>
                <RegionIndicator fresnelNumber={fresnelNumber} region={region} />
              </div>

              {/* Vector components */}
              {useVectorDiffraction && (
                <div style={{ maxWidth: '300px', width: '100%', marginBottom: '12px' }}>
                  <VectorComponentsPanel result={vectorResult} />
                </div>
              )}

              {/* Slice profile */}
              {showSlice && (
                <div style={{ marginBottom: '12px' }}>
                  <SliceProfileCanvas
                    intensity={vectorResult.intensity}
                    gridSize={GRID_SIZE}
                    fieldSizeM={fieldSizeM}
                    wavelengthNm={wavelengthNm}
                    distanceM={distanceM}
                    apertureRadiusNorm={apertureRadiusNorm}
                  />
                </div>
              )}

              {/* 3D surface */}
              <div style={{ width: '100%', maxWidth: '500px', height: '350px', border: '1px solid #E8ECF0', borderRadius: '2px', marginBottom: '12px' }}>
                {render3D}
              </div>
            </>
          )}

          {/* ─── Babinet Mode ─── */}
          {expMode === 'babinet' && compResult && (
            <BabinetPanel
              aperture={aperture}
              compAperture={compAperture}
              intensityOrig={vectorResult.intensity}
              intensityComp={compResult}
              gridSize={GRID_SIZE}
              wavelengthNm={wavelengthNm}
            />
          )}

          {/* ─── Grating Spectrometer Mode ─── */}
          {expMode === 'grating_spectrometer' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
              {/* Diffraction pattern */}
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '10px', fontWeight: 600, color: '#1A1A1A', fontFamily: FONT, marginBottom: '4px' }}>光栅衍射图样</div>
                <canvas ref={diffractionCanvasRef} />
              </div>
              <GratingSpectrometerPanel
                wavelengthNm={wavelengthNm}
                numSlits={numGratingSlits}
                gratingPeriodPx={gratingPeriod}
                slitWidth={slitWidth}
                fieldSizeM={fieldSizeM}
              />
            </div>
          )}

          {/* ─── Rayleigh Mode ─── */}
          {expMode === 'rayleigh' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
              <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', justifyContent: 'center' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '10px', fontWeight: 600, color: '#1A1A1A', fontFamily: FONT, marginBottom: '4px' }}>两点源口径</div>
                  <canvas ref={apertureCanvasRef} />
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '10px', fontWeight: 600, color: '#1A1A1A', fontFamily: FONT, marginBottom: '4px' }}>衍射极限成像</div>
                  <canvas ref={diffractionCanvasRef} />
                </div>
              </div>
              <RayleighPanel
                separation={pointSeparation}
                wavelengthNm={wavelengthNm}
                apertureRadiusNorm={apertureRadiusNorm}
                fieldSizeM={fieldSizeM}
                distanceM={distanceM}
              />
              {/* Slice profile for Rayleigh */}
              <SliceProfileCanvas
                intensity={vectorResult.intensity}
                gridSize={GRID_SIZE}
                fieldSizeM={fieldSizeM}
                wavelengthNm={wavelengthNm}
                distanceM={distanceM}
                apertureRadiusNorm={apertureRadiusNorm}
              />
            </div>
          )}

          {/* ─── Hologram Mode ─── */}
          {expMode === 'hologram' && holoResult && (
            <HologramPanel
              aperture={holoAperture}
              intensity={holoResult}
              gridSize={GRID_SIZE}
              wavelengthNm={wavelengthNm}
              pattern={holoPattern}
            />
          )}
        </div>

        {/* Right: Control Panel */}
        <div className="custom-scrollbar" style={{
          width: '280px', flexShrink: 0, backgroundColor: '#FAFAFA',
          borderLeft: '1px solid #D0D0D0', overflowY: 'auto', padding: '16px',
        }}>
          {/* Wavelength */}
          <SectionTitle>波长</SectionTitle>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <input type="range" min="380" max="780" step="0.5" value={wavelengthNm}
              onChange={e => setWavelengthNm(Number(e.target.value))}
              style={{ flex: 1, accentColor: '#333333' }}
            />
            <span className="tabular-nums" style={{ fontSize: '11px', fontWeight: 600, color: '#1A1A1A', fontFamily: FONT, minWidth: '52px' }}>
              {wavelengthNm.toFixed(1)}nm
            </span>
          </div>
          {/* Wavelength presets */}
          <div style={{ display: 'flex', gap: '2px', flexWrap: 'wrap', marginBottom: '4px' }}>
            {WAVELENGTH_PRESETS.map(p => (
              <button key={p.value} onClick={() => setWavelengthNm(p.value)} style={{
                fontSize: '7px', padding: '2px 4px', borderRadius: '1px',
                border: `1px solid ${Math.abs(wavelengthNm - p.value) < 1 ? '#333333' : '#D0D0D0'}`,
                backgroundColor: Math.abs(wavelengthNm - p.value) < 1 ? '#F0F3F6' : '#FFFFFF',
                color: '#1A1A1A', cursor: 'pointer', fontFamily: FONT,
              }}>
                {p.label.split(' ')[0]}
              </button>
            ))}
          </div>
          {/* Color swatch */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{
              width: '20px', height: '12px', borderRadius: '2px',
              backgroundColor: `rgb(${wavelengthToRGB(wavelengthNm).r}, ${wavelengthToRGB(wavelengthNm).g}, ${wavelengthToRGB(wavelengthNm).b})`,
              border: '1px solid #D0D0D0',
            }} />
            <span style={{ fontSize: '8px', color: '#888888', fontFamily: FONT }}>
              {wavelengthToRGB(wavelengthNm).r}, {wavelengthToRGB(wavelengthNm).g}, {wavelengthToRGB(wavelengthNm).b}
            </span>
          </div>

          {/* Propagation Distance */}
          <SectionTitle>传播距离</SectionTitle>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <input type="range" min="1" max="5000" step="1" value={distanceMm}
              onChange={e => setDistanceMm(Number(e.target.value))}
              style={{ flex: 1, accentColor: '#333333' }}
            />
            <span className="tabular-nums" style={{ fontSize: '11px', fontWeight: 600, color: '#1A1A1A', fontFamily: FONT, minWidth: '48px' }}>
              {distanceMm >= 1000 ? `${(distanceMm / 1000).toFixed(1)}m` : `${distanceMm}mm`}
            </span>
          </div>

          {/* Field Size */}
          <SectionTitle>口径面尺寸</SectionTitle>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <input type="range" min="10" max="2000" step="10" value={fieldSizeUm}
              onChange={e => setFieldSizeUm(Number(e.target.value))}
              style={{ flex: 1, accentColor: '#333333' }}
            />
            <span className="tabular-nums" style={{ fontSize: '11px', fontWeight: 600, color: '#1A1A1A', fontFamily: FONT, minWidth: '48px' }}>
              {fieldSizeUm >= 1000 ? `${(fieldSizeUm / 1000).toFixed(1)}mm` : `${fieldSizeUm}μm`}
            </span>
          </div>

          {/* Aperture type (only for basic/babinet modes) */}
          {(expMode === 'basic' || expMode === 'babinet') && (
            <>
              <SectionTitle>口径类型</SectionTitle>
              <Select value={apertureMode} onValueChange={v => setApertureMode(v as ApertureMode)}>
                <SelectTrigger className="h-8 text-[12px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(APERTURE_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Aperture Parameters */}
              <SectionTitle>口径参数</SectionTitle>

              {(apertureMode === 'circular' || apertureMode === 'annular' || apertureMode === 'triangle') && (
                <div style={{ marginBottom: '6px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Label style={{ fontSize: '11px', color: '#2d3142' }}>{apertureMode === 'triangle' ? '外接圆半径' : '半径'}</Label>
                    <span className="tabular-nums" style={{ fontSize: '10px', color: '#6b7280' }}>{apertureSize} px</span>
                  </div>
                  <Slider value={[apertureSize]} onValueChange={([v]) => setApertureSize(v)} min={5} max={100} step={1} />
                </div>
              )}

              {apertureMode === 'annular' && (
                <div style={{ marginBottom: '6px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Label style={{ fontSize: '11px', color: '#2d3142' }}>内径</Label>
                    <span className="tabular-nums" style={{ fontSize: '10px', color: '#6b7280' }}>{annularInner} px</span>
                  </div>
                  <Slider value={[annularInner]} onValueChange={([v]) => setAnnularInner(v)} min={2} max={apertureSize - 2} step={1} />
                </div>
              )}

              {apertureMode === 'rectangular' && (
                <>
                  <div style={{ marginBottom: '6px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Label style={{ fontSize: '11px', color: '#2d3142' }}>半宽</Label>
                      <span className="tabular-nums" style={{ fontSize: '10px', color: '#6b7280' }}>{apertureSize} px</span>
                    </div>
                    <Slider value={[apertureSize]} onValueChange={([v]) => setApertureSize(v)} min={5} max={100} step={1} />
                  </div>
                  <div style={{ marginBottom: '6px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Label style={{ fontSize: '11px', color: '#2d3142' }}>半高</Label>
                      <span className="tabular-nums" style={{ fontSize: '10px', color: '#6b7280' }}>{apertureHeight} px</span>
                    </div>
                    <Slider value={[apertureHeight]} onValueChange={([v]) => setApertureHeight(v)} min={5} max={100} step={1} />
                  </div>
                </>
              )}

              {(apertureMode === 'single_slit' || apertureMode === 'double_slit' || apertureMode === 'grating') && (
                <div style={{ marginBottom: '6px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Label style={{ fontSize: '11px', color: '#2d3142' }}>缝宽</Label>
                    <span className="tabular-nums" style={{ fontSize: '10px', color: '#6b7280' }}>{slitWidth} px</span>
                  </div>
                  <Slider value={[slitWidth]} onValueChange={([v]) => setSlitWidth(v)} min={2} max={40} step={1} />
                </div>
              )}

              {(apertureMode === 'double_slit' || apertureMode === 'grating') && (
                <div style={{ marginBottom: '6px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Label style={{ fontSize: '11px', color: '#2d3142' }}>{apertureMode === 'grating' ? '光栅周期' : '缝间距'}</Label>
                    <span className="tabular-nums" style={{ fontSize: '10px', color: '#6b7280' }}>{apertureMode === 'grating' ? gratingPeriod : slitSeparation} px</span>
                  </div>
                  {apertureMode === 'grating' ? (
                    <Slider value={[gratingPeriod]} onValueChange={([v]) => setGratingPeriod(v)} min={10} max={80} step={1} />
                  ) : (
                    <Slider value={[slitSeparation]} onValueChange={([v]) => setSlitSeparation(v)} min={10} max={80} step={1} />
                  )}
                </div>
              )}

              {apertureMode === 'grating' && (
                <div style={{ marginBottom: '6px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Label style={{ fontSize: '11px', color: '#2d3142' }}>缝数</Label>
                    <span className="tabular-nums" style={{ fontSize: '10px', color: '#6b7280' }}>{numGratingSlits}</span>
                  </div>
                  <Slider value={[numGratingSlits]} onValueChange={([v]) => setNumGratingSlits(v)} min={2} max={30} step={1} />
                </div>
              )}

              {apertureMode === 'polygon' && (
                <PolygonDrawCanvas
                  vertices={polygonVertices}
                  onVerticesChange={setPolygonVertices}
                  gridSize={GRID_SIZE}
                />
              )}

              {/* Gaussian Apodization */}
              <SectionTitle>高斯切趾</SectionTitle>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <input type="range" min="0" max="20" step="1" value={apodizationWidth}
                  onChange={e => setApodizationWidth(Number(e.target.value))}
                  style={{ flex: 1, accentColor: '#333333' }}
                />
                <span className="tabular-nums" style={{ fontSize: '10px', fontWeight: 600, color: '#1A1A1A', fontFamily: FONT, minWidth: '28px' }}>
                  {apodizationWidth}%
                </span>
              </div>
              <div style={{ fontSize: '8px', color: '#888888', fontFamily: FONT }}>
                0% = 硬边界，{'>'}0 = 高斯软边减振铃
              </div>
            </>
          )}

          {/* Rayleigh mode controls */}
          {expMode === 'rayleigh' && (
            <>
              <SectionTitle>点源间距</SectionTitle>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <input type="range" min="0.02" max="0.3" step="0.005" value={pointSeparation}
                  onChange={e => setPointSeparation(Number(e.target.value))}
                  style={{ flex: 1, accentColor: '#333333' }}
                />
                <span className="tabular-nums" style={{ fontSize: '10px', fontWeight: 600, color: '#1A1A1A', fontFamily: FONT, minWidth: '40px' }}>
                  {pointSeparation.toFixed(3)}
                </span>
              </div>
            </>
          )}

          {/* Hologram mode controls */}
          {expMode === 'hologram' && (
            <>
              <SectionTitle>全息图图案</SectionTitle>
              <div style={{ display: 'flex', gap: '4px', marginBottom: '6px' }}>
                {(['F', 'cross', 'circle'] as const).map(p => (
                  <button key={p} onClick={() => setHoloPattern(p)} style={{
                    fontSize: '10px', padding: '4px 10px', borderRadius: '2px',
                    border: `1px solid ${holoPattern === p ? '#333333' : '#D0D0D0'}`,
                    backgroundColor: holoPattern === p ? '#F0F3F6' : '#FFFFFF',
                    color: '#1A1A1A', cursor: 'pointer', fontFamily: FONT,
                  }}>
                    {p === 'F' ? '字母F' : p === 'cross' ? '十字' : '圆形'}
                  </button>
                ))}
              </div>
              <SectionTitle>参考光角度</SectionTitle>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <input type="range" min="1" max="20" step="0.5" value={referenceAngle}
                  onChange={e => setReferenceAngle(Number(e.target.value))}
                  style={{ flex: 1, accentColor: '#333333' }}
                />
                <span className="tabular-nums" style={{ fontSize: '10px', fontWeight: 600, color: '#1A1A1A', fontFamily: FONT, minWidth: '32px' }}>
                  {referenceAngle}°
                </span>
              </div>
            </>
          )}

          {/* Display Options */}
          <SectionTitle>显示选项</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div>
              <Label style={{ fontSize: '10px', color: '#555555', marginBottom: '4px', display: 'block' }}>色彩映射</Label>
              <Select value={colorMode} onValueChange={v => setColorMode(v as ColorMode)}>
                <SelectTrigger className="h-7 text-[10px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="wavelength">波长着色 (物理真实)</SelectItem>
                  <SelectItem value="inverted">反色 (白底黑线)</SelectItem>
                  <SelectItem value="grayscale">灰度</SelectItem>
                  <SelectItem value="blue-white">蓝白映射</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', color: '#555555', fontFamily: FONT, cursor: 'pointer' }}>
              <Switch checked={showSlice} onCheckedChange={setShowSlice} />
              显示剖切曲线
            </label>

            {expMode === 'basic' && (
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', color: '#555555', fontFamily: FONT, cursor: 'pointer' }}>
                <Switch checked={useVectorDiffraction} onCheckedChange={setUseVectorDiffraction} />
                矢量衍射 (Ex/Ey/Ez)
              </label>
            )}
          </div>

          {/* Polarization angle (only in vector mode) */}
          {useVectorDiffraction && expMode === 'basic' && (
            <>
              <SectionTitle>偏振方向</SectionTitle>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <input type="range" min="0" max="180" step="1" value={polarizationAngle}
                  onChange={e => setPolarizationAngle(Number(e.target.value))}
                  style={{ flex: 1, accentColor: '#333333' }}
                />
                <span className="tabular-nums" style={{ fontSize: '10px', fontWeight: 600, color: '#1A1A1A', fontFamily: FONT, minWidth: '32px' }}>
                  {polarizationAngle}°
                </span>
              </div>
              <div style={{ fontSize: '8px', color: '#888888', fontFamily: FONT }}>
                0° = x偏振, 90° = y偏振
              </div>
            </>
          )}

          {/* Physics info */}
          <SectionTitle>物理参数</SectionTitle>
          <div style={{
            backgroundColor: '#FFFFFF', border: '1px solid #D0D0D0',
            borderRadius: '2px', padding: '8px', fontSize: '9px',
            fontFamily: FONT, lineHeight: '1.8',
          }}>
            <div style={{ color: '#555555' }}>波长 λ: <span className="tabular-nums" style={{ color: '#1A1A1A', fontWeight: 600 }}>{wavelengthNm.toFixed(1)} nm</span></div>
            <div style={{ color: '#555555' }}>传播距离 z: <span className="tabular-nums" style={{ color: '#1A1A1A', fontWeight: 600 }}>{distanceMm} mm</span></div>
            <div style={{ color: '#555555' }}>口径面尺寸: <span className="tabular-nums" style={{ color: '#1A1A1A', fontWeight: 600 }}>{fieldSizeUm} μm</span></div>
            <div style={{ color: '#555555' }}>菲涅耳数 N<sub>F</sub>: <span className="tabular-nums" style={{ color: '#1A1A1A', fontWeight: 600 }}>{fresnelNumber.toFixed(2)}</span></div>
            <div style={{ color: '#555555' }}>衍射区域: <span style={{ color: region === 'fraunhofer' ? '#2D7D46' : region === 'fresnel' ? '#B8860B' : '#CC0000', fontWeight: 600 }}>
              {region === 'fraunhofer' ? '夫琅禾费' : region === 'fresnel' ? '菲涅耳' : '近场'}
            </span></div>
            <div style={{ color: '#555555' }}>FFT分辨率: <span className="tabular-nums" style={{ color: '#1A1A1A', fontWeight: 600 }}>{GRID_SIZE}×{GRID_SIZE}</span></div>
          </div>

          {/* Theory card */}
          <SectionTitle>原理说明</SectionTitle>
          <div style={{ fontSize: '8px', color: '#888888', fontFamily: FONT, lineHeight: '1.7' }}>
            <div>• 角谱衍射理论 (Angular Spectrum Method)</div>
            <div>• H(fx,fy,z) = exp(ikz√(1-(λfx)²-(λfy)²))</div>
            <div>• 传播因子: 菲涅耳近似→精确传递函数</div>
            <div>• 矢量衍射: 从∇·E=0推导Ez分量</div>
            <div>• 菲涅耳数: N<sub>F</sub> = a²/(λz)</div>
            <div>• N<sub>F</sub> &lt; 0.5 夫琅禾费区</div>
            <div>• N<sub>F</sub> ≈ 1 菲涅耳区</div>
            <div>• N<sub>F</sub> &gt; 5 近场区</div>
            <div>• 高斯切趾减少振铃伪影</div>
            <div>• 巴比涅: I<sub>孔</sub>+I<sub>盘</sub>=常数(轴外)</div>
            <div>• 瑞利判据: δ = 1.22λz/D</div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 flex items-center mt-auto" style={{
        height: '24px', backgroundColor: '#FFFFFF',
        borderTop: '1px solid #CCCCCC', paddingLeft: '24px',
      }}>
        <span className="tabular-nums" style={{ fontFamily: FONT, fontSize: '10px', color: '#888888' }}>
          v2.0 · 角谱衍射理论 + 矢量衍射 + 巴比涅/光栅/瑞利/全息
        </span>
      </div>
    </div>
  )
}
