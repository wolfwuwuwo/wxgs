"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Line, Text } from "@react-three/drei";
import * as THREE from "three";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  propagateThroughChain,
  propagateThroughChainStepByStep,
  analyzePolarization,
  polarizationEllipsePoints,
  getElementMatrix,
  stokesFromJones,
  degreeOfPolarization,
  HLP,
  VLP,
  LP45,
  LPn45,
  RCP,
  LCP,
  type ElementType,
  type OpticalElement,
  type JonesVector,
  type PropagationStep,
  ELEMENT_INFO,
  cAbs,
} from "@/lib/optics/jones-matrix";

// ─── Type alias for a full Jones vector (Ex, Ey each complex) ───────
type JonesVec2 = [JonesVector, JonesVector];

// ─── Input state presets ────────────────────────────────────────────
const INPUT_STATES: Record<string, { label: string; jones: JonesVec2 }> = {
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

// ─── Poincaré Sphere 3D ───────────────────────────────────────────
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
  const R = 1.5;
  const meshRef = useRef<THREE.Mesh>(null);

  const normStokes = (s: [number, number, number, number]): [number, number, number] => {
    const S0 = s[0];
    if (S0 < 1e-15) return [0, 0, 0];
    const norm = Math.sqrt(s[1] * s[1] + s[2] * s[2] + s[3] * s[3]);
    if (norm < 1e-15) return [0, 0, 0];
    return [(s[1] / S0) * R, (s[2] / S0) * R, (s[3] / S0) * R];
  };

  const inputPt = normStokes(inputStokes);
  const outputPt = normStokes(outputStokes);

  // Chain trajectory on Poincaré sphere with great circle interpolation
  const trajectoryPts = useMemo(() => {
    if (chainSteps.length < 2) return [];
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < chainSteps.length - 1; i++) {
      const from = normStokes(chainSteps[i].stokes);
      const to = normStokes(chainSteps[i + 1].stokes);
      const fromV = new THREE.Vector3(from[0], from[1], from[2]);
      const toV = new THREE.Vector3(to[0], to[1], to[2]);
      const steps = 30;
      for (let j = 0; j <= steps; j++) {
        const t = j / steps;
        const pt = new THREE.Vector3().lerpVectors(fromV, toV, t);
        const len = pt.length();
        if (len > 1e-6) pt.normalize().multiplyScalar(R);
        pts.push(pt);
      }
    }
    return pts;
  }, [chainSteps]);

  // Sphere wireframe great circles
  const sphereCircles = useMemo(() => {
    const circles: THREE.Vector3[][] = [];
    const segments = 80;
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

  const outputPulse = 0.06 + 0.015 * Math.sin(animTime * 3);

  return (
    <group>
      {/* Translucent sphere */}
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

      {/* S1 axis (red) */}
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

      {/* S2 axis (green) */}
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

      {/* S3 axis (teal) */}
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

      {/* 6 characteristic polarization state markers */}
      {POINCARE_STATES.map(({ key, label, s, color }) => (
        <group key={key}>
          <mesh position={[s[0] * R, s[1] * R, s[2] * R]}>
            <sphereGeometry args={[0.05, 12, 12]} />
            <meshBasicMaterial color={color} />
          </mesh>
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

      {/* Great circle arcs connecting opposite states */}
      {[
        { from: [1, 0, 0], to: [-1, 0, 0], color: "#cc4444" },
        { from: [0, 1, 0], to: [0, -1, 0], color: "#44aa44" },
        { from: [0, 0, 1], to: [0, 0, -1], color: "#4488aa" },
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
        return <Line key={`arc-${idx}`} points={arcPts} color={color} lineWidth={0.5} transparent opacity={0.25} />;
      })}

      {/* Trajectory line */}
      {trajectoryPts.length > 1 && (
        <Line points={trajectoryPts} color="#e8a838" lineWidth={2} />
      )}

      {/* Input state point (teal) */}
      <mesh position={[inputPt[0], inputPt[1], inputPt[2]]}>
        <sphereGeometry args={[0.07, 16, 16]} />
        <meshBasicMaterial color="#4488aa" />
      </mesh>
      <Text position={[inputPt[0] * 1.15, inputPt[1] * 1.15, inputPt[2] * 1.15]} fontSize={0.08} color="#4488aa" anchorX="center">
        入射
      </Text>

      {/* Output state point (red, pulsing) */}
      <mesh position={[outputPt[0], outputPt[1], outputPt[2]]}>
        <sphereGeometry args={[outputPulse, 16, 16]} />
        <meshBasicMaterial color="#cc4444" />
      </mesh>
      <mesh position={[outputPt[0], outputPt[1], outputPt[2]]}>
        <ringGeometry args={[outputPulse + 0.02, outputPulse + 0.05, 24]} />
        <meshBasicMaterial color="#cc4444" transparent opacity={0.3 + 0.1 * Math.sin(animTime * 3)} side={THREE.DoubleSide} />
      </mesh>
      <Text position={[outputPt[0] * 1.15, outputPt[1] * 1.15, outputPt[2] * 1.15]} fontSize={0.08} color="#cc4444" anchorX="center">
        出射
      </Text>

      {/* Intermediate step markers */}
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

      {/* Coordinate projection lines from origin to output */}
      {Math.abs(outputPt[0]) > 0.01 && (
        <Line
          points={[new THREE.Vector3(0, 0, 0), new THREE.Vector3(outputPt[0], 0, 0)]}
          color="#cc4444" lineWidth={0.4} transparent opacity={0.3} dashed dashSize={0.04} gapSize={0.03}
        />
      )}
      {Math.abs(outputPt[1]) > 0.01 && (
        <Line
          points={[new THREE.Vector3(outputPt[0], 0, 0), new THREE.Vector3(outputPt[0], outputPt[1], 0)]}
          color="#44aa44" lineWidth={0.4} transparent opacity={0.3} dashed dashSize={0.04} gapSize={0.03}
        />
      )}
      {Math.abs(outputPt[2]) > 0.01 && (
        <Line
          points={[new THREE.Vector3(outputPt[0], outputPt[1], 0), new THREE.Vector3(outputPt[0], outputPt[1], outputPt[2])]}
          color="#4488aa" lineWidth={0.4} transparent opacity={0.3} dashed dashSize={0.04} gapSize={0.03}
        />
      )}
    </group>
  );
}

// ─── E-field 3D Helix ──────────────────────────────────────────────
function EFieldHelix({
  jones,
  showEx,
  showEy,
  showComposite,
  animTime,
  chainSteps,
}: {
  jones: JonesVec2;
  showEx: boolean;
  showEy: boolean;
  showComposite: boolean;
  animTime: number;
  chainSteps: PropagationStep[];
}) {
  const groupRef = useRef<THREE.Group>(null);

  const { helixLine, exLine, eyLine, propagationAxis } = useMemo(() => {
    const [Ex, Ey] = jones;
    const numPts = 300;
    const zLen = 5;
    const scale = 1.2;

    const helixPts: THREE.Vector3[] = [];
    const exPts: THREE.Vector3[] = [];
    const eyPts: THREE.Vector3[] = [];

    for (let i = 0; i <= numPts; i++) {
      const t = (i / numPts) * zLen;
      const phase = (i / numPts) * Math.PI * 8;
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
    };
  }, [jones]);

  // Animated moving tip
  const movingTipPhase = animTime * 2;
  const tipZ = ((movingTipPhase % 5) / 5) * 5 - 2.5;
  const [Ex, Ey] = jones;
  const scale = 1.2;
  const tipExVal = scale * (Ex[0] * Math.cos((movingTipPhase * Math.PI * 8) / 5) - Ex[1] * Math.sin((movingTipPhase * Math.PI * 8) / 5));
  const tipEyVal = scale * (Ey[0] * Math.cos((movingTipPhase * Math.PI * 8) / 5) - Ey[1] * Math.sin((movingTipPhase * Math.PI * 8) / 5));

  // Intermediate chain state markers along z-axis
  const chainMarkers = useMemo(() => {
    if (chainSteps.length <= 2) return [];
    const zLen = 5;
    const markers: { z: number; jones: JonesVec2; stepIdx: number }[] = [];
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

      {/* Ex component */}
      {showEx && (
        <Line points={exLine} color="#cc4444" lineWidth={1.2} transparent opacity={0.7} />
      )}

      {/* Ey component */}
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

      {/* Projection dashed lines from tip to component planes */}
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
            <mesh position={[0, 0, z]}>
              <ringGeometry args={[0.01, 0.015, 16]} />
              <meshBasicMaterial color="#e8a838" transparent opacity={0.5} side={THREE.DoubleSide} />
            </mesh>
            {/* Cross-section indicator lines */}
            <Line
              points={[new THREE.Vector3(0, 0, z), new THREE.Vector3(sExVal, sEyVal, z)]}
              color="#e8a838" lineWidth={0.5} transparent opacity={0.4}
            />
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

      {/* Ex/Ey amplitude indicators at start */}
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
}: {
  polarization: ReturnType<typeof analyzePolarization>;
  jones: JonesVec2;
  label: string;
  size?: number;
  showVector?: boolean;
  showTrail?: boolean;
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

      // Polarization ellipse
      const points = polarizationEllipsePoints(polarization, 200);
      const intensity = Math.sqrt(polarization.a ** 2 + polarization.b ** 2);
      const normScale = intensity > 0 ? scaleF / Math.max(intensity, 0.01) : scaleF;

      // Animated trail
      if (showTrail && polarization.handedness !== 0) {
        const trailSteps = 8;
        const phaseOffset = phaseRef.current;
        for (let t = trailSteps; t >= 1; t--) {
          const offset = ((t / trailSteps) * 0.3 + phaseOffset) % 1.0;
          ctx.beginPath();
          const startIdx = Math.round(offset * 200) % 200;
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

      // Direction arrows on ellipse
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

        // Fading trail
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

      // Advance phase
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
  onRetardationChange,
  onRemove,
}: {
  element: OpticalElement;
  onAngleChange: (id: string, angle: number) => void;
  onRetardationChange: (id: string, retardation: number) => void;
  onRemove: (id: string) => void;
}) {
  const info = ELEMENT_INFO[element.type];
  const isFaraday = element.type === "faraday";
  const isWaveplate = element.type === "waveplate";
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
          <span className="text-[10px] text-[#6b7280]" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
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
        {isWaveplate && (
          <>
            <div className="flex items-center justify-between mt-1">
              <span className="text-[10px] text-[#6b7280]">相位延迟 δ</span>
              <span className="text-[10px] text-[#6b7280]" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
                {(element.retardation ?? 90).toFixed(1)}°
              </span>
            </div>
            <Slider
              value={[element.retardation ?? 90]}
              onValueChange={([v]) => onRetardationChange(element.id, v)}
              min={0}
              max={360}
              step={1}
            />
          </>
        )}
        {isFaraday && (
          <p className="text-[9px] text-[#cc4444] mt-1">⚠ 法拉第旋转器：反向传播时旋转方向不变（非互易）</p>
        )}
      </div>
    </div>
  );
}

// ─── Chain Step Table ───────────────────────────────────────────────
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
                <td className="px-1.5 py-1 text-right" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
                  {step.stokes[1].toFixed(3)}
                </td>
                <td className="px-1.5 py-1 text-right" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
                  {step.stokes[2].toFixed(3)}
                </td>
                <td className="px-1.5 py-1 text-right" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
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
                    <span className="text-right w-8" style={{ fontFamily: "var(--font-ibm-plex-mono)", color: step.dop > 0.99 ? "#008800" : "#1a1a2e" }}>
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
  inputJones: JonesVec2;
  elements: OpticalElement[];
}) {
  const hasFaraday = elements.some((e) => e.type === "faraday");

  const { forwardAnalysis, reverseAnalysis } = useMemo(() => {
    const forward = propagateThroughChain(inputJones, elements);

    // Reverse: reverse element order; Faraday keeps same angle, others negate
    const reversedElements = [...elements].reverse().map((e) => ({
      ...e,
      angle: e.type === "faraday" ? e.angle : -e.angle,
    }));
    const reverse = propagateThroughChain(forward, reversedElements);

    return {
      forwardAnalysis: analyzePolarization(forward),
      reverseAnalysis: analyzePolarization(reverse),
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
      {isIdentical && (
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
        {elements.map((elem) => {
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

// ─── Main Component ────────────────────────────────────────────────
let nextElementId = 1;

export default function JonesPolarizationLab({ onBack }: { onBack: () => void }) {
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

  const chainSteps = useMemo(
    () => propagateThroughChainStepByStep(inputJones, elements),
    [inputJones, elements]
  );

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
    setElements((prev) => prev.filter((el) => el.id !== id));
  }, []);

  const updateAngle = useCallback((id: string, angle: number) => {
    setElements((prev) =>
      prev.map((el) => (el.id === id ? { ...el, angle } : el))
    );
  }, []);

  const updateRetardation = useCallback((id: string, retardation: number) => {
    setElements((prev) =>
      prev.map((el) => (el.id === id ? { ...el, retardation } : el))
    );
  }, []);

  return (
    <AnimationTimeProvider>
      {(animTime) => (
        <div className="min-h-screen flex flex-col bg-[#FFFFFF]">
          {/* Header */}
          <div className="flex-shrink-0 flex items-center h-12 border-b border-[#d4d8e0] px-6">
            <button
              onClick={onBack}
              className="text-[12px] font-normal text-[#555] hover:text-[#1a1a2e] transition-colors bg-transparent border-none cursor-pointer flex items-center gap-1"
            >
              ← 返回
            </button>
            <span className="mx-3 text-[#d4d8e0]">|</span>
            <h1 className="text-[20px] font-semibold text-[#1a1a2e] m-0">
              偏振琼斯矩阵实验室
            </h1>
          </div>

          {/* Main content */}
          <div className="flex flex-1 min-h-0">
            {/* Left control panel */}
            <div className="w-80 flex-shrink-0 bg-[#f8f9fb] border-r border-[#d4d8e0] overflow-y-auto p-4 space-y-4">
              {/* Input state selector */}
              <div>
                <div className="text-[12px] font-semibold text-[#1a1a2e] mb-2 pb-1.5 border-b border-[#d4d8e0]">
                  输入偏振态
                </div>
                <Select value={inputState} onValueChange={setInputState}>
                  <SelectTrigger className="w-full h-8 text-[11px]">
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

              {/* Element chain */}
              <div>
                <div className="text-[12px] font-semibold text-[#1a1a2e] mb-2 pb-1.5 border-b border-[#d4d8e0]">
                  光学元件链
                </div>
                <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                  {elements.map((el) => (
                    <ElementCard
                      key={el.id}
                      element={el}
                      onAngleChange={updateAngle}
                      onRetardationChange={updateRetardation}
                      onRemove={removeElement}
                    />
                  ))}
                </div>

                {/* Add element */}
                <div className="mt-2 flex items-center gap-2">
                  <Select value={addingType} onValueChange={(v) => setAddingType(v as ElementType)}>
                    <SelectTrigger className="flex-1 h-7 text-[10px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(ELEMENT_INFO).map(([key, info]) => (
                        <SelectItem key={key} value={key}>
                          {info.symbol} {info.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[10px] px-3 border-[#d4d8e0] hover:bg-[#edf0f5]"
                    onClick={addElement}
                  >
                    + 添加
                  </Button>
                </div>
              </div>

              {/* View tabs */}
              <div>
                <div className="text-[12px] font-semibold text-[#1a1a2e] mb-2 pb-1.5 border-b border-[#d4d8e0]">
                  可视化视图
                </div>
                <div className="flex gap-1">
                  {([
                    { key: "ellipse", label: "偏振椭圆" },
                    { key: "poincare", label: "庞加莱球" },
                    { key: "efield", label: "电场螺旋" },
                  ] as const).map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => setViewTab(key)}
                      className={`flex-1 text-[10px] py-1.5 rounded border transition-colors ${
                        viewTab === key
                          ? "bg-[#2d3142] text-white border-[#2d3142]"
                          : "bg-white text-[#4a4a5a] border-[#d4d8e0] hover:bg-[#edf0f5]"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* E-field display options */}
              {(viewTab === "efield") && (
                <div>
                  <div className="text-[12px] font-semibold text-[#1a1a2e] mb-2 pb-1.5 border-b border-[#d4d8e0]">
                    电场分量
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="show-ex"
                        checked={showEx}
                        onCheckedChange={(v) => setShowEx(v === true)}
                      />
                      <Label htmlFor="show-ex" className="text-[11px] text-[#cc4444] cursor-pointer">Ex 分量 (红)</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="show-ey"
                        checked={showEy}
                        onCheckedChange={(v) => setShowEy(v === true)}
                      />
                      <Label htmlFor="show-ey" className="text-[11px] text-[#44aa44] cursor-pointer">Ey 分量 (绿)</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="show-composite"
                        checked={showComposite}
                        onCheckedChange={(v) => setShowComposite(v === true)}
                      />
                      <Label htmlFor="show-composite" className="text-[11px] text-[#2d3142] cursor-pointer">合电场 (黑)</Label>
                    </div>
                  </div>
                </div>
              )}

              {/* Output polarization info */}
              <div>
                <div className="text-[12px] font-semibold text-[#1a1a2e] mb-2 pb-1.5 border-b border-[#d4d8e0]">
                  输出偏振态
                </div>
                <div className="bg-white border border-[#d4d8e0] rounded p-2.5 space-y-1 text-[10px]">
                  <div className="flex justify-between">
                    <span className="text-[#6b7280]">类型</span>
                    <span className="text-[#1a1a2e]">{getPolTypeName(outputPol.chi, outputPol.handedness)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#6b7280]">方位角 ψ</span>
                    <span className="text-[#1a1a2e]" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
                      {(outputPol.psi * 180 / Math.PI).toFixed(1)}°
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#6b7280]">椭圆率角 χ</span>
                    <span className="text-[#1a1a2e]" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
                      {(outputPol.chi * 180 / Math.PI).toFixed(1)}°
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#6b7280]">DOP</span>
                    <span style={{ fontFamily: "var(--font-ibm-plex-mono)", color: outputDOP > 0.99 ? "#008800" : "#1a1a2e" }}>
                      {outputDOP.toFixed(4)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#6b7280]">S₁</span>
                    <span style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>{outputStokes[1].toFixed(4)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#6b7280]">S₂</span>
                    <span style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>{outputStokes[2].toFixed(4)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#6b7280]">S₃</span>
                    <span style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>{outputStokes[3].toFixed(4)}</span>
                  </div>
                </div>
              </div>

              {/* Faraday demo */}
              <FaradayDemo inputJones={inputJones} elements={elements} />

              {/* Jones Matrix Display */}
              <JonesMatrixDisplay elements={elements} />

              {/* Chain Step Table */}
              {chainSteps.length > 0 && (
                <div>
                  <div className="text-[12px] font-semibold text-[#1a1a2e] mb-2 pb-1.5 border-b border-[#d4d8e0]">
                    传播步骤
                  </div>
                  <ChainStepTable steps={chainSteps} />
                </div>
              )}
            </div>

            {/* Right visualization area */}
            <div className="flex-1 flex flex-col min-h-0">
              {/* Ellipse view */}
              {viewTab === "ellipse" && (
                <div className="flex-1 flex items-center justify-center gap-8 p-6">
                  <div className="flex flex-col items-center gap-2">
                    <PolarizationCanvas
                      polarization={inputPol}
                      jones={inputJones}
                      label="输入偏振态"
                      size={280}
                      showVector={true}
                      showTrail={true}
                    />
                    <span className="text-[11px] text-[#6b7280]">入射</span>
                  </div>
                  <div className="flex items-center">
                    <svg width="48" height="24" viewBox="0 0 48 24">
                      <line x1="4" y1="12" x2="32" y2="12" stroke="#9ca3af" strokeWidth="1" />
                      <polygon points="32,8 40,12 32,16" fill="#9ca3af" />
                    </svg>
                  </div>
                  <div className="flex flex-col items-center gap-2">
                    <PolarizationCanvas
                      polarization={outputPol}
                      jones={outputJones}
                      label="输出偏振态"
                      size={280}
                      showVector={true}
                      showTrail={true}
                    />
                    <span className="text-[11px] text-[#6b7280]">出射</span>
                  </div>
                </div>
              )}

              {/* Poincaré sphere view */}
              {viewTab === "poincare" && (
                <div className="flex-1 min-h-0">
                  <Canvas
                    camera={{ position: [3.5, 2.5, 3.5], fov: 45, near: 0.1, far: 50 }}
                    style={{ width: "100%", height: "100%" }}
                  >
                    <ambientLight intensity={0.6} />
                    <directionalLight position={[5, 5, 5]} intensity={0.4} />
                    <PoincareSphere
                      inputStokes={inputStokes}
                      outputStokes={outputStokes}
                      chainSteps={chainSteps}
                      animTime={animTime}
                    />
                    <OrbitControls enableDamping dampingFactor={0.1} rotateSpeed={0.8} />
                  </Canvas>
                </div>
              )}

              {/* E-field helix view */}
              {viewTab === "efield" && (
                <div className="flex-1 min-h-0">
                  <Canvas
                    camera={{ position: [3, 2, 3], fov: 45, near: 0.1, far: 50 }}
                    style={{ width: "100%", height: "100%" }}
                  >
                    <ambientLight intensity={0.6} />
                    <directionalLight position={[5, 5, 5]} intensity={0.4} />
                    <EFieldHelix
                      jones={outputJones}
                      showEx={showEx}
                      showEy={showEy}
                      showComposite={showComposite}
                      animTime={animTime}
                      chainSteps={chainSteps}
                    />
                    <OrbitControls enableDamping dampingFactor={0.1} rotateSpeed={0.8} />
                  </Canvas>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </AnimationTimeProvider>
  );
}
