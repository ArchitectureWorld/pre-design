import { useState, type FormEvent } from 'react'
import { deriveWorkspaceProjectName } from './direct-start.ts'
import { VersionFooter } from './VersionFooter.tsx'

export interface PreplanningProjectFormProps {
  readonly start: () => Promise<void>
  readonly onClose?: () => void
  readonly workspacePath?: string
  readonly workspaceTitle?: string
  readonly openProjectFolder?: () => Promise<void>
  readonly embedded?: boolean
}

type SubmitState = 'idle' | 'running' | 'success'
type OpenState = 'idle' | 'running' | 'success'

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : '前期策划项目启动失败，请重试。'
}

export function PreplanningProjectForm({
  start,
  onClose,
  workspacePath,
  workspaceTitle,
  openProjectFolder,
  embedded = false,
}: PreplanningProjectFormProps) {
  const [submitState, setSubmitState] = useState<SubmitState>('idle')
  const [openState, setOpenState] = useState<OpenState>('idle')
  const [error, setError] = useState<string>()
  const workspaceMissing = workspacePath === undefined || workspacePath.trim() === ''
  const projectName = workspaceTitle?.trim()
    || (workspacePath === undefined ? '' : deriveWorkspaceProjectName(workspacePath))

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (workspaceMissing) {
      setError('请先选择或创建 DSH 工作区。该工作区就是当前 Pre 项目。')
      return
    }
    setError(undefined)
    setSubmitState('running')
    try {
      await start()
      setSubmitState('success')
    } catch (cause) {
      setError(messageOf(cause))
      setSubmitState('idle')
    }
  }

  const openFolder = async () => {
    if (openProjectFolder === undefined) return
    setError(undefined)
    setOpenState('running')
    try {
      await openProjectFolder()
      setOpenState('success')
    } catch (cause) {
      setError(messageOf(cause))
      setOpenState('idle')
    }
  }

  const panelStyle = embedded
    ? {
        background: 'var(--dsw-alias-bg-layer-1, #fff)',
        border: '1px solid var(--dsw-alias-border-l2, rgb(0 0 0 / 18%))',
        borderRadius: 14,
        boxSizing: 'border-box' as const,
        color: 'var(--dsw-alias-label-primary, #1f2328)',
        display: 'grid',
        gap: 14,
        margin: '48px auto',
        maxWidth: 680,
        padding: 24,
        width: 'calc(100% - 48px)',
      }
    : {
        background: 'var(--dsw-alias-bg-layer-1, #fff)',
        border: '1px solid var(--dsw-alias-border-l2, rgb(0 0 0 / 18%))',
        borderRadius: 14,
        boxShadow: 'var(--dsw-shadow-lv3, 0 14px 38px rgb(0 0 0 / 18%))',
        boxSizing: 'border-box' as const,
        color: 'var(--dsw-alias-label-primary, #1f2328)',
        display: 'grid',
        gap: 12,
        maxHeight: 'calc(100dvh - 32px)',
        overflowY: 'auto' as const,
        padding: 16,
        position: 'fixed' as const,
        right: 16,
        top: 16,
        width: 'min(420px, calc(100vw - 32px))',
        zIndex: 2_147_483_000,
      }

  return (
    <form aria-label="前期策划项目" onSubmit={submit} style={panelStyle}>
      <div style={{ alignItems: 'flex-start', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <strong style={{ display: 'block', fontSize: 16, lineHeight: '28px' }}>前期策划</strong>
          {!workspaceMissing && projectName.length > 0 && (
            <div style={{ fontSize: 14, fontWeight: 600, marginTop: 4 }}>{projectName}</div>
          )}
        </div>
        {!embedded && onClose !== undefined && (
          <button
            aria-label="关闭前期策划面板"
            onClick={onClose}
            style={{
              alignItems: 'center', alignSelf: 'start', background: 'transparent', border: 0,
              borderRadius: 8, color: 'inherit', cursor: 'pointer', display: 'inline-flex',
              fontSize: 20, height: 28, justifyContent: 'center', lineHeight: 1, opacity: 0.72,
              padding: 0, width: 28,
            }}
            type="button"
          >
            ×
          </button>
        )}
      </div>

      {workspaceMissing ? (
        <div role="alert" style={{ color: '#c33', fontSize: 12 }}>
          请先选择或创建 DSH 工作区。该工作区就是当前 Pre 项目。
        </div>
      ) : (
        <small style={{ opacity: 0.68, overflowWrap: 'anywhere' }}>
          项目总文件夹：{workspacePath}
        </small>
      )}

      <div style={{
        background: 'color-mix(in srgb, var(--dsh-color-accent, #3568d4) 6%, transparent)',
        borderRadius: 10,
        display: 'grid',
        gap: 6,
        padding: '12px 14px',
      }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>零输入启动</span>
        <small style={{ lineHeight: 1.55, opacity: 0.72 }}>
          Pre 直接使用当前 DSH 工作区，并自动读取工作区中的“原始资料”目录；无需填写项目描述或项目名称。
        </small>
      </div>

      {error !== undefined && !workspaceMissing && (
        <div role="alert" style={{ color: '#c33', fontSize: 12 }}>{error}</div>
      )}
      {submitState === 'success' && (
        <div role="status" style={{ color: '#24844b', fontSize: 12 }}>
          项目已创建或恢复，系统将自动推进前期策划。
        </div>
      )}

      <button
        disabled={submitState !== 'idle' || workspaceMissing}
        style={{
          background: 'var(--dsh-color-accent, #3568d4)', border: 0, borderRadius: 9,
          color: '#fff', cursor: submitState === 'running' ? 'wait' : 'pointer',
          fontWeight: 600, padding: '10px 12px',
        }}
        type="submit"
      >
        {submitState === 'running' ? '正在启动…' : '开始前期策划'}
      </button>

      {!workspaceMissing && openProjectFolder !== undefined && (
        <button
          disabled={openState === 'running'}
          onClick={openFolder}
          style={{
            background: 'transparent', border: '1px solid var(--dsw-alias-border-l2, #c7c9cc)',
            borderRadius: 9, color: 'inherit', cursor: openState === 'running' ? 'wait' : 'pointer',
            fontWeight: 600, padding: '9px 12px',
          }}
          type="button"
        >
          {openState === 'running' ? '正在打开…' : '打开项目文件夹'}
        </button>
      )}
      {openState === 'success' && (
        <div role="status" style={{ color: '#24844b', fontSize: 12, textAlign: 'center' }}>
          项目文件夹已打开。
        </div>
      )}
      <VersionFooter />
    </form>
  )
}
