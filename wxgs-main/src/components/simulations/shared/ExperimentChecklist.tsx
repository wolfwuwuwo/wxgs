'use client'

import { useState } from 'react'

const FONT = "system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif"

export interface ChecklistStep {
  id: string
  label: string
  /** 是否已完成（自动派生自实验状态） */
  done: boolean
  /** 是否为关键步骤（未完成时显示"待完成"） */
  required?: boolean
  /** 完成时的简短说明（可选） */
  doneHint?: string
}

interface ExperimentChecklistProps {
  title?: string
  steps: ChecklistStep[]
  defaultOpen?: boolean
}

/**
 * 智能实验步骤引导与核查清单
 *
 * - 可折叠，灰色文字
 * - 完成步骤自动淡黑打勾，未完成保持浅灰
 * - 关键未完成步骤显示"待完成"
 * - 无进度条或徽章
 */
export function ExperimentChecklist({
  title = '实验操作清单',
  steps,
  defaultOpen = true,
}: ExperimentChecklistProps) {
  const [open, setOpen] = useState(defaultOpen)
  const completedCount = steps.filter(s => s.done).length

  return (
    <div style={{
      border: '1px solid #E0E4E8',
      borderRadius: '3px',
      backgroundColor: '#FAFBFC',
      overflow: 'hidden',
    }}>
      {/* 折叠头 */}
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 10px', minHeight: '44px',
          background: 'none', border: 'none', cursor: 'pointer',
          fontFamily: FONT,
        }}
      >
        <span style={{
          fontSize: '11px', fontWeight: 600, color: '#555555',
          letterSpacing: '0.03em', display: 'flex', alignItems: 'center', gap: '6px',
        }}>
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" style={{
            transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 150ms ease-out',
            color: '#888888',
          }}>
            <path d="M3 1.5L7 5.5L3 9.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {title}
        </span>
        <span style={{
          fontSize: '9px', fontWeight: 400, color: '#AAAAAA',
          fontFamily: 'var(--font-geist-mono), monospace',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {completedCount}/{steps.length}
        </span>
      </button>

      {/* 步骤列表 */}
      {open && (
        <div style={{
          borderTop: '1px solid #E8ECF0',
          padding: '4px 0',
        }}>
          {steps.map((step, idx) => (
            <div
              key={step.id}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: '8px',
                padding: '6px 10px 6px 24px', minHeight: '36px',
                position: 'relative',
              }}
            >
              {/* 步骤序号连接线 */}
              {idx < steps.length - 1 && (
                <span style={{
                  position: 'absolute', left: '15px', top: '18px', bottom: '-6px',
                  width: '1px', backgroundColor: step.done ? '#C0C4C8' : '#E8ECF0',
                }} />
              )}
              {/* 勾选标记 */}
              <span style={{
                position: 'absolute', left: '10px', top: '7px',
                width: '12px', height: '12px', borderRadius: '50%',
                border: `1px solid ${step.done ? '#1A1A1A' : '#C0C4C8'}`,
                backgroundColor: step.done ? '#1A1A1A' : '#FFFFFF',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, transition: 'all 180ms ease-out',
              }}>
                {step.done && (
                  <svg width="7" height="7" viewBox="0 0 7 7" fill="none">
                    <path d="M1 3.5L2.8 5.3L6 1.8" stroke="#FFFFFF" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              {/* 步骤文字 */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{
                  fontFamily: FONT, fontSize: '11px', fontWeight: step.done ? 500 : 400,
                  color: step.done ? '#1A1A1A' : '#999999',
                  lineHeight: 1.5, transition: 'color 180ms ease-out',
                  textDecoration: step.done ? 'none' : 'none',
                }}>
                  {step.label}
                </span>
                {step.done && step.doneHint && (
                  <span style={{
                    display: 'block', fontFamily: 'var(--font-geist-mono), monospace',
                    fontSize: '9px', color: '#AAAAAA', marginTop: '1px',
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {step.doneHint}
                  </span>
                )}
              </div>
              {/* 待完成标记 */}
              {!step.done && step.required && (
                <span style={{
                  fontFamily: FONT, fontSize: '8px', fontWeight: 500, color: '#999999',
                  border: '1px solid #D8DCE0', borderRadius: '2px',
                  padding: '1px 4px', flexShrink: 0, backgroundColor: '#FFFFFF',
                  whiteSpace: 'nowrap',
                }}>
                  待完成
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
