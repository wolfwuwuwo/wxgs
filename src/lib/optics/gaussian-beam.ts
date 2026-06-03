/**
 * Gaussian Beam Optics Library
 *
 * Provides calculations for Gaussian beam propagation, including
 * free-space propagation and thin-lens focusing using the complex
 * beam parameter (q-parameter) formalism.
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
  const { w0, wavelength, propagationDistance, lensFocalLength, lensPosition } =
    params;

  // --- Original (unfocused) beam properties ---
  const zR = (Math.PI * w0 * w0) / wavelength; // Rayleigh range
  const divergence = wavelength / (Math.PI * w0); // half-angle divergence

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

  // --- Envelope generation (250 points for smooth visualisation) ---
  const NUM_POINTS = 250;
  const envelopePoints: { z: number; w: number }[] = [];

  for (let i = 0; i <= NUM_POINTS; i++) {
    const z = (i / NUM_POINTS) * propagationDistance;
    envelopePoints.push({ z, w: beamWidthAt(z) });
  }

  // --- widthAt helper (multi-segment aware) ---
  function beamWidthAt(z: number): number {
    if (lensFocalLength !== 0 && z >= lensPosition) {
      // Post-lens segment: use focused beam parameters
      const dz = z - newWaistPos;
      return newW0 * Math.sqrt(1 + (dz / newZR) * (dz / newZR));
    }
    // Pre-lens segment or no lens: original beam
    return w0 * Math.sqrt(1 + (z / zR) * (z / zR));
  }

  return {
    rayleighRange: zR,
    divergence,
    focusedW0,
    focusedPosition,
    envelopePoints,
    widthAt: beamWidthAt,
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
