import { expect, it, vi } from 'vitest'
import { WebQueryAgent } from '../src/agent-classes/web-query.ts'
import { resolveChildAgentOptions } from '@deepseek-ai/dsh-subagent'

function fixture(events: unknown[] = [], hasTools = true) {
  const classes = { begin: vi.fn(async () => ({ id: 'run', selected: { provider: 'p', model: 'm' } })), attach: vi.fn(), finish: vi.fn() }
  const dispose = vi.fn()
  const start = vi.fn(async (_provider: string, _request: any) => ({ id: 'child', result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: '候选内容' }] }), dispose }))
  const service = new WebQueryAgent({ classes, subagents: { start }, tools: { get: () => hasTools ? {} : undefined }, sessions: { get: () => ({ snapshotEvents: () => events }) } } as never)
  return { service, start, classes, dispose }
}
function exhaustedRetrieval(tool = 'web_fetch') {
  const reason = `PREPLANNING_REPEATED_TOOL_FAILURE: 工具 ${tool} 连续 3 次返回相同错误，已停止本轮；请根据工具参数要求修正后重试。`
  return [{ type: 'subagent/descriptor', data: { label: 'preplanning_web:p:retrieval=6' } }, { type: 'turn/start', data: {} },
    ...Array.from({ length: 3 }, (_, i) => [
      { type: 'tool/call', data: { callId: `failed-${i}`, name: tool } },
      { type: 'tool/result', data: { message: { content: [{ type: 'tool-result', toolCallId: `failed-${i}`, isError: true, content: [{ type: 'text', text: 'HTTP 403' }] }] } } },
    ]).flat(), { type: 'turn/end', data: { reason: { kind: 'aborted', reason: { kind: 'hook', reason } } } }]
}
it.each(['web_fetch', 'web_search'])('identifies a terminal bounded %s failure without presenting it as successful research', async tool => {
  const h = fixture(exhaustedRetrieval(tool))
  h.start.mockResolvedValueOnce({ id: 'child', result: Promise.resolve({ stopReason: 'aborted', output: [] }), dispose: h.dispose } as never)
  await expect(h.service.query({ id: 'parent' } as never, 'p', '查询', AbortSignal.timeout(1000))).rejects
    .toMatchObject({ name: 'WebRetrievalExhaustedError', executionId: 'run', childId: 'child' })
  expect(h.classes.finish).toHaveBeenCalledWith('run', 'failed', expect.any(String))
  expect(h.classes.finish).not.toHaveBeenCalledWith('run', 'completed')
  expect(h.dispose).toHaveBeenCalledOnce()
})
it.each(['unverified hook', 'later turn', 'other tool', 'parent cancellation'])('does not classify %s as an exhausted web retrieval', async variation => {
  let events = exhaustedRetrieval(variation === 'other tool' ? 'pwsh' : 'web_fetch')
  if (variation === 'unverified hook') events = events.slice(-1)
  if (variation === 'later turn') events.push({ type: 'turn/start', data: {} })
  const h = fixture(events), controller = new AbortController()
  h.start.mockImplementationOnce(async () => {
    if (variation === 'parent cancellation') controller.abort(new Error('USER_CANCELLED'))
    return { id: 'child', result: Promise.resolve({ stopReason: 'aborted', output: [] }), dispose: h.dispose } as never
  })
  await expect(h.service.query({ id: 'parent' } as never, 'p', '查询', controller.signal)).rejects.not.toHaveProperty('name', 'WebRetrievalExhaustedError')
})
it.each([0, 21, 1.5, NaN])('rejects invalid native retrieval budget %s before reserving a task', async maxToolCalls => {
  const h = fixture()
  await expect(h.service.query({ id: 'parent' } as never, 'p', '查询', AbortSignal.timeout(1000), { maxToolCalls })).rejects.toThrow('WEB_TOOL_BUDGET_INVALID')
  expect(h.classes.begin).not.toHaveBeenCalled(); expect(h.start).not.toHaveBeenCalled()
})
it('passes a strict native retrieval budget label and asks the child to conclude from existing material', async () => {
  const h = fixture([
    { type: 'tool/call', data: { callId: 'c1', name: 'web_fetch' } },
    { type: 'tool/result', data: { message: { content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: '原文' }] }] } } },
  ])
  await h.service.query({ id: 'parent' } as never, 'p', '查询', AbortSignal.timeout(1000), { maxToolCalls: 6 })
  expect(h.start.mock.calls[0]![1].label).toBe('preplanning_web:p:retrieval=6')
  expect(h.start.mock.calls[0]![1].persona).toContain('最多调用 6 次')
  expect(h.start.mock.calls[0]![1].persona).toContain('空结果')
})
it('requires an actual successful web tool result and returns its receipt separately from generated text', async () => {
  const h = fixture([
    { type: 'tool/call', data: { callId: 'c1', name: 'web_fetch' } },
    { type: 'tool/result', data: { message: { content: [{ type: 'tool-result', toolCallId: 'c1', isError: false, content: [{ type: 'text', text: '来源网页原文' }] }] } } },
  ])
  const result = await h.service.query({ id: 'parent' } as never, 'p', '查询项目所在地', AbortSignal.timeout(1000))
  expect(h.start).toHaveBeenCalledWith('spawn', expect.objectContaining({ agentOptions: { provider: 'p', model: 'm' }, toolFilter: { allow: ['web_search', 'web_fetch'] }, maxDepth: 1 }))
  expect(result).toMatchObject({ childId: 'child', verifiedEvidence: false, summary: '候选内容', retrievals: [{ tool: 'web_fetch', callId: 'c1', text: '来源网页原文' }] })
  expect(h.classes.finish).toHaveBeenCalledWith('run', 'completed')
  expect(h.dispose).toHaveBeenCalledOnce()
})
it('lets the selected web model resolve its output budget instead of inheriting a small parent cap', async () => {
  const h = fixture([
    { type: 'tool/call', data: { callId: 'c1', name: 'web_fetch' } },
    { type: 'tool/result', data: { message: { content: [{ type: 'tool-result', toolCallId: 'c1', isError: false, content: [{ type: 'text', text: '原文' }] }] } } },
  ])
  const parent = { id: 'parent', options: { provider: 'p', model: 'm', maxTokens: 2048 }, session: { requestHeader: () => undefined } } as never
  await h.service.query(parent, 'p', '寻找真实案例原图及来源摘录', AbortSignal.timeout(1000))
  expect(resolveChildAgentOptions(parent, h.start.mock.calls[0]![1].agentOptions, 1).maxTokens).toBeUndefined()
})
it.each([{ events: [] }, { events: [{ type: 'tool/call', data: { callId: 'c1', name: 'web_search' } }, { type: 'tool/result', data: { message: { content: [{ type: 'tool-result', toolCallId: 'c1', isError: true, content: [] }] } } }]}])('rejects model prose or failed retrieval as web research', async ({ events }) => {
  const h = fixture(events)
  await expect(h.service.query({ id: 'parent' } as never, 'p', '查询', AbortSignal.timeout(1000))).rejects.toThrow('WEB_RETRIEVAL_UNVERIFIED')
  expect(h.classes.finish).toHaveBeenCalledWith('run', 'failed', expect.any(String))
})
it('fails before dispatch when DSH has no allowed web tools', async () => {
  const h = fixture([], false)
  await expect(h.service.query({ id: 'parent' } as never, 'p', '查询', AbortSignal.timeout(1000))).rejects.toThrow('WEB_TOOLS_UNAVAILABLE')
  expect(h.start).not.toHaveBeenCalled()
})
it('preserves a safe provider diagnostic and releases the child on upstream failure', async () => {
  const h = fixture()
  h.start.mockResolvedValueOnce({ id: 'child', result: Promise.resolve({ stopReason: 'error', output: [], diagnostic: '503 All accounts limited' }), dispose: h.dispose } as never)
  await expect(h.service.query({ id: 'parent' } as never, 'p', '查询', AbortSignal.timeout(1000))).rejects.toThrow('503 All accounts limited')
  expect(h.classes.finish).toHaveBeenCalledWith('run', 'failed', expect.stringContaining('503 All accounts limited'))
  expect(h.dispose).toHaveBeenCalledOnce()
})
it('reports the runtime guard cause when DSH cancellation has no provider diagnostic', async () => {
  const h = fixture([{ type: 'turn/end', data: { reason: { kind: 'aborted', reason: { kind: 'hook', reason: 'PREPLANNING_REPEATED_TOOL_FAILURE: synthetic loop stopped' } } } }])
  h.start.mockResolvedValueOnce({ id: 'child', result: Promise.resolve({ stopReason: 'aborted', output: [] }), dispose: h.dispose } as never)
  await expect(h.service.query({ id: 'parent' } as never, 'p', '查询', AbortSignal.timeout(1000))).rejects.toThrow('PREPLANNING_REPEATED_TOOL_FAILURE')
})
