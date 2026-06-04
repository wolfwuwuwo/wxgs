// Jones Matrix Calculus Library for Optics Simulation
// Implements Jones matrix formalism for polarization optics

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Element types supported by the Jones matrix engine */
export type ElementType = 'polarizer' | 'halfwave' | 'quarterwave' | 'waveplate' | 'rotator' | 'faraday';

/** A complex number represented as [real, imaginary] */
export type JonesVector = [number, number];

/** 2×2 Jones matrix where each entry is a complex number */
export type JonesMatrix = [[JonesVector, JonesVector], [JonesVector, JonesVector]];

/** An optical element in a Jones calculus chain */
export interface OpticalElement {
  id: string;
  type: ElementType;
  angle: number;           // degrees
  retardation?: number;    // degrees (for waveplate)
  label?: string;
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
  polarizer:  { symbol: 'P',   name: '偏振片' },
  halfwave:   { symbol: 'λ/2', name: '半波片' },
  quarterwave:{ symbol: 'λ/4', name: '1/4波片' },
  waveplate:  { symbol: 'WP',  name: '波片' },
  rotator:    { symbol: 'R',   name: '旋光器' },
  faraday:    { symbol: 'F',   name: '法拉第旋转器' },
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

/** Right circular polarisation (Ex = 1/√2, Ey = -i/√2 ⇒ S3 > 0) */
export const RCP: [JonesVector, JonesVector] = [
  [1 / Math.sqrt(2), 0],
  [0, -1 / Math.sqrt(2)],
];

/** Left circular polarisation (Ex = 1/√2, Ey = +i/√2 ⇒ S3 < 0) */
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

  // Propagate through each element
  let current: JonesVec2 = input;
  for (let i = 0; i < elements.length; i++) {
    const M = getElementMatrix(elements[i]);
    current = jonesMatVec(M, current);

    const stokes = stokesFromJones(current);
    const analysis = analyzePolarization(current);
    steps.push({
      stepIndex: i,
      element: elements[i],
      jones: current,
      stokes,
      analysis,
      dop: degreeOfPolarization(stokes),
    });
  }

  return steps;
}
