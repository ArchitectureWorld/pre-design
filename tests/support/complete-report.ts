import type { FrozenProjectInput } from '../../src/report/types.ts'
import { getModuleFieldContracts } from '../../src/research-v2/module-contracts.ts'
import { DEFAULT_REPORT_DELIVERY_CONTRACT } from '../../src/report/delivery-contract.ts'
import { makeSourceIndex, manuscriptSourceFingerprint } from '../../src/report/manuscript/source.ts'

export function completeReportFixture(linked = false): FrozenProjectInput {
  const contract = getModuleFieldContracts('5.06'), [port, definition] = Object.entries(contract.ports)[0]!
  const result = { itemId: '5.06', moduleId: contract.moduleId, outputs: { [port]: { limitations: [], records: [{ recordId: 'r',
    ...Object.fromEntries(definition.fields.map(f => [f.name, { value: null, claimRefs: [], claimClass: 'missing', limitations: ['待核原件'] }])) }] } },
    claims: [], sourceValues: [], limitations: [], execution: { executionId: 'author', childId: 'author-child', actualModel: { provider: 'test', model: 'test' }, stopReason: 'completed' } }
  const input: FrozenProjectInput = { deliveryContract: DEFAULT_REPORT_DELIVERY_CONTRACT, projectId: 'p', projectName: '测试山地公园', revision: 3, generatedAt: '2026-09-27',
    recommendation: '研学课程', decisionItems: [], gates: [], visualAssets: [], stateObjects: [], moduleResearch: {
      selectionId: 'selection', manifestRunId: 'manifest', snapshotId: 'snapshot', snapshotHash: 'b'.repeat(64), catalogHash: 'catalog', planHash: 'plan', corpusFingerprint: 'corpus',
      taskBrief: '生态研学', expectedModuleIds: ['5.06'], results: [result], moduleRuns: [{ itemId: '5.06', status: 'completed', bundleRunId: 'bundle', resultHash: 'c'.repeat(64) }], limitations: [], fingerprint: 'fingerprint',
    } as never }
  const sourceRefs = makeSourceIndex(input).map(s => s.id)
  const kinds = { opportunity: 'argument', site: 'evidence', positioning: 'comparison', products: 'product', spatial: 'spatial', launch: 'delivery', operation: 'financial' }
  return { ...input, manuscript: { schemaVersion: 'pre-design.planning-manuscript.v1', policyVersion: 'test', projectId: 'p', sourceRevision: 3, sourceFingerprint: manuscriptSourceFingerprint(input), generatedAt: input.generatedAt,
    title: '生态研学', chapters: Object.entries(kinds).map(([id, kind]) => ({ id, title: id, thesis: '研学课堂串联步道', pages: [{ id: id + '-plan', kind, title: '河畔课堂', claim: '课程与步道构成预约体验', body: ['河畔课堂连接入口与服务点'], sourceRefs,
      ...(id === 'products' ? { product: { name: '河畔课堂', audience: '亲子', experience: '观察水生动植物', location: '河畔节点', scale: '由导师与场地承载限定', operations: '预约小组' } } : {}),
      ...(linked && ['spatial','launch','operation'].includes(id) ? { productRefs: ['products-plan'] } : {}),
      ...(linked && id === 'spatial' ? { spatialEvidence: { baseRefs: sourceRefs, zone: '河畔', node: '课堂', access: '入口', route: '步道', service: '服务点', logistics: '后勤通道', rationale: '依地形组织游线' } } : {}),
      visual: { kind: 'diagram', subject: '课程关系', purpose: '对应节点与游线', caption: '设计假设' }, notes: [],
    }] })) } as never }
}
