import { expect, it } from 'vitest'
import { preplanningExecutionStop } from '../src/runtime/preplanning-execution-guard.ts'

const start = { type: 'turn/start', data: {} }
const context = { type: 'tool/call', data: { name: 'preplanning_get_context', callId: 'context' } }
const failures = (count: number, name = 'subagent') => Array.from({ length: count }, (_, i) => [
  { type: 'tool/call', data: { name, callId: `c${i}` } },
  { type: 'tool/result', data: { message: { content: [{ type: 'tool-result', toolCallId: `c${i}`, isError: true, content: [{ type: 'text', text: 'invalid arguments: missing required property "prompt"' }] }] } } },
]).flat()

it('stops repeated invalid subagent calls even with unrelated successful tools between failures', () => {
  expect(preplanningExecutionStop([start, context, ...failures(2)], true)).toBeUndefined()
  const unrelated = [
    { type: 'tool/call', data: { name: 'read', callId: 'read' } },
    { type: 'tool/result', data: { message: { content: [{ type: 'tool-result', toolCallId: 'read', content: [] }] } } },
  ]
  expect(preplanningExecutionStop([start, context, ...failures(2), ...unrelated, ...failures(1)], true)).toContain('PREPLANNING_REPEATED_TOOL_FAILURE')
})
it('does not carry a previous turn failure budget into a new turn or limit unrelated DSH tasks', () => {
  expect(preplanningExecutionStop([start, context, ...failures(3), start], true)).toBeUndefined()
  expect(preplanningExecutionStop([start, context, ...failures(3)], false)).toBeUndefined()
  expect(preplanningExecutionStop([start, ...failures(3)], true)).toBeUndefined()
})
it('bounds managed child execution using its durable descriptor before class attachment', () => {
  const descriptor = { type: 'subagent/descriptor', data: { label: 'preplanning_web:p' } }
  expect(preplanningExecutionStop([start, descriptor, ...failures(3, 'web_search')], false)).toContain('PREPLANNING_REPEATED_TOOL_FAILURE')
  expect(preplanningExecutionStop([start, descriptor, ...Array.from({ length: 40 }, () => ({ type: 'step/start', data: {} }))], false)).toContain('PREPLANNING_STEP_LIMIT')
})
it('does not interpret echoed action placeholders as useful progress', () => {
  const echoes = Array.from({ length: 3 }, (_, i) => [
    { type: 'tool/call', data: { callId: `echo${i}`, name: 'pwsh' } },
    { type: 'tool/result', data: { message: { content: [{ type: 'tool-result', toolCallId: `echo${i}`, content: [{ type: 'text', text: '[OK: Action logged - Write test text to file]' }] }] } } },
  ]).flat()
  expect(preplanningExecutionStop([start, context, ...echoes], true)).toContain('PREPLANNING_NO_PROGRESS')
})
