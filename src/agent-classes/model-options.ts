import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { LlmRoute } from './types.ts'

/** Explicit undefined clears inherited request caps/effort; DSH then applies this model's own configured defaults. */
export function agentOptionsForRoute(route: LlmRoute) {
  return { provider: route.provider, model: route.model,
    maxTokens: undefined,
    reasoningEffort: route.reasoningEffort === undefined ? undefined : ReasoningEffortId(route.reasoningEffort) }
}

/** Legacy/default selections leave the adapter's actual effort unconstrained. */
export function matchesModelRoute(actual: { readonly provider?: unknown; readonly model?: unknown; readonly reasoningEffort?: unknown }, expected: LlmRoute): boolean {
  return actual.provider === expected.provider && actual.model === expected.model
    && (expected.reasoningEffort === undefined || actual.reasoningEffort === expected.reasoningEffort)
}
