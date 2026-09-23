import { useEffect, useId, useRef, useState } from 'react'
import { AGENT_CLASSES, type ClassExecution, type ExecutionStatus } from '../agent-classes/types.ts'
import { GlassIcon } from './GlassIcon.tsx'
import { GlassAction, GlassHelp } from './GlassControls.tsx'

export function executionStatusLabel(status: ExecutionStatus): string {
  return ({ starting: '正在启动', running: '执行中 / 等待结果校验', completed: '已完成', failed: '执行失败', cancelled: '已取消', recovery_required: '需要恢复确认' } as const)[status]
}
export function childActivityLabel(activity: ClassExecution['activity']): string {
  return activity === 'running' ? '子会话运行中' : activity === 'idle' ? '子会话空闲' : '子会话状态未知'
}
const timestamp = (value: string): number => { const time = Date.parse(value); return Number.isFinite(time) ? time : 0 }
const displayTime = (value: string): string => timestamp(value) ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '时间未知'

export function ClassExecutionPanel({ projectId, executions }: { readonly projectId?: string; readonly executions: readonly ClassExecution[] }) {
  return projectId ? <ExecutionHistory key={projectId} projectId={projectId} executions={executions} /> : null
}
function ExecutionHistory({ projectId, executions }: { readonly projectId: string; readonly executions: readonly ClassExecution[] }) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const id = useId()
  // New tasks, not old tasks whose activity was just refreshed, belong at the top.
  const runs = executions.filter(run => run.projectId === projectId).slice().sort((a, b) =>
    (timestamp(b.startedAt) || timestamp(b.updatedAt)) - (timestamp(a.startedAt) || timestamp(a.updatedAt))
    || timestamp(b.updatedAt) - timestamp(a.updatedAt) || a.id.localeCompare(b.id))
  const pending = runs.filter(run => ['starting', 'running', 'recovery_required'].includes(run.status)).length
  const dismiss = () => { setOpen(false); trigger.current?.focus() }
  return <section className="execution-panel" aria-label="当前项目执行记录">
    <button className="history-trigger" type="button" ref={trigger} aria-label={`执行记录 · ${runs.length} 条`} aria-haspopup="dialog" aria-expanded={open} aria-controls={id} onClick={() => setOpen(true)}>
      <GlassIcon name="clock" /><span>执行记录</span><span className="history-count">{runs.length}</span>
      {pending > 0 && <span className="pending-count">{pending} 项未结束</span>}<GlassIcon name="expand" />
    </button>
    {open && <ExecutionDialog id={id} runs={runs} onClose={dismiss} />}
  </section>
}
function ExecutionDialog({ id, runs, onClose }: { readonly id: string; readonly runs: readonly ClassExecution[]; readonly onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (typeof element.showModal === 'function') element.showModal()
    else element.setAttribute('open', '')
    return () => { if (element.open && typeof element.close === 'function') element.close() }
  }, [])
  const dismiss = () => {
    // Remove modal inertness before restoring focus to the trigger outside the dialog.
    const element = dialog.current
    if (element?.open) { if (typeof element.close === 'function') element.close(); else element.removeAttribute('open') }
    onClose()
  }
  return <dialog className="pre-dialog execution-dialog" ref={dialog} id={id} aria-label="执行记录" onCancel={event => { event.preventDefault(); dismiss() }} onClose={onClose}
    onClick={event => {
      if (event.target !== event.currentTarget) return
      const r = event.currentTarget.getBoundingClientRect()
      if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dismiss()
    }}>
    <header className="dialog-heading"><div><h3>执行记录</h3><span className="history-count">{runs.length} 条 · 最新在前</span></div>
      <div className="settings-tools"><GlassHelp label="执行状态说明"><p>按启动时间倒序排列。子会话空闲不代表任务完成；这里只读取执行记录，不启动或重复提交任务。</p></GlassHelp><GlassAction icon="close" label="关闭执行记录" autoFocus onClick={dismiss} /></div>
    </header>
    <div className="execution-scroll" tabIndex={0} role="region" aria-label="执行记录列表">
      {runs.length === 0 ? <p className="pre-empty">暂无执行记录</p> : runs.map(run => <article className="execution-row" key={run.id}>
        <div className="execution-summary"><strong>{run.task}</strong><span className="pre-tag" data-outcome={run.status}>{executionStatusLabel(run.status)}</span></div>
        <p className="execution-meta"><span>{AGENT_CLASSES.find(kind => kind.id === run.classId)?.title ?? run.classId} · <span>{childActivityLabel(run.activity)}</span></span><time dateTime={run.startedAt}>{displayTime(run.startedAt)}</time></p>
        <details><summary>执行详情</summary><dl><dt>执行编号</dt><dd>{run.id}</dd><dt>启动配置版本</dt><dd>{run.configurationRevision}</dd><dt>选用模型 / 工具</dt><dd>{run.selected.provider} / {run.selected.model}</dd>
          {run.selected.llm && <><dt>启动时配套 LLM</dt><dd>{run.selected.llm.provider} / {run.selected.llm.model}</dd></>}
          {run.actual && <><dt>实际模型 / 工具</dt><dd>{run.actual.provider} / {run.actual.model}</dd></>}
          {run.actual?.llm && <><dt>实际配套 LLM</dt><dd>{run.actual.llm.provider} / {run.actual.llm.model}</dd></>}
          {run.childId && <><dt>子会话</dt><dd>{run.childId}</dd></>}
          {run.childStopReason && <><dt>停止原因</dt><dd>{run.childStopReason}</dd></>}
          <dt>更新时间</dt><dd><time dateTime={run.updatedAt}>{displayTime(run.updatedAt)}</time></dd></dl>
          {run.routeChain && <div className="execution-chain"><span>启动时备用顺序</span><ol>{run.routeChain.map((route, index) => <li key={index}>{route.provider} / {route.model}{route.llm && <span> · LLM: {route.llm.provider} / {route.llm.model}</span>}</li>)}</ol></div>}
          {run.error && <p className="pre-error">{run.error}</p>}
        </details>
      </article>)}
    </div>
  </dialog>
}
