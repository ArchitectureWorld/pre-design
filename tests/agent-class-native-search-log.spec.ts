import { expect, it } from 'vitest'
import * as web from '../src/agent-classes/web-query.ts'
import { sha256CanonicalJson } from '../src/presentation/canonical-json.ts'

it('records only real public search inputs and observed tool outcomes without assistant reasoning or credentials', () => {
  expect(typeof (web as Record<string, unknown>).nativeWebSearchCalls).toBe('function')
  const events = [
    { type: 'assistant/message', data: { message: { content: [{ type: 'thinking', text: 'private reasoning' }] } } },
    { type: 'tool/call', data: { name: 'web_search', callId: 's', arguments: JSON.stringify({ queries: ['武汉亲子研学'], secret: 'credential' }) } },
    { type: 'tool/result', data: { message: { content: [{ type: 'tool-result', toolCallId: 's', isError: false, content: [{ type: 'text', text: 'Public results' }] }] } } },
    { type: 'tool/call', data: { name: 'web_fetch', callId: 'f', arguments: JSON.stringify({ url: 'https://example.gov.cn/p' }) } },
    { type: 'tool/result', data: { message: { content: [{ type: 'tool-result', toolCallId: 'f', isError: true, content: [{ type: 'text', text: 'fetch failed' }] }] } } },
    { type: 'tool/call', data: { name: 'shell', callId: 'x', arguments: 'credential' } },
  ]
  const calls = (web as unknown as { nativeWebSearchCalls: (e: typeof events) => unknown[] }).nativeWebSearchCalls(events)
  expect(calls).toEqual([
    { tool: 'web_search', callId: 's', request: { queries: ['武汉亲子研学'] }, status: 'succeeded', resultHash: sha256CanonicalJson('Public results'), resultChars: 14 },
    { tool: 'web_fetch', callId: 'f', request: { url: 'https://example.gov.cn/p' }, status: 'failed', resultHash: sha256CanonicalJson('fetch failed'), resultChars: 12 },
  ])
  expect(JSON.stringify(calls)).not.toMatch(/credential|secret|reasoning|shell/)
})
