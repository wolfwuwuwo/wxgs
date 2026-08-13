/**
 * PDF 中文字体加载器
 *
 * jsPDF 内置字体（helvetica/times/courier）不含 CJK 字形，
 * 导出实验报告时中文全部显示为乱码。
 *
 * 解决方案：全量 SimHei（黑体）TTF 字体（~7.2 MB，覆盖全部常用汉字与符号）
 * - jsPDF 4.x 在嵌入 PDF 时会自动子集化，报告体积仍保持在数百 KB 级别
 * - 注意：仅注册 normal 样式，报告代码中不要使用 bold/italic，
 *   否则 jsPDF 会回退到不包含中文字形的 Times 字体导致乱码
 *
 * 字体在首次 PDF 生成时通过 fetch 加载，base64 编码后缓存。
 */

let fontBase64: string | null = null
let loadPromise: Promise<string> | null = null

/**
 * 将 ArrayBuffer 转为 base64 字符串
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return typeof btoa !== 'undefined' ? btoa(binary) : Buffer.from(binary, 'binary').toString('base64')
}

/**
 * 加载 SimHei 子集字体并返回 base64 数据
 */
export async function loadChineseFont(): Promise<string> {
  if (fontBase64) return fontBase64
  if (loadPromise) return loadPromise

  loadPromise = (async () => {
    // 优先使用站点根路径，兼容子路径/本地文件部署时回退到相对路径
    const urls = ['/fonts/simhei.ttf', './fonts/simhei.ttf']
    let lastError: unknown = null
    for (const url of urls) {
      try {
        const response = await fetch(url)
        if (response.ok) {
          const buffer = await response.arrayBuffer()
          fontBase64 = arrayBufferToBase64(buffer)
          return fontBase64
        }
        lastError = new Error(`字体加载失败: ${url} (${response.status})`)
      } catch (err) {
        lastError = err
      }
    }
    throw lastError ?? new Error('中文字体加载失败')
  })()

  return loadPromise
}

/**
 * 将中文字体注册到 jsPDF 实例
 */
export function registerChineseFont(doc: import('jspdf').jsPDF, base64: string): void {
  doc.addFileToVFS('SimHei.ttf', base64)
  doc.addFont('SimHei.ttf', 'SimHei', 'normal')
}
