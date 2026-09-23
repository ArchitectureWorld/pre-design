import { useRef, useState, type FormEvent } from 'react'
import { GlassAction, GlassHelp } from './GlassControls.tsx'
import { GlassIcon } from './GlassIcon.tsx'
import { deriveWorkspaceProjectName, type DirectStartResult } from './direct-start.ts'
import { VersionFooter } from './VersionFooter.tsx'

export interface PreplanningProjectFormProps {
  readonly start: () => Promise<DirectStartResult>
  readonly onClose?: () => void
  readonly workspacePath?: string
  readonly workspaceTitle?: string
  readonly openProjectFolder?: () => Promise<void>
  readonly embedded?: boolean
  readonly checkingProject?: boolean
  readonly projectReadError?: string
  readonly existingProjectId?: string
  readonly projectRunning?: boolean
}

type SubmitState = 'idle' | 'running' | 'success' | 'waiting_for_source'
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
  checkingProject = false,
  projectReadError,
  existingProjectId,
  projectRunning = false,
}: PreplanningProjectFormProps) {
  const submitting = useRef(false), opening = useRef(false)
  const [submitState, setSubmitState] = useState<SubmitState>('idle')
  const [startResult, setStartResult] = useState<DirectStartResult>()
  const [openState, setOpenState] = useState<OpenState>('idle')
  const [error, setError] = useState<string>()
  const workspaceMissing = workspacePath === undefined || workspacePath.trim() === ''
  const projectName = workspaceTitle?.trim()
    || (workspacePath === undefined ? '' : deriveWorkspaceProjectName(workspacePath))

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting.current || checkingProject || projectReadError || existingProjectId || submitState === 'running' || submitState === 'success') return
    if (workspaceMissing) {
      setError('请先选择或创建 DSH 工作区。该工作区就是当前 Pre 项目。')
      return
    }
    setError(undefined)
    setSubmitState('running')
    submitting.current = true
    try {
      const result = await start()
      setStartResult(result)
      setSubmitState(result.state === 'running' ? 'success' : 'waiting_for_source')
    } catch (cause) {
      setError(messageOf(cause))
      setSubmitState('idle')
    } finally { submitting.current = false }
  }

  const openFolder = async () => {
    if (openProjectFolder === undefined || opening.current) return
    opening.current = true
    setError(undefined)
    setOpenState('running')
    try {
      await openProjectFolder()
      setOpenState('success')
    } catch (cause) {
      setError(messageOf(cause))
      setOpenState('idle')
    } finally { opening.current = false }
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

  if (embedded) {
    const buttonLabel = projectReadError ? '项目状态读取失败' : checkingProject ? '正在读取项目状态…' : existingProjectId
      ? projectRunning ? '项目运行中' : '已关联项目'
      : submitState === 'success' ? '前期策划已启动' : submitState === 'running' ? '正在启动…'
      : submitState === 'waiting_for_source' ? '重新检测原始资料' : '开始前期策划'
    return <form className="project-card" aria-label="前期策划项目" onSubmit={submit}>
      <div className="project-identity"><div className="folder-tile" aria-hidden="true"><GlassIcon name="folder" /></div>
        <div className="project-copy"><h1>前期策划</h1>
          {!workspaceMissing && <><p className="project-name">{projectName}</p><p className="project-path" title={`项目总文件夹：${workspacePath}`}>{workspacePath}</p></>}
          {workspaceMissing && <p className="pre-alert" role="alert">请先选择或创建 DSH 工作区。该工作区就是当前 Pre 项目。</p>}
        </div>
      </div>
      <div className="project-right">
        {projectReadError && <p className="pre-warning">尚未确认当前会话的项目状态，请在下方重试读取配置；不会重复启动项目。</p>}
        {error && !workspaceMissing && <div className="pre-alert" role="alert">{error}</div>}
        {submitState === 'success' && startResult?.state === 'running' && <div className="pre-feedback" role="status"><strong>项目已创建或恢复，系统将自动推进前期策划。</strong><p>已登记 {startResult.sourceMaterialCount} 个标准原件；当前“原始资料”检测到 {startResult.sourceInboxFileCount} 个文件。</p></div>}
        {submitState === 'waiting_for_source' && startResult?.state === 'waiting_for_source' && <div className="pre-feedback" role="status"><strong>等待原始资料</strong><p>当前项目尚未检测到可分析资料。请将项目资料放入“原始资料”文件夹。</p><p>标准项目目录已经初始化；检测到资料后才会启动自动前期策划。</p></div>}
        <div className="project-actions">
          <button className={`pre-button pre-primary ${existingProjectId ? 'pre-linked' : ''}`} disabled={!!projectReadError || checkingProject || !!existingProjectId || submitState === 'running' || submitState === 'success' || workspaceMissing} type="submit"><GlassIcon name={existingProjectId ? 'check' : 'link'} />{buttonLabel}</button>
          {!workspaceMissing && openProjectFolder && <GlassAction icon="folder" label={openState === 'running' ? '正在打开…' : '打开项目文件夹'} disabled={openState === 'running'} onClick={openFolder} />}
          <GlassHelp label="项目说明"><p>{existingProjectId ? '当前会话已关联前期策划项目。' : '零输入启动'}</p><p>{existingProjectId ? '下方显示当前项目的实际执行记录，重新打开面板不会再次启动项目。' : 'Pre 直接使用当前 DSH 工作区，并自动读取工作区中的“原始资料”目录；无需填写项目描述或项目名称。'}</p></GlassHelp>
        </div>
        {openState === 'success' && <p className="pre-feedback" role="status">项目文件夹已打开。</p>}
      </div>
    </form>
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
        <span style={{ fontSize: 12, fontWeight: 600 }}>{existingProjectId ? '当前会话已关联前期策划项目。' : '零输入启动'}</span>
        <small style={{ lineHeight: 1.55, opacity: 0.72 }}>
          {existingProjectId
            ? '下方显示当前项目的实际执行记录，重新打开面板不会再次启动项目。'
            : 'Pre 直接使用当前 DSH 工作区，并自动读取工作区中的“原始资料”目录；无需填写项目描述或项目名称。'}
        </small>
      </div>

      {error !== undefined && !workspaceMissing && (
        <div role="alert" style={{ color: '#c33', fontSize: 12 }}>{error}</div>
      )}
      {submitState === 'success' && startResult?.state === 'running' && (
        <div role="status" style={{ color: '#24844b', display: 'grid', fontSize: 12, gap: 4 }}>
          <strong>项目已创建或恢复，系统将自动推进前期策划。</strong>
          <span>
            已登记 {startResult.sourceMaterialCount} 个标准原件；当前“原始资料”检测到 {startResult.sourceInboxFileCount} 个文件。
          </span>
        </div>
      )}
      {submitState === 'waiting_for_source' && startResult?.state === 'waiting_for_source' && (
        <div
          role="status"
          style={{
            background: 'color-mix(in srgb, #b7791f 8%, transparent)',
            borderRadius: 10,
            display: 'grid',
            fontSize: 12,
            gap: 5,
            padding: '12px 14px',
          }}
        >
          <strong>等待原始资料</strong>
          <span>当前项目尚未检测到可分析资料。请将项目资料放入“原始资料”文件夹。</span>
          <span style={{ opacity: 0.72 }}>标准项目目录已经初始化；检测到资料后才会启动自动前期策划。</span>
        </div>
      )}

      <button
        disabled={checkingProject || !!existingProjectId || submitState === 'running' || submitState === 'success' || workspaceMissing}
        style={{
          background: 'var(--dsh-color-accent, #3568d4)', border: 0, borderRadius: 9,
          color: '#fff', cursor: submitState === 'running' ? 'wait' : 'pointer',
          fontWeight: 600, padding: '10px 12px',
        }}
        type="submit"
      >
        {checkingProject
          ? '正在读取项目状态…'
          : existingProjectId
            ? projectRunning ? '项目运行中' : '已关联项目'
          : submitState === 'success'
            ? '前期策划已启动'
          : submitState === 'running'
          ? '正在启动…'
          : submitState === 'waiting_for_source'
            ? '重新检测原始资料'
            : '开始前期策划'}
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
