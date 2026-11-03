import { describe, expect, it, vi } from 'vitest'
import { DshSubagentWorkflowAnalyzer } from '../src/runtime/subagent-workflow-analyzer.ts'
import { WORKFLOW_AUTHOR_PROJECTION_VERSION } from '../src/runtime/workflow-author-projection.ts'

function fixture(alwaysMissing = false, cancelOnDispose = false, native?: { stopReason: string; diagnostic?: string; events?: any[] }) {
  const events: string[] = [], controller = new AbortController()
  const raw = { projectionVersion: WORKFLOW_AUTHOR_PROJECTION_VERSION, data: {},
    qualityEvidence: { completionChecks: [], evidenceChecks: [], assumptions: [], blockers: [], confidence: 0.5 } }
  let attempt = 0
  const route = { provider: 'user-provider', model: 'user-model', reasoningEffort: 'high' }
  const execution = (index: number) => ({ id: `execution-${index}`, selected: route,
    routeChain: [route, { provider: 'user-backup', model: 'user-backup-model' }], routeIndex: 0 })
  const classes = { begin: vi.fn(async () => execution(0)), attach: vi.fn(),
    finish: vi.fn(async (_id, status) => { events.push(`finish:${status}`) }),
    retryContent: vi.fn(async () => { events.push('retry-content'); return execution(attempt) }), fallback: vi.fn() }
  const start = vi.fn(async (_kind: string, request: any) => {
    const index = attempt++
    events.push(`start:${index}`)
    return { id: `child-${index}`, ...(native?.events ? { localAgent: { session: { snapshotEvents: () => native.events } } } : {}), dispose: async () => {
      events.push(`dispose:${index}`)
      if (cancelOnDispose) controller.abort(new Error('user-cancelled'))
    }, result: Promise.resolve(index > 0 && !alwaysMissing ? { stopReason: 'completed', structured: raw }
      : { stopReason: native?.stopReason ?? 'completed', ...(native?.diagnostic === undefined ? {} : { diagnostic: native.diagnostic }) }) }
  })
  const analyzer = new DshSubagentWorkflowAnalyzer({
    repository: { readContext: () => ({ project: { projectId: 'p', name: 'p', currentRevision: 1 }, stateObjects: [] }) },
    registry: { stateSchema: () => ({ type: 'object', properties: { data: { type: 'object' } } }) },
    subagents: { getProvider: () => ({}), start }, agentClasses: classes,
  } as never)
  const run = () => analyzer.analyze({ id: 'parent' } as never, 'p', {
    workflowId: 'preplan.wf.07.06', targetObjectId: 'SP06', requiredUpstream: [], atomicToolIds: [],
  } as never, controller.signal)
  return { run, classes, start, raw, events }
}

describe('completed native author without structured submission', () => {
  const completedReceipt = [
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ]

  it('recognizes the native driver error caused by an observed completed turn with no structured tool call', async () => {
    const f = fixture(false, false, { stopReason: 'error', events: completedReceipt })
    const candidate = await f.run()
    expect(f.start).toHaveBeenCalledTimes(2)
    expect(f.classes.fallback).not.toHaveBeenCalled()
    expect(f.start.mock.calls[1]![1].prompt[0].text).toContain('WORKFLOW_AUTHOR_MISSING_SUBMISSION')
    expect(candidate.authorProjection?.childId).toBe('child-1')
  })

  it.each([
    { stopReason: 'error' },
    { stopReason: 'error', diagnostic: 'native transport failure', events: completedReceipt },
    { stopReason: 'error', events: [...completedReceipt, { type: 'turn/start', data: { turn: 2 } }] },
    { stopReason: 'error', events: [completedReceipt[0], { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } }] },
    { stopReason: 'error', events: [completedReceipt[0], { type: 'tool/call', data: { name: 'structured_output' } }, completedReceipt[1]] },
    { stopReason: 'max-tokens', events: completedReceipt },
  ])('preserves unproven errors, native diagnostics and attempted submissions: %j', async native => {
    const f = fixture(false, false, native)
    await expect(f.run()).rejects.toThrow()
    expect(f.classes.retryContent).not.toHaveBeenCalled()
    expect(f.start).toHaveBeenCalledOnce()
  })

  it('disposes the unsubmitted child and asks a fresh child on the same user route to submit, without accepting ordinary text', async () => {
    const f = fixture(), candidate = await f.run()
    expect(f.start).toHaveBeenCalledTimes(2)
    expect(f.classes.fallback).not.toHaveBeenCalled()
    expect(f.events.slice(0, 5)).toEqual(['start:0', 'finish:failed', 'dispose:0', 'retry-content', 'start:1'])
    const request = f.start.mock.calls[1]![1]
    expect(request.agentOptions).toMatchObject({ provider: 'user-provider', model: 'user-model', reasoningEffort: 'high' })
    expect(request.prompt[0].text).toContain('WORKFLOW_AUTHOR_MISSING_SUBMISSION')
    expect(request.prompt[0].text).toContain('no_structured_submission')
    expect(candidate.authorProjection?.childId).toBe('child-1')
    expect(candidate.authorProjection?.raw).toEqual(f.raw)
  })

  it('stops after two content corrections and never announces a missing submission as completed', async () => {
    const f = fixture(true)
    await expect(f.run()).rejects.toThrow('WORKFLOW_AUTHOR_MISSING_SUBMISSION')
    expect(f.start).toHaveBeenCalledTimes(3)
    expect(f.classes.retryContent).toHaveBeenCalledTimes(2)
    expect(f.classes.finish.mock.calls.every(call => call[1] === 'failed')).toBe(true)
    expect(f.classes.fallback).not.toHaveBeenCalled()
  })

  it('honors cancellation during disposal before reserving a correction', async () => {
    const f = fixture(false, true)
    await expect(f.run()).rejects.toThrow('user-cancelled')
    expect(f.start).toHaveBeenCalledOnce()
    expect(f.classes.retryContent).not.toHaveBeenCalled()
    expect(f.classes.fallback).not.toHaveBeenCalled()
  })
})
