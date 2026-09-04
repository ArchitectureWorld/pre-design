import { useEffect, useState, type FormEvent } from 'react'
import { deriveProjectName, type DirectStartInput } from './direct-start.ts'
import { VersionFooter } from './VersionFooter.tsx'
import {
  clearWorkspaceDraft,
  loadWorkspaceDraft,
  saveWorkspaceDraft,
} from './workspace-draft.ts'

export interface PreplanningProjectFormProps {
  readonly start: (input: DirectStartInput) => Promise<void>
  readonly onClose: () => void
  readonly workspacePath?: string
  readonly openProjectFolder?: () => Promise<void>
}

type SubmitState = 'idle' | 'running' | 'success'
type OpenState = 'idle' | 'running'

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : '前期策划启动失败，请重试。'
}

export function PreplanningProjectForm({
  start,
  onClose,
  workspacePath,
  openProjectFolder,
}: PreplanningProjectFormProps) {
  const [initialDraft] = useState(() => loadWorkspaceDraft(workspacePath))
  const [statement, setStatement] = useState(initialDraft.statement)
  const [projectName, setProjectName] = useState(initialDraft.projectName)
  const [nameEdited, setNameEdited] = useState(initialDraft.nameEdited)
  const [mode, setMode] = useState<NonNullable<DirectStartInput['mode']>>(initialDraft.mode)
  const [reportDepth, setReportDepth] = useState<NonNullable<DirectStartInput['reportDepth']>>(initialDraft.reportDepth)
  const [visualBudget, setVisualBudget] = useState(initialDraft.visualBudget)
  const [submitState, setSubmitState] = useState<SubmitState>('idle')
  const [openState, setOpenState] = useState<OpenState>('idle')
  const [error, setError] = useState<string>()
  const workspaceMissing = workspacePath === undefined || workspacePath.trim() === ''

  useEffect(() => {
    if (submitState === 'success') return
    saveWorkspaceDraft(workspacePath, {
      statement,
      projectName,
      nameEdited,
      mode,
      reportDepth,
      visualBudget,
    })
  }, [workspacePath, statement, projectName, nameEdited, mode, reportDepth, visualBudget, submitState])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (workspaceMissing) {
      setError('请先为当前会话选择或创建 DSH 工作区。该工作区就是项目总文件夹。')
      return
    }
    const normalizedName = projectName.trim()
    const normalizedStatement = statement.trim()
    if (normalizedStatement.length === 0) { setError('请输入一句话项目描述。'); return }
    if (normalizedName.length === 0) { setError('未能识别项目名称，请补充项目名称。'); return }
    if (!Number.isInteger(visualBudget) || visualBudget < 0 || visualBudget > 20) {
      setError('概念图预算上限必须是 0 至 20 的整数。')
      return
    }
    setError(undefined)
    setSubmitState('running')
    try {
      await start({ projectName: normalizedName, statement: normalizedStatement, mode, reportDepth, visualBudget })
      clearWorkspaceDraft(workspacePath)
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
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setOpenState('idle')
    }
  }

  const fieldStyle = { display: 'grid', fontSize: 12, gap: 5 } as const
  const controlStyle = {
    background: 'var(--dsw-specific-input-major, #fff)',
    border: '1px solid var(--dsw-alias-border-l2, #c7c9cc)',
    borderRadius: 8,
    color: 'var(--dsw-alias-label-primary, #1f2328)',
    font: 'inherit',
    padding: 9,
  } as const
  const disabled = submitState === 'running' || workspaceMissing

  return (
    <form
      aria-label="新建前期策划项目"
      onSubmit={submit}
      style={{
        background: 'var(--dsw-alias-bg-layer-1, #fff)',
        border: '1px solid var(--dsw-alias-border-l2, rgb(0 0 0 / 18%))',
        borderRadius: 14,
        boxShadow: 'var(--dsw-shadow-lv3, 0 14px 38px rgb(0 0 0 / 18%))',
        boxSizing: 'border-box',
        color: 'var(--dsw-alias-label-primary, #1f2328)',
        display: 'grid', gap: 12, maxHeight: 'calc(100dvh - 32px)', overflowY: 'auto',
        padding: 16, position: 'fixed', right: 16, top: 16,
        width: 'min(420px, calc(100vw - 32px))', zIndex: 2_147_483_000,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <strong style={{ display: 'block', fontSize: 15 }}>新建或继续前期策划</strong>
          <small style={{ display: 'block', opacity: 0.65 }}>一个 DSH 工作区对应一个 Pre 项目</small>
          <small style={{ display: 'block', opacity: 0.65 }}>主流程使用当前会话所选模型</small>
        </div>
        <button aria-label="关闭前期策划面板" onClick={onClose} type="button">×</button>
      </div>
      {workspaceMissing ? (
        <div role="alert" style={{ color: '#c33', fontSize: 12 }}>
          请先为当前会话选择或创建 DSH 工作区。该工作区就是项目总文件夹。
        </div>
      ) : (
        <small style={{ opacity: 0.68, overflowWrap: 'anywhere' }}>
          项目总文件夹：{workspacePath}
        </small>
      )}
      <label style={fieldStyle}>
        一句话描述项目和目标
        <textarea
          aria-label="一句话描述项目和目标"
          disabled={disabled}
          onChange={event => {
            const next = event.target.value
            setStatement(next)
            if (!nameEdited) setProjectName(deriveProjectName(next))
          }}
          placeholder="例如：新建滨江文化活力区并完成全流程前期策划"
          rows={3}
          style={{ ...controlStyle, resize: 'vertical' }}
          value={statement}
        />
      </label>
      <label style={fieldStyle}>
        识别的项目名称（可修改）
        <input
          aria-label="识别的项目名称"
          disabled={disabled}
          onChange={event => { setNameEdited(true); setProjectName(event.target.value) }}
          style={controlStyle}
          value={projectName}
        />
      </label>
      <fieldset disabled={disabled} style={{ border: 0, display: 'grid', gap: 6, margin: 0, padding: 0 }}>
        <legend style={{ fontSize: 12, fontWeight: 600 }}>确认方式</legend>
        <label><input checked={mode === 'manual'} name="mode" onChange={() => setMode('manual')} type="radio" /> 人工确认</label>
        <label><input checked={mode === 'automatic'} name="mode" onChange={() => setMode('automatic')} type="radio" /> 全自动完成</label>
      </fieldset>
      <fieldset disabled={disabled} style={{ border: 0, display: 'flex', gap: 18, margin: 0, padding: 0 }}>
        <legend style={{ fontSize: 12, fontWeight: 600 }}>报告深度</legend>
        <label><input checked={reportDepth === 'standard'} name="depth" onChange={() => setReportDepth('standard')} type="radio" /> 标准汇报</label>
        <label><input checked={reportDepth === 'extended'} name="depth" onChange={() => setReportDepth('extended')} type="radio" /> 扩展汇报</label>
      </fieldset>
      <label style={fieldStyle}>
        概念图预算上限（0–20）
        <input
          aria-label="概念图预算上限"
          disabled={disabled}
          max={20} min={0} onChange={event => setVisualBudget(event.target.valueAsNumber)}
          style={controlStyle} type="number" value={visualBudget}
        />
      </label>
      <small style={{ opacity: 0.68 }}>
        概念图固定由项目级视觉子 Agent 调用 antigravity / gemini-3.1-flash-image；失败不会替换模型。
      </small>
      {error !== undefined && !workspaceMissing && <div role="alert" style={{ color: '#c33', fontSize: 12 }}>{error}</div>}
      {submitState === 'success' && (
        <div role="status" style={{ color: '#24844b', fontSize: 12 }}>
          项目与 Presentation 标准目录已创建，前期策划全流程已经启动。
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
        {submitState === 'running' ? '正在启动…' : '创建或继续全流程'}
      </button>
      {submitState === 'success' && openProjectFolder !== undefined && (
        <button disabled={openState === 'running'} onClick={openFolder} type="button">
          {openState === 'running' ? '正在打开…' : '打开项目文件夹'}
        </button>
      )}
      <VersionFooter />
    </form>
  )
}
