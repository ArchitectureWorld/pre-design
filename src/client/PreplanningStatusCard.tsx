import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { useState } from 'react'
import { PreplanningDashboard } from './PreplanningDashboard.tsx'
import { VersionFooter } from './VersionFooter.tsx'

type Props = PropsRuntime<'conversation.chat.node', 'preplanning-status'> & {
  readonly openProjectFolder?: () => Promise<void>
}

export function PreplanningStatusCard({ node, openProjectFolder }: Props) {
  const data = node.data
  const [folderState, setFolderState] = useState<'idle' | 'running'>('idle')
  const [error, setError] = useState<string>()
  const status = data.status === 'pending_review'
    ? data.mode === 'automatic' ? '系统正在自动处理' : '兼容流程待处理'
    : data.status === 'attention_required'
      ? '需要补充信息'
      : data.mode === 'automatic' ? '自动推进中' : '进行中'
  const proposalSummary = data.mode === 'automatic'
    ? `自动处理 ${data.pendingProposalCount} 项`
    : `待处理 ${data.pendingProposalCount} 项`
  const openFolder = async () => {
    if (openProjectFolder === undefined) return
    setFolderState('running')
    setError(undefined)
    try {
      await openProjectFolder()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '项目文件夹打开失败，请重试。')
    } finally {
      setFolderState('idle')
    }
  }
  const secondaryButtonStyle = {
    background: 'transparent',
    border: '1px solid color-mix(in srgb, var(--dsh-color-accent, #3568d4) 40%, transparent)',
    borderRadius: 8,
    color: 'inherit',
    cursor: folderState === 'running' ? 'wait' : 'pointer',
    fontWeight: 600,
    justifySelf: 'start',
    padding: '8px 12px',
  } as const
  return (
    <section
      aria-label="前期策划项目状态"
      style={{
        background: 'color-mix(in srgb, var(--dsh-color-accent, #3568d4) 8%, transparent)',
        border: '1px solid color-mix(in srgb, var(--dsh-color-accent, #3568d4) 24%, transparent)',
        borderRadius: 12,
        display: 'grid',
        gap: 8,
        padding: 14,
      }}
    >
      <PreplanningDashboard status={data} />
      <span>{status} · revision {data.revision} · 阶段 {data.stage}</span>
      <small>{proposalSummary} · 开放问题 {data.openQuestionCount} 项</small>
      {openProjectFolder !== undefined && (
        <button
          disabled={folderState === 'running'}
          onClick={openFolder}
          style={secondaryButtonStyle}
          type="button"
        >
          {folderState === 'running' ? '正在打开…' : '打开项目文件夹'}
        </button>
      )}
      {error !== undefined && <span role="alert" style={{ color: '#c33', fontSize: 12 }}>{error}</span>}
      <VersionFooter />
    </section>
  )
}
