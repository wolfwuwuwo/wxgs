/* ═══════════════════════════════════════════════════════════════
   Vector Diffraction Physics Engine v2
   Angular Spectrum Method + Vector Diffraction + Polygon Aperture
   ═══════════════════════════════════════════════════════════════ */

export type ApertureType = 'circular' | 'rectangular' | 'single_slit' | 'double_slit' | 'grating' | 'polygon' | 'annular' | 'triangle';

export interface ApertureParams {
  type: ApertureType;
  gridSize: number;
  radius?: number;
  halfWidth?: number;
  halfHeight?: number;
  slitWidth?: number;
  slitSeparation?: number;
  numSlits?: number;
  gratingSlitWidth?: number;
  gratingPeriod?: number;
  /** Polygon vertices in normalized coords [-1,1] */
  polygonVertices?: { x: number; y: number }[];
  /** Inner radius for annular aperture */
  innerRadius?: number;
  /** Gaussian apodization edge width (0 = sharp, >0 = soft edge) */
  apodizationWidth?: number;
}

export interface VectorDiffractionResult {
  /** Total intensity |Ex|²+|Ey|²+|Ez|² */
  intensity: Float64Array;
  /** |Ex|² component */
  intensityX: Float64Array;
  /** |Ey|² component */
  intensityY: Float64Array;
  /** |Ez|² component (longitudinal, important for sub-wavelength) */
  intensityZ: Float64Array;
  /** Fresnel number N_F = a²/(λz) */
  fresnelNumber: number;
  /** Region classification */
  region: 'fraunhofer' | 'fresnel' | 'near-field';
  /** Physical field size in meters */
  fieldSizeM: number;
}

// ────────────────────────────────────────────────────────────
// Internal 1D Cooley-Tukey radix-2 FFT (in-place)
// ────────────────────────────────────────────────────────────

function fft1d(re: Float64Array, im: Float64Array, n: number, inverse: boolean): void {
  let j = 0;
  for (let i = 0; i < n; i++) {
    if (j > i) {
      let tmp = re[i]; re[i] = re[j]; re[j] = tmp;
      tmp = im[i]; im[i] = im[j]; im[j] = tmp;
    }
    let m = n >> 1;
    while (m >= 1 && j >= m) { j -= m; m >>= 1; }
    j += m;
  }

  const sign = inverse ? 1 : -1;
  for (let size = 2; size <= n; size <<= 1) {
    const halfSize = size >> 1;
    const angleStep = (2 * Math.PI * sign) / size;
    const wRe = Math.cos(angleStep);
    const wIm = Math.sin(angleStep);

    for (let base = 0; base < n; base += size) {
      let curRe = 1, curIm = 0;
      for (let k = 0; k < halfSize; k++) {
        const idx1 = base + k;
        const idx2 = base + k + halfSize;
        const tRe = curRe * re[idx2] - curIm * im[idx2];
        const tIm = curRe * im[idx2] + curIm * re[idx2];
        re[idx2] = re[idx1] - tRe;
        im[idx2] = im[idx1] - tIm;
        re[idx1] += tRe;
        im[idx1] += tIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }

  if (inverse) {
    for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  }
}

// ────────────────────────────────────────────────────────────
// Internal 2D FFT (row–column decomposition)
// ────────────────────────────────────────────────────────────

export function fft2d(re: Float64Array, im: Float64Array, n: number, inverse: boolean): void {
  const rowRe = new Float64Array(n);
  const rowIm = new Float64Array(n);

  for (let y = 0; y < n; y++) {
    const offset = y * n;
    for (let x = 0; x < n; x++) { rowRe[x] = re[offset + x]; rowIm[x] = im[offset + x]; }
    fft1d(rowRe, rowIm, n, inverse);
    for (let x = 0; x < n; x++) { re[offset + x] = rowRe[x]; im[offset + x] = rowIm[x]; }
  }

  const colRe = new Float64Array(n);
  const colIm = new Float64Array(n);
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) { colRe[y] = re[y * n + x]; colIm[y] = im[y * n + x]; }
    fft1d(colRe, colIm, n, inverse);
    for (let y = 0; y < n; y++) { re[y * n + x] = colRe[y]; im[y * n + x] = colIm[y]; }
  }
}

// ────────────────────────────────────────────────────────────
// FFT shift — swap quadrants so DC is centred
// ────────────────────────────────────────────────────────────

export function fftshift2d(data: Float64Array, n: number): void {
  const half = n >> 1;
  for (let y = 0; y < half; y++) {
    for (let x = 0; x < half; x++) {
      const i1 = y * n + x;
      const i2 = (y + half) * n + (x + half);
      let tmp = data[i1]; data[i1] = data[i2]; data[i2] = tmp;
    }
    for (let x = half; x < n; x++) {
      const i1 = y * n + x;
      const i2 = (y + half) * n + (x - half);
      let tmp = data[i1]; data[i1] = data[i2]; data[i2] = tmp;
    }
  }
}

// ────────────────────────────────────────────────────────────
// Point-in-polygon test (ray casting)
// ────────────────────────────────────────────────────────────

function pointInPolygon(px: number, py: number, vertices: { x: number; y: number }[]): boolean {
  let inside = false;
  const n = vertices.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = vertices[i].x, yi = vertices[i].y;
    const xj = vertices[j].x, yj = vertices[j].y;
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

// ────────────────────────────────────────────────────────────
// Distance from point to line segment (for apodization)
// ────────────────────────────────────────────────────────────

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.sqrt((px - ax) ** 2 + (py - ay) ** 2);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = ax + t * dx, projY = ay + t * dy;
  return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
}

// ────────────────────────────────────────────────────────────
// Aperture generation (with Gaussian apodization support)
// ────────────────────────────────────────────────────────────

export function generateAperture(params: ApertureParams): Float64Array {
  const { type, gridSize } = params;
  const aperture = new Float64Array(gridSize * gridSize);
  const half = (gridSize - 1) / 2; // 圆心对准：避免偶数网格中心偏移 0.5px
  const apodWidth = params.apodizationWidth ?? 0;

  for (let j = 0; j < gridSize; j++) {
    const y = (j - half) / half;
    for (let i = 0; i < gridSize; i++) {
      const x = (i - half) / half;
      let val = 0;

      switch (type) {
        case 'circular': {
          const r = params.radius ?? 0.4;
          const dist = Math.sqrt(x * x + y * y);
          if (dist <= r) {
            val = 1;
            if (apodWidth > 0 && dist > r - apodWidth) {
              val = Math.exp(-((dist - (r - apodWidth)) ** 2) / (2 * (apodWidth / 3) ** 2));
            }
          }
          break;
        }
        case 'annular': {
          const rOuter = params.radius ?? 0.4;
          const rInner = params.innerRadius ?? 0.2;
          const dist = Math.sqrt(x * x + y * y);
          if (dist <= rOuter && dist >= rInner) {
            val = 1;
            if (apodWidth > 0) {
              if (dist > rOuter - apodWidth) {
                val *= Math.exp(-((dist - (rOuter - apodWidth)) ** 2) / (2 * (apodWidth / 3) ** 2));
              }
              if (dist < rInner + apodWidth) {
                val *= Math.exp(-((rInner + apodWidth - dist) ** 2) / (2 * (apodWidth / 3) ** 2));
              }
            }
          }
          break;
        }
        case 'rectangular': {
          const hw = params.halfWidth ?? 0.3;
          const hh = params.halfHeight ?? 0.3;
          if (Math.abs(x) <= hw && Math.abs(y) <= hh) {
            val = 1;
            if (apodWidth > 0) {
              const dEdge = Math.min(hw - Math.abs(x), hh - Math.abs(y));
              if (dEdge < apodWidth) {
                val = Math.exp(-((apodWidth - dEdge) ** 2) / (2 * (apodWidth / 3) ** 2));
              }
            }
          }
          break;
        }
        case 'triangle': {
          const r = params.radius ?? 0.4;
          const verts = [
            { x: 0, y: r },
            { x: -r * Math.cos(Math.PI / 6), y: -r * Math.sin(Math.PI / 6) },
            { x: r * Math.cos(Math.PI / 6), y: -r * Math.sin(Math.PI / 6) },
          ];
          if (pointInPolygon(x, y, verts)) {
            val = 1;
            if (apodWidth > 0) {
              let minDist = Infinity;
              for (let vi = 0; vi < verts.length; vi++) {
                const vj = (vi + 1) % verts.length;
                minDist = Math.min(minDist, distToSegment(x, y, verts[vi].x, verts[vi].y, verts[vj].x, verts[vj].y));
              }
              if (minDist < apodWidth) {
                val = Math.exp(-((apodWidth - minDist) ** 2) / (2 * (apodWidth / 3) ** 2));
              }
            }
          }
          break;
        }
        case 'single_slit': {
          const sw = params.slitWidth ?? 0.1;
          if (Math.abs(x) <= sw / 2) {
            val = 1;
            if (apodWidth > 0) {
              const dEdge = sw / 2 - Math.abs(x);
              if (dEdge < apodWidth) {
                val = Math.exp(-((apodWidth - dEdge) ** 2) / (2 * (apodWidth / 3) ** 2));
              }
            }
          }
          break;
        }
        case 'double_slit': {
          const sw = params.slitWidth ?? 0.05;
          const sep = params.slitSeparation ?? 0.3;
          if (Math.abs(x + sep / 2) <= sw / 2 || Math.abs(x - sep / 2) <= sw / 2) {
            val = 1;
            if (apodWidth > 0) {
              const dLeft = sw / 2 - Math.abs(x + sep / 2);
              const dRight = sw / 2 - Math.abs(x - sep / 2);
              const dEdge = Math.max(dLeft > 0 ? dLeft : -1, dRight > 0 ? dRight : -1);
              if (dEdge >= 0 && dEdge < apodWidth) {
                val = Math.exp(-((apodWidth - dEdge) ** 2) / (2 * (apodWidth / 3) ** 2));
              }
            }
          }
          break;
        }
        case 'grating': {
          const sw = params.gratingSlitWidth ?? 0.05;
          const period = params.gratingPeriod ?? 0.2;
          const numS = params.numSlits ?? 5;
          const startK = -Math.floor((numS - 1) / 2);
          for (let k = startK; k < startK + numS; k++) {
            if (Math.abs(x - k * period) <= sw / 2) {
              val = 1;
              if (apodWidth > 0) {
                const dEdge = sw / 2 - Math.abs(x - k * period);
                if (dEdge < apodWidth) {
                  val = Math.exp(-((apodWidth - dEdge) ** 2) / (2 * (apodWidth / 3) ** 2));
                }
              }
              break;
            }
          }
          break;
        }
        case 'polygon': {
          const verts = params.polygonVertices ?? [];
          if (verts.length >= 3 && pointInPolygon(x, y, verts)) {
            val = 1;
            if (apodWidth > 0) {
              let minDist = Infinity;
              for (let vi = 0; vi < verts.length; vi++) {
                const vj = (vi + 1) % verts.length;
                minDist = Math.min(minDist, distToSegment(x, y, verts[vi].x, verts[vi].y, verts[vj].x, verts[vj].y));
              }
              if (minDist < apodWidth) {
                val = Math.exp(-((apodWidth - minDist) ** 2) / (2 * (apodWidth / 3) ** 2));
              }
            }
          }
          break;
        }
      }

      aperture[j * gridSize + i] = val;
    }
  }

  return aperture;
}

// ────────────────────────────────────────────────────────────
// Complementary aperture (Babinet's principle)
// ────────────────────────────────────────────────────────────

export function generateComplementaryAperture(aperture: Float64Array, gridSize: number): Float64Array {
  const comp = new Float64Array(gridSize * gridSize);
  for (let i = 0; i < gridSize * gridSize; i++) {
    comp[i] = aperture[i] > 0.5 ? 0 : 1;
  }
  return comp;
}

// ────────────────────────────────────────────────────────────
// Fresnel number computation
// N_F = a² / (λ·z)
// ────────────────────────────────────────────────────────────

export function computeFresnelNumber(
  apertureRadiusM: number,
  wavelengthM: number,
  distanceM: number
): number {
  if (distanceM <= 0 || wavelengthM <= 0) return Infinity;
  return (apertureRadiusM * apertureRadiusM) / (wavelengthM * distanceM);
}

export function classifyRegion(fresnelNumber: number): 'fraunhofer' | 'fresnel' | 'near-field' {
  if (fresnelNumber < 0.5) return 'fraunhofer';
  if (fresnelNumber < 5) return 'fresnel';
  return 'near-field';
}

// ────────────────────────────────────────────────────────────
// Angular Spectrum Method (ASM) — rigorous scalar diffraction
// U(x,y,0) → FFT → multiply H(fx,fy,z) → IFFT → U(x,y,z)
// H(fx,fy,z) = exp(ikz·√(1-(λfx)²-(λfy)²))   propagating
//            = exp(-kz·√((λfx)²+(λfy)²-1))      evanescent
// ────────────────────────────────────────────────────────────

export function computeAngularSpectrum(
  aperture: Float64Array,
  gridSize: number,
  wavelengthM: number,
  distanceM: number,
  fieldSizeM: number
): { intensity: Float64Array; fieldRe: Float64Array; fieldIm: Float64Array } {
  const total = gridSize * gridSize;
  const re = new Float64Array(total);
  const im = new Float64Array(total);
  re.set(aperture);

  // Forward 2D FFT
  fft2d(re, im, gridSize, false);

  // Apply propagation transfer function
  const k = 2 * Math.PI / wavelengthM;
  const df = 1 / fieldSizeM; // frequency spacing

  for (let j = 0; j < gridSize; j++) {
    const fj = j < gridSize / 2 ? j : j - gridSize;
    const fy = fj * df;
    for (let i = 0; i < gridSize; i++) {
      const fi = i < gridSize / 2 ? i : i - gridSize;
      const fx = fi * df;

      const arg = (wavelengthM * fx) ** 2 + (wavelengthM * fy) ** 2;
      const idx = j * gridSize + i;

      if (arg < 1) {
        // Propagating wave
        const phase = k * distanceM * Math.sqrt(1 - arg);
        const cosP = Math.cos(phase);
        const sinP = Math.sin(phase);
        const reOld = re[idx], imOld = im[idx];
        re[idx] = reOld * cosP - imOld * sinP;
        im[idx] = reOld * sinP + imOld * cosP;
      } else {
        // Evanescent wave — exponential decay
        const decay = Math.exp(-k * distanceM * Math.sqrt(arg - 1));
        re[idx] *= decay;
        im[idx] *= decay;
      }
    }
  }

  // Save field before shift for vector diffraction
  const fieldRePreShift = new Float64Array(re);
  const fieldImPreShift = new Float64Array(im);

  // Inverse 2D FFT
  fft2d(re, im, gridSize, true);

  // Intensity = |U|²
  const intensity = new Float64Array(total);
  for (let i = 0; i < total; i++) {
    intensity[i] = re[i] * re[i] + im[i] * im[i];
  }

  return { intensity, fieldRe: fieldRePreShift, fieldIm: fieldImPreShift };
}

// ────────────────────────────────────────────────────────────
// Vector Diffraction — compute Ex, Ey, Ez components
// For a linearly polarized input (e.g., x-polarized),
// the angular spectrum decomposes into TE and TM components.
// Ez arises from TM (p-polarization) component.
// ────────────────────────────────────────────────────────────

export function computeVectorDiffraction(
  aperture: Float64Array,
  gridSize: number,
  wavelengthM: number,
  distanceM: number,
  fieldSizeM: number,
  polarizationAngle: number = 0 // 0 = x-polarized, π/2 = y-polarized
): VectorDiffractionResult {
  const total = gridSize * gridSize;
  const k = 2 * Math.PI / wavelengthM;
  const df = 1 / fieldSizeM;

  // Input field components (linearly polarized)
  const Ex_re = new Float64Array(total);
  const Ex_im = new Float64Array(total);
  const Ey_re = new Float64Array(total);
  const Ey_im = new Float64Array(total);

  const cosP = Math.cos(polarizationAngle);
  const sinP = Math.sin(polarizationAngle);

  for (let i = 0; i < total; i++) {
    Ex_re[i] = aperture[i] * cosP;
    Ey_re[i] = aperture[i] * sinP;
  }

  // Forward FFT both components
  fft2d(Ex_re, Ex_im, gridSize, false);
  fft2d(Ey_re, Ey_im, gridSize, false);

  // Angular spectrum field components after propagation
  // For each spatial frequency (fx, fy):
  //   kx = 2π·fx, ky = 2π·fy
  //   kz = √(k² - kx² - ky²) if k² > kx² + ky² (propagating)
  //
  // Ex_out(fx,fy) = Ex_in(fx,fy) · H(fx,fy,z)
  // Ey_out(fx,fy) = Ey_in(fx,fy) · H(fx,fy,z)
  // Ez(fx,fy) = -(kx·Ex_out + ky·Ey_out) / kz  (from ∇·E=0)

  const Ex_out_re = new Float64Array(total);
  const Ex_out_im = new Float64Array(total);
  const Ey_out_re = new Float64Array(total);
  const Ey_out_im = new Float64Array(total);
  const Ez_re = new Float64Array(total);
  const Ez_im = new Float64Array(total);

  for (let j = 0; j < gridSize; j++) {
    const fj = j < gridSize / 2 ? j : j - gridSize;
    const fy = fj * df;
    const ky = 2 * Math.PI * fy;
    for (let i = 0; i < gridSize; i++) {
      const fi = i < gridSize / 2 ? i : i - gridSize;
      const fx = fi * df;
      const kx = 2 * Math.PI * fx;

      const kPerpSq = kx * kx + ky * ky;
      const idx = j * gridSize + i;

      if (kPerpSq < k * k) {
        // Propagating wave
        const kz = Math.sqrt(k * k - kPerpSq);
        const phase = kz * distanceM;
        const cosPhase = Math.cos(phase);
        const sinPhase = Math.sin(phase);

        // H · Ex_in
        const exReOld = Ex_re[idx], exImOld = Ex_im[idx];
        Ex_out_re[idx] = exReOld * cosPhase - exImOld * sinPhase;
        Ex_out_im[idx] = exReOld * sinPhase + exImOld * cosPhase;

        // H · Ey_in
        const eyReOld = Ey_re[idx], eyImOld = Ey_im[idx];
        Ey_out_re[idx] = eyReOld * cosPhase - eyImOld * sinPhase;
        Ey_out_im[idx] = eyReOld * sinPhase + eyImOld * cosPhase;

        // Ez = -(kx·Ex + ky·Ey) / kz
        const kxEx_re = kx * Ex_out_re[idx];
        const kxEx_im = kx * Ex_out_im[idx];
        const kyEy_re = ky * Ey_out_re[idx];
        const kyEy_im = ky * Ey_out_im[idx];

        Ez_re[idx] = -(kxEx_re + kyEy_re) / kz;
        Ez_im[idx] = -(kxEx_im + kyEy_im) / kz;
      } else {
        // Evanescent — set to 0 (decay is very fast)
        Ex_out_re[idx] = 0;
        Ex_out_im[idx] = 0;
        Ey_out_re[idx] = 0;
        Ey_out_im[idx] = 0;
        Ez_re[idx] = 0;
        Ez_im[idx] = 0;
      }
    }
  }

  // Inverse FFT all components
  fft2d(Ex_out_re, Ex_out_im, gridSize, true);
  fft2d(Ey_out_re, Ey_out_im, gridSize, true);
  fft2d(Ez_re, Ez_im, gridSize, true);

  // Compute intensities
  const intensityX = new Float64Array(total);
  const intensityY = new Float64Array(total);
  const intensityZ = new Float64Array(total);
  const intensity = new Float64Array(total);

  for (let i = 0; i < total; i++) {
    intensityX[i] = Ex_out_re[i] * Ex_out_re[i] + Ex_out_im[i] * Ex_out_im[i];
    intensityY[i] = Ey_out_re[i] * Ey_out_re[i] + Ey_out_im[i] * Ey_out_im[i];
    intensityZ[i] = Ez_re[i] * Ez_re[i] + Ez_im[i] * Ez_im[i];
    intensity[i] = intensityX[i] + intensityY[i] + intensityZ[i];
  }

  // Compute Fresnel number
  const apertureRadiusM = fieldSizeM * 0.2; // approximate
  const fresnelNumber = computeFresnelNumber(apertureRadiusM, wavelengthM, distanceM);
  const region = classifyRegion(fresnelNumber);

  return {
    intensity,
    intensityX,
    intensityY,
    intensityZ,
    fresnelNumber,
    region,
    fieldSizeM,
  };
}

// ────────────────────────────────────────────────────────────
// Fraunhofer (far-field) diffraction (legacy, scalar)
// ────────────────────────────────────────────────────────────

export function computeFraunhoferDiffraction(
  aperture: Float64Array,
  gridSize: number
): { intensity: Float64Array } {
  const total = gridSize * gridSize;
  const re = new Float64Array(total);
  const im = new Float64Array(total);
  re.set(aperture);

  fft2d(re, im, gridSize, false);

  const intensity = new Float64Array(total);
  for (let i = 0; i < total; i++) {
    intensity[i] = re[i] * re[i] + im[i] * im[i];
  }

  fftshift2d(intensity, gridSize);
  return { intensity };
}

// ────────────────────────────────────────────────────────────
// Fresnel (near-field) diffraction (legacy, scalar)
// ────────────────────────────────────────────────────────────

export function computeFresnelDiffraction(
  aperture: Float64Array,
  gridSize: number,
  fresnelNumber: number
): { intensity: Float64Array } {
  const total = gridSize * gridSize;
  const re = new Float64Array(total);
  const im = new Float64Array(total);
  const half = (gridSize - 1) / 2; // 圆心对准

  for (let j = 0; j < gridSize; j++) {
    const y = (j - half) / half;
    for (let i = 0; i < gridSize; i++) {
      const x = (i - half) / half;
      const idx = j * gridSize + i;
      const phase = (Math.PI * (x * x + y * y)) / fresnelNumber;
      re[idx] = aperture[idx] * Math.cos(phase);
      im[idx] = aperture[idx] * Math.sin(phase);
    }
  }

  fft2d(re, im, gridSize, false);

  const intensity = new Float64Array(total);
  for (let i = 0; i < total; i++) {
    intensity[i] = re[i] * re[i] + im[i] * im[i];
  }

  fftshift2d(intensity, gridSize);
  return { intensity };
}

// ────────────────────────────────────────────────────────────
// Two-point source diffraction (Rayleigh criterion)
// ────────────────────────────────────────────────────────────

export function generateTwoPointAperture(
  gridSize: number,
  separation: number, // normalized [-1,1]
  pointRadius: number = 0.02
): Float64Array {
  const aperture = new Float64Array(gridSize * gridSize);
  const half = (gridSize - 1) / 2; // 圆心对准

  for (let j = 0; j < gridSize; j++) {
    const y = (j - half) / half;
    for (let i = 0; i < gridSize; i++) {
      const x = (i - half) / half;
      const d1 = Math.sqrt((x + separation / 2) ** 2 + y * y);
      const d2 = Math.sqrt((x - separation / 2) ** 2 + y * y);
      if (d1 <= pointRadius || d2 <= pointRadius) {
        aperture[j * gridSize + i] = 1;
      }
    }
  }
  return aperture;
}

// ────────────────────────────────────────────────────────────
// Hologram generation (simple Fourier hologram of a pattern)
// ────────────────────────────────────────────────────────────

export function generateFourierHologram(
  gridSize: number,
  pattern: 'F' | 'cross' | 'circle',
  referenceAngleDeg: number = 5
): Float64Array {
  const aperture = new Float64Array(gridSize * gridSize);
  const half = (gridSize - 1) / 2; // 圆心对准

  // Generate object pattern
  for (let j = 0; j < gridSize; j++) {
    const y = (j - half) / half;
    for (let i = 0; i < gridSize; i++) {
      const x = (i - half) / half;
      let objVal = 0;

      switch (pattern) {
        case 'F': {
          // Letter F shape
          const w = 0.06;
          const h = 0.25;
          if ((Math.abs(x + 0.05) < w && y > -h && y < h) || // vertical bar
            (Math.abs(y - 0.15) < w * 0.8 && x > -0.05 && x < 0.2) || // top bar
            (Math.abs(y) < w * 0.8 && x > -0.05 && x < 0.15)) { // middle bar
            objVal = 1;
          }
          break;
        }
        case 'cross': {
          if ((Math.abs(x) < 0.03 && Math.abs(y) < 0.2) ||
            (Math.abs(y) < 0.03 && Math.abs(x) < 0.2)) {
            objVal = 1;
          }
          break;
        }
        case 'circle': {
          if (Math.sqrt(x * x + y * y) < 0.15) {
            objVal = 1;
          }
          break;
        }
      }

      // Add reference wave: exp(i·2π·sinθ·x/λ)  →  cos/sin carrier
      const refAngleRad = (referenceAngleDeg * Math.PI) / 180;
      const carrierPhase = 2 * Math.PI * Math.sin(refAngleRad) * x * 20; // spatial frequency

      // Hologram = |O + R|² where O = object, R = reference
      // = |O|² + |R|² + O·R* + O*·R
      // We store the real part of (object + reference) for reconstruction
      aperture[j * gridSize + i] = objVal + Math.cos(carrierPhase);
    }
  }
  return aperture;
}

// ────────────────────────────────────────────────────────────
// Wavelength to RGB color (spectral locus approximation)
// ────────────────────────────────────────────────────────────

export function wavelengthToRGB(wavelengthNm: number): { r: number; g: number; b: number } {
  let r = 0, g = 0, b = 0;
  if (wavelengthNm >= 380 && wavelengthNm < 440) {
    r = -(wavelengthNm - 440) / (440 - 380);
    b = 1;
  } else if (wavelengthNm >= 440 && wavelengthNm < 490) {
    g = (wavelengthNm - 440) / (490 - 440);
    b = 1;
  } else if (wavelengthNm >= 490 && wavelengthNm < 510) {
    g = 1;
    b = -(wavelengthNm - 510) / (510 - 490);
  } else if (wavelengthNm >= 510 && wavelengthNm < 580) {
    r = (wavelengthNm - 510) / (580 - 510);
    g = 1;
  } else if (wavelengthNm >= 580 && wavelengthNm < 645) {
    r = 1;
    g = -(wavelengthNm - 645) / (645 - 580);
  } else if (wavelengthNm >= 645 && wavelengthNm <= 780) {
    r = 1;
  }

  // Intensity correction at edges of visible spectrum
  let factor = 1;
  if (wavelengthNm >= 380 && wavelengthNm < 420) {
    factor = 0.3 + 0.7 * (wavelengthNm - 380) / (420 - 380);
  } else if (wavelengthNm >= 645 && wavelengthNm <= 780) {
    factor = 0.3 + 0.7 * (780 - wavelengthNm) / (780 - 645);
  }

  return {
    r: Math.round(r * factor * 255),
    g: Math.round(g * factor * 255),
    b: Math.round(b * factor * 255),
  };
}

// ────────────────────────────────────────────────────────────
// Intensity → wavelength-accurate monochrome gradient
// Uses the wavelength's actual color for a physically realistic display
// ────────────────────────────────────────────────────────────

export function intensityToWavelengthColor(
  intensity: Float64Array,
  gridSize: number,
  wavelengthNm: number
): ImageData {
  const total = gridSize * gridSize;
  let maxVal = 0;
  for (let i = 0; i < total; i++) {
    if (intensity[i] > maxVal) maxVal = intensity[i];
  }

  const baseColor = wavelengthToRGB(wavelengthNm);
  const imageData = new ImageData(gridSize, gridSize);
  const data = imageData.data;
  const gamma = 0.4;

  for (let i = 0; i < total; i++) {
    const norm = maxVal > 0 ? intensity[i] / maxVal : 0;
    const v = Math.pow(norm, gamma); // gamma correction
    data[i * 4] = Math.round(baseColor.r * v);
    data[i * 4 + 1] = Math.round(baseColor.g * v);
    data[i * 4 + 2] = Math.round(baseColor.b * v);
    data[i * 4 + 3] = 255;
  }

  return imageData;
}

// ────────────────────────────────────────────────────────────
// Intensity → grayscale ImageData (gamma-corrected)
// ────────────────────────────────────────────────────────────

export function intensityToGrayscale(
  intensity: Float64Array,
  gridSize: number,
  inverted: boolean
): ImageData {
  const total = gridSize * gridSize;
  let maxVal = 0;
  for (let i = 0; i < total; i++) {
    if (intensity[i] > maxVal) maxVal = intensity[i];
  }

  const imageData = new ImageData(gridSize, gridSize);
  const data = imageData.data;
  const gamma = 0.4;

  for (let i = 0; i < total; i++) {
    const norm = maxVal > 0 ? intensity[i] / maxVal : 0;
    let v = Math.pow(norm, gamma) * 255;
    if (inverted) v = 255 - v;
    const c = Math.max(0, Math.min(255, Math.round(v)));
    data[i * 4] = c;
    data[i * 4 + 1] = c;
    data[i * 4 + 2] = c;
    data[i * 4 + 3] = 255;
  }

  return imageData;
}

// ────────────────────────────────────────────────────────────
// Intensity → blue-white ImageData
// ────────────────────────────────────────────────────────────

export function intensityToBlueWhite(
  intensity: Float64Array,
  gridSize: number
): ImageData {
  const total = gridSize * gridSize;
  let maxVal = 0;
  for (let i = 0; i < total; i++) {
    if (intensity[i] > maxVal) maxVal = intensity[i];
  }

  const imageData = new ImageData(gridSize, gridSize);
  const data = imageData.data;
  const C0 = { r: 0x00, g: 0x00, b: 0x50 };
  const C1 = { r: 0x50, g: 0x60, b: 0xa0 };
  const C2 = { r: 0xff, g: 0xff, b: 0xff };

  for (let i = 0; i < total; i++) {
    const t = maxVal > 0 ? intensity[i] / maxVal : 0;
    let r: number, g: number, b: number;
    if (t <= 0.5) {
      const s = t * 2;
      r = C0.r + s * (C1.r - C0.r);
      g = C0.g + s * (C1.g - C0.g);
      b = C0.b + s * (C1.b - C0.b);
    } else {
      const s = (t - 0.5) * 2;
      r = C1.r + s * (C2.r - C1.r);
      g = C1.g + s * (C2.g - C1.g);
      b = C1.b + s * (C2.b - C1.b);
    }
    data[i * 4] = Math.max(0, Math.min(255, Math.round(r)));
    data[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(g)));
    data[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(b)));
    data[i * 4 + 3] = 255;
  }

  return imageData;
}

// ────────────────────────────────────────────────────────────
// Compute Airy disk first dark ring radius
// r_Airy = 1.22 · λ · z / D
// ────────────────────────────────────────────────────────────

export function computeAiryDiskRadius(
  wavelengthM: number,
  distanceM: number,
  apertureDiameterM: number
): number {
  return 1.22 * wavelengthM * distanceM / apertureDiameterM;
}

// ────────────────────────────────────────────────────────────
// Grating spectrometer: compute diffraction angles
// d·sin(θ) = m·λ  →  θ_m = arcsin(m·λ/d)
// ────────────────────────────────────────────────────────────

export function computeGratingOrders(
  gratingPeriodM: number,
  wavelengthNm: number,
  maxOrder: number = 5
): { order: number; angleDeg: number; wavelengthNm: number }[] {
  const wavelengthM = wavelengthNm * 1e-9;
  const orders: { order: number; angleDeg: number; wavelengthNm: number }[] = [];

  for (let m = -maxOrder; m <= maxOrder; m++) {
    const sinTheta = m * wavelengthM / gratingPeriodM;
    if (Math.abs(sinTheta) <= 1) {
      orders.push({
        order: m,
        angleDeg: (Math.asin(sinTheta) * 180) / Math.PI,
        wavelengthNm,
      });
    }
  }
  return orders;
}

// Angular dispersion: dθ/dλ = m / (d·cos(θ))
export function computeAngularDispersion(
  gratingPeriodM: number,
  wavelengthNm: number,
  order: number
): number { // rad/nm
  const wavelengthM = wavelengthNm * 1e-9;
  const sinTheta = order * wavelengthM / gratingPeriodM;
  if (Math.abs(sinTheta) >= 1) return 0;
  const cosTheta = Math.sqrt(1 - sinTheta * sinTheta);
  return order / (gratingPeriodM * cosTheta) * 1e-9; // convert to per nm
}

// Resolving power: R = m·N
export function computeResolvingPower(order: number, numSlits: number): number {
  return order * numSlits;
}
