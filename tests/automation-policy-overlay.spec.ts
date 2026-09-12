import { describe, expect, it } from 'vitest'
import { ContractRegistry } from '../src/contracts/registry.ts'

const contractRoot = new URL('../contracts/v0.6/', import.meta.url)

describe('Pre 2.0.1 effective automation policy overlay', () => {
  it('keeps legacy review flags as source history but exposes automatic-mode override policy', async () => {
    const registry = await ContractRegistry.open(contractRoot)
    const highRisk = registry.workflow('preplan.wf.01.02') as any

    expect(highRisk.risk).toBe('H')
    expect(highRisk.reviewPolicy).toMatchObject({
      humanReviewMandatory: true,
      gateStillHuman: true,
    })
    expect(highRisk.automationPolicy).toMatchObject({
      automaticCommitAllowed: true,
      automaticGateAllowed: true,
      humanApprovalRequired: false,
      humanInteractionMode: 'override_only',
      minimumConfidence: 0.88,
      maxAutomaticAttempts: 5,
    })
  })

  it('does not mutate the V0.6 source contract while applying the V2.0.1 overlay', async () => {
    const registry = await ContractRegistry.open(contractRoot)
    const highRisk = registry.workflow('preplan.wf.01.02') as any

    expect(highRisk.humanReviewMandatory).toBe(true)
    expect(highRisk.reviewPolicy.humanReviewMandatory).toBe(true)
    expect(highRisk.automationPolicy.humanApprovalRequired).toBe(false)
  })
})
