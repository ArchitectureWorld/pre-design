import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { ContractRegistry } from '../src/contracts/registry.ts'

const contractRoot = new URL('../contracts/v0.6/', import.meta.url)

describe('ContractRegistry', () => {
  it('loads the canonical registry and validates state with its real JSON Schemas', async () => {
    const registry = await ContractRegistry.open(contractRoot)
    const valid = JSON.parse(await readFile(new URL('tests/fixtures/valid/PS01.json', contractRoot), 'utf8'))
    const invalid = JSON.parse(await readFile(new URL('tests/fixtures/invalid/PS01_missing_required.json', contractRoot), 'utf8'))

    expect(registry.stateObjectIds()).toHaveLength(57)
    expect(registry.workflowIds()).toHaveLength(57)
    expect(registry.modelToolNames()).toEqual([
      'preplanning_apply_commands',
      'preplanning_get_context',
    ])
    expect(registry.validateStateObject('PS01', valid)).toEqual({ valid: true, errors: [] })

    const rejected = registry.validateStateObject('PS01', invalid)
    expect(rejected.valid).toBe(false)
    expect(rejected.errors.join('\n')).toContain("must have required property 'project_id'")
  })

  it('fails closed when a state object id is not registered', async () => {
    const registry = await ContractRegistry.open(contractRoot)
    expect(() => registry.validateStateObject('UNKNOWN', {})).toThrow('unknown state object contract: UNKNOWN')
  })

  it('projects all workflows, gates and atomic tools from the canonical contract files', async () => {
    const registry = await ContractRegistry.open(contractRoot)

    expect(registry.workflows()).toHaveLength(57)
    expect(registry.gates()).toHaveLength(8)
    expect(registry.atomicToolIds()).toHaveLength(47)
    expect(registry.workflows()[0]?.workflowId).toBe('preplan.wf.01.01')
    expect(registry.workflows().at(-1)?.workflowId).toBe('preplan.wf.08.08')
    expect(registry.workflow('preplan.wf.08.08')).toMatchObject({
      chapterId: '08',
      workItemId: '08-08',
      title: '风险敏感性绩效与后评估',
      targetObjectId: 'IM08',
      targetSchemaId: 'urn:preplan:v0.6:state:IM08',
      gateId: 'G8',
      requiredUpstream: ['IM01', 'IM02', 'IM03', 'IM04', 'IM05', 'IM06', 'IM07', 'OB03'],
      automationLevel: 'A2',
      risk: 'H',
      humanReviewMandatory: true,
    })
    expect(registry.gate('G1')).toMatchObject({
      chapterId: '01',
      title: '项目任务确认',
      requiredObjectIds: ['PS01', 'PS02', 'PS03', 'PS04', 'PS05', 'PS06', 'PS07'],
      allowedDecisions: ['approved', 'approved_with_conditions', 'returned'],
    })
    expect(registry.atomicToolIds()[0]).toBe('T01')
    expect(registry.atomicToolIds().at(-1)).toBe('T47')
  })

  it('serves dependency closure and raw state schemas without a handwritten work-item list', async () => {
    const registry = await ContractRegistry.open(contractRoot)

    expect(registry.dependents('PS01')).toHaveLength(56)
    expect(registry.dependents('PS01')).toEqual(expect.arrayContaining(['PS02', 'SP08', 'IM08']))
    expect(registry.stateSchema('PS01')).toMatchObject({
      $id: 'urn:preplan:v0.6:state:PS01',
      'x-preplan': {
        chapter: '01',
        work_item_id: '01-01',
        workflow: 'preplan.wf.01.01',
        gate: 'G1',
      },
    })
    expect(() => registry.workflow('missing')).toThrow('unknown workflow contract: missing')
    expect(() => registry.gate('missing')).toThrow('unknown gate contract: missing')
    expect(() => registry.dependents('missing')).toThrow('unknown dependency object: missing')
  })
})
