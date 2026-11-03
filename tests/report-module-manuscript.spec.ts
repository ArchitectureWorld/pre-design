import { describe, expect, it } from 'vitest'
import { makeSourceIndex, manuscriptSourceFingerprint } from '../src/report/manuscript/source.ts'
import { planningChapterSources, buildPlanningChapterPrompt } from '../src/report/manuscript/prompts.ts'
import { getModuleFieldContracts } from '../src/research-v2/module-contracts.ts'
import { loadPlanningCatalog } from '../src/research-v2/catalog.ts'
import { getModuleAuthorFieldGroups } from '../src/research-v2/module-author-groups.ts'
import type { FrozenProjectInput } from '../src/report/types.ts'

function input() {
  const contract = getModuleFieldContracts('5.06'), [port, definition] = Object.entries(contract.ports)[0]
  const field = definition.fields.find(field => field.kind === 'text')!
  const selector = `/outputs/${port}/records/0/${field.name}/value`
  const result = { projectId: 'p', snapshotId: 'snapshot', runId: 'run', itemId: '5.06', moduleId: contract.moduleId, methodVersion: 'planning-modules-62.v1', lifecycle: 'current',
    outputs: { [port]: { records: [{ recordId: 'record', ...Object.fromEntries(definition.fields.map(f => [f.name, { value: null, claimRefs: [], claimClass: 'missing', limitations: ['原件缺失'] }])),
      [field.name]: { value: '河畔观察课堂', claimRefs: ['claim'], claimClass: 'source_conclusion', limitations: ['原件提出的拟议产品，尚未运营'] } }], limitations: ['拟议产品'] } },
    claims: [{ claimId: 'claim', selector, kind: 'source', value: '河畔观察课堂', sourceId: 's' }],
    sourceValues: [{ sourceId: 's', path: '原始资料/产品.txt', contentHash: 'a'.repeat(64), quote: '计划开展河畔观察课堂。', rawValue: '河畔观察课堂' }],
    limitations: ['仅资料记载'], inputRefs: [], qualityChecks: [],
    execution: { executionId: 'author', childId: 'author-child', actualModel: { provider: 'test', model: 'test' }, stopReason: 'completed' } }
  const moduleResearch = { selectionId: 'selection', manifestRunId: 'manifest', snapshotId: 'snapshot', snapshotHash: 'b'.repeat(64), catalogHash: 'catalog', planHash: 'plan', corpusFingerprint: 'corpus',
    taskBrief: '用户拟议生态研学', expectedModuleIds: ['5.06'], results: [result], moduleRuns: [{ itemId: '5.06', status: 'completed', bundleRunId: 'bundle', resultHash: 'c'.repeat(64) }], limitations: [], fingerprint: 'fingerprint' }
  const frozen = { projectId: 'p', projectName: '少潭河', revision: 3, generatedAt: '2026-09-27', recommendation: '研学体验', decisionItems: [], gates: [], visualAssets: [],
    stateObjects: [{ objectId: 'PG04', chapterId: '06', title: '旧产品', summary: '旧产品', facts: [], reportSections: [{ key: 'products', title: '产品', entries: [{ key: 'a', fieldPath: 'data.products[0]', text: '既有的旧产品素材', basis: '旧状态' }] }] }], moduleResearch }
  return { frozen: frozen as unknown as FrozenProjectInput, moduleResearch, selector, field: field.name }
}

function peerGroupInput(version: 'module-author-field-group.v8' | 'module-author-field-group.v16') {
  const { frozen, moduleResearch } = input(), contract = getModuleFieldContracts('3.05')
  const result = moduleResearch.results[0] as any, fieldNames = contract.ports.peer_products.fields.map(field => field.name)
  const records = ['peer-a', 'peer-b', 'peer-c', 'peer-d'].map((recordId, index) => ({ recordId, resultClass: 'observation_summary',
    ...Object.fromEntries(fieldNames.map(field => [field, { value: null, claimRefs: [], claimClass: 'missing', limitations: ['原件未记载'] }])),
    coreProduct: { value: `案例产品${index}`, claimRefs: [`claim-${index}`], claimClass: 'source_conclusion', limitations: ['案例原文'] },
  }))
  const rawGroup = (group: ReturnType<typeof getModuleAuthorFieldGroups>[number]) => ({ projectionVersion: version, groupId: group.groupId,
    outputs: { peer_products: { type: contract.ports.peer_products.type, quality: 'limited', scope: '四个案例产品', asOf: '2026-10-13', limitations: [],
      records: records.filter(record => !group.recordIds || group.recordIds.includes(record.recordId)).map(record => ({
        recordId: record.recordId, resultClass: record.resultClass, ...Object.fromEntries(group.fields.map(field => [field, (record as any)[field]])),
      })) } },
    evidence: group.fields.includes('coreProduct') ? records.filter(record => !group.recordIds || group.recordIds.includes(record.recordId)).map(record => ({
      kind: 'source', target: { port: 'peer_products', recordId: record.recordId, field: 'coreProduct', at: '' }, source: { path: '案例.txt', quote: record.coreProduct.value },
    })) : [], limitations: [], stepResults: Object.fromEntries([1, 2, 3, 4].map(step => [`step${step}`, {
      status: 'limited', summary: '原文中的案例产品', fieldRefs: [], limitations: ['其余字段待研究'],
    }])),
  })
  const anchor = rawGroup(getModuleAuthorFieldGroups('3.05', version)[0])
  const groups = getModuleAuthorFieldGroups('3.05', version, [anchor] as any).map(group => ({ raw: rawGroup(group),
    receipt: { executionId: `author-${group.groupId}`, childId: `child-${group.groupId}`, actualModel: { provider: 'test', model: 'test' }, stopReason: 'completed' },
    projectionHash: `projection-${group.groupId}`, outputsJsonHash: `outputs-${group.groupId}`,
  }))
  Object.assign(result, { itemId: '3.05', moduleId: contract.moduleId, outputs: { peer_products: { records, limitations: [] } },
    claims: records.map((record, index) => ({ claimId: `claim-${index}`, selector: `/outputs/peer_products/records/${index}/coreProduct/value`,
      kind: 'source', value: record.coreProduct.value, sourceId: `s-${index}` })),
    sourceValues: records.map((record, index) => ({ sourceId: `s-${index}`, path: '案例.txt', contentHash: 'a'.repeat(64), quote: record.coreProduct.value, rawValue: record.coreProduct.value })),
    execution: { ...result.execution, kind: 'author-field-groups-v3', authorGroups: { version, groups } },
  })
  moduleResearch.expectedModuleIds = ['3.05']; moduleResearch.moduleRuns[0].itemId = '3.05'
  return { frozen, groups }
}
describe('module business fields in planning manuscript sources', () => {
  it.each([
    ['module-author-field-group.v16', 'peer_products:1.2.1', 'peer_products:1.2.2', 'peer_products:2.1.1', 'peer_products:2.1.2'],
    ['module-author-field-group.v8', 'peer_products:1', 'peer_products:1', 'peer_products:2', 'peer_products:2'],
  ] as const)('uses the saved %s plan and each record owner for source and missing fields', (version, firstOwner, secondOwner, firstProductOwner, secondProductOwner) => {
    const { frozen } = peerGroupInput(version), before = structuredClone(frozen), sources = makeSourceIndex(frozen)
    for (const [recordId, positionOwner, productOwner] of [['peer-a', firstOwner, firstProductOwner], ['peer-c', secondOwner, secondProductOwner]]) {
      for (const [fieldName, owner] of [['coreProduct', productOwner], ['positioningQuote', positionOwner]]) {
        const lineage = sources.find(source => source.moduleLineage?.recordId === recordId && source.moduleLineage.fieldName === fieldName)!.moduleLineage!
        expect(lineage.nativeEvidence).toHaveLength(1)
        expect(lineage.nativeEvidence[0].receipt.executionId).toBe(`author-${owner}`)
        expect(lineage.nativeEvidence[0].projectionHash).toBe(`projection-${owner}`)
        if (fieldName === 'coreProduct') expect(lineage.nativeEvidence[0].evidence).toMatchObject({ target: { recordId, field: fieldName } })
        else expect(lineage.sources).toEqual([])
      }
    }
    expect(frozen).toEqual(before)
  })
  it('rejects an absent record-part author instead of borrowing another record owner', () => {
    const { frozen, groups } = peerGroupInput('module-author-field-group.v16')
    groups.splice(groups.findIndex(group => group.raw.groupId === 'peer_products:1.2.2'), 1)
    expect(() => makeSourceIndex(frozen)).toThrow(/REPORT_MODULE_FIELD_LINEAGE/)
  })
  it('includes new fields beside legacy sources and selects them in the correct chapter with exact lineage', () => {
    const { frozen, selector } = input(), sources = makeSourceIndex(frozen)
    const source = sources.find(row => row.text.includes('河畔观察课堂')) as any
    expect(source).toBeDefined()
    expect(source.moduleLineage.selector).toBe(selector)
    expect(source.moduleLineage.sources[0].source.contentHash).toBe('a'.repeat(64))
    expect(source.moduleLineage.sources[0].source.quote).toBe('计划开展河畔观察课堂。')
    expect(source.moduleLineage.nativeEvidence[0].receipt.executionId).toBe('author')
    expect(source.basis).toContain('尚未运营')
    expect(planningChapterSources('products', sources)).toContain(source)
    const prompt = buildPlanningChapterPrompt(frozen, 'products', sources)
    expect(prompt).toContain(source.id)
    expect(prompt).toContain('source_conclusion')
    expect(prompt).not.toContain('"executionId":"author"')
  })
  it('invalidates the manuscript identity when module evidence changes without changing the legacy revision', () => {
    const { frozen, moduleResearch } = input(), first = manuscriptSourceFingerprint(frozen)
    moduleResearch.moduleRuns[0].resultHash = 'd'.repeat(64)
    expect(manuscriptSourceFingerprint(frozen)).not.toBe(first)
  })
  it('keeps missing values as limitations and does not fabricate source evidence', () => {
    const { frozen } = input(), sources = makeSourceIndex(frozen) as any[]
    const missing = sources.find(row => row.moduleLineage?.claimClass === 'missing')
    expect(missing).toBeDefined()
    expect(missing.moduleLineage.sources).toEqual([])
    expect(missing.basis).toContain('原件缺失')
  })
  it('retains the responsible native group receipt for fields explicitly authored as missing', () => {
    const { frozen, moduleResearch } = input(), result = moduleResearch.results[0] as any
    const receipt = result.execution
    result.execution = { ...receipt, kind: 'author-field-groups-v3', authorGroups: { groups: getModuleAuthorFieldGroups('5.06').map(group => ({
      raw: { groupId: group.groupId, evidence: [] }, receipt, projectionHash: `projection-${group.groupId}`, outputsJsonHash: 'raw-text-hash',
    })) } }
    const source = makeSourceIndex(frozen).find(row => row.moduleLineage?.claimClass === 'missing')!
    expect(source.moduleLineage!.nativeEvidence).toHaveLength(1)
    expect(source.moduleLineage!.nativeEvidence[0].receipt.executionId).toBe('author')
  })
  it('resolves upstream claim names in their own module and retains the upstream native evidence association', () => {
    const { frozen, moduleResearch } = input()
    const downstream = moduleResearch.results[0] as any
    const contract = getModuleFieldContracts('1.01'), [port, definition] = Object.entries(contract.ports)[0]
    const field = definition.fields.find(f => f.kind === 'text')!
    const upstream = structuredClone(downstream)
    Object.assign(upstream, { itemId: '1.01', moduleId: contract.moduleId, outputs: { [port]: { limitations: ['历史来源'], records: [{ recordId: 'upstream',
      ...Object.fromEntries(definition.fields.map(f => [f.name, { value: null, claimRefs: [], claimClass: 'missing', limitations: ['资料不足'] }])),
      [field.name]: { value: '河畔观察课堂', claimRefs: ['claim'], claimClass: 'source_conclusion', limitations: ['历史来源'] } }] } } })
    upstream.claims[0].selector = `/outputs/${port}/records/0/${field.name}/value`
    upstream.execution.executionId = 'upstream-author'
    downstream.claims[0] = { claimId: 'claim', selector: downstream.claims[0].selector, kind: 'inference', value: '河畔观察课堂',
      inputRefs: [{ moduleId: upstream.moduleId, claimId: 'claim' }], rationale: '沿用有出处的拟议产品' }
    downstream.sourceValues[0].quote = '下游的同名来源不能被借用'
    moduleResearch.results.push(upstream)
    moduleResearch.moduleRuns.push({ itemId: '1.01', status: 'completed', bundleRunId: 'upstream-bundle', resultHash: 'e'.repeat(64) })
    const row = makeSourceIndex(frozen).find(row => row.moduleLineage?.itemId === '5.06' && row.text.includes('河畔观察课堂'))!
    expect(row.moduleLineage!.sources).toHaveLength(1)
    expect(row.moduleLineage!.sources[0].moduleId).toBe(upstream.moduleId)
    expect(row.moduleLineage!.sources[0].source.quote).toBe('计划开展河畔观察课堂。')
    expect(row.moduleLineage!.nativeEvidence.some(row => row.receipt.executionId === 'upstream-author')).toBe(true)
  })
  it('maps every current catalog item into the existing seven chapters', async () => {
    const url = new URL('../src/report/manuscript/module-sources.ts', import.meta.url)
    const m = await import(url.href)
    for (const item of loadPlanningCatalog().modules) expect(m.moduleReportChapters(item.id).length, item.id).toBeGreaterThan(0)
  })
})
