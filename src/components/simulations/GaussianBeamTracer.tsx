"use client";

import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

import {
  calculateGaussianBeam,
  getWavelengthColor,
  formatSI,
  gouyPhase,
  radiusOfCurvature,
  powerContainment,
  complexBeamParam,
  abcdTransformQ,
  freeSpaceABCD,
  thinLensABCD,
  multimodeBeamWidth,
  correctedM2BeamWidth,
  hermiteGaussianIntensity,
  gaussianIntensity,
  multiLensABCDChain,
  modeCouplingEfficiency,
  type GaussianBeamParams,
  type LensConfig,
} from "@/lib/optics/gaussian-beam";
import BeamProfileCanvas from "./BeamProfileCanvas";

/* ─── Experiment Mode Type ─── */
type ExperimentMode =
  | "basic"
  | "lens-transform"
  | "gouy-phase"
  | "m2-measurement"
  | "higher-order"
  | "mode-matching"
  | "spatial-filter"
  | "param-scanner";

const MODE_LABELS: Record<ExperimentMode, string> = {
  basic: "基本模式",
  "lens-transform": "透镜变换",
  "gouy-phase": "Gouy相位",
  "m2-measurement": "M²测量",
  "higher-order": "高阶模式",
  "mode-matching": "模式匹配",
  "spatial-filter": "空间滤波",
  "param-scanner": "参数扫描",
};

/* ─── Wavelength Dark/Light Color Mapping ─── */
function getWavelengthDarkColor(wlNm: number): string {
  if (wlNm >= 600) return "#990000";
  if (wlNm >= 500) return "#006633";
  return "#3322AA";
}
function getWavelengthLightRgba(wlNm: number): string {
  if (wlNm >= 600) return "rgba(204,0,0,0.30)";
  if (wlNm >= 500) return "rgba(0,170,68,0.30)";
  return "rgba(64,80,176,0.30)";
}

/* ─── 3D projection utilities ─── */
function project3D(x: number, y: number, z: number, azim: number, elev: number): [number, number, number] {
  const cosA = Math.cos(azim), sinA = Math.sin(azim);
  const cosE = Math.cos(elev), sinE = Math.sin(elev);
  const x1 = x * cosA + z * sinA;
  const z1 = -x * sinA + z * cosA;
  const y1 = y;
  const x2 = x1;
  const y2 = y1 * cosE - z1 * sinE;
  const z2 = y1 * sinE + z1 * cosE;
  return [x2, y2, z2];
}

function drawLine3D(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number, z1: number,
  x2: number, y2: number, z2: number,
  azim: number, elev: number,
  cx: number, cy: number, scale: number,
) {
  const [sx1, sy1] = project3D(x1, y1, z1, azim, elev);
  const [sx2, sy2] = project3D(x2, y2, z2, azim, elev);
  ctx.beginPath();
  ctx.moveTo(cx + sx1 * scale, cy - sy1 * scale);
  ctx.lineTo(cx + sx2 * scale, cy - sy2 * scale);
  ctx.stroke();
}

function drawDashDot3D(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number, z1: number,
  x2: number, y2: number, z2: number,
  azim: number, elev: number,
  cx: number, cy: number, scale: number,
) {
  const [sx1, sy1] = project3D(x1, y1, z1, azim, elev);
  const [sx2, sy2] = project3D(x2, y2, z2, azim, elev);
  const dx = sx2 - sx1, dy = sy2 - sy1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return;
  const ux = dx / len, uy = dy / len;
  let pos = 0;
  const dashLen = 8 * (scale / 100), dotLen = 2 * (scale / 100), gapLen = 4 * (scale / 100);
  ctx.beginPath();
  while (pos < len) {
    const segEnd = Math.min(pos + dashLen, len);
    ctx.moveTo(cx + (sx1 + ux * pos) * 1, cy - (sy1 + uy * pos) * 1);
    ctx.lineTo(cx + (sx1 + ux * segEnd) * 1, cy - (sy1 + uy * segEnd) * 1);
    pos = segEnd + gapLen;
    if (pos < len) {
      const dotEnd = Math.min(pos + dotLen, len);
      ctx.moveTo(cx + (sx1 + ux * pos) * 1, cy - (sy1 + uy * pos) * 1);
      ctx.lineTo(cx + (sx1 + ux * dotEnd) * 1, cy - (sy1 + uy * dotEnd) * 1);
      pos = dotEnd + gapLen;
    }
  }
  ctx.stroke();
}

/* ─── Parse hex color ─── */
function parseHexColor(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16) / 255;
  const g = parseInt(h.substring(2, 4), 16) / 255;
  const b = parseInt(h.substring(4, 6), 16) / 255;
  return [r, g, b];
}

/* ═══════════════════════════════════════════════════════════════
   3D Beam Envelope Canvas — MATLAB mesh/surf style hourglass
   ═══════════════════════════════════════════════════════════════ */

function MatlabBeamEnvelopeCanvas({
  widthAt,
  w0,
  zR,
  propagationDistance,
  observationZ,
  lenses,
  wavelengthNm,
}: {
  widthAt: (z: number) => number;
  w0: number;
  zR: number;
  propagationDistance: number;
  observationZ: number;
  lenses: LensConfig[];
  wavelengthNm: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [azimuth, setAzimuth] = useState(-Math.PI / 5);
  const [elevation, setElevation] = useState(20 * Math.PI / 180);
  const isDragging = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    isDragging.current = true;
    lastMouse.current = { x: e.clientX, y: e.clientY };
  }, []);
  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current) return;
    const dx = e.clientX - lastMouse.current.x;
    const dy = e.clientY - lastMouse.current.y;
    lastMouse.current = { x: e.clientX, y: e.clientY };
    setAzimuth(prev => prev + dx * 0.008);
    setElevation(prev => Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, prev + dy * 0.008)));
  }, []);
  const onMouseUp = useCallback(() => { isDragging.current = false; }, []);

  const darkColor = getWavelengthDarkColor(wavelengthNm);
  const lightRgba = getWavelengthLightRgba(wavelengthNm);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    if (cw === 0 || ch === 0) return;
    canvas.width = cw * dpr;
    canvas.height = ch * dpr;
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${ch}px`;
    ctx.scale(dpr, dpr);

    const w = cw, h = ch;
    const padL = 55, padR = 20, padT = 25, padB = 40;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;
    const cx = padL + plotW / 2;
    const cy = padT + plotH / 2;

    const maxW = Math.max(w0 * 3, ...Array.from({ length: 50 }, (_, i) => widthAt((i / 50) * propagationDistance)));
    const rMax = maxW * 1.2;
    const zRange = propagationDistance;

    // Scale: map physical to normalized 3D coords
    const rScale = 1 / rMax;
    const zScale = 2 / zRange; // z from -1 to 1
    const viewScale = Math.min(plotW, plotH) * 0.38;

    const azim = azimuth, elev = elevation;
    const toScreen = (x3: number, y3: number, z3: number): [number, number, number] => {
      const [xp, yp, zp] = project3D(x3, y3, z3, azim, elev);
      return [cx + xp * viewScale, cy - yp * viewScale, zp];
    };

    // White background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);

    // ─── 1. Draw axis box ───
    const NTHETA = 30;
    const NZ = 50;

    // Axis lines (black, thin)
    ctx.strokeStyle = "#333333";
    ctx.lineWidth = 0.6;

    // Z-axis
    drawDashDot3D(ctx, 0, 0, -1, 0, 0, 1, azim, elev, cx, cy, viewScale);

    // Axis tick marks
    ctx.fillStyle = "#333333";
    ctx.font = "8px IBM Plex Sans";
    ctx.textAlign = "center";
    for (let i = 0; i <= 4; i++) {
      const frac = i / 4;
      const zVal = frac * zRange;
      const zn = -1 + frac * 2;
      const [sx, sy] = toScreen(0, 0, zn);
      // Small tick
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + 3, sy + 3);
      ctx.stroke();
      ctx.fillText(formatSI(zVal, "m"), sx + 6, sy + 10);
    }

    // Axis labels (italic for physical quantities)
    ctx.fillStyle = "#333333";
    ctx.font = "italic 10px IBM Plex Sans";
    const [zlpX, zlpY] = toScreen(0, -0.15, 1.15);
    ctx.fillText("z (m)", zlpX, zlpY);
    const [xlpX, xlpY] = toScreen(1.15, 0, -1);
    ctx.fillText("r (mm)", xlpX - 15, xlpY + 14);

    // ─── 2. Surface of revolution: beam envelope hourglass ───
    interface Quad { depth: number; pts: [number, number][]; strokeColor: string; fillColor: string; }
    const quads: Quad[] = [];

    for (let iz = 0; iz < NZ; iz++) {
      for (let itheta = 0; itheta < NTHETA; itheta++) {
        const z0 = (iz / NZ) * zRange;
        const z1 = ((iz + 1) / NZ) * zRange;
        const t0 = (itheta / NTHETA) * 2 * Math.PI;
        const t1 = ((itheta + 1) / NTHETA) * 2 * Math.PI;

        const wz0 = widthAt(z0);
        const wz1 = widthAt(z1);

        const x0 = wz0 * Math.cos(t0) * rScale;
        const y0 = wz0 * Math.sin(t0) * rScale;
        const zn0 = -1 + (z0 / zRange) * 2;

        const x1 = wz0 * Math.cos(t1) * rScale;
        const y1 = wz0 * Math.sin(t1) * rScale;

        const x2 = wz1 * Math.cos(t1) * rScale;
        const y2 = wz1 * Math.sin(t1) * rScale;
        const zn1 = -1 + (z1 / zRange) * 2;

        const x3 = wz1 * Math.cos(t0) * rScale;
        const y3 = wz1 * Math.sin(t0) * rScale;

        const s00 = toScreen(x0, y0, zn0);
        const s10 = toScreen(x1, y1, zn0);
        const s11 = toScreen(x2, y2, zn1);
        const s01 = toScreen(x3, y3, zn1);

        const avgDepth = (s00[2] + s10[2] + s11[2] + s01[2]) / 4;

        quads.push({
          depth: avgDepth,
          pts: [[s00[0], s00[1]], [s10[0], s10[1]], [s11[0], s11[1]], [s01[0], s01[1]]],
          strokeColor: darkColor,
          fillColor: lightRgba,
        });
      }
    }
    quads.sort((a, b) => a.depth - b.depth);

    // Draw mesh surface
    for (const q of quads) {
      ctx.fillStyle = q.fillColor;
      ctx.strokeStyle = q.strokeColor;
      ctx.lineWidth = 0.3;
      ctx.beginPath();
      ctx.moveTo(q.pts[0][0], q.pts[0][1]);
      ctx.lineTo(q.pts[1][0], q.pts[1][1]);
      ctx.lineTo(q.pts[2][0], q.pts[2][1]);
      ctx.lineTo(q.pts[3][0], q.pts[3][1]);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // ─── 3. Optical axis (gray dash-dot) ───
    ctx.strokeStyle = "#888888";
    ctx.lineWidth = 0.8;
    drawDashDot3D(ctx, 0, 0, -1.05, 0, 0, 1.05, azim, elev, cx, cy, viewScale);

    // ─── 4. Rayleigh range double cone wireframe ───
    const zRNorm = -1 + (zR / zRange) * 2;
    const wAtZR = widthAt(zR);
    const wAtZRScaled = wAtZR * rScale;
    ctx.strokeStyle = "#88BBDD";
    ctx.lineWidth = 0.6;
    ctx.setLineDash([4, 3]);

    // Forward cone lines (from waist to +zR)
    const nConeLines = 12;
    for (let i = 0; i < nConeLines; i++) {
      const theta = (i / nConeLines) * 2 * Math.PI;
      drawLine3D(ctx,
        0, 0, -1, // z=0 (waist)
        wAtZRScaled * Math.cos(theta), wAtZRScaled * Math.sin(theta), zRNorm,
        azim, elev, cx, cy, viewScale);
    }
    // Circle at +zR
    ctx.beginPath();
    for (let i = 0; i <= 60; i++) {
      const theta = (i / 60) * 2 * Math.PI;
      const [sx, sy] = toScreen(wAtZRScaled * Math.cos(theta), wAtZRScaled * Math.sin(theta), zRNorm);
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // zR label
    const [zrlx, zrly] = toScreen(wAtZRScaled * 1.1, 0, zRNorm);
    ctx.fillStyle = "#333333";
    ctx.font = "9px IBM Plex Sans";
    ctx.textAlign = "left";
    ctx.fillText("zR", zrlx + 3, zrly - 3);
    // Arrow from label to zR position
    ctx.strokeStyle = "#333333";
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(zrlx + 2, zrly - 2);
    ctx.lineTo(zrlx - 3, zrly + 2);
    ctx.stroke();

    // ─── 5. Lens wireframes ───
    for (const lens of lenses) {
      if (lens.position <= 0 || lens.position >= zRange || lens.focalLength === 0) continue;
      const lensZn = -1 + (lens.position / zRange) * 2;
      const wAtLens = widthAt(lens.position);
      const wScaled = wAtLens * rScale;

      // Biconvex wireframe: two arcs
      ctx.strokeStyle = "#4a4a5a";
      ctx.lineWidth = 0.8;

      // Left arc
      const arcOffset = 0.04;
      ctx.beginPath();
      for (let i = 0; i <= 30; i++) {
        const frac = i / 30;
        const angle = -Math.PI / 2 + frac * Math.PI;
        const rx = -arcOffset + arcOffset * 0.3 * Math.cos(angle);
        const ry = wScaled * Math.sin(angle);
        const [sx, sy] = toScreen(rx, ry, lensZn);
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.stroke();

      // Right arc
      ctx.beginPath();
      for (let i = 0; i <= 30; i++) {
        const frac = i / 30;
        const angle = -Math.PI / 2 + frac * Math.PI;
        const rx = arcOffset - arcOffset * 0.3 * Math.cos(angle);
        const ry = wScaled * Math.sin(angle);
        const [sx, sy] = toScreen(rx, ry, lensZn);
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.stroke();

      // Lens label
      const [llx, lly] = toScreen(0, -wScaled - 0.08, lensZn);
      ctx.fillStyle = "#4a4a5a";
      ctx.font = "7px IBM Plex Sans";
      ctx.textAlign = "center";
      ctx.fillText(`f=${formatSI(lens.focalLength, "m")}`, llx, lly);
    }

    // ─── 6. Focal point markers (cross +) ───
    let focalPointsList: { z: number }[] = [];
    try {
      const cr = multiLensABCDChain(w0, (wavelengthNm * 1e-9), lenses, zRange);
      focalPointsList = cr.focalPoints;
    } catch { /* ignore if chain fails */ }
    for (const fp of focalPointsList) {
      const fpZn = -1 + (fp.z / zRange) * 2;
      const [fpx, fpy] = toScreen(0, 0, fpZn);
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = 1;
      const cs = 4;
      ctx.beginPath();
      ctx.moveTo(fpx - cs, fpy - cs);
      ctx.lineTo(fpx + cs, fpy + cs);
      ctx.moveTo(fpx + cs, fpy - cs);
      ctx.lineTo(fpx - cs, fpy + cs);
      ctx.stroke();
    }

    // ─── 7. Observation point (red dashed circle) ───
    const obsZn = -1 + (observationZ / zRange) * 2;
    const obsW = widthAt(observationZ);
    const obsWScaled = obsW * rScale;
    ctx.strokeStyle = "#cc3333";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 2]);
    ctx.beginPath();
    for (let i = 0; i <= 60; i++) {
      const theta = (i / 60) * 2 * Math.PI;
      const [sx, sy] = toScreen(obsWScaled * Math.cos(theta), obsWScaled * Math.sin(theta), obsZn);
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    const [olx, oly] = toScreen(obsWScaled + 0.05, 0, obsZn);
    ctx.fillStyle = "#cc3333";
    ctx.font = "8px IBM Plex Sans";
    ctx.textAlign = "left";
    ctx.fillText("obs", olx, oly - 3);

  }, [widthAt, w0, zR, propagationDistance, observationZ, lenses, wavelengthNm, darkColor, lightRgba, azimuth, elevation]);

  return (
    <div ref={containerRef} className="relative w-full h-full" style={{ cursor: "grab" }}
      onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
    >
      <canvas ref={canvasRef} className="w-full h-full" />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Contourf Cross-Section Canvas — at observation z
   ═══════════════════════════════════════════════════════════════ */

function ContourfCanvas({
  widthAt,
  w0,
  zR,
  observationZ,
  wavelengthNm,
  pinholeDiameter,
}: {
  widthAt: (z: number) => number;
  w0: number;
  zR: number;
  observationZ: number;
  wavelengthNm: number;
  pinholeDiameter: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    try {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.parentElement?.clientWidth || 300;
    const ch = cw;
    canvas.width = cw * dpr;
    canvas.height = ch * dpr;
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${ch}px`;
    ctx.scale(dpr, dpr);

    const margin = { left: 30, right: 30, top: 25, bottom: 25 };
    const plotW = cw - margin.left - margin.right;
    const plotH = ch - margin.top - margin.bottom;
    const plotSize = Math.min(plotW, plotH); // square plot area for circular symmetry
    const offX = (plotW - plotSize) / 2;     // center horizontally
    const offY = (plotH - plotSize) / 2;     // center vertically
    const plotLeft = margin.left + offX;
    const plotTop = margin.top + offY;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, cw, ch);

    const wz = Math.max(widthAt(observationZ), 1e-12);
    const extent = wz * 3;
    const NLEVELS = 12;
    const darkColor = getWavelengthDarkColor(wavelengthNm);
    const [dr, dg, db] = parseHexColor(darkColor);

    // Precompute intensity grid
    const NG = 120;
    const grid: number[][] = [];
    let iMax = 0;
    for (let iy = 0; iy <= NG; iy++) {
      grid[iy] = [];
      const yv = ((iy / NG) - 0.5) * 2 * extent;
      for (let ix = 0; ix <= NG; ix++) {
        const xv = ((ix / NG) - 0.5) * 2 * extent;
        const r2 = xv * xv + yv * yv;
        let intensity = (w0 / wz) * (w0 / wz) * Math.exp(-2 * r2 / (wz * wz));
        // Pinhole filter: if pinhole is active, truncate outside pinhole
        if (pinholeDiameter > 0) {
          const pinholeR = pinholeDiameter / 2;
          if (Math.sqrt(r2) > pinholeR) {
            intensity *= Math.exp(-2 * (Math.sqrt(r2) - pinholeR) * (Math.sqrt(r2) - pinholeR) / (wz * 0.1 * (wz * 0.1)));
          }
        }
        grid[iy][ix] = intensity;
        if (intensity > iMax) iMax = intensity;
      }
    }
    if (iMax > 0) {
      for (let iy = 0; iy <= NG; iy++)
        for (let ix = 0; ix <= NG; ix++)
          grid[iy][ix] /= iMax;
    }

    // Draw filled contour levels
    const xToP = (xv: number) => plotLeft + ((xv / extent + 1) / 2) * plotSize;
    const yToP = (yv: number) => plotTop + ((1 - (yv / extent + 1) / 2)) * plotSize;

    const cellW = plotSize / NG;
    const cellH = plotSize / NG;

    for (let lev = NLEVELS; lev >= 0; lev--) {
      const threshold = lev / NLEVELS;
      // Color: white (center, high I) → dark (edge, low I)
      const t = 1 - threshold; // 0 at edge, 1 at center
      const blendR = Math.round(255 * (1 - t) + dr * 255 * t);
      const blendG = Math.round(255 * (1 - t) + dg * 255 * t);
      const blendB = Math.round(255 * (1 - t) + db * 255 * t);
      ctx.fillStyle = `rgb(${blendR},${blendG},${blendB})`;

      // Draw pixels above this threshold
      for (let iy = 0; iy < NG; iy++) {
        for (let ix = 0; ix < NG; ix++) {
          if (grid[iy][ix] >= threshold) {
            const px = plotLeft + ix * cellW;
            const py = plotTop + iy * cellH;
            ctx.fillRect(px, py, cellW + 0.5, cellH + 0.5);
          }
        }
      }
    }

    // Draw contour lines (black thin)
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 0.4;
    for (let lev = 1; lev < NLEVELS; lev++) {
      const threshold = lev / NLEVELS;
      // Simple marching squares approximation
      for (let iy = 0; iy < NG; iy++) {
        for (let ix = 0; ix < NG; ix++) {
          const v00 = grid[iy][ix] >= threshold ? 1 : 0;
          const v10 = grid[iy][ix + 1] >= threshold ? 1 : 0;
          const v01 = grid[iy + 1]?.[ix] >= threshold ? 1 : 0;
          const v11 = grid[iy + 1]?.[ix + 1] >= threshold ? 1 : 0;
          const code = v00 + v10 * 2 + v01 * 4 + v11 * 8;
          if (code === 0 || code === 15) continue;
          // Draw approximate contour segment through cell center
          const cx = plotLeft + (ix + 0.5) * cellW;
          const cy = plotTop + (iy + 0.5) * cellH;
          ctx.beginPath();
          if ((code & 3) === 1 || (code & 3) === 2) {
            ctx.moveTo(cx - cellW / 2, cy);
            ctx.lineTo(cx, cy + cellH / 2);
          }
          if ((code >> 2) === 1 || (code >> 2) === 2) {
            ctx.moveTo(cx, cy - cellH / 2);
            ctx.lineTo(cx + cellW / 2, cy);
          }
          ctx.stroke();
        }
      }
    }

    // Pinhole circle if active
    if (pinholeDiameter > 0) {
      const pinR = (pinholeDiameter / 2 / extent) * (plotSize / 2);
      ctx.strokeStyle = "#cc3333";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 2]);
      ctx.beginPath();
      ctx.arc(plotLeft + plotSize / 2, plotTop + plotSize / 2, pinR, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Axis labels
    ctx.fillStyle = "#333333";
    ctx.font = "italic 9px IBM Plex Sans";
    ctx.textAlign = "center";
    ctx.fillText("x", plotLeft + plotSize / 2, ch - 3);
    ctx.save();
    ctx.translate(10, plotTop + plotSize / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("y", 0, 0);
    ctx.restore();

    // Tick marks
    ctx.font = "7px IBM Plex Mono";
    ctx.fillStyle = "#9ca3af";
    ctx.textAlign = "center";
    for (let i = 0; i <= 4; i++) {
      const frac = i / 4;
      const val = -extent + frac * 2 * extent;
      const px = plotLeft + frac * plotSize;
      ctx.fillText(formatSI(val, "m"), px, plotTop + plotSize + 12);
    }

    // Title
    ctx.fillStyle = "#2d3142";
    ctx.font = "9px IBM Plex Sans";
    ctx.textAlign = "left";
    ctx.fillText(`光斑剖面 z=${observationZ.toFixed(2)}m`, plotLeft + 3, plotTop - 5);

    } catch (err) {
      // Draw error message on canvas if something goes wrong
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx2 = canvas.getContext("2d");
        if (ctx2) {
          ctx2.fillStyle = "#ffffff";
          ctx2.fillRect(0, 0, canvas.width, canvas.height);
          ctx2.fillStyle = "#cc3333";
          ctx2.font = "11px IBM Plex Sans";
          ctx2.fillText(`渲染错误: ${err instanceof Error ? err.message : String(err)}`, 10, 30);
        }
      }
      console.error("ContourfCanvas error:", err);
    }
  }, [widthAt, w0, zR, observationZ, wavelengthNm, pinholeDiameter]);

  return <canvas ref={canvasRef} className="w-full" />;
}

/* ═══════════════════════════════════════════════════════════════
   Intensity Profile Canvas — I(r) curve at observation z
   ═══════════════════════════════════════════════════════════════ */

function IntensityProfileCanvas({
  widthAt,
  w0,
  zR,
  observationZ,
  wavelengthNm,
}: {
  widthAt: (z: number) => number;
  w0: number;
  zR: number;
  observationZ: number;
  wavelengthNm: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.parentElement?.clientWidth || 300;
    const ch = 180;
    canvas.width = cw * dpr;
    canvas.height = ch * dpr;
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${ch}px`;
    ctx.scale(dpr, dpr);

    const margin = { left: 45, right: 15, top: 15, bottom: 28 };
    const plotW = cw - margin.left - margin.right;
    const plotH = ch - margin.top - margin.bottom;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, cw, ch);

    // Light gray grid
    ctx.strokeStyle = "#ebeef2";
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 5; i++) {
      const x = margin.left + (i / 5) * plotW;
      ctx.beginPath(); ctx.moveTo(x, margin.top); ctx.lineTo(x, margin.top + plotH); ctx.stroke();
    }
    for (let i = 0; i <= 4; i++) {
      const y = margin.top + (i / 4) * plotH;
      ctx.beginPath(); ctx.moveTo(margin.left, y); ctx.lineTo(margin.left + plotW, y); ctx.stroke();
    }

    // Axes
    ctx.strokeStyle = "#333333";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(margin.left, margin.top + plotH);
    ctx.lineTo(margin.left + plotW, margin.top + plotH);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(margin.left, margin.top);
    ctx.lineTo(margin.left, margin.top + plotH);
    ctx.stroke();

    const wz = Math.max(widthAt(observationZ), 1e-12);
    const rMax = wz * 3;
    const numPts = 150;

    // I(r) curve: I = (w0/wz)^2 * exp(-2r^2/wz^2)
    ctx.beginPath();
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 1.5;
    for (let i = 0; i <= numPts; i++) {
      const r = (i / numPts) * rMax;
      const I = (w0 / wz) * (w0 / wz) * Math.exp(-2 * r * r / (wz * wz));
      const x = margin.left + (r / rMax) * plotW;
      const y = margin.top + (1 - I) * plotH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Mark w(z) position
    const wNorm = wz / rMax;
    const wX = margin.left + wNorm * plotW;
    ctx.setLineDash([3, 2]);
    ctx.strokeStyle = "#9ca3af";
    ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.moveTo(wX, margin.top); ctx.lineTo(wX, margin.top + plotH); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#6b7280";
    ctx.font = "8px IBM Plex Sans";
    ctx.textAlign = "center";
    ctx.fillText("w(z)", wX, margin.top - 2);

    // Axis labels
    ctx.fillStyle = "#333333";
    ctx.font = "italic 9px IBM Plex Sans";
    ctx.textAlign = "center";
    ctx.fillText("r (m)", margin.left + plotW / 2, ch - 3);

    ctx.save();
    ctx.translate(10, margin.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("I / I₀", 0, 0);
    ctx.restore();

    // Ticks
    ctx.font = "7px IBM Plex Mono";
    ctx.fillStyle = "#9ca3af";
    ctx.textAlign = "center";
    for (let i = 0; i <= 4; i++) {
      const frac = i / 4;
      ctx.fillText(formatSI(frac * rMax, "m"), margin.left + frac * plotW, margin.top + plotH + 12);
    }
    ctx.textAlign = "right";
    for (let i = 0; i <= 4; i++) {
      const frac = i / 4;
      ctx.fillText(frac.toFixed(1), margin.left - 4, margin.top + (1 - frac) * plotH + 3);
    }

  }, [widthAt, w0, zR, observationZ, wavelengthNm]);

  return <canvas ref={canvasRef} className="w-full border-t border-[#d4d8e0]" />;
}

/* ═══════════════════════════════════════════════════════════════
   Gouy Phase Canvas (kept from original)
   ═══════════════════════════════════════════════════════════════ */

function GouyPhaseCanvas({
  w0, wavelength, zR, propagationDistance, observationZ, beamColor,
}: {
  w0: number; wavelength: number; zR: number; propagationDistance: number; observationZ: number; beamColor: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.parentElement?.clientWidth || 600;
    const h = 300;
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
    ctx.scale(dpr, dpr);

    const margin = { left: 55, right: 55, top: 25, bottom: 35 };
    const plotW = w - margin.left - margin.right;
    const plotH = h - margin.top - margin.bottom;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = "#ebeef2"; ctx.lineWidth = 0.5;
    for (let x = margin.left; x <= w - margin.right; x += plotW / 10) {
      ctx.beginPath(); ctx.moveTo(x, margin.top); ctx.lineTo(x, h - margin.bottom); ctx.stroke();
    }
    for (let y = margin.top; y <= h - margin.bottom; y += plotH / 8) {
      ctx.beginPath(); ctx.moveTo(margin.left, y); ctx.lineTo(w - margin.right, y); ctx.stroke();
    }
    // Axes
    ctx.strokeStyle = "#9ca3af"; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(margin.left, h - margin.bottom); ctx.lineTo(w - margin.right, h - margin.bottom); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(margin.left, margin.top); ctx.lineTo(margin.left, h - margin.bottom); ctx.stroke();

    const psiToY = (psi: number) => margin.top + (1 - (psi + Math.PI / 2) / Math.PI) * plotH;
    const zToX = (z: number) => margin.left + (z / (propagationDistance || 1)) * plotW;
    const numPts = 200;

    // Zero line
    ctx.setLineDash([3, 3]); ctx.strokeStyle = "#d4d8e0"; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(margin.left, psiToY(0)); ctx.lineTo(w - margin.right, psiToY(0)); ctx.stroke();
    ctx.setLineDash([]);

    // ψ(z) curve
    ctx.beginPath();
    for (let i = 0; i <= numPts; i++) {
      const z = (i / numPts) * propagationDistance;
      const psi = gouyPhase(z, zR);
      if (i === 0) ctx.moveTo(zToX(z), psiToY(psi));
      else ctx.lineTo(zToX(z), psiToY(psi));
    }
    ctx.strokeStyle = "#333333"; ctx.lineWidth = 1.8; ctx.stroke();

    // π/2 labels
    ctx.fillStyle = "#6b7280"; ctx.font = "9px IBM Plex Sans"; ctx.textAlign = "right";
    ctx.fillText("π/2", margin.left - 5, psiToY(Math.PI / 2) + 3);
    ctx.fillText("-π/2", margin.left - 5, psiToY(-Math.PI / 2) + 3);
    ctx.fillText("0", margin.left - 5, psiToY(0) + 3);

    // R(z) dashed
    ctx.beginPath(); ctx.setLineDash([5, 3]);
    let rStarted = false;
    for (let i = 0; i <= numPts; i++) {
      const z = (i / numPts) * propagationDistance;
      if (z === 0) continue;
      const R = radiusOfCurvature(z, zR);
      if (!isFinite(R)) continue;
      const logMin = Math.log10(zR * 0.5), logMax = Math.log10(propagationDistance * 5);
      const logR = Math.log10(Math.max(Math.abs(R), zR * 0.5));
      const y = margin.top + (1 - (logR - logMin) / (logMax - logMin)) * plotH;
      if (y < margin.top || y > h - margin.bottom) continue;
      if (!rStarted) { ctx.moveTo(zToX(z), y); rStarted = true; } else ctx.lineTo(zToX(z), y);
    }
    ctx.strokeStyle = "#b07020"; ctx.lineWidth = 1.2; ctx.stroke(); ctx.setLineDash([]);

    // Observation point
    const obsPsi = gouyPhase(observationZ, zR);
    ctx.beginPath(); ctx.arc(zToX(observationZ), psiToY(obsPsi), 4, 0, 2 * Math.PI);
    ctx.fillStyle = "#cc3333"; ctx.fill();
    ctx.setLineDash([3, 2]); ctx.beginPath();
    ctx.moveTo(zToX(observationZ), margin.top); ctx.lineTo(zToX(observationZ), h - margin.bottom);
    ctx.strokeStyle = "#cc3333"; ctx.lineWidth = 0.8; ctx.stroke(); ctx.setLineDash([]);

    // Axis labels
    ctx.fillStyle = "#6b7280"; ctx.font = "9px IBM Plex Sans"; ctx.textAlign = "center";
    ctx.fillText("z (传播方向)", w / 2, h - 5);
    ctx.save(); ctx.translate(14, margin.top + plotH / 2); ctx.rotate(-Math.PI / 2);
    ctx.fillText("ψ(z) [rad]", 0, 0); ctx.restore();

    // Title
    ctx.fillStyle = "#2d3142"; ctx.font = "10px IBM Plex Sans"; ctx.textAlign = "left";
    ctx.fillText("Gouy相位 ψ(z) 与曲率半径 R(z)", margin.left + 5, margin.top + 12);
  }, [w0, wavelength, zR, propagationDistance, observationZ, beamColor]);

  return <canvas ref={canvasRef} className="w-full border-t border-[#d4d8e0]" />;
}

/* ═══════════════════════════════════════════════════════════════
   M² Measurement Canvas (with corrected formula)
   ═══════════════════════════════════════════════════════════════ */

function M2MeasurementCanvas({
  w0, wavelength, zR, M2, noiseLevel, measurements, propagationDistance, beamColor,
}: {
  w0: number; wavelength: number; zR: number; M2: number; noiseLevel: number;
  measurements: { z: number; w: number }[]; propagationDistance: number; beamColor: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.parentElement?.clientWidth || 600;
    const h = 280;
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
    ctx.scale(dpr, dpr);

    const margin = { left: 60, right: 20, top: 25, bottom: 35 };
    const plotW = w - margin.left - margin.right;
    const plotH = h - margin.top - margin.bottom;
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = "#ebeef2"; ctx.lineWidth = 0.5;
    for (let x = margin.left; x <= w - margin.right; x += plotW / 10) {
      ctx.beginPath(); ctx.moveTo(x, margin.top); ctx.lineTo(x, h - margin.bottom); ctx.stroke();
    }
    for (let y = margin.top; y <= h - margin.bottom; y += plotH / 6) {
      ctx.beginPath(); ctx.moveTo(margin.left, y); ctx.lineTo(w - margin.right, y); ctx.stroke();
    }
    ctx.strokeStyle = "#9ca3af"; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(margin.left, h - margin.bottom); ctx.lineTo(w - margin.right, h - margin.bottom); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(margin.left, margin.top); ctx.lineTo(margin.left, h - margin.bottom); ctx.stroke();

    const zRange = propagationDistance;
    const numPts = 200;
    let maxW2 = 0;
    const idealPts: { z: number; w2: number }[] = [];
    const actualPts: { z: number; w2: number }[] = [];

    for (let i = 0; i <= numPts; i++) {
      const z = -zRange / 2 + (i / numPts) * zRange;
      const wIdeal = w0 * Math.sqrt(1 + (z / zR) * (z / zR));
      const wActual = correctedM2BeamWidth(z, w0, wavelength, M2);
      const w2I = wIdeal * wIdeal, w2A = wActual * wActual;
      idealPts.push({ z, w2: w2I });
      actualPts.push({ z, w2: w2A });
      if (w2A > maxW2) maxW2 = w2A;
      if (w2I > maxW2) maxW2 = w2I;
    }
    maxW2 *= 1.15;

    const zToX = (z: number) => margin.left + ((z + zRange / 2) / zRange) * plotW;
    const w2ToY = (w2: number) => margin.top + (1 - w2 / maxW2) * plotH;

    // Ideal dashed
    ctx.beginPath(); ctx.setLineDash([4, 3]);
    for (let i = 0; i < idealPts.length; i++) {
      const x = zToX(idealPts[i].z), y = w2ToY(idealPts[i].w2);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = "#9ca3af"; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);

    // Actual solid
    ctx.beginPath();
    for (let i = 0; i < actualPts.length; i++) {
      const x = zToX(actualPts[i].z), y = w2ToY(actualPts[i].w2);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = beamColor; ctx.lineWidth = 1.5; ctx.stroke();

    // Measurement points
    for (const m of measurements) {
      const x = zToX(m.z), y = w2ToY(m.w * m.w);
      if (x < margin.left || x > w - margin.right || y < margin.top || y > h - margin.bottom) continue;
      ctx.beginPath(); ctx.arc(x, y, 4, 0, 2 * Math.PI);
      ctx.fillStyle = "#cc3333"; ctx.fill();
      ctx.strokeStyle = "#cc3333"; ctx.lineWidth = 1; ctx.stroke();
    }

    // Regression line
    if (measurements.length >= 3) {
      const n = measurements.length;
      let sumZ = 0, sumW2 = 0, sumZ2 = 0, sumZW2 = 0;
      for (const m of measurements) { sumZ += m.z; sumW2 += m.w * m.w; sumZ2 += m.z * m.z; sumZW2 += m.z * m.w * m.w; }
      const denom = n * sumZ2 - sumZ * sumZ;
      if (denom !== 0) {
        const slope = (n * sumZW2 - sumZ * sumW2) / denom;
        const intercept = (sumW2 - slope * sumZ) / n;
        const measuredM2 = Math.sqrt(Math.max(0, slope * Math.PI / wavelength)) * w0;
        ctx.beginPath(); ctx.setLineDash([6, 3]);
        ctx.moveTo(zToX(-zRange / 2), w2ToY(Math.max(0, slope * (-zRange / 2) + intercept)));
        ctx.lineTo(zToX(zRange / 2), w2ToY(Math.max(0, slope * (zRange / 2) + intercept)));
        ctx.strokeStyle = "#cc3333"; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = "#cc3333"; ctx.font = "10px IBM Plex Sans"; ctx.textAlign = "right";
        ctx.fillText(`拟合 M² = ${measuredM2.toFixed(3)}`, w - margin.right, margin.top + 12);
        ctx.fillStyle = "#6b7280"; ctx.font = "9px IBM Plex Sans";
        ctx.fillText(`真实 M² = ${M2.toFixed(2)}`, w - margin.right, margin.top + 24);
      }
    }

    // Labels
    ctx.fillStyle = "#6b7280"; ctx.font = "9px IBM Plex Sans"; ctx.textAlign = "center";
    ctx.fillText("z (传播方向)", w / 2, h - 5);
    ctx.save(); ctx.translate(14, margin.top + plotH / 2); ctx.rotate(-Math.PI / 2);
    ctx.fillText("w²(z) [m²]", 0, 0); ctx.restore();
    ctx.fillStyle = "#2d3142"; ctx.font = "10px IBM Plex Sans"; ctx.textAlign = "left";
    ctx.fillText("w²(z) 线性回归 — M²测量 (修正公式)", margin.left + 5, margin.top + 12);
  }, [w0, wavelength, zR, M2, noiseLevel, measurements, propagationDistance, beamColor]);

  return <canvas ref={canvasRef} className="w-full border-t border-[#d4d8e0]" />;
}

/* ═══════════════════════════════════════════════════════════════
   HG Mode 2D Canvas (kept)
   ═══════════════════════════════════════════════════════════════ */

function HGModeCanvas({
  w0, zR, n, m, z, beamColor, size = 200,
}: { w0: number; zR: number; n: number; m: number; z: number; beamColor: string; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr; canvas.height = size * dpr;
    canvas.style.width = `${size}px`; canvas.style.height = `${size}px`;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, size, size);
    const w = w0 * Math.sqrt(1 + (z / zR) * (z / zR));
    const extent = w * 3;
    const resolution = size;
    const imageData = ctx.createImageData(resolution, resolution);
    const [pr, pg, pb] = parseHexColor(beamColor);
    for (let iy = 0; iy < resolution; iy++) {
      for (let ix = 0; ix < resolution; ix++) {
        const xv = ((ix / resolution) - 0.5) * 2 * extent;
        const yv = ((iy / resolution) - 0.5) * 2 * extent;
        const intensity = hermiteGaussianIntensity(xv, yv, z, w0, zR, n, m);
        const idx = (iy * resolution + ix) * 4;
        imageData.data[idx] = Math.round(pr * 255 * Math.min(intensity, 1));
        imageData.data[idx + 1] = Math.round(pg * 255 * Math.min(intensity, 1));
        imageData.data[idx + 2] = Math.round(pb * 255 * Math.min(intensity, 1));
        imageData.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(imageData, 0, 0);
    ctx.strokeStyle = "#d4d8e0"; ctx.lineWidth = 0.5; ctx.strokeRect(0, 0, size, size);
  }, [w0, zR, n, m, z, beamColor, size]);
  return <canvas ref={canvasRef} />;
}

/* ═══════════════════════════════════════════════════════════════
   Parameter Scanner Canvas — overlaid w(z) curves
   ═══════════════════════════════════════════════════════════════ */

function ParamScannerCanvas({
  w0, wavelengthNm, zR, propagationDistance,
  scanParam, scanMin, scanMax, scanSteps,
}: {
  w0: number; wavelengthNm: number; zR: number; propagationDistance: number;
  scanParam: "wavelength" | "beam-waist";
  scanMin: number; scanMax: number; scanSteps: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.parentElement?.clientWidth || 600;
    const ch = 280;
    canvas.width = cw * dpr; canvas.height = ch * dpr;
    canvas.style.width = `${cw}px`; canvas.style.height = `${ch}px`;
    ctx.scale(dpr, dpr);

    const margin = { left: 55, right: 20, top: 25, bottom: 35 };
    const plotW = cw - margin.left - margin.right;
    const plotH = ch - margin.top - margin.bottom;
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, cw, ch);

    // Grid
    ctx.strokeStyle = "#ebeef2"; ctx.lineWidth = 0.5;
    for (let x = margin.left; x <= cw - margin.right; x += plotW / 10) {
      ctx.beginPath(); ctx.moveTo(x, margin.top); ctx.lineTo(x, ch - margin.bottom); ctx.stroke();
    }
    for (let y = margin.top; y <= ch - margin.bottom; y += plotH / 6) {
      ctx.beginPath(); ctx.moveTo(margin.left, y); ctx.lineTo(cw - margin.right, y); ctx.stroke();
    }
    ctx.strokeStyle = "#9ca3af"; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(margin.left, ch - margin.bottom); ctx.lineTo(cw - margin.right, ch - margin.bottom); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(margin.left, margin.top); ctx.lineTo(margin.left, ch - margin.bottom); ctx.stroke();

    // Generate curves
    const numPts = 200;
    let maxW = 0;
    const curves: { label: string; points: { z: number; w: number }[] }[] = [];

    for (let step = 0; step < scanSteps; step++) {
      const frac = scanSteps === 1 ? 0 : step / (scanSteps - 1);
      const paramVal = scanMin + frac * (scanMax - scanMin);
      let curW0 = w0;
      let curWL = wavelengthNm;
      if (scanParam === "wavelength") curWL = paramVal;
      else curW0 = paramVal * 1e-3; // mm to m

      const curZR = (Math.PI * curW0 * curW0) / (curWL * 1e-9);
      const pts: { z: number; w: number }[] = [];
      for (let i = 0; i <= numPts; i++) {
        const z = (i / numPts) * propagationDistance;
        const w = curW0 * Math.sqrt(1 + (z / curZR) * (z / curZR));
        pts.push({ z, w });
        if (w > maxW) maxW = w;
      }
      const label = scanParam === "wavelength" ? `λ=${paramVal.toFixed(0)}nm` : `w₀=${paramVal.toFixed(2)}mm`;
      curves.push({ label, points: pts });
    }
    maxW *= 1.15;

    const zToX = (z: number) => margin.left + (z / propagationDistance) * plotW;
    const wToY = (wv: number) => margin.top + (1 - wv / maxW) * plotH;

    // Draw curves
    for (const curve of curves) {
      ctx.beginPath();
      for (let i = 0; i < curve.points.length; i++) {
        const x = zToX(curve.points[i].z), y = wToY(curve.points[i].w);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Legend
    ctx.fillStyle = "#ffffff";
    const legendH = Math.min(curves.length * 14 + 8, 120);
    const legendW = 130;
    const lx = margin.left + 5, ly = ch - margin.bottom - legendH - 5;
    ctx.fillRect(lx, ly, legendW, legendH);
    ctx.strokeStyle = "#d4d8e0"; ctx.lineWidth = 0.5; ctx.strokeRect(lx, ly, legendW, legendH);
    ctx.font = "7px IBM Plex Sans"; ctx.textAlign = "left";
    const maxLegend = Math.min(curves.length, 8);
    for (let i = 0; i < maxLegend; i++) {
      const cy = ly + 8 + i * 14;
      ctx.strokeStyle = "#000000"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(lx + 4, cy); ctx.lineTo(lx + 18, cy); ctx.stroke();
      ctx.fillStyle = "#333333";
      ctx.fillText(curves[i].label, lx + 22, cy + 3);
    }

    // Axis labels
    ctx.fillStyle = "#6b7280"; ctx.font = "9px IBM Plex Sans"; ctx.textAlign = "center";
    ctx.fillText("z (m)", cw / 2, ch - 5);
    ctx.save(); ctx.translate(12, margin.top + plotH / 2); ctx.rotate(-Math.PI / 2);
    ctx.fillText("w(z) 光束宽度", 0, 0); ctx.restore();

    // Title
    ctx.fillStyle = "#2d3142"; ctx.font = "10px IBM Plex Sans"; ctx.textAlign = "left";
    const paramLabel = scanParam === "wavelength" ? "波长" : "束腰";
    ctx.fillText(`参数扫描: ${paramLabel} (${scanSteps}步)`, margin.left + 5, margin.top + 12);
  }, [w0, wavelengthNm, zR, propagationDistance, scanParam, scanMin, scanMax, scanSteps]);

  return <canvas ref={canvasRef} className="w-full border-t border-[#d4d8e0]" />;
}

/* ═══════════════════════════════════════════════════════════════
   Main Component
   ═══════════════════════════════════════════════════════════════ */

export default function GaussianBeamTracer({
  onBack,
}: {
  onBack: () => void;
}) {
  const [expMode, setExpMode] = useState<ExperimentMode>("basic");

  // Basic mode state
  const [w0, setW0] = useState(0.5); // mm
  const [wavelength, setWavelength] = useState(632.8); // nm
  const [propagationDistance, setPropagationDistance] = useState(5); // m
  const [lensFocalLength, setLensFocalLength] = useState(0.5); // m
  const [lensPosition, setLensPosition] = useState(0.5); // m
  const [showLens, setShowLens] = useState(false);
  const [observationZ, setObservationZ] = useState(0.5); // m

  // Multi-lens system (up to 5)
  const [lenses, setLenses] = useState<LensConfig[]>([
    { position: 0.5, focalLength: 0.3 },
  ]);

  // M² measurement mode state
  const [trueM2, setTrueM2] = useState(1.5);
  const [noiseLevel, setNoiseLevel] = useState(0.05);
  const [detectorZ, setDetectorZ] = useState(0.5);
  const [measurements, setMeasurements] = useState<{ z: number; w: number }[]>([]);

  // Higher-order mode state
  const [hgN, setHgN] = useState(0);
  const [hgM, setHgM] = useState(0);
  const [hgZ, setHgZ] = useState(0);
  const [show3DMode, setShow3DMode] = useState(false);

  // Mode matching state
  const [matchLens1F, setMatchLens1F] = useState(0.3);
  const [matchLens2F, setMatchLens2F] = useState(0.5);
  const [matchLens2Pos, setMatchLens2Pos] = useState(1.5);

  // Spatial filter state
  const [pinholeDiameter, setPinholeDiameter] = useState(0); // 0 = no pinhole

  // Parameter scanner state
  const [scanParam, setScanParam] = useState<"wavelength" | "beam-waist">("wavelength");
  const [scanMin, setScanMin] = useState(405);
  const [scanMax, setScanMax] = useState(700);
  const [scanSteps, setScanSteps] = useState(5);

  // Compute beam using multi-lens chain when applicable
  const activeLenses = useMemo(() => {
    if (expMode === "basic" && showLens) {
      return [{ position: lensPosition, focalLength: lensFocalLength }];
    }
    if (expMode === "lens-transform" || expMode === "mode-matching" || expMode === "spatial-filter") {
      return lenses.filter(l => l.focalLength !== 0 && l.position > 0);
    }
    return [];
  }, [expMode, showLens, lensPosition, lensFocalLength, lenses]);

  const chainResult = useMemo(
    () => multiLensABCDChain(w0 * 1e-3, wavelength * 1e-9, activeLenses, propagationDistance),
    [w0, wavelength, activeLenses, propagationDistance]
  );

  // Single-lens beam result (for basic info panel)
  const beamParams: GaussianBeamParams = useMemo(
    () => ({
      w0: w0 * 1e-3,
      wavelength: wavelength * 1e-9,
      propagationDistance,
      lensFocalLength: showLens ? lensFocalLength : 0,
      lensPosition,
      M2: expMode === "m2-measurement" ? trueM2 : 1,
      observationZ,
    }),
    [w0, wavelength, propagationDistance, lensFocalLength, lensPosition, showLens, expMode, trueM2, observationZ]
  );
  const beamResult = useMemo(() => calculateGaussianBeam(beamParams), [beamParams]);
  const beamColor = useMemo(() => getWavelengthColor(wavelength), [wavelength]);

  // Width function depends on mode
  const widthAt = useMemo(() => {
    if (expMode === "m2-measurement") {
      return (z: number) => correctedM2BeamWidth(z, w0 * 1e-3, wavelength * 1e-9, trueM2);
    }
    return chainResult.widthAt;
  }, [expMode, chainResult, w0, wavelength, trueM2]);

  const zR = beamResult.rayleighRange;

  // Observation point computed values
  const obsW = useMemo(() => widthAt(observationZ), [widthAt, observationZ]);
  const obsGouy = beamResult.gouyPhaseAtObs;
  const obsR = beamResult.radiusOfCurvatureAtObs;
  const obsPower = useMemo(
    () => powerContainment(obsW, observationZ, w0 * 1e-3, zR),
    [obsW, observationZ, w0, zR]
  );

  // Mode matching efficiency
  const matchEfficiency = useMemo(() => {
    const matchLenses: LensConfig[] = [
      { position: 0.5, focalLength: matchLens1F },
      { position: matchLens2Pos, focalLength: matchLens2F },
    ];
    const chain = multiLensABCDChain(w0 * 1e-3, wavelength * 1e-9, matchLenses, propagationDistance);
    // Find the minimum beam width (focused waist) in the last segment
    const lastSeg = chain.segments[chain.segments.length - 1];
    if (!lastSeg) return 0;
    const outputW0 = lastSeg.w0;
    return modeCouplingEfficiency(w0 * 1e-3, outputW0);
  }, [w0, wavelength, matchLens1F, matchLens2F, matchLens2Pos, propagationDistance]);

  // M² measurement
  const recordMeasurement = useCallback(() => {
    const z = detectorZ;
    const idealW = correctedM2BeamWidth(z, w0 * 1e-3, wavelength * 1e-9, trueM2);
    const noise = 1 + (Math.random() - 0.5) * 2 * noiseLevel;
    setMeasurements(prev => [...prev, { z, w: idealW * noise }]);
  }, [detectorZ, w0, wavelength, trueM2, noiseLevel]);

  const clearMeasurements = useCallback(() => setMeasurements([]), []);

  // Lens management
  const addLens = useCallback(() => {
    if (lenses.length >= 5) return;
    const lastPos = lenses.length > 0 ? lenses[lenses.length - 1].position + 0.5 : 0.5;
    setLenses(prev => [...prev, { position: Math.min(lastPos, propagationDistance - 0.1), focalLength: 0.3 }]);
  }, [lenses, propagationDistance]);

  const removeLens = useCallback((idx: number) => {
    setLenses(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const updateLens = useCallback((idx: number, field: "position" | "focalLength", value: number) => {
    setLenses(prev => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  }, []);

  const m2Score = useMemo(() => {
    if (measurements.length < 3) return null;
    const n = measurements.length;
    let sumZ = 0, sumW2 = 0, sumZ2 = 0, sumZW2 = 0;
    for (const m of measurements) { sumZ += m.z; sumW2 += m.w * m.w; sumZ2 += m.z * m.z; sumZW2 += m.z * m.w * m.w; }
    const denom = n * sumZ2 - sumZ * sumZ;
    if (denom === 0) return null;
    const slope = (n * sumZW2 - sumZ * sumW2) / denom;
    const measuredM2 = Math.sqrt(Math.max(0, slope * Math.PI / (wavelength * 1e-9))) * w0 * 1e-3;
    const error = Math.abs(measuredM2 - trueM2) / trueM2 * 100;
    return { measuredM2, error, score: Math.max(0, 100 - error * 10) };
  }, [measurements, trueM2, w0, wavelength]);

  return (
    <div className="flex h-full flex-col" style={{ background: "#FFFFFF" }}>
      {/* Header bar */}
      <div className="flex flex-shrink-0 items-center flex-wrap" style={{ height: "48px", backgroundColor: "#FFFFFF", borderBottom: "1px solid #d4d8e0", paddingLeft: "24px", paddingRight: "24px" }}>
        <button onClick={onBack} className="flex items-center gap-1 border-none bg-none text-[12px] font-normal text-[#555555] transition-colors duration-200 hover:text-[#1a1a1a]" style={{ cursor: "pointer" }}>
          ← 返回
        </button>
        <span style={{ margin: "0 12px", color: "#D0D0D0" }}>|</span>
        <h1 className="m-0 text-[20px] font-semibold text-[#1A1A1A]" style={{ fontFamily: "var(--font-ibm-plex-sans), system-ui, sans-serif" }}>
          高斯光束追踪器
        </h1>

        {/* Mode tabs */}
        <div className="ml-4 flex gap-1 flex-wrap">
          {(Object.keys(MODE_LABELS) as ExperimentMode[]).map((mode) => (
            <button key={mode} onClick={() => setExpMode(mode)}
              className="border-[1px] px-2 py-1 text-[10px] transition-colors duration-150"
              style={{ fontFamily: "var(--font-ibm-plex-sans), system-ui, sans-serif", borderColor: expMode === mode ? "#333333" : "#d4d8e0", backgroundColor: expMode === mode ? "#F0F3F6" : "#ffffff", fontWeight: expMode === mode ? 600 : 400, color: expMode === mode ? "#1a1a2e" : "#6b7280", cursor: "pointer", borderRadius: "2px" }}
            >
              {MODE_LABELS[mode]}
            </button>
          ))}
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1" style={{ minHeight: 0 }}>
        {/* Left Control Panel */}
        <div className="w-72 shrink-0 overflow-y-auto border-r border-[#d4d8e0] bg-[#f8f9fb] p-4 custom-scrollbar">
          <div className="space-y-5">
            {/* ─── Basic Controls (shared) ─── */}
            <div>
              <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[#6b7280]" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>光束参数</h3>

              {/* Wavelength */}
              <div className="mb-4 space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-[12px] text-[#2d3142]">波长 λ</Label>
                  <span className="mono-digits text-[11px] text-[#6b7280]">{wavelength} nm</span>
                </div>
                <Select value={String(wavelength)} onValueChange={(v) => setWavelength(Number(v))}>
                  <SelectTrigger className="h-8 text-[12px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="632.8">632.8 nm — He-Ne 红</SelectItem>
                    <SelectItem value="532">532 nm — Nd:YAG 绿</SelectItem>
                    <SelectItem value="405">405 nm — 蓝紫</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Beam waist */}
              <div className="mb-4 space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-[12px] text-[#2d3142]">束腰半径 w₀</Label>
                  <span className="mono-digits text-[11px] text-[#6b7280]">{w0.toFixed(2)} mm</span>
                </div>
                <Slider value={[w0]} onValueChange={([v]) => setW0(v)} min={0.05} max={3} step={0.01} className="mt-1" />
              </div>

              {/* Propagation distance */}
              <div className="mb-4 space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-[12px] text-[#2d3142]">传输距离</Label>
                  <span className="mono-digits text-[11px] text-[#6b7280]">{propagationDistance.toFixed(1)} m</span>
                </div>
                <Slider value={[propagationDistance]} onValueChange={([v]) => setPropagationDistance(v)} min={0.5} max={20} step={0.1} />
              </div>
            </div>

            {/* ─── BASIC MODE ─── */}
            {expMode === "basic" && (
              <>
                <div className="border-t border-[#d4d8e0] pt-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[#6b7280]" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>透镜</h3>
                    <Switch checked={showLens} onCheckedChange={setShowLens} />
                  </div>
                  {showLens && (
                    <>
                      <div className="mb-3 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <Label className="text-[12px] text-[#2d3142]">焦距 f</Label>
                          <span className="mono-digits text-[11px] text-[#6b7280]">{lensFocalLength.toFixed(2)} m</span>
                        </div>
                        <Slider value={[lensFocalLength]} onValueChange={([v]) => setLensFocalLength(v)} min={0.05} max={5} step={0.01} />
                      </div>
                      <div className="mb-3 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <Label className="text-[12px] text-[#2d3142]">透镜位置</Label>
                          <span className="mono-digits text-[11px] text-[#6b7280]">{lensPosition.toFixed(2)} m</span>
                        </div>
                        <Slider value={[lensPosition]} onValueChange={([v]) => setLensPosition(v)} min={0} max={propagationDistance / 2} step={0.01} />
                      </div>
                    </>
                  )}
                </div>

                <div className="border-t border-[#d4d8e0] pt-4">
                  <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[#6b7280]" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>观测点</h3>
                  <div className="mb-3 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-[12px] text-[#2d3142]">观测位置 z</Label>
                      <span className="mono-digits text-[11px] text-[#6b7280]">{observationZ.toFixed(2)} m</span>
                    </div>
                    <Slider value={[observationZ]} onValueChange={([v]) => setObservationZ(v)} min={0} max={propagationDistance} step={0.01} />
                  </div>
                </div>

                <div className="border-t border-[#d4d8e0] pt-4">
                  <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[#6b7280]" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>计算结果</h3>
                  <div className="space-y-2 rounded border border-[#d4d8e0] bg-white p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-[#6b7280]">瑞利范围 z_R</span>
                      <span className="mono-digits text-[12px] font-medium text-[#1a1a2e]">{formatSI(zR, "m")}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-[#6b7280]">远场发散角 θ</span>
                      <span className="mono-digits text-[12px] font-medium text-[#1a1a2e]">{(beamResult.divergence * 1000).toFixed(3)} mrad</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-[#6b7280]">光束宽度 w(z)</span>
                      <span className="mono-digits text-[12px] font-medium text-[#1a1a2e]">{formatSI(obsW, "m")}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-[#6b7280]">Gouy相位 ψ(z)</span>
                      <span className="mono-digits text-[12px] font-medium text-[#1a1a2e]">{(obsGouy * 180 / Math.PI).toFixed(1)}°</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-[#6b7280]">曲率半径 R(z)</span>
                      <span className="mono-digits text-[12px] font-medium text-[#1a1a2e]">{isFinite(obsR) ? formatSI(obsR, "m") : "∞"}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-[#6b7280]">功率包含率</span>
                      <span className="mono-digits text-[12px] font-medium text-[#1a1a2e]">{(obsPower * 100).toFixed(1)}%</span>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* ─── LENS TRANSFORM / MODE MATCHING / SPATIAL FILTER ─── */}
            {(expMode === "lens-transform" || expMode === "mode-matching" || expMode === "spatial-filter") && (
              <>
                <div className="border-t border-[#d4d8e0] pt-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[#6b7280]" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>透镜组 ({lenses.length}/5)</h3>
                    <button onClick={addLens} disabled={lenses.length >= 5}
                      className="border border-[#d4d8e0] bg-white px-2 py-0.5 text-[10px] text-[#6b7280] hover:bg-[#f0f3f6] disabled:opacity-40"
                      style={{ cursor: "pointer", borderRadius: "2px" }}
                    >+ 添加</button>
                  </div>
                  <div className="space-y-3 max-h-96 overflow-y-auto custom-scrollbar">
                    {lenses.map((lens, idx) => (
                      <div key={idx} className="rounded border border-[#d4d8e0] bg-white p-2.5 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-semibold text-[#4a4a5a]">L{idx + 1}</span>
                          <button onClick={() => removeLens(idx)} className="text-[10px] text-[#cc3333] hover:text-[#990000]" style={{ cursor: "pointer" }}>删除</button>
                        </div>
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <Label className="text-[10px] text-[#2d3142]">位置 z</Label>
                            <span className="mono-digits text-[10px] text-[#6b7280]">{lens.position.toFixed(2)} m</span>
                          </div>
                          <Slider value={[lens.position]} onValueChange={([v]) => updateLens(idx, "position", v)} min={0.1} max={propagationDistance - 0.1} step={0.01} />
                        </div>
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <Label className="text-[10px] text-[#2d3142]">焦距 f</Label>
                            <span className="mono-digits text-[10px] text-[#6b7280]">{lens.focalLength.toFixed(2)} m</span>
                          </div>
                          <Slider value={[lens.focalLength]} onValueChange={([v]) => updateLens(idx, "focalLength", v)} min={-5} max={5} step={0.01} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Observation point */}
                <div className="border-t border-[#d4d8e0] pt-4">
                  <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[#6b7280]" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>观测点</h3>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-[12px] text-[#2d3142]">观测位置 z</Label>
                      <span className="mono-digits text-[11px] text-[#6b7280]">{observationZ.toFixed(2)} m</span>
                    </div>
                    <Slider value={[observationZ]} onValueChange={([v]) => setObservationZ(v)} min={0} max={propagationDistance} step={0.01} />
                  </div>
                </div>

                {/* Mode matching info */}
                {expMode === "mode-matching" && (
                  <div className="border-t border-[#d4d8e0] pt-4">
                    <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[#6b7280]" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>耦合效率</h3>
                    <div className="rounded border border-[#d4d8e0] bg-white p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-[#6b7280]">η 模式耦合效率</span>
                        <span className="mono-digits text-[14px] font-bold" style={{ color: matchEfficiency > 0.9 ? "#008800" : matchEfficiency > 0.5 ? "#cc8800" : "#cc0000" }}>
                          {(matchEfficiency * 100).toFixed(1)}%
                        </span>
                      </div>
                      <div className="w-full h-2 bg-[#ebeef2] rounded">
                        <div className="h-full rounded" style={{ width: `${matchEfficiency * 100}%`, backgroundColor: matchEfficiency > 0.9 ? "#008800" : matchEfficiency > 0.5 ? "#cc8800" : "#cc0000" }} />
                      </div>
                      <p className="text-[9px] text-[#9ca3af]">
                        η = (2w₁w₂/(w₁²+w₂²))² · 调整透镜位置和焦距来优化匹配
                      </p>
                    </div>
                  </div>
                )}

                {/* Spatial filter pinhole */}
                {expMode === "spatial-filter" && (
                  <div className="border-t border-[#d4d8e0] pt-4">
                    <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[#6b7280]" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>空间滤波器</h3>
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label className="text-[12px] text-[#2d3142]">针孔直径</Label>
                        <span className="mono-digits text-[11px] text-[#6b7280]">{pinholeDiameter === 0 ? "关闭" : formatSI(pinholeDiameter, "m")}</span>
                      </div>
                      <Slider value={[pinholeDiameter]} onValueChange={([v]) => setPinholeDiameter(v)} min={0} max={w0 * 1e-3 * 10} step={w0 * 1e-3 * 0.1} />
                    </div>
                    <p className="text-[9px] text-[#9ca3af] mt-2">
                      小针孔过滤高阶空间模式，使光束更接近高斯分布
                    </p>
                  </div>
                )}

                {/* Chain result info */}
                <div className="border-t border-[#d4d8e0] pt-4">
                  <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[#6b7280]" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>ABCD链结果</h3>
                  <div className="rounded border border-[#d4d8e0] bg-white p-2.5 space-y-1 text-[10px]">
                    {chainResult.segments.map((seg, i) => (
                      <div key={i} className="flex items-center justify-between">
                        <span className="text-[#6b7280]">段{i + 1}: z={seg.zStart.toFixed(1)}–{seg.zEnd.toFixed(1)}m</span>
                        <span className="mono-digits text-[#1a1a2e]">w₀={formatSI(seg.w0, "m")}</span>
                      </div>
                    ))}
                    {chainResult.focalPoints.map((fp, i) => (
                      <div key={`fp${i}`} className="flex items-center justify-between text-[#cc3333]">
                        <span>焦点{i + 1}</span>
                        <span className="mono-digits">z={fp.z.toFixed(3)}m</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* ─── GOUY PHASE ─── */}
            {expMode === "gouy-phase" && (
              <div className="border-t border-[#d4d8e0] pt-4">
                <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[#6b7280]" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>观测点</h3>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-[12px] text-[#2d3142]">观测位置 z</Label>
                    <span className="mono-digits text-[11px] text-[#6b7280]">{observationZ.toFixed(2)} m</span>
                  </div>
                  <Slider value={[observationZ]} onValueChange={([v]) => setObservationZ(v)} min={0} max={propagationDistance} step={0.01} />
                </div>
                <div className="mt-3 rounded border border-[#d4d8e0] bg-white p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-[#6b7280]">z_R</span>
                    <span className="mono-digits text-[12px] font-medium text-[#1a1a2e]">{formatSI(zR, "m")}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-[#6b7280]">ψ(obs)</span>
                    <span className="mono-digits text-[12px] font-medium text-[#1a1a2e]">{(obsGouy * 180 / Math.PI).toFixed(1)}°</span>
                  </div>
                </div>
              </div>
            )}

            {/* ─── M² MEASUREMENT ─── */}
            {expMode === "m2-measurement" && (
              <>
                <div className="border-t border-[#d4d8e0] pt-4">
                  <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[#6b7280]" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>M²参数</h3>
                  <div className="space-y-1.5 mb-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-[12px] text-[#2d3142]">真实 M²</Label>
                      <span className="mono-digits text-[11px] text-[#6b7280]">{trueM2.toFixed(1)}</span>
                    </div>
                    <Slider value={[trueM2]} onValueChange={([v]) => setTrueM2(v)} min={1} max={5} step={0.1} />
                  </div>
                  <div className="space-y-1.5 mb-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-[12px] text-[#2d3142]">噪声水平</Label>
                      <span className="mono-digits text-[11px] text-[#6b7280]">{(noiseLevel * 100).toFixed(0)}%</span>
                    </div>
                    <Slider value={[noiseLevel]} onValueChange={([v]) => setNoiseLevel(v)} min={0} max={0.2} step={0.01} />
                  </div>
                  <div className="space-y-1.5 mb-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-[12px] text-[#2d3142]">探测器位置 z</Label>
                      <span className="mono-digits text-[11px] text-[#6b7280]">{detectorZ.toFixed(2)} m</span>
                    </div>
                    <Slider value={[detectorZ]} onValueChange={([v]) => setDetectorZ(v)} min={0} max={propagationDistance} step={0.01} />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={recordMeasurement} className="flex-1 border border-[#333] bg-[#F0F3F6] px-2 py-1.5 text-[11px] font-medium text-[#1a1a2e]" style={{ cursor: "pointer", borderRadius: "2px" }}>
                      记录测量点
                    </button>
                    <button onClick={clearMeasurements} className="border border-[#d4d8e0] bg-white px-2 py-1.5 text-[11px] text-[#6b7280]" style={{ cursor: "pointer", borderRadius: "2px" }}>
                      清除
                    </button>
                  </div>
                  {m2Score && (
                    <div className="mt-3 rounded border border-[#d4d8e0] bg-white p-2.5 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-[#6b7280]">拟合 M²</span>
                        <span className="mono-digits text-[11px] text-[#cc3333]">{m2Score.measuredM2.toFixed(3)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-[#6b7280]">误差</span>
                        <span className="mono-digits text-[11px] text-[#6b7280]">{m2Score.error.toFixed(1)}%</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-[#6b7280]">评分</span>
                        <span className="mono-digits text-[12px] font-bold" style={{ color: m2Score.score > 80 ? "#008800" : m2Score.score > 50 ? "#cc8800" : "#cc0000" }}>{m2Score.score.toFixed(0)}</span>
                      </div>
                      <p className="text-[8px] text-[#9ca3af]">修正公式: w(z) = w₀√(1 + M⁴(λz/πw₀²)²)</p>
                    </div>
                  )}
                  <p className="text-[9px] text-[#9ca3af] mt-2">已记录 {measurements.length} 个测量点 (至少3个)</p>
                </div>
              </>
            )}

            {/* ─── HIGHER ORDER ─── */}
            {expMode === "higher-order" && (
              <>
                <div className="border-t border-[#d4d8e0] pt-4">
                  <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[#6b7280]" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>HG模式</h3>
                  <div className="space-y-1.5 mb-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-[12px] text-[#2d3142]">n</Label>
                      <span className="mono-digits text-[11px] text-[#6b7280]">{hgN}</span>
                    </div>
                    <Slider value={[hgN]} onValueChange={([v]) => setHgN(Math.round(v))} min={0} max={4} step={1} />
                  </div>
                  <div className="space-y-1.5 mb-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-[12px] text-[#2d3142]">m</Label>
                      <span className="mono-digits text-[11px] text-[#6b7280]">{hgM}</span>
                    </div>
                    <Slider value={[hgM]} onValueChange={([v]) => setHgM(Math.round(v))} min={0} max={4} step={1} />
                  </div>
                  <div className="space-y-1.5 mb-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-[12px] text-[#2d3142]">z 位置</Label>
                      <span className="mono-digits text-[11px] text-[#6b7280]">{hgZ.toFixed(2)} m</span>
                    </div>
                    <Slider value={[hgZ]} onValueChange={([v]) => setHgZ(v)} min={0} max={propagationDistance} step={0.01} />
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <Switch checked={show3DMode} onCheckedChange={setShow3DMode} />
                    <Label className="text-[11px] text-[#6b7280]">3D表面</Label>
                  </div>
                </div>
              </>
            )}

            {/* ─── PARAM SCANNER ─── */}
            {expMode === "param-scanner" && (
              <div className="border-t border-[#d4d8e0] pt-4">
                <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[#6b7280]" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>扫描参数</h3>
                <div className="space-y-1.5 mb-3">
                  <Label className="text-[12px] text-[#2d3142]">参数选择</Label>
                  <Select value={scanParam} onValueChange={(v) => { setScanParam(v as "wavelength" | "beam-waist"); if (v === "wavelength") { setScanMin(405); setScanMax(700); } else { setScanMin(0.1); setScanMax(3); } }}>
                    <SelectTrigger className="h-8 text-[12px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="wavelength">波长 λ</SelectItem>
                      <SelectItem value="beam-waist">束腰 w₀</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5 mb-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-[12px] text-[#2d3142]">{scanParam === "wavelength" ? "λ min (nm)" : "w₀ min (mm)"}</Label>
                    <span className="mono-digits text-[11px] text-[#6b7280]">{scanMin.toFixed(scanParam === "wavelength" ? 0 : 2)}</span>
                  </div>
                  <Slider value={[scanMin]} onValueChange={([v]) => setScanMin(v)} min={scanParam === "wavelength" ? 380 : 0.05} max={scanParam === "wavelength" ? 780 : 5} step={scanParam === "wavelength" ? 1 : 0.01} />
                </div>
                <div className="space-y-1.5 mb-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-[12px] text-[#2d3142]">{scanParam === "wavelength" ? "λ max (nm)" : "w₀ max (mm)"}</Label>
                    <span className="mono-digits text-[11px] text-[#6b7280]">{scanMax.toFixed(scanParam === "wavelength" ? 0 : 2)}</span>
                  </div>
                  <Slider value={[scanMax]} onValueChange={([v]) => setScanMax(v)} min={scanParam === "wavelength" ? 380 : 0.05} max={scanParam === "wavelength" ? 780 : 5} step={scanParam === "wavelength" ? 1 : 0.01} />
                </div>
                <div className="space-y-1.5 mb-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-[12px] text-[#2d3142]">步数</Label>
                    <span className="mono-digits text-[11px] text-[#6b7280]">{scanSteps}</span>
                  </div>
                  <Slider value={[scanSteps]} onValueChange={([v]) => setScanSteps(Math.round(v))} min={2} max={10} step={1} />
                </div>
              </div>
            )}

            {/* Formula Reference Card (shared) */}
            <div className="border-t border-[#d4d8e0] pt-4">
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#6b7280]" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>公式参考</h3>
              <div className="rounded border border-[#d4d8e0] bg-white p-2.5 space-y-1">
                <p className="text-[10px] text-[#6b7280]" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>w(z) = w₀√(1+(z/z_R)²)</p>
                <p className="text-[10px] text-[#6b7280]" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>z_R = πw₀²/λ</p>
                <p className="text-[10px] text-[#6b7280]" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>ψ(z) = arctan(z/z_R)</p>
                <p className="text-[10px] text-[#6b7280]" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>R(z) = z(1+(z_R/z)²)</p>
                <p className="text-[10px] text-[#9ca3af]" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>M²修正: w=w₀√(1+M⁴(z/z_R)²)</p>
              </div>
            </div>
          </div>
        </div>

        {/* Right Visualization Area */}
        <div className="flex-1 flex flex-col overflow-hidden" style={{ minHeight: 0 }}>
          {/* Subplot layout for modes with 3D + contourf + profile */}
          {(expMode === "basic" || expMode === "lens-transform" || expMode === "mode-matching" || expMode === "spatial-filter") && (
            <div className="flex-1 flex flex-col" style={{ minHeight: 0 }}>
              {/* Top row: 3D envelope (60%) + Contourf (40%) */}
              <div className="flex" style={{ height: "60%", minHeight: 0 }}>
                {/* 3D Beam Envelope */}
                <div className="relative" style={{ width: "60%", borderRight: "1px solid #d4d8e0" }}>
                  <MatlabBeamEnvelopeCanvas
                    widthAt={widthAt}
                    w0={w0 * 1e-3}
                    zR={zR}
                    propagationDistance={propagationDistance}
                    observationZ={observationZ}
                    lenses={activeLenses}
                    wavelengthNm={wavelength}
                  />
                </div>
                {/* Contourf cross-section */}
                <div className="relative" style={{ width: "40%" }}>
                  <ContourfCanvas
                    widthAt={widthAt}
                    w0={w0 * 1e-3}
                    zR={zR}
                    observationZ={observationZ}
                    wavelengthNm={wavelength}
                    pinholeDiameter={expMode === "spatial-filter" ? pinholeDiameter : 0}
                  />
                </div>
              </div>
              {/* Bottom: Beam profile envelope + Intensity profile */}
              <div className="flex" style={{ height: "40%", minHeight: 0, borderTop: "1px solid #d4d8e0" }}>
                <div style={{ width: "60%", borderRight: "1px solid #d4d8e0" }}>
                  <BeamProfileCanvas
                    beamParams={beamParams}
                    wavelength={wavelength}
                    observationZ={observationZ}
                    showGouyMode={false}
                    showObservationPoint={true}
                  />
                </div>
                <div style={{ width: "40%" }}>
                  <IntensityProfileCanvas
                    widthAt={widthAt}
                    w0={w0 * 1e-3}
                    zR={zR}
                    observationZ={observationZ}
                    wavelengthNm={wavelength}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Gouy Phase mode */}
          {expMode === "gouy-phase" && (
            <div className="flex-1 flex flex-col" style={{ minHeight: 0 }}>
              <div style={{ height: "55%", minHeight: 0 }}>
                <MatlabBeamEnvelopeCanvas
                  widthAt={widthAt}
                  w0={w0 * 1e-3}
                  zR={zR}
                  propagationDistance={propagationDistance}
                  observationZ={observationZ}
                  lenses={activeLenses}
                  wavelengthNm={wavelength}
                />
              </div>
              <div style={{ height: "45%", borderTop: "1px solid #d4d8e0" }}>
                <GouyPhaseCanvas
                  w0={w0 * 1e-3}
                  wavelength={wavelength * 1e-9}
                  zR={zR}
                  propagationDistance={propagationDistance}
                  observationZ={observationZ}
                  beamColor={beamColor}
                />
              </div>
            </div>
          )}

          {/* M² Measurement mode */}
          {expMode === "m2-measurement" && (
            <div className="flex-1 flex flex-col" style={{ minHeight: 0 }}>
              <div style={{ height: "50%", minHeight: 0 }}>
                <MatlabBeamEnvelopeCanvas
                  widthAt={widthAt}
                  w0={w0 * 1e-3}
                  zR={zR}
                  propagationDistance={propagationDistance}
                  observationZ={detectorZ}
                  lenses={[]}
                  wavelengthNm={wavelength}
                />
              </div>
              <div style={{ height: "50%", borderTop: "1px solid #d4d8e0" }}>
                <M2MeasurementCanvas
                  w0={w0 * 1e-3}
                  wavelength={wavelength * 1e-9}
                  zR={zR}
                  M2={trueM2}
                  noiseLevel={noiseLevel}
                  measurements={measurements}
                  propagationDistance={propagationDistance}
                  beamColor={beamColor}
                />
              </div>
            </div>
          )}

          {/* Higher Order mode */}
          {expMode === "higher-order" && (
            <div className="flex-1 flex flex-col p-4 gap-4 overflow-y-auto custom-scrollbar" style={{ minHeight: 0 }}>
              <div className="flex gap-4">
                <div>
                  <p className="text-[10px] text-[#6b7280] mb-1">HG{hgN}{hgM} 光斑 (z={hgZ.toFixed(2)}m)</p>
                  <HGModeCanvas w0={w0 * 1e-3} zR={zR} n={hgN} m={hgM} z={hgZ} beamColor={beamColor} size={200} />
                </div>
              </div>
              {show3DMode && (
                <div style={{ height: "350px" }}>
                  <p className="text-[10px] text-[#6b7280] mb-1">3D 强度表面</p>
                  {/* Placeholder for 3D HG surface - use beam envelope as approximation */}
                  <MatlabBeamEnvelopeCanvas
                    widthAt={widthAt}
                    w0={w0 * 1e-3}
                    zR={zR}
                    propagationDistance={propagationDistance}
                    observationZ={observationZ}
                    lenses={[]}
                    wavelengthNm={wavelength}
                  />
                </div>
              )}
            </div>
          )}

          {/* Parameter Scanner mode */}
          {expMode === "param-scanner" && (
            <div className="flex-1 flex flex-col" style={{ minHeight: 0 }}>
              <div style={{ height: "50%", minHeight: 0 }}>
                <ParamScannerCanvas
                  w0={w0}
                  wavelengthNm={wavelength}
                  zR={zR}
                  propagationDistance={propagationDistance}
                  scanParam={scanParam}
                  scanMin={scanMin}
                  scanMax={scanMax}
                  scanSteps={scanSteps}
                />
              </div>
              <div style={{ height: "50%", borderTop: "1px solid #d4d8e0" }}>
                <MatlabBeamEnvelopeCanvas
                  widthAt={widthAt}
                  w0={w0 * 1e-3}
                  zR={zR}
                  propagationDistance={propagationDistance}
                  observationZ={observationZ}
                  lenses={[]}
                  wavelengthNm={wavelength}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 flex items-center justify-between px-6 h-6 border-t border-[#d4d8e0] bg-[#f8f9fb] mt-auto" style={{ fontSize: "10px", color: "#9ca3af" }}>
        <span>v2.0 · 高斯光束追踪器 — ABCD矩阵 · 3D包络 · contourf</span>
        <span style={{ fontFamily: "var(--font-ibm-plex-mono)" }} className="tabular-nums">
          λ={wavelength}nm w₀={w0.toFixed(2)}mm z_R={formatSI(zR, "m")}
        </span>
      </div>
    </div>
  );
}
