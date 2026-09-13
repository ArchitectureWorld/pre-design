import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ResearchRegistry } from '../src/research/registry.ts'

const researchRoot = new URL('../research/v2.0.1/', import.meta.url)
const tempRoots: string[] = []

async function tempResearchRoot(catalog: unknown, workflows: unknown): Promise<URL> {
  const root = await mkdtemp(join(tmpdir(), 'pre-research-registry-'))
  tempRoots.push(root)
  await cp(new URL('../research/v2.0.1/schemas/', import.meta.url), join(root, 'schemas'), { recursive: true })
  await writeFile(join(root, 'data-sources.json'), JSON.stringify(catalog, null, 2))
  await writeFile(join(root, 'workflow-research-specs.json'), JSON.stringify(workflows, null, 2))
  return new URL(`file://${root.replaceAll('\\', '/')}/`)
}

afterEach(async () => {
  for (const root of tempRoots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('Pre 2.0.1 ResearchRegistry', () => {
  it('loads authoritative sources and all available research spec documents', async () => {
    const registry = await ResearchRegistry.open(researchRoot)
    expect(registry.sourceIds()).toEqual(expect.arrayContaining([
      'workspace-project-files', 'cn-nbs', 'cn-gov-policy', 'cn-mohurd', 'cn-mnr', 'cn-standards', 'cn-cma', 'cn-gsxt',
    ]))
    expect(registry.workflowIds()).toEqual(expect.arrayContaining([
      'preplan.wf.01.01', 'preplan.wf.01.02', 'preplan.wf.01.07', 'preplan.wf.02.01', 'preplan.wf.08.02',
    ]))
    expect(registry.workflowIds().length).toBe(9)
    expect(registry.source('cn-nbs')).toMatchObject({ priority: 'P1', reliabilityGrade: 'A' })
    expect(registry.workflow('preplan.wf.08.02').aggregationMethod.deterministic).toBe(true)
    for (const workflowId of registry.workflowIds()) {
      expect(registry.workflow(workflowId).researchSteps.length, workflowId).toBeGreaterThan(0)
    }
  })

  it('requires an explicit ordered Workflow -> ResearchStep -> DataPoint -> Source chain', async () => {
    const registry = await ResearchRegistry.open(researchRoot)
    const sourceIds = new Set(registry.sourceIds())
    for (const workflowId of registry.workflowIds()) {
      const spec = registry.workflow(workflowId)
      const dataPointIds = new Set([...spec.requiredDataPoints, ...spec.optionalDataPoints].map(row => row.dataPointId))
      const stepIds = new Set(spec.researchSteps.map(row => row.stepId))
      expect(stepIds.size, workflowId).toBe(spec.researchSteps.length)
      expect(spec.researchSteps.map(row => row.order), workflowId)
        .toEqual([...spec.researchSteps].sort((left, right) => left.order - right.order).map(row => row.order))
      for (const step of spec.researchSteps) {
        for (const dependencyId of step.dependsOnStepIds) expect(stepIds.has(dependencyId), `${workflowId}:${step.stepId}:${dependencyId}`).toBe(true)
        for (const dataPointId of step.dataPointIds) expect(dataPointIds.has(dataPointId), `${workflowId}:${step.stepId}:${dataPointId}`).toBe(true)
        for (const sourceId of step.sourceIds) expect(sourceIds.has(sourceId)).toBe(true)
      }
    }
  })

  it('rejects workflow source references that are absent from the catalog', async () => {
    const root = await tempResearchRoot({
      schemaVersion: '2.0.1',
      sources: [{
        sourceId: 'workspace-project-files', name: '项目正式资料', publisher: '项目方', priority: 'P0',
        authorityLevel: 'project_official', homepage: null, allowedDomains: [], accessModes: ['workspace_file'],
        supportedDataKinds: ['project_document'], freshnessPolicy: { maxAgeDays: null, refreshOnProjectStart: true, notes: '按项目版本复核' },
        reliabilityGrade: 'A', notes: '项目正式资料。',
      }],
    }, {
      schemaVersion: '2.0.1',
      workflows: [{
        workflowId: 'preplan.wf.01.01',
        requiredDataPoints: [{ dataPointId: 'project-name', label: '项目名称', dataKind: 'project_identity', description: '项目正式名称', unit: null }],
        optionalDataPoints: [], preferredSources: [{ sourceId: 'missing-source', purpose: '不存在的来源', required: true }],
        queryTemplates: [], extractionRules: ['提取正式名称'], normalizationRules: ['统一名称'],
        researchSteps: [{ stepId: '01-01-S01', order: 1, title: '读取资料', dependsOnStepIds: [], dataPointIds: ['project-name'], sourceIds: ['missing-source'], action: 'workspace_extract', produces: 'evidence' }],
        aggregationMethod: { methodId: 'identity-merge', version: '1', description: '同名归并', deterministic: true },
        analysisMethod: { methodId: 'identity-review', version: '1', description: '身份研判', deterministic: false },
        crossCheckRules: ['正式文件优先'], freshnessRules: ['使用最新版本'],
        minimumEvidence: { minHighAuthority: 1, minIndependentSources: 1, highRiskRequiresGradeA: false }, fallbackPolicy: '缺失则 unknown', outputClaims: ['项目身份'],
      }],
    })
    await expect(ResearchRegistry.open(root)).rejects.toThrow(/missing-source/)
  })

  it('validates EvidenceRecord and forbids inference-only facts', async () => {
    const registry = await ResearchRegistry.open(researchRoot)
    const valid = registry.validateEvidenceRecord({
      evidenceId: 'ev-1', workflowId: 'preplan.wf.02.01', dataPointId: 'applicable-policies', sourceId: 'cn-gov-policy',
      sourceType: 'web_page', sourceUri: 'https://www.gov.cn/zhengce/', sourceTitle: '中国政府网政策文件库',
      publisher: '中华人民共和国中央人民政府', publishedAt: null, capturedAt: '2026-09-12T00:00:00.000Z', asOf: null,
      locator: { section: '政策' }, rawValue: '政策原文', normalizedValue: '政策原文', unit: null,
      contentHash: 'a'.repeat(64), reliability: 'A', claimClass: 'fact', notes: '测试证据',
    })
    expect(valid.valid).toBe(true)
    const invalid = registry.validateEvidenceRecord({
      evidenceId: 'ev-2', workflowId: 'preplan.wf.01.01', dataPointId: 'project-trigger', sourceId: 'llm-inference',
      sourceType: 'model_output', sourceUri: 'model://pre-design/current-run', sourceTitle: '模型推断', publisher: 'LLM', publishedAt: null,
      capturedAt: '2026-09-12T00:00:00.000Z', asOf: null, locator: {}, rawValue: '推测', normalizedValue: '推测', unit: null,
      contentHash: 'b'.repeat(64), reliability: 'inference', claimClass: 'fact', notes: '',
    })
    expect(invalid.valid).toBe(false)
    expect(invalid.errors.join(' ')).toMatch(/inference.*fact/i)
  })

  it('validates a reproducible AnalysisTrace', async () => {
    const registry = await ResearchRegistry.open(researchRoot)
    expect(registry.validateAnalysisTrace({
      traceId: 'trace-1', workflowId: 'preplan.wf.08.02', claimId: 'capex-total', inputEvidenceIds: ['quantity-1', 'rate-1'],
      inputObjectIds: ['IM01', 'SP06'], methodId: 'quantity-times-rate', methodVersion: '1.0.0', parameters: { taxIncluded: true },
      calculationSteps: [{ step: 1, description: '工程量乘以含税单价', inputEvidenceIds: ['quantity-1', 'rate-1'], output: 5200000 }],
      outputValue: 5200000, confidence: 0.91, limitations: ['未含融资成本'],
    }).valid).toBe(true)
  })
})
