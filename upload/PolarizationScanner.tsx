"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { processBirefringenceFrame, retardationToMichelLevy, type BirefringenceParams } from "@/lib/optics/birefringence";

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
    ctx.font = "8px IBM Plex Mono";
    ctx.textAlign = "center";
    ctx.fillText("0", 0, height - 1);
    ctx.fillText("500", width * 0.25, height - 1);
    ctx.fillText("1000", width * 0.5, height - 1);
    ctx.fillText("1500", width * 0.75, height - 1);
    ctx.fillText("2000 nm", width, height - 1);
  }, [width, height]);

  return <canvas ref={canvasRef} style={{ width, height }} />;
}

export default function PolarizationScanner() {
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

  const birefringenceParams: BirefringenceParams = useMemo(() => ({
    subtractBackground: false,
    sensitivity,
    rotationCompensation: 0,
  }), [sensitivity]);

  const startCamera = useCallback(async () => {
    try {
      setCameraError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 640 }, height: { ideal: 480 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setStreaming(true);
    } catch (err) {
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

  // Processing loop
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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  return (
    <div className="flex h-full">
      {/* Control Panel */}
      <div className="w-72 border-r border-[#d4d8e0] bg-[#f8f9fb] p-4 overflow-y-auto optics-panel shrink-0">
        <div className="space-y-4">
          {/* Camera Control */}
          <div>
            <h3 className="text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider mb-2.5" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
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
          </div>

          {/* Processing Parameters */}
          <div className="border-t border-[#d4d8e0] pt-3">
            <h3 className="text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider mb-2.5" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
              处理参数
            </h3>
            <div className="space-y-1.5 mb-3">
              <div className="flex items-center justify-between">
                <Label className="text-[12px] text-[#2d3142]">灵敏度</Label>
                <span className="text-[11px] text-[#6b7280] mono-digits">{sensitivity.toFixed(1)}×</span>
              </div>
              <Slider
                value={[sensitivity]}
                onValueChange={([v]) => setSensitivity(v)}
                min={0.5}
                max={3}
                step={0.1}
              />
            </div>
          </div>

          {/* Display Options */}
          <div className="border-t border-[#d4d8e0] pt-3">
            <h3 className="text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider mb-2.5" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
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

          {/* Michel-Lévy Chart */}
          <div className="border-t border-[#d4d8e0] pt-3">
            <h3 className="text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider mb-2.5" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
              Michel-Lévy 干涉色表
            </h3>
            <MichelLevyChart width={240} height={44} />
            <p className="text-[10px] text-[#9ca3af] mt-1.5 leading-relaxed">
              颜色对应光程差(延迟量)。黑→灰→白→淡黄→红→蓝为标准应力光学配色。
            </p>
          </div>

          {/* Usage Guide */}
          <div className="border-t border-[#d4d8e0] pt-3">
            <h3 className="text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider mb-2.5" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
              使用指南
            </h3>
            <div className="bg-white border border-[#d4d8e0] rounded p-2.5">
              <ol className="text-[10.5px] text-[#4a4a5a] space-y-1.5 leading-relaxed list-decimal list-inside">
                <li>准备两个正交偏振片，将样品置于其间</li>
                <li>启动摄像头，对准样品</li>
                <li>调节灵敏度，观察应力双折射图案</li>
                <li>尝试：透明塑料尺、胶带、CD盒、眼镜片</li>
              </ol>
            </div>
          </div>

          {/* Sample Suggestions */}
          <div className="border-t border-[#d4d8e0] pt-3">
            <h3 className="text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider mb-2.5" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
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

      {/* Visualization */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 bg-white">
        {/* Hidden video element */}
        <video ref={videoRef} className="hidden" playsInline muted />

        {!streaming ? (
          /* Idle state */
          <div className="flex flex-col items-center gap-4">
            <div className="w-32 h-32 border-2 border-dashed border-[#d4d8e0] rounded-lg flex items-center justify-center">
              <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                <rect x="8" y="4" width="32" height="40" rx="3" stroke="#9ca3af" strokeWidth="1.5" fill="none" />
                <circle cx="24" cy="20" r="8" stroke="#9ca3af" strokeWidth="1.2" fill="none" />
                <circle cx="24" cy="20" r="3" fill="#d4d8e0" />
                <line x1="18" y1="36" x2="30" y2="36" stroke="#d4d8e0" strokeWidth="1" />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-[13px] text-[#4a4a5a] font-medium">偏振视觉扫描仪</p>
              <p className="text-[11px] text-[#9ca3af] mt-1 max-w-xs leading-relaxed">
                点击"启动摄像头扫描"开始。将摄像头对准正交偏振片间的样品，
                实时观察应力双折射引起的偏振变化。
              </p>
            </div>
          </div>
        ) : (
          /* Active state */
          <div className="flex gap-6 items-start w-full justify-center">
            {showOriginal && (
              <div className="flex flex-col items-center">
                <div className="text-[10px] text-[#9ca3af] uppercase tracking-wider mb-2" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
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
                <div className="text-[10px] text-[#9ca3af] uppercase tracking-wider mb-2" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
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

        {/* Michel-Lévy reference at bottom */}
        {streaming && (
          <div className="mt-4">
            <div className="text-[9px] text-[#9ca3af] text-center mb-1" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
              Michel-Lévy 干涉色参考
            </div>
            <MichelLevyChart width={400} height={36} />
          </div>
        )}
      </div>
    </div>
  );
}
