'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { useIsMobile } from '@/hooks/use-mobile'
import type { ViewId, ExperimentNode } from '@/lib/navigation'

const FONT = "system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif"
const MONO = 'var(--font-geist-mono), monospace'

interface HubContentProps {
  title: string
  subtitle?: string
  experiments: ExperimentNode[]
  onNavigate: (id: ViewId) => void
}

export function HubContent({ title, subtitle, experiments, onNavigate }: HubContentProps) {
  const isMobile = useIsMobile()
  const [pressedCard, setPressedCard] = useState<string | null>(null)
  const [hoveredCard, setHoveredCard] = useState<string | null>(null)

  return (
    <div className="dot-grid h-full overflow-y-auto custom-scrollbar"
      style={{ padding: isMobile ? '24px 16px 32px' : '36px 32px 48px' }}>
      <div style={{ maxWidth: '920px', margin: '0 auto' }}>
        {/* ─── 标题区 ─── */}
        <div style={{ marginBottom: isMobile ? '20px' : '28px' }}>
          {/* Eyebrow + 计数 */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: '8px',
          }}>
            <span className="eyebrow" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ width: '12px', height: '1px', backgroundColor: '#888888', display: 'inline-block' }} />
              BRANCH · 学科分支
            </span>
            <span style={{
              fontFamily: MONO, fontSize: '10px', color: '#888888',
              letterSpacing: '0.04em',
            }} className="tabular-nums">
              {experiments.length} MODULES
            </span>
          </div>

          {/* 标题 */}
          <h1 style={{
            fontFamily: FONT, fontSize: isMobile ? '22px' : '28px', fontWeight: 600,
            color: '#1A1A1A', margin: 0, letterSpacing: '-0.02em', lineHeight: 1.2,
          }}>
            {title}
          </h1>
          {subtitle && (
            <p style={{
              fontFamily: FONT, fontSize: isMobile ? '12px' : '13px', fontWeight: 400,
              color: '#666666', margin: '8px 0 0 0', lineHeight: 1.7, maxWidth: '640px',
            }}>
              {subtitle}
            </p>
          )}

          {/* 分割线 */}
          <div style={{
            marginTop: '16px', height: '1px',
            background: 'linear-gradient(90deg, #E0E4E8 0%, #E0E4E8 70%, transparent 100%)',
          }} />
        </div>

        {/* ─── 实验卡片网格 ─── */}
        <div className="flex items-start justify-center flex-wrap"
          style={{ gap: isMobile ? '14px' : '18px' }}>
          {experiments.map((sub, idx) => {
            const isHovered = hoveredCard === sub.id
            const isPressed = pressedCard === sub.id
            const num = String(idx + 1).padStart(2, '0')
            return (
              <div key={sub.id} className={`optics-card card-hover-lift focus-ring card-entrance${idx > 0 ? '-delay-' + Math.min(idx, 2) : ''}`}
                role="button" tabIndex={0} aria-label={`进入${sub.title}`}
                onMouseEnter={() => setHoveredCard(sub.id)}
                onMouseLeave={() => { setHoveredCard(null); setPressedCard(null) }}
                onMouseDown={() => setPressedCard(sub.id)}
                onMouseUp={() => setPressedCard(null)}
                onClick={() => {
                  if (sub.comingSoon) {
                    toast(`${sub.title}模块正在开发中`, { description: '敬请期待下一版本更新' })
                  } else {
                    onNavigate(sub.id)
                  }
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    if (sub.comingSoon) {
                      toast(`${sub.title}模块正在开发中`, { description: '敬请期待下一版本更新' })
                    } else {
                      onNavigate(sub.id)
                    }
                  }
                }}
                style={{
                  width: isMobile ? '100%' : '260px',
                  maxWidth: isMobile ? '360px' : '260px',
                  minHeight: isMobile ? '170px' : '220px',
                  backgroundColor: isPressed ? '#E6E9EC' : isHovered ? '#FFFFFF' : '#FAFAFA',
                  border: `1px solid ${isHovered ? '#1A1A1A' : '#D0D0D0'}`,
                  borderRadius: '3px', cursor: 'pointer',
                  display: 'flex', flexDirection: 'column',
                  padding: isMobile ? '16px' : '20px 20px 16px 20px',
                  userSelect: 'none', position: 'relative',
                  overflow: 'hidden',
                }}
              >
                {/* 顶部细线强调（hover 时显现） */}
                <div style={{
                  position: 'absolute', top: 0, left: 0, right: 0, height: '2px',
                  backgroundColor: '#1A1A1A',
                  opacity: isHovered ? 1 : 0,
                  transition: 'opacity 200ms ease-out',
                }} />

                {/* 头部：编号 + icon徽章 */}
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  marginBottom: '14px',
                }}>
                  <span style={{
                    fontFamily: MONO, fontSize: '10px', fontWeight: 500,
                    color: isHovered ? '#1A1A1A' : '#AAAAAA',
                    letterSpacing: '0.1em',
                    transition: 'color 200ms ease-out',
                  }} className="tabular-nums">
                    {num} / {String(experiments.length).padStart(2, '0')}
                  </span>
                  <div style={{
                    width: '40px', height: '40px', borderRadius: '50%',
                    border: `1.5px solid ${isHovered ? '#1A1A1A' : '#333333'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: sub.iconText.length > 1 ? '14px' : '20px',
                    fontWeight: 600, color: '#333333',
                    fontFamily: FONT,
                    backgroundColor: isHovered ? '#FFFFFF' : 'transparent',
                    transition: 'background-color 200ms ease-out, border-color 200ms ease-out',
                  }}>
                    {sub.iconText}
                  </div>
                </div>

                {/* 标题 + 描述 */}
                <h2 style={{
                  fontFamily: FONT, fontSize: isMobile ? '14px' : '15px', fontWeight: 600,
                  color: '#1A1A1A', margin: '0 0 6px 0', textAlign: 'left',
                  letterSpacing: '-0.01em',
                }}>
                  {sub.title}
                </h2>
                <p style={{
                  fontFamily: FONT, fontSize: isMobile ? '10.5px' : '11px', fontWeight: 400,
                  color: '#666666', margin: 0, textAlign: 'left', lineHeight: '1.6',
                  flex: 1,
                }}>
                  {sub.description}
                </p>

                {/* 底部信息栏 */}
                <div style={{
                  marginTop: '12px', paddingTop: '10px',
                  borderTop: '1px solid #E8ECF0',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  fontFamily: FONT, fontSize: '10px',
                }}>
                  <span style={{
                    color: sub.comingSoon ? '#AAAAAA' : '#888888',
                    display: 'flex', alignItems: 'center', gap: '4px',
                  }}>
                    <span style={{
                      width: '5px', height: '5px', borderRadius: '50%',
                      backgroundColor: sub.comingSoon ? '#C0C4C8' : '#00AA44',
                      display: 'inline-block',
                    }} />
                    {sub.comingSoon ? '即将上线' : '可用'}
                  </span>
                  {!sub.comingSoon && (
                    <span style={{
                      display: 'flex', alignItems: 'center', gap: '4px',
                      color: isHovered ? '#1A1A1A' : '#888888',
                      fontWeight: 500,
                      transition: 'color 200ms ease-out, transform 200ms ease-out',
                      transform: isHovered ? 'translateX(2px)' : 'translateX(0)',
                    }}>
                      打开
                      <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
                        <path d="M1.5 4.5H7M7 4.5L4.5 2M7 4.5L4.5 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  )}
                </div>

                {sub.comingSoon && (
                  <div style={{
                    position: 'absolute', top: '10px', right: '10px',
                    fontSize: '8px', fontWeight: 600, color: '#888888',
                    fontFamily: FONT, padding: '2px 6px',
                    border: '1px solid #D0D0D0', borderRadius: '2px',
                    backgroundColor: '#FAFAFA',
                    letterSpacing: '0.04em',
                  }}>
                    SOON
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* ─── 底部提示 ─── */}
        <div style={{
          marginTop: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: FONT, fontSize: '11px', color: '#AAAAAA', gap: '6px',
        }}>
          <span style={{ width: '12px', height: '1px', backgroundColor: '#E0E4E8' }} />
          <span>点击卡片进入实验 · 使用左侧导航切换模块</span>
          <span style={{ width: '12px', height: '1px', backgroundColor: '#E0E4E8' }} />
        </div>
      </div>
    </div>
  )
}
