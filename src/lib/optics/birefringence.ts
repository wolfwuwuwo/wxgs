export interface BirefringenceParams {
  subtractBackground: boolean;
  sensitivity: number;
  rotationCompensation: number;
}

/**
 * Convert retardation (nm) to Michel-Lévy interference color [r, g, b].
 *
 * The Michel-Lévy color chart maps optical retardation to interference colors
 * observed under crossed polarizers:
 *   0 nm:     black [0,0,0]
 *   0-50 nm:  dark gray to gray
 *   50-200nm: gray to white
 *   200-300nm:white to pale yellow
 *   300-450nm:yellow to orange to red
 *   450-550nm:red to violet (tint of passage)
 *   550-700nm:blue to green (second order)
 *   700+ nm:  repeat with diminishing contrast
 */
export function retardationToMichelLevy(retardationNm: number): [number, number, number] {
  // Normalize retardation to 0-2000nm range
  const r = ((retardationNm % 2000) + 2000) % 2000;

  // Use sine-based color mapping for interference colors
  const phase = (r / 550) * Math.PI * 2;

  const red = Math.max(0, Math.min(255, Math.round(128 + 127 * Math.sin(phase))));
  const green = Math.max(0, Math.min(255, Math.round(128 + 127 * Math.sin(phase - (Math.PI * 2) / 3))));
  const blue = Math.max(0, Math.min(255, Math.round(128 + 127 * Math.sin(phase - (Math.PI * 4) / 3))));

  // Apply intensity modulation for first-order visibility
  const intensity = 0.5 + 0.5 * Math.cos(phase);

  return [
    Math.round(red * intensity),
    Math.round(green * intensity),
    Math.round(blue * intensity),
  ];
}

/**
 * Rotate the hue of an [r, g, b] color by the given angle (in radians).
 * Uses the standard RGB hue rotation matrix (rotation around the (1,1,1)/√3 axis).
 */
function rotateHue(r: number, g: number, b: number, angleRad: number): [number, number, number] {
  const cosA = Math.cos(angleRad);
  const sinA = Math.sin(angleRad);

  const oneMinusCos = 1 - cosA;
  const third = 1 / 3;
  const invSqrt3 = 1 / Math.sqrt(3);

  // Rotation matrix: cos(θ)*I + (1-cos(θ))/3 * J + sin(θ)/√3 * K
  const a11 = cosA + third * oneMinusCos;
  const a12 = third * oneMinusCos - invSqrt3 * sinA;
  const a13 = third * oneMinusCos + invSqrt3 * sinA;
  const a21 = third * oneMinusCos + invSqrt3 * sinA;
  const a22 = cosA + third * oneMinusCos;
  const a23 = third * oneMinusCos - invSqrt3 * sinA;
  const a31 = third * oneMinusCos - invSqrt3 * sinA;
  const a32 = third * oneMinusCos + invSqrt3 * sinA;
  const a33 = cosA + third * oneMinusCos;

  const rotatedR = a11 * r + a12 * g + a13 * b;
  const rotatedG = a21 * r + a22 * g + a23 * b;
  const rotatedB = a31 * r + a32 * g + a33 * b;

  return [
    Math.max(0, Math.min(255, Math.round(rotatedR))),
    Math.max(0, Math.min(255, Math.round(rotatedG))),
    Math.max(0, Math.min(255, Math.round(rotatedB))),
  ];
}

/**
 * Process a video frame ImageData and return processed ImageData
 * with Michel-Lévy pseudocolor mapping for stress birefringence.
 */
export function processBirefringenceFrame(
  imageData: ImageData,
  params: BirefringenceParams
): ImageData {
  const { sensitivity, rotationCompensation, subtractBackground } = params;
  const width = imageData.width;
  const height = imageData.height;
  const src = imageData.data;

  const output = new ImageData(width, height);
  const dst = output.data;

  // If background subtraction is enabled, compute mean channel values
  let bgR = 0;
  let bgG = 0;
  let bgB = 0;
  const totalPixels = width * height;

  if (subtractBackground) {
    for (let i = 0; i < src.length; i += 4) {
      bgR += src[i];
      bgG += src[i + 1];
      bgB += src[i + 2];
    }
    bgR = Math.round(bgR / totalPixels);
    bgG = Math.round(bgG / totalPixels);
    bgB = Math.round(bgB / totalPixels);
  }

  const compensationRad = (rotationCompensation * Math.PI) / 180;

  for (let i = 0; i < src.length; i += 4) {
    let pixelR = src[i];
    let pixelG = src[i + 1];
    let pixelB = src[i + 2];
    const pixelA = src[i + 3];

    // Subtract background if enabled
    if (subtractBackground) {
      pixelR = Math.max(0, pixelR - bgR);
      pixelG = Math.max(0, pixelG - bgG);
      pixelB = Math.max(0, pixelB - bgB);
    }

    // Compute color channel differences as birefringence signal
    const diff = Math.abs(pixelR - pixelG) + Math.abs(pixelG - pixelB) + Math.abs(pixelR - pixelB);

    // Map diff to retardation (nm)
    const retardation = (diff / (3 * 255)) * (sensitivity * 500);

    if (retardation > 5) {
      // Get Michel-Lévy color
      let [mlR, mlG, mlB] = retardationToMichelLevy(retardation);

      // Apply rotation compensation if specified
      if (rotationCompensation !== 0) {
        [mlR, mlG, mlB] = rotateHue(mlR, mlG, mlB, compensationRad);
      }

      // Blend factor based on retardation
      const alpha = Math.min(1, retardation / (sensitivity * 150));

      // Blend Michel-Lévy color with original pixel
      dst[i] = Math.round(pixelR * (1 - alpha) + mlR * alpha);
      dst[i + 1] = Math.round(pixelG * (1 - alpha) + mlG * alpha);
      dst[i + 2] = Math.round(pixelB * (1 - alpha) + mlB * alpha);
      dst[i + 3] = pixelA;
    } else {
      // Below threshold — keep original pixel
      dst[i] = src[i];
      dst[i + 1] = src[i + 1];
      dst[i + 2] = src[i + 2];
      dst[i + 3] = pixelA;
    }
  }

  return output;
}
