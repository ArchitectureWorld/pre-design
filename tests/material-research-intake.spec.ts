import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ResearchRegistry } from '../src/research/registry.ts'
import { WorkflowResearchRuntime } from '../src/runtime/workflow-research-runtime.ts'
import { MaterialResearchIntake, sessionStatements } from '../src/runtime/material-research-intake.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'pre-intake-')); roots.push(root)
  await mkdir(join(root, '原始资料'))
  const text = '少潭河水库位于湖北省。历史方案编于2020年。'
  await writeFile(join(root, '原始资料/a.txt'), text)
  const parent = { id: 'session-test', session: { id: 'session-test', header: { cwd: root }, snapshotEvents: () => [
    { type: 'user/message', seq: 1, time: Date.parse('2026-09-26T00:00:00.000Z'), data: { source: { kind: 'user' }, content: [{ type: 'text', text: '少潭河新版测试；从原始内容重新测试所有流程。' }] } },
    { type: 'assistant/message', seq: 2, time: '2026-09-26T00:00:01.000Z', data: { content: [{ type: 'text', text: '已获政府批准。' }] } },
  ] } }
  const bindings = [{ dataPointId: 'project-location', path: '原始资料/a.txt', contentHash: createHash('sha256').update(text).digest('hex'), quote: '少潭河水库位于湖北省。' }]
  const statements = [{ dataPointId: 'canonical-name', seq: 1, quote: '少潭河新版测试' }, { dataPointId: 'project-trigger', seq: 1, quote: '从原始内容重新测试所有流程。' }]
  const registry = await ResearchRegistry.open(new URL('../research/v2.0.1/', import.meta.url))
  return { root, parent, bindings, statements, registry }
}

describe('native material research intake', () => {
  it('admits verified PDF/text and real user statements before the initial gate without elevating user intent to fact', async () => {
    const f = await fixture()
    const extract = vi.fn(async () => ({ materials: f.bindings, statements: f.statements, limitations: [] }))
    const intake = new MaterialResearchIntake({ registry: f.registry, extract })
    const runtime = new WorkflowResearchRuntime(f.registry, { materialEvidence: (parent, workflowId, signal) => intake.collect(parent, workflowId, signal) })
    const result = await runtime.collect(f.parent, 'preplan.wf.01.01')
    expect(result.validation.valid).toBe(true)
    expect(result.records.find(r => r.dataPointId === 'project-trigger')).toMatchObject({ claimClass: 'user_statement', reliability: 'C', locator: { sessionId: 'session-test', seq: 1 } })
    expect(JSON.stringify(result.records)).not.toContain('政府批准')
    expect(extract).toHaveBeenCalledTimes(1)
  })
  it('rejects assistant text, forged quotes and unknown fields rather than trusting extraction output', async () => {
    const f = await fixture()
    for (const statements of [[{ dataPointId: 'project-trigger', seq: 2, quote: '已获政府批准。' }], [{ dataPointId: 'project-trigger', seq: 1, quote: '批准建设' }], [{ dataPointId: 'invented', seq: 1, quote: '新版测试' }]]) {
      const intake = new MaterialResearchIntake({ registry: f.registry, extract: async () => ({ materials: [], statements, limitations: [] }) })
      await expect(intake.collect(f.parent, 'preplan.wf.01.01')).rejects.toThrow()
    }
  })
  it.each([['implementation-boundary', 'boundary'], ['time-horizon', 'schedule']])
    ('identifies the exact unsupported PS03 statement binding %s and kind %s', async (dataPointId, dataKind) => {
      const f = await fixture()
      const intake = new MaterialResearchIntake({ registry: f.registry, extract: async () => ({ materials: [],
        statements: [{ dataPointId, seq: 1, quote: '从原始内容重新测试所有流程。' }], limitations: ['不代表实施边界或本轮时间依据。'] }) })
      await expect(intake.collect(f.parent, 'preplan.wf.01.03')).rejects.toThrow(`MATERIAL_INTAKE_STATEMENT_KIND_INVALID: dataPointId=${JSON.stringify(dataPointId)}; dataKind=${JSON.stringify(dataKind)}; sourceId="dsh-user-statement"`)
    })
  it('rechecks source changes and never reuses a stale result', async () => {
    const f = await fixture()
    const extract = vi.fn(async () => ({ materials: f.bindings, statements: f.statements, limitations: [] }))
    const intake = new MaterialResearchIntake({ registry: f.registry, extract })
    await intake.collect(f.parent, 'preplan.wf.01.01')
    await intake.collect(f.parent, 'preplan.wf.01.01')
    expect(extract).toHaveBeenCalledTimes(1)
    await writeFile(join(f.root, '原始资料/a.txt'), 'changed')
    await expect(intake.collect(f.parent, 'preplan.wf.01.01')).rejects.toThrow()
    expect(extract).toHaveBeenCalledTimes(2)
  })
  it('respects cancellation and does not invent evidence for empty inputs', async () => {
    const f = await fixture()
    const extract = vi.fn(async () => ({ materials: [], statements: [], limitations: ['missing'] }))
    const intake = new MaterialResearchIntake({ registry: f.registry, extract })
    await expect(intake.collect(f.parent, 'preplan.wf.01.01', AbortSignal.abort())).rejects.toThrow()
    expect(extract).not.toHaveBeenCalled()
    expect(sessionStatements({ session: { snapshotEvents: () => [] } })).toEqual([])
  })
})
