/**
 * Gaussian Beam Optics Library
 *
 * Provides calculations for Gaussian beam propagation, including
 * free-space propagation and thin-lens focusing using the complex
 * beam parameter (q-parameter) formalism.
 *
 * Extended with Gouy phase, radius of curvature, intensity profiles,
 * power containment, ABCD matrix formalism, M² beam quality,
 * and Hermite-Gaussian mode calculations.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GaussianBeamParams {
  /** Beam waist radius in meters */
  w0: number;
  /** Wavelength in meters */
  wavelength: number;
  /** Total propagation distance in meters */
  propagationDistance: number;
  /** Lens focal length in meters (0 = no lens) */
  lensFocalLength: number;
  /** Lens position in meters from waist */
  lensPosition: number;
  /** M² beam quality factor (default 1 = ideal Gaussian) */
  M2?: number;
  /** Observation point z position in meters */
  observationZ?: number;
}

export interface GaussianBeamResult {
  /** Rayleigh range z_R in meters */
  rayleighRange: number;
  /** Far-field half-angle divergence in radians */
  divergence: number;
  /** Focused beam waist radius in meters (0 if no lens) */
  focusedW0: number;
  /** Focused waist position in meters from origin (0 if no lens) */
  focusedPosition: number;
  /** Beam-width envelope sampled at regular z intervals */
  envelopePoints: { z: number; w: number }[];
  /** Compute beam radius at arbitrary z */
  widthAt(z: number): number;
  /** M² factor used */
  M2: number;
  /** Gouy phase at observation point in radians */
  gouyPhaseAtObs: number;
  /** Radius of curvature at observation point in meters (Infinity at waist) */
  radiusOfCurvatureAtObs: number;
}

// ---------------------------------------------------------------------------
// New Physics Functions
// ---------------------------------------------------------------------------

/**
 * Gouy phase at position z.
 * ψ(z) = arctan(z / z_R)
 */
export function gouyPhase(z: number, zR: number): number {
  if (zR === 0) return z > 0 ? Math.PI / 2 : z < 0 ? -Math.PI / 2 : 0;
  return Math.atan(z / zR);
}

/**
 * Radius of curvature at position z.
 * R(z) = z * (1 + (z_R/z)²), returns Infinity at z=0
 */
export function radiusOfCurvature(z: number, zR: number): number {
  if (z === 0) return Infinity;
  return z * (1 + (zR / z) * (zR / z));
}

/**
 * Intensity at radial position r and axial position z.
 * I(r,z) = I₀ * (w₀/w(z))² * exp(-2r²/w(z)²)
 */
export function gaussianIntensity(
  r: number,
  z: number,
  w0: number,
  zR: number,
  I0: number = 1,
): number {
  const w = w0 * Math.sqrt(1 + (z / zR) * (z / zR));
  return I0 * (w0 / w) * (w0 / w) * Math.exp((-2 * r * r) / (w * w));
}

/**
 * Power contained within aperture of radius a at position z.
 * P(a)/P_total = 1 - exp(-2a²/w(z)²)
 */
export function powerContainment(
  a: number,
  z: number,
  w0: number,
  zR: number,
): number {
  const w = w0 * Math.sqrt(1 + (z / zR) * (z / zR));
  return 1 - Math.exp((-2 * a * a) / (w * w));
}

/**
 * Complex beam parameter q = z + i*z_R
 */
export function complexBeamParam(
  z: number,
  zR: number,
): { re: number; im: number } {
  return { re: z, im: zR };
}

/**
 * ABCD matrix transformation of q parameter.
 * q' = (A*q + B) / (C*q + D)
 */
export function abcdTransformQ(
  q: { re: number; im: number },
  M: number[][],
): { re: number; im: number } {
  const A = M[0][0];
  const B = M[0][1];
  const C = M[1][0];
  const D = M[1][1];

  // Numerator: A*q + B
  const numRe = A * q.re + B;
  const numIm = A * q.im;

  // Denominator: C*q + D
  const denRe = C * q.re + D;
  const denIm = C * q.im;

  // Complex division: num / den
  const denMag2 = denRe * denRe + denIm * denIm;
  if (denMag2 === 0) return { re: 0, im: 0 };

  return {
    re: (numRe * denRe + numIm * denIm) / denMag2,
    im: (numIm * denRe - numRe * denIm) / denMag2,
  };
}

/**
 * Standard ABCD matrix for free-space propagation of distance d.
 */
export function freeSpaceABCD(d: number): number[][] {
  return [
    [1, d],
    [0, 1],
  ];
}

/**
 * Standard ABCD matrix for a thin lens with focal length f.
 */
export function thinLensABCD(f: number): number[][] {
  return [
    [1, 0],
    [-1 / f, 1],
  ];
}

/**
 * Standard ABCD matrix for a flat mirror (identity).
 */
export function flatMirrorABCD(): number[][] {
  return [
    [1, 0],
    [0, 1],
  ];
}

/**
 * Multimode beam width (M² factor).
 * w(z) = w₀ * sqrt(1 + ((z * M²) / z_R)²) [simplified model]
 */
export function multimodeBeamWidth(
  z: number,
  w0: number,
  zR: number,
  M2: number,
): number {
  const effectiveZ = (z * M2) / zR;
  return w0 * Math.sqrt(1 + effectiveZ * effectiveZ);
}

/**
 * Corrected M² beam width formula (ISO 11146).
 * w(z) = w₀ * sqrt(1 + M⁴ * (λz/(πw₀²))²)
 * This is the physically correct formula where M⁴ appears (not M²).
 */
export function correctedM2BeamWidth(
  z: number,
  w0: number,
  wavelength: number,
  M2: number,
): number {
  const zR = (Math.PI * w0 * w0) / wavelength;
  return w0 * Math.sqrt(1 + (M2 * M2 * M2 * M2) * (z / zR) * (z / zR));
}

/**
 * Multi-lens ABCD chain propagation.
 * Propagates a Gaussian beam through a series of thin lenses.
 * Returns the beam width function w(z) and segment info.
 */
export interface LensConfig {
  position: number; // z position in meters
  focalLength: number; // focal length in meters (positive = converging)
}

export interface BeamSegment {
  zStart: number;
  zEnd: number;
  waistPos: number; // absolute waist position
  w0: number; // waist radius
  zR: number; // Rayleigh range
}

export function multiLensABCDChain(
  inputW0: number,
  wavelength: number,
  lenses: LensConfig[],
  propagationDistance: number,
): {
  widthAt: (z: number) => number;
  segments: BeamSegment[];
  focalPoints: { z: number }[];
} {
  const inputZR = (Math.PI * inputW0 * inputW0) / wavelength;
  const sortedLenses = [...lenses].sort((a, b) => a.position - b.position);

  const segments: BeamSegment[] = [];
  const focalPoints: { z: number }[] = [];

  // Build segments by propagating q through each lens
  let currentQ = { re: 0, im: inputZR }; // q at z=0 (waist)
  let segStart = 0;

  for (const lens of sortedLenses) {
    if (lens.position <= segStart || lens.focalLength === 0) continue;

    // Propagate q from segStart to lens position
    const d = lens.position - segStart;
    const qAtLens = abcdTransformQ(currentQ, freeSpaceABCD(d));

    // Extract beam params at lens
    const lensZR = Math.max(qAtLens.im, 1e-15); // ensure positive zR
    const lensW0 = Math.sqrt(Math.max(0, (lensZR * wavelength) / Math.PI));
    const lensWaistPos = lens.position - qAtLens.re; // absolute

    segments.push({
      zStart: segStart,
      zEnd: lens.position,
      waistPos: lensWaistPos,
      w0: lensW0,
      zR: lensZR,
    });

    // Apply thin lens transformation
    const qAfterLens = abcdTransformQ(qAtLens, thinLensABCD(lens.focalLength));

    // Find focal point (where beam is narrowest after lens)
    const newWaistPos = lens.position - qAfterLens.re;
    if (newWaistPos > lens.position && newWaistPos <= propagationDistance) {
      focalPoints.push({ z: newWaistPos });
    }

    currentQ = { re: qAfterLens.re, im: qAfterLens.im };
    segStart = lens.position;
  }

  // Final segment from last lens to end
  const finalZR = Math.max(currentQ.im, 1e-15); // ensure positive zR
  const finalW0 = Math.sqrt(Math.max(0, (finalZR * wavelength) / Math.PI));
  // q = (z - z_waist) + i*zR, so waist is at lensPos - Re(q)
  const lastLensPos = segStart;
  const waistPosAfterLastLens = lastLensPos - currentQ.re;

  segments.push({
    zStart: segStart,
    zEnd: propagationDistance,
    waistPos: waistPosAfterLastLens,
    w0: finalW0,
    zR: finalZR,
  });

  // Build widthAt function
  function widthAt(z: number): number {
    for (const seg of segments) {
      if (z >= seg.zStart && z <= seg.zEnd) {
        const dz = z - seg.waistPos;
        return seg.w0 * Math.sqrt(1 + (dz / seg.zR) * (dz / seg.zR));
      }
    }
    // Fallback: use last segment
    const lastSeg = segments[segments.length - 1];
    const dz = z - lastSeg.waistPos;
    return lastSeg.w0 * Math.sqrt(1 + (dz / lastSeg.zR) * (dz / lastSeg.zR));
  }

  return { widthAt, segments, focalPoints };
}

/**
 * Mode coupling efficiency between two Gaussian beams.
 * η = (2*w1*w2 / (w1² + w2²))² * exp(-2*Δx² / (w1² + w2²))
 * where Δx is the lateral offset between beams.
 */
export function modeCouplingEfficiency(
  w1: number,
  w2: number,
  offset: number = 0,
): number {
  const w1sq = w1 * w1;
  const w2sq = w2 * w2;
  const sum = w1sq + w2sq;
  if (sum === 0) return 0;
  const sizeFactor = (2 * w1 * w2) / sum;
  const offsetFactor = Math.exp((-2 * offset * offset) / sum);
  return sizeFactor * sizeFactor * offsetFactor;
}

/**
 * Hermite polynomial H_n(x) using recurrence relation.
 * H_0 = 1, H_1 = 2x, H_n = 2x*H_{n-1} - 2(n-1)*H_{n-2}
 */
function hermitePoly(n: number, x: number): number {
  if (n === 0) return 1;
  if (n === 1) return 2 * x;
  let hPrev2 = 1; // H_0
  let hPrev1 = 2 * x; // H_1
  for (let k = 2; k <= n; k++) {
    const hK = 2 * x * hPrev1 - 2 * (k - 1) * hPrev2;
    hPrev2 = hPrev1;
    hPrev1 = hK;
  }
  return hPrev1;
}

/**
 * Factorial function for small integers.
 */
function factorial(n: number): number {
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
}

/**
 * Hermite-Gaussian mode intensity HG_nm at position (x, y, z).
 * I_nm = (w₀/w(z))² * H_n(√2 x/w(z))² * H_m(√2 y/w(z))²
 *        / (2^n * n! * 2^m * m!) * exp(-2(x²+y²)/w(z)²)
 */
export function hermiteGaussianIntensity(
  x: number,
  y: number,
  z: number,
  w0: number,
  zR: number,
  n: number,
  m: number,
): number {
  const w = w0 * Math.sqrt(1 + (z / zR) * (z / zR));
  const sq2OverW = Math.SQRT2 / w;
  const argX = sq2OverW * x;
  const argY = sq2OverW * y;

  const Hn = hermitePoly(n, argX);
  const Hm = hermitePoly(m, argY);

  const normFactor =
    (w0 / w) * (w0 / w) /
    (Math.pow(2, n) * factorial(n) * Math.pow(2, m) * factorial(m));

  const gaussianEnvelope = Math.exp((-2 * (x * x + y * y)) / (w * w));

  return normFactor * Hn * Hn * Hm * Hm * gaussianEnvelope;
}

// ---------------------------------------------------------------------------
// Core calculation
// ---------------------------------------------------------------------------

/**
 * Calculate Gaussian beam parameters and envelope.
 *
 * Uses the complex beam parameter q = z + i·z_R for propagation and
 * applies the thin-lens ABCD transformation 1/q' = 1/q − 1/f at the
 * lens position.  The beam width is computed via
 *   w(z) = w₀ √(1 + (z/z_R)²)
 * in each segment (before and after the lens).
 */
export function calculateGaussianBeam(
  params: GaussianBeamParams,
): GaussianBeamResult {
  const {
    w0,
    wavelength,
    propagationDistance,
    lensFocalLength,
    lensPosition,
    M2: M2Param = 1,
    observationZ = 0,
  } = params;

  // --- Original (unfocused) beam properties ---
  const zR = (Math.PI * w0 * w0) / wavelength; // Rayleigh range
  const divergence = (wavelength * M2Param) / (Math.PI * w0); // half-angle divergence with M²
  const M2 = M2Param;

  // Variables for the focused (post-lens) beam segment
  let focusedW0 = 0;
  let focusedPosition = 0;
  let newZR = zR;
  let newW0 = w0;
  let newWaistPos = 0;

  if (lensFocalLength !== 0) {
    // Complex beam parameter at the lens position
    // q_lens = lensPosition + i·zR
    const qLensRe = lensPosition;
    const qLensIm = zR;

    // 1/q = q̄ / |q|²
    const denom = qLensRe * qLensRe + qLensIm * qLensIm;
    const invQRe = qLensRe / denom;
    const invQIm = -qLensIm / denom;

    // Thin-lens transformation: 1/q' = 1/q − 1/f
    const invQPrimeRe = invQRe - 1 / lensFocalLength;
    const invQPrimeIm = invQIm;

    // Recover q' by inverting again
    const invDenom =
      invQPrimeRe * invQPrimeRe + invQPrimeIm * invQPrimeIm;
    const qPrimeRe = invQPrimeRe / invDenom;
    const qPrimeIm = -invQPrimeIm / invDenom;

    // The new waist is located where Re(q) = 0, i.e. at distance
    // d = −Re(q') from the lens.
    newWaistPos = lensPosition - qPrimeRe; // absolute position
    newZR = qPrimeIm; // new Rayleigh range
    newW0 = Math.sqrt((newZR * wavelength) / Math.PI); // new waist

    focusedW0 = newW0;
    focusedPosition = newWaistPos;
  }

  // --- widthAt helper (multi-segment aware) ---
  function beamWidthAt(z: number): number {
    if (M2 > 1) {
      // M² modified beam width (simplified model)
      if (lensFocalLength !== 0 && z >= lensPosition) {
        const dz = z - newWaistPos;
        return newW0 * Math.sqrt(1 + ((dz * M2) / newZR) * ((dz * M2) / newZR));
      }
      return w0 * Math.sqrt(1 + ((z * M2) / zR) * ((z * M2) / zR));
    }
    if (lensFocalLength !== 0 && z >= lensPosition) {
      // Post-lens segment: use focused beam parameters
      const dz = z - newWaistPos;
      return newW0 * Math.sqrt(1 + (dz / newZR) * (dz / newZR));
    }
    // Pre-lens segment or no lens: original beam
    return w0 * Math.sqrt(1 + (z / zR) * (z / zR));
  }

  // --- Envelope generation (250 points for smooth visualisation) ---
  const NUM_POINTS = 250;
  const envelopePoints: { z: number; w: number }[] = [];

  for (let i = 0; i <= NUM_POINTS; i++) {
    const z = (i / NUM_POINTS) * propagationDistance;
    envelopePoints.push({ z, w: beamWidthAt(z) });
  }

  // --- Observation point calculations ---
  const obsZ = observationZ;
  let obsZR = zR;
  let obsW0 = w0;
  let obsWaistPos = 0;

  // Determine which segment the observation point is in
  if (lensFocalLength !== 0 && obsZ >= lensPosition) {
    obsZR = newZR;
    obsW0 = newW0;
    obsWaistPos = newWaistPos;
  }

  const obsDz = obsZ - obsWaistPos;
  const gouyPhaseAtObs = gouyPhase(obsDz, obsZR);
  const radiusOfCurvatureAtObs = radiusOfCurvature(obsDz, obsZR);

  return {
    rayleighRange: zR,
    divergence,
    focusedW0,
    focusedPosition,
    envelopePoints,
    widthAt: beamWidthAt,
    M2,
    gouyPhaseAtObs,
    radiusOfCurvatureAtObs,
  };
}

// ---------------------------------------------------------------------------
// Wavelength → colour mapping
// ---------------------------------------------------------------------------

interface SpectrumAnchor {
  wavelength: number;
  r: number;
  g: number;
  b: number;
}

/** Anchor points across the visible spectrum (380–780 nm) */
const SPECTRUM_ANCHORS: SpectrumAnchor[] = [
  { wavelength: 380, r: 75, g: 0, b: 130 }, // deep violet
  { wavelength: 405, r: 64, g: 80, b: 176 }, // blue-violet (specified)
  { wavelength: 440, r: 40, g: 40, b: 210 }, // blue
  { wavelength: 470, r: 0, g: 100, b: 220 }, // blue
  { wavelength: 495, r: 0, g: 170, b: 200 }, // cyan
  { wavelength: 520, r: 0, g: 195, b: 80 }, // green-cyan
  { wavelength: 532, r: 0, g: 170, b: 68 }, // Nd:YAG green (specified)
  { wavelength: 565, r: 180, g: 200, b: 0 }, // yellow-green
  { wavelength: 580, r: 220, g: 180, b: 0 }, // yellow
  { wavelength: 600, r: 235, g: 120, b: 0 }, // orange
  { wavelength: 632.8, r: 204, g: 0, b: 0 }, // He-Ne red (specified)
  { wavelength: 680, r: 160, g: 0, b: 0 }, // red
  { wavelength: 730, r: 120, g: 0, b: 0 }, // deep red
  { wavelength: 780, r: 85, g: 0, b: 0 }, // dark red
];

/**
 * Return a hex colour string appropriate for the given wavelength.
 *
 * Uses piecewise-linear interpolation between spectral anchor points.
 * For wavelengths outside the visible range the nearest anchor colour
 * is returned (with attenuation for extreme values).
 */
export function getWavelengthColor(wavelengthNm: number): string {
  const anchors = SPECTRUM_ANCHORS;

  // Clamp to anchor range
  if (wavelengthNm <= anchors[0].wavelength) {
    const { r, g, b } = anchors[0];
    // Dim for UV
    const factor = Math.max(0.3, wavelengthNm / anchors[0].wavelength);
    return toHex(
      Math.round(r * factor),
      Math.round(g * factor),
      Math.round(b * factor),
    );
  }

  if (wavelengthNm >= anchors[anchors.length - 1].wavelength) {
    const { r, g, b } = anchors[anchors.length - 1];
    // Dim for IR
    const lastWl = anchors[anchors.length - 1].wavelength;
    const factor = Math.max(0.2, lastWl / wavelengthNm);
    return toHex(
      Math.round(r * factor),
      Math.round(g * factor),
      Math.round(b * factor),
    );
  }

  // Find bounding anchors and interpolate
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i];
    const b = anchors[i + 1];
    if (wavelengthNm >= a.wavelength && wavelengthNm <= b.wavelength) {
      const t =
        (wavelengthNm - a.wavelength) / (b.wavelength - a.wavelength);
      const r = Math.round(a.r + t * (b.r - a.r));
      const g = Math.round(a.g + t * (b.g - a.g));
      const bb = Math.round(a.b + t * (b.b - a.b));
      return toHex(r, g, bb);
    }
  }

  // Fallback (should not reach)
  return "#FFFFFF";
}

/** Convert 0–255 RGB values to a hex colour string. */
function toHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, v));
  const hex = (v: number) => clamp(v).toString(16).padStart(2, "0").toUpperCase();
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

// ---------------------------------------------------------------------------
// SI-prefix formatting
// ---------------------------------------------------------------------------

interface SIPrefix {
  threshold: number;
  prefix: string;
}

const SI_PREFIXES: SIPrefix[] = [
  { threshold: 1e12, prefix: "T" },
  { threshold: 1e9, prefix: "G" },
  { threshold: 1e6, prefix: "M" },
  { threshold: 1e3, prefix: "k" },
  { threshold: 1e0, prefix: "" },
  { threshold: 1e-3, prefix: "m" },
  { threshold: 1e-6, prefix: "\u03BC" }, // μ
  { threshold: 1e-9, prefix: "n" },
  { threshold: 1e-12, prefix: "p" },
  { threshold: 1e-15, prefix: "f" },
];

/**
 * Format a numeric value with the appropriate SI prefix and unit.
 *
 * @example
 * formatSI(0.0005, "m")   → "500.0 μm"
 * formatSI(0.001, "rad")  → "1.000 mrad"
 * formatSI(1.5e-6, "m")   → "1.500 μm"
 */
export function formatSI(value: number, unit: string): string {
  if (value === 0) return `0.0 ${unit}`;

  const absValue = Math.abs(value);
  const sign = value < 0 ? "\u2212" : ""; // minus sign

  for (const { threshold, prefix } of SI_PREFIXES) {
    if (absValue >= threshold * 0.9999995) {
      const scaled = absValue / threshold;
      return `${sign}${formatScaledNumber(scaled)} ${prefix}${unit}`;
    }
  }

  // Very small values – use scientific notation
  return `${sign}${absValue.toExponential(3)} ${unit}`;
}

/**
 * Format a scaled number with an appropriate number of decimal places:
 *   ≥ 100 → 1 decimal  (e.g. 500.0)
 *   ≥ 10  → 2 decimals (e.g. 12.35)
 *   < 10  → 3 decimals (e.g. 1.000)
 */
function formatScaledNumber(val: number): string {
  if (val >= 100) return val.toFixed(1);
  if (val >= 10) return val.toFixed(2);
  return val.toFixed(3);
}
