import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getModuleFieldContracts } from '../src/research-v2/module-contracts.ts'
import { getResearchModuleSpec } from '../src/research-v2/specification.ts'
import { sha256CanonicalJson } from '../src/presentation/canonical-json.ts'
import type { ModuleAnalysisContext } from '../src/research-v2/module-execution.ts'
import { buildProjectTaskAudit } from '../src/research-v2/project-task-audit.ts'

const url = new URL('../src/research-v2/module-execution.ts', import.meta.url)
async function api() { expect(existsSync(url), 'research module execution is implemented').toBe(true); return import(url.href) }
const roots: string[] = []
async function root() { const value = await mkdtemp(join(tmpdir(), 'research-module-')); roots.push(value); return value }
afterEach(async () => { for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true }) })
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const text = '原始面积 12.5 平方米，新增面积 2.5 平方米。'
const documents = [{ path: '原始资料/面积.txt', contentHash: hash(text), byteLength: Buffer.byteLength(text), text }]
const corpus = { documents, limitations: [], fingerprint: hash(JSON.stringify({ documents, limitations: [] })) }
const values = [{ sourceId: 'area', path: documents[0].path, contentHash: documents[0].contentHash, quote: '原始面积 12.5 平方米', valueQuote: '12.5', rawValue: 12.5 },
  { sourceId: 'additional', path: documents[0].path, contentHash: documents[0].contentHash, quote: '新增面积 2.5 平方米', valueQuote: '2.5', rawValue: 2.5 }]
const flags = { industryPlanning: false, existingBuildings: false, externalPartners: false, marketing: false }
function output(context: any) {
  const claims = context.module.ports.map((port: any) => ({ claimId: `area-${port.name}`, selector: `/outputs/${port.name}/records/0/area`, kind: 'calculation', value: 15,
    calculation: { operation: 'sum', operands: [{ sourceId: 'area' }, { sourceId: 'additional' }] } }))
  return { outputs: Object.fromEntries(context.module.ports.map((port: any, index: number) => [port.name, {
    type: port.type, quality: 'limited', records: [{ area: 15 }], claimRefs: [claims[index].claimId], limitations: ['仅历史资料，不代表现状实测'], scope: 'fixture', asOf: '2026-09-26',
  }])), claims, sourceValues: values, limitations: ['仅历史资料，不代表现状实测'] }
}
const validateOutputs = (_id: string, outputs: any) => {
  for (const value of Object.values(outputs) as any[]) if (value.records.some((r: any) => typeof r.area !== 'number')) throw Error('PROFESSIONAL_AREA_REQUIRED')
}
async function request(moduleIds = ['1.01']) { return { workspaceRoot: await root(), projectId: 'project-1', snapshotId: 'snapshot-1', corpus, flags, moduleIds } }

function professionalOutput(context: any) {
  const contract = getModuleFieldContracts(context.module.id)
  const outputs = Object.fromEntries(Object.entries(contract.ports).map(([name, port]) => [name, {
    type: port.type, quality: 'limited', records: [{ recordId: 'record-1', resultClass: 'observation_summary',
      ...Object.fromEntries(port.fields.map(field => [field.name, { value: null, claimRefs: [], claimClass: 'missing', limitations: ['原件没有该字段，待补资料'] }])) }],
    claimRefs: [], limitations: ['历史来源且字段不完整'], scope: '原始资料实际记载', asOf: '2026-09-26',
  }])) as any
  const port = context.module.ports[0].name
  outputs[port].records[0].formalName = { value: '原始面积', claimRefs: ['name'], claimClass: 'source_conclusion', limitations: ['仅取原文措辞，尚非正式命名'] }
  outputs[port].claimRefs = ['name']
  return { outputs, claims: [{ claimId: 'name', selector: `/outputs/${port}/records/0/formalName/value`, kind: 'source', value: '原始面积', sourceId: 'name-source' }],
    sourceValues: [{ sourceId: 'name-source', path: documents[0].path, contentHash: documents[0].contentHash, quote: text, rawValue: '原始面积' }], limitations: ['历史来源且字段不完整'] }
}

describe('professional module execution and immutable replay', () => {
  it('restores a failed native checkpoint without replaying its verified ancestors again', async () => {
    const { runModuleExecution } = await api()
    const audit = { attempts: [{ classId: 'text', groupId: 'fixture:1', status: 'completed' }], reviewReceipts: [] }
    async function resume(withAudit: boolean) {
      const input = await request(['1.02'])
      const first = await runModuleExecution(input, { validateOutputs, analyze: async (context: ModuleAnalysisContext) => {
        if (context.module.id === '1.02') throw Object.assign(new Error('provider failed'), withAudit ? { moduleExecutionAudit: audit } : {})
        return output(context)
      } })
      expect(first.status).toBe('partial')
      let ancestorValidations = 0
      const resumed = await runModuleExecution({ ...input, resumeRunIds: [first.manifestRunId!] }, {
        validateOutputs: (id: string, outputs: unknown) => { if (id === '1.01') ancestorValidations++; return validateOutputs(id, outputs) },
        analyze: async (context: ModuleAnalysisContext) => {
          expect(context.module.id).toBe('1.02')
          expect(context.resumeExecutionAudit).toEqual(withAudit ? audit : undefined)
          expect(context.inputRefs[0].bundleRunId).toBe(first.moduleRuns[0].bundleRunId)
          return output(context)
        },
      })
      expect(resumed.moduleRuns.find((row: { itemId: string; error?: string }) => row.itemId === '1.02')?.error).toBeUndefined()
      expect(resumed.status).toBe('completed')
      expect(resumed.moduleRuns[0].resultHash).toBe(first.moduleRuns[0].resultHash)
      expect(ancestorValidations).toBeGreaterThan(0)
      return ancestorValidations
    }
    const withoutAudit = await resume(false)
    expect(await resume(true)).toBe(withoutAudit)
  })
  it('preserves a central merge rejection for same-input native recovery even when every author receipt completed', async () => {
    const { runModuleExecution, readModuleExecutionSummary } = await api(), input = await request()
    const message = 'MODULE_EMPTY_PROFESSIONAL_CONCLUSION: concrete fallback required'
    const audit = { attempts: [{ classId: 'text', groupId: 'fixture:1', status: 'completed' }], reviewReceipts: [] }
    const first = await runModuleExecution(input, { validateOutputs, analyze: async () => {
      throw Object.assign(new Error(message), { moduleExecutionAudit: audit })
    } })
    const prior = await readModuleExecutionSummary(input.workspaceRoot, first.manifestRunId!, { validateOutputs })
    expect(prior.moduleRuns[0].error).toBe(message)
    const next = await runModuleExecution({ ...input, resumeRunIds: [first.manifestRunId!] }, { validateOutputs, analyze: async (context: ModuleAnalysisContext) => {
      expect(context.resumeExecutionError).toBe(message)
      expect(context.resumeExecutionAudit).toEqual(audit)
      return output(context)
    } })
    expect(next.moduleRuns[0].status).toBe('completed')
    expect(await readModuleExecutionSummary(input.workspaceRoot, first.manifestRunId!, { validateOutputs })).toEqual(prior)
    await runModuleExecution(input, { validateOutputs, analyze: async (context: ModuleAnalysisContext) => {
      expect(context.resumeExecutionError).toBeUndefined()
      return output(context)
    } })
  })
  it('does not reuse a historical boundary result without a native review receipt', async () => {
    const {runModuleExecution,readModuleExecutionSummary}=await api(),input=await request(['1.01','1.02'])
    const old=await runModuleExecution(input,{validateOutputs,analyze:async(context:any)=>output(context)})
    expect((await readModuleExecutionSummary(input.workspaceRoot,old.manifestRunId,{validateOutputs})).status).toBe('completed')
    const calls:string[]=[]
    await runModuleExecution({...input,resumeRunIds:[old.manifestRunId]},{validateOutputs,analyze:async(context:any)=>{calls.push(context.module.id);return output(context)}})
    expect(calls).toEqual(['1.02'])
  })
  it('persists and independently replays conditional calculations without turning their assumptions into source values', async () => {
    const { runModuleExecution, readModuleExecutionResult } = await api(), input = await request()
    const run = await runModuleExecution(input, { validateOutputs, analyze: async (context: any) => {
      const value: any = output(context), port = context.module.ports[0].name
      value.outputs[port].records[0].allowance = 2.5
      value.outputs[port].claimRefs.push('allowance')
      value.claims.push({ claimId: 'allowance', selector: `/outputs/${port}/records/0/allowance`, kind: 'assumption', value: 2.5,
        rationale: '仅用2.5平方米作为设计预留情景；是否采用由后续方案比较决定。' })
      value.claims[0].calculation = { basis: 'scenario', operation: 'sum', operands: [{ sourceId: 'area' }, { claimId: 'allowance' }] }
      value.claims[0].rationale = '历史面积与明确的设计预留假设之和，并非现状测量。'
      value.sourceValues = values.slice(0, 1)
      return value
    } })
    expect(run.moduleRuns[0].status).toBe('completed')
    const loaded = await readModuleExecutionResult(input.workspaceRoot, run.moduleRuns[0].bundleRunId!, { validateOutputs })
    expect(loaded.claims.find((c: { kind: string; calculation?: { basis?: string } }) => c.kind === 'calculation')?.calculation?.basis).toBe('scenario')
    expect(loaded.sourceValues).toHaveLength(1)
    expect(loaded.limitations.some((l: string) => l.includes('条件情景'))).toBe(true)
  })
  it('recomputes numeric claims from frozen original source values and persists an independently replayable module', async () => {
    const { runModuleExecution, readModuleExecutionResult } = await api(), input = await request()
    const result = await runModuleExecution(input, { analyze: async (context: any) => output(context), validateOutputs })
    expect(result.status).toBe('completed')
    expect(result.results[0].claims[0].value).toBe(15)
    expect(result.results[0].qualityChecks.every((q: any) => q.passed === true)).toBe(true)
    const loaded = await readModuleExecutionResult(input.workspaceRoot, result.moduleRuns[0].bundleRunId, { validateOutputs })
    expect(loaded.outputs).toEqual(result.results[0].outputs)
    expect(loaded.sourceValues).toHaveLength(2)
  })
  it('rejects both invented numeric operands and claimed arithmetic results instead of trusting accepted status', async () => {
    const { runModuleExecution } = await api()
    for (const mutation of ['source', 'calculation']) {
      const input = await request()
      const result = await runModuleExecution(input, { validateOutputs, analyze: async (context: any) => {
        const value = output(context)
        if (mutation === 'source') value.sourceValues = [{ ...values[0], rawValue: 99 }, values[1]]
        else { value.claims[0].value = 999; (Object.values(value.outputs)[0] as any).records[0].area = 999 }
        return value
      } })
      expect(result.status).toBe('partial')
      expect(result.results).toHaveLength(0)
      expect(result.moduleRuns[0].error).toMatch(mutation === 'source' ? /SOURCE_VALUE/ : /CALCULATION/)
    }
  })
  it('rejects unclaimed professional fields and a raw text summary that is absent from original text', async () => {
    const { runModuleExecution } = await api()
    const a = await runModuleExecution(await request(), { validateOutputs, analyze: async (context: any) => ({ ...output(context), claims: [] }) })
    expect(a.moduleRuns[0].error).toMatch(/CLAIM/)
    const b = await runModuleExecution(await request(), { validateOutputs, analyze: async (context: any) => ({ ...output(context), sourceValues: [...values,
      { sourceId: 'invented', path: documents[0].path, contentHash: documents[0].contentHash, quote: text, rawValue: '总面积十五平方米' }] }) })
    expect(b.moduleRuns[0].error).toMatch(/SOURCE_VALUE/)
  })
  it('executes the real catalog DAG before dependants, preserves earlier success on failure, and resumes only verified bundles', async () => {
    const { runModuleExecution } = await api(), input = await request(['1.02'])
    const result = await runModuleExecution(input, { validateOutputs, analyze: async (context: any) => {
      if (context.module.id === '1.02') { expect(context.upstream.some((r: any) => r.itemId === '1.01')).toBe(true); throw Error('provider failed') }
      return output(context)
    } })
    expect(result.status).toBe('partial')
    expect(result.results.map((r: any) => r.itemId)).toContain('1.01')
    const resumed = await runModuleExecution({ ...input, resumeRunIds: [result.manifestRunId] }, { validateOutputs, analyze: async (context: any) => {
      if (context.module.id === '1.01') throw Error('completed root was unnecessarily rerun')
      return output(context)
    } })
    expect(resumed.status).toBe('completed')
    expect(resumed.moduleRuns.find((r: any) => r.itemId === '1.01').bundleRunId).toBe(result.moduleRuns.find((r: any) => r.itemId === '1.01').bundleRunId)
  })
  it('rejects a foreign snapshot and tampered persisted values during resume', async () => {
    const { runModuleExecution } = await api(), input = await request()
    const result = await runModuleExecution(input, { validateOutputs, analyze: async (context: any) => output(context) })
    await expect(runModuleExecution({ ...input, snapshotId: 'snapshot-2', resumeRunIds: [result.manifestRunId] }, { validateOutputs, analyze: async () => { throw Error('must not run') } })).rejects.toThrow(/SNAPSHOT|IDENTITY/)
    await writeFile(join(input.workspaceRoot, 'research/runs', result.moduleRuns[0].bundleRunId, 'result.json'), '{}')
    await expect(runModuleExecution({ ...input, resumeRunIds: [result.manifestRunId] }, { validateOutputs, analyze: async () => { throw Error('must not run') } })).rejects.toThrow(/HASH/)
  })
  it('recomputes stored claims on replay even when altered output bytes have matching manifest hashes', async () => {
    const { runModuleExecution, readModuleExecutionResult } = await api(), input = await request()
    const result = await runModuleExecution(input, { validateOutputs, analyze: async (context: any) => output(context) })
    const savedId = result.moduleRuns[0].bundleRunId, folder = join(input.workspaceRoot, 'research/runs', savedId)
    const persisted = JSON.parse(await readFile(join(folder, 'result.json'), 'utf8'))
    persisted.claims[0].value = 999
    Object.values(persisted.outputs).forEach((p: any) => { p.records[0].area = 999 })
    const content = JSON.stringify(persisted, null, 2) + '\n'
    const manifest = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8'))
    const entry = manifest.files.find((f: any) => f.path === 'result.json')
    entry.sha256 = hash(content); entry.sizeBytes = Buffer.byteLength(content)
    const { manifestHash: _old, ...core } = manifest
    manifest.manifestHash = sha256CanonicalJson(core)
    await writeFile(join(folder, 'result.json'), content)
    await writeFile(join(folder, 'manifest.json'), JSON.stringify(manifest))
    await expect(readModuleExecutionResult(input.workspaceRoot, savedId, { validateOutputs })).rejects.toThrow('MODULE_CALCULATION_MISMATCH')
  })
  it('records cancellation without publishing an in-flight module as complete', async () => {
    const { runModuleExecution } = await api(), input = await request(), controller = new AbortController()
    const result = await runModuleExecution({ ...input, signal: controller.signal }, { validateOutputs, analyze: async (context: any) => {
      controller.abort(new Error('stop')); return output(context)
    } })
    expect(result.status).toBe('cancelled')
    expect(result.results).toHaveLength(0)
    expect(result.moduleRuns.some((r: any) => r.status === 'completed')).toBe(false)
    expect(await readdir(join(input.workspaceRoot, 'research/runs'))).toEqual([result.manifestRunId])
    const stored = JSON.parse(await readFile(join(input.workspaceRoot, 'research/runs', result.manifestRunId, 'run.json'), 'utf8'))
    expect(stored.status).toBe('cancelled')
  })
  it('validates real professional field wrappers and preserves each original missing-field limitation', async () => {
    const { runModuleExecution } = await api(), input = await request()
    const result = await runModuleExecution(input, { analyze: async (context: any) => professionalOutput(context) })
    expect(result.status).toBe('completed')
    expect(result.results[0].limitations.some((s: string) => s.includes('projectId') && s.includes('原件没有该字段'))).toBe(true)
  })
  it('does not let one referenced numeric leaf launder other unsupported numbers in the same field', async () => {
    const { runModuleExecution } = await api(), input = await request()
    const result = await runModuleExecution(input, { analyze: async (context: any) => {
      const value = output(context), port = context.module.ports[0].name
      value.outputs[port].records[0] = { area: { value: { x: 15, y: 999 }, claimRefs: [value.claims[0].claimId], claimClass: 'agent_inference', limitations: ['limited'] } } as any
      value.claims[0].selector += '/value/x'
      return value
    }, validateOutputs: () => undefined })
    expect(result.status).toBe('partial')
    expect(result.moduleRuns[0].error).toMatch(/CLAIM.*UNCOVERED/)
  })
  it('requires an independent complete review receipt and preserves limited findings for native analyses', async () => {
    const { runModuleExecution } = await api(), input = await request()
    for (const broken of [true, false]) {
      const result = await runModuleExecution(input, { analyze: async (context: any) => {
        const candidate = professionalOutput(context)
        const steps = [1, 2, 3, 4].map(step => ({ step, status: 'limited', summary: '原文已读，缺口保留', claimRefs: ['name'], limitations: ['资料有限'] }))
        return { ...candidate, execution: {
        executionId: 'text-execution', childId: 'text-child', actualModel: { provider: 'test', model: 'text' }, stopReason: 'completed',
        steps,
        reviewReceipts: [{ executionId: 'review-execution', childId: broken ? 'text-child' : 'review-child', actualModel: { provider: 'test', model: 'review' }, stopReason: 'completed',
          candidateHash: sha256CanonicalJson({ ...candidate, steps }),
          checks: getResearchModuleSpec('1.01').qa.map(criterion => ({ criterion, status: 'limited', rationale: '仅核对来源与缺失标记，需补充资料' })), limitations: ['复核明确保留现状未核实边界'] }],
      } } } })
      expect(result.status).toBe('partial')
      if (!broken) { expect(result.moduleRuns[0].status).toBe('limited'); expect(result.results[0].limitations).toContain('复核明确保留现状未核实边界') }
    }
  })
  it.each(['run', 'module'])('revises a limited %s checkpoint with its exact independent review instead of losing the rejection', async checkpointKind => {
    const { runModuleExecution } = await api(), input = await request()
    const original = await runModuleExecution(input, { analyze: async (context: any) => {
      const candidate = professionalOutput(context)
      const steps = [1, 2, 3, 4].map(step => ({ step, status: 'limited', summary: '来源核对完成，限制保留', claimRefs: ['name'], limitations: ['资料有限'] }))
      return { ...candidate, execution: { executionId: 'author', childId: 'author-child', actualModel: { provider: 'test', model: 'text' }, stopReason: 'completed', steps,
        reviewReceipts: [{ executionId: 'review', childId: 'review-child', actualModel: { provider: 'test', model: 'review' }, stopReason: 'completed',
          candidateHash: sha256CanonicalJson({ ...candidate, steps }), checks: getResearchModuleSpec('1.01').qa.map(criterion => ({ criterion, status: 'limited', rationale: '区分历史计划与当前资产，不得沿用拟建数值作为现状' })), limitations: ['研究仍需修订'] }] } }
    } })
    expect(original.moduleRuns[0].status).toBe('limited')
    const before = structuredClone(original)
    let calls = 0
    const resumed = await runModuleExecution({ ...input, resumeRunIds: [checkpointKind === 'run' ? original.manifestRunId : original.moduleRuns[0].bundleRunId!] }, {
      analyze: async (context: any) => {
        calls++
        expect(context.resumeExecutionAudit).toEqual({ attempts: [], reviewReceipts: original.results[0].execution!.reviewReceipts })
        throw Error('fresh author intentionally not submitted in this test')
      },
    })
    expect(calls).toBe(1)
    expect(resumed.moduleRuns[0].status).toBe('failed')
    expect(resumed.moduleRuns[0].error).toContain('fresh author intentionally')
    expect(resumed.moduleRuns[0].executionAudit).toEqual({ attempts: [], reviewReceipts: [], priorReviewReceipts: original.results[0].execution!.reviewReceipts })
    let correctionAudit: unknown
    const failed = await runModuleExecution(input, { analyze: async () => { throw Object.assign(Error('MODULE_PROJECTION_EVIDENCE_KIND'), {
      moduleExecutionAudit: { attempts: [{ classId: 'text', status: 'failed', error: 'MODULE_PROJECTION_EVIDENCE_KIND', structuredHash: 'new-rejected-payload' }], reviewReceipts: [] },
    }) } })
    const combined = await runModuleExecution({ ...input, resumeRunIds: [original.manifestRunId, failed.manifestRunId] }, {
      analyze: async (context: any) => { correctionAudit = context.resumeExecutionAudit; throw Error('fresh native revision required') },
    })
    expect(correctionAudit).toEqual({ ...failed.moduleRuns[0].executionAudit, priorReviewReceipts: original.results[0].execution!.reviewReceipts })
    expect(combined.moduleRuns[0].status).toBe('failed'); expect(combined.results).toHaveLength(0)
    await runModuleExecution({ ...input, resumeRunIds: [combined.manifestRunId] }, { analyze: async (context: any) => {
      expect(context.resumeExecutionAudit?.reviewReceipts).toEqual([])
      expect(context.resumeExecutionAudit?.priorReviewReceipts).toEqual(original.results[0].execution!.reviewReceipts)
      throw Error('new independent review still required')
    } })
    const unrelatedFailure = await runModuleExecution(input, { analyze: async () => { throw Object.assign(Error('Unrelated failure'), {
      moduleExecutionAudit: { attempts: [{ classId: 'text', status: 'failed', structuredHash: 'different-author-payload' }], reviewReceipts: [] },
    }) } })
    await expect(runModuleExecution({ ...input, resumeRunIds: [failed.manifestRunId, unrelatedFailure.manifestRunId] }, {
      analyze: async () => { throw Error('ambiguous checkpoint must not execute') },
    })).rejects.toThrow('MODULE_RESUME_AMBIGUOUS')
    expect(original).toEqual(before)
  })
  it.each(['dependency-only', 'explicit-target'])('retains a reviewed limited ancestor without upgrading it when recovering %s research', async scope => {
    const { runModuleExecution, readModuleExecutionSummary } = await api(), input = await request(['1.02'])
    const original = await runModuleExecution(input, { validateOutputs, analyze: async (context: any) => {
      if (context.module.id === '1.02') throw Error('dependent interrupted')
      const candidate = output(context), claimRefs = candidate.claims.map((c: any) => c.claimId)
      const steps = [1, 2, 3, 4].map(step => ({ step, status: 'limited' as const, summary: '原始证据核验，缺口保留', claimRefs, limitations: ['缺少真实原件'] }))
      const projectTaskAudit = buildProjectTaskAudit({ ...candidate, steps }, context.taskBrief)
      return { ...candidate, execution: { executionId: 'author', childId: 'author-child', actualModel: { provider: 'test', model: 'text' }, stopReason: 'completed', steps, projectTaskAudit,
        reviewReceipts: [{ executionId: 'review', childId: 'review-child', actualModel: { provider: 'test', model: 'review' }, stopReason: 'completed',
          candidateHash: sha256CanonicalJson({ ...candidate, steps }), projectTaskAuditHash: sha256CanonicalJson(projectTaskAudit), checks: getResearchModuleSpec('1.01').qa.map(criterion => ({ criterion, status: 'limited', rationale: '须保留原件缺口' })), limitations: ['缺少真实原件'] }] } }
    } })
    const ancestor = original.moduleRuns.find((r: any) => r.itemId === '1.01')!
    expect(ancestor.status, ancestor.error).toBe('limited')
    const calls: string[] = []
    const resumed = await runModuleExecution({ ...input, moduleIds: scope === 'dependency-only' ? ['1.02'] : ['1.01', '1.02'], resumeRunIds: [original.manifestRunId] }, {
      validateOutputs, analyze: async (context: any) => {
        calls.push(context.module.id)
        if (context.module.id === '1.01') {
          expect(context.resumeExecutionAudit?.reviewReceipts).toEqual(original.results[0].execution!.reviewReceipts)
          throw Error('explicit limited target still needs native revision')
        }
        expect(context.inputRefs[0].bundleRunId).toBe(ancestor.bundleRunId)
        expect(context.inputRefs[0].resultHash).toBe(ancestor.resultHash)
        expect(context.upstream[0]).toEqual(original.results[0])
        return output(context)
      },
    })
    expect(calls).toEqual(scope === 'dependency-only' ? ['1.02'] : ['1.01'])
    expect(resumed.status).toBe('partial')
    if (scope === 'dependency-only') {
      expect(resumed.moduleRuns.find((r: any) => r.itemId === '1.01')).toEqual(ancestor)
      expect((await readModuleExecutionSummary(input.workspaceRoot, resumed.manifestRunId, { validateOutputs })).moduleRuns.find((r: any) => r.itemId === '1.01')?.status).toBe('limited')
    } else expect(resumed.moduleRuns.find((r: any) => r.itemId === '1.02')?.status).toBe('blocked')
  })
  it.each([
    ['difference', 10], ['product', 31.25], ['ratio', 5], ['min', 2.5], ['max', 12.5], ['weighted_mean', 25 / 6],
  ])('replays the finite %s operation without accepting literal invented operands', async (operation, expected) => {
    const { runModuleExecution } = await api(), input = await request()
    const result = await runModuleExecution(input, { validateOutputs, analyze: async (context: any) => {
      const value = output(context)
      for (const claim of value.claims) { claim.value = expected as number; claim.calculation.operation = operation as string
        if (operation === 'weighted_mean') (claim.calculation as any).weights = [{ sourceId: 'additional' }, { sourceId: 'area' }] }
      for (const port of Object.values(value.outputs) as any[]) port.records[0].area = expected
      return value
    } })
    expect(result.status).toBe('completed')
    expect(result.results[0].claims[0].value).toBe(expected)
  })
  it('resolves calculation operands only through the actual selected upstream port and claim', async () => {
    const { runModuleExecution } = await api(), input = await request(['1.02'])
    const result = await runModuleExecution(input, { validateOutputs, analyze: async (context: any) => {
      const value = output(context)
      if (context.module.id === '1.02') {
        const upstream = context.upstream[0]
        for (const claim of value.claims) { claim.value = 37.5; claim.calculation = { operation: 'product', operands: [
          { moduleId: upstream.moduleId, claimId: upstream.claims[0].claimId }, { sourceId: 'additional' },
        ] } as any }
        for (const port of Object.values(value.outputs) as any[]) port.records[0].area = 37.5
      }
      return value
    } })
    expect(result.status).toBe('completed')
    expect(result.results.find((r: any) => r.itemId === '1.02').claims[0].value).toBe(37.5)
    expect(result.results.find((r: any) => r.itemId === '1.02').inputRefs[0].selector).toBe('/outputs/project_brief')
  })
  it('allows qualitative inference from an already verified local claim and retains exhausted native failure receipts', async () => {
    const { runModuleExecution } = await api(), input = await request()
    const success = await runModuleExecution(input, { validateOutputs, analyze: async (context: any) => {
      const value = output(context), port = context.module.ports[0].name
      ;(value.outputs[port].records[0] as any).interpretation = '原始与新增面积合并计算'
      ;(value.claims as any[]).push({ claimId: 'interpretation', kind: 'inference', selector: `/outputs/${port}/records/0/interpretation`, value: '原始与新增面积合并计算', rationale: '加法仅表达两部分合计', inputRefs: [{ moduleId: context.module.moduleId, claimId: value.claims[0].claimId }] })
      value.outputs[port].claimRefs.push('interpretation')
      return value
    } })
    expect(success.status).toBe('completed')
    const failure = await runModuleExecution(input, { validateOutputs, analyze: async () => {
      throw Object.assign(new Error('review attempts exhausted'), { moduleExecutionAudit: { attempts: [{ executionId: 'failed-execution' }], reviewReceipts: [{ childId: 'failed-review', verdict: 'fail' }] } })
    } })
    expect(failure.status).toBe('partial')
    expect(failure.moduleRuns[0].executionAudit.reviewReceipts[0].childId).toBe('failed-review')
  })
  it('reads a verified run summary and refuses omitted completed modules or failed items relabelled completed', async () => {
    const { runModuleExecution, readModuleExecutionSummary } = await api(), input = await request(['1.02'])
    const result = await runModuleExecution(input, { validateOutputs, analyze: async (context: any) => {
      if (context.module.id === '1.02') throw Error('provider failed')
      return output(context)
    } })
    const verified = await readModuleExecutionSummary(input.workspaceRoot, result.manifestRunId, { validateOutputs })
    expect(verified.status).toBe('partial')
    expect(verified.results.map((r: any) => r.itemId)).toEqual(['1.01'])
    const folder = join(input.workspaceRoot, 'research/runs', result.manifestRunId)
    const original = JSON.parse(await readFile(join(folder, 'run.json'), 'utf8'))
    for (const mutation of ['omit', 'status']) {
      const changed = structuredClone(original)
      if (mutation === 'omit') changed.moduleRuns = changed.moduleRuns.filter((r: any) => r.status !== 'completed')
      else changed.status = 'completed'
      const content = JSON.stringify(changed)
      const manifest = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8'))
      const entry = manifest.files.find((f: any) => f.path === 'run.json')
      entry.sha256 = hash(content); entry.sizeBytes = Buffer.byteLength(content)
      const { manifestHash: _old, ...core } = manifest; manifest.manifestHash = sha256CanonicalJson(core)
      await writeFile(join(folder, 'run.json'), content); await writeFile(join(folder, 'manifest.json'), JSON.stringify(manifest))
      await expect(readModuleExecutionSummary(input.workspaceRoot, result.manifestRunId, { validateOutputs })).rejects.toThrow(/MODULE_RUN_(COVERAGE|STATUS)/)
    }
  })
  it('rejects a review receipt bound to a different candidate even if all criterion strings say pass', async () => {
    const { runModuleExecution } = await api(), input = await request()
    const result = await runModuleExecution(input, { analyze: async (context: any) => ({ ...professionalOutput(context), execution: {
      executionId: 'a', childId: 'a', actualModel: { provider: 'test', model: 'text' }, stopReason: 'completed',
      steps: [1, 2, 3, 4].map(step => ({ step, status: 'limited', summary: '已核对', claimRefs: ['name'], limitations: ['原始资料不足'] })),
      reviewReceipts: [{ executionId: 'b', childId: 'b', actualModel: { provider: 'test', model: 'review' }, stopReason: 'completed', candidateHash: '0'.repeat(64),
        checks: getResearchModuleSpec('1.01').qa.map(criterion => ({ criterion, status: 'pass', rationale: '通过' })), limitations: [] }],
    } }) })
    expect(result.status).toBe('partial')
    expect(result.moduleRuns[0].error).toMatch(/REVIEW_CANDIDATE/)
  })
  it('refuses to upgrade a copied historical source quotation into an independently verified fact', async () => {
    const { runModuleExecution } = await api(), input = await request()
    const result = await runModuleExecution(input, { analyze: async (context: any) => {
      const value = professionalOutput(context)
      value.outputs[context.module.ports[0].name].records[0].formalName.claimClass = 'fact'
      return value
    } })
    expect(result.status).toBe('partial')
    expect(result.moduleRuns[0].error).toMatch(/CLAIM_(FACT|CLASS)/)
  })
  it('binds the task brief to snapshot identity without treating that brief as raw source evidence', async () => {
    const { runModuleExecution } = await api(), input = { ...await request(), taskBrief: '生态文旅策划试验，保留未核实条件' }
    const result = await runModuleExecution(input, { validateOutputs, analyze: async (context: any) => {
      expect(context.taskBrief).toBe(input.taskBrief)
      expect(context.corpus.documents).toHaveLength(1)
      return output(context)
    } })
    expect(result.status).toBe('completed')
    await expect(runModuleExecution({ ...input, taskBrief: '仅水库管理任务', resumeRunIds: [result.manifestRunId] }, { validateOutputs, analyze: async () => { throw Error('must not run') } })).rejects.toThrow('MODULE_SNAPSHOT_IDENTITY_MISMATCH')
  })
  it('restores the exact persisted ancestor bundle while redoing a dependent boundary without a current review', async () => {
    const { runModuleExecution, readModuleExecutionSummary } = await api(), input = await request(['1.02'])
    const original = await runModuleExecution(input, { validateOutputs, analyze: async (context: any) => output(context) })
    const leaf = original.moduleRuns.find((row: any) => row.itemId === '1.02')
    const calls: string[] = []
    const resumed = await runModuleExecution({ ...input, resumeRunIds: [leaf.bundleRunId] }, { validateOutputs, analyze: async (context: any) => {
      calls.push(context.module.id)
      return output(context)
    } })
    expect(resumed.status).toBe('completed')
    expect(calls).toEqual(['1.02'])
    expect(resumed.moduleRuns.find((row: any) => row.itemId === '1.02').bundleRunId).not.toBe(leaf.bundleRunId)
    expect(resumed.moduleRuns.find((row: any) => row.itemId === '1.01').bundleRunId).toBe(original.moduleRuns.find((row: any) => row.itemId === '1.01').bundleRunId)
    expect((await readModuleExecutionSummary(input.workspaceRoot, resumed.manifestRunId, { validateOutputs })).results).toHaveLength(2)
  })
  it('preserves a committed module when an optional progress notification fails', async () => {
    const { runModuleExecution, readModuleExecutionSummary } = await api(), input = await request()
    const result = await runModuleExecution(input, { validateOutputs, analyze: async (context: any) => output(context),
      onProgress: async () => { throw Error('UI unavailable') } })
    expect(result.moduleRuns).toHaveLength(1)
    expect(result.status).toBe('completed')
    expect(result.limitations.some((l: string) => l.includes('PROGRESS_NOTIFICATION'))).toBe(true)
    expect((await readModuleExecutionSummary(input.workspaceRoot, result.manifestRunId, { validateOutputs })).results).toHaveLength(1)
  })
})

function reviewedLimited(context: any) {
  const candidate = output(context), claimRefs = candidate.claims.map((c: any) => c.claimId)
  const steps = [1,2,3,4].map(step => ({step,status:'limited' as const,summary:'真实证据缺口',claimRefs,limitations:['待补来源']}))
  const projectTaskAudit = buildProjectTaskAudit({ ...candidate, steps }, context.taskBrief)
  return {...candidate,execution:{executionId:'old-author',childId:'old-author-child',actualModel:{provider:'test',model:'text'},stopReason:'completed',steps, projectTaskAudit,
    reviewReceipts:[{executionId:'old-review',childId:'old-review-child',actualModel:{provider:'test',model:'review'},stopReason:'completed',
      candidateHash:sha256CanonicalJson({...candidate,steps}),projectTaskAuditHash:sha256CanonicalJson(projectTaskAudit),checks:getResearchModuleSpec(context.module.id).qa.map(criterion=>({criterion,status:'limited',rationale:'修订实际来源缺口'})),limitations:['待补来源']}]}}
}
async function withWebSource(key: string) {
  const {materialCorpusFingerprint} = await import('../src/materials/research-evidence.ts')
  const sourceText = '新检索来源'
  const doc = {path:'research/runs/RUN-source/网页.txt',text:sourceText,contentHash:hash(sourceText),byteLength:Buffer.byteLength(sourceText),
    provenance:{queryKeys:[key],sourceUri:'https://example.gov.cn/source',rawHash:hash(sourceText),retrievedAt:'2026-10-08T00:00:00Z',claimClass:'source_conclusion' as const}}
  const next = {...corpus,documents:[...documents,doc]}
  return {...next,fingerprint:materialCorpusFingerprint(next)}
}
describe('explicit cross-snapshot input migration replay',()=>{
  it.each(['coordinator-and-leaf','leaf-only'])('binds frozen ancestor proofs during mixed coordinator and leaf recovery (%s)',async mode=>{
    const {runModuleExecution,readModuleExecutionSummary}=await api(),input=await request(['1.03'])
    const old=await runModuleExecution(input,{validateOutputs,analyze:async(context:any)=>{
      if(context.module.id==='1.03')throw Error('dependent interrupted')
      return context.module.id==='1.01'?reviewedLimited(context):output(context)
    }})
    const nextInput={...input,snapshotId:'snapshot-2',corpus:await withWebSource('1.02:0')}
    const frozen=await runModuleExecution({...nextInput,allowInputReuse:true,resumeRunIds:[old.manifestRunId]}, {
      validateOutputs,analyze:async(context:any)=>output(context),
    })
    const ancestor=frozen.moduleRuns.find((row:any)=>row.itemId==='1.01')!
    expect(ancestor.reuseProof).toMatchObject({fromSnapshotId:'snapshot-1',toSnapshotId:'snapshot-2'})
    const ancestorPath=join(input.workspaceRoot,'research/runs',ancestor.bundleRunId!,'result.json'),before=await readFile(ancestorPath,'utf8')
    const leaf=frozen.moduleRuns.find((row:any)=>row.itemId==='1.03')!,calls:string[]=[]
    const continuation=runModuleExecution({...nextInput,resumeRunIds:mode==='coordinator-and-leaf'?[frozen.manifestRunId,leaf.bundleRunId!]:[leaf.bundleRunId!]}, {
      validateOutputs,analyze:async(context:any)=>{calls.push(context.module.id);return output(context)},
    })
    if(mode==='leaf-only'){
      await expect(continuation).rejects.toThrow('MODULE_INPUT_REUSE_PROOF_INVALID')
      expect(calls).toEqual([])
    }else{
      const resumed=await continuation
      expect(calls).toEqual(['1.02','1.03'])
      expect(resumed.moduleRuns.find((row:any)=>row.itemId==='1.01')).toMatchObject({bundleRunId:ancestor.bundleRunId,status:'limited',reuseProof:ancestor.reuseProof})
      expect((await readModuleExecutionSummary(input.workspaceRoot,resumed.manifestRunId,{validateOutputs})).results).toHaveLength(3)
    }
    expect(await readFile(ancestorPath,'utf8')).toBe(before)
  })
  it('resumes a failed dependent from a frozen coordinator whose verified ancestors span snapshots',async()=>{
    const {runModuleExecution,readModuleExecutionSummary}=await api(),input=await request(['1.03'])
    const old=await runModuleExecution(input,{validateOutputs,analyze:async(context:any)=>{
      if(context.module.id==='1.03')throw Error('original dependent interrupted')
      return context.module.id==='1.01'?reviewedLimited(context):output(context)
    }})
    const nextInput={...input,snapshotId:'snapshot-2',corpus:await withWebSource('1.02:0')}
    const audit={attempts:[{classId:'text',groupId:'fixture:1',status:'completed'}],reviewReceipts:[]}
    const message='MODULE_SOURCE_VALUE_TEXT: fix the original quotation'
    const migrated=await runModuleExecution({...nextInput,allowInputReuse:true,resumeRunIds:[old.manifestRunId]}, {
      validateOutputs,analyze:async(context:any)=>{
        if(context.module.id==='1.03')throw Object.assign(new Error(message),{moduleExecutionAudit:audit})
        return context.module.id==='1.01'?reviewedLimited(context):output(context)
      },
    })
    expect(migrated.moduleRuns.map((row:any)=>[row.itemId,row.status])).toEqual([['1.01','limited'],['1.02','completed'],['1.03','failed']])
    expect(migrated.results.map((row:any)=>row.snapshotId)).toEqual(['snapshot-1','snapshot-2'])
    const original=await readModuleExecutionSummary(input.workspaceRoot,migrated.manifestRunId,{validateOutputs})
    const calls:string[]=[]
    const continued=await runModuleExecution({...nextInput,resumeRunIds:[migrated.manifestRunId]}, {
      validateOutputs,analyze:async(context:ModuleAnalysisContext)=>{
        calls.push(context.module.id)
        if(context.module.id==='1.03'){
          // A boundary without the current native audit must be redone. Its
          // new identity invalidates the failed dependent's author prefix.
          expect(context.resumeExecutionAudit).toBeUndefined()
          expect(context.resumeExecutionError).toBeUndefined()
          expect(context.inputRefs[0].reuseProof).toMatchObject({fromSnapshotId:'snapshot-1',toSnapshotId:'snapshot-2'})
          expect(context.upstream.map(row=>row.snapshotId)).toEqual(['snapshot-1','snapshot-2'])
        }
        return output(context)
      },
    })
    expect(calls).toEqual(['1.02','1.03'])
    expect(continued.moduleRuns.find((row:any)=>row.itemId==='1.03').status).toBe('completed')
    expect(await readModuleExecutionSummary(input.workspaceRoot,migrated.manifestRunId,{validateOutputs})).toEqual(original)
  })
  it('preserves an unrelated original bundle and receipt and replays the new dependency proof',async()=>{
    const {runModuleExecution,readModuleExecutionSummary}=await api(),input=await request(['1.02'])
    const old=await runModuleExecution(input,{validateOutputs,analyze:async(context:any)=>{
      if(context.module.id==='1.02')throw Error('interrupted dependent')
      return reviewedLimited(context)
    }})
    const ancestor=old.moduleRuns.find((r:any)=>r.itemId==='1.01')!,before=await readFile(join(input.workspaceRoot,'research/runs',ancestor.bundleRunId,'result.json'),'utf8')
    const calls:string[]=[]
    const next=await runModuleExecution({...input,snapshotId:'snapshot-2',corpus:await withWebSource('3.04:2'),allowInputReuse:true,resumeRunIds:[old.manifestRunId]},{validateOutputs,analyze:async(context:any)=>{
      calls.push(context.module.id)
      expect(context.inputRefs[0].reuseProof.fromSnapshotId).toBe('snapshot-1')
      expect(context.upstream[0].execution.childId).toBe('old-author-child')
      expect(context.upstream[0].snapshotId).toBe('snapshot-1')
      return output(context)
    }})
    expect(calls).toEqual(['1.02'])
    expect(next.moduleRuns.find((r:any)=>r.itemId==='1.01')).toMatchObject({...ancestor,reuseProof:{version:'module-input-reuse.v1',fromSnapshotId:'snapshot-1',toSnapshotId:'snapshot-2'}})
    const replay=await readModuleExecutionSummary(input.workspaceRoot,next.manifestRunId,{validateOutputs})
    expect(replay.moduleRuns).toEqual(next.moduleRuns)
    const continuedCalls:string[]=[]
    const continued=await runModuleExecution({...input,snapshotId:'snapshot-2',corpus:await withWebSource('3.04:2'),resumeRunIds:[next.manifestRunId]},{validateOutputs,analyze:async(context:any)=>{continuedCalls.push(context.module.id);return output(context)}})
    expect(continuedCalls).toEqual(['1.02']);expect(continued.moduleRuns.find((r:any)=>r.itemId==='1.01').bundleRunId).toBe(ancestor.bundleRunId)
    expect(await readFile(join(input.workspaceRoot,'research/runs',ancestor.bundleRunId,'result.json'),'utf8')).toBe(before)
    const folder=join(input.workspaceRoot,'research/runs',next.manifestRunId)
    const raw=JSON.parse(await readFile(join(folder,'run.json'),'utf8'));raw.moduleRuns.find((r:any)=>r.itemId==='1.01').reuseProof.inputFingerprint='0'.repeat(64)
    const content=JSON.stringify(raw),manifest=JSON.parse(await readFile(join(folder,'manifest.json'),'utf8'))
    const entry=manifest.files.find((f:any)=>f.path==='run.json');entry.sha256=hash(content);entry.sizeBytes=Buffer.byteLength(content)
    const {manifestHash:_old,...core}=manifest;manifest.manifestHash=sha256CanonicalJson(core)
    await writeFile(join(folder,'run.json'),content);await writeFile(join(folder,'manifest.json'),JSON.stringify(manifest))
    await expect(readModuleExecutionSummary(input.workspaceRoot,next.manifestRunId,{validateOutputs})).rejects.toThrow('MODULE_INPUT_REUSE_PROOF_INVALID')
  })
  it('reexecutes the affected ancestor and its downstream under the new snapshot',async()=>{
    const {runModuleExecution}=await api(),input=await request(['1.02'])
    const old=await runModuleExecution(input,{validateOutputs,analyze:async(context:any)=>context.module.id==='1.01'?reviewedLimited(context):output(context)})
    const calls:string[]=[]
    const next=await runModuleExecution({...input,snapshotId:'snapshot-2',corpus:await withWebSource('1.01:0'),allowInputReuse:true,resumeRunIds:[old.manifestRunId]},{validateOutputs,analyze:async(context:any)=>{calls.push(context.module.id);return context.module.id==='1.01'?reviewedLimited(context):output(context)}})
    expect(calls).toEqual(['1.01','1.02'])
    expect(next.results.every((r:any)=>r.snapshotId==='snapshot-2')).toBe(true)
    expect(next.results.every((r:any)=>!old.results.some((p:any)=>p.runId===r.runId))).toBe(true)
  })
  it('passes the old independent problems as diagnostics across changed inputs without reusing authors',async()=>{
    const {runModuleExecution}=await api(),input=await request()
    const old=await runModuleExecution(input,{validateOutputs,analyze:async(context:any)=>reviewedLimited(context)})
    let feedback:any
    await runModuleExecution({...input,snapshotId:'snapshot-2',corpus:await withWebSource('1.01:0'),allowInputReuse:true,resumeRunIds:[old.manifestRunId]},{validateOutputs,analyze:async(context:any)=>{
      expect(context.resumeExecutionAudit).toBeUndefined();feedback=context.priorModuleReview;return reviewedLimited(context)
    }})
    expect(feedback).toMatchObject({snapshotId:'snapshot-1',bundleRunId:old.moduleRuns[0].bundleRunId,reviewReceipts:old.results[0].execution!.reviewReceipts})
  })
})
