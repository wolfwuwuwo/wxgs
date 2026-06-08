'use client'

import { useState, useMemo } from 'react'
import { Slider } from '@/components/ui/slider'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

/* ═══════════════════════════════════════════════
   PRISM SPECTROMETER (棱镜光谱仪)
   v2.1 · 几何光学模块 — 棱镜分光·色散曲线·光谱分析
   ═══════════════════════════════════════════════ */

const FONT = 'var(--font-ibm-plex-sans), system-ui, sans-serif'

// ─── Types ───
type ExpMode = 'basic' | 'minDeviation' | 'spectral' | 'prismSystem'
type Material = 'BK7' | 'F2' | 'SF11' | 'custom'
type LightSource = 'white' | 'Hg' | 'Na' | 'H' | 'HeNe'

// ─── Cauchy Dispersion Coefficients ───
const CAUCHY: Record<string, { A: number; B: number; C: number }> = {
  BK7:  { A: 1.5046, B: 0.00420, C: 0 },
  F2:   { A: 1.6127, B: 0.01030, C: 0 },
  SF11: { A: 1.7432, B: 0.01342, C: 0 },
  custom: { A: 1.50, B: 0.005, C: 0 },
}

// ─── Spectral Lines (nm) ───
const SPECTRAL_LINES: Record<string, { wavelength: number; label: string; element: string }[]> = {
  Hg: [
    { wavelength: 404.7, label: 'h', element: 'Hg' },
    { wavelength: 435.8, label: 'g', element: 'Hg' },
    { wavelength: 546.1, label: 'e', element: 'Hg' },
    { wavelength: 577.0, label: 'D₁', element: 'Hg' },
    { wavelength: 579.1, label: 'D₂', element: 'Hg' },
  ],
  Na: [
    { wavelength: 589.0, label: 'D₁', element: 'Na' },
    { wavelength: 589.6, label: 'D₂', element: 'Na' },
  ],
  H: [
    { wavelength: 410.2, label: 'Hδ', element: 'H' },
    { wavelength: 434.0, label: 'Hγ', element: 'H' },
    { wavelength: 486.1, label: 'Hβ', element: 'H' },
    { wavelength: 656.3, label: 'Hα', element: 'H' },
  ],
  HeNe: [
    { wavelength: 632.8, label: 'He-Ne', element: 'HeNe' },
  ],
  white: [
    { wavelength: 400, label: '400', element: '' },
    { wavelength: 450, label: '450', element: '' },
    { wavelength: 500, label: '500', element: '' },
    { wavelength: 550, label: '550', element: '' },
    { wavelength: 600, label: '600', element: '' },
    { wavelength: 650, label: '650', element: '' },
    { wavelength: 700, label: '700', element: '' },
  ],
}

// ─── Physics Functions ───

/** Cauchy dispersion: n(λ) = A + B/λ² + C/λ⁴, λ in μm */
function cauchyN(lambdaNm: number, A: number, B: number, C: number): number {
  const lam = lambdaNm / 1000 // nm → μm
  return A + B / (lam * lam) + C / (lam * lam * lam * lam)
}

/** dn/dλ in μm⁻¹ */
function cauchyDnDlambda(lambdaNm: number, B: number, C: number): number {
  const lam = lambdaNm / 1000
  return -2 * B / (lam * lam * lam) - 4 * C / (lam * lam * lam * lam * lam)
}

/** Snell's law: n₁ sin(θ₁) = n₂ sin(θ₂). Returns null on TIR. */
function snellAngle(n1: number, n2: number, theta1: number): number | null {
  const sinTheta2 = (n1 / n2) * Math.sin(theta1)
  if (Math.abs(sinTheta2) > 1) return null
  return Math.asin(sinTheta2)
}

/** Compute full prism deviation for a given wavelength */
function computePrismRefraction(
  apexAngleDeg: number,
  incidenceDeg: number,
  lambdaNm: number,
  cauchyA: number,
  cauchyB: number,
  cauchyC: number,
): {
  deviation: number       // rad
  exitAngle: number       // rad
  r1: number | null       // first refraction angle
  r2: number | null       // second refraction angle (inside prism)
  i2: number | null       // exit incidence angle
  totalInternalReflection: boolean
  n: number
} {
  const n = cauchyN(lambdaNm, cauchyA, cauchyB, cauchyC)
  const A = (apexAngleDeg * Math.PI) / 180
  const i1 = (incidenceDeg * Math.PI) / 180

  const r1 = snellAngle(1, n, i1)
  if (r1 === null) return { deviation: 0, exitAngle: 0, r1: null, r2: null, i2: null, totalInternalReflection: true, n }

  const r2 = A - r1
  if (r2 < 0) return { deviation: 0, exitAngle: 0, r1, r2: null, i2: null, totalInternalReflection: true, n }

  const i2 = snellAngle(n, 1, r2)
  if (i2 === null) return { deviation: 0, exitAngle: 0, r1, r2, i2: null, totalInternalReflection: true, n }

  const deviation = i1 + i2 - A
  return { deviation, exitAngle: i2, r1, r2, i2, totalInternalReflection: false, n }
}

/** Minimum deviation angle for a given wavelength */
function computeMinDeviation(apexAngleDeg: number, lambdaNm: number, cauchyA: number, cauchyB: number, cauchyC: number): {
  deviation: number
  incidenceDeg: number
  n: number
} {
  const n = cauchyN(lambdaNm, cauchyA, cauchyB, cauchyC)
  const A = (apexAngleDeg * Math.PI) / 180
  const sinVal = n * Math.sin(A / 2)
  if (Math.abs(sinVal) > 1) return { deviation: 0, incidenceDeg: 0, n }
  const iMin = Math.asin(sinVal)
  return {
    deviation: 2 * iMin - A,
    incidenceDeg: (iMin * 180) / Math.PI,
    n,
  }
}

/** Resolving power R = b · |dn/dλ| */
function computeResolvingPower(baseLengthMm: number, lambdaNm: number, cauchyB: number, cauchyC: number): number {
  const b = baseLengthMm / 1000 // mm → m
  const dnDl = cauchyDnDlambda(lambdaNm, cauchyB, cauchyC) // μm⁻¹
  return Math.abs(b * dnDl * 1e6) // convert μm⁻¹ to m⁻¹
}

// ─── Wavelength to RGB ───
function wavelengthToRGB(wavelength: number): { r: number; g: number; b: number } {
  let r = 0, g = 0, b = 0

  if (wavelength >= 380 && wavelength < 440) {
    r = -(wavelength - 440) / (440 - 380)
    b = 1.0
  } else if (wavelength >= 440 && wavelength < 490) {
    g = (wavelength - 440) / (490 - 440)
    b = 1.0
  } else if (wavelength >= 490 && wavelength < 510) {
    g = 1.0
    b = -(wavelength - 510) / (510 - 490)
  } else if (wavelength >= 510 && wavelength < 580) {
    r = (wavelength - 510) / (580 - 510)
    g = 1.0
  } else if (wavelength >= 580 && wavelength < 645) {
    r = 1.0
    g = -(wavelength - 645) / (645 - 580)
  } else if (wavelength >= 645 && wavelength <= 780) {
    r = 1.0
  }

  // Intensity falloff at edges
  let factor = 1.0
  if (wavelength >= 380 && wavelength < 420) {
    factor = 0.3 + 0.7 * (wavelength - 380) / (420 - 380)
  } else if (wavelength >= 700 && wavelength <= 780) {
    factor = 0.3 + 0.7 * (780 - wavelength) / (780 - 700)
  } else if (wavelength < 380 || wavelength > 780) {
    factor = 0
  }

  return {
    r: Math.round(255 * r * factor),
    g: Math.round(255 * g * factor),
    b: Math.round(255 * b * factor),
  }
}

function rgbStr(wavelength: number): string {
  const c = wavelengthToRGB(wavelength)
  return `rgb(${c.r},${c.g},${c.b})`
}

function rgbStrAlpha(wavelength: number, alpha: number): string {
  const c = wavelengthToRGB(wavelength)
  return `rgba(${c.r},${c.g},${c.b},${alpha})`
}

// ─── SVG Helpers ───
const SVG_W = 680
const SVG_H = 400

/** Draw an arc path for angle annotation */
function arcPath(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  const x1 = cx + r * Math.cos(startAngle)
  const y1 = cy + r * Math.sin(startAngle)
  const x2 = cx + r * Math.cos(endAngle)
  const y2 = cy + r * Math.sin(endAngle)
  const largeArc = Math.abs(endAngle - startAngle) > Math.PI ? 1 : 0
  const sweep = endAngle > startAngle ? 1 : 0
  return `M${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 ${largeArc},${sweep} ${x2.toFixed(1)},${y2.toFixed(1)}`
}

// ─── Sub-Components ───

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: '11px', fontWeight: 600, textTransform: 'uppercase',
      letterSpacing: '0.08em', color: '#6b7280', fontFamily: FONT,
      marginTop: '16px', marginBottom: '6px',
    }}>
      {children}
    </div>
  )
}

function ReadoutBox({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{
      padding: '6px 10px', border: '1px solid #E8ECF0', borderRadius: '2px',
      backgroundColor: '#FAFAFA', minWidth: '100px',
    }}>
      <div style={{ fontSize: '9px', color: '#888888', fontFamily: FONT }}>{label}</div>
      <div className="tabular-nums" style={{
        fontSize: '14px', fontWeight: 600, color, fontFamily: FONT, marginTop: '2px',
      }}>
        {value}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════
//  MODE 1: 基本分光 (Basic Dispersion)
// ═══════════════════════════════════════════════

function BasicDispersionMode({
  apexAngle, incAngle, material, customA, customB, customC, baseLength,
}: {
  apexAngle: number; incAngle: number; material: Material;
  customA: number; customB: number; customC: number; baseLength: number;
}) {
  const cauchyA = material === 'custom' ? customA : CAUCHY[material].A
  const cauchyB = material === 'custom' ? customB : CAUCHY[material].B
  const cauchyC = material === 'custom' ? customC : CAUCHY[material].C
  const refWavelength = 550 // reference wavelength nm

  // Compute refraction for key wavelengths
  const dispersionWavelengths = useMemo(() => {
    const wavelengths = []
    for (let lam = 400; lam <= 700; lam += 10) {
      wavelengths.push(lam)
    }
    return wavelengths
  }, [])

  // Reference refraction (for the main ray)
  const refRefraction = useMemo(() =>
    computePrismRefraction(apexAngle, incAngle, refWavelength, cauchyA, cauchyB, cauchyC),
    [apexAngle, incAngle, cauchyA, cauchyB, cauchyC]
  )

  // Compute dispersed rays for display wavelengths
  const dispersedRays = useMemo(() => {
    return dispersionWavelengths.map(lam => ({
      wavelength: lam,
      ...computePrismRefraction(apexAngle, incAngle, lam, cauchyA, cauchyB, cauchyC),
    }))
  }, [apexAngle, incAngle, cauchyA, cauchyB, cauchyC, dispersionWavelengths])

  // Resolving power
  const resolvingPower = useMemo(() =>
    computeResolvingPower(baseLength, refWavelength, cauchyB, cauchyC),
    [baseLength, refWavelength, cauchyB, cauchyC]
  )

  // Min deviation
  const minDev = useMemo(() =>
    computeMinDeviation(apexAngle, refWavelength, cauchyA, cauchyB, cauchyC),
    [apexAngle, refWavelength, cauchyA, cauchyB, cauchyC]
  )

  // Angular dispersion at reference wavelength
  const angularDispersion = useMemo(() => {
    const lam1 = refWavelength - 5
    const lam2 = refWavelength + 5
    const ref1 = computePrismRefraction(apexAngle, incAngle, lam1, cauchyA, cauchyB, cauchyC)
    const ref2 = computePrismRefraction(apexAngle, incAngle, lam2, cauchyA, cauchyB, cauchyC)
    if (ref1.totalInternalReflection || ref2.totalInternalReflection) return 0
    return Math.abs((ref2.deviation - ref1.deviation) / (lam2 - lam1)) * (180 / Math.PI) // deg/nm
  }, [apexAngle, incAngle, cauchyA, cauchyB, cauchyC])

  // SVG prism geometry
  const prismCx = 300
  const prismCy = 200
  const prismSize = 90
  const A_rad = (apexAngle * Math.PI) / 180
  const halfA = A_rad / 2

  // Prism vertices: apex at top
  const apexX = prismCx
  const apexY = prismCy - prismSize * Math.cos(halfA)
  const leftBaseX = prismCx - prismSize * Math.sin(halfA)
  const leftBaseY = prismCy + prismSize * 0.35
  const rightBaseX = prismCx + prismSize * Math.sin(halfA)
  const rightBaseY = leftBaseY

  // Left face: from apex to leftBase
  // Left face normal direction (outward): perpendicular to left face, pointing left
  const leftFaceAngle = Math.atan2(leftBaseY - apexY, leftBaseX - apexX) // angle of left face
  const leftNormalAngle = leftFaceAngle - Math.PI / 2 // outward normal

  // Hit point on left face (at 55% from apex)
  const hitFrac = 0.55
  const hitLeftX = apexX + hitFrac * (leftBaseX - apexX)
  const hitLeftY = apexY + hitFrac * (leftBaseY - apexY)

  // Right face: from apex to rightBase
  const rightFaceAngle = Math.atan2(rightBaseY - apexY, rightBaseX - apexX)
  const rightNormalAngle = rightFaceAngle + Math.PI / 2 // outward normal

  // Exit hit point (will be computed based on internal ray)
  // For the exit, compute where internal ray hits right face
  const internalRayExit = useMemo(() => {
    if (refRefraction.totalInternalReflection || refRefraction.r1 === null) return null

    // Direction of refracted ray inside prism
    // The incident ray hits the left face. The refracted ray goes inside.
    // The internal ray direction relative to the left face normal (pointing inward)
    const inwardNormalAngle = leftNormalAngle + Math.PI
    const internalAngle = refRefraction.r1 // angle from inward normal
    const internalDir = inwardNormalAngle + internalAngle // direction of ray inside

    // Find intersection with right face
    const dx = Math.cos(internalDir)
    const dy = Math.sin(internalDir)

    // Right face: parametric line from apex to rightBase
    const rdx = rightBaseX - apexX
    const rdy = rightBaseY - apexY

    // Solve: hitLeftX + t*dx = apexX + s*rdx
    //        hitLeftY + t*dy = apexY + s*rdy
    const det = dx * rdy - dy * rdx
    if (Math.abs(det) < 1e-10) return null

    const t = ((apexX - hitLeftX) * rdy - (apexY - hitLeftY) * rdx) / det
    const s = ((apexX - hitLeftX) * dy - (apexY - hitLeftY) * dx) / det

    if (t < 0 || s < 0 || s > 1) return null

    const exitX = hitLeftX + t * dx
    const exitY = hitLeftY + t * dy

    return { exitX, exitY, internalDir, s }
  }, [refRefraction, hitLeftX, hitLeftY, apexX, apexY, rightBaseX, rightBaseY])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', width: '100%' }}>
      {/* Main SVG */}
      <svg width={SVG_W} height={SVG_H} viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        style={{ border: '1px solid #D0D0D0', backgroundColor: '#FFFFFF' }}>

        {/* Prism triangle */}
        <polygon
          points={`${apexX},${apexY} ${leftBaseX},${leftBaseY} ${rightBaseX},${rightBaseY}`}
          fill="#f0f4f8" stroke="#333333" strokeWidth="1.5" />

        {/* Apex angle label */}
        <text x={apexX} y={apexY - 8} textAnchor="middle" fontSize="10"
          fill="#555555" fontFamily={FONT} className="tabular-nums">
          A = {apexAngle}°
        </text>

        {/* ─── Incident ray (white) ─── */}
        {(() => {
          // Incident direction: from upper-left toward hit point
          // The angle of incidence is measured from the normal to the left face
          // Normal to left face pointing outward: leftNormalAngle
          // Incident ray comes from the direction: leftNormalAngle + PI + incAngle (from the other side of normal)
          // Actually, incident ray direction is such that angle between incoming ray and outward normal = incAngle
          // Outward normal angle of left face
          const incDir = leftNormalAngle + Math.PI - ((incAngle * Math.PI) / 180) // direction FROM which ray comes
          const rayStartX = hitLeftX + 160 * Math.cos(incDir)
          const rayStartY = hitLeftY + 160 * Math.sin(incDir)
          return (
            <>
              {/* White light band */}
              <line x1={rayStartX} y1={rayStartY} x2={hitLeftX} y2={hitLeftY}
                stroke="#cccccc" strokeWidth="5" />
              {/* White light core */}
              <line x1={rayStartX} y1={rayStartY} x2={hitLeftX} y2={hitLeftY}
                stroke="#ffffff" strokeWidth="2.5" />
              {/* Arrow at hit point */}
              <polygon points={`${hitLeftX},${hitLeftY} ${hitLeftX - 8 * Math.cos(incDir) + 3 * Math.sin(incDir)},${hitLeftY - 8 * Math.sin(incDir) - 3 * Math.cos(incDir)} ${hitLeftX - 8 * Math.cos(incDir) - 3 * Math.sin(incDir)},${hitLeftY - 8 * Math.sin(incDir) + 3 * Math.cos(incDir)}`}
                fill="#888888" />
              {/* Label */}
              <text x={(rayStartX + hitLeftX) / 2} y={(rayStartY + hitLeftY) / 2 - 6}
                textAnchor="middle" fontSize="9" fill="#888888" fontFamily={FONT}>白光</text>
            </>
          )
        })()}

        {/* Normal line at left surface */}
        <line
          x1={hitLeftX - 40 * Math.cos(leftNormalAngle)}
          y1={hitLeftY - 40 * Math.sin(leftNormalAngle)}
          x2={hitLeftX + 40 * Math.cos(leftNormalAngle)}
          y2={hitLeftY + 40 * Math.sin(leftNormalAngle)}
          stroke="#888888" strokeWidth="0.5" strokeDasharray="4,3" />
        <text
          x={hitLeftX + 50 * Math.cos(leftNormalAngle)}
          y={hitLeftY + 50 * Math.sin(leftNormalAngle) - 4}
          fontSize="8" fill="#888888" fontFamily={FONT}>N</text>

        {/* Angle of incidence arc */}
        {(() => {
          const normalDir = leftNormalAngle + Math.PI // inward normal direction
          const incDir = leftNormalAngle + Math.PI - ((incAngle * Math.PI) / 180)
          // Draw arc from normal to incident ray direction (reversed)
          const startA = normalDir
          const endA = incDir
          return (
            <path d={arcPath(hitLeftX, hitLeftY, 25, startA, endA)}
              fill="none" stroke="#CC0000" strokeWidth="0.8" />
          )
        })()}
        <text
          x={hitLeftX - 55 * Math.cos(leftNormalAngle + Math.PI / 2)}
          y={hitLeftY - 55 * Math.sin(leftNormalAngle + Math.PI / 2) - 2}
          fontSize="9" fill="#CC0000" fontFamily={FONT}>
          θᵢ = {incAngle}°
        </text>

        {/* ─── Internal ray ─── */}
        {internalRayExit && !refRefraction.totalInternalReflection && (
          <>
            {/* Internal ray - colored band */}
            <line x1={hitLeftX} y1={hitLeftY}
              x2={internalRayExit.exitX} y2={internalRayExit.exitY}
              stroke="#dddddd" strokeWidth="3" />
            <line x1={hitLeftX} y1={hitLeftY}
              x2={internalRayExit.exitX} y2={internalRayExit.exitY}
              stroke="#ffffff" strokeWidth="1.5" />
          </>
        )}

        {/* ─── Normal line at right surface ─── */}
        {internalRayExit && (
          <>
            <line
              x1={internalRayExit.exitX - 40 * Math.cos(rightNormalAngle)}
              y1={internalRayExit.exitY - 40 * Math.sin(rightNormalAngle)}
              x2={internalRayExit.exitX + 40 * Math.cos(rightNormalAngle)}
              y2={internalRayExit.exitY + 40 * Math.sin(rightNormalAngle)}
              stroke="#888888" strokeWidth="0.5" strokeDasharray="4,3" />
            <text
              x={internalRayExit.exitX + 50 * Math.cos(rightNormalAngle)}
              y={internalRayExit.exitY + 50 * Math.sin(rightNormalAngle) - 4}
              fontSize="8" fill="#888888" fontFamily={FONT}>N&apos;</text>
          </>
        )}

        {/* ─── Dispersed exit rays ─── */}
        {internalRayExit && dispersedRays.map((ray, idx) => {
          if (ray.totalInternalReflection) return null
          // Exit direction: measured from right face outward normal
          const outwardNormalAngle = rightNormalAngle
          // The exit ray makes angle i2 with the outward normal
          if (ray.i2 === null) return null
          // Exit direction is rotated from outward normal by i2
          const exitDir = outwardNormalAngle + ray.i2
          const rayLen = 160
          const endX = internalRayExit.exitX + rayLen * Math.cos(exitDir)
          const endY = internalRayExit.exitY + rayLen * Math.sin(exitDir)
          const isRef = ray.wavelength === refWavelength
          return (
            <g key={idx}>
              <line
                x1={internalRayExit.exitX} y1={internalRayExit.exitY}
                x2={endX} y2={endY}
                stroke={rgbStr(ray.wavelength)} strokeWidth={isRef ? 2.5 : 1.8}
                opacity={isRef ? 1 : 0.75} />
              {/* Arrow tip at the end of reference ray */}
              {isRef && (
                <polygon points={`${endX},${endY} ${endX - 8 * Math.cos(exitDir) + 3 * Math.sin(exitDir)},${endY - 8 * Math.sin(exitDir) - 3 * Math.cos(exitDir)} ${endX - 8 * Math.cos(exitDir) - 3 * Math.sin(exitDir)},${endY - 8 * Math.sin(exitDir) + 3 * Math.cos(exitDir)}`}
                  fill={rgbStr(ray.wavelength)} />
              )}
            </g>
          )
        })}

        {/* Deviation angle label */}
        {!refRefraction.totalInternalReflection && (
          <text x={SVG_W - 10} y={20} textAnchor="end" fontSize="10"
            fill="#333333" fontFamily={FONT} className="tabular-nums">
            δ = {(refRefraction.deviation * 180 / Math.PI).toFixed(1)}°
          </text>
        )}

        {/* TIR indicator */}
        {refRefraction.totalInternalReflection && (
          <text x={prismCx} y={prismCy + 80} textAnchor="middle" fontSize="12"
            fill="#CC0000" fontFamily={FONT}>全内反射</text>
        )}

        {/* Material label */}
        <text x={10} y={SVG_H - 10} fontSize="9" fill="#888888" fontFamily={FONT}>
          {material === 'custom' ? `自定义 n(A=${customA})` : `${material} 玻璃`}
        </text>
        <text x={10} y={SVG_H - 24} fontSize="9" fill="#888888" fontFamily={FONT} className="tabular-nums">
          n({refWavelength}nm) = {cauchyN(refWavelength, cauchyA, cauchyB, cauchyC).toFixed(4)}
        </text>
      </svg>

      {/* Spectrum Bar */}
      <div style={{ width: SVG_W, border: '1px solid #D0D0D0', backgroundColor: '#FFFFFF', padding: '8px' }}>
        <div style={{ fontSize: '9px', color: '#888888', fontFamily: FONT, marginBottom: '4px' }}>色散光谱</div>
        <svg width={SVG_W - 16} height="24" viewBox={`0 0 ${SVG_W - 16} 24`}>
          {dispersionWavelengths.map((lam, idx) => {
            const x = ((lam - 380) / (700 - 380)) * (SVG_W - 16)
            const width = (SVG_W - 16) / dispersionWavelengths.length
            return (
              <rect key={idx} x={x} y="0" width={width + 0.5} height="16"
                fill={rgbStr(lam)} />
            )
          })}
          {/* Wavelength labels */}
          {[400, 450, 500, 550, 600, 650, 700].map(lam => {
            const x = ((lam - 380) / (700 - 380)) * (SVG_W - 16)
            return (
              <text key={lam} x={x} y="22" textAnchor="middle" fontSize="7"
                fill="#888888" fontFamily={FONT} className="tabular-nums">
                {lam}
              </text>
            )
          })}
        </svg>
      </div>

      {/* Readouts */}
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
        <ReadoutBox label="偏向角 δ" value={refRefraction.totalInternalReflection ? '全内反射' : `${(refRefraction.deviation * 180 / Math.PI).toFixed(2)}°`} color="#CC0000" />
        <ReadoutBox label="最小偏向角" value={`${(minDev.deviation * 180 / Math.PI).toFixed(2)}°`} color="#00AA44" />
        <ReadoutBox label="角色散" value={`${angularDispersion.toFixed(4)}°/nm`} color="#3355BB" />
        <ReadoutBox label="分辨本领 R" value={resolvingPower.toFixed(0)} color="#555555" />
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════
//  MODE 2: 最小偏向角 (Minimum Deviation)
// ═══════════════════════════════════════════════

function MinDeviationMode({
  apexAngle, incAngle, material, customA, customB, customC, baseLength,
}: {
  apexAngle: number; incAngle: number; material: Material;
  customA: number; customB: number; customC: number; baseLength: number;
}) {
  const cauchyA = material === 'custom' ? customA : CAUCHY[material].A
  const cauchyB = material === 'custom' ? customB : CAUCHY[material].B
  const cauchyC = material === 'custom' ? customC : CAUCHY[material].C
  const refWavelength = 550

  // Compute deviation vs incidence angle curve
  const devCurve = useMemo(() => {
    const points: { incDeg: number; devDeg: number; tir: boolean }[] = []
    for (let inc = 15; inc <= 85; inc += 0.5) {
      const ref = computePrismRefraction(apexAngle, inc, refWavelength, cauchyA, cauchyB, cauchyC)
      points.push({
        incDeg: inc,
        devDeg: ref.totalInternalReflection ? NaN : (ref.deviation * 180) / Math.PI,
        tir: ref.totalInternalReflection,
      })
    }
    return points
  }, [apexAngle, cauchyA, cauchyB, cauchyC])

  // Current point on curve
  const currentDeviation = useMemo(() =>
    computePrismRefraction(apexAngle, incAngle, refWavelength, cauchyA, cauchyB, cauchyC),
    [apexAngle, incAngle, cauchyA, cauchyB, cauchyC]
  )

  // Min deviation
  const minDev = useMemo(() =>
    computeMinDeviation(apexAngle, refWavelength, cauchyA, cauchyB, cauchyC),
    [apexAngle, refWavelength, cauchyA, cauchyB, cauchyC]
  )

  // Compute n from measured min deviation (if user finds it)
  // n = sin((A + δ_min) / 2) / sin(A / 2)
  const measuredN = useMemo(() => {
    const A_rad = (apexAngle * Math.PI) / 180
    const dMin_rad = minDev.deviation
    const sinVal = Math.sin((A_rad + dMin_rad) / 2) / Math.sin(A_rad / 2)
    return sinVal
  }, [apexAngle, minDev.deviation])

  // n(λ) curve data
  const nCurve = useMemo(() => {
    const points: { lam: number; n: number }[] = []
    for (let lam = 380; lam <= 780; lam += 5) {
      points.push({ lam, n: cauchyN(lam, cauchyA, cauchyB, cauchyC) })
    }
    return points
  }, [cauchyA, cauchyB, cauchyC])

  // SVG dimensions for curves
  const curveW = 320
  const curveH = 200
  const padL = 45
  const padR = 15
  const padT = 20
  const padB = 30

  // Deviation curve scaling
  const devMin = Math.min(...devCurve.filter(p => !p.tir).map(p => p.devDeg).filter(v => !isNaN(v)))
  const devMax = Math.max(...devCurve.filter(p => !p.tir && p.devDeg > 0).map(p => p.devDeg).filter(v => !isNaN(v)))
  const devRange = devMax - devMin || 1

  // n(λ) curve scaling
  const nMin = Math.min(...nCurve.map(p => p.n))
  const nMax = Math.max(...nCurve.map(p => p.n))
  const nRange = nMax - nMin || 0.01

  // How close is current incidence to min deviation?
  const currentDevDeg = currentDeviation.totalInternalReflection ? NaN : (currentDeviation.deviation * 180 / Math.PI)
  const deviationFromMin = isNaN(currentDevDeg) ? NaN : Math.abs(currentDevDeg - (minDev.deviation * 180 / Math.PI))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', width: '100%' }}>
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
        {/* Deviation vs Incidence curve */}
        <svg width={curveW} height={curveH} viewBox={`0 0 ${curveW} ${curveH}`}
          style={{ border: '1px solid #D0D0D0', backgroundColor: '#FFFFFF' }}>
          {/* Axes */}
          <line x1={padL} y1={padT} x2={padL} y2={curveH - padB} stroke="#333333" strokeWidth="0.8" />
          <line x1={padL} y1={curveH - padB} x2={curveW - padR} y2={curveH - padB} stroke="#333333" strokeWidth="0.8" />

          {/* Axis labels */}
          <text x={curveW / 2} y={curveH - 4} textAnchor="middle" fontSize="8" fill="#555555" fontFamily={FONT}>
            入射角 i (°)
          </text>
          <text x={8} y={curveH / 2} textAnchor="middle" fontSize="8" fill="#555555" fontFamily={FONT}
            transform={`rotate(-90, 8, ${curveH / 2})`}>
            偏向角 δ (°)
          </text>

          {/* Tick marks on x-axis */}
          {[20, 30, 40, 50, 60, 70, 80].map(deg => {
            const x = padL + ((deg - 15) / (85 - 15)) * (curveW - padL - padR)
            return (
              <g key={deg}>
                <line x1={x} y1={curveH - padB} x2={x} y2={curveH - padB + 4}
                  stroke="#333333" strokeWidth="0.5" />
                <text x={x} y={curveH - padB + 12} textAnchor="middle" fontSize="7"
                  fill="#888888" fontFamily={FONT} className="tabular-nums">{deg}</text>
              </g>
            )
          })}

          {/* Curve */}
          <polyline
            points={devCurve.filter(p => !p.tir && !isNaN(p.devDeg)).map(p => {
              const x = padL + ((p.incDeg - 15) / (85 - 15)) * (curveW - padL - padR)
              const y = padT + (1 - (p.devDeg - devMin) / devRange) * (curveH - padT - padB)
              return `${x.toFixed(1)},${y.toFixed(1)}`
            }).join(' ')}
            fill="none" stroke="#333333" strokeWidth="1.2" />

          {/* Min deviation point */}
          {(() => {
            const x = padL + ((minDev.incidenceDeg - 15) / (85 - 15)) * (curveW - padL - padR)
            const y = padT + (1 - (minDev.deviation * 180 / Math.PI - devMin) / devRange) * (curveH - padT - padB)
            return (
              <g>
                <circle cx={x} cy={y} r="3" fill="#00AA44" />
                <text x={x + 6} y={y - 4} fontSize="7" fill="#00AA44" fontFamily={FONT} className="tabular-nums">
                  δmin = {(minDev.deviation * 180 / Math.PI).toFixed(1)}°
                </text>
              </g>
            )
          })()}

          {/* Current point */}
          {!isNaN(currentDevDeg) && (() => {
            const x = padL + ((incAngle - 15) / (85 - 15)) * (curveW - padL - padR)
            const y = padT + (1 - (currentDevDeg - devMin) / devRange) * (curveH - padT - padB)
            return (
              <circle cx={x} cy={y} r="3.5" fill="none" stroke="#CC0000" strokeWidth="1.5" />
            )
          })()}
        </svg>

        {/* n(λ) curve */}
        <svg width={curveW} height={curveH} viewBox={`0 0 ${curveW} ${curveH}`}
          style={{ border: '1px solid #D0D0D0', backgroundColor: '#FFFFFF' }}>
          {/* Axes */}
          <line x1={padL} y1={padT} x2={padL} y2={curveH - padB} stroke="#333333" strokeWidth="0.8" />
          <line x1={padL} y1={curveH - padB} x2={curveW - padR} y2={curveH - padB} stroke="#333333" strokeWidth="0.8" />

          {/* Axis labels */}
          <text x={curveW / 2} y={curveH - 4} textAnchor="middle" fontSize="8" fill="#555555" fontFamily={FONT}>
            波长 λ (nm)
          </text>
          <text x={8} y={curveH / 2} textAnchor="middle" fontSize="8" fill="#555555" fontFamily={FONT}
            transform={`rotate(-90, 8, ${curveH / 2})`}>
            折射率 n
          </text>

          {/* Tick marks */}
          {[400, 500, 600, 700].map(lam => {
            const x = padL + ((lam - 380) / (780 - 380)) * (curveW - padL - padR)
            return (
              <g key={lam}>
                <line x1={x} y1={curveH - padB} x2={x} y2={curveH - padB + 4}
                  stroke="#333333" strokeWidth="0.5" />
                <text x={x} y={curveH - padB + 12} textAnchor="middle" fontSize="7"
                  fill="#888888" fontFamily={FONT} className="tabular-nums">{lam}</text>
              </g>
            )
          })}

          {/* n ticks */}
          {(() => {
            const ticks: number[] = []
            const step = nRange > 0.05 ? 0.02 : 0.01
            for (let v = Math.ceil(nMin / step) * step; v <= nMax; v += step) {
              ticks.push(v)
            }
            return ticks.map(v => {
              const y = padT + (1 - (v - nMin) / nRange) * (curveH - padT - padB)
              return (
                <g key={v}>
                  <line x1={padL - 4} y1={y} x2={padL} y2={y} stroke="#333333" strokeWidth="0.5" />
                  <text x={padL - 6} y={y + 3} textAnchor="end" fontSize="7"
                    fill="#888888" fontFamily={FONT} className="tabular-nums">{v.toFixed(2)}</text>
                </g>
              )
            })
          })()}

          {/* Curve with wavelength coloring */}
          {nCurve.map((p, idx) => {
            if (idx === 0) return null
            const prev = nCurve[idx - 1]
            const x1 = padL + ((prev.lam - 380) / (780 - 380)) * (curveW - padL - padR)
            const y1 = padT + (1 - (prev.n - nMin) / nRange) * (curveH - padT - padB)
            const x2 = padL + ((p.lam - 380) / (780 - 380)) * (curveW - padL - padR)
            const y2 = padT + (1 - (p.n - nMin) / nRange) * (curveH - padT - padB)
            return (
              <line key={idx} x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={rgbStr(p.lam)} strokeWidth="1.5" />
            )
          })}

          {/* Reference point */}
          {(() => {
            const x = padL + ((refWavelength - 380) / (780 - 380)) * (curveW - padL - padR)
            const nRef = cauchyN(refWavelength, cauchyA, cauchyB, cauchyC)
            const y = padT + (1 - (nRef - nMin) / nRange) * (curveH - padT - padB)
            return <circle cx={x} cy={y} r="3" fill="#333333" />
          })()}
        </svg>
      </div>

      {/* Measurement info */}
      <div style={{
        padding: '10px 16px', border: '1px solid #E8ECF0', borderRadius: '2px',
        backgroundColor: '#FAFAFA', width: SVG_W, fontSize: '10px',
        fontFamily: FONT, color: '#555555', lineHeight: '1.8',
      }}>
        <div className="tabular-nums">
          <span style={{ fontWeight: 600, color: '#1A1A1A' }}>最小偏向角法测折射率:</span>{' '}
          n = sin((A + δmin)/2) / sin(A/2)
        </div>
        <div className="tabular-nums">
          A = {apexAngle}°, δmin = {(minDev.deviation * 180 / Math.PI).toFixed(2)}°
          → n = {measuredN.toFixed(4)}
        </div>
        <div className="tabular-nums">
          对应入射角 i_min = {minDev.incidenceDeg.toFixed(2)}°
          {' | '}当前 i = {incAngle}°, δ = {isNaN(currentDevDeg) ? '全内反射' : `${currentDevDeg.toFixed(2)}°`}
          {!isNaN(deviationFromMin) && (
            <span style={{ color: deviationFromMin < 0.5 ? '#00AA44' : '#CC0000' }}>
              {' '}({deviationFromMin < 0.5 ? '✓ 接近最小偏向角' : `偏差 ${deviationFromMin.toFixed(2)}°`})
            </span>
          )}
        </div>
      </div>

      {/* Readouts */}
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
        <ReadoutBox label="当前偏向角" value={isNaN(currentDevDeg) ? '全内反射' : `${currentDevDeg.toFixed(2)}°`} color="#CC0000" />
        <ReadoutBox label="最小偏向角" value={`${(minDev.deviation * 180 / Math.PI).toFixed(2)}°`} color="#00AA44" />
        <ReadoutBox label="测量折射率" value={measuredN.toFixed(4)} color="#3355BB" />
        <ReadoutBox label="理论折射率" value={cauchyN(refWavelength, cauchyA, cauchyB, cauchyC).toFixed(4)} color="#555555" />
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════
//  MODE 3: 光谱分析 (Spectral Analysis)
// ═══════════════════════════════════════════════

function SpectralAnalysisMode({
  apexAngle, incAngle, material, customA, customB, customC, baseLength, lightSource,
}: {
  apexAngle: number; incAngle: number; material: Material;
  customA: number; customB: number; customC: number; baseLength: number;
  lightSource: LightSource;
}) {
  const cauchyA = material === 'custom' ? customA : CAUCHY[material].A
  const cauchyB = material === 'custom' ? customB : CAUCHY[material].B
  const cauchyC = material === 'custom' ? customC : CAUCHY[material].C
  const lines = SPECTRAL_LINES[lightSource] || SPECTRAL_LINES.white

  // Compute deviation for each spectral line
  const lineDeviations = useMemo(() => {
    return lines.map(line => ({
      ...line,
      ...computePrismRefraction(apexAngle, incAngle, line.wavelength, cauchyA, cauchyB, cauchyC),
    }))
  }, [apexAngle, incAngle, cauchyA, cauchyB, cauchyC, lines])

  // Spectrometer eyepiece view
  const specW = 500
  const specH = 120

  // Map deviation angles to x positions in eyepiece
  const validDeviations = lineDeviations.filter(d => !d.totalInternalReflection)
  const devValues = validDeviations.map(d => d.deviation * 180 / Math.PI)
  const minDevAngle = devValues.length > 0 ? Math.min(...devValues) - 2 : 30
  const maxDevAngle = devValues.length > 0 ? Math.max(...devValues) + 2 : 50
  const devAngleRange = maxDevAngle - minDevAngle || 1

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', width: '100%' }}>

      {/* Spectrometer eyepiece view */}
      <svg width={specW} height={specH} viewBox={`0 0 ${specW} ${specH}`}
        style={{ border: '1px solid #D0D0D0', backgroundColor: '#1a1a2e' }}>
        {/* Crosshair */}
        <line x1={specW / 2} y1={0} x2={specW / 2} y2={specH}
          stroke="#333355" strokeWidth="0.5" strokeDasharray="4,4" />
        <line x1={0} y1={specH / 2} x2={specW} y2={specH / 2}
          stroke="#333355" strokeWidth="0.5" strokeDasharray="4,4" />

        {/* Spectral lines */}
        {lineDeviations.map((line, idx) => {
          if (line.totalInternalReflection) return null
          const devDeg = (line.deviation * 180) / Math.PI
          const x = 20 + ((devDeg - minDevAngle) / devAngleRange) * (specW - 40)
          return (
            <g key={idx}>
              {/* Line glow effect (just wider line, no filter) */}
              <line x1={x} y1={8} x2={x} y2={specH - 8}
                stroke={rgbStrAlpha(line.wavelength, 0.3)} strokeWidth="6" />
              {/* Main line */}
              <line x1={x} y1={8} x2={x} y2={specH - 8}
                stroke={rgbStr(line.wavelength)} strokeWidth="2" />
              {/* Label */}
              <text x={x} y={specH - 2} textAnchor="middle" fontSize="7"
                fill={rgbStr(line.wavelength)} fontFamily={FONT} className="tabular-nums">
                {line.label}
              </text>
              {/* Wavelength */}
              <text x={x} y={10} textAnchor="middle" fontSize="6"
                fill="#888899" fontFamily={FONT} className="tabular-nums">
                {line.wavelength}nm
              </text>
            </g>
          )
        })}

        {/* Scale bar */}
        <line x1={20} y1={specH - 14} x2={specW - 20} y2={specH - 14}
          stroke="#555566" strokeWidth="0.5" />
      </svg>

      {/* Spectral line table */}
      <div style={{
        width: SVG_W, border: '1px solid #D0D0D0', backgroundColor: '#FFFFFF',
        overflow: 'hidden',
      }}>
        <div style={{
          display: 'grid', gridTemplateColumns: '60px 80px 80px 80px 80px auto',
          fontSize: '9px', fontFamily: FONT, borderBottom: '1px solid #E8ECF0',
          backgroundColor: '#f8f9fb', padding: '4px 8px',
        }}>
          <div style={{ color: '#6b7280' }}>谱线</div>
          <div style={{ color: '#6b7280' }}>波长(nm)</div>
          <div style={{ color: '#6b7280' }}>折射率 n</div>
          <div style={{ color: '#6b7280' }}>偏向角 δ</div>
          <div style={{ color: '#6b7280' }}>角色散</div>
          <div style={{ color: '#6b7280' }}>分辨率 R</div>
        </div>
        <div style={{ maxHeight: '160px', overflowY: 'auto' }} className="custom-scrollbar">
          {lineDeviations.map((line, idx) => {
            const dnDl = Math.abs(cauchyDnDlambda(line.wavelength, cauchyB, cauchyC)) * 1e3 // per nm
            const R = computeResolvingPower(baseLength, line.wavelength, cauchyB, cauchyC)
            const angDisp = (() => {
              const ref1 = computePrismRefraction(apexAngle, incAngle, line.wavelength - 5, cauchyA, cauchyB, cauchyC)
              const ref2 = computePrismRefraction(apexAngle, incAngle, line.wavelength + 5, cauchyA, cauchyB, cauchyC)
              if (ref1.totalInternalReflection || ref2.totalInternalReflection) return 0
              return Math.abs((ref2.deviation - ref1.deviation) * 180 / Math.PI / 10)
            })()

            return (
              <div key={idx} style={{
                display: 'grid', gridTemplateColumns: '60px 80px 80px 80px 80px auto',
                fontSize: '10px', fontFamily: FONT, padding: '3px 8px',
                borderBottom: '1px solid #f0f0f0',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{
                    display: 'inline-block', width: '8px', height: '8px',
                    borderRadius: '50%', backgroundColor: rgbStr(line.wavelength),
                  }} />
                  <span className="tabular-nums">{line.label}</span>
                </div>
                <div className="tabular-nums">{line.wavelength}</div>
                <div className="tabular-nums">{line.n.toFixed(4)}</div>
                <div className="tabular-nums">
                  {line.totalInternalReflection ? 'TIR' : `${(line.deviation * 180 / Math.PI).toFixed(2)}°`}
                </div>
                <div className="tabular-nums">{angDisp.toFixed(4)}°/nm</div>
                <div className="tabular-nums">{R.toFixed(0)}</div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Element identification */}
      <div style={{
        padding: '8px 16px', border: '1px solid #E8ECF0', borderRadius: '2px',
        backgroundColor: '#FAFAFA', width: SVG_W, fontSize: '10px',
        fontFamily: FONT, color: '#555555', lineHeight: '1.6',
      }}>
        <span style={{ fontWeight: 600, color: '#1A1A1A' }}>光源:</span>{' '}
        {lightSource === 'Hg' ? '汞灯 (Hg)' :
         lightSource === 'Na' ? '钠灯 (Na)' :
         lightSource === 'H' ? '氢放电管 (H)' :
         lightSource === 'HeNe' ? '氦氖激光器 (He-Ne)' :
         '白光光源'}
        {' | '}
        <span style={{ fontWeight: 600, color: '#1A1A1A' }}>谱线数:</span> {lines.length}
        {' | '}
        <span style={{ fontWeight: 600, color: '#1A1A1A' }}>棱镜底边:</span> {baseLength}mm
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════
//  MODE 4: 棱镜组合 (Prism System)
// ═══════════════════════════════════════════════

type PrismSystemType = 'amici' | 'pellinBroca'

function PrismSystemMode({
  material, customA, customB, customC,
}: {
  apexAngle: number; incAngle: number; material: Material;
  customA: number; customB: number; customC: number; baseLength: number;
  lightSource: LightSource;
}) {
  const cauchyA = material === 'custom' ? customA : CAUCHY[material].A
  const cauchyB = material === 'custom' ? customB : CAUCHY[material].B
  const cauchyC = material === 'custom' ? customC : CAUCHY[material].C
  const [systemType, setSystemType] = useState<PrismSystemType>('amici')

  // Amici prism (direct vision): Crown-flint-crown prism system
  // Three prisms: crown (60°) + flint (60°, reversed) + crown (60°)
  // The central ray (usually D line) exits undeviated
  const amiciResult = useMemo(() => {
    const wavelengths = [434, 486.1, 546.1, 589.3, 656.3]

    return wavelengths.map(lam => {
      const nCrown = cauchyN(lam, CAUCHY.BK7.A, CAUCHY.BK7.B, CAUCHY.BK7.C)
      const nFlint = cauchyN(lam, CAUCHY.F2.A, CAUCHY.F2.B, CAUCHY.F2.C)

      // First crown prism (60° apex)
      const ref1 = computePrismRefraction(60, 48.6, lam, CAUCHY.BK7.A, CAUCHY.BK7.B, CAUCHY.BK7.C)
      // Flint prism (reversed, 60° apex)
      const ref2 = computePrismRefraction(60, 48.6, lam, CAUCHY.F2.A, CAUCHY.F2.B, CAUCHY.F2.C)

      const crownDev = ref1.totalInternalReflection ? 0 : ref1.deviation * 180 / Math.PI
      const flintDev = ref2.totalInternalReflection ? 0 : ref2.deviation * 180 / Math.PI
      const netDev = 2 * crownDev - flintDev // approximate

      return {
        wavelength: lam,
        nCrown,
        nFlint,
        crownDev,
        flintDev,
        netDev,
        color: rgbStr(lam),
      }
    })
  }, [])

  // Pellin-Broca prism
  const pellinBrocaResult = useMemo(() => {
    const selectedWavelength = 550
    const wavelengths = [434, 486.1, 546.1, 589.3, 656.3]

    return wavelengths.map(lam => {
      const n = cauchyN(lam, cauchyA, cauchyB, cauchyC)
      const devAtMin = computeMinDeviation(30, lam, cauchyA, cauchyB, cauchyC)
      const angleFromTarget = devAtMin.deviation * 180 / Math.PI - (computeMinDeviation(30, selectedWavelength, cauchyA, cauchyB, cauchyC).deviation * 180 / Math.PI)

      return {
        wavelength: lam,
        n,
        deviation: 90 + angleFromTarget,
        angularOffset: angleFromTarget,
        color: rgbStr(lam),
      }
    })
  }, [cauchyA, cauchyB, cauchyC])

  const prismSvgW = 680
  const prismSvgH = 280

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', width: '100%' }}>
      {/* System type selector */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '4px' }}>
        {([['amici', 'Amici 直视棱镜'], ['pellinBroca', 'Pellin-Broca 棱镜']] as [PrismSystemType, string][]).map(([key, label]) => (
          <button key={key} onClick={() => setSystemType(key)} style={{
            fontSize: '10px', padding: '4px 12px', borderRadius: '2px',
            border: `1px solid ${systemType === key ? '#333333' : '#D0D0D0'}`,
            backgroundColor: systemType === key ? '#F0F3F6' : '#FFFFFF',
            color: '#1A1A1A', cursor: 'pointer', fontFamily: FONT,
            transition: 'border-color 200ms ease-out, background-color 200ms ease-out',
          }}>
            {label}
          </button>
        ))}
      </div>

      {systemType === 'amici' ? (
        <>
          {/* Amici prism SVG */}
          <svg width={prismSvgW} height={prismSvgH} viewBox={`0 0 ${prismSvgW} ${prismSvgH}`}
            style={{ border: '1px solid #D0D0D0', backgroundColor: '#FFFFFF' }}>
            {/* Three prisms side by side */}
            {/* Crown 1 */}
            <polygon points="120,40 80,240 160,240" fill="#e0eef8" stroke="#333333" strokeWidth="1.2" />
            <text x={120} y={255} textAnchor="middle" fontSize="8" fill="#555555" fontFamily={FONT}>Crown (BK7)</text>

            {/* Flint (reversed) */}
            <polygon points="260,40 220,240 300,240" fill="#e8e0f0" stroke="#333333" strokeWidth="1.2" />
            <text x={260} y={255} textAnchor="middle" fontSize="8" fill="#555555" fontFamily={FONT}>Flint (F2)</text>
            <text x={260} y={32} textAnchor="middle" fontSize="7" fill="#888888" fontFamily={FONT}>▼ 倒置</text>

            {/* Crown 2 */}
            <polygon points="400,40 360,240 440,240" fill="#e0eef8" stroke="#333333" strokeWidth="1.2" />
            <text x={400} y={255} textAnchor="middle" fontSize="8" fill="#555555" fontFamily={FONT}>Crown (BK7)</text>

            {/* Incident white ray */}
            <line x1={0} y1={140} x2={100} y2={140} stroke="#888888" strokeWidth="2.5" />

            {/* Internal ray paths through 3 prisms */}
            <line x1={100} y1={140} x2={140} y2={160} stroke="#aaaaaa" strokeWidth="1" strokeDasharray="3,2" />
            <line x1={240} y1={160} x2={280} y2={140} stroke="#aaaaaa" strokeWidth="1" strokeDasharray="3,2" />
            <line x1={340} y1={140} x2={380} y2={160} stroke="#aaaaaa" strokeWidth="1" strokeDasharray="3,2" />

            {/* Exit dispersed rays */}
            {amiciResult.map((r, idx) => {
              const baseY = 140
              const angleOffset = (r.netDev - amiciResult[2].netDev) * 2 // exaggerate for visibility
              const endY = baseY + angleOffset * 10
              return (
                <line key={idx}
                  x1={440} y1={baseY + angleOffset * 3}
                  x2={prismSvgW} y2={endY + (endY - baseY) * 0.8}
                  stroke={r.color} strokeWidth="1.8" />
              )
            })}

            {/* Labels */}
            <text x={prismSvgW / 2} y={20} textAnchor="middle" fontSize="10"
              fill="#333333" fontFamily={FONT}>
              Amici 直视棱镜 — D线直行，其余色散
            </text>
          </svg>

          {/* Amici data table */}
          <div style={{
            width: SVG_W, border: '1px solid #D0D0D0', backgroundColor: '#FFFFFF',
          }}>
            <div style={{
              display: 'grid', gridTemplateColumns: '70px 80px 80px 80px 80px auto',
              fontSize: '9px', fontFamily: FONT, borderBottom: '1px solid #E8ECF0',
              backgroundColor: '#f8f9fb', padding: '4px 8px',
            }}>
              <div style={{ color: '#6b7280' }}>波长</div>
              <div style={{ color: '#6b7280' }}>n(Crown)</div>
              <div style={{ color: '#6b7280' }}>n(Flint)</div>
              <div style={{ color: '#6b7280' }}>Crown δ</div>
              <div style={{ color: '#6b7280' }}>Flint δ</div>
              <div style={{ color: '#6b7280' }}>净偏向</div>
            </div>
            {amiciResult.map((r, idx) => (
              <div key={idx} style={{
                display: 'grid', gridTemplateColumns: '70px 80px 80px 80px 80px auto',
                fontSize: '10px', fontFamily: FONT, padding: '3px 8px',
                borderBottom: '1px solid #f0f0f0',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{
                    display: 'inline-block', width: '8px', height: '8px',
                    borderRadius: '50%', backgroundColor: r.color,
                  }} />
                  <span className="tabular-nums">{r.wavelength}nm</span>
                </div>
                <div className="tabular-nums">{r.nCrown.toFixed(4)}</div>
                <div className="tabular-nums">{r.nFlint.toFixed(4)}</div>
                <div className="tabular-nums">{r.crownDev.toFixed(2)}°</div>
                <div className="tabular-nums">{r.flintDev.toFixed(2)}°</div>
                <div className="tabular-nums" style={{ color: Math.abs(r.netDev) < 0.5 ? '#00AA44' : '#CC0000' }}>
                  {r.netDev.toFixed(2)}°
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          {/* Pellin-Broca prism SVG */}
          <svg width={prismSvgW} height={prismSvgH} viewBox={`0 0 ${prismSvgW} ${prismSvgH}`}
            style={{ border: '1px solid #D0D0D0', backgroundColor: '#FFFFFF' }}>
            {/* Pellin-Broca prism shape (pentagon-ish) */}
            <polygon
              points="250,30 400,30 450,150 350,250 200,250 150,150"
              fill="#f0f4f8" stroke="#333333" strokeWidth="1.5" />

            {/* Incident ray */}
            <line x1={0} y1={140} x2={220} y2={140} stroke="#888888" strokeWidth="2.5" />

            {/* Internal ray */}
            <line x1={220} y1={140} x2={370} y2={180} stroke="#aaaaaa" strokeWidth="1.2" strokeDasharray="4,2" />

            {/* 90° exit ray for selected wavelength */}
            <line x1={370} y1={180} x2={370} y2={prismSvgH} stroke="#00AA44" strokeWidth="2" />
            <text x={375} y={prismSvgH - 5} fontSize="8" fill="#00AA44" fontFamily={FONT}>550nm (90°)</text>

            {/* Other wavelengths exit at slightly different angles */}
            {pellinBrocaResult.filter(r => r.wavelength !== 550).map((r, idx) => {
              const angleRad = ((r.deviation - 90) * Math.PI) / 180
              const exitX = 370 + 100 * Math.sin(angleRad * 5) // exaggerate
              const exitY = 180 + 100 * Math.cos(0)
              return (
                <line key={idx}
                  x1={370} y1={180}
                  x2={exitX} y2={exitY}
                  stroke={r.color} strokeWidth="1.5" opacity="0.7" />
              )
            })}

            {/* 90° angle indicator */}
            <path d="M370,200 L370,190 L360,190" fill="none" stroke="#00AA44" strokeWidth="0.8" />

            <text x={prismSvgW / 2} y={20} textAnchor="middle" fontSize="10"
              fill="#333333" fontFamily={FONT}>
              Pellin-Broca 棱镜 — 选定波长90°出射
            </text>
          </svg>

          {/* Pellin-Broca data */}
          <div style={{
            padding: '10px 16px', border: '1px solid #E8ECF0', borderRadius: '2px',
            backgroundColor: '#FAFAFA', width: SVG_W, fontSize: '10px',
            fontFamily: FONT, color: '#555555', lineHeight: '1.8',
          }}>
            <div><span style={{ fontWeight: 600, color: '#1A1A1A' }}>Pellin-Broca 棱镜原理:</span> 在最小偏向角配置下，选定波长光线经90°反射后出射，其他波长偏离90°方向，实现单色光选择</div>
            <div className="tabular-nums">
              设计波长 550nm: 出射角 90.00°
              {' | '}{pellinBrocaResult.filter(r => r.wavelength !== 550).map(r =>
                `${r.wavelength}nm: ${r.deviation.toFixed(2)}°`
              ).join(' | ')}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════
//  MAIN COMPONENT
// ═══════════════════════════════════════════════

export default function PrismSpectrometer({ onBack }: { onBack: () => void }) {
  const [expMode, setExpMode] = useState<ExpMode>('basic')

  // Parameters
  const [material, setMaterial] = useState<Material>('BK7')
  const [customA, setCustomA] = useState(1.50)
  const [customB, setCustomB] = useState(0.005)
  const [customC, setCustomC] = useState(0.0)
  const [apexAngle, setApexAngle] = useState(60)
  const [incAngle, setIncAngle] = useState(45)
  const [lightSource, setLightSource] = useState<LightSource>('white')
  const [baseLength, setBaseLength] = useState(50)

  const effectiveA = material === 'custom' ? customA : CAUCHY[material].A
  const effectiveB = material === 'custom' ? customB : CAUCHY[material].B
  const effectiveC = material === 'custom' ? customC : CAUCHY[material].C
  const refN = cauchyN(550, effectiveA, effectiveB, effectiveC)

  // Min deviation incidence angle for status bar
  const minDevInc = useMemo(() =>
    computeMinDeviation(apexAngle, 550, effectiveA, effectiveB, effectiveC),
    [apexAngle, effectiveA, effectiveB, effectiveC]
  )

  const modeTabs: [ExpMode, string][] = [
    ['basic', '基本分光'],
    ['minDeviation', '最小偏向角'],
    ['spectral', '光谱分析'],
    ['prismSystem', '棱镜组合'],
  ]

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#FFFFFF' }}>
      {/* Header bar 48px */}
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
          棱镜光谱仪
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
            {modeTabs.map(([key, label]) => (
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

          {/* Mode content */}
          {expMode === 'basic' && (
            <BasicDispersionMode
              apexAngle={apexAngle} incAngle={incAngle} material={material}
              customA={customA} customB={customB} customC={customC} baseLength={baseLength} />
          )}
          {expMode === 'minDeviation' && (
            <MinDeviationMode
              apexAngle={apexAngle} incAngle={incAngle} material={material}
              customA={customA} customB={customB} customC={customC} baseLength={baseLength} />
          )}
          {expMode === 'spectral' && (
            <SpectralAnalysisMode
              apexAngle={apexAngle} incAngle={incAngle} material={material}
              customA={customA} customB={customB} customC={customC} baseLength={baseLength}
              lightSource={lightSource} />
          )}
          {expMode === 'prismSystem' && (
            <PrismSystemMode
              apexAngle={apexAngle} incAngle={incAngle} material={material}
              customA={customA} customB={customB} customC={customC} baseLength={baseLength}
              lightSource={lightSource} />
          )}

          {/* Formula card */}
          <div style={{
            marginTop: '12px', padding: '8px 16px', border: '1px solid #E8ECF0',
            borderRadius: '2px', backgroundColor: '#FAFAFA', fontSize: '10px',
            fontFamily: FONT, color: '#555555', lineHeight: '1.8', width: SVG_W,
          }}>
            {expMode === 'basic' && (
              <>
                <div>Cauchy 色散: <span className="tabular-nums" style={{ fontWeight: 600, color: '#1A1A1A' }}>n(λ) = A + B/λ² + C/λ⁴</span></div>
                <div>Snell 定律: <span className="tabular-nums" style={{ fontWeight: 600, color: '#1A1A1A' }}>n₁ sin θ₁ = n₂ sin θ₂</span></div>
                <div>偏向角: δ = i₁ + i₂ − A</div>
              </>
            )}
            {expMode === 'minDeviation' && (
              <>
                <div>最小偏向角: <span className="tabular-nums" style={{ fontWeight: 600, color: '#1A1A1A' }}>δmin = 2·arcsin(n·sin(A/2)) − A</span></div>
                <div>折射率测量: <span className="tabular-nums" style={{ fontWeight: 600, color: '#1A1A1A' }}>n = sin((A+δmin)/2) / sin(A/2)</span></div>
                <div>最小偏向角时: r₁ = r₂ = A/2, i₁ = i₂</div>
              </>
            )}
            {expMode === 'spectral' && (
              <>
                <div>角色散: <span className="tabular-nums" style={{ fontWeight: 600, color: '#1A1A1A' }}>dθ/dλ = (dθ/dn)·(dn/dλ)</span></div>
                <div>分辨本领: <span className="tabular-nums" style={{ fontWeight: 600, color: '#1A1A1A' }}>R = b·|dn/dλ| = λ/Δλ</span></div>
                <div>Cauchy dn/dλ = −2B/λ³ − 4C/λ⁵</div>
              </>
            )}
            {expMode === 'prismSystem' && (
              <>
                <div>Amici 直视棱镜: 冕牌+火石+冕牌三棱镜组合，D线直行</div>
                <div>Pellin-Broca 棱镜: 选定波长90°出射，用于单色仪</div>
              </>
            )}
          </div>
        </div>

        {/* Right: Control Panel w-72 */}
        <div className="custom-scrollbar" style={{
          width: '288px', flexShrink: 0, backgroundColor: '#f8f9fb',
          borderLeft: '1px solid #D0D0D0', overflowY: 'auto', padding: '16px',
        }}>

          {/* Material */}
          <SectionTitle>棱镜材料</SectionTitle>
          <Select value={material} onValueChange={(v) => setMaterial(v as Material)}>
            <SelectTrigger style={{ width: '100%', fontSize: '11px', fontFamily: FONT }}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="BK7">BK7 冕牌玻璃</SelectItem>
              <SelectItem value="F2">F2 火石玻璃</SelectItem>
              <SelectItem value="SF11">SF11 重火石玻璃</SelectItem>
              <SelectItem value="custom">自定义 Cauchy</SelectItem>
            </SelectContent>
          </Select>

          {/* Custom Cauchy coefficients */}
          {material === 'custom' && (
            <>
              <SectionTitle>Cauchy 系数 A</SectionTitle>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Slider value={[customA]} onValueChange={([v]) => setCustomA(v)}
                  min={1.3} max={2.0} step={0.001}
                  style={{ flex: 1 }} />
                <span className="tabular-nums" style={{
                  fontSize: '11px', fontWeight: 600, color: '#1A1A1A',
                  fontFamily: FONT, minWidth: '40px',
                }}>
                  {customA.toFixed(3)}
                </span>
              </div>

              <SectionTitle>Cauchy 系数 B</SectionTitle>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Slider value={[customB]} onValueChange={([v]) => setCustomB(v)}
                  min={0} max={0.03} step={0.0001}
                  style={{ flex: 1 }} />
                <span className="tabular-nums" style={{
                  fontSize: '11px', fontWeight: 600, color: '#1A1A1A',
                  fontFamily: FONT, minWidth: '48px',
                }}>
                  {customB.toFixed(4)}
                </span>
              </div>

              <SectionTitle>Cauchy 系数 C</SectionTitle>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Slider value={[customC]} onValueChange={([v]) => setCustomC(v)}
                  min={0} max={0.001} step={0.00001}
                  style={{ flex: 1 }} />
                <span className="tabular-nums" style={{
                  fontSize: '11px', fontWeight: 600, color: '#1A1A1A',
                  fontFamily: FONT, minWidth: '48px',
                }}>
                  {customC.toFixed(5)}
                </span>
              </div>
            </>
          )}

          {/* Apex Angle */}
          <SectionTitle>顶角 A</SectionTitle>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Slider value={[apexAngle]} onValueChange={([v]) => setApexAngle(v)}
              min={30} max={80} step={1} style={{ flex: 1 }} />
            <span className="tabular-nums" style={{
              fontSize: '12px', fontWeight: 600, color: '#1A1A1A',
              fontFamily: FONT, minWidth: '36px',
            }}>
              {apexAngle}°
            </span>
          </div>
          <div style={{ fontSize: '7px', color: '#888888', fontFamily: FONT, display: 'flex', justifyContent: 'space-between' }}>
            <span>30°</span><span>60°</span><span>80°</span>
          </div>

          {/* Incidence Angle */}
          <SectionTitle>入射角 θᵢ</SectionTitle>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Slider value={[incAngle]} onValueChange={([v]) => setIncAngle(v)}
              min={20} max={80} step={0.5} style={{ flex: 1 }} />
            <span className="tabular-nums" style={{
              fontSize: '12px', fontWeight: 600, color: '#1A1A1A',
              fontFamily: FONT, minWidth: '40px',
            }}>
              {incAngle}°
            </span>
          </div>
          <div style={{ fontSize: '7px', color: '#888888', fontFamily: FONT, display: 'flex', justifyContent: 'space-between' }}>
            <span>20°</span>
            <span style={{ color: '#00AA44' }}>i_min={minDevInc.incidenceDeg.toFixed(1)}°</span>
            <span>80°</span>
          </div>

          {/* Light Source (for spectral mode) */}
          <SectionTitle>光源</SectionTitle>
          <Select value={lightSource} onValueChange={(v) => setLightSource(v as LightSource)}>
            <SelectTrigger style={{ width: '100%', fontSize: '11px', fontFamily: FONT }}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="white">白光</SelectItem>
              <SelectItem value="Hg">汞灯 (Hg)</SelectItem>
              <SelectItem value="Na">钠灯 (Na)</SelectItem>
              <SelectItem value="H">氢放电管 (H)</SelectItem>
              <SelectItem value="HeNe">氦氖激光 (He-Ne)</SelectItem>
            </SelectContent>
          </Select>

          {/* Base Length */}
          <SectionTitle>棱镜底边 b</SectionTitle>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Slider value={[baseLength]} onValueChange={([v]) => setBaseLength(v)}
              min={10} max={100} step={1} style={{ flex: 1 }} />
            <span className="tabular-nums" style={{
              fontSize: '12px', fontWeight: 600, color: '#1A1A1A',
              fontFamily: FONT, minWidth: '44px',
            }}>
              {baseLength}mm
            </span>
          </div>

          {/* Info panel */}
          <SectionTitle>参数摘要</SectionTitle>
          <div style={{
            padding: '8px', border: '1px solid #E8ECF0', borderRadius: '2px',
            backgroundColor: '#FFFFFF', fontSize: '10px', fontFamily: FONT,
            color: '#555555', lineHeight: '1.7',
          }}>
            <div className="tabular-nums">n(550nm) = {refN.toFixed(4)}</div>
            <div className="tabular-nums">n(F) = {cauchyN(486.1, effectiveA, effectiveB, effectiveC).toFixed(4)}</div>
            <div className="tabular-nums">n(C) = {cauchyN(656.3, effectiveA, effectiveB, effectiveC).toFixed(4)}</div>
            <div className="tabular-nums">Δn = {(cauchyN(486.1, effectiveA, effectiveB, effectiveC) - cauchyN(656.3, effectiveA, effectiveB, effectiveC)).toFixed(4)}</div>
            <div className="tabular-nums">δmin = {(minDevInc.deviation * 180 / Math.PI).toFixed(2)}°</div>
          </div>

          {/* Spectral line reference */}
          <SectionTitle>常用谱线</SectionTitle>
          <div style={{
            padding: '6px', border: '1px solid #E8ECF0', borderRadius: '2px',
            backgroundColor: '#FFFFFF', fontSize: '9px', fontFamily: FONT,
            color: '#555555', lineHeight: '1.6',
          }}>
            {[
              { el: 'Hg', lines: '404.7 435.8 546.1 577/579' },
              { el: 'Na', lines: '589.0 589.6 (D双线)' },
              { el: 'H', lines: '410.2 434.0 486.1 656.3' },
              { el: 'HeNe', lines: '632.8' },
            ].map(ref => (
              <div key={ref.el}>
                <span style={{ fontWeight: 600, color: '#1A1A1A' }}>{ref.el}:</span> {ref.lines} nm
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Status bar 24px */}
      <div className="flex-shrink-0" style={{
        height: '24px', backgroundColor: '#FFFFFF',
        borderTop: '1px solid #CCCCCC', paddingLeft: '24px', paddingRight: '24px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{
          fontSize: '9px', color: '#888888', fontFamily: FONT, className: 'tabular-nums',
        }}>
          v2.1 · 几何光学模块 — 棱镜分光·色散曲线·光谱分析
        </span>
        <span className="tabular-nums" style={{
          fontSize: '9px', color: '#888888', fontFamily: FONT,
        }}>
          {material === 'custom' ? `自定义` : material} · n={refN.toFixed(3)} · A={apexAngle}° · i={incAngle}°
        </span>
      </div>
    </div>
  )
}
