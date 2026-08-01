'use client'

/* ═══════════════════════════════════════════════════════════════════
   FourierOptics4f — 傅里叶光学 4f 系统仿真
   4 种实验模式：低通/高通 · 方向滤波 · 带通滤波 · 卷积定理
   核心：2D FFT (Cooley–Tukey radix-2) + 频域滤波 + IFFT
   ═══════════════════════════════════════════════════════════════════ */

import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { Slider } from '@/components/ui/slider'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useIsMobile } from '@/hooks/use-mobile'
import { ControlPanel, MobilePanelToggle } from './shared/ControlPanel'
import { TearOffButton } from './shared/TearOffPanel'
import { useSnapshotTarget } from '@/hooks/use-snapshot-target'
import { fft2d, fftshift2d } from '@/lib/optics/diffraction'

/* ─── 常量 ─── */
const FONT = "system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif"
const MONO = 'var(--font-geist-mono), ui-monospace, monospace'
const N = 128 // FFT 网格分辨率 (radix-2)
const CANVAS_PX = 220 // 单画布显示像素
const VIEW_ID = 'modern-fourier' as const

type ExperimentMode = 'lowpass-highpass' | 'directional' | 'bandpass' | 'convolution-demo'
type FilterType = 'lowpass' | 'highpass' | 'bandpass' | 'directional' | 'custom'
type InputPattern = 'grid' | 'circle' | 'square' | 'double-slit' | 'text' | 'cross' | 'sine'
type PSFType = 'gaussian' | 'square' | 'delta'
type SpectrumColormap = 'warm' | 'grayscale'

const MODE_LABELS: Record<ExperimentMode, string> = {
  'lowpass-highpass': '低通/高通',
  'directional': '方向滤波',
  'bandpass': '带通滤波',
  'convolution-demo': '卷积定理',
}

const MODE_DESCRIPTIONS: Record<ExperimentMode, string> = {
  'lowpass-highpass': '在频谱面应用圆形低通或高通滤波器，观察像的平滑与边缘增强效应',
  'directional': '在频谱面阻挡特定角度方向的频率分量，仅保留特定方向的边缘信息',
  'bandpass': '环形带通滤波器，仅保留特定空间频率范围的能量，产生边缘增强效果',
  'convolution-demo': '将输入与点扩散函数(PSF)卷积，演示卷积定理：空域卷积 ⇔ 频域相乘',
}

const FILTER_LABELS: Record<FilterType, string> = {
  lowpass: '低通 (Low-pass)',
  highpass: '高通 (High-pass)',
  bandpass: '带通 (Band-pass)',
  directional: '方向 (Directional)',
  custom: '自定义 (Custom)',
}

const INPUT_LABELS: Record<InputPattern, string> = {
  grid: '点阵网格',
  circle: '圆孔',
  square: '方孔',
  'double-slit': '双缝',
  text: '汉字「光」',
  cross: '十字',
  sine: '正弦光栅',
}

const PSF_LABELS: Record<PSFType, string> = {
  gaussian: '高斯 PSF',
  square: '方框 PSF',
  delta: 'δ 函数 PSF',
}

/* ═══════════════════════════════════════════════════════════════════
   1. 输入图案生成
   ═══════════════════════════════════════════════════════════════════ */

function generateInput(pattern: InputPattern, n: number): Float64Array {
  const data = new Float64Array(n * n)
  const c = (n - 1) / 2 // 圆心对准：避免偶数网格中心偏移 0.5px

  switch (pattern) {
    case 'grid': {
      const period = n / 8
      const dotR = n / 36
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          // 对齐到周期网格的中心
          const cellX = ((x - period / 2) % period + period) % period
          const cellY = ((y - period / 2) % period + period) % period
          const dx = cellX - period / 2
          const dy = cellY - period / 2
          if (Math.sqrt(dx * dx + dy * dy) < dotR) data[y * n + x] = 1
        }
      }
      break
    }
    case 'circle': {
      const r = n / 4
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const dx = x - c, dy = y - c
          if (Math.sqrt(dx * dx + dy * dy) < r) data[y * n + x] = 1
        }
      }
      break
    }
    case 'square': {
      const half = n / 4
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          if (Math.abs(x - c) < half && Math.abs(y - c) < half) data[y * n + x] = 1
        }
      }
      break
    }
    case 'double-slit': {
      const slitW = 3
      const sep = n / 6
      const halfH = n / 3
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          if (Math.abs(y - c) < halfH) {
            if (Math.abs(x - c + sep / 2) < slitW / 2) data[y * n + x] = 1
            if (Math.abs(x - c - sep / 2) < slitW / 2) data[y * n + x] = 1
          }
        }
      }
      break
    }
    case 'text': {
      // 使用 canvas 渲染汉字「光」
      if (typeof document !== 'undefined') {
        try {
          const cv = document.createElement('canvas')
          cv.width = n; cv.height = n
          const cx = cv.getContext('2d')
          if (cx) {
            cx.fillStyle = '#FFFFFF'
            cx.fillRect(0, 0, n, n)
            cx.fillStyle = '#000000'
            cx.font = `bold ${Math.floor(n * 0.72)}px system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif`
            cx.textAlign = 'center'
            cx.textBaseline = 'middle'
            cx.fillText('光', n / 2, n / 2 + 2)
            const img = cx.getImageData(0, 0, n, n)
            for (let i = 0; i < n * n; i++) {
              data[i] = 1 - img.data[i * 4] / 255
            }
          }
        } catch { /* fallback to cross */ }
      }
      if (data.every(v => v === 0)) {
        // 退化：使用十字
        for (let y = 0; y < n; y++) {
          for (let x = 0; x < n; x++) {
            const dx = Math.abs(x - c), dy = Math.abs(y - c)
            if (dx < 4 && dy < n / 2.5) data[y * n + x] = 1
            if (dy < 4 && dx < n / 2.5) data[y * n + x] = 1
          }
        }
      }
      break
    }
    case 'cross': {
      const thick = 4
      const arm = n / 2.5
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const dx = Math.abs(x - c), dy = Math.abs(y - c)
          if (dx < thick && dy < arm) data[y * n + x] = 1
          if (dy < thick && dx < arm) data[y * n + x] = 1
        }
      }
      break
    }
    case 'sine': {
      const period = n / 8
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          data[y * n + x] = 0.5 + 0.5 * Math.cos(2 * Math.PI * x / period)
        }
      }
      break
    }
  }
  return data
}

/* ═══════════════════════════════════════════════════════════════════
   2. 滤波器掩膜生成 (H(u,v), DC 在 (0,0))
   ═══════════════════════════════════════════════════════════════════ */

function generateFilterMask(
  filterType: FilterType,
  fc: number,
  ringWidth: number,
  direction: number,
  angularWidth: number,
  n: number,
): Float64Array {
  const H = new Float64Array(n * n)
  const half = n / 2
  const fcPx = fc * half // 截止频率(像素单位)

  for (let v = 0; v < n; v++) {
    for (let u = 0; u < n; u++) {
      // wrap-around 到 [-N/2, N/2)
      const uu = u <= half ? u : u - n
      const vv = v <= half ? v : v - n
      const r = Math.sqrt(uu * uu + vv * vv)
      let pass = 0

      switch (filterType) {
        case 'lowpass':
          pass = r < fcPx ? 1 : 0
          break
        case 'highpass':
          pass = r >= fcPx ? 1 : 0
          break
        case 'bandpass': {
          const inner = Math.max(0, fcPx - ringWidth * half)
          const outer = fcPx + ringWidth * half
          pass = (r > inner && r < outer) ? 1 : 0
          break
        }
        case 'directional': {
          // 阻挡 [direction - Δ/2, direction + Δ/2] 角度范围
          // angle 从 +u 轴逆时针测量，atan2(vv, uu)
          let angle = Math.atan2(vv, uu) * 180 / Math.PI
          if (angle < 0) angle += 360
          const theta = ((direction % 360) + 360) % 360
          let diff = Math.abs(angle - theta)
          if (diff > 180) diff = 360 - diff
          pass = diff < angularWidth / 2 ? 0 : 1
          break
        }
        case 'custom': {
          // 自定义 = 低通 + 阻挡水平方向(去除水平条纹对应的垂直频率)
          const lowpass = r < fcPx ? 1 : 0
          let angle = Math.atan2(vv, uu) * 180 / Math.PI
          if (angle < 0) angle += 360
          // 阻挡 90° (垂直频率 = 水平结构) ± 18°
          let diff = Math.abs(angle - 90)
          if (diff > 180) diff = 360 - diff
          const dirBlock = diff < 18 ? 0 : 1
          pass = lowpass * dirBlock
          break
        }
      }
      H[v * n + u] = pass
    }
  }
  return H
}

/* ═══════════════════════════════════════════════════════════════════
   3. PSF 生成 (归一化)
   ═══════════════════════════════════════════════════════════════════ */

function generatePSF(type: PSFType, size: number, n: number): Float64Array {
  const psf = new Float64Array(n * n)
  const c = (n - 1) / 2 // 圆心对准
  const sigma = Math.max(0.5, size * n / 16) // size 0.05-0.5 → sigma 0.4-4 像素

  switch (type) {
    case 'gaussian': {
      let sum = 0
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const dx = x - c, dy = y - c
          const v = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma))
          psf[y * n + x] = v
          sum += v
        }
      }
      if (sum > 0) for (let i = 0; i < psf.length; i++) psf[i] /= sum
      break
    }
    case 'square': {
      const half = Math.max(1, Math.round(sigma))
      const area = (2 * half + 1) * (2 * half + 1)
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          if (Math.abs(x - c) <= half && Math.abs(y - c) <= half) {
            psf[y * n + x] = 1 / area
          }
        }
      }
      break
    }
    case 'delta': {
      psf[c * n + c] = 1
      break
    }
  }
  return psf
}

/* ═══════════════════════════════════════════════════════════════════
   4. 颜色映射
   ═══════════════════════════════════════════════════════════════════ */

// 暖色 colormap: 黑 → 暗红 → 红 → 橙 → 黄 → 浅黄
function warmColor(t: number): [number, number, number] {
  t = Math.max(0, Math.min(1, t))
  const stops: [number, number, number][] = [
    [0, 0, 0],
    [70, 0, 0],
    [180, 25, 0],
    [230, 100, 0],
    [250, 190, 30],
    [255, 235, 130],
  ]
  const n = stops.length - 1
  const idx = t * n
  const i = Math.min(Math.floor(idx), n - 1)
  const f = idx - i
  const a = stops[i], b = stops[i + 1]
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ]
}

function grayscaleColor(t: number): [number, number, number] {
  t = Math.max(0, Math.min(1, t))
  const v = Math.round(t * 255)
  return [v, v, v]
}

/* ═══════════════════════════════════════════════════════════════════
   5. 频谱/输入/输出 计算
   ═══════════════════════════════════════════════════════════════════ */

interface FourierResult {
  /** 输入图案 (用于绘制) */
  input: Float64Array
  /** 频谱幅度 |F(u,v)| 经过 log + fftshift, 已归一化到 [0,1] */
  spectrum: Float64Array
  /** 滤波后频谱幅度 (log + fftshift, 归一化) */
  spectrumFiltered: Float64Array
  /** 滤波器掩膜 (fftshift, 0/1) */
  filterMaskShifted: Float64Array | null
  /** 输出图像 |g(x,y)|, 归一化到 [0,1] */
  output: Float64Array
  /** 输出 SNR (dB) */
  snr: number
  /** 透射比 (能量) */
  transmission: number
  /** PSF 显示 (用于卷积模式) */
  psf: Float64Array | null
  /** PSF 频谱 (log, fftshift, 归一化) */
  psfSpectrum: Float64Array | null
  /** PSF FWHM (像素) */
  psfFwhm: number
}

function computeFourierPipeline(
  input: Float64Array,
  filterMask: Float64Array | null,
  psf: Float64Array | null,
  isConvolution: boolean,
  n: number,
): FourierResult {
  // 1. FFT(input)
  const F_re = Float64Array.from(input)
  const F_im = new Float64Array(n * n)
  fft2d(F_re, F_im, n, false)

  // 2. 计算原始频谱幅度 (log)
  const spectrumRaw = new Float64Array(n * n)
  let maxMag = 0
  for (let i = 0; i < n * n; i++) {
    const mag = Math.sqrt(F_re[i] * F_re[i] + F_im[i] * F_im[i])
    spectrumRaw[i] = mag
    if (mag > maxMag) maxMag = mag
  }
  const spectrum = new Float64Array(n * n)
  const logMax = Math.log(1 + maxMag)
  for (let i = 0; i < n * n; i++) {
    spectrum[i] = logMax > 0 ? Math.log(1 + spectrumRaw[i]) / logMax : 0
  }
  fftshift2d(spectrum, n)

  // 3. 滤波 (或卷积)
  const G_re = new Float64Array(n * n)
  const G_im = new Float64Array(n * n)
  let filterMaskShifted: Float64Array | null = null
  let psfSpectrum: Float64Array | null = null

  if (isConvolution && psf) {
    // 卷积: G = F * FFT(PSF)
    const P_re = Float64Array.from(psf)
    const P_im = new Float64Array(n * n)
    fft2d(P_re, P_im, n, false)

    // PSF 频谱 (用于显示)
    let pMax = 0
    const pRaw = new Float64Array(n * n)
    for (let i = 0; i < n * n; i++) {
      const mag = Math.sqrt(P_re[i] * P_re[i] + P_im[i] * P_im[i])
      pRaw[i] = mag
      if (mag > pMax) pMax = mag
    }
    psfSpectrum = new Float64Array(n * n)
    const pLogMax = Math.log(1 + pMax)
    for (let i = 0; i < n * n; i++) {
      psfSpectrum[i] = pLogMax > 0 ? Math.log(1 + pRaw[i]) / pLogMax : 0
    }
    fftshift2d(psfSpectrum, n)

    // G = F · P
    for (let i = 0; i < n * n; i++) {
      G_re[i] = F_re[i] * P_re[i] - F_im[i] * P_im[i]
      G_im[i] = F_re[i] * P_im[i] + F_im[i] * P_re[i]
    }
    // 构造一个"虚拟滤波器"用于显示 (PSF 频谱幅度归一化)
    filterMaskShifted = new Float64Array(n * n)
    for (let i = 0; i < n * n; i++) {
      filterMaskShifted[i] = pMax > 0 ? pRaw[i] / pMax : 0
    }
    fftshift2d(filterMaskShifted, n)
  } else if (filterMask) {
    // 直接频域滤波: G = F · H
    for (let i = 0; i < n * n; i++) {
      G_re[i] = F_re[i] * filterMask[i]
      G_im[i] = F_im[i] * filterMask[i]
    }
    // 滤波器掩膜用于显示 (fftshift)
    filterMaskShifted = Float64Array.from(filterMask)
    fftshift2d(filterMaskShifted, n)
  } else {
    // 无滤波: G = F
    G_re.set(F_re)
    G_im.set(F_im)
  }

  // 4. 计算滤波后频谱幅度 (用于显示)
  const spectrumFiltered = new Float64Array(n * n)
  {
    let maxFMag = 0
    const fRaw = new Float64Array(n * n)
    for (let i = 0; i < n * n; i++) {
      const mag = Math.sqrt(G_re[i] * G_re[i] + G_im[i] * G_im[i])
      fRaw[i] = mag
      if (mag > maxFMag) maxFMag = mag
    }
    const fLogMax = Math.log(1 + maxFMag)
    for (let i = 0; i < n * n; i++) {
      spectrumFiltered[i] = fLogMax > 0 ? Math.log(1 + fRaw[i]) / fLogMax : 0
    }
    fftshift2d(spectrumFiltered, n)
  }

  // 5. IFFT(G) → g
  fft2d(G_re, G_im, n, true)
  // 取实部作为输出 (虚部应接近 0)
  const output = new Float64Array(n * n)
  let maxOut = 0
  for (let i = 0; i < n * n; i++) {
    const v = Math.abs(G_re[i])
    output[i] = v
    if (v > maxOut) maxOut = v
  }
  // 归一化输出 (相对于输入最大值, 保持尺度一致)
  let maxIn = 0
  for (let i = 0; i < n * n; i++) if (input[i] > maxIn) maxIn = input[i]
  const normFactor = maxIn > 0 ? maxIn : 1
  const outputNorm = new Float64Array(n * n)
  for (let i = 0; i < n * n; i++) {
    outputNorm[i] = maxOut > 0 ? output[i] / maxOut * (maxOut / normFactor > 1 ? 1 : maxOut / normFactor) : 0
  }
  // 简化: 直接归一化到 [0,1]
  for (let i = 0; i < n * n; i++) {
    outputNorm[i] = maxOut > 0 ? Math.min(1, output[i] / maxOut) : 0
  }

  // 6. SNR: 10·log10(Σinput² / Σ(input-output)²)
  let sumIn2 = 0, sumDiff2 = 0
  for (let i = 0; i < n * n; i++) {
    const inVal = input[i]
    // 将 output 缩放到与 input 相同的尺度 (用 maxOut/maxIn 比例)
    const outVal = maxOut > 0 ? (output[i] / maxOut) * (maxIn > 0 ? maxIn : 1) : 0
    sumIn2 += inVal * inVal
    const d = inVal - outVal
    sumDiff2 += d * d
  }
  const snr = sumDiff2 > 0 ? 10 * Math.log10(sumIn2 / sumDiff2) : 99

  // 7. 透射比
  let sumInE = 0, sumOutE = 0
  for (let i = 0; i < n * n; i++) {
    sumInE += spectrumRaw[i] * spectrumRaw[i]
    const gMag = Math.sqrt(G_re[i] * G_re[i] + G_im[i] * G_im[i]) // IFFT 前
    // 注意 G_re 已被 IFFT 覆盖, 改用滤波后频谱累计
    sumOutE += 0 // placeholder
  }
  void sumOutE
  // 重新计算透射比: 用滤波前/后的频谱能量
  let totalIn = 0, totalOut = 0
  if (filterMask) {
    for (let i = 0; i < n * n; i++) {
      const inMag = spectrumRaw[i]
      totalIn += inMag * inMag
      totalOut += inMag * inMag * filterMask[i] * filterMask[i]
    }
  } else if (isConvolution && psf) {
    // 卷积透射比 = |P(0,0)|² / max(|P|)² ~ PSF 直流分量
    totalIn = 1
    totalOut = 1
  }
  const transmission = totalIn > 0 ? totalOut / totalIn : 1

  // 8. PSF FWHM
  let psfFwhm = 0
  if (psf) {
    if (isConvolution) {
      // 沿水平中线计算 FWHM
      const c2 = (n - 1) / 2 // 圆心对准
      const row = new Float64Array(n)
      for (let x = 0; x < n; x++) row[x] = psf[c2 * n + x]
      const peak = row[c2]
      const halfPeak = peak / 2
      let l = c2, r = c2
      while (l > 0 && row[l] > halfPeak) l--
      while (r < n - 1 && row[r] > halfPeak) r++
      psfFwhm = r - l
    }
  }

  return {
    input,
    spectrum,
    spectrumFiltered,
    filterMaskShifted,
    output: outputNorm,
    snr,
    transmission,
    psf: isConvolution ? psf : null,
    psfSpectrum,
    psfFwhm,
  }
}

/* ═══════════════════════════════════════════════════════════════════
   6. Canvas 渲染组件
   ═══════════════════════════════════════════════════════════════════ */

/** 通用 2D 数组 → Canvas 绘制 */
function drawArrayToCanvas(
  canvas: HTMLCanvasElement,
  data: Float64Array,
  n: number,
  colormap: (t: number) => [number, number, number],
  displaySize: number,
) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const dpr = window.devicePixelRatio || 1
  canvas.width = displaySize * dpr
  canvas.height = displaySize * dpr
  canvas.style.width = `${displaySize}px`
  canvas.style.height = `${displaySize}px`
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.scale(dpr, dpr)

  // 创建 n×n 的 ImageData
  const imgData = ctx.createImageData(n, n)
  for (let i = 0; i < n * n; i++) {
    const v = Math.max(0, Math.min(1, data[i]))
    const [r, g, b] = colormap(v)
    imgData.data[i * 4] = r
    imgData.data[i * 4 + 1] = g
    imgData.data[i * 4 + 2] = b
    imgData.data[i * 4 + 3] = 255
  }
  // 用临时 canvas 缩放
  const tmp = document.createElement('canvas')
  tmp.width = n; tmp.height = n
  const tctx = tmp.getContext('2d')
  if (!tctx) return
  tctx.putImageData(imgData, 0, 0)
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, displaySize, displaySize)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(tmp, 0, 0, displaySize, displaySize)
  // 边框
  ctx.strokeStyle = '#333333'
  ctx.lineWidth = 1
  ctx.strokeRect(0.5, 0.5, displaySize - 1, displaySize - 1)
}

/** 频谱 canvas: 在频谱上叠加滤波器掩膜 (红色半透明) */
function drawSpectrumWithFilter(
  canvas: HTMLCanvasElement,
  spectrum: Float64Array,
  filterMask: Float64Array | null,
  showOverlay: boolean,
  n: number,
  colormap: (t: number) => [number, number, number],
  displaySize: number,
) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const dpr = window.devicePixelRatio || 1
  canvas.width = displaySize * dpr
  canvas.height = displaySize * dpr
  canvas.style.width = `${displaySize}px`
  canvas.style.height = `${displaySize}px`
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.scale(dpr, dpr)

  // 1. 绘制频谱
  const imgData = ctx.createImageData(n, n)
  for (let i = 0; i < n * n; i++) {
    const v = Math.max(0, Math.min(1, spectrum[i]))
    const [r, g, b] = colormap(v)
    imgData.data[i * 4] = r
    imgData.data[i * 4 + 1] = g
    imgData.data[i * 4 + 2] = b
    imgData.data[i * 4 + 3] = 255
  }
  // 叠加滤波器掩膜 (红色半透明, 标识"阻挡"区域)
  if (showOverlay && filterMask) {
    for (let i = 0; i < n * n; i++) {
      if (filterMask[i] < 0.5) {
        // 阻挡区域 - 红色覆盖
        imgData.data[i * 4] = Math.min(255, imgData.data[i * 4] * 0.35 + 220 * 0.55)
        imgData.data[i * 4 + 1] = Math.min(255, imgData.data[i * 4 + 1] * 0.35 + 40 * 0.55)
        imgData.data[i * 4 + 2] = Math.min(255, imgData.data[i * 4 + 2] * 0.35 + 30 * 0.55)
      } else if (filterMask[i] > 0 && filterMask[i] < 1) {
        // 卷积模式: PSF 频谱幅度高的地方亮 (绿色叠加)
        const w = filterMask[i]
        imgData.data[i * 4] = Math.min(255, imgData.data[i * 4] * (1 - w * 0.4) + 0 * w * 0.4)
        imgData.data[i * 4 + 1] = Math.min(255, imgData.data[i * 4 + 1] * (1 - w * 0.4) + 120 * w * 0.4)
        imgData.data[i * 4 + 2] = Math.min(255, imgData.data[i * 4 + 2] * (1 - w * 0.4) + 60 * w * 0.4)
      }
    }
  }
  const tmp = document.createElement('canvas')
  tmp.width = n; tmp.height = n
  const tctx = tmp.getContext('2d')
  if (!tctx) return
  tctx.putImageData(imgData, 0, 0)
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, displaySize, displaySize)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(tmp, 0, 0, displaySize, displaySize)

  // 中心十字标记 (DC)
  const mid = displaySize / 2
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'
  ctx.lineWidth = 0.5
  ctx.beginPath()
  ctx.moveTo(mid - 6, mid); ctx.lineTo(mid + 6, mid)
  ctx.moveTo(mid, mid - 6); ctx.lineTo(mid, mid + 6)
  ctx.stroke()

  // 边框
  ctx.strokeStyle = '#333333'
  ctx.lineWidth = 1
  ctx.strokeRect(0.5, 0.5, displaySize - 1, displaySize - 1)
}

/* ═══════════════════════════════════════════════════════════════════
   7. 4f 系统示意图 (SVG)
   ═══════════════════════════════════════════════════════════════════ */

function SystemSchematic({
  mode, filterType, fc, psfType, isMobile,
}: {
  mode: ExperimentMode
  filterType: FilterType
  fc: number
  psfType: PSFType
  isMobile: boolean
}) {
  const W = 760, H = 150
  // 关键位置
  const x0 = 60      // 输入面
  const x1 = 220     // L1
  const x2 = 380     // 频谱面 (滤波)
  const x3 = 540     // L2
  const x4 = 700     // 输出面
  const cy = 75      // 光轴 y

  // 滤波器图标 (在频谱面位置)
  const renderFilterIcon = () => {
    if (mode === 'convolution-demo') {
      // 卷积: 显示 PSF 在频谱面的传递函数
      return (
        <g>
          <circle cx={x2} cy={cy} r={14} fill="none" stroke="#333" strokeWidth="1.2" />
          <circle cx={x2} cy={cy} r={4} fill="#333" opacity="0.6" />
          <text x={x2} y={cy + 32} textAnchor="middle" fontSize="9" fill="#555" fontFamily={FONT}>
            MTF (PSF 频谱)
          </text>
        </g>
      )
    }
    // 滤波器形状取决于 filterType
    if (filterType === 'lowpass') {
      return (
        <g>
          <rect x={x2 - 14} y={cy - 14} width={28} height={28} fill="none" stroke="#333" strokeWidth="0.6" strokeDasharray="2 1" />
          <circle cx={x2} cy={cy} r={8} fill="none" stroke="#333" strokeWidth="1.4" />
          <text x={x2} y={cy + 32} textAnchor="middle" fontSize="9" fill="#555" fontFamily={FONT}>
            低通 (fc={fc.toFixed(2)})
          </text>
        </g>
      )
    }
    if (filterType === 'highpass') {
      return (
        <g>
          <rect x={x2 - 14} y={cy - 14} width={28} height={28} fill="rgba(220,40,30,0.15)" stroke="#333" strokeWidth="0.6" strokeDasharray="2 1" />
          <circle cx={x2} cy={cy} r={8} fill="rgba(220,40,30,0.5)" stroke="#333" strokeWidth="1" />
          <text x={x2} y={cy + 32} textAnchor="middle" fontSize="9" fill="#555" fontFamily={FONT}>
            高通 (fc={fc.toFixed(2)})
          </text>
        </g>
      )
    }
    if (filterType === 'bandpass') {
      return (
        <g>
          <circle cx={x2} cy={cy} r={12} fill="rgba(220,40,30,0.4)" stroke="none" />
          <circle cx={x2} cy={cy} r={6} fill="rgba(220,40,30,0.4)" stroke="none" />
          <circle cx={x2} cy={cy} r={12} fill="none" stroke="#333" strokeWidth="1" />
          <circle cx={x2} cy={cy} r={6} fill="none" stroke="#333" strokeWidth="1" />
          <text x={x2} y={cy + 32} textAnchor="middle" fontSize="9" fill="#555" fontFamily={FONT}>
            带通 (fc={fc.toFixed(2)})
          </text>
        </g>
      )
    }
    if (filterType === 'directional') {
      return (
        <g>
          <rect x={x2 - 14} y={cy - 14} width={28} height={28} fill="rgba(220,40,30,0.2)" stroke="#333" strokeWidth="0.6" strokeDasharray="2 1" />
          <path d={`M ${x2 - 10} ${cy + 10} A 12 12 0 0 1 ${x2 + 10} ${cy + 10} Z`} fill="rgba(220,40,30,0.5)" stroke="#333" strokeWidth="0.8" />
          <text x={x2} y={cy + 32} textAnchor="middle" fontSize="9" fill="#555" fontFamily={FONT}>
            方向阻挡
          </text>
        </g>
      )
    }
    // custom
    return (
      <g>
        <rect x={x2 - 14} y={cy - 14} width={28} height={28} fill="none" stroke="#333" strokeWidth="0.6" strokeDasharray="2 1" />
        <circle cx={x2} cy={cy} r={9} fill="none" stroke="#333" strokeWidth="1.2" />
        <rect x={x2 - 2} y={cy - 12} width={4} height={24} fill="rgba(220,40,30,0.5)" />
        <text x={x2} y={cy + 32} textAnchor="middle" fontSize="9" fill="#555" fontFamily={FONT}>
          自定义
        </text>
      </g>
    )
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{
        width: '100%',
        maxWidth: isMobile ? '100%' : '720px',
        height: 'auto',
        display: 'block',
        margin: '0 auto',
      }}
    >
      {/* 光轴 */}
      <line x1={x0} y1={cy} x2={x4} y2={cy} stroke="#999" strokeWidth="0.6" strokeDasharray="3 3" />

      {/* 输入面 */}
      <line x1={x0} y1={cy - 32} x2={x0} y2={cy + 32} stroke="#333" strokeWidth="1.6" />
      <text x={x0} y={cy - 40} textAnchor="middle" fontSize="11" fill="#1a1a2e" fontFamily={FONT} fontWeight="600">输入面</text>
      <text x={x0} y={cy + 50} textAnchor="middle" fontSize="9" fill="#777" fontFamily={MONO}>f(x,y)</text>

      {/* L1 透镜 (双凸) */}
      <g>
        <ellipse cx={x1} cy={cy} rx={6} ry={28} fill="rgba(200,220,255,0.25)" stroke="#333" strokeWidth="1.2" />
        <path d={`M ${x1 - 5} ${cy - 26} Q ${x1} ${cy} ${x1 - 5} ${cy + 26}`} fill="none" stroke="#333" strokeWidth="1.2" />
        <path d={`M ${x1 + 5} ${cy - 26} Q ${x1} ${cy} ${x1 + 5} ${cy + 26}`} fill="none" stroke="#333" strokeWidth="1.2" />
        <text x={x1} y={cy - 38} textAnchor="middle" fontSize="11" fill="#1a1a2e" fontFamily={FONT} fontWeight="600">L₁</text>
        <text x={x1} y={cy + 50} textAnchor="middle" fontSize="9" fill="#777" fontFamily={MONO}>f</text>
      </g>

      {/* 频谱面 + 滤波器 */}
      <line x1={x2} y1={cy - 32} x2={x2} y2={cy + 32} stroke="#333" strokeWidth="1.2" strokeDasharray="4 2" />
      <text x={x2} y={cy - 40} textAnchor="middle" fontSize="11" fill="#1a1a2e" fontFamily={FONT} fontWeight="600">频谱面</text>
      <text x={x2} y={cy + 50} textAnchor="middle" fontSize="9" fill="#777" fontFamily={MONO}>F(u,v)·H(u,v)</text>
      {renderFilterIcon()}

      {/* L2 透镜 */}
      <g>
        <ellipse cx={x3} cy={cy} rx={6} ry={28} fill="rgba(200,220,255,0.25)" stroke="#333" strokeWidth="1.2" />
        <path d={`M ${x3 - 5} ${cy - 26} Q ${x3} ${cy} ${x3 - 5} ${cy + 26}`} fill="none" stroke="#333" strokeWidth="1.2" />
        <path d={`M ${x3 + 5} ${cy - 26} Q ${x3} ${cy} ${x3 + 5} ${cy + 26}`} fill="none" stroke="#333" strokeWidth="1.2" />
        <text x={x3} y={cy - 38} textAnchor="middle" fontSize="11" fill="#1a1a2e" fontFamily={FONT} fontWeight="600">L₂</text>
        <text x={x3} y={cy + 50} textAnchor="middle" fontSize="9" fill="#777" fontFamily={MONO}>f</text>
      </g>

      {/* 输出面 */}
      <line x1={x4} y1={cy - 32} x2={x4} y2={cy + 32} stroke="#333" strokeWidth="1.6" />
      <text x={x4} y={cy - 40} textAnchor="middle" fontSize="11" fill="#1a1a2e" fontFamily={FONT} fontWeight="600">输出面</text>
      <text x={x4} y={cy + 50} textAnchor="middle" fontSize="9" fill="#777" fontFamily={MONO}>g(x,y)</text>

      {/* 光线 (输入 → L1) */}
      <line x1={x0} y1={cy - 28} x2={x1} y2={cy - 8} stroke="#333" strokeWidth="0.8" />
      <line x1={x0} y1={cy + 28} x2={x1} y2={cy + 8} stroke="#333" strokeWidth="0.8" />
      {/* L1 → 频谱面 (会聚) */}
      <line x1={x1} y1={cy - 26} x2={x2} y2={cy} stroke="#333" strokeWidth="0.8" />
      <line x1={x1} y1={cy + 26} x2={x2} y2={cy} stroke="#333" strokeWidth="0.8" />
      {/* 频谱面 → L2 (发散) */}
      <line x1={x2} y1={cy} x2={x3} y2={cy - 26} stroke="#333" strokeWidth="0.8" />
      <line x1={x2} y1={cy} x2={x3} y2={cy + 26} stroke="#333" strokeWidth="0.8" />
      {/* L2 → 输出面 (会聚) */}
      <line x1={x3} y1={cy - 26} x2={x4} y2={cy - 28} stroke="#333" strokeWidth="0.8" />
      <line x1={x3} y1={cy + 26} x2={x4} y2={cy + 28} stroke="#333" strokeWidth="0.8" />

      {/* f 距离标注 */}
      <g stroke="#aaa" strokeWidth="0.5" fill="none">
        <line x1={x0} y1={cy + 60} x2={x1} y2={cy + 60} />
        <line x1={x0} y1={cy + 57} x2={x0} y2={cy + 63} />
        <line x1={x1} y1={cy + 57} x2={x1} y2={cy + 63} />
        <line x1={x1} y1={cy + 60} x2={x2} y2={cy + 60} />
        <line x1={x2} y1={cy + 57} x2={x2} y2={cy + 63} />
        <line x1={x2} y1={cy + 60} x2={x3} y2={cy + 60} />
        <line x1={x3} y1={cy + 57} x2={x3} y2={cy + 63} />
        <line x1={x3} y1={cy + 60} x2={x4} y2={cy + 60} />
        <line x1={x4} y1={cy + 57} x2={x4} y2={cy + 63} />
      </g>
      <text x={(x0 + x1) / 2} y={cy + 72} textAnchor="middle" fontSize="8" fill="#999" fontFamily={MONO}>f</text>
      <text x={(x1 + x2) / 2} y={cy + 72} textAnchor="middle" fontSize="8" fill="#999" fontFamily={MONO}>f</text>
      <text x={(x2 + x3) / 2} y={cy + 72} textAnchor="middle" fontSize="8" fill="#999" fontFamily={MONO}>f</text>
      <text x={(x3 + x4) / 2} y={cy + 72} textAnchor="middle" fontSize="8" fill="#999" fontFamily={MONO}>f</text>

      {/* 卷积模式标注 */}
      {mode === 'convolution-demo' && (
        <text x={(x0 + x4) / 2} y={20} textAnchor="middle" fontSize="10" fill="#cc4400" fontFamily={FONT} fontWeight="600">
          卷积定理: g = f ⊗ h ⇔ G = F · H  (PSF: {PSF_LABELS[psfType]})
        </text>
      )}
      {mode !== 'convolution-demo' && (
        <text x={(x0 + x4) / 2} y={20} textAnchor="middle" fontSize="10" fill="#1a1a2e" fontFamily={FONT} fontWeight="600">
          4f 系统: L₁ 执行傅里叶变换, L₂ 执行逆变换, 频谱面进行空间滤波
        </text>
      )}
    </svg>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   8. 信息面板
   ═══════════════════════════════════════════════════════════════════ */

function InfoPanel({
  mode, filterType, fc, ringWidth, direction, angularWidth,
  psfType, psfSize, snr, transmission, psfFwhm, isMobile,
}: {
  mode: ExperimentMode
  filterType: FilterType
  fc: number
  ringWidth: number
  direction: number
  angularWidth: number
  psfType: PSFType
  psfSize: number
  snr: number
  transmission: number
  psfFwhm: number
  isMobile: boolean
}) {
  const items: { label: string; value: string; accent?: boolean }[] = []

  if (mode === 'convolution-demo') {
    items.push({ label: 'PSF 类型', value: PSF_LABELS[psfType] })
    items.push({ label: 'PSF 尺寸', value: psfSize.toFixed(3) })
    items.push({ label: 'PSF FWHM', value: `${psfFwhm.toFixed(1)} px` })
    items.push({ label: '卷积模式', value: 'G = F · H_psf' })
  } else {
    items.push({ label: '滤波器', value: FILTER_LABELS[filterType] })
    items.push({ label: '截止频率 fc', value: fc.toFixed(3) })
    if (filterType === 'bandpass') items.push({ label: '环宽 Δf', value: ringWidth.toFixed(3) })
    if (filterType === 'directional') {
      items.push({ label: '阻挡角度 θ', value: `${direction.toFixed(0)}°` })
      items.push({ label: '角度宽度 Δθ', value: `${angularWidth.toFixed(0)}°` })
    }
    items.push({ label: '能量透射比', value: `${(transmission * 100).toFixed(1)} %` })
  }
  items.push({ label: '输出 SNR', value: `${snr.toFixed(2)} dB`, accent: true })

  return (
    <div
      style={{
        backgroundColor: '#FFFFFF',
        border: '1px solid #D0D0D0',
        borderRadius: '2px',
        padding: '10px 12px',
        fontSize: '11px',
        fontFamily: FONT,
        width: '100%',
        maxWidth: isMobile ? '100%' : '480px',
      }}
    >
      <div style={{
        fontSize: '10px', fontWeight: 600, color: '#6b7280',
        textTransform: 'uppercase', letterSpacing: '0.05em',
        marginBottom: '8px', paddingBottom: '6px',
        borderBottom: '1px solid #E8ECF0',
      }}>
        系统参数 · 信息面板
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr 1fr' : '1fr 1fr 1fr',
        gap: '6px 16px',
      }}>
        {items.map((it, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
            <span style={{ fontSize: '9px', color: '#999' }}>{it.label}</span>
            <span
              className="tabular-nums"
              style={{
                fontSize: '11px',
                fontWeight: 600,
                color: it.accent ? '#cc4400' : '#1a1a2e',
                fontFamily: MONO,
              }}
            >
              {it.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   9. 控制面板分区
   ═══════════════════════════════════════════════════════════════════ */

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 style={{
      fontSize: '10px', fontWeight: 600, color: '#6b7280',
      fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace",
      textTransform: 'uppercase', letterSpacing: '0.05em',
      margin: '12px 0 6px 0',
      borderTop: '1px solid #E8ECF0', paddingTop: '8px',
    }}>
      {children}
    </h3>
  )
}

function SliderRow({
  label, value, min, max, step, onChange, format,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  format?: (v: number) => string
}) {
  return (
    <div style={{ marginBottom: '10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
        <Label style={{ fontSize: '10px', color: '#555' }}>{label}</Label>
        <span
          className="tabular-nums"
          style={{
            fontSize: '10px', fontWeight: 600, color: '#1a1a2e',
            fontFamily: MONO,
            padding: '1px 6px', backgroundColor: '#F0F3F6', borderRadius: '2px',
          }}
        >
          {format ? format(value) : value.toFixed(3)}
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(v[0])}
      />
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   10. 主组件
   ═══════════════════════════════════════════════════════════════════ */

export default function FourierOptics4f({ onBack }: { onBack: () => void }) {
  const isMobile = useIsMobile()
  const [panelOpen, setPanelOpen] = useState(false)

  // ─── 实验状态缓存 (步骤三: 切换模块后恢复) ───
  const cachedState = typeof window !== 'undefined'
    ? (() => {
        try {
          return JSON.parse(localStorage.getItem('ops-lab-v3') || '{}')?.state?.[VIEW_ID]?.state || null
        } catch { return null }
      })()
    : null

  // ─── 核心状态 ───
  const [mode, setMode] = useState<ExperimentMode>(cachedState?.mode ?? 'lowpass-highpass')
  const [inputPattern, setInputPattern] = useState<InputPattern>(cachedState?.inputPattern ?? 'grid')
  const [filterType, setFilterType] = useState<FilterType>(cachedState?.filterType ?? 'lowpass')
  const [fc, setFc] = useState<number>(cachedState?.fc ?? 0.18)
  const [ringWidth, setRingWidth] = useState<number>(cachedState?.ringWidth ?? 0.08)
  const [direction, setDirection] = useState<number>(cachedState?.direction ?? 90)
  const [angularWidth, setAngularWidth] = useState<number>(cachedState?.angularWidth ?? 30)
  const [psfType, setPsfType] = useState<PSFType>(cachedState?.psfType ?? 'gaussian')
  const [psfSize, setPsfSize] = useState<number>(cachedState?.psfSize ?? 0.18)
  const [spectrumColormap, setSpectrumColormap] = useState<SpectrumColormap>(cachedState?.spectrumColormap ?? 'warm')
  const [showFilterOverlay, setShowFilterOverlay] = useState<boolean>(cachedState?.showFilterOverlay ?? true)

  // ─── 可视化区域 ref (快照捕获 + 撕下面板) ───
  const vizRef = useRef<HTMLDivElement>(null)
  const inputCanvasRef = useRef<HTMLCanvasElement>(null)
  const spectrumCanvasRef = useRef<HTMLCanvasElement>(null)
  const outputCanvasRef = useRef<HTMLCanvasElement>(null)

  // ─── 快照目标注册 ───
  useSnapshotTarget(VIEW_ID, {
    targetRef: vizRef,
    getTitle: () => `傅里叶4f · ${MODE_LABELS[mode]} · ${INPUT_LABELS[inputPattern]} · fc=${fc.toFixed(2)}`,
    getParams: () => [
      { key: '模式', value: MODE_LABELS[mode] },
      { key: '输入', value: INPUT_LABELS[inputPattern] },
      { key: '滤波', value: mode === 'convolution-demo' ? PSF_LABELS[psfType] : FILTER_LABELS[filterType] },
      { key: 'fc', value: fc.toFixed(2) },
      ...(mode === 'bandpass' ? [{ key: 'Δf', value: ringWidth.toFixed(2) }] : []),
      ...(mode === 'directional' ? [{ key: 'θ', value: `${direction.toFixed(0)}°` }] : []),
      ...(mode === 'directional' ? [{ key: 'Δθ', value: `${angularWidth.toFixed(0)}°` }] : []),
      ...(mode === 'convolution-demo' ? [{ key: 'PSF尺寸', value: psfSize.toFixed(2) }] : []),
    ],
  })

  // ─── 状态缓存: 卸载时保存 ───
  useEffect(() => {
    return () => {
      try {
        const store = JSON.parse(localStorage.getItem('ops-lab-v3') || '{}')
        if (!store.state) store.state = {}
        store.state[VIEW_ID] = {
          viewId: VIEW_ID,
          state: {
            mode, inputPattern, filterType, fc, ringWidth,
            direction, angularWidth, psfType, psfSize,
            spectrumColormap, showFilterOverlay,
          },
          updatedAt: new Date().toISOString(),
        }
        localStorage.setItem('ops-lab-v3', JSON.stringify(store))
      } catch { /* ignore */ }
    }
  }, [mode, inputPattern, filterType, fc, ringWidth, direction, angularWidth, psfType, psfSize, spectrumColormap, showFilterOverlay])

  // ─── 输入图案 (memoized) ───
  const inputData = useMemo(() => generateInput(inputPattern, N), [inputPattern])

  // ─── 滤波器掩膜 (memoized) ───
  const filterMask = useMemo(() => {
    if (mode === 'convolution-demo') return null
    return generateFilterMask(filterType, fc, ringWidth, direction, angularWidth, N)
  }, [mode, filterType, fc, ringWidth, direction, angularWidth])

  // ─── PSF (memoized) ───
  const psfData = useMemo(() => {
    if (mode !== 'convolution-demo') return null
    return generatePSF(psfType, psfSize, N)
  }, [mode, psfType, psfSize])

  // ─── 傅里叶管线计算 ───
  const result = useMemo(
    () => computeFourierPipeline(inputData, filterMask, psfData, mode === 'convolution-demo', N),
    [inputData, filterMask, psfData, mode],
  )

  // ─── 绘制三幅 canvas ───
  const colormapFn = spectrumColormap === 'warm' ? warmColor : grayscaleColor
  const canvasSize = isMobile ? 180 : 220

  useEffect(() => {
    if (inputCanvasRef.current) {
      drawArrayToCanvas(inputCanvasRef.current, result.input, N, grayscaleColor, canvasSize)
    }
  }, [result.input, canvasSize])

  useEffect(() => {
    if (spectrumCanvasRef.current) {
      drawSpectrumWithFilter(
        spectrumCanvasRef.current,
        result.spectrum,
        result.filterMaskShifted,
        showFilterOverlay,
        N,
        colormapFn,
        canvasSize,
      )
    }
  }, [result.spectrum, result.filterMaskShifted, showFilterOverlay, colormapFn, canvasSize])

  useEffect(() => {
    if (outputCanvasRef.current) {
      // 卷积模式: 显示 PSF 替代输出? 不, 仍显示卷积输出
      drawArrayToCanvas(outputCanvasRef.current, result.output, N, grayscaleColor, canvasSize)
    }
  }, [result.output, canvasSize])

  // ─── 模式切换处理 ───
  const handleModeChange = useCallback((m: ExperimentMode) => {
    setMode(m)
    // 自动设置对应的 filterType
    if (m === 'lowpass-highpass') {
      setFilterType(prev => (prev === 'lowpass' || prev === 'highpass') ? prev : 'lowpass')
    } else if (m === 'directional') {
      setFilterType('directional')
    } else if (m === 'bandpass') {
      setFilterType('bandpass')
    }
  }, [])

  // ─── 重置 ───
  const handleReset = useCallback(() => {
    setFc(0.18)
    setRingWidth(0.08)
    setDirection(90)
    setAngularWidth(30)
    setPsfSize(0.18)
  }, [])

  // ─── 预设 ───
  const applyPreset = useCallback((preset: 'edge' | 'smooth' | 'sharpen' | 'vertical') => {
    if (preset === 'edge') {
      setMode('lowpass-highpass')
      setFilterType('highpass')
      setFc(0.12)
      setInputPattern('circle')
    } else if (preset === 'smooth') {
      setMode('lowpass-highpass')
      setFilterType('lowpass')
      setFc(0.15)
      setInputPattern('grid')
    } else if (preset === 'sharpen') {
      setMode('bandpass')
      setFilterType('bandpass')
      setFc(0.20)
      setRingWidth(0.08)
      setInputPattern('text')
    } else if (preset === 'vertical') {
      setMode('directional')
      setFilterType('directional')
      setDirection(90)
      setAngularWidth(30)
      setInputPattern('cross')
    }
  }, [])

  const modeKeys: ExperimentMode[] = ['lowpass-highpass', 'directional', 'bandpass', 'convolution-demo']

  return (
    <div className="h-full flex flex-col" style={{ background: '#FFFFFF', fontFamily: FONT }}>
      {/* ═══ Header ═══ */}
      <div
        className="flex-shrink-0 flex items-center"
        style={{
          height: isMobile ? '44px' : '48px',
          backgroundColor: '#FFFFFF',
          borderBottom: '1px solid #CCCCCC',
          paddingLeft: isMobile ? '16px' : '24px',
          paddingRight: isMobile ? '16px' : '24px',
          gap: '8px',
        }}
      >
        <button
          onClick={onBack}
          style={{
            fontSize: '12px', fontWeight: 400, color: '#555555',
            background: 'none', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: '4px',
            transition: 'color 200ms ease-out',
            flexShrink: 0,
          }}
          onMouseEnter={e => (e.currentTarget.style.color = '#1A1A1A')}
          onMouseLeave={e => (e.currentTarget.style.color = '#555555')}
        >
          ← 返回
        </button>
        <span style={{ margin: '0 4px', color: '#D0D0D0' }}>|</span>
        <h1 style={{
          fontSize: isMobile ? '17px' : '20px',
          fontWeight: 600, color: '#1A1A1A', margin: 0,
          flexShrink: 0,
        }}>
          傅里叶光学 4f 系统
        </h1>
        {!isMobile && (
          <span style={{
            marginLeft: '4px', fontSize: '9px', color: '#888',
            border: '1px solid #D0D0D0', borderRadius: '2px', padding: '1px 6px',
            fontFamily: MONO,
          }}>
            FFT {N}×{N}
          </span>
        )}

        {/* 模式 tab - 桌面端在 header, 移动端横向滚动 */}
        <div
          className="mobile-x-scroll"
          style={{
            display: 'flex',
            gap: '4px',
            marginLeft: isMobile ? 'auto' : '12px',
            marginRight: isMobile ? '8px' : '0',
            overflowX: isMobile ? 'auto' : 'visible',
            flex: isMobile ? '0 1 auto' : '0 0 auto',
            maxWidth: isMobile ? '160px' : 'none',
          }}
        >
          {modeKeys.map(m => (
            <button
              key={m}
              onClick={() => handleModeChange(m)}
              style={{
                fontSize: '11px',
                fontWeight: mode === m ? 600 : 400,
                color: mode === m ? '#1a1a2e' : '#777',
                backgroundColor: mode === m ? '#F0F3F6' : 'transparent',
                border: '1px solid',
                borderColor: mode === m ? '#1a1a2e' : '#D0D0D0',
                borderRadius: '2px',
                padding: '4px 10px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 150ms ease-out',
                fontFamily: FONT,
              }}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>

        {!isMobile && <div style={{ flex: 1 }} />}
        <MobilePanelToggle onClick={() => setPanelOpen(true)} label="参数" />
        <TearOffButton
          viewId={VIEW_ID}
          title={`傅里叶4f · ${MODE_LABELS[mode]} · ${INPUT_LABELS[inputPattern]} · fc=${fc.toFixed(2)}`}
          params={[
            { key: '模式', value: MODE_LABELS[mode] },
            { key: '输入', value: INPUT_LABELS[inputPattern] },
            { key: '滤波', value: mode === 'convolution-demo' ? PSF_LABELS[psfType] : FILTER_LABELS[filterType] },
            { key: 'fc', value: fc.toFixed(2) },
          ]}
          targetRef={vizRef}
          panelWidth={320}
          label="撕下对比"
        />
      </div>

      {/* ═══ 主体 ═══ */}
      <div className="flex flex-1" style={{ minHeight: 0 }}>
        {/* ─── 左: 控制面板 ─── */}
        <ControlPanel open={panelOpen} onClose={() => setPanelOpen(false)} title="傅里叶4f · 实验参数" desktopWidth="w-80">
          {/* 模式说明 */}
          <div style={{
            padding: '8px 10px',
            backgroundColor: '#F8F9FB',
            border: '1px solid #E8ECF0',
            borderRadius: '2px',
            fontSize: '10px',
            color: '#555',
            lineHeight: '1.6',
          }}>
            <div style={{ fontWeight: 600, color: '#1a1a2e', marginBottom: '2px' }}>
              {MODE_LABELS[mode]}
            </div>
            {MODE_DESCRIPTIONS[mode]}
          </div>

          {/* 实验模式 */}
          <SectionTitle>实验模式</SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
            {modeKeys.map(m => (
              <button
                key={m}
                onClick={() => handleModeChange(m)}
                style={{
                  fontSize: '10px',
                  fontWeight: mode === m ? 600 : 400,
                  color: mode === m ? '#1a1a2e' : '#777',
                  backgroundColor: mode === m ? '#F0F3F6' : '#FFFFFF',
                  border: '1px solid',
                  borderColor: mode === m ? '#1a1a2e' : '#D0D0D0',
                  borderRadius: '2px',
                  padding: '6px 4px',
                  cursor: 'pointer',
                  transition: 'all 150ms ease-out',
                  fontFamily: FONT,
                }}
              >
                {MODE_LABELS[m]}
              </button>
            ))}
          </div>

          {/* 输入图案 */}
          <SectionTitle>输入图案 f(x,y)</SectionTitle>
          <Select
            value={inputPattern}
            onValueChange={(v) => setInputPattern(v as InputPattern)}
          >
            <SelectTrigger style={{ height: '32px', fontSize: '11px' }}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(INPUT_LABELS) as InputPattern[]).map(k => (
                <SelectItem key={k} value={k}>{INPUT_LABELS[k]}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* 快速预设 */}
          <SectionTitle>快速预设</SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
            <Button
              variant="outline"
              size="sm"
              onClick={() => applyPreset('smooth')}
              style={{ fontSize: '10px', height: '28px' }}
            >
              平滑去噪
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => applyPreset('edge')}
              style={{ fontSize: '10px', height: '28px' }}
            >
              边缘提取
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => applyPreset('sharpen')}
              style={{ fontSize: '10px', height: '28px' }}
            >
              字符锐化
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => applyPreset('vertical')}
              style={{ fontSize: '10px', height: '28px' }}
            >
              方向滤波
            </Button>
          </div>

          {/* 滤波器类型 (模式 1-3 显示) */}
          {mode !== 'convolution-demo' && (
            <>
              <SectionTitle>滤波器类型 H(u,v)</SectionTitle>
              <Select
                value={filterType}
                onValueChange={(v) => setFilterType(v as FilterType)}
              >
                <SelectTrigger style={{ height: '32px', fontSize: '11px' }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(FILTER_LABELS) as FilterType[]).map(k => (
                    <SelectItem key={k} value={k}>{FILTER_LABELS[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* 截止频率 (低通/高通/带通) */}
              {(filterType === 'lowpass' || filterType === 'highpass' || filterType === 'bandpass' || filterType === 'custom') && (
                <SliderRow
                  label="截止频率 fc (归一化)"
                  value={fc}
                  min={0.05}
                  max={0.5}
                  step={0.01}
                  onChange={setFc}
                  format={v => v.toFixed(3)}
                />
              )}

              {/* 带通环宽 */}
              {filterType === 'bandpass' && (
                <SliderRow
                  label="环宽 Δf"
                  value={ringWidth}
                  min={0.02}
                  max={0.2}
                  step={0.01}
                  onChange={setRingWidth}
                  format={v => v.toFixed(3)}
                />
              )}

              {/* 方向滤波参数 */}
              {filterType === 'directional' && (
                <>
                  <SliderRow
                    label="阻挡方向 θ (°)"
                    value={direction}
                    min={0}
                    max={360}
                    step={5}
                    onChange={setDirection}
                    format={v => `${v.toFixed(0)}°`}
                  />
                  <SliderRow
                    label="角度宽度 Δθ (°)"
                    value={angularWidth}
                    min={5}
                    max={90}
                    step={1}
                    onChange={setAngularWidth}
                    format={v => `${v.toFixed(0)}°`}
                  />
                  <div style={{
                    fontSize: '9px', color: '#888', lineHeight: '1.6',
                    padding: '6px 8px', backgroundColor: '#FAFAFA',
                    border: '1px solid #F0F2F5', borderRadius: '2px', marginTop: '4px',
                  }}>
                    θ=0° 阻挡水平方向 (保留垂直结构)<br/>
                    θ=90° 阻挡垂直方向 (保留水平结构)
                  </div>
                </>
              )}
            </>
          )}

          {/* 卷积模式: PSF 参数 */}
          {mode === 'convolution-demo' && (
            <>
              <SectionTitle>点扩散函数 PSF</SectionTitle>
              <Select
                value={psfType}
                onValueChange={(v) => setPsfType(v as PSFType)}
              >
                <SelectTrigger style={{ height: '32px', fontSize: '11px' }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PSF_LABELS) as PSFType[]).map(k => (
                    <SelectItem key={k} value={k}>{PSF_LABELS[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <SliderRow
                label="PSF 尺寸 (σ)"
                value={psfSize}
                min={0.05}
                max={0.5}
                step={0.01}
                onChange={setPsfSize}
                format={v => v.toFixed(3)}
              />
              <div style={{
                fontSize: '9px', color: '#888', lineHeight: '1.6',
                padding: '6px 8px', backgroundColor: '#FAFAFA',
                border: '1px solid #F0F2F5', borderRadius: '2px', marginTop: '4px',
              }}>
                <div style={{ fontWeight: 600, color: '#555', marginBottom: '2px' }}>卷积定理</div>
                g(x,y) = f(x,y) ⊗ h(x,y)<br/>
                ⇔ G(u,v) = F(u,v) · H(u,v)<br/>
                <span style={{ color: '#aaa' }}>δ 函数 PSF → 输出 = 输入 (恒等变换)</span>
              </div>
            </>
          )}

          {/* 显示选项 */}
          <SectionTitle>显示选项</SectionTitle>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <Switch
              checked={showFilterOverlay}
              onCheckedChange={setShowFilterOverlay}
            />
            <Label style={{ fontSize: '10px', color: '#555' }}>
              频谱面叠加滤波掩膜 (红色=阻挡)
            </Label>
          </div>
          <div style={{ marginBottom: '4px' }}>
            <Label style={{ fontSize: '10px', color: '#555', display: 'block', marginBottom: '4px' }}>
              频谱配色
            </Label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
              <button
                onClick={() => setSpectrumColormap('warm')}
                style={{
                  fontSize: '10px', padding: '6px 8px',
                  border: '1px solid',
                  borderColor: spectrumColormap === 'warm' ? '#1a1a2e' : '#D0D0D0',
                  backgroundColor: spectrumColormap === 'warm' ? '#F0F3F6' : '#FFFFFF',
                  borderRadius: '2px', cursor: 'pointer',
                  color: spectrumColormap === 'warm' ? '#1a1a2e' : '#777',
                  fontWeight: spectrumColormap === 'warm' ? 600 : 400,
                  fontFamily: FONT,
                  transition: 'all 120ms ease-out',
                }}
              >
                暖色 (黑→红→黄)
              </button>
              <button
                onClick={() => setSpectrumColormap('grayscale')}
                style={{
                  fontSize: '10px', padding: '6px 8px',
                  border: '1px solid',
                  borderColor: spectrumColormap === 'grayscale' ? '#1a1a2e' : '#D0D0D0',
                  backgroundColor: spectrumColormap === 'grayscale' ? '#F0F3F6' : '#FFFFFF',
                  borderRadius: '2px', cursor: 'pointer',
                  color: spectrumColormap === 'grayscale' ? '#1a1a2e' : '#777',
                  fontWeight: spectrumColormap === 'grayscale' ? 600 : 400,
                  fontFamily: FONT,
                  transition: 'all 120ms ease-out',
                }}
              >
                灰度
              </button>
            </div>
          </div>

          {/* 重置按钮 */}
          <SectionTitle>操作</SectionTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={handleReset}
            style={{ width: '100%', fontSize: '10px', height: '28px' }}
          >
            重置参数到默认值
          </Button>

          {/* 公式参考 */}
          <SectionTitle>公式参考</SectionTitle>
          <div style={{
            padding: '8px 10px',
            backgroundColor: '#FAFAFA',
            border: '1px solid #F0F2F5',
            borderRadius: '2px',
            fontSize: '9px',
            color: '#555',
            lineHeight: '1.8',
            fontFamily: MONO,
          }}>
            <div>F(u,v) = ∫∫ f(x,y)·e^(-2πi(ux+vy)) dxdy</div>
            <div>低通: H = 1, √(u²+v²) &lt; fc</div>
            <div>高通: H = 1 - 低通</div>
            <div>带通: fc₁ &lt; √(u²+v²) &lt; fc₂</div>
            <div>方向: |∠(u,v) − θ| &gt; Δθ/2</div>
            <div>卷积: g = IFFT(FFT(f)·FFT(h))</div>
            <div style={{ marginTop: '4px', color: '#999' }}>L₁ 在后焦面执行 FT, L₂ 执行 IFT</div>
          </div>
        </ControlPanel>

        {/* ─── 右: 可视化区域 ─── */}
        <div
          ref={vizRef}
          className="flex-1 custom-scrollbar min-w-0"
          style={{
            display: 'flex',
            flexDirection: 'column',
            padding: isMobile ? '12px 8px' : '20px 24px',
            overflowY: 'auto',
            alignItems: 'center',
            gap: '16px',
          }}
        >
          {/* 模式描述条 */}
          <div style={{
            width: '100%',
            maxWidth: '780px',
            padding: '8px 12px',
            backgroundColor: '#F8F9FB',
            border: '1px solid #E8ECF0',
            borderRadius: '2px',
            fontSize: '11px',
            color: '#555',
            lineHeight: '1.5',
            fontFamily: FONT,
          }}>
            <span style={{ fontWeight: 600, color: '#1a1a2e' }}>{MODE_LABELS[mode]} · </span>
            {MODE_DESCRIPTIONS[mode]}
          </div>

          {/* 三面板布局: 输入 | 频谱 | 输出 */}
          <div style={{
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            gap: isMobile ? '16px' : '24px',
            justifyContent: 'center',
            alignItems: 'center',
            width: '100%',
            maxWidth: '780px',
          }}>
            {/* 输入面板 */}
            <PanelFrame
              title="输入面 f(x,y)"
              subtitle={INPUT_LABELS[inputPattern]}
              isMobile={isMobile}
            >
              <canvas
                ref={inputCanvasRef}
                style={{
                  maxWidth: '100%',
                  height: 'auto',
                  display: 'block',
                }}
              />
            </PanelFrame>

            {/* 频谱面板 (含滤波掩膜叠加) */}
            <PanelFrame
              title="频谱面 |F(u,v)|·H(u,v)"
              subtitle={
                mode === 'convolution-demo'
                  ? `${PSF_LABELS[psfType]} 频谱`
                  : `${FILTER_LABELS[filterType]} · fc=${fc.toFixed(2)}`
              }
              isMobile={isMobile}
              accent
            >
              <canvas
                ref={spectrumCanvasRef}
                style={{
                  maxWidth: '100%',
                  height: 'auto',
                  display: 'block',
                }}
              />
            </PanelFrame>

            {/* 输出面板 */}
            <PanelFrame
              title="输出面 g(x,y)"
              subtitle={
                mode === 'convolution-demo'
                  ? '卷积结果 f⊗h'
                  : '滤波后图像'
              }
              isMobile={isMobile}
            >
              <canvas
                ref={outputCanvasRef}
                style={{
                  maxWidth: '100%',
                  height: 'auto',
                  display: 'block',
                }}
              />
            </PanelFrame>
          </div>

          {/* 频谱模式标注 */}
          <div style={{
            display: 'flex',
            gap: '16px',
            fontSize: '9px',
            color: '#888',
            fontFamily: MONO,
            flexWrap: 'wrap',
            justifyContent: 'center',
          }}>
            <span>● 频谱配色: {spectrumColormap === 'warm' ? '暖色 (黑→红→黄)' : '灰度'}</span>
            <span>● 对数缩放: log(1+|F|)</span>
            <span>● DC 居中 (fftshift)</span>
            {showFilterOverlay && mode !== 'convolution-demo' && (
              <span style={{ color: '#cc4400' }}>● 红色 = 滤波器阻挡区</span>
            )}
            {mode === 'convolution-demo' && (
              <span style={{ color: '#2D7D46' }}>● 绿色 = PSF 传递函数权重</span>
            )}
          </div>

          {/* 4f 系统示意图 */}
          <div style={{
            width: '100%',
            maxWidth: '780px',
            backgroundColor: '#FFFFFF',
            border: '1px solid #D0D0D0',
            borderRadius: '2px',
            padding: '12px',
          }}>
            <div style={{
              fontSize: '10px', fontWeight: 600, color: '#6b7280',
              fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace",
              textTransform: 'uppercase', letterSpacing: '0.05em',
              marginBottom: '8px',
            }}>
              4f 系统光路示意
            </div>
            <SystemSchematic
              mode={mode}
              filterType={filterType}
              fc={fc}
              psfType={psfType}
              isMobile={isMobile}
            />
          </div>

          {/* 信息面板 */}
          <InfoPanel
            mode={mode}
            filterType={filterType}
            fc={fc}
            ringWidth={ringWidth}
            direction={direction}
            angularWidth={angularWidth}
            psfType={psfType}
            psfSize={psfSize}
            snr={result.snr}
            transmission={result.transmission}
            psfFwhm={result.psfFwhm}
            isMobile={isMobile}
          />

          {/* 物理解释卡 */}
          <PhysicsExplanation
            mode={mode}
            filterType={filterType}
            psfType={psfType}
            isMobile={isMobile}
          />
        </div>
      </div>

      {/* ═══ Footer ═══ */}
      <div
        className="flex-shrink-0 flex items-center"
        style={{
          height: '24px',
          backgroundColor: '#FFFFFF',
          borderTop: '1px solid #CCCCCC',
          paddingLeft: isMobile ? '16px' : '24px',
          paddingRight: isMobile ? '16px' : '24px',
          fontSize: '9px',
          color: '#888',
          fontFamily: MONO,
          gap: '12px',
        }}
      >
        <span style={{
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          flex: '1 1 auto',
        }}>
          v1.0 · 傅里叶4f · {MODE_LABELS[mode]} · {INPUT_LABELS[inputPattern]}
        </span>
        {!isMobile && (
          <>
            <span style={{ flexShrink: 0 }}>
              FFT {N}×{N} · radix-2 Cooley–Tukey
            </span>
            <span style={{ flexShrink: 0 }}>
              SNR: <span className="tabular-nums" style={{ color: '#1a1a2e', fontWeight: 600 }}>{result.snr.toFixed(2)}</span> dB
            </span>
            <span style={{ flexShrink: 0 }}>
              透射: <span className="tabular-nums" style={{ color: '#1a1a2e', fontWeight: 600 }}>{(result.transmission * 100).toFixed(1)}</span>%
            </span>
          </>
        )}
        {isMobile && (
          <span style={{ flexShrink: 0 }}>
            SNR <span className="tabular-nums" style={{ color: '#1a1a2e', fontWeight: 600 }}>{result.snr.toFixed(1)}</span>dB
          </span>
        )}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   11. 面板框架组件
   ═══════════════════════════════════════════════════════════════════ */

function PanelFrame({
  title, subtitle, children, isMobile, accent,
}: {
  title: string
  subtitle: string
  children: React.ReactNode
  isMobile: boolean
  accent?: boolean
}) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      width: isMobile ? '100%' : 'auto',
      maxWidth: isMobile ? '320px' : 'none',
    }}>
      <div style={{
        fontSize: '11px',
        fontWeight: 600,
        color: '#1a1a2e',
        fontFamily: FONT,
        marginBottom: '2px',
        textAlign: 'center',
      }}>
        {title}
      </div>
      <div style={{
        fontSize: '9px',
        color: accent ? '#cc4400' : '#888',
        fontFamily: MONO,
        marginBottom: '6px',
        textAlign: 'center',
      }}>
        {subtitle}
      </div>
      {children}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   12. 物理解释卡
   ═══════════════════════════════════════════════════════════════════ */

function PhysicsExplanation({
  mode, filterType, psfType, isMobile,
}: {
  mode: ExperimentMode
  filterType: FilterType
  psfType: PSFType
  isMobile: boolean
}) {
  let title = ''
  let body = ''

  if (mode === 'lowpass-highpass') {
    if (filterType === 'lowpass') {
      title = '低通滤波 · 平滑效应'
      body = '低通滤波器保留频谱中心的低频分量 (即图像的平滑变化区域), 阻挡外围高频 (细节与边缘). 输出图像变得模糊, 噪声被抑制. 截止频率 fc 越小, 模糊越严重. 这相当于与一个 sinc² 函数做卷积.'
    } else if (filterType === 'highpass') {
      title = '高通滤波 · 边缘增强'
      body = '高通滤波器阻挡低频 (背景、整体亮度), 保留高频 (边缘、细节). 输出图像仅显示原图中的急变区域, 类似边缘检测算子. 常用于图像锐化与高通滤波成像. 注意输出会失去绝对亮度信息.'
    } else {
      title = '自定义滤波 · 复合效果'
      body = '自定义滤波器组合低通与方向阻挡, 实现特定的频域操作. 可以同时去除噪声和特定方向的结构, 在光学信息处理中用于图像增强.'
    }
  } else if (mode === 'directional') {
    title = '方向滤波 · 各向异性'
    body = '方向滤波器阻挡特定角度的频率分量. 例如阻挡 θ=0° (水平频率) 会去除图像中的水平条纹结构, 仅保留垂直边缘; 阻挡 θ=90° 则去除垂直结构. 这是各向异性滤波的典型应用, 常用于去除扫描线、栅格噪声.'
  } else if (mode === 'bandpass') {
    title = '带通滤波 · 边缘提取'
    body = '带通滤波器仅保留某一环形频带内的能量, 同时去除低频 (整体亮度) 和过高频 (噪声). 输出呈现明显的边缘增强效果, 类似 DoG (Difference of Gaussians) 算子. 调节 fc 与 Δf 可控制增强的尺度.'
  } else if (mode === 'convolution-demo') {
    if (psfType === 'gaussian') {
      title = '高斯 PSF · 卷积模糊'
      body = '高斯 PSF 的傅里叶变换仍为高斯 (低通特性), 因此卷积结果为低通滤波后的模糊图像. PSF 越宽 (σ 越大), 模糊越严重. 这是大多数光学成像系统 (有限孔径、像差) 的标准模型, 也是相机散焦的物理基础.'
    } else if (psfType === 'square') {
      title = '方框 PSF · 均值模糊'
      body = '方框 PSF 等价于对图像做局部均值滤波, 其频谱为 sinc² 函数 (带有零点). 输出表现为均匀模糊, 且 sinc² 的零点会在频谱上形成特征十字结构. 这种 PSF 是 CCD/CMOS 像元积分的标准模型.'
    } else {
      title = 'δ 函数 PSF · 恒等变换'
      body = 'δ 函数的傅里叶变换为常数 1, 因此 G = F · 1 = F, 输出 = 输入. 这表示理想冲激响应 (无像差、无衍射极限) 的成像系统. δ PSF 是其他 PSF 的参考基准, SNR 趋于无穷大.'
    }
  }

  return (
    <div style={{
      width: '100%',
      maxWidth: isMobile ? '100%' : '780px',
      backgroundColor: '#FFFFFF',
      border: '1px solid #D0D0D0',
      borderRadius: '2px',
      padding: '12px 14px',
      fontFamily: FONT,
    }}>
      <div style={{
        fontSize: '10px', fontWeight: 600, color: '#6b7280',
        fontFamily: "ui-monospace, 'Cascadia Code', 'Consolas', 'Source Code Pro', monospace",
        textTransform: 'uppercase', letterSpacing: '0.05em',
        marginBottom: '6px',
      }}>
        物理解释
      </div>
      <div style={{
        fontSize: '12px', fontWeight: 600, color: '#1a1a2e',
        marginBottom: '4px',
      }}>
        {title}
      </div>
      <div style={{
        fontSize: '11px', color: '#555', lineHeight: '1.7',
      }}>
        {body}
      </div>
    </div>
  )
}
