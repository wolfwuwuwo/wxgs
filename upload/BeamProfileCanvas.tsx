"use client";

import { useRef, useEffect, useMemo } from "react";
import { calculateGaussianBeam, getWavelengthColor, type GaussianBeamParams } from "@/lib/optics/gaussian-beam";

function BeamProfileCanvas({
  beamParams,
  wavelength,
}: {
  beamParams: GaussianBeamParams;
  wavelength: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const beamResult = useMemo(() => calculateGaussianBeam(beamParams), [beamParams]);
  const beamColor = useMemo(() => getWavelengthColor(wavelength), [wavelength]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.parentElement?.clientWidth || 600;
    const h = 180;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.scale(dpr, dpr);

    const margin = { left: 50, right: 20, top: 20, bottom: 30 };
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

    // Draw beam spots at regular intervals
    const numSpots = 9;
    for (let i = 0; i < numSpots; i++) {
      const frac = i / (numSpots - 1);
      const z = zMin + frac * zSpan;
      const wz = beamResult.widthAt(z);
      
      const x = margin.left + frac * plotW;
      const cy = margin.top + plotH / 2;
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
      const x = margin.left + ((points[i].z - zMin) / zSpan) * plotW;
      const y = margin.top + plotH / 2 - (points[i].w / maxW) * (plotH / 2);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = beamColor;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Lower envelope: -w(z)
    ctx.beginPath();
    for (let i = 0; i < points.length; i++) {
      const x = margin.left + ((points[i].z - zMin) / zSpan) * plotW;
      const y = margin.top + plotH / 2 + (points[i].w / maxW) * (plotH / 2);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = beamColor;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Fill between envelopes
    ctx.beginPath();
    for (let i = 0; i < points.length; i++) {
      const x = margin.left + ((points[i].z - zMin) / zSpan) * plotW;
      const y = margin.top + plotH / 2 - (points[i].w / maxW) * (plotH / 2);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    for (let i = points.length - 1; i >= 0; i--) {
      const x = margin.left + ((points[i].z - zMin) / zSpan) * plotW;
      const y = margin.top + plotH / 2 + (points[i].w / maxW) * (plotH / 2);
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
    const w0x = margin.left + ((-zMin) / zSpan) * plotW;
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

    // Tick marks
    ctx.font = "8px IBM Plex Mono";
    ctx.fillStyle = "#9ca3af";
    ctx.textAlign = "center";
    for (let i = 0; i <= 4; i++) {
      const frac = i / 4;
      const z = zMin + frac * zSpan;
      const x = margin.left + frac * plotW;
      ctx.fillText(`${z.toFixed(1)}m`, x, h - margin.bottom + 12);
    }

    // Title
    ctx.fillStyle = "#2d3142";
    ctx.font = "10px IBM Plex Sans";
    ctx.textAlign = "left";
    ctx.fillText("光束宽度包络与光斑演化", margin.left + 5, margin.top + 12);
  }, [beamResult, beamColor, wavelength]);

  return <canvas ref={canvasRef} className="w-full border-t border-[#d4d8e0]" />;
}

export default BeamProfileCanvas;
