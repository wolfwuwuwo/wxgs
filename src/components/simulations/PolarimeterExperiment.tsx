"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useIsMobile } from "@/hooks/use-mobile";
import { ControlPanel, MobilePanelToggle } from "./shared/ControlPanel";
import { Knob } from "./shared/Knob";
import { ExperimentChecklist, type ChecklistStep } from "./shared/ExperimentChecklist";
import { TearOffButton } from "./shared/TearOffPanel";
import { useSnapshotTarget } from "@/hooks/use-snapshot-target";
import { useExperimentState } from "@/hooks/use-experiment-state";
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
  specificRotationAtTemp,
  mutarotationAtTime,
  type SubstancePreset,
  type CustomSubstance,
  type MeasurementMode,
  type FieldState,
} from "@/lib/optics/polarimeter";

type ExperimentMode = "zero" | "halfshadow" | "concentration" | "dispersion" | "mutarotation" | "mixture";
type ExperimentPhase = "zeroing" | "loaded" | "measuring" | "complete";

// Extended sample preset for the 6 experiment modes
interface SamplePreset {
  name: string;
  specificRotation: number;
  concentration: number;
  tubeLength: number;
  color: string;
  drudeA: number;
  drudeLambda0: number;
  tempCoeff: number;
  mutarotation?: { alpha0: number; alphaEq: number; k: number };
}

const SAMPLE_PRESETS_EXT: SamplePreset[] = [
  {
    name: "葡萄糖", specificRotation: 52.7, concentration: 0.1, tubeLength: 2,
    color: "#F0E8D0", drudeA: 1.82e7, drudeLambda0: 140, tempCoeff: -0.06,
    mutarotation: { alpha0: 112.2, alphaEq: 52.7, k: 0.015 },
  },
  {
    name: "蔗糖", specificRotation: 66.5, concentration: 0.1, tubeLength: 2,
    color: "#F0E8D0", drudeA: 2.30e7, drudeLambda0: 130, tempCoeff: -0.04,
  },
  {
    name: "果糖", specificRotation: -92.4, concentration: 0.1, tubeLength: 2,
    color: "#F0E8D0", drudeA: -3.19e7, drudeLambda0: 140, tempCoeff: -0.07,
    mutarotation: { alpha0: -134.0, alphaEq: -92.4, k: 0.020 },
  },
  {
    name: "酒石酸", specificRotation: 14.0, concentration: 0.1, tubeLength: 2,
    color: "#F0ECD8", drudeA: 4.84e6, drudeLambda0: 135, tempCoeff: -0.02,
  },
  {
    name: "混合物(葡萄糖+果糖)", specificRotation: 0, concentration: 0.1, tubeLength: 2,
    color: "#F0E8D0", drudeA: 0, drudeLambda0: 140, tempCoeff: -0.05,
  },
  {
    name: "自定义", specificRotation: 0, concentration: 0.1, tubeLength: 2,
    color: "#F0F0F0", drudeA: 1.82e7, drudeLambda0: 140, tempCoeff: 0,
  },
];

/* ─── Drude Equation: [α](λ) = A / (λ² - λ₀²) ─── */
function drudeSpecificRotation(A: number, lambda0: number, wavelengthNm: number): number {
  const denom = wavelengthNm * wavelengthNm - lambda0 * lambda0;
  if (Math.abs(denom) < 1) return 0;
  return A / denom;
}

// ═══════════════════════════════════════════════════════════════════
// OpticalBenchCanvas - Canvas-based optical bench (720×120)
// ═══════════════════════════════════════════════════════════════════
function OpticalBenchCanvas({
  wavelength,
  hasSample,
  sampleName,
  analyzerAngle,
  beamColor,
  intensity,
  measurementMode,
  shadowAngle,
}: {
  wavelength: number;
  hasSample: boolean;
  sampleName: string;
  analyzerAngle: number;
  beamColor: string;
  intensity: number;
  measurementMode: MeasurementMode;
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
    const isTriple = measurementMode === "triple_field";

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
    ctx.font = "9px sans-serif";
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
    ctx.font = "8px monospace";
    ctx.textAlign = "center";
    ctx.fillText(`${wavelength}nm`, filterX, axisY + 32);
    ctx.font = "9px sans-serif";
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
    ctx.font = "9px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("起偏器 P₁", polarizerX, axisY + (isTriple ? 34 : 32));

    // 3.5. Half-wave plate (triple-field mode only)
    if (isTriple) {
      drawBeam(polarizerX + 8, hwpX - 12, beamColor);

      ctx.strokeStyle = "#4a4a5a";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(hwpX - 10, axisY - 20, 20, 40);
      ctx.fillStyle = "#4a4a5a";
      ctx.font = "11px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Z", hwpX, axisY + 4);
      const axisAngleRad = (shadowAngle * Math.PI) / 180;
      ctx.strokeStyle = "#6b7280";
      ctx.lineWidth = 0.8;
      ctx.setLineDash([3, 2]);
      ctx.beginPath();
      ctx.moveTo(hwpX + 14, axisY - 14 * Math.cos(axisAngleRad));
      ctx.lineTo(hwpX + 14, axisY + 14 * Math.cos(axisAngleRad));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#9ca3af";
      ctx.font = "7px monospace";
      ctx.textAlign = "left";
      ctx.fillText(`荫视角 θ=${shadowAngle}°`, hwpX + 16, axisY - 12);
      ctx.fillStyle = "#6b7280";
      ctx.font = "9px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("半波片", hwpX, axisY + 34);

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
      ctx.font = "8px sans-serif";
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
      ctx.font = "9px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("样品管仓", sampleX, axisY + 28);
      ctx.fillText("(空)", sampleX, axisY + 38);
    }

    drawBeam(sampleX + (hasSample ? 32 : 28), analyzerX - 20, beamColor, hasSample ? 0.85 : 1);

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
    ctx.font = "9px sans-serif";
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
      ctx.font = "10px monospace";
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
      ctx.font = "11px monospace";
      ctx.textAlign = "left";
      ctx.fillText(`I/I₀ = ${formatIntensity(intensity)}`, detectorX - 16, axisY + 44);
      ctx.fillStyle = "#6b7280";
      ctx.font = "9px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("探测器", detectorX, axisY + 28);
    }
  }, [wavelength, hasSample, sampleName, analyzerAngle, beamColor, intensity, measurementMode, shadowAngle]);

  return <canvas ref={canvasRef} className="border border-[#d4d8e0] bg-white" style={{ maxWidth: '100%', height: 'auto' }} />;
}

// ═══════════════════════════════════════════════════════════════════
// AnalyzerDialCanvas - Interactive dial (260×260)
// ═══════════════════════════════════════════════════════════════════
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
        ctx.font = "8px monospace";
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

    // Vernier scale (0.1° resolution) - inner ring with 10 divisions spanning 9°
    const vernierBase = Math.floor(angle / 10) * 10; // base degree mark
    const vernierFrac = (angle % 10); // fractional part
    ctx.strokeStyle = "#cc0000";
    ctx.lineWidth = 0.8;
    const vernierSpan = 9; // 10 divisions of vernier span 9° on main scale
    for (let i = 0; i <= 10; i++) {
      const vDeg = vernierBase + (i / 10) * vernierSpan;
      const vRad = ((vDeg - 90) * Math.PI) / 180;
      const vOuter = outerR - 22;
      const vInner = vOuter - (i % 5 === 0 ? 8 : 4);
      ctx.beginPath();
      ctx.moveTo(cx + vOuter * Math.cos(vRad), cy + vOuter * Math.sin(vRad));
      ctx.lineTo(cx + vInner * Math.cos(vRad), cy + vInner * Math.sin(vRad));
      ctx.stroke();
    }
    // Vernier reading indicator (arrow pointing to aligned mark)
    const alignedMark = Math.round(vernierFrac * 10) / 10;
    const alignedDeg = vernierBase + alignedMark * vernierSpan / 10;
    const alignedRad = ((alignedDeg - 90) * Math.PI) / 180;
    ctx.fillStyle = "#cc0000";
    ctx.beginPath();
    ctx.moveTo(cx + (outerR - 22) * Math.cos(alignedRad), cy + (outerR - 22) * Math.sin(alignedRad));
    ctx.lineTo(cx + (outerR - 36) * Math.cos(alignedRad - 0.05), cy + (outerR - 36) * Math.sin(alignedRad - 0.05));
    ctx.lineTo(cx + (outerR - 36) * Math.cos(alignedRad + 0.05), cy + (outerR - 36) * Math.sin(alignedRad + 0.05));
    ctx.fill();

    // Angle display
    ctx.fillStyle = "#1a1a2e";
    ctx.font = "12px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(`${formatAngle(angle % 360)}°`, cx, cy + outerR + 4);
    ctx.fillStyle = "#9ca3af";
    ctx.font = "7px monospace";
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

  return <canvas ref={canvasRef} className="border border-[#d4d8e0] bg-white cursor-grab active:cursor-grabbing" style={{ maxWidth: '100%', height: 'auto', touchAction: 'none' }} />;
}

// ═══════════════════════════════════════════════════════════════════
// MalusLawCanvas - I-θ curve (440×160)
// ═══════════════════════════════════════════════════════════════════
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
      const intens = Math.cos(((theta - extinctionAngle) * Math.PI) / 180) ** 2;
      const x = margin.left + i;
      const y = h - margin.bottom - intens * plotH;
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
      ctx.font = "8px monospace";
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
        ctx.font = "8px monospace";
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
    ctx.font = "9px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("检偏器角度 θ (°)", w / 2, h - 3);
    ctx.save();
    ctx.translate(10, margin.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("I/I₀", 0, 0);
    ctx.restore();
    ctx.font = "10px sans-serif";
    ctx.fillStyle = "#2d3142";
    ctx.textAlign = "left";
    ctx.fillText("光强曲线 I = I₀cos²(θ−φ)", margin.left + 4, margin.top + 10);
  }, [analyzerAngle, extinctionAngle, zeroAngle, showTheoretical, theoreticalExtinction]);

  return <canvas ref={canvasRef} className="border border-[#d4d8e0] bg-white" style={{ maxWidth: '100%', height: 'auto' }} />;
}

// ═══════════════════════════════════════════════════════════════════
// TripleFieldEyepieceCanvas - Half-shadow field view (420×140)
// ═══════════════════════════════════════════════════════════════════
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

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);

    const viewLeft = 20;
    const viewTop = 15;
    const viewW = w - 40;
    const viewH = h - 45;

    const showGreen = nearZero && greenFlashOn;
    ctx.strokeStyle = showGreen ? "#008800" : "#2d3142";
    ctx.lineWidth = showGreen ? 2.5 : 1.2;
    ctx.strokeRect(viewLeft, viewTop, viewW, viewH);

    const thirdW = viewW / 3;
    const boundaries = [viewLeft + thirdW, viewLeft + 2 * thirdW];

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

    const sections = [
      { intensity: edgeIntensity, label: "边缘" },
      { intensity: centerIntensity, label: "中间" },
      { intensity: edgeIntensity, label: "边缘" },
    ];

    const hexToRgb = (hex: string) => {
      const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
      if (!m) return { r: 200, g: 168, b: 0 };
      return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
    };
    const rgb = hexToRgb(beamColor);

    sections.forEach((section, i) => {
      const sx = viewLeft + i * thirdW;
      const cr = Math.round(rgb.r * section.intensity);
      const cg = Math.round(rgb.g * section.intensity);
      const cb = Math.round(rgb.b * section.intensity);
      ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
      ctx.fillRect(sx, viewTop, thirdW, viewH);
      ctx.fillStyle = "#9ca3af";
      ctx.font = "7px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(section.label, sx + thirdW / 2, viewTop + viewH + 10);
    });

    ctx.font = "8px monospace";
    ctx.fillStyle = "#6b7280";
    sections.forEach((section, i) => {
      const sx = viewLeft + i * thirdW;
      ctx.fillText(`I=${section.intensity.toFixed(2)}`, sx + thirdW / 2, viewTop + viewH + 20);
    });

    const stateLabel = fieldStateLabel(fieldState);
    const isFalseZero = fieldState === "uniform_bright";
    ctx.font = isFalseZero ? "12px sans-serif" : "10px sans-serif";
    ctx.fillStyle = isFalseZero ? "#CC0000" : "#4a4a5a";
    ctx.textAlign = "center";
    ctx.fillText(stateLabel, w / 2, h - 3);
  }, [edgeIntensity, centerIntensity, fieldState, nearZero, greenFlashOn, beamColor]);

  return <canvas ref={canvasRef} className="border border-[#d4d8e0] bg-white" style={{ maxWidth: '100%', height: 'auto' }} />;
}

// ═══════════════════════════════════════════════════════════════════
// BrightnessDiffCanvas - ΔI curve for triple-field mode (440×160)
// ═══════════════════════════════════════════════════════════════════
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

    ctx.strokeStyle = "#9ca3af";
    ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(margin.left, h - margin.bottom); ctx.lineTo(w - margin.right, h - margin.bottom); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(margin.left, margin.top); ctx.lineTo(margin.left, h - margin.bottom); ctx.stroke();

    const dimZero = findDimZeroAngle(opticalRotation, shadowAngle);
    const brightZero = findBrightZeroAngle(opticalRotation, shadowAngle);
    const rangeStart = dimZero - 90;
    const rangeEnd = dimZero + 90;

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

    const zeroX = margin.left + ((zeroAngle - rangeStart) / (rangeEnd - rangeStart)) * plotW;
    if (zeroX >= margin.left && zeroX <= w - margin.right) {
      ctx.setLineDash([3, 2]);
      ctx.strokeStyle = "#6b7280";
      ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(zeroX, margin.top); ctx.lineTo(zeroX, h - margin.bottom); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#6b7280";
      ctx.font = "8px monospace";
      ctx.textAlign = "center";
      ctx.fillText("φ₀", zeroX, margin.top - 2);
    }

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
      ctx.font = "7px monospace";
      ctx.textAlign = "center";
      ctx.fillText("假零点", falseX, h - margin.bottom + 18);
    }

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
        ctx.font = "8px monospace";
        ctx.textAlign = "center";
        ctx.fillText("理论值", theoX, margin.top - 2);
      }
    }

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

    ctx.fillStyle = "#6b7280";
    ctx.font = "9px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("检偏器角度 θ (°)", w / 2, h - 3);
    ctx.save();
    ctx.translate(10, margin.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("ΔI", 0, 0);
    ctx.restore();
    ctx.font = "10px sans-serif";
    ctx.fillStyle = "#2d3142";
    ctx.textAlign = "left";
    ctx.fillText("亮度差 ΔI = |I_mid − I_edge|", margin.left + 4, margin.top + 10);
  }, [analyzerAngle, opticalRotation, shadowAngle, zeroAngle, showTheoretical, theoreticalRotation]);

  return <canvas ref={canvasRef} className="border border-[#d4d8e0] bg-white" style={{ maxWidth: '100%', height: 'auto' }} />;
}

// ═══════════════════════════════════════════════════════════════════
// DispersionCurveCanvas - Drude dispersion curve
// ═══════════════════════════════════════════════════════════════════
function DispersionCurveCanvas({
  data,
  currentWavelength,
  currentSpecRot,
  beamColor,
}: {
  data: { wl: number; specRot: number }[];
  currentWavelength: number;
  currentSpecRot: number;
  beamColor: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.length === 0) return;
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

    const margin = { left: 50, right: 12, top: 14, bottom: 28 };
    const plotW = w - margin.left - margin.right;
    const plotH = h - margin.top - margin.bottom;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);

    const minRot = Math.min(...data.map(d => d.specRot));
    const maxRot = Math.max(...data.map(d => d.specRot));
    const range = maxRot - minRot || 1;
    const padRange = range * 0.1;
    const yMin = minRot - padRange;
    const yMax = maxRot + padRange;

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

    // Curve
    ctx.beginPath();
    data.forEach((d, i) => {
      const x = margin.left + ((d.wl - 400) / 300) * plotW;
      const y = margin.top + plotH - ((d.specRot - yMin) / (yMax - yMin)) * plotH;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = "#2d3142";
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Current wavelength marker
    const cx = margin.left + ((currentWavelength - 400) / 300) * plotW;
    const cy = margin.top + plotH - ((currentSpecRot - yMin) / (yMax - yMin)) * plotH;
    ctx.fillStyle = beamColor;
    ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fill();

    // Labels
    ctx.fillStyle = "#6b7280";
    ctx.font = "9px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("波长 λ (nm)", w / 2, h - 3);
    ctx.save();
    ctx.translate(12, margin.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("[α](λ)", 0, 0);
    ctx.restore();
    ctx.font = "10px sans-serif";
    ctx.fillStyle = "#2d3142";
    ctx.textAlign = "left";
    ctx.fillText("旋光色散 [α](λ) = A/(λ²−λ₀²)", margin.left + 4, margin.top + 10);
  }, [data, currentWavelength, currentSpecRot, beamColor]);

  return <canvas ref={canvasRef} className="border border-[#d4d8e0] bg-white" style={{ maxWidth: '100%', height: 'auto' }} />;
}

// ═══════════════════════════════════════════════════════════════════
// MutarotationCurveCanvas
// ═══════════════════════════════════════════════════════════════════
function MutarotationCurveCanvas({
  data,
  currentTime,
}: {
  data: { t: number; alpha: number }[];
  currentTime: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.length === 0) return;
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

    const margin = { left: 50, right: 12, top: 14, bottom: 28 };
    const plotW = w - margin.left - margin.right;
    const plotH = h - margin.top - margin.bottom;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);

    const maxT = data[data.length - 1]?.t || 120;
    const minA = Math.min(...data.map(d => d.alpha));
    const maxA = Math.max(...data.map(d => d.alpha));
    const rangeA = maxA - minA || 1;
    const padA = rangeA * 0.1;
    const yMin = minA - padA;
    const yMax = maxA + padA;

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

    ctx.strokeStyle = "#9ca3af";
    ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(margin.left, h - margin.bottom); ctx.lineTo(w - margin.right, h - margin.bottom); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(margin.left, margin.top); ctx.lineTo(margin.left, h - margin.bottom); ctx.stroke();

    ctx.beginPath();
    data.forEach((d, i) => {
      const x = margin.left + (d.t / maxT) * plotW;
      const y = margin.top + plotH - ((d.alpha - yMin) / (yMax - yMin)) * plotH;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = "#2d3142";
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Current time marker
    const cx = margin.left + (currentTime / maxT) * plotW;
    // Interpolate alpha at current time
    const curDataPoint = data.find(d => d.t >= currentTime) || data[data.length - 1];
    if (curDataPoint) {
      const cy = margin.top + plotH - ((curDataPoint.alpha - yMin) / (yMax - yMin)) * plotH;
      ctx.fillStyle = "#cc0000";
      ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(204,0,0,0.3)";
      ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(cx, margin.top); ctx.lineTo(cx, h - margin.bottom); ctx.stroke();
    }

    ctx.fillStyle = "#6b7280";
    ctx.font = "9px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("时间 t (min)", w / 2, h - 3);
    ctx.save();
    ctx.translate(12, margin.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("α(t) (°)", 0, 0);
    ctx.restore();
    ctx.font = "10px sans-serif";
    ctx.fillStyle = "#2d3142";
    ctx.textAlign = "left";
    ctx.fillText("变旋曲线 α(t) = α∞ + (α₀−α∞)e⁻ᵏᵗ", margin.left + 4, margin.top + 10);
  }, [data, currentTime]);

  return <canvas ref={canvasRef} className="border border-[#d4d8e0] bg-white" style={{ maxWidth: '100%', height: 'auto' }} />;
}

// ═══════════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════════
export default function PolarimeterExperiment({ onBack }: { onBack: () => void }) {
  const isMobile = useIsMobile();
  const [panelOpen, setPanelOpen] = useState(false);
  // ─── 实验状态缓存（步骤三：切换模块后恢复） ───
  const cachedState = typeof window !== 'undefined'
    ? (() => { try { return JSON.parse(localStorage.getItem('ops-lab-v3') || '{}')?.state?.['physical-polarimeter']?.state || null } catch { return null } })()
    : null
  // ─── Core state ───
  const [analyzerAngle, setAnalyzerAngle] = useState(cachedState?.analyzerAngle ?? 90.0);
  const [sampleInserted, setSampleInserted] = useState(cachedState?.sampleInserted ?? false);
  const [selectedPreset, setSelectedPreset] = useState(cachedState?.selectedPreset ?? 0);
  const [customSpecRotation, setCustomSpecRotation] = useState(cachedState?.customSpecRotation ?? 0);
  const [customConcentration, setCustomConcentration] = useState(cachedState?.customConcentration ?? 0.1);
  const [customTubeLength, setCustomTubeLength] = useState(cachedState?.customTubeLength ?? 2);
  const [wavelengthIdx, setWavelengthIdx] = useState(cachedState?.wavelengthIdx ?? 0);
  const [zeroAngle, setZeroAngle] = useState<number | null>(cachedState?.zeroAngle ?? null);
  const [measurementAngle, setMeasurementAngle] = useState<number | null>(cachedState?.measurementAngle ?? null);

  // ─── Advanced features state ───
  const [temperature, setTemperature] = useState(cachedState?.temperature ?? 20);
  const [mutarotTime, setMutarotTime] = useState(cachedState?.mutarotTime ?? 0);
  const [mutarotRunning, setMutarotRunning] = useState(false);
  const [experimentMode, setExperimentMode] = useState<ExperimentMode>(cachedState?.experimentMode ?? "zero");

  // ─── Mixture state ───
  const [mixtureGlucose, setMixtureGlucose] = useState(cachedState?.mixtureGlucose ?? 0.05);
  const [mixtureFructose, setMixtureFructose] = useState(cachedState?.mixtureFructose ?? 0.05);
  const [mixturePH, setMixturePH] = useState(cachedState?.mixturePH ?? 7.0);

  // ─── 可视化区域 ref（用于快照捕获 + 撕下面板） ───
  const vizRef = useRef<HTMLDivElement>(null);

  // ─── 快照目标注册（StatusBar 快照按钮触发） ───
  useSnapshotTarget('physical-polarimeter', {
    targetRef: vizRef,
    getTitle: () => `旋光仪 · 检偏角 ${analyzerAngle.toFixed(1)}° · ${WAVELENGTH_OPTIONS[wavelengthIdx].label}`,
    getParams: () => [
      { key: 'λ', value: `${WAVELENGTH_OPTIONS[wavelengthIdx].value}nm` },
      { key: 'θ分析', value: `${analyzerAngle.toFixed(1)}°` },
      { key: '样品', value: sampleInserted ? SAMPLE_PRESETS_EXT[selectedPreset]?.name || '自定义' : '未放入' },
      { key: '温度', value: `${temperature}°C` },
      ...(zeroAngle != null ? [{ key: 'θ零位', value: `${zeroAngle.toFixed(2)}°` }] : []),
      ...(measurementAngle != null ? [{ key: 'θ测', value: `${measurementAngle.toFixed(2)}°` }] : []),
    ],
  })

  // ─── 状态缓存：卸载时保存 ───
  useEffect(() => {
    return () => {
      try {
        const store = JSON.parse(localStorage.getItem('ops-lab-v3') || '{}')
        if (!store.state) store.state = {}
        store.state['physical-polarimeter'] = {
          viewId: 'physical-polarimeter',
          state: {
            analyzerAngle, sampleInserted, selectedPreset,
            customSpecRotation, customConcentration, customTubeLength,
            wavelengthIdx, zeroAngle, measurementAngle,
            temperature, experimentMode, mixtureGlucose, mixtureFructose, mixturePH,
          },
          updatedAt: new Date().toISOString(),
        }
        localStorage.setItem('ops-lab-v3', JSON.stringify(store))
      } catch { /* ignore */ }
    }
  }, [analyzerAngle, sampleInserted, selectedPreset, wavelengthIdx, zeroAngle, measurementAngle, temperature, experimentMode])

  // ─── Triple-field state ───
  const [measurementMode, setMeasurementMode] = useState<MeasurementMode>("extinction");
  const [shadowAngle, setShadowAngle] = useState(3);
  const [greenFlashOn, setGreenFlashOn] = useState(true);
  const [showTheoretical, setShowTheoretical] = useState(false);
  const [phase, setPhase] = useState<ExperimentPhase>("zeroing");

  const isDraggingRef = useRef(false);

  // ─── Wavelength ───
  const wavelength = WAVELENGTH_OPTIONS[wavelengthIdx].value;
  const beamColor = useMemo(() => wavelengthToColor(wavelength), [wavelength]);

  // ─── Mutarotation timer ───
  const mutarotTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (mutarotRunning) {
      mutarotTimerRef.current = setInterval(() => {
        setMutarotTime(prev => prev + 0.5);
      }, 500);
    } else {
      if (mutarotTimerRef.current) clearInterval(mutarotTimerRef.current);
    }
    return () => { if (mutarotTimerRef.current) clearInterval(mutarotTimerRef.current); };
  }, [mutarotRunning]);

  // ─── Green flash timer (2Hz) ───
  useEffect(() => {
    if (measurementMode !== "triple_field") return;
    const interval = setInterval(() => {
      setGreenFlashOn(prev => !prev);
    }, 250);
    return () => clearInterval(interval);
  }, [measurementMode]);

  // ─── Current sample ───
  const sample = useMemo(() => {
    if (selectedPreset < SAMPLE_PRESETS_EXT.length - 1) {
      return SAMPLE_PRESETS_EXT[selectedPreset];
    }
    return {
      name: "自定义", specificRotation: customSpecRotation,
      concentration: customConcentration, tubeLength: customTubeLength,
      color: "#F0F0F0", drudeA: 1.82e7, drudeLambda0: 140, tempCoeff: 0,
    };
  }, [selectedPreset, customSpecRotation, customConcentration, customTubeLength]);

  // ─── Specific rotation with Drude wavelength correction ───
  const effectiveSpecRotation = useMemo(() => {
    if (sample.name === "混合物(葡萄糖+果糖)") return 0;
    if (sample.name === "自定义") return sample.specificRotation;
    const baseRotation = sample.specificRotation;
    const drudeAt589 = drudeSpecificRotation(sample.drudeA, sample.drudeLambda0, 589.3);
    const drudeAtLambda = drudeSpecificRotation(sample.drudeA, sample.drudeLambda0, wavelength);
    if (Math.abs(drudeAt589) < 0.001) return baseRotation;
    return baseRotation * (drudeAtLambda / drudeAt589);
  }, [sample, wavelength]);

  // ─── Temperature correction ───
  const tempCorrectedSpecRotation = useMemo(() => {
    if (sample.name === "混合物(葡萄糖+果糖)") return 0;
    return effectiveSpecRotation + sample.tempCoeff * (temperature - 20);
  }, [effectiveSpecRotation, sample, temperature]);

  // ─── Mutarotation correction ───
  const mutarotCorrectedSpecRotation = useMemo(() => {
    if (!sample.mutarotation || sample.name === "混合物(葡萄糖+果糖)") return tempCorrectedSpecRotation;
    const { alpha0, alphaEq, k } = sample.mutarotation;
    const currentAlpha = mutarotationAtTime(alpha0, alphaEq, k, mutarotTime);
    if (Math.abs(alphaEq) < 0.001) return tempCorrectedSpecRotation;
    return tempCorrectedSpecRotation * (currentAlpha / alphaEq);
  }, [tempCorrectedSpecRotation, sample, mutarotTime]);

  // ─── Mixture specific rotation ───
  const mixtureSpecRotation = useMemo(() => {
    if (sample.name !== "混合物(葡萄糖+果糖)") return mutarotCorrectedSpecRotation;
    const glucose = SAMPLE_PRESETS_EXT[0];
    const fructose = SAMPLE_PRESETS_EXT[2];
    const g589 = drudeSpecificRotation(glucose.drudeA, glucose.drudeLambda0, 589.3);
    const gLambda = drudeSpecificRotation(glucose.drudeA, glucose.drudeLambda0, wavelength);
    const f589 = drudeSpecificRotation(fructose.drudeA, fructose.drudeLambda0, 589.3);
    const fLambda = drudeSpecificRotation(fructose.drudeA, fructose.drudeLambda0, wavelength);
    const gSpec = Math.abs(g589) > 0.001 ? glucose.specificRotation * (gLambda / g589) : glucose.specificRotation;
    const fSpec = Math.abs(f589) > 0.001 ? fructose.specificRotation * (fLambda / f589) : fructose.specificRotation;
    const phFactor = 1 + 0.3 * Math.max(0, 7 - mixturePH);
    const gCurrent = glucose.mutarotation
      ? mutarotationAtTime(glucose.mutarotation.alpha0, glucose.mutarotation.alphaEq, glucose.mutarotation.k * phFactor, mutarotTime) / glucose.mutarotation.alphaEq * gSpec
      : gSpec;
    const fCurrent = fructose.mutarotation
      ? mutarotationAtTime(fructose.mutarotation.alpha0, fructose.mutarotation.alphaEq, fructose.mutarotation.k * phFactor, mutarotTime) / fructose.mutarotation.alphaEq * fSpec
      : fSpec;
    const totalConc = mixtureGlucose + mixtureFructose;
    if (totalConc < 0.001) return 0;
    return (gCurrent * mixtureGlucose + fCurrent * mixtureFructose) / totalConc;
  }, [sample, wavelength, mixtureGlucose, mixtureFructose, mixturePH, mutarotTime, mutarotCorrectedSpecRotation]);

  const finalSpecRotation = mixtureSpecRotation;

  // ─── Final rotation angle ───
  const rotationAngle = useMemo(() => {
    if (!sampleInserted) return 0;
    if (sample.name === "混合物(葡萄糖+果糖)") {
      const totalConc = mixtureGlucose + mixtureFructose;
      return finalSpecRotation * sample.tubeLength * totalConc;
    }
    return finalSpecRotation * sample.tubeLength * sample.concentration;
  }, [sampleInserted, sample, finalSpecRotation, mixtureGlucose, mixtureFructose]);

  // ─── Light intensity: Malus's law ───
  const intensity = useMemo(() => {
    const effectiveAngle = analyzerAngle - rotationAngle;
    const rad = (effectiveAngle * Math.PI) / 180;
    return Math.cos(rad) ** 2;
  }, [analyzerAngle, rotationAngle]);

  // ─── Half-shadow field intensities ───
  const halfShadowDelta = measurementMode === "triple_field" ? shadowAngle : 3.5;
  const halfShadowFields = useMemo(() => {
    const centerEff = analyzerAngle - rotationAngle;
    const sideEff = (analyzerAngle - halfShadowDelta) - rotationAngle;
    return {
      center: Math.cos((centerEff * Math.PI) / 180) ** 2,
      left: Math.cos((sideEff * Math.PI) / 180) ** 2,
      right: Math.cos((sideEff * Math.PI) / 180) ** 2,
    };
  }, [analyzerAngle, rotationAngle, halfShadowDelta]);

  // ─── Extinction mode calculations ───
  const extinctionAngle = useMemo(() => {
    if (measurementMode === "triple_field") {
      const dimZeroBase = 90 + shadowAngle / 2;
      return sampleInserted && zeroAngle !== null ? zeroAngle + rotationAngle : dimZeroBase;
    }
    if (sampleInserted && zeroAngle !== null) return zeroAngle + rotationAngle;
    return zeroAngle ?? 90;
  }, [measurementMode, sampleInserted, zeroAngle, rotationAngle, shadowAngle]);

  // ─── Triple-field calculations ───
  const tripleFieldOpticalRotation = useMemo(() => {
    if (!sampleInserted) return 0;
    return rotationAngle;
  }, [sampleInserted, rotationAngle]);

  const { edge: edgeIntensity, center: centerIntensity } = useMemo(
    () => tripleFieldIntensities(analyzerAngle, tripleFieldOpticalRotation, shadowAngle),
    [analyzerAngle, tripleFieldOpticalRotation, shadowAngle]
  );

  const fieldState = useMemo(
    () => classifyFieldState(analyzerAngle, tripleFieldOpticalRotation, shadowAngle),
    [analyzerAngle, tripleFieldOpticalRotation, shadowAngle]
  );

  const nearFalseZeroVal = useMemo(
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

  // Triple-field: "intensity" for beam opacity
  const tripleFieldAvgIntensity = (edgeIntensity + centerIntensity) / 2;
  const displayIntensity = measurementMode === "triple_field" ? tripleFieldAvgIntensity : intensity;

  // ─── Concentration determination ───
  const concentrationResult = useMemo(() => {
    if (experimentMode !== "concentration") return null;
    if (zeroAngle === null || measurementAngle === null) return null;
    const alpha = measurementAngle - zeroAngle;
    if (Math.abs(finalSpecRotation) < 0.001 || sample.tubeLength === 0) return null;
    const c = alpha / (finalSpecRotation * sample.tubeLength);
    const dAlpha = 0.05;
    const dC = dAlpha / Math.abs(finalSpecRotation * sample.tubeLength);
    return { concentration: c, uncertainty: dC, alpha };
  }, [experimentMode, zeroAngle, measurementAngle, finalSpecRotation, sample]);

  // ─── Dispersion data ───
  const dispersionData = useMemo(() => {
    if (experimentMode !== "dispersion") return [];
    const points: { wl: number; specRot: number }[] = [];
    for (let wl = 400; wl <= 700; wl += 5) {
      if (sample.name === "混合物(葡萄糖+果糖)") {
        const g589 = drudeSpecificRotation(SAMPLE_PRESETS_EXT[0].drudeA, SAMPLE_PRESETS_EXT[0].drudeLambda0, 589.3);
        const gWl = drudeSpecificRotation(SAMPLE_PRESETS_EXT[0].drudeA, SAMPLE_PRESETS_EXT[0].drudeLambda0, wl);
        const f589 = drudeSpecificRotation(SAMPLE_PRESETS_EXT[2].drudeA, SAMPLE_PRESETS_EXT[2].drudeLambda0, 589.3);
        const fWl = drudeSpecificRotation(SAMPLE_PRESETS_EXT[2].drudeA, SAMPLE_PRESETS_EXT[2].drudeLambda0, wl);
        const gSpec = Math.abs(g589) > 0.001 ? SAMPLE_PRESETS_EXT[0].specificRotation * (gWl / g589) : SAMPLE_PRESETS_EXT[0].specificRotation;
        const fSpec = Math.abs(f589) > 0.001 ? SAMPLE_PRESETS_EXT[2].specificRotation * (fWl / f589) : SAMPLE_PRESETS_EXT[2].specificRotation;
        const totalConc = mixtureGlucose + mixtureFructose;
        const mixSpec = totalConc > 0.001 ? (gSpec * mixtureGlucose + fSpec * mixtureFructose) / totalConc : 0;
        points.push({ wl, specRot: mixSpec });
      } else {
        const drude589 = drudeSpecificRotation(sample.drudeA, sample.drudeLambda0, 589.3);
        const drudeWl = drudeSpecificRotation(sample.drudeA, sample.drudeLambda0, wl);
        const specRot = Math.abs(drude589) > 0.001
          ? sample.specificRotation * (drudeWl / drude589)
          : sample.specificRotation;
        points.push({ wl, specRot: specRot + sample.tempCoeff * (temperature - 20) });
      }
    }
    return points;
  }, [experimentMode, sample, temperature, mixtureGlucose, mixtureFructose]);

  // ─── Mutarotation curve ───
  const mutarotCurveData = useMemo(() => {
    if (!sample.mutarotation && sample.name !== "混合物(葡萄糖+果糖)") return [];
    const points: { t: number; alpha: number }[] = [];
    const maxT = 120;
    if (sample.name === "混合物(葡萄糖+果糖)") {
      const phFactor = 1 + 0.3 * Math.max(0, 7 - mixturePH);
      for (let t = 0; t <= maxT; t += 2) {
        const totalConc = mixtureGlucose + mixtureFructose;
        const gSpec = SAMPLE_PRESETS_EXT[0].specificRotation;
        const fSpec = SAMPLE_PRESETS_EXT[2].specificRotation;
        const gMut = SAMPLE_PRESETS_EXT[0].mutarotation;
        const fMut = SAMPLE_PRESETS_EXT[2].mutarotation;
        const gAlpha = gMut ? mutarotationAtTime(gMut.alpha0, gMut.alphaEq, gMut.k * phFactor, t) / gMut.alphaEq * gSpec : gSpec;
        const fAlpha = fMut ? mutarotationAtTime(fMut.alpha0, fMut.alphaEq, fMut.k * phFactor, t) / fMut.alphaEq * fSpec : fSpec;
        const mixAlpha = totalConc > 0.001 ? (gAlpha * mixtureGlucose + fAlpha * mixtureFructose) / totalConc : 0;
        points.push({ t, alpha: mixAlpha * sample.tubeLength * totalConc });
      }
    } else if (sample.mutarotation) {
      const { alpha0, alphaEq, k } = sample.mutarotation;
      for (let t = 0; t <= maxT; t += 2) {
        const currentAlpha = mutarotationAtTime(alpha0, alphaEq, k, t);
        const specRot = currentAlpha / alphaEq * sample.specificRotation;
        points.push({ t, alpha: specRot * sample.tubeLength * sample.concentration });
      }
    }
    return points;
  }, [sample, mixtureGlucose, mixtureFructose, mixturePH]);

  // ─── Measurement results ───
  const measuredRotation = useMemo(() => {
    if (measurementAngle !== null && zeroAngle !== null) return measurementAngle - zeroAngle;
    return null;
  }, [measurementAngle, zeroAngle]);

  const measuredSpecificRotation = useMemo(() => {
    if (measuredRotation !== null && sample.tubeLength > 0 && sample.concentration > 0)
      return measuredRotation / (sample.tubeLength * sample.concentration);
    return null;
  }, [measuredRotation, sample]);

  // ─── Hints ───
  const hintText = useMemo(() => {
    if (measurementMode === "triple_field") {
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
  }, [measurementMode, phase]);

  // ─── False zero warning ───
  const falseZeroWarning = useMemo(() => {
    if (measurementMode !== "triple_field") return false;
    return fieldState === "uniform_bright";
  }, [measurementMode, fieldState]);

  // ─── Auto-detect zero notification ───
  const zeroFoundNotification = useMemo(() => {
    if (measurementMode !== "triple_field") return null;
    if (autoZeroDetected && zeroAngle === null && phase === "zeroing") {
      return `已找到零点 φ₀ = ${formatAngle(analyzerAngle)}°`;
    }
    return null;
  }, [measurementMode, autoZeroDetected, zeroAngle, phase, analyzerAngle]);

  // ─── Handlers ───
  const handleRecordZero = useCallback(() => {
    if (measurementMode === "triple_field" && fieldState === "uniform_bright") return;
    setZeroAngle(analyzerAngle);
    setPhase("loaded");
  }, [analyzerAngle, measurementMode, fieldState]);

  const handleLoadSample = useCallback(() => {
    setSampleInserted(true);
    setPhase("measuring");
  }, []);

  const handleRecordMeasurement = useCallback(() => {
    if (measurementMode === "triple_field" && fieldState === "uniform_bright") return;
    setMeasurementAngle(analyzerAngle);
    setPhase("complete");
  }, [analyzerAngle, measurementMode, fieldState]);

  const handleReset = useCallback(() => {
    setZeroAngle(null);
    setMeasurementAngle(null);
    setPhase("zeroing");
  }, []);

  const handleStartMutarot = useCallback(() => {
    setMutarotTime(0);
    setMutarotRunning(true);
  }, []);

  const handleStopMutarot = useCallback(() => {
    setMutarotRunning(false);
  }, []);

  const handleModeChange = useCallback((mode: ExperimentMode) => {
    setExperimentMode(mode);
    if (mode === "halfshadow") setMeasurementMode("triple_field");
    else setMeasurementMode("extinction");
  }, []);

  return (
    <div className="h-full flex flex-col" style={{ background: "#FFFFFF" }}>
      {/* Header */}
      <div className="flex-shrink-0 flex items-center" style={{
        height: isMobile ? "44px" : "48px", backgroundColor: "#FFFFFF",
        borderBottom: "1px solid #CCCCCC", paddingLeft: isMobile ? "16px" : "24px", paddingRight: isMobile ? "16px" : "24px",
      }}>
        <button onClick={onBack} style={{
          fontSize: "12px", fontWeight: 400, color: "#555555",
          background: "none", border: "none", cursor: "pointer",
          display: "flex", alignItems: "center", gap: "4px",
          transition: "color 200ms ease-out",
        }} onMouseEnter={e => (e.currentTarget.style.color = "#1A1A1A")}
           onMouseLeave={e => (e.currentTarget.style.color = "#555555")}>
          ← 返回
        </button>
        <span style={{ margin: "0 12px", color: "#D0D0D0" }}>|</span>
        <h1 style={{ fontSize: isMobile ? "17px" : "20px", fontWeight: 600, color: "#1A1A1A", margin: 0 }}>
          旋光仪实验
        </h1>
        {!isMobile && (
          <span style={{ marginLeft: "12px", fontSize: "9px", color: "#888888",
            border: "1px solid #D0D0D0", borderRadius: "2px", padding: "1px 6px" }}>
            优化版
          </span>
        )}
        <MobilePanelToggle onClick={() => setPanelOpen(true)} label="参数" />
        <TearOffButton
          viewId="physical-polarimeter"
          title={`旋光仪 · θ=${analyzerAngle.toFixed(1)}° · ${WAVELENGTH_OPTIONS[wavelengthIdx].label}`}
          params={[
            { key: 'λ', value: `${WAVELENGTH_OPTIONS[wavelengthIdx].value}nm` },
            { key: 'θ分析', value: `${analyzerAngle.toFixed(1)}°` },
            { key: '样品', value: sampleInserted ? (SAMPLE_PRESETS_EXT[selectedPreset]?.name || '自定义') : '未放入' },
            { key: '温度', value: `${temperature}°C` },
          ]}
          targetRef={vizRef}
          panelWidth={300}
          label="撕下对比"
        />
      </div>

      <div className="flex flex-1" style={{ minHeight: 0 }}>
        {/* ═══ Left: Visualization ═══ */}
        <div ref={vizRef} className="flex-1 custom-scrollbar min-w-0" style={{
          display: "flex", flexDirection: "column", padding: isMobile ? "12px 8px" : "16px", overflowY: "auto",
          alignItems: "center", gap: "12px",
        }}>
          {/* Optical Bench Canvas */}
          <OpticalBenchCanvas
            wavelength={wavelength}
            hasSample={sampleInserted}
            sampleName={sample.name}
            analyzerAngle={analyzerAngle}
            beamColor={beamColor}
            intensity={displayIntensity}
            measurementMode={measurementMode}
            shadowAngle={shadowAngle}
          />

          {/* Analyzer Dial Canvas */}
          <AnalyzerDialCanvas
            angle={analyzerAngle}
            onAngleChange={setAnalyzerAngle}
            isDraggingRef={isDraggingRef}
          />

          {/* Triple-field eyepiece view */}
          {measurementMode === "triple_field" && (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "12px", fontWeight: 600, color: "#1A1A1A", marginBottom: "6px" }}>
                三分视场
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

          {/* Detector readout */}
          {measurementMode === "extinction" && (
            <div style={{ textAlign: "center" }}>
              <div style={{
                display: "inline-flex", alignItems: "center", gap: isMobile ? "8px" : "16px",
                padding: isMobile ? "8px 12px" : "12px 20px", border: "1px solid #D0D0D0", borderRadius: "2px",
                backgroundColor: "#FAFAFA", maxWidth: '100%', flexWrap: 'wrap', justifyContent: 'center',
              }}>
                <svg width="50" height="50" viewBox="0 0 50 50" style={{ flexShrink: 0 }}>
                  <circle cx="25" cy="25" r="24" fill="#F0F3F6" stroke="#D0D0D0" strokeWidth="0.5" />
                  {intensity > 0.005 && (() => {
                    const r = 4 + 20 * intensity;
                    return (
                      <path d={`M${25 - r} 25 A${r} ${r} 0 0 1 ${25 + r} 25 Z`}
                        fill={beamColor} fillOpacity={0.3 + 0.5 * intensity} />
                    );
                  })()}
                </svg>
                <div>
                  <div style={{ fontSize: "10px", color: "#555555" }}>归一化光强</div>
                  <div className="tabular-nums" style={{ fontSize: "28px", fontWeight: 600, color: "#1A1A1A" }}>
                    {intensity.toFixed(4)}
                  </div>
                  <div style={{ width: "120px", height: "4px", backgroundColor: "#E8ECF0", marginTop: "2px", borderRadius: "1px" }}>
                    <div style={{
                      width: `${intensity * 100}%`, height: "100%",
                      backgroundColor: beamColor, borderRadius: "1px",
                      transition: "width 100ms ease-out",
                    }} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* False zero warning */}
          {falseZeroWarning && (
            <div style={{ padding: "6px 12px", backgroundColor: "#FFF0F0", border: "1px solid #CC0000", borderRadius: "4px", fontSize: "11px", color: "#CC0000", fontWeight: 600 }}>
              ⚠ 假零点警告！此位置视场均匀但偏亮，并非正确的零度视场。请继续旋转寻找暗且均匀的位置。
            </div>
          )}

          {/* Auto zero detection */}
          {zeroFoundNotification && (
            <div style={{ padding: "6px 12px", backgroundColor: "#F0FFF0", border: "1px solid #008800", borderRadius: "4px", fontSize: "11px", color: "#008800", fontWeight: 600 }}>
              ✓ {zeroFoundNotification}
            </div>
          )}

          {/* Hint text */}
          <div style={{ fontSize: "10px", color: "#6b7280", textAlign: "center", maxWidth: isMobile ? "100%" : "440px", padding: isMobile ? "0 4px" : 0 }}>
            {hintText}
          </div>

          {/* Malus Law / Brightness Diff curve */}
          {measurementMode === "extinction" ? (
            <MalusLawCanvas
              analyzerAngle={analyzerAngle}
              extinctionAngle={extinctionAngle}
              zeroAngle={zeroAngle ?? 90}
              showTheoretical={showTheoretical}
              theoreticalExtinction={sampleInserted && zeroAngle !== null ? zeroAngle + rotationAngle : null}
            />
          ) : (
            <BrightnessDiffCanvas
              analyzerAngle={analyzerAngle}
              opticalRotation={tripleFieldOpticalRotation}
              shadowAngle={shadowAngle}
              zeroAngle={zeroAngle ?? 90}
              showTheoretical={showTheoretical}
              theoreticalRotation={sampleInserted ? rotationAngle : null}
            />
          )}

          {/* Dispersion curve */}
          {experimentMode === "dispersion" && dispersionData.length > 0 && (
            <DispersionCurveCanvas
              data={dispersionData}
              currentWavelength={wavelength}
              currentSpecRot={finalSpecRotation}
              beamColor={beamColor}
            />
          )}

          {/* Mutarotation curve */}
          {(experimentMode === "mutarotation" || (sample.name === "混合物(葡萄糖+果糖)" && experimentMode === "mixture")) && mutarotCurveData.length > 0 && (
            <MutarotationCurveCanvas
              data={mutarotCurveData}
              currentTime={mutarotTime}
            />
          )}
        </div>

        {/* ═══ Right: Control Panel (w-80) ═══ */}
        <ControlPanel open={panelOpen} onClose={() => setPanelOpen(false)} title="旋光仪参数" desktopWidth="w-80" >
          {/* Experiment Mode Selection */}
          <div style={{ marginBottom: "12px" }}>
            <Label style={{ fontSize: "11px", fontWeight: 600, color: "#1A1A1A", marginBottom: "4px", display: "block" }}>
              实验模式
            </Label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "3px" }}>
              {([
                ["zero", "零位法"],
                ["halfshadow", "半荫法"],
                ["concentration", "浓度测定"],
                ["dispersion", "旋光色散"],
                ["mutarotation", "变旋现象"],
                ["mixture", "混合物分析"],
              ] as const).map(([key, label]) => (
                <Button key={key} size="sm" variant={experimentMode === key ? "default" : "outline"}
                  onClick={() => handleModeChange(key)}
                  style={{ fontSize: "9px", padding: "2px 6px", height: "24px" }}>
                  {label}
                </Button>
              ))}
            </div>
          </div>

          {/* Measurement mode switch (extinction vs triple-field) */}
          <div style={{ marginBottom: "12px", display: "flex", alignItems: "center", gap: "8px" }}>
            <Label style={{ fontSize: "10px", color: "#555555" }}>消光法</Label>
            <Switch
              checked={measurementMode === "triple_field"}
              onCheckedChange={(checked) => setMeasurementMode(checked ? "triple_field" : "extinction")}
            />
            <Label style={{ fontSize: "10px", color: "#555555" }}>三分视场法</Label>
          </div>

          {/* Shadow angle (triple-field only) */}
          {measurementMode === "triple_field" && (
            <div style={{ marginBottom: "12px" }}>
              <Label style={{ fontSize: "10px", color: "#555555", display: "block" }}>荫视角 δ</Label>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <Slider value={[shadowAngle]} min={1} max={10} step={0.5}
                  onValueChange={v => setShadowAngle(v[0])} style={{ flex: 1 }} />
                <span className="tabular-nums" style={{ fontSize: "10px", color: "#1A1A1A", minWidth: "30px" }}>
                  {shadowAngle.toFixed(1)}°
                </span>
              </div>
              <div style={{ fontSize: "8px", color: "#888888" }}>灵敏度: {sensitivity.toFixed(4)} °⁻¹</div>
            </div>
          )}

          {/* Wavelength selection */}
          <div style={{ marginBottom: "12px" }}>
            <Label style={{ fontSize: "11px", fontWeight: 600, color: "#1A1A1A", marginBottom: "4px", display: "block" }}>
              光源波长
            </Label>
            <Select value={String(wavelengthIdx)} onValueChange={v => setWavelengthIdx(Number(v))}>
              <SelectTrigger style={{ fontSize: "11px", height: "28px" }}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WAVELENGTH_OPTIONS.map((wl, i) => (
                  <SelectItem key={i} value={String(i)}>
                    <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: wl.color, border: "1px solid #D0D0D0", display: "inline-block" }} />
                      {wl.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div style={{ fontSize: "8px", color: "#888888", marginTop: "4px" }}>
              Drude方程自动修正: [α](λ) = A/(λ²−λ₀²)
            </div>
          </div>

          {/* Sample selection */}
          <div style={{ marginBottom: "12px" }}>
            <Label style={{ fontSize: "11px", fontWeight: 600, color: "#1A1A1A", marginBottom: "4px", display: "block" }}>
              样品选择
            </Label>
            <Select value={String(selectedPreset)} onValueChange={v => setSelectedPreset(Number(v))}>
              <SelectTrigger style={{ fontSize: "11px", height: "28px" }}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SAMPLE_PRESETS_EXT.map((s, i) => (
                  <SelectItem key={i} value={String(i)}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {selectedPreset === SAMPLE_PRESETS_EXT.length - 1 && (
              <div style={{ marginTop: "6px", display: "flex", flexDirection: "column", gap: "4px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <Label style={{ fontSize: "9px", color: "#555555", minWidth: "80px" }}>比旋光度 [α]</Label>
                  <Slider value={[customSpecRotation]} min={-100} max={100} step={0.1}
                    onValueChange={v => setCustomSpecRotation(v[0])} style={{ flex: 1 }} />
                  <span className="tabular-nums" style={{ fontSize: "9px", minWidth: "40px" }}>{customSpecRotation.toFixed(1)}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <Label style={{ fontSize: "9px", color: "#555555", minWidth: "80px" }}>浓度 c</Label>
                  <Slider value={[customConcentration]} min={0.01} max={0.5} step={0.01}
                    onValueChange={v => setCustomConcentration(v[0])} style={{ flex: 1 }} />
                  <span className="tabular-nums" style={{ fontSize: "9px", minWidth: "40px" }}>{customConcentration.toFixed(2)}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <Label style={{ fontSize: "9px", color: "#555555", minWidth: "80px" }}>管长 l</Label>
                  <Slider value={[customTubeLength]} min={0.5} max={4} step={0.1}
                    onValueChange={v => setCustomTubeLength(v[0])} style={{ flex: 1 }} />
                  <span className="tabular-nums" style={{ fontSize: "9px", minWidth: "40px" }}>{customTubeLength.toFixed(1)}</span>
                </div>
              </div>
            )}

            {/* Mixture parameters */}
            {sample.name === "混合物(葡萄糖+果糖)" && (
              <div style={{ marginTop: "6px", display: "flex", flexDirection: "column", gap: "4px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <Label style={{ fontSize: "9px", color: "#555555", minWidth: "80px" }}>葡萄糖浓度</Label>
                  <Slider value={[mixtureGlucose]} min={0} max={0.3} step={0.005}
                    onValueChange={v => setMixtureGlucose(v[0])} style={{ flex: 1 }} />
                  <span className="tabular-nums" style={{ fontSize: "9px", minWidth: "40px" }}>{mixtureGlucose.toFixed(3)}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <Label style={{ fontSize: "9px", color: "#555555", minWidth: "80px" }}>果糖浓度</Label>
                  <Slider value={[mixtureFructose]} min={0} max={0.3} step={0.005}
                    onValueChange={v => setMixtureFructose(v[0])} style={{ flex: 1 }} />
                  <span className="tabular-nums" style={{ fontSize: "9px", minWidth: "40px" }}>{mixtureFructose.toFixed(3)}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <Label style={{ fontSize: "9px", color: "#555555", minWidth: "80px" }}>pH</Label>
                  <Slider value={[mixturePH]} min={1} max={14} step={0.5}
                    onValueChange={v => setMixturePH(v[0])} style={{ flex: 1 }} />
                  <span className="tabular-nums" style={{ fontSize: "9px", minWidth: "40px" }}>{mixturePH.toFixed(1)}</span>
                </div>
                <div style={{ fontSize: "8px", color: "#888888" }}>
                  酸性pH加速变旋速率，用于分离两组分贡献
                </div>
              </div>
            )}

            <Button
              onClick={() => { setSampleInserted(!sampleInserted); if (!sampleInserted) setPhase("measuring"); else setPhase(phase === "zeroing" ? "zeroing" : "loaded"); }}
              variant={sampleInserted ? "destructive" : "default"}
              style={{ marginTop: "6px", width: "100%", fontSize: "10px", height: "28px" }}>
              {sampleInserted ? "✕ 移除样品管" : "↓ 放入样品管"}
            </Button>
          </div>

          {/* Temperature control */}
          <div style={{ marginBottom: "12px" }}>
            <Label style={{ fontSize: "11px", fontWeight: 600, color: "#1A1A1A", marginBottom: "4px", display: "block" }}>
              温度控制
            </Label>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Slider value={[temperature]} min={5} max={50} step={0.5}
                onValueChange={v => setTemperature(v[0])} style={{ flex: 1 }} />
              <span className="tabular-nums" style={{ fontSize: "10px", color: "#1A1A1A", minWidth: "36px" }}>
                {temperature.toFixed(1)}°C
              </span>
            </div>
            <div style={{ fontSize: "8px", color: "#888888" }}>
              温度系数: d[α]/dT = {sample.tempCoeff} °/°C
            </div>
          </div>

          {/* Analyzer angle — 刻度旋钮 + 滑块 */}
          <div style={{ marginBottom: "12px" }}>
            <Label style={{ fontSize: "11px", fontWeight: 600, color: "#1A1A1A", marginBottom: "6px", display: "block" }}>
              检偏器角度
            </Label>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <Knob
                value={analyzerAngle}
                min={0}
                max={360}
                step={0.1}
                onChange={setAnalyzerAngle}
                unit="°"
                precision={1}
                size={64}
                detentValues={[0, 90, 180, 270, 360]}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <Slider value={[analyzerAngle]} min={0} max={360} step={0.1}
                    onValueChange={v => setAnalyzerAngle(v[0])} style={{ flex: 1 }} />
                  <span className="tabular-nums" style={{ fontSize: "10px", color: "#1A1A1A", minWidth: "36px" }}>
                    {analyzerAngle.toFixed(1)}°
                  </span>
                </div>
                <div style={{ display: "flex", gap: "4px", marginTop: "6px" }}>
                  <Input type="number" value={analyzerAngle.toFixed(1)}
                    onChange={e => setAnalyzerAngle(Number(e.target.value))}
                    style={{ fontSize: "10px", height: "24px", width: "70px" }} />
                  <span style={{ fontSize: "9px", color: "#888888", lineHeight: "24px" }}>° (0.1° 精度)</span>
                </div>
              </div>
            </div>
          </div>

          {/* 实验操作核查清单 */}
          {(experimentMode === "zero" || experimentMode === "halfshadow") && (() => {
            const isHalf = experimentMode === "halfshadow"
            const nearTarget = isHalf
              ? fieldState === "balanced"
              : intensity < 0.005
            const steps: ChecklistStep[] = [
              {
                id: 'remove-sample',
                label: '取下样品管，准备置零',
                done: !sampleInserted,
                required: true,
              },
              {
                id: 'find-zero',
                label: isHalf ? '调节检偏器至三视场亮度一致' : '调节检偏器至消光位（光强趋近 0）',
                done: nearTarget && !sampleInserted,
                required: true,
                doneHint: nearTarget ? `当前光强 ${intensity.toFixed(4)}` : undefined,
              },
              {
                id: 'record-zero',
                label: '记录零位 φ₀',
                done: zeroAngle !== null,
                required: true,
                doneHint: zeroAngle !== null ? `φ₀ = ${zeroAngle.toFixed(1)}°` : undefined,
              },
              {
                id: 'load-sample',
                label: '放入样品管',
                done: sampleInserted && zeroAngle !== null,
                required: true,
              },
              {
                id: 'find-measure',
                label: isHalf ? '再次调节至三视场亮度一致' : '再次调节至消光位',
                done: nearTarget && sampleInserted && zeroAngle !== null,
                required: true,
                doneHint: nearTarget && sampleInserted ? `当前光强 ${intensity.toFixed(4)}` : undefined,
              },
              {
                id: 'record-measure',
                label: '记录测量值 θ',
                done: measurementAngle !== null,
                required: true,
                doneHint: measurementAngle !== null ? `θ = ${measurementAngle.toFixed(1)}°` : undefined,
              },
              {
                id: 'compute',
                label: '计算旋光度 α = θ − φ₀',
                done: zeroAngle !== null && measurementAngle !== null,
                doneHint: zeroAngle !== null && measurementAngle !== null
                  ? `α = ${(measurementAngle - zeroAngle).toFixed(1)}°`
                  : undefined,
              },
            ]
            return (
              <div style={{ marginBottom: "12px" }}>
                <ExperimentChecklist steps={steps} />
              </div>
            )
          })()}

          {/* Measurement operations */}
          {(experimentMode === "zero" || experimentMode === "halfshadow" || experimentMode === "concentration") && (
            <div style={{ marginBottom: "12px" }}>
              <Label style={{ fontSize: "11px", fontWeight: 600, color: "#1A1A1A", marginBottom: "4px", display: "block" }}>
                {experimentMode === "zero" ? "零位法操作" : experimentMode === "halfshadow" ? "半荫法操作" : "浓度测定"}
              </Label>
              <div style={{ fontSize: "9px", color: "#888888", lineHeight: "1.6", marginBottom: "6px" }}>
                {experimentMode === "zero" && (
                  <>1. 不放样品，调至消光 → 记录零位<br />2. 放入样品，再调至消光 → 记录测量值<br />3. 自动计算旋光度 α = θ₂ − θ₁</>
                )}
                {experimentMode === "halfshadow" && (
                  <>1. 不放样品，调至三部分亮度一致 → 记录零位<br />2. 放入样品，再调至一致 → 记录测量值<br />3. α = θ₂ − θ₁ (比全暗法更灵敏)</>
                )}
                {experimentMode === "concentration" && (
                  <>1. 已知[α]和l，测量α<br />2. 反算浓度 c = α/([α]·l)<br />3. 给出不确定度范围</>
                )}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <Button size="sm" variant="outline"
                  onClick={handleRecordZero}
                  disabled={phase !== "zeroing"}
                  style={{ fontSize: "10px", height: "26px" }}>
                  记录零位 φ₀ = {analyzerAngle.toFixed(1)}°
                </Button>

                <Button size="sm" variant="outline"
                  onClick={handleLoadSample}
                  disabled={phase !== "loaded" || sampleInserted}
                  style={{ fontSize: "10px", height: "26px" }}>
                  放入样品管
                </Button>

                <Button size="sm" variant="outline"
                  onClick={handleRecordMeasurement}
                  disabled={phase !== "measuring"}
                  style={{ fontSize: "10px", height: "26px" }}>
                  记录测量值 φ₁ = {analyzerAngle.toFixed(1)}°
                </Button>

                <Button size="sm" variant="ghost"
                  onClick={handleReset}
                  style={{ fontSize: "10px", height: "26px" }}>
                  重置测量
                </Button>
              </div>

              {/* Measurement results */}
              {zeroAngle !== null && (
                <div style={{ marginTop: "8px", padding: "6px", backgroundColor: "#F0F3F6", borderRadius: "4px", fontSize: "10px" }}>
                  <div>零位: φ₀ = {zeroAngle.toFixed(1)}°</div>
                  {measurementAngle !== null && (
                    <>
                      <div>测量: φ₁ = {measurementAngle.toFixed(1)}°</div>
                      <div style={{ fontWeight: 600, color: "#1A1A1A" }}>
                        旋光度: α = {measuredRotation?.toFixed(2)}°
                      </div>
                      {measuredSpecificRotation !== null && (
                        <div>测量[α] = {measuredSpecificRotation.toFixed(2)} °/(dm·g/mL)</div>
                      )}
                      {concentrationResult && (
                        <div>
                          浓度: c = {concentrationResult.concentration.toFixed(4)} g/mL
                          <br />±{concentrationResult.uncertainty.toFixed(4)} g/mL
                        </div>
                      )}
                      <div style={{ fontSize: "9px", color: "#888888", marginTop: "4px" }}>
                        理论旋光度: {rotationAngle.toFixed(2)}°
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Dispersion controls */}
          {experimentMode === "dispersion" && (
            <div style={{ marginBottom: "12px" }}>
              <Label style={{ fontSize: "11px", fontWeight: 600, color: "#1A1A1A", marginBottom: "4px", display: "block" }}>
                旋光色散
              </Label>
              <div style={{ fontSize: "9px", color: "#888888", lineHeight: "1.6", marginBottom: "6px" }}>
                切换不同波长观测比旋光度变化。Drude方程描述了[α]对波长的依赖关系。
              </div>
              <div style={{ fontSize: "10px", color: "#1A1A1A" }}>
                当前[α]({wavelength}nm) = {finalSpecRotation.toFixed(2)} °/(dm·g/mL)
              </div>
            </div>
          )}

          {/* Mutarotation controls */}
          {(experimentMode === "mutarotation" || (sample.name === "混合物(葡萄糖+果糖)" && experimentMode === "mixture")) && (
            <div style={{ marginBottom: "12px" }}>
              <Label style={{ fontSize: "11px", fontWeight: 600, color: "#1A1A1A", marginBottom: "4px", display: "block" }}>
                变旋现象
              </Label>
              <div style={{ fontSize: "9px", color: "#888888", lineHeight: "1.6", marginBottom: "6px" }}>
                {sample.mutarotation
                  ? `α₀ = ${sample.mutarotation.alpha0}° → α∞ = ${sample.mutarotation.alphaEq}°, k = ${sample.mutarotation.k} min⁻¹`
                  : "此样品不具有变旋性"}
              </div>
              <div style={{ display: "flex", gap: "4px" }}>
                <Button size="sm" variant="outline"
                  onClick={handleStartMutarot}
                  disabled={mutarotRunning}
                  style={{ fontSize: "10px", height: "26px" }}>
                  开始
                </Button>
                <Button size="sm" variant="outline"
                  onClick={handleStopMutarot}
                  disabled={!mutarotRunning}
                  style={{ fontSize: "10px", height: "26px" }}>
                  暂停
                </Button>
                <Button size="sm" variant="ghost"
                  onClick={() => { setMutarotTime(0); setMutarotRunning(false); }}
                  style={{ fontSize: "10px", height: "26px" }}>
                  重置
                </Button>
              </div>
              <div style={{ fontSize: "10px", color: "#1A1A1A", marginTop: "4px" }}>
                t = {mutarotTime.toFixed(1)} min
              </div>
            </div>
          )}

          {/* Theoretical values display */}
          <div style={{ marginBottom: "12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
              <Switch checked={showTheoretical} onCheckedChange={setShowTheoretical} />
              <Label style={{ fontSize: "10px", color: "#555555" }}>显示理论值</Label>
            </div>
            {sampleInserted && (
              <div style={{ padding: "6px", backgroundColor: "#F0F3F6", borderRadius: "4px", fontSize: "9px", lineHeight: "1.6" }}>
                <div style={{ fontWeight: 600, color: "#1A1A1A", marginBottom: "2px" }}>理论参数</div>
                <div>[α] = {finalSpecRotation.toFixed(2)} °/(dm·g/mL)</div>
                <div>c = {sample.concentration.toFixed(3)} g/mL</div>
                <div>l = {sample.tubeLength.toFixed(1)} dm</div>
                <div>T = {temperature.toFixed(1)} °C</div>
                <div style={{ fontWeight: 600, color: "#1A1A1A", marginTop: "2px" }}>
                  理论旋光度 α = {rotationAngle.toFixed(2)}°
                </div>
                {measurementMode === "triple_field" && (
                  <div style={{ marginTop: "4px", borderTop: "1px solid #D0D0D0", paddingTop: "4px" }}>
                    <div>暗零点: {findDimZeroAngle(rotationAngle, shadowAngle).toFixed(2)}°</div>
                    <div>亮零点(假零): {findBrightZeroAngle(rotationAngle, shadowAngle).toFixed(2)}°</div>
                    <div>灵敏度: {sensitivity.toFixed(4)} °⁻¹</div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Phase indicator */}
          <div style={{ padding: "6px 10px", backgroundColor: phase === "complete" ? "#F0FFF0" : phase === "measuring" ? "#FFFFF0" : "#F0F3F6", borderRadius: "4px", fontSize: "10px", color: "#555555" }}>
            阶段: {phase === "zeroing" ? "确定零位" : phase === "loaded" ? "等待放入样品" : phase === "measuring" ? "测量中" : "测量完成"}
          </div>
        </ControlPanel>
      </div>
    </div>
  );
}
