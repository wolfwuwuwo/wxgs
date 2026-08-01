"use client";

import { useRef, useEffect, useMemo } from "react";
import {
  calculateGaussianBeam,
  getWavelengthColor,
  gouyPhase,
  radiusOfCurvature,
  formatSI,
  type GaussianBeamParams,
} from "@/lib/optics/gaussian-beam";

interface BeamProfileCanvasProps {
  beamParams: GaussianBeamParams;
  wavelength: number;
  /** Observation point z position in meters */
  observationZ?: number;
  /** Whether to show Gouy phase axis and R(z) curve */
  showGouyMode?: boolean;
  /** Whether to show observation point marker */
  showObservationPoint?: boolean;
}

function BeamProfileCanvas({
  beamParams,
  wavelength,
  observationZ = 0,
  showGouyMode = false,
  showObservationPoint = true,
}: BeamProfileCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const beamResult = useMemo(
    () => calculateGaussianBeam(beamParams),
    [beamParams]
  );
  const beamColor = useMemo(() => getWavelengthColor(wavelength), [wavelength]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.parentElement?.clientWidth || 600;
    const h = showGouyMode ? 240 : 180;
    if (w < 50) return;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.scale(dpr, dpr);

    const margin = { left: 55, right: showGouyMode ? 55 : 20, top: 20, bottom: 30 };
    const plotW = w - margin.left - margin.right;
    const plotH = h - margin.top - margin.bottom;

    // Clear - white background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = "#ebeef2";
    ctx.lineWidth = 0.5;
    for (let x = margin.left; x <= w - margin.right; x += plotW / 10) {
      ctx.beginPath();
      ctx.moveTo(x, margin.top);
      ctx.lineTo(x, h - margin.bottom);
      ctx.stroke();
    }
    for (let y = margin.top; y <= h - margin.bottom; y += plotH / 6) {
      ctx.beginPath();
      ctx.moveTo(margin.left, y);
      ctx.lineTo(w - margin.right, y);
      ctx.stroke();
    }

    // Axes
    ctx.strokeStyle = "#9ca3af";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(margin.left, h - margin.bottom);
    ctx.lineTo(w - margin.right, h - margin.bottom);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(margin.left, margin.top);
    ctx.lineTo(margin.left, h - margin.bottom);
    ctx.stroke();

    const points = beamResult.envelopePoints;
    if (points.length === 0) return;

    const zMin = points[0].z;
    const zMax = points[points.length - 1].z;
    const zSpan = zMax - zMin || 1;

    // Find max w for scaling
    let maxW = 0;
    for (const p of points) {
      if (p.w > maxW) maxW = p.w;
    }
    maxW = maxW * 1.15; // Add margin

    // Helper: z → x pixel
    const zToX = (z: number) => margin.left + ((z - zMin) / zSpan) * plotW;
    // Helper: w → y pixel (center of plot)
    const cy = margin.top + plotH / 2;
    const wToY = (wv: number) => cy - (wv / maxW) * (plotH / 2);

    // Draw beam spots at regular intervals
    const numSpots = 9;
    for (let i = 0; i < numSpots; i++) {
      const frac = i / (numSpots - 1);
      const z = zMin + frac * zSpan;
      const wz = beamResult.widthAt(z);

      const x = zToX(z);
      const rPixels = (wz / maxW) * (plotH / 2);

      // Draw spot circle with solid fill
      ctx.beginPath();
      ctx.arc(x, cy, rPixels, 0, 2 * Math.PI);
      ctx.fillStyle = beamColor;
      ctx.globalAlpha = 0.15;
      ctx.fill();
      ctx.globalAlpha = 1;

      // Draw spot circle with clear boundary
      ctx.beginPath();
      ctx.arc(x, cy, rPixels, 0, 2 * Math.PI);
      ctx.strokeStyle = beamColor;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    // Draw envelope curves (upper and lower)
    // Upper envelope: w(z)
    ctx.beginPath();
    for (let i = 0; i < points.length; i++) {
      const x = zToX(points[i].z);
      const y = wToY(points[i].w);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = beamColor;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Lower envelope: -w(z)
    ctx.beginPath();
    for (let i = 0; i < points.length; i++) {
      const x = zToX(points[i].z);
      const y = cy + (points[i].w / maxW) * (plotH / 2);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = beamColor;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Fill between envelopes
    ctx.beginPath();
    for (let i = 0; i < points.length; i++) {
      const x = zToX(points[i].z);
      const y = wToY(points[i].w);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    for (let i = points.length - 1; i >= 0; i--) {
      const x = zToX(points[i].z);
      const y = cy + (points[i].w / maxW) * (plotH / 2);
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = beamColor;
    ctx.globalAlpha = 0.04;
    ctx.fill();
    ctx.globalAlpha = 1;

    // Rayleigh range markers
    const zRFrac1 = (beamResult.rayleighRange - zMin) / zSpan;
    const zRFrac2 = (-beamResult.rayleighRange - zMin) / zSpan;
    for (const zRFrac of [zRFrac1, zRFrac2]) {
      if (zRFrac >= 0 && zRFrac <= 1) {
        const x = margin.left + zRFrac * plotW;
        ctx.setLineDash([3, 2]);
        ctx.beginPath();
        ctx.moveTo(x, margin.top);
        ctx.lineTo(x, h - margin.bottom);
        ctx.strokeStyle = "#9ca3af";
        ctx.lineWidth = 0.8;
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Beam waist marker
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    const w0x = zToX(0);
    ctx.moveTo(w0x, margin.top);
    ctx.lineTo(w0x, h - margin.bottom);
    ctx.strokeStyle = "#6b7280";
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.setLineDash([]);

    // w₀ label
    ctx.fillStyle = "#6b7280";
    ctx.font = "10px IBM Plex Sans";
    ctx.textAlign = "center";
    ctx.fillText("w₀", w0x, margin.top - 5);

    // z_R label
    if (zRFrac1 >= 0 && zRFrac1 <= 1) {
      const x = margin.left + zRFrac1 * plotW;
      ctx.fillText("z_R", x, margin.top - 5);
    }

    // --- R(z) curve (dashed) in Gouy mode ---
    if (showGouyMode) {
      // Compute R(z) for all points, find max |R| that is finite
      const rValues: number[] = [];
      let maxR = 0;
      for (const p of points) {
        const dz = p.z; // distance from waist (original segment)
        const R = radiusOfCurvature(dz, beamResult.rayleighRange);
        rValues.push(R);
        if (isFinite(R) && Math.abs(R) > maxR) maxR = Math.abs(R);
      }

      // Draw R(z) as dashed line on secondary y-axis (right side)
      if (maxR > 0) {
        const rScale = plotH / 2 / (maxR * 1.15);
        ctx.beginPath();
        ctx.setLineDash([5, 3]);
        let started = false;
        for (let i = 0; i < points.length; i++) {
          const R = rValues[i];
          if (!isFinite(R)) continue;
          const x = zToX(points[i].z);
          const y = cy - R * rScale;
          if (y < margin.top || y > h - margin.bottom) continue;
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.strokeStyle = "#b07020";
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.setLineDash([]);

        // Secondary y-axis label
        ctx.fillStyle = "#b07020";
        ctx.font = "9px IBM Plex Sans";
        ctx.textAlign = "left";
        ctx.fillText("R(z)", w - margin.right + 5, margin.top + 10);

        // R(z) tick marks on right side
        ctx.font = "7px IBM Plex Mono";
        ctx.fillStyle = "#b07020";
        ctx.textAlign = "left";
        const rTicks = 4;
        for (let i = 0; i <= rTicks; i++) {
          const frac = i / rTicks;
          const Rval = -maxR * 1.15 + frac * 2 * maxR * 1.15;
          const y = cy - Rval * rScale;
          if (y >= margin.top && y <= h - margin.bottom) {
            ctx.fillText(formatSI(Rval, "m"), w - margin.right + 4, y + 3);
          }
        }
      }
    }

    // --- Gouy phase secondary y-axis in Gouy mode ---
    if (showGouyMode) {
      // Plot Gouy phase ψ(z) from -π/2 to π/2
      const phaseScale = plotH / Math.PI; // full height spans π
      ctx.beginPath();
      for (let i = 0; i < points.length; i++) {
        const psi = gouyPhase(points[i].z, beamResult.rayleighRange);
        const x = zToX(points[i].z);
        const y = cy - psi * phaseScale;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = "#606060";
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Gouy phase label
      ctx.fillStyle = "#606060";
      ctx.font = "9px IBM Plex Sans";
      ctx.textAlign = "left";
      const gouyLabelX = margin.left + plotW * 0.02;
      ctx.fillText("ψ(z)", gouyLabelX, margin.top + 10);

      // Phase axis ticks on left side
      ctx.font = "7px IBM Plex Mono";
      ctx.fillStyle = "#606060";
      ctx.textAlign = "right";
      const phaseTicks = [-Math.PI / 2, -Math.PI / 4, 0, Math.PI / 4, Math.PI / 2];
      const phaseLabels = ["-π/2", "-π/4", "0", "π/4", "π/2"];
      for (let i = 0; i < phaseTicks.length; i++) {
        const y = cy - phaseTicks[i] * phaseScale;
        if (y >= margin.top && y <= h - margin.bottom) {
          ctx.fillText(phaseLabels[i], margin.left - 4, y + 3);
        }
      }
    }

    // --- Observation point marker ---
    if (showObservationPoint) {
      const obsX = zToX(observationZ);
      if (obsX >= margin.left && obsX <= w - margin.right) {
        // Dashed vertical line
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(obsX, margin.top);
        ctx.lineTo(obsX, h - margin.bottom);
        ctx.strokeStyle = "#cc3333";
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.setLineDash([]);

        // Small cross-section inset circle at observation point
        const obsW = beamResult.widthAt(observationZ);
        const obsR = (obsW / maxW) * (plotH / 2);

        // Highlighted observation spot circle
        ctx.beginPath();
        ctx.arc(obsX, cy, obsR, 0, 2 * Math.PI);
        ctx.fillStyle = "#cc3333";
        ctx.globalAlpha = 0.2;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "#cc3333";
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Observation point label
        ctx.fillStyle = "#cc3333";
        ctx.font = "9px IBM Plex Sans";
        ctx.textAlign = "center";
        ctx.fillText("观测点", obsX, margin.top - 5);
      }
    }

    // Axis labels
    ctx.fillStyle = "#6b7280";
    ctx.font = "9px IBM Plex Sans";
    ctx.textAlign = "center";
    ctx.fillText("z (传播方向)", w / 2, h - 5);

    ctx.save();
    ctx.translate(12, margin.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("w(z) 光束宽度", 0, 0);
    ctx.restore();

    // Tick marks with SI units
    ctx.font = "8px IBM Plex Mono";
    ctx.fillStyle = "#9ca3af";
    ctx.textAlign = "center";
    for (let i = 0; i <= 4; i++) {
      const frac = i / 4;
      const z = zMin + frac * zSpan;
      const x = margin.left + frac * plotW;
      ctx.fillText(formatSI(z, "m"), x, h - margin.bottom + 12);
    }

    // Width axis ticks
    ctx.textAlign = "right";
    for (let i = 0; i <= 4; i++) {
      const frac = i / 4;
      const wv = -maxW + frac * 2 * maxW;
      const y = cy - (wv / maxW) * (plotH / 2);
      if (y >= margin.top && y <= h - margin.bottom) {
        ctx.fillText(formatSI(Math.abs(wv), "m"), margin.left - 4, y + 3);
      }
    }

    // Title
    ctx.fillStyle = "#2d3142";
    ctx.font = "10px IBM Plex Sans";
    ctx.textAlign = "left";
    ctx.fillText("光束宽度包络与光斑演化", margin.left + 5, margin.top + 12);

    // Legend info box in Gouy mode
    if (showGouyMode) {
      const legendX = margin.left + 5;
      const legendY = h - margin.bottom - 35;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(legendX, legendY, 180, 32);
      ctx.strokeStyle = "#d4d8e0";
      ctx.lineWidth = 0.5;
      ctx.strokeRect(legendX, legendY, 180, 32);

      ctx.font = "8px IBM Plex Sans";
      ctx.textAlign = "left";

      // Beam width line
      ctx.strokeStyle = beamColor;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(legendX + 5, legendY + 8);
      ctx.lineTo(legendX + 20, legendY + 8);
      ctx.stroke();
      ctx.fillStyle = "#2d3142";
      ctx.fillText("w(z) 光束宽度", legendX + 24, legendY + 11);

      // Gouy phase line
      ctx.strokeStyle = "#606060";
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(legendX + 5, legendY + 20);
      ctx.lineTo(legendX + 20, legendY + 20);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#606060";
      ctx.fillText("ψ(z) Gouy相位", legendX + 24, legendY + 23);

      // R(z) line
      if (showGouyMode) {
        ctx.strokeStyle = "#b07020";
        ctx.lineWidth = 1.2;
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        ctx.moveTo(legendX + 95, legendY + 20);
        ctx.lineTo(legendX + 110, legendY + 20);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "#b07020";
        ctx.fillText("R(z)", legendX + 114, legendY + 23);
      }
    }
  }, [beamResult, beamColor, wavelength, observationZ, showGouyMode, showObservationPoint]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full border-t border-[#d4d8e0]"
    />
  );
}

export default BeamProfileCanvas;
