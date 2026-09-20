import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DshSubagentWorkflowAnalyzer } from '../src/runtime/subagent-workflow-analyzer.ts'

const descriptor = { workflowId: 'preplan.wf.01.01', targetObjectId: 'PS01', requiredUpstream: ['ProjectSeed'], title: '项目身份', atomicToolIds: [] }
const candidate = { payload: { data: { canonical_name: '少潭河' } }, qualityEvidence: { completionChecks: [], evidenceChecks: [], assumptions: [], blockers: [], confidence: 0.9 } }

function harness(provider: string, timeoutMs?: number) {
  let complete!: (result?: unknown) => void
  let childSignal!: AbortSignal
  const finish = vi.fn(async () => undefined)
  const dispose = vi.fn(async () => undefined)
  const begin = vi.fn(async () => ({ id: 'execution', selected: { provider, model: 'qwen3.8:27b' } }))
  const start = vi.fn(async (_provider: string, request: { signal: AbortSignal; prompt: unknown }) => {
    childSignal = request.signal
    const result = new Promise((resolve, reject) => {
      complete = output => resolve(output ?? { stopReason: 'completed', structured: candidate })
      request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true })
    })
    return { id: 'child', result, dispose }
  })
  const analyzer = new DshSubagentWorkflowAnalyzer({
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    agentClasses: {
      begin,
      attach: async () => undefined, finish,
    },
    subagents: {
      getProvider: () => ({}),
      start,
    },
    repository: { readContext: () => ({ project: { projectId: 'project', name: '少潭河', currentRevision: 0 }, stateObjects: [] }) },
    registry: { stateSchema: () => ({}), stateExample: () => ({}) },
  } as never)
  return { analyzer, begin, start, finish, dispose, complete: (output?: unknown) => complete(output), signal: () => childSignal }
}

// Native AbortSignal.timeout uses Node's internal clock, outside Vitest fake timers.
beforeEach(() => {
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(new DOMException('Timeout', 'TimeoutError')), ms)
    return controller.signal
  })
})
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

describe('workflow analysis deadlines', () => {
  it('allows a local Ollama child to finish after the former five-minute limit', async () => {
    vi.useFakeTimers()
    const h = harness('ollama-local')
    const result = h.analyzer.analyze({ id: 'parent' } as never, 'project', descriptor as never)
    void result.catch(() => undefined)
    await vi.advanceTimersByTimeAsync(600_000)
    expect(h.signal().aborted).toBe(false)
    h.complete()
    await expect(result).resolves.toMatchObject({ payload: candidate.payload })
    expect(h.dispose).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps a finite default local deadline and reports a timeout as failure', async () => {
    vi.useFakeTimers()
    const h = harness('ollama-local')
    const result = h.analyzer.analyze({ id: 'parent' } as never, 'project', descriptor as never)
    const assertion = expect(result).rejects.toThrow('WORKFLOW_ANALYSIS_TIMEOUT')
    await vi.advanceTimersByTimeAsync(2_400_001)
    expect(h.signal().aborted).toBe(true)
    await assertion
    expect(h.finish).toHaveBeenCalledWith('execution', 'failed', expect.stringContaining('超时'))
  })

  it('preserves the cloud deadline even when a caller supplies a non-aborted signal', async () => {
    vi.useFakeTimers()
    const h = harness('cloud')
    const result = h.analyzer.analyze({ id: 'parent' } as never, 'project', descriptor as never, new AbortController().signal)
    const assertion = expect(result).rejects.toThrow('WORKFLOW_ANALYSIS_TIMEOUT')
    await vi.advanceTimersByTimeAsync(600_001)
    expect(h.signal().aborted).toBe(true)
    await assertion
  })

  it('propagates caller cancellation and clears the longer deadline', async () => {
    vi.useFakeTimers()
    const h = harness('ollama-local')
    const controller = new AbortController()
    const result = h.analyzer.analyze({ id: 'parent' } as never, 'project', descriptor as never, controller.signal)
    const assertion = expect(result).rejects.toThrow('user cancelled')
    await vi.advanceTimersByTimeAsync(1)
    controller.abort(new Error('user cancelled'))
    await assertion
    expect(h.finish).toHaveBeenCalledWith('execution', 'cancelled', expect.any(String))
    expect(h.dispose).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('retries one timed-out child with the same correction context after disposal and reserves a new task', async () => {
    vi.useFakeTimers()
    const h = harness('cloud', 100)
    const feedback = { payload: { data: { conclusion: 'conditional' } }, errors: ['Preserve assumption class'] }
    const result = h.analyzer.analyze({ id: 'parent' } as never, 'project', descriptor as never,
      undefined, undefined, undefined, feedback)
    void result.catch(() => undefined)
    await vi.advanceTimersByTimeAsync(101)
    expect(h.start).toHaveBeenCalledTimes(2)
    expect(h.begin).toHaveBeenCalledTimes(2)
    expect(h.dispose).toHaveBeenCalledTimes(1)
    expect(h.dispose.mock.invocationCallOrder[0]).toBeLessThan(h.begin.mock.invocationCallOrder[1]!)
    expect(h.start.mock.calls[0]![1].signal.aborted).toBe(true)
    expect(h.start.mock.calls[1]![1].signal.aborted).toBe(false)
    expect(h.start.mock.calls[1]![1].prompt).toEqual(h.start.mock.calls[0]![1].prompt)
    expect(JSON.stringify(h.start.mock.calls[1]![1].prompt)).toContain('Preserve assumption class')
    h.complete()
    await expect(result).resolves.toMatchObject({ payload: candidate.payload })
    expect(h.finish).toHaveBeenNthCalledWith(1, 'execution', 'failed', expect.stringContaining('超时'))
    expect(h.finish).toHaveBeenNthCalledWith(2, 'execution', 'completed')
    expect(h.dispose).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('stops after two deadlines without a third reservation or accepting partial output', async () => {
    vi.useFakeTimers()
    const h = harness('cloud', 100)
    const result = h.analyzer.analyze({ id: 'parent' } as never, 'project', descriptor as never)
    const assertion = expect(result).rejects.toThrow('WORKFLOW_ANALYSIS_TIMEOUT')
    await vi.advanceTimersByTimeAsync(201)
    await assertion
    expect(h.start).toHaveBeenCalledTimes(2)
    expect(h.begin).toHaveBeenCalledTimes(2)
    expect(h.dispose).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('respects budget exhaustion on the retry reservation', async () => {
    vi.useFakeTimers()
    const h = harness('cloud', 100)
    h.begin.mockResolvedValueOnce({ id: 'execution', selected: { provider: 'cloud', model: 'test' } })
      .mockRejectedValueOnce(new Error('PREPLANNING_MODEL_TURN_LIMIT'))
    const result = h.analyzer.analyze({ id: 'parent' } as never, 'project', descriptor as never)
    const assertion = expect(result).rejects.toThrow('PREPLANNING_MODEL_TURN_LIMIT')
    await vi.advanceTimersByTimeAsync(101)
    await assertion
    expect(h.start).toHaveBeenCalledTimes(1)
    expect(h.dispose).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not retry if the caller cancels while the timed-out child is disposing', async () => {
    vi.useFakeTimers()
    const h = harness('cloud', 100)
    const controller = new AbortController()
    h.dispose.mockImplementationOnce(async () => { controller.abort(new Error('user cancelled')) })
    const result = h.analyzer.analyze({ id: 'parent' } as never, 'project', descriptor as never, controller.signal)
    const assertion = expect(result).rejects.toThrow('user cancelled')
    await vi.advanceTimersByTimeAsync(101)
    await assertion
    expect(h.begin).toHaveBeenCalledTimes(1)
    expect(h.dispose).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not retry max-tokens or non-timeout child failures', async () => {
    vi.useFakeTimers()
    for (const stopReason of ['max-tokens', 'error']) {
      const h = harness('cloud', 100)
      const result = h.analyzer.analyze({ id: 'parent' } as never, 'project', descriptor as never)
      await vi.advanceTimersByTimeAsync(1)
      h.complete({ stopReason })
      await expect(result).rejects.toThrow(stopReason === 'max-tokens' ? 'WORKFLOW_OUTPUT_LIMIT' : 'ended with error')
      expect(h.begin).toHaveBeenCalledTimes(1)
      expect(h.dispose).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    }
  })
})
