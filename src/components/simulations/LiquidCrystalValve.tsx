'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import { useIsMobile } from '@/hooks/use-mobile'
import { ControlPanel, MobilePanelToggle } from './shared/ControlPanel'

/* ═══════════════════════════════════════════════
   PHYSICS ENGINE: Oseen-Frank + Berreman 4×4
   ═══════════════════════════════════════════════ */

const FONT = "system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif"
const EPS0 = 8.854e-12 // F/m

// ─── LC Material Parameters (5CB-like nematic) ───
const K11 = 6.2e-12   // N, splay elastic constant
const K33 = 8.2e-12   // N, bend elastic constant
const K22 = 3.9e-12   // N, twist elastic constant
const DELTA_EPS = 11.5 // dielectric anisotropy
const NO = 1.53        // ordinary refractive index
const NE = 1.71        // extraordinary refractive index
const CELL_D = 5e-6    // 5 μm cell gap
const PRETILT = 2      // degrees, pretilt angle
const TWIST_ANGLE = 90 // degrees, TN mode twist
const GAMMA1 = 0.081   // Pa·s, rotational viscosity

// Threshold voltage: Vth = π·√(K11/(ε₀·Δε))
const VTH = Math.PI * Math.sqrt(K11 / (EPS0 * DELTA_EPS))

// ─── Director Profile Solver: Oseen-Frank + E-field ───
// Solves for tilt angle θ(z) using finite difference relaxation
// Minimizes free energy: F = ∫[½(K11cos²θ+K33sin²θ)(dθ/dz)² - ½ε₀Δε(V/d)²sin²θ]dz

function solveTiltProfile(
  voltage: number,
  cellGap: number = CELL_D,
  nLayers: number = 40,
  k11: number = K11,
  k33: number = K33,
  deltaEps: number = DELTA_EPS,
  pretiltDeg: number = PRETILT
): number[] {
  const N = nLayers
  const dz = cellGap / N
  const pretiltRad = (pretiltDeg * Math.PI) / 180
  const E2 = voltage > 0 ? (voltage / cellGap) ** 2 : 0

  // Initialize with pretilt
  const theta = new Array(N + 1).fill(pretiltRad)

  // If voltage below threshold, just return pretilt
  if (voltage < VTH * 0.95) {
    return theta.map(t => (t * 180) / Math.PI)
  }

  // Gauss-Seidel relaxation
  const omega = 0.4 // relaxation factor
  const maxIter = 300
  const tol = 1e-8

  for (let iter = 0; iter < maxIter; iter++) {
    let maxChange = 0
    for (let i = 1; i < N; i++) {
      const ti = theta[i]
      const tPrev = theta[i - 1]
      const tNext = theta[i + 1]

      // Elastic constant at this point
      const K_i = k11 * Math.cos(ti) ** 2 + k33 * Math.sin(ti) ** 2
      const K_prev = k11 * Math.cos(tPrev) ** 2 + k33 * Math.sin(tPrev) ** 2
      const K_next = k11 * Math.cos(tNext) ** 2 + k33 * Math.sin(tNext) ** 2

      // Gradient dθ/dz (central difference)
      const dtheta = (tNext - tPrev) / (2 * dz)

      // Elastic torque from neighbors
      const elasticTorque = (K_prev * (tPrev - ti) + K_next * (tNext - ti)) / (dz * dz)

      // Nonlinear elastic term: ½(K33-K11)sin2θ·(dθ/dz)²
      const nonlinearElastic = 0.5 * (k33 - k11) * Math.sin(2 * ti) * dtheta * dtheta

      // Electric torque: ½ε₀ΔεE²sin2θ
      const electricTorque = 0.5 * EPS0 * deltaEps * E2 * Math.sin(2 * ti)

      // Total generalized force
      const force = elasticTorque + nonlinearElastic + electricTorque

      // Diagonal coefficient (approximate)
      const diag = (K_prev + K_next) / (dz * dz)

      // Update
      const delta = omega * force / Math.max(diag, 1e-10)
      const newTi = ti + delta

      // Clamp to valid range
      const clamped = Math.max(pretiltRad, Math.min(Math.PI / 2 - 0.001, newTi))
      const change = Math.abs(clamped - ti)
      if (change > maxChange) maxChange = change
      theta[i] = clamped
    }
    if (maxChange < tol) break
  }

  return theta.map(t => (t * 180) / Math.PI)
}

// ─── Berreman 4×4 Matrix Method ───
// Computes transmittance through the LC layer using the 4×4 transfer matrix method

function dielectricTensor(thetaDeg: number, phiDeg: number): number[][] {
  const theta = (thetaDeg * Math.PI) / 180
  const phi = (phiDeg * Math.PI) / 180
  const nx = Math.sin(theta) * Math.cos(phi)
  const ny = Math.sin(theta) * Math.sin(phi)
  const nz = Math.cos(theta)

  const eo = NO * NO
  const ee = NE * NE
  const dn = ee - eo

  return [
    [eo + dn * nx * nx, dn * nx * ny, dn * nx * nz],
    [dn * ny * nx, eo + dn * ny * ny, dn * ny * nz],
    [dn * nz * nx, dn * nz * ny, eo + dn * nz * nz],
  ]
}

// Build Berreman Δ matrix for normal incidence
function berremanDelta(thetaDeg: number, phiDeg: number): number[][] {
  const eps = dielectricTensor(thetaDeg, phiDeg)
  const [exx, exy, exz] = eps[0]
  const [eyx, eyy, eyz] = eps[1]
  const [ezx, ezy, ezz] = eps[2]

  // At normal incidence, the Berreman Δ matrix simplifies
  // Using the Schubert formulation for kx=ky=0
  return [
    [0, 1, 0, 0],
    [exx - (exz * ezx) / ezz, 0, exy - (exz * ezy) / ezz, 0],
    [0, 0, 0, 1],
    [eyx - (eyz * ezx) / ezz, 0, eyy - (eyz * ezy) / ezz, 0],
  ]
}

// Matrix exponential using eigendecomposition for 4×4
function matExp4(M: number[][], h: number): number[][] {
  // For small h, use Padé approximation (order 4)
  // exp(M·h) ≈ [I + (M·h)/2 + (M·h)²/6] (first order approximation)
  // For better accuracy, use scaling and squaring

  const scale = Math.abs(h)
  let nSquarings = 0
  let s = 1.0
  if (scale > 0.5) {
    nSquarings = Math.ceil(Math.log2(scale / 0.1))
    s = h / Math.pow(2, nSquarings)
  } else {
    s = h
  }

  // Compute exp(M·s) using Taylor series to order 6
  let result = identity4()
  let Mk = identity4()
  let factorial = 1

  for (let k = 1; k <= 8; k++) {
    Mk = matMul4(Mk, matScale4(M, s))
    factorial *= k
    result = matAdd4(result, matScale4(Mk, 1 / factorial))
  }

  // Squaring step
  for (let i = 0; i < nSquarings; i++) {
    result = matMul4(result, result)
  }

  return result
}

function identity4(): number[][] {
  return [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ]
}

function matScale4(A: number[][], s: number): number[][] {
  return A.map(row => row.map(v => v * s))
}

function matAdd4(A: number[][], B: number[][]): number[][] {
  return A.map((row, i) => row.map((v, j) => v + B[i][j]))
}

function matMul4(A: number[][], B: number[][]): number[][] {
  const C: number[][] = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++)
      for (let k = 0; k < 4; k++)
        C[i][j] += A[i][k] * B[k][j]
  return C
}

// Compute transmittance using Berreman 4×4 for normal incidence
function computeTransmittanceBerreman(
  tiltProfile: number[],   // θ(z) in degrees
  twistAngle: number,       // total twist in degrees
  wavelength: number,       // nm
  cellGap: number = CELL_D,
  polarizerAngle: number = 0,   // input polarizer angle (degrees)
  analyzerAngle: number = 90,   // analyzer angle (degrees)
  incidenceAngle: number = 0,   // oblique incidence (degrees)
): number {
  const N = tiltProfile.length - 1
  const dz = cellGap / N
  const k0 = (2 * Math.PI) / (wavelength * 1e-9)

  // Total transfer matrix
  let M = identity4()

  for (let i = 0; i < N; i++) {
    const theta = tiltProfile[i]
    const phi = (twistAngle * i) / N
    const Delta = berremanDelta(theta, phi)

    // Phase matrix for this sublayer
    const Pi = matExp4(Delta, k0 * dz)

    M = matMul4(Pi, M)
  }

  // Extract Jones matrix from the 4×4 transfer matrix
  // For normal incidence, the relationship is:
  // M relates [Ex, Hy, Ey, -Hx] at input to output
  // For normal incidence on isotropic boundaries (glass):
  // T_xx = M[0][0], T_xy = M[0][2], T_yx = M[2][0], T_yy = M[2][2]
  // (approximate, ignoring multiple reflections)

  const jxx = M[0][0]
  const jxy = M[0][2]
  const jyx = M[2][0]
  const jyy = M[2][2]

  // Input polarization (Jones vector after polarizer)
  const pRad = (polarizerAngle * Math.PI) / 180
  const aRad = (analyzerAngle * Math.PI) / 180

  const Ein_x = Math.cos(pRad)
  const Ein_y = Math.sin(pRad)

  // Output field
  const Eout_x = jxx * Ein_x + jxy * Ein_y
  const Eout_y = jyx * Ein_x + jyy * Ein_y

  // Project onto analyzer
  const Eout = Eout_x * Math.cos(aRad) + Eout_y * Math.sin(aRad)

  return Math.min(1, Math.abs(Eout) ** 2)
}

// ─── Jones Matrix Layer-by-Layer Method (fast, for T-V curve) ───
// Equivalent to Berreman for normal incidence

function computeTransmittanceJones(
  tiltProfile: number[],
  twistAngle: number,
  wavelength: number,
  cellGap: number = CELL_D,
  polarizerAngle: number = 0,
  analyzerAngle: number = 90,
): number {
  const N = tiltProfile.length - 1
  const dz = cellGap / N
  const k0 = (2 * Math.PI) / (wavelength * 1e-9)

  // Complex Jones matrix: Jre (real part) and Jim (imaginary part)
  const Jre = [[1, 0], [0, 1]]
  const Jim = [[0, 0], [0, 0]]

  for (let i = 0; i < N; i++) {
    const thetaRad = (tiltProfile[i] * Math.PI) / 180
    const phiRad = ((twistAngle * i) / N * Math.PI) / 180

    const cosT = Math.cos(thetaRad)
    const sinT = Math.sin(thetaRad)
    const nEff = (NO * NE) / Math.sqrt(NE * NE * sinT * sinT + NO * NO * cosT * cosT)
    const deltaN = nEff - NO
    const gamma = k0 * deltaN * dz

    const cphi = Math.cos(phiRad)
    const sphi = Math.sin(phiRad)
    const cg = Math.cos(gamma)
    const sg = Math.sin(gamma)

    // Layer Jones matrix (complex 2×2)
    const l11r = cphi * cphi + sphi * sphi * cg
    const l11i = sphi * sphi * sg
    const l12r = cphi * sphi * (1 - cg)
    const l12i = -cphi * sphi * sg
    const l21r = l12r
    const l21i = -l12i  // conjugate for off-diagonal symmetry
    const l22r = sphi * sphi + cphi * cphi * cg
    const l22i = cphi * cphi * sg

    // Complex matrix multiplication: J_new = L · J
    const n00r = l11r * Jre[0][0] - l11i * Jim[0][0] + l12r * Jre[1][0] - l12i * Jim[1][0]
    const n00i = l11r * Jim[0][0] + l11i * Jre[0][0] + l12r * Jim[1][0] + l12i * Jre[1][0]
    const n01r = l11r * Jre[0][1] - l11i * Jim[0][1] + l12r * Jre[1][1] - l12i * Jim[1][1]
    const n01i = l11r * Jim[0][1] + l11i * Jre[0][1] + l12r * Jim[1][1] + l12i * Jre[1][1]
    const n10r = l21r * Jre[0][0] - l21i * Jim[0][0] + l22r * Jre[1][0] - l22i * Jim[1][0]
    const n10i = l21r * Jim[0][0] + l21i * Jre[0][0] + l22r * Jim[1][0] + l22i * Jre[1][0]
    const n11r = l21r * Jre[0][1] - l21i * Jim[0][1] + l22r * Jre[1][1] - l22i * Jim[1][1]
    const n11i = l21r * Jim[0][1] + l21i * Jre[0][1] + l22r * Jim[1][1] + l22i * Jre[1][1]

    Jre[0][0] = n00r; Jim[0][0] = n00i
    Jre[0][1] = n01r; Jim[0][1] = n01i
    Jre[1][0] = n10r; Jim[1][0] = n10i
    Jre[1][1] = n11r; Jim[1][1] = n11i
  }

  // Input polarization
  const pRad = (polarizerAngle * Math.PI) / 180
  const aRad = (analyzerAngle * Math.PI) / 180

  const ein_r = Math.cos(pRad)
  const ein_i = 0

  // E_out = J · E_in
  const eout_x_r = Jre[0][0] * ein_r - Jim[0][0] * ein_i
  const eout_x_i = Jre[0][0] * ein_i + Jim[0][0] * ein_r
  const eout_y_r = Jre[1][0] * ein_r - Jim[1][0] * ein_i
  const eout_y_i = Jre[1][0] * ein_i + Jim[1][0] * ein_r

  // Project onto analyzer direction
  const eout_r = eout_x_r * Math.cos(aRad) + eout_y_r * Math.sin(aRad)
  const eout_i = eout_x_i * Math.cos(aRad) + eout_y_i * Math.sin(aRad)

  return Math.min(1, eout_r * eout_r + eout_i * eout_i)
}

// ─── Response Time Model ───
// τ_rise ≈ γ₁·d² / (Δε·ε₀·V² - K·π²) for V > Vth
// τ_fall ≈ γ₁·d² / (K·π²)

function computeResponseTime(voltage: number): { tauRise: number; tauFall: number } {
  const d = CELL_D
  const tauFall = (GAMMA1 * d * d) / (K11 * Math.PI * Math.PI)

  if (voltage <= VTH) {
    return { tauRise: Infinity, tauFall }
  }

  const tauRise = (GAMMA1 * d * d) / (EPS0 * DELTA_EPS * voltage * voltage - K11 * Math.PI * Math.PI)
  return { tauRise: Math.max(tauRise, 0.001), tauFall }
}

// Simulate transient response
function simulateTransient(
  voltageOn: number,
  timePoints: number[],
): { time: number; intensity: number }[] {
  const { tauRise, tauFall } = computeResponseTime(voltageOn)
  const maxTilt = solveTiltProfile(voltageOn)
  const minTilt = solveTiltProfile(0)

  // Compute steady-state intensities
  const T_on = computeTransmittanceJones(maxTilt, TWIST_ANGLE, 550)
  const T_off = computeTransmittanceJones(minTilt, TWIST_ANGLE, 550)

  // Simplified model: intensity follows exponential
  return timePoints.map(t => {
    if (t < 20) {
      // Rising phase (voltage on)
      const tRel = t
      const T = T_off + (T_on - T_off) * (1 - Math.exp(-tRel / tauRise))
      return { time: t, intensity: T }
    } else {
      // Falling phase (voltage off)
      const tRel = t - 20
      const T = T_on + (T_off - T_on) * (1 - Math.exp(-tRel / tauFall))
      return { time: t, intensity: T }
    }
  })
}

// ─── IPS and VA Mode Director Profiles ───

function solveIPSProfile(voltage: number, nLayers: number = 40): number[] {
  // IPS: directors rotate in-plane, tilt is minimal
  // Simplified: azimuthal angle varies with voltage
  const N = nLayers
  const theta = new Array(N + 1).fill(PRETILT)
  // IPS effective rotation angle
  const VthIPS = Math.PI * Math.sqrt(K22 / (EPS0 * DELTA_EPS * 0.5))
  const maxRotation = voltage > VthIPS ? Math.min(90, 45 * (voltage / VthIPS - 1)) : 0
  return theta.map(() => PRETILT) // tilt stays small in IPS
}

function solveVAProfile(voltage: number, nLayers: number = 40): number[] {
  // VA: directors start vertical (θ=90°), tilt toward horizontal under voltage
  // Wait, VA is the opposite: molecules start vertical (homeotropic)
  // Under voltage, they tilt AWAY from vertical
  // Actually for VA with negative Δε, molecules start vertical and stay vertical
  // For VA with positive Δε (MVA), molecules tilt under voltage
  // Let's model VA with negative Δε (standard VA mode)
  const N = nLayers
  const dz = CELL_D / N
  const theta = new Array(N + 1).fill(88) // start near vertical

  if (voltage < VTH * 0.95) return theta

  // VA: voltage tilts molecules from vertical toward horizontal
  const t = Math.min(1, (voltage - VTH * 0.95) / (3 * VTH))
  for (let i = 0; i <= N; i++) {
    const z = i / N
    const boundaryEffect = Math.sin(Math.PI * z) // tilt is max in center
    theta[i] = 88 - (88 - PRETILT) * t * boundaryEffect
  }
  return theta
}

// ─── View Angle Computation ───
function computeViewAngleTVCurve(
  incidenceAngleDeg: number,
  azimuthDeg: number,
  voltages: number[],
): { v: number; t: number }[] {
  // Simplified view angle effect
  // For oblique incidence, the effective birefringence changes
  const incRad = (incidenceAngleDeg * Math.PI) / 180
  const aziRad = (azimuthDeg * Math.PI) / 180

  return voltages.map(v => {
    const tilt = solveTiltProfile(v)
    const T0 = computeTransmittanceJones(tilt, TWIST_ANGLE, 550)
    // Oblique incidence modification
    const pathLengthFactor = 1 / Math.cos(incRad)
    // Azimuthal asymmetry for TN
    const asymFactor = 1 + 0.15 * Math.cos(2 * aziRad) * Math.sin(incRad)
    const T = Math.min(1, T0 * pathLengthFactor * asymFactor)
    return { v, t: Math.max(0, T) }
  })
}

/* ═══════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════ */

type LCMode = 'TN' | 'IPS' | 'VA'
type ExperimentMode = 'basic' | 'response' | 'viewangle' | 'comparison' | 'grayscale'
type PolConfig = 'normallyWhite' | 'normallyBlack'

export default function LiquidCrystalValve({ onBack }: { onBack: () => void }) {
  /* ── Mobile panel state ─────────────────────────────────── */
  const isMobile = useIsMobile()
  const [panelOpen, setPanelOpen] = useState(false)

  const [voltage, setVoltage] = useState(0)
  const [lcMode, setLcMode] = useState<LCMode>('TN')
  const [polConfig, setPolConfig] = useState<PolConfig>('normallyWhite')
  const [expMode, setExpMode] = useState<ExperimentMode>('basic')
  const [wavelength, setWavelength] = useState(550)
  const [showRGB, setShowRGB] = useState(false)

  // Response time mode
  const [responseVoltage, setResponseVoltage] = useState(5)
  const [responseRunning, setResponseRunning] = useState(false)
  const [responseTime, setResponseTime] = useState(0)

  // View angle mode
  const [incidenceAngle, setIncidenceAngle] = useState(0)
  const [azimuthAngle, setAzimuthAngle] = useState(0)

  // Grayscale mode - 4×4 pixel array
  const [pixelVoltages, setPixelVoltages] = useState<number[]>(
    new Array(16).fill(0)
  )

  // ─── Computed Physics ───
  const tiltProfile = useMemo(() => {
    if (lcMode === 'TN') return solveTiltProfile(voltage)
    if (lcMode === 'IPS') return solveIPSProfile(voltage)
    return solveVAProfile(voltage)
  }, [voltage, lcMode])

  const twistAngle = useMemo(() => {
    if (lcMode === 'TN') return TWIST_ANGLE
    if (lcMode === 'IPS') return 0
    return 0 // VA has no twist
  }, [lcMode])

  const polAngle = useMemo(() => {
    if (lcMode === 'TN') return polConfig === 'normallyWhite' ? 0 : 0
    return 0
  }, [lcMode, polConfig])

  const anaAngle = useMemo(() => {
    if (lcMode === 'TN') return polConfig === 'normallyWhite' ? 90 : 0
    if (lcMode === 'IPS') return 90
    return polConfig === 'normallyWhite' ? 0 : 90
  }, [lcMode, polConfig])

  const intensity = useMemo(() => {
    return computeTransmittanceJones(tiltProfile, twistAngle, wavelength, CELL_D, polAngle, anaAngle)
  }, [tiltProfile, twistAngle, wavelength, polAngle, anaAngle])

  // T-V curve data
  const tvCurveData = useMemo(() => {
    const points: { v: number; t: number }[] = []
    for (let v = 0; v <= 5; v += 0.1) {
      const tilt = lcMode === 'TN' ? solveTiltProfile(v) : lcMode === 'IPS' ? solveIPSProfile(v) : solveVAProfile(v)
      const tw = lcMode === 'TN' ? TWIST_ANGLE : 0
      const pa = polAngle
      const aa = anaAngle
      const T = computeTransmittanceJones(tilt, tw, wavelength, CELL_D, pa, aa)
      points.push({ v, t: T })
    }
    return points
  }, [lcMode, polConfig, wavelength, polAngle, anaAngle])

  // RGB sub-pixel intensities
  const rgbIntensities = useMemo(() => {
    if (!showRGB) return null
    const makeTilt = (v: number, vthShift: number) => {
      const shiftedV = Math.max(0, v * vthShift)
      return lcMode === 'TN' ? solveTiltProfile(shiftedV) : lcMode === 'IPS' ? solveIPSProfile(shiftedV) : solveVAProfile(shiftedV)
    }
    const tw = lcMode === 'TN' ? TWIST_ANGLE : 0
    return {
      r: computeTransmittanceJones(makeTilt(voltage, 0.92), tw, 630, CELL_D, polAngle, anaAngle),
      g: computeTransmittanceJones(makeTilt(voltage, 1.0), tw, 530, CELL_D, polAngle, anaAngle),
      b: computeTransmittanceJones(makeTilt(voltage, 1.08), tw, 460, CELL_D, polAngle, anaAngle),
    }
  }, [showRGB, voltage, lcMode, polAngle, anaAngle])

  // Response time data
  const responseData = useMemo(() => {
    const times = []
    for (let t = 0; t <= 60; t += 0.5) {
      times.push(t)
    }
    return simulateTransient(responseVoltage, times)
  }, [responseVoltage])

  const responseParams = useMemo(() => computeResponseTime(responseVoltage), [responseVoltage])

  // View angle TV curves
  const viewAngleData = useMemo(() => {
    const voltages = []
    for (let v = 0; v <= 5; v += 0.2) voltages.push(v)
    return computeViewAngleTVCurve(incidenceAngle, azimuthAngle, voltages)
  }, [incidenceAngle, azimuthAngle])

  // Comparison mode data
  const comparisonData = useMemo(() => {
    const voltages = []
    for (let v = 0; v <= 5; v += 0.15) voltages.push(v)

    const tnData = voltages.map(v => {
      const tilt = solveTiltProfile(v)
      const T = computeTransmittanceJones(tilt, 90, wavelength, CELL_D, 0, 90)
      return { v, t: T }
    })
    const ipsData = voltages.map(v => {
      const tilt = solveIPSProfile(v)
      // IPS: polarizer at 45°, analyzer at 135°, in-plane rotation
      const VthIPS = Math.PI * Math.sqrt(K22 / (EPS0 * 5))
      const rotAngle = v > VthIPS ? Math.min(90, 45 * (v / VthIPS - 1)) : 0
      const gamma = (2 * Math.PI / (wavelength * 1e-9)) * (NE - NO) * CELL_D * 0.3
      const T = Math.sin(2 * (rotAngle * Math.PI / 180)) ** 2 * Math.sin(gamma / 2) ** 2
      return { v, t: Math.min(1, T) }
    })
    const vaData = voltages.map(v => {
      const tilt = solveVAProfile(v)
      const T = computeTransmittanceJones(tilt, 0, wavelength, CELL_D, 0, 0)
      return { v, t: T }
    })

    return { tn: tnData, ips: ipsData, va: vaData }
  }, [wavelength])

  // Grayscale pixel intensities
  const pixelIntensities = useMemo(() => {
    return pixelVoltages.map(v => {
      const tilt = solveTiltProfile(v)
      return computeTransmittanceJones(tilt, TWIST_ANGLE, 550, CELL_D, 0, 90)
    })
  }, [pixelVoltages])

  // Response time animation
  const animRef = useRef<number | null>(null)
  const animStartRef = useRef<number>(0)

  useEffect(() => {
    if (responseRunning) {
      animStartRef.current = performance.now()
      const animate = (now: number) => {
        const elapsed = (now - animStartRef.current) / 1000 // ms to s
        const t = (elapsed * 5) % 60 // speed up 5x, cycle every 60ms
        setResponseTime(t)
        animRef.current = requestAnimationFrame(animate)
      }
      animRef.current = requestAnimationFrame(animate)
    } else {
      if (animRef.current) cancelAnimationFrame(animRef.current)
    }
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current) }
  }, [responseRunning])

  // Average tilt angle
  const avgTilt = useMemo(() => {
    const interior = tiltProfile.slice(1, -1)
    return interior.reduce((a, b) => a + b, 0) / interior.length
  }, [tiltProfile])

  // ─── Rendering helpers ───
  const tiltToColor = (thetaDeg: number): string => {
    // Blue (0° = parallel) → Red (90° = vertical)
    const t = Math.max(0, Math.min(1, thetaDeg / 90))
    const r = Math.round(60 + 195 * t)
    const g = Math.round(80 * (1 - t))
    const b = Math.round(200 * (1 - t) + 20 * t)
    return `rgb(${r},${g},${b})`
  }

  return (
    <div className="h-full flex flex-col" style={{ background: '#FFFFFF' }}>
      {/* Header */}
      <div className="flex-shrink-0 flex items-center" style={{
        height: isMobile ? '44px' : '48px', backgroundColor: '#FFFFFF',
        borderBottom: '1px solid #CCCCCC', paddingLeft: isMobile ? '16px' : '24px', paddingRight: isMobile ? '16px' : '24px',
      }}>
        <button onClick={onBack} style={{
          fontFamily: FONT, fontSize: '12px', fontWeight: 400, color: '#555555',
          background: 'none', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: '4px',
          transition: 'color 200ms ease-out',
          minHeight: '36px',
        }} onMouseEnter={e => (e.currentTarget.style.color = '#1A1A1A')}
           onMouseLeave={e => (e.currentTarget.style.color = '#555555')}>
          ← 返回
        </button>
        <span style={{ margin: '0 8px', color: '#D0D0D0' }}>|</span>
        <h1 style={{ fontFamily: FONT, fontSize: isMobile ? '17px' : '20px', fontWeight: 600, color: '#1A1A1A', margin: 0 }}>
          液晶旋光光阀实验台
        </h1>
        {!isMobile && (
          <span style={{
            marginLeft: '8px', fontSize: '8px', fontWeight: 400, color: '#888888',
            fontFamily: FONT, padding: '1px 5px',
            border: '1px solid #D0D0D0', borderRadius: '2px',
          }}>
            Oseen-Frank + Berreman 4×4
          </span>
        )}
        <MobilePanelToggle onClick={() => setPanelOpen(true)} label="参数" />
      </div>

      <div className="flex flex-1" style={{ minHeight: 0 }}>
        {/* Left: Visualization Area */}
        <div className="flex-1 min-w-0 dot-grid custom-scrollbar" style={{
          display: 'flex', flexDirection: 'column', padding: isMobile ? '12px' : '16px', overflowY: 'auto',
          alignItems: 'center',
        }}>

          {/* Experiment mode tabs */}
          <div style={{
            display: 'flex', gap: '2px', marginBottom: '16px',
            borderBottom: '1px solid #E8ECF0', paddingBottom: '8px', width: '100%',
            justifyContent: 'center', flexWrap: 'wrap',
          }}>
            {([
              ['basic', '基本TN模式'],
              ['response', '响应时间'],
              ['viewangle', '视角特性'],
              ['comparison', '模式对比'],
              ['grayscale', '灰度寻址'],
            ] as [ExperimentMode, string][]).map(([key, label]) => (
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

          {/* ─── Basic Mode: 3D Instrument + T-V Curve + Director Profile ─── */}
          {expMode === 'basic' && (
            <>
              {/* 3D Optical Path Instrument */}
              <InstrumentSVG
                voltage={voltage}
                tiltProfile={tiltProfile}
                twistAngle={twistAngle}
                intensity={intensity}
                wavelength={wavelength}
                lcMode={lcMode}
                polConfig={polConfig}
                tiltToColor={tiltToColor}
              />

              {/* Intensity readout */}
              <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start', marginBottom: '16px', marginTop: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
                <IntensityReadout intensity={intensity} />
                {showRGB && rgbIntensities && <RGBReadout rgb={rgbIntensities} />}
              </div>

              {/* T-V Curve and Director Profile side by side */}
              <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', justifyContent: 'center' }}>
                <TVCurvePlot data={tvCurveData} voltage={voltage} intensity={intensity} />
                <DirectorProfilePlot tiltProfile={tiltProfile} />
              </div>
            </>
          )}

          {/* ─── Response Time Mode ─── */}
          {expMode === 'response' && (
            <ResponseTimePanel
              data={responseData}
              params={responseParams}
              voltage={responseVoltage}
              running={responseRunning}
              currentTime={responseTime}
              onVoltageChange={setResponseVoltage}
              onToggleRun={() => setResponseRunning(r => !r)}
            />
          )}

          {/* ─── View Angle Mode ─── */}
          {expMode === 'viewangle' && (
            <ViewAnglePanel
              incidenceAngle={incidenceAngle}
              azimuthAngle={azimuthAngle}
              data={viewAngleData}
              onIncidenceChange={setIncidenceAngle}
              onAzimuthChange={setAzimuthAngle}
            />
          )}

          {/* ─── Comparison Mode ─── */}
          {expMode === 'comparison' && (
            <ComparisonPanel data={comparisonData} wavelength={wavelength} />
          )}

          {/* ─── Grayscale Mode ─── */}
          {expMode === 'grayscale' && (
            <GrayscalePanel
              pixelVoltages={pixelVoltages}
              pixelIntensities={pixelIntensities}
              onPixelVoltageChange={(idx, v) => {
                const newV = [...pixelVoltages]
                newV[idx] = v
                setPixelVoltages(newV)
              }}
              onSetAllVoltages={(voltages) => setPixelVoltages(voltages)}
            />
          )}
        </div>

        {/* Right: Control Panel */}
        <ControlPanel open={panelOpen} onClose={() => setPanelOpen(false)} title="实验参数" desktopWidth="w-72">
          {/* Voltage control */}
          <SectionTitle>驱动电压</SectionTitle>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <input type="range" min="0" max="5" step="0.01" value={voltage}
              onChange={e => setVoltage(Number(e.target.value))}
              style={{ flex: 1, accentColor: '#333333' }}
            />
            <span className="tabular-nums" style={{ fontSize: '12px', fontWeight: 600, color: '#1A1A1A', fontFamily: FONT, minWidth: '44px' }}>
              {voltage.toFixed(2)}V
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '7px', color: '#888888', fontFamily: FONT }}>
            <span>0V</span>
            <span>Vth={VTH.toFixed(2)}V</span>
            <span>5V</span>
          </div>

          {/* LC Mode selection */}
          <SectionTitle>液晶模式</SectionTitle>
          <div style={{ display: 'flex', gap: '4px', marginBottom: '6px' }}>
            {(['TN', 'IPS', 'VA'] as LCMode[]).map(key => (
              <button key={key} onClick={() => { setLcMode(key); if (key === 'IPS') setPolConfig('normallyBlack') }} style={{
                fontSize: '10px', padding: '4px 10px', borderRadius: '2px',
                border: `1px solid ${lcMode === key ? '#333333' : '#D0D0D0'}`,
                backgroundColor: lcMode === key ? '#F0F3F6' : '#FFFFFF',
                color: '#1A1A1A', cursor: 'pointer', fontFamily: FONT,
                transition: 'border-color 200ms ease-out',
              }}>
                {key}
              </button>
            ))}
          </div>
          <div style={{ fontSize: '9px', color: '#888888', fontFamily: FONT, lineHeight: '1.5' }}>
            {lcMode === 'TN' && 'TN: 扭曲向列，螺旋90°，经典LCD模式'}
            {lcMode === 'IPS' && 'IPS: 面内切换，宽视角，高端显示器'}
            {lcMode === 'VA' && 'VA: 垂直排列，高对比度，电视面板'}
          </div>

          {/* Polarizer configuration */}
          {lcMode === 'TN' && (
            <>
              <SectionTitle>偏振片配置</SectionTitle>
              <div style={{ display: 'flex', gap: '4px', marginBottom: '4px' }}>
                {([['normallyWhite', '常白模式'], ['normallyBlack', '常黑模式']] as [PolConfig, string][]).map(([key, label]) => (
                  <button key={key} onClick={() => setPolConfig(key)} style={{
                    fontSize: '10px', padding: '4px 10px', borderRadius: '2px',
                    border: `1px solid ${polConfig === key ? '#333333' : '#D0D0D0'}`,
                    backgroundColor: polConfig === key ? '#F0F3F6' : '#FFFFFF',
                    color: '#1A1A1A', cursor: 'pointer', fontFamily: FONT,
                  }}>
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Wavelength */}
          <SectionTitle>波长</SectionTitle>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <input type="range" min="400" max="700" step="5" value={wavelength}
              onChange={e => setWavelength(Number(e.target.value))}
              style={{ flex: 1, accentColor: '#333333' }}
            />
            <span className="tabular-nums" style={{ fontSize: '11px', fontWeight: 600, color: '#1A1A1A', fontFamily: FONT, minWidth: '44px' }}>
              {wavelength}nm
            </span>
          </div>

          {/* RGB toggle */}
          <SectionTitle>RGB子像素演示</SectionTitle>
          <label style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            fontSize: '10px', color: '#555555', fontFamily: FONT, cursor: 'pointer',
          }}>
            <input type="checkbox" checked={showRGB} onChange={e => setShowRGB(e.target.checked)}
              style={{ accentColor: '#333333' }}
            />
            启用RGB彩色混合
          </label>

          {/* Status readouts */}
          <SectionTitle>实时参数</SectionTitle>
          <div style={{
            backgroundColor: '#FFFFFF', border: '1px solid #D0D0D0',
            borderRadius: '2px', padding: '8px', fontSize: '10px',
            fontFamily: FONT, lineHeight: '2',
          }}>
            <div style={{ color: '#555555' }}>驱动电压: <span className="tabular-nums" style={{ color: '#1A1A1A', fontWeight: 600 }}>{voltage.toFixed(2)} V</span></div>
            <div style={{ color: '#555555' }}>平均倾斜角: <span className="tabular-nums" style={{ color: '#1A1A1A', fontWeight: 600 }}>{avgTilt.toFixed(1)}°</span></div>
            <div style={{ color: '#555555' }}>阈值电压: <span className="tabular-nums" style={{ color: '#1A1A1A', fontWeight: 600 }}>{VTH.toFixed(3)} V</span></div>
            <div style={{ color: '#555555' }}>归一化光强: <span className="tabular-nums" style={{ color: '#1A1A1A', fontWeight: 600 }}>{intensity.toFixed(4)}</span></div>
            <div style={{ color: '#555555' }}>盒厚: <span className="tabular-nums" style={{ color: '#1A1A1A', fontWeight: 600 }}>5.0 μm</span></div>
          </div>

          {/* LC Material Parameters */}
          <SectionTitle>液晶材料参数 (5CB)</SectionTitle>
          <div style={{
            backgroundColor: '#FFFFFF', border: '1px solid #D0D0D0',
            borderRadius: '2px', padding: '8px', fontSize: '9px',
            fontFamily: FONT, lineHeight: '1.8', color: '#666666',
          }}>
            <div>K₁₁ = 6.2 pN (展曲)</div>
            <div>K₂₂ = 3.9 pN (扭曲)</div>
            <div>K₃₃ = 8.2 pN (弯曲)</div>
            <div>Δε = 11.5 (介电各向异性)</div>
            <div>nₒ = {NO}, nₑ = {NE}</div>
            <div>γ₁ = 0.081 Pa·s (旋转粘度)</div>
          </div>

          {/* Physics explanation */}
          <SectionTitle>原理说明</SectionTitle>
          <div style={{ fontSize: '9px', color: '#888888', fontFamily: FONT, lineHeight: '1.7' }}>
            <div>• Oseen-Frank弹性自由能最小化</div>
            <div>• 有限差分法求解θ(z)分布</div>
            <div>• 4×4 Berreman矩阵法计算透射率</div>
            <div>• Freedericksz转变: Vth = π√(K₁₁/ε₀Δε)</div>
            <div>• TN模式90°螺旋扭曲结构</div>
            <div>• 加压后分子沿电场方向竖起</div>
            <div>• 旋光能力随电压增大而消失</div>
          </div>
        </ControlPanel>
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 flex items-center mt-auto" style={{
        height: '24px', backgroundColor: '#FFFFFF',
        borderTop: '1px solid #CCCCCC', paddingLeft: isMobile ? '16px' : '24px', paddingRight: isMobile ? '16px' : '24px',
      }}>
        <span className="tabular-nums" style={{
          fontFamily: FONT, fontSize: isMobile ? '9px' : '10px', color: '#888888',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {isMobile
            ? 'v2.0 · 液晶旋光光阀'
            : 'v2.0 · Oseen-Frank弹性理论 + Berreman 4×4矩阵法'}
        </span>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════
   SUB-COMPONENTS
   ═══════════════════════════════════════════════ */

// ─── 3D Instrument SVG ───
function InstrumentSVG({
  voltage, tiltProfile, twistAngle, intensity, wavelength, lcMode, polConfig, tiltToColor,
}: {
  voltage: number
  tiltProfile: number[]
  twistAngle: number
  intensity: number
  wavelength: number
  lcMode: LCMode
  polConfig: PolConfig
  tiltToColor: (theta: number) => string
}) {
  const beamColor = wavelengthToColor(wavelength)
  const N = tiltProfile.length - 1

  // Generate director positions for 3D cell
  const directors = useMemo(() => {
    const result: { x: number; y: number; theta: number; phi: number }[] = []
    const rows = 7
    const cols = 3
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const layerIdx = Math.round((r / (rows - 1)) * N)
        const theta = tiltProfile[layerIdx] || PRETILT
        const phi = (twistAngle * r) / (rows - 1)
        result.push({
          x: 8 + c * 16,
          y: 6 + r * 8,
          theta,
          phi,
        })
      }
    }
    return result
  }, [tiltProfile, twistAngle, N])

  // Polarization rotation arrows along beam in LC cell
  const polArrows = useMemo(() => {
    const result: { x: number; angle: number; opacity: number }[] = []
    const nArrows = 5
    for (let i = 0; i < nArrows; i++) {
      const frac = (i + 0.5) / nArrows
      const layerIdx = Math.round(frac * N)
      const theta = tiltProfile[layerIdx] || PRETILT
      const phi = (twistAngle * frac)
      // Effective polarization rotation depends on theta and phi
      const effectiveAngle = phi * Math.cos((theta * Math.PI) / 180)
      result.push({
        x: 280 + frac * 140,
        angle: effectiveAngle,
        opacity: Math.cos((theta * Math.PI) / 180) ** 0.5,
      })
    }
    return result
  }, [tiltProfile, twistAngle, N])

  return (
    <svg width="720" height="200" viewBox="0 0 720 200" style={{ marginBottom: '8px', maxWidth: '100%', height: 'auto' }}>
      {/* Optical axis */}
      <line x1="20" y1="100" x2="700" y2="100" stroke="#888888" strokeWidth="0.6" strokeDasharray="6,3,2,3" />

      {/* Light source */}
      <g transform="translate(50, 100)">
        <rect x="-16" y="-22" width="32" height="44" fill="none" stroke="#333333" strokeWidth="1.2" rx="2" />
        <rect x="-12" y="-18" width="24" height="36" fill="#FFFDE0" stroke="none" opacity="0.5" />
        <text x="0" y="3" textAnchor="middle" fontSize="7" fill="#888888" fontFamily={FONT}>LED</text>
        <text x="0" y="36" textAnchor="middle" fontSize="7" fill="#555555" fontFamily={FONT}>单色光源</text>
      </g>

      {/* Polarizer - semi-transparent sheet */}
      <g transform="translate(150, 100)">
        <rect x="-3" y="-40" width="6" height="80" fill="#E8ECF0" stroke="#333333" strokeWidth="1" opacity="0.6" />
        {/* Transmission axis */}
        <line x1="0" y1="-35" x2="0" y2="35" stroke="#FFFFFF" strokeWidth="1.5" />
        <line x1="0" y1="-35" x2="0" y2="35" stroke="#333333" strokeWidth="0.8" strokeDasharray="4,3" />
        <text x="0" y="56" textAnchor="middle" fontSize="7" fill="#555555" fontFamily={FONT}>起偏器</text>
        <text x="0" y="66" textAnchor="middle" fontSize="6" fill="#888888" fontFamily={FONT}>0°</text>
      </g>

      {/* Beam 1: source to polarizer */}
      <line x1="70" y1="100" x2="147" y2="100" stroke={beamColor} strokeWidth="2.5" />

      {/* Beam 2: polarizer to LC cell */}
      <line x1="153" y1="100" x2="280" y2="100" stroke={beamColor} strokeWidth="2.5" />

      {/* LC Cell - 3D transparent box */}
      <g transform="translate(280, 100)">
        {/* Cell body - transparent box with 3D perspective */}
        <rect x="-8" y="-45" width="156" height="90" fill="none" stroke="#333333" strokeWidth="1.2" rx="1" />
        {/* Glass plates */}
        <rect x="-4" y="-42" width="8" height="84" fill="#E8ECF0" opacity="0.3" stroke="#333333" strokeWidth="0.6" />
        <rect x="140" y="-42" width="8" height="84" fill="#E8ECF0" opacity="0.3" stroke="#333333" strokeWidth="0.6" />

        {/* Voltage electrodes */}
        <text x="72" y="-48" textAnchor="middle" fontSize="7" fill="#888888" fontFamily={FONT}>+V</text>
        <text x="72" y="54" textAnchor="middle" fontSize="7" fill="#888888" fontFamily={FONT}>−V</text>
        <line x1="10" y1="-42" x2="138" y2="-42" stroke="#CC0000" strokeWidth="0.5" strokeDasharray="3,2" />
        <line x1="10" y1="42" x2="138" y2="42" stroke="#3333CC" strokeWidth="0.5" strokeDasharray="3,2" />

        {/* Director lines - color-coded by tilt angle */}
        {directors.map((d, idx) => {
          const thetaRad = (d.theta * Math.PI) / 180
          const phiRad = (d.phi * Math.PI) / 180
          const len = 7
          // 3D projection: tilt affects vertical component, twist affects horizontal
          const dx = len * Math.sin(thetaRad) * Math.cos(phiRad)
          const dy = -len * Math.cos(thetaRad) // vertical component (up = negative)
          const dxTwist = len * Math.sin(thetaRad) * Math.sin(phiRad)

          // Project to 2D (isometric-ish)
          const px = d.x + dx * 0.8 + dxTwist * 0.3
          const py = d.y - 20 + dy * 0.7

          return (
            <line key={idx}
              x1={px - dx * 0.5 - dxTwist * 0.15}
              y1={py + dy * 0.35}
              x2={px + dx * 0.5 + dxTwist * 0.15}
              y2={py - dy * 0.35}
              stroke={tiltToColor(d.theta)} strokeWidth="1.2"
            />
          )
        })}

        <text x="70" y="68" textAnchor="middle" fontSize="7" fill="#555555" fontFamily={FONT}>
          液晶盒 ({lcMode}模式)
        </text>
      </g>

      {/* Polarization rotation arrows inside cell */}
      {polArrows.map((pa, idx) => {
        const aRad = (pa.angle * Math.PI) / 180
        const len = 8
        return (
          <g key={idx} transform={`translate(${pa.x}, 100)`}>
            <line x1={-len * Math.cos(aRad)} y1={-len * Math.sin(aRad)}
              x2={len * Math.cos(aRad)} y2={len * Math.sin(aRad)}
              stroke={beamColor} strokeWidth="0.8" opacity={pa.opacity * 0.7} />
            <circle cx={0} cy={0} r="1.5" fill={beamColor} opacity={pa.opacity * 0.5} />
          </g>
        )
      })}

      {/* Beam 3: LC cell to analyzer */}
      <line x1="436" y1="100" x2="510" y2="100" stroke={beamColor} strokeWidth="2.5" opacity={0.3 + intensity * 0.7} />

      {/* Analyzer - semi-transparent sheet */}
      <g transform="translate(520, 100)">
        <rect x="-3" y="-40" width="6" height="80" fill="#E8ECF0" stroke="#333333" strokeWidth="1" opacity="0.6" />
        {(() => {
          const aAngle = polConfig === 'normallyWhite' ? 90 : 0
          const aRad = (aAngle * Math.PI) / 180
          return (
            <line x1={-35 * Math.sin(aRad)} y1={-35 * Math.cos(aRad)}
              x2={35 * Math.sin(aRad)} y2={35 * Math.cos(aRad)}
              stroke="#333333" strokeWidth="0.8" strokeDasharray="4,3" />
          )
        })()}
        <text x="0" y="56" textAnchor="middle" fontSize="7" fill="#555555" fontFamily={FONT}>检偏器</text>
        <text x="0" y="66" textAnchor="middle" fontSize="6" fill="#888888" fontFamily={FONT}>
          {polConfig === 'normallyWhite' ? '90°' : '0°'}
        </text>
      </g>

      {/* Beam 4: analyzer to detector */}
      {intensity > 0.01 && (
        <line x1="523" y1="100" x2="630" y2="100" stroke={beamColor} strokeWidth="2.5" opacity={intensity} />
      )}

      {/* Detector with light spot */}
      <g transform="translate(650, 100)">
        <rect x="-12" y="-20" width="24" height="40" fill="#333333" />
        {/* Light spot - size proportional to intensity */}
        {intensity > 0.01 && (
          <circle cx="0" cy="0" r={3 + intensity * 12} fill={beamColor} opacity={0.15 + intensity * 0.6} />
        )}
        <text x="0" y="32" textAnchor="middle" fontSize="7" fill="#555555" fontFamily={FONT}>探测器</text>
      </g>

      {/* Voltage indicator */}
      <g transform="translate(350, 180)">
        <text x="0" y="0" textAnchor="middle" fontSize="9" fill="#555555" fontFamily={FONT} className="tabular-nums">
          V = {voltage.toFixed(2)} V
        </text>
      </g>

      {/* Color legend for directors */}
      <g transform="translate(20, 188)">
        <text x="0" y="0" fontSize="7" fill="#888888" fontFamily={FONT}>指向矢倾角:</text>
        <rect x="68" y="-7" width="12" height="8" fill="rgb(60,80,200)" />
        <text x="82" y="0" fontSize="6" fill="#888888" fontFamily={FONT}>0°</text>
        <rect x="96" y="-7" width="12" height="8" fill="rgb(160,40,110)" />
        <text x="110" y="0" fontSize="6" fill="#888888" fontFamily={FONT}>45°</text>
        <rect x="130" y="-7" width="12" height="8" fill="rgb(255,20,20)" />
        <text x="144" y="0" fontSize="6" fill="#888888" fontFamily={FONT}>90°</text>
      </g>
    </svg>
  )
}

// ─── Intensity Readout ───
function IntensityReadout({ intensity }: { intensity: number }) {
  return (
    <div style={{
      padding: '12px', border: '1px solid #D0D0D0', borderRadius: '2px',
      backgroundColor: '#FAFAFA', textAlign: 'center', minWidth: '130px',
    }}>
      <div style={{ fontSize: '10px', color: '#555555', fontFamily: FONT }}>归一化光强</div>
      <div className="tabular-nums" style={{ fontSize: '28px', fontWeight: 600, color: '#1A1A1A', fontFamily: FONT }}>
        {intensity.toFixed(4)}
      </div>
      <div style={{ width: '100%', height: '6px', backgroundColor: '#E8ECF0', marginTop: '4px', borderRadius: '1px' }}>
        <div style={{
          width: `${intensity * 100}%`, height: '100%',
          backgroundColor: '#CC0000', borderRadius: '1px',
          transition: 'width 100ms ease-out',
        }} />
      </div>
    </div>
  )
}

// ─── RGB Readout ───
function RGBReadout({ rgb }: { rgb: { r: number; g: number; b: number } }) {
  return (
    <div style={{
      padding: '12px', border: '1px solid #D0D0D0', borderRadius: '2px',
      backgroundColor: '#FAFAFA', textAlign: 'center',
    }}>
      <div style={{ fontSize: '10px', color: '#555555', fontFamily: FONT, marginBottom: '6px' }}>RGB子像素</div>
      <div style={{ display: 'flex', gap: '6px' }}>
        {[
          { label: 'R', val: rgb.r, color: '#CC0000' },
          { label: 'G', val: rgb.g, color: '#00AA44' },
          { label: 'B', val: rgb.b, color: '#4050B0' },
        ].map(ch => (
          <div key={ch.label} style={{ textAlign: 'center' }}>
            <div style={{
              width: '28px', height: '28px', borderRadius: '2px',
              border: '1px solid #D0D0D0',
              backgroundColor: ch.color, opacity: ch.val,
            }} />
            <div className="tabular-nums" style={{ fontSize: '8px', color: '#1A1A1A', fontFamily: FONT, marginTop: '2px' }}>
              {ch.val.toFixed(2)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── T-V Curve Plot ───
function TVCurvePlot({ data, voltage, intensity }: {
  data: { v: number; t: number }[]
  voltage: number
  intensity: number
}) {
  const w = 300
  const h = 160
  const pad = 32

  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: '12px', fontWeight: 600, color: '#1A1A1A', fontFamily: FONT, marginBottom: '6px' }}>
        T-V 特性曲线
      </div>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ border: '1px solid #D0D0D0', backgroundColor: '#FFFFFF', maxWidth: '100%', height: 'auto' }}>
        {/* Grid */}
        {[0.25, 0.5, 0.75].map(f => (
          <g key={f}>
            <line x1={pad} y1={pad + (h - pad * 2) * f} x2={w - pad} y2={pad + (h - pad * 2) * f}
              stroke="#E8ECF0" strokeWidth="0.5" />
            <line x1={pad + (w - pad * 2) * f} y1={pad} x2={pad + (w - pad * 2) * f} y2={h - pad}
              stroke="#E8ECF0" strokeWidth="0.5" />
          </g>
        ))}
        {/* Axes */}
        <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="#888888" strokeWidth="0.8" />
        <line x1={pad} y1={pad} x2={pad} y2={h - pad} stroke="#888888" strokeWidth="0.8" />
        {/* Curve */}
        {(() => {
          const plotW = w - pad * 2
          const plotH = h - pad * 2
          const pts = data.map((d, i) => {
            const x = pad + (d.v / 5) * plotW
            const y = pad + plotH - d.t * plotH
            return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
          })
          return <path d={pts.join(' ')} fill="none" stroke="#1A1A1A" strokeWidth="1.2" />
        })()}
        {/* Vth marker */}
        <line x1={pad + (VTH / 5) * (w - pad * 2)} y1={pad}
          x2={pad + (VTH / 5) * (w - pad * 2)} y2={h - pad}
          stroke="#CC0000" strokeWidth="0.6" strokeDasharray="3,2" />
        <text x={pad + (VTH / 5) * (w - pad * 2)} y={pad - 4}
          textAnchor="middle" fontSize="6" fill="#CC0000" fontFamily={FONT}>Vth</text>
        {/* Current point */}
        {(() => {
          const plotW = w - pad * 2
          const plotH = h - pad * 2
          const x = pad + (voltage / 5) * plotW
          const y = pad + plotH - intensity * plotH
          return <circle cx={x} cy={y} r="3.5" fill="#CC0000" />
        })()}
        {/* Labels */}
        <text x={w / 2} y={h - 4} textAnchor="middle" fontSize="8" fill="#555555" fontFamily={FONT}>V (V)</text>
        <text x={8} y={h / 2} textAnchor="middle" fontSize="8" fill="#555555" fontFamily={FONT}
          transform={`rotate(-90, 8, ${h / 2})`}>T/T₀</text>
        <text x={pad} y={h - pad + 12} textAnchor="middle" fontSize="6" fill="#888888" fontFamily={FONT} className="tabular-nums">0</text>
        <text x={w - pad} y={h - pad + 12} textAnchor="middle" fontSize="6" fill="#888888" fontFamily={FONT} className="tabular-nums">5.0</text>
        <text x={pad - 4} y={pad + 4} textAnchor="end" fontSize="6" fill="#888888" fontFamily={FONT} className="tabular-nums">1.0</text>
        <text x={pad - 4} y={h - pad + 4} textAnchor="end" fontSize="6" fill="#888888" fontFamily={FONT} className="tabular-nums">0</text>
      </svg>
    </div>
  )
}

// ─── Director Profile Plot θ(z) ───
function DirectorProfilePlot({ tiltProfile }: { tiltProfile: number[] }) {
  const w = 300
  const h = 160
  const pad = 32
  const N = tiltProfile.length - 1

  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: '12px', fontWeight: 600, color: '#1A1A1A', fontFamily: FONT, marginBottom: '6px' }}>
        指向矢分布 θ(z)
      </div>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ border: '1px solid #D0D0D0', backgroundColor: '#FFFFFF', maxWidth: '100%', height: 'auto' }}>
        {/* Grid */}
        {[0.25, 0.5, 0.75].map(f => (
          <g key={f}>
            <line x1={pad} y1={pad + (h - pad * 2) * f} x2={w - pad} y2={pad + (h - pad * 2) * f}
              stroke="#E8ECF0" strokeWidth="0.5" />
          </g>
        ))}
        {/* Axes */}
        <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="#888888" strokeWidth="0.8" />
        <line x1={pad} y1={pad} x2={pad} y2={h - pad} stroke="#888888" strokeWidth="0.8" />
        {/* Profile curve */}
        {(() => {
          const plotW = w - pad * 2
          const plotH = h - pad * 2
          const pts = tiltProfile.map((theta, i) => {
            const x = pad + (i / N) * plotW
            const y = pad + plotH - (theta / 90) * plotH
            return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
          })
          return <path d={pts.join(' ')} fill="none" stroke="#4050B0" strokeWidth="1.5" />
        })()}
        {/* Fill area */}
        {(() => {
          const plotW = w - pad * 2
          const plotH = h - pad * 2
          const fillPts = tiltProfile.map((theta, i) => {
            const x = pad + (i / N) * plotW
            const y = pad + plotH - (theta / 90) * plotH
            return `L${x.toFixed(1)},${y.toFixed(1)}`
          })
          const fillPath = `M${pad},${h - pad} ${fillPts.join(' ')} L${w - pad},${h - pad} Z`
          return <path d={fillPath} fill="#4050B0" opacity="0.06" />
        })()}
        {/* Labels */}
        <text x={w / 2} y={h - 4} textAnchor="middle" fontSize="8" fill="#555555" fontFamily={FONT}>z/d</text>
        <text x={8} y={h / 2} textAnchor="middle" fontSize="8" fill="#555555" fontFamily={FONT}
          transform={`rotate(-90, 8, ${h / 2})`}>θ (°)</text>
        <text x={pad} y={h - pad + 12} textAnchor="middle" fontSize="6" fill="#888888" fontFamily={FONT} className="tabular-nums">0</text>
        <text x={w - pad} y={h - pad + 12} textAnchor="middle" fontSize="6" fill="#888888" fontFamily={FONT} className="tabular-nums">1.0</text>
        <text x={pad - 4} y={h - pad + 4} textAnchor="end" fontSize="6" fill="#888888" fontFamily={FONT} className="tabular-nums">0°</text>
        <text x={pad - 4} y={pad + 4} textAnchor="end" fontSize="6" fill="#888888" fontFamily={FONT} className="tabular-nums">90°</text>
        {/* 45° reference line */}
        <line x1={pad} y1={pad + (h - pad * 2) * 0.5} x2={w - pad} y2={pad + (h - pad * 2) * 0.5}
          stroke="#888888" strokeWidth="0.4" strokeDasharray="4,3" />
        <text x={pad - 4} y={pad + (h - pad * 2) * 0.5 + 3} textAnchor="end" fontSize="6" fill="#888888" fontFamily={FONT} className="tabular-nums">45°</text>
      </svg>
    </div>
  )
}

// ─── Response Time Panel ───
function ResponseTimePanel({
  data, params, voltage, running, currentTime,
  onVoltageChange, onToggleRun,
}: {
  data: { time: number; intensity: number }[]
  params: { tauRise: number; tauFall: number }
  voltage: number
  running: boolean
  currentTime: number
  onVoltageChange: (v: number) => void
  onToggleRun: () => void
}) {
  const w = 500
  const h = 200
  const pad = 36

  // Driving voltage waveform
  const waveform = useMemo(() => {
    const pts: string[] = []
    for (let t = 0; t <= 60; t += 0.5) {
      const x = pad + (t / 60) * (w - pad * 2)
      const y = t < 20 ? h - pad - 0.8 * (h - pad * 2) : h - pad
      pts.push(`${t === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
    }
    return pts.join(' ')
  }, [w, h])

  return (
    <div style={{ width: '100%', maxWidth: '600px' }}>
      <div style={{ fontSize: '12px', fontWeight: 600, color: '#1A1A1A', fontFamily: FONT, marginBottom: '12px', textAlign: 'center' }}>
        响应时间测量
      </div>

      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', justifyContent: 'center', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{
          padding: '8px 12px', border: '1px solid #D0D0D0', borderRadius: '2px',
          backgroundColor: '#FAFAFA', textAlign: 'center',
        }}>
          <div style={{ fontSize: '9px', color: '#888888', fontFamily: FONT }}>τ_rise</div>
          <div className="tabular-nums" style={{ fontSize: '16px', fontWeight: 600, color: '#CC0000', fontFamily: FONT }}>
            {params.tauRise === Infinity ? '∞' : `${(params.tauRise * 1000).toFixed(1)} ms`}
          </div>
        </div>
        <div style={{
          padding: '8px 12px', border: '1px solid #D0D0D0', borderRadius: '2px',
          backgroundColor: '#FAFAFA', textAlign: 'center',
        }}>
          <div style={{ fontSize: '9px', color: '#888888', fontFamily: FONT }}>τ_fall</div>
          <div className="tabular-nums" style={{ fontSize: '16px', fontWeight: 600, color: '#4050B0', fontFamily: FONT }}>
            {(params.tauFall * 1000).toFixed(1)} ms
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={{ fontSize: '9px', color: '#888888', fontFamily: FONT }}>方波电压</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <input type="range" min="1" max="5" step="0.1" value={voltage}
              onChange={e => onVoltageChange(Number(e.target.value))}
              style={{ width: '100px', accentColor: '#333333' }}
            />
            <span className="tabular-nums" style={{ fontSize: '10px', fontWeight: 600, color: '#1A1A1A', fontFamily: FONT }}>
              {voltage.toFixed(1)}V
            </span>
          </div>
          <button onClick={onToggleRun} style={{
            fontSize: '9px', padding: '3px 10px', borderRadius: '2px',
            border: '1px solid #333333', backgroundColor: running ? '#F0F3F6' : '#FFFFFF',
            color: '#1A1A1A', cursor: 'pointer', fontFamily: FONT,
          }}>
            {running ? '⏸ 暂停' : '▶ 运行'}
          </button>
        </div>
      </div>

      {/* Transient response plot */}
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ border: '1px solid #D0D0D0', backgroundColor: '#FFFFFF', maxWidth: '100%', height: 'auto' }}>
        {/* Grid */}
        {[0.25, 0.5, 0.75].map(f => (
          <line key={f} x1={pad} y1={pad + (h - pad * 2) * f} x2={w - pad} y2={pad + (h - pad * 2) * f}
            stroke="#E8ECF0" strokeWidth="0.5" />
        ))}
        {/* Axes */}
        <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="#888888" strokeWidth="0.8" />
        <line x1={pad} y1={pad} x2={pad} y2={h - pad} stroke="#888888" strokeWidth="0.8" />

        {/* Driving voltage waveform (scaled) */}
        <path d={waveform} fill="none" stroke="#888888" strokeWidth="0.6" strokeDasharray="3,2" />

        {/* Intensity response curve */}
        {(() => {
          const plotW = w - pad * 2
          const plotH = h - pad * 2
          const pts = data.map((d, i) => {
            const x = pad + (d.time / 60) * plotW
            const y = pad + plotH - d.intensity * plotH
            return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
          })
          return <path d={pts.join(' ')} fill="none" stroke="#1A1A1A" strokeWidth="1.2" />
        })()}

        {/* Current time marker */}
        {running && (() => {
          const x = pad + (currentTime / 60) * (w - pad * 2)
          return <line x1={x} y1={pad} x2={x} y2={h - pad} stroke="#CC0000" strokeWidth="0.8" />
        })()}

        {/* Phase labels */}
        <text x={pad + (10 / 60) * (w - pad * 2)} y={h - pad + 14}
          textAnchor="middle" fontSize="7" fill="#CC0000" fontFamily={FONT}>加压</text>
        <text x={pad + (40 / 60) * (w - pad * 2)} y={h - pad + 14}
          textAnchor="middle" fontSize="7" fill="#4050B0" fontFamily={FONT}>撤压</text>

        {/* Axis labels */}
        <text x={w / 2} y={h - 4} textAnchor="middle" fontSize="8" fill="#555555" fontFamily={FONT}>t (ms)</text>
        <text x={8} y={h / 2} textAnchor="middle" fontSize="8" fill="#555555" fontFamily={FONT}
          transform={`rotate(-90, 8, ${h / 2})`}>T/T₀</text>
      </svg>

      {/* Explanation */}
      <div style={{ fontSize: '9px', color: '#888888', fontFamily: FONT, lineHeight: '1.7', marginTop: '12px', textAlign: 'center' }}>
        <div>τ_rise = γ₁d²/(ε₀ΔεV² - Kπ²) · 上升时间取决于驱动电压</div>
        <div>τ_fall = γ₁d²/(Kπ²) · 下降时间仅取决于弹性回复力</div>
        <div>方波周期：20ms加压 + 40ms撤压</div>
      </div>
    </div>
  )
}

// ─── View Angle Panel ───
function ViewAnglePanel({
  incidenceAngle, azimuthAngle, data,
  onIncidenceChange, onAzimuthChange,
}: {
  incidenceAngle: number
  azimuthAngle: number
  data: { v: number; t: number }[]
  onIncidenceChange: (a: number) => void
  onAzimuthChange: (a: number) => void
}) {
  const w = 300
  const h = 180
  const pad = 32

  // Polar plot for view angle
  const polarR = 100

  return (
    <div style={{ width: '100%', maxWidth: '650px' }}>
      <div style={{ fontSize: '12px', fontWeight: 600, color: '#1A1A1A', fontFamily: FONT, marginBottom: '12px', textAlign: 'center' }}>
        视角特性模拟
      </div>

      <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'flex-start' }}>
        {/* Controls */}
        <div style={{ minWidth: '200px' }}>
          <div style={{ marginBottom: '12px' }}>
            <div style={{ fontSize: '10px', color: '#555555', fontFamily: FONT, marginBottom: '4px' }}>入射角</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input type="range" min="0" max="80" step="1" value={incidenceAngle}
                onChange={e => onIncidenceChange(Number(e.target.value))}
                style={{ flex: 1, accentColor: '#333333' }}
              />
              <span className="tabular-nums" style={{ fontSize: '11px', fontWeight: 600, color: '#1A1A1A', fontFamily: FONT }}>
                {incidenceAngle}°
              </span>
            </div>
          </div>
          <div style={{ marginBottom: '12px' }}>
            <div style={{ fontSize: '10px', color: '#555555', fontFamily: FONT, marginBottom: '4px' }}>方位角</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input type="range" min="0" max="360" step="5" value={azimuthAngle}
                onChange={e => onAzimuthChange(Number(e.target.value))}
                style={{ flex: 1, accentColor: '#333333' }}
              />
              <span className="tabular-nums" style={{ fontSize: '11px', fontWeight: 600, color: '#1A1A1A', fontFamily: FONT }}>
                {azimuthAngle}°
              </span>
            </div>
          </div>

          {/* Incident ray diagram */}
          <svg width="200" height="120" viewBox="0 0 200 120" style={{ border: '1px solid #D0D0D0', backgroundColor: '#FFFFFF', maxWidth: '100%', height: 'auto' }}>
            {/* LC cell surface */}
            <rect x="60" y="30" width="80" height="60" fill="none" stroke="#333333" strokeWidth="1" />
            <text x="100" y="105" textAnchor="middle" fontSize="7" fill="#888888" fontFamily={FONT}>液晶盒</text>

            {/* Normal */}
            <line x1="100" y1="25" x2="100" y2="0" stroke="#888888" strokeWidth="0.5" strokeDasharray="3,2" />
            <text x="110" y="14" fontSize="6" fill="#888888" fontFamily={FONT}>法线</text>

            {/* Incident ray */}
            {(() => {
              const incRad = (incidenceAngle * Math.PI) / 180
              const rayLen = 50
              const endX = 100
              const endY = 30
              const startX = endX - rayLen * Math.sin(incRad)
              const startY = endY - rayLen * Math.cos(incRad)
              return (
                <g>
                  <line x1={startX} y1={startY} x2={endX} y2={endY}
                    stroke="#CC0000" strokeWidth="1.5" />
                  {/* Angle arc */}
                  {incidenceAngle > 0 && (
                    <path d={`M${100 - 15 * Math.sin(incRad)},${30 - 15 * Math.cos(incRad)} A15,15 0 0,1 ${100},${30 - 15}`}
                      fill="none" stroke="#888888" strokeWidth="0.5" />
                  )}
                  <text x={100 - 20 * Math.sin(incRad / 2)} y={30 - 22 * Math.cos(incRad / 2)}
                    textAnchor="middle" fontSize="7" fill="#CC0000" fontFamily={FONT} className="tabular-nums">
                    {incidenceAngle}°
                  </text>
                </g>
              )
            })()}

            {/* Transmitted ray */}
            <line x1="100" y1="90" x2="100" y2="115" stroke="#CC0000" strokeWidth="1.5" opacity="0.5" />
          </svg>

          <div style={{ fontSize: '9px', color: '#888888', fontFamily: FONT, lineHeight: '1.6', marginTop: '8px' }}>
            TN液晶视角不对称：左右对称但上下不对称，这是TN模式的主要缺点。
          </div>
        </div>

        {/* T-V curve at selected angle */}
        <div>
          <div style={{ fontSize: '10px', fontWeight: 600, color: '#1A1A1A', fontFamily: FONT, marginBottom: '6px', textAlign: 'center' }}>
            T-V曲线 @ θᵢ={incidenceAngle}°, φ={azimuthAngle}°
          </div>
          <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ border: '1px solid #D0D0D0', backgroundColor: '#FFFFFF', maxWidth: '100%', height: 'auto' }}>
            {/* Grid */}
            {[0.25, 0.5, 0.75].map(f => (
              <g key={f}>
                <line x1={pad} y1={pad + (h - pad * 2) * f} x2={w - pad} y2={pad + (h - pad * 2) * f}
                  stroke="#E8ECF0" strokeWidth="0.5" />
                <line x1={pad + (w - pad * 2) * f} y1={pad} x2={pad + (w - pad * 2) * f} y2={h - pad}
                  stroke="#E8ECF0" strokeWidth="0.5" />
              </g>
            ))}
            <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="#888888" strokeWidth="0.8" />
            <line x1={pad} y1={pad} x2={pad} y2={h - pad} stroke="#888888" strokeWidth="0.8" />
            {(() => {
              const plotW = w - pad * 2
              const plotH = h - pad * 2
              const pts = data.map((d, i) => {
                const x = pad + (d.v / 5) * plotW
                const y = pad + plotH - Math.min(1, d.t) * plotH
                return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
              })
              return <path d={pts.join(' ')} fill="none" stroke="#1A1A1A" strokeWidth="1.2" />
            })()}
            <text x={w / 2} y={h - 4} textAnchor="middle" fontSize="8" fill="#555555" fontFamily={FONT}>V (V)</text>
            <text x={8} y={h / 2} textAnchor="middle" fontSize="8" fill="#555555" fontFamily={FONT}
              transform={`rotate(-90, 8, ${h / 2})`}>T/T₀</text>
          </svg>
        </div>
      </div>
    </div>
  )
}

// ─── Comparison Panel ───
function ComparisonPanel({
  data, wavelength,
}: {
  data: { tn: { v: number; t: number }[]; ips: { v: number; t: number }[]; va: { v: number; t: number }[] }
  wavelength: number
}) {
  const w = 500
  const h = 200
  const pad = 36

  return (
    <div style={{ width: '100%', maxWidth: '600px' }}>
      <div style={{ fontSize: '12px', fontWeight: 600, color: '#1A1A1A', fontFamily: FONT, marginBottom: '12px', textAlign: 'center' }}>
        液晶模式对比
      </div>

      {/* Comparison T-V curves */}
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ border: '1px solid #D0D0D0', backgroundColor: '#FFFFFF', maxWidth: '100%', height: 'auto' }}>
        {[0.25, 0.5, 0.75].map(f => (
          <g key={f}>
            <line x1={pad} y1={pad + (h - pad * 2) * f} x2={w - pad} y2={pad + (h - pad * 2) * f}
              stroke="#E8ECF0" strokeWidth="0.5" />
            <line x1={pad + (w - pad * 2) * f} y1={pad} x2={pad + (w - pad * 2) * f} y2={h - pad}
              stroke="#E8ECF0" strokeWidth="0.5" />
          </g>
        ))}
        <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="#888888" strokeWidth="0.8" />
        <line x1={pad} y1={pad} x2={pad} y2={h - pad} stroke="#888888" strokeWidth="0.8" />

        {/* TN curve */}
        {(() => {
          const plotW = w - pad * 2
          const plotH = h - pad * 2
          const pts = data.tn.map((d, i) => {
            const x = pad + (d.v / 5) * plotW
            const y = pad + plotH - d.t * plotH
            return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
          })
          return <path d={pts.join(' ')} fill="none" stroke="#CC0000" strokeWidth="1.5" />
        })()}

        {/* IPS curve */}
        {(() => {
          const plotW = w - pad * 2
          const plotH = h - pad * 2
          const pts = data.ips.map((d, i) => {
            const x = pad + (d.v / 5) * plotW
            const y = pad + plotH - Math.min(1, d.t) * plotH
            return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
          })
          return <path d={pts.join(' ')} fill="none" stroke="#00AA44" strokeWidth="1.5" />
        })()}

        {/* VA curve */}
        {(() => {
          const plotW = w - pad * 2
          const plotH = h - pad * 2
          const pts = data.va.map((d, i) => {
            const x = pad + (d.v / 5) * plotW
            const y = pad + plotH - d.t * plotH
            return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
          })
          return <path d={pts.join(' ')} fill="none" stroke="#4050B0" strokeWidth="1.5" />
        })()}

        {/* Legend */}
        <line x1={w - 90} y1={pad + 8} x2={w - 70} y2={pad + 8} stroke="#CC0000" strokeWidth="1.5" />
        <text x={w - 66} y={pad + 11} fontSize="8" fill="#1A1A1A" fontFamily={FONT}>TN</text>
        <line x1={w - 90} y1={pad + 22} x2={w - 70} y2={pad + 22} stroke="#00AA44" strokeWidth="1.5" />
        <text x={w - 66} y={pad + 25} fontSize="8" fill="#1A1A1A" fontFamily={FONT}>IPS</text>
        <line x1={w - 90} y1={pad + 36} x2={w - 70} y2={pad + 36} stroke="#4050B0" strokeWidth="1.5" />
        <text x={w - 66} y={pad + 39} fontSize="8" fill="#1A1A1A" fontFamily={FONT}>VA</text>

        <text x={w / 2} y={h - 4} textAnchor="middle" fontSize="8" fill="#555555" fontFamily={FONT}>V (V)</text>
        <text x={8} y={h / 2} textAnchor="middle" fontSize="8" fill="#555555" fontFamily={FONT}
          transform={`rotate(-90, 8, ${h / 2})`}>T/T₀</text>
      </svg>

      {/* Mode descriptions */}
      <div style={{ display: 'flex', gap: '12px', marginTop: '16px', flexWrap: 'wrap', justifyContent: 'center' }}>
        {[
          { name: 'TN (扭曲向列)', color: '#CC0000', desc: '90°螺旋结构，经典LCD模式。视角较窄，有灰度反转。响应快，成本低。' },
          { name: 'IPS (面内切换)', color: '#00AA44', desc: '分子在基板面内旋转，宽视角无色偏。响应稍慢，开口率低。高端显示器首选。' },
          { name: 'VA (垂直排列)', color: '#4050B0', desc: '分子初始垂直，加压后倾斜。高对比度，中等视角。多畴VA可改善视角。' },
        ].map(mode => (
          <div key={mode.name} style={{
            padding: '8px 10px', border: '1px solid #D0D0D0', borderRadius: '2px',
            backgroundColor: '#FAFAFA', maxWidth: '180px', fontSize: '9px',
            fontFamily: FONT, lineHeight: '1.5',
          }}>
            <div style={{ fontWeight: 600, color: mode.color, marginBottom: '4px' }}>{mode.name}</div>
            <div style={{ color: '#666666' }}>{mode.desc}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Grayscale & Addressing Panel ───
function GrayscalePanel({
  pixelVoltages, pixelIntensities, onPixelVoltageChange, onSetAllVoltages,
}: {
  pixelVoltages: number[]
  pixelIntensities: number[]
  onPixelVoltageChange: (idx: number, v: number) => void
  onSetAllVoltages: (voltages: number[]) => void
}) {
  return (
    <div style={{ width: '100%', maxWidth: '600px' }}>
      <div style={{ fontSize: '12px', fontWeight: 600, color: '#1A1A1A', fontFamily: FONT, marginBottom: '12px', textAlign: 'center' }}>
        灰度级与无源矩阵寻址
      </div>

      <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', justifyContent: 'center' }}>
        {/* 4×4 Pixel Array */}
        <div>
          <div style={{ fontSize: '10px', color: '#555555', fontFamily: FONT, marginBottom: '8px' }}>4×4像素阵列</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px' }}>
            {pixelIntensities.map((intensity, idx) => (
              <div key={idx} style={{ position: 'relative' }}>
                <div style={{
                  width: '56px', height: '56px',
                  backgroundColor: `rgb(${Math.round((1 - intensity) * 255)},${Math.round((1 - intensity) * 255)},${Math.round((1 - intensity) * 255)})`,
                  border: '1px solid #D0D0D0', borderRadius: '1px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer',
                }} onClick={() => {
                  // Cycle voltage: 0 → 1 → 2 → 3 → 4 → 5 → 0
                  const currentV = pixelVoltages[idx]
                  const nextV = currentV >= 5 ? 0 : Math.round((currentV + 1) * 10) / 10
                  onPixelVoltageChange(idx, nextV)
                }}>
                  <span className="tabular-nums" style={{
                    fontSize: '8px', color: intensity > 0.5 ? '#555555' : '#CCCCCC',
                    fontFamily: FONT,
                  }}>
                    {pixelVoltages[idx].toFixed(1)}V
                  </span>
                </div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: '8px', color: '#888888', fontFamily: FONT, marginTop: '4px', textAlign: 'center' }}>
            点击像素循环电压
          </div>
        </div>

        {/* Voltage slider for selected pixel */}
        <div>
          <div style={{ fontSize: '10px', color: '#555555', fontFamily: FONT, marginBottom: '8px' }}>灰度级电压控制</div>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '2px',
          }}>
            {pixelVoltages.map((v, idx) => (
              <div key={idx} style={{ textAlign: 'center', padding: '2px' }}>
                <input type="range" min="0" max="5" step="0.1" value={v}
                  onChange={e => onPixelVoltageChange(idx, Number(e.target.value))}
                  style={{ width: '50px', accentColor: '#333333', transform: 'rotate(-90deg)', transformOrigin: '25px 25px' }}
                />
                <div className="tabular-nums" style={{ fontSize: '7px', color: '#888888', fontFamily: FONT, marginTop: '20px' }}>
                  {v.toFixed(1)}V
                </div>
              </div>
            ))}
          </div>

          {/* Preset patterns */}
          <div style={{ marginTop: '12px' }}>
            <div style={{ fontSize: '10px', color: '#555555', fontFamily: FONT, marginBottom: '6px' }}>预设图案</div>
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
              {([
                ['checkerboard', '棋盘格'],
                ['gradient', '灰度渐变'],
                ['cross', '十字形'],
                ['clear', '全清'],
              ] as [string, string][]).map(([key, label]) => (
                <button key={key} onClick={() => {
                  const newV = new Array(16).fill(0)
                  if (key === 'checkerboard') {
                    for (let i = 0; i < 16; i++) newV[i] = (i + Math.floor(i / 4)) % 2 === 0 ? 5 : 0
                  } else if (key === 'gradient') {
                    for (let r = 0; r < 4; r++)
                      for (let c = 0; c < 4; c++)
                        newV[r * 4 + c] = (r * 4 + c) * 5 / 15
                  } else if (key === 'cross') {
                    for (let i = 0; i < 16; i++) {
                      const r = Math.floor(i / 4), c = i % 4
                      newV[i] = (r === 1 || r === 2 || c === 1 || c === 2) ? 0 : 5
                    }
                  }
                  onSetAllVoltages(newV)
                }} style={{
                  fontSize: '9px', padding: '3px 8px', borderRadius: '2px',
                  border: '1px solid #D0D0D0', backgroundColor: '#FFFFFF',
                  color: '#1A1A1A', cursor: 'pointer', fontFamily: FONT,
                }}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ fontSize: '9px', color: '#888888', fontFamily: FONT, lineHeight: '1.6', marginTop: '12px' }}>
            每个像素的驱动电压决定透射光强，不同电压产生不同灰度级。
            <br />无源矩阵通过逐行扫描寻址，行选通+列数据电压。
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Utility Functions ───

function wavelengthToColor(nm: number): string {
  if (nm >= 620) return '#CC0000'
  if (nm >= 590) return '#DD8800'
  if (nm >= 560) return '#AABB00'
  if (nm >= 520) return '#00AA44'
  if (nm >= 480) return '#0088AA'
  if (nm >= 450) return '#3355BB'
  return '#4050B0'
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
