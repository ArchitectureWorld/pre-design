import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ResearchRegistry } from '../src/research/registry.ts'
import { WorkflowResearchRuntime } from '../src/runtime/workflow-research-runtime.ts'

const researchRoot = new URL('../research/v2.0.1/', import.meta.url)
const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('V2.0.1 runtime workflow research', () => {
  it('auto-discovers exact required DataPoints from structured workspace JSON', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pre-v201-runtime-research-'))
    cleanup.push(root)
    await writeFile(join(root, 'project.json'), JSON.stringify({
      canonical_name: '武汉站改造',
      project_location: '武汉市',
      project_trigger: '既有站房更新与服务能力提升',
    }), 'utf8')

    const registry = await ResearchRegistry.open(researchRoot)
    const runtime = new WorkflowResearchRuntime(registry, {
      workspaceRootOf: () => root,
      clock: () => new Date('2026-09-14T06:00:00.000Z'),
    })

    const result = await runtime.collect({}, 'preplan.wf.01.01')

    expect(result.validation).toMatchObject({ valid: true, coverage: 1, missingDataPointIds: [] })
    expect(result.records.map(record => [record.dataPointId, record.normalizedValue])).toEqual([
      ['canonical-name', '武汉站改造'],
      ['project-location', '武汉市'],
      ['project-trigger', '既有站房更新与服务能力提升'],
    ])
    expect(result.records.every(record => record.locator.selectorType === 'json_pointer')).toBe(true)
  })

  it('fails closed when no trusted workspace evidence can satisfy required DataPoints', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pre-v201-runtime-research-empty-'))
    cleanup.push(root)
    await writeFile(join(root, 'notes.json'), JSON.stringify({ unrelated: true }), 'utf8')

    const registry = await ResearchRegistry.open(researchRoot)
    const runtime = new WorkflowResearchRuntime(registry, { workspaceRootOf: () => root })
    const result = await runtime.collect({}, 'preplan.wf.01.01')

    expect(result.validation.valid).toBe(false)
    expect(result.validation.missingDataPointIds).toEqual(expect.arrayContaining([
      'canonical-name', 'project-location', 'project-trigger',
    ]))
  })
})
