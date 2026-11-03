import { researchError } from '../app/src/research-contract.mjs'

export async function collectExecutionTrace(agent, classes, projectId, { since } = {}) {
  const threshold = since === undefined ? 0 : typeof since === 'number' ? since : Date.parse(since)
  if (!Number.isFinite(threshold) || threshold < 0) throw researchError('TRACE_TIME_INVALID')
  const requests = (agent.session?.snapshotEvents?.() ?? []).filter(event => event.type === 'request/header' && event.time >= threshold).flatMap(event => {
    const config = event.data?.header?.config
    if (typeof config?.provider !== 'string' || typeof config.model !== 'string') return []
    return [{ sessionId: String(agent.id), seq: event.seq, time: event.time, turn: event.data.turn, step: event.data.step,
      provider: config.provider, model: config.model, evidence: 'request/header', usage: null }]
  })
  const executions = (await classes.executions(projectId, { all: true })).filter(row => row.projectId === projectId && Date.parse(row.startedAt) >= threshold).map(row => ({
    executionId: row.id, classId: row.classId, childId: row.childId ?? null, status: row.status, startedAt: row.startedAt, updatedAt: row.updatedAt,
    actual: typeof row.actual?.provider === 'string' && typeof row.actual.model === 'string' ? { provider: row.actual.provider, model: row.actual.model } : null,
    evidence: row.actual ? 'native-request-header' : 'not_recorded', usage: null,
  }))
  return { parent: { status: requests.length ? 'recorded' : 'not_recorded', requests }, executions, usage: null }
}
