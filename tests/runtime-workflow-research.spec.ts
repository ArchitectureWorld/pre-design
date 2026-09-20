import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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
  it('excludes superseded project state from research even when its revision is newer', async () => {
    const registry = await ResearchRegistry.open(researchRoot)
    const runtime = new WorkflowResearchRuntime(registry, {
      excludedStateObjectIds: () => ['DG01'],
      projectContextOf: () => ({ project: { projectId: 'project' }, stateObjects: [
        { projectId: 'project', objectId: 'BL08', revision: 1, updatedAt: '2026-09-17T00:00:00Z', value: { issues: ['可核实的问题'] } },
        { projectId: 'project', objectId: 'DG01', revision: 48, updatedAt: '2026-09-17T00:00:00Z', value: { issues: ['已被审查否定的内容'] } },
      ] } as never),
    })
    const result = await runtime.collect({}, 'preplan.wf.03.01')
    expect(result.records.find(record => record.dataPointId === 'issues')?.normalizedValue).toEqual(['可核实的问题'])
    expect(JSON.stringify(result.records)).not.toContain('已被审查否定')
  })
  it('continues decision framing with an explicit missing-owner limitation, without inventing evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pre-research-conditional-'))
    cleanup.push(root)
    await writeFile(join(root, 'project.json'), JSON.stringify({ decision_question: '是否开展文旅开发、采用何种定位及招商方案', decision_context: '水库保护约束，投资和开发主体未指定' }))
    const runtime = new WorkflowResearchRuntime(await ResearchRegistry.open(researchRoot), { workspaceRootOf: () => root })
    const result = await runtime.collect({}, 'preplan.wf.01.02')
    expect(result.validation).toMatchObject({ valid: false, missingDataPointIds: ['decision-owner'] })
    expect(result.records.some(record => record.dataPointId === 'decision-owner')).toBe(false)
    expect(result.continuation).toMatchObject({ mode: 'conditional', workflowId: 'preplan.wf.01.02', missingDataPointIds: ['decision-owner'] })
  })

  it('uses confirmed upstream context for a conditional scope instead of asking a person to fill every input', async () => {
    const registry = await ResearchRegistry.open(researchRoot)
    const runtime = new WorkflowResearchRuntime(registry, { projectContextOf: () => ({
      project: { projectId: 'project' }, stateObjects: [{ objectId: 'PS02', revision: 1, value: { data: { summary: '已建立决策问题' } } }],
    } as never) })
    const result = await runtime.collect({}, 'preplan.wf.01.03')
    expect(result.validation.valid).toBe(false)
    expect(result.records).toHaveLength(0)
    expect(result.continuation?.mode).toBe('conditional')
    expect(result.continuation?.missingDataPointIds).toContain('spatial-boundary')
  })

  it('does not acquire facts from schema definitions, examples, debug files or generated proposals', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pre-research-artifacts-'))
    cleanup.push(root)
    await writeFile(join(root, 'context.json'), JSON.stringify({
      targetSchema: { $defs: { TimeConstraint: { type: 'object', properties: { deadline: { type: 'string' } } } } },
      example: { project_location: '示例城市' },
    }))
    await writeFile(join(root, 'envelope_final.json'), JSON.stringify({ project_trigger: '历史自动草稿' }))
    await mkdir(join(root, 'debug'))
    await writeFile(join(root, 'debug', 'project.json'), JSON.stringify({ canonical_name: '调试样例' }))
    const runtime = new WorkflowResearchRuntime(await ResearchRegistry.open(researchRoot), { workspaceRootOf: () => root })
    const result = await runtime.collect({}, 'preplan.wf.01.01')
    expect(result.records).toEqual([])
    expect(result.validation.valid).toBe(false)
  })

  it('keeps real nested facts while skipping schema-shaped values in an otherwise valid source', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pre-research-nested-'))
    cleanup.push(root)
    await writeFile(join(root, 'project.json'), JSON.stringify({
      technical: { TimeConstraint: { type: 'object', properties: { deadline: { type: 'string' } } } },
      facts: { canonical_name: '少潭河', project_location: '武汉市新洲区', project_trigger: '文旅休闲开发',
        time_constraint: { deadline: '尚未确定', source: '任务说明' } },
    }))
    const runtime = new WorkflowResearchRuntime(await ResearchRegistry.open(researchRoot), { workspaceRootOf: () => root })
    const result = await runtime.collect({}, 'preplan.wf.01.01')
    expect(result.validation.valid).toBe(true)
    expect(result.records.find(record => record.dataPointId === 'time-constraint')?.normalizedValue)
      .toEqual({ deadline: '尚未确定', source: '任务说明' })
  })

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
