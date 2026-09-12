import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { ResearchRegistry } from '../src/research/registry.ts'

const roots: string[] = []
const researchRoot = new URL('../research/v2.0.1/', import.meta.url)

async function tempResearchRoot(catalog: unknown, workflows: unknown): Promise<URL> {
  const root = await mkdtemp(join(tmpdir(), 'pre-design-research-registry-'))
  roots.push(root)
  const schemas = join(root, 'schemas')
  await mkdir(schemas, { recursive: true })
  for (const name of [
    'data-source-catalog.schema.json',
    'workflow-research-spec.schema.json',
    'evidence-record.schema.json',
    'analysis-trace.schema.json',
  ]) {
    await writeFile(join(schemas, name), await readFile(new URL(`schemas/${name}`, researchRoot)))
  }
  await writeFile(join(root, 'data-sources.json'), `${JSON.stringify(catalog, null, 2)}\n`)
  await writeFile(join(root, 'workflow-research-specs.json'), `${JSON.stringify(workflows, null, 2)}\n`)
  return pathToFileURL(`${root}/`)
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('Pre 2.0.1 ResearchRegistry', () => {
  it('loads authoritative sources and pilot workflow research plans', async () => {
    const registry = await ResearchRegistry.open(researchRoot)
    expect(registry.source('cn-nbs')).toMatchObject({
      priority: 'P1',
      reliabilityGrade: 'A',
      allowedDomains: ['stats.gov.cn'],
    })
    expect(registry.source('cn-standards').allowedDomains).toContain('std.samr.gov.cn')

    const policy = registry.workflow('preplan.wf.02.01')
    expect(policy.preferredSources.map(source => source.sourceId)).toEqual(expect.arrayContaining([
      'workspace-project-files', 'cn-gov-policy', 'cn-mnr', 'cn-mohurd', 'cn-standards',
    ]))
    expect(policy.minimumEvidence.highRiskRequiresGradeA).toBe(true)

    const cost = registry.workflow('preplan.wf.08.02')
    expect(cost.fallbackPolicy).toContain('不得由 LLM 补写金额')
    expect(cost.aggregationMethod.deterministic).toBe(true)
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
        optionalDataPoints: [],
        preferredSources: [{ sourceId: 'missing-source', purpose: '不存在的来源', required: true }],
        queryTemplates: [], extractionRules: ['提取正式名称'], normalizationRules: ['统一名称'],
        aggregationMethod: { methodId: 'identity-merge', version: '1', description: '同名归并', deterministic: true },
        analysisMethod: { methodId: 'identity-review', version: '1', description: '身份研判', deterministic: false },
        crossCheckRules: ['正式文件优先'], freshnessRules: ['使用最新版本'],
        minimumEvidence: { minHighAuthority: 1, minIndependentSources: 1, highRiskRequiresGradeA: false },
        fallbackPolicy: '缺失则 unknown', outputClaims: ['项目身份'],
      }],
    })
    await expect(ResearchRegistry.open(root)).rejects.toThrow(/missing-source/)
  })

  it('validates EvidenceRecord and forbids inference-only facts', async () => {
    const registry = await ResearchRegistry.open(researchRoot)
    const valid = registry.validateEvidenceRecord({
      evidenceId: 'ev-1', sourceId: 'cn-nbs', sourceType: 'web_page', sourceUri: 'https://www.stats.gov.cn/',
      sourceTitle: '国家统计局', publisher: '国家统计局', publishedAt: null, capturedAt: '2026-09-12T00:00:00.000Z',
      asOf: null, locator: { section: '数据查询' }, rawValue: 100, normalizedValue: 100, unit: '人',
      contentHash: 'a'.repeat(64), reliability: 'A', claimClass: 'fact', notes: '测试证据',
    })
    expect(valid.valid).toBe(true)

    const invalid = registry.validateEvidenceRecord({
      evidenceId: 'ev-2', sourceId: 'llm-inference', sourceType: 'manual_import', sourceUri: 'inference://model',
      sourceTitle: '模型推断', publisher: 'LLM', publishedAt: null, capturedAt: '2026-09-12T00:00:00.000Z',
      asOf: null, locator: {}, rawValue: '推测', normalizedValue: '推测', unit: null,
      contentHash: 'b'.repeat(64), reliability: 'inference', claimClass: 'fact', notes: '',
    })
    expect(invalid.valid).toBe(false)
    expect(invalid.errors.join(' ')).toMatch(/inference.*fact/i)
  })

  it('validates a reproducible AnalysisTrace', async () => {
    const registry = await ResearchRegistry.open(researchRoot)
    const validation = registry.validateAnalysisTrace({
      traceId: 'trace-1', workflowId: 'preplan.wf.08.02', claimId: 'capex-total',
      inputEvidenceIds: ['quantity-1', 'rate-1'], inputObjectIds: ['IM01', 'SP06'],
      methodId: 'quantity-times-rate', methodVersion: '1.0.0', parameters: { taxIncluded: true },
      calculationSteps: [{ step: 1, description: '工程量乘以含税单价', inputEvidenceIds: ['quantity-1', 'rate-1'], output: 5200000 }],
      outputValue: 5200000, confidence: 0.91, limitations: ['未含融资成本'],
    })
    expect(validation.valid).toBe(true)
  })
})
