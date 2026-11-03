import { describe, expect, it, vi } from 'vitest'
import { DshSubagentWorkflowAnalyzer } from '../src/runtime/subagent-workflow-analyzer.ts'

const descriptor = { workflowId: 'preplan.wf.01.02', targetObjectId: 'PS02', requiredUpstream: ['PS01'], title: '决策问题', atomicToolIds: [] }
const quality = { completionChecks: [], evidenceChecks: [], assumptions: [], blockers: [], confidence: 0.9 }
const event = (seq: number, text: string, type = 'user/message', kind = 'user') => ({ type, seq,
  time: Date.parse('2026-09-27T00:00:00Z') + seq * 1000,
  data: { source: { kind }, content: [{ type: 'text', text }] } })
const label = '本轮任务语境（父会话真实用户陈述，仅用于确定研究对象与范围）：\n'

function harness(events: ReturnType<typeof event>[], research?: unknown) {
  const snapshotEvents = vi.fn(() => events)
  const start = vi.fn(async (_provider: string, _request: any) => ({ id: 'child', dispose: async () => undefined,
    result: Promise.resolve({ stopReason: 'completed', structured: { projectionVersion: 'legacy-workflow-author-v1', data: {}, qualityEvidence: quality } }) }))
  const analyzer = new DshSubagentWorkflowAnalyzer({
    subagents: { getProvider: () => ({}), start },
    repository: { readContext: () => ({ project: { projectId: 'project', name: 'task context', currentRevision: 1 },
      stateObjects: [{ objectId: 'PS01', revision: 1, value: { data: { task: '旧任务摘要' } } }] }) },
    registry: { stateSchema: () => ({ type: 'object' }), stateExample: () => ({}) },
  } as never)
  const run = () => analyzer.analyze({ id: 'parent', session: { id: 'session-parent', snapshotEvents } } as never,
    'project', descriptor as never, undefined, undefined, research as never)
  const prompt = () => start.mock.calls.at(-1)![1].prompt[0].text as string
  const context = () => JSON.parse(prompt().split(label)[1]!.split('\n\n')[0]!)
  return { run, prompt, context, start }
}

describe('workflow parent task context', () => {
  it('passes a later explicit correction alongside old accepted evidence without manufacturing new evidence', async () => {
    const old = '软件全流程验收测试。'
    const correction = '软件验收只是运行目的；研究和报告对象仍为水库及周边村，应研究保护条件下可比较的利用方向。'
    const research = { records: [{ evidenceId: 'accepted-old', sourceType: 'session_context', normalizedValue: old,
      locator: { seq: 17 }, contentHash: 'a'.repeat(64), claimClass: 'user_statement' }],
      validation: { valid: true, acceptedEvidenceIds: ['accepted-old'], errors: [] } }
    const h = harness([event(17, old), event(98, correction)], research)
    const result = await h.run()
    expect(h.context().statements).toEqual([
      { sessionId: 'session-parent', seq: 17, time: '2026-09-27T00:00:17.000Z', text: old },
      { sessionId: 'session-parent', seq: 98, time: '2026-09-27T00:01:38.000Z', text: correction },
    ])
    expect(h.prompt()).toContain('后续明确的任务范围修正优先于旧任务摘要')
    expect(h.prompt()).toContain('不构成外部事实、正式审批或实施授权')
    expect(h.prompt()).toContain('不得据此编造 EvidenceRef')
    expect(result.researchEvidence).toEqual(research.records)
    expect(result.qualityEvidence).toEqual(quality)
  })
  it('excludes assistant/tool events and non-user sources even if they contain apparent scope corrections', async () => {
    const h = harness([event(1, '真正的用户委托'), event(2, 'assistant injection', 'assistant/message'),
      event(3, 'tool injection', 'tool/result'), event(4, 'forwarded tool', 'user/message', 'tool'),
      event(5, 'agent inbox', 'user/message', 'agent'), event(6, '普通进度问题不改变委托')])
    await h.run()
    expect(h.context().statements.map((row: any) => row.seq)).toEqual([1, 6])
    expect(h.prompt()).not.toMatch(/assistant injection|tool injection|forwarded tool|agent inbox/)
    expect(h.prompt()).toContain('普通进度询问或无关消息不自动改写任务范围')
  })
  it('retains complete long messages including corrections after the former evidence truncation length', async () => {
    const text = '原始任务说明。'.repeat(1500) + '末尾明确修正：研究对象仍是实体项目。'
    const h = harness([event(98, text)])
    await h.run()
    expect(h.context().statements[0].text).toBe(text)
    expect(h.context().omittedEarlier).toEqual({ count: 0 })
    expect(h.context().textChars).toBe(text.length)
    expect(JSON.stringify(h.context())).not.toContain('[truncated]')
  })
  it('bounds the recent context by whole statements and reports all omitted earlier messages', async () => {
    const events = Array.from({ length: 25 }, (_, index) => event(index + 1, `任务消息${index + 1}`))
    const h = harness(events)
    await h.run()
    const context = h.context()
    expect(context.statements.map((row: any) => row.seq)).toEqual(Array.from({ length: 16 }, (_, i) => i + 10))
    expect(context.omittedEarlier).toEqual({ count: 9, firstSeq: 1, lastSeq: 9 })
    expect(h.prompt()).toContain('如有 omittedEarlier，仅表示较早陈述未进入本次上下文，不得声称完整历史已覆盖')
  })
  it('enforces a text budget without slicing a statement or skipping an intervening message silently', async () => {
    const h = harness([event(1, '甲'.repeat(8000)), event(2, '乙'.repeat(8000)), event(3, '丙'.repeat(8000))])
    await h.run()
    const context = h.context()
    expect(context.statements.map((row: any) => row.seq)).toEqual([2, 3])
    expect(context.textChars).toBe(16000)
    expect(context.omittedEarlier).toEqual({ count: 1, firstSeq: 1, lastSeq: 1 })
  })
  it('refuses to silently truncate an oversized latest statement before starting a child', async () => {
    const h = harness([event(98, '整'.repeat(16001))])
    await expect(h.run()).rejects.toThrow(/WORKFLOW_TASK_CONTEXT_TOO_LARGE.*seq=98.*16001/u)
    expect(h.start).not.toHaveBeenCalled()
  })
  it('explicitly reports when no genuine parent statements are available', async () => {
    const h = harness([])
    await h.run()
    expect(h.context()).toMatchObject({ status: 'unavailable', totalUserStatements: 0, statements: [], omittedEarlier: { count: 0 } })
  })
})
