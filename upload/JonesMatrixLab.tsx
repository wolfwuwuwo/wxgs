"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Line, Text } from "@react-three/drei";
import * as THREE from "three";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  linearPolarizer,
  halfWavePlate,
  quarterWavePlate,
  wavePlate,
  rotator,
  faradayRotator,
  propagateThroughChain,
  propagateThroughChainStepByStep,
  analyzePolarization,
  polarizationEllipsePoints,
  getElementMatrix,
  stokesFromJones,
  degreeOfPolarization,
  jonesMatVec,
  HLP,
  VLP,
  LP45,
  LPn45,
  RCP,
  LCP,
  linearPolarization,
  type ElementType,
  type OpticalElement,
  type JonesVector,
  type JonesMatrix,
  type PropagationStep,
  ELEMENT_INFO,
  cAbs,
  cArg,
} from "@/lib/optics/jones-matrix";

const INPUT_STATES: Record<string, { label: string; jones: JonesVector }> = {
  HLP: { label: "水平线偏振", jones: HLP },
  VLP: { label: "垂直线偏振", jones: VLP },
  LP45: { label: "45°线偏振", jones: LP45 },
  LPn45: { label: "-45°线偏振", jones: LPn45 },
  RCP: { label: "右旋圆偏振", jones: RCP },
  LCP: { label: "左旋圆偏振", jones: LCP },
};

// Characteristic states on Poincaré sphere with colors
const POINCARE_STATES: { key: string; label: string; s: [number, number, number]; color: string }[] = [
  { key: "H", label: "H", s: [1, 0, 0], color: "#cc4444" },
  { key: "V", label: "V", s: [-1, 0, 0], color: "#8844cc" },
  { key: "+45", label: "+45°", s: [0, 1, 0], color: "#44aa44" },
  { key: "-45", label: "-45°", s: [0, -1, 0], color: "#aa8844" },
  { key: "RCP", label: "RCP", s: [0, 0, 1], color: "#4488aa" },
  { key: "LCP", label: "LCP", s: [0, 0, -1], color: "#cc8844" },
];

// ─── Helper: format complex number ─────────────────────────────────
function fmtComplex(c: [number, number], precision = 2): string {
  const [re, im] = c;
  if (Math.abs(im) < 1e-6) return re.toFixed(precision);
  if (Math.abs(re) < 1e-6) return `${im.toFixed(precision)}i`;
  const sign = im >= 0 ? "+" : "-";
  return `${re.toFixed(precision)}${sign}${Math.abs(im).toFixed(precision)}i`;
}

// ─── Helper: get polarization type name ────────────────────────────
function getPolTypeName(chi: number, handedness: number): string {
  if (Math.abs(chi) < 0.05) return "线偏振";
  if (Math.abs(Math.abs(chi) - Math.PI / 4) < 0.05)
    return `${handedness > 0 ? "右" : "左"}旋圆偏振`;
  return `${handedness > 0 ? "右" : "左"}旋椭圆偏振`;
}

// ─── Poincaré Sphere 3D (Enhanced) ────────────────────────────────
function PoincareSphere({
  inputStokes,
  outputStokes,
  chainSteps,
  animTime,
}: {
  inputStokes: [number, number, number, number];
  outputStokes: [number, number, number, number];
  chainSteps: PropagationStep[];
  animTime: number;
}) {
  const R = 1.5; // sphere radius
  const meshRef = useRef<THREE.Mesh>(null);

  // Normalize Stokes to Poincaré sphere surface
  const normStokes = (s: [number, number, number, number]): [number, number, number] => {
    const S0 = s[0];
    if (S0 < 1e-15) return [0, 0, 0];
    const norm = Math.sqrt(s[1] * s[1] + s[2] * s[2] + s[3] * s[3]);
    if (norm < 1e-15) return [0, 0, 0];
    return [s[1] / S0 * R, s[2] / S0 * R, s[3] / S0 * R];
  };

  const inputPt = normStokes(inputStokes);
  const outputPt = normStokes(outputStokes);

  // Chain trajectory points on Poincaré sphere with interpolated arcs
  const trajectoryPts = useMemo(() => {
    if (chainSteps.length < 2) return [];
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < chainSteps.length - 1; i++) {
      const from = normStokes(chainSteps[i].stokes);
      const to = normStokes(chainSteps[i + 1].stokes);
      const fromV = new THREE.Vector3(from[0], from[1], from[2]);
      const toV = new THREE.Vector3(to[0], to[1], to[2]);
      // Interpolate along great circle arc
      const steps = 30;
      for (let j = 0; j <= steps; j++) {
        const t = j / steps;
        const pt = new THREE.Vector3().lerpVectors(fromV, toV, t);
        // Project onto sphere surface
        const len = pt.length();
        if (len > 1e-6) pt.normalize().multiplyScalar(R);
        pts.push(pt);
      }
    }
    return pts;
  }, [chainSteps]);

  // Sphere wireframe circles
  const sphereCircles = useMemo(() => {
    const circles: THREE.Vector3[][] = [];
    const segments = 80;
    // 3 great circles: S1S2, S1S3, S2S3 planes
    for (let k = 0; k < 3; k++) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= segments; i++) {
        const angle = (2 * Math.PI * i) / segments;
        let x = 0, y = 0, z = 0;
        if (k === 0) { x = R * Math.cos(angle); y = R * Math.sin(angle); }
        else if (k === 1) { x = R * Math.cos(angle); z = R * Math.sin(angle); }
        else { y = R * Math.cos(angle); z = R * Math.sin(angle); }
        pts.push(new THREE.Vector3(x, y, z));
      }
      circles.push(pts);
    }
    return circles;
  }, []);

  // Animated output point position (pulsing glow)
  const outputPulse = useMemo(() => {
    return 0.06 + 0.015 * Math.sin(animTime * 3);
  }, [animTime]);

  return (
    <group>
      {/* Translucent sphere surface */}
      <mesh ref={meshRef}>
        <sphereGeometry args={[R, 48, 48]} />
        <meshPhysicalMaterial
          color="#f0f2f8"
          transparent
          opacity={0.08}
          roughness={0.3}
          metalness={0.0}
          side={THREE.FrontSide}
          depthWrite={false}
        />
      </mesh>

      {/* Great circles */}
      {sphereCircles.map((pts, i) => (
        <Line key={`gc-${i}`} points={pts} color="#c8ccd4" lineWidth={0.6} transparent opacity={0.35} />
      ))}

      {/* S1 axis (red) with arrowhead */}
      <Line
        points={[new THREE.Vector3(-R * 1.35, 0, 0), new THREE.Vector3(R * 1.35, 0, 0)]}
        color="#cc4444" lineWidth={1}
      />
      <mesh position={[R * 1.35, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <coneGeometry args={[0.04, 0.1, 8]} />
        <meshBasicMaterial color="#cc4444" />
      </mesh>
      <Text position={[R * 1.5, 0, 0]} fontSize={0.14} color="#cc4444" anchorX="center" anchorY="middle">
        S₁
      </Text>

      {/* S2 axis (green) with arrowhead */}
      <Line
        points={[new THREE.Vector3(0, -R * 1.35, 0), new THREE.Vector3(0, R * 1.35, 0)]}
        color="#44aa44" lineWidth={1}
      />
      <mesh position={[0, R * 1.35, 0]}>
        <coneGeometry args={[0.04, 0.1, 8]} />
        <meshBasicMaterial color="#44aa44" />
      </mesh>
      <Text position={[0, R * 1.5, 0]} fontSize={0.14} color="#44aa44" anchorX="center" anchorY="middle">
        S₂
      </Text>

      {/* S3 axis (teal) with arrowhead */}
      <Line
        points={[new THREE.Vector3(0, 0, -R * 1.35), new THREE.Vector3(0, 0, R * 1.35)]}
        color="#4488aa" lineWidth={1}
      />
      <mesh position={[0, 0, R * 1.35]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.04, 0.1, 8]} />
        <meshBasicMaterial color="#4488aa" />
      </mesh>
      <Text position={[0, 0, R * 1.55]} fontSize={0.14} color="#4488aa" anchorX="center" anchorY="middle">
        S₃
      </Text>

      {/* 6 characteristic polarization states - colored markers */}
      {POINCARE_STATES.map(({ key, label, s, color }) => (
        <group key={key}>
          <mesh position={[s[0] * R, s[1] * R, s[2] * R]}>
            <sphereGeometry args={[0.05, 12, 12]} />
            <meshBasicMaterial color={color} />
          </mesh>
          {/* Glow ring around characteristic states */}
          <mesh position={[s[0] * R, s[1] * R, s[2] * R]}>
            <ringGeometry args={[0.07, 0.09, 16]} />
            <meshBasicMaterial color={color} transparent opacity={0.4} side={THREE.DoubleSide} />
          </mesh>
          <Text
            position={[s[0] * R * 1.2, s[1] * R * 1.2, s[2] * R * 1.2]}
            fontSize={0.1}
            color={color}
            anchorX="center"
            anchorY="middle"
          >
            {label}
          </Text>
        </group>
      ))}

      {/* Great circle arcs connecting opposite states (H-V, +45/-45, RCP-LCP) */}
      {[
        { from: [1, 0, 0], to: [-1, 0, 0], color: "#cc444488" },
        { from: [0, 1, 0], to: [0, -1, 0], color: "#44aa4488" },
        { from: [0, 0, 1], to: [0, 0, -1], color: "#4488aa88" },
      ].map(({ from, to, color }, idx) => {
        const arcPts: THREE.Vector3[] = [];
        const fV = new THREE.Vector3(from[0] * R, from[1] * R, from[2] * R);
        const tV = new THREE.Vector3(to[0] * R, to[1] * R, to[2] * R);
        for (let i = 0; i <= 40; i++) {
          const t = i / 40;
          const pt = new THREE.Vector3().lerpVectors(fV, tV, t);
          const len = pt.length();
          if (len > 1e-6) pt.normalize().multiplyScalar(R);
          arcPts.push(pt);
        }
        return <Line key={`arc-${idx}`} points={arcPts} color={color.slice(0, 7)} lineWidth={0.5} transparent opacity={0.25} />;
      })}

      {/* Trajectory line on Poincaré sphere */}
      {trajectoryPts.length > 1 && (
        <Line points={trajectoryPts} color="#e8a838" lineWidth={2} />
      )}

      {/* Input state point (teal) */}
      <mesh position={[inputPt[0], inputPt[1], inputPt[2]]}>
        <sphereGeometry args={[0.07, 16, 16]} />
        <meshBasicMaterial color="#4488aa" />
      </mesh>

      {/* Output state point (red, pulsing) */}
      <mesh position={[outputPt[0], outputPt[1], outputPt[2]]}>
        <sphereGeometry args={[outputPulse, 16, 16]} />
        <meshBasicMaterial color="#cc4444" />
      </mesh>
      {/* Output glow ring */}
      <mesh position={[outputPt[0], outputPt[1], outputPt[2]]}>
        <ringGeometry args={[outputPulse + 0.02, outputPulse + 0.05, 24]} />
        <meshBasicMaterial color="#cc4444" transparent opacity={0.3 + 0.1 * Math.sin(animTime * 3)} side={THREE.DoubleSide} />
      </mesh>

      {/* Intermediate step markers with numbers */}
      {chainSteps.slice(1, -1).map((step, i) => {
        const [sx, sy, sz] = normStokes(step.stokes);
        return (
          <group key={`step-${i}`}>
            <mesh position={[sx, sy, sz]}>
              <sphereGeometry args={[0.04, 10, 10]} />
              <meshBasicMaterial color="#e8a838" />
            </mesh>
            <Text
              position={[sx * 1.1, sy * 1.1, sz * 1.1]}
              fontSize={0.07}
              color="#e8a838"
              anchorX="center"
              anchorY="middle"
            >
              {`${i + 1}`}
            </Text>
          </group>
        );
      })}

      {/* Coordinate lines from origin to output point */}
      {outputPt[0] !== 0 && (
        <Line
          points={[new THREE.Vector3(0, 0, 0), new THREE.Vector3(outputPt[0], 0, 0)]}
          color="#cc4444" lineWidth={0.4} transparent opacity={0.3} dashed dashSize={0.04} gapSize={0.03}
        />
      )}
      {outputPt[1] !== 0 && (
        <Line
          points={[new THREE.Vector3(outputPt[0], 0, 0), new THREE.Vector3(outputPt[0], outputPt[1], 0)]}
          color="#44aa44" lineWidth={0.4} transparent opacity={0.3} dashed dashSize={0.04} gapSize={0.03}
        />
      )}
      {outputPt[2] !== 0 && (
        <Line
          points={[new THREE.Vector3(outputPt[0], outputPt[1], 0), new THREE.Vector3(outputPt[0], outputPt[1], outputPt[2])]}
          color="#4488aa" lineWidth={0.4} transparent opacity={0.3} dashed dashSize={0.04} gapSize={0.03}
        />
      )}
    </group>
  );
}

// ─── E-field 3D Helix (Enhanced with animation) ───────────────────
function EFieldHelix({
  jones,
  showEx,
  showEy,
  showComposite,
  animTime,
  chainSteps,
}: {
  jones: JonesVector;
  showEx: boolean;
  showEy: boolean;
  showComposite: boolean;
  animTime: number;
  chainSteps: PropagationStep[];
}) {
  const groupRef = useRef<THREE.Group>(null);

  const { helixLine, exLine, eyLine, propagationAxis, tipIndex } = useMemo(() => {
    const [Ex, Ey] = jones;
    const numPts = 300;
    const zLen = 5;
    const scale = 1.2;

    const helixPts: THREE.Vector3[] = [];
    const exPts: THREE.Vector3[] = [];
    const eyPts: THREE.Vector3[] = [];

    for (let i = 0; i <= numPts; i++) {
      const t = (i / numPts) * zLen;
      const phase = (i / numPts) * Math.PI * 8; // 4 full cycles
      const exVal = scale * (Ex[0] * Math.cos(phase) - Ex[1] * Math.sin(phase));
      const eyVal = scale * (Ey[0] * Math.cos(phase) - Ey[1] * Math.sin(phase));
      const z = t - zLen / 2;
      helixPts.push(new THREE.Vector3(exVal, eyVal, z));
      exPts.push(new THREE.Vector3(exVal, 0, z));
      eyPts.push(new THREE.Vector3(0, eyVal, z));
    }

    return {
      helixLine: helixPts,
      exLine: exPts,
      eyLine: eyPts,
      propagationAxis: [
        new THREE.Vector3(0, 0, -zLen / 2 - 0.5),
        new THREE.Vector3(0, 0, zLen / 2 + 0.5),
      ] as THREE.Vector3[],
      tipIndex: numPts,
    };
  }, [jones]);

  // Animated moving tip position
  const movingTipPhase = animTime * 2;
  const tipZ = ((movingTipPhase % 5) / 5) * 5 - 2.5;
  const [Ex, Ey] = jones;
  const scale = 1.2;
  const tipExVal = scale * (Ex[0] * Math.cos(movingTipPhase * Math.PI * 8 / 5) - Ex[1] * Math.sin(movingTipPhase * Math.PI * 8 / 5));
  const tipEyVal = scale * (Ey[0] * Math.cos(movingTipPhase * Math.PI * 8 / 5) - Ey[1] * Math.sin(movingTipPhase * Math.PI * 8 / 5));

  // Intermediate chain state markers along z-axis
  const chainMarkers = useMemo(() => {
    if (chainSteps.length <= 2) return [];
    const zLen = 5;
    const markers: { z: number; jones: JonesVector; stepIdx: number }[] = [];
    const innerSteps = chainSteps.slice(1, -1);
    innerSteps.forEach((step, i) => {
      const z = -zLen / 2 + ((i + 1) / (chainSteps.length - 1)) * zLen;
      markers.push({ z, jones: step.jones, stepIdx: i + 1 });
    });
    return markers;
  }, [chainSteps]);

  return (
    <group ref={groupRef}>
      {/* Propagation axis */}
      <Line points={propagationAxis} color="#d4d8e0" lineWidth={0.5} />
      <Text position={[0, 0, propagationAxis[1].z + 0.25]} fontSize={0.12} color="#6b7280" anchorX="center">
        z (传播方向)
      </Text>

      {/* Semi-transparent projection plane for Ex-z */}
      {showEx && (
        <mesh position={[0, 0, 0]} rotation={[0, 0, 0]}>
          <planeGeometry args={[3, 5]} />
          <meshBasicMaterial color="#cc4444" transparent opacity={0.02} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      )}

      {/* Ex component (horizontal plane) */}
      {showEx && (
        <Line points={exLine} color="#cc4444" lineWidth={1.2} transparent opacity={0.7} />
      )}

      {/* Ey component (vertical plane) */}
      {showEy && (
        <Line points={eyLine} color="#44aa44" lineWidth={1.2} transparent opacity={0.7} />
      )}

      {/* Composite E vector helix */}
      {showComposite && (
        <Line points={helixLine} color="#2d3142" lineWidth={2} />
      )}

      {/* E vector arrows at intervals */}
      {showComposite && Array.from({ length: 30 }, (_, i) => {
        const idx = Math.round((i / 30) * 300);
        if (idx >= helixLine.length) return null;
        const pt = helixLine[idx];
        return (
          <Line
            key={`evec-${i}`}
            points={[new THREE.Vector3(0, 0, pt.z), pt]}
            color="#2d3142"
            lineWidth={0.3}
            transparent
            opacity={0.12}
          />
        );
      })}

      {/* Moving E-field tip indicator */}
      {showComposite && (
        <group>
          <mesh position={[tipExVal, tipEyVal, tipZ]}>
            <sphereGeometry args={[0.05, 12, 12]} />
            <meshBasicMaterial color="#cc4444" />
          </mesh>
          <Line
            points={[new THREE.Vector3(0, 0, tipZ), new THREE.Vector3(tipExVal, tipEyVal, tipZ)]}
            color="#cc4444"
            lineWidth={1.5}
          />
        </group>
      )}

      {/* Ex projection dashed line to tip */}
      {showEx && showComposite && (
        <Line
          points={[new THREE.Vector3(tipExVal, 0, tipZ), new THREE.Vector3(tipExVal, tipEyVal, tipZ)]}
          color="#cc4444" lineWidth={0.5} transparent opacity={0.3} dashed dashSize={0.05} gapSize={0.03}
        />
      )}
      {showEy && showComposite && (
        <Line
          points={[new THREE.Vector3(0, tipEyVal, tipZ), new THREE.Vector3(tipExVal, tipEyVal, tipZ)]}
          color="#44aa44" lineWidth={0.5} transparent opacity={0.3} dashed dashSize={0.05} gapSize={0.03}
        />
      )}

      {/* Intermediate chain state markers along z */}
      {chainMarkers.map(({ z, jones: stepJones, stepIdx }) => {
        const [sEx, sEy] = stepJones;
        const sExVal = scale * cAbs(sEx) * 0.5;
        const sEyVal = scale * cAbs(sEy) * 0.5;
        return (
          <group key={`chain-marker-${stepIdx}`}>
            {/* Small cross-section ellipse at this z position */}
            <mesh position={[0, 0, z]}>
              <ringGeometry args={[0.01, 0.015, 16]} />
              <meshBasicMaterial color="#e8a838" transparent opacity={0.5} side={THREE.DoubleSide} />
            </mesh>
            <Text position={[0.1, 0.1, z]} fontSize={0.06} color="#e8a838" anchorX="left">
              {`#${stepIdx}`}
            </Text>
          </group>
        );
      })}

      {/* Axis labels */}
      <Text position={[1.6, 0, -2.8]} fontSize={0.1} color="#cc4444" anchorX="center">
        Ex
      </Text>
      <Text position={[0, 1.6, -2.8]} fontSize={0.1} color="#44aa44" anchorX="center">
        Ey
      </Text>

      {/* Ex/Ey amplitude indicators */}
      {showEx && (
        <Line
          points={[new THREE.Vector3(0, 0, -2.5), new THREE.Vector3(scale * cAbs(Ex), 0, -2.5)]}
          color="#cc4444" lineWidth={2}
        />
      )}
      {showEy && (
        <Line
          points={[new THREE.Vector3(0, 0, -2.5), new THREE.Vector3(0, scale * cAbs(Ey), -2.5)]}
          color="#44aa44" lineWidth={2}
        />
      )}
    </group>
  );
}

// ─── Polarization Canvas (2D with animated trail) ──────────────────
function PolarizationCanvas({
  polarization,
  jones,
  label,
  size = 240,
  showVector = true,
  showTrail = true,
  animTime = 0,
}: {
  polarization: ReturnType<typeof analyzePolarization>;
  jones: JonesVector;
  label: string;
  size?: number;
  showVector?: boolean;
  showTrail?: boolean;
  animTime?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const phaseRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;

    let running = true;
    phaseRef.current = 0;

    const draw = () => {
      if (!running || !ctx) return;

      ctx.save();
      ctx.scale(dpr, dpr);

      const cx = size / 2;
      const cy = size / 2;
      const scaleF = size * 0.35;

      // Clear
      ctx.fillStyle = "#f8f9fb";
      ctx.fillRect(0, 0, size, size);

      // Grid
      ctx.strokeStyle = "#e0e3e8";
      ctx.lineWidth = 0.5;
      const gridSize = 20;
      for (let i = 0; i <= size; i += gridSize) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, size); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(size, i); ctx.stroke();
      }

      // Axes
      ctx.strokeStyle = "#9ca3af";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(10, cy); ctx.lineTo(size - 10, cy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, 10); ctx.lineTo(cx, size - 10); ctx.stroke();

      // Axis labels
      ctx.fillStyle = "#6b7280";
      ctx.font = "11px IBM Plex Sans";
      ctx.textAlign = "center";
      ctx.fillText("Ex", size - 16, cy - 6);
      ctx.fillText("Ey", cx + 12, 16);

      // Draw polarization ellipse
      const points = polarizationEllipsePoints(polarization, 200);
      const intensity = Math.sqrt(polarization.a ** 2 + polarization.b ** 2);
      const normScale = intensity > 0 ? scaleF / Math.max(intensity, 0.01) : scaleF;

      // Animated trail effect — gradient fade showing rotation direction
      if (showTrail && polarization.handedness !== 0) {
        const trailSteps = 8;
        const phaseOffset = phaseRef.current;
        for (let t = trailSteps; t >= 1; t--) {
          const offset = ((t / trailSteps) * 0.3 + phaseOffset) % 1.0;
          ctx.beginPath();
          const startIdx = Math.round(offset * 200) % 200;
          // Draw partial arc (60% of ellipse)
          const arcLen = Math.round(200 * 0.6);
          for (let i = 0; i <= arcLen; i++) {
            const idx = (startIdx + i) % 200;
            const p = points[idx];
            const x = cx + p.x * normScale;
            const y = cy - p.y * normScale;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          const alpha = 0.02 + 0.015 * (trailSteps - t);
          ctx.strokeStyle = `rgba(26, 26, 46, ${alpha})`;
          ctx.lineWidth = 1 + (trailSteps - t) * 0.3;
          ctx.stroke();
        }
      }

      // Ellipse fill
      ctx.beginPath();
      points.forEach((p, i) => {
        const x = cx + p.x * normScale;
        const y = cy - p.y * normScale;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.fillStyle = "rgba(26, 26, 46, 0.04)";
      ctx.fill();

      // Ellipse stroke
      ctx.beginPath();
      points.forEach((p, i) => {
        const x = cx + p.x * normScale;
        const y = cy - p.y * normScale;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.strokeStyle = "#1a1a2e";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Direction arrows on ellipse (multiple)
      if (polarization.handedness !== 0 && showTrail) {
        const arrowPositions = [40, 90, 140];
        for (const arrowIdx of arrowPositions) {
          const nextIdx = arrowIdx + 3;
          if (arrowIdx < points.length && nextIdx < points.length) {
            const ax = cx + points[arrowIdx].x * normScale;
            const ay = cy - points[arrowIdx].y * normScale;
            const bx = cx + points[nextIdx].x * normScale;
            const by = cy - points[nextIdx].y * normScale;
            const angle = Math.atan2(by - ay, bx - ax);
            const headLen = 5;
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(ax - headLen * Math.cos(angle - 0.4), ay - headLen * Math.sin(angle - 0.4));
            ctx.moveTo(ax, ay);
            ctx.lineTo(ax - headLen * Math.cos(angle + 0.4), ay - headLen * Math.sin(angle + 0.4));
            ctx.strokeStyle = "#cc0000";
            ctx.lineWidth = 1.2;
            ctx.stroke();
          }
        }
      }

      // Animated E-field vector (rotating)
      if (showVector && showTrail) {
        const [Ex, Ey] = jones;
        const animPhase = phaseRef.current * Math.PI * 2;
        const exVal = Ex[0] * Math.cos(animPhase) - Ex[1] * Math.sin(animPhase);
        const eyVal = Ey[0] * Math.cos(animPhase) - Ey[1] * Math.sin(animPhase);
        const vx = cx + exVal * normScale;
        const vy = cy - eyVal * normScale;

        // Vector line
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(vx, vy);
        ctx.strokeStyle = "#cc4444";
        ctx.lineWidth = 2;
        ctx.stroke();

        // Vector tip dot
        ctx.beginPath();
        ctx.arc(vx, vy, 3, 0, Math.PI * 2);
        ctx.fillStyle = "#cc4444";
        ctx.fill();

        // Fading trail of past positions
        const trailLen = 15;
        for (let t = 1; t <= trailLen; t++) {
          const pastPhase = animPhase - t * 0.12;
          const pex = Ex[0] * Math.cos(pastPhase) - Ex[1] * Math.sin(pastPhase);
          const pey = Ey[0] * Math.cos(pastPhase) - Ey[1] * Math.sin(pastPhase);
          const px = cx + pex * normScale;
          const py = cy - pey * normScale;
          ctx.beginPath();
          ctx.arc(px, py, 1.5, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(204, 68, 68, ${0.4 * (1 - t / trailLen)})`;
          ctx.fill();
        }
      } else if (showVector) {
        // Static E-field vector arrows
        const numArrows = 12;
        for (let i = 0; i < numArrows; i++) {
          const t = (2 * Math.PI * i) / numArrows;
          const idx = Math.round((t / (2 * Math.PI)) * 200) % 200;
          if (idx < points.length) {
            const x0 = cx + points[idx].x * normScale;
            const y0 = cy - points[idx].y * normScale;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(x0, y0);
            ctx.strokeStyle = "rgba(107, 114, 128, 0.15)";
            ctx.lineWidth = 0.6;
            ctx.stroke();
          }
        }
      }

      // Handedness indicator
      if (polarization.handedness !== 0) {
        const dir = polarization.handedness > 0 ? "R" : "L";
        ctx.fillStyle = polarization.handedness > 0 ? "#4488aa" : "#cc4444";
        ctx.font = "10px IBM Plex Sans";
        ctx.textAlign = "right";
        ctx.fillText(dir === "R" ? "右旋 ↻" : "左旋 ↺", size - 8, size - 6);
      }

      // Label
      ctx.fillStyle = "#2d3142";
      ctx.font = "12px IBM Plex Sans";
      ctx.textAlign = "left";
      ctx.fillText(label, 8, size - 6);

      ctx.restore();

      // Advance phase for animation
      phaseRef.current += 0.015;
      if (phaseRef.current > 1) phaseRef.current -= 1;

      animRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      running = false;
      cancelAnimationFrame(animRef.current);
    };
  }, [polarization, jones, label, size, showVector, showTrail]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size }}
      className="border border-[#d4d8e0]"
    />
  );
}

// ─── Element Card ───────────────────────────────────────────────────
function ElementCard({
  element,
  onAngleChange,
  onRemove,
}: {
  element: OpticalElement;
  onAngleChange: (id: string, angle: number) => void;
  onRemove: (id: string) => void;
}) {
  const info = ELEMENT_INFO[element.type];
  const isFaraday = element.type === "faraday";
  return (
    <div className={`bg-white border rounded p-2.5 ${isFaraday ? "border-[#cc4444] bg-[#fff8f8]" : "border-[#d4d8e0]"}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${isFaraday ? "bg-[#fde8e8] text-[#cc4444]" : "bg-[#edf0f5] text-[#4a4a5a]"}`} style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
            {info.symbol}
          </span>
          <span className="text-[12px] text-[#2d3142]">{info.name}</span>
          {isFaraday && (
            <span className="text-[8px] bg-[#cc4444] text-white px-1 py-0 rounded">非互易</span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-5 w-5 p-0 text-[#9ca3af] hover:text-[#dc2626]"
          onClick={() => onRemove(element.id)}
        >
          ×
        </Button>
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-[#6b7280]">角度 θ</span>
          <span className="text-[10px] text-[#6b7280] mono-digits" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
            {element.angle.toFixed(1)}°
          </span>
        </div>
        <Slider
          value={[element.angle]}
          onValueChange={([v]) => onAngleChange(element.id, v)}
          min={-180}
          max={180}
          step={0.5}
        />
        {isFaraday && (
          <p className="text-[9px] text-[#cc4444] mt-1">⚠ 法拉第旋转器：反向传播时旋转方向不变（非互易）</p>
        )}
      </div>
    </div>
  );
}

// ─── Chain Step Table (Enhanced with Jones vectors and DOP bars) ───
function ChainStepTable({ steps }: { steps: PropagationStep[] }) {
  return (
    <div className="bg-white border border-[#d4d8e0] rounded overflow-hidden">
      <table className="w-full text-[10px]">
        <thead>
          <tr className="bg-[#f8f9fb] border-b border-[#d4d8e0]">
            <th className="px-1.5 py-1.5 text-left text-[#6b7280] font-medium">步骤</th>
            <th className="px-1.5 py-1.5 text-left text-[#6b7280] font-medium">元件</th>
            <th className="px-1.5 py-1.5 text-left text-[#6b7280] font-medium">Jones矢量</th>
            <th className="px-1.5 py-1.5 text-right text-[#6b7280] font-medium">S₁</th>
            <th className="px-1.5 py-1.5 text-right text-[#6b7280] font-medium">S₂</th>
            <th className="px-1.5 py-1.5 text-right text-[#6b7280] font-medium">S₃</th>
            <th className="px-1.5 py-1.5 text-center text-[#6b7280] font-medium">DOP</th>
            <th className="px-1.5 py-1.5 text-left text-[#6b7280] font-medium">类型</th>
          </tr>
        </thead>
        <tbody>
          {steps.map((step, i) => {
            const elemInfo = step.element ? ELEMENT_INFO[step.element.type] : null;
            const polType = getPolTypeName(step.analysis.chi, step.analysis.handedness);
            return (
              <tr key={i} className={`${i % 2 === 0 ? "" : "bg-[#fafbfc]"} ${step.element?.type === "faraday" ? "bg-[#fff8f8]" : ""}`}>
                <td className="px-1.5 py-1 text-[#1a1a2e]">
                  {step.stepIndex === -1 ? "入射" : `${step.stepIndex + 1}`}
                </td>
                <td className="px-1.5 py-1 text-[#2d3142]">
                  {elemInfo ? (
                    <span className={step.element!.type === "faraday" ? "text-[#cc4444]" : ""}>
                      {elemInfo.symbol} {step.element!.angle.toFixed(1)}°
                    </span>
                  ) : "—"}
                </td>
                <td className="px-1.5 py-1 text-[#4a4a5a]" style={{ fontFamily: "var(--font-ibm-plex-mono)", fontSize: "8px" }}>
                  [{fmtComplex(step.jones[0], 2)}, {fmtComplex(step.jones[1], 2)}]
                </td>
                <td className="px-1.5 py-1 text-right mono-digits" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
                  {step.stokes[1].toFixed(3)}
                </td>
                <td className="px-1.5 py-1 text-right mono-digits" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
                  {step.stokes[2].toFixed(3)}
                </td>
                <td className="px-1.5 py-1 text-right mono-digits" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
                  {step.stokes[3].toFixed(3)}
                </td>
                <td className="px-1.5 py-1">
                  <div className="flex items-center gap-1">
                    <div className="w-12 h-2 bg-[#edf0f5] rounded overflow-hidden">
                      <div
                        className="h-full rounded"
                        style={{
                          width: `${Math.min(step.dop * 100, 100)}%`,
                          backgroundColor: step.dop > 0.99 ? "#008800" : step.dop > 0.9 ? "#44aa44" : "#e8a838",
                        }}
                      />
                    </div>
                    <span className="mono-digits text-right w-8" style={{ fontFamily: "var(--font-ibm-plex-mono)", color: step.dop > 0.99 ? "#008800" : "#1a1a2e" }}>
                      {step.dop.toFixed(2)}
                    </span>
                  </div>
                </td>
                <td className="px-1.5 py-1 text-[9px] text-[#6b7280]">
                  {polType}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Faraday Non-Reciprocal Demo ───────────────────────────────────
function FaradayDemo({
  inputJones,
  elements,
}: {
  inputJones: JonesVector;
  elements: OpticalElement[];
}) {
  const hasFaraday = elements.some((e) => e.type === "faraday");

  const { forwardResult, reverseResult, forwardAnalysis, reverseAnalysis } = useMemo(() => {
    const forward = propagateThroughChain(inputJones, elements);
    const forwardStokes = stokesFromJones(forward);

    // Reverse propagation: reverse element order, and for Faraday rotators,
    // the rotation does NOT reverse (non-reciprocal)
    const reversedElements = [...elements].reverse().map((e) => ({
      ...e,
      // For regular rotator: reverse the angle (reciprocal)
      // For Faraday: keep the same angle (non-reciprocal)
      angle: e.type === "faraday" ? e.angle : -e.angle,
    }));
    const reverse = propagateThroughChain(forward, reversedElements);
    const reverseStokes = stokesFromJones(reverse);

    return {
      forwardResult: forward,
      reverseResult: reverse,
      forwardAnalysis: analyzePolarization(forward),
      reverseAnalysis: analyzePolarization(reverse),
      forwardStokes,
      reverseStokes,
    };
  }, [inputJones, elements]);

  if (!hasFaraday) return null;

  const isIdentical =
    Math.abs(forwardAnalysis.psi - reverseAnalysis.psi) < 0.01 &&
    Math.abs(forwardAnalysis.chi - reverseAnalysis.chi) < 0.01;

  return (
    <div className="bg-[#fff8f8] border border-[#cc4444] rounded p-2.5 space-y-2">
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] bg-[#cc4444] text-white px-1.5 py-0.5 rounded font-medium">非互易演示</span>
        <span className="text-[10px] text-[#cc4444]">法拉第旋转器正向 vs 反向传播</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-white border border-[#f0d0d0] rounded p-2">
          <div className="text-[9px] text-[#6b7280] mb-1">正向传播 →</div>
          <div className="text-[10px] text-[#1a1a2e]" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
            ψ = {(forwardAnalysis.psi * 180 / Math.PI).toFixed(1)}°
          </div>
          <div className="text-[10px] text-[#1a1a2e]" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
            χ = {(forwardAnalysis.chi * 180 / Math.PI).toFixed(1)}°
          </div>
          <div className="text-[9px] text-[#6b7280]">{getPolTypeName(forwardAnalysis.chi, forwardAnalysis.handedness)}</div>
        </div>
        <div className="bg-white border border-[#f0d0d0] rounded p-2">
          <div className="text-[9px] text-[#6b7280] mb-1">← 反向传播</div>
          <div className="text-[10px] text-[#1a1a2e]" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
            ψ = {(reverseAnalysis.psi * 180 / Math.PI).toFixed(1)}°
          </div>
          <div className="text-[10px] text-[#1a1a2e]" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
            χ = {(reverseAnalysis.chi * 180 / Math.PI).toFixed(1)}°
          </div>
          <div className="text-[9px] text-[#6b7280]">{getPolTypeName(reverseAnalysis.chi, reverseAnalysis.handedness)}</div>
        </div>
      </div>
      {!isIdentical && (
        <div className="text-[9px] text-[#cc4444] bg-[#fff0f0] rounded px-2 py-1">
          ⚠ 正向与反向传播结果不同 — 非互易效应！法拉第旋转器反向传播时旋转方向不变，而普通旋光器会反转。
        </div>
      )}
      {isIdentical && elements.some(e => e.type === "faraday") && (
        <div className="text-[9px] text-[#008800] bg-[#f0fff0] rounded px-2 py-1">
          ✓ 当前配置下正反向结果恰好相同（可能需要调整角度以观察差异）
        </div>
      )}
    </div>
  );
}

// ─── Jones Matrix Display ──────────────────────────────────────────
function JonesMatrixDisplay({
  elements,
}: {
  elements: OpticalElement[];
}) {
  if (elements.length === 0) return null;

  return (
    <div className="bg-white border border-[#d4d8e0] rounded p-2.5 space-y-2">
      <div className="text-[10px] text-[#6b7280] uppercase tracking-wider font-medium" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
        琼斯矩阵链
      </div>
      <div className="space-y-1.5">
        {elements.map((elem, i) => {
          const M = getElementMatrix(elem);
          const info = ELEMENT_INFO[elem.type];
          return (
            <div key={elem.id} className={`text-[8px] p-1.5 rounded ${elem.type === "faraday" ? "bg-[#fff8f8] border border-[#f0d0d0]" : "bg-[#f8f9fb]"}`}>
              <div className="flex items-center gap-1 mb-1">
                <span className={`font-mono px-1 rounded ${elem.type === "faraday" ? "bg-[#fde8e8] text-[#cc4444]" : "bg-[#edf0f5] text-[#4a4a5a]"}`}>
                  {info.symbol}
                </span>
                <span className="text-[9px] text-[#4a4a5a]">{elem.angle.toFixed(1)}°</span>
              </div>
              <div style={{ fontFamily: "var(--font-ibm-plex-mono)" }} className="text-[#4a4a5a]">
                <div>[{fmtComplex(M[0][0], 3)}, {fmtComplex(M[0][1], 3)}]</div>
                <div>[{fmtComplex(M[1][0], 3)}, {fmtComplex(M[1][1], 3)}]</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Animation Time Provider ───────────────────────────────────────
function AnimationTimeProvider({ children }: { children: (time: number) => React.ReactNode }) {
  const [time, setTime] = useState(0);
  const frameRef = useRef<number>(0);

  useEffect(() => {
    let running = true;
    const animate = () => {
      if (!running) return;
      setTime((t) => t + 0.016);
      frameRef.current = requestAnimationFrame(animate);
    };
    animate();
    return () => {
      running = false;
      cancelAnimationFrame(frameRef.current);
    };
  }, []);

  return <>{children(time)}</>;
}

let nextElementId = 1;

export default function JonesMatrixLab() {
  const [inputState, setInputState] = useState("LP45");
  const [elements, setElements] = useState<OpticalElement[]>([]);
  const [addingType, setAddingType] = useState<ElementType>("polarizer");
  const [showEx, setShowEx] = useState(true);
  const [showEy, setShowEy] = useState(true);
  const [showComposite, setShowComposite] = useState(true);
  const [viewTab, setViewTab] = useState<"ellipse" | "poincare" | "efield">("ellipse");

  const inputJones = INPUT_STATES[inputState]?.jones || LP45;
  const outputJones = useMemo(
    () => propagateThroughChain(inputJones, elements),
    [inputJones, elements]
  );
  const inputPol = useMemo(() => analyzePolarization(inputJones), [inputJones]);
  const outputPol = useMemo(() => analyzePolarization(outputJones), [outputJones]);

  // Step-by-step propagation
  const chainSteps = useMemo(
    () => propagateThroughChainStepByStep(inputJones, elements),
    [inputJones, elements]
  );

  // Stokes parameters
  const inputStokes = useMemo(() => stokesFromJones(inputJones), [inputJones]);
  const outputStokes = useMemo(() => stokesFromJones(outputJones), [outputJones]);
  const outputDOP = useMemo(() => degreeOfPolarization(outputStokes), [outputStokes]);

  const addElement = useCallback(() => {
    const newElement: OpticalElement = {
      id: `elem-${nextElementId++}`,
      type: addingType,
      angle: 0,
      retardation: addingType === "waveplate" ? 90 : undefined,
      label: ELEMENT_INFO[addingType].name,
    };
    setElements((prev) => [...prev, newElement]);
  }, [addingType]);

  const removeElement = useCallback((id: string) => {
    setElements((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const updateAngle = useCallback((id: string, angle: number) => {
    setElements((prev) =>
      prev.map((e) => (e.id === id ? { ...e, angle } : e))
    );
  }, []);

  // Optical path schematic canvas
  const pathCanvasRef = useRef<HTMLCanvasElement>(null);
  const drawOpticalPath = useCallback(() => {
    const canvas = pathCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = 80 * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = 80;

    ctx.fillStyle = "#f8f9fb";
    ctx.fillRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = "#ebeef2";
    ctx.lineWidth = 0.5;
    for (let x = 0; x < w; x += 15) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = 0; y < h; y += 15) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    // Optical axis
    ctx.strokeStyle = "#9ca3af";
    ctx.lineWidth = 0.8;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(20, h / 2);
    ctx.lineTo(w - 20, h / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Input arrow
    ctx.strokeStyle = "#1a1a2e";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(20, h / 2);
    ctx.lineTo(50, h / 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(50, h / 2);
    ctx.lineTo(44, h / 2 - 4);
    ctx.moveTo(50, h / 2);
    ctx.lineTo(44, h / 2 + 4);
    ctx.stroke();

    ctx.fillStyle = "#2d3142";
    ctx.font = "10px IBM Plex Sans";
    ctx.textAlign = "center";
    ctx.fillText("入射", 35, h / 2 - 10);

    const elemSpacing = elements.length > 0 ? Math.min(120, (w - 140) / (elements.length + 1)) : 120;
    const startX = 80;

    elements.forEach((elem, i) => {
      const x = startX + i * elemSpacing;
      const info = ELEMENT_INFO[elem.type];

      ctx.save();
      ctx.translate(x, h / 2);

      switch (elem.type) {
        case "polarizer": {
          ctx.strokeStyle = "#4a4a5a";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(0, -25);
          ctx.lineTo(0, 25);
          ctx.stroke();
          ctx.lineWidth = 0.8;
          for (let dy = -20; dy <= 20; dy += 6) {
            ctx.beginPath();
            ctx.moveTo(-4, dy + 4);
            ctx.lineTo(4, dy - 4);
            ctx.stroke();
          }
          if (elem.angle !== 0) {
            ctx.save();
            ctx.rotate((elem.angle * Math.PI) / 180);
            ctx.strokeStyle = "#cc0000";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, -25);
            ctx.lineTo(0, 25);
            ctx.stroke();
            ctx.restore();
          }
          break;
        }
        case "hwp":
        case "qwp":
        case "waveplate": {
          ctx.strokeStyle = "#4a4a5a";
          ctx.lineWidth = 1.5;
          ctx.strokeRect(-4, -22, 8, 44);
          ctx.save();
          ctx.rotate((elem.angle * Math.PI) / 180);
          ctx.strokeStyle = elem.type === "hwp" ? "#0066cc" : "#008800";
          ctx.lineWidth = 1.2;
          ctx.setLineDash([3, 2]);
          ctx.beginPath();
          ctx.moveTo(0, -20);
          ctx.lineTo(0, 20);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();
          break;
        }
        case "rotator": {
          ctx.strokeStyle = "#4a4a5a";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(0, 0, 15, 0, Math.PI * 1.5);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(0, -15);
          ctx.lineTo(-4, -10);
          ctx.moveTo(0, -15);
          ctx.lineTo(5, -12);
          ctx.stroke();
          break;
        }
        case "faraday": {
          // Faraday: double circle (non-reciprocal symbol) with B-field arrow
          ctx.strokeStyle = "#cc4444";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(0, 0, 15, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(0, 0, 10, 0, Math.PI * 2);
          ctx.stroke();
          // B-field direction arrow (vertical, indicating magnetic field)
          ctx.beginPath();
          ctx.moveTo(0, -18);
          ctx.lineTo(0, 18);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(-3, 13);
          ctx.lineTo(0, 18);
          ctx.lineTo(3, 13);
          ctx.stroke();
          // B label
          ctx.fillStyle = "#cc4444";
          ctx.font = "bold 8px IBM Plex Sans";
          ctx.textAlign = "center";
          ctx.fillText("B", 6, -16);
          break;
        }
      }

      ctx.fillStyle = elem.type === "faraday" ? "#cc4444" : "#6b7280";
      ctx.font = "9px IBM Plex Sans";
      ctx.textAlign = "center";
      ctx.fillText(info.name, 0, -30);

      if (elem.angle !== 0) {
        ctx.fillStyle = "#9ca3af";
        ctx.font = "8px IBM Plex Mono";
        ctx.fillText(`${elem.angle.toFixed(1)}°`, 0, 40);
      }

      ctx.restore();

      if (i < elements.length - 1) {
        const nextX = startX + (i + 1) * elemSpacing;
        ctx.strokeStyle = "#1a1a2e";
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(x + 8, h / 2);
        ctx.lineTo(nextX - 8, h / 2);
        ctx.stroke();
      }
    });

    if (elements.length > 0) {
      const lastX = startX + (elements.length - 1) * elemSpacing + 8;
      ctx.strokeStyle = "#1a1a2e";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(lastX, h / 2);
      ctx.lineTo(w - 20, h / 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(w - 30, h / 2 - 4);
      ctx.lineTo(w - 20, h / 2);
      ctx.lineTo(w - 30, h / 2 + 4);
      ctx.stroke();
    }

    ctx.fillStyle = "#2d3142";
    ctx.font = "10px IBM Plex Sans";
    ctx.textAlign = "center";
    ctx.fillText("出射", w - 30, h / 2 - 10);
  }, [elements]);

  useEffect(() => {
    drawOpticalPath();
  }, [drawOpticalPath]);

  return (
    <div className="flex h-full">
      {/* Control Panel */}
      <div className="w-72 border-r border-[#d4d8e0] bg-[#f8f9fb] p-4 overflow-y-auto optics-panel shrink-0">
        <div className="space-y-4">
          {/* Input Polarization */}
          <div>
            <h3 className="text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider mb-2.5" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
              入射偏振态
            </h3>
            <Select value={inputState} onValueChange={setInputState}>
              <SelectTrigger className="h-8 text-[12px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(INPUT_STATES).map(([key, { label }]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Add Element */}
          <div className="border-t border-[#d4d8e0] pt-3">
            <h3 className="text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider mb-2.5" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
              添加光学元件
            </h3>
            <div className="flex gap-2">
              <Select value={addingType} onValueChange={(v) => setAddingType(v as ElementType)}>
                <SelectTrigger className="h-8 text-[12px] flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ELEMENT_INFO).map(([key, info]) => (
                    <SelectItem key={key} value={key}>
                      <span className={key === "faraday" ? "text-[#cc4444] font-medium" : ""}>
                        {info.symbol} — {info.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                onClick={addElement}
                className="h-8 px-3 bg-[#2d3142] hover:bg-[#3d4152] text-white text-[12px]"
              >
                添加
              </Button>
            </div>
          </div>

          {/* Element Chain */}
          <div className="border-t border-[#d4d8e0] pt-3">
            <h3 className="text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider mb-2.5" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
              元件链 ({elements.length})
            </h3>
            {elements.length === 0 ? (
              <p className="text-[11px] text-[#9ca3af] italic">
                点击"添加"按钮加入光学元件
              </p>
            ) : (
              <div className="space-y-2 max-h-56 overflow-y-auto optics-panel">
                {elements.map((elem) => (
                  <ElementCard
                    key={elem.id}
                    element={elem}
                    onAngleChange={updateAngle}
                    onRemove={removeElement}
                  />
                ))}
              </div>
            )}
            {elements.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="mt-2 w-full text-[11px] h-7 border-[#d4d8e0] text-[#6b7280]"
                onClick={() => setElements([])}
              >
                清除所有元件
              </Button>
            )}
          </div>

          {/* Faraday Non-Reciprocal Demo */}
          <FaradayDemo inputJones={inputJones} elements={elements} />

          {/* Jones Matrix Display */}
          <JonesMatrixDisplay elements={elements} />

          {/* Output Analysis */}
          <div className="border-t border-[#d4d8e0] pt-3">
            <h3 className="text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider mb-2.5" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
              出射偏振分析
            </h3>
            <div className="bg-white border border-[#d4d8e0] rounded p-2.5 space-y-1.5">
              <div className="flex justify-between">
                <span className="text-[10px] text-[#6b7280]">偏振类型</span>
                <span className="text-[11px] text-[#1a1a2e] mono-digits font-medium">
                  {getPolTypeName(outputPol.chi, outputPol.handedness)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[10px] text-[#6b7280]">方位角 ψ</span>
                <span className="text-[11px] text-[#1a1a2e] mono-digits">
                  {(outputPol.psi * 180 / Math.PI).toFixed(1)}°
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[10px] text-[#6b7280]">椭圆率角 χ</span>
                <span className="text-[11px] text-[#1a1a2e] mono-digits">
                  {(outputPol.chi * 180 / Math.PI).toFixed(1)}°
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[10px] text-[#6b7280]">偏振度 DOP</span>
                <span className="text-[11px] font-medium mono-digits" style={{ color: outputDOP > 0.99 ? "#008800" : "#1a1a2e" }}>
                  {outputDOP.toFixed(4)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-[#6b7280]">DOP</span>
                <div className="flex-1 h-2 bg-[#edf0f5] rounded overflow-hidden">
                  <div
                    className="h-full rounded transition-all duration-300"
                    style={{
                      width: `${Math.min(outputDOP * 100, 100)}%`,
                      backgroundColor: outputDOP > 0.99 ? "#008800" : outputDOP > 0.9 ? "#44aa44" : "#e8a838",
                    }}
                  />
                </div>
              </div>
              <div className="flex justify-between">
                <span className="text-[10px] text-[#6b7280]">Stokes S₁S₂S₃</span>
                <span className="text-[10px] text-[#1a1a2e] mono-digits">
                  {outputStokes[1].toFixed(2)}, {outputStokes[2].toFixed(2)}, {outputStokes[3].toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[10px] text-[#6b7280]">Jones矢量</span>
                <span className="text-[9px] text-[#1a1a2e] mono-digits" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
                  [{fmtComplex(outputJones[0], 2)}, {fmtComplex(outputJones[1], 2)}]
                </span>
              </div>
            </div>
          </div>

          {/* Chain Step Table */}
          {elements.length > 0 && (
            <div className="border-t border-[#d4d8e0] pt-3">
              <h3 className="text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider mb-2.5" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
                逐步传播
              </h3>
              <ChainStepTable steps={chainSteps} />
            </div>
          )}
        </div>
      </div>

      {/* Visualization */}
      <div className="flex-1 flex flex-col overflow-hidden bg-white">
        {/* Optical path schematic */}
        <div className="border-b border-[#d4d8e0] p-3 shrink-0">
          <div className="text-[10px] text-[#9ca3af] uppercase tracking-wider mb-1.5" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
            光路示意
          </div>
          <canvas
            ref={pathCanvasRef}
            className="w-full border border-[#d4d8e0] bg-[#f8f9fb]"
            style={{ height: 80 }}
          />
        </div>

        {/* View mode tabs */}
        <div className="border-b border-[#d4d8e0] bg-[#f8f9fb] px-3 py-1.5 flex items-center gap-2 shrink-0">
          {([
            { value: "ellipse" as const, label: "偏振椭圆" },
            { value: "poincare" as const, label: "邦加球" },
            { value: "efield" as const, label: "E场螺旋" },
          ]).map(({ value, label }) => (
            <Button
              key={value}
              variant={viewTab === value ? "default" : "outline"}
              size="sm"
              className={`h-6 text-[10px] px-3 ${viewTab === value ? "bg-[#2d3142] text-white" : "bg-white text-[#6b7280]"}`}
              onClick={() => setViewTab(value)}
            >
              {label}
            </Button>
          ))}
        </div>

        {/* Main visualization area */}
        <div className="flex-1 overflow-auto">
          {viewTab === "ellipse" && (
            <AnimationTimeProvider>
              {(animTime) => (
                <div className="flex items-center justify-center gap-6 p-4 h-full flex-wrap">
                  <div className="flex flex-col items-center">
                    <PolarizationCanvas
                      polarization={inputPol}
                      jones={inputJones}
                      label="入射偏振"
                      size={240}
                      showTrail
                      animTime={animTime}
                    />
                  </div>
                  <div className="flex flex-col items-center justify-center">
                    <svg width="60" height="24" viewBox="0 0 60 24">
                      <line x1="0" y1="12" x2="48" y2="12" stroke="#9ca3af" strokeWidth="1" />
                      <polygon points="48,8 56,12 48,16" fill="#9ca3af" />
                    </svg>
                    <span className="text-[10px] text-[#9ca3af] mt-1" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
                      {elements.length} 个元件
                    </span>
                  </div>
                  <div className="flex flex-col items-center">
                    <PolarizationCanvas
                      polarization={outputPol}
                      jones={outputJones}
                      label="出射偏振"
                      size={240}
                      showTrail
                      animTime={animTime}
                    />
                  </div>

                  {/* Intermediate polarization states */}
                  {chainSteps.length > 2 && (
                    <div className="w-full border-t border-[#d4d8e0] pt-3 mt-2">
                      <div className="text-[10px] text-[#6b7280] uppercase tracking-wider mb-2" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
                        中间偏振态
                      </div>
                      <div className="flex gap-3 overflow-x-auto pb-2">
                        {chainSteps.slice(1, -1).map((step, i) => (
                          <div key={i} className="flex flex-col items-center shrink-0">
                            <PolarizationCanvas
                              polarization={step.analysis}
                              jones={step.jones}
                              label={`${ELEMENT_INFO[step.element!.type].symbol} ${step.element!.angle.toFixed(0)}°`}
                              size={120}
                              showTrail
                              animTime={animTime}
                            />
                            <div className="text-[8px] text-[#6b7280] mt-1" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
                              DOP: {step.dop.toFixed(2)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </AnimationTimeProvider>
          )}

          {viewTab === "poincare" && (
            <AnimationTimeProvider>
              {(animTime) => (
                <div className="h-full relative">
                  <Canvas
                    camera={{ position: [3, 2, 3], fov: 45, near: 0.1, far: 100 }}
                    style={{ background: "#ffffff" }}
                    gl={{ antialias: true, alpha: false }}
                  >
                    <ambientLight intensity={0.7} />
                    <directionalLight position={[5, 8, 5]} intensity={0.3} />
                    <PoincareSphere
                      inputStokes={inputStokes}
                      outputStokes={outputStokes}
                      chainSteps={chainSteps}
                      animTime={animTime}
                    />
                    <OrbitControls
                      enableDamping
                      dampingFactor={0.1}
                      rotateSpeed={0.5}
                      zoomSpeed={0.8}
                      minDistance={2}
                      maxDistance={10}
                    />
                  </Canvas>
                  {/* Legend overlay */}
                  <div className="absolute top-2 right-2 bg-white/95 border border-[#d4d8e0] rounded px-2.5 py-1.5 shadow-sm">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-2.5 h-2.5 rounded-full bg-[#4488aa]" />
                      <span className="text-[10px] text-[#4a4a5a]">入射态</span>
                    </div>
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-2.5 h-2.5 rounded-full bg-[#cc4444]" />
                      <span className="text-[10px] text-[#4a4a5a]">出射态</span>
                    </div>
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-2.5 h-2.5 rounded-full bg-[#e8a838]" />
                      <span className="text-[10px] text-[#4a4a5a]">中间态</span>
                    </div>
                    <div className="border-t border-[#d4d8e0] mt-1 pt-1">
                      <p className="text-[9px] text-[#9ca3af]">拖拽旋转 · 滚轮缩放</p>
                    </div>
                  </div>
                  {/* Stokes readout */}
                  <div className="absolute bottom-2 left-2 bg-white/95 border border-[#d4d8e0] rounded px-2.5 py-1.5 shadow-sm">
                    <div className="text-[9px] text-[#6b7280] uppercase tracking-wider mb-1" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
                      出射 Stokes 参数
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <span className="text-[9px] text-[#cc4444]">S₁</span>
                        <span className="text-[10px] text-[#1a1a2e] ml-1 mono-digits" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
                          {outputStokes[1].toFixed(3)}
                        </span>
                      </div>
                      <div>
                        <span className="text-[9px] text-[#44aa44]">S₂</span>
                        <span className="text-[10px] text-[#1a1a2e] ml-1 mono-digits" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
                          {outputStokes[2].toFixed(3)}
                        </span>
                      </div>
                      <div>
                        <span className="text-[9px] text-[#4488aa]">S₃</span>
                        <span className="text-[10px] text-[#1a1a2e] ml-1 mono-digits" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
                          {outputStokes[3].toFixed(3)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </AnimationTimeProvider>
          )}

          {viewTab === "efield" && (
            <AnimationTimeProvider>
              {(animTime) => (
                <div className="h-full relative">
                  <Canvas
                    camera={{ position: [3, 2, 3], fov: 45, near: 0.1, far: 100 }}
                    style={{ background: "#ffffff" }}
                    gl={{ antialias: true, alpha: false }}
                  >
                    <ambientLight intensity={0.7} />
                    <directionalLight position={[5, 8, 5]} intensity={0.3} />
                    <EFieldHelix
                      jones={outputJones}
                      showEx={showEx}
                      showEy={showEy}
                      showComposite={showComposite}
                      animTime={animTime}
                      chainSteps={chainSteps}
                    />
                    <OrbitControls
                      enableDamping
                      dampingFactor={0.1}
                      rotateSpeed={0.5}
                      zoomSpeed={0.8}
                      minDistance={2}
                      maxDistance={15}
                    />
                  </Canvas>
                  {/* E-field component toggles */}
                  <div className="absolute top-2 right-2 bg-white/95 border border-[#d4d8e0] rounded px-2.5 py-2 shadow-sm space-y-1.5">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        checked={showEx}
                        onCheckedChange={(v) => setShowEx(!!v)}
                        className="border-[#cc4444] data-[state=checked]:bg-[#cc4444]"
                      />
                      <span className="text-[10px] text-[#cc4444] font-medium">Ex 分量</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        checked={showEy}
                        onCheckedChange={(v) => setShowEy(!!v)}
                        className="border-[#44aa44] data-[state=checked]:bg-[#44aa44]"
                      />
                      <span className="text-[10px] text-[#44aa44] font-medium">Ey 分量</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        checked={showComposite}
                        onCheckedChange={(v) => setShowComposite(!!v)}
                      />
                      <span className="text-[10px] text-[#2d3142] font-medium">合成螺旋</span>
                    </label>
                  </div>
                  {/* Jones vector readout */}
                  <div className="absolute bottom-2 left-2 bg-white/95 border border-[#d4d8e0] rounded px-2.5 py-1.5 shadow-sm">
                    <div className="text-[9px] text-[#6b7280] uppercase tracking-wider mb-1" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
                      出射 Jones 矢量
                    </div>
                    <div className="text-[9px]" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
                      <span className="text-[#cc4444]">Ex</span> = {fmtComplex(outputJones[0])}
                      <span className="mx-1.5 text-[#d4d8e0]">|</span>
                      <span className="text-[#44aa44]">Ey</span> = {fmtComplex(outputJones[1])}
                    </div>
                    <div className="text-[8px] text-[#9ca3af] mt-0.5">
                      |Ex| = {cAbs(outputJones[0]).toFixed(3)}  |Ey| = {cAbs(outputJones[1]).toFixed(3)}
                    </div>
                  </div>
                </div>
              )}
            </AnimationTimeProvider>
          )}
        </div>
      </div>
    </div>
  );
}
