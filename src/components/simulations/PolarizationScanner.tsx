"use client";

import { useState, useRef, useEffect, useCallback, useMemo, Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  processBirefringenceFrame,
  retardationToMichelLevy,
  type BirefringenceParams,
} from "@/lib/optics/birefringence";
import { useIsMobile } from "@/hooks/use-mobile";
import { ControlPanel, MobilePanelToggle } from "./shared/ControlPanel";

/* ─── Michel-Lévy Chart Reusable Canvas ─── */
function MichelLevyChart({ width = 280, height = 40 }: { width?: number; height?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    for (let x = 0; x < width; x++) {
      const retardation = (x / width) * 2000;
      const [r, g, b] = retardationToMichelLevy(retardation);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(x, 0, 1, height - 12);
    }

    ctx.strokeStyle = "#d4d8e0";
    ctx.lineWidth = 0.5;
    ctx.strokeRect(0, 0, width, height - 12);

    ctx.fillStyle = "#6b7280";
    ctx.font = "8px IBM Plex Mono, monospace";
    ctx.textAlign = "center";
    ctx.fillText("0", 0, height - 1);
    ctx.fillText("500", width * 0.25, height - 1);
    ctx.fillText("1000", width * 0.5, height - 1);
    ctx.fillText("1500", width * 0.75, height - 1);
    ctx.fillText("2000 nm", width, height - 1);
  }, [width, height]);

  return <canvas ref={canvasRef} style={{ width, maxWidth: "100%", height: "auto" }} />;
}

/* ─── Types ─── */
type DemoPattern = "disk" | "plate" | "beam" | "residual" | "notch" | "ring" | "crack";
type ExperimentMode = "demo" | "quantitative" | "teaching" | "3d";
type LightSourceMode = "white" | "red" | "green" | "blue";

const DEMO_PATTERN_LABELS: Record<DemoPattern, string> = {
  disk: "圆盘压缩",
  plate: "方板拉伸",
  beam: "梁弯曲",
  residual: "残余应力",
  notch: "缺口板",
  ring: "圆环受压",
  crack: "裂纹尖端",
};

const DEMO_PATTERN_DESC: Record<DemoPattern, string> = {
  disk: "同心彩色环 — 受压玻璃盘在正交偏光镜下的干涉图样",
  plate: "对角等色线 — 单轴拉伸板的应力双折射条纹",
  beam: "中性轴 + 弯曲条纹 — 梁弯曲时的应力分布",
  residual: "不规则图样 — 钢化玻璃的残余应力分布",
  notch: "应力集中 — V型缺口板的应力流线，缺口根部条纹密集",
  ring: "圆环内压 — 受内外压的圆环，呈现对称应力分布",
  crack: "Westergaard场 — 裂纹尖端奇异应力场，1/√r衰减",
};

const LIGHT_SOURCE_LABELS: Record<LightSourceMode, string> = {
  white: "白光",
  red: "红色滤光(630nm)",
  green: "绿色滤光(530nm)",
  blue: "蓝色滤光(460nm)",
};

const WAVELENGTHS: Record<LightSourceMode, number> = {
  white: 550,
  red: 630,
  green: 530,
  blue: 460,
};

/* ─── Photoelastic material library (stress-optic coefficient C in Brewster = 10⁻¹² Pa⁻¹) ─── */
type Material = "custom" | "polycarbonate" | "epoxy" | "pmma" | "glass" | "bakelite";
const MATERIAL_LABELS: Record<Material, string> = {
  custom: "自定义",
  polycarbonate: "聚碳酸酯 (PC)",
  epoxy: "环氧树脂",
  pmma: "PMMA (亚克力)",
  glass: "硼硅玻璃",
  bakelite: "酚醛树脂 (Bakelite)",
};
const MATERIAL_C: Record<Material, number> = {
  // Typical stress-optic constants C in Brewster (10⁻¹² Pa⁻¹)
  custom: 0,
  polycarbonate: 9.0,
  epoxy: 5.5,
  pmma: 3.5,
  glass: 2.7,
  bakelite: 4.5,
};

/* ─── Isoclinic scan animation parameters ─── */
const ISOCLINIC_STEPS = 18; // 18 steps × 10° = 180° rotation

/* ─── Stress-optical standard color map ─── */
function stressColorMap(retardationNm: number): [number, number, number] {
  const r = Math.max(
    0,
    Math.min(
      255,
      retardationNm < 200
        ? retardationNm * 1.2
        : retardationNm < 400
          ? 240 - (retardationNm - 200) * 0.8
          : retardationNm < 550
            ? 80 + (retardationNm - 400) * 1.1
            : 245 - (retardationNm - 550) * 0.5
    )
  );
  const g = Math.max(
    0,
    Math.min(
      255,
      retardationNm < 150
        ? retardationNm * 0.6
        : retardationNm < 300
          ? 90 + (retardationNm - 150) * 0.5
          : retardationNm < 500
            ? 165 - (retardationNm - 300) * 0.5
            : 65 + (retardationNm - 500) * 0.3
    )
  );
  const b = Math.max(
    0,
    Math.min(
      255,
      retardationNm < 100
        ? retardationNm * 1.5
        : retardationNm < 250
          ? 150 - (retardationNm - 100) * 0.3
          : retardationNm < 450
            ? 105 + (retardationNm - 250) * 0.5
            : 205 - (retardationNm - 450) * 0.6
    )
  );
  return [Math.round(r), Math.round(g), Math.round(b)];
}

/* ─── Single-wavelength interference color ─── */
function singleWavelengthColor(
  retardationNm: number,
  wavelengthNm: number
): [number, number, number] {
  const intensity = Math.pow(Math.sin(Math.PI * retardationNm / wavelengthNm), 2);
  const v = Math.round(intensity * 255);
  if (wavelengthNm >= 600) return [v, 0, 0];
  if (wavelengthNm >= 500) return [0, v, 0];
  return [0, 0, v];
}

/* ─── White-light dispersion color (R/G/B computed separately)
 *  Models spectral dispersion of birefringence: Δn(λ) = Δn₀·(1 + k·(λ-λ₀))
 *  The birefCoeff controls the magnitude of the dispersion effect.
 *  Each RGB channel uses its own effective retardation (no cancellation).
 */
function dispersionWhiteLightColor(
  retardationNm: number,
  birefCoeff: number
): [number, number, number] {
  const lambda0 = 550;
  // dispersion factor - now birefCoeff meaningfully modulates the effect
  const k = 0.0015 * birefCoeff;
  // Effective retardation per RGB channel (different wavelengths see different R)
  const retR = retardationNm * (1 + k * (630 - lambda0));
  const retG = retardationNm * (1 + k * (530 - lambda0));
  const retB = retardationNm * (1 + k * (460 - lambda0));
  // Each channel's intensity follows sin²(πR/λ) interference
  const Ir = Math.pow(Math.sin(Math.PI * retR / 630), 2) * 255;
  const Ig = Math.pow(Math.sin(Math.PI * retG / 530), 2) * 255;
  const Ib = Math.pow(Math.sin(Math.PI * retB / 460), 2) * 255;
  return [Math.round(Ir), Math.round(Ig), Math.round(Ib)];
}

/* ─── Unified color dispatcher: chooses encoding based on light source mode ─── */
function getStressColor(
  retardationNm: number,
  lightMode: LightSourceMode,
  birefCoeff: number
): [number, number, number] {
  if (lightMode === "white") {
    return dispersionWhiteLightColor(retardationNm, birefCoeff);
  }
  return singleWavelengthColor(retardationNm, WAVELENGTHS[lightMode]);
}

/* ─── Demo pattern retardation generators ─── */
function diskCompressionRetardation(
  x: number, y: number, cx: number, cy: number,
  w: number, h: number, stressFactor: number,
  birefringenceCoeff: number, rotation: number
): number {
  const cosR = Math.cos(rotation);
  const sinR = Math.sin(rotation);
  const dx = x - cx;
  const dy = y - cy;
  const rx = dx * cosR - dy * sinR;
  const ry = dx * sinR + dy * cosR;
  const maxR = Math.min(w, h) * 0.45;
  const dist = Math.sqrt(rx * rx + ry * ry);
  if (dist > maxR) return 0;
  const rn = dist / maxR;
  const stressDiff = (1 - rn * rn) * stressFactor * birefringenceCoeff;
  const retardation = stressDiff * 300 * (0.5 + 0.5 * Math.cos(Math.PI * stressDiff * 2.5));
  const fringeDetail = 20 * Math.sin(rn * Math.PI * stressFactor * 3) * birefringenceCoeff;
  return Math.max(0, retardation + fringeDetail);
}

function plateTensionRetardation(
  x: number, y: number, cx: number, cy: number,
  w: number, h: number, stressFactor: number,
  birefringenceCoeff: number, rotation: number
): number {
  const cosR = Math.cos(rotation);
  const sinR = Math.sin(rotation);
  const dx = x - cx;
  const dy = y - cy;
  const rx = dx * cosR - dy * sinR;
  const ry = dx * sinR + dy * cosR;
  const halfW = w * 0.45;
  const halfH = h * 0.45;
  if (Math.abs(rx) > halfW || Math.abs(ry) > halfH) return 0;
  const edgeDistX = (halfW - Math.abs(rx)) / halfW;
  let stressDiff = stressFactor * birefringenceCoeff;
  stressDiff *= 0.7 + 0.3 * Math.min(edgeDistX, 1);
  const ny = ry / halfH;
  const fringePattern = Math.cos(Math.PI * ny * stressFactor * 2);
  const holeR = Math.min(w, h) * 0.08;
  const distFromHole = Math.sqrt(rx * rx + ry * ry);
  if (distFromHole < holeR * 1.1) return 0;
  const holeStressConcentration =
    distFromHole < holeR * 3 ? (holeR / distFromHole) * stressFactor * 0.5 : 0;
  const retardation = stressDiff * 250 * fringePattern + holeStressConcentration * 200;
  return Math.max(0, retardation);
}

function beamBendingRetardation(
  x: number, y: number, cx: number, cy: number,
  w: number, h: number, stressFactor: number,
  birefringenceCoeff: number, rotation: number
): number {
  const cosR = Math.cos(rotation);
  const sinR = Math.sin(rotation);
  const dx = x - cx;
  const dy = y - cy;
  const rx = dx * cosR - dy * sinR;
  const ry = dx * sinR + dy * cosR;
  const beamHalfH = h * 0.12;
  const beamHalfW = w * 0.45;
  if (Math.abs(rx) > beamHalfW || Math.abs(ry) > beamHalfH) return 0;
  const mx = Math.abs(rx) / beamHalfW;
  const bendingMoment = (1 - mx) * stressFactor;
  const ny = ry / beamHalfH;
  const stressDiff = bendingMoment * ny * birefringenceCoeff * 2;
  const retardation = Math.abs(stressDiff) * 300;
  const fringeOrder = Math.abs(stressDiff) * stressFactor * 1.5;
  const fringeMod = 0.5 + 0.5 * Math.cos(Math.PI * fringeOrder * 2);
  const detailedRetardation = retardation * fringeMod;
  const neutralAxisFade = Math.abs(ny);
  return Math.max(0, detailedRetardation * neutralAxisFade);
}

function residualStressRetardation(
  x: number, y: number, cx: number, cy: number,
  w: number, h: number, stressFactor: number,
  birefringenceCoeff: number, rotation: number
): number {
  const cosR = Math.cos(rotation);
  const sinR = Math.sin(rotation);
  const dx = x - cx;
  const dy = y - cy;
  const rx = dx * cosR - dy * sinR;
  const ry = dx * sinR + dy * cosR;
  const halfW = w * 0.45;
  const halfH = h * 0.45;
  if (Math.abs(rx) > halfW || Math.abs(ry) > halfH) return 0;
  const nx = rx / halfW;
  const ny = ry / halfH;
  const edgeX = (1 - Math.abs(nx)) * 4;
  const edgeY = (1 - Math.abs(ny)) * 4;
  const surfaceStress =
    (1 / (1 + edgeX * edgeX) + 1 / (1 + edgeY * edgeY)) * stressFactor * 0.3;
  const cooling1 = Math.sin(nx * Math.PI * 2.3 + ny * Math.PI * 1.7) * 0.4;
  const cooling2 = Math.cos(nx * Math.PI * 3.1 - ny * Math.PI * 2.1) * 0.3;
  const cooling3 = Math.sin((nx + ny) * Math.PI * 1.5) * 0.2;
  const cooling4 = Math.cos(nx * Math.PI * 4.7) * Math.sin(ny * Math.PI * 3.3) * 0.15;
  const coolingPattern =
    (cooling1 + cooling2 + cooling3 + cooling4) * stressFactor * birefringenceCoeff;
  const centralDist = Math.sqrt(nx * nx + ny * ny);
  const centralTension =
    Math.exp(-centralDist * centralDist * 2) * stressFactor * 0.5 * birefringenceCoeff;
  const totalStress = surfaceStress + coolingPattern + centralTension;
  const retardation = Math.abs(totalStress) * 350;
  const fineFringes =
    15 * Math.sin(totalStress * Math.PI * stressFactor * 2) * birefringenceCoeff;
  return Math.max(0, retardation + fineFringes);
}

/* ─── Notched plate under tension (stress concentration at V-notch root) ─── */
function notchedPlateRetardation(
  x: number, y: number, cx: number, cy: number,
  w: number, h: number, stressFactor: number,
  birefCoeff: number, rotation: number
): number {
  const cosR = Math.cos(rotation);
  const sinR = Math.sin(rotation);
  const dx = x - cx;
  const dy = y - cy;
  const rx = dx * cosR - dy * sinR;
  const ry = dx * sinR + dy * cosR;
  const halfW = w * 0.45;
  const halfH = h * 0.4;
  if (Math.abs(rx) > halfW || Math.abs(ry) > halfH) return 0;
  // V-notch on the right edge at y=0
  const notchDepth = halfH * 0.5;
  const notchHalfAngle = Math.PI / 6; // 30° half-angle
  // Distance from notch root (located at (halfW - notchDepth*tan(angle), 0))
  const notchRootX = halfW - notchDepth * Math.tan(notchHalfAngle);
  const ndx = rx - notchRootX;
  const ndy = ry;
  const distFromNotch = Math.sqrt(ndx * ndx + ndy * ndy);
  const notchAngle = Math.atan2(ndy, ndx);
  // Inside the notch (excluded region)
  if (rx > notchRootX && Math.abs(ry) < (rx - notchRootX) * Math.tan(notchHalfAngle)) {
    return 0;
  }
  // Stress concentration factor ~ K_t = 1 + 2*sqrt(a/rho)
  const rho = halfH * 0.05; // notch root radius
  const kt = 1 + 2 * Math.sqrt(notchDepth / Math.max(rho, 1));
  // Far-field uniform stress, amplified near notch root
  const nx = rx / halfW;
  const farField = stressFactor * birefCoeff * (0.6 + 0.4 * (1 - nx * nx));
  // Stress concentration: decays as 1/r from notch root, modulated by angle
  const angularFactor = 0.5 + 0.5 * Math.cos(notchAngle * 1.5);
  const radialDecay = rho / Math.max(distFromNotch, rho);
  const concentrated = kt * farField * radialDecay * angularFactor;
  // Streamline-like fringes flowing around the notch
  const flowFringe = 0.5 + 0.5 * Math.cos(
    Math.PI * (distFromNotch / halfW) * stressFactor * 1.5 + notchAngle * 2
  );
  const retardation = (farField + concentrated * 2) * 280 * flowFringe;
  return Math.max(0, retardation);
}

/* ─── Ring under internal pressure (Lamé thick-walled cylinder) ─── */
function ringPressureRetardation(
  x: number, y: number, cx: number, cy: number,
  w: number, h: number, stressFactor: number,
  birefCoeff: number, rotation: number
): number {
  const cosR = Math.cos(rotation);
  const sinR = Math.sin(rotation);
  const dx = x - cx;
  const dy = y - cy;
  const rx = dx * cosR - dy * sinR;
  const ry = dx * sinR + dy * cosR;
  const outerR = Math.min(w, h) * 0.42;
  const innerR = outerR * 0.5;
  const dist = Math.sqrt(rx * rx + ry * ry);
  if (dist > outerR || dist < innerR) return 0;
  // Lamé equations for thick-walled cylinder under internal pressure p_i:
  // σ_r = p_i·a²/(b²-a²)·(1 - b²/r²)
  // σ_θ = p_i·a²/(b²-a²)·(1 + b²/r²)
  // σ_r - σ_θ = -2·p_i·a²·b² / ((b²-a²)·r²)
  const a = innerR, b = outerR;
  const b2ma2 = b * b - a * a;
  const stressDiff = Math.abs(
    -2 * stressFactor * birefCoeff * a * a * b * b / (b2ma2 * dist * dist)
  );
  // Isochromate fringe modulation
  const fringeMod = 0.6 + 0.4 * Math.cos(Math.PI * stressDiff * 2.2);
  const retardation = stressDiff * 320 * fringeMod;
  // Angular detail (hoop stress direction creates fine structure)
  const theta = Math.atan2(ry, rx);
  const angularDetail = 12 * Math.cos(2 * theta) * birefCoeff;
  return Math.max(0, retardation + angularDetail);
}

/* ─── Crack-tip Westergaard stress field ( Mode I, 1/√r singularity ) ─── */
function crackTipRetardation(
  x: number, y: number, cx: number, cy: number,
  w: number, h: number, stressFactor: number,
  birefCoeff: number, rotation: number
): number {
  const cosR = Math.cos(rotation);
  const sinR = Math.sin(rotation);
  const dx = x - cx;
  const dy = y - cy;
  const rx = dx * cosR - dy * sinR;
  const ry = dx * sinR + dy * cosR;
  const halfW = w * 0.45;
  const halfH = h * 0.4;
  if (Math.abs(rx) > halfW || Math.abs(ry) > halfH) return 0;
  // Inside the crack (negative x, small |y|)
  if (rx < 0 && Math.abs(ry) < h * 0.015) return 0;
  // Westergaard Mode I near-tip field (plane stress):
  // σ_1 - σ_2 = 2·K_I/√(2πr) · |sin(θ)| (max shear)
  const r = Math.sqrt(rx * rx + ry * ry);
  const theta = Math.atan2(ry, Math.max(rx, 0.01));
  // Avoid singularity at r=0
  const rEff = Math.max(r, h * 0.01);
  const K = stressFactor * birefCoeff * 8; // stress intensity factor proxy
  const invSqrtR = 1 / Math.sqrt(rEff);
  const stressDiff = 2 * K * invSqrtR * Math.abs(Math.sin(theta));
  // Isochromate fringes form characteristic "butterfly" lobes
  const fringeMod = 0.5 + 0.5 * Math.cos(
    2 * (stressDiff * Math.PI - theta / 2)
  );
  const retardation = stressDiff * 250 * fringeMod;
  return Math.max(0, retardation);
}

/* ─── Single lookup table for all demo patterns (eliminates duplicated switches) ─── */
const PATTERN_GENERATORS: Record<DemoPattern, typeof diskCompressionRetardation> = {
  disk: diskCompressionRetardation,
  plate: plateTensionRetardation,
  beam: beamBendingRetardation,
  residual: residualStressRetardation,
  notch: notchedPlateRetardation,
  ring: ringPressureRetardation,
  crack: crackTipRetardation,
};

/* ─── Teaching library pattern generators ─── */
function threePointBendingIsochromates(
  x: number, y: number, cx: number, cy: number,
  w: number, h: number
): number {
  const beamHalfH = h * 0.18;
  const beamHalfW = w * 0.45;
  if (Math.abs(x - cx) > beamHalfW || Math.abs(y - cy) > beamHalfH) return 0;
  const mx = Math.abs(x - cx) / beamHalfW;
  const bendingMoment = (1 - mx) * 5;
  const ny = (y - cy) / beamHalfH;
  const stressDiff = bendingMoment * ny * 2;
  const retardation = Math.abs(stressDiff) * 280;
  const fringeMod = 0.5 + 0.5 * Math.cos(Math.PI * Math.abs(stressDiff) * 3);
  return Math.max(0, retardation * fringeMod * Math.abs(ny));
}

function diskDiametralCompressionIsoclinics(
  x: number, y: number, cx: number, cy: number,
  w: number, h: number
): number {
  const maxR = Math.min(w, h) * 0.42;
  const dx = x - cx;
  const dy = y - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist > maxR) return 0;
  const rn = dist / maxR;
  // Compute principal stress direction (simplified model)
  const sigmaX = 1 - rn * rn * (1 - 2 * (dx * dx) / (dist * dist + 0.01));
  const sigmaY = 1 - rn * rn * (1 - 2 * (dy * dy) / (dist * dist + 0.01));
  const tauXY = -2 * rn * rn * dx * dy / (dist * dist + 0.01);
  const phi = 0.5 * Math.atan2(2 * tauXY, sigmaX - sigmaY);
  // Isoclinic darkness when phi matches polarizer angle (0°)
  const isoclinicParam = Math.pow(Math.cos(2 * phi), 2);
  // Isochromate (stress difference) for color
  const stressDiff = Math.sqrt(
    Math.pow(sigmaX - sigmaY, 2) + 4 * tauXY * tauXY
  ) * (1 - rn * rn) * 5;
  const ret = Math.abs(stressDiff) * 200;
  // Blend: isoclinic darkens the isochromate
  return Math.max(0, ret * (0.15 + 0.85 * isoclinicParam));
}

function pureBendingIsochromates(
  x: number, y: number, cx: number, cy: number,
  w: number, h: number
): number {
  const beamHalfH = h * 0.18;
  const beamHalfW = w * 0.45;
  if (Math.abs(x - cx) > beamHalfW || Math.abs(y - cy) > beamHalfH) return 0;
  const ny = (y - cy) / beamHalfH;
  // Pure bending: constant moment, stress proportional to y
  const stressDiff = ny * 6;
  const retardation = Math.abs(stressDiff) * 250;
  const fringeMod = 0.5 + 0.5 * Math.cos(Math.PI * Math.abs(stressDiff) * 2.5);
  return Math.max(0, retardation * fringeMod);
}

/* ─── Fast axis direction for each demo pattern ─── */
function getFastAxisAngle(
  pattern: DemoPattern,
  x: number, y: number,
  cx: number, cy: number
): number {
  const dx = x - cx;
  const dy = y - cy;
  switch (pattern) {
    case "disk": {
      const angle = Math.atan2(dy, dx);
      return angle + Math.PI / 4; // tangential + 45°
    }
    case "plate":
      return 0; // along stretching direction
    case "beam":
      return 0; // along beam axis
    case "residual": {
      const angle = Math.atan2(dy, dx);
      return angle * 0.5 + 0.3;
    }
    case "notch": {
      // Principal stress flows around notch — tangential near root
      const angle = Math.atan2(dy, dx);
      return angle + Math.PI / 4;
    }
    case "ring": {
      // Hoop stress direction (tangential)
      const angle = Math.atan2(dy, dx);
      return angle + Math.PI / 2;
    }
    case "crack": {
      // Principal stress at 45° to crack plane (Mode I)
      const angle = Math.atan2(dy, Math.max(dx, 0.01));
      return angle / 2 + Math.PI / 4;
    }
  }
}

/* ─── Teaching Pattern Canvas ─── */
function TeachingPatternCanvas({
  generator,
  width = 200,
  height = 150,
}: {
  generator: (x: number, y: number, cx: number, cy: number, w: number, h: number) => number;
  width?: number;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = width;
    canvas.height = height;
    const cxLocal = width / 2;
    const cyLocal = height / 2;

    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;

    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const idx = (py * width + px) * 4;
        const ret = generator(px + 0.5, py + 0.5, cxLocal, cyLocal, width, height);
        if (ret > 2) {
          const [cr, cg, cb] = stressColorMap(ret);
          data[idx] = cr;
          data[idx + 1] = cg;
          data[idx + 2] = cb;
          data[idx + 3] = 255;
        } else {
          const brightness = 15 + Math.round(ret * 4);
          data[idx] = brightness;
          data[idx + 1] = brightness;
          data[idx + 2] = brightness;
          data[idx + 3] = 255;
        }
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }, [generator, width, height]);

  return (
    <canvas
      ref={canvasRef}
      className="border border-[#d4d8e0] bg-[#0F0F0F]"
      style={{ width, height }}
    />
  );
}

/* ─── Isoclinic Scan Canvas: disk under diametral compression with rotating polarizer ─── */
function IsoclinicScanCanvas({
  polarizerAngle,
  width = 220,
  height = 180,
}: {
  polarizerAngle: number;
  width?: number;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = width;
    canvas.height = height;
    const cx = width / 2;
    const cy = height / 2;

    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;
    const polRad = (polarizerAngle * Math.PI) / 180;
    const maxR = Math.min(width, height) * 0.42;

    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const dx = px + 0.5 - cx;
        const dy = py + 0.5 - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const idx = (py * width + px) * 4;

        if (dist > maxR) {
          // Background: dark
          data[idx] = 15;
          data[idx + 1] = 15;
          data[idx + 2] = 15;
          data[idx + 3] = 255;
          continue;
        }

        const rn = dist / maxR;
        // Principal stress direction φ (using the disk model)
        const sigmaX = 1 - rn * rn * (1 - 2 * (dx * dx) / (dist * dist + 0.01));
        const sigmaY = 1 - rn * rn * (1 - 2 * (dy * dy) / (dist * dist + 0.01));
        const tauXY = -2 * rn * rn * dx * dy / (dist * dist + 0.01);
        const phi = 0.5 * Math.atan2(2 * tauXY, sigmaX - sigmaY);

        // Isochromate (color, stress difference)
        const stressDiff = Math.sqrt(
          (sigmaX - sigmaY) ** 2 + 4 * tauXY * tauXY
        ) * (1 - rn * rn) * 5;
        const ret = Math.abs(stressDiff) * 200;

        // Isoclinic: dark when φ matches polarizer angle
        // cos²(2·(φ - θ_polarizer)) → 0 (dark) when aligned, 1 (bright) when at 45°
        const isoclinicFactor = Math.pow(Math.cos(2 * (phi - polRad)), 2);

        if (ret > 2) {
          const [cr, cg, cb] = stressColorMap(ret);
          // Apply isoclinic darkening
          const brightness = 0.15 + 0.85 * isoclinicFactor;
          data[idx] = Math.round(cr * brightness);
          data[idx + 1] = Math.round(cg * brightness);
          data[idx + 2] = Math.round(cb * brightness);
          data[idx + 3] = 255;
        } else {
          const brightness = 15 + Math.round(ret * 4 * isoclinicFactor);
          data[idx] = brightness;
          data[idx + 1] = brightness;
          data[idx + 2] = brightness;
          data[idx + 3] = 255;
        }
      }
    }
    ctx.putImageData(imageData, 0, 0);

    // Draw polarizer angle indicator
    ctx.strokeStyle = "#FFFFFF";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    const endX = cx + Math.cos(polRad) * maxR;
    const endY = cy + Math.sin(polRad) * maxR;
    ctx.moveTo(cx - Math.cos(polRad) * maxR, cy - Math.sin(polRad) * maxR);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Label
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "9px IBM Plex Sans, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(`θ = ${polarizerAngle}°`, width - 4, height - 4);
  }, [polarizerAngle, width, height]);

  return (
    <canvas
      ref={canvasRef}
      className="border border-[#d4d8e0] bg-[#0F0F0F]"
      style={{ width, height }}
    />
  );
}

/* ─── 3D Stress Surface Component ─── */
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";

type RetardationFn = (
  x: number, y: number, cx: number, cy: number,
  w: number, h: number, stressFactor: number,
  birefringenceCoeff: number, rotation: number
) => number;

function StressSurfaceMesh({
  getRetardation,
  stressFactor,
  birefringenceCoeff,
  rotation,
  retardationScale,
  birefCoeffForLight,
  lightSourceMode,
}: {
  getRetardation: RetardationFn;
  stressFactor: number;
  birefringenceCoeff: number;
  rotation: number;
  retardationScale: number;
  birefCoeffForLight: number;
  lightSourceMode: LightSourceMode;
}) {
  const GRID_W = 80;
  const GRID_H = 60;
  const CANVAS_W = 400;
  const CANVAS_H = 300;

  const { geometry } = useMemo(() => {
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];

    const cx = CANVAS_W / 2;
    const cy = CANVAS_H / 2;

    // Find max retardation for Z scaling
    let maxRet = 0;
    const retGrid: number[][] = [];
    for (let j = 0; j <= GRID_H; j++) {
      retGrid[j] = [];
      for (let i = 0; i <= GRID_W; i++) {
        const px = (i / GRID_W) * CANVAS_W;
        const py = (j / GRID_H) * CANVAS_H;
        const ret = getRetardation(px, py, cx, cy, CANVAS_W, CANVAS_H, stressFactor, birefringenceCoeff, rotation);
        const scaledRet = (ret / 1000) * retardationScale;
        retGrid[j][i] = scaledRet;
        if (scaledRet > maxRet) maxRet = scaledRet;
      }
    }

    const zScale = maxRet > 0 ? 2.0 / maxRet : 0;

    for (let j = 0; j <= GRID_H; j++) {
      for (let i = 0; i <= GRID_W; i++) {
        const x = (i / GRID_W) * 2 - 1;
        const y = (j / GRID_H) * 2 - 1;
        const ret = retGrid[j][i];
        const z = ret * zScale;

        positions.push(x, y, z);

        let cr: number, cg: number, cb: number;
        if (ret > 2) {
          if (lightSourceMode === "white") {
            [cr, cg, cb] = dispersionWhiteLightColor(ret, birefCoeffForLight);
          } else {
            [cr, cg, cb] = singleWavelengthColor(ret, WAVELENGTHS[lightSourceMode]);
          }
        } else {
          const brightness = 0.06 + ret * 0.016;
          cr = brightness * 255;
          cg = brightness * 255;
          cb = brightness * 255;
        }
        colors.push(cr / 255, cg / 255, cb / 255);
      }
    }

    for (let j = 0; j < GRID_H; j++) {
      for (let i = 0; i < GRID_W; i++) {
        const a = j * (GRID_W + 1) + i;
        const b = a + 1;
        const c = a + (GRID_W + 1);
        const d = c + 1;
        indices.push(a, c, b);
        indices.push(b, c, d);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    return { geometry: geo };
  }, [getRetardation, stressFactor, birefringenceCoeff, rotation, retardationScale, birefCoeffForLight, lightSourceMode]);

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial
        vertexColors
        roughness={0.8}
        metalness={0}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

function StressSurface3D({
  demoPattern,
  stressFactor,
  birefringenceCoeff,
  rotation,
  retardationScale,
  birefCoeffForLight,
  lightSourceMode,
}: {
  demoPattern: DemoPattern;
  stressFactor: number;
  birefringenceCoeff: number;
  rotation: number;
  retardationScale: number;
  birefCoeffForLight: number;
  lightSourceMode: LightSourceMode;
}) {
  const getRetardation = useMemo(
    () => PATTERN_GENERATORS[demoPattern],
    [demoPattern]
  );

  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex-1 min-h-0" style={{ minHeight: 380 }}>
        <Canvas
          camera={{ position: [2.5, 2.5, 2.5], fov: 45, near: 0.1, far: 100 }}
          style={{ background: "#FFFFFF" }}
          gl={{ antialias: true }}
        >
          <ambientLight intensity={0.5} />
          <directionalLight position={[5, 5, 5]} intensity={0.8} />
          <directionalLight position={[-3, -3, 5]} intensity={0.3} />
          <Suspense fallback={null}>
            <StressSurfaceMesh
              getRetardation={getRetardation}
              stressFactor={stressFactor}
              birefringenceCoeff={birefringenceCoeff}
              rotation={rotation}
              retardationScale={retardationScale}
              birefCoeffForLight={birefCoeffForLight}
              lightSourceMode={lightSourceMode}
            />
          </Suspense>
          <gridHelper args={[3, 15, "#d4d8e0", "#e8ecf0"]} rotation={[0, 0, 0]} position={[0, 0, -0.01]} />
          <OrbitControls
            enableDamping
            dampingFactor={0.1}
            minDistance={1.5}
            maxDistance={8}
          />
        </Canvas>
      </div>
      {/* Color legend / axis labels */}
      <div className="flex items-center justify-center gap-4 mt-2 px-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] text-[#9ca3af]" style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>
            X / Y: 位置
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] text-[#9ca3af]" style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>
            Z: 延迟量 (nm)
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] text-[#9ca3af]" style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>
            颜色: 干涉色
          </span>
        </div>
      </div>
      <div className="flex justify-center mt-1">
        <div
          className="text-[9px] text-[#6b7280]"
          style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}
        >
          {DEMO_PATTERN_LABELS[demoPattern]} — 鼠标拖拽旋转 / 滚轮缩放
        </div>
      </div>
      {/* Michel-Lévy reference */}
      <div className="flex justify-center mt-2">
        <div>
          <div
            className="text-[9px] text-[#9ca3af] text-center mb-1"
            style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}
          >
            Michel-Lévy 干涉色参考
          </div>
          <MichelLevyChart width={300} height={30} />
        </div>
      </div>
    </div>
  );
}

/* ─── Main Component ─── */
export default function PolarizationScanner({ onBack }: { onBack: () => void }) {
  // Mobile layout state
  const isMobile = useIsMobile();
  const [panelOpen, setPanelOpen] = useState(false);

  // Camera mode state
  const [streaming, setStreaming] = useState(false);
  const [sensitivity, setSensitivity] = useState(1.0);
  const [showOriginal, setShowOriginal] = useState(true);
  const [showProcessed, setShowProcessed] = useState(true);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const originalCanvasRef = useRef<HTMLCanvasElement>(null);
  const processedCanvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);

  // Demo mode state
  const [demoPattern, setDemoPattern] = useState<DemoPattern>("disk");
  const [stressMagnitude, setStressMagnitude] = useState(3);
  const [birefringenceCoeff, setBirefringenceCoeff] = useState(1.5);
  const [rotationAngle, setRotationAngle] = useState(0);
  const [retardationScale, setRetardationScale] = useState(500);

  // NEW: Experiment mode tabs
  const [experimentMode, setExperimentMode] = useState<ExperimentMode>("demo");

  // NEW: Light source mode
  const [lightSourceMode, setLightSourceMode] = useState<LightSourceMode>("white");

  // NEW: Sénarmont method state
  const [senarmontAngle, setSenarmontAngle] = useState(45);
  const [senarmontMinAngle, setSenarmontMinAngle] = useState<number | null>(null);

  // NEW: Point-click ellipse state
  const [clickPoint, setClickPoint] = useState<{
    x: number;
    y: number;
    ret: number;
    stress: number;
    fastAxis: number;
  } | null>(null);

  // NEW: Quantitative measurement state
  const [weight, setWeight] = useState(0);
  const [stressData, setStressData] = useState<{ weight: number; retardation: number }[]>([]);

  // NEW: Sample geometry & material for quantitative mode
  const [sampleWidth, setSampleWidth] = useState(10); // mm (beam width b)
  const [sampleThickness, setSampleThickness] = useState(5); // mm (depth d)
  const [material, setMaterial] = useState<Material>("custom");

  // NEW: Isoclinic scan animation state (teaching mode)
  const [isoclinicAngle, setIsoclinicAngle] = useState(0);
  const [isoclinicPlaying, setIsoclinicPlaying] = useState(false);

  // Demo canvas ref
  const demoCanvasRef = useRef<HTMLCanvasElement>(null);

  // Refs for demo rendering to avoid stale closures
  const demoPatternRef = useRef(demoPattern);
  const stressMagRef = useRef(stressMagnitude);
  const birefCoeffRef = useRef(birefringenceCoeff);
  const rotationRef = useRef(rotationAngle);
  const retardationScaleRef = useRef(retardationScale);
  const lightSourceModeRef = useRef(lightSourceMode);
  const birefCoeffForLightRef = useRef(birefringenceCoeff);
  const experimentModeRef = useRef(experimentMode);
  const weightRef = useRef(weight);

  useEffect(() => { demoPatternRef.current = demoPattern; }, [demoPattern]);
  useEffect(() => { stressMagRef.current = stressMagnitude; }, [stressMagnitude]);
  useEffect(() => { birefCoeffRef.current = birefringenceCoeff; }, [birefringenceCoeff]);
  useEffect(() => { rotationRef.current = rotationAngle; }, [rotationAngle]);
  useEffect(() => { retardationScaleRef.current = retardationScale; }, [retardationScale]);
  useEffect(() => { lightSourceModeRef.current = lightSourceMode; }, [lightSourceMode]);
  useEffect(() => { birefCoeffForLightRef.current = birefringenceCoeff; }, [birefringenceCoeff]);
  useEffect(() => { experimentModeRef.current = experimentMode; }, [experimentMode]);
  useEffect(() => { weightRef.current = weight; }, [weight]);

  const birefringenceParams: BirefringenceParams = useMemo(
    () => ({
      subtractBackground: false,
      sensitivity,
      rotationCompensation: 0,
    }),
    [sensitivity]
  );

  /* ─── Camera controls ─── */
  const startCamera = useCallback(async () => {
    try {
      setCameraError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setStreaming(true);
    } catch {
      setCameraError("无法访问摄像头。请确认已授权并使用支持摄像头的设备。");
      setStreaming(false);
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setStreaming(false);
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
    }
  }, []);

  /* ─── Camera processing loop ─── */
  useEffect(() => {
    if (!streaming || !videoRef.current) return;

    const processFrame = () => {
      const video = videoRef.current;
      if (!video || video.paused || video.ended) {
        animFrameRef.current = requestAnimationFrame(processFrame);
        return;
      }

      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (vw === 0 || vh === 0) {
        animFrameRef.current = requestAnimationFrame(processFrame);
        return;
      }

      if (showOriginal && originalCanvasRef.current) {
        const canvas = originalCanvasRef.current;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          canvas.width = vw;
          canvas.height = vh;
          ctx.drawImage(video, 0, 0);
        }
      }

      if (showProcessed && processedCanvasRef.current) {
        const canvas = processedCanvasRef.current;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          canvas.width = vw;
          canvas.height = vh;
          ctx.drawImage(video, 0, 0);
          const imageData = ctx.getImageData(0, 0, vw, vh);
          const processed = processBirefringenceFrame(imageData, birefringenceParams);
          ctx.putImageData(processed, 0, 0);
        }
      }

      animFrameRef.current = requestAnimationFrame(processFrame);
    };

    animFrameRef.current = requestAnimationFrame(processFrame);

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [streaming, showOriginal, showProcessed, birefringenceParams]);

  /* ─── Demo mode rendering ─── */
  useEffect(() => {
    if (streaming || !demoCanvasRef.current || experimentModeRef.current === "3d") return;

    const canvas = demoCanvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = 400;
    const H = 300;
    canvas.width = W;
    canvas.height = H;

    const cx = W / 2;
    const cy = H / 2;
    const rotRad = () => (rotationRef.current * Math.PI) / 180;

    let animId: number;

    const renderDemo = () => {
      const pattern = demoPatternRef.current;
      const sf = stressMagRef.current;
      const bc = birefCoeffRef.current;
      const rot = rotRad();
      const scale = retardationScaleRef.current;
      const lMode = lightSourceModeRef.current;
      const bcForLight = birefCoeffForLightRef.current;
      const expMode = experimentModeRef.current;
      const wt = weightRef.current;

      const imageData = ctx.createImageData(W, H);
      const data = imageData.data;

      const getRetardation = PATTERN_GENERATORS[pattern];

      for (let py = 0; py < H; py++) {
        for (let px = 0; px < W; px++) {
          const idx = (py * W + px) * 4;
          let ret = getRetardation(px + 0.5, py + 0.5, cx, cy, W, H, sf, bc, rot);
          const scaledRet = (ret / 1000) * scale;

          // Weight effect in quantitative mode
          if (expMode === "quantitative" && wt > 0) {
            const distFromCenter = Math.sqrt(
              (px + 0.5 - cx) * (px + 0.5 - cx) + (py + 0.5 - cy) * (py + 0.5 - cy)
            );
            const maxDist = Math.min(W, H) * 0.3;
            if (distFromCenter < maxDist) {
              const weightStress =
                (1 - distFromCenter / maxDist) * wt * 3;
              ret += weightStress;
            }
            const finalScaledRet = (ret / 1000) * scale;

            if (finalScaledRet > 2) {
              let cr: number, cg: number, cb: number;
              if (lMode === "white") {
                [cr, cg, cb] = dispersionWhiteLightColor(finalScaledRet, bcForLight);
              } else {
                [cr, cg, cb] = singleWavelengthColor(finalScaledRet, WAVELENGTHS[lMode]);
              }
              data[idx] = cr;
              data[idx + 1] = cg;
              data[idx + 2] = cb;
              data[idx + 3] = 255;
            } else {
              const brightness = 15 + Math.round(finalScaledRet * 4);
              data[idx] = brightness;
              data[idx + 1] = brightness;
              data[idx + 2] = brightness;
              data[idx + 3] = 255;
            }
            continue;
          }

          if (scaledRet > 2) {
            let cr: number, cg: number, cb: number;
            if (lMode === "white") {
              [cr, cg, cb] = dispersionWhiteLightColor(scaledRet, bcForLight);
            } else {
              [cr, cg, cb] = singleWavelengthColor(scaledRet, WAVELENGTHS[lMode]);
            }
            data[idx] = cr;
            data[idx + 1] = cg;
            data[idx + 2] = cb;
            data[idx + 3] = 255;
          } else {
            const brightness = 15 + Math.round(scaledRet * 4);
            data[idx] = brightness;
            data[idx + 1] = brightness;
            data[idx + 2] = brightness;
            data[idx + 3] = 255;
          }
        }
      }

      ctx.putImageData(imageData, 0, 0);

      // Draw weight indicator in quantitative mode
      if (expMode === "quantitative" && wt > 0) {
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.fillRect(cx - 20, cy - 18, 40, 16);
        ctx.fillStyle = "#2d3142";
        ctx.font = "10px IBM Plex Sans, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(`${wt}g`, cx, cy - 6);
      }

      // Draw pattern label on canvas
      ctx.font = "10px IBM Plex Sans, sans-serif";
      ctx.fillStyle = "#AAAAAA";
      ctx.textAlign = "right";
      ctx.fillText(DEMO_PATTERN_LABELS[pattern], W - 8, H - 8);

      animId = requestAnimationFrame(renderDemo);
    };

    animId = requestAnimationFrame(renderDemo);
    return () => cancelAnimationFrame(animId);
  }, [streaming]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  /* ─── Isoclinic scan animation (teaching mode) ─── */
  useEffect(() => {
    if (!isoclinicPlaying) return;
    const id = setInterval(() => {
      setIsoclinicAngle((prev) => (prev + 10) % 180);
    }, 400);
    return () => clearInterval(id);
  }, [isoclinicPlaying]);

  /* ─── Sénarmont I-θ curve canvas ─── */
  const senarmontCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = senarmontCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const cW = 240;
    const cH = 60;
    canvas.width = cW;
    canvas.height = cH;

    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, cW, cH);

    // Compute center-point retardation for the current pattern
    const pattern = demoPatternRef.current;
    const sf = stressMagRef.current;
    const bc = birefCoeffRef.current;
    const rot = (rotationAngle * Math.PI) / 180;
    const scale = retardationScale;

    const getRetardation = PATTERN_GENERATORS[pattern];

    const centerRet = getRetardation(200, 150, 200, 150, 400, 300, sf, bc, rot);
    const scaledCenterRet = (centerRet / 1000) * scale;
    const lambda = WAVELENGTHS[lightSourceMode];

    // Draw I(θ) = sin²(π·R/λ + 2·θ·π/180) curve
    ctx.strokeStyle = "#2d3142";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let px = 0; px < cW; px++) {
      const theta = (px / cW) * 360;
      const phase = (Math.PI * scaledCenterRet) / lambda + (2 * theta * Math.PI) / 180;
      const intensity = Math.pow(Math.sin(phase), 2);
      const py = cH - intensity * (cH - 4) - 2;
      if (px === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    // Draw current analyzer angle marker
    const markerX = (senarmontAngle / 360) * cW;
    ctx.strokeStyle = "#dc2626";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(markerX, 0);
    ctx.lineTo(markerX, cH);
    ctx.stroke();

    // Draw minimum angle marker if found
    if (senarmontMinAngle !== null) {
      const minX = (senarmontMinAngle / 360) * cW;
      ctx.strokeStyle = "#16a34a";
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(minX, 0);
      ctx.lineTo(minX, cH);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Axis labels
    ctx.fillStyle = "#9ca3af";
    ctx.font = "7px IBM Plex Mono, monospace";
    ctx.textAlign = "left";
    ctx.fillText("0°", 0, cH - 1);
    ctx.textAlign = "center";
    ctx.fillText("180°", cW / 2, cH - 1);
    ctx.textAlign = "right";
    ctx.fillText("360°", cW, cH - 1);
  }, [
    senarmontAngle,
    senarmontMinAngle,
    demoPattern,
    stressMagnitude,
    birefringenceCoeff,
    rotationAngle,
    retardationScale,
    lightSourceMode,
  ]);

  /* ─── Auto-find Sénarmont minimum ─── */
  const autoFindSenarmontMin = useCallback(() => {
    const pattern = demoPatternRef.current;
    const sf = stressMagRef.current;
    const bc = birefCoeffRef.current;
    const rot = (rotationAngle * Math.PI) / 180;
    const scale = retardationScale;

    const getRetardation = PATTERN_GENERATORS[pattern];

    const centerRet = getRetardation(200, 150, 200, 150, 400, 300, sf, bc, rot);
    const scaledCenterRet = (centerRet / 1000) * scale;
    const lambda = WAVELENGTHS[lightSourceMode];

    let minIntensity = Infinity;
    let minAngle = 45;
    for (let theta = 0; theta < 360; theta += 0.5) {
      const phase = (Math.PI * scaledCenterRet) / lambda + (2 * theta * Math.PI) / 180;
      const intensity = Math.pow(Math.sin(phase), 2);
      if (intensity < minIntensity) {
        minIntensity = intensity;
        minAngle = theta;
      }
    }

    setSenarmontMinAngle(minAngle);
    setSenarmontAngle(minAngle);
  }, [rotationAngle, retardationScale, lightSourceMode]);

  /* ─── Sénarmont calculated retardation ─── */
  const senarmontRetardation = useMemo(() => {
    if (senarmontMinAngle === null) return null;
    const lambda = WAVELENGTHS[lightSourceMode];
    const R = 2 * (senarmontMinAngle - 45) * lambda / 360;
    return Math.abs(R);
  }, [senarmontMinAngle, lightSourceMode]);

  /* ─── Demo canvas click handler ─── */
  const handleDemoCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = demoCanvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const scaleX = 400 / rect.width;
      const scaleY = 300 / rect.height;
      const canvasX = (e.clientX - rect.left) * scaleX;
      const canvasY = (e.clientY - rect.top) * scaleY;

      const pattern = demoPatternRef.current;
      const sf = stressMagRef.current;
      const bc = birefCoeffRef.current;
      const rot = (rotationAngle * Math.PI) / 180;
      const scale = retardationScale;

      const getRetardation = PATTERN_GENERATORS[pattern];

      const ret = getRetardation(canvasX, canvasY, 200, 150, 400, 300, sf, bc, rot);
      const scaledRet = (ret / 1000) * scale;
      const stress = scaledRet / 300;
      const fastAxis = getFastAxisAngle(pattern, canvasX, canvasY, 200, 150);

      setClickPoint({
        x: canvasX,
        y: canvasY,
        ret: scaledRet,
        stress,
        fastAxis: (fastAxis * 180) / Math.PI,
      });
    },
    [rotationAngle, retardationScale]
  );

  /* ─── Stress-retardation plot canvas ─── */
  const stressPlotCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = stressPlotCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const pW = 350;
    const pH = 200;
    canvas.width = pW;
    canvas.height = pH;

    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, pW, pH);

    const marginL = 50;
    const marginR = 20;
    const marginT = 20;
    const marginB = 40;
    const plotW = pW - marginL - marginR;
    const plotH = pH - marginT - marginB;

    // Axes
    ctx.strokeStyle = "#D0D0D0";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(marginL, marginT);
    ctx.lineTo(marginL, marginT + plotH);
    ctx.lineTo(marginL + plotW, marginT + plotH);
    ctx.stroke();

    // Axis labels
    ctx.fillStyle = "#6b7280";
    ctx.font = "9px IBM Plex Sans, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("载荷 (g)", marginL + plotW / 2, pH - 4);
    ctx.save();
    ctx.translate(12, marginT + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("延迟量 (nm)", 0, 0);
    ctx.restore();

    // Tick marks
    ctx.font = "7px IBM Plex Mono, monospace";
    ctx.fillStyle = "#9ca3af";
    ctx.textAlign = "center";
    for (let i = 0; i <= 5; i++) {
      const x = marginL + (i / 5) * plotW;
      const val = i * 20;
      ctx.fillText(String(val), x, marginT + plotH + 14);
      ctx.strokeStyle = "#EFEFEF";
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(x, marginT);
      ctx.lineTo(x, marginT + plotH);
      ctx.stroke();
    }
    ctx.textAlign = "right";
    for (let i = 0; i <= 4; i++) {
      const y = marginT + plotH - (i / 4) * plotH;
      const val = i * 100;
      ctx.fillText(String(val), marginL - 4, y + 3);
      ctx.strokeStyle = "#EFEFEF";
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(marginL, y);
      ctx.lineTo(marginL + plotW, y);
      ctx.stroke();
    }

    if (stressData.length === 0) {
      ctx.fillStyle = "#9ca3af";
      ctx.font = "10px IBM Plex Sans, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("调节载荷后点击「记录数据点」", marginL + plotW / 2, marginT + plotH / 2);
      return;
    }

    // Find max values for scaling
    const maxWeight = Math.max(100, ...stressData.map((d) => d.weight));
    const maxRet = Math.max(400, ...stressData.map((d) => d.retardation));

    // Draw data points and fit line
    const scaleX = plotW / maxWeight;
    const scaleY = plotH / maxRet;

    // Linear fit
    const n = stressData.length;
    if (n >= 2) {
      let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
      for (const d of stressData) {
        sumX += d.weight;
        sumY += d.retardation;
        sumXY += d.weight * d.retardation;
        sumX2 += d.weight * d.weight;
      }
      const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
      const intercept = (sumY - slope * sumX) / n;

      // Draw fit line
      ctx.strokeStyle = "#2d3142";
      ctx.lineWidth = 1;
      ctx.beginPath();
      const y0 = intercept;
      const yMax = slope * maxWeight + intercept;
      ctx.moveTo(marginL, marginT + plotH - (y0 / maxRet) * plotH);
      ctx.lineTo(
        marginL + plotW,
        marginT + plotH - (yMax / maxRet) * plotH
      );
      ctx.stroke();
    }

    // Draw data points
    for (const d of stressData) {
      const px = marginL + d.weight * scaleX;
      const py = marginT + plotH - d.retardation * scaleY;
      ctx.fillStyle = "#dc2626";
      ctx.beginPath();
      ctx.arc(px, py, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#FFFFFF";
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }

    // Re-draw axes on top
    ctx.strokeStyle = "#D0D0D0";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(marginL, marginT);
    ctx.lineTo(marginL, marginT + plotH);
    ctx.lineTo(marginL + plotW, marginT + plotH);
    ctx.stroke();
  }, [stressData]);

  /* ─── Current center retardation for quantitative mode ─── */
  const currentCenterRetardation = useMemo(() => {
    const pattern = demoPattern;
    const sf = stressMagnitude;
    const bc = birefringenceCoeff;
    const rot = (rotationAngle * Math.PI) / 180;
    const scale = retardationScale;

    const getRetardation = PATTERN_GENERATORS[pattern];

    const baseRet = getRetardation(200, 150, 200, 150, 400, 300, sf, bc, rot);
    const scaledRet = (baseRet / 1000) * scale;
    // Add weight contribution at center
    const weightContrib = weight > 0 ? weight * 3 * (scale / 1000) : 0;
    return scaledRet + weightContrib;
  }, [demoPattern, stressMagnitude, birefringenceCoeff, rotationAngle, retardationScale, weight]);

  /* ─── Photoelastic constant calculation ─── */
  const photoelasticConstant = useMemo(() => {
    if (stressData.length < 2) return null;
    const n = stressData.length;
    let sumW = 0, sumR = 0, sumWR = 0, sumW2 = 0;
    for (const d of stressData) {
      sumW += d.weight;
      sumR += d.retardation;
      sumWR += d.weight * d.retardation;
      sumW2 += d.weight * d.weight;
    }
    const slope = (n * sumWR - sumW * sumR) / (n * sumW2 - sumW * sumW);
    const intercept = (sumR - slope * sumW) / n;
    // slope = nm/g, convert to Brewster using configurable geometry
    // Δσ/Δm = g / (b·d), where b=sampleWidth(mm), d=sampleThickness(mm)
    const b_m = sampleWidth * 1e-3; // convert mm → m
    const d_m = sampleThickness * 1e-3;
    const dSigmaPerGram = 9.8 / (b_m * d_m); // Pa per gram
    // C = ΔR / (σ·d) = (slope·1e-9) / (dSigmaPerGram · d_m) in Pa⁻¹
    const C_brewster = (slope * 1e-9) / (dSigmaPerGram * d_m);
    return {
      C: C_brewster * 1e12, // in Brewster (10⁻¹² Pa⁻¹)
      slope,
      intercept,
    };
  }, [stressData, sampleWidth, sampleThickness]);

  /* ─── Compute R² (coefficient of determination) for the linear fit ─── */
  const fitR2 = useMemo(() => {
    if (stressData.length < 2 || !photoelasticConstant) return null;
    const n = stressData.length;
    const meanR = stressData.reduce((s, d) => s + d.retardation, 0) / n;
    let ssTot = 0, ssRes = 0;
    for (const d of stressData) {
      const predicted = photoelasticConstant.slope * d.weight + photoelasticConstant.intercept;
      ssTot += (d.retardation - meanR) ** 2;
      ssRes += (d.retardation - predicted) ** 2;
    }
    if (ssTot === 0) return null;
    return 1 - ssRes / ssTot;
  }, [stressData, photoelasticConstant]);

  /* ─── Compare fitted C with material reference ─── */
  const materialComparison = useMemo(() => {
    if (!photoelasticConstant || material === "custom") return null;
    const refC = MATERIAL_C[material];
    const measured = photoelasticConstant.C;
    const diff = ((measured - refC) / refC) * 100;
    return { refC, measured, diff };
  }, [photoelasticConstant, material]);

  /* ─── Record stress data point ─── */
  const recordStressDataPoint = useCallback(() => {
    setStressData((prev) => [
      ...prev,
      { weight, retardation: currentCenterRetardation },
    ]);
  }, [weight, currentCenterRetardation]);

  /* ─── Keyboard shortcuts (1-4 tabs, R record, C clear, Space camera) ─── */
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;

      if (e.key === "1" && !streaming) setExperimentMode("demo");
      else if (e.key === "2" && !streaming) setExperimentMode("quantitative");
      else if (e.key === "3" && !streaming) setExperimentMode("teaching");
      else if (e.key === "4" && !streaming) setExperimentMode("3d");
      else if ((e.key === "r" || e.key === "R") && !streaming && experimentMode === "quantitative") {
        recordStressDataPoint();
      } else if ((e.key === "c" || e.key === "C") && !streaming && experimentMode === "quantitative") {
        setStressData([]);
      } else if (e.code === "Space") {
        e.preventDefault();
        if (streaming) stopCamera();
        else startCamera();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [streaming, experimentMode, recordStressDataPoint, startCamera, stopCamera]);

  /* ─── Teaching library pattern generators (memoized) ─── */
  const teachingGen1 = useMemo(
    () => threePointBendingIsochromates,
    []
  );
  const teachingGen2 = useMemo(
    () => diskDiametralCompressionIsoclinics,
    []
  );
  const teachingGen3 = useMemo(
    () => pureBendingIsochromates,
    []
  );

  /* ─── Section header style ─── */
  const sectionHeaderClass =
    "text-[10px] font-semibold text-[#6b7280] uppercase tracking-wider mb-2.5";
  const sectionHeaderStyle = { fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" };

  return (
    <div className="flex flex-col h-full" style={{ background: "#FFFFFF" }}>
      {/* ─── Header ─── */}
      <div
        className="flex-shrink-0 flex items-center border-b border-[#d4d8e0]"
        style={{
          background: "#FFFFFF",
          height: isMobile ? "44px" : "48px",
          paddingLeft: isMobile ? "16px" : "24px",
          paddingRight: isMobile ? "12px" : "24px",
        }}
      >
        <button
          onClick={onBack}
          className="text-[12px] text-[#6b7280] hover:text-[#2d3142] transition-colors bg-transparent border-none cursor-pointer flex items-center gap-1"
        >
          ← 返回
        </button>
        <span className="mx-3 text-[#d4d8e0]">|</span>
        <h1
          className="font-semibold text-[#2d3142] m-0"
          style={{ fontSize: isMobile ? "17px" : "18px" }}
        >
          偏振视觉扫描仪
        </h1>
        {!streaming && (
          <span className="ml-3 text-[10px] text-[#9ca3af] bg-[#f0f3f6] px-2 py-0.5 rounded border border-[#e8ecf0]">
            {experimentMode === "demo" && "演示模式"}
            {experimentMode === "quantitative" && "定量测量"}
            {experimentMode === "teaching" && "教学库"}
            {experimentMode === "3d" && "3D应力图"}
          </span>
        )}
        <MobilePanelToggle onClick={() => setPanelOpen(true)} label="参数" />
      </div>

      {/* ─── Main Content ─── */}
      <div className="flex flex-1 min-h-0">
        {/* ─── Left Control Panel ─── */}
        <ControlPanel
          open={panelOpen}
          onClose={() => setPanelOpen(false)}
          title="偏振视觉扫描仪参数"
          desktopWidth="w-72"
        >
          <div className="space-y-4">
            {/* Camera Control */}
            <div>
              <h3 className={sectionHeaderClass} style={sectionHeaderStyle}>
                摄像头控制
              </h3>
              {cameraError && (
                <div className="bg-red-50 border border-red-200 rounded p-2 mb-3">
                  <p className="text-[11px] text-red-600">{cameraError}</p>
                </div>
              )}
              <Button
                onClick={streaming ? stopCamera : startCamera}
                className={`w-full h-9 text-[12px] ${
                  streaming
                    ? "bg-[#dc2626] hover:bg-[#b91c1c] text-white"
                    : "bg-[#2d3142] hover:bg-[#3d4152] text-white"
                }`}
              >
                {streaming ? "停止扫描" : "启动摄像头扫描"}
              </Button>
              {!streaming && (
                <div className="mt-2 text-[9px] text-[#9ca3af] bg-white border border-[#d4d8e0] rounded px-2 py-1.5">
                  无摄像头时自动进入演示模式
                </div>
              )}
            </div>

            {/* Processing Parameters */}
            <div className="border-t border-[#d4d8e0] pt-3">
              <h3 className={sectionHeaderClass} style={sectionHeaderStyle}>
                处理参数
              </h3>
              <div className="space-y-1.5 mb-3">
                <div className="flex items-center justify-between">
                  <Label className="text-[12px] text-[#2d3142]">灵敏度</Label>
                  <span className="text-[11px] text-[#6b7280] tabular-nums">
                    {sensitivity.toFixed(1)}×
                  </span>
                </div>
                <Slider
                  value={[sensitivity]}
                  onValueChange={([v]) => setSensitivity(v)}
                  min={0.5}
                  max={3}
                  step={0.1}
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-[12px] text-[#2d3142]">延迟量范围</Label>
                  <span className="text-[11px] text-[#6b7280] tabular-nums">
                    {retardationScale} nm
                  </span>
                </div>
                <Slider
                  value={[retardationScale]}
                  onValueChange={([v]) => setRetardationScale(v)}
                  min={100}
                  max={2000}
                  step={50}
                />
              </div>
            </div>

            {/* Light Source Mode - NEW */}
            {!streaming && (
              <div className="border-t border-[#d4d8e0] pt-3">
                <h3 className={sectionHeaderClass} style={sectionHeaderStyle}>
                  光源模式
                </h3>
                <Select
                  value={lightSourceMode}
                  onValueChange={(v) => setLightSourceMode(v as LightSourceMode)}
                >
                  <SelectTrigger className="w-full h-8 text-[11px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(LIGHT_SOURCE_LABELS) as LightSourceMode[]).map((key) => (
                      <SelectItem key={key} value={key} className="text-[11px]">
                        {LIGHT_SOURCE_LABELS[key]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {lightSourceMode !== "white" && (
                  <p className="text-[8px] text-[#9ca3af] mt-1.5">
                    单波长干涉：I = sin²(πR/λ)，条纹对比度更高
                  </p>
                )}
                {lightSourceMode === "white" && (
                  <p className="text-[8px] text-[#9ca3af] mt-1.5">
                    色散模型：C(λ) = C₀·(1 + k·(λ-λ₀))，R/G/B分别计算
                  </p>
                )}
              </div>
            )}

            {/* Demo Mode Controls (only when camera not active) */}
            {!streaming && (
              <div className="border-t border-[#d4d8e0] pt-3">
                <h3 className={sectionHeaderClass} style={sectionHeaderStyle}>
                  演示模式
                </h3>
                <div className="grid grid-cols-3 gap-1 mb-3">
                  {(Object.keys(DEMO_PATTERN_LABELS) as DemoPattern[]).map((key) => (
                    <Button
                      key={key}
                      variant="outline"
                      size="sm"
                      onClick={() => setDemoPattern(key)}
                      className={`h-8 text-[9px] px-1 ${
                        demoPattern === key
                          ? "bg-[#2d3142] text-white border-[#2d3142] hover:bg-[#3d4152] hover:text-white"
                          : "bg-white text-[#6b7280] border-[#d4d8e0] hover:bg-[#f0f1f3]"
                      }`}
                    >
                      {DEMO_PATTERN_LABELS[key]}
                    </Button>
                  ))}
                </div>
                <p className="text-[9px] text-[#9ca3af] leading-relaxed mb-3">
                  {DEMO_PATTERN_DESC[demoPattern]}
                </p>

                {/* Stress Magnitude Slider */}
                <div className="space-y-1.5 mb-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-[12px] text-[#2d3142]">应力大小</Label>
                    <span className="text-[11px] text-[#6b7280] tabular-nums">
                      {stressMagnitude}
                    </span>
                  </div>
                  <Slider
                    value={[stressMagnitude]}
                    onValueChange={([v]) => setStressMagnitude(v)}
                    min={1}
                    max={10}
                    step={0.5}
                  />
                  <p className="text-[8px] text-[#9ca3af]">控制条纹级次/密度</p>
                </div>

                {/* Birefringence Coefficient Slider */}
                <div className="space-y-1.5 mb-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-[12px] text-[#2d3142]">双折射系数</Label>
                    <span className="text-[11px] text-[#6b7280] tabular-nums">
                      {birefringenceCoeff.toFixed(1)}
                    </span>
                  </div>
                  <Slider
                    value={[birefringenceCoeff]}
                    onValueChange={([v]) => setBirefringenceCoeff(v)}
                    min={0.1}
                    max={3}
                    step={0.1}
                  />
                  <p className="text-[8px] text-[#9ca3af]">控制颜色偏移量</p>
                </div>

                {/* Rotation Angle Slider */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-[12px] text-[#2d3142]">旋转角度</Label>
                    <span className="text-[11px] text-[#6b7280] tabular-nums">
                      {rotationAngle}°
                    </span>
                  </div>
                  <Slider
                    value={[rotationAngle]}
                    onValueChange={([v]) => setRotationAngle(v)}
                    min={0}
                    max={360}
                    step={5}
                  />
                  <p className="text-[8px] text-[#9ca3af]">旋转样品/图案方向</p>
                </div>
              </div>
            )}

            {/* Sénarmont Compensation Method - NEW */}
            {!streaming && (
              <div className="border-t border-[#d4d8e0] pt-3">
                <h3 className={sectionHeaderClass} style={sectionHeaderStyle}>
                  Sénarmont 补偿法
                </h3>
                <div className="space-y-1.5 mb-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-[12px] text-[#2d3142]">分析镜角度</Label>
                    <span className="text-[11px] text-[#6b7280] tabular-nums">
                      {senarmontAngle.toFixed(1)}°
                    </span>
                  </div>
                  <Slider
                    value={[senarmontAngle]}
                    onValueChange={([v]) => setSenarmontAngle(v)}
                    min={0}
                    max={360}
                    step={0.5}
                  />
                </div>
                {/* I-θ curve */}
                <div className="mb-2">
                  <div className="text-[8px] text-[#9ca3af] mb-1">I(θ) = sin²(πR/λ + 2θ)</div>
                  <canvas
                    ref={senarmontCanvasRef}
                    className="border border-[#d4d8e0] bg-white w-full"
                    style={{ height: 60 }}
                  />
                  <div className="flex items-center gap-3 mt-1">
                    <div className="flex items-center gap-1">
                      <div className="w-3 h-0.5 bg-[#dc2626]" />
                      <span className="text-[7px] text-[#9ca3af]">当前角度</span>
                    </div>
                    {senarmontMinAngle !== null && (
                      <div className="flex items-center gap-1">
                        <div className="w-3 h-0.5 bg-[#16a34a] border-dashed" />
                        <span className="text-[7px] text-[#9ca3af]">最小值</span>
                      </div>
                    )}
                  </div>
                </div>
                <Button
                  onClick={autoFindSenarmontMin}
                  variant="outline"
                  size="sm"
                  className="w-full h-7 text-[10px] mb-2"
                >
                  自动寻零
                </Button>
                {senarmontRetardation !== null && (
                  <div className="bg-white border border-[#d4d8e0] rounded p-2">
                    <div className="text-[9px] text-[#9ca3af] mb-1">计算延迟量</div>
                    <div className="text-[13px] text-[#2d3142] font-semibold tabular-nums">
                      R = {senarmontRetardation.toFixed(1)} nm
                    </div>
                    <div className="text-[8px] text-[#9ca3af] mt-1">
                      R = 2·(θ_min - 45°)·λ/360, 精度 λ/{Math.round(WAVELENGTHS[lightSourceMode] / 100)}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Quantitative Measurement Controls - NEW */}
            {!streaming && experimentMode === "quantitative" && (
              <div className="border-t border-[#d4d8e0] pt-3">
                <h3 className={sectionHeaderClass} style={sectionHeaderStyle}>
                  定量测量
                </h3>

                {/* Sample material selector */}
                <div className="space-y-1.5 mb-2">
                  <Label className="text-[11px] text-[#2d3142]">样品材料</Label>
                  <Select
                    value={material}
                    onValueChange={(v) => setMaterial(v as Material)}
                  >
                    <SelectTrigger className="w-full h-8 text-[11px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(MATERIAL_LABELS) as Material[]).map((key) => (
                        <SelectItem key={key} value={key} className="text-[11px]">
                          {MATERIAL_LABELS[key]}
                          {key !== "custom" && ` (C=${MATERIAL_C[key].toFixed(1)} Br)`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Sample geometry sliders */}
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <Label className="text-[10px] text-[#2d3142]">宽度 b</Label>
                      <span className="text-[10px] text-[#6b7280] tabular-nums">{sampleWidth}mm</span>
                    </div>
                    <Slider
                      value={[sampleWidth]}
                      onValueChange={([v]) => setSampleWidth(v)}
                      min={2}
                      max={30}
                      step={1}
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <Label className="text-[10px] text-[#2d3142]">厚度 d</Label>
                      <span className="text-[10px] text-[#6b7280] tabular-nums">{sampleThickness}mm</span>
                    </div>
                    <Slider
                      value={[sampleThickness]}
                      onValueChange={([v]) => setSampleThickness(v)}
                      min={1}
                      max={20}
                      step={0.5}
                    />
                  </div>
                </div>

                <div className="space-y-1.5 mb-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-[12px] text-[#2d3142]">虚拟载荷</Label>
                    <span className="text-[11px] text-[#6b7280] tabular-nums">
                      {weight} g
                    </span>
                  </div>
                  <Slider
                    value={[weight]}
                    onValueChange={([v]) => setWeight(v)}
                    min={0}
                    max={100}
                    step={1}
                  />
                </div>
                <div className="bg-white border border-[#d4d8e0] rounded p-2 mb-2">
                  <div className="text-[9px] text-[#9ca3af]">中心延迟量</div>
                  <div className="text-[13px] text-[#2d3142] font-semibold tabular-nums">
                    {currentCenterRetardation.toFixed(1)} nm
                  </div>
                </div>
                <div className="flex gap-1.5 mb-2">
                  <Button
                    onClick={recordStressDataPoint}
                    variant="outline"
                    size="sm"
                    className="flex-1 h-7 text-[10px]"
                  >
                    记录数据点
                  </Button>
                  <Button
                    onClick={() => setStressData([])}
                    variant="outline"
                    size="sm"
                    className="h-7 text-[10px] px-2"
                  >
                    清除
                  </Button>
                  <Button
                    onClick={() => {
                      if (stressData.length === 0) return;
                      const csv = "weight_g,retardation_nm\n" +
                        stressData.map((d) => `${d.weight},${d.retardation.toFixed(2)}`).join("\n");
                      const blob = new Blob([csv], { type: "text/csv" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `stress-data-${Date.now()}.csv`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                    variant="outline"
                    size="sm"
                    className="h-7 text-[10px] px-2"
                    disabled={stressData.length === 0}
                  >
                    CSV
                  </Button>
                </div>
                {photoelasticConstant !== null && (
                  <div className="bg-white border border-[#d4d8e0] rounded p-2">
                    <div className="text-[9px] text-[#9ca3af]">光弹性常数 C</div>
                    <div className="text-[13px] text-[#2d3142] font-semibold tabular-nums">
                      {photoelasticConstant.C.toFixed(2)} Brewster
                    </div>
                    <div className="text-[8px] text-[#9ca3af] mt-1">
                      C = ΔR/(σ·d), 样品 b={sampleWidth}mm, d={sampleThickness}mm
                    </div>
                    {fitR2 !== null && (
                      <div className="mt-1.5 flex items-center justify-between border-t border-[#e8ecf0] pt-1.5">
                        <span className="text-[8px] text-[#9ca3af]">拟合 R²</span>
                        <span className={`text-[10px] font-semibold tabular-nums ${
                          fitR2 > 0.95 ? "text-[#16a34a]" : fitR2 > 0.8 ? "text-[#ca8a04]" : "text-[#dc2626]"
                        }`}>
                          {fitR2.toFixed(4)}
                        </span>
                      </div>
                    )}
                    {materialComparison && (
                      <div className="mt-1.5 border-t border-[#e8ecf0] pt-1.5">
                        <div className="text-[8px] text-[#9ca3af]">材料对比</div>
                        <div className="text-[9px] text-[#6b7280] tabular-nums mt-0.5">
                          测量 {materialComparison.measured.toFixed(2)} vs 参考 {materialComparison.refC.toFixed(1)} Br
                        </div>
                        <div className={`text-[9px] font-semibold tabular-nums ${
                          Math.abs(materialComparison.diff) < 10 ? "text-[#16a34a]" : "text-[#dc2626]"
                        }`}>
                          偏差 {materialComparison.diff > 0 ? "+" : ""}{materialComparison.diff.toFixed(1)}%
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <p className="text-[8px] text-[#9ca3af] mt-2">
                  数据点: {stressData.length} | 调节载荷后记录多组数据
                </p>
              </div>
            )}

            {/* Display Options (only when camera active) */}
            {streaming && (
              <div className="border-t border-[#d4d8e0] pt-3">
                <h3 className={sectionHeaderClass} style={sectionHeaderStyle}>
                  显示选项
                </h3>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-[12px] text-[#2d3142]">原始画面</Label>
                    <Switch checked={showOriginal} onCheckedChange={setShowOriginal} />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="text-[12px] text-[#2d3142]">应力图案</Label>
                    <Switch checked={showProcessed} onCheckedChange={setShowProcessed} />
                  </div>
                </div>
              </div>
            )}

            {/* Michel-Lévy Chart */}
            <div className="border-t border-[#d4d8e0] pt-3">
              <h3 className={sectionHeaderClass} style={sectionHeaderStyle}>
                Michel-Lévy 干涉色表
              </h3>
              <MichelLevyChart width={240} height={44} />
              <p className="text-[10px] text-[#9ca3af] mt-1.5 leading-relaxed">
                颜色对应光程差(延迟量)。黑→灰→白→淡黄→红→蓝为标准应力光学配色。
              </p>
            </div>

            {/* Usage Guide */}
            <div className="border-t border-[#d4d8e0] pt-3">
              <h3 className={sectionHeaderClass} style={sectionHeaderStyle}>
                使用指南
              </h3>
              <div className="bg-white border border-[#d4d8e0] rounded p-2.5">
                {streaming ? (
                  <ol className="text-[10.5px] text-[#4a4a5a] space-y-1.5 leading-relaxed list-decimal list-inside">
                    <li>将样品置于正交偏光镜之间</li>
                    <li>启动摄像头，对准样品</li>
                    <li>调节灵敏度，观察应力双折射图案</li>
                    <li>应力集中处颜色更鲜艳，零应力区域呈暗灰色</li>
                  </ol>
                ) : (
                  <ol className="text-[10.5px] text-[#4a4a5a] space-y-1.5 leading-relaxed list-decimal list-inside">
                    <li>选择预设应力图样</li>
                    <li>调节应力大小、双折射系数和旋转角度</li>
                    <li>切换光源模式观察色散效果</li>
                    <li>点击画布查看局部偏振椭圆</li>
                    <li>使用Sénarmont法测量延迟量</li>
                  </ol>
                )}
              </div>
            </div>

            {/* Sample Suggestions */}
            <div className="border-t border-[#d4d8e0] pt-3">
              <h3 className={sectionHeaderClass} style={sectionHeaderStyle}>
                推荐样品
              </h3>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { name: "透明塑料", path: "M3 5h18v14H3z M3 9h18 M7 5v14" },
                  { name: "胶带", path: "M4 6h16v4H4z M6 10v8h12v-8" },
                  { name: "水果表皮", path: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z M12 4v16" },
                  { name: "眼镜片", path: "M2 10c4-2 6-2 10 0s6 2 10 0 M2 10v4c4 2 6 2 10 0s6-2 10 0v-4" },
                  { name: "CD盒", path: "M4 5h16v14H4z M8 9h8v6H8z" },
                  { name: "冰块", path: "M6 6l12 12 M18 6L6 18 M12 4v16 M4 12h16" },
                ].map((item) => (
                  <div
                    key={item.name}
                    className="bg-white border border-[#d4d8e0] rounded px-1.5 py-2 text-center hover:border-[#9ca3af] transition-colors"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" className="mx-auto" fill="none" stroke="#9ca3af" strokeWidth="1.2">
                      <path d={item.path} />
                    </svg>
                    <p className="text-[9px] text-[#6b7280] mt-1">{item.name}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Keyboard shortcuts hint */}
            <div className="border-t border-[#d4d8e0] pt-3">
              <h3 className={sectionHeaderClass} style={sectionHeaderStyle}>
                键盘快捷键
              </h3>
              <div className="bg-white border border-[#d4d8e0] rounded p-2 space-y-1">
                {[
                  { key: "1-4", desc: "切换实验模式" },
                  { key: "R", desc: "记录数据点" },
                  { key: "C", desc: "清除数据" },
                  { key: "Space", desc: "启停摄像头" },
                ].map((item) => (
                  <div key={item.key} className="flex items-center justify-between">
                    <kbd className="text-[8px] font-mono bg-[#f0f3f6] border border-[#d4d8e0] rounded px-1.5 py-0.5 text-[#2d3142]">
                      {item.key}
                    </kbd>
                    <span className="text-[9px] text-[#9ca3af]">{item.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </ControlPanel>

        {/* ─── Right Visualization Area ─── */}
        <div className="flex-1 min-w-0 flex flex-col items-center bg-white overflow-y-auto custom-scrollbar" style={{ padding: isMobile ? "12px" : "24px" }}>
          {/* Hidden video element */}
          <video ref={videoRef} className="hidden" playsInline muted />

          {!streaming ? (
            <div className="w-full max-w-[700px]">
              {/* ─── Experiment Mode Tabs ─── */}
              <div
                className={`flex gap-1 mb-4 border-b border-[#d4d8e0] pb-0 ${
                  isMobile ? "overflow-x-auto mobile-x-scroll" : ""
                }`}
              >
                {([
                  { id: "demo" as const, label: "演示模式" },
                  { id: "quantitative" as const, label: "定量测量" },
                  { id: "teaching" as const, label: "教学库" },
                  { id: "3d" as const, label: "3D应力图" },
                ] as const).map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => {
                      setExperimentMode(tab.id);
                      setClickPoint(null);
                    }}
                    className={`px-4 py-2 text-[12px] border-b-2 transition-colors bg-transparent cursor-pointer whitespace-nowrap ${
                      experimentMode === tab.id
                        ? "border-[#2d3142] text-[#2d3142] font-semibold"
                        : "border-transparent text-[#9ca3af] hover:text-[#6b7280]"
                    }`}
                    style={{ fontFamily: "system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif" }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* ─── Demo Mode Tab ─── */}
              {experimentMode === "demo" && (
                <div className="flex flex-col items-center gap-4">
                  {/* Demo canvas with click overlay */}
                  <div className="relative">
                    <canvas
                      ref={demoCanvasRef}
                      onClick={handleDemoCanvasClick}
                      className="border border-[#d4d8e0] bg-[#0F0F0F] cursor-crosshair"
                      style={{ maxWidth: "100%", height: "auto", maxHeight: 400 }}
                    />
                    {/* Demo mode badge overlay */}
                    <div className="absolute top-2 left-2 text-[9px] text-[#888888] bg-[#f8f9fb]/80 px-1.5 py-0.5 rounded border border-[#d4d8e0]">
                      演示模式
                    </div>

                    {/* Point-click polarization ellipse overlay */}
                    {clickPoint && (
                      <div
                        className="absolute pointer-events-none"
                        style={{
                          left: `${(clickPoint.x / 400) * 100}%`,
                          top: `${(clickPoint.y / 300) * 100}%`,
                          transform: "translate(-50%, -50%)",
                        }}
                      >
                        {/* Polarization ellipse SVG */}
                        <svg
                          width="60"
                          height="60"
                          viewBox="-30 -30 60 60"
                          style={{
                            transform: `rotate(${clickPoint.fastAxis}deg)`,
                          }}
                        >
                          <ellipse
                            cx="0"
                            cy="0"
                            rx="20"
                            ry={20 * Math.abs(Math.sin((Math.PI * clickPoint.ret) / (2 * (WAVELENGTHS[lightSourceMode] || 550))))}
                            fill="none"
                            stroke="#FFFFFF"
                            strokeWidth="1.5"
                            opacity="0.9"
                          />
                          {/* Fast axis line */}
                          <line
                            x1="-24"
                            y1="0"
                            x2="24"
                            y2="0"
                            stroke="#FFFFFF"
                            strokeWidth="0.5"
                            strokeDasharray="2,2"
                            opacity="0.6"
                          />
                          {/* Arrow indicator */}
                          <line
                            x1="0"
                            y1="-3"
                            x2="0"
                            y2="3"
                            stroke="#FFFFFF"
                            strokeWidth="1"
                            opacity="0.8"
                          />
                        </svg>
                        {/* Info tooltip */}
                        <div
                          className="absolute left-8 -top-2 bg-white border border-[#d4d8e0] rounded px-2 py-1.5"
                          style={{ minWidth: 120, pointerEvents: "auto" }}
                        >
                          <div className="text-[8px] text-[#9ca3af] mb-0.5">局部测量</div>
                          <div className="text-[10px] text-[#2d3142] tabular-nums">
                            R = {clickPoint.ret.toFixed(1)} nm
                          </div>
                          <div className="text-[10px] text-[#2d3142] tabular-nums">
                            σ = {clickPoint.stress.toFixed(2)}
                          </div>
                          <div className="text-[10px] text-[#2d3142] tabular-nums">
                            α = {clickPoint.fastAxis.toFixed(1)}°
                          </div>
                          <button
                            onClick={() => setClickPoint(null)}
                            className="text-[7px] text-[#9ca3af] hover:text-[#6b7280] mt-0.5 bg-transparent border-none cursor-pointer"
                          >
                            关闭
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Idle state description */}
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-20 h-20 border-2 border-dashed border-[#d4d8e0] rounded-lg flex items-center justify-center">
                      <svg width="36" height="36" viewBox="0 0 48 48" fill="none">
                        <rect
                          x="8" y="4" width="32" height="40" rx="3"
                          stroke="#9ca3af" strokeWidth="1.5" fill="none"
                        />
                        <circle cx="24" cy="20" r="8" stroke="#9ca3af" strokeWidth="1.2" fill="none" />
                        <circle cx="24" cy="20" r="3" fill="#d4d8e0" />
                        <line x1="18" y1="36" x2="30" y2="36" stroke="#d4d8e0" strokeWidth="1" />
                      </svg>
                    </div>
                    <div className="text-center">
                      <p className="text-[11px] text-[#9ca3af] max-w-xs leading-relaxed">
                        点击画布查看局部偏振椭圆。调节左侧参数观察应力双折射图案变化。
                      </p>
                    </div>
                  </div>

                  {/* Michel-Lévy reference below demo canvas */}
                  <div className="mt-2">
                    <div
                      className="text-[9px] text-[#9ca3af] text-center mb-1"
                      style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}
                    >
                      Michel-Lévy 干涉色参考
                    </div>
                    <MichelLevyChart width={400} height={36} />
                  </div>
                </div>
              )}

              {/* ─── Quantitative Measurement Tab ─── */}
              {experimentMode === "quantitative" && (
                <div className="flex flex-col items-center gap-4">
                  {/* Demo canvas (shared ref, shows weight effect) */}
                  <div className="relative">
                    <canvas
                      ref={demoCanvasRef}
                      onClick={handleDemoCanvasClick}
                      className="border border-[#d4d8e0] bg-[#0F0F0F]"
                      style={{ maxWidth: "100%", height: "auto", maxHeight: 400 }}
                    />
                    <div className="absolute top-2 left-2 text-[9px] text-[#888888] bg-[#f8f9fb]/80 px-1.5 py-0.5 rounded border border-[#d4d8e0]">
                      定量测量
                    </div>
                  </div>

                  {/* Stress-retardation plot */}
                  <div className="w-full max-w-[400px]">
                    <div
                      className="text-[9px] text-[#9ca3af] text-center mb-1"
                      style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}
                    >
                      载荷-延迟量关系
                    </div>
                    <canvas
                      ref={stressPlotCanvasRef}
                      className="border border-[#d4d8e0] bg-white w-full"
                      style={{ height: 200 }}
                    />
                  </div>

                  {/* Data summary */}
                  <div className="bg-white border border-[#d4d8e0] rounded p-3 w-full max-w-[400px]">
                    <div className="text-[10px] text-[#6b7280] mb-2" style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>
                      测量数据
                    </div>
                    {stressData.length > 0 ? (
                      <div className="max-h-32 overflow-y-auto overflow-x-auto custom-scrollbar mobile-x-scroll">
                        <table className="w-full text-[10px]">
                          <thead>
                            <tr className="border-b border-[#d4d8e0]">
                              <th className="text-left py-1 text-[#9ca3af] font-normal">序号</th>
                              <th className="text-right py-1 text-[#9ca3af] font-normal">载荷 (g)</th>
                              <th className="text-right py-1 text-[#9ca3af] font-normal">延迟量 (nm)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {stressData.map((d, i) => (
                              <tr key={i} className="border-b border-[#f0f3f6]">
                                <td className="py-0.5 text-[#6b7280] tabular-nums">{i + 1}</td>
                                <td className="py-0.5 text-right text-[#2d3142] tabular-nums">{d.weight}</td>
                                <td className="py-0.5 text-right text-[#2d3142] tabular-nums">{d.retardation.toFixed(1)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-[9px] text-[#9ca3af]">暂无数据，调节载荷后点击「记录数据点」</p>
                    )}
                  </div>
                </div>
              )}

              {/* ─── 3D Stress Surface Tab ─── */}
              {experimentMode === "3d" && (
                <div className="w-full">
                  <StressSurface3D
                    demoPattern={demoPattern}
                    stressFactor={stressMagnitude}
                    birefringenceCoeff={birefringenceCoeff}
                    rotation={(rotationAngle * Math.PI) / 180}
                    retardationScale={retardationScale}
                    birefCoeffForLight={birefringenceCoeff}
                    lightSourceMode={lightSourceMode}
                  />
                  {/* Info panel with current parameters */}
                  <div className="mt-4 bg-white border border-[#d4d8e0] rounded p-3">
                    <div
                      className="text-[10px] text-[#6b7280] mb-2"
                      style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}
                    >
                      当前参数
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      <div className="text-[10px]">
                        <span className="text-[#9ca3af]">图案: </span>
                        <span className="text-[#2d3142] tabular-nums">{DEMO_PATTERN_LABELS[demoPattern]}</span>
                      </div>
                      <div className="text-[10px]">
                        <span className="text-[#9ca3af]">应力: </span>
                        <span className="text-[#2d3142] tabular-nums">{stressMagnitude}</span>
                      </div>
                      <div className="text-[10px]">
                        <span className="text-[#9ca3af]">双折射系数: </span>
                        <span className="text-[#2d3142] tabular-nums">{birefringenceCoeff}</span>
                      </div>
                      <div className="text-[10px]">
                        <span className="text-[#9ca3af]">旋转: </span>
                        <span className="text-[#2d3142] tabular-nums">{rotationAngle}°</span>
                      </div>
                      <div className="text-[10px]">
                        <span className="text-[#9ca3af]">延迟量比例: </span>
                        <span className="text-[#2d3142] tabular-nums">{retardationScale}</span>
                      </div>
                      <div className="text-[10px]">
                        <span className="text-[#9ca3af]">光源: </span>
                        <span className="text-[#2d3142]">{LIGHT_SOURCE_LABELS[lightSourceMode]}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ─── Teaching Library Tab ─── */}
              {experimentMode === "teaching" && (
                <div className="w-full">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Three-point bending isochromates */}
                    <div className="bg-white border border-[#d4d8e0] rounded p-4">
                      <h4 className="text-[12px] font-semibold text-[#2d3142] mb-2">
                        三点弯曲梁等色线
                      </h4>
                      <TeachingPatternCanvas generator={teachingGen1} width={200} height={150} />
                      <div className="mt-2">
                        <p className="text-[9px] text-[#6b7280] leading-relaxed">
                          三点弯曲梁在跨中受集中载荷，弯矩呈三角形分布。
                          等色线为恒定主应力差(σ₁-σ₂)的轨迹，中性轴处应力为零呈暗场，
                          远离中性轴等色线级次递增。
                        </p>
                        <div className="mt-1.5 text-[8px] text-[#9ca3af]">
                          σ = M·y/I，R = C·(σ₁-σ₂)·d
                        </div>
                      </div>
                    </div>

                    {/* Disk diametral compression isoclinics */}
                    <div className="bg-white border border-[#d4d8e0] rounded p-4">
                      <h4 className="text-[12px] font-semibold text-[#2d3142] mb-2">
                        圆盘对径受压等倾线
                      </h4>
                      <TeachingPatternCanvas generator={teachingGen2} width={200} height={150} />
                      <div className="mt-2">
                        <p className="text-[9px] text-[#6b7280] leading-relaxed">
                          圆盘沿直径受对径压缩力。等倾线为主应力方向相同的点轨迹，
                          同步旋转正交偏光镜时等倾线移动，等色线不动——这是区分两者的关键特征。
                        </p>
                        <div className="mt-1.5 text-[8px] text-[#9ca3af]">
                          tan(2φ) = 2τ_xy/(σ_x - σ_y)
                        </div>
                      </div>
                    </div>

                    {/* Pure bending isochromates */}
                    <div className="bg-white border border-[#d4d8e0] rounded p-4">
                      <h4 className="text-[12px] font-semibold text-[#2d3142] mb-2">
                        纯弯曲等色线
                      </h4>
                      <TeachingPatternCanvas generator={teachingGen3} width={200} height={150} />
                      <div className="mt-2">
                        <p className="text-[9px] text-[#6b7280] leading-relaxed">
                          四点加载使梁中部处于纯弯曲状态(等弯矩区)。应力沿高度线性分布，
                          等色线为平行于中性轴的直线条纹，上下对称，级次由中性轴向边缘递增。
                        </p>
                        <div className="mt-1.5 text-[8px] text-[#9ca3af]">
                          σ = M·y/I = const·y
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Interactive isoclinic scan demo */}
                  <div className="mt-6 bg-white border border-[#d4d8e0] rounded p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-[11px] font-semibold text-[#2d3142]" style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>
                        交互式等倾线扫描 — 圆盘对径受压
                      </h4>
                      <Button
                        onClick={() => setIsoclinicPlaying((p) => !p)}
                        variant="outline"
                        size="sm"
                        className="h-6 text-[9px] px-2"
                      >
                        {isoclinicPlaying ? "暂停" : "播放扫描"}
                      </Button>
                    </div>
                    <div className="flex flex-col md:flex-row gap-4 items-center">
                      <IsoclinicScanCanvas polarizerAngle={isoclinicAngle} width={220} height={180} />
                      <div className="flex-1 space-y-2 min-w-0">
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <Label className="text-[11px] text-[#2d3142]">偏光镜角度</Label>
                            <span className="text-[11px] text-[#6b7280] tabular-nums">{isoclinicAngle}°</span>
                          </div>
                          <Slider
                            value={[isoclinicAngle]}
                            onValueChange={([v]) => setIsoclinicAngle(v)}
                            min={0}
                            max={170}
                            step={5}
                          />
                        </div>
                        <p className="text-[9px] text-[#9ca3af] leading-relaxed">
                          旋转正交偏光镜组时，等倾线(暗带)随之扫过样品——这是区分等倾线与等色线的关键：
                          等色线(彩色环)随载荷变化而<strong className="text-[#6b7280]">不</strong>随偏光镜旋转移动；
                          等倾线(暗带)则随偏光镜旋转而扫过。
                        </p>
                        <div className="grid grid-cols-2 gap-2 pt-1">
                          <div className="bg-[#f8f9fb] border border-[#e8ecf0] rounded px-2 py-1">
                            <div className="text-[8px] text-[#9ca3af]">当前角度</div>
                            <div className="text-[11px] text-[#2d3142] font-semibold tabular-nums">{isoclinicAngle}°</div>
                          </div>
                          <div className="bg-[#f8f9fb] border border-[#e8ecf0] rounded px-2 py-1">
                            <div className="text-[8px] text-[#9ca3af]">扫描范围</div>
                            <div className="text-[11px] text-[#2d3142] font-semibold tabular-nums">0° → 180°</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Theory reference */}
                  <div className="mt-6 bg-white border border-[#d4d8e0] rounded p-4">
                    <h4 className="text-[11px] font-semibold text-[#2d3142] mb-2" style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>
                      光弹性基本原理
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <div className="text-[9px] text-[#6b7280] font-semibold mb-1">应力-光学定律</div>
                        <p className="text-[9px] text-[#9ca3af] leading-relaxed">
                          透明材料受力后产生双折射，延迟量与主应力差成正比：
                          R = C·(σ₁-σ₂)·d，其中C为光弹性常数，d为样品厚度。
                        </p>
                      </div>
                      <div>
                        <div className="text-[9px] text-[#6b7280] font-semibold mb-1">等色线与等倾线</div>
                        <p className="text-[9px] text-[#9ca3af] leading-relaxed">
                          等色线：主应力差相同的点连线(彩色条纹)。等倾线：主应力方向相同的点连线(暗带)。
                          同步旋转偏光镜时等倾线移动，等色线不变。
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* ─── Camera Active View ─── */
            <div
              className={`w-full justify-center ${
                isMobile
                  ? "flex flex-col items-center gap-4"
                  : "flex gap-6 items-start"
              }`}
            >
              {showOriginal && (
                <div className="flex flex-col items-center w-full">
                  <div
                    className="text-[10px] text-[#9ca3af] uppercase tracking-wider mb-2"
                    style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}
                  >
                    原始画面
                  </div>
                  <canvas
                    ref={originalCanvasRef}
                    className="border border-[#d4d8e0] bg-black"
                    style={{ maxWidth: "100%", height: "auto", maxHeight: 360 }}
                  />
                </div>
              )}

              {showProcessed && (
                <div className="flex flex-col items-center w-full">
                  <div
                    className="text-[10px] text-[#9ca3af] uppercase tracking-wider mb-2"
                    style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}
                  >
                    应力双折射图案
                  </div>
                  <canvas
                    ref={processedCanvasRef}
                    className="border border-[#d4d8e0] bg-[#f0f0f0]"
                    style={{ maxWidth: "100%", height: "auto", maxHeight: 360 }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Michel-Lévy reference at bottom when camera active */}
          {streaming && (
            <div className="mt-4">
              <div
                className="text-[9px] text-[#9ca3af] text-center mb-1"
                style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}
              >
                Michel-Lévy 干涉色参考
              </div>
              <MichelLevyChart width={400} height={36} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
