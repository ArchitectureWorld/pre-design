import { useState, type FormEvent } from 'react'
import { deriveProjectName, type DirectStartInput } from './direct-start.ts'

export interface PreplanningProjectFormProps {
  readonly start: (input: DirectStartInput) => Promise<void>
  readonly onClose: () => void
}

type SubmitState = 'idle' | 'running' | 'success'

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : '前期策划启动失败，请重试。'
}

export function PreplanningProjectForm({ start, onClose }: PreplanningProjectFormProps) {
  const [statement, setStatement] = useState('')
  const [projectName, setProjectName] = useState('')
  const [nameEdited, setNameEdited] = useState(false)
  const [mode, setMode] = useState<NonNullable<DirectStartInput['mode']>>('manual')
  const [reportDepth, setReportDepth] = useState<NonNullable<DirectStartInput['reportDepth']>>('standard')
  const [visualBudget, setVisualBudget] = useState(8)
  const [submitState, setSubmitState] = useState<SubmitState>('idle')
  const [error, setError] = useState<string>()

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
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
      setSubmitState('success')
    } catch (cause) {
      setError(messageOf(cause))
      setSubmitState('idle')
    }
  }

  const fieldStyle = { display: 'grid', fontSize: 12, gap: 5 } as const
  return (
    <form
      aria-label="新建前期策划项目"
      onSubmit={submit}
      style={{
        background: 'var(--dsh-color-background, #fff)',
        border: '1px solid color-mix(in srgb, currentColor 18%, transparent)',
        borderRadius: 14,
        boxShadow: '0 14px 38px rgb(0 0 0 / 18%)',
        color: 'var(--dsh-color-foreground, inherit)',
        display: 'grid', gap: 12, padding: 16, position: 'absolute', right: 0,
        top: 'calc(100% + 8px)', width: 'min(420px, calc(100vw - 32px))', zIndex: 40,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <strong style={{ display: 'block', fontSize: 15 }}>新建前期策划全流程</strong>
          <small style={{ opacity: 0.65 }}>主流程使用当前会话所选模型</small>
        </div>
        <button aria-label="关闭前期策划面板" onClick={onClose} type="button">×</button>
      </div>
      <label style={fieldStyle}>
        一句话描述项目和目标
        <textarea
          aria-label="一句话描述项目和目标"
          disabled={submitState === 'running'}
          onChange={event => {
            const next = event.target.value
            setStatement(next)
            if (!nameEdited) setProjectName(deriveProjectName(next))
          }}
          placeholder="例如：新建滨江文化活力区并完成全流程前期策划"
          rows={3}
          style={{ borderRadius: 8, font: 'inherit', padding: 9, resize: 'vertical' }}
          value={statement}
        />
      </label>
      <label style={fieldStyle}>
        识别的项目名称（可修改）
        <input
          aria-label="识别的项目名称"
          disabled={submitState === 'running'}
          onChange={event => { setNameEdited(true); setProjectName(event.target.value) }}
          style={{ borderRadius: 8, font: 'inherit', padding: 9 }}
          value={projectName}
        />
      </label>
      <fieldset style={{ border: 0, display: 'grid', gap: 6, margin: 0, padding: 0 }}>
        <legend style={{ fontSize: 12, fontWeight: 600 }}>确认方式</legend>
        <label><input checked={mode === 'manual'} name="mode" onChange={() => setMode('manual')} type="radio" /> 人工确认</label>
        <label><input checked={mode === 'automatic'} name="mode" onChange={() => setMode('automatic')} type="radio" /> 全自动完成</label>
      </fieldset>
      <fieldset style={{ border: 0, display: 'flex', gap: 18, margin: 0, padding: 0 }}>
        <legend style={{ fontSize: 12, fontWeight: 600 }}>报告深度</legend>
        <label><input checked={reportDepth === 'standard'} name="depth" onChange={() => setReportDepth('standard')} type="radio" /> 标准汇报</label>
        <label><input checked={reportDepth === 'extended'} name="depth" onChange={() => setReportDepth('extended')} type="radio" /> 扩展汇报</label>
      </fieldset>
      <label style={fieldStyle}>
        概念图预算上限（0–20）
        <input
          aria-label="概念图预算上限"
          max={20} min={0} onChange={event => setVisualBudget(event.target.valueAsNumber)}
          style={{ borderRadius: 8, font: 'inherit', padding: 9 }} type="number" value={visualBudget}
        />
      </label>
      <small style={{ opacity: 0.68 }}>
        概念图固定由项目级视觉子 Agent 调用 antigravity / gemini-3.1-flash-image；失败不会替换模型。
      </small>
      {error !== undefined && <div role="alert" style={{ color: '#c33', fontSize: 12 }}>{error}</div>}
      {submitState === 'success' && (
        <div role="status" style={{ color: '#24844b', fontSize: 12 }}>项目已创建，前期策划全流程已经启动。</div>
      )}
      <button
        disabled={submitState !== 'idle'}
        style={{
          background: 'var(--dsh-color-accent, #3568d4)', border: 0, borderRadius: 9,
          color: '#fff', cursor: submitState === 'running' ? 'wait' : 'pointer',
          fontWeight: 600, padding: '10px 12px',
        }}
        type="submit"
      >
        {submitState === 'running' ? '正在启动…' : '创建并开始全流程'}
      </button>
    </form>
  )
}
