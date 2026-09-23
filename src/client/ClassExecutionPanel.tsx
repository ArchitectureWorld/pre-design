import { AGENT_CLASSES, type ClassExecution, type ExecutionStatus } from '../agent-classes/types.ts'

export function executionStatusLabel(status: ExecutionStatus): string {
  return ({ starting: '正在启动', running: '执行中 / 等待结果校验', completed: '已完成', failed: '执行失败', cancelled: '已取消', recovery_required: '需要恢复确认' } as const)[status]
}
export function childActivityLabel(activity: ClassExecution['activity']): string {
  return activity === 'running' ? '子会话运行中' : activity === 'idle' ? '子会话空闲' : '子会话状态未知'
}
export function ClassExecutionPanel({ projectId, executions }: { readonly projectId?: string; readonly executions: readonly ClassExecution[] }) {
  if (!projectId) return null
  const runs = executions.filter(run => run.projectId === projectId).slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return <section className="execution-panel" aria-label="当前项目执行记录">
    <header><div><h3>当前项目执行记录</h3><p>结果状态与子会话活动分别显示；子会话空闲不代表任务已完成。</p></div><span className="pre-tag">{runs.length} 条记录</span></header>
    {runs.length === 0 ? <p className="pre-empty">当前项目暂无执行记录。这里不会自动启动任务。</p> : runs.slice(0, 20).map(run => <article className="execution-row" key={run.id}>
      <div className="execution-summary"><strong>{run.task}</strong><span className="pre-tag" data-outcome={run.status}>{executionStatusLabel(run.status)}</span></div>
      <p>{AGENT_CLASSES.find(kind => kind.id === run.classId)?.title ?? run.classId} · <span>{childActivityLabel(run.activity)}</span></p>
      <details><summary>执行详情</summary><dl><dt>执行编号</dt><dd>{run.id}</dd><dt>启动配置版本</dt><dd>{run.configurationRevision}</dd><dt>选用模型</dt><dd>{run.selected.provider} / {run.selected.model}</dd>
        {run.actual && <><dt>实际模型</dt><dd>{run.actual.provider} / {run.actual.model}</dd></>}
        {run.childId && <><dt>子会话</dt><dd>{run.childId}</dd></>}
        {run.childStopReason && <><dt>停止原因</dt><dd>{run.childStopReason}</dd></>}
        <dt>更新时间</dt><dd><time dateTime={run.updatedAt}>{run.updatedAt}</time></dd></dl>
        {run.error && <p className="pre-error">{run.error}</p>}
      </details>
    </article>)}
    {runs.length > 20 && <p className="pre-muted">显示最近 20 条，共 {runs.length} 条。</p>}
  </section>
}
