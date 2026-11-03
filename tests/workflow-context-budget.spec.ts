import { describe, expect, it, vi } from 'vitest'
import { DshSubagentWorkflowAnalyzer } from '../src/runtime/subagent-workflow-analyzer.ts'
import { expandWorkflowUpstreamPromptView } from '../src/runtime/workflow-upstream-context.ts'

function harness(stopReason = 'completed', schemaFeedback?: { payload: Record<string, unknown>; errors: string[] }) {
  const source = { objectId: 'SP01', revision: 82, value: { data: { rows: Array.from({ length: 40 }, (_, index) => ({
    id: `row-${index}`, title: '实施条件', limitations: ['边界未知', '实施前另核验'], evidence_refs: [{
      evidence_id: `ev-${index}`, version_id: 'PG03@70', locator: { section: '/data/ranges/0' }, claim_class: 'assumption',
    }],
  })) } } }
  const start = vi.fn(async () => ({ id: 'child', dispose: async () => {}, result: Promise.resolve({ stopReason,
    structured: stopReason === 'completed' ? { projectionVersion: 'legacy-workflow-author-v1', data: {}, qualityEvidence: { completionChecks: [], evidenceChecks: [], assumptions: [], blockers: [], confidence: 0.9 } } : undefined,
  }) }))
  const analyzer = new DshSubagentWorkflowAnalyzer({
    repository: { readContext: () => ({ project: { projectId: 'project-1' }, stateObjects: [source] }) },
    subagents: { getProvider: () => ({}), start }, registry: { stateSchema: () => ({ type: 'object', properties: { data: { type: 'object' } } }), stateExample: () => ({ data: { limits: ['fixture-target-not-evidence'] } }) },
  } as never)
  const run = () => analyzer.analyze({ id: 'parent' } as never, 'project-1', {
    workflowId: 'preplan.wf.08.01', targetObjectId: 'IM01', requiredUpstream: ['SP01'], atomicToolIds: [],
  } as never, undefined, undefined, undefined, schemaFeedback)
  return { source, start, run }
}

describe('workflow model context budget', () => {
  it('uses a lossless dictionary only in the prompt while retaining original snapshots and original pointer guidance', async () => {
    const h = harness()
    for (const row of h.source.value.data.rows) row.evidence_refs[0]!.version_id = '原始来源版本'.repeat(60)
    const original = structuredClone(h.source)
    const candidate = await h.run()
    const request = (h.start.mock.calls as unknown[][])[0]![1] as { prompt: { text: string }[] }
    const prompt = request.prompt[0]!.text
    const view = JSON.parse(prompt.split('本工作项实际可用的上游对象：\n')[1]!.split('\n\n')[0]!)
    expect(view.encoding).toBe('workflow-upstream-evidence-v2')
    expect(expandWorkflowUpstreamPromptView(view)).toEqual([original])
    expect(candidate.authorProjection?.context.upstream[0]?.value).toEqual(original.value)
    expect(h.source).toEqual(original)
    expect(prompt).toContain('禁止指向传输视图的 strings、upstream 或字典标记')
    const guide = JSON.parse(prompt.split('上游精确引用分类指引（从冻结原始节点计算，不构成新判断）：\n')[1]!.split('\n')[0]!)
    expect(guide.rows).toContainEqual(['U1', '/data/rows/0/title', 'assumption', null])
  })
  it('reduces formatting overhead while retaining every upstream field, limitation, identity and revision', async () => {
    const h = harness()
    await h.run()
    const request = (h.start.mock.calls as unknown[][])[0]![1] as { prompt: { text: string }[] }
    const prompt = request.prompt[0]!.text
    const segment = prompt.split('本工作项实际可用的上游对象：\n')[1]!.split('\n\n')[0]!
    expect(expandWorkflowUpstreamPromptView(JSON.parse(segment))).toEqual([h.source])
    expect(segment.length).toBeLessThan(JSON.stringify([h.source], null, 2).length * 0.8)
  })
  it('rejects output-limit termination without accepting a partial payload or retrying blindly', async () => {
    const h = harness('max-tokens')
    await expect(h.run()).rejects.toThrow(/WORKFLOW_OUTPUT_LIMIT.*inputChars=\d+.*upstreamChars=\d+/u)
    expect(h.start).toHaveBeenCalledOnce()
  })
  it('keeps the full contract and correction candidate but excludes synthetic target example facts', async () => {
    const feedback = { payload: { data: { notes: 'line one\nline two', limitations: ['未知', '条件式'] } }, errors: ['/data/source: invalid pointer'] }
    const h = harness('completed', feedback)
    await h.run()
    const request = (h.start.mock.calls as unknown[][])[0]![1] as { prompt: { text: string }[] }
    const prompt = request.prompt[0]!.text
    expect(prompt).toContain(JSON.stringify(feedback))
    const schema = JSON.parse(prompt.split('目标作者投影 JSON Schema（业务约束仍由完整 State Schema 复核）：\n')[1]!.split('\n\n')[0]!)
    expect(schema.properties.data.type).toBe('object')
    expect(schema.required).toEqual(['projectionVersion', 'data', 'qualityEvidence'])
    expect(prompt).not.toContain('fixture-target-not-evidence')
    expect(prompt).toContain('紧凑 JSON')
    expect(prompt).toContain('不得删减必填字段、完成条件、证据或限制')
  })

  it('transports exact reference classes once per row while preserving the guide coverage limit and every upstream value', async () => {
    const h = harness()
    await h.run()
    const request = (h.start.mock.calls as unknown[][])[0]![1] as { prompt: { text: string }[] }
    const prompt = request.prompt[0]!.text
    const table = JSON.parse(prompt.split('上游精确引用分类指引（从冻结原始节点计算，不构成新判断）：\n')[1]!.split('\n')[0]!)
    expect(table.columns).toEqual(['upstream', 'pointer', 'claimClass', 'errorIndex'])
    expect(table.errors).toEqual([])
    expect(table.rows).toContainEqual(['U1', '/data/rows/0/title', 'assumption', null])
    expect(table.complete).toBe(false)
    expect(table.omittedSubtrees).toBeGreaterThan(0)
    const upstream = JSON.parse(prompt.split('本工作项实际可用的上游对象：\n')[1]!.split('\n\n')[0]!)
    const expanded = expandWorkflowUpstreamPromptView(upstream) as typeof h.source[]
    expect(expanded).toEqual([h.source])
    expect(expanded[0]!.value.data.rows.at(-1)).toMatchObject({ id: 'row-39', limitations: ['边界未知', '实施前另核验'] })
  })

  it('retains ambiguous classification errors and escaped selectors without inventing a table class', async () => {
    const h = harness()
    h.source.value.data = { 'a/b~c': { value: '混合来源', evidence_refs: [{ claim_class: 'user_statement' }, { claim_class: 'source_conclusion' }] } } as never
    await h.run()
    const request = (h.start.mock.calls as unknown[][])[0]![1] as { prompt: { text: string }[] }
    const table = JSON.parse(request.prompt[0]!.text.split('上游精确引用分类指引（从冻结原始节点计算，不构成新判断）：\n')[1]!.split('\n')[0]!)
    expect(table.rows).toContainEqual(['U1', '/data/a~1b~0c/value', null, 0])
    expect(table.rows.filter((row: unknown[]) => row[3] === 0).length).toBeGreaterThan(1)
    expect(table.errors).toEqual(['PROJECT_STATE_CLASS_AMBIGUOUS: selected source mixes user_statement, source_conclusion; use a more precise JSON Pointer'])
    expect(table.complete).toBe(true)
  })
})
