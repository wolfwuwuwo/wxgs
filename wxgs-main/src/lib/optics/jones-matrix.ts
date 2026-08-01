// Jones Matrix Calculus Library for Optics Simulation
// Implements Jones matrix formalism for polarization optics
// Extended with crystal, Babinet-Soleil compensator, depolarizer, and Mueller-Stokes utilities

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Element types supported by the Jones matrix engine */
export type ElementType =
  | 'polarizer'
  | 'halfwave'
  | 'quarterwave'
  | 'waveplate'
  | 'rotator'
  | 'faraday'
  | 'crystal'
  | 'babinet_soleil'
  | 'depolarizer';

/** A complex number represented as [real, imaginary] */
export type JonesVector = [number, number];

/** 2×2 Jones matrix where each entry is a complex number */
export type JonesMatrix = [[JonesVector, JonesVector], [JonesVector, JonesVector]];

/** An optical element in a Jones calculus chain */
export interface OpticalElement {
  id: string;
  type: ElementType;
  angle: number;           // degrees
  retardation?: number;    // degrees (for waveplate, babinet_soleil)
  label?: string;
  // Crystal parameters
  thickness?: number;      // mm (for crystal)
  no?: number;             // ordinary refractive index (for crystal)
  ne?: number;             // extraordinary refractive index (for crystal)
  wavelength?: number;     // nm (for crystal)
  // Depolarizer parameters
  depolFactor?: number;    // 0-1 (for depolarizer)
}

/** A single propagation step with full polarisation analysis */
export interface PropagationStep {
  stepIndex: number;       // -1 for input, 0+ for after each element
  element: OpticalElement | null;
  jones: [JonesVector, JonesVector]; // output Jones vector at this step
  stokes: [number, number, number, number];
  analysis: {
    psi: number;           // orientation angle
    chi: number;           // ellipticity angle
    handedness: number;    // +1 right, -1 left
    a: number;             // semi-major axis
    b: number;             // semi-minor axis
  };
  dop: number;            // degree of polarization
}

/** Human-readable info for each element type */
export interface ElementInfo {
  symbol: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Element info mapping
// ---------------------------------------------------------------------------

export const ELEMENT_INFO: Record<ElementType, ElementInfo> = {
  polarizer:      { symbol: 'P',   name: '偏振片' },
  halfwave:       { symbol: 'λ/2', name: '半波片' },
  quarterwave:    { symbol: 'λ/4', name: '1/4波片' },
  waveplate:      { symbol: 'WP',  name: '波片' },
  rotator:        { symbol: 'R',   name: '旋光器' },
  faraday:        { symbol: 'F',   name: '法拉第旋转器' },
  crystal:        { symbol: 'XC',  name: '单轴晶体' },
  babinet_soleil: { symbol: 'BS',  name: 'Babinet-Soleil补偿器' },
  depolarizer:    { symbol: 'D',   name: '退偏器' },
};

// ---------------------------------------------------------------------------
// Standard input states  [[Ex_re, Ex_im], [Ey_re, Ey_im]]
// ---------------------------------------------------------------------------

/** Horizontal linear polarisation */
export const HLP: [JonesVector, JonesVector] = [[1, 0], [0, 0]];

/** Vertical linear polarisation */
export const VLP: [JonesVector, JonesVector] = [[0, 0], [1, 0]];

/** +45° linear polarisation */
export const LP45: [JonesVector, JonesVector] = [
  [1 / Math.sqrt(2), 0],
  [1 / Math.sqrt(2), 0],
];

/** -45° linear polarisation */
export const LPn45: [JonesVector, JonesVector] = [
  [1 / Math.sqrt(2), 0],
  [-1 / Math.sqrt(2), 0],
];

/** Right circular polarisation (Ex = 1/√2, Ey = -i/√2 ⇒ S3 < 0 in our convention) */
export const RCP: [JonesVector, JonesVector] = [
  [1 / Math.sqrt(2), 0],
  [0, -1 / Math.sqrt(2)],
];

/** Left circular polarisation (Ex = 1/√2, Ey = +i/√2 ⇒ S3 > 0 in our convention) */
export const LCP: [JonesVector, JonesVector] = [
  [1 / Math.sqrt(2), 0],
  [0, 1 / Math.sqrt(2)],
];

// ---------------------------------------------------------------------------
// Internal complex-number helpers
// ---------------------------------------------------------------------------

function cAdd(a: JonesVector, b: JonesVector): JonesVector {
  return [a[0] + b[0], a[1] + b[1]];
}

function cSub(a: JonesVector, b: JonesVector): JonesVector {
  return [a[0] - b[0], a[1] - b[1]];
}

function cMul(a: JonesVector, b: JonesVector): JonesVector {
  return [
    a[0] * b[0] - a[1] * b[1],
    a[0] * b[1] + a[1] * b[0],
  ];
}

function cConj(a: JonesVector): JonesVector {
  return [a[0], -a[1]];
}

function cExp(phase: number): JonesVector {
  return [Math.cos(phase), Math.sin(phase)];
}

// ---------------------------------------------------------------------------
// Exported complex number utilities
// ---------------------------------------------------------------------------

/** Magnitude of a complex number */
export function cAbs(c: JonesVector): number {
  return Math.sqrt(c[0] * c[0] + c[1] * c[1]);
}

/** Argument (phase) of a complex number in radians */
export function cArg(c: JonesVector): number {
  return Math.atan2(c[1], c[0]);
}

// ---------------------------------------------------------------------------
// Internal matrix helpers
// ---------------------------------------------------------------------------

type JonesVec2 = [JonesVector, JonesVector];

/** 2×2 Jones matrix–matrix multiplication */
function matMul(A: JonesMatrix, B: JonesMatrix): JonesMatrix {
  return [
    [
      cAdd(cMul(A[0][0], B[0][0]), cMul(A[0][1], B[1][0])),
      cAdd(cMul(A[0][0], B[0][1]), cMul(A[0][1], B[1][1])),
    ],
    [
      cAdd(cMul(A[1][0], B[0][0]), cMul(A[1][1], B[1][0])),
      cAdd(cMul(A[1][0], B[0][1]), cMul(A[1][1], B[1][1])),
    ],
  ];
}

/** Rotation matrix R(θ) in Jones calculus */
function rotationMatrix(thetaRad: number): JonesMatrix {
  const c = Math.cos(thetaRad);
  const s = Math.sin(thetaRad);
  return [
    [[c, 0], [s, 0]],
    [[-s, 0], [c, 0]],
  ];
}

/** Build a diagonal Jones matrix from two complex numbers */
function diagMatrix(a: JonesVector, b: JonesVector): JonesMatrix {
  return [
    [a, [0, 0]],
    [[0, 0], b],
  ];
}

// ---------------------------------------------------------------------------
// Jones matrix–vector multiplication (exported)
// ---------------------------------------------------------------------------

export function jonesMatVec(M: JonesMatrix, v: JonesVec2): JonesVec2 {
  return [
    cAdd(cMul(M[0][0], v[0]), cMul(M[0][1], v[1])),
    cAdd(cMul(M[1][0], v[0]), cMul(M[1][1], v[1])),
  ];
}

// ---------------------------------------------------------------------------
// Element Jones matrices
// ---------------------------------------------------------------------------

/**
 * Linear polariser at angle θ (degrees).
 * M = R(−θ) · [[1,0],[0,0]] · R(θ)
 */
export function linearPolarizer(angleDeg: number): JonesMatrix {
  const theta = (angleDeg * Math.PI) / 180;
  const R = rotationMatrix(theta);
  const Rinv = rotationMatrix(-theta);
  const P = diagMatrix([1, 0], [0, 0]);
  return matMul(Rinv, matMul(P, R));
}

/**
 * Half-wave plate at angle θ (degrees).
 * M = R(−θ) · [[1,0],[0,−1]] · R(θ)   (retardation = π)
 */
export function halfWavePlate(angleDeg: number): JonesMatrix {
  return wavePlate(angleDeg, 180);
}

/**
 * Quarter-wave plate at angle θ (degrees).
 * M = R(−θ) · [[1,0],[0,−i]] · R(θ)    (retardation = π/2)
 */
export function quarterWavePlate(angleDeg: number): JonesMatrix {
  return wavePlate(angleDeg, 90);
}

/**
 * General wave plate at angle θ with retardation δ (both in degrees).
 * M = R(−θ) · [[1,0],[0,exp(−iδ)]] · R(θ)
 */
export function wavePlate(angleDeg: number, retardationDeg: number): JonesMatrix {
  const theta = (angleDeg * Math.PI) / 180;
  const delta = (retardationDeg * Math.PI) / 180;
  const R = rotationMatrix(theta);
  const Rinv = rotationMatrix(-theta);
  // Diagonal matrix: 1 and exp(-iδ)
  const W = diagMatrix([1, 0], cExp(-delta));
  return matMul(Rinv, matMul(W, R));
}

/**
 * Optical rotator (reciprocal).
 * Rotates the plane of polarisation by angle θ (degrees).
 * M = [[cos θ, −sin θ], [sin θ, cos θ]]
 */
export function rotator(angleDeg: number): JonesMatrix {
  const theta = (angleDeg * Math.PI) / 180;
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return [
    [[c, 0], [-s, 0]],
    [[s, 0], [c, 0]],
  ];
}

/**
 * Faraday rotator (non-reciprocal).
 * For forward propagation the matrix is identical to a regular rotator.
 * The non-reciprocal behaviour (angle does NOT reverse for backward propagation)
 * is handled at the component level, not in this library function.
 */
export function faradayRotator(angleDeg: number): JonesMatrix {
  return rotator(angleDeg);
}

// ---------------------------------------------------------------------------
// NEW: Crystal (uniaxial birefringent crystal)
// ---------------------------------------------------------------------------

/**
 * Calculate the retardation (in degrees) produced by a uniaxial crystal.
 * δ = 2π · Δn · d / λ, where Δn = ne − no
 *
 * @param thicknessMm  Thickness in millimetres
 * @param no           Ordinary refractive index
 * @param ne           Extraordinary refractive index
 * @param wavelengthNm Wavelength in nanometres
 * @returns Retardation in degrees
 */
export function crystalRetardation(
  thicknessMm: number,
  no: number,
  ne: number,
  wavelengthNm: number,
): number {
  const deltaN = ne - no;
  const thicknessNm = thicknessMm * 1e6; // mm → nm
  const retardationRad = (2 * Math.PI * deltaN * thicknessNm) / wavelengthNm;
  const retardationDeg = (retardationRad * 180) / Math.PI;
  // Normalise to [0, 360)
  return ((retardationDeg % 360) + 360) % 360;
}

/**
 * Calculate the walk-off angle for a uniaxial crystal at oblique incidence.
 * tan(ρ) ≈ (ne² − no²) · sin(2θ_inc) / (2 · (no² · sin²θ + ne² · cos²θ))
 *
 * @param no                Ordinary refractive index
 * @param ne                Extraordinary refractive index
 * @param incidenceAngleDeg Angle of incidence in degrees
 * @returns Walk-off angle in degrees
 */
export function walkOffAngle(
  no: number,
  ne: number,
  incidenceAngleDeg: number,
): number {
  const thetaInc = (incidenceAngleDeg * Math.PI) / 180;
  const numerator = (ne * ne - no * no) * Math.sin(2 * thetaInc);
  const denominator =
    2 * (no * no * Math.sin(thetaInc) * Math.sin(thetaInc) +
         ne * ne * Math.cos(thetaInc) * Math.cos(thetaInc));
  if (Math.abs(denominator) < 1e-15) return 0;
  const rho = Math.atan(numerator / denominator);
  return (rho * 180) / Math.PI;
}

/**
 * Uniaxial birefringent crystal Jones matrix.
 * Computes retardation from crystal parameters, then applies a wave plate matrix.
 *
 * @param angleDeg     Fast axis orientation in degrees
 * @param thicknessMm  Crystal thickness in millimetres
 * @param no           Ordinary refractive index
 * @param ne           Extraordinary refractive index
 * @param wavelengthNm Wavelength in nanometres
 */
export function uniaxialCrystal(
  angleDeg: number,
  thicknessMm: number,
  no: number,
  ne: number,
  wavelengthNm: number,
): JonesMatrix {
  const retDeg = crystalRetardation(thicknessMm, no, ne, wavelengthNm);
  return wavePlate(angleDeg, retDeg);
}

// ---------------------------------------------------------------------------
// NEW: Babinet-Soleil compensator
// ---------------------------------------------------------------------------

/**
 * Babinet-Soleil compensator Jones matrix.
 * Provides continuously variable retardation (0–360°) at a given fast-axis angle.
 * Internally identical to a wave plate, but emphasises variable-delay measurement.
 *
 * @param angleDeg        Fast axis orientation in degrees
 * @param retardationDeg  Retardation in degrees (0–360°, continuously variable)
 */
export function babinetSoleilCompensator(
  angleDeg: number,
  retardationDeg: number,
): JonesMatrix {
  // Clamp retardation to [0, 360)
  const clampedRet = ((retardationDeg % 360) + 360) % 360;
  return wavePlate(angleDeg, clampedRet);
}

// ---------------------------------------------------------------------------
// NEW: Depolarizer (Mueller matrix approach)
// ---------------------------------------------------------------------------

/**
 * Mueller matrix for a depolarising element.
 * M = (1−d)·I₄ + d·diag(1,0,0,0)
 *   = diag(1, 1−d, 1−d, 1−d)
 *
 * @param depolFactor Depolarisation factor: 0 = fully polarised, 1 = fully depolarised
 * @returns 4×4 Mueller matrix (real-valued)
 */
export function depolarizerMueller(depolFactor: number): number[][] {
  const d = Math.max(0, Math.min(1, depolFactor));
  return [
    [1, 0, 0, 0],
    [0, 1 - d, 0, 0],
    [0, 0, 1 - d, 0],
    [0, 0, 0, 1 - d],
  ];
}

/** Apply a 4×4 Mueller matrix to a Stokes vector */
export function applyMuellerToStokes(
  M: number[][],
  s: [number, number, number, number],
): [number, number, number, number] {
  const result: number[] = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      result[i] += M[i][j] * s[j];
    }
  }
  return [result[0], result[1], result[2], result[3]];
}

// ---------------------------------------------------------------------------
// NEW: Mueller-from-Jones conversion
// ---------------------------------------------------------------------------

/**
 * Convert a 2×2 Jones matrix to a 4×4 Mueller matrix.
 *
 * Uses the Pauli matrix trace formula:
 *   M[i][j] = ½ · Re(Tr(σᵢ · J · σⱼ · J†))
 *
 * where the Pauli basis is chosen to be consistent with our Stokes convention:
 *   S₀ = |Ex|²+|Ey|², S₁ = |Ex|²−|Ey|², S₂ = 2·Re(Ex*·Ey), S₃ = 2·Im(Ex*·Ey)
 *
 * σ₀ = [[1,0],[0,1]],  σ₁ = [[1,0],[0,−1]],  σ₂ = [[0,1],[1,0]],  σ₃ = [[0,i],[−i,0]]
 */
export function muellerFromJones(M: JonesMatrix): number[][] {
  // Pauli matrices as 2×2 complex matrices (each entry is [re, im])
  const sigma: JonesMatrix[] = [
    // σ₀ = I
    [[[1, 0], [0, 0]], [[0, 0], [1, 0]]],
    // σ₁
    [[[1, 0], [0, 0]], [[0, 0], [-1, 0]]],
    // σ₂
    [[[0, 0], [1, 0]], [[1, 0], [0, 0]]],
    // σ₃ = [[0, i], [-i, 0]]   (gives S₃ = Tr(σ₃·ρ) = 2·Im(Ex*·Ey))
    [[[0, 0], [0, 1]], [[0, -1], [0, 0]]],
  ];

  // Compute J† (conjugate transpose)
  const jDag: JonesMatrix = [
    [cConj(M[0][0]), cConj(M[1][0])],
    [cConj(M[0][1]), cConj(M[1][1])],
  ];

  const result: number[][] = Array.from({ length: 4 }, () => Array(4).fill(0));

  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      // Compute σᵢ · J · σⱼ · J†
      const step1 = matMul(sigma[i], M);        // σᵢ · J
      const step2 = matMul(step1, sigma[j]);     // σᵢ · J · σⱼ
      const step3 = matMul(step2, jDag);         // σᵢ · J · σⱼ · J†
      // Trace = sum of diagonal elements (real part)
      const trace = cAdd(step3[0][0], step3[1][1]);
      result[i][j] = trace[0] / 2; // Take real part / 2
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// NEW: Stokes ↔ Poincaré sphere
// ---------------------------------------------------------------------------

/**
 * Convert Stokes parameters to Poincaré sphere coordinates.
 * For a fully polarised beam (DOP = 1), the point lies on the unit sphere.
 * For partially polarised light, the point is inside the sphere at radius = DOP.
 *
 * x = S₁/S₀,  y = S₂/S₀,  z = S₃/S₀
 */
export function stokesToPoincare(
  s: [number, number, number, number],
): { x: number; y: number; z: number } {
  const S0 = s[0] === 0 ? 1 : s[0]; // avoid division by zero
  return {
    x: s[1] / S0,
    y: s[2] / S0,
    z: s[3] / S0,
  };
}

// ---------------------------------------------------------------------------
// Get Jones matrix for an arbitrary element
// ---------------------------------------------------------------------------

export function getElementMatrix(element: OpticalElement): JonesMatrix {
  switch (element.type) {
    case 'polarizer':
      return linearPolarizer(element.angle);
    case 'halfwave':
      return halfWavePlate(element.angle);
    case 'quarterwave':
      return quarterWavePlate(element.angle);
    case 'waveplate':
      return wavePlate(element.angle, element.retardation ?? 0);
    case 'rotator':
      return rotator(element.angle);
    case 'faraday':
      return faradayRotator(element.angle);
    case 'crystal':
      return uniaxialCrystal(
        element.angle,
        element.thickness ?? 1,
        element.no ?? 1.544,
        element.ne ?? 1.553,
        element.wavelength ?? 632.8,
      );
    case 'babinet_soleil':
      return babinetSoleilCompensator(element.angle, element.retardation ?? 0);
    case 'depolarizer':
      // Jones calculus cannot represent depolarisation; return identity.
      // Use depolarizerMueller() and applyMuellerToStokes() for proper handling.
      return diagMatrix([1, 0], [1, 0]);
    default: {
      // Exhaustiveness check — should never reach here
      const _exhaustive: never = element.type;
      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Stokes parameters & polarisation analysis
// ---------------------------------------------------------------------------

/**
 * Convert a Jones vector to Stokes parameters.
 * S0 = |Ex|² + |Ey|²
 * S1 = |Ex|² − |Ey|²
 * S2 = 2·Re(Ex*·Ey)
 * S3 = 2·Im(Ex*·Ey)
 */
export function stokesFromJones(jones: JonesVec2): [number, number, number, number] {
  const [Ex, Ey] = jones;
  const S0 = cAbs(Ex) ** 2 + cAbs(Ey) ** 2;
  const S1 = cAbs(Ex) ** 2 - cAbs(Ey) ** 2;
  const ExConjEy = cMul(cConj(Ex), Ey);
  const S2 = 2 * ExConjEy[0];
  const S3 = 2 * ExConjEy[1];
  return [S0, S1, S2, S3];
}

/** Degree of polarisation from Stokes parameters */
export function degreeOfPolarization(stokes: [number, number, number, number]): number {
  const [S0, S1, S2, S3] = stokes;
  if (S0 === 0) return 0;
  return Math.sqrt(S1 * S1 + S2 * S2 + S3 * S3) / S0;
}

/**
 * Analyse the polarisation state of a Jones vector.
 * Returns orientation angle ψ, ellipticity angle χ, handedness, and ellipse axes.
 */
export function analyzePolarization(jones: JonesVec2): {
  psi: number;
  chi: number;
  handedness: number;
  a: number;
  b: number;
} {
  const [S0, S1, S2, S3] = stokesFromJones(jones);

  // Orientation angle
  const psi = Math.atan2(S2, S1) / 2;

  // Ellipticity angle
  const S0safe = S0 === 0 ? 1 : S0;
  const chi = Math.asin(Math.max(-1, Math.min(1, S3 / S0safe))) / 2;

  // Handedness: +1 right (S3 > 0), −1 left (S3 < 0)
  const handedness = S3 >= 0 ? 1 : -1;

  // Semi-major and semi-minor axes
  const sumSq = Math.sqrt(S1 * S1 + S2 * S2);
  const a = S0 === 0 ? 0 : Math.sqrt((S0 + sumSq) / 2);
  const b = S0 === 0 ? 0 : Math.sqrt(Math.max(0, (S0 - sumSq) / 2));

  return { psi, chi, handedness, a, b };
}

/**
 * Generate polarisation ellipse points for SVG rendering.
 * Parametric: x(t) = a·cos(t)·cos(ψ) − b·sin(t)·sin(ψ)
 *             y(t) = a·cos(t)·sin(ψ) + b·sin(t)·cos(ψ)
 */
export function polarizationEllipsePoints(
  analysis: ReturnType<typeof analyzePolarization>,
  numPoints: number,
): { x: number; y: number }[] {
  const { psi, a, b } = analysis;
  const cosPsi = Math.cos(psi);
  const sinPsi = Math.sin(psi);
  const points: { x: number; y: number }[] = [];

  for (let i = 0; i < numPoints; i++) {
    const t = (2 * Math.PI * i) / numPoints;
    const cosT = Math.cos(t);
    const sinT = Math.sin(t);
    points.push({
      x: a * cosT * cosPsi - b * sinT * sinPsi,
      y: a * cosT * sinPsi + b * sinT * cosPsi,
    });
  }

  return points;
}

// ---------------------------------------------------------------------------
// Propagation
// ---------------------------------------------------------------------------

/**
 * Propagate a Jones vector through an entire chain of optical elements.
 * Returns the final Jones vector after all elements.
 *
 * Note: Depolarizer elements are handled via Mueller-Stokes calculus internally,
 * but the output is converted back to an equivalent Jones vector for API consistency.
 * The DOP field in step-by-step propagation will reflect partial depolarisation.
 */
export function propagateThroughChain(
  input: JonesVec2,
  elements: OpticalElement[],
): JonesVec2 {
  let current: JonesVec2 = input;
  for (const element of elements) {
    const M = getElementMatrix(element);
    current = jonesMatVec(M, current);
  }
  return current;
}

/**
 * Propagate a Jones vector through a chain, returning intermediate states
 * at each step (including the input state).
 *
 * For depolarizer elements, the Jones vector is not meaningful (Jones calculus
 * cannot represent partial polarisation). Instead, the Stokes parameters are
 * computed via the Mueller matrix, and the Jones vector is set to an
 * equivalent fully-polarised state with reduced intensity. The `dop` field
 * correctly reflects the degree of polarisation.
 */
export function propagateThroughChainStepByStep(
  input: JonesVec2,
  elements: OpticalElement[],
): PropagationStep[] {
  const steps: PropagationStep[] = [];

  // Initial input state (stepIndex = -1)
  const inputStokes = stokesFromJones(input);
  const inputAnalysis = analyzePolarization(input);
  steps.push({
    stepIndex: -1,
    element: null,
    jones: input,
    stokes: inputStokes,
    analysis: inputAnalysis,
    dop: degreeOfPolarization(inputStokes),
  });

  // Track current state in both Jones and Stokes representations
  let currentJones: JonesVec2 = input;
  let currentStokes: [number, number, number, number] = inputStokes;

  // Propagate through each element
  for (let i = 0; i < elements.length; i++) {
    const element = elements[i];

    if (element.type === 'depolarizer') {
      // Depolarizer: use Mueller-Stokes calculus
      const dFactor = element.depolFactor ?? 0;
      const mDepol = depolarizerMueller(dFactor);
      currentStokes = applyMuellerToStokes(mDepol, currentStokes);

      // Compute equivalent Jones vector from the (partially depolarised) Stokes
      // The Jones vector represents the polarised component only
      const dop = degreeOfPolarization(currentStokes);
      const [S0, S1, S2, S3] = currentStokes;

      // Reconstruct an equivalent Jones vector from the polarised part
      const S0safe = S0 === 0 ? 1 : S0;
      const psi = Math.atan2(S2, S1) / 2;
      const chi = 0.5 * Math.asin(Math.max(-1, Math.min(1, S3 / S0safe)));
      const cosPsi = Math.cos(psi);
      const sinPsi = Math.sin(psi);
      const cosChi = Math.cos(chi);
      const sinChi = Math.sin(chi);

      // |E|² = S0 (total intensity, including unpolarised part)
      // Reconstruct Jones vector from Stokes parameters:
      //   Ex = amp · cos(ψ) · cos(χ)        (real part only)
      //   Ey = amp · sin(ψ) · cos(χ) + i · amp · sin(χ)
      // This gives the correct S2 and S3 via our convention: S3 = 2·Im(Ex*·Ey)
      const amp = Math.sqrt(S0);
      const exRe = amp * cosPsi * cosChi;
      const exIm = 0;
      const eyRe = amp * sinPsi * cosChi;
      const eyIm = amp * sinChi;

      currentJones = [[exRe, exIm], [eyRe, eyIm]];

      const analysis = analyzePolarization(currentJones);
      steps.push({
        stepIndex: i,
        element,
        jones: currentJones,
        stokes: currentStokes,
        analysis,
        dop,
      });
    } else {
      // Standard Jones calculus element
      const M = getElementMatrix(element);
      currentJones = jonesMatVec(M, currentJones);
      currentStokes = stokesFromJones(currentJones);

      const analysis = analyzePolarization(currentJones);
      steps.push({
        stepIndex: i,
        element,
        jones: currentJones,
        stokes: currentStokes,
        analysis,
        dop: degreeOfPolarization(currentStokes),
      });
    }
  }

  return steps;
}
