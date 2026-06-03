"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  SUBSTANCE_PRESETS,
  WAVELENGTH_OPTIONS,
  calculateOpticalRotation,
  malusIntensity,
  wavelengthToColor,
  formatAngle,
  formatIntensity,
  tripleFieldIntensities,
  tripleFieldBrightnessDiff,
  classifyFieldState,
  fieldStateLabel,
  isNearFalseZero,
  isNearDimZero,
  sensitivityAtAngle,
  autoDetectDimZero,
  findDimZeroAngle,
  findBrightZeroAngle,
  type SubstancePreset,
  type CustomSubstance,
  type MeasurementMode,
  type FieldState,
} from "@/lib/optics/polarimeter";

type ExperimentPhase = "zeroing" | "loaded" | "measuring" | "complete";

// ─── Optical Bench Canvas ────────────────────────────────────────
function OpticalBenchCanvas({
  wavelength,
  hasSample,
  sampleName,
  analyzerAngle,
  beamColor,
  intensity,
  mode,
  shadowAngle,
}: {
  wavelength: number;
  hasSample: boolean;
  sampleName: string;
  analyzerAngle: number;
  beamColor: string;
  intensity: number;
  mode: MeasurementMode;
  shadowAngle: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = 720;
    const h = 120;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.scale(dpr, dpr);

    const axisY = h / 2;
    const isTriple = mode === "triple_field";

    // Background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);

    // Optical axis
    ctx.strokeStyle = "#d4d8e0";
    ctx.lineWidth = 0.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(10, axisY);
    ctx.lineTo(w - 10, axisY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Positions
    const lampX = 50;
    const filterX = 130;
    const polarizerX = 210;
    const hwpX = isTriple ? 290 : 0;
    const sampleX = isTriple ? 380 : 350;
    const analyzerX = isTriple ? 520 : 500;
    const detectorX = isTriple ? 640 : 630;

    const drawBeam = (x1: number, x2: number, color: string, opacity: number = 1) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.globalAlpha = opacity;
      ctx.beginPath();
      ctx.moveTo(x1, axisY);
      ctx.lineTo(x2, axisY);
      ctx.stroke();
      ctx.globalAlpha = 1;
    };

    // 1. Lamp
    ctx.strokeStyle = "#4a4a5a";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(lampX, axisY, 16, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = beamColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(lampX - 4, axisY - 6);
    ctx.lineTo(lampX + 4, axisY + 6);
    ctx.moveTo(lampX + 4, axisY - 6);
    ctx.lineTo(lampX - 4, axisY + 6);
    ctx.stroke();
    ctx.fillStyle = "#6b7280";
    ctx.font = "9px IBM Plex Sans";
    ctx.textAlign = "center";
    ctx.fillText("钠灯", lampX, axisY + 28);

    drawBeam(lampX + 18, filterX - 12, beamColor);

    // 2. Filter
    ctx.strokeStyle = "#4a4a5a";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(filterX, axisY - 20);
    ctx.quadraticCurveTo(filterX + 8, axisY, filterX, axisY + 20);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(filterX, axisY - 20);
    ctx.quadraticCurveTo(filterX - 8, axisY, filterX, axisY + 20);
    ctx.stroke();
    ctx.fillStyle = "#6b7280";
    ctx.font = "8px IBM Plex Mono";
    ctx.textAlign = "center";
    ctx.fillText(`${wavelength}nm`, filterX, axisY + 32);
    ctx.font = "9px IBM Plex Sans";
    ctx.fillText("滤光", filterX, axisY + 42);

    drawBeam(filterX + 10, polarizerX - 14, beamColor);

    // 3. Polarizer
    ctx.strokeStyle = "#4a4a5a";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(polarizerX, axisY - 22);
    ctx.lineTo(polarizerX, axisY + 22);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 2]);
    ctx.beginPath();
    ctx.moveTo(polarizerX + 6, axisY - 18);
    ctx.lineTo(polarizerX + 6, axisY + 18);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 0.6;
    ctx.strokeStyle = "#6b7280";
    for (let dy = -18; dy <= 18; dy += 6) {
      ctx.beginPath();
      ctx.moveTo(polarizerX - 3, dy + axisY + 3);
      ctx.lineTo(polarizerX + 3, dy + axisY - 3);
      ctx.stroke();
    }
    ctx.fillStyle = "#6b7280";
    ctx.font = "9px IBM Plex Sans";
    ctx.textAlign = "center";
    ctx.fillText("起偏器 P₁", polarizerX, axisY + (isTriple ? 34 : 32));

    // 3.5. Half-wave plate (triple-field mode only)
    if (isTriple) {
      drawBeam(polarizerX + 8, hwpX - 12, beamColor);

      ctx.strokeStyle = "#4a4a5a";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(hwpX - 10, axisY - 20, 20, 40);
      // Label "Z"
      ctx.fillStyle = "#4a4a5a";
      ctx.font = "11px IBM Plex Sans";
      ctx.textAlign = "center";
      ctx.fillText("Z", hwpX, axisY + 4);
      // Light axis direction - a short dashed line at angle θ from P1
      const axisAngleRad = (shadowAngle * Math.PI) / 180;
      ctx.strokeStyle = "#6b7280";
      ctx.lineWidth = 0.8;
      ctx.setLineDash([3, 2]);
      ctx.beginPath();
      ctx.moveTo(hwpX + 14, axisY - 14 * Math.cos(axisAngleRad));
      ctx.lineTo(hwpX + 14, axisY + 14 * Math.cos(axisAngleRad));
      ctx.stroke();
      ctx.setLineDash([]);
      // Shadow angle annotation
      ctx.fillStyle = "#9ca3af";
      ctx.font = "7px IBM Plex Mono";
      ctx.textAlign = "left";
      ctx.fillText(`荫视角 θ=${shadowAngle}°`, hwpX + 16, axisY - 12);
      // Component label
      ctx.fillStyle = "#6b7280";
      ctx.font = "9px IBM Plex Sans";
      ctx.textAlign = "center";
      ctx.fillText("半波片", hwpX, axisY + 34);

      // Draw three-part beam split indicator after HWP
      drawBeam(hwpX + 12, sampleX - (hasSample ? 30 : 20), beamColor);
    } else {
      drawBeam(polarizerX + 8, sampleX - (hasSample ? 30 : 20), beamColor);
    }

    // 4. Sample tube
    if (hasSample) {
      ctx.strokeStyle = "#4a4a5a";
      ctx.lineWidth = 1.2;
      const tubeLeft = sampleX - 28;
      const tubeRight = sampleX + 28;
      const tubeHH = 12;
      ctx.beginPath();
      ctx.moveTo(tubeLeft, axisY - tubeHH);
      ctx.lineTo(tubeRight, axisY - tubeHH);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(tubeLeft, axisY + tubeHH);
      ctx.lineTo(tubeRight, axisY + tubeHH);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(tubeLeft, axisY, 3, tubeHH, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(tubeRight, axisY, 3, tubeHH, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = beamColor;
      ctx.globalAlpha = 0.08;
      ctx.fillRect(tubeLeft + 3, axisY - tubeHH + 1, tubeRight - tubeLeft - 6, tubeHH * 2 - 2);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "#9ca3af";
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(tubeLeft, axisY + tubeHH + 4);
      ctx.lineTo(tubeRight, axisY + tubeHH + 4);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(tubeLeft, axisY + tubeHH + 2);
      ctx.lineTo(tubeLeft, axisY + tubeHH + 6);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(tubeRight, axisY + tubeHH + 2);
      ctx.lineTo(tubeRight, axisY + tubeHH + 6);
      ctx.stroke();
      ctx.fillStyle = "#6b7280";
      ctx.font = "8px IBM Plex Sans";
      ctx.textAlign = "center";
      ctx.fillText(sampleName, sampleX, axisY - 18);
      ctx.fillText("样品管", sampleX, axisY + 32);
    } else {
      ctx.strokeStyle = "#9ca3af";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(sampleX - 25, axisY - 16, 50, 32);
      ctx.setLineDash([]);
      ctx.fillStyle = "#9ca3af";
      ctx.font = "9px IBM Plex Sans";
      ctx.textAlign = "center";
      ctx.fillText("样品管仓", sampleX, axisY + 28);
      ctx.fillText("(空)", sampleX, axisY + 38);
    }

    drawBeam(
      sampleX + (hasSample ? 32 : 28),
      analyzerX - 20,
      beamColor,
      hasSample ? 0.85 : 1
    );

    // 5. Analyzer
    ctx.save();
    ctx.translate(analyzerX, axisY);
    ctx.strokeStyle = "#4a4a4a";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, 18, 0, Math.PI * 2);
    ctx.stroke();
    const angleRad = (analyzerAngle * Math.PI) / 180;
    ctx.save();
    ctx.rotate(angleRad);
    ctx.strokeStyle = "#2d3142";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, -15);
    ctx.lineTo(0, 15);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-3, -12);
    ctx.lineTo(0, -15);
    ctx.lineTo(3, -12);
    ctx.stroke();
    ctx.restore();
    const dotX = 18 * Math.cos(angleRad - Math.PI / 2);
    const dotY = 18 * Math.sin(angleRad - Math.PI / 2);
    ctx.fillStyle = "#cc0000";
    ctx.beginPath();
    ctx.arc(dotX, dotY, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = "#6b7280";
    ctx.font = "9px IBM Plex Sans";
    ctx.textAlign = "center";
    ctx.fillText("检偏器 P₂", analyzerX, axisY + 32);

    // Beam to detector
    drawBeam(analyzerX + 22, detectorX - 14, beamColor, intensity);

    // 6. Detector / Eyepiece
    ctx.strokeStyle = "#4a4a5a";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(detectorX, axisY - 14);
    ctx.lineTo(detectorX + 12, axisY);
    ctx.lineTo(detectorX, axisY + 14);
    ctx.closePath();
    ctx.stroke();
    if (isTriple) {
      ctx.fillStyle = "#1a1a2e";
      ctx.font = "10px IBM Plex Mono";
      ctx.textAlign = "left";
      ctx.fillText("目镜", detectorX - 10, axisY + 28);
    } else {
      ctx.strokeStyle = beamColor;
      ctx.lineWidth = 1;
      ctx.globalAlpha = intensity;
      ctx.beginPath();
      ctx.moveTo(detectorX - 10, axisY);
      ctx.lineTo(detectorX - 3, axisY);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(detectorX - 6, axisY - 3);
      ctx.lineTo(detectorX - 3, axisY);
      ctx.lineTo(detectorX - 6, axisY + 3);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#1a1a2e";
      ctx.font = "11px IBM Plex Mono";
      ctx.textAlign = "left";
      ctx.fillText(`I/I₀ = ${formatIntensity(intensity)}`, detectorX - 16, axisY + 44);
      ctx.fillStyle = "#6b7280";
      ctx.font = "9px IBM Plex Sans";
      ctx.textAlign = "center";
      ctx.fillText("探测器", detectorX, axisY + 28);
    }
  }, [wavelength, hasSample, sampleName, analyzerAngle, beamColor, intensity, mode, shadowAngle]);

  return <canvas ref={canvasRef} className="border border-[#d4d8e0] bg-white" />;
}

// ─── Analyzer Dial Canvas ────────────────────────────────────────
function AnalyzerDialCanvas({
  angle,
  onAngleChange,
  isDraggingRef,
}: {
  angle: number;
  onAngleChange: (a: number) => void;
  isDraggingRef: React.MutableRefObject<boolean>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const centerRef = useRef({ x: 0, y: 0 });
  const radiusRef = useRef(0);

  const drawDial = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const size = 260;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.scale(dpr, dpr);

    const cx = size / 2;
    const cy = size / 2;
    const outerR = size / 2 - 12;
    centerRef.current = { x: cx, y: cy };
    radiusRef.current = outerR;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size, size);

    // Main circle
    ctx.strokeStyle = "#2d3142";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
    ctx.stroke();

    // Inner circle
    ctx.strokeStyle = "#d4d8e0";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(cx, cy, outerR - 20, 0, Math.PI * 2);
    ctx.stroke();

    // Ticks
    for (let deg = 0; deg < 360; deg += 1) {
      const rad = ((deg - 90) * Math.PI) / 180;
      const isMajor = deg % 10 === 0;
      const isMid = deg % 5 === 0 && !isMajor;
      const tickLen = isMajor ? 12 : isMid ? 7 : 3;
      const innerR = outerR - tickLen;
      ctx.strokeStyle = isMajor ? "#2d3142" : "#9ca3af";
      ctx.lineWidth = isMajor ? 1.2 : 0.6;
      ctx.beginPath();
      ctx.moveTo(cx + innerR * Math.cos(rad), cy + innerR * Math.sin(rad));
      ctx.lineTo(cx + outerR * Math.cos(rad), cy + outerR * Math.sin(rad));
      ctx.stroke();
      if (isMajor) {
        const labelR = outerR - 18;
        ctx.fillStyle = "#2d3142";
        ctx.font = "8px IBM Plex Mono";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(`${deg}`, cx + labelR * Math.cos(rad), cy + labelR * Math.sin(rad));
      }
    }

    // Direction line
    const angleRad = ((angle - 90) * Math.PI) / 180;
    const lineInner = 18;
    const lineOuter = outerR - 26;
    ctx.strokeStyle = "#2d3142";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx + lineInner * Math.cos(angleRad), cy + lineInner * Math.sin(angleRad));
    ctx.lineTo(cx + lineOuter * Math.cos(angleRad), cy + lineOuter * Math.sin(angleRad));
    ctx.stroke();
    // Arrow
    const ax = cx + lineOuter * Math.cos(angleRad);
    const ay = cy + lineOuter * Math.sin(angleRad);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax + 7 * Math.cos(angleRad + Math.PI - 0.3), ay + 7 * Math.sin(angleRad + Math.PI - 0.3));
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax + 7 * Math.cos(angleRad + Math.PI + 0.3), ay + 7 * Math.sin(angleRad + Math.PI + 0.3));
    ctx.stroke();

    // Center dot
    ctx.fillStyle = "#2d3142";
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fill();

    // Angle display
    ctx.fillStyle = "#1a1a2e";
    ctx.font = "12px IBM Plex Mono";
    ctx.textAlign = "center";
    ctx.fillText(`${formatAngle(angle % 360)}°`, cx, cy + outerR + 4);
    ctx.fillStyle = "#9ca3af";
    ctx.font = "7px IBM Plex Mono";
    ctx.fillText("游标分度值 0.1°", cx, cy + outerR + 15);

    // Drag handle
    ctx.fillStyle = "#cc0000";
    ctx.beginPath();
    ctx.arc(cx + (outerR - 1) * Math.cos(angleRad), cy + (outerR - 1) * Math.sin(angleRad), 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1;
    ctx.stroke();
  }, [angle]);

  useEffect(() => { drawDial(); }, [drawDial]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handleMove = (clientX: number, clientY: number) => {
      if (!isDraggingRef.current) return;
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      let newAngle = Math.atan2(y - centerRef.current.y, x - centerRef.current.x) * (180 / Math.PI) + 90;
      if (newAngle < 0) newAngle += 360;
      newAngle = Math.round(newAngle * 10) / 10;
      onAngleChange(newAngle);
    };
    const md = (e: MouseEvent) => { isDraggingRef.current = true; handleMove(e.clientX, e.clientY); };
    const mm = (e: MouseEvent) => { handleMove(e.clientX, e.clientY); };
    const mu = () => { isDraggingRef.current = false; };
    const ts = (e: TouchEvent) => { e.preventDefault(); isDraggingRef.current = true; handleMove(e.touches[0].clientX, e.touches[0].clientY); };
    const tm = (e: TouchEvent) => { e.preventDefault(); handleMove(e.touches[0].clientX, e.touches[0].clientY); };
    const te = () => { isDraggingRef.current = false; };
    canvas.addEventListener("mousedown", md);
    window.addEventListener("mousemove", mm);
    window.addEventListener("mouseup", mu);
    canvas.addEventListener("touchstart", ts, { passive: false });
    canvas.addEventListener("touchmove", tm, { passive: false });
    canvas.addEventListener("touchend", te);
    return () => {
      canvas.removeEventListener("mousedown", md);
      window.removeEventListener("mousemove", mm);
      window.removeEventListener("mouseup", mu);
      canvas.removeEventListener("touchstart", ts);
      canvas.removeEventListener("touchmove", tm);
      canvas.removeEventListener("touchend", te);
    };
  }, [onAngleChange, isDraggingRef]);

  return <canvas ref={canvasRef} className="border border-[#d4d8e0] bg-white cursor-grab active:cursor-grabbing" />;
}

// ─── Malus Law Canvas (Extinction Mode) ──────────────────────────
function MalusLawCanvas({
  analyzerAngle,
  extinctionAngle,
  zeroAngle,
  showTheoretical,
  theoreticalExtinction,
}: {
  analyzerAngle: number;
  extinctionAngle: number;
  zeroAngle: number;
  showTheoretical: boolean;
  theoreticalExtinction: number | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = 440;
    const h = 160;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.scale(dpr, dpr);

    const margin = { left: 42, right: 12, top: 14, bottom: 26 };
    const plotW = w - margin.left - margin.right;
    const plotH = h - margin.top - margin.bottom;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = "#ebeef2";
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 10; i++) {
      const x = margin.left + (i / 10) * plotW;
      ctx.beginPath(); ctx.moveTo(x, margin.top); ctx.lineTo(x, h - margin.bottom); ctx.stroke();
    }
    for (let i = 0; i <= 5; i++) {
      const y = margin.top + (i / 5) * plotH;
      ctx.beginPath(); ctx.moveTo(margin.left, y); ctx.lineTo(w - margin.right, y); ctx.stroke();
    }

    // Axes
    ctx.strokeStyle = "#9ca3af";
    ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(margin.left, h - margin.bottom); ctx.lineTo(w - margin.right, h - margin.bottom); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(margin.left, margin.top); ctx.lineTo(margin.left, h - margin.bottom); ctx.stroke();

    const rangeStart = extinctionAngle - 90;
    const rangeEnd = extinctionAngle + 90;

    // Curve
    ctx.beginPath();
    for (let i = 0; i <= plotW; i++) {
      const theta = rangeStart + (i / plotW) * (rangeEnd - rangeStart);
      const intensity = Math.cos(((theta - extinctionAngle) * Math.PI) / 180) ** 2;
      const x = margin.left + i;
      const y = h - margin.bottom - intensity * plotH;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = "#2d3142";
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Zero angle marker
    const zeroX = margin.left + ((zeroAngle - rangeStart) / (rangeEnd - rangeStart)) * plotW;
    if (zeroX >= margin.left && zeroX <= w - margin.right) {
      ctx.setLineDash([3, 2]);
      ctx.strokeStyle = "#6b7280";
      ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(zeroX, margin.top); ctx.lineTo(zeroX, h - margin.bottom); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#6b7280";
      ctx.font = "8px IBM Plex Mono";
      ctx.textAlign = "center";
      ctx.fillText("φ₀", zeroX, margin.top - 2);
    }

    // Theoretical marker
    if (showTheoretical && theoreticalExtinction !== null) {
      const theoX = margin.left + ((theoreticalExtinction - rangeStart) / (rangeEnd - rangeStart)) * plotW;
      if (theoX >= margin.left && theoX <= w - margin.right) {
        ctx.setLineDash([5, 3]);
        ctx.strokeStyle = "#008800";
        ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(theoX, margin.top); ctx.lineTo(theoX, h - margin.bottom); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "#008800";
        ctx.font = "8px IBM Plex Mono";
        ctx.textAlign = "center";
        ctx.fillText("理论值", theoX, margin.top - 2);
      }
    }

    // Current angle marker
    const curIntensity = malusIntensity(analyzerAngle, extinctionAngle);
    const curX = margin.left + ((analyzerAngle - rangeStart) / (rangeEnd - rangeStart)) * plotW;
    const curY = h - margin.bottom - curIntensity * plotH;
    if (curX >= margin.left && curX <= w - margin.right) {
      ctx.fillStyle = "#cc0000";
      ctx.beginPath(); ctx.arc(curX, curY, 4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(204,0,0,0.3)";
      ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(curX, margin.top); ctx.lineTo(curX, h - margin.bottom); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(margin.left, curY); ctx.lineTo(w - margin.right, curY); ctx.stroke();
    }

    // Labels
    ctx.fillStyle = "#6b7280";
    ctx.font = "9px IBM Plex Sans";
    ctx.textAlign = "center";
    ctx.fillText("检偏器角度 θ (°)", w / 2, h - 3);
    ctx.save();
    ctx.translate(10, margin.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("I/I₀", 0, 0);
    ctx.restore();

    ctx.font = "10px IBM Plex Sans";
    ctx.fillStyle = "#2d3142";
    ctx.textAlign = "left";
    ctx.fillText("光强曲线 I = I₀cos²(θ−φ)", margin.left + 4, margin.top + 10);
  }, [analyzerAngle, extinctionAngle, zeroAngle, showTheoretical, theoreticalExtinction]);

  return <canvas ref={canvasRef} className="border border-[#d4d8e0] bg-white" />;
}

// ─── Triple-Field Eyepiece Canvas ────────────────────────────────
function TripleFieldEyepieceCanvas({
  edgeIntensity,
  centerIntensity,
  fieldState,
  nearZero,
  greenFlashOn,
  beamColor,
}: {
  edgeIntensity: number;
  centerIntensity: number;
  fieldState: FieldState;
  nearZero: boolean;
  greenFlashOn: boolean;
  beamColor: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = 420;
    const h = 140;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.scale(dpr, dpr);

    // White background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);

    const viewLeft = 20;
    const viewTop = 15;
    const viewW = w - 40;
    const viewH = h - 45;

    // Border — green flash when near zero (2Hz blink)
    const showGreen = nearZero && greenFlashOn;
    ctx.strokeStyle = showGreen ? "#008800" : "#2d3142";
    ctx.lineWidth = showGreen ? 2.5 : 1.2;
    ctx.strokeRect(viewLeft, viewTop, viewW, viewH);

    // Divide into three equal vertical sections
    const thirdW = viewW / 3;
    const boundaries = [
      viewLeft + thirdW,
      viewLeft + 2 * thirdW,
    ];

    // Draw boundary lines (dashed, gray #999999, 1px, gap 4px)
    ctx.strokeStyle = "#999999";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    for (const bx of boundaries) {
      ctx.beginPath();
      ctx.moveTo(bx, viewTop);
      ctx.lineTo(bx, viewTop + viewH);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Fill each section with smooth wavelength-colored area
    // Uses wavelength color with brightness variation to distinguish sections
    const sections = [
      { intensity: edgeIntensity, label: "边缘" },
      { intensity: centerIntensity, label: "中间" },
      { intensity: edgeIntensity, label: "边缘" },
    ];

    // Parse beamColor hex to RGB
    const hexToRgb = (hex: string) => {
      const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
      if (!m) return { r: 200, g: 168, b: 0 }; // fallback yellow
      return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
    };
    const rgb = hexToRgb(beamColor);

    sections.forEach((section, i) => {
      const sx = viewLeft + i * thirdW;
      const sy = viewTop;

      // Smooth fill: blend wavelength color toward black based on (1 - intensity)
      // At intensity=1 → full wavelength color; at intensity=0 → black (no light)
      // This keeps the chromatic identity of the wavelength while encoding brightness
      const cr = Math.round(rgb.r * section.intensity);
      const cg = Math.round(rgb.g * section.intensity);
      const cb = Math.round(rgb.b * section.intensity);
      ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
      ctx.fillRect(sx, sy, thirdW, viewH);

      // Section label (tiny, at bottom)
      ctx.fillStyle = "#9ca3af";
      ctx.font = "7px IBM Plex Sans";
      ctx.textAlign = "center";
      ctx.fillText(section.label, sx + thirdW / 2, viewTop + viewH + 10);
    });

    // Intensity values below each section
    ctx.font = "8px IBM Plex Mono";
    ctx.fillStyle = "#6b7280";
    sections.forEach((section, i) => {
      const sx = viewLeft + i * thirdW;
      ctx.fillText(
        `I=${section.intensity.toFixed(2)}`,
        sx + thirdW / 2,
        viewTop + viewH + 20
      );
    });

    // Field state label
    const stateLabel = fieldStateLabel(fieldState);
    const isFalseZero = fieldState === "uniform_bright";
    // False zero warning: red #CC0000, one size larger than normal
    ctx.font = isFalseZero ? "12px IBM Plex Sans" : "10px IBM Plex Sans";
    ctx.fillStyle = isFalseZero ? "#CC0000" : "#4a4a5a";
    ctx.textAlign = "center";
    ctx.fillText(stateLabel, w / 2, h - 3);
  }, [edgeIntensity, centerIntensity, fieldState, nearZero, greenFlashOn, beamColor]);

  return <canvas ref={canvasRef} className="border border-[#d4d8e0] bg-white" />;
}

// ─── Brightness Difference Curve (Triple-Field Mode) ─────────────
function BrightnessDiffCanvas({
  analyzerAngle,
  opticalRotation,
  shadowAngle,
  zeroAngle,
  showTheoretical,
  theoreticalRotation,
}: {
  analyzerAngle: number;
  opticalRotation: number;
  shadowAngle: number;
  zeroAngle: number;
  showTheoretical: boolean;
  theoreticalRotation: number | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = 440;
    const h = 160;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.scale(dpr, dpr);

    const margin = { left: 42, right: 12, top: 14, bottom: 26 };
    const plotW = w - margin.left - margin.right;
    const plotH = h - margin.top - margin.bottom;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = "#ebeef2";
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 10; i++) {
      const x = margin.left + (i / 10) * plotW;
      ctx.beginPath(); ctx.moveTo(x, margin.top); ctx.lineTo(x, h - margin.bottom); ctx.stroke();
    }
    for (let i = 0; i <= 5; i++) {
      const y = margin.top + (i / 5) * plotH;
      ctx.beginPath(); ctx.moveTo(margin.left, y); ctx.lineTo(w - margin.right, y); ctx.stroke();
    }

    // Axes
    ctx.strokeStyle = "#9ca3af";
    ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(margin.left, h - margin.bottom); ctx.lineTo(w - margin.right, h - margin.bottom); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(margin.left, margin.top); ctx.lineTo(margin.left, h - margin.bottom); ctx.stroke();

    // Range: show 180° centered on the dim zero
    const dimZero = findDimZeroAngle(opticalRotation, shadowAngle);
    const brightZero = findBrightZeroAngle(opticalRotation, shadowAngle);
    const rangeStart = dimZero - 90;
    const rangeEnd = dimZero + 90;

    // ΔI curve
    ctx.beginPath();
    for (let i = 0; i <= plotW; i++) {
      const theta = rangeStart + (i / plotW) * (rangeEnd - rangeStart);
      const diff = tripleFieldBrightnessDiff(theta, opticalRotation, shadowAngle);
      const x = margin.left + i;
      const y = h - margin.bottom - diff * plotH;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = "#2d3142";
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Zero angle marker (dim zero)
    const zeroX = margin.left + ((zeroAngle - rangeStart) / (rangeEnd - rangeStart)) * plotW;
    if (zeroX >= margin.left && zeroX <= w - margin.right) {
      ctx.setLineDash([3, 2]);
      ctx.strokeStyle = "#6b7280";
      ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(zeroX, margin.top); ctx.lineTo(zeroX, h - margin.bottom); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#6b7280";
      ctx.font = "8px IBM Plex Mono";
      ctx.textAlign = "center";
      ctx.fillText("φ₀", zeroX, margin.top - 2);
    }

    // False zero marker — gray dashed circle + label
    const falseX = margin.left + ((brightZero - rangeStart) / (rangeEnd - rangeStart)) * plotW;
    if (falseX >= margin.left && falseX <= w - margin.right) {
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = "#9ca3af";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(falseX, h - margin.bottom, 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#9ca3af";
      ctx.font = "7px IBM Plex Mono";
      ctx.textAlign = "center";
      ctx.fillText("假零点", falseX, h - margin.bottom + 18);
    }

    // Theoretical dim zero
    if (showTheoretical && theoreticalRotation !== null) {
      const theoDimZero = findDimZeroAngle(theoreticalRotation, shadowAngle);
      const theoX = margin.left + ((theoDimZero - rangeStart) / (rangeEnd - rangeStart)) * plotW;
      if (theoX >= margin.left && theoX <= w - margin.right) {
        ctx.setLineDash([5, 3]);
        ctx.strokeStyle = "#008800";
        ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(theoX, margin.top); ctx.lineTo(theoX, h - margin.bottom); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "#008800";
        ctx.font = "8px IBM Plex Mono";
        ctx.textAlign = "center";
        ctx.fillText("理论值", theoX, margin.top - 2);
      }
    }

    // Current angle marker
    const curDiff = tripleFieldBrightnessDiff(analyzerAngle, opticalRotation, shadowAngle);
    const curX = margin.left + ((analyzerAngle - rangeStart) / (rangeEnd - rangeStart)) * plotW;
    const curY = h - margin.bottom - curDiff * plotH;
    if (curX >= margin.left && curX <= w - margin.right) {
      ctx.fillStyle = "#cc0000";
      ctx.beginPath(); ctx.arc(curX, curY, 4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(204,0,0,0.3)";
      ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(curX, margin.top); ctx.lineTo(curX, h - margin.bottom); ctx.stroke();
    }

    // Labels
    ctx.fillStyle = "#6b7280";
    ctx.font = "9px IBM Plex Sans";
    ctx.textAlign = "center";
    ctx.fillText("检偏器角度 θ (°)", w / 2, h - 3);
    ctx.save();
    ctx.translate(10, margin.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("ΔI", 0, 0);
    ctx.restore();

    ctx.font = "10px IBM Plex Sans";
    ctx.fillStyle = "#2d3142";
    ctx.textAlign = "left";
    ctx.fillText("亮度差 ΔI = |I_mid − I_edge|", margin.left + 4, margin.top + 10);
  }, [analyzerAngle, opticalRotation, shadowAngle, zeroAngle, showTheoretical, theoreticalRotation]);

  return <canvas ref={canvasRef} className="border border-[#d4d8e0] bg-white" />;
}

// ─── Main Component ──────────────────────────────────────────────
export default function PolarimeterExperiment() {
  const [mode, setMode] = useState<MeasurementMode>("extinction");
  const [wavelength, setWavelength] = useState(589);
  const [analyzerAngle, setAnalyzerAngle] = useState(90.0);
  const [zeroAngle, setZeroAngle] = useState<number | null>(null);
  const [selectedPresetId, setSelectedPresetId] = useState<string>("");
  const [customName, setCustomName] = useState("");
  const [customRotation, setCustomRotation] = useState(0);
  const [customSolvent, setCustomSolvent] = useState("水");
  const [isCustom, setIsCustom] = useState(false);
  const [concentration, setConcentration] = useState(0.10);
  const [tubeLength, setTubeLength] = useState(2.0);
  const [temperature, setTemperature] = useState(20);
  const [hasSample, setHasSample] = useState(false);
  const [measurementAngle, setMeasurementAngle] = useState<number | null>(null);
  const [phase, setPhase] = useState<ExperimentPhase>("zeroing");
  const [showTheoretical, setShowTheoretical] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [shadowAngle, setShadowAngle] = useState(3);

  // Green flash state (2Hz toggle)
  const [greenFlashOn, setGreenFlashOn] = useState(true);

  const isDraggingRef = useRef(false);

  // Green flash timer (2Hz = 500ms period)
  useEffect(() => {
    if (mode !== "triple_field") return;
    const interval = setInterval(() => {
      setGreenFlashOn((prev) => !prev);
    }, 250); // toggle every 250ms → 2Hz flash
    return () => clearInterval(interval);
  }, [mode]);

  const beamColor = useMemo(() => wavelengthToColor(wavelength), [wavelength]);

  const currentSubstance = useMemo(() => {
    if (isCustom) return { name: customName || "自定义", specificRotation: customRotation, solvent: customSolvent } as CustomSubstance;
    return SUBSTANCE_PRESETS.find((p) => p.id === selectedPresetId) || null;
  }, [isCustom, customName, customRotation, customSolvent, selectedPresetId]);

  const theoreticalRotation = useMemo(() => {
    if (!currentSubstance || !hasSample) return 0;
    return calculateOpticalRotation(currentSubstance, wavelength, concentration, tubeLength);
  }, [currentSubstance, wavelength, concentration, tubeLength, hasSample]);

  // Extinction mode calculations
  const extinctionAngle = useMemo(() => {
    if (mode === "triple_field") {
      const dimZeroBase = 90 + shadowAngle;
      return hasSample && zeroAngle !== null
        ? zeroAngle + theoreticalRotation
        : dimZeroBase;
    }
    if (hasSample && zeroAngle !== null) return zeroAngle + theoreticalRotation;
    return zeroAngle ?? 90;
  }, [mode, hasSample, zeroAngle, theoreticalRotation, shadowAngle]);

  // Triple-field calculations
  const tripleFieldOpticalRotation = useMemo(() => {
    if (!hasSample) return 0;
    return theoreticalRotation;
  }, [hasSample, theoreticalRotation]);

  const { edge: edgeIntensity, center: centerIntensity } = useMemo(
    () => tripleFieldIntensities(analyzerAngle, tripleFieldOpticalRotation, shadowAngle),
    [analyzerAngle, tripleFieldOpticalRotation, shadowAngle]
  );

  const fieldState = useMemo(
    () => classifyFieldState(analyzerAngle, tripleFieldOpticalRotation, shadowAngle),
    [analyzerAngle, tripleFieldOpticalRotation, shadowAngle]
  );

  const nearFalseZero = useMemo(
    () => isNearFalseZero(analyzerAngle, tripleFieldOpticalRotation, shadowAngle),
    [analyzerAngle, tripleFieldOpticalRotation, shadowAngle]
  );

  const nearDimZeroVal = useMemo(
    () => isNearDimZero(analyzerAngle, tripleFieldOpticalRotation, shadowAngle),
    [analyzerAngle, tripleFieldOpticalRotation, shadowAngle]
  );

  const sensitivity = useMemo(
    () => sensitivityAtAngle(analyzerAngle, tripleFieldOpticalRotation, shadowAngle),
    [analyzerAngle, tripleFieldOpticalRotation, shadowAngle]
  );

  const autoZeroDetected = useMemo(
    () => autoDetectDimZero(analyzerAngle, tripleFieldOpticalRotation, shadowAngle),
    [analyzerAngle, tripleFieldOpticalRotation, shadowAngle]
  );

  // Common: Malus intensity for extinction mode
  const intensity = useMemo(() => malusIntensity(analyzerAngle, extinctionAngle), [analyzerAngle, extinctionAngle]);

  // Triple-field: "intensity" for beam opacity
  const tripleFieldAvgIntensity = (edgeIntensity + centerIntensity) / 2;
  const displayIntensity = mode === "triple_field" ? tripleFieldAvgIntensity : intensity;

  // Near zero detection
  const nearExtinction = mode === "extinction" ? intensity < 0.005 : fieldState === "uniform_dim";
  const nearTripleZero = mode === "triple_field" && fieldState === "uniform_dim";

  // Measurement results
  const measuredRotation = useMemo(() => {
    if (measurementAngle !== null && zeroAngle !== null) return measurementAngle - zeroAngle;
    return null;
  }, [measurementAngle, zeroAngle]);

  const measuredSpecificRotation = useMemo(() => {
    if (measuredRotation !== null && tubeLength > 0 && concentration > 0) return measuredRotation / (tubeLength * concentration);
    return null;
  }, [measuredRotation, tubeLength, concentration]);

  // Hints — enhanced for triple-field with false zero teaching
  const hintText = useMemo(() => {
    if (mode === "triple_field") {
      switch (phase) {
        case "zeroing": return "不放样品，旋转检偏器找到暗且均匀的零度视场（三分视场亮度一致）。注意区分假零点！";
        case "loaded": return "已装入样品。零度视场被打破，请旋转检偏器寻找新的暗且均匀的零度视场。";
        case "measuring": return "正在寻找零度视场…旋转检偏器至三分视场亮度一致且偏暗。";
        case "complete": return "计算旋光度 α = φ₁ − φ₀，并与理论值比较。思考三分视场法相比消光法的精度优势。";
      }
    }
    switch (phase) {
      case "zeroing": return "请不放样品，旋转检偏器找到消光位置（I/I₀ → 0），确定零点 φ₀。";
      case "loaded": return "已装入样品。请旋转检偏器寻找新的消光位置，观测旋转方向。";
      case "measuring": return "正在寻找消光位置…旋转检偏器至 I/I₀ 最小。";
      case "complete": return "计算旋光度 α = φ₁ − φ₀，并与理论值比较。";
    }
  }, [mode, phase]);

  // False zero warning for triple-field — enhanced with sensitivity detection
  const falseZeroWarning = useMemo(() => {
    if (mode !== "triple_field") return false;
    return fieldState === "uniform_bright";
  }, [mode, fieldState]);

  // Sluggish sensitivity near false zero
  const sluggishWarning = useMemo(() => {
    if (mode !== "triple_field") return false;
    // Near false zero AND low sensitivity (sluggish response)
    return nearFalseZero && sensitivity < 0.003;
  }, [mode, nearFalseZero, sensitivity]);

  // Auto-detect zero notification — derived from state, no effect needed
  const zeroFoundNotification = useMemo(() => {
    if (mode !== "triple_field") return null;
    if (autoZeroDetected && zeroAngle === null && phase === "zeroing") {
      return `已找到零点 φ₀ = ${formatAngle(analyzerAngle)}°`;
    }
    return null;
  }, [mode, autoZeroDetected, zeroAngle, phase, analyzerAngle]);

  // Handlers
  const handleRecordZero = useCallback(() => {
    // Triple-field: reject false zero
    if (mode === "triple_field" && fieldState === "uniform_bright") return;
    setZeroAngle(analyzerAngle);
    setPhase("loaded");
  }, [analyzerAngle, mode, fieldState]);

  const handleLoadSample = useCallback(() => {
    if (!currentSubstance) return;
    setHasSample(true);
    setPhase("measuring");
  }, [currentSubstance]);

  const handleRecordMeasurement = useCallback(() => {
    // Triple-field: reject false zero
    if (mode === "triple_field" && fieldState === "uniform_bright") return;
    setMeasurementAngle(analyzerAngle);
    setPhase("complete");
  }, [analyzerAngle, mode, fieldState]);

  const handleReset = useCallback(() => {
    setAnalyzerAngle(90.0);
    setZeroAngle(null);
    setMeasurementAngle(null);
    setHasSample(false);
    setPhase("zeroing");
  }, []);

  const handleAngleInput = useCallback((val: string) => {
    const num = parseFloat(val);
    if (!isNaN(num)) setAnalyzerAngle(((num % 360) + 360) % 360);
  }, []);

  const handlePresetChange = useCallback((id: string) => {
    setSelectedPresetId(id);
    setIsCustom(false);
    const preset = SUBSTANCE_PRESETS.find((p) => p.id === id);
    if (preset) setConcentration(preset.defaultConcentration);
  }, []);

  const handleModeChange = useCallback((newMode: MeasurementMode) => {
    setMode(newMode);
    // Reset when switching modes
    setAnalyzerAngle(90.0);
    setZeroAngle(null);
    setMeasurementAngle(null);
    setHasSample(false);
    setPhase("zeroing");
  }, []);

  const sampleName = useMemo(() => {
    if (!hasSample) return "";
    if (isCustom) return customName || "自定义";
    const p = SUBSTANCE_PRESETS.find((p) => p.id === selectedPresetId);
    return p ? p.name : "";
  }, [hasSample, isCustom, customName, selectedPresetId]);

  return (
    <div className="flex h-full">
      {/* Control Panel */}
      <div className="w-80 border-r border-[#d4d8e0] bg-[#f8f9fb] p-4 overflow-y-auto optics-panel shrink-0">
        <div className="space-y-4">
          {/* Hint banner */}
          <div className="bg-white border border-[#d4d8e0] rounded p-2.5">
            <div className="flex items-start gap-2">
              <svg width="14" height="14" viewBox="0 0 16 16" className="shrink-0 mt-0.5">
                <circle cx="8" cy="8" r="6" stroke="#6b7280" strokeWidth="1.2" fill="none" />
                <text x="8" y="11" textAnchor="middle" fontSize="8" fill="#6b7280">i</text>
              </svg>
              <div className="flex-1">
                <p className="text-[11px] text-[#4a4a5a] leading-relaxed">{hintText}</p>
                {falseZeroWarning && (
                  <p className="text-[12px] text-[#CC0000] font-medium mt-1">
                    假零点！请继续旋转至暗零度视场。
                  </p>
                )}
                {sluggishWarning && !falseZeroWarning && (
                  <p className="text-[11px] text-[#CC0000] mt-1">
                    当前区域灵敏度极低，旋转时亮度变化迟钝，可能是假零点附近。
                  </p>
                )}
              </div>
              <button onClick={() => setShowHelp(!showHelp)} className="text-[10px] text-[#9ca3af] underline shrink-0 hover:text-[#6b7280]">帮助</button>
            </div>
          </div>

          {/* Auto-zero detection notification */}
          {zeroFoundNotification && (
            <div className="bg-[#f0faf0] border border-[#008800] rounded p-2 text-center">
              <p className="text-[11px] text-[#006600] font-medium">{zeroFoundNotification}</p>
              <p className="text-[9px] text-[#6b7280] mt-0.5">点击&quot;记录零点&quot;确认</p>
            </div>
          )}

          {showHelp && (
            <div className="bg-white border border-[#d4d8e0] rounded p-3">
              <h4 className="text-[11px] font-semibold text-[#2d3142] mb-2">实验步骤</h4>
              <ol className="text-[10.5px] text-[#4a4a5a] space-y-1.5 list-decimal list-inside leading-relaxed">
                <li><b>调零</b>：不放样品管，旋转检偏器至{mode === "triple_field" ? "暗且均匀的零度视场" : "消光位置（I/I₀→0）"}，点击&quot;记录零点&quot;。</li>
                {mode === "triple_field" && <li className="text-[#CC0000]"><b>注意</b>：假零点视场极亮且变化迟钝，必须找到<b>暗的</b>零度视场。</li>}
                <li><b>装样</b>：选择物质并设置参数，点击&quot;装入样品管&quot;。</li>
                <li><b>测量</b>：旋转检偏器找到新的{mode === "triple_field" ? "暗零度视场" : "消光位置"}，点击&quot;记录测量&quot;。</li>
                <li><b>读数</b>：查看旋光度 α 和比旋光度 [α] 的计算结果。</li>
              </ol>
              {mode === "triple_field" && (
                <div className="mt-2 pt-2 border-t border-[#ebeef2]">
                  <h5 className="text-[10px] font-semibold text-[#2d3142] mb-1">三分视场法原理</h5>
                  <p className="text-[9.5px] text-[#6b7280] leading-relaxed">
                    半波片将中间部分偏振面旋转2θ，使视场分为三部分。
                    旋转检偏器至三部分亮度一致的<b>暗</b>视场即为零度视场。
                    此法比消光法灵敏度高得多，因为人眼对亮度差比对绝对亮度更敏感。
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Mode Switch */}
          <div>
            <h3 className="text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider mb-2" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
              测量模式
            </h3>
            <div className="flex border border-[#d4d8e0] rounded overflow-hidden">
              <button
                onClick={() => handleModeChange("extinction")}
                className={`flex-1 py-1.5 text-[11px] font-medium transition-colors ${
                  mode === "extinction"
                    ? "bg-[#2d3142] text-white"
                    : "bg-white text-[#4a4a5a] hover:bg-[#f0f2f6]"
                }`}
              >
                消光法
              </button>
              <button
                onClick={() => handleModeChange("triple_field")}
                className={`flex-1 py-1.5 text-[11px] font-medium transition-colors ${
                  mode === "triple_field"
                    ? "bg-[#2d3142] text-white"
                    : "bg-white text-[#4a4a5a] hover:bg-[#f0f2f6]"
                }`}
              >
                三分视场法
              </button>
            </div>
          </div>

          {/* Shadow angle (triple-field only) */}
          {mode === "triple_field" && (
            <div className="border-t border-[#d4d8e0] pt-3">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-[11px] text-[#2d3142]">荫视角 θ</Label>
                  <span className="text-[10px] text-[#6b7280] mono-digits">{shadowAngle}°</span>
                </div>
                <Slider
                  value={[shadowAngle]}
                  onValueChange={([v]) => setShadowAngle(v)}
                  min={2}
                  max={10}
                  step={1}
                />
                <p className="text-[9px] text-[#9ca3af]">半波片光轴与起偏器通光轴的夹角（2°~10°）</p>
              </div>
            </div>
          )}

          {/* Wavelength */}
          <div className="border-t border-[#d4d8e0] pt-3">
            <h3 className="text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider mb-2" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
              光源波长
            </h3>
            <Select value={String(wavelength)} onValueChange={(v) => setWavelength(Number(v))}>
              <SelectTrigger className="h-8 text-[12px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {WAVELENGTH_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={String(opt.value)}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Zero point */}
          <div className="border-t border-[#d4d8e0] pt-3">
            <h3 className="text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider mb-2" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
              零点
            </h3>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] text-[#6b7280]">零点角度 φ₀</span>
              <span className="text-[12px] text-[#1a1a2e] mono-digits font-medium">
                {zeroAngle !== null ? `${formatAngle(zeroAngle)}°` : "未记录"}
              </span>
            </div>
            {phase === "zeroing" && (
              <Button
                onClick={handleRecordZero}
                className="w-full h-8 text-[11px] bg-[#2d3142] hover:bg-[#3d4152] text-white"
                disabled={zeroAngle !== null || (mode === "triple_field" && fieldState === "uniform_bright")}
              >
                记录零点
              </Button>
            )}
          </div>

          {/* Sample */}
          <div className="border-t border-[#d4d8e0] pt-3">
            <h3 className="text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider mb-2" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
              样品选择
            </h3>
            <Select value={isCustom ? "custom" : selectedPresetId} onValueChange={(v) => { if (v === "custom") { setIsCustom(true); } else { handlePresetChange(v); } }}>
              <SelectTrigger className="h-8 text-[12px]"><SelectValue placeholder="选择预设物质…" /></SelectTrigger>
              <SelectContent>
                {SUBSTANCE_PRESETS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} ([α]={p.specificRotation589 > 0 ? "+" : ""}{p.specificRotation589}°)
                  </SelectItem>
                ))}
                <SelectItem value="custom">自定义物质…</SelectItem>
              </SelectContent>
            </Select>

            {isCustom && (
              <div className="mt-2 space-y-2">
                <div className="space-y-1">
                  <Label className="text-[11px] text-[#6b7280]">物质名称</Label>
                  <Input value={customName} onChange={(e) => setCustomName(e.target.value)} className="h-7 text-[11px]" placeholder="例：D-果糖" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] text-[#6b7280]">比旋光度 [α]²⁰_D</Label>
                  <Input type="number" value={customRotation} onChange={(e) => setCustomRotation(parseFloat(e.target.value) || 0)} className="h-7 text-[11px]" step="0.1" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] text-[#6b7280]">溶剂</Label>
                  <Input value={customSolvent} onChange={(e) => setCustomSolvent(e.target.value)} className="h-7 text-[11px]" placeholder="水" />
                </div>
              </div>
            )}

            {currentSubstance && (
              <div className="mt-3 space-y-2.5">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-[11px] text-[#2d3142]">浓度 c (g/mL)</Label>
                    <span className="text-[10px] text-[#6b7280] mono-digits">{concentration.toFixed(3)}</span>
                  </div>
                  <Slider value={[concentration]} onValueChange={([v]) => setConcentration(v)} min={0.01} max={0.50} step={0.005} />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-[11px] text-[#2d3142]">管长 l (dm)</Label>
                    <span className="text-[10px] text-[#6b7280] mono-digits">{tubeLength.toFixed(1)}</span>
                  </div>
                  <Slider value={[tubeLength]} onValueChange={([v]) => setTubeLength(v)} min={0.5} max={4.0} step={0.1} />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-[11px] text-[#2d3142]">温度 T (°C)</Label>
                    <span className="text-[10px] text-[#6b7280] mono-digits">{temperature}</span>
                  </div>
                  <Slider value={[temperature]} onValueChange={([v]) => setTemperature(v)} min={15} max={30} step={1} />
                </div>

                {!hasSample && zeroAngle !== null && (
                  <Button onClick={handleLoadSample} className="w-full h-8 text-[11px] bg-[#2d3142] hover:bg-[#3d4152] text-white">
                    装入样品管
                  </Button>
                )}
                {hasSample && (
                  <div className="bg-white border border-[#d4d8e0] rounded p-2">
                    <p className="text-[10px] text-[#008800]">✓ 样品已装入光路</p>
                    <p className="text-[10px] text-[#6b7280] mt-1">{currentSubstance.name} · c={concentration.toFixed(3)} g/mL · l={tubeLength.toFixed(1)} dm</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Measurement Results */}
          <div className="border-t border-[#d4d8e0] pt-3">
            <h3 className="text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider mb-2" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
              测量结果
            </h3>
            <div className="bg-white border border-[#d4d8e0] rounded p-2.5 space-y-1.5">
              <div className="flex justify-between">
                <span className="text-[10px] text-[#6b7280]">检偏器角度 θ</span>
                <span className="text-[11px] text-[#1a1a2e] mono-digits font-medium">{formatAngle(analyzerAngle)}°</span>
              </div>
              {mode === "extinction" ? (
                <div className="flex justify-between">
                  <span className="text-[10px] text-[#6b7280]">相对光强 I/I₀</span>
                  <span className="text-[11px] mono-digits font-medium" style={{ color: nearExtinction ? "#008800" : "#1a1a2e" }}>
                    {formatIntensity(intensity)}{nearExtinction ? " ←消光" : ""}
                  </span>
                </div>
              ) : (
                <>
                  <div className="flex justify-between">
                    <span className="text-[10px] text-[#6b7280]">边缘光强 I_edge</span>
                    <span className="text-[11px] text-[#1a1a2e] mono-digits">{edgeIntensity.toFixed(3)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[10px] text-[#6b7280]">中间光强 I_mid</span>
                    <span className="text-[11px] text-[#1a1a2e] mono-digits">{centerIntensity.toFixed(3)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[10px] text-[#6b7280]">亮度差 ΔI</span>
                    <span className="text-[11px] mono-digits font-medium" style={{ color: nearTripleZero ? "#008800" : "#1a1a2e" }}>
                      {Math.abs(edgeIntensity - centerIntensity).toFixed(3)}{nearTripleZero ? " ←均匀" : ""}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[10px] text-[#6b7280]">灵敏度 dΔI/dβ</span>
                    <span className="text-[11px] mono-digits" style={{ color: sensitivity < 0.003 ? "#CC0000" : "#1a1a2e" }}>
                      {sensitivity.toFixed(4)}{sensitivity < 0.003 ? " ⚠迟钝" : ""}
                    </span>
                  </div>
                </>
              )}
              <div className="flex justify-between">
                <span className="text-[10px] text-[#6b7280]">零点 φ₀</span>
                <span className="text-[11px] text-[#1a1a2e] mono-digits">{zeroAngle !== null ? `${formatAngle(zeroAngle)}°` : "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[10px] text-[#6b7280]">测量角 φ₁</span>
                <span className="text-[11px] text-[#1a1a2e] mono-digits">{measurementAngle !== null ? `${formatAngle(measurementAngle)}°` : "—"}</span>
              </div>
              <div className="border-t border-[#ebeef2] pt-1.5 mt-1">
                <div className="flex justify-between">
                  <span className="text-[10px] text-[#6b7280] font-medium">旋光度 α</span>
                  <span className="text-[12px] text-[#1a1a2e] mono-digits font-semibold">
                    {measuredRotation !== null ? `${measuredRotation > 0 ? "+" : ""}${formatAngle(measuredRotation)}°` : "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[10px] text-[#6b7280]">比旋光度 [α]</span>
                  <span className="text-[11px] text-[#1a1a2e] mono-digits font-medium">
                    {measuredSpecificRotation !== null ? `${measuredSpecificRotation > 0 ? "+" : ""}${measuredSpecificRotation.toFixed(1)} °·mL/(g·dm)` : "—"}
                  </span>
                </div>
                {hasSample && currentSubstance && (
                  <div className="flex justify-between mt-1">
                    <span className="text-[10px] text-[#6b7280]">理论 [α]</span>
                    <span className="text-[11px] text-[#9ca3af] mono-digits">
                      {(() => {
                        if ("specificRotation589" in currentSubstance) {
                          const sr = currentSubstance.specificRotation589;
                          return `${sr > 0 ? "+" : ""}${sr.toFixed(1)} °·mL/(g·dm)`;
                        }
                        return `${customRotation > 0 ? "+" : ""}${customRotation.toFixed(1)} °·mL/(g·dm)`;
                      })()}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {(mode === "extinction"
              ? phase === "measuring" && hasSample && nearExtinction
              : phase === "measuring" && hasSample && nearTripleZero
            ) && (
              <Button onClick={handleRecordMeasurement} className="w-full h-8 text-[11px] mt-2 bg-[#008800] hover:bg-[#006600] text-white">
                记录{mode === "triple_field" ? "零度视场" : "消光位置"}
              </Button>
            )}

            <div className="flex items-center justify-between mt-2">
              <Label className="text-[11px] text-[#2d3142]">显示理论值</Label>
              <Switch checked={showTheoretical} onCheckedChange={setShowTheoretical} />
            </div>
          </div>

          {/* Angle input */}
          <div className="border-t border-[#d4d8e0] pt-3">
            <h3 className="text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider mb-2" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
              角度输入
            </h3>
            <div className="flex gap-2">
              <Input type="number" value={analyzerAngle.toFixed(1)} onChange={(e) => handleAngleInput(e.target.value)} className="h-7 text-[11px] mono-digits flex-1" step="0.1" min="0" max="360" />
              <span className="text-[11px] text-[#6b7280] self-center">°</span>
            </div>
          </div>

          {/* Reset */}
          <div className="border-t border-[#d4d8e0] pt-3">
            <Button onClick={handleReset} variant="outline" className="w-full h-8 text-[11px] border-[#d4d8e0] text-[#6b7280]">
              重置实验
            </Button>
          </div>
        </div>
      </div>

      {/* Visualization */}
      <div className="flex-1 flex flex-col overflow-auto bg-white p-4">
        <div className="flex flex-col items-center gap-4">
          {/* Optical bench */}
          <div>
            <div className="text-[10px] text-[#9ca3af] uppercase tracking-wider mb-1" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
              实验台光路
            </div>
            <OpticalBenchCanvas
              wavelength={wavelength}
              hasSample={hasSample}
              sampleName={sampleName}
              analyzerAngle={analyzerAngle}
              beamColor={beamColor}
              intensity={displayIntensity}
              mode={mode}
              shadowAngle={shadowAngle}
            />
          </div>

          {/* Triple-field eyepiece (only in triple-field mode) */}
          {mode === "triple_field" && (
            <div>
              <div className="text-[10px] text-[#9ca3af] uppercase tracking-wider mb-1" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
                三分视场目镜
              </div>
              <TripleFieldEyepieceCanvas
                edgeIntensity={edgeIntensity}
                centerIntensity={centerIntensity}
                fieldState={fieldState}
                nearZero={nearDimZeroVal}
                greenFlashOn={greenFlashOn}
                beamColor={beamColor}
              />
            </div>
          )}

          {/* Dial + Curve side by side */}
          <div className="flex gap-5 items-start flex-wrap justify-center">
            <div>
              <div className="text-[10px] text-[#9ca3af] uppercase tracking-wider mb-1" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
                检偏器刻度盘 (拖拽旋转)
              </div>
              <AnalyzerDialCanvas angle={analyzerAngle} onAngleChange={setAnalyzerAngle} isDraggingRef={isDraggingRef} />
              {/* Mode indicator below dial — as specified in Section 7 */}
              <div className="flex border border-[#d4d8e0] rounded overflow-hidden mt-1.5">
                <button
                  onClick={() => handleModeChange("extinction")}
                  className={`flex-1 py-1 text-[10px] font-medium transition-colors ${
                    mode === "extinction" ? "bg-[#2d3142] text-white" : "bg-white text-[#4a4a5a]"
                  }`}
                >
                  消光法
                </button>
                <button
                  onClick={() => handleModeChange("triple_field")}
                  className={`flex-1 py-1 text-[10px] font-medium transition-colors ${
                    mode === "triple_field" ? "bg-[#2d3142] text-white" : "bg-white text-[#4a4a5a]"
                  }`}
                >
                  三分视场法
                </button>
              </div>
            </div>

            <div>
              <div className="text-[10px] text-[#9ca3af] uppercase tracking-wider mb-1" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
                {mode === "extinction" ? "光强-角度曲线" : "亮度差-角度曲线"}
              </div>
              {mode === "extinction" ? (
                <MalusLawCanvas
                  analyzerAngle={analyzerAngle}
                  extinctionAngle={extinctionAngle}
                  zeroAngle={zeroAngle ?? 90}
                  showTheoretical={showTheoretical}
                  theoreticalExtinction={hasSample && showTheoretical ? zeroAngle !== null ? zeroAngle + theoreticalRotation : null : null}
                />
              ) : (
                <BrightnessDiffCanvas
                  analyzerAngle={analyzerAngle}
                  opticalRotation={tripleFieldOpticalRotation}
                  shadowAngle={shadowAngle}
                  zeroAngle={zeroAngle ?? findDimZeroAngle(0, shadowAngle)}
                  showTheoretical={showTheoretical}
                  theoreticalRotation={hasSample && showTheoretical ? theoreticalRotation : null}
                />
              )}
            </div>
          </div>

          {/* Intensity bar (extinction) or difference bar (triple-field) */}
          <div className="w-full max-w-lg">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-[#9ca3af]">
                {mode === "extinction" ? "相对光强 I/I₀" : "亮度差 ΔI = |I_mid − I_edge|"}
              </span>
              <span className="text-[12px] text-[#1a1a2e] mono-digits font-medium">
                {mode === "extinction"
                  ? formatIntensity(intensity)
                  : Math.abs(edgeIntensity - centerIntensity).toFixed(3)
                }
              </span>
            </div>
            <div className="h-4 bg-[#f0f2f6] border border-[#d4d8e0] rounded overflow-hidden">
              <div
                className="h-full transition-all duration-75"
                style={{
                  width: `${(mode === "extinction" ? intensity : Math.abs(edgeIntensity - centerIntensity)) * 100}%`,
                  backgroundColor: beamColor,
                  opacity: 0.7 + (mode === "extinction" ? intensity : Math.abs(edgeIntensity - centerIntensity)) * 0.3,
                }}
              />
            </div>
          </div>

          {/* Sensitivity comparison hint when in triple-field mode */}
          {mode === "triple_field" && (
            <div className="w-full max-w-lg bg-[#fafbfc] border border-[#d4d8e0] rounded p-2.5">
              <div className="flex items-center gap-2">
                <svg width="12" height="12" viewBox="0 0 16 16" className="shrink-0">
                  <circle cx="8" cy="8" r="6" stroke="#008800" strokeWidth="1.2" fill="none" />
                  <text x="8" y="11.5" textAnchor="middle" fontSize="8" fill="#008800">✓</text>
                </svg>
                <div className="flex-1">
                  <p className="text-[10px] text-[#4a4a5a] leading-relaxed">
                    <b>精度优势</b>：三分视场法中，人眼对亮度差ΔI的分辨阈值约0.01，
                    而消光法中对绝对光强I的分辨阈值约0.05-0.10。
                    因此三分视场法的角度判读灵敏度约为消光法的5-10倍。
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
