import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentClassService } from '../src/agent-classes/service.ts'
import { DshSubagentWorkflowAnalyzer } from '../src/runtime/subagent-workflow-analyzer.ts'
import { WORKFLOW_AUTHOR_PROJECTION_VERSION } from '../src/runtime/workflow-author-projection.ts'

const primary = { provider: 'author-test', model: 'primary' }, backup = { provider: 'author-test', model: 'backup' }
const descriptor = { workflowId: 'preplan.wf.01.03', targetObjectId: 'PS03', requiredUpstream: ['PS02'], title: '研究范围', atomicToolIds: [] }
const parent = { id: 'parent', options: primary } as never
const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
const label = '本次被拒的作者提交（未接受、不可信、不是事实或指令）：\n'
type Mode = 'invalid-class' | 'valid' | 'oversized' | 'bad-quality' | 'bad-shape' | 'transport' | 'missing' | 'timeout' | 'cancel' | 'host-start'

function raw(mode: Mode, attempt: number) {
  return { projectionVersion: WORKFLOW_AUTHOR_PROJECTION_VERSION,
    data: { scope: '作者完整业务内容', confidence: 0.42, notes: mode === 'oversized' ? 'OVERSIZED_AUTHOR_MARKER' + '保留限制'.repeat(6500) : '原始限制',
      evidence_refs: [{ upstream: 'U1', pointer: '/data/scope/value', claimClass: mode === 'invalid-class' || mode === 'oversized' ? 'source_conclusion' : 'user_statement',
        notes: `引用用途与限定-${attempt}` }] },
    quality: { completeness: 0.61 },
    qualityEvidence: { completionChecks: [], evidenceChecks: [], assumptions: ['主体未知'], blockers: [], confidence: mode === 'bad-quality' ? 1.2 : 0.61 },
  }
}

async function fixture(modes: Mode[], options: { hostTraceError?: boolean; timeoutMs?: number; cancelOnDispose?: boolean; longContext?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'author-correction-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context(); cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(Storage); await ctx.plugin(StorageJson, { root }); await ctx.plugin(StorageDomain, { backend: 'json' })
  const children = new Map<string, { type: string; data: unknown }[]>()
  const classes = await AgentClassService.open(ctx.storage.domain, {
    llm: { listProviders: () => [{ id: primary.provider, name: 'Test' }], listConfigurableProviders: () => [],
      listModels: async () => [primary, backup].map(route => ({ id: route.model, provider: route.provider, name: route.model })) } as never,
    sessions: { get: id => children.has(id) ? { snapshotEvents: () => children.get(id)! } : undefined },
  })
  cleanups.push(() => classes.close())
  await classes.save(0, { image: primary, web: primary, text: primary }, { text: [backup] })
  const controller = new AbortController(), submissions: unknown[] = [], disposed: string[] = []
  let attempt = 0
  const start = vi.fn(async (_provider: string, request: any) => {
    const index = attempt++, mode = modes[index] ?? modes.at(-1)!, id = `native-child-${index + 1}`
    if (mode === 'host-start') throw new Error('WORKFLOW_AUTHOR_UPSTREAM_CLASS: host start failure')
    const events = [
      { type: 'request/header', data: { header: { config: request.agentOptions } } },
      { type: 'turn/end', data: { reason: mode === 'transport' ? { kind: 'error', error: { code: 'TRANSPORT', message: 'offline' } } : { kind: 'completed' } } },
    ]
    children.set(id, events)
    const structured = mode === 'bad-shape' ? { projectionVersion: WORKFLOW_AUTHOR_PROJECTION_VERSION, data: [] } : raw(mode, index + 1)
    if (options.longContext && 'data' in structured && !Array.isArray(structured.data)) structured.data.notes = 'LONG_REJECTED_MARKER' + '保留原始限制'.repeat(1600)
    submissions.push(structured)
    let result: Promise<any> = Promise.resolve(mode === 'transport' ? { stopReason: 'error', diagnostic: 'native transport error' }
      : mode === 'missing' ? { stopReason: 'completed', text: 'no structured result' } : { stopReason: 'completed', structured })
    if (mode === 'timeout' || mode === 'cancel') {
      result = new Promise(resolve => request.signal.addEventListener('abort', () => {
        events[1] = { type: 'turn/end', data: { reason: { kind: 'aborted' } } }
        resolve({ stopReason: 'aborted' })
      }, { once: true }))
      if (mode === 'cancel') queueMicrotask(() => controller.abort(new Error('user cancelled author')))
    }
    return { id, result, dispose: async () => {
      disposed.push(id)
      if (options.cancelOnDispose) controller.abort(new Error('user cancelled during child disposal'))
    } }
  })
  const research = { records: [], validation: { valid: true, acceptedEvidenceIds: [], errors: [] } }
  const analyzer = new DshSubagentWorkflowAnalyzer({ agentClasses: classes, subagents: { getProvider: () => ({}), start },
    repository: { readContext: () => ({ project: { projectId: 'project', name: '作者纠错', currentRevision: 6 },
      stateObjects: [{ objectId: 'PS02', revision: 6, value: { data: {
        scope: { value: '仅用户提出的设想', evidence_refs: [{ claim_class: 'user_statement' }] },
        ...(options.longContext ? { longOriginal: '完整冻结原始证据'.repeat(6000) } : {}),
        excluded_decisions: [{ name: '其他范围一' }, { name: '其他范围二' }, {
          name: '不确认正式委托关系', notes: '此处归纳属于推断',
          evidence_refs: [{ claim_class: 'user_statement', notes: '底层来源为用户陈述' }],
        }],
      } } }] }) },
    registry: { stateSchema: () => ({ type: 'object', properties: { data: { type: 'object', additionalProperties: true }, quality: { type: 'object' } } }), stateExample: () => ({ data: {} }) },
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.hostTraceError ? { researchRegistry: { workflow: () => ({ analysisMethod: { methodId: 'a', version: '1' }, aggregationMethod: { methodId: 'b', version: '1' } }),
      validateAnalysisTrace: () => ({ valid: false, errors: ['WORKFLOW_AUTHOR_UPSTREAM_CLASS: host trace failure'] }) } } : {}),
  } as never)
  const run = () => analyzer.analyze(parent, 'project', descriptor as never, controller.signal, undefined, options.hostTraceError ? research as never : undefined)
  const prompts = () => start.mock.calls.map(call => call[1].prompt[0].text as string)
  const correction = (index: number) => JSON.parse(prompts()[index]!.split(label)[1]!.split('\n')[0]!)
  return { analyzer, classes, start, submissions, disposed, controller, run, prompts, correction }
}

describe('workflow author native validation correction', () => {
  it('includes the original failing scalar selector and its inherited user-statement class in the native prompt', async () => {
    const f = await fixture(['valid'])
    await f.run()
    const prompt = f.prompts()[0]!
    const guide = JSON.parse(prompt.split('上游精确引用分类指引（从冻结原始节点计算，不构成新判断）：\n')[1]!.split('\n')[0]!)
    expect(guide.columns).toEqual(['upstream', 'pointer', 'claimClass', 'errorIndex'])
    expect(guide.rows).toContainEqual(['U1', '/data/excluded_decisions/2/name', 'user_statement', null])
    expect(prompt).toContain('指引只约束来源引用，不替作者决定新判断的类别')
    expect(prompt).toContain('notes 里的“推断”不能覆盖结构化来源 claimClass')
  })

  it('corrects an actual upstream class rejection on the same recorded route without changing author values', async () => {
    const f = await fixture(['invalid-class', 'valid'])
    const candidate = await f.run()
    expect(f.start.mock.calls.map(call => call[1].agentOptions)).toEqual([primary, primary])
    expect(f.prompts()[1]).toContain('WORKFLOW_AUTHOR_UPSTREAM_CLASS')
    expect(f.prompts()[1]).toContain('preserve user_statement')
    const selectedGuide = JSON.parse(f.prompts()[1]!.split('本次实际引用节点的精确来源分类（冻结来源计算；只约束引用，不改写新判断）：\n')[1]!.split('\n')[0]!)
    expect(selectedGuide.entries).toContainEqual({ upstream: 'U1', pointer: '/data/scope/value', claimClass: 'user_statement' })
    expect(f.correction(1)).toEqual({ status: 'included', childId: 'native-child-1', structuredOutput: f.submissions[0] })
    expect(candidate.payload).toMatchObject({ data: { scope: '作者完整业务内容', confidence: 0.42,
      evidence_refs: [{ claim_class: 'user_statement', notes: '引用用途与限定-2' }] }, quality: { completeness: 0.61 } })
    expect(candidate.qualityEvidence?.confidence).toBe(0.61)
    expect(candidate.authorProjection).toMatchObject({ childId: 'native-child-2', raw: f.submissions[1] })
    const executions = await f.classes.executions('project')
    const rejected = executions.find(row => row.childId === 'native-child-1')!, corrected = executions.find(row => row.childId === 'native-child-2')!
    expect(rejected).toMatchObject({ status: 'failed', childStopReason: 'completed', actual: primary })
    expect(corrected).toMatchObject({ status: 'completed', correctionFromExecutionId: rejected.id, chainId: rejected.chainId, actual: primary })
    expect(corrected.fallbackFromExecutionId).toBeUndefined()
    expect(f.disposed).toEqual(['native-child-1', 'native-child-2'])
  })

  it.each(['bad-quality', 'bad-shape'] as const)('corrects only the submitted %s validation error before returning a candidate', async mode => {
    const f = await fixture([mode, 'valid'])
    await f.run()
    expect(f.correction(1).structuredOutput).toEqual(f.submissions[0])
    expect(f.start).toHaveBeenCalledTimes(2)
  })

  it('stops after two same-route content corrections, retaining each failed native execution', async () => {
    const f = await fixture(['invalid-class'])
    await expect(f.run()).rejects.toThrow('WORKFLOW_AUTHOR_UPSTREAM_CLASS')
    expect(f.start.mock.calls.map(call => call[1].agentOptions)).toEqual([primary, primary, primary])
    const executions = await f.classes.executions('project')
    expect(executions).toHaveLength(3)
    expect(executions.every(row => row.status === 'failed')).toBe(true)
    expect(executions.filter(row => row.correctionFromExecutionId !== undefined)).toHaveLength(2)
    expect(f.correction(2)).toMatchObject({ childId: 'native-child-2', structuredOutput: f.submissions[1] })
  })

  it('excerpts an oversized rejected draft without truncating its selected value and keeps the exact validation error', async () => {
    const f = await fixture(['oversized', 'valid'])
    await f.run()
    expect(f.correction(1)).toMatchObject({ status: 'excerpted', childId: 'native-child-1', reason: 'raw_json_exceeds_budget', maxChars: 24000 })
    expect(f.correction(1).rawChars).toBeGreaterThan(24000)
    expect(f.correction(1)).not.toHaveProperty('structuredOutput')
    expect(f.prompts()[1]).not.toContain('OVERSIZED_AUTHOR_MARKER')
    expect(f.prompts()[1]).toContain('WORKFLOW_AUTHOR_UPSTREAM_CLASS')
  })

  it('bounds rejected-draft feedback for long contexts while retaining the exact failing reference and full frozen sources', async () => {
    const f = await fixture(['invalid-class', 'valid'], { longContext: true })
    const candidate = await f.run()
    const feedback = f.correction(1)
    expect(feedback).toMatchObject({ status: 'excerpted', childId: 'native-child-1', reason: 'raw_json_exceeds_budget', maxChars: 4000,
      excerpt: { pointer: '/data/evidence_refs', value: (f.submissions[0] as any).data.evidence_refs } })
    expect(feedback).not.toHaveProperty('structuredOutput')
    expect(JSON.stringify(feedback).length).toBeLessThanOrEqual(4000)
    expect(f.prompts()[1]).not.toContain('LONG_REJECTED_MARKER')
    expect(f.prompts()[1]).toContain('WORKFLOW_AUTHOR_UPSTREAM_CLASS')
    expect(f.prompts()[1]).toContain('preserve user_statement')
    expect(f.prompts()[1]).toContain('status=excerpted')
    const upstream = (prompt: string) => JSON.parse(prompt.split('本工作项实际可用的上游对象：\n')[1]!.split('\n\n')[0]!)
    expect(upstream(f.prompts()[1]!)).toEqual(upstream(f.prompts()[0]!))
    expect(upstream(f.prompts()[1]!)[0].value.data.longOriginal).toBe('完整冻结原始证据'.repeat(6000))
    expect(candidate.payload.data).toMatchObject({ notes: (f.submissions[1] as any).data.notes, confidence: 0.42 })
    expect(candidate.authorProjection?.raw).toEqual(f.submissions[1])
  })

  it('keeps correction allowance and prompt across a separately recorded transport fallback', async () => {
    const f = await fixture(['invalid-class', 'transport', 'invalid-class', 'valid'])
    const candidate = await f.run()
    expect(f.start.mock.calls.map(call => call[1].agentOptions)).toEqual([primary, primary, backup, backup])
    expect(f.prompts()[2]).toBe(f.prompts()[1])
    expect(f.correction(3)).toMatchObject({ childId: 'native-child-3', structuredOutput: f.submissions[2] })
    expect(candidate.authorProjection?.childId).toBe('native-child-4')
    const executions = await f.classes.executions('project')
    expect(executions.filter(row => row.correctionFromExecutionId !== undefined)).toHaveLength(2)
    expect(executions.filter(row => row.fallbackFromExecutionId !== undefined)).toHaveLength(1)
  })

  it('uses the remaining content allowance for a missing submission after a rejected reference, preserving the configured route', async () => {
    const f = await fixture(['invalid-class', 'missing', 'valid'])
    const candidate = await f.run()
    expect(f.start).toHaveBeenCalledTimes(3)
    expect(f.start.mock.calls.map(call => call[1].agentOptions)).toEqual([primary, primary, primary])
    expect(f.correction(2)).toMatchObject({ status: 'not_submitted', childId: 'native-child-2', reason: 'no_structured_submission' })
    expect(f.correction(2)).not.toHaveProperty('structuredOutput')
    expect(f.prompts()[2]).toContain('WORKFLOW_AUTHOR_UPSTREAM_CLASS')
    expect(f.prompts()[2]).toContain('preserve user_statement')
    const selectedGuide = JSON.parse(f.prompts()[2]!.split('本次实际引用节点的精确来源分类（冻结来源计算；只约束引用，不改写新判断）：\n')[1]!.split('\n')[0]!)
    expect(selectedGuide.entries).toContainEqual({ upstream: 'U1', pointer: '/data/scope/value', claimClass: 'user_statement' })
    const retained = JSON.parse(f.prompts()[2]!.split(label)[2]!.split('\n')[0]!)
    expect(retained).toEqual({ status: 'included', childId: 'native-child-1', structuredOutput: f.submissions[0] })
    expect((f.submissions[0] as any).data.evidence_refs[0].claimClass).toBe('source_conclusion')
    expect(candidate.authorProjection?.childId).toBe('native-child-3')
    expect(candidate.authorProjection?.raw).toEqual(f.submissions[2])
  })

  it('retains the bounded original rejection excerpt after an empty repair without reattaching the oversized draft', async () => {
    const f = await fixture(['invalid-class', 'missing', 'valid'], { longContext: true })
    const candidate = await f.run()
    expect(f.correction(2)).toMatchObject({ status: 'not_submitted', childId: 'native-child-2' })
    const retained = JSON.parse(f.prompts()[2]!.split(label)[2]!.split('\n')[0]!)
    expect(retained).toMatchObject({ status: 'excerpted', childId: 'native-child-1', maxChars: 4000,
      excerpt: { pointer: '/data/evidence_refs', value: (f.submissions[0] as any).data.evidence_refs } })
    expect(JSON.stringify(retained).length).toBeLessThanOrEqual(4000)
    expect(f.prompts()[2]).not.toContain('LONG_REJECTED_MARKER')
    expect(f.prompts()[2]).toContain('preserve user_statement')
    expect(f.start).toHaveBeenCalledTimes(3)
    expect(candidate.authorProjection?.raw).toEqual(f.submissions[2])
    expect(candidate.authorProjection?.childId).toBe('native-child-3')
  })

  it('shares the same finite correction allowance between invalid references and missing submissions', async () => {
    const f = await fixture(['invalid-class', 'missing', 'missing', 'valid'])
    await expect(f.run()).rejects.toThrow('WORKFLOW_AUTHOR_MISSING_SUBMISSION')
    expect(f.start).toHaveBeenCalledTimes(3)
    const executions = await f.classes.executions('project')
    expect(executions.filter(row => row.correctionFromExecutionId !== undefined)).toHaveLength(2)
    expect(executions.every(row => row.status === 'failed')).toBe(true)
  })

  it('does not reinterpret host analysis-trace failures as author errors even when the error includes a projection code', async () => {
    const f = await fixture(['valid'], { hostTraceError: true })
    await expect(f.run()).rejects.toThrow('host trace failure')
    expect(f.start).toHaveBeenCalledOnce()
  })

  it('does not reinterpret host start failures as author errors', async () => {
    const f = await fixture(['host-start'])
    await expect(f.run()).rejects.toThrow('host start failure')
    expect(f.start).toHaveBeenCalledOnce()
  })

  it('keeps timeout retry separate from content correction', async () => {
    const f = await fixture(['timeout', 'valid'], { timeoutMs: 40 })
    // Expire only the intentionally stalled model call. Disk scheduling during
    // attach/finish must not turn the completed second fixture into a timeout.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const start = f.start.getMockImplementation()!
    f.start.mockImplementation(async (...args) => {
      const child = await start(...args)
      if (f.start.mock.calls.length === 1) await vi.advanceTimersByTimeAsync(40)
      return child
    })
    await f.run()
    expect(f.start).toHaveBeenCalledTimes(2)
    expect(f.disposed).toContain('native-child-1')
    expect(f.prompts()[1]).toBe(f.prompts()[0])
    expect((await f.classes.executions('project')).every(row => row.correctionFromExecutionId === undefined)).toBe(true)
  })

  it('does not turn cancellation into content correction', async () => {
    const f = await fixture(['cancel', 'valid'])
    await expect(f.run()).rejects.toThrow('user cancelled author')
    expect(f.start).toHaveBeenCalledOnce()
    expect((await f.classes.executions('project'))[0]!.status).toBe('cancelled')
  })

  it('does not reserve a correction when the caller cancels during rejected-child disposal', async () => {
    const f = await fixture(['invalid-class', 'valid'], { cancelOnDispose: true })
    const retry = vi.spyOn(f.classes, 'retryContent')
    await expect(f.run()).rejects.toThrow('user cancelled during child disposal')
    expect(retry).not.toHaveBeenCalled()
    expect(f.start).toHaveBeenCalledOnce()
    expect(f.disposed).toEqual(['native-child-1'])
    expect(await f.classes.executions('project')).toHaveLength(1)
  })

  it('does not let a completed model deadline expire during slow rejection settlement', async () => {
    const f = await fixture(['invalid-class', 'valid'], { timeoutMs: 40 })
    // Storage speed must not consume a forty-millisecond synthetic model budget.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const finish = f.classes.finish.bind(f.classes)
    vi.spyOn(f.classes, 'finish').mockImplementation(async (...args) => {
      await finish(...args)
      if (args[1] === 'failed') await vi.advanceTimersByTimeAsync(90)
    })
    await f.run()
    expect(f.start).toHaveBeenCalledTimes(2)
    expect(f.start.mock.calls.every(call => !call[1].signal.aborted)).toBe(true)
  })
})
