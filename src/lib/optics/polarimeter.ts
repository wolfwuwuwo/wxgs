// Polarimeter Calculation Library for Optics Simulation
// Implements optical rotation, Malus's law, triple-field (half-shadow) analysis,
// Drude dispersion correction, and mutarotation kinetics.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SubstancePreset {
  id: string;
  name: string;
  specificRotation: number;    // °/(dm·g/mL) at 589nm, 20°C
  defaultConcentration: number;
  defaultTubeLength: number;
  drudeA: number;              // Drude equation coefficient
  drudeLambda0: number;        // Drude resonance wavelength (nm)
  tempCoeff: number;           // d[α]/dT (°/°C)
  mutarotation?: {
    alpha0: number;            // initial specific rotation
    alphaEq: number;           // equilibrium specific rotation
    k: number;                 // rate constant (min⁻¹)
  };
}

export interface CustomSubstance {
  name: string;
  specificRotation: number;
  solvent?: string;
}

export type MeasurementMode = 'extinction' | 'triple_field';
export type FieldState = 'uniform_dim' | 'uniform_bright' | 'non_uniform';

// ---------------------------------------------------------------------------
// Substance presets
// ---------------------------------------------------------------------------

export const SUBSTANCE_PRESETS: SubstancePreset[] = [
  {
    id: 'glucose',
    name: 'Glucose (D-Glucose)',
    specificRotation: 52.7,
    defaultConcentration: 0.1,       // g/mL
    defaultTubeLength: 2,            // dm
    drudeA: 1.711e7,
    drudeLambda0: 150,               // nm
    tempCoeff: -0.018,               // °/°C
    mutarotation: {
      alpha0: 112.2,
      alphaEq: 52.7,
      k: 0.012,                      // min⁻¹
    },
  },
  {
    id: 'sucrose',
    name: 'Sucrose',
    specificRotation: 66.5,
    defaultConcentration: 0.1,
    defaultTubeLength: 2,
    drudeA: 2.179e7,
    drudeLambda0: 140,
    tempCoeff: -0.016,
  },
  {
    id: 'fructose',
    name: 'Fructose (D-Fructose)',
    specificRotation: -92.4,
    defaultConcentration: 0.1,
    defaultTubeLength: 2,
    drudeA: -3.040e7,
    drudeLambda0: 135,
    tempCoeff: -0.024,
    mutarotation: {
      alpha0: -132.0,
      alphaEq: -92.4,
      k: 0.008,
    },
  },
  {
    id: 'tartaric',
    name: 'Tartaric Acid (L-(+))',
    specificRotation: 14.0,
    defaultConcentration: 0.1,
    defaultTubeLength: 2,
    drudeA: 4.567e6,
    drudeLambda0: 145,
    tempCoeff: -0.006,
  },
  {
    id: 'custom',
    name: 'Custom',
    specificRotation: 0,
    defaultConcentration: 0.1,
    defaultTubeLength: 2,
    drudeA: 0,
    drudeLambda0: 0,
    tempCoeff: 0,
  },
];

// ---------------------------------------------------------------------------
// Wavelength options
// ---------------------------------------------------------------------------

export const WAVELENGTH_OPTIONS: { value: number; label: string; color: string }[] = [
  { value: 589.3, label: 'Na D 589.3nm',  color: '#FFB800' },
  { value: 546.1, label: 'Hg绿 546.1nm',   color: '#00AA44' },
  { value: 632.8, label: 'He-Ne 632.8nm',  color: '#CC0000' },
  { value: 435.8, label: 'Hg蓝 435.8nm',   color: '#4050B0' },
];

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Reference wavelength (Na D-line) in nm */
const REF_WAVELENGTH = 589.3;

/** Threshold for considering the triple-field as "uniform" */
const UNIFORM_THRESHOLD = 0.02;

/** Threshold for auto-detecting dim zero via sensitivity */
const DIM_ZERO_SENSITIVITY_THRESHOLD = 0.005;

// ---------------------------------------------------------------------------
// Degree ↔ radian helpers
// ---------------------------------------------------------------------------

function deg2rad(d: number): number {
  return (d * Math.PI) / 180;
}

// ---------------------------------------------------------------------------
// Optical rotation calculation
// ---------------------------------------------------------------------------

/**
 * Calculate the observed optical rotation for a substance.
 *
 * For SubstancePreset the Drude dispersion equation is applied to correct
 * for wavelength, then the standard Biot's law is used:
 *
 *   α = [α]λ × c × l
 *
 * Drude equation:  [α](λ) = A / (λ² − λ₀²)
 * Scaling:  [α]λ = [α]₅₈₉ × drudeAt(λ) / drudeAt(589)
 *
 * Temperature correction is NOT applied here (assumes 20 °C standard).
 * Use `specificRotationAtTemp` separately if needed.
 */
export function calculateOpticalRotation(
  substance: SubstancePreset | CustomSubstance,
  wavelength: number,
  concentration: number,
  tubeLength: number,
): number {
  let specificRotation = substance.specificRotation;

  // Apply Drude wavelength correction for SubstancePreset entries that
  // carry non-trivial Drude coefficients.
  if ('drudeA' in substance && substance.drudeA !== 0 && substance.drudeLambda0 !== 0) {
    const lambdaSq = wavelength * wavelength;
    const lambda0Sq = substance.drudeLambda0 * substance.drudeLambda0;
    const refLambdaSq = REF_WAVELENGTH * REF_WAVELENGTH;

    // Avoid division by zero near resonance
    const denomAtLambda = lambdaSq - lambda0Sq;
    const denomAtRef = refLambdaSq - lambda0Sq;
    if (Math.abs(denomAtLambda) < 1e-6 || Math.abs(denomAtRef) < 1e-6) {
      // Near resonance — fall back to base rotation
      return specificRotation * concentration * tubeLength;
    }

    const drudeRatio = denomAtRef / denomAtLambda;
    specificRotation = specificRotation * drudeRatio;
  }

  // Biot's law: α = [α] × c × l
  return specificRotation * concentration * tubeLength;
}

// ---------------------------------------------------------------------------
// Temperature correction (utility, not part of main calc signature)
// ---------------------------------------------------------------------------

/**
 * Apply temperature correction to a specific rotation value.
 * [α]T = [α]₂₀ + tempCoeff × (T − 20)
 */
export function specificRotationAtTemp(
  baseRotation: number,
  tempCoeff: number,
  temperatureC: number,
): number {
  return baseRotation + tempCoeff * (temperatureC - 20);
}

// ---------------------------------------------------------------------------
// Mutarotation kinetics (utility)
// ---------------------------------------------------------------------------

/**
 * Specific rotation at time t for a substance undergoing mutarotation.
 * [α](t) = α_eq + (α₀ − α_eq) × e^(−kt)
 */
export function mutarotationAtTime(
  alpha0: number,
  alphaEq: number,
  k: number,
  tMin: number,
): number {
  return alphaEq + (alpha0 - alphaEq) * Math.exp(-k * tMin);
}

// ---------------------------------------------------------------------------
// Malus's law
// ---------------------------------------------------------------------------

/**
 * Malus's law intensity: I = I₀ × cos²(θ − φ)
 *
 * @param analyzerAngle  Analyzer angle in degrees
 * @param extinctionAngle  Extinction angle (φ) in degrees
 * @returns Normalised intensity in [0, 1]
 */
export function malusIntensity(analyzerAngle: number, extinctionAngle: number): number {
  const diffRad = deg2rad(analyzerAngle - extinctionAngle);
  return Math.cos(diffRad) ** 2;
}

// ---------------------------------------------------------------------------
// Wavelength → colour
// ---------------------------------------------------------------------------

/**
 * Convert a wavelength (nm) to a CSS colour string.
 * Uses the WAVELENGTH_OPTIONS lookup first, then falls back to a
 * piecewise visible-spectrum algorithm.
 */
export function wavelengthToColor(wavelength: number): string {
  // Exact match from preset options
  const match = WAVELENGTH_OPTIONS.find((w) => Math.abs(w.value - wavelength) < 1);
  if (match) return match.color;

  // Piecewise approximation for 380–780 nm
  let r = 0;
  let g = 0;
  let b = 0;

  if (wavelength >= 380 && wavelength < 440) {
    r = -(wavelength - 440) / (440 - 380);
    b = 1;
  } else if (wavelength >= 440 && wavelength < 490) {
    g = (wavelength - 440) / (490 - 440);
    b = 1;
  } else if (wavelength >= 490 && wavelength < 510) {
    g = 1;
    b = -(wavelength - 510) / (510 - 490);
  } else if (wavelength >= 510 && wavelength < 580) {
    r = (wavelength - 510) / (580 - 510);
    g = 1;
  } else if (wavelength >= 580 && wavelength < 645) {
    r = 1;
    g = -(wavelength - 645) / (645 - 580);
  } else if (wavelength >= 645 && wavelength <= 780) {
    r = 1;
  }

  // Intensity fall-off at edges of visible spectrum
  let factor = 1;
  if (wavelength >= 380 && wavelength < 420) {
    factor = 0.3 + (0.7 * (wavelength - 380)) / (420 - 380);
  } else if (wavelength >= 645 && wavelength <= 780) {
    factor = 0.3 + (0.7 * (780 - wavelength)) / (780 - 645);
  }

  const ri = Math.round(255 * r * factor);
  const gi = Math.round(255 * g * factor);
  const bi = Math.round(255 * b * factor);

  return `rgb(${ri}, ${gi}, ${bi})`;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/** Format an angle (in degrees) with two-decimal precision and degree symbol. */
export function formatAngle(angle: number): string {
  return angle.toFixed(2) + '°';
}

/** Format a normalised intensity (0–1) as a percentage with one decimal. */
export function formatIntensity(intensity: number): string {
  return (intensity * 100).toFixed(1) + '%';
}

// ---------------------------------------------------------------------------
// Triple-field (half-shadow) calculations
// ---------------------------------------------------------------------------

/**
 * Triple-field intensities using the Lippich half-shadow model.
 *
 * The field is divided into three zones:
 *   Left edge:   cos²(θ − δ − α)
 *   Centre:      cos²(θ − α)
 *   Right edge:  cos²(θ − δ − α)
 *
 * Both edge zones share the same polarization plane, offset from the
 * centre zone by the half-shadow angle δ. This is the classic
 * three-part field (三分视场) design: at the null angle
 * θ = α + 90° + δ/2 all three zones are exactly equally bright (dim),
 * and near the null the zone-to-zone brightness difference changes
 * linearly with θ, which is what makes the reading sensitive.
 *
 * @param analyzerAngle    Analyzer angle θ (degrees)
 * @param opticalRotation  Sample optical rotation α (degrees)
 * @param shadowAngle      Half-shadow angle δ (degrees)
 */
export function tripleFieldIntensities(
  analyzerAngle: number,
  opticalRotation: number,
  shadowAngle: number,
): { edge: number; center: number } {
  const theta = deg2rad(analyzerAngle);
  const alpha = deg2rad(opticalRotation);
  const delta = deg2rad(shadowAngle);

  const edge = Math.cos(theta - delta - alpha) ** 2;
  const center = Math.cos(theta - alpha) ** 2;

  return {
    edge,
    center,
  };
}

/**
 * Maximum absolute brightness difference between any two zones in the
 * triple-field view. A value of 0 means all three zones are equally bright.
 * Since both edge zones are identical, this reduces to |I_edge − I_centre|.
 */
export function tripleFieldBrightnessDiff(
  analyzerAngle: number,
  opticalRotation: number,
  shadowAngle: number,
): number {
  const theta = deg2rad(analyzerAngle);
  const alpha = deg2rad(opticalRotation);
  const delta = deg2rad(shadowAngle);

  const edge = Math.cos(theta - delta - alpha) ** 2;
  const center = Math.cos(theta - alpha) ** 2;

  return Math.abs(center - edge);
}

/**
 * Classify the triple-field appearance into one of three states.
 *
 * - `uniform_dim`    — all zones have similar, low intensity
 * - `uniform_bright` — all zones have similar, high intensity (false zero)
 * - `non_uniform`    — zones differ noticeably
 */
export function classifyFieldState(
  analyzerAngle: number,
  opticalRotation: number,
  shadowAngle: number,
): FieldState {
  const { edge, center } = tripleFieldIntensities(analyzerAngle, opticalRotation, shadowAngle);
  const diff = tripleFieldBrightnessDiff(analyzerAngle, opticalRotation, shadowAngle);
  const avgIntensity = (2 * edge + center) / 3;

  if (diff < UNIFORM_THRESHOLD) {
    return avgIntensity < 0.5 ? 'uniform_dim' : 'uniform_bright';
  }
  return 'non_uniform';
}

/** Human-readable label for a FieldState value. */
export function fieldStateLabel(state: FieldState): string {
  switch (state) {
    case 'uniform_dim':
      return 'Uniform Dim';
    case 'uniform_bright':
      return 'Uniform Bright';
    case 'non_uniform':
      return 'Non-Uniform';
  }
}

/**
 * Returns true when the analyzer is near the **bright zero** (false zero)
 * — the field appears uniform and bright, which a novice might mistake
 * for the true extinction point.
 */
export function isNearFalseZero(
  analyzerAngle: number,
  opticalRotation: number,
  shadowAngle: number,
): boolean {
  return classifyFieldState(analyzerAngle, opticalRotation, shadowAngle) === 'uniform_bright';
}

/**
 * Returns true when the analyzer is near the **dim zero** (true zero)
 * — the field appears uniform and dim, which is the correct
 * extinction reading.
 */
export function isNearDimZero(
  analyzerAngle: number,
  opticalRotation: number,
  shadowAngle: number,
): boolean {
  return classifyFieldState(analyzerAngle, opticalRotation, shadowAngle) === 'uniform_dim';
}

/**
 * Measurement sensitivity at the current analyzer angle.
 *
 * Defined as |dΔI/dθ| where ΔI = I_edge − I_centre. The two edge zones
 * are identical, so this is the rate at which the three-part field
 * contrast changes per degree of analyzer rotation.
 *
 * The derivative is expressed **per degree** of analyzer rotation,
 * yielding small numerical values suitable for the 0.005 threshold
 * used in `autoDetectDimZero`.
 *
 * Derivation (θ in radians):
 *   d/dθ cos²(θ−δ−α) = −sin(2(θ−δ−α))
 *   dΔI/dθ           = −sin(2(θ−δ−α)) + sin(2(θ−α))
 *
 * Converting to per-degree: multiply by π/180.
 */
export function sensitivityAtAngle(
  analyzerAngle: number,
  opticalRotation: number,
  shadowAngle: number,
): number {
  const theta = deg2rad(analyzerAngle);
  const alpha = deg2rad(opticalRotation);
  const delta = deg2rad(shadowAngle);

  const dDiff = -Math.sin(2 * (theta - delta - alpha)) + Math.sin(2 * (theta - alpha));

  // Convert from per-radian to per-degree
  const radPerDeg = Math.PI / 180;

  return Math.abs(dDiff) * radPerDeg;
}

/**
 * Automatically detect whether the analyzer is sitting at the dim zero.
 *
 * True when sensitivity is very low (< 0.005 per degree) AND the field
 * is classified as `uniform_dim`.
 */
export function autoDetectDimZero(
  analyzerAngle: number,
  opticalRotation: number,
  shadowAngle: number,
): boolean {
  const sensitivity = sensitivityAtAngle(analyzerAngle, opticalRotation, shadowAngle);
  const state = classifyFieldState(analyzerAngle, opticalRotation, shadowAngle);
  return sensitivity < DIM_ZERO_SENSITIVITY_THRESHOLD && state === 'uniform_dim';
}

/**
 * Find the analyzer angle for the **dim zero** (true extinction).
 *
 * In the Lippich three-part field model the dim zero occurs where the
 * three zones are exactly equal and minimal: θ − α = 90° + δ/2, giving
 * every zone an intensity sin²(δ/2).
 *
 * @returns Analyzer angle in degrees for the dim zero
 */
export function findDimZeroAngle(
  opticalRotation: number,
  shadowAngle: number,
): number {
  // θ = α + 90° + δ/2
  return opticalRotation + 90 + shadowAngle / 2;
}

/**
 * Find the analyzer angle for the **bright zero** (false zero).
 *
 * The bright zero occurs at θ = α + δ/2, where the centre and edge
 * zones are equal at cos²(δ/2) ≈ 1.
 *
 * @returns Analyzer angle in degrees for the bright zero
 */
export function findBrightZeroAngle(
  opticalRotation: number,
  shadowAngle: number,
): number {
  // θ = α + δ/2
  return opticalRotation + shadowAngle / 2;
}
