import { describe, expect, it } from 'vitest'
import { LlmRuntime } from '@deepseek-ai/dsh-llm'
import { agentOptionsForRoute } from '../src/agent-classes/model-options.ts'

describe('native per-model output budgets', () => {
  it('clears a parent output cap so a child can use its own model budget', () => {
    const child = agentOptionsForRoute({ provider: 'openai-codex', model: 'gpt-6-luna', reasoningEffort: 'xhigh' })
    expect(child).toHaveProperty('maxTokens', undefined)
    expect(child).toMatchObject({ provider: 'openai-codex', model: 'gpt-6-luna', reasoningEffort: 'xhigh' })
  })

  it.each([
    ['SenseNova', 'sensenova-6.8-flash-lite', 262144, 65536],
    ['openai-codex', 'gpt-6-luna', 1050000, 128000],
    ['antigravity', 'gemini-3.8-flash-high', 1048576, 65536],
  ])('lets the actual DSH normalizer materialize %s/%s limits', (provider, model, contextWindow, outputTokens) => {
    const options = agentOptionsForRoute({ provider, model })
    const resolved = (LlmRuntime.prototype as any).resolveCallWithInfo(options, {
      provider, id: model, name: model, context: { contextWindow }, defaultMaxTokens: outputTokens,
    })
    expect(resolved.config).toMatchObject({ provider, model, maxTokens: outputTokens })
    expect(resolved.context).toEqual({ contextWindow })
  })
})
