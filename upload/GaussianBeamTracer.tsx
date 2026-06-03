"use client";

import { useState, useMemo, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Line } from "@react-three/drei";
import * as THREE from "three";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { calculateGaussianBeam, getWavelengthColor, formatSI, type GaussianBeamParams } from "@/lib/optics/gaussian-beam";
import BeamProfileCanvas from "./BeamProfileCanvas";

function BeamVisualization({
  beamResult,
  color,
  showLens,
  lensZ,
  showCrossSections,
}: {
  beamResult: ReturnType<typeof calculateGaussianBeam>;
  color: string;
  showLens: boolean;
  lensZ: number;
  showCrossSections: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const zRange = beamResult.propagationDistance;
  const scaleZ = 6;

  // Build envelope points for the upper and lower curves
  const { upperPoints, lowerPoints, crossSectionData } = useMemo(() => {
    const points = beamResult.envelopePoints;
    if (points.length === 0) return { upperPoints: [], lowerPoints: [], crossSectionData: [] };

    const zMin = points[0].z;
    const zMax = points[points.length - 1].z;
    const zSpan = zMax - zMin || 1;

    const upper: THREE.Vector3[] = [];
    const lower: THREE.Vector3[] = [];

    for (let i = 0; i < points.length; i++) {
      const scaledZ = ((points[i].z - zMin) / zSpan - 0.5) * scaleZ;
      const scaledW = points[i].w * 1000;
      upper.push(new THREE.Vector3(scaledW, scaledZ, 0));
      lower.push(new THREE.Vector3(-scaledW, scaledZ, 0));
    }

    // Cross-section data
    const numDiscs = 16;
    const discs: { y: number; r: number; opacity: number }[] = [];
    for (let i = 0; i <= numDiscs; i++) {
      const idx = Math.floor((i / numDiscs) * (points.length - 1));
      const z = ((points[idx].z - zMin) / zSpan - 0.5) * scaleZ;
      const w = points[idx].w * 1000;
      const isWaist = i === Math.floor(numDiscs / 2);
      discs.push({ y: z, r: w, opacity: isWaist ? 0.3 : 0.05 });
    }

    return { upperPoints: upper, lowerPoints: lower, crossSectionData: discs };
  }, [beamResult.envelopePoints, scaleZ]);

  // Build the envelope surface using many thin circles
  const envelopeCircles = useMemo(() => {
    const points = beamResult.envelopePoints;
    if (points.length === 0) return [];

    const zMin = points[0].z;
    const zMax = points[points.length - 1].z;
    const zSpan = zMax - zMin || 1;

    const circles: { points: THREE.Vector3[]; opacity: number }[] = [];
    const step = Math.max(1, Math.floor(points.length / 60));

    for (let i = 0; i < points.length; i += step) {
      const z = ((points[i].z - zMin) / zSpan - 0.5) * scaleZ;
      const w = points[i].w * 1000;
      const segments = 48;
      const circlePoints: THREE.Vector3[] = [];
      for (let j = 0; j <= segments; j++) {
        const angle = (2 * Math.PI * j) / segments;
        circlePoints.push(new THREE.Vector3(w * Math.cos(angle), z, w * Math.sin(angle)));
      }
      circles.push({ points: circlePoints, opacity: i === Math.floor(points.length / 2) ? 0.12 : 0.03 });
    }

    return circles;
  }, [beamResult.envelopePoints, scaleZ]);

  // Lens position in scene coordinates
  const points = beamResult.envelopePoints;
  const zMin = points[0]?.z || 0;
  const zMax = points[points.length - 1]?.z || 0;
  const zSpan = zMax - zMin || 1;
  const lensY = showLens ? ((lensZ - zMin) / zSpan - 0.5) * scaleZ : 0;

  // Rayleigh range positions
  const zR_y1 = ((beamResult.rayleighRange - zMin) / zSpan - 0.5) * scaleZ;
  const zR_y2 = ((-beamResult.rayleighRange - zMin) / zSpan - 0.5) * scaleZ;

  return (
    <group ref={groupRef}>
      {/* Envelope circles (horizontal cross-sections forming the surface) */}
      {envelopeCircles.map((circle, i) => (
        <Line
          key={`env-${i}`}
          points={circle.points}
          color={color}
          lineWidth={1}
        />
      ))}

      {/* Upper envelope curve (side profile) */}
      <Line points={upperPoints} color={color} lineWidth={2} />

      {/* Lower envelope curve (side profile) */}
      <Line points={lowerPoints} color={color} lineWidth={2} />

      {/* Cross-section discs with solid fill */}
      {showCrossSections && crossSectionData.map((disc, i) => (
        <mesh key={`disc-${i}`} position={[0, disc.y, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <circleGeometry args={[disc.r, 64]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={disc.opacity}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      ))}

      {/* Beam waist disc (highlighted) */}
      <mesh position={[0, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <circleGeometry args={[
          (points[Math.floor(points.length / 2)]?.w || 0.0001) * 1000, 64
        ]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.35}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* Beam waist label line */}
      <Line
        points={[
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(
            (points[Math.floor(points.length / 2)]?.w || 0) * 1000 + 0.3,
            0.2,
            0
          ),
        ]}
        color="#6b7280"
        lineWidth={0.8}
      />

      {/* z_R markers (horizontal dashed lines) */}
      {[
        { y: zR_y1, label: "zR" },
        { y: zR_y2, label: "-zR" },
      ].map(({ y, label }) => {
        const wAtZR = beamResult.widthAt(y > 0 ? beamResult.rayleighRange : -beamResult.rayleighRange) * 1000;
        return (
          <group key={label}>
            <Line
              points={[
                new THREE.Vector3(-wAtZR - 0.2, y, 0),
                new THREE.Vector3(wAtZR + 0.2, y, 0),
              ]}
              color="#9ca3af"
              lineWidth={0.8}
            />
          </group>
        );
      })}

      {/* Vertical axis (optical axis) */}
      <Line
        points={[
          new THREE.Vector3(0, -scaleZ / 2 - 0.5, 0),
          new THREE.Vector3(0, scaleZ / 2 + 0.5, 0),
        ]}
        color="#d4d8e0"
        lineWidth={0.5}
      />

      {/* Lens visualization */}
      {showLens && (
        <group position={[0, lensY, 0]}>
          {/* Biconvex lens outline */}
          <Line
            points={[
              new THREE.Vector3(0, -0.7, 0),
              new THREE.Vector3(0.12, -0.55, 0),
              new THREE.Vector3(0.18, -0.3, 0),
              new THREE.Vector3(0.2, 0, 0),
              new THREE.Vector3(0.18, 0.3, 0),
              new THREE.Vector3(0.12, 0.55, 0),
              new THREE.Vector3(0, 0.7, 0),
              new THREE.Vector3(-0.12, 0.55, 0),
              new THREE.Vector3(-0.18, 0.3, 0),
              new THREE.Vector3(-0.2, 0, 0),
              new THREE.Vector3(-0.18, -0.3, 0),
              new THREE.Vector3(-0.12, -0.55, 0),
              new THREE.Vector3(0, -0.7, 0),
            ]}
            color="#4a4a5a"
            lineWidth={1.8}
          />
          {/* Arrow tips */}
          <Line
            points={[
              new THREE.Vector3(-0.06, 0.63, 0),
              new THREE.Vector3(0, 0.7, 0),
              new THREE.Vector3(0.06, 0.63, 0),
            ]}
            color="#4a4a5a"
            lineWidth={1.2}
          />
          <Line
            points={[
              new THREE.Vector3(-0.06, -0.63, 0),
              new THREE.Vector3(0, -0.7, 0),
              new THREE.Vector3(0.06, -0.63, 0),
            ]}
            color="#4a4a5a"
            lineWidth={1.2}
          />
          {/* "f" label indicator */}
          <Line
            points={[
              new THREE.Vector3(0.25, 0, 0),
              new THREE.Vector3(0.5, 0, 0),
            ]}
            color="#6b7280"
            lineWidth={0.8}
          />
        </group>
      )}

      {/* Scale markers along z-axis */}
      {[-3, -2, -1, 1, 2, 3].map((tick) => {
        const y = (tick / 3) * scaleZ / 2;
        return (
          <Line
            key={`tick-${tick}`}
            points={[
              new THREE.Vector3(-0.08, y, 0),
              new THREE.Vector3(0.08, y, 0),
            ]}
            color="#9ca3af"
            lineWidth={0.5}
          />
        );
      })}
    </group>
  );
}

// Scene grid on the back plane
function SceneGrid() {
  const lines = useMemo(() => {
    const result: THREE.Vector3[][] = [];
    const size = 4;
    const divisions = 20;
    const step = (size * 2) / divisions;
    for (let i = 0; i <= divisions; i++) {
      const pos = -size + i * step;
      result.push([
        new THREE.Vector3(pos, -size, -0.5),
        new THREE.Vector3(pos, size, -0.5),
      ]);
      result.push([
        new THREE.Vector3(-size, pos, -0.5),
        new THREE.Vector3(size, pos, -0.5),
      ]);
    }
    return result;
  }, []);

  return (
    <group>
      {lines.map((pts, i) => (
        <Line key={i} points={pts} color="#ebeef2" lineWidth={0.5} />
      ))}
    </group>
  );
}

export default function GaussianBeamTracer() {
  const [w0, setW0] = useState(0.5); // mm
  const [wavelength, setWavelength] = useState(632.8); // nm
  const [propagationDistance, setPropagationDistance] = useState(5); // m
  const [lensFocalLength, setLensFocalLength] = useState(0.5); // m
  const [lensPosition, setLensPosition] = useState(0.5); // m from waist
  const [showLens, setShowLens] = useState(false);
  const [showCrossSections, setShowCrossSections] = useState(true);

  const beamParams: GaussianBeamParams = useMemo(
    () => ({
      w0: w0 * 1e-3,
      wavelength: wavelength * 1e-9,
      propagationDistance,
      lensFocalLength: showLens ? lensFocalLength : 0,
      lensPosition,
    }),
    [w0, wavelength, propagationDistance, lensFocalLength, lensPosition, showLens]
  );

  const beamResult = useMemo(() => calculateGaussianBeam(beamParams), [beamParams]);
  const beamColor = useMemo(() => getWavelengthColor(wavelength), [wavelength]);

  return (
    <div className="flex h-full">
      {/* Control Panel */}
      <div className="w-72 border-r border-[#d4d8e0] bg-[#f8f9fb] p-4 overflow-y-auto optics-panel shrink-0">
        <div className="space-y-5">
          {/* Beam Parameters */}
          <div>
            <h3
              className="text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider mb-3"
              style={{ fontFamily: "var(--font-ibm-plex-mono)" }}
            >
              光束参数
            </h3>

            {/* Wavelength */}
            <div className="space-y-1.5 mb-4">
              <div className="flex items-center justify-between">
                <Label className="text-[12px] text-[#2d3142]">波长 λ</Label>
                <span className="text-[11px] text-[#6b7280] mono-digits">{wavelength} nm</span>
              </div>
              <Select value={String(wavelength)} onValueChange={(v) => setWavelength(Number(v))}>
                <SelectTrigger className="h-8 text-[12px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="632.8">632.8 nm — He-Ne 红</SelectItem>
                  <SelectItem value="532">532 nm — Nd:YAG 绿</SelectItem>
                  <SelectItem value="405">405 nm — 蓝紫</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Beam waist */}
            <div className="space-y-1.5 mb-4">
              <div className="flex items-center justify-between">
                <Label className="text-[12px] text-[#2d3142]">束腰半径 w₀</Label>
                <span className="text-[11px] text-[#6b7280] mono-digits">{w0.toFixed(2)} mm</span>
              </div>
              <Slider
                value={[w0]}
                onValueChange={([v]) => setW0(v)}
                min={0.05}
                max={3}
                step={0.01}
                className="mt-1"
              />
            </div>

            {/* Propagation distance */}
            <div className="space-y-1.5 mb-4">
              <div className="flex items-center justify-between">
                <Label className="text-[12px] text-[#2d3142]">传输距离</Label>
                <span className="text-[11px] text-[#6b7280] mono-digits">{propagationDistance.toFixed(1)} m</span>
              </div>
              <Slider
                value={[propagationDistance]}
                onValueChange={([v]) => setPropagationDistance(v)}
                min={0.5}
                max={20}
                step={0.1}
              />
            </div>
          </div>

          {/* Lens */}
          <div className="border-t border-[#d4d8e0] pt-4">
            <div className="flex items-center justify-between mb-3">
              <h3
                className="text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider"
                style={{ fontFamily: "var(--font-ibm-plex-mono)" }}
              >
                透镜
              </h3>
              <Switch checked={showLens} onCheckedChange={setShowLens} />
            </div>

            {showLens && (
              <>
                <div className="space-y-1.5 mb-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-[12px] text-[#2d3142]">焦距 f</Label>
                    <span className="text-[11px] text-[#6b7280] mono-digits">{lensFocalLength.toFixed(2)} m</span>
                  </div>
                  <Slider
                    value={[lensFocalLength]}
                    onValueChange={([v]) => setLensFocalLength(v)}
                    min={0.05}
                    max={5}
                    step={0.01}
                  />
                </div>

                <div className="space-y-1.5 mb-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-[12px] text-[#2d3142]">透镜位置</Label>
                    <span className="text-[11px] text-[#6b7280] mono-digits">{lensPosition.toFixed(2)} m</span>
                  </div>
                  <Slider
                    value={[lensPosition]}
                    onValueChange={([v]) => setLensPosition(v)}
                    min={0}
                    max={propagationDistance / 2}
                    step={0.01}
                  />
                </div>
              </>
            )}
          </div>

          {/* Computed Values */}
          <div className="border-t border-[#d4d8e0] pt-4">
            <h3
              className="text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider mb-3"
              style={{ fontFamily: "var(--font-ibm-plex-mono)" }}
            >
              计算结果
            </h3>
            <div className="bg-white border border-[#d4d8e0] rounded p-3 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-[11px] text-[#6b7280]">瑞利范围 z_R</span>
                <span className="text-[12px] text-[#1a1a2e] mono-digits font-medium">
                  {formatSI(beamResult.rayleighRange, "m")}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[11px] text-[#6b7280]">远场发散角 θ</span>
                <span className="text-[12px] text-[#1a1a2e] mono-digits font-medium">
                  {(beamResult.divergence * 1000).toFixed(3)} mrad
                </span>
              </div>
              {showLens && (
                <>
                  <div className="flex justify-between items-center">
                    <span className="text-[11px] text-[#6b7280]">聚焦束腰 w₀&apos;</span>
                    <span className="text-[12px] text-[#1a1a2e] mono-digits font-medium">
                      {formatSI(beamResult.focusedW0, "m")}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[11px] text-[#6b7280]">焦点位置</span>
                    <span className="text-[12px] text-[#1a1a2e] mono-digits font-medium">
                      {formatSI(beamResult.focusedPosition, "m")}
                    </span>
                  </div>
                </>
              )}
              <div className="flex justify-between items-center">
                <span className="text-[11px] text-[#6b7280]">w₀处曲率 R</span>
                <span className="text-[12px] text-[#1a1a2e] mono-digits font-medium">∞</span>
              </div>
            </div>
          </div>

          {/* Display Options */}
          <div className="border-t border-[#d4d8e0] pt-4">
            <h3
              className="text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider mb-3"
              style={{ fontFamily: "var(--font-ibm-plex-mono)" }}
            >
              显示选项
            </h3>
            <div className="flex items-center justify-between">
              <Label className="text-[12px] text-[#2d3142]">截面圆盘</Label>
              <Switch checked={showCrossSections} onCheckedChange={setShowCrossSections} />
            </div>
          </div>
        </div>
      </div>

      {/* 3D Visualization */}
      <div className="flex-1 flex flex-col bg-white">
        <div className="flex-1 relative">
          <Canvas
            camera={{ position: [3, 1.5, 4], fov: 45, near: 0.1, far: 100 }}
            style={{ background: "#ffffff" }}
            gl={{ antialias: true, alpha: false }}
          >
            <ambientLight intensity={0.6} />
            <directionalLight position={[5, 5, 5]} intensity={0.2} />

            <BeamVisualization
              beamResult={beamResult}
              color={beamColor}
              showLens={showLens}
              lensZ={lensPosition}
              showCrossSections={showCrossSections}
            />

            <SceneGrid />

            <OrbitControls
              enableDamping
              dampingFactor={0.1}
              rotateSpeed={0.5}
              zoomSpeed={0.8}
              minDistance={2}
              maxDistance={15}
            />
          </Canvas>

          {/* Info overlay */}
          <div className="absolute top-3 right-3 bg-white/95 border border-[#d4d8e0] rounded px-3 py-2 shadow-sm">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full border border-[#d4d8e0]" style={{ backgroundColor: beamColor }} />
              <span className="text-[11px] text-[#4a4a5a] mono-digits">{wavelength} nm</span>
            </div>
            <p className="text-[10px] text-[#9ca3af] mt-1">拖拽旋转 · 滚轮缩放</p>
          </div>

          {/* Formula overlay */}
          <div className="absolute bottom-3 left-3 bg-white/95 border border-[#d4d8e0] rounded px-3 py-2 shadow-sm">
            <p className="text-[10px] text-[#6b7280]" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
              w(z) = w₀√(1 + (z/z_R)²)
            </p>
            <p className="text-[10px] text-[#6b7280] mt-0.5" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
              z_R = πw₀²/λ = {formatSI(beamResult.rayleighRange, "m")}
            </p>
          </div>
        </div>

        {/* 2D Beam Profile and Spot Evolution */}
        <BeamProfileCanvas beamParams={beamParams} wavelength={wavelength} />
      </div>
    </div>
  );
}
