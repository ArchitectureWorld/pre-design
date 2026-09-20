import { describe, expect, it, vi } from 'vitest'
import { DshSubagentWorkflowAnalyzer } from '../src/runtime/subagent-workflow-analyzer.ts'

function harness(stopReason = 'completed', schemaFeedback?: { payload: Record<string, unknown>; errors: string[] }) {
  const source = { objectId: 'SP01', revision: 82, value: { data: { rows: Array.from({ length: 40 }, (_, index) => ({
    id: `row-${index}`, title: '实施条件', limitations: ['边界未知', '实施前另核验'], evidence_refs: [{
      evidence_id: `ev-${index}`, version_id: 'PG03@70', locator: { section: '/data/ranges/0' }, claim_class: 'assumption',
    }],
  })) } } }
  const start = vi.fn(async () => ({ id: 'child', dispose: async () => {}, result: Promise.resolve({ stopReason,
    structured: stopReason === 'completed' ? { payload: { data: {} }, qualityEvidence: { completionChecks: [], evidenceChecks: [], assumptions: [], blockers: [], confidence: 0.9 } } : undefined,
  }) }))
  const analyzer = new DshSubagentWorkflowAnalyzer({
    repository: { readContext: () => ({ project: { projectId: 'project-1' }, stateObjects: [source] }) },
    subagents: { getProvider: () => ({}), start }, registry: { stateSchema: () => ({ type: 'object', properties: { data: { type: 'object' } } }), stateExample: () => ({ data: { limits: ['边界未知'] } }) },
  } as never)
  const run = () => analyzer.analyze({ id: 'parent' } as never, 'project-1', {
    workflowId: 'preplan.wf.08.01', targetObjectId: 'IM01', requiredUpstream: ['SP01'], atomicToolIds: [],
  } as never, undefined, undefined, undefined, schemaFeedback)
  return { source, start, run }
}

describe('workflow model context budget', () => {
  it('reduces formatting overhead while retaining every upstream field, limitation, identity and revision', async () => {
    const h = harness()
    await h.run()
    const request = (h.start.mock.calls as unknown[][])[0]![1] as { prompt: { text: string }[] }
    const prompt = request.prompt[0]!.text
    const segment = prompt.split('本工作项实际可用的上游对象：\n')[1]!.split('\n\n')[0]!
    expect(JSON.parse(segment)).toEqual([h.source])
    expect(segment.length).toBeLessThan(JSON.stringify([h.source], null, 2).length * 0.8)
  })
  it('rejects output-limit termination without accepting a partial payload or retrying blindly', async () => {
    const h = harness('max-tokens')
    await expect(h.run()).rejects.toThrow(/WORKFLOW_OUTPUT_LIMIT.*inputChars=\d+.*upstreamChars=\d+/u)
    expect(h.start).toHaveBeenCalledOnce()
  })
  it('keeps schema, examples and correction candidates lossless without JSON formatting overhead', async () => {
    const feedback = { payload: { data: { notes: 'line one\nline two', limitations: ['未知', '条件式'] } }, errors: ['/data/source: invalid pointer'] }
    const h = harness('completed', feedback)
    await h.run()
    const request = (h.start.mock.calls as unknown[][])[0]![1] as { prompt: { text: string }[] }
    const prompt = request.prompt[0]!.text
    expect(prompt).toContain(JSON.stringify(feedback))
    expect(prompt).toContain('{"type":"object","properties":{"data":{"type":"object"}}}')
    expect(prompt).toContain('{"data":{"limits":["边界未知"]}}')
    expect(prompt).toContain('紧凑 JSON')
    expect(prompt).toContain('不得删减必填字段、完成条件、证据或限制')
  })
})
