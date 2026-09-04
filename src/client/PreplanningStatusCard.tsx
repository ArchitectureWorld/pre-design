import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { useState } from 'react'
import { PreplanningDashboard } from './PreplanningDashboard.tsx'
import { VersionFooter } from './VersionFooter.tsx'

type Props = PropsRuntime<'conversation.chat.node', 'preplanning-status'> & {
  readonly confirm?: (proposalId: string) => Promise<void>
  readonly openProjectFolder?: () => Promise<void>
}

export function PreplanningStatusCard({ node, confirm, openProjectFolder }: Props) {
  const data = node.data
  const [confirmState, setConfirmState] = useState<'idle' | 'running' | 'success'>('idle')
  const [folderState, setFolderState] = useState<'idle' | 'running'>('idle')
  const [error, setError] = useState<string>()
  const status = data.status === 'pending_review'
    ? '待人工确认'
    : data.status === 'attention_required' ? '需要补充信息' : '进行中'
  const confirmProposal = async () => {
    if (data.pendingProposalId === undefined || confirm === undefined) return
    setConfirmState('running')
    setError(undefined)
    try {
      await confirm(data.pendingProposalId)
      setConfirmState('success')
    } catch (cause) {
      setConfirmState('idle')
      setError(cause instanceof Error ? cause.message : '提案确认失败，请重试。')
    }
  }
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
      <small>待确认 {data.pendingProposalCount} 项 · 开放问题 {data.openQuestionCount} 项</small>
      {data.status === 'pending_review' && data.pendingProposalId !== undefined && confirm !== undefined && (
        <button
          disabled={confirmState !== 'idle'}
          onClick={confirmProposal}
          style={{
            background: 'var(--dsh-color-accent, #3568d4)',
            border: 0,
            borderRadius: 8,
            color: '#fff',
            cursor: confirmState === 'running' ? 'wait' : 'pointer',
            fontWeight: 600,
            justifySelf: 'start',
            padding: '8px 12px',
          }}
          type="button"
        >
          {confirmState === 'running' ? '正在确认…' : '人工确认提案'}
        </button>
      )}
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
      {confirmState === 'success' && (
        <span role="status" style={{ color: '#24844b', fontSize: 12 }}>
          提案已确认，正在刷新项目状态。
        </span>
      )}
      {error !== undefined && <span role="alert" style={{ color: '#c33', fontSize: 12 }}>{error}</span>}
      <VersionFooter />
    </section>
  )
}
