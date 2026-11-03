import { describe, expect, it } from 'vitest'
import { getModuleAuthorFieldGroups } from '../src/research-v2/module-author-groups.ts'
import { moduleGroupWorkPlan } from '../src/research-v2/module-group-work-plan.ts'

describe('bounded native group responsibilities', () => {
  it('keeps the three historical node groups and limits the final author to its own fields', () => {
    const groups = getModuleAuthorFieldGroups('2.02'), original = structuredClone(groups)
    expect(groups.map(row => row.groupId)).toEqual(['regional_nodes:1', 'regional_nodes:2', 'regional_nodes:3'])
    const work = moduleGroupWorkPlan('2.02', groups[2])
    expect(work.assignedFields).toEqual(['scale', 'status', 'relationshipState'])
    expect(work.stepCoverage).toEqual([
      { step: 1, assignedFields: [], responsibility: 'dependencies-and-limitations-only' },
      { step: 2, assignedFields: ['scale', 'status'], responsibility: 'current-fields-only' },
      { step: 3, assignedFields: ['relationshipState'], responsibility: 'current-fields-only' },
      { step: 4, assignedFields: ['scale', 'status', 'relationshipState'], responsibility: 'current-fields-only' },
    ])
    expect(work.otherGroups.flatMap(row => row.fields)).toContain('geometry')
    expect(work.assignedFields).not.toContain('geometry')
    expect(groups).toEqual(original)
  })

  it('keeps OD coordinates separate from calculations and does not supply route values', () => {
    const groups = getModuleAuthorFieldGroups('2.03')
    const identity = moduleGroupWorkPlan('2.03', groups[0]), calculation = moduleGroupWorkPlan('2.03', groups[2])
    expect(identity.stepCoverage[2].assignedFields).toEqual([])
    expect(calculation.stepCoverage[0].assignedFields).toEqual([])
    expect(calculation.stepCoverage[2].assignedFields).toEqual(['straightMeters', 'roadMeters', 'durationSeconds'])
    expect(calculation).not.toHaveProperty('outputs')
    expect(calculation).not.toHaveProperty('evidence')
    expect(calculation.unresolvedDependencies).toBe('preserve-limitations-no-substitution')
  })
})
