import type { EffectiveWorkflowAutomationPolicy } from './types.ts'

function normalizedRisk(risk: string): 'L' | 'M' | 'H' {
  const normalized = risk.trim().toUpperCase()
  if (normalized === 'H' || normalized === 'HIGH') return 'H'
  if (normalized === 'M' || normalized === 'MEDIUM') return 'M'
  return 'L'
}

export function effectiveWorkflowAutomationPolicy(risk: string): EffectiveWorkflowAutomationPolicy {
  const level = normalizedRisk(risk)
  const defaults = level === 'H'
    ? { minimumConfidence: 0.88, maxAutomaticAttempts: 5 }
    : level === 'M'
      ? { minimumConfidence: 0.80, maxAutomaticAttempts: 4 }
      : { minimumConfidence: 0.72, maxAutomaticAttempts: 3 }

  return Object.freeze({
    automaticCommitAllowed: true,
    automaticGateAllowed: true,
    humanApprovalRequired: false,
    humanInteractionMode: 'override_only' as const,
    ...defaults,
  })
}
