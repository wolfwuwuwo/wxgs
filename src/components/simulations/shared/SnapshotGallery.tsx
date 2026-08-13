'use client'

/**
 * 快照画廊 — 临时记录区
 *
 * 功能：
 * - 列出所有快照（缩略图 + 标题 + 时间 + 来源 + 参数）
 * - 勾选用于导出 PDF
 * - 编辑标题/备注
 * - 单张删除 / 全部清空
 * - 一键导出 PDF（仿实验室讲义）
 * - 打印
 *
 * 触发方式：StatusBar 快照按钮点击 → 弹出抽屉
 */

import { useState, useMemo, useCallback } from 'react'
import { useExperimentStore } from '@/lib/experiment-store'
import { exportReportPDF, printReportPDF } from '@/lib/pdf-report'
import { findBranch, findExperiment } from '@/lib/navigation'
import { useIsMobile } from '@/hooks/use-mobile'

const FONT = "system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif"
const MONO = 'var(--font-geist-mono), ui-monospace, monospace'

interface SnapshotGalleryProps {
  open: boolean
  onClose: () => void
}

export function SnapshotGallery({ open, onClose }: SnapshotGalleryProps) {
  const isMobile = useIsMobile()
  const snapshots = useExperimentStore(s => s.snapshots)
  const toggleSelected = useExperimentStore(s => s.toggleSnapshotSelected)
  const removeSnapshot = useExperimentStore(s => s.removeSnapshot)
  const clearSnapshots = useExperimentStore(s => s.clearSnapshots)
  const selectAll = useExperimentStore(s => s.selectAllSnapshots)
  const updateNotes = useExperimentStore(s => s.updateSnapshotNotes)
  const updateTitle = useExperimentStore(s => s.updateSnapshotTitle)

  const [meta, setMeta] = useState({
    experimenter: '',
    studentId: '',
    course: '光学实验',
    conclusion: '',
  })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editNotes, setEditNotes] = useState('')

  const selectedCount = useMemo(() => snapshots.filter(s => s.selected).length, [snapshots])

  const handleExport = useCallback(() => {
    const selected = snapshots.filter(s => s.selected)
    if (selected.length === 0) {
      alert('请至少勾选一个快照用于导出')
      return
    }
    exportReportPDF(selected, meta)
  }, [snapshots, meta])

  const handlePrint = useCallback(() => {
    const selected = snapshots.filter(s => s.selected)
    if (selected.length === 0) {
      alert('请至少勾选一个快照用于打印')
      return
    }
    printReportPDF(selected, meta)
  }, [snapshots, meta])

  const startEdit = useCallback((s: typeof snapshots[number]) => {
    setEditingId(s.id)
    setEditTitle(s.title)
    setEditNotes(s.notes || '')
  }, [])

  const saveEdit = useCallback(() => {
    if (editingId) {
      updateTitle(editingId, editTitle)
      updateNotes(editingId, editNotes)
    }
    setEditingId(null)
  }, [editingId, editTitle, editNotes, updateTitle, updateNotes])

  if (!open) return null

  return (
    <>
      {/* 遮罩 */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.18)',
          zIndex: 40, backdropFilter: 'blur(1px)',
        }}
      />

      {/* 抽屉（右侧滑入） */}
      <aside
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: isMobile ? '92vw' : '460px',
          backgroundColor: '#FFFFFF',
          borderLeft: '1px solid #D0D0D0',
          zIndex: 41,
          display: 'flex', flexDirection: 'column',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 200ms ease-out',
        }}
      >
        {/* 头部 */}
        <header
          style={{
            height: '48px', padding: '0 16px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            borderBottom: '1px solid #E8ECF0', flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ color: '#555' }}>
              <path d="M2 4.5H4L4.8 3.5H9.2L10 4.5H12V11.5H2V4.5Z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
              <circle cx="7" cy="7.5" r="2" stroke="currentColor" strokeWidth="1" />
            </svg>
            <span style={{ fontFamily: FONT, fontSize: '13px', fontWeight: 600, color: '#1A1A1A' }}>
              实验快照记录
            </span>
            <span style={{ fontFamily: MONO, fontSize: '10px', color: '#888' }}>
              {snapshots.length} 张 · 已选 {selectedCount}
            </span>
          </div>
          <button
            onClick={onClose}
            aria-label="关闭"
            style={{
              width: '28px', height: '28px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'none', border: '1px solid transparent', cursor: 'pointer',
              color: '#888', borderRadius: '2px',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#D0D0D0'; e.currentTarget.style.color = '#1A1A1A' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.color = '#888' }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        {/* 报告元信息 */}
        <div
          style={{
            padding: '12px 16px', borderBottom: '1px solid #E8ECF0',
            backgroundColor: '#FAFAFA', flexShrink: 0,
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px',
          }}
        >
          <Field label="实验者">
            <input
              value={meta.experimenter}
              onChange={e => setMeta({ ...meta, experimenter: e.target.value })}
              placeholder="姓名"
              style={inputStyle}
            />
          </Field>
          <Field label="学号">
            <input
              value={meta.studentId}
              onChange={e => setMeta({ ...meta, studentId: e.target.value })}
              placeholder="学号"
              style={inputStyle}
            />
          </Field>
          <Field label="课程" fullWidth>
            <input
              value={meta.course}
              onChange={e => setMeta({ ...meta, course: e.target.value })}
              style={inputStyle}
            />
          </Field>
          <Field label="实验结论" fullWidth>
            <textarea
              value={meta.conclusion}
              onChange={e => setMeta({ ...meta, conclusion: e.target.value })}
              placeholder="本次系列实验的主要观察与结论..."
              rows={2}
              style={{ ...inputStyle, resize: 'vertical', minHeight: '40px' }}
            />
          </Field>
        </div>

        {/* 工具栏 */}
        <div
          style={{
            padding: '8px 16px', borderBottom: '1px solid #E8ECF0',
            display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0,
            flexWrap: 'wrap',
          }}
        >
          <ToolButton onClick={() => selectAll(true)} disabled={snapshots.length === 0}>
            全选
          </ToolButton>
          <ToolButton onClick={() => selectAll(false)} disabled={snapshots.length === 0}>
            全不选
          </ToolButton>
          <div style={{ flex: 1 }} />
          <ToolButton
            onClick={handleExport}
            disabled={selectedCount === 0}
            primary
          >
            导出 PDF ({selectedCount})
          </ToolButton>
          <ToolButton onClick={handlePrint} disabled={selectedCount === 0}>
            打印
          </ToolButton>
          <ToolButton
            onClick={() => {
              if (snapshots.length > 0 && confirm('确定清空所有快照？此操作不可撤销。')) {
                clearSnapshots()
              }
            }}
            disabled={snapshots.length === 0}
            danger
          >
            清空
          </ToolButton>
        </div>

        {/* 快照列表 */}
        <div
          className="custom-scrollbar"
          style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}
        >
          {snapshots.length === 0 ? (
            <div
              style={{
                padding: '40px 20px', textAlign: 'center',
                color: '#999', fontFamily: FONT, fontSize: '12px',
              }}
            >
              <div style={{ fontSize: '32px', marginBottom: '12px', opacity: 0.3 }}>⌖</div>
              <div>暂无快照</div>
              <div style={{ fontSize: '10px', marginTop: '6px', color: '#BBB' }}>
                在实验过程中点击底部状态栏的「快照」按钮<br />
                截取当前实验视图存入此处
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {snapshots.map((s, idx) => {
                const exp = findExperiment(s.viewId)
                const branch = findBranch(s.viewId)
                return (
                  <div
                    key={s.id}
                    style={{
                      border: `1px solid ${s.selected ? '#1A1A1A' : '#E0E4E8'}`,
                      borderRadius: '3px', backgroundColor: '#FFFFFF',
                      overflow: 'hidden',
                      transition: 'border-color 120ms ease-out',
                    }}
                  >
                    {/* 头部：勾选 + 标题 + 操作 */}
                    <div
                      style={{
                        display: 'flex', alignItems: 'center', gap: '8px',
                        padding: '6px 8px', borderBottom: '1px solid #F0F2F5',
                        backgroundColor: s.selected ? '#F8F8F8' : 'transparent',
                      }}
                    >
                      <button
                        onClick={() => toggleSelected(s.id)}
                        aria-label={s.selected ? '取消勾选' : '勾选用于导出'}
                        style={{
                          width: '16px', height: '16px',
                          border: `1.5px solid ${s.selected ? '#1A1A1A' : '#999'}`,
                          backgroundColor: s.selected ? '#1A1A1A' : '#FFFFFF',
                          cursor: 'pointer', display: 'flex',
                          alignItems: 'center', justifyContent: 'center',
                          padding: 0, borderRadius: '1px', flexShrink: 0,
                        }}
                      >
                        {s.selected && (
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                            <path d="M2 5L4 7L8 3" stroke="#FFF" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </button>
                      <span style={{ fontFamily: MONO, fontSize: '9px', color: '#AAA', flexShrink: 0 }}>
                        #{idx + 1}
                      </span>
                      {editingId === s.id ? (
                        <input
                          value={editTitle}
                          onChange={e => setEditTitle(e.target.value)}
                          style={{
                            flex: 1, fontFamily: FONT, fontSize: '11px', fontWeight: 600,
                            border: '1px solid #D0D0D0', padding: '2px 4px', borderRadius: '1px',
                            outline: 'none',
                          }}
                        />
                      ) : (
                        <span
                          style={{
                            flex: 1, fontFamily: FONT, fontSize: '11px', fontWeight: 600,
                            color: '#1A1A1A', overflow: 'hidden', textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {s.title}
                        </span>
                      )}
                      {editingId === s.id ? (
                        <>
                          <MiniBtn onClick={saveEdit}>保存</MiniBtn>
                          <MiniBtn onClick={() => setEditingId(null)}>取消</MiniBtn>
                        </>
                      ) : (
                        <>
                          <MiniBtn onClick={() => startEdit(s)}>编辑</MiniBtn>
                          <MiniBtn
                            danger
                            onClick={() => {
                              if (confirm('删除此快照？')) removeSnapshot(s.id)
                            }}
                          >
                            删除
                          </MiniBtn>
                        </>
                      )}
                    </div>

                    {/* 缩略图 */}
                    <div
                      style={{
                        padding: '8px', display: 'flex', gap: '8px',
                        backgroundColor: '#FAFAFA',
                      }}
                    >
                      <div
                        style={{
                          width: '110px', height: '80px', flexShrink: 0,
                          border: '1px solid #E0E4E8', backgroundColor: '#FFFFFF',
                          backgroundImage: `url(${s.image})`,
                          backgroundSize: 'contain', backgroundPosition: 'center',
                          backgroundRepeat: 'no-repeat',
                        }}
                      />
                      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <div style={{ fontFamily: FONT, fontSize: '9px', color: '#888' }}>
                          {branch?.title} / {exp?.title || s.experimentTitle}
                        </div>
                        <div style={{ fontFamily: MONO, fontSize: '9px', color: '#AAA' }}>
                          {s.timestamp.replace('T', ' ').slice(0, 16)} · {s.width}×{s.height}
                        </div>
                        {s.params.length > 0 && (
                          <div
                            style={{
                              fontFamily: MONO, fontSize: '8.5px', color: '#555',
                              lineHeight: 1.5, marginTop: '2px',
                              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1px 8px',
                              overflow: 'hidden',
                            }}
                          >
                            {s.params.slice(0, 6).map((p, i) => (
                              <span key={i} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {p.key}={p.value}
                              </span>
                            ))}
                            {s.params.length > 6 && (
                              <span style={{ color: '#AAA' }}>+{s.params.length - 6}</span>
                            )}
                          </div>
                        )}
                        {s.notes && editingId !== s.id && (
                          <div
                            style={{
                              fontFamily: FONT, fontSize: '9px', color: '#777',
                              fontStyle: 'italic', marginTop: '2px',
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}
                          >
                            "{s.notes}"
                          </div>
                        )}
                      </div>
                    </div>

                    {/* 编辑备注 */}
                    {editingId === s.id && (
                      <div style={{ padding: '8px', borderTop: '1px solid #F0F2F5' }}>
                        <textarea
                          value={editNotes}
                          onChange={e => setEditNotes(e.target.value)}
                          placeholder="备注..."
                          rows={2}
                          style={{
                            width: '100%', fontFamily: FONT, fontSize: '10px',
                            border: '1px solid #D0D0D0', padding: '4px 6px',
                            borderRadius: '1px', resize: 'vertical', outline: 'none',
                          }}
                        />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </aside>
    </>
  )
}

/* ─── 内部组件 ─── */

function Field({ label, children, fullWidth }: { label: string; children: React.ReactNode; fullWidth?: boolean }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '3px', gridColumn: fullWidth ? '1 / -1' : 'auto' }}>
      <span style={{ fontFamily: "system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif", fontSize: '9px', color: '#888', fontWeight: 500 }}>
        {label}
      </span>
      {children}
    </label>
  )
}

const inputStyle: React.CSSProperties = {
  fontFamily: "system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif",
  fontSize: '11px',
  border: '1px solid #D0D0D0',
  padding: '3px 6px',
  borderRadius: '1px',
  outline: 'none',
  backgroundColor: '#FFFFFF',
  width: '100%',
}

function ToolButton({
  children, onClick, disabled, primary, danger,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  primary?: boolean
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        fontFamily: "system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif",
        fontSize: '10px', fontWeight: 500,
        padding: '4px 10px', height: '24px', minHeight: '44px',
        border: `1px solid ${
          disabled ? '#E8ECF0' :
          primary ? '#1A1A1A' :
          danger ? '#CC3333' : '#D0D0D0'
        }`,
        backgroundColor: disabled ? '#FAFAFA' : primary ? '#1A1A1A' : '#FFFFFF',
        color: disabled ? '#CCC' : primary ? '#FFFFFF' : danger ? '#CC3333' : '#333',
        cursor: disabled ? 'not-allowed' : 'pointer',
        borderRadius: '2px',
        transition: 'all 120ms ease-out',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}
      onMouseEnter={e => {
        if (disabled) return
        if (primary) e.currentTarget.style.backgroundColor = '#333'
        else if (danger) e.currentTarget.style.backgroundColor = '#FFF0F0'
        else e.currentTarget.style.borderColor = '#888'
      }}
      onMouseLeave={e => {
        if (disabled) return
        if (primary) e.currentTarget.style.backgroundColor = '#1A1A1A'
        else if (danger) e.currentTarget.style.backgroundColor = '#FFFFFF'
        else e.currentTarget.style.borderColor = '#D0D0D0'
      }}
    >
      {children}
    </button>
  )
}

function MiniBtn({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontFamily: "system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif",
        fontSize: '9px', fontWeight: 500,
        padding: '2px 6px', height: '18px',
        border: '1px solid transparent',
        backgroundColor: 'transparent',
        color: danger ? '#CC5555' : '#888',
        cursor: 'pointer',
        borderRadius: '1px',
        transition: 'all 100ms ease-out',
        flexShrink: 0,
      }}
      onMouseEnter={e => {
        e.currentTarget.style.border = `1px solid ${danger ? '#CC3333' : '#D0D0D0'}`
        e.currentTarget.style.color = danger ? '#CC3333' : '#1A1A1A'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.border = '1px solid transparent'
        e.currentTarget.style.color = danger ? '#CC5555' : '#888'
      }}
    >
      {children}
    </button>
  )
}
