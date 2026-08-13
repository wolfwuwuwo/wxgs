/**
 * PDF 实验报告生成器 — 仿实验室讲义格式
 *
 * 设计原则：
 * - 干净的单页（或多页）布局，无装饰元素
 * - 黑白印刷友好，无渐变无阴影
 * - 标题 + 日期 + 实验者 + 快照 + 参数表 + 结论
 * - A4 纵向， margins 20mm
 */

import { jsPDF } from 'jspdf'
import type { Snapshot } from './experiment-store'
import { findBranch, findExperiment } from './navigation'
import { loadChineseFont, registerChineseFont } from './pdf-font'

interface ReportMeta {
  /** 报告标题 */
  title?: string
  /** 实验者姓名 */
  experimenter?: string
  /** 学号/班级 */
  studentId?: string
  /** 课程名称 */
  course?: string
  /** 实验日期 YYYY-MM-DD */
  date?: string
  /** 结论文字 */
  conclusion?: string
}

const PAGE_W = 210 // A4 mm
const PAGE_H = 297
const MARGIN = 20
const CONTENT_W = PAGE_W - MARGIN * 2

/**
 * SimHei（黑体）未覆盖的符号/上下标字形。
 * jsPDF 遇到缺失字形时会直接截断该段文本，因此必须在写入 PDF 前
 * 替换为字体中存在的等价字符，否则中文正文会从缺失字符处丢失。
 */
const PDF_GLYPH_MAP: Record<string, string> = {
  // 上标：²³¹⁰⁴⁵⁶⁷⁸⁹⁺⁻
  '²': '^2',
  '³': '^3',
  '¹': '^1',
  '⁰': '^0',
  '⁴': '^4',
  '⁵': '^5',
  '⁶': '^6',
  '⁷': '^7',
  '⁸': '^8',
  '⁹': '^9',
  '⁺': '^+',
  '⁻': '^-',
  // 下标数字：₀-₉ ₊ ₋
  '₀': '0',
  '₁': '1',
  '₂': '2',
  '₃': '3',
  '₄': '4',
  '₅': '5',
  '₆': '6',
  '₇': '7',
  '₈': '8',
  '₉': '9',
  '₊': '+',
  '₋': '-',
  // 下标字母
  'ₘ': 'm',
  'ₙ': 'n',
  'ₒ': 'o',
  'ₑ': 'e',
  'ₖ': 'k',
  'ₜ': 't',
  'ₗ': 'l',
  'ₚ': 'p',
  'ᵢ': 'i',
  'ᵀ': 'T',
  'ᵏ': 'k',
  'ᵗ': 't',
  'ⱼ': 'j',
  // 符号
  '·': '×',
  '•': '*',
  '●': '*',
  '○': 'o',
  '◎': 'o',
  '■': '□',
  '△': 'Δ',
  '▽': 'Δ',
  '▼': 'Δ',
  '▶': '>',
  '─': '-',
  '═': '=',
  '⌘': 'Ctrl',
  '⌖': '+',
  '↵': '↓',
  '∂': 'd',
  '∇': 'Δ',
  '−': '-',
  '⇔': '↔',
  '⇒': '→',
  '↻': '↔',
  '↺': '↔',
  '⚠': '!',
  '💡': '*',
  '½': '1/2',
  '✓': '√',
  '✗': '×',
  '✕': '×',
  '‘': "'",
  '’': "'",
  '“': '"',
  '”': '"',
  'é': 'e',
  '†': '+',
  '̄': '',
}

/** 将文本中的缺失字形替换为 SimHei 可用字符，并移除 emoji/组合符号 */
function normalizePdfText(text: string): string {
  let out = text
  for (const [from, to] of Object.entries(PDF_GLYPH_MAP)) {
    if (from && out.includes(from)) {
      out = out.split(from).join(to)
    }
  }
  // 移除 emoji、变体选择符与组合附加符号（SimHei 均无对应字形）
  return out.replace(/[\u{1F000}-\u{1FAFF}\u{FE00}-\u{FE0F}\u0300-\u036F]/gu, '')
}

/**
 * 生成实验报告 PDF
 */
export async function generateReportPDF(
  snapshots: Snapshot[],
  meta: ReportMeta = {}
): Promise<jsPDF> {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  })

  // 加载并注册中文字体（SimHei 子集）
  let font = 'helvetica'
  try {
    const fontBase64 = await loadChineseFont()
    registerChineseFont(doc, fontBase64)
    font = 'SimHei'
  } catch {
    // 字体加载失败时回退到 helvetica（仅支持 Latin）
    console.warn('中文字体加载失败，PDF 中文可能显示为乱码')
  }
  const today = meta.date || new Date().toISOString().slice(0, 10)

  let y = MARGIN

  /* ── 报告头 ── */
  doc.setFont(font, 'normal')
  doc.setFontSize(16)
  doc.text(normalizePdfText(meta.title || '光学仿真实验报告'), PAGE_W / 2, y, { align: 'center' })
  y += 8

  // 副标题分隔线
  doc.setDrawColor(180)
  doc.setLineWidth(0.3)
  doc.line(MARGIN, y, PAGE_W - MARGIN, y)
  y += 6

  // 元信息表
  doc.setFont(font, 'normal')
  doc.setFontSize(10)
  const metaRows: [string, string][] = [
    ['课程', meta.course || '光学实验'],
    ['实验者', meta.experimenter || ''],
    ['学号', meta.studentId || ''],
    ['日期', today],
    ['快照数', `${snapshots.length}`],
  ]
  const metaLabelW = 22
  const metaValueW = CONTENT_W / 2 - metaLabelW
  for (let i = 0; i < metaRows.length; i++) {
    const col = i % 2
    const row = Math.floor(i / 2)
    const x = MARGIN + col * (CONTENT_W / 2)
    const ry = y + row * 6
    doc.setFont(font, 'normal')
    doc.text(normalizePdfText(metaRows[i][0] + '：'), x, ry)
    doc.setFont(font, 'normal')
    doc.text(normalizePdfText(metaRows[i][1] || '—'), x + metaLabelW, ry, {
      maxWidth: metaValueW - metaLabelW,
    })
  }
  y += Math.ceil(metaRows.length / 2) * 6 + 4

  doc.setDrawColor(220)
  doc.setLineWidth(0.2)
  doc.line(MARGIN, y, PAGE_W - MARGIN, y)
  y += 6

  /* ── 快照内容 ── */
  doc.setFont(font, 'normal')
  doc.setFontSize(12)
  doc.text(normalizePdfText('实验观测'), MARGIN, y)
  y += 6

  for (let i = 0; i < snapshots.length; i++) {
    const snap = snapshots[i]
    const exp = findExperiment(snap.viewId)
    const branch = findBranch(snap.viewId)
    const expLabel = exp ? `${branch?.title || ''} / ${exp.title}` : snap.experimentTitle

    // 检查是否需要换页
    if (y > PAGE_H - 80) {
      doc.addPage()
      y = MARGIN
    }

    // 快照标题
    doc.setFont(font, 'normal')
    doc.setFontSize(10)
    doc.text(normalizePdfText(`图 ${i + 1}  ${snap.title}`), MARGIN, y)
    y += 4

    // 来源 + 时间
    doc.setFont(font, 'normal')
    doc.setFontSize(8)
    doc.setTextColor(110)
    doc.text(normalizePdfText(`${expLabel}  ·  ${snap.timestamp.replace('T', ' ').slice(0, 16)}`), MARGIN, y)
    y += 4
    doc.setTextColor(0)

    // 图片
    const maxImgW = CONTENT_W
    const maxImgH = 90 // 单图最大高度
    const ratio = snap.height / snap.width
    let imgW = maxImgW
    let imgH = imgW * ratio
    if (imgH > maxImgH) {
      imgH = maxImgH
      imgW = imgH / ratio
    }
    // 居中
    const imgX = MARGIN + (CONTENT_W - imgW) / 2
    try {
      doc.addImage(snap.image, 'PNG', imgX, y, imgW, imgH)
    } catch {
      doc.setFontSize(8)
      doc.text(normalizePdfText('[图像加载失败]'), imgX, y + 4)
    }
    y += imgH + 3

    // 参数表
    if (snap.params.length > 0) {
      doc.setFont(font, 'normal')
      doc.setFontSize(8)
      doc.text(normalizePdfText('参数：'), MARGIN, y)
      doc.setFont(font, 'normal')
      const paramText = normalizePdfText(snap.params.map(p => `${p.key}=${p.value}`).join('  ·  '))
      const lines = doc.splitTextToSize(paramText, CONTENT_W - 12)
      doc.text(lines, MARGIN + 12, y)
      y += lines.length * 3.6 + 2
    }

    // 备注
    if (snap.notes) {
      doc.setFont(font, 'normal')
      doc.setFontSize(8)
      doc.setTextColor(80)
      const noteLines = doc.splitTextToSize(normalizePdfText(`备注：${snap.notes}`), CONTENT_W)
      doc.text(noteLines, MARGIN, y)
      y += noteLines.length * 3.6 + 2
      doc.setTextColor(0)
    }

    y += 4
    doc.setDrawColor(230)
    doc.setLineWidth(0.15)
    doc.line(MARGIN, y, PAGE_W - MARGIN, y)
    y += 5
  }

  /* ── 结论 ── */
  if (meta.conclusion) {
    if (y > PAGE_H - 50) {
      doc.addPage()
      y = MARGIN
    }
    doc.setFont(font, 'normal')
    doc.setFontSize(12)
    doc.text(normalizePdfText('实验结论'), MARGIN, y)
    y += 6
    doc.setFont(font, 'normal')
    doc.setFontSize(10)
    const conclusionLines = doc.splitTextToSize(normalizePdfText(meta.conclusion), CONTENT_W)
    doc.text(conclusionLines, MARGIN, y)
    y += conclusionLines.length * 5 + 4
  }

  /* ── 页脚（页码 + 生成时间） ── */
  const pageCount = doc.getNumberOfPages()
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p)
    doc.setFont(font, 'normal')
    doc.setFontSize(7)
    doc.setTextColor(140)
    doc.text(
      normalizePdfText(
        `第 ${p} / ${pageCount} 页  ·  光学仿真实验平台 v5.0  ·  生成于 ${new Date().toLocaleString('zh-CN')}`
      ),
      PAGE_W / 2,
      PAGE_H - 10,
      { align: 'center' }
    )
    doc.setTextColor(0)
  }

  return doc
}

/**
 * 导出 PDF（触发浏览器下载）
 */
export async function exportReportPDF(snapshots: Snapshot[], meta: ReportMeta = {}) {
  const doc = await generateReportPDF(snapshots, meta)
  const filename = `光学实验报告_${new Date().toISOString().slice(0, 10)}.pdf`
  doc.save(filename)
}

/**
 * 打印报告（在新窗口打开 PDF）
 */
export async function printReportPDF(snapshots: Snapshot[], meta: ReportMeta = {}) {
  const doc = await generateReportPDF(snapshots, meta)
  const blobUrl = doc.output('bloburl')
  if (typeof window !== 'undefined') {
    window.open(blobUrl as unknown as string, '_blank')
  }
}
