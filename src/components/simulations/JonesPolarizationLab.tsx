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
import { blitImageData } from "@/lib/utils";
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
  babinetSoleilCompensator,
  linearPolarizer,
  quarterWavePlate,
  stokesToPoincare,
  depolarizerMueller,
  applyMuellerToStokes,
  crystalRetardation,
  walkOffAngle,
  jonesMatVec,
  stokesFromJones as stokesFromJonesCalc,
  wavePlate,
} from "@/lib/optics/jones-matrix";
import { useIsMobile } from "@/hooks/use-mobile";
import { ControlPanel, MobilePanelToggle } from "./shared/ControlPanel";

// ─── Experiment Mode Type ────────────────────────────────────────────
type ExperimentMode = 'basic' | 'babinet_soleil' | 'measurement' | 'depolarization' | 'microscope';

const EXP_MODE_TABS: { key: ExperimentMode; label: string }[] = [
  { key: "basic", label: "基础模式" },
  { key: "babinet_soleil", label: "Babinet-Soleil" },
  { key: "measurement", label: "偏振态测量" },
  { key: "depolarization", label: "消偏振模拟" },
  { key: "microscope", label: "偏光显微镜" },
];

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

// ─── Michel-Levy interference color lookup ──────────────────────────
function michelLevyColor(retardationNm: number): string {
  // Simplified Michel-Levy color mapping based on retardation in nm
  const r = ((retardationNm % 2000) + 2000) % 2000;
  const t = r / 2000;
  // Approximate spectral hue cycling
  const hue = (r * 0.18) % 360;
  const sat = r < 50 ? 0 : Math.min(0.85, 0.4 + 0.3 * Math.sin(r * 0.01));
  const lum = r < 20 ? 0.95 : Math.max(0.3, 0.65 - 0.25 * Math.sin(r * 0.008));
  // Convert HSL to RGB
  const s = sat;
  const l = lum;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  let rr = 0, gg = 0, bb = 0;
  if (hue < 60) { rr = c; gg = x; }
  else if (hue < 120) { rr = x; gg = c; }
  else if (hue < 180) { gg = c; bb = x; }
  else if (hue < 240) { gg = x; bb = c; }
  else if (hue < 300) { rr = x; bb = c; }
  else { rr = c; bb = x; }
  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${toHex(rr)}${toHex(gg)}${toHex(bb)}`;
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
      {sphereCircles.map((pts, i) => (
        <Line key={`gc-${i}`} points={pts} color="#c8ccd4" lineWidth={0.6} transparent opacity={0.35} />
      ))}
      <Line points={[new THREE.Vector3(-R * 1.35, 0, 0), new THREE.Vector3(R * 1.35, 0, 0)]} color="#cc4444" lineWidth={1} />
      <mesh position={[R * 1.35, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <coneGeometry args={[0.04, 0.1, 8]} />
        <meshBasicMaterial color="#cc4444" />
      </mesh>
      <Text position={[R * 1.5, 0, 0]} fontSize={0.14} color="#cc4444" anchorX="center" anchorY="middle">S₁</Text>
      <Line points={[new THREE.Vector3(0, -R * 1.35, 0), new THREE.Vector3(0, R * 1.35, 0)]} color="#44aa44" lineWidth={1} />
      <mesh position={[0, R * 1.35, 0]}>
        <coneGeometry args={[0.04, 0.1, 8]} />
        <meshBasicMaterial color="#44aa44" />
      </mesh>
      <Text position={[0, R * 1.5, 0]} fontSize={0.14} color="#44aa44" anchorX="center" anchorY="middle">S₂</Text>
      <Line points={[new THREE.Vector3(0, 0, -R * 1.35), new THREE.Vector3(0, 0, R * 1.35)]} color="#4488aa" lineWidth={1} />
      <mesh position={[0, 0, R * 1.35]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.04, 0.1, 8]} />
        <meshBasicMaterial color="#4488aa" />
      </mesh>
      <Text position={[0, 0, R * 1.55]} fontSize={0.14} color="#4488aa" anchorX="center" anchorY="middle">S₃</Text>
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
          <Text position={[s[0] * R * 1.2, s[1] * R * 1.2, s[2] * R * 1.2]} fontSize={0.1} color={color} anchorX="center" anchorY="middle">{label}</Text>
        </group>
      ))}
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
      {trajectoryPts.length > 1 && <Line points={trajectoryPts} color="#e8a838" lineWidth={2} />}
      <mesh position={[inputPt[0], inputPt[1], inputPt[2]]}>
        <sphereGeometry args={[0.07, 16, 16]} />
        <meshBasicMaterial color="#4488aa" />
      </mesh>
      <Text position={[inputPt[0] * 1.15, inputPt[1] * 1.15, inputPt[2] * 1.15]} fontSize={0.08} color="#4488aa" anchorX="center">入射</Text>
      <mesh position={[outputPt[0], outputPt[1], outputPt[2]]}>
        <sphereGeometry args={[outputPulse, 16, 16]} />
        <meshBasicMaterial color="#cc4444" />
      </mesh>
      <mesh position={[outputPt[0], outputPt[1], outputPt[2]]}>
        <ringGeometry args={[outputPulse + 0.02, outputPulse + 0.05, 24]} />
        <meshBasicMaterial color="#cc4444" transparent opacity={0.3 + 0.1 * Math.sin(animTime * 3)} side={THREE.DoubleSide} />
      </mesh>
      <Text position={[outputPt[0] * 1.15, outputPt[1] * 1.15, outputPt[2] * 1.15]} fontSize={0.08} color="#cc4444" anchorX="center">出射</Text>
      {chainSteps.slice(1, -1).map((step, i) => {
        const [sx, sy, sz] = normStokes(step.stokes);
        return (
          <group key={`step-${i}`}>
            <mesh position={[sx, sy, sz]}>
              <sphereGeometry args={[0.04, 10, 10]} />
              <meshBasicMaterial color="#e8a838" />
            </mesh>
            <Text position={[sx * 1.1, sy * 1.1, sz * 1.1]} fontSize={0.07} color="#e8a838" anchorX="center" anchorY="middle">{`${i + 1}`}</Text>
          </group>
        );
      })}
      {Math.abs(outputPt[0]) > 0.01 && <Line points={[new THREE.Vector3(0, 0, 0), new THREE.Vector3(outputPt[0], 0, 0)]} color="#cc4444" lineWidth={0.4} transparent opacity={0.3} dashed dashSize={0.04} gapSize={0.03} />}
      {Math.abs(outputPt[1]) > 0.01 && <Line points={[new THREE.Vector3(outputPt[0], 0, 0), new THREE.Vector3(outputPt[0], outputPt[1], 0)]} color="#44aa44" lineWidth={0.4} transparent opacity={0.3} dashed dashSize={0.04} gapSize={0.03} />}
      {Math.abs(outputPt[2]) > 0.01 && <Line points={[new THREE.Vector3(outputPt[0], outputPt[1], 0), new THREE.Vector3(outputPt[0], outputPt[1], outputPt[2])]} color="#4488aa" lineWidth={0.4} transparent opacity={0.3} dashed dashSize={0.04} gapSize={0.03} />}
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
  elements,
}: {
  jones: JonesVec2;
  showEx: boolean;
  showEy: boolean;
  showComposite: boolean;
  animTime: number;
  chainSteps: PropagationStep[];
  elements: OpticalElement[];
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
      helixLine: helixPts, exLine: exPts, eyLine: eyPts,
      propagationAxis: [new THREE.Vector3(0, 0, -zLen / 2 - 0.5), new THREE.Vector3(0, 0, zLen / 2 + 0.5)] as THREE.Vector3[],
    };
  }, [jones]);

  const movingTipPhase = animTime * 2;
  const tipZ = ((movingTipPhase % 5) / 5) * 5 - 2.5;
  const [Ex, Ey] = jones;
  const scale = 1.2;
  const tipExVal = scale * (Ex[0] * Math.cos((movingTipPhase * Math.PI * 8) / 5) - Ex[1] * Math.sin((movingTipPhase * Math.PI * 8) / 5));
  const tipEyVal = scale * (Ey[0] * Math.cos((movingTipPhase * Math.PI * 8) / 5) - Ey[1] * Math.sin((movingTipPhase * Math.PI * 8) / 5));

  const chainMarkers = useMemo(() => {
    if (chainSteps.length <= 2) return [];
    const zLen = 5;
    const markers: { z: number; jones: JonesVec2; stepIdx: number }[] = [];
    chainSteps.slice(1, -1).forEach((step, i) => {
      const z = -zLen / 2 + ((i + 1) / (chainSteps.length - 1)) * zLen;
      markers.push({ z, jones: step.jones, stepIdx: i + 1 });
    });
    return markers;
  }, [chainSteps]);

  return (
    <group ref={groupRef}>
      <Line points={propagationAxis} color="#d4d8e0" lineWidth={0.5} />
      <Text position={[0, 0, propagationAxis[1].z + 0.25]} fontSize={0.12} color="#6b7280" anchorX="center">z (传播方向)</Text>
      {showEx && <Line points={exLine} color="#cc4444" lineWidth={1.2} transparent opacity={0.7} />}
      {showEy && <Line points={eyLine} color="#44aa44" lineWidth={1.2} transparent opacity={0.7} />}
      {showComposite && <Line points={helixLine} color="#2d3142" lineWidth={2} />}
      {showComposite && Array.from({ length: 30 }, (_, i) => {
        const idx = Math.round((i / 30) * 300);
        if (idx >= helixLine.length) return null;
        const pt = helixLine[idx];
        return <Line key={`evec-${i}`} points={[new THREE.Vector3(0, 0, pt.z), pt]} color="#2d3142" lineWidth={0.3} transparent opacity={0.12} />;
      })}
      {showComposite && (
        <group>
          <mesh position={[tipExVal, tipEyVal, tipZ]}><sphereGeometry args={[0.05, 12, 12]} /><meshBasicMaterial color="#cc4444" /></mesh>
          <Line points={[new THREE.Vector3(0, 0, tipZ), new THREE.Vector3(tipExVal, tipEyVal, tipZ)]} color="#cc4444" lineWidth={1.5} />
        </group>
      )}
      {showEx && showComposite && <Line points={[new THREE.Vector3(tipExVal, 0, tipZ), new THREE.Vector3(tipExVal, tipEyVal, tipZ)]} color="#cc4444" lineWidth={0.5} transparent opacity={0.3} dashed dashSize={0.05} gapSize={0.03} />}
      {showEy && showComposite && <Line points={[new THREE.Vector3(0, tipEyVal, tipZ), new THREE.Vector3(tipExVal, tipEyVal, tipZ)]} color="#44aa44" lineWidth={0.5} transparent opacity={0.3} dashed dashSize={0.05} gapSize={0.03} />}
      {chainMarkers.map(({ z, jones: stepJones, stepIdx }) => {
        const [sEx, sEy] = stepJones;
        const sExVal = scale * cAbs(sEx) * 0.5;
        const sEyVal = scale * cAbs(sEy) * 0.5;
        return (
          <group key={`chain-marker-${stepIdx}`}>
            <mesh position={[0, 0, z]}><ringGeometry args={[0.01, 0.015, 16]} /><meshBasicMaterial color="#e8a838" transparent opacity={0.5} side={THREE.DoubleSide} /></mesh>
            <Line points={[new THREE.Vector3(0, 0, z), new THREE.Vector3(sExVal, sEyVal, z)]} color="#e8a838" lineWidth={0.5} transparent opacity={0.4} />
            <Text position={[0.1, 0.1, z]} fontSize={0.06} color="#e8a838" anchorX="left">{`#${stepIdx}`}</Text>
          </group>
        );
      })}
      <Text position={[1.6, 0, -2.8]} fontSize={0.1} color="#cc4444" anchorX="center">Ex</Text>
      <Text position={[0, 1.6, -2.8]} fontSize={0.1} color="#44aa44" anchorX="center">Ey</Text>
      {showEx && <Line points={[new THREE.Vector3(0, 0, -2.5), new THREE.Vector3(scale * cAbs(Ex), 0, -2.5)]} color="#cc4444" lineWidth={2} />}
      {showEy && <Line points={[new THREE.Vector3(0, 0, -2.5), new THREE.Vector3(0, scale * cAbs(Ey), -2.5)]} color="#44aa44" lineWidth={2} />}
      {/* Waveplate/crystal axis markers at element positions */}
      {chainMarkers.map(({ z, stepIdx }) => {
        const elem = elements[stepIdx - 1];
        if (!elem) return null;
        const isWaveplateType = elem.type === "waveplate" || elem.type === "babinet_soleil" || elem.type === "crystal";
        if (!isWaveplateType) return null;
        const angleRad = (elem.angle * Math.PI) / 180;
        const axisLen = 1.4;
        const fastX = axisLen * Math.cos(angleRad);
        const fastY = axisLen * Math.sin(angleRad);
        const slowX = axisLen * Math.cos(angleRad + Math.PI / 2);
        const slowY = axisLen * Math.sin(angleRad + Math.PI / 2);
        const info = ELEMENT_INFO[elem.type];
        return (
          <group key={`axis-${stepIdx}`}>
            {/* Fast axis (solid orange) */}
            <Line points={[new THREE.Vector3(-fastX, -fastY, z), new THREE.Vector3(fastX, fastY, z)]} color="#e8a838" lineWidth={1.2} transparent opacity={0.6} />
            {/* Slow axis (dashed purple) */}
            <Line points={[new THREE.Vector3(-slowX, -slowY, z), new THREE.Vector3(slowX, slowY, z)]} color="#8844cc" lineWidth={0.8} transparent opacity={0.4} dashed dashSize={0.08} gapSize={0.04} />
            {/* Element label */}
            <Text position={[fastX + 0.15, fastY + 0.15, z]} fontSize={0.07} color="#e8a838" anchorX="left">{info.symbol} 快轴</Text>
            <Text position={[slowX + 0.15, slowY + 0.15, z]} fontSize={0.06} color="#8844cc" anchorX="left">慢轴</Text>
            {/* Crystal birefringence info */}
            {elem.type === "crystal" && (
              <Text position={[-1.2, -1.3, z]} fontSize={0.06} color="#6b7280" anchorX="left">
                {`Δn=${((elem.ne ?? 1.71) - (elem.no ?? 1.53)).toFixed(3)}`}
              </Text>
            )}
          </group>
        );
      })}
    </group>
  );
}

// ─── 3D Polarization Ellipse ────────────────────────────────────────
function PolarizationEllipse3D({
  jones,
  polarization,
  animTime,
  elements,
}: {
  jones: JonesVec2;
  polarization: ReturnType<typeof analyzePolarization>;
  animTime: number;
  elements: OpticalElement[];
}) {
  const scale = 1.2;

  // Handedness-based colors
  const colors = useMemo(() => {
    if (Math.abs(polarization.handedness) < 0.01) {
      return { fill: "#e0e3e8", stroke: "#6b7280", label: "线偏振" };
    } else if (polarization.handedness > 0) {
      return { fill: "#e8a0a0", stroke: "#cc4444", label: "右旋" };
    } else {
      return { fill: "#a0c0e8", stroke: "#4488aa", label: "左旋" };
    }
  }, [polarization.handedness]);

  // Compute ellipse points in 3D (x=Ex, y=Ey, z=0 plane)
  const ellipsePoints2D = useMemo(
    () => polarizationEllipsePoints(polarization, 128),
    [polarization]
  );

  // Normalize so the largest dimension is ~1.0
  const maxRadius = useMemo(() => {
    const intensity = Math.sqrt(polarization.a ** 2 + polarization.b ** 2);
    return intensity > 0 ? intensity : 1;
  }, [polarization]);

  const normScale = scale / maxRadius;

  // 3D ellipse line points
  const ellipseLinePts = useMemo(
    () =>
      ellipsePoints2D.map(
        (p) => new THREE.Vector3(p.x * normScale, p.y * normScale, 0)
      ),
    [ellipsePoints2D, normScale]
  );

  // Close the loop
  const closedEllipsePts = useMemo(() => {
    if (ellipseLinePts.length === 0) return [];
    return [...ellipseLinePts, ellipseLinePts[0]];
  }, [ellipseLinePts]);

  // Ellipse fill mesh: triangulate the interior
  const fillGeometry = useMemo(() => {
    const shape = new THREE.Shape();
    ellipsePoints2D.forEach((p, i) => {
      const x = p.x * normScale;
      const y = p.y * normScale;
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    });
    shape.closePath();
    const geom = new THREE.ShapeGeometry(shape);
    // Rotate to lie in the XY plane at z=0 (ShapeGeometry creates in XY already)
    return geom;
  }, [ellipsePoints2D, normScale]);

  // Animated E-field vector tip position
  const animPhase = animTime * Math.PI * 2;
  const [Ex, Ey] = jones;
  const tipX = normScale * (Ex[0] * Math.cos(animPhase) - Ex[1] * Math.sin(animPhase));
  const tipY = normScale * (Ey[0] * Math.cos(animPhase) - Ey[1] * Math.sin(animPhase));

  // Trail of fading dots
  const trailDots = useMemo(() => {
    const dots: { x: number; y: number; opacity: number }[] = [];
    const trailLen = 20;
    for (let t = 1; t <= trailLen; t++) {
      const pastPhase = animPhase - t * 0.1;
      const px = normScale * (Ex[0] * Math.cos(pastPhase) - Ex[1] * Math.sin(pastPhase));
      const py = normScale * (Ey[0] * Math.cos(pastPhase) - Ey[1] * Math.sin(pastPhase));
      dots.push({ x: px, y: py, opacity: 0.5 * (1 - t / trailLen) });
    }
    return dots;
  }, [animPhase, Ex, Ey, normScale]);

  // Fast axis direction for waveplate elements
  const waveplateAxes = useMemo(() => {
    const waveplateTypes: ElementType[] = ["halfwave", "quarterwave", "waveplate"];
    const axes: { angle: number; label: string }[] = [];
    for (const el of elements) {
      if (waveplateTypes.includes(el.type)) {
        axes.push({
          angle: (el.angle * Math.PI) / 180,
          label: ELEMENT_INFO[el.type].symbol,
        });
      }
    }
    return axes;
  }, [elements]);

  // Axis line length
  const axisLen = scale * 1.4;

  return (
    <group>
      {/* Background reference grid on XY plane */}
      <gridHelper args={[4, 12, "#e0e3e8", "#e8eaef"]} rotation={[0, 0, 0]} position={[0, 0, -0.01]} />

      {/* Ex axis arrow */}
      <Line
        points={[new THREE.Vector3(0, 0, 0), new THREE.Vector3(axisLen, 0, 0)]}
        color="#cc4444"
        lineWidth={1}
      />
      <mesh position={[axisLen, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <coneGeometry args={[0.04, 0.12, 8]} />
        <meshBasicMaterial color="#cc4444" />
      </mesh>
      <Text position={[axisLen + 0.2, 0, 0]} fontSize={0.14} color="#cc4444" anchorX="center" anchorY="middle">
        Ex
      </Text>

      {/* Ey axis arrow */}
      <Line
        points={[new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, axisLen, 0)]}
        color="#44aa44"
        lineWidth={1}
      />
      <mesh position={[0, axisLen, 0]}>
        <coneGeometry args={[0.04, 0.12, 8]} />
        <meshBasicMaterial color="#44aa44" />
      </mesh>
      <Text position={[0, axisLen + 0.2, 0]} fontSize={0.14} color="#44aa44" anchorX="center" anchorY="middle">
        Ey
      </Text>

      {/* Z axis (propagation direction) */}
      <Line
        points={[new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, axisLen * 0.8)]}
        color="#d4d8e0"
        lineWidth={0.5}
      />
      <mesh position={[0, 0, axisLen * 0.8]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.03, 0.08, 6]} />
        <meshBasicMaterial color="#d4d8e0" />
      </mesh>
      <Text position={[0.15, 0, axisLen * 0.85]} fontSize={0.1} color="#6b7280" anchorX="left" anchorY="middle">
        z (传播方向)
      </Text>

      {/* Semi-transparent fill for ellipse interior */}
      <mesh geometry={fillGeometry} rotation={[0, 0, 0]}>
        <meshBasicMaterial
          color={colors.fill}
          transparent
          opacity={0.15}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* Ellipse outline (thick line) */}
      {closedEllipsePts.length > 1 && (
        <Line points={closedEllipsePts} color={colors.stroke} lineWidth={2.5} />
      )}

      {/* Animated E-field vector */}
      <Line
        points={[new THREE.Vector3(0, 0, 0), new THREE.Vector3(tipX, tipY, 0)]}
        color={colors.stroke}
        lineWidth={2}
      />
      {/* Tip sphere */}
      <mesh position={[tipX, tipY, 0]}>
        <sphereGeometry args={[0.05, 12, 12]} />
        <meshBasicMaterial color={colors.stroke} />
      </mesh>

      {/* Trail of fading dots */}
      {trailDots.map((dot, i) => (
        <mesh key={`trail-${i}`} position={[dot.x, dot.y, 0]}>
          <sphereGeometry args={[0.02, 6, 6]} />
          <meshBasicMaterial color={colors.stroke} transparent opacity={dot.opacity} />
        </mesh>
      ))}

      {/* Waveplate fast/slow axis indicators */}
      {waveplateAxes.map(({ angle, label }, idx) => {
        const faX = Math.cos(angle) * axisLen * 0.9;
        const faY = Math.sin(angle) * axisLen * 0.9;
        const saX = Math.cos(angle + Math.PI / 2) * axisLen * 0.6;
        const saY = Math.sin(angle + Math.PI / 2) * axisLen * 0.6;
        return (
          <group key={`wp-axis-${idx}`}>
            {/* Fast axis - solid thin line */}
            <Line
              points={[
                new THREE.Vector3(-faX, -faY, 0.01),
                new THREE.Vector3(faX, faY, 0.01),
              ]}
              color="#e8a838"
              lineWidth={1}
            />
            <Text
              position={[faX * 1.1, faY * 1.1, 0.01]}
              fontSize={0.08}
              color="#e8a838"
              anchorX="center"
              anchorY="middle"
            >
              {label} 快轴
            </Text>
            {/* Slow axis - dashed line */}
            <Line
              points={[
                new THREE.Vector3(-saX, -saY, 0.01),
                new THREE.Vector3(saX, saY, 0.01),
              ]}
              color="#e8a838"
              lineWidth={0.5}
              transparent
              opacity={0.5}
              dashed
              dashSize={0.06}
              gapSize={0.04}
            />
            <Text
              position={[saX * 1.15, saY * 1.15, 0.01]}
              fontSize={0.07}
              color="#c4a050"
              anchorX="center"
              anchorY="middle"
            >
              慢轴
            </Text>
          </group>
        );
      })}

      {/* Handedness label */}
      <Text position={[0, -axisLen - 0.3, 0]} fontSize={0.12} color={colors.stroke} anchorX="center" anchorY="middle">
        {colors.label}
      </Text>
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
      ctx.fillStyle = "#f8f9fb";
      ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = "#e0e3e8";
      ctx.lineWidth = 0.5;
      const gridSize = 20;
      for (let i = 0; i <= size; i += gridSize) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, size); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(size, i); ctx.stroke();
      }
      ctx.strokeStyle = "#9ca3af";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(10, cy); ctx.lineTo(size - 10, cy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, 10); ctx.lineTo(cx, size - 10); ctx.stroke();
      ctx.fillStyle = "#6b7280";
      ctx.font = "11px IBM Plex Sans";
      ctx.textAlign = "center";
      ctx.fillText("Ex", size - 16, cy - 6);
      ctx.fillText("Ey", cx + 12, 16);
      const points = polarizationEllipsePoints(polarization, 200);
      const intensity = Math.sqrt(polarization.a ** 2 + polarization.b ** 2);
      const normScale = intensity > 0 ? scaleF / Math.max(intensity, 0.01) : scaleF;
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
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.strokeStyle = `rgba(26, 26, 46, ${0.02 + 0.015 * (trailSteps - t)})`;
          ctx.lineWidth = 1 + (trailSteps - t) * 0.3;
          ctx.stroke();
        }
      }
      ctx.beginPath();
      points.forEach((p, i) => { const x = cx + p.x * normScale; const y = cy - p.y * normScale; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
      ctx.closePath();
      ctx.fillStyle = "rgba(26, 26, 46, 0.04)";
      ctx.fill();
      ctx.beginPath();
      points.forEach((p, i) => { const x = cx + p.x * normScale; const y = cy - p.y * normScale; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
      ctx.closePath();
      ctx.strokeStyle = "#1a1a2e";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (polarization.handedness !== 0 && showTrail) {
        [40, 90, 140].forEach(arrowIdx => {
          const nextIdx = arrowIdx + 3;
          if (arrowIdx < points.length && nextIdx < points.length) {
            const ax = cx + points[arrowIdx].x * normScale; const ay = cy - points[arrowIdx].y * normScale;
            const bx = cx + points[nextIdx].x * normScale; const by = cy - points[nextIdx].y * normScale;
            const angle = Math.atan2(by - ay, bx - ax);
            ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax - 5 * Math.cos(angle - 0.4), ay - 5 * Math.sin(angle - 0.4));
            ctx.moveTo(ax, ay); ctx.lineTo(ax - 5 * Math.cos(angle + 0.4), ay - 5 * Math.sin(angle + 0.4));
            ctx.strokeStyle = "#cc0000"; ctx.lineWidth = 1.2; ctx.stroke();
          }
        });
      }
      if (showVector && showTrail) {
        const [Ex, Ey] = jones;
        const animPhase = phaseRef.current * Math.PI * 2;
        const exVal = Ex[0] * Math.cos(animPhase) - Ex[1] * Math.sin(animPhase);
        const eyVal = Ey[0] * Math.cos(animPhase) - Ey[1] * Math.sin(animPhase);
        const vx = cx + exVal * normScale; const vy = cy - eyVal * normScale;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(vx, vy); ctx.strokeStyle = "#cc4444"; ctx.lineWidth = 2; ctx.stroke();
        ctx.beginPath(); ctx.arc(vx, vy, 3, 0, Math.PI * 2); ctx.fillStyle = "#cc4444"; ctx.fill();
        const trailLen = 15;
        for (let t = 1; t <= trailLen; t++) {
          const pastPhase = animPhase - t * 0.12;
          const pex = Ex[0] * Math.cos(pastPhase) - Ex[1] * Math.sin(pastPhase);
          const pey = Ey[0] * Math.cos(pastPhase) - Ey[1] * Math.sin(pastPhase);
          ctx.beginPath(); ctx.arc(cx + pex * normScale, cy - pey * normScale, 1.5, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(204, 68, 68, ${0.4 * (1 - t / trailLen)})`; ctx.fill();
        }
      } else if (showVector) {
        for (let i = 0; i < 12; i++) {
          const t = (2 * Math.PI * i) / 12;
          const idx = Math.round((t / (2 * Math.PI)) * 200) % 200;
          if (idx < points.length) {
            ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + points[idx].x * normScale, cy - points[idx].y * normScale);
            ctx.strokeStyle = "rgba(107, 114, 128, 0.15)"; ctx.lineWidth = 0.6; ctx.stroke();
          }
        }
      }
      if (polarization.handedness !== 0) {
        ctx.fillStyle = polarization.handedness > 0 ? "#4488aa" : "#cc4444";
        ctx.font = "10px IBM Plex Sans"; ctx.textAlign = "right";
        ctx.fillText(polarization.handedness > 0 ? "右旋 ↻" : "左旋 ↺", size - 8, size - 6);
      }
      ctx.fillStyle = "#2d3142"; ctx.font = "12px IBM Plex Sans"; ctx.textAlign = "left"; ctx.fillText(label, 8, size - 6);
      ctx.restore();
      phaseRef.current += 0.015;
      if (phaseRef.current > 1) phaseRef.current -= 1;
      animRef.current = requestAnimationFrame(draw);
    };
    draw();
    return () => { running = false; cancelAnimationFrame(animRef.current); };
  }, [polarization, jones, label, size, showVector, showTrail]);

  return <canvas ref={canvasRef} style={{ width: size, height: size }} className="border border-[#d4d8e0]" />;
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
          <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${isFaraday ? "bg-[#fde8e8] text-[#cc4444]" : "bg-[#edf0f5] text-[#4a4a5a]"}`} style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>
            {info.symbol}
          </span>
          <span className="text-[12px] text-[#2d3142]">{info.name}</span>
          {isFaraday && <span className="text-[8px] bg-[#cc4444] text-white px-1 py-0 rounded">非互易</span>}
        </div>
        <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-[#9ca3af] hover:text-[#dc2626]" onClick={() => onRemove(element.id)}>×</Button>
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-[#6b7280]">角度 θ</span>
          <span className="text-[10px] text-[#6b7280]" style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>{element.angle.toFixed(1)}°</span>
        </div>
        <Slider value={[element.angle]} onValueChange={([v]) => onAngleChange(element.id, v)} min={-180} max={180} step={0.5} />
        {isWaveplate && (
          <>
            <div className="flex items-center justify-between mt-1">
              <span className="text-[10px] text-[#6b7280]">相位延迟 δ</span>
              <span className="text-[10px] text-[#6b7280]" style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>{(element.retardation ?? 90).toFixed(1)}°</span>
            </div>
            <Slider value={[element.retardation ?? 90]} onValueChange={([v]) => onRetardationChange(element.id, v)} min={0} max={360} step={1} />
          </>
        )}
        {isFaraday && <p className="text-[9px] text-[#cc4444] mt-1">⚠ 法拉第旋转器：反向传播时旋转方向不变（非互易）</p>}
      </div>
    </div>
  );
}

// ─── Chain Step Table ───────────────────────────────────────────────
function ChainStepTable({ steps }: { steps: PropagationStep[] }) {
  return (
    <div className="bg-white border border-[#d4d8e0] rounded overflow-x-auto mobile-x-scroll">
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
                <td className="px-1.5 py-1 text-[#1a1a2e]">{step.stepIndex === -1 ? "入射" : `${step.stepIndex + 1}`}</td>
                <td className="px-1.5 py-1 text-[#2d3142]">{elemInfo ? <span className={step.element!.type === "faraday" ? "text-[#cc4444]" : ""}>{elemInfo.symbol} {step.element!.angle.toFixed(1)}°</span> : "—"}</td>
                <td className="px-1.5 py-1 text-[#4a4a5a]" style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace", fontSize: "8px" }}>[{fmtComplex(step.jones[0], 2)}, {fmtComplex(step.jones[1], 2)}]</td>
                <td className="px-1.5 py-1 text-right" style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>{step.stokes[1].toFixed(3)}</td>
                <td className="px-1.5 py-1 text-right" style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>{step.stokes[2].toFixed(3)}</td>
                <td className="px-1.5 py-1 text-right" style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>{step.stokes[3].toFixed(3)}</td>
                <td className="px-1.5 py-1">
                  <div className="flex items-center gap-1">
                    <div className="w-12 h-2 bg-[#edf0f5] rounded overflow-hidden">
                      <div className="h-full rounded" style={{ width: `${Math.min(step.dop * 100, 100)}%`, backgroundColor: step.dop > 0.99 ? "#008800" : step.dop > 0.9 ? "#44aa44" : "#e8a838" }} />
                    </div>
                    <span className="text-right w-8" style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace", color: step.dop > 0.99 ? "#008800" : "#1a1a2e" }}>{step.dop.toFixed(2)}</span>
                  </div>
                </td>
                <td className="px-1.5 py-1 text-[9px] text-[#6b7280]">{polType}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Faraday Non-Reciprocal Demo ───────────────────────────────────
function FaradayDemo({ inputJones, elements }: { inputJones: JonesVec2; elements: OpticalElement[] }) {
  const hasFaraday = elements.some((e) => e.type === "faraday");
  const { forwardAnalysis, reverseAnalysis } = useMemo(() => {
    const forward = propagateThroughChain(inputJones, elements);
    const reversedElements = [...elements].reverse().map((e) => ({ ...e, angle: e.type === "faraday" ? e.angle : -e.angle }));
    const reverse = propagateThroughChain(forward, reversedElements);
    return { forwardAnalysis: analyzePolarization(forward), reverseAnalysis: analyzePolarization(reverse) };
  }, [inputJones, elements]);
  if (!hasFaraday) return null;
  const isIdentical = Math.abs(forwardAnalysis.psi - reverseAnalysis.psi) < 0.01 && Math.abs(forwardAnalysis.chi - reverseAnalysis.chi) < 0.01;
  return (
    <div className="bg-[#fff8f8] border border-[#cc4444] rounded p-2.5 space-y-2">
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] bg-[#cc4444] text-white px-1.5 py-0.5 rounded font-medium">非互易演示</span>
        <span className="text-[10px] text-[#cc4444]">法拉第旋转器正向 vs 反向传播</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-white border border-[#f0d0d0] rounded p-2">
          <div className="text-[9px] text-[#6b7280] mb-1">正向传播 →</div>
          <div className="text-[10px] text-[#1a1a2e]" style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>ψ = {(forwardAnalysis.psi * 180 / Math.PI).toFixed(1)}°</div>
          <div className="text-[10px] text-[#1a1a2e]" style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>χ = {(forwardAnalysis.chi * 180 / Math.PI).toFixed(1)}°</div>
          <div className="text-[9px] text-[#6b7280]">{getPolTypeName(forwardAnalysis.chi, forwardAnalysis.handedness)}</div>
        </div>
        <div className="bg-white border border-[#f0d0d0] rounded p-2">
          <div className="text-[9px] text-[#6b7280] mb-1">← 反向传播</div>
          <div className="text-[10px] text-[#1a1a2e]" style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>ψ = {(reverseAnalysis.psi * 180 / Math.PI).toFixed(1)}°</div>
          <div className="text-[10px] text-[#1a1a2e]" style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>χ = {(reverseAnalysis.chi * 180 / Math.PI).toFixed(1)}°</div>
          <div className="text-[9px] text-[#6b7280]">{getPolTypeName(reverseAnalysis.chi, reverseAnalysis.handedness)}</div>
        </div>
      </div>
      {!isIdentical && <div className="text-[9px] text-[#cc4444] bg-[#fff0f0] rounded px-2 py-1">⚠ 正向与反向传播结果不同 — 非互易效应！法拉第旋转器反向传播时旋转方向不变，而普通旋光器会反转。</div>}
      {isIdentical && <div className="text-[9px] text-[#008800] bg-[#f0fff0] rounded px-2 py-1">✓ 当前配置下正反向结果恰好相同（可能需要调整角度以观察差异）</div>}
    </div>
  );
}

// ─── Jones Matrix Display ──────────────────────────────────────────
function JonesMatrixDisplay({ elements }: { elements: OpticalElement[] }) {
  if (elements.length === 0) return null;
  return (
    <div className="bg-white border border-[#d4d8e0] rounded p-2.5 space-y-2">
      <div className="text-[10px] text-[#6b7280] uppercase tracking-wider font-medium" style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>琼斯矩阵链</div>
      <div className="space-y-1.5">
        {elements.map((elem) => {
          const M = getElementMatrix(elem);
          const info = ELEMENT_INFO[elem.type];
          return (
            <div key={elem.id} className={`text-[8px] p-1.5 rounded ${elem.type === "faraday" ? "bg-[#fff8f8] border border-[#f0d0d0]" : "bg-[#f8f9fb]"}`}>
              <div className="flex items-center gap-1 mb-1">
                <span className={`font-mono px-1 rounded ${elem.type === "faraday" ? "bg-[#fde8e8] text-[#cc4444]" : "bg-[#edf0f5] text-[#4a4a5a]"}`}>{info.symbol}</span>
                <span className="text-[9px] text-[#4a4a5a]">{elem.angle.toFixed(1)}°</span>
              </div>
              <div style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }} className="text-[#4a4a5a]">
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
    const animate = () => { if (!running) return; setTime((t) => t + 0.016); frameRef.current = requestAnimationFrame(animate); };
    animate();
    return () => { running = false; cancelAnimationFrame(frameRef.current); };
  }, []);
  return <>{children(time)}</>;
}

// ═══════════════════════════════════════════════════════════════════
// MODE 1: Babinet-Soleil Compensator (巴比涅-索里补偿器)
// ═══════════════════════════════════════════════════════════════════
function BabinetSoleilMode({ panelOpen, onPanelClose }: { panelOpen: boolean; onPanelClose: () => void }) {
  const isMobile = useIsMobile();
  const [bsAngle, setBsAngle] = useState(0);
  const [bsRetardation, setBsRetardation] = useState(0);
  const [inputState, setInputState] = useState<JonesVec2>(HLP);
  const [measuring, setMeasuring] = useState(false);
  const [mysteryRetardation, setMysteryRetardation] = useState(0);
  const [measuredRetardation, setMeasuredRetardation] = useState<number | null>(null);

  // Compute output through BS compensator
  const bsMatrix = useMemo(() => babinetSoleilCompensator(bsAngle, bsRetardation), [bsAngle, bsRetardation]);
  const outputJones = useMemo(() => jonesMatVec(bsMatrix, inputState), [bsMatrix, inputState]);
  const inputPol = useMemo(() => analyzePolarization(inputState), [inputState]);
  const outputPol = useMemo(() => analyzePolarization(outputJones), [outputJones]);

  // For mystery waveplate measurement
  const mysteryOutputJones = useMemo(() => {
    if (!measuring) return outputJones;
    // Chain: input -> mystery waveplate -> BS compensator -> output
    const mysteryM = wavePlate(0, mysteryRetardation);
    const afterMystery = jonesMatVec(mysteryM, inputState);
    return jonesMatVec(bsMatrix, afterMystery);
  }, [measuring, mysteryRetardation, bsMatrix, inputState, outputJones]);
  const mysteryOutputPol = useMemo(() => analyzePolarization(mysteryOutputJones), [mysteryOutputJones]);

  const outputIntensity = useMemo(() => {
    const [Ex, Ey] = mysteryOutputJones;
    return Ex[0] * Ex[0] + Ex[1] * Ex[1] + Ey[0] * Ey[0] + Ey[1] * Ey[1];
  }, [mysteryOutputJones]);

  const isExtinct = outputIntensity < 0.01;

  const startMeasurement = useCallback(() => {
    const ret = Math.round(Math.random() * 360 * 10) / 10;
    setMysteryRetardation(ret);
    setMeasuring(true);
    setMeasuredRetardation(null);
  }, []);

  const confirmMeasurement = useCallback(() => {
    if (isExtinct) {
      setMeasuredRetardation(360 - bsRetardation);
    }
  }, [isExtinct, bsRetardation]);

  const dopColor = (dop: number) => dop > 0.99 ? "#008800" : dop > 0.9 ? "#44aa44" : "#e8a838";

  return (
    <div className="flex flex-1 min-h-0">
      {/* Left panel */}
      <ControlPanel open={panelOpen} onClose={onPanelClose} title="实验参数">
        <div className="text-[10px] text-[#6b7280] uppercase tracking-wider font-medium font-mono">Babinet-Soleil 补偿器</div>

        {/* BS parameters */}
        <div className="bg-white border border-[#d4d8e0] rounded p-3 space-y-3">
          <div className="text-[11px] font-semibold text-[#2d3142]">补偿器参数</div>
          <div>
            <div className="flex justify-between mb-1">
              <span className="text-[10px] text-[#6b7280]">快轴角度</span>
              <span className="text-[10px] text-[#6b7280] tabular-nums" style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>{bsAngle.toFixed(1)}°</span>
            </div>
            <Slider value={[bsAngle]} onValueChange={([v]) => setBsAngle(v)} min={-90} max={90} step={0.5} />
          </div>
          <div>
            <div className="flex justify-between mb-1">
              <span className="text-[10px] text-[#6b7280]">总延迟量</span>
              <span className="text-[10px] text-[#6b7280] tabular-nums" style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>{bsRetardation.toFixed(1)}°</span>
            </div>
            <Slider value={[bsRetardation]} onValueChange={([v]) => setBsRetardation(v)} min={0} max={360} step={0.5} />
          </div>
        </div>

        {/* Input state */}
        <div className="bg-white border border-[#d4d8e0] rounded p-3 space-y-2">
          <div className="text-[11px] font-semibold text-[#2d3142]">入射偏振态</div>
          <div className="flex gap-1 flex-wrap">
            {Object.entries(INPUT_STATES).map(([key, { label }]) => (
              <Button key={key} variant="outline" size="sm" className="h-6 text-[9px] px-2 border-[#d4d8e0]" onClick={() => setInputState(INPUT_STATES[key].jones)}>{label}</Button>
            ))}
          </div>
        </div>

        {/* Measurement section */}
        <div className="bg-white border border-[#d4d8e0] rounded p-3 space-y-2">
          <div className="text-[11px] font-semibold text-[#2d3142]">测量未知波片</div>
          <p className="text-[9px] text-[#6b7280]">放置一个未知延迟的波片，调节补偿器使出射光消光，读取延迟量。</p>
          <Button
            variant="outline"
            size="sm"
            className="w-full text-[10px] border-[#d4d8e0]"
            onClick={startMeasurement}
          >
            {measuring ? "重新生成未知波片" : "放置未知波片"}
          </Button>
          {measuring && (
            <div className="space-y-2 mt-2">
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${isExtinct ? "bg-[#008800]" : "bg-[#cc4444]"}`} />
                <span className="text-[10px] tabular-nums" style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>
                  出射光强: {outputIntensity.toFixed(4)}
                </span>
              </div>
              {isExtinct && (
                <div className="text-[10px] text-[#008800] bg-[#f0fff0] rounded px-2 py-1 font-medium">
                  ✓ 消光 — 可读数
                </div>
              )}
              <Button
                variant="outline"
                size="sm"
                className="w-full text-[10px] border-[#008800] text-[#008800] disabled:opacity-40"
                disabled={!isExtinct}
                onClick={confirmMeasurement}
              >
                确认读数
              </Button>
              {measuredRetardation !== null && (
                <div className="bg-[#f8f9fb] border border-[#d4d8e0] rounded p-2 space-y-1">
                  <div className="flex justify-between text-[10px]">
                    <span className="text-[#6b7280]">测量延迟</span>
                    <span className="tabular-nums" style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>{measuredRetardation.toFixed(1)}°</span>
                  </div>
                  <div className="flex justify-between text-[10px]">
                    <span className="text-[#6b7280]">实际延迟</span>
                    <span className="tabular-nums" style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>{mysteryRetardation.toFixed(1)}°</span>
                  </div>
                  <div className="flex justify-between text-[10px]">
                    <span className="text-[#6b7280]">误差</span>
                    <span className="tabular-nums" style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace", color: "#cc4444" }}>
                      {Math.abs(measuredRetardation - mysteryRetardation).toFixed(1)}°
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Output info */}
        <div className="bg-white border border-[#d4d8e0] rounded p-3 space-y-1 text-[10px]">
          <div className="text-[11px] font-semibold text-[#2d3142] mb-1">出射偏振态</div>
          <div className="flex justify-between"><span className="text-[#6b7280]">类型</span><span>{getPolTypeName(mysteryOutputPol.chi, mysteryOutputPol.handedness)}</span></div>
          <div className="flex justify-between"><span className="text-[#6b7280]">ψ</span><span className="tabular-nums" style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>{(mysteryOutputPol.psi * 180 / Math.PI).toFixed(1)}°</span></div>
          <div className="flex justify-between"><span className="text-[#6b7280]">χ</span><span className="tabular-nums" style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>{(mysteryOutputPol.chi * 180 / Math.PI).toFixed(1)}°</span></div>
        </div>
      </ControlPanel>

      {/* Right visualization */}
      <div className={isMobile ? "flex-1 flex flex-col items-center justify-center gap-3 p-3" : "flex-1 flex items-center justify-center gap-6 p-6"}>
        <div className="flex flex-col items-center gap-2">
          <PolarizationCanvas polarization={inputPol} jones={inputState} label="输入偏振态" size={isMobile ? 160 : 200} showVector={true} showTrail={true} />
          <span className="text-[10px] text-[#6b7280]">入射</span>
        </div>
        <div className="flex items-center gap-3">
          <svg width="80" height="40" viewBox="0 0 80 40">
            <line x1="4" y1="20" x2="28" y2="20" stroke="#9ca3af" strokeWidth="1" />
            <rect x="28" y="8" width="24" height="24" fill="none" stroke="#d4d8e0" strokeWidth="1" />
            <text x="40" y="24" textAnchor="middle" fontSize="8" fill="#6b7280">BS</text>
            <line x1="52" y1="20" x2="76" y2="20" stroke="#9ca3af" strokeWidth="1" />
            <polygon points="72,16 80,20 72,24" fill="#9ca3af" />
          </svg>
        </div>
        <div className="flex flex-col items-center gap-2">
          <PolarizationCanvas polarization={mysteryOutputPol} jones={mysteryOutputJones} label="输出偏振态" size={isMobile ? 160 : 200} showVector={true} showTrail={true} />
          <span className="text-[10px] text-[#6b7280]">出射</span>
          {isExtinct && <span className="text-[10px] text-[#008800] font-medium">✓ 消光</span>}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// MODE 2: Polarization State Measurement (偏振态测量实验)
// ═══════════════════════════════════════════════════════════════════
function MeasurementMode({ panelOpen, onPanelClose }: { panelOpen: boolean; onPanelClose: () => void }) {
  const isMobile = useIsMobile();
  // ─── Measurement record type ────────────────────────────────────
  interface MeasurementRecord {
    id: number;
    polarizerAngle: number;
    qwpAngle: number | null;
    useQWP: boolean;
    intensity: number;
  }

  // ─── State ──────────────────────────────────────────────────────
  const [targetStokes, setTargetStokes] = useState<[number, number, number, number]>([1, 0, 0, 0]);
  const [targetGenerated, setTargetGenerated] = useState(false);
  const [polarizerAngle, setPolarizerAngle] = useState(0);
  const [qwpAngle, setQwpAngle] = useState(0);
  const [useQWP, setUseQWP] = useState(false);
  const [recordedMeasurements, setRecordedMeasurements] = useState<MeasurementRecord[]>([]);
  const [measurementIdCounter, setMeasurementIdCounter] = useState(0);

  // ─── Generate random Stokes vector on unit sphere ───────────────
  const generateTarget = useCallback(() => {
    const psi = Math.random() * Math.PI;
    const chi = (Math.random() - 0.5) * Math.PI / 2;
    const S1 = Math.cos(2 * chi) * Math.cos(2 * psi);
    const S2 = Math.cos(2 * chi) * Math.sin(2 * psi);
    const S3 = Math.sin(2 * chi);
    setTargetStokes([1, S1, S2, S3]);
    setTargetGenerated(true);
    setRecordedMeasurements([]);
    setMeasurementIdCounter(0);
  }, []);

  // ─── Compute output intensity with current analyzer settings ────
  const outputIntensity = useMemo(() => {
    if (!targetGenerated) return [[0, 0], [0, 0]] as JonesVec2;

    // Reconstruct Jones from target Stokes
    const [S0, S1, S2, S3] = targetStokes;
    const S0s = S0 === 0 ? 1 : S0;
    const psiT = Math.atan2(S2, S1) / 2;
    const chiT = 0.5 * Math.asin(Math.max(-1, Math.min(1, S3 / S0s)));
    const amp = Math.sqrt(S0);
    const exRe = amp * Math.cos(psiT) * Math.cos(chiT);
    const eyRe = amp * Math.sin(psiT) * Math.cos(chiT);
    const eyIm = amp * Math.sin(chiT);
    const targetJones: JonesVec2 = [[exRe, 0], [eyRe, eyIm]];

    // Apply analyzer: Target → [QWP] → Polarizer → Output
    const polM = linearPolarizer(polarizerAngle);
    if (useQWP) {
      const qwpM = quarterWavePlate(qwpAngle);
      const afterQWP = jonesMatVec(qwpM, targetJones);
      return jonesMatVec(polM, afterQWP);
    }
    return jonesMatVec(polM, targetJones);
  }, [targetStokes, targetGenerated, polarizerAngle, qwpAngle, useQWP]);

  const intensity = useMemo(() => {
    const [Ex, Ey] = outputIntensity;
    return Ex[0] * Ex[0] + Ex[1] * Ex[1] + Ey[0] * Ey[0] + Ey[1] * Ey[1];
  }, [outputIntensity]);

  const isExtinct = intensity < 0.02;

  // ─── Measurement recording ──────────────────────────────────────
  const recordMeasurement = useCallback(() => {
    const newId = measurementIdCounter + 1;
    setMeasurementIdCounter(newId);
    setRecordedMeasurements(prev => [...prev, {
      id: newId,
      polarizerAngle,
      qwpAngle: useQWP ? qwpAngle : null,
      useQWP,
      intensity,
    }]);
  }, [polarizerAngle, qwpAngle, useQWP, intensity, measurementIdCounter]);

  const clearMeasurements = useCallback(() => {
    setRecordedMeasurements([]);
    setMeasurementIdCounter(0);
  }, []);

  // ─── Count extinction measurements ──────────────────────────────
  const extinctionMeasurements = useMemo(() =>
    recordedMeasurements.filter(m => m.intensity < 0.02),
    [recordedMeasurements]
  );

  const noQwpExtinctions = useMemo(() =>
    extinctionMeasurements.filter(m => !m.useQWP),
    [extinctionMeasurements]
  );

  const qwpExtinctions = useMemo(() =>
    extinctionMeasurements.filter(m => m.useQWP),
    [extinctionMeasurements]
  );

  // ─── Compute measured Stokes from recorded extinction angles ────
  const measuredStokes = useMemo((): [number, number, number, number] | null => {
    if (!targetGenerated) return null;
    if (extinctionMeasurements.length < 2) return null;

    // If we have a QWP extinction measurement, use inverse QWP method
    // to determine full Stokes parameters.
    // Physics: extinction at Pol(θ₂) after QWP(α) means
    //   QWP(α) · E_target ∝ [-sinθ₂, cosθ₂]
    //   E_target = QWP(α)⁻¹ · [-sinθ₂, cosθ₂]
    // QWP⁻¹(α) = wavePlate(α, -90°)
    if (qwpExtinctions.length > 0) {
      const meas = qwpExtinctions[0];
      const qwpInv = wavePlate(meas.qwpAngle!, -90);
      const θ2 = (meas.polarizerAngle * Math.PI) / 180;
      const linearVec: JonesVec2 = [[-Math.sin(θ2), 0], [Math.cos(θ2), 0]];
      const targetJones = jonesMatVec(qwpInv, linearVec);
      const rawStokes = stokesFromJonesCalc(targetJones);
      if (rawStokes[0] < 1e-10) return null;
      // Normalize to S0 = 1
      return [1, rawStokes[1] / rawStokes[0], rawStokes[2] / rawStokes[0], rawStokes[3] / rawStokes[0]];
    }

    // If only no-QWP extinctions: determine S1, S2 from the first one
    // Extinction at Pol(θ₁) means E_target ∝ [-sinθ₁, cosθ₁] (purely linear)
    if (noQwpExtinctions.length >= 2) {
      const θ1 = (noQwpExtinctions[0].polarizerAngle * Math.PI) / 180;
      return [1, -Math.cos(2 * θ1), -Math.sin(2 * θ1), 0];
    }

    return null;
  }, [targetGenerated, extinctionMeasurements, qwpExtinctions, noQwpExtinctions]);

  // ─── Score breakdown ────────────────────────────────────────────
  const scoreBreakdown = useMemo(() => {
    if (!measuredStokes || !targetGenerated) return null;
    const [, S1m, S2m, S3m] = measuredStokes;
    const [, S1t, S2t, S3t] = targetStokes;

    const s1Error = Math.abs(S1m - S1t);
    const s2Error = Math.abs(S2m - S2t);
    const s3Error = Math.abs(S3m - S3t);

    // S1 accuracy: 0-30 points (error 0 → 30, error 0.5 → 0)
    const s1Score = Math.max(0, Math.round(30 - s1Error * 60));
    // S2 accuracy: 0-30 points
    const s2Score = Math.max(0, Math.round(30 - s2Error * 60));
    // S3 accuracy: 0-30 points
    const s3Score = Math.max(0, Math.round(30 - s3Error * 60));
    // Measurement efficiency: 0-10 points (2 measurements = 10, +1 meas = -3)
    const efficiencyScore = Math.max(0, Math.round(10 - (recordedMeasurements.length - 2) * 3));

    const total = s1Score + s2Score + s3Score + efficiencyScore;

    return { s1Score, s2Score, s3Score, efficiencyScore, total, s1Error, s2Error, s3Error };
  }, [measuredStokes, targetStokes, targetGenerated, recordedMeasurements.length]);

  // ─── Guidance step tracking ─────────────────────────────────────
  const guidanceStep = useMemo(() => {
    if (!targetGenerated) return 0;
    if (noQwpExtinctions.length === 0) return 1; // Step 1: find extinction without QWP
    if (qwpExtinctions.length === 0) return 2;   // Step 2: add QWP and find extinction
    return 3;                                     // Step 3: compare results
  }, [targetGenerated, noQwpExtinctions.length, qwpExtinctions.length]);

  // ─── Render ─────────────────────────────────────────────────────
  return (
    <div className="flex flex-1 min-h-0">
      {/* Left panel */}
      <ControlPanel open={panelOpen} onClose={onPanelClose} title="实验参数">
        <div className="text-[10px] text-[#6b7280] uppercase tracking-wider font-medium font-mono">偏振态测量</div>

        {/* Target generation */}
        <div className="bg-white border border-[#d4d8e0] rounded p-3 space-y-2">
          <div className="text-[11px] font-semibold text-[#2d3142]">未知偏振态</div>
          <p className="text-[9px] text-[#6b7280]">生成一个随机偏振态，使用可旋转偏振片和1/4波片测量其Stokes参数。</p>
          <Button variant="outline" size="sm" className="w-full text-[10px] border-[#d4d8e0]" onClick={generateTarget}>
            {targetGenerated ? "重新生成" : "生成未知偏振态"}
          </Button>
        </div>

        {targetGenerated && (
          <>
            {/* Guidance steps */}
            <div className="bg-white border border-[#d4d8e0] rounded p-3 space-y-2">
              <div className="text-[11px] font-semibold text-[#2d3142]">测量步骤</div>
              <div className="space-y-1.5">
                {[
                  { step: 1, text: "用偏振片找到消光点，记录测量", done: noQwpExtinctions.length > 0 },
                  { step: 2, text: "加入1/4波片，再次找到消光点，记录测量", done: qwpExtinctions.length > 0 },
                  { step: 3, text: "比较测量结果与真实偏振态", done: measuredStokes !== null },
                ].map(({ step, text, done }) => (
                  <div key={step} className={`flex items-start gap-2 text-[9px] ${guidanceStep === step ? "text-[#2d3142]" : done ? "text-[#008800]" : "text-[#9ca3af]"}`}>
                    <span className={`flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-medium border ${
                      done ? "bg-[#008800] text-white border-[#008800]"
                        : guidanceStep === step ? "bg-white text-[#2d3142] border-[#2d3142]"
                        : "bg-white text-[#9ca3af] border-[#d4d8e0]"
                    }`}>
                      {done ? "✓" : step}
                    </span>
                    <span className={done ? "line-through opacity-60" : ""}>{text}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Analyzer controls */}
            <div className="bg-white border border-[#d4d8e0] rounded p-3 space-y-3">
              <div className="text-[11px] font-semibold text-[#2d3142]">分析元件</div>
              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-[10px] text-[#6b7280]">偏振片角度</span>
                  <span className="text-[10px] text-[#6b7280] tabular-nums" style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>{polarizerAngle.toFixed(1)}°</span>
                </div>
                <Slider value={[polarizerAngle]} onValueChange={([v]) => setPolarizerAngle(v)} min={0} max={180} step={0.5} />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="use-qwp" checked={useQWP} onCheckedChange={(v) => setUseQWP(v === true)} />
                <Label htmlFor="use-qwp" className="text-[10px] text-[#2d3142] cursor-pointer">使用1/4波片</Label>
              </div>
              {useQWP && (
                <div>
                  <div className="flex justify-between mb-1">
                    <span className="text-[10px] text-[#6b7280]">1/4波片角度</span>
                    <span className="text-[10px] text-[#6b7280] tabular-nums" style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>{qwpAngle.toFixed(1)}°</span>
                  </div>
                  <Slider value={[qwpAngle]} onValueChange={([v]) => setQwpAngle(v)} min={-90} max={90} step={0.5} />
                </div>
              )}
            </div>

            {/* Output intensity */}
            <div className="bg-white border border-[#d4d8e0] rounded p-3 space-y-2">
              <div className="text-[11px] font-semibold text-[#2d3142]">探测器读数</div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-4 bg-[#edf0f5] rounded overflow-hidden">
                  <div className="h-full bg-[#cc4444] rounded transition-all" style={{ width: `${Math.min(intensity * 100, 100)}%` }} />
                </div>
                <span className="text-[10px] tabular-nums w-14 text-right" style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>{intensity.toFixed(4)}</span>
              </div>
              {isExtinct && <div className="text-[10px] text-[#008800] bg-[#f0fff0] rounded px-2 py-1 font-medium">✓ 消光</div>}
              <Button
                variant="outline"
                size="sm"
                className="w-full text-[10px] border-[#d4d8e0]"
                onClick={recordMeasurement}
              >
                记录测量点
              </Button>
            </div>

            {/* Recorded measurements list */}
            {recordedMeasurements.length > 0 && (
              <div className="bg-white border border-[#d4d8e0] rounded p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-semibold text-[#2d3142]">
                    测量记录
                    <span className="text-[9px] text-[#6b7280] font-normal ml-1">
                      ({extinctionMeasurements.length} 次消光)
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 text-[9px] text-[#9ca3af] hover:text-[#dc2626] px-1"
                    onClick={clearMeasurements}
                  >
                    清除记录
                  </Button>
                </div>
                <div className="max-h-40 overflow-y-auto space-y-1 custom-scrollbar">
                  {recordedMeasurements.map((m) => (
                    <div
                      key={m.id}
                      className={`flex items-center gap-1.5 text-[9px] px-1.5 py-1 rounded ${
                        m.intensity < 0.02 ? "bg-[#f0fff0] border border-[#c0e8c0]" : "bg-[#fafbfc]"
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                        m.intensity < 0.02 ? "bg-[#008800]" : "bg-[#d4d8e0]"
                      }`} />
                      <span className="text-[#6b7280]">#{m.id}</span>
                      <span style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>
                        P:{m.polarizerAngle.toFixed(1)}°
                      </span>
                      {m.useQWP && (
                        <span style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>
                          Q:{m.qwpAngle!.toFixed(1)}°
                        </span>
                      )}
                      <span className={`tabular-nums ml-auto ${m.intensity < 0.02 ? "text-[#008800]" : "text-[#6b7280]"}`} style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>
                        {m.intensity.toFixed(4)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Comparison table (when measuredStokes available) */}
            {measuredStokes ? (
              <div className="bg-white border border-[#d4d8e0] rounded p-3 space-y-2">
                <div className="text-[11px] font-semibold text-[#2d3142]">测量结果对比</div>
                <div className="border border-[#d4d8e0] rounded overflow-x-auto mobile-x-scroll">
                  <table className="w-full text-[9px]">
                    <thead>
                      <tr className="bg-[#f8f9fb] border-b border-[#d4d8e0]">
                        <th className="px-2 py-1.5 text-left text-[#6b7280] font-medium">参数</th>
                        <th className="px-2 py-1.5 text-right text-[#6b7280] font-medium">真实值</th>
                        <th className="px-2 py-1.5 text-right text-[#6b7280] font-medium">测量值</th>
                        <th className="px-2 py-1.5 text-right text-[#6b7280] font-medium">误差</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { label: "S₁", target: targetStokes[1], measured: measuredStokes[1] },
                        { label: "S₂", target: targetStokes[2], measured: measuredStokes[2] },
                        { label: "S₃", target: targetStokes[3], measured: measuredStokes[3] },
                      ].map(({ label, target, measured }) => {
                        const error = Math.abs(measured - target);
                        const errorColor = error < 0.05 ? "#008800" : error < 0.2 ? "#e8a838" : "#cc4444";
                        return (
                          <tr key={label} className="border-b border-[#edf0f5] last:border-b-0">
                            <td className="px-2 py-1 text-[#2d3142] font-medium">{label}</td>
                            <td className="px-2 py-1 text-right tabular-nums" style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>{target.toFixed(3)}</td>
                            <td className="px-2 py-1 text-right tabular-nums" style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>{measured.toFixed(3)}</td>
                            <td className="px-2 py-1 text-right tabular-nums" style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace", color: errorColor }}>{error.toFixed(3)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="bg-white border border-[#d4d8e0] rounded p-3">
                <div className="text-[10px] text-[#9ca3af] text-center py-2">
                  需要至少2次消光测量
                </div>
              </div>
            )}

            {/* Scoring panel */}
            {scoreBreakdown && (
              <div className="bg-white border border-[#d4d8e0] rounded p-3 space-y-2">
                <div className="text-[11px] font-semibold text-[#2d3142]">测量评分</div>
                <div className="flex items-center gap-2">
                  <div className="text-[24px] font-bold tabular-nums" style={{
                    fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace",
                    color: scoreBreakdown.total > 85 ? "#008800" : scoreBreakdown.total > 60 ? "#e8a838" : "#cc4444"
                  }}>
                    {scoreBreakdown.total}
                  </div>
                  <span className="text-[10px] text-[#6b7280]">/100</span>
                </div>
                <div className="space-y-1.5">
                  {[
                    { label: "S₁ 精度", score: scoreBreakdown.s1Score, max: 30 },
                    { label: "S₂ 精度", score: scoreBreakdown.s2Score, max: 30 },
                    { label: "S₃ 精度", score: scoreBreakdown.s3Score, max: 30 },
                    { label: "测量效率", score: scoreBreakdown.efficiencyScore, max: 10 },
                  ].map(({ label, score, max }) => (
                    <div key={label} className="space-y-0.5">
                      <div className="flex items-center justify-between text-[9px]">
                        <span className="text-[#6b7280]">{label}</span>
                        <span className="tabular-nums" style={{
                          fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace",
                          color: score >= max * 0.8 ? "#008800" : score >= max * 0.5 ? "#e8a838" : "#cc4444"
                        }}>
                          {score}/{max}
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-[#edf0f5] rounded overflow-hidden">
                        <div
                          className="h-full rounded transition-all"
                          style={{
                            width: `${(score / max) * 100}%`,
                            backgroundColor: score >= max * 0.8 ? "#008800" : score >= max * 0.5 ? "#e8a838" : "#cc4444"
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </ControlPanel>

      {/* Right visualization */}
      <div className={isMobile ? "flex-1 flex items-center justify-center p-3" : "flex-1 flex items-center justify-center p-6"}>
        {targetGenerated ? (
          <div className="flex flex-col items-center gap-3">
            <div className="text-[11px] text-[#6b7280]">未知偏振态（隐藏）</div>
            <div className="w-48 h-48 border border-[#d4d8e0] rounded bg-[#f8f9fb] flex items-center justify-center">
              <span className="text-[36px] text-[#d4d8e0]">?</span>
            </div>
            <div className={`text-[10px] text-[#6b7280] mt-2 text-center ${isMobile ? "max-w-[280px] px-2" : ""}`}>
              {guidanceStep === 1 && "调节偏振片寻找消光点，然后点击「记录测量点」"}
              {guidanceStep === 2 && "勾选「使用1/4波片」，调节波片和偏振片再次找消光"}
              {guidanceStep === 3 && "测量完成！查看左侧评分面板"}
            </div>
          </div>
        ) : (
          <div className="text-[12px] text-[#6b7280]">点击"生成未知偏振态"开始实验</div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// MODE 3: Depolarization Simulation (消偏振与退偏模拟)
// ═══════════════════════════════════════════════════════════════════
function DepolarizationMode({ panelOpen, onPanelClose }: { panelOpen: boolean; onPanelClose: () => void }) {
  const isMobile = useIsMobile();
  const [inputState, setInputState] = useState<JonesVec2>(LP45);
  const [concentration, setConcentration] = useState(0);

  const depolFactor = concentration / 100;

  // Compute through depolarizer
  const inputStokes = useMemo(() => stokesFromJones(inputState), [inputState]);
  const depolMueller = useMemo(() => depolarizerMueller(depolFactor), [depolFactor]);
  const outputStokes = useMemo(() => applyMuellerToStokes(depolMueller, inputStokes), [depolMueller, inputStokes]);
  const dop = useMemo(() => degreeOfPolarization(outputStokes), [outputStokes]);

  // Reconstruct output Jones for visualization
  const outputJones = useMemo((): JonesVec2 => {
    const [S0, S1, S2, S3] = outputStokes;
    const S0s = S0 === 0 ? 1 : S0;
    const psi = Math.atan2(S2, S1) / 2;
    const chi = 0.5 * Math.asin(Math.max(-1, Math.min(1, S3 / S0s)));
    const amp = Math.sqrt(S0);
    return [[amp * Math.cos(psi) * Math.cos(chi), 0], [amp * Math.sin(psi) * Math.cos(chi), amp * Math.sin(chi)]];
  }, [outputStokes]);

  const inputPol = useMemo(() => analyzePolarization(inputState), [inputState]);
  const outputPol = useMemo(() => analyzePolarization(outputJones), [outputJones]);

  // DOP color
  const dopColor = dop > 0.8 ? "#008800" : dop > 0.4 ? "#e8a838" : "#cc4444";
  const dopLabel = dop > 0.8 ? "高偏振" : dop > 0.4 ? "中等偏振" : "低偏振";

  // DOP curve data
  const dopCurve = useMemo(() => {
    const pts: { x: number; y: number }[] = [];
    for (let c = 0; c <= 100; c += 2) {
      const df = c / 100;
      const mD = depolarizerMueller(df);
      const outS = applyMuellerToStokes(mD, inputStokes);
      pts.push({ x: c, y: degreeOfPolarization(outS) });
    }
    return pts;
  }, [inputStokes]);

  return (
    <div className="flex flex-1 min-h-0">
      {/* Left panel */}
      <ControlPanel open={panelOpen} onClose={onPanelClose} title="实验参数">
        <div className="text-[10px] text-[#6b7280] uppercase tracking-wider font-medium font-mono">消偏振模拟</div>

        {/* Input state */}
        <div className="bg-white border border-[#d4d8e0] rounded p-3 space-y-2">
          <div className="text-[11px] font-semibold text-[#2d3142]">入射偏振态</div>
          <div className="flex gap-1 flex-wrap">
            {Object.entries(INPUT_STATES).map(([key, { label }]) => (
              <Button key={key} variant="outline" size="sm" className="h-6 text-[9px] px-2 border-[#d4d8e0]" onClick={() => setInputState(INPUT_STATES[key].jones)}>{label}</Button>
            ))}
          </div>
        </div>

        {/* Depolarizer parameters */}
        <div className="bg-white border border-[#d4d8e0] rounded p-3 space-y-3">
          <div className="text-[11px] font-semibold text-[#2d3142]">退偏器参数</div>
          <div>
            <div className="flex justify-between mb-1">
              <span className="text-[10px] text-[#6b7280]">散射浓度</span>
              <span className="text-[10px] text-[#6b7280] tabular-nums" style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>{concentration.toFixed(0)}%</span>
            </div>
            <Slider value={[concentration]} onValueChange={([v]) => setConcentration(v)} min={0} max={100} step={1} />
          </div>
          <div className="text-[9px] text-[#6b7280]">退偏因子 d = {depolFactor.toFixed(2)}</div>
        </div>

        {/* DOP display */}
        <div className="bg-white border border-[#d4d8e0] rounded p-3 space-y-2">
          <div className="text-[11px] font-semibold text-[#2d3142]">偏振度 DOP</div>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full border-2 flex items-center justify-center" style={{ borderColor: dopColor }}>
              <span className="text-[14px] font-bold tabular-nums" style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace", color: dopColor }}>
                {(dop * 100).toFixed(0)}
              </span>
            </div>
            <div>
              <div className="text-[10px] font-medium" style={{ color: dopColor }}>{dopLabel}</div>
              <div className="text-[10px] text-[#6b7280] tabular-nums" style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>DOP = {dop.toFixed(4)}</div>
            </div>
          </div>
          <div className="h-2 bg-[#edf0f5] rounded overflow-hidden">
            <div className="h-full rounded transition-all" style={{ width: `${dop * 100}%`, backgroundColor: dopColor }} />
          </div>
        </div>

        {/* Stokes comparison */}
        <div className="bg-white border border-[#d4d8e0] rounded p-3 space-y-1 text-[10px]">
          <div className="text-[11px] font-semibold text-[#2d3142] mb-1">Stokes参数</div>
          {["S₀", "S₁", "S₂", "S₃"].map((label, i) => (
            <div key={label} className="flex justify-between">
              <span className="text-[#6b7280]">{label}</span>
              <span className="tabular-nums" style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>
                {inputStokes[i].toFixed(3)} → {outputStokes[i].toFixed(3)}
              </span>
            </div>
          ))}
        </div>

        {/* DOP curve */}
        <div className="bg-white border border-[#d4d8e0] rounded p-3 space-y-2">
          <div className="text-[11px] font-semibold text-[#2d3142]">DOP vs 浓度</div>
          <svg width="100%" viewBox="0 0 260 100" className="border border-[#d4d8e0] rounded">
            <line x1="30" y1="5" x2="30" y2="85" stroke="#9ca3af" strokeWidth="0.5" />
            <line x1="30" y1="85" x2="255" y2="85" stroke="#9ca3af" strokeWidth="0.5" />
            <text x="28" y="12" fontSize="7" fill="#6b7280" textAnchor="end">1</text>
            <text x="28" y="88" fontSize="7" fill="#6b7280" textAnchor="end">0</text>
            <text x="30" y="96" fontSize="7" fill="#6b7280">0</text>
            <text x="130" y="96" fontSize="7" fill="#6b7280" textAnchor="middle">50%</text>
            <text x="255" y="96" fontSize="7" fill="#6b7280" textAnchor="end">100%</text>
            <polyline
              fill="none"
              stroke="#cc4444"
              strokeWidth="1.5"
              points={dopCurve.map(p => `${30 + p.x * 2.25},${85 - p.y * 80}`).join(" ")}
            />
            {/* Current point */}
            <circle cx={30 + concentration * 2.25} cy={85 - dop * 80} r="3" fill="#cc4444" />
          </svg>
        </div>
      </ControlPanel>

      {/* Right visualization */}
      <div className={isMobile ? "flex-1 flex flex-col items-center justify-center gap-3 p-3" : "flex-1 flex items-center justify-center gap-8 p-6"}>
        <div className="flex flex-col items-center gap-2">
          <PolarizationCanvas polarization={inputPol} jones={inputState} label="输入偏振态" size={isMobile ? 180 : 240} showVector={true} showTrail={true} />
          <span className="text-[10px] text-[#6b7280]">入射 (DOP=1.00)</span>
        </div>
        <svg width="60" height="24" viewBox="0 0 60 24">
          <line x1="4" y1="12" x2="24" y2="12" stroke="#9ca3af" strokeWidth="1" />
          <rect x="24" y="4" width="12" height="16" fill="none" stroke="#d4d8e0" strokeWidth="1" />
          <text x="30" y="15" textAnchor="middle" fontSize="7" fill="#6b7280">D</text>
          <line x1="36" y1="12" x2="56" y2="12" stroke="#9ca3af" strokeWidth="1" />
          <polygon points="52,8 60,12 52,16" fill="#9ca3af" />
        </svg>
        <div className="flex flex-col items-center gap-2">
          <PolarizationCanvas polarization={outputPol} jones={outputJones} label="输出偏振态" size={isMobile ? 180 : 240} showVector={true} showTrail={true} />
          <span className="text-[10px] tabular-nums" style={{ color: dopColor }}>出射 (DOP={dop.toFixed(2)})</span>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// MODE 4: Convergent Polarization Interference (偏光显微镜模式)
// ═══════════════════════════════════════════════════════════════════
function MicroscopeMode({ panelOpen, onPanelClose }: { panelOpen: boolean; onPanelClose: () => void }) {
  const isMobile = useIsMobile();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const [thickness, setThickness] = useState(0.03); // mm
  const [birefringence, setBirefringence] = useState(0.009); // delta n
  const [convergenceAngle, setConvergenceAngle] = useState(15); // degrees
  const [wavelength, setWavelength] = useState(550); // nm

  // Draw the interference pattern
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const size = 400;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;

    let running = true;

    const draw = () => {
      if (!running || !ctx) return;
      ctx.save();
      ctx.scale(dpr, dpr);

      const cx = size / 2;
      const cy = size / 2;
      const maxR = size / 2 - 10;
      const convRad = (convergenceAngle * Math.PI) / 180;

      // Clear to dark (crossed polarizers background)
      ctx.fillStyle = "#1a1a2e";
      ctx.fillRect(0, 0, size, size);

      // Draw interference pattern pixel by pixel using imageData for performance
      const imageData = ctx.createImageData(size, size);
      const data = imageData.data;

      for (let py = 0; py < size; py++) {
        for (let px = 0; px < size; px++) {
          const dx = px + 0.5 - cx;
          const dy = py + 0.5 - cy;
          const r = Math.sqrt(dx * dx + dy * dy);
          const idx = (py * size + px) * 4;

          if (r > maxR) {
            // Outside aperture
            data[idx] = 248; data[idx + 1] = 249; data[idx + 2] = 251; data[idx + 3] = 255;
            continue;
          }

          // Normalized position within convergence cone
          const nx = dx / maxR;
          const ny = dy / maxR;
          const nr = r / maxR;

          // Incidence angle proportional to radial position
          const thetaInc = nr * convRad;

          // Isogyre: dark cross where vibration directions align with polarizer/analyzer
          // The cross is along the horizontal and vertical directions
          const azimuth = Math.atan2(ny, nx);
          const sin2az = Math.sin(2 * azimuth);
          // Isogyre intensity: sin²(2φ), where φ is the azimuth of the vibration direction
          // For uniaxial crystal, isogyres form a cross
          const isogyreFactor = sin2az * sin2az;

          // Retardation depends on incidence angle and thickness
          // δ(θ) = 2π · Δn · d · cos(θ') / λ, where θ' is the refracted angle
          const no = 1.544;
          const sinThetaPrime = no * Math.sin(thetaInc) / (no + birefringence);
          const cosThetaPrime = Math.sqrt(Math.max(0, 1 - sinThetaPrime * sinThetaPrime));
          const retNm = birefringence * thickness * 1e6 * cosThetaPrime; // nm
          const retRad = (2 * Math.PI * retNm) / wavelength;

          // Intensity through crossed polarizers with uniaxial crystal
          // I = I0 · sin²(2φ) · sin²(δ/2)
          const sinHalfDelta = Math.sin(retRad / 2);
          const intensity = isogyreFactor * sinHalfDelta * sinHalfDelta;

          // Get interference color from retardation
          const colorStr = michelLevyColor(retNm);
          const cr = parseInt(colorStr.slice(1, 3), 16);
          const cg = parseInt(colorStr.slice(3, 5), 16);
          const cb = parseInt(colorStr.slice(5, 7), 16);

          // Mix color with intensity and isogyre
          const bright = Math.min(1, intensity * 3);
          const darkFactor = 1 - isogyreFactor * 0.85; // Isogyres darken

          data[idx] = Math.round(cr * bright * darkFactor);
          data[idx + 1] = Math.round(cg * bright * darkFactor);
          data[idx + 2] = Math.round(cb * bright * darkFactor);
          data[idx + 3] = 255;
        }
      }

      blitImageData(ctx, imageData, size, size);

      // Draw aperture circle
      ctx.beginPath();
      ctx.arc(cx, cy, maxR, 0, 2 * Math.PI);
      ctx.strokeStyle = "#d4d8e0";
      ctx.lineWidth = 1;
      ctx.stroke();

      // Cross-hair lines
      ctx.strokeStyle = "rgba(200, 200, 210, 0.3)";
      ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(cx - maxR, cy); ctx.lineTo(cx + maxR, cy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, cy - maxR); ctx.lineTo(cx, cy + maxR); ctx.stroke();

      ctx.restore();
    };

    draw();
    return () => { running = false; };
  }, [thickness, birefringence, convergenceAngle, wavelength]);

  return (
    <div className="flex flex-1 min-h-0">
      {/* Left panel */}
      <ControlPanel open={panelOpen} onClose={onPanelClose} title="实验参数">
        <div className="text-[10px] text-[#6b7280] uppercase tracking-wider font-medium font-mono">偏光显微镜</div>

        <div className="bg-white border border-[#d4d8e0] rounded p-3 space-y-3">
          <div className="text-[11px] font-semibold text-[#2d3142]">晶体参数</div>
          <div>
            <div className="flex justify-between mb-1">
              <span className="text-[10px] text-[#6b7280]">晶体厚度</span>
              <span className="text-[10px] text-[#6b7280] tabular-nums" style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>{(thickness * 1000).toFixed(0)} μm</span>
            </div>
            <Slider value={[thickness * 1000]} onValueChange={([v]) => setThickness(v / 1000)} min={5} max={100} step={1} />
          </div>
          <div>
            <div className="flex justify-between mb-1">
              <span className="text-[10px] text-[#6b7280]">双折射率 Δn</span>
              <span className="text-[10px] text-[#6b7280] tabular-nums" style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>{birefringence.toFixed(4)}</span>
            </div>
            <Slider value={[birefringence * 10000]} onValueChange={([v]) => setBirefringence(v / 10000)} min={1} max={30} step={1} />
          </div>
          <div>
            <div className="flex justify-between mb-1">
              <span className="text-[10px] text-[#6b7280]">会聚角</span>
              <span className="text-[10px] text-[#6b7280] tabular-nums" style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>{convergenceAngle.toFixed(0)}°</span>
            </div>
            <Slider value={[convergenceAngle]} onValueChange={([v]) => setConvergenceAngle(v)} min={5} max={40} step={1} />
          </div>
          <div>
            <div className="flex justify-between mb-1">
              <span className="text-[10px] text-[#6b7280]">波长 λ</span>
              <span className="text-[10px] text-[#6b7280] tabular-nums" style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>{wavelength} nm</span>
            </div>
            <Slider value={[wavelength]} onValueChange={([v]) => setWavelength(v)} min={400} max={700} step={5} />
          </div>
        </div>

        {/* Retardation info */}
        <div className="bg-white border border-[#d4d8e0] rounded p-3 space-y-1 text-[10px]">
          <div className="text-[11px] font-semibold text-[#2d3142] mb-1">中心延迟量</div>
          <div className="flex justify-between">
            <span className="text-[#6b7280]">δ (正入射)</span>
            <span className="tabular-nums" style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>{(birefringence * thickness * 1e6).toFixed(0)} nm</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#6b7280]">δ / λ</span>
            <span className="tabular-nums" style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>{(birefringence * thickness * 1e6 / wavelength).toFixed(2)} λ</span>
          </div>
        </div>

        {/* Legend */}
        <div className="bg-white border border-[#d4d8e0] rounded p-3 space-y-2">
          <div className="text-[11px] font-semibold text-[#2d3142]">图样说明</div>
          <div className="text-[9px] text-[#6b7280] space-y-1">
            <p><span className="font-medium text-[#1a1a2e]">黑十字 (Isogyres)</span> — 振动方向平行于偏振片/检偏器方向的区域消光</p>
            <p><span className="font-medium text-[#1a1a2e]">彩色环 (Isochromates)</span> — 等延迟干涉环，颜色对应Michel-Lévy色谱</p>
            <p>正交偏光镜下，单轴晶体的锥光干涉图呈对称黑十字+同心彩色环。</p>
          </div>
        </div>

        {/* Michel-Levy chart strip */}
        <div className="bg-white border border-[#d4d8e0] rounded p-3 space-y-2">
          <div className="text-[11px] font-semibold text-[#2d3142]">Michel-Lévy 色谱条</div>
          <div className="h-4 rounded overflow-hidden flex">
            {Array.from({ length: 100 }, (_, i) => {
              const ret = i * 20; // 0 to 2000nm
              return <div key={i} className="flex-1" style={{ backgroundColor: michelLevyColor(ret) }} />;
            })}
          </div>
          <div className="flex justify-between text-[8px] text-[#6b7280]">
            <span>0 nm</span>
            <span>1000 nm</span>
            <span>2000 nm</span>
          </div>
        </div>
      </ControlPanel>

      {/* Right visualization */}
      <div className={isMobile ? "flex-1 flex items-center justify-center p-3" : "flex-1 flex items-center justify-center p-6"}>
        <div className="flex flex-col items-center gap-3">
          <canvas ref={canvasRef} style={{ width: isMobile ? "min(85vw, 400px)" : 400, height: isMobile ? "min(85vw, 400px)" : 400 }} className="border border-[#d4d8e0] rounded" />
          <div className="text-[10px] text-[#6b7280]">正交偏光镜下锥光干涉图</div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────
let nextElementId = 1;

export default function JonesPolarizationLab({ onBack }: { onBack: () => void }) {
  const isMobile = useIsMobile();
  const [panelOpen, setPanelOpen] = useState(false);
  const [expMode, setExpMode] = useState<ExperimentMode>("basic");

  // Basic mode states
  const [inputState, setInputState] = useState("LP45");
  const [elements, setElements] = useState<OpticalElement[]>([]);
  const [addingType, setAddingType] = useState<ElementType>("polarizer");
  const [showEx, setShowEx] = useState(true);
  const [showEy, setShowEy] = useState(true);
  const [showComposite, setShowComposite] = useState(true);
  const [viewTab, setViewTab] = useState<"ellipse" | "poincare" | "efield" | "3dellipse">("ellipse");

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
    setElements((prev) => prev.map((el) => (el.id === id ? { ...el, angle } : el)));
  }, []);

  const updateRetardation = useCallback((id: string, retardation: number) => {
    setElements((prev) => prev.map((el) => (el.id === id ? { ...el, retardation } : el)));
  }, []);

  return (
    <AnimationTimeProvider>
      {(animTime) => (
        <div className="h-full flex flex-col bg-[#FFFFFF]">
          {/* Header */}
          <div className={`flex-shrink-0 flex items-center ${isMobile ? "h-11 px-4" : "h-12 px-6"} border-b border-[#d4d8e0]`}>
            <button
              onClick={onBack}
              className="text-[12px] font-normal text-[#555] hover:text-[#1a1a2e] transition-colors bg-transparent border-none cursor-pointer flex items-center gap-1"
            >
              ← 返回
            </button>
            <span className="mx-3 text-[#d4d8e0]">|</span>
            <h1 className={`${isMobile ? "text-[17px]" : "text-[20px]"} font-semibold text-[#1a1a2e] m-0`}>
              偏振琼斯矩阵实验室
            </h1>
            <MobilePanelToggle onClick={() => setPanelOpen(true)} label="参数" />
          </div>

          {/* Experiment Mode Tabs */}
          <div className={`flex-shrink-0 flex items-center gap-1 ${isMobile ? "px-3 py-2 overflow-x-auto mobile-x-scroll flex-nowrap" : "px-6 py-2"} border-b border-[#d4d8e0] bg-[#f8f9fb]`}>
            {EXP_MODE_TABS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setExpMode(key)}
                className={`text-[10px] px-3 py-1.5 rounded border transition-colors flex-shrink-0 whitespace-nowrap ${
                  expMode === key
                    ? "bg-[#F0F3F6] text-[#333] border-[#333] font-medium"
                    : "bg-white text-[#6b7280] border-[#D0D0D0] hover:bg-[#F0F3F6]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Mode content */}
          {expMode === "basic" && (
            <div className="flex flex-1 min-h-0">
              {/* Left control panel */}
              <ControlPanel open={panelOpen} onClose={() => setPanelOpen(false)} title="实验参数">
                {/* Input state selector */}
                <div>
                  <div className="text-[12px] font-semibold text-[#1a1a2e] mb-2 pb-1.5 border-b border-[#d4d8e0]">输入偏振态</div>
                  <Select value={inputState} onValueChange={setInputState}>
                    <SelectTrigger className="w-full h-8 text-[11px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(INPUT_STATES).map(([key, { label }]) => (
                        <SelectItem key={key} value={key}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Element chain */}
                <div>
                  <div className="text-[12px] font-semibold text-[#1a1a2e] mb-2 pb-1.5 border-b border-[#d4d8e0]">光学元件链</div>
                  <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                    {elements.map((el) => (
                      <ElementCard key={el.id} element={el} onAngleChange={updateAngle} onRetardationChange={updateRetardation} onRemove={removeElement} />
                    ))}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <Select value={addingType} onValueChange={(v) => setAddingType(v as ElementType)}>
                      <SelectTrigger className="flex-1 h-7 text-[10px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(ELEMENT_INFO).map(([key, info]) => (
                          <SelectItem key={key} value={key}>{info.symbol} {info.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button variant="outline" size="sm" className="h-7 text-[10px] px-3 border-[#d4d8e0] hover:bg-[#edf0f5]" onClick={addElement}>+ 添加</Button>
                  </div>
                </div>

                {/* View tabs */}
                <div>
                  <div className="text-[12px] font-semibold text-[#1a1a2e] mb-2 pb-1.5 border-b border-[#d4d8e0]">可视化视图</div>
                  <div className="flex gap-1">
                    {([
                      { key: "ellipse", label: "偏振椭圆" },
                      { key: "poincare", label: "庞加莱球" },
                      { key: "efield", label: "电场螺旋" },
                      { key: "3dellipse", label: "3D偏振椭圆" },
                    ] as const).map(({ key, label }) => (
                      <button
                        key={key}
                        onClick={() => setViewTab(key)}
                        className={`flex-1 text-[10px] py-1.5 rounded border transition-colors ${
                          viewTab === key ? "bg-[#2d3142] text-white border-[#2d3142]" : "bg-white text-[#4a4a5a] border-[#d4d8e0] hover:bg-[#edf0f5]"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* E-field display options */}
                {viewTab === "efield" && (
                  <div>
                    <div className="text-[12px] font-semibold text-[#1a1a2e] mb-2 pb-1.5 border-b border-[#d4d8e0]">电场分量</div>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Checkbox id="show-ex" checked={showEx} onCheckedChange={(v) => setShowEx(v === true)} />
                        <Label htmlFor="show-ex" className="text-[11px] text-[#cc4444] cursor-pointer">Ex 分量 (红)</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <Checkbox id="show-ey" checked={showEy} onCheckedChange={(v) => setShowEy(v === true)} />
                        <Label htmlFor="show-ey" className="text-[11px] text-[#44aa44] cursor-pointer">Ey 分量 (绿)</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <Checkbox id="show-composite" checked={showComposite} onCheckedChange={(v) => setShowComposite(v === true)} />
                        <Label htmlFor="show-composite" className="text-[11px] text-[#2d3142] cursor-pointer">合电场 (黑)</Label>
                      </div>
                    </div>
                  </div>
                )}

                {/* Output polarization info */}
                <div>
                  <div className="text-[12px] font-semibold text-[#1a1a2e] mb-2 pb-1.5 border-b border-[#d4d8e0]">输出偏振态</div>
                  <div className="bg-white border border-[#d4d8e0] rounded p-2.5 space-y-1 text-[10px]">
                    <div className="flex justify-between"><span className="text-[#6b7280]">类型</span><span className="text-[#1a1a2e]">{getPolTypeName(outputPol.chi, outputPol.handedness)}</span></div>
                    <div className="flex justify-between"><span className="text-[#6b7280]">方位角 ψ</span><span className="text-[#1a1a2e] tabular-nums" style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>{(outputPol.psi * 180 / Math.PI).toFixed(1)}°</span></div>
                    <div className="flex justify-between"><span className="text-[#6b7280]">椭圆率角 χ</span><span className="text-[#1a1a2e] tabular-nums" style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>{(outputPol.chi * 180 / Math.PI).toFixed(1)}°</span></div>
                    <div className="flex justify-between"><span className="text-[#6b7280]">DOP</span><span className="tabular-nums" style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace", color: outputDOP > 0.99 ? "#008800" : "#1a1a2e" }}>{outputDOP.toFixed(4)}</span></div>
                    <div className="flex justify-between"><span className="text-[#6b7280]">S₁</span><span className="tabular-nums" style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>{outputStokes[1].toFixed(4)}</span></div>
                    <div className="flex justify-between"><span className="text-[#6b7280]">S₂</span><span className="tabular-nums" style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>{outputStokes[2].toFixed(4)}</span></div>
                    <div className="flex justify-between"><span className="text-[#6b7280]">S₃</span><span className="tabular-nums" style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace" }}>{outputStokes[3].toFixed(4)}</span></div>
                  </div>
                </div>

                <FaradayDemo inputJones={inputJones} elements={elements} />
                <JonesMatrixDisplay elements={elements} />
                {chainSteps.length > 0 && (
                  <div>
                    <div className="text-[12px] font-semibold text-[#1a1a2e] mb-2 pb-1.5 border-b border-[#d4d8e0]">传播步骤</div>
                    <ChainStepTable steps={chainSteps} />
                  </div>
                )}
              </ControlPanel>

              {/* Right visualization area */}
              <div className="flex-1 flex flex-col min-h-0">
                {viewTab === "ellipse" && (
                  <div className={isMobile ? "flex-1 flex flex-col items-center justify-center gap-3 p-3" : "flex-1 flex items-center justify-center gap-8 p-6"}>
                    <div className="flex flex-col items-center gap-2">
                      <PolarizationCanvas polarization={inputPol} jones={inputJones} label="输入偏振态" size={isMobile ? 200 : 280} showVector={true} showTrail={true} />
                      <span className="text-[11px] text-[#6b7280]">入射</span>
                    </div>
                    <div className="flex items-center">
                      <svg width="48" height="24" viewBox="0 0 48 24"><line x1="4" y1="12" x2="32" y2="12" stroke="#9ca3af" strokeWidth="1" /><polygon points="32,8 40,12 32,16" fill="#9ca3af" /></svg>
                    </div>
                    <div className="flex flex-col items-center gap-2">
                      <PolarizationCanvas polarization={outputPol} jones={outputJones} label="输出偏振态" size={isMobile ? 200 : 280} showVector={true} showTrail={true} />
                      <span className="text-[11px] text-[#6b7280]">出射</span>
                    </div>
                  </div>
                )}
                {viewTab === "poincare" && (
                  <div className="flex-1 min-h-0">
                    <Canvas camera={{ position: [3.5, 2.5, 3.5], fov: 45, near: 0.1, far: 50 }} style={{ width: "100%", height: "100%" }}>
                      <ambientLight intensity={0.6} />
                      <directionalLight position={[5, 5, 5]} intensity={0.4} />
                      <PoincareSphere inputStokes={inputStokes} outputStokes={outputStokes} chainSteps={chainSteps} animTime={animTime} />
                      <OrbitControls enableDamping dampingFactor={0.1} rotateSpeed={0.8} />
                    </Canvas>
                  </div>
                )}
                {viewTab === "efield" && (
                  <div className="flex-1 min-h-0">
                    <Canvas camera={{ position: [3, 2, 3], fov: 45, near: 0.1, far: 50 }} style={{ width: "100%", height: "100%" }}>
                      <ambientLight intensity={0.6} />
                      <directionalLight position={[5, 5, 5]} intensity={0.4} />
                      <EFieldHelix jones={outputJones} showEx={showEx} showEy={showEy} showComposite={showComposite} animTime={animTime} chainSteps={chainSteps} elements={elements} />
                      <OrbitControls enableDamping dampingFactor={0.1} rotateSpeed={0.8} />
                    </Canvas>
                  </div>
                )}
                {viewTab === "3dellipse" && (
                  <div className="flex-1 min-h-0">
                    <Canvas camera={{ position: [2.5, 2, 3], fov: 45, near: 0.1, far: 50 }} style={{ width: "100%", height: "100%" }}>
                      <ambientLight intensity={0.6} />
                      <directionalLight position={[5, 5, 5]} intensity={0.4} />
                      <PolarizationEllipse3D jones={outputJones} polarization={outputPol} animTime={animTime} elements={elements} />
                      <OrbitControls enableDamping dampingFactor={0.1} rotateSpeed={0.8} />
                    </Canvas>
                  </div>
                )}
              </div>
            </div>
          )}

          {expMode === "babinet_soleil" && <BabinetSoleilMode panelOpen={panelOpen} onPanelClose={() => setPanelOpen(false)} />}
          {expMode === "measurement" && <MeasurementMode panelOpen={panelOpen} onPanelClose={() => setPanelOpen(false)} />}
          {expMode === "depolarization" && <DepolarizationMode panelOpen={panelOpen} onPanelClose={() => setPanelOpen(false)} />}
          {expMode === "microscope" && <MicroscopeMode panelOpen={panelOpen} onPanelClose={() => setPanelOpen(false)} />}
        </div>
      )}
    </AnimationTimeProvider>
  );
}
