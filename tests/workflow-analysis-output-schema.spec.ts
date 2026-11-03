import { createHash } from 'node:crypto'
import { assertObjectJsonSchema, validateJsonSchemaValue, type ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { ContractRegistry } from '../src/contracts/registry.ts'
import { DshSubagentWorkflowAnalyzer } from '../src/runtime/subagent-workflow-analyzer.ts'
import { projectStateClaimClass, validateCandidateStateProvenance } from '../src/research/project-state-provenance.ts'
import type { ResearchExecutionResult } from '../src/research/execution-service.ts'
import { WORKFLOW_AUTHOR_PROJECTION_VERSION } from '../src/runtime/workflow-author-projection.ts'

let registry: ContractRegistry
beforeAll(async () => { registry = await ContractRegistry.open(new URL('../contracts/v0.6/', import.meta.url)) })
const quality = { completionChecks: [], evidenceChecks: [], assumptions: [], blockers: [], confidence: 0.8 }
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
function projectedExample(objectId: string) {
  const example = registry.stateExample(objectId) as any
  const project = (value: any): any => Array.isArray(value) ? value.map(project)
    : value !== null && typeof value === 'object' ? (typeof value.evidence_id === 'string' && typeof value.asset_id === 'string'
      ? { source: 'R1', ...(typeof value.notes === 'string' ? { notes: value.notes } : {}) }
      : Object.fromEntries(Object.entries(value).map(([key, child]) => [key, project(child)]))) : value
  return { projectionVersion: WORKFLOW_AUTHOR_PROJECTION_VERSION, data: project(example.data),
    ...(example.quality === undefined ? {} : { quality: project(example.quality) }), qualityEvidence: quality }
}

async function requestFor(objectId = 'PS02', research?: ResearchExecutionResult, upstreamValue: unknown = {}, upstreamRevision = 1) {
  const descriptor = registry.workflows().find(row => row.targetObjectId === objectId)!
  const start = vi.fn(async (_provider: string, _request: unknown) => ({
    id: 'child', dispose: async () => undefined,
    result: Promise.resolve({ stopReason: 'completed', structured: { projectionVersion: WORKFLOW_AUTHOR_PROJECTION_VERSION, data: {}, qualityEvidence: quality } }),
  }))
  const analyzer = new DshSubagentWorkflowAnalyzer({
    registry, subagents: { getProvider: () => ({}), start },
    repository: { readContext: () => ({ project: { projectId: 'project', name: 'schema projection', currentRevision: 1 },
      stateObjects: descriptor.requiredUpstream.map(id => ({ objectId: id, revision: upstreamRevision, value: upstreamValue })) }) },
  } as never)
  await analyzer.analyze({ id: 'parent' } as never, 'project', descriptor, undefined, undefined, research)
  return start.mock.calls[0]![1] as { outputSchema: ObjectJsonSchema; prompt: { text: string }[]; persona: string; toolFilter: { allow: string[] } }
}

describe('workflow native output contract', () => {
  it('describes the real OP06 numeric map constraint without inviting unsupported evidence metadata', async () => {
    const { outputSchema } = await requestFor('OP06')
    const weights = outputSchema.properties!.data!.properties!.weights!
    expect(weights.properties ?? {}).not.toHaveProperty('evidence_refs')
    expect(weights.description).toContain('附加键值约束')
    expect(weights.description).toContain('"type":"number"')
    const candidate = structuredClone(registry.stateExample('OP06')) as any
    candidate.data.weights.evidence_refs = []
    expect(registry.validateStateObject('OP06', candidate).errors.join(';')).toContain('/data/weights/evidence_refs')
  })
  it('requires exact quality criterion identities so paraphrased labels cannot silently score zero coverage',async()=>{
    const descriptor=registry.workflows().find(row=>row.targetObjectId==='PS02')!
    const {outputSchema}=await requestFor('PS02'),valid=structuredClone(projectedExample('PS02')) as any
    valid.qualityEvidence.completionChecks=[{criterion:descriptor.completionCriteria![0],status:'pass',rationale:'已逐项复核'}]
    valid.qualityEvidence.evidenceChecks=[{policy:descriptor.evidencePolicy![0],status:'pass',rationale:'已复核来源'}]
    expect(validateJsonSchemaValue(outputSchema,valid)).toEqual([])
    valid.qualityEvidence.completionChecks[0].criterion='改写过的标准'
    valid.qualityEvidence.evidenceChecks[0].policy='简写的证据标准'
    const errors=validateJsonSchemaValue(outputSchema,valid).join(' ')
    expect(errors).toContain('criterion');expect(errors).toContain('policy')
  })
  it('requires native structured submission while keeping business and delegation tools unavailable', async () => {
    const { prompt, persona, toolFilter } = await requestFor('PS03')
    expect(persona).toContain('禁止调用业务工具和委派工具')
    expect(persona).toContain('structured_output')
    expect(persona).not.toContain('禁止调用工具，')
    expect(prompt[0]!.text).toContain('最终必须调用 structured_output 一次')
    expect(prompt[0]!.text).toContain('不能在普通消息中输出 JSON')
    expect(prompt[0]!.text).not.toContain('当前子 Agent 无工具权限')
    expect(toolFilter).toEqual({ allow: [] })
  })

  it('explains a schema-valid structured class for a new composite judgment without relabeling its sources', async () => {
    const { prompt, outputSchema } = await requestFor('DG06')
    expect(prompt[0]!.text).toContain('新论断自身的 claim_class')
    const candidate = projectedExample('DG06') as any
    candidate.data.rationale = [{ id: 'priority-basis', name: '本轮优先级依据', description: '依据历史设施与用户任务综合确定的本轮优先级', claim_class: 'agent_inference',
      evidence_refs: [{ source: 'R1' }, { source: 'R2' }] }]
    expect(validateJsonSchemaValue(outputSchema, candidate)).toEqual([])
    const refs = [{ claim_class: 'source_conclusion' }, { claim_class: 'user_statement' }]
    const state = { data: { rationale: [{ ...candidate.data.rationale[0], evidence_refs: refs }] } }
    expect(projectStateClaimClass(state, '/data/rationale/0/description')).toBe('agent_inference')
    expect(state.data.rationale[0].evidence_refs).toEqual(refs)
    delete state.data.rationale[0].claim_class
    expect(() => projectStateClaimClass(state, '/data/rationale/0/description')).toThrow('PROJECT_STATE_CLASS_AMBIGUOUS')
  })

  it('rejects completed plain-text JSON without parsing it into a structured candidate', async () => {
    const descriptor = registry.workflow('preplan.wf.01.03')
    const dispose = vi.fn(async () => undefined)
    const analyzer = new DshSubagentWorkflowAnalyzer({
      registry,
      repository: { readContext: () => ({ project: { projectId: 'project', name: 'native submit', currentRevision: 2 },
        stateObjects: descriptor.requiredUpstream.map(objectId => ({ objectId, revision: 2, value: {} })) }) },
      subagents: { getProvider: () => ({}), start: async () => ({ id: 'child', dispose,
        result: Promise.resolve({ stopReason: 'completed', text: JSON.stringify({ payload: registry.stateExample('PS03'), qualityEvidence: quality }) }) }) },
    } as never)
    await expect(analyzer.analyze({ id: 'parent' } as never, 'project', descriptor)).rejects.toThrow('returned no structured author projection')
    expect(dispose).toHaveBeenCalledOnce()
  })

  it.each([['PS02', 17], ['PG06', 70], ['PS01', 1]] as const)('provides copyable actual upstream citation identities for %s at revision %s', async (objectId, revision) => {
    const { prompt } = await requestFor(objectId, undefined, {}, revision)
    const text = prompt[0]!.text
    const mapping = JSON.parse(text.split('上游短引用身份映射（upstream 逐字复制 alias，pointer 必须精确选择原始上游字段）：\n')[1]!.split('\n\n')[0]!)
    const upstreamIds = registry.workflows().find(row => row.targetObjectId === objectId)!.requiredUpstream.filter(id => id !== 'ProjectSeed')
    expect(mapping).toEqual(upstreamIds.map((id, index) => ({ alias: `U${index + 1}`, objectId: id, revision })))
    expect(text).toContain('pointer 必须精确选择原始上游字段')
    expect(text).not.toContain('version_id 使用实际 OBJECT@revision')
    expect(text).toContain('来源引用会由中央重新校验版本、路径及已提供的hash')
  })

  it('rejects the observed duplicate envelope and undeclared nested payload fields before native capture', async () => {
    const { outputSchema } = await requestFor()
    const valid = projectedExample('PS02')
    expect(validateJsonSchemaValue(outputSchema, valid)).toEqual([])
    expect(validateJsonSchemaValue(outputSchema, { payload: valid, qualityEvidence: quality }).join(' ')).toContain('payload')
    const extra = structuredClone(valid) as any
    extra.data.reasoning = 'undeclared'
    expect(validateJsonSchemaValue(outputSchema, extra).join(' ')).toContain('reasoning')
    extra.object_id = 'PS01'
    expect(validateJsonSchemaValue(outputSchema, extra).join(' ')).toContain('object_id')
  })

  it('projects every real workflow state contract to supported DSH schema without rejecting its valid example', async () => {
    for (const descriptor of registry.workflows()) {
      const { outputSchema } = await requestFor(descriptor.targetObjectId)
      expect(() => assertObjectJsonSchema(outputSchema), descriptor.targetObjectId).not.toThrow()
      expect(validateJsonSchemaValue(outputSchema, projectedExample(descriptor.targetObjectId)), descriptor.targetObjectId).toEqual([])
      expect(JSON.stringify(outputSchema)).not.toContain('"$ref"')
      const canonical = registry.stateSchema(descriptor.targetObjectId) as any
      const canonicalData = canonical.properties.data.$ref ? canonical.$defs[canonical.properties.data.$ref.split('/').at(-1)] : canonical.properties.data
      expect(outputSchema.required).toEqual(['projectionVersion', 'data', 'qualityEvidence'])
      expect(outputSchema.properties!.data!.required, descriptor.targetObjectId).toEqual(canonicalData.required)
      expect(outputSchema.additionalProperties).toBe(false)
    }
  })

  it('keeps full numeric and string constraints with the central contract validator', async () => {
    const { outputSchema } = await requestFor()
    const payload = structuredClone(registry.stateExample('PS02')) as any
    payload.data.decision_question = '短'
    payload.revision = -1
    const native = projectedExample('PS02')
    native.data.decision_question = '短'
    expect(validateJsonSchemaValue(outputSchema, native)).toEqual([])
    expect(registry.validateStateObject('PS02', payload).valid).toBe(false)
  })

  it('supplies original source and selected fragment hashes even for truncated evidence, without changing provenance checks', async () => {
    const source = { projectId: 'project', objectId: 'PS01', revision: 1, value: { data: { context: '资料'.repeat(2500) } } }
    const fragmentHash = hash(source.value.data.context)
    const record = { evidenceId: 'ev-state', workflowId: 'preplan.wf.01.02', dataPointId: 'decision-context',
      sourceId: 'project-state', sourceType: 'project_state', sourceUri: 'state://project/PS01?revision=1',
      sourceTitle: 'PS01 @ revision 1', publisher: 'runtime', capturedAt: '2026-09-26T00:00:00Z', asOf: null,
      locator: { objectId: 'PS01', revision: 1, jsonPointer: '/data/context', fragmentHash },
      rawValue: source.value.data.context, normalizedValue: source.value.data.context, unit: null,
      contentHash: hash(source.value), reliability: 'B', claimClass: 'source_conclusion' }
    const research = { records: [record], validation: { valid: true, acceptedEvidenceIds: ['ev-state'], missingDataPointIds: [], coverage: 1, errors: [] } } as unknown as ResearchExecutionResult
    const { prompt } = await requestFor('PS02', research, source.value)
    const text = prompt[0]!.text
    const snapshot = JSON.parse(text.split('中央 Runtime 已独立采集并校验的 Research Evidence（只能使用这里实际出现的事实）：\n')[1]!.split('\n\n')[0]!)
    expect(snapshot.records[0].contentHash).toBe(record.contentHash)
    expect(snapshot.records[0].source).toBe('R1')
    expect(snapshot.records[0].locator.fragmentHash).toBe(fragmentHash)
    expect(snapshot.records[0].normalizedValue).toContain('[truncated]')
    expect(text).toContain('禁止 payload 包装')
    expect(text).toContain('JSON.stringify')
    expect(text).toContain('不得从截断文本重新计算')
    expect(text).toContain('作者不能覆盖这些字段')
    const ref = { evidence_id: 'ev-state', asset_id: 'project-state', version_id: 'PS01@1',
      locator: { section: '/data/context' }, quote_hash: fragmentHash, claim_class: 'source_conclusion' }
    const validate = (quote_hash: string | null) => validateCandidateStateProvenance({ data: { evidence_refs: [{ ...ref, quote_hash }] } },
      { projectId: 'project', stateObjects: [source] as never, researchEvidence: research.records })
    expect(validate(fragmentHash).valid).toBe(true)
    expect(validate(record.contentHash).errors.join(' ')).toContain('quote_hash')
    expect(validate(null).valid).toBe(true)
  })
})
