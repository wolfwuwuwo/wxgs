"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  processBirefringenceFrame,
  retardationToMichelLevy,
  type BirefringenceParams,
} from "@/lib/optics/birefringence";

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

    // Draw Michel-Lévy color bar
    for (let x = 0; x < width; x++) {
      const retardation = (x / width) * 2000;
      const [r, g, b] = retardationToMichelLevy(retardation);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(x, 0, 1, height - 12);
    }

    // Border
    ctx.strokeStyle = "#d4d8e0";
    ctx.lineWidth = 0.5;
    ctx.strokeRect(0, 0, width, height - 12);

    // Labels
    ctx.fillStyle = "#6b7280";
    ctx.font = "8px IBM Plex Mono, monospace";
    ctx.textAlign = "center";
    ctx.fillText("0", 0, height - 1);
    ctx.fillText("500", width * 0.25, height - 1);
    ctx.fillText("1000", width * 0.5, height - 1);
    ctx.fillText("1500", width * 0.75, height - 1);
    ctx.fillText("2000 nm", width, height - 1);
  }, [width, height]);

  return <canvas ref={canvasRef} style={{ width, height }} />;
}

/* ─── Demo Pattern Types ─── */
type DemoPattern = "disk" | "plate" | "beam" | "residual";

const DEMO_PATTERN_LABELS: Record<DemoPattern, string> = {
  disk: "圆盘压缩",
  plate: "方板拉伸",
  beam: "梁弯曲",
  residual: "残余应力",
};

const DEMO_PATTERN_DESC: Record<DemoPattern, string> = {
  disk: "同心彩色环 — 受压玻璃盘在正交偏光镜下的干涉图样",
  plate: "对角等色线 — 单轴拉伸板的应力双折射条纹",
  beam: "中性轴 + 弯曲条纹 — 梁弯曲时的应力分布",
  residual: "不规则图样 — 钢化玻璃的残余应力分布",
};

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

/* ─── Demo pattern retardation generators ─── */
function diskCompressionRetardation(
  x: number,
  y: number,
  cx: number,
  cy: number,
  w: number,
  h: number,
  stressFactor: number,
  birefringenceCoeff: number,
  rotation: number
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
  x: number,
  y: number,
  cx: number,
  cy: number,
  w: number,
  h: number,
  stressFactor: number,
  birefringenceCoeff: number,
  rotation: number
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
  x: number,
  y: number,
  cx: number,
  cy: number,
  w: number,
  h: number,
  stressFactor: number,
  birefringenceCoeff: number,
  rotation: number
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
  x: number,
  y: number,
  cx: number,
  cy: number,
  w: number,
  h: number,
  stressFactor: number,
  birefringenceCoeff: number,
  rotation: number
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

/* ─── Main Component ─── */
export default function PolarizationScanner({ onBack }: { onBack: () => void }) {
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

  // Demo canvas ref
  const demoCanvasRef = useRef<HTMLCanvasElement>(null);

  // Refs for demo rendering to avoid stale closures
  const demoPatternRef = useRef(demoPattern);
  const stressMagRef = useRef(stressMagnitude);
  const birefCoeffRef = useRef(birefringenceCoeff);
  const rotationRef = useRef(rotationAngle);
  const retardationScaleRef = useRef(retardationScale);

  useEffect(() => {
    demoPatternRef.current = demoPattern;
  }, [demoPattern]);
  useEffect(() => {
    stressMagRef.current = stressMagnitude;
  }, [stressMagnitude]);
  useEffect(() => {
    birefCoeffRef.current = birefringenceCoeff;
  }, [birefringenceCoeff]);
  useEffect(() => {
    rotationRef.current = rotationAngle;
  }, [rotationAngle]);
  useEffect(() => {
    retardationScaleRef.current = retardationScale;
  }, [retardationScale]);

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

      // Draw original
      if (showOriginal && originalCanvasRef.current) {
        const canvas = originalCanvasRef.current;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          canvas.width = vw;
          canvas.height = vh;
          ctx.drawImage(video, 0, 0);
        }
      }

      // Process and draw
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
    if (streaming || !demoCanvasRef.current) return;

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

      const imageData = ctx.createImageData(W, H);
      const data = imageData.data;

      let getRetardation: typeof diskCompressionRetardation;
      switch (pattern) {
        case "disk":
          getRetardation = diskCompressionRetardation;
          break;
        case "plate":
          getRetardation = plateTensionRetardation;
          break;
        case "beam":
          getRetardation = beamBendingRetardation;
          break;
        case "residual":
          getRetardation = residualStressRetardation;
          break;
      }

      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const idx = (y * W + x) * 4;
          const ret = getRetardation(x, y, cx, cy, W, H, sf, bc, rot);
          const scaledRet = (ret / 1000) * scale;

          if (scaledRet > 2) {
            const [cr, cg, cb] = stressColorMap(scaledRet);
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

  return (
    <div className="flex flex-col h-full" style={{ background: "#FFFFFF" }}>
      {/* ─── Header ─── */}
      <div
        className="flex-shrink-0 flex items-center h-12 border-b border-[#d4d8e0] px-6"
        style={{ background: "#FFFFFF" }}
      >
        <button
          onClick={onBack}
          className="text-[12px] text-[#6b7280] hover:text-[#2d3142] transition-colors bg-transparent border-none cursor-pointer flex items-center gap-1"
        >
          ← 返回
        </button>
        <span className="mx-3 text-[#d4d8e0]">|</span>
        <h1 className="text-[18px] font-semibold text-[#2d3142] m-0">偏振视觉扫描仪</h1>
        {!streaming && (
          <span className="ml-3 text-[10px] text-[#9ca3af] bg-[#f0f3f6] px-2 py-0.5 rounded border border-[#e8ecf0]">
            演示模式
          </span>
        )}
      </div>

      {/* ─── Main Content ─── */}
      <div className="flex flex-1 min-h-0">
      {/* ─── Left Control Panel ─── */}
      <div className="w-72 border-r border-[#d4d8e0] bg-[#f8f9fb] p-4 overflow-y-auto shrink-0">
        <div className="space-y-4">
          {/* Camera Control */}
          <div>
            <h3
              className="text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider mb-2.5"
              style={{ fontFamily: "var(--font-ibm-plex-mono)" }}
            >
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
            <h3
              className="text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider mb-2.5"
              style={{ fontFamily: "var(--font-ibm-plex-mono)" }}
            >
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

          {/* Demo Mode Controls (only when camera not active) */}
          {!streaming && (
            <div className="border-t border-[#d4d8e0] pt-3">
              <h3
                className="text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider mb-2.5"
                style={{ fontFamily: "var(--font-ibm-plex-mono)" }}
              >
                演示模式
              </h3>
              <div className="grid grid-cols-2 gap-1.5 mb-3">
                {(Object.keys(DEMO_PATTERN_LABELS) as DemoPattern[]).map((key) => (
                  <Button
                    key={key}
                    variant="outline"
                    size="sm"
                    onClick={() => setDemoPattern(key)}
                    className={`h-7 text-[10px] px-2 ${
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

          {/* Display Options (only when camera active) */}
          {streaming && (
            <div className="border-t border-[#d4d8e0] pt-3">
              <h3
                className="text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider mb-2.5"
                style={{ fontFamily: "var(--font-ibm-plex-mono)" }}
              >
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
            <h3
              className="text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider mb-2.5"
              style={{ fontFamily: "var(--font-ibm-plex-mono)" }}
            >
              Michel-Lévy 干涉色表
            </h3>
            <MichelLevyChart width={240} height={44} />
            <p className="text-[10px] text-[#9ca3af] mt-1.5 leading-relaxed">
              颜色对应光程差(延迟量)。黑→灰→白→淡黄→红→蓝为标准应力光学配色。
            </p>
          </div>

          {/* Usage Guide */}
          <div className="border-t border-[#d4d8e0] pt-3">
            <h3
              className="text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider mb-2.5"
              style={{ fontFamily: "var(--font-ibm-plex-mono)" }}
            >
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
                  <li>观察应力双折射伪彩色分布变化</li>
                  <li>启动摄像头可切换为实时模式</li>
                </ol>
              )}
            </div>
          </div>

          {/* Sample Suggestions */}
          <div className="border-t border-[#d4d8e0] pt-3">
            <h3
              className="text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider mb-2.5"
              style={{ fontFamily: "var(--font-ibm-plex-mono)" }}
            >
              推荐样品
            </h3>
            <div className="grid grid-cols-2 gap-1.5">
              {[
                { name: "透明塑料", icon: "□" },
                { name: "胶带", icon: "▬" },
                { name: "水果表皮", icon: "○" },
                { name: "眼镜片", icon: "◇" },
                { name: "CD盒", icon: "▢" },
                { name: "冰块", icon: "△" },
              ].map((item) => (
                <div
                  key={item.name}
                  className="bg-white border border-[#d4d8e0] rounded px-2 py-1.5 text-center"
                >
                  <span className="text-[14px] text-[#9ca3af]">{item.icon}</span>
                  <p className="text-[9px] text-[#6b7280] mt-0.5">{item.name}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ─── Right Visualization Area ─── */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 bg-white">
        {/* Hidden video element */}
        <video ref={videoRef} className="hidden" playsInline muted />

        {!streaming ? (
          /* ─── Demo Mode View ─── */
          <div className="flex flex-col items-center gap-4">
            {/* Demo canvas */}
            <div className="relative">
              <canvas
                ref={demoCanvasRef}
                className="border border-[#d4d8e0] bg-[#0F0F0F]"
                style={{ maxWidth: "100%", height: "auto", maxHeight: 400 }}
              />
              {/* 演示模式 badge overlay */}
              <div className="absolute top-2 left-2 text-[9px] text-[#888888] bg-[#f8f9fb]/80 px-1.5 py-0.5 rounded border border-[#d4d8e0]">
                演示模式
              </div>
            </div>

            {/* Idle state description when demo hasn't rendered */}
            <div className="flex flex-col items-center gap-3">
              <div className="w-20 h-20 border-2 border-dashed border-[#d4d8e0] rounded-lg flex items-center justify-center">
                <svg width="36" height="36" viewBox="0 0 48 48" fill="none">
                  <rect
                    x="8"
                    y="4"
                    width="32"
                    height="40"
                    rx="3"
                    stroke="#9ca3af"
                    strokeWidth="1.5"
                    fill="none"
                  />
                  <circle cx="24" cy="20" r="8" stroke="#9ca3af" strokeWidth="1.2" fill="none" />
                  <circle cx="24" cy="20" r="3" fill="#d4d8e0" />
                  <line x1="18" y1="36" x2="30" y2="36" stroke="#d4d8e0" strokeWidth="1" />
                </svg>
              </div>
              <div className="text-center">
                <p className="text-[11px] text-[#9ca3af] max-w-xs leading-relaxed">
                  点击"启动摄像头扫描"切换实时模式。当前为演示模式，
                  可调节左侧参数观察应力双折射图案。
                </p>
              </div>
            </div>

            {/* Michel-Lévy reference below demo canvas */}
            <div className="mt-2">
              <div
                className="text-[9px] text-[#9ca3af] text-center mb-1"
                style={{ fontFamily: "var(--font-ibm-plex-mono)" }}
              >
                Michel-Lévy 干涉色参考
              </div>
              <MichelLevyChart width={400} height={36} />
            </div>
          </div>
        ) : (
          /* ─── Camera Active View ─── */
          <div className="flex gap-6 items-start w-full justify-center">
            {showOriginal && (
              <div className="flex flex-col items-center">
                <div
                  className="text-[10px] text-[#9ca3af] uppercase tracking-wider mb-2"
                  style={{ fontFamily: "var(--font-ibm-plex-mono)" }}
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
              <div className="flex flex-col items-center">
                <div
                  className="text-[10px] text-[#9ca3af] uppercase tracking-wider mb-2"
                  style={{ fontFamily: "var(--font-ibm-plex-mono)" }}
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
              style={{ fontFamily: "var(--font-ibm-plex-mono)" }}
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
