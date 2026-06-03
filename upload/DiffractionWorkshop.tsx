"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Line, Text } from "@react-three/drei";
import * as THREE from "three";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  generateAperture,
  computeFraunhoferDiffraction,
  computeFresnelDiffraction,
  intensityToGrayscale,
  intensityToBlueWhite,
  type ApertureType,
  type ApertureParams,
} from "@/lib/optics/diffraction";

const APERTURE_TYPES: Record<ApertureType, string> = {
  circular: "圆孔",
  rectangular: "方孔",
  single_slit: "单缝",
  double_slit: "双缝",
  grating: "矩形光栅",
};

const GRID_SIZE = 256;
const SURFACE_SIZE = 80; // downsample for 3D mesh performance

type ViewMode = "2d" | "3d" | "split";

// ─── Find local peaks in downsampled intensity ─────────────────────
function findPeaks(
  intensity: Float64Array,
  gridSize: number,
  surfaceSize: number,
  maxPeaks: number
): { x: number; z: number; val: number; worldX: number; worldZ: number }[] {
  const S = surfaceSize;
  const step = gridSize / S;
  const candidates: { si: number; sj: number; val: number }[] = [];

  for (let sj = 2; sj < S - 2; sj++) {
    for (let si = 2; si < S - 2; si++) {
      const srcX = Math.min(Math.floor(si * step), gridSize - 1);
      const srcY = Math.min(Math.floor(sj * step), gridSize - 1);
      const v = intensity[srcY * gridSize + srcX];
      if (v < 0.05) continue;
      // Check if local max in 5×5 neighborhood
      let isPeak = true;
      for (let dj = -2; dj <= 2 && isPeak; dj++) {
        for (let di = -2; di <= 2 && isPeak; di++) {
          if (di === 0 && dj === 0) continue;
          const ni = si + di;
          const nj = sj + dj;
          if (ni < 0 || ni >= S || nj < 0 || nj >= S) continue;
          const nSrcX = Math.min(Math.floor(ni * step), gridSize - 1);
          const nSrcY = Math.min(Math.floor(nj * step), gridSize - 1);
          if (intensity[nSrcY * gridSize + nSrcX] > v) isPeak = false;
        }
      }
      if (isPeak) candidates.push({ si, sj, val: v });
    }
  }

  // Sort by intensity descending, take top N, ensure minimum separation
  candidates.sort((a, b) => b.val - a.val);
  const result: { x: number; z: number; val: number; worldX: number; worldZ: number }[] = [];
  const minDist = S * 0.08;
  for (const c of candidates) {
    if (result.length >= maxPeaks) break;
    const worldX = (c.si / S - 0.5) * 4;
    const worldZ = (c.sj / S - 0.5) * 4;
    const tooClose = result.some((r) => {
      const dx = r.worldX - worldX;
      const dz = r.worldZ - worldZ;
      return Math.sqrt(dx * dx + dz * dz) < minDist;
    });
    if (!tooClose) {
      result.push({ x: c.si, z: c.sj, val: c.val, worldX, worldZ });
    }
  }
  return result;
}

// ─── 3D Surface Mesh Component ─────────────────────────────────────
function DiffractionSurface3D({
  intensity,
  gridSize,
  colorMode,
  showWireframe,
  heightScale,
}: {
  intensity: Float64Array;
  gridSize: number;
  colorMode: "grayscale" | "inverted" | "blue-white";
  showWireframe: boolean;
  heightScale: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null);

  const { geometry, wireframeGeo, peaks } = useMemo(() => {
    const S = SURFACE_SIZE;
    // Build geometry manually: XZ plane, Y up (linear intensity for height)
    const vertexCount = S * S;
    const indexCount = (S - 1) * (S - 1) * 6;
    const positions = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 3);
    const indices = new Uint32Array(indexCount);
    const step = gridSize / S;

    for (let j = 0; j < S; j++) {
      for (let i = 0; i < S; i++) {
        const idx = j * S + i;
        const srcX = Math.min(Math.floor(i * step), gridSize - 1);
        const srcY = Math.min(Math.floor(j * step), gridSize - 1);
        const rawVal = intensity[srcY * gridSize + srcX];
        const linearVal = Math.max(0, Math.min(1, rawVal)); // true linear intensity
        const gammaVal = Math.pow(linearVal, 0.4); // gamma for color only

        // XZ plane, Y = intensity * heightScale
        positions[idx * 3] = (i / (S - 1) - 0.5) * 4;     // X: spatial x [-2, 2]
        positions[idx * 3 + 1] = linearVal * heightScale;    // Y: intensity (up)
        positions[idx * 3 + 2] = (j / (S - 1) - 0.5) * 4;  // Z: spatial y [-2, 2]

        // Vertex color (gamma-corrected for visibility)
        let r: number, g: number, b: number;
        switch (colorMode) {
          case "grayscale": {
            const gray = 1 - gammaVal;
            r = gray; g = gray; b = gray;
            break;
          }
          case "inverted": {
            const gray = gammaVal;
            r = gray; g = gray; b = gray;
            break;
          }
          case "blue-white": {
            r = gammaVal;
            g = gammaVal;
            b = 0.78 + 0.22 * gammaVal;
            break;
          }
          default: {
            r = 1 - gammaVal; g = 1 - gammaVal; b = 1 - gammaVal;
          }
        }
        colors[idx * 3] = r;
        colors[idx * 3 + 1] = g;
        colors[idx * 3 + 2] = b;
      }
    }

    // Build triangle indices
    let idxPtr = 0;
    for (let j = 0; j < S - 1; j++) {
      for (let i = 0; i < S - 1; i++) {
        const a = j * S + i;
        const b = a + 1;
        const c = a + S;
        const d = c + 1;
        indices[idxPtr++] = a;
        indices[idxPtr++] = c;
        indices[idxPtr++] = b;
        indices[idxPtr++] = b;
        indices[idxPtr++] = c;
        indices[idxPtr++] = d;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeVertexNormals();

    // Wireframe geometry
    const wGeo = new THREE.WireframeGeometry(geo);

    // Find peaks
    const peakList = findPeaks(intensity, gridSize, SURFACE_SIZE, 8);

    return { geometry: geo, wireframeGeo: wGeo, peaks: peakList };
  }, [intensity, gridSize, colorMode, heightScale]);

  return (
    <group>
      <mesh ref={meshRef} geometry={geometry}>
        <meshStandardMaterial
          vertexColors
          side={THREE.DoubleSide}
          roughness={0.6}
          metalness={0.1}
        />
      </mesh>
      {showWireframe && (
        <lineSegments geometry={wireframeGeo}>
          <lineBasicMaterial color="#2d3142" transparent opacity={0.08} />
        </lineSegments>
      )}

      {/* Peak markers: vertical stems + spheres + value labels */}
      {peaks.map((peak, i) => (
        <group key={`peak-${i}`}>
          {/* Vertical stem from ground to peak */}
          <Line
            points={[
              new THREE.Vector3(peak.worldX, 0, peak.worldZ),
              new THREE.Vector3(peak.worldX, peak.val * heightScale, peak.worldZ),
            ]}
            color="#cc0000"
            lineWidth={1}
            dashed
            dashSize={0.05}
            gapSize={0.03}
          />
          {/* Peak sphere */}
          <mesh position={[peak.worldX, peak.val * heightScale, peak.worldZ]}>
            <sphereGeometry args={[0.04, 12, 12]} />
            <meshBasicMaterial color={i === 0 ? "#cc0000" : "#e06060"} />
          </mesh>
          {/* Value label */}
          <Text
            position={[peak.worldX + 0.12, peak.val * heightScale + 0.1, peak.worldZ]}
            fontSize={0.07}
            color={i === 0 ? "#cc0000" : "#6b7280"}
            anchorX="left"
            anchorY="bottom"
          >
            {peak.val.toFixed(3)}
          </Text>
        </group>
      ))}

      {/* Base plane reference (translucent) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.005, 0]}>
        <planeGeometry args={[4, 4]} />
        <meshBasicMaterial color="#f8f9fb" transparent opacity={0.5} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

// ─── 3D Axis Labels ────────────────────────────────────────────────
function AxisLabels({ heightScale }: { heightScale: number }) {
  return (
    <group>
      {/* X axis (spatial x) */}
      <Line
        points={[new THREE.Vector3(-2.2, 0, 0), new THREE.Vector3(2.2, 0, 0)]}
        color="#9ca3af"
        lineWidth={0.8}
      />
      {/* Z axis (spatial y) */}
      <Line
        points={[new THREE.Vector3(0, 0, -2.2), new THREE.Vector3(0, 0, 2.2)]}
        color="#9ca3af"
        lineWidth={0.8}
      />
      {/* Y axis (intensity, up) */}
      <Line
        points={[new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, heightScale + 0.3, 0)]}
        color="#9ca3af"
        lineWidth={0.8}
      />
      {/* Y tick marks with values */}
      {[0.25, 0.5, 0.75, 1.0].map((v) => {
        const y = v * heightScale;
        if (y > heightScale + 0.1) return null;
        return (
          <group key={`ytick-${v}`}>
            <Line
              points={[new THREE.Vector3(-0.08, y, 0), new THREE.Vector3(0.08, y, 0)]}
              color="#9ca3af"
              lineWidth={0.5}
            />
            <Text
              position={[-0.15, y, 0]}
              fontSize={0.07}
              color="#9ca3af"
              anchorX="right"
              anchorY="middle"
            >
              {v.toFixed(2)}
            </Text>
            {/* Horizontal reference grid line at this Y level */}
            <Line
              points={[new THREE.Vector3(-2, y, -2), new THREE.Vector3(2, y, -2)]}
              color="#ebeef2"
              lineWidth={0.3}
            />
          </group>
        );
      })}
      {/* X tick marks */}
      {[-2, -1, 0, 1, 2].map((v) => (
        <group key={`xtick-${v}`}>
          <Line
            points={[new THREE.Vector3(v, 0, -0.06), new THREE.Vector3(v, 0, 0.06)]}
            color="#9ca3af"
            lineWidth={0.5}
          />
          <Text
            position={[v, -0.12, 0.1]}
            fontSize={0.06}
            color="#9ca3af"
            anchorX="center"
            anchorY="top"
          >
            {v}
          </Text>
        </group>
      ))}
      {/* Z tick marks */}
      {[-2, -1, 0, 1, 2].map((v) => (
        <group key={`ztick-${v}`}>
          <Line
            points={[new THREE.Vector3(-0.06, 0, v), new THREE.Vector3(0.06, 0, v)]}
            color="#9ca3af"
            lineWidth={0.5}
          />
          <Text
            position={[0.1, -0.12, v]}
            fontSize={0.06}
            color="#9ca3af"
            anchorX="left"
            anchorY="top"
          >
            {v}
          </Text>
        </group>
      ))}
      {/* Axis labels */}
      <Text position={[2.4, -0.1, 0]} fontSize={0.1} color="#4a4a5a" anchorX="center">
        x
      </Text>
      <Text position={[0.1, -0.1, 2.4]} fontSize={0.1} color="#4a4a5a" anchorX="left">
        y
      </Text>
      <Text position={[-0.2, heightScale + 0.35, 0]} fontSize={0.1} color="#cc0000" anchorX="center">
        I/I₀
      </Text>
    </group>
  );
}

// ─── 3D Propagation Scene ──────────────────────────────────────────
function PropagationScene({
  aperture,
  intensity,
  gridSize,
  colorMode,
}: {
  aperture: Float64Array;
  intensity: Float64Array;
  gridSize: number;
  colorMode: "grayscale" | "inverted" | "blue-white";
}) {
  // Build aperture texture
  const apertureTexture = useMemo(() => {
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, size, size);
    const step = gridSize / size;
    ctx.fillStyle = "#ffffff";
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const srcX = Math.min(Math.floor(x * step), gridSize - 1);
        const srcY = Math.min(Math.floor(y * step), gridSize - 1);
        if (aperture[srcY * gridSize + srcX] > 0) {
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }, [aperture, gridSize]);

  // Build diffraction texture
  const diffractionTexture = useMemo(() => {
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, size, size);
    const step = gridSize / size;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const srcX = Math.min(Math.floor(x * step), gridSize - 1);
        const srcY = Math.min(Math.floor(y * step), gridSize - 1);
        const val = Math.pow(intensity[srcY * gridSize + srcX], 0.4);
        const c = Math.round(Math.max(0, Math.min(1, val)) * 255);
        if (colorMode === "blue-white") {
          ctx.fillStyle = `rgb(${c},${c},${Math.round((0.78 + 0.22 * val) * 255)})`;
        } else if (colorMode === "inverted") {
          ctx.fillStyle = `rgb(${c},${c},${c})`;
        } else {
          const gc = 255 - c;
          ctx.fillStyle = `rgb(${gc},${gc},${gc})`;
        }
        ctx.fillRect(x, y, 1, 1);
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }, [intensity, gridSize, colorMode]);

  // Light rays from aperture to screen
  const rays = useMemo(() => {
    const result: THREE.Vector3[][] = [];
    const numRays = 12;
    const halfGrid = gridSize / 2;
    const step = gridSize / numRays;
    // Collect aperture points for ray origins
    for (let i = 0; i < numRays; i++) {
      const srcX = Math.floor(halfGrid - (numRays / 2 - i) * step);
      if (srcX < 0 || srcX >= gridSize) continue;
      const srcY = Math.floor(gridSize / 2);
      if (aperture[srcY * gridSize + srcX] > 0) {
        const x = ((srcX / gridSize) - 0.5) * 2;
        const y = ((srcY / gridSize) - 0.5) * 2;
        result.push([
          new THREE.Vector3(x, y, -2),
          new THREE.Vector3(x * 0.3, y * 0.3, 2),
        ]);
      }
    }
    return result;
  }, [aperture, gridSize]);

  return (
    <group>
      {/* Aperture screen (back plane) */}
      <mesh position={[0, 0, -2]}>
        <planeGeometry args={[2.4, 2.4]} />
        <meshBasicMaterial map={apertureTexture} side={THREE.DoubleSide} />
      </mesh>
      {/* Aperture screen border */}
      <Line
        points={[
          new THREE.Vector3(-1.2, -1.2, -2),
          new THREE.Vector3(1.2, -1.2, -2),
          new THREE.Vector3(1.2, 1.2, -2),
          new THREE.Vector3(-1.2, 1.2, -2),
          new THREE.Vector3(-1.2, -1.2, -2),
        ]}
        color="#4a4a5a"
        lineWidth={1}
      />
      <Text position={[0, 1.4, -2]} fontSize={0.12} color="#4a4a5a" anchorX="center">
        口径面
      </Text>

      {/* Observation screen (front plane) */}
      <mesh position={[0, 0, 2]}>
        <planeGeometry args={[2.4, 2.4]} />
        <meshBasicMaterial map={diffractionTexture} side={THREE.DoubleSide} />
      </mesh>
      <Line
        points={[
          new THREE.Vector3(-1.2, -1.2, 2),
          new THREE.Vector3(1.2, -1.2, 2),
          new THREE.Vector3(1.2, 1.2, 2),
          new THREE.Vector3(-1.2, 1.2, 2),
          new THREE.Vector3(-1.2, -1.2, 2),
        ]}
        color="#4a4a5a"
        lineWidth={1}
      />
      <Text position={[0, 1.4, 2]} fontSize={0.12} color="#4a4a5a" anchorX="center">
        观察面
      </Text>

      {/* Light rays */}
      {rays.map((pts, i) => (
        <Line key={`ray-${i}`} points={pts} color="#e8a838" lineWidth={0.5} transparent opacity={0.4} />
      ))}

      {/* Central ray (optical axis) */}
      <Line
        points={[new THREE.Vector3(0, 0, -2.2), new THREE.Vector3(0, 0, 2.2)]}
        color="#d4d8e0"
        lineWidth={0.5}
      />

      {/* Propagation direction arrow */}
      <Line
        points={[
          new THREE.Vector3(0, -1.4, -1),
          new THREE.Vector3(0, -1.4, 0.8),
        ]}
        color="#9ca3af"
        lineWidth={0.8}
      />
      {/* Arrow head */}
      <Line
        points={[
          new THREE.Vector3(0, -1.4, 0.8),
          new THREE.Vector3(0.06, -1.4, 0.65),
        ]}
        color="#9ca3af"
        lineWidth={0.8}
      />
      <Line
        points={[
          new THREE.Vector3(0, -1.4, 0.8),
          new THREE.Vector3(-0.06, -1.4, 0.65),
        ]}
        color="#9ca3af"
        lineWidth={0.8}
      />
      <Text position={[0, -1.6, 0]} fontSize={0.09} color="#9ca3af" anchorX="center">
        传播方向 z
      </Text>

      {/* Distance annotation */}
      <Line
        points={[new THREE.Vector3(1.4, -1.2, -2), new THREE.Vector3(1.4, -1.2, 2)]}
        color="#9ca3af"
        lineWidth={0.5}
      />
      <Text position={[1.55, -1.2, 0]} fontSize={0.08} color="#9ca3af" anchorX="left">
        d
      </Text>
    </group>
  );
}

// ─── Scene Grid (XZ ground plane) ────────────────────────────────
function SceneGrid() {
  const lines = useMemo(() => {
    const result: THREE.Vector3[][] = [];
    const size = 2;
    const divisions = 8;
    const step = (size * 2) / divisions;
    for (let i = 0; i <= divisions; i++) {
      const pos = -size + i * step;
      // Lines along X
      result.push([
        new THREE.Vector3(-size, -0.005, pos),
        new THREE.Vector3(size, -0.005, pos),
      ]);
      // Lines along Z
      result.push([
        new THREE.Vector3(pos, -0.005, -size),
        new THREE.Vector3(pos, -0.005, size),
      ]);
    }
    return result;
  }, []);

  return (
    <group>
      {lines.map((pts, i) => (
        <Line key={i} points={pts} color="#ebeef2" lineWidth={0.3} />
      ))}
    </group>
  );
}

// ─── Main Component ────────────────────────────────────────────────
export default function DiffractionWorkshop() {
  const [apertureType, setApertureType] = useState<ApertureType>("circular");
  const [apertureSize, setApertureSize] = useState(30);
  const [apertureHeight, setApertureHeight] = useState(60);
  const [slitWidth, setSlitWidth] = useState(8);
  const [slitSeparation, setSlitSeparation] = useState(40);
  const [numGratingSlits, setNumGratingSlits] = useState(5);
  const [gratingPeriod, setGratingPeriod] = useState(30);
  const [fresnelNumber, setFresnelNumber] = useState(0.5);
  const [colorMode, setColorMode] = useState<"grayscale" | "inverted" | "blue-white">("inverted");
  const [diffractionMode, setDiffractionMode] = useState<"fraunhofer" | "fresnel">("fraunhofer");
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [showWireframe, setShowWireframe] = useState(false);
  const [heightScale, setHeightScale] = useState(2.0);
  const [scene3D, setScene3D] = useState<"surface" | "propagation">("surface");

  const apertureCanvasRef = useRef<HTMLCanvasElement>(null);
  const diffractionCanvasRef = useRef<HTMLCanvasElement>(null);
  const crossSectionCanvasRef = useRef<HTMLCanvasElement>(null);

  // Generate aperture
  const apertureParams: ApertureParams = useMemo(() => {
    const base: ApertureParams = {
      type: apertureType,
      gridSize: GRID_SIZE,
    };
    switch (apertureType) {
      case "circular":
        return { ...base, radius: apertureSize };
      case "rectangular":
        return { ...base, halfWidth: apertureSize, halfHeight: apertureHeight };
      case "single_slit":
        return { ...base, slitWidth: slitWidth * 2, halfHeight: apertureHeight };
      case "double_slit":
        return { ...base, slitWidth: slitWidth * 2, slitSeparation, halfHeight: apertureHeight };
      case "grating":
        return {
          ...base,
          gratingSlitWidth: slitWidth,
          gratingPeriod,
          numSlits: numGratingSlits,
          halfHeight: apertureHeight,
        };
      default:
        return base;
    }
  }, [apertureType, apertureSize, apertureHeight, slitWidth, slitSeparation, numGratingSlits, gratingPeriod]);

  const aperture = useMemo(() => generateAperture(apertureParams), [apertureParams]);

  // Compute diffraction
  const diffractionResult = useMemo(() => {
    if (diffractionMode === "fraunhofer") {
      return computeFraunhoferDiffraction(aperture, GRID_SIZE);
    } else {
      return computeFresnelDiffraction(aperture, GRID_SIZE, fresnelNumber);
    }
  }, [aperture, diffractionMode, fresnelNumber]);

  // Draw aperture
  useEffect(() => {
    const canvas = apertureCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const displaySize = 200;
    canvas.width = displaySize * dpr;
    canvas.height = displaySize * dpr;
    canvas.style.width = `${displaySize}`;
    canvas.style.height = `${displaySize}`;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, displaySize, displaySize);

    // Draw grid
    ctx.strokeStyle = "#ebeef2";
    ctx.lineWidth = 0.5;
    const step = displaySize / 20;
    for (let i = 0; i <= 20; i++) {
      ctx.beginPath();
      ctx.moveTo(i * step, 0);
      ctx.lineTo(i * step, displaySize);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * step);
      ctx.lineTo(displaySize, i * step);
      ctx.stroke();
    }

    // Draw aperture
    const pixelSize = displaySize / GRID_SIZE;
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        if (aperture[y * GRID_SIZE + x] > 0) {
          ctx.fillStyle = "#2d3142";
          ctx.fillRect(
            x * pixelSize,
            y * pixelSize,
            Math.ceil(pixelSize),
            Math.ceil(pixelSize)
          );
        }
      }
    }

    // Border
    ctx.strokeStyle = "#d4d8e0";
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, displaySize, displaySize);

    // Axis labels
    ctx.fillStyle = "#9ca3af";
    ctx.font = "9px IBM Plex Sans";
    ctx.textAlign = "center";
    ctx.fillText("x", displaySize / 2, displaySize - 3);
    ctx.save();
    ctx.translate(8, displaySize / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("y", 0, 0);
    ctx.restore();
  }, [aperture]);

  // Draw diffraction pattern (2D)
  useEffect(() => {
    const canvas = diffractionCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const displaySize = 200;
    canvas.width = displaySize * dpr;
    canvas.height = displaySize * dpr;
    canvas.style.width = `${displaySize}`;
    canvas.style.height = `${displaySize}`;
    ctx.scale(dpr, dpr);

    let imageData: ImageData;
    switch (colorMode) {
      case "grayscale":
        imageData = intensityToGrayscale(diffractionResult.intensity, GRID_SIZE, false);
        break;
      case "inverted":
        imageData = intensityToGrayscale(diffractionResult.intensity, GRID_SIZE, true);
        break;
      case "blue-white":
        imageData = intensityToBlueWhite(diffractionResult.intensity, GRID_SIZE);
        break;
    }

    // Scale up to display size
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = GRID_SIZE;
    tempCanvas.height = GRID_SIZE;
    const tempCtx = tempCanvas.getContext("2d")!;
    tempCtx.putImageData(imageData, 0, 0);

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(tempCanvas, 0, 0, displaySize, displaySize);

    // Border
    ctx.strokeStyle = "#d4d8e0";
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, displaySize, displaySize);
  }, [diffractionResult, colorMode]);

  // Draw cross-section
  useEffect(() => {
    const canvas = crossSectionCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = 500;
    const h = 140;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}`;
    canvas.style.height = `${h}`;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = "#f8f9fb";
    ctx.fillRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = "#ebeef2";
    ctx.lineWidth = 0.5;
    for (let x = 0; x < w; x += 25) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y < h; y += 25) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Horizontal cross-section through center
    const centerY = Math.floor(GRID_SIZE / 2);
    const intensity = diffractionResult.intensity;
    const margin = 30;
    const plotW = w - 2 * margin;
    const plotH = h - 2 * margin;

    ctx.beginPath();
    for (let i = 0; i < GRID_SIZE; i++) {
      const val = intensity[centerY * GRID_SIZE + i];
      const x = margin + (i / GRID_SIZE) * plotW;
      const y = h - margin - val * plotH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = "#1a1a2e";
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Axes
    ctx.strokeStyle = "#9ca3af";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(margin, h - margin);
    ctx.lineTo(w - margin, h - margin);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(margin, margin);
    ctx.lineTo(margin, h - margin);
    ctx.stroke();

    // Labels
    ctx.fillStyle = "#6b7280";
    ctx.font = "9px IBM Plex Sans";
    ctx.textAlign = "center";
    ctx.fillText("位置", w / 2, h - 5);
    ctx.save();
    ctx.translate(8, h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("强度", 0, 0);
    ctx.restore();

    // Title
    ctx.fillStyle = "#2d3142";
    ctx.font = "10px IBM Plex Sans";
    ctx.textAlign = "left";
    ctx.fillText("水平截面强度分布", margin, margin - 6);
  }, [diffractionResult]);

  // 3D Canvas renderer
  const render3D = useMemo(() => {
    return (
      <Canvas
        camera={{
          position: scene3D === "surface" ? [3, 2.5, 3] : [3, 2, 0],
          fov: 45,
          near: 0.1,
          far: 100,
        }}
        style={{ background: "#ffffff" }}
        gl={{ antialias: true, alpha: false }}
      >
        <ambientLight intensity={0.7} />
        <directionalLight position={[5, 8, 5]} intensity={0.4} />
        <directionalLight position={[-3, 4, -3]} intensity={0.15} />

        {scene3D === "surface" ? (
          <>
            <DiffractionSurface3D
              intensity={diffractionResult.intensity}
              gridSize={GRID_SIZE}
              colorMode={colorMode}
              showWireframe={showWireframe}
              heightScale={heightScale}
            />
            <AxisLabels heightScale={heightScale} />
            <SceneGrid />
          </>
        ) : (
          <PropagationScene
            aperture={aperture}
            intensity={diffractionResult.intensity}
            gridSize={GRID_SIZE}
            colorMode={colorMode}
          />
        )}

        <OrbitControls
          enableDamping
          dampingFactor={0.1}
          rotateSpeed={0.5}
          zoomSpeed={0.8}
          minDistance={2}
          maxDistance={15}
        />
      </Canvas>
    );
  }, [diffractionResult, colorMode, showWireframe, heightScale, scene3D, aperture]);

  return (
    <div className="flex h-full">
      {/* Control Panel */}
      <div className="w-72 border-r border-[#d4d8e0] bg-[#f8f9fb] p-4 overflow-y-auto optics-panel shrink-0">
        <div className="space-y-4">
          {/* Aperture Type */}
          <div>
            <h3 className="text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider mb-2.5" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
              口径类型
            </h3>
            <Select value={apertureType} onValueChange={(v) => setApertureType(v as ApertureType)}>
              <SelectTrigger className="h-8 text-[12px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(APERTURE_TYPES).map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Aperture Parameters */}
          <div className="border-t border-[#d4d8e0] pt-3">
            <h3 className="text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider mb-2.5" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
              口径参数
            </h3>

            {(apertureType === "circular" || apertureType === "rectangular") && (
              <div className="space-y-1.5 mb-3">
                <div className="flex items-center justify-between">
                  <Label className="text-[12px] text-[#2d3142]">
                    {apertureType === "circular" ? "半径" : "半宽"}
                  </Label>
                  <span className="text-[11px] text-[#6b7280] mono-digits">{apertureSize} px</span>
                </div>
                <Slider
                  value={[apertureSize]}
                  onValueChange={([v]) => setApertureSize(v)}
                  min={5}
                  max={80}
                  step={1}
                />
              </div>
            )}

            {apertureType === "rectangular" && (
              <div className="space-y-1.5 mb-3">
                <div className="flex items-center justify-between">
                  <Label className="text-[12px] text-[#2d3142]">半高</Label>
                  <span className="text-[11px] text-[#6b7280] mono-digits">{apertureHeight} px</span>
                </div>
                <Slider
                  value={[apertureHeight]}
                  onValueChange={([v]) => setApertureHeight(v)}
                  min={5}
                  max={100}
                  step={1}
                />
              </div>
            )}

            {(apertureType === "single_slit" || apertureType === "double_slit" || apertureType === "grating") && (
              <>
                <div className="space-y-1.5 mb-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-[12px] text-[#2d3142]">缝宽</Label>
                    <span className="text-[11px] text-[#6b7280] mono-digits">{slitWidth} px</span>
                  </div>
                  <Slider
                    value={[slitWidth]}
                    onValueChange={([v]) => setSlitWidth(v)}
                    min={2}
                    max={40}
                    step={1}
                  />
                </div>

                {apertureType !== "single_slit" && (
                  <div className="space-y-1.5 mb-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-[12px] text-[#2d3142]">缝间距</Label>
                      <span className="text-[11px] text-[#6b7280] mono-digits">{slitSeparation} px</span>
                    </div>
                    <Slider
                      value={[slitSeparation]}
                      onValueChange={([v]) => setSlitSeparation(v)}
                      min={10}
                      max={80}
                      step={1}
                    />
                  </div>
                )}

                <div className="space-y-1.5 mb-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-[12px] text-[#2d3142]">缝高</Label>
                    <span className="text-[11px] text-[#6b7280] mono-digits">{apertureHeight} px</span>
                  </div>
                  <Slider
                    value={[apertureHeight]}
                    onValueChange={([v]) => setApertureHeight(v)}
                    min={20}
                    max={100}
                    step={1}
                  />
                </div>
              </>
            )}

            {apertureType === "grating" && (
              <>
                <div className="space-y-1.5 mb-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-[12px] text-[#2d3142]">光栅周期</Label>
                    <span className="text-[11px] text-[#6b7280] mono-digits">{gratingPeriod} px</span>
                  </div>
                  <Slider
                    value={[gratingPeriod]}
                    onValueChange={([v]) => setGratingPeriod(v)}
                    min={10}
                    max={60}
                    step={1}
                  />
                </div>

                <div className="space-y-1.5 mb-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-[12px] text-[#2d3142]">缝数</Label>
                    <span className="text-[11px] text-[#6b7280] mono-digits">{numGratingSlits}</span>
                  </div>
                  <Slider
                    value={[numGratingSlits]}
                    onValueChange={([v]) => setNumGratingSlits(v)}
                    min={2}
                    max={15}
                    step={1}
                  />
                </div>
              </>
            )}
          </div>

          {/* Diffraction Mode */}
          <div className="border-t border-[#d4d8e0] pt-3">
            <h3 className="text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider mb-2.5" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
              衍射模式
            </h3>
            <Select value={diffractionMode} onValueChange={(v) => setDiffractionMode(v as "fraunhofer" | "fresnel")}>
              <SelectTrigger className="h-8 text-[12px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fraunhofer">夫琅禾费 (远场)</SelectItem>
                <SelectItem value="fresnel">菲涅耳 (近场)</SelectItem>
              </SelectContent>
            </Select>

            {diffractionMode === "fresnel" && (
              <div className="space-y-1.5 mt-3">
                <div className="flex items-center justify-between">
                  <Label className="text-[12px] text-[#2d3142]">菲涅耳数 N_F</Label>
                  <span className="text-[11px] text-[#6b7280] mono-digits">{fresnelNumber.toFixed(2)}</span>
                </div>
                <Slider
                  value={[fresnelNumber]}
                  onValueChange={([v]) => setFresnelNumber(v)}
                  min={0.1}
                  max={10}
                  step={0.05}
                />
              </div>
            )}
          </div>

          {/* View Mode */}
          <div className="border-t border-[#d4d8e0] pt-3">
            <h3 className="text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider mb-2.5" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
              视图模式
            </h3>
            <div className="flex gap-1">
              {([
                { value: "2d", label: "2D" },
                { value: "3d", label: "3D" },
                { value: "split", label: "2D+3D" },
              ] as const).map(({ value, label }) => (
                <Button
                  key={value}
                  variant={viewMode === value ? "default" : "outline"}
                  size="sm"
                  className={`h-7 text-[11px] flex-1 ${viewMode === value ? "bg-[#2d3142] text-white" : "bg-white text-[#6b7280]"}`}
                  onClick={() => setViewMode(value)}
                >
                  {label}
                </Button>
              ))}
            </div>

            {/* 3D Scene selector */}
            {(viewMode === "3d" || viewMode === "split") && (
              <div className="mt-3 space-y-2">
                <div className="flex gap-1">
                  {([
                    { value: "surface" as const, label: "强度曲面" },
                    { value: "propagation" as const, label: "光路传播" },
                  ]).map(({ value, label }) => (
                    <Button
                      key={value}
                      variant={scene3D === value ? "default" : "outline"}
                      size="sm"
                      className={`h-6 text-[10px] flex-1 ${scene3D === value ? "bg-[#2d3142] text-white" : "bg-white text-[#6b7280]"}`}
                      onClick={() => setScene3D(value)}
                    >
                      {label}
                    </Button>
                  ))}
                </div>

                {scene3D === "surface" && (
                  <>
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label className="text-[11px] text-[#2d3142]">高度缩放</Label>
                        <span className="text-[10px] text-[#6b7280] mono-digits">{heightScale.toFixed(1)}×</span>
                      </div>
                      <Slider
                        value={[heightScale]}
                        onValueChange={([v]) => setHeightScale(v)}
                        min={0.5}
                        max={5}
                        step={0.1}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label className="text-[11px] text-[#2d3142]">线框叠加</Label>
                      <Switch checked={showWireframe} onCheckedChange={setShowWireframe} />
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Display Options */}
          <div className="border-t border-[#d4d8e0] pt-3">
            <h3 className="text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider mb-2.5" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
              显示选项
            </h3>
            <Select value={colorMode} onValueChange={(v) => setColorMode(v as typeof colorMode)}>
              <SelectTrigger className="h-8 text-[12px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="grayscale">灰度 (白底黑纹)</SelectItem>
                <SelectItem value="inverted">反转灰度 (黑底白斑)</SelectItem>
                <SelectItem value="blue-white">蓝白映射</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Info */}
          <div className="border-t border-[#d4d8e0] pt-3">
            <div className="bg-white border border-[#d4d8e0] rounded p-2.5 space-y-1">
              <div className="flex justify-between">
                <span className="text-[10px] text-[#6b7280]">网格分辨率</span>
                <span className="text-[11px] text-[#1a1a2e] mono-digits">{GRID_SIZE}×{GRID_SIZE}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[10px] text-[#6b7280]">峰值强度</span>
                <span className="text-[11px] text-[#1a1a2e] mono-digits">{diffractionResult.peakIntensity.toExponential(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[10px] text-[#6b7280]">算法</span>
                <span className="text-[11px] text-[#1a1a2e]">2D FFT</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Visualization */}
      <div className="flex-1 flex flex-col bg-white overflow-hidden">
        <div className="flex-1 flex overflow-auto p-4 gap-4">
          {/* 2D Panel */}
          {viewMode !== "3d" && (
            <div className="flex flex-col items-center justify-center gap-4" style={{ minWidth: viewMode === "2d" ? "100%" : "auto" }}>
              <div className="flex gap-6 items-start">
                {/* Aperture */}
                <div className="flex flex-col items-center">
                  <div className="text-[10px] text-[#9ca3af] uppercase tracking-wider mb-2" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
                    口径函数
                  </div>
                  <canvas ref={apertureCanvasRef} className="border border-[#d4d8e0]" />
                </div>

                {/* Arrow */}
                <div className="flex flex-col items-center justify-center pt-24">
                  <svg width="40" height="24" viewBox="0 0 40 24">
                    <line x1="0" y1="12" x2="30" y2="12" stroke="#9ca3af" strokeWidth="1" />
                    <polygon points="30,8 38,12 30,16" fill="#9ca3af" />
                  </svg>
                  <span className="text-[9px] text-[#9ca3af] mt-1" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
                    FFT
                  </span>
                </div>

                {/* Diffraction Pattern */}
                <div className="flex flex-col items-center">
                  <div className="text-[10px] text-[#9ca3af] uppercase tracking-wider mb-2" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
                    {diffractionMode === "fraunhofer" ? "夫琅禾费衍射" : "菲涅耳衍射"}
                  </div>
                  <canvas ref={diffractionCanvasRef} className="border border-[#d4d8e0]" style={{ imageRendering: "auto" }} />
                </div>
              </div>

              {/* Cross-section */}
              <div>
                <canvas ref={crossSectionCanvasRef} className="border border-[#d4d8e0]" />
              </div>
            </div>
          )}

          {/* 3D Panel */}
          {viewMode !== "2d" && (
            <div className="flex flex-col flex-1 relative" style={{ minHeight: 300 }}>
              <div className="flex-1 relative rounded border border-[#d4d8e0] overflow-hidden">
                {render3D}

                {/* Info overlay */}
                <div className="absolute top-2 right-2 bg-white/95 border border-[#d4d8e0] rounded px-2.5 py-1.5 shadow-sm">
                  <p className="text-[10px] text-[#4a4a5a]" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
                    {scene3D === "surface" ? "3D 强度曲面" : "3D 光路传播"}
                  </p>
                  <p className="text-[9px] text-[#9ca3af]">拖拽旋转 · 滚轮缩放</p>
                </div>

                {/* Scene label */}
                <div className="absolute bottom-2 left-2 bg-white/95 border border-[#d4d8e0] rounded px-2.5 py-1.5 shadow-sm">
                  <p className="text-[10px] text-[#6b7280]" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
                    {scene3D === "surface"
                      ? `I(x,y) = |FT[A(x,y)]|²  h=${heightScale.toFixed(1)}×`
                      : "A(x,y) → 传播 d → I(x,y)"}
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
