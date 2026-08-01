"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Line } from "@react-three/drei";
import * as THREE from "three";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useIsMobile } from "@/hooks/use-mobile";
import { ControlPanel, MobilePanelToggle } from "./shared/ControlPanel";
import { blitImageData } from "@/lib/utils";

/* ═══════════════════════════════════════════════════════════════
   BESSEL FUNCTIONS — Numerical Implementations
   ═══════════════════════════════════════════════════════════════ */

/** Gamma function approximation (Stirling + Lanczos) */
function gammaFn(z: number): number {
  if (z < 0.5) {
    return Math.PI / (Math.sin(Math.PI * z) * gammaFn(1 - z));
  }
  z -= 1;
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
}

/** Bessel function of the first kind J_n(x) via series expansion */
function besselJ(n: number, x: number): number {
  if (x === 0) return n === 0 ? 1 : 0;
  const absX = Math.abs(x);
  if (absX > 50) {
    // Asymptotic expansion for large x
    const phase = absX - (0.5 * n + 0.25) * Math.PI;
    const amp = Math.sqrt(2 / (Math.PI * absX));
    const mu = 4 * n * n;
    const x2 = absX * absX;
    const p1 = 1 - mu / (8 * x2);
    return (x >= 0 ? 1 : (n % 2 === 0 ? 1 : -1)) * amp * p1 * Math.cos(phase);
  }
  // Series: J_n(x) = sum_{k=0}^{inf} (-1)^k / (k! Gamma(n+k+1)) * (x/2)^{n+2k}
  let sum = 0;
  let term = Math.pow(x / 2, n) / gammaFn(n + 1);
  for (let k = 0; k < 100; k++) {
    if (k > 0) {
      term *= -1 / (k * (n + k)) * (x / 2) * (x / 2);
    }
    sum += term;
    if (Math.abs(term) < 1e-15 * Math.abs(sum + 1e-300)) break;
  }
  return sum;
}

/** Modified Bessel function of the second kind K_n(x) via polynomial approximation */
function besselK(n: number, x: number): number {
  if (x <= 0) return 1e30;
  if (x < 2) {
    // Use relation K_n(x) = pi/2 * (I_{-n}(x) - I_n(x)) / sin(n*pi)
    // For integer n, use limit. Instead, use small-x approximation
    if (n === 0) {
      // K_0(x) ≈ -ln(x/2) - gamma  for small x
      const eulerGamma = 0.5772156649015329;
      return -Math.log(x / 2) - eulerGamma;
    }
    // K_n(x) ≈ Gamma(n)/2 * (2/x)^n for small x, n>0
    return gammaFn(n) / 2 * Math.pow(2 / x, n);
  }
  // Polynomial approximation for x >= 2 (Abramowitz & Stegun 9.7)
  if (n === 0) {
    const t = 2 / x;
    const p = [
      1, -0.5758165, -4.5099303e-2, 2.5749856e-3, -3.2997686e-5,
    ];
    const q = [
      1, 0.2678658, 2.9440405e-2, 1.8265902e-3, 5.7988321e-5,
    ];
    let pp = p[0], qq = q[0];
    for (let i = 1; i < p.length; i++) { pp = pp * t + p[i]; qq = qq * t + q[i]; }
    return Math.sqrt(Math.PI / (2 * x)) * Math.exp(-x) * pp / qq;
  }
  if (n === 1) {
    const t = 2 / x;
    const p = [
      1, 0.49006057, -3.5589481e-2, 2.7063469e-3, -4.3546955e-5,
    ];
    const q = [
      1, 0.7239583, 7.0626246e-2, 3.8259876e-3, 1.0668586e-4,
    ];
    let pp = p[0], qq = q[0];
    for (let i = 1; i < p.length; i++) { pp = pp * t + p[i]; qq = qq * t + q[i]; }
    return Math.sqrt(Math.PI / (2 * x)) * Math.exp(-x) * pp / qq;
  }
  // K_n for n >= 2: recurrence K_{n+1}(x) = (2n/x)*K_n(x) + K_{n-1}(x)
  let k0 = besselK(n - 2, x);
  let k1 = besselK(n - 1, x);
  for (let i = n - 1; i < n; i++) {
    const k2 = (2 * i / x) * k1 + k0;
    k0 = k1;
    k1 = k2;
  }
  return k1;
}

/** Find zeros of J_n(x) by bisection */
function findZerosOfJn(n: number, count: number): number[] {
  const zeros: number[] = [];
  let x = 0.01;
  const step = 0.1;
  let prevVal = besselJ(n, x);
  while (zeros.length < count && x < 200) {
    x += step;
    const val = besselJ(n, x);
    if (prevVal * val < 0) {
      // Bisect
      let lo = x - step, hi = x;
      for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (besselJ(n, mid) * besselJ(n, lo) < 0) hi = mid;
        else lo = mid;
      }
      zeros.push((lo + hi) / 2);
    }
    prevVal = val;
  }
  return zeros;
}

/* ═══════════════════════════════════════════════════════════════
   FIBER MODE PHYSICS
   ═══════════════════════════════════════════════════════════════ */

interface FiberParams {
  coreRadius: number; // μm
  n1: number; // core refractive index
  n2: number; // cladding refractive index
  wavelength: number; // nm
}

interface LPMode {
  l: number; // azimuthal order
  m: number; // radial order
  cutoffV: number; // cutoff V-number
  u: number; // transverse wavenumber in core
  w: number; // decay constant in cladding
  beta: number; // propagation constant
  neff: number; // effective index
}

/** Compute numerical aperture */
function computeNA(n1: number, n2: number): number {
  return Math.sqrt(n1 * n1 - n2 * n2);
}

/** Actually: V = (2π·a/λ)·NA. If a is in μm and λ is in nm:
    a/λ = a(μm) / λ(nm) = a·10⁻⁶ / (λ·10⁻⁹) = (a/λ)·10³
    So V = 2π·(a/λ)·10³·NA = 2π·a·NA·1000/λ
*/
function computeVNumber(a_um: number, lambda_nm: number, NA: number): number {
  return (2 * Math.PI * a_um * 1000 * NA) / lambda_nm;
}

/** Compute cutoff V-numbers for LP_lm modes.
    LP01 has no cutoff (V_cutoff = 0)
    LP0m (m>=2): V_cutoff = (m-1)-th zero of J_1
    LP1m (l>=1): V_cutoff = m-th zero of J_{l-1}
*/
function computeCutoffV(l: number, m: number): number {
  if (l === 0 && m === 1) return 0; // Fundamental mode has no cutoff
  if (l === 0) {
    // LP0m (m>=2): cutoff at j_{1,m-1}
    const zeros = findZerosOfJn(1, m - 1);
    return zeros[m - 2] || 999;
  } else {
    // LP1m (l>=1): cutoff at j_{l-1,m}
    const zeros = findZerosOfJn(l - 1, m);
    return zeros[m - 1] || 999;
  }
}

/** Find all guided LP modes for given V-number */
function findGuidedModes(V: number): LPMode[] {
  if (V <= 0) return [];
  const modes: LPMode[] = [];
  // Only consider modes with cutoff V <= current V
  for (let l = 0; l <= 10; l++) {
    for (let m = 1; m <= 10; m++) {
      const cutoffV = computeCutoffV(l, m);
      if (cutoffV > V) break;
      // Find u and w by solving the characteristic equation
      const mode = solveModeEquation(l, m, V, cutoffV);
      if (mode) modes.push(mode);
    }
    // If even the first mode of this l isn't guided, stop
    if (computeCutoffV(l, 1) > V && l > 2) break;
  }
  return modes;
}

/** Solve the eigenvalue equation for LP_lm mode using bisection on u */
function solveModeEquation(l: number, m: number, V: number, cutoffV: number): LPMode | null {
  // u ranges from just above the (m-1)-th zero of J_l to just below the m-th zero
  // Actually for LP_lm: u is between the (m-1)th and mth zero of J_l
  // At cutoff: u = V_cutoff, w = 0
  // Far from cutoff: u → (m-th zero of J_l), w = sqrt(V² - u²) → 0 ... no.
  // Actually: u goes from cutoffV (at cutoff where w→0) down toward... 
  // Let me reconsider. The eigenvalue equation is:
  //   u · J_{l-1}(u) / J_l(u) = -w · K_{l-1}(w) / K_l(w)   for l ≥ 1
  //   -u · J_1(u) / J_0(u) = w · K_1(w) / K_0(w)            for l = 0
  // 
  // At cutoff: w = 0, u = V_cutoff
  // As V increases: u stays between (m-1)th and mth zero of J_l
  // Wait, u is bounded by the m-th zero of J_l for the m-th mode.
  // Actually: for LP_lm, u is between the (m-1)th zero of J_l and V
  // No, u ∈ (j_{l,m-1}, j_{l,m}) where j_{l,0} = 0

  const zerosJl = findZerosOfJn(l, m + 1);
  const uLow = m === 1 ? 0.001 : (zerosJl[m - 2] || 0) + 0.001;
  const uHigh = Math.min(zerosJl[m - 1] || V, V - 0.001);

  if (uLow >= uHigh || uHigh <= 0) return null;

  // Bisect: find u where both sides of the eigenvalue equation match
  // Left side: f_l(u) = u · J_{l±1}(u) / J_l(u)
  // Right side: g_l(w) = ±w · K_{l±1}(w) / K_l(w)  with w = sqrt(V²-u²)

  function lhs(u: number): number {
    const Jl = besselJ(l, u);
    if (Math.abs(Jl) < 1e-15) return 1e10;
    if (l === 0) {
      return -u * besselJ(1, u) / Jl;
    }
    return u * besselJ(l - 1, u) / Jl;
  }

  function rhs(w: number): number {
    if (w < 1e-10) return 0;
    const Kl = besselK(l, w);
    if (Math.abs(Kl) < 1e-30) return 1e10;
    if (l === 0) {
      return w * besselK(1, w) / Kl;
    }
    return -w * besselK(l - 1, w) / Kl;
  }

  // Evaluate the mismatch at boundaries
  const wHigh = Math.sqrt(Math.max(0, V * V - uLow * uLow));
  const wLow = Math.sqrt(Math.max(0, V * V - uHigh * uHigh));
  
  const fLow = lhs(uLow) - rhs(wHigh);
  const fHigh = lhs(uHigh) - rhs(wLow);

  if (fLow * fHigh > 0) {
    // Try a simple approach: use bisection on u
    // Sometimes the sign convention needs adjustment
  }

  // Bisection search
  let lo = uLow, hi = uHigh;
  const evalFunc = (u: number) => {
    const w = Math.sqrt(Math.max(0, V * V - u * u));
    return lhs(u) - rhs(w);
  };

  let fLo = evalFunc(lo);
  let fHi = evalFunc(hi);

  if (fLo * fHi > 0) {
    // Fallback: use approximate formula
    // u ≈ j_{l,m} * (1 - something) ... just use cutoff as approximation
    const uApprox = cutoffV * (1 - 0.1 * (V - cutoffV) / V);
    if (uApprox > 0 && uApprox < V) {
      const wApprox = Math.sqrt(Math.max(0, V * V - uApprox * uApprox));
      const k0 = 2 * Math.PI / 1; // normalized
      const beta = Math.sqrt(uApprox * uApprox / ((V / (2 * Math.PI)) ** 2) + 1); // placeholder
      return {
        l, m, cutoffV,
        u: uApprox, w: wApprox,
        beta: 0, neff: 0,
      };
    }
    return null;
  }

  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const fMid = evalFunc(mid);
    if (fLo * fMid < 0) { hi = mid; fHi = fMid; }
    else { lo = mid; fLo = fMid; }
  }

  const u = (lo + hi) / 2;
  const w = Math.sqrt(Math.max(0, V * V - u * u));
  
  return {
    l, m, cutoffV,
    u, w,
    beta: 0, neff: 0, // will be computed with actual params
  };
}

/** Compute mode field R(r) at given radial position */
function computeModeField(r_norm: number, l: number, u: number, w: number): number {
  // r_norm = r/a (normalized radius)
  if (r_norm <= 1) {
    // Core: R(r) = J_l(u·r/a) / J_l(u)
    const denom = besselJ(l, u);
    if (Math.abs(denom) < 1e-30) return 0;
    return besselJ(l, u * r_norm) / denom;
  } else {
    // Cladding: R(r) = K_l(w·r/a) / K_l(w)
    const denom = besselK(l, w);
    if (Math.abs(denom) < 1e-30 || w < 1e-10) return 0;
    return besselK(l, w * r_norm) / denom;
  }
}

/* ═══════════════════════════════════════════════════════════════
   WAVELENGTH TO COLOR
   ═══════════════════════════════════════════════════════════════ */

function wavelengthToRGB(wl: number): string {
  let r = 0, g = 0, b = 0;
  if (wl >= 380 && wl < 440) {
    r = -(wl - 440) / (440 - 380); g = 0; b = 1;
  } else if (wl >= 440 && wl < 490) {
    r = 0; g = (wl - 440) / (490 - 440); b = 1;
  } else if (wl >= 490 && wl < 510) {
    r = 0; g = 1; b = -(wl - 510) / (510 - 490);
  } else if (wl >= 510 && wl < 580) {
    r = (wl - 510) / (580 - 510); g = 1; b = 0;
  } else if (wl >= 580 && wl < 645) {
    r = 1; g = -(wl - 645) / (645 - 580); b = 0;
  } else if (wl >= 645 && wl <= 780) {
    r = 1; g = 0; b = 0;
  }
  // Intensity falloff at edges
  let factor = 1;
  if (wl >= 380 && wl < 420) factor = 0.3 + 0.7 * (wl - 380) / 40;
  else if (wl > 700 && wl <= 780) factor = 0.3 + 0.7 * (780 - wl) / 80;
  else if (wl < 380 || wl > 780) factor = 0;
  r = Math.round(Math.max(0, Math.min(255, r * factor * 255)));
  g = Math.round(Math.max(0, Math.min(255, g * factor * 255)));
  b = Math.round(Math.max(0, Math.min(255, b * factor * 255)));
  return `rgb(${r},${g},${b})`;
}

/* ═══════════════════════════════════════════════════════════════
   PRESETS
   ═══════════════════════════════════════════════════════════════ */

const PRESETS = {
  smf28: { label: "SMF-28", a: 4.1, n1: 1.4682, n2: 1.4629, lambda: 1310 },
  mm50: { label: "多模 50/125", a: 25, n1: 1.48, n2: 1.46, lambda: 850 },
  mm625: { label: "多模 62.5/125", a: 31.25, n1: 1.49, n2: 1.47, lambda: 850 },
  custom: { label: "自定义", a: 25, n1: 1.46, n2: 1.45, lambda: 632.8 },
};

type PresetKey = keyof typeof PRESETS;

/* ═══════════════════════════════════════════════════════════════
   EXPERIMENT MODES
   ═══════════════════════════════════════════════════════════════ */

type ExpMode = "basic" | "multimode" | "dispersion" | "coupling" | "bending";

const EXP_MODE_LABELS: Record<ExpMode, string> = {
  basic: "基本模式",
  multimode: "多模分析",
  dispersion: "色散特性",
  coupling: "耦合效率",
  bending: "弯曲损耗",
};

/* ═══════════════════════════════════════════════════════════════
   3D MODE FIELD SURFACE
   ═══════════════════════════════════════════════════════════════ */

function ModeFieldSurface3D({ l, u, w, color }: {
  l: number; u: number; w: number; color: string;
}) {
  const gridSize = 40;
  const extent = 3; // in units of core radius

  const { geometry, maxIntensity } = useMemo(() => {
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    let maxI = 0;

    // Compute intensities
    const intensities: number[][] = [];
    for (let i = 0; i <= gridSize; i++) {
      intensities[i] = [];
      for (let j = 0; j <= gridSize; j++) {
        const x = (i / gridSize - 0.5) * 2 * extent;
        const y = (j / gridSize - 0.5) * 2 * extent;
        const r = Math.sqrt(x * x + y * y);
        const phi = Math.atan2(y, x);
        const r_norm = r;
        const R = computeModeField(r_norm, l, u, w);
        const angular = l === 0 ? 1 : Math.cos(l * phi);
        const intensity = (R * angular) ** 2;
        intensities[i][j] = intensity;
        if (intensity > maxI) maxI = intensity;
      }
    }

    // Build vertices
    for (let i = 0; i <= gridSize; i++) {
      for (let j = 0; j <= gridSize; j++) {
        const x = (i / gridSize - 0.5) * 2 * extent;
        const y = (j / gridSize - 0.5) * 2 * extent;
        const intensity = intensities[i][j];
        const z = (maxI > 0 ? intensity / maxI : 0) * 1.5;
        positions.push(x, z, y);
        const t = maxI > 0 ? intensity / maxI : 0;
        // Parse color and modulate
        const parsed = new THREE.Color(color);
        colors.push(parsed.r * t, parsed.g * t, parsed.b * t);
      }
    }

    // Build indices
    for (let i = 0; i < gridSize; i++) {
      for (let j = 0; j < gridSize; j++) {
        const a = i * (gridSize + 1) + j;
        const b = a + 1;
        const c = a + (gridSize + 1);
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    return { geometry: geo, maxIntensity: maxI };
  }, [l, u, w, color, gridSize, extent]);

  // Core boundary ring
  const coreRingPoints = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 64; i++) {
      const angle = (2 * Math.PI * i) / 64;
      pts.push(new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)));
    }
    return pts;
  }, []);

  return (
    <group>
      <mesh geometry={geometry}>
        <meshStandardMaterial
          vertexColors
          side={THREE.DoubleSide}
          roughness={0.8}
          metalness={0}
        />
      </mesh>
      {/* Core boundary */}
      <Line
        points={coreRingPoints.map(p => [p.x, p.y, p.z] as [number, number, number])}
        color="#333333"
        lineWidth={1}
      />
    </group>
  );
}



/* ═══════════════════════════════════════════════════════════════
   2D MODE FIELD CANVAS
   ═══════════════════════════════════════════════════════════════ */

function ModeFieldCanvas({ l, u, w, wavelength, size = 200 }: {
  l: number; u: number; w: number; wavelength: number; size?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const cl = l, cu = u, cw = w, cwl = wavelength;
    const extent = 3; // core radii
    const imageData = ctx.createImageData(size, size);
    let maxI = 0;

    // First pass: find max intensity
    const intensities = new Float64Array(size * size);
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const x = ((px + 0.5) / size - 0.5) * 2 * extent;
        const y = ((py + 0.5) / size - 0.5) * 2 * extent;
        const r = Math.sqrt(x * x + y * y);
        const phi = Math.atan2(y, x);
        const R = computeModeField(r, cl, cu, cw);
        const angular = cl === 0 ? 1 : Math.cos(cl * phi);
        const intensity = (R * angular) ** 2;
        intensities[py * size + px] = intensity;
        if (intensity > maxI) maxI = intensity;
      }
    }

    // Get base color from wavelength
    const rgb = wavelengthToRGB(cwl);
    const match = rgb.match(/rgb\((\d+),(\d+),(\d+)\)/);
    const baseR = match ? parseInt(match[1]) : 200;
    const baseG = match ? parseInt(match[2]) : 0;
    const baseB = match ? parseInt(match[3]) : 0;

    // Second pass: color pixels
    for (let i = 0; i < size * size; i++) {
      const t = maxI > 0 ? intensities[i] / maxI : 0;
      const idx = i * 4;
      // Background white, intensity mapped to wavelength color
      imageData.data[idx] = 255 - (255 - baseR) * t;
      imageData.data[idx + 1] = 255 - (255 - baseG) * t;
      imageData.data[idx + 2] = 255 - (255 - baseB) * t;
      imageData.data[idx + 3] = 255;
    }

    blitImageData(ctx, imageData, size, size);

    // Draw core boundary circle
    ctx.strokeStyle = "#333333";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    const corePixel = (1 / extent) * size / 2;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, corePixel, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.setLineDash([]);

  }, [l, u, w, wavelength, size]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size, imageRendering: "pixelated" }}
    />
  );
}

/* ═══════════════════════════════════════════════════════════════
   UNICODE SUBSCRIPT HELPER
   ═══════════════════════════════════════════════════════════════ */

const SUBSCRIPT_DIGITS: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄',
  '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
};

function toSubscript(n: number): string {
  return String(n).split('').map(d => SUBSCRIPT_DIGITS[d] || d).join('');
}

/* ═══════════════════════════════════════════════════════════════
   FIBER CROSS-SECTION SVG
   ═══════════════════════════════════════════════════════════════ */

function FiberCrossSectionSVG({ a, n1, n2, l, m, u, w, color }: {
  a: number; n1: number; n2: number;
  l: number; m: number; u: number; w: number; color: string;
}) {
  const cx = 100, cy = 100, rClad = 80;
  const safeA = a > 0 ? a : 1; // Guard against a=0 causing NaN
  const rCore = rClad * (safeA / (safeA * 1.5)); // Scale: assume cladding is 1.5× core radius visually

  // Mode field extent (1/e² radius)
  const modeExtent = w > 0.1 ? (rCore / safeA) * (u > 0 ? (2.405 / u) * 1.5 : 1) : rCore * 1.2;
  const rMode = isFinite(modeExtent) ? Math.min(rCore * 2, modeExtent) : rCore;

  return (
    <svg width="200" height="200" viewBox="0 0 200 200" className="svg-responsive" style={{ maxWidth: "100%" }}>
      {/* Cladding */}
      <circle cx={cx} cy={cy} r={rClad} fill="none" stroke="#333333" strokeWidth="1.5" />
      <text x={cx} y={cy - rClad + 12} textAnchor="middle" fontSize="8" fill="#888888"
        fontFamily="system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif">
        n₂={n2.toFixed(4)}
      </text>
      {/* Core */}
      <circle cx={cx} cy={cy} r={rCore} fill={color} fillOpacity="0.08" stroke="#333333" strokeWidth="1" />
      <text x={cx} y={cy + 4} textAnchor="middle" fontSize="8" fill="#333333"
        fontFamily="system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif">
        n₁={n1.toFixed(4)}
      </text>
      {/* Mode field extent */}
      <circle cx={cx} cy={cy} r={Math.min(rMode, rClad - 2)} fill="none" stroke={color}
        strokeWidth="0.8" strokeDasharray="4,3" opacity="0.6" />
      {/* Core radius label */}
      <line x1={cx} y1={cy} x2={cx + rCore} y2={cy} stroke="#333333" strokeWidth="0.5" />
      <text x={cx + rCore / 2} y={cy - 4} textAnchor="middle" fontSize="7" fill="#555555"
        fontFamily="system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif">
        a={a}μm
      </text>
      {/* LP mode label */}
      <text x={cx} y={cy + rClad + 14} textAnchor="middle" fontSize="9" fill="#333333"
        fontFamily="system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif" fontWeight="600">
        LP{toSubscript(l)}{toSubscript(m)}
      </text>
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SIDE-VIEW BEAM PROPAGATION SVG
   ═══════════════════════════════════════════════════════════════ */

function FiberSideViewSVG({ n1, n2, a, NA, wavelength, color }: {
  n1: number; n2: number; a: number; NA: number; wavelength: number; color: string;
}) {
  const W = 280, H = 120;
  const cladY1 = 15, cladY2 = 105; // cladding boundaries
  const coreHalf = (cladY2 - cladY1) * 0.25; // core visual half-height
  const coreCenter = (cladY1 + cladY2) / 2;
  const coreY1 = coreCenter - coreHalf;
  const coreY2 = coreCenter + coreHalf;

  // Critical angle: θc = arcsin(n2/n1)
  const thetaC = Math.asin(Math.min(n2 / n1, 1));
  const thetaCDeg = (thetaC * 180 / Math.PI);

  // Ray angle from axis (depends on NA: acceptance angle θa = arcsin(NA))
  const thetaA = Math.asin(Math.min(NA, 1));
  // Ray angle inside fiber from normal: θ = 90° - θa (from axis)
  // For visualization: zigzag angle relative to fiber axis
  const rayAngle = Math.min(thetaA, Math.PI / 2 * 0.8);
  const zigzagDx = coreHalf / Math.tan(rayAngle + 0.01); // horizontal distance per half-zigzag

  // Build zigzag ray path
  const rayPath: string[] = [];
  let x = 20;
  let goingUp = true;
  rayPath.push(`M${x},${coreY2}`);
  while (x < W - 20) {
    const nextX = x + zigzagDx;
    const nextY = goingUp ? coreY1 : coreY2;
    rayPath.push(`L${Math.min(nextX, W - 20)},${nextY}`);
    x = nextX;
    goingUp = !goingUp;
  }

  // Critical angle arc at first reflection point
  const arcCx = 20 + zigzagDx; // first bounce x
  const arcCy = coreY1; // top core boundary
  const arcR = 20;

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="svg-responsive" style={{ maxWidth: "100%" }}>
      {/* Cladding fill */}
      <rect x="0" y={cladY1} width={W} height={cladY2 - cladY1}
        fill="#f0f3f6" stroke="none" />
      {/* Cladding boundaries */}
      <line x1="0" y1={cladY1} x2={W} y2={cladY1} stroke="#333333" strokeWidth="1.5" />
      <line x1="0" y1={cladY2} x2={W} y2={cladY2} stroke="#333333" strokeWidth="1.5" />
      {/* Core boundaries */}
      <line x1="0" y1={coreY1} x2={W} y2={coreY1} stroke="#333333" strokeWidth="0.8" strokeDasharray="4,2" />
      <line x1="0" y1={coreY2} x2={W} y2={coreY2} stroke="#333333" strokeWidth="0.8" strokeDasharray="4,2" />
      {/* Core fill */}
      <rect x="0" y={coreY1} width={W} height={coreY2 - coreY1}
        fill={color} fillOpacity="0.05" stroke="none" />

      {/* Zigzag ray (total internal reflection) */}
      <path d={rayPath.join(" ")} fill="none" stroke={color} strokeWidth="1.5" opacity="0.8" />

      {/* Labels: n₁ and n₂ */}
      <text x={W - 5} y={coreCenter + 3} textAnchor="end" fontSize="9" fill="#333333" fontWeight="600"
        fontFamily="system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif">n₁</text>
      <text x={W - 5} y={cladY1 + 10} textAnchor="end" fontSize="8" fill="#888888"
        fontFamily="system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif">n₂</text>
      <text x={W - 5} y={cladY2 - 4} textAnchor="end" fontSize="8" fill="#888888"
        fontFamily="system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif">n₂</text>

      {/* Critical angle arc */}
      {arcCx < W - 30 && (
        <>
          <path
            d={`M${arcCx},${arcCy} L${arcCx + arcR},${arcCy} A${arcR},${arcR} 0 0,1 ${arcCx + arcR * Math.cos(thetaC)},${arcCy + arcR * Math.sin(thetaC)}`}
            fill="none" stroke="#888888" strokeWidth="0.8"
          />
          <text x={arcCx + arcR + 2} y={arcCy + 10} fontSize="7" fill="#888888"
            fontFamily="system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif">
            θc={thetaCDeg.toFixed(1)}°
          </text>
        </>
      )}

      {/* Propagation arrow */}
      <line x1="10" y1={coreCenter} x2={W - 10} y2={coreCenter}
        stroke="#cccccc" strokeWidth="0.5" strokeDasharray="2,4" />
      <text x={W / 2} y={H - 2} textAnchor="middle" fontSize="7" fill="#6b7280"
        fontFamily="system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif">
        光纤侧视图 · 全内反射
      </text>
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════════
   DISPERSION CURVE SVG
   ═══════════════════════════════════════════════════════════════ */

/** Compute effective index from mode eigenvalue u and fiber params.
 *  β = sqrt(k0²·n1² - u²/a²), neff = β/k0
 */
function computeNeffFromU(u: number, a_um: number, wl_nm: number, n1: number): number {
  const k0 = (2 * Math.PI) / (wl_nm * 1e-9);
  const a_m = a_um * 1e-6;
  const beta2 = k0 * k0 * n1 * n1 - (u / a_m) ** 2;
  if (beta2 <= 0) return 0;
  return Math.sqrt(beta2) / k0;
}

/** Smooth approximation for normalized propagation constant b(V) of LP01.
 *  b(V) = (neff - n2)/(n1 - n2), ranges from 0 (at cutoff) to ~1 (far from cutoff)
 *  Uses a smooth polynomial fit that avoids the discontinuity at V=2.405
 */
function normalizedPropConstB(V: number): number {
  if (V <= 0) return 0;
  // For large V: b → 1 - u0²/V² (far from cutoff)
  if (V > 20) return Math.min(1, 1 - (2.405 * 2.405) / (V * V));
  // Smooth polynomial approximation (Jung 1987, modified):
  // b(V) ≈ (1.1428 - 0.9960/V)² for V ≥ ~1.5 (step-index fiber)
  // This gives b(2.405) ≈ (1.1428 - 0.4145)² = 0.7283² ≈ 0.530
  if (V >= 1.0) {
    const b = Math.pow(1.1428 - 0.9960 / V, 2);
    return Math.max(0, Math.min(1, b));
  }
  // For V < 1 (very weakly guided): linear ramp to 0
  return V * V * 0.1;
}

function DispersionCurveSVG({ coreRadius, n1, n2, wavelength }: FiberParams) {
  const a = coreRadius; // alias for brevity
  const W = 280, H = 160;
  const pad = { l: 35, r: 10, t: 10, b: 25 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;

  // Compute n_eff vs wavelength using smooth analytical approximation
  const points = useMemo(() => {
    if (!a || a <= 0 || n1 <= n2) return [];
    const pts: { wl: number; neff: number }[] = [];
    const na = computeNA(n1, n2);
    for (let wl = 400; wl <= 1600; wl += 20) {
      const V = computeVNumber(a, wl, na);
      if (V < 0.5) continue;
      // Smooth neff: neff = n2 + b(V)·(n1-n2)
      const b = normalizedPropConstB(V);
      const neff = n2 + b * (n1 - n2);
      if (isFinite(neff) && neff >= n2 - 0.001 && neff <= n1 + 0.001) {
        pts.push({ wl, neff });
      }
    }
    return pts;
  }, [a, n1, n2]);

  const neffMin = (n2 || 1.46) - 0.005;
  const neffMax = (n1 || 1.48) + 0.005;
  const neffRange = Math.max(0.001, neffMax - neffMin);

  const toX = (wl: number) => pad.l + ((wl - 400) / 1200) * plotW;
  const toY = (neff: number) => {
    if (!isFinite(neff) || neffRange <= 0) return pad.t + plotH / 2;
    return pad.t + (1 - (neff - neffMin) / neffRange) * plotH;
  };

  const pathD = points
    .filter(p => isFinite(p.neff))
    .map((p, i) =>
      `${i === 0 ? "M" : "L"}${toX(p.wl).toFixed(1)},${toY(p.neff).toFixed(1)}`
    ).join(" ");

  // Current wavelength marker (also use analytical approximation for smoothness)
  const safeWavelength = (isFinite(wavelength) && wavelength >= 400 && wavelength <= 1600) ? wavelength : 850;
  const currentX = toX(safeWavelength);
  const currentNA = a > 0 ? computeNA(n1, n2) : 0;
  const currentV = (a > 0 && isFinite(currentNA)) ? computeVNumber(a, safeWavelength, currentNA) : 0;
  let currentNeff = n1 || 1.48;
  if (isFinite(currentV) && currentV >= 0.5) {
    const b = normalizedPropConstB(currentV);
    const neff = (n2 || 1.46) + b * ((n1 || 1.48) - (n2 || 1.46));
    if (isFinite(neff) && neff >= (n2 || 1.46)) currentNeff = neff;
  }
  if (!isFinite(currentNeff)) currentNeff = (n2 + n1) / 2 || 1.47;
  const currentY = toY(currentNeff);
  const safeCx = isFinite(currentX) ? currentX : pad.l;
  const safeCy = isFinite(currentY) ? currentY : pad.t + plotH / 2;

  // Final NaN fallbacks for cx/cy to satisfy type-checkers and React DOM (mobile-safe)
  const finalCx = Number.isFinite(safeCx) ? safeCx : pad.l;
  const finalCy = Number.isFinite(safeCy) ? safeCy : pad.t + plotH / 2;
  const finalN1Y = Number.isFinite(toY(n1)) ? toY(n1) : pad.t + plotH / 2;
  const finalN2Y = Number.isFinite(toY(n2)) ? toY(n2) : pad.t + plotH / 2;

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="svg-responsive" style={{ maxWidth: "100%" }}>
      {/* Axes */}
      <line x1={pad.l} y1={pad.t} x2={pad.l} y2={pad.t + plotH} stroke="#333333" strokeWidth="1" />
      <line x1={pad.l} y1={pad.t + plotH} x2={pad.l + plotW} y2={pad.t + plotH} stroke="#333333" strokeWidth="1" />
      {/* Axis labels */}
      <text x={pad.l + plotW / 2} y={H - 2} textAnchor="middle" fontSize="8" fill="#6b7280"
        fontFamily="system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif">λ (nm)</text>
      <text x={4} y={pad.t + plotH / 2} textAnchor="middle" fontSize="8" fill="#6b7280"
        fontFamily="system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif"
        transform={`rotate(-90,4,${pad.t + plotH / 2})`}>n_eff</text>
      {/* n1 and n2 reference lines */}
      <line x1={pad.l} y1={finalN1Y} x2={pad.l + plotW} y2={finalN1Y}
        stroke="#cccccc" strokeWidth="0.5" strokeDasharray="3,3" />
      <text x={pad.l - 3} y={finalN1Y + 3} textAnchor="end" fontSize="7" fill="#888888">n₁</text>
      <line x1={pad.l} y1={finalN2Y} x2={pad.l + plotW} y2={finalN2Y}
        stroke="#cccccc" strokeWidth="0.5" strokeDasharray="3,3" />
      <text x={pad.l - 3} y={finalN2Y + 3} textAnchor="end" fontSize="7" fill="#888888">n₂</text>
      {/* Curve */}
      {pathD && <path d={pathD} fill="none" stroke="#CC0000" strokeWidth="1.5" />}
      {/* Current wavelength marker */}
      <circle cx={finalCx} cy={finalCy} r="3" fill="#CC0000" stroke="#FFFFFF" strokeWidth="1" />
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════════
   COUPLING DIAGRAM SVG
   ═══════════════════════════════════════════════════════════════ */

function CouplingDiagramSVG({ offset, tilt, color, mfdRadius }: {
  offset: number; tilt: number; color: string; mfdRadius: number;
}) {
  const fiberCx = 210, fiberCy = 70;
  const coreR = 15;

  // Gaussian bell curve path at beam source
  const gaussX = 30, gaussW = 45, gaussH = 45;
  const gaussPoints: string[] = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    const x = gaussX + t * gaussW;
    const yNorm = (t - 0.5) * 2; // -1 to 1
    const gaussVal = Math.exp(-2 * yNorm * yNorm); // Gaussian profile
    const y = fiberCy - gaussVal * gaussH / 2;
    gaussPoints.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`);
  }
  // Mirror for bottom
  for (let i = 40; i >= 0; i--) {
    const t = i / 40;
    const x = gaussX + t * gaussW;
    const yNorm = (t - 0.5) * 2;
    const gaussVal = Math.exp(-2 * yNorm * yNorm);
    const y = fiberCy + gaussVal * gaussH / 2;
    gaussPoints.push(`L${x.toFixed(1)},${y.toFixed(1)}`);
  }
  gaussPoints.push('Z');

  return (
    <svg width="280" height="160" viewBox="0 0 280 160" className="svg-responsive" style={{ maxWidth: "100%" }}>
      {/* Fiber end face (circle) — cladding */}
      <ellipse cx={fiberCx} cy={fiberCy} rx="40" ry="40" fill="none" stroke="#333333" strokeWidth="1.5" />
      {/* Core circle */}
      <ellipse cx={fiberCx} cy={fiberCy} rx={coreR} ry={coreR} fill={color} fillOpacity="0.1" stroke="#333333" strokeWidth="0.8" />
      {/* 1/e² mode field concentric circles (dotted) */}
      <ellipse cx={fiberCx} cy={fiberCy} rx={Math.min(mfdRadius, 38)} ry={Math.min(mfdRadius, 38)}
        fill="none" stroke={color} strokeWidth="0.6" strokeDasharray="2,2" opacity="0.5" />
      <ellipse cx={fiberCx} cy={fiberCy} rx={Math.min(mfdRadius * 1.5, 38)} ry={Math.min(mfdRadius * 1.5, 38)}
        fill="none" stroke={color} strokeWidth="0.4" strokeDasharray="1,3" opacity="0.3" />
      <text x={fiberCx} y={fiberCy + 55} textAnchor="middle" fontSize="8" fill="#6b7280"
        fontFamily="system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif">光纤端面</text>
      {/* 1/e² label */}
      <text x={fiberCx + Math.min(mfdRadius, 38) + 2} y={fiberCy - 2} fontSize="6" fill="#888888"
        fontFamily="system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif">1/e²</text>

      {/* Gaussian beam source — bell curve shape */}
      <path d={gaussPoints.join(" ")} fill={color} fillOpacity="0.06" stroke="#333333" strokeWidth="0.8" />
      <text x={gaussX + gaussW / 2} y={fiberCy + gaussH / 2 + 14} textAnchor="middle" fontSize="8" fill="#6b7280"
        fontFamily="system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif">高斯光束</text>

      {/* Beam path */}
      {tilt === 0 ? (
        <line x1={gaussX + gaussW} y1={fiberCy} x2={fiberCx - 42} y2={fiberCy + offset * 2} stroke={color} strokeWidth="2" />
      ) : (
        <line x1={gaussX + gaussW} y1={fiberCy} x2={fiberCx - 42} y2={fiberCy + offset * 2 - tilt * 0.5} stroke={color} strokeWidth="2" />
      )}

      {/* Offset arrow annotation */}
      {offset !== 0 && (
        <>
          <line x1={fiberCx - 42} y1={fiberCy} x2={fiberCx - 42} y2={fiberCy + offset * 2}
            stroke="#888888" strokeWidth="0.5" strokeDasharray="2,2" />
          {/* Arrow tip */}
          <polygon
            points={`0,-3 4,0 0,3`}
            fill="#888888"
            transform={`translate(${fiberCx - 42},${fiberCy + offset}) rotate(${offset > 0 ? 90 : -90})`}
          />
          <text x={fiberCx - 37} y={fiberCy + offset} fontSize="7" fill="#888888"
            fontFamily="system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif">
            d={offset > 0 ? "+" : ""}{(offset * 0.5).toFixed(1)}μm
          </text>
        </>
      )}

      {/* Tilt angle arrow annotation */}
      {tilt !== 0 && (
        <>
          <path d={`M${gaussX + gaussW},${fiberCy} L${gaussX + gaussW + 25},${fiberCy - tilt * 0.3}`}
            fill="none" stroke="#888888" strokeWidth="0.5" />
          <text x={gaussX + gaussW + 28} y={fiberCy - tilt * 0.15} fontSize="7" fill="#888888"
            fontFamily="system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif">
            θ={tilt.toFixed(1)}°
          </text>
        </>
      )}

      {/* Center reference */}
      <line x1={fiberCx - 42} y1={fiberCy - 5} x2={fiberCx - 42} y2={fiberCy + 5} stroke="#cccccc" strokeWidth="0.5" />
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════ */

export default function FiberModeSimulator({ onBack }: { onBack: () => void }) {
  const isMobile = useIsMobile();
  const [panelOpen, setPanelOpen] = useState(false);
  const [expMode, setExpMode] = useState<ExpMode>("basic");
  const [preset, setPreset] = useState<PresetKey>("mm50");
  const [coreRadius, setCoreRadius] = useState(25); // μm
  const [n1, setN1] = useState(1.48);
  const [n2, setN2] = useState(1.46);
  const [wavelength, setWavelength] = useState(850); // nm
  const [selectedL, setSelectedL] = useState(0);
  const [selectedM, setSelectedM] = useState(1);
  // Coupling params
  const [couplingOffset, setCouplingOffset] = useState(0); // μm
  const [couplingTilt, setCouplingTilt] = useState(0); // degrees
  // Bending params
  const [bendRadius, setBendRadius] = useState(30); // mm

  // Preset handler
  const handlePreset = useCallback((key: string) => {
    const p = PRESETS[key as PresetKey];
    if (p) {
      setPreset(key as PresetKey);
      setCoreRadius(p.a);
      setN1(p.n1);
      setN2(p.n2);
      setWavelength(p.lambda);
    }
  }, []);

  // Computed fiber parameters
  const NA = useMemo(() => computeNA(n1, n2), [n1, n2]);
  const V = useMemo(() => computeVNumber(coreRadius, wavelength, NA), [coreRadius, wavelength, NA]);
  const delta = useMemo(() => (n1 - n2) / n1, [n1, n2]);
  const totalModes = useMemo(() => Math.floor(V * V / 2), [V]);

  // Guided modes
  const guidedModes = useMemo(() => findGuidedModes(V), [V]);

  // Practical single-mode classification:
  // - Strict: V < 2.405 (no LP11 can exist)
  // - Practical: if V < ~3, check if higher-order modes have neff very close to n2
  //   (near cutoff, they're effectively non-propagating)
  const isSingleMode = useMemo(() => {
    if (V < 2.405) return true; // strict single-mode
    if (V > 3.0) return false; // clearly multimode
    // In the transition region, check if any mode beyond LP01 has neff close to n2
    const higherModes = guidedModes.filter(m => m.l > 0 || m.m > 1);
    if (higherModes.length === 0) return true;
    // If all higher modes have neff within 0.001 of n2, treat as single-mode
    const delta = n1 - n2;
    return higherModes.every(mode => {
      const modeNeff = computeNeffFromU(mode.u, coreRadius, wavelength, n1);
      return modeNeff <= 0 || (modeNeff - n2) / delta < 0.05; // less than 5% of delta above n2
    });
  }, [V, guidedModes, n1, n2, coreRadius, wavelength]);

  // Derive effective selected mode (auto-correct if invalid)
  const effectiveL = useMemo(() => {
    if (guidedModes.length === 0) return 0;
    const exists = guidedModes.find(m => m.l === selectedL && m.m === selectedM);
    return exists ? selectedL : guidedModes[0].l;
  }, [guidedModes, selectedL, selectedM]);

  const effectiveM = useMemo(() => {
    if (guidedModes.length === 0) return 1;
    const exists = guidedModes.find(m => m.l === effectiveL && m.m === selectedM);
    return exists ? selectedM : (guidedModes.find(m => m.l === effectiveL)?.m ?? 1);
  }, [guidedModes, effectiveL, selectedM]);

  // Current selected mode parameters
  const currentMode = useMemo(() => {
    const mode = guidedModes.find(m => m.l === effectiveL && m.m === effectiveM);
    if (!mode && guidedModes.length > 0) return guidedModes[0];
    return mode || null;
  }, [guidedModes, effectiveL, effectiveM]);

  // Current mode u, w
  const modeU = currentMode?.u || 2.405;
  const modeW = currentMode?.w || Math.sqrt(Math.max(0, V * V - modeU * modeU));

  // Propagation constant
  const beta = useMemo(() => {
    if (!currentMode) return 0;
    const k0 = (2 * Math.PI) / (wavelength * 1e-9);
    return Math.sqrt(k0 * k0 * n1 * n1 - (currentMode.u / (coreRadius * 1e-6)) ** 2);
  }, [currentMode, wavelength, n1, coreRadius]);

  const neff = useMemo(() => {
    if (!currentMode) return 0;
    const k0 = (2 * Math.PI) / (wavelength * 1e-9);
    return beta / k0;
  }, [currentMode, beta, wavelength]);

  // Beam color
  const beamColor = useMemo(() => wavelengthToRGB(wavelength), [wavelength]);

  // Mode Field Diameter (Marcuse approximation for fundamental mode)
  const MFD = useMemo(() => {
    if (V <= 0) return 0;
    // w₀ = a · (0.65 + 1.619/V^1.5 + 2.879/V^6)  (Marcuse)
    const w0 = coreRadius * (0.65 + 1.619 / Math.pow(V, 1.5) + 2.879 / Math.pow(V, 6));
    return 2 * w0; // MFD = 2·w₀
  }, [coreRadius, V]);

  // Critical angle θc = arcsin(n2/n1)
  const thetaC = useMemo(() => Math.asin(Math.min(n2 / n1, 1)) * 180 / Math.PI, [n1, n2]);

  // Coupling efficiency (Marcuse formula)
  const couplingEfficiency = useMemo(() => {
    const w0 = coreRadius * 0.65; // approximate mode field radius for SMF
    const d = couplingOffset;
    const theta = couplingTilt * Math.PI / 180;
    // η = exp(-(d²/w0²)) · exp(-(π·w0·θ/λ)²)
    const offsetLoss = Math.exp(-(d * d) / (w0 * w0));
    const tiltLoss = Math.exp(-Math.pow(Math.PI * w0 * 1e-6 * theta / (wavelength * 1e-9), 2));
    return offsetLoss * tiltLoss;
  }, [coreRadius, couplingOffset, couplingTilt, wavelength]);

  // Bending loss — Marcuse formula for single-mode fiber, enhanced for near-cutoff
  // For near-cutoff operation (small w), uses the modified formula with
  // effective w from Marcuse spot size for better accuracy
  const computeBendingLoss = useCallback((R_mm: number): number => {
    if (R_mm < 1 || V < 1.5) return 0;
    const a_m = coreRadius * 1e-6; // core radius in meters
    const R_m = R_mm * 1e-3; // bend radius in meters
    const u0 = 2.405;
    const wMode = Math.sqrt(Math.max(0.001, V * V - u0 * u0));

    // For near-cutoff (small w), use Marcuse spot size for effective w
    // w_eff = a·(0.65 + 1.619/V^1.5 + 2.879/V^6) — Marcuse spot size
    const wSpot = coreRadius * (0.65 + 1.619 / Math.pow(V, 1.5) + 2.879 / Math.pow(V, 6));
    // Effective w for bending calculation (use larger of mode w and spot-size-based)
    const wEff = Math.max(wMode, V * (wSpot / coreRadius) * 0.5);

    // Marcuse bending loss formula (step-index)
    // α = (√π / (2·V²)) · (u₀/w)² · (a/R)^(1/2) · exp(-2w³/(3V²·a/R))  [Np/m]
    const aOverR = a_m / R_m;
    const exponent = -2 * wEff * wEff * wEff / (3 * V * V * aOverR);
    if (exponent < -500) return 0; // negligible loss

    const coeff = (Math.sqrt(Math.PI) / (2 * V * V)) * (u0 / wEff) * (u0 / wEff) * Math.pow(aOverR, 0.5);
    const alpha_Np_per_m = coeff * Math.exp(exponent);

    // Convert Np/m to dB/m: 1 Np = 8.686 dB
    const loss_dB_per_m = alpha_Np_per_m * 8.686;
    return Math.max(0, loss_dB_per_m);
  }, [coreRadius, V]);

  const bendingLoss = useMemo(() => computeBendingLoss(bendRadius), [computeBendingLoss, bendRadius]);

  // Chromatic dispersion (material dispersion approximation)
  const chromaticDispersion = useMemo(() => {
    // D = -(λ/c) · d²n/dλ² ≈ simplified model
    // For silica: D ≈ 0 (at 1310nm zero-dispersion), positive > 1310nm
    const D = (wavelength - 1310) * 0.06; // ps/(nm·km), very simplified
    return D;
  }, [wavelength]);

  // Modal dispersion (for multimode)
  const modalDispersion = useMemo(() => {
    if (isSingleMode) return 0;
    // Δτ/L = n1·Δ/c for step-index multimode
    return (n1 * delta / 3e5) * 1e12; // ps/km
  }, [n1, delta, isSingleMode]);

  // Bandwidth-length product
  const bandwidthLength = useMemo(() => {
    if (isSingleMode) return 99999;
    return Math.round(0.5 / (modalDispersion * 1e-12) / 1000); // MHz·km
  }, [isSingleMode, modalDispersion]);

  // Mode field canvas for multimode analysis
  const modeFieldCanvasRef = useRef<HTMLCanvasElement>(null);

  // Render mode field grid for multimode
  useEffect(() => {
    if (expMode !== "multimode") return;
    const canvas = modeFieldCanvasRef.current;
    if (!canvas || guidedModes.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const cols = Math.min(6, guidedModes.length);
    const rows = Math.ceil(guidedModes.length / cols);
    const cellSize = 60;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = cols * cellSize * dpr;
    canvas.height = rows * cellSize * dpr;
    canvas.style.width = `${cols * cellSize}px`;
    canvas.style.height = `${rows * cellSize}px`;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, cols * cellSize, rows * cellSize);

    guidedModes.slice(0, 24).forEach((mode, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const ox = col * cellSize;
      const oy = row * cellSize;
      const cs = cellSize;
      const extent = 3;

      let maxI = 0;
      const intensities: number[] = [];
      const step = 2;
      for (let py = 0; py < cs; py += step) {
        for (let px = 0; px < cs; px += step) {
          const x = (px / cs - 0.5) * 2 * extent;
          const y = (py / cs - 0.5) * 2 * extent;
          const r = Math.sqrt(x * x + y * y);
          const phi = Math.atan2(y, x);
          const R = computeModeField(r, mode.l, mode.u, mode.w);
          const angular = mode.l === 0 ? 1 : Math.cos(mode.l * phi);
          const intensity = (R * angular) ** 2;
          intensities.push(intensity);
          if (intensity > maxI) maxI = intensity;
        }
      }

      let ii = 0;
      const rgb = wavelengthToRGB(wavelength);
      const match = rgb.match(/rgb\((\d+),(\d+),(\d+)\)/);
      const bR = match ? parseInt(match[1]) : 200;
      const bG = match ? parseInt(match[2]) : 0;
      const bB = match ? parseInt(match[3]) : 0;

      for (let py = 0; py < cs; py += step) {
        for (let px = 0; px < cs; px += step) {
          const t = maxI > 0 ? intensities[ii++] / maxI : 0;
          ctx.fillStyle = `rgb(${255 - (255 - bR) * t},${255 - (255 - bG) * t},${255 - (255 - bB) * t})`;
          ctx.fillRect(ox + px, oy + py, step, step);
        }
      }

      // Label
      ctx.fillStyle = "#333333";
      ctx.font = "8px system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`LP${mode.l}${mode.m}`, ox + cs / 2, oy + cs - 2);
    });
  }, [expMode, guidedModes, wavelength]);

  const FONT = "system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif";

  return (
    <div className="flex h-full flex-col" style={{ background: "#FFFFFF" }}>
      {/* Header bar */}
      <div
        className="flex flex-shrink-0 items-center"
        style={{
          height: isMobile ? "44px" : "48px",
          backgroundColor: "#FFFFFF",
          borderBottom: "1px solid #d4d8e0",
          paddingLeft: isMobile ? "16px" : "24px",
          paddingRight: isMobile ? "16px" : "24px",
        }}
      >
        <button
          onClick={onBack}
          className="flex items-center gap-1 border-none bg-none text-[12px] font-normal text-[#555555] transition-colors duration-200 hover:text-[#1a1a1a]"
          style={{ cursor: "pointer" }}
        >
          ← 返回
        </button>
        <span style={{ margin: "0 12px", color: "#D0D0D0" }}>|</span>
        <h1
          className="m-0 font-semibold text-[#1A1A1A]"
          style={{
            fontFamily: FONT,
            fontSize: isMobile ? "17px" : "20px",
          }}
        >
          阶跃光纤模式仿真器
        </h1>

        {/* Mobile-only panel toggle */}
        {isMobile && (
          <MobilePanelToggle onClick={() => setPanelOpen(true)} label="参数" />
        )}
      </div>

      {/* Main content */}
      <div className="flex flex-1" style={{ minHeight: 0 }}>
        {/* Left Control Panel — uses shared ControlPanel wrapper (inline on desktop, slide-in drawer on mobile) */}
        <ControlPanel
          open={panelOpen}
          onClose={() => setPanelOpen(false)}
          title="实验参数"
          desktopWidth="w-72"
        >
          <div className="space-y-5">
            {/* Preset */}
            <div>
              <h3
                className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[#6b7280]"
                style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}
              >
                光纤预设
              </h3>
              <Select value={preset} onValueChange={handlePreset}>
                <SelectTrigger className="h-8 text-[12px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="smf28">SMF-28 单模</SelectItem>
                  <SelectItem value="mm50">多模 50/125</SelectItem>
                  <SelectItem value="mm625">多模 62.5/125</SelectItem>
                  <SelectItem value="custom">自定义</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Fiber Parameters */}
            <div>
              <h3
                className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[#6b7280]"
                style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}
              >
                光纤参数
              </h3>

              {/* Core radius */}
              <div className="mb-4 space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-[12px] text-[#2d3142]">芯径半径 a</Label>
                  <span className="mono-digits text-[11px] text-[#6b7280]">
                    {coreRadius.toFixed(1)} μm
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[coreRadius]}
                    onValueChange={([v]) => setCoreRadius(v)}
                    min={1}
                    max={100}
                    step={0.5}
                    className="flex-1"
                  />
                  <input
                    type="number"
                    value={coreRadius}
                    onChange={e => setCoreRadius(Number(e.target.value))}
                    className="w-14 border border-[#d4d8e0] bg-white px-1 py-0.5 text-[10px] text-right tabular-nums"
                    step={0.5}
                    min={1}
                    max={100}
                  />
                </div>
              </div>

              {/* n1 */}
              <div className="mb-4 space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-[12px] text-[#2d3142]">纤芯折射率 n₁</Label>
                  <span className="mono-digits text-[11px] text-[#6b7280]">
                    {n1.toFixed(4)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[n1]}
                    onValueChange={([v]) => setN1(v)}
                    min={1.44}
                    max={1.52}
                    step={0.0001}
                    className="flex-1"
                  />
                  <input
                    type="number"
                    value={n1}
                    onChange={e => setN1(Number(e.target.value))}
                    className="w-14 border border-[#d4d8e0] bg-white px-1 py-0.5 text-[10px] text-right tabular-nums"
                    step={0.0001}
                    min={1.44}
                    max={1.52}
                  />
                </div>
              </div>

              {/* n2 */}
              <div className="mb-4 space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-[12px] text-[#2d3142]">包层折射率 n₂</Label>
                  <span className="mono-digits text-[11px] text-[#6b7280]">
                    {n2.toFixed(4)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[n2]}
                    onValueChange={([v]) => setN2(Math.min(v, n1 - 0.001))}
                    min={1.40}
                    max={1.50}
                    step={0.0001}
                    className="flex-1"
                  />
                  <input
                    type="number"
                    value={n2}
                    onChange={e => setN2(Math.min(Number(e.target.value), n1 - 0.001))}
                    className="w-14 border border-[#d4d8e0] bg-white px-1 py-0.5 text-[10px] text-right tabular-nums"
                    step={0.0001}
                    min={1.40}
                    max={1.50}
                  />
                </div>
              </div>

              {/* Wavelength */}
              <div className="mb-4 space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-[12px] text-[#2d3142]">波长 λ</Label>
                  <span className="mono-digits text-[11px] text-[#6b7280]">
                    {wavelength} nm
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[wavelength]}
                    onValueChange={([v]) => setWavelength(v)}
                    min={400}
                    max={1600}
                    step={1}
                    className="flex-1"
                  />
                  <input
                    type="number"
                    value={wavelength}
                    onChange={e => setWavelength(Number(e.target.value))}
                    className="w-14 border border-[#d4d8e0] bg-white px-1 py-0.5 text-[10px] text-right tabular-nums"
                    step={1}
                    min={400}
                    max={1600}
                  />
                </div>
                {/* Wavelength quick-select buttons */}
                <div className="flex gap-1 mt-1">
                  {[
                    { label: 'He-Ne 633', value: 633 },
                    { label: '850nm VCSEL', value: 850 },
                    { label: '1310nm', value: 1310 },
                    { label: '1550nm', value: 1550 },
                  ].map(wl => (
                    <button
                      key={wl.value}
                      onClick={() => setWavelength(wl.value)}
                      className="border border-[#d4d8e0] bg-white px-1.5 py-0.5 text-[9px] text-[#6b7280] transition-colors duration-150 hover:bg-[#f0f3f6] hover:text-[#333333]"
                      style={{ cursor: 'pointer', fontFamily: FONT }}
                    >
                      {wl.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Mode Selection (Basic & Multimode) */}
            {(expMode === "basic" || expMode === "multimode") && (
              <div className="border-t border-[#d4d8e0] pt-4">
                <h3
                  className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[#6b7280]"
                  style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}
                >
                  模式选择
                </h3>
                <div className="mb-4 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-[12px] text-[#2d3142]">方位角阶 l</Label>
                    <span className="mono-digits text-[11px] text-[#6b7280]">
                      {effectiveL}
                    </span>
                  </div>
                  <Slider
                    value={[selectedL]}
                    onValueChange={([v]) => setSelectedL(v)}
                    min={0}
                    max={guidedModes.length > 0 ? Math.max(...guidedModes.map(m => m.l), 0) : 5}
                    step={1}
                  />
                </div>
                <div className="mb-4 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-[12px] text-[#2d3142]">径向阶 m</Label>
                    <span className="mono-digits text-[11px] text-[#6b7280]">
                      {effectiveM}
                    </span>
                  </div>
                  <Slider
                    value={[selectedM]}
                    onValueChange={([v]) => setSelectedM(v)}
                    min={1}
                    max={guidedModes.filter(m => m.l === effectiveL).length > 0 ? Math.max(...guidedModes.filter(m => m.l === effectiveL).map(m => m.m), 1) : 5}
                    step={1}
                  />
                </div>
              </div>
            )}

            {/* Coupling Parameters */}
            {expMode === "coupling" && (
              <div className="border-t border-[#d4d8e0] pt-4">
                <h3
                  className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[#6b7280]"
                  style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}
                >
                  耦合参数
                </h3>
                <div className="mb-4 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-[12px] text-[#2d3142]">横向偏移</Label>
                    <span className="mono-digits text-[11px] text-[#6b7280]">
                      {couplingOffset.toFixed(1)} μm
                    </span>
                  </div>
                  <Slider
                    value={[couplingOffset]}
                    onValueChange={([v]) => setCouplingOffset(v)}
                    min={-20}
                    max={20}
                    step={0.5}
                  />
                </div>
                <div className="mb-4 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-[12px] text-[#2d3142]">倾斜角</Label>
                    <span className="mono-digits text-[11px] text-[#6b7280]">
                      {couplingTilt.toFixed(1)}°
                    </span>
                  </div>
                  <Slider
                    value={[couplingTilt]}
                    onValueChange={([v]) => setCouplingTilt(v)}
                    min={-10}
                    max={10}
                    step={0.1}
                  />
                </div>
              </div>
            )}

            {/* Bending Parameters */}
            {expMode === "bending" && (
              <div className="border-t border-[#d4d8e0] pt-4">
                <h3
                  className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[#6b7280]"
                  style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}
                >
                  弯曲参数
                </h3>
                <div className="mb-4 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-[12px] text-[#2d3142]">弯曲半径 R</Label>
                    <span className="mono-digits text-[11px] text-[#6b7280]">
                      {bendRadius.toFixed(1)} mm
                    </span>
                  </div>
                  <Slider
                    value={[bendRadius]}
                    onValueChange={([v]) => setBendRadius(v)}
                    min={1}
                    max={100}
                    step={0.5}
                  />
                </div>
              </div>
            )}

            {/* Computed Results */}
            <div className="border-t border-[#d4d8e0] pt-4">
              <h3
                className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[#6b7280]"
                style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}
              >
                计算结果
              </h3>
              <div className="space-y-2 rounded border border-[#d4d8e0] bg-white p-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-[#6b7280]">数值孔径 NA</span>
                  <span className="mono-digits text-[12px] font-medium text-[#1a1a2e]">
                    {NA.toFixed(4)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-[#6b7280]">V 数</span>
                  <span className="mono-digits text-[12px] font-medium text-[#1a1a2e]">
                    {V.toFixed(3)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-[#6b7280]">相对折射率差 Δ</span>
                  <span className="mono-digits text-[12px] font-medium text-[#1a1a2e]">
                    {(delta * 100).toFixed(3)}%
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-[#6b7280]">引导模式数</span>
                  <span className="mono-digits text-[12px] font-medium text-[#1a1a2e]">
                    {isSingleMode ? "1 (单模)" : `${guidedModes.length} (≈V²/2=${totalModes})`}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-[#6b7280]">单模条件</span>
                  <span className="mono-digits text-[12px] font-medium"
                    style={{ color: isSingleMode ? "#16a34a" : "#dc2626" }}>
                    {isSingleMode ? (V < 2.405 ? "V < 2.405 ✓" : `V=${V.toFixed(2)} ≈单模 ✓`) : "V ≥ 2.405"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-[#6b7280]">模场直径 MFD</span>
                  <span className="mono-digits text-[12px] font-medium text-[#1a1a2e]">
                    {MFD.toFixed(2)} μm
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-[#6b7280]">临界角 θc</span>
                  <span className="mono-digits text-[12px] font-medium text-[#1a1a2e]">
                    {thetaC.toFixed(2)}°
                  </span>
                </div>
                {currentMode && (
                  <>
                    <div className="border-t border-[#e8ecf0] my-1" />
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-[#6b7280]">当前模式</span>
                      <span className="mono-digits text-[12px] font-medium text-[#1a1a2e]">
                        LP{toSubscript(currentMode.l)}{toSubscript(currentMode.m)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-[#6b7280]">u</span>
                      <span className="mono-digits text-[12px] font-medium text-[#1a1a2e]">
                        {currentMode.u.toFixed(4)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-[#6b7280]">w</span>
                      <span className="mono-digits text-[12px] font-medium text-[#1a1a2e]">
                        {currentMode.w.toFixed(4)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-[#6b7280]">V_cutoff</span>
                      <span className="mono-digits text-[12px] font-medium text-[#1a1a2e]">
                        {currentMode.cutoffV.toFixed(3)}
                      </span>
                    </div>
                    {neff > 0 && (
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-[#6b7280]">n_eff</span>
                        <span className="mono-digits text-[12px] font-medium text-[#1a1a2e]">
                          {neff.toFixed(6)}
                        </span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Formula Reference Card */}
            <div className="border-t border-[#d4d8e0] pt-4">
              <h3
                className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[#6b7280]"
                style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}
              >
                公式参考
              </h3>
              <div className="space-y-1.5 rounded border border-[#d4d8e0] bg-white p-3 text-[10px] text-[#555555]"
                style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>
                <p>V = 2πa·NA/λ <span className="text-[#9ca3af]">({V.toFixed(3)})</span></p>
                <p>NA = √(n₁²−n₂²) <span className="text-[#9ca3af]">({NA.toFixed(4)})</span></p>
                <p>Δ = (n₁−n₂)/n₁ <span className="text-[#9ca3af]">({(delta * 100).toFixed(3)}%)</span></p>
                <p>θc = arcsin(n₂/n₁) <span className="text-[#9ca3af]">({thetaC.toFixed(2)}°)</span></p>
                <p className="border-t border-[#e8ecf0] pt-1 mt-1">MFD = 2·w₀</p>
                <p className="pl-2">w₀ = a·(0.65+1.619/V<sup>1.5</sup>+2.879/V<sup>6</sup>)</p>
              </div>
            </div>
          </div>
        </ControlPanel>

        {/* Right Visualization Area */}
        <div className="flex flex-1 flex-col bg-white" style={{ minHeight: 0 }}>
          {/* Mode Tabs — horizontal scroll on mobile */}
          <div
            className={isMobile
              ? "flex flex-shrink-0 items-center border-b border-[#d4d8e0] overflow-x-auto mobile-x-scroll"
              : "flex flex-shrink-0 items-center border-b border-[#d4d8e0]"}
            style={{ height: "36px", paddingLeft: "12px", gap: "2px" }}
          >
            {(Object.keys(EXP_MODE_LABELS) as ExpMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setExpMode(mode)}
                className="border-none text-[11px] font-medium transition-colors duration-150 whitespace-nowrap"
                style={{
                  padding: "4px 12px",
                  cursor: "pointer",
                  backgroundColor: expMode === mode ? "#F0F3F6" : "transparent",
                  color: expMode === mode ? "#333333" : "#6b7280",
                  borderBottom: expMode === mode ? "2px solid #333333" : "2px solid transparent",
                  fontFamily: FONT,
                }}
              >
                {EXP_MODE_LABELS[mode]}
              </button>
            ))}
          </div>

          {/* Visualization Content */}
          <div className="flex-1 overflow-y-auto p-4 custom-scrollbar" style={{ background: "#FFFFFF" }}>
            {/* ──── BASIC MODE ──── */}
            {expMode === "basic" && (
              <div className="space-y-4">
                {/* 2D + 3D mode field side by side (stack on mobile) */}
                <div className={isMobile ? "flex flex-col gap-4" : "flex gap-4 flex-wrap"}>
                  {/* 2D Mode Field */}
                  <div className="rounded border border-[#d4d8e0] p-3 bg-white">
                    <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[#6b7280] mb-2"
                      style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>
                      |Ψ|² 强度分布 (2D)
                    </h4>
                    <ModeFieldCanvas
                      l={effectiveL}
                      u={modeU}
                      w={modeW}
                      wavelength={wavelength}
                      size={200}
                    />
                  </div>

                  {/* 3D Mode Field */}
                  <div
                    className="rounded border border-[#d4d8e0]"
                    style={isMobile
                      ? { width: "100%", height: "260px" }
                      : { width: "300px", height: "250px" }}
                  >
                    <Canvas
                      camera={{ position: [3, 3, 3], fov: 45, near: 0.1, far: 100 }}
                      style={{ background: "#ffffff" }}
                      gl={{ antialias: true, alpha: false }}
                    >
                      <ambientLight intensity={0.6} />
                      <directionalLight position={[5, 5, 5]} intensity={0.3} />
                      <ModeFieldSurface3D
                        l={effectiveL} u={modeU} w={modeW} color={beamColor}
                      />
                      <OrbitControls
                        enableDamping dampingFactor={0.1}
                        rotateSpeed={0.5} zoomSpeed={0.8}
                        minDistance={2} maxDistance={15}
                      />
                    </Canvas>
                    <div className="flex items-center justify-between px-3 py-1"
                      style={{ borderTop: "1px solid #e8ecf0" }}>
                      <span className="text-[10px] text-[#9ca3af]">拖拽旋转 · 滚轮缩放</span>
                      <span className="mono-digits text-[10px] text-[#6b7280]">
                        LP{toSubscript(effectiveL)}{toSubscript(effectiveM)} · 3D
                      </span>
                    </div>
                  </div>
                </div>

                {/* Fiber Cross-Section + Side View (stack on mobile) */}
                <div className={isMobile ? "flex flex-col gap-4" : "flex gap-4 flex-wrap"}>
                  {/* Fiber Cross-Section */}
                  <div className="rounded border border-[#d4d8e0] p-3 bg-white">
                    <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[#6b7280] mb-2"
                      style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>
                      光纤截面
                    </h4>
                    <FiberCrossSectionSVG
                      a={coreRadius} n1={n1} n2={n2}
                      l={effectiveL} m={effectiveM} u={modeU} w={modeW}
                      color={beamColor}
                    />
                  </div>

                  {/* Fiber Side View */}
                  <div className="rounded border border-[#d4d8e0] p-3 bg-white">
                    <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[#6b7280] mb-2"
                      style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>
                      侧视图 · 光束传播
                    </h4>
                    <FiberSideViewSVG
                      n1={n1} n2={n2} a={coreRadius}
                      NA={NA} wavelength={wavelength} color={beamColor}
                    />
                  </div>
                </div>

                {/* Mode formula reference */}
                <div className="rounded border border-[#d4d8e0] bg-[#fafbfc] p-3">
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[#6b7280] mb-2"
                    style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>
                    模式场公式
                  </h4>
                  <div className="space-y-1 text-[11px] text-[#555555]"
                    style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>
                    <p>Ψ(r,φ) = R(r) · cos(lφ)</p>
                    <p>芯层 (r&lt;a): R(r) = J_l(u·r/a) / J_l(u)</p>
                    <p>包层 (r&gt;a): R(r) = K_l(w·r/a) / K_l(w)</p>
                    <p>u² + w² = V² = (2πa/λ)²·NA²</p>
                  </div>
                </div>
              </div>
            )}

            {/* ──── MULTIMODE ANALYSIS ──── */}
            {expMode === "multimode" && (
              <div className="space-y-4">
                {/* Mode count summary */}
                <div className="rounded border border-[#d4d8e0] bg-white p-4">
                  <div className={isMobile ? "grid grid-cols-2 gap-4" : "flex items-center gap-6"}>
                    <div>
                      <span className="text-[11px] text-[#6b7280]">V 数</span>
                      <div className="mono-digits text-[20px] font-semibold text-[#1a1a2e]">{V.toFixed(2)}</div>
                    </div>
                    <div>
                      <span className="text-[11px] text-[#6b7280]">引导模式</span>
                      <div className="mono-digits text-[20px] font-semibold text-[#1a1a2e]">{guidedModes.length}</div>
                    </div>
                    <div>
                      <span className="text-[11px] text-[#6b7280]">近似 V²/2</span>
                      <div className="mono-digits text-[20px] font-semibold text-[#6b7280]">{totalModes}</div>
                    </div>
                    <div>
                      <span className="text-[11px] text-[#6b7280]">模式类型</span>
                      <div className="text-[14px] font-semibold"
                        style={{ color: isSingleMode ? "#16a34a" : "#dc2626" }}>
                        {isSingleMode ? "单模" : "多模"}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Mode field grid */}
                {guidedModes.length > 0 && (
                  <div className="rounded border border-[#d4d8e0] p-3 bg-white">
                    <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[#6b7280] mb-2"
                      style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>
                      模式场分布 (前{Math.min(24, guidedModes.length)}个)
                    </h4>
                    <div className="overflow-x-auto mobile-x-scroll">
                      <canvas ref={modeFieldCanvasRef} style={{ maxWidth: "100%" }} />
                    </div>
                  </div>
                )}

                {/* Mode list table */}
                <div className="rounded border border-[#d4d8e0] bg-white overflow-hidden">
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[#6b7280] px-3 pt-3 pb-2"
                    style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>
                    引导模式列表
                  </h4>
                  <div className="max-h-64 overflow-y-auto custom-scrollbar">
                    <div className={isMobile ? "overflow-x-auto mobile-x-scroll" : undefined}>
                      <table className="w-full text-[11px]" style={isMobile ? { minWidth: "360px" } : undefined}>
                      <thead>
                        <tr className="border-b border-[#e8ecf0] bg-[#f8f9fb]">
                          <th className="text-left px-3 py-1.5 font-semibold text-[#6b7280]">模式</th>
                          <th className="text-right px-3 py-1.5 font-semibold text-[#6b7280]">V_cutoff</th>
                          <th className="text-right px-3 py-1.5 font-semibold text-[#6b7280]">u</th>
                          <th className="text-right px-3 py-1.5 font-semibold text-[#6b7280]">w</th>
                          <th className="text-right px-3 py-1.5 font-semibold text-[#6b7280]">简并度</th>
                        </tr>
                      </thead>
                      <tbody>
                        {guidedModes.slice(0, 30).map((mode) => (
                          <tr key={`LP${mode.l}${mode.m}`} className="border-b border-[#f0f2f5]">
                            <td className="px-3 py-1.5 font-medium text-[#1a1a2e]">LP{mode.l}{mode.m}</td>
                            <td className="px-3 py-1.5 text-right mono-digits text-[#555555]">{mode.cutoffV.toFixed(3)}</td>
                            <td className="px-3 py-1.5 text-right mono-digits text-[#555555]">{mode.u.toFixed(3)}</td>
                            <td className="px-3 py-1.5 text-right mono-digits text-[#555555]">{mode.w.toFixed(3)}</td>
                            <td className="px-3 py-1.5 text-right mono-digits text-[#555555]">{mode.l === 0 ? 1 : 2}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
                    {guidedModes.length > 30 && (
                      <div className="px-3 py-2 text-[10px] text-[#9ca3af]">
                        ... 及其他 {guidedModes.length - 30} 个模式
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ──── DISPERSION ──── */}
            {expMode === "dispersion" && (
              <div className="space-y-4">
                {/* n_eff vs λ curve */}
                <div className="rounded border border-[#d4d8e0] p-3 bg-white">
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[#6b7280] mb-2"
                    style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>
                    有效折射率 n_eff(λ)
                  </h4>
                  <DispersionCurveSVG
                    coreRadius={coreRadius} n1={n1} n2={n2} wavelength={wavelength}
                  />
                </div>

                {/* Dispersion metrics */}
                <div className="rounded border border-[#d4d8e0] bg-white p-4">
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[#6b7280] mb-3"
                    style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>
                    色散参数
                  </h4>
                  <div className={isMobile ? "grid grid-cols-1 gap-3" : "grid grid-cols-2 gap-4"}>
                    <div className="rounded border border-[#e8ecf0] p-3">
                      <span className="text-[10px] text-[#6b7280] block">模式色散</span>
                      <span className="mono-digits text-[16px] font-semibold text-[#1a1a2e]">
                        {modalDispersion.toFixed(2)}
                      </span>
                      <span className="text-[10px] text-[#6b7280]"> ps/km</span>
                    </div>
                    <div className="rounded border border-[#e8ecf0] p-3">
                      <span className="text-[10px] text-[#6b7280] block">色度色散 D</span>
                      <span className="mono-digits text-[16px] font-semibold text-[#1a1a2e]">
                        {chromaticDispersion.toFixed(2)}
                      </span>
                      <span className="text-[10px] text-[#6b7280]"> ps/(nm·km)</span>
                    </div>
                    <div className="rounded border border-[#e8ecf0] p-3">
                      <span className="text-[10px] text-[#6b7280] block">带宽长度积</span>
                      <span className="mono-digits text-[16px] font-semibold text-[#1a1a2e]">
                        {isSingleMode ? ">99" : bandwidthLength.toString()}
                      </span>
                      <span className="text-[10px] text-[#6b7280]"> MHz·km</span>
                    </div>
                    <div className="rounded border border-[#e8ecf0] p-3">
                      <span className="text-[10px] text-[#6b7280] block">模式类型</span>
                      <span className="text-[16px] font-semibold"
                        style={{ color: isSingleMode ? "#16a34a" : "#dc2626" }}>
                        {isSingleMode ? "单模" : "多模"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Group delay SVG */}
                <div className="rounded border border-[#d4d8e0] bg-white p-3">
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[#6b7280] mb-2"
                    style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>
                    模式群时延 (多模)
                  </h4>
                  {guidedModes.length > 1 ? (
                    <svg width="280" height={Math.min(120, 20 + guidedModes.length * 14)}
                      viewBox={`0 0 280 ${Math.min(120, 20 + guidedModes.length * 14)}`}
                      className="svg-responsive" style={{ maxWidth: "100%" }}>
                      {guidedModes.slice(0, 8).map((mode, idx) => {
                        const groupDelay = (n1 * delta * (1 - mode.cutoffV / V)) * 1e3;
                        const barWidth = Math.abs(groupDelay) * 500;
                        return (
                          <g key={`gd-${idx}`} transform={`translate(50, ${10 + idx * 14})`}>
                            <text x="0" y="9" fontSize="8" fill="#555555"
                              fontFamily={FONT} textAnchor="end">
                              LP{mode.l}{mode.m}
                            </text>
                            <rect x="5" y="1" width={Math.min(barWidth, 200)} height="10"
                              fill={beamColor} opacity="0.6" />
                          </g>
                        );
                      })}
                    </svg>
                  ) : (
                    <p className="text-[11px] text-[#9ca3af]">单模光纤无模式色散</p>
                  )}
                </div>
              </div>
            )}

            {/* ──── COUPLING EFFICIENCY ──── */}
            {expMode === "coupling" && (
              <div className="space-y-4">
                {/* Coupling diagram */}
                <div className="rounded border border-[#d4d8e0] p-3 bg-white">
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[#6b7280] mb-2"
                    style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>
                    耦合示意
                  </h4>
                  <CouplingDiagramSVG
                    offset={couplingOffset}
                    tilt={couplingTilt}
                    color={beamColor}
                    mfdRadius={MFD / 2 * (15 / coreRadius)}
                  />
                </div>

                {/* Efficiency display */}
                <div className="rounded border border-[#d4d8e0] bg-white p-4">
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[#6b7280] mb-3"
                    style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>
                    耦合效率
                  </h4>
                  <div className="flex items-center gap-4">
                    <div>
                      <span className="text-[10px] text-[#6b7280] block">η</span>
                      <span className="mono-digits text-[20px] font-semibold text-[#1a1a2e]">
                        {(couplingEfficiency * 100).toFixed(2)}%
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-[#6b7280] block">插入损耗</span>
                      <span className="mono-digits text-[14px] font-semibold text-[#1a1a2e]">
                        {couplingEfficiency > 0 ? (-10 * Math.log10(couplingEfficiency)).toFixed(2) : "∞"}
                      </span>
                      <span className="text-[10px] text-[#6b7280]"> dB</span>
                    </div>
                  </div>
                  {/* Efficiency bar */}
                  <div className="mt-3 h-3 w-full rounded-full bg-[#e8ecf0] overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-200 ease-out"
                      style={{
                        width: `${couplingEfficiency * 100}%`,
                        backgroundColor: couplingEfficiency > 0.8 ? "#16a34a" :
                          couplingEfficiency > 0.5 ? "#eab308" : "#dc2626",
                      }}
                    />
                  </div>
                </div>

                {/* Loss breakdown */}
                <div className="rounded border border-[#d4d8e0] bg-white p-4">
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[#6b7280] mb-3"
                    style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>
                    损耗分解
                  </h4>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-[#6b7280]">偏移损耗</span>
                      <span className="mono-digits text-[12px] text-[#1a1a2e]">
                        {couplingOffset !== 0
                          ? (-10 * Math.log10(Math.exp(-(couplingOffset ** 2) / ((coreRadius * 0.65) ** 2)))).toFixed(2)
                          : "0.00"} dB
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-[#6b7280]">倾斜损耗</span>
                      <span className="mono-digits text-[12px] text-[#1a1a2e]">
                        {couplingTilt !== 0
                          ? (-10 * Math.log10(Math.exp(-Math.pow(Math.PI * coreRadius * 0.65e-6 * (couplingTilt * Math.PI / 180) / (wavelength * 1e-9), 2)))).toFixed(2)
                          : "0.00"} dB
                      </span>
                    </div>
                  </div>
                </div>

                {/* Marcuse formula reference */}
                <div className="rounded border border-[#d4d8e0] bg-[#fafbfc] p-3">
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[#6b7280] mb-2"
                    style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>
                    Marcuse耦合公式
                  </h4>
                  <div className="space-y-1 text-[11px] text-[#555555]"
                    style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>
                    <p>η = exp(-d²/w₀²) · exp(-(πw₀θ/λ)²)</p>
                    <p>w₀ ≈ {coreRadius === 4.1 ? "4.8" : (coreRadius * 0.65).toFixed(1)} μm (模场半径)</p>
                  </div>
                </div>
              </div>
            )}

            {/* ──── BENDING LOSS ──── */}
            {expMode === "bending" && (
              <div className="space-y-4">
                {/* Bending diagram */}
                <div className="rounded border border-[#d4d8e0] p-3 bg-white">
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[#6b7280] mb-2"
                    style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>
                    宏弯损耗示意
                  </h4>
                  <svg width="280" height="140" viewBox="0 0 280 140" className="svg-responsive" style={{ maxWidth: "100%" }}>
                    {/* Bent fiber arc */}
                    <path
                      d={`M 40,${70 + bendRadius * 0.5} Q 140,${70 - bendRadius * 0.3} 240,${70 + bendRadius * 0.5}`}
                      fill="none" stroke="#333333" strokeWidth="3" strokeLinecap="round"
                    />
                    {/* Core */}
                    <path
                      d={`M 40,${70 + bendRadius * 0.5} Q 140,${70 - bendRadius * 0.3} 240,${70 + bendRadius * 0.5}`}
                      fill="none" stroke={beamColor} strokeWidth="1.5" strokeDasharray="4,2"
                    />
                    {/* Radiation loss arrows */}
                    <line x1="140" y1={70 - bendRadius * 0.3 - 5} x2="140" y2={20}
                      stroke="#dc2626" strokeWidth="0.8" strokeDasharray="2,2" />
                    <text x="145" y="18" fontSize="8" fill="#dc2626" fontFamily={FONT}>辐射损耗</text>
                    {/* R label */}
                    <path d={`M 140,${70 - bendRadius * 0.3} L 140,${70 + 30}`}
                      fill="none" stroke="#888888" strokeWidth="0.5" strokeDasharray="3,2" />
                    <text x="145" y={70 + 25} fontSize="8" fill="#6b7280" fontFamily={FONT}>
                      R={bendRadius}mm
                    </text>
                  </svg>
                </div>

                {/* Bending loss metrics */}
                <div className="rounded border border-[#d4d8e0] bg-white p-4">
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[#6b7280] mb-3"
                    style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>
                    弯曲损耗
                  </h4>
                  <div className={isMobile ? "grid grid-cols-1 gap-3" : "grid grid-cols-2 gap-4"}>
                    <div className="rounded border border-[#e8ecf0] p-3">
                      <span className="text-[10px] text-[#6b7280] block">宏弯损耗</span>
                      <span className="mono-digits text-[16px] font-semibold text-[#1a1a2e]">
                        {bendingLoss < 0.01 ? "<0.01" : bendingLoss.toFixed(2)}
                      </span>
                      <span className="text-[10px] text-[#6b7280]"> dB/m</span>
                    </div>
                    <div className="rounded border border-[#e8ecf0] p-3">
                      <span className="text-[10px] text-[#6b7280] block">弯曲半径</span>
                      <span className="mono-digits text-[16px] font-semibold text-[#1a1a2e]">
                        {bendRadius.toFixed(1)}
                      </span>
                      <span className="text-[10px] text-[#6b7280]"> mm</span>
                    </div>
                  </div>
                </div>

                {/* Loss vs R curve */}
                <div className="rounded border border-[#d4d8e0] p-3 bg-white">
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[#6b7280] mb-2"
                    style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>
                    损耗 vs 弯曲半径
                  </h4>
                  <svg width="280" height="120" viewBox="0 0 280 120" className="svg-responsive" style={{ maxWidth: "100%" }}>
                    {/* Axes */}
                    <line x1="35" y1="10" x2="35" y2="95" stroke="#333333" strokeWidth="1" />
                    <line x1="35" y1="95" x2="270" y2="95" stroke="#333333" strokeWidth="1" />
                    <text x="150" y="112" textAnchor="middle" fontSize="8" fill="#6b7280"
                      fontFamily={FONT}>R (mm)</text>
                    <text x="8" y="52" textAnchor="middle" fontSize="8" fill="#6b7280"
                      fontFamily={FONT} transform="rotate(-90,8,52)">dB/m</text>
                    {/* Curve */}
                    {(() => {
                      const pts: string[] = [];
                      for (let r = 1; r <= 100; r += 1) {
                        const loss = computeBendingLoss(r);
                        const x = 35 + ((r - 1) / 99) * 235;
                        // Use log scale for dB/m
                        const logLoss = loss > 0.001 ? Math.log10(loss) : -3;
                        const y = 95 - Math.min(80, (logLoss + 3) * 20);
                        pts.push(`${x.toFixed(1)},${Math.max(10, y).toFixed(1)}`);
                      }
                      return pts.length > 1 ? (
                        <polyline points={pts.join(" ")} fill="none" stroke={beamColor} strokeWidth="1.5" />
                      ) : null;
                    })()}
                    {/* Current R marker */}
                    {(() => {
                      const x = 35 + ((bendRadius - 1) / 99) * 235;
                      return (
                        <line x1={x} y1="10" x2={x} y2="95"
                          stroke="#888888" strokeWidth="0.5" strokeDasharray="3,2" />
                      );
                    })()}
                  </svg>
                </div>

                {/* Reference */}
                <div className="rounded border border-[#d4d8e0] bg-[#fafbfc] p-3">
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[#6b7280] mb-2"
                    style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>
                    弯曲损耗公式
                  </h4>
                  <div className="space-y-1 text-[11px] text-[#555555]"
                    style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>
                    <p>α = (√π/2V²)·(u₀/w)²·√(a/R)·e^(-2w³/3V²a/R)</p>
                    <p>Marcuse bending loss formula (step-index)</p>
                    <p>单模光纤临界弯曲半径 ~{(() => {
                      // Rc = (3·n1²·λ) / (4π·(n1²-n2²)^{3/2})
                      const deltaN2 = Math.pow(n1*n1 - n2*n2, 1.5);
                      const Rc = deltaN2 > 0 ? (3 * n1*n1 * wavelength*1e-6) / (4*Math.PI * deltaN2) : 0;
                      return Rc > 0 ? Rc.toFixed(1) : "—";
                    })()} mm</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom status bar */}
      <div
        className="flex flex-shrink-0 items-center"
        style={{
          height: "24px",
          backgroundColor: "#FFFFFF",
          borderTop: "1px solid #d4d8e0",
          paddingLeft: isMobile ? "16px" : "24px",
          paddingRight: isMobile ? "16px" : "24px",
          overflow: "hidden",
        }}
      >
        <span
          className="tabular-nums font-normal text-[#888888]"
          style={{
            fontFamily: FONT,
            fontSize: isMobile ? "9px" : "10px",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {isMobile
            ? "v2.1 · 光纤模式仿真器"
            : "v2.1 · 现代光学模块 — 光纤LP模式·色散·耦合·弯曲损耗"}
        </span>
      </div>
    </div>
  );
}
