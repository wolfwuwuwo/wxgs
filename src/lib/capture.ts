/**
 * 快照捕获工具 — 截取 Canvas / SVG / HTML 元素为 PNG dataURL
 *
 * 设计原则：
 * - 仅截取图表/模型部分（不包含控制面板、装饰元素）
 * - 优先使用 Canvas.toDataURL()（最高保真）
 * - 退化为 SVG serialize + foreignObject 渲染
 * - 最后退化为 html2canvas 风格的 DOM 重绘（不引入额外依赖，使用 SVG foreignObject）
 */

/**
 * 捕获单个 canvas 元素为 PNG dataURL
 */
export function captureCanvas(canvas: HTMLCanvasElement): {
  image: string
  width: number
  height: number
} | null {
  try {
    const image = canvas.toDataURL('image/png')
    return {
      image,
      width: canvas.width,
      height: canvas.height,
    }
  } catch {
    return null
  }
}

/**
 * 捕获容器内所有 canvas，合成一张图（横向或纵向拼接）
 */
export function captureContainerCanvases(
  container: HTMLElement,
  mode: 'horizontal' | 'vertical' | 'grid' = 'grid'
): { image: string; width: number; height: number } | null {
  const canvases = Array.from(container.querySelectorAll('canvas')) as HTMLCanvasElement[]
  if (canvases.length === 0) return null

  // 过滤掉尺寸为 0 的 canvas
  const valid = canvases.filter(c => c.width > 0 && c.height > 0)
  if (valid.length === 0) return null

  // 单 canvas 直接返回
  if (valid.length === 1) {
    return captureCanvas(valid[0])
  }

  // 计算合成画布尺寸
  const gap = 12
  let totalW = 0
  let totalH = 0

  if (mode === 'horizontal') {
    totalW = valid.reduce((sum, c) => sum + c.width, 0) + gap * (valid.length - 1)
    totalH = Math.max(...valid.map(c => c.height))
  } else if (mode === 'vertical') {
    totalW = Math.max(...valid.map(c => c.width))
    totalH = valid.reduce((sum, c) => sum + c.height, 0) + gap * (valid.length - 1)
  } else {
    // grid: 2 列
    const cols = 2
    const rows = Math.ceil(valid.length / cols)
    const colW: number[] = []
    const rowH: number[] = []
    for (let r = 0; r < rows; r++) {
      const rowCanvases = valid.slice(r * cols, (r + 1) * cols)
      rowH.push(Math.max(...rowCanvases.map(c => c.height)))
    }
    for (let c = 0; c < cols; c++) {
      const colCanvases = valid.filter((_, i) => i % cols === c)
      colW.push(Math.max(...colCanvases.map(c => c.width)))
    }
    totalW = colW.reduce((a, b) => a + b, 0) + gap * (cols - 1)
    totalH = rowH.reduce((a, b) => a + b, 0) + gap * (rows - 1)
  }

  const out = document.createElement('canvas')
  out.width = totalW
  out.height = totalH
  const ctx = out.getContext('2d')
  if (!ctx) return null

  // 白底
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, totalW, totalH)

  // 绘制
  let x = 0
  let y = 0
  if (mode === 'horizontal') {
    for (const c of valid) {
      ctx.drawImage(c, x, 0)
      x += c.width + gap
    }
  } else if (mode === 'vertical') {
    for (const c of valid) {
      ctx.drawImage(c, 0, y)
      y += c.height + gap
    }
  } else {
    const cols = 2
    const rows = Math.ceil(valid.length / cols)
    const colW: number[] = []
    const rowH: number[] = []
    for (let r = 0; r < rows; r++) {
      const rowCanvases = valid.slice(r * cols, (r + 1) * cols)
      rowH.push(Math.max(...rowCanvases.map(c => c.height)))
    }
    for (let c = 0; c < cols; c++) {
      const colCanvases = valid.filter((_, i) => i % cols === c)
      colW.push(Math.max(...colCanvases.map(c => c.width)))
    }
    let cy = 0
    for (let r = 0; r < rows; r++) {
      let cx = 0
      const rowCanvases = valid.slice(r * cols, (r + 1) * cols)
      for (let c = 0; c < rowCanvases.length; c++) {
        ctx.drawImage(rowCanvases[c], cx, cy)
        cx += colW[c] + gap
      }
      cy += rowH[r] + gap
    }
  }

  try {
    return {
      image: out.toDataURL('image/png'),
      width: totalW,
      height: totalH,
    }
  } catch {
    return null
  }
}

/**
 * 捕获 SVG 元素为 PNG dataURL
 */
export function captureSVG(svg: SVGSVGElement): {
  image: string
  width: number
  height: number
} | null {
  try {
    const serializer = new XMLSerializer()
    let svgStr = serializer.serializeToString(svg)

    // 确保有 xmlns
    if (!svgStr.includes('xmlns')) {
      svgStr = svgStr.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"')
    }

    const w = svg.viewBox.baseVal.width || svg.clientWidth || 400
    const h = svg.viewBox.baseVal.height || svg.clientHeight || 300

    const img = new Image()
    const svg64 = btoa(unescape(encodeURIComponent(svgStr)))
    const src = `data:image/svg+xml;base64,${svg64}`

    return new Promise<{ image: string; width: number; height: number } | null>((resolve) => {
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) return resolve(null)
        ctx.fillStyle = '#FFFFFF'
        ctx.fillRect(0, 0, w, h)
        ctx.drawImage(img, 0, 0)
        try {
          resolve({
            image: canvas.toDataURL('image/png'),
            width: w,
            height: h,
          })
        } catch {
          resolve(null)
        }
      }
      img.onerror = () => resolve(null)
      img.src = src
    }) as unknown as { image: string; width: number; height: number } | null
  } catch {
    return null
  }
}

/**
 * 智能捕获：从容器中提取所有 canvas + svg，合成一张图
 * 优先 canvas，其次 svg
 */
export function smartCapture(
  container: HTMLElement
): { image: string; width: number; height: number } | null {
  const canvases = Array.from(container.querySelectorAll('canvas')) as HTMLCanvasElement[]
  const validCanvases = canvases.filter(c => c.width > 0 && c.height > 0)

  if (validCanvases.length > 0) {
    return captureContainerCanvases(container, 'grid')
  }

  // 退化：尝试单个 SVG
  const svg = container.querySelector('svg')
  if (svg) {
    return captureSVG(svg as SVGSVGElement)
  }

  return null
}

/**
 * 截取整个 DOM 元素的渲染快照（用于撕下面板，含 SVG + Canvas + 文本）
 * 使用 SVG foreignObject 包裹 DOM，渲染到 canvas
 */
export function captureElement(
  element: HTMLElement,
  backgroundColor = '#FFFFFF'
): { image: string; width: number; height: number } | null {
  const rect = element.getBoundingClientRect()
  const w = Math.ceil(rect.width)
  const h = Math.ceil(rect.height)
  if (w <= 0 || h <= 0) return null

  // 优先用 canvas 拼接
  const canvases = Array.from(element.querySelectorAll('canvas')) as HTMLCanvasElement[]
  const validCanvases = canvases.filter(c => c.width > 0 && c.height > 0)
  if (validCanvases.length > 0 && canvases.length === element.querySelectorAll('img,canvas,svg').length) {
    // 容器内主要是 canvas
    return captureContainerCanvases(element, 'grid')
  }

  // 退化：clone DOM 到 SVG foreignObject
  try {
    const clone = element.cloneNode(true) as HTMLElement
    clone.style.backgroundColor = backgroundColor
    clone.style.margin = '0'
    clone.style.padding = '0'

    const serializer = new XMLSerializer()
    const cloneStr = serializer.serializeToString(clone)

    const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <foreignObject width="100%" height="100%">
        <div xmlns="http://www.w3.org/1999/xhtml" style="width:${w}px;height:${h}px;background:${backgroundColor};">
          ${cloneStr}
        </div>
      </foreignObject>
    </svg>`

    const img = new Image()
    const svg64 = btoa(unescape(encodeURIComponent(svgStr)))
    const src = `data:image/svg+xml;base64,${svg64}`

    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.fillStyle = backgroundColor
        ctx.fillRect(0, 0, w, h)
        ctx.drawImage(img, 0, 0)
      }
    }
    img.src = src
  } catch {
    /* ignore */
  }

  // 最终退化：尝试 canvas
  if (validCanvases.length > 0) {
    return captureContainerCanvases(element, 'grid')
  }

  return null
}
