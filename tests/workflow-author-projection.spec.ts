import { createHash } from 'node:crypto'
import Ajv2020 from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'
import {
  WORKFLOW_AUTHOR_PROJECTION_VERSION,
  createWorkflowAuthorContext,
  compileWorkflowAuthorProjection,
  createWorkflowAuthorAudit,
  replayWorkflowAuthorProjection,
  workflowAuthorSchema,
  workflowAuthorReferenceGuide,
} from '../src/runtime/workflow-author-projection.ts'
import { validateCandidateStateProvenance } from '../src/research/project-state-provenance.ts'
import { validateCandidateWorkspaceProvenance } from '../src/research/workspace-provenance.ts'
import type { EvidenceRecord } from '../src/research/types.ts'

const jsonHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const quality = { completionChecks: [], evidenceChecks: [], assumptions: ['保持限制'], blockers: [], confidence: 0.63 }
const evidence = {
  evidenceId: 'accepted-file', workflowId: 'wf', dataPointId: 'context', sourceId: 'workspace-files', sourceType: 'workspace_file',
  sourceUri: 'file:///D:/source.pdf', sourceTitle: '历史方案', publisher: '原始资料', capturedAt: '2026-09-26T12:00:00Z',
  publishedAt: null, asOf: null, locator: { relativePath: 'source.pdf', page: 18, fragmentHash: 'b'.repeat(64) },
  rawValue: '历史管理范围1071364.64m²', normalizedValue: '历史管理范围1071364.64m²', unit: null,
  contentHash: 'a'.repeat(64), reliability: 'B', claimClass: 'source_conclusion',
} as EvidenceRecord
const upstream = [{ objectId: 'PS02', revision: 6, value: { data: {
  decision: '是否继续调查（工作假设）',
  excluded: [{ description: '不批准建设', evidence_refs: [{ claim_class: 'assumption' }] }],
} } }]
function trusted() {
  return { projectId: 'project', targetObjectId: 'PS03', researchEvidence: [structuredClone(evidence)],
    acceptedEvidenceIds: ['accepted-file'], upstream: structuredClone(upstream) }
}
function context() {
  return createWorkflowAuthorContext({ ...trusted(), capturedAt: '2026-09-26T13:00:00Z' })
}
function raw() {
  return { projectionVersion: WORKFLOW_AUTHOR_PROJECTION_VERSION,
    data: { amount: 1071364.64, unit: 'm²', status: 'provisional', confidence: { score: 0.4, limitations: ['非2026现状'] },
      arbitraryScope: { status: 'provisional', evidence_refs: [
        { source: 'R1', notes: '仅为历史管理范围，非项目开发面积。' },
        { upstream: 'U1', pointer: '/data/excluded/0', claimClass: 'assumption', notes: '继承上游的工作假设限制。' },
      ] } },
    quality: { completeness: 0.7, consistency: 0.8, timeliness: 0.3, traceability: 0.9, reproducibility: 0.8, issues: ['主体未知'] },
    qualityEvidence: structuredClone(quality),
  }
}

describe('legacy workflow single submission author projection', () => {
  it('reports independent citation failures together without returning a partly compiled candidate', () => {
    const frozen = context(), input = raw() as any
    input.data.first = { evidence_refs: [{ upstream: 'U1', pointer: '/data/excluded/0', claimClass: 'source_conclusion' }] }
    input.data.second = { evidence_refs: [{ source: 'R404' }] }
    input.quality.notes = { evidence_refs: [{ upstream: 'U1', pointer: '/data/absent', claimClass: 'assumption' }] }
    const original = structuredClone(input)
    let rejected: any
    try { compileWorkflowAuthorProjection(input, frozen) } catch (error) { rejected = error }
    expect(rejected.message).toContain('/data/first/evidence_refs/0')
    expect(rejected.message).toContain('preserve assumption')
    expect(rejected.message).toContain('/data/second/evidence_refs/0')
    expect(rejected.message).toContain('/quality/notes/evidence_refs/0')
    expect(rejected.authorPointer).toBe('/data/first/evidence_refs/0')
    expect(input).toEqual(original)
    input.data.first.evidence_refs[0].claimClass = 'assumption'
    input.data.second.evidence_refs[0].source = 'R1'
    input.quality.notes.evidence_refs[0].pointer = '/data/excluded/0'
    expect(() => compileWorkflowAuthorProjection(input, frozen)).not.toThrow()
  })
  it('bounds grouped reference diagnostics while rejecting every invalid submission', () => {
    const input = raw() as any
    input.data.extra = { evidence_refs: Array.from({ length: 24 }, () => ({ source: 'missing' })) }
    let rejected: any
    try { compileWorkflowAuthorProjection(input, context()) } catch (error) { rejected = error }
    expect(rejected.message).toContain('/data/extra/evidence_refs/15')
    expect(rejected.message).not.toContain('/data/extra/evidence_refs/16')
    expect(rejected.message).toContain('8 additional reference errors')
  })
  it('shows the exact inherited class for a business scalar despite prose describing a new inference', () => {
    const sources = trusted() as any
    sources.upstream[0].value.data.excluded = [{ name: '不确认委托', notes: '推断并非正式决策主体',
      evidence_refs: [{ claim_class: 'user_statement', notes: '底层为用户陈述，归纳属 agent_inference' }] }]
    const frozen = createWorkflowAuthorContext({ ...sources, capturedAt: '2026-09-26T13:00:00Z' })
    const before = JSON.stringify(frozen)
    const guide = workflowAuthorReferenceGuide(frozen)
    expect(guide.entries).toContainEqual({ upstream: 'U1', pointer: '/data/excluded/0/name', claimClass: 'user_statement' })
    expect(guide.entries.some(row => row.pointer.includes('/evidence_refs'))).toBe(false)
    expect(guide.entries.some(row => row.pointer === '/data/decision')).toBe(false)
    expect(guide.complete).toBe(true)
    expect(JSON.stringify(frozen)).toBe(before)
    const input = { projectionVersion: WORKFLOW_AUTHOR_PROJECTION_VERSION, data: { evidence_refs: [
      { upstream: 'U1', pointer: '/data/excluded/0/name', claimClass: 'agent_inference' },
    ] }, qualityEvidence: quality }
    expect(() => compileWorkflowAuthorProjection(input, frozen)).toThrow(/preserve user_statement/)
  })

  it('names ambiguous pointers and retains RFC6901 escaping instead of choosing an authority class', () => {
    const sources = trusted() as any
    sources.upstream[0].value.data = { 'a/b~c': { name: '混合来源', evidence_refs: [
      { claim_class: 'user_statement' }, { claim_class: 'source_conclusion' },
    ] } }
    const frozen = createWorkflowAuthorContext({ ...sources, capturedAt: '2026-09-26T13:00:00Z' })
    const row = workflowAuthorReferenceGuide(frozen).entries.find(row => row.pointer === '/data/a~1b~0c/name')
    expect(row).toMatchObject({ upstream: 'U1', error: expect.stringContaining('PROJECT_STATE_CLASS_AMBIGUOUS') })
    expect(row).not.toHaveProperty('claimClass')
  })

  it('bounds the guide and declares omitted subtrees without claiming unlisted pointers are unconstrained', () => {
    const sources = trusted() as any
    sources.upstream[0].value.data = { rows: Array.from({ length: 2000 }, (_, i) => ({
      name: `条目${i}`, evidence_refs: [{ claim_class: 'assumption' }],
    })) }
    const frozen = createWorkflowAuthorContext({ ...sources, capturedAt: '2026-09-26T13:00:00Z' })
    const guide = workflowAuthorReferenceGuide(frozen)
    expect(guide.entries.length).toBeLessThanOrEqual(128)
    expect(guide.visitedNodes).toBeLessThanOrEqual(1024)
    expect(guide.complete).toBe(false)
    expect(guide.omittedSubtrees).toBeGreaterThan(0)
  })

  it('retains reference array constraints while projecting its item grammar', () => {
    const schema = workflowAuthorSchema({ properties: { data: { type: 'object', additionalProperties: false,
      properties: { evidence_refs: { type: 'array', minItems: 1, maxItems: 4, uniqueItems: true,
        description: 'Necessary citations', items: { $ref: '#/$defs/EvidenceRef' } } } } } }, {}) as any
    expect(schema.properties.data.properties.evidence_refs).toMatchObject({ type: 'array', minItems: 1, maxItems: 4,
      uniqueItems: true, description: 'Necessary citations', items: { oneOf: expect.any(Array) } })
  })

  it.each([
    [{ type: 'number', minimum: 0 }, 0.4],
    [{ type: 'string' }, 'conditional'],
    [{ type: 'object', additionalProperties: false, required: ['value'], properties: { value: { type: 'number' } } }, { value: 2 }],
  ])('does not add an evidence exception to a typed business map (%j)', (valueSchema, value) => {
    const schema = workflowAuthorSchema({ properties: { data: { type: 'object', additionalProperties: false,
      properties: { weights: { type: 'object', additionalProperties: valueSchema }, scope: { type: 'object', additionalProperties: true } },
    } } }, {}) as any
    const validate = new Ajv2020({ strict: false }).compile(schema)
    const candidate = { projectionVersion: WORKFLOW_AUTHOR_PROJECTION_VERSION, data: { weights: { criterion: value }, scope: { evidence_refs: [{ source: 'R1' }] } }, qualityEvidence: {} }
    expect(validate(candidate)).toBe(true)
    expect(validate({ ...candidate, data: { ...candidate.data, weights: { criterion: value, evidence_refs: [{ source: 'R1' }] } } })).toBe(false)
    expect(schema.properties.data.properties.weights.properties ?? {}).not.toHaveProperty('evidence_refs')
  })

  it('preserves all authored business fields, scores and per-use notes while expanding trusted references', () => {
    const input = raw(), original = structuredClone(input), frozen = context()
    const result = compileWorkflowAuthorProjection(input, frozen)
    expect(input).toEqual(original)
    const refs = (result.payload.data as any).arbitraryScope.evidence_refs
    expect(refs[0]).toMatchObject({ evidence_id: 'accepted-file', version_id: evidence.contentHash,
      claim_class: 'source_conclusion', locator: { page: 18 }, quote_hash: evidence.locator.fragmentHash,
      captured_at: evidence.capturedAt, reliability: 'B', notes: input.data.arbitraryScope.evidence_refs[0]!.notes })
    expect(refs[1]).toMatchObject({ evidence_id: 'PS02', asset_id: 'PS02', version_id: 'PS02@6', claim_class: 'assumption',
      locator: { section: '/data/excluded/0' }, quote_hash: jsonHash(upstream[0]!.value.data.excluded[0]),
      captured_at: '2026-09-26T13:00:00Z', notes: input.data.arbitraryScope.evidence_refs[1]!.notes })
    const withoutRefs = structuredClone(result.payload.data) as any
    withoutRefs.arbitraryScope.evidence_refs = original.data.arbitraryScope.evidence_refs
    expect(withoutRefs).toEqual(original.data)
    expect(result.payload.quality).toEqual(original.quality)
    expect(result.qualityEvidence).toEqual(original.qualityEvidence)
    expect(Object.keys(result.payload).sort()).toEqual(['data', 'quality'])
    expect(validateCandidateWorkspaceProvenance(result.payload, trusted()).valid).toBe(true)
    expect(validateCandidateStateProvenance(result.payload, { projectId: 'project',
      stateObjects: upstream.map(row => ({ ...row, projectId: 'project' })) as never }).valid).toBe(true)
  })

  it('keeps repeated references at their original positions with distinct author notes', () => {
    const input = raw()
    input.data.arbitraryScope.evidence_refs.push({ source: 'R1', notes: '第二处用途不同，说明必须保留。' })
    const result = compileWorkflowAuthorProjection(input, context())
    const refs = (result.payload.data as any).arbitraryScope.evidence_refs
    expect(refs).toHaveLength(3)
    expect(refs[0].evidence_id).toBe(refs[2].evidence_id)
    expect(refs[0].notes).not.toBe(refs[2].notes)
  })

  it.each([['BL04', 'photo_refs'], ['BL08', 'survey_refs'], ['OB02', 'baseline_refs'], ['OB03', 'sources'], ['OB04', 'sources']])
    ('expands the canonical %s data.%s EvidenceRef array at its exact field path', (targetObjectId, key) => {
      const input = { projectionVersion: WORKFLOW_AUTHOR_PROJECTION_VERSION, data: { [key]: [{ source: 'R1', notes: '用途保留' }] }, qualityEvidence: quality }
      const frozen = createWorkflowAuthorContext({ ...trusted(), targetObjectId, capturedAt: '2026-09-26T13:00:00Z' })
      expect((compileWorkflowAuthorProjection(input, frozen).payload.data as any)[key][0])
        .toMatchObject({ evidence_id: evidence.evidenceId, notes: '用途保留' })
      input.data[key]![0] = { source: 'R1', notes: '用途保留', version_id: 'override' } as any
      expect(() => compileWorkflowAuthorProjection(input, frozen)).toThrow(/WORKFLOW_AUTHOR_/u)
    })

  it('does not reinterpret similarly named business fields in another object or nested field', () => {
    const input = { projectionVersion: WORKFLOW_AUTHOR_PROJECTION_VERSION,
      data: { sources: ['业务资料名称'], nested: { sources: ['另一业务资料'] } }, qualityEvidence: quality }
    expect(compileWorkflowAuthorProjection(input, context()).payload.data).toEqual(input.data)
  })

  it('still validates Research project-state selectors inside a differently named citation array', () => {
    const sources = trusted() as any
    sources.targetObjectId = 'BL04'
    sources.researchEvidence[0] = { ...sources.researchEvidence[0], sourceType: 'project_state', sourceId: 'project-state',
      sourceUri: 'state://project/PS02?revision=6', locator: { objectId: 'PS02', revision: 6, jsonPointer: '/data/absent' } }
    const frozen = createWorkflowAuthorContext({ ...sources, capturedAt: '2026-09-26T13:00:00Z' })
    const input = { projectionVersion: WORKFLOW_AUTHOR_PROJECTION_VERSION, data: { photo_refs: [{ source: 'R1' }] }, qualityEvidence: quality }
    expect(() => compileWorkflowAuthorProjection(input, frozen)).toThrow(/WORKFLOW_AUTHOR_/u)
  })

  it('freezes only accepted same-project supplementary state sources, without new upstream aliases', () => {
    const sources = trusted() as any
    const value = { data: { facilities: '历史设施' } }
    sources.researchEvidence[0] = { ...sources.researchEvidence[0], sourceType: 'project_state', sourceId: 'project-state',
      sourceUri: 'state://project/BL06?revision=5', contentHash: jsonHash(value),
      locator: { objectId: 'BL06', revision: 5, jsonPointer: '/data/facilities', fragmentHash: jsonHash(value.data.facilities) } }
    sources.availableStates = [
      { projectId: 'another-project', objectId: 'BL06', revision: 10, value: { data: 'wrong project' } },
      { projectId: 'project', objectId: 'BL06', revision: 5, value },
      { projectId: 'project', objectId: 'BL07', revision: 6, value: { data: 'unreferenced' } },
    ]
    const frozen = createWorkflowAuthorContext({ ...sources, capturedAt: '2026-09-26T13:00:00Z' })
    expect(frozen.researchStates).toEqual([{ objectId: 'BL06', revision: 5, value }])
    expect(frozen.upstream.map(row => row.objectId)).toEqual(['PS02'])
    sources.availableStates[1].value.data.facilities = 'later mutation'
    expect(compileWorkflowAuthorProjection(raw(), frozen).payload.data).toBeDefined()
    const unaccepted = createWorkflowAuthorContext({ ...sources, acceptedEvidenceIds: [], capturedAt: '2026-09-26T13:00:00Z' })
    expect(unaccepted.researchStates).toBeUndefined()
    expect(() => compileWorkflowAuthorProjection(raw(), unaccepted)).toThrow('UNKNOWN_SOURCE')
  })

  it.each([
    { source: 'missing' },
    { source: 'R1', version_id: 'unknown' },
    { source: 'R1', claimClass: 'fact' },
    { source: 'R1', captured_at: '2999-01-01T00:00:00Z' },
    { source: 'R1', upstream: 'U1' },
    { evidence_id: 'accepted-file', asset_id: 'source.pdf', version_id: 'a'.repeat(64), claim_class: 'source_conclusion', locator: { page: 18 } },
    'R1', null,
  ])('rejects invalid or overriding short refs even inside open Scope properties: %j', (ref) => {
    const input = raw() as any
    input.data.arbitraryScope.evidence_refs = [ref]
    expect(() => compileWorkflowAuthorProjection(input, context())).toThrow(/WORKFLOW_AUTHOR_/u)
  })

  it.each([null, {}, 'R1'])('rejects a non-array evidence_refs anywhere in business data: %j', (value) => {
    const input = raw() as any
    input.data.arbitraryScope.evidence_refs = value
    expect(() => compileWorkflowAuthorProjection(input, context())).toThrow(/WORKFLOW_AUTHOR_/u)
  })

  it('does not make an unaccepted Research record addressable', () => {
    const frozen = createWorkflowAuthorContext({ ...trusted(), acceptedEvidenceIds: [], capturedAt: '2026-09-26T13:00:00Z' })
    expect(() => compileWorkflowAuthorProjection(raw(), frozen)).toThrow(/WORKFLOW_AUTHOR_/u)
  })

  it.each([
    { upstream: 'U2', pointer: '/data/decision', claimClass: 'source_conclusion' },
    { upstream: 'U1', pointer: '/data/missing', claimClass: 'source_conclusion' },
    { upstream: 'U1', pointer: '/data/excluded/0', claimClass: 'source_conclusion' },
    { upstream: 'U1', pointer: '/data/excluded/0', claimClass: 'fact' },
    { upstream: 'U1', pointer: '/data/excluded/0' },
    { upstream: 'U1', pointer: 'data/decision', claimClass: 'source_conclusion' },
  ])('requires an available exact upstream selector and an explicit non-upgraded class: %j', (ref) => {
    const input = raw() as any
    input.data.arbitraryScope.evidence_refs = [ref]
    expect(() => compileWorkflowAuthorProjection(input, context())).toThrow(/WORKFLOW_AUTHOR_/u)
  })

  it('uses the author declared classification when the upstream rule does not establish an uncertain class', () => {
    const input = raw() as any
    input.data.arbitraryScope.evidence_refs = [{ upstream: 'U1', pointer: '/data/decision', claimClass: 'agent_inference' }]
    const ref = (compileWorkflowAuthorProjection(input, context()).payload.data as any).arbitraryScope.evidence_refs[0]
    expect(ref.claim_class).toBe('agent_inference')
  })

  it.each(['user_statement', 'decision'])('preserves explicit upstream %s without promoting its authority', (claimClass) => {
    const sources = trusted() as any
    sources.upstream[0].value.data.decision = { text: '明确来源性质', claim_class: claimClass }
    const frozen = createWorkflowAuthorContext({ ...sources, capturedAt: '2026-09-26T13:00:00Z' })
    const input = { projectionVersion: WORKFLOW_AUTHOR_PROJECTION_VERSION, data: { evidence_refs: [
      { upstream: 'U1', pointer: '/data/decision/text', claimClass },
    ] }, qualityEvidence: quality }
    expect((compileWorkflowAuthorProjection(input, frozen).payload.data as any).evidence_refs[0].claim_class).toBe(claimClass)
    for (const upgrade of ['source_conclusion', 'fact']) {
      input.data.evidence_refs[0]!.claimClass = upgrade
      expect(() => compileWorkflowAuthorProjection(input, frozen)).toThrow(/WORKFLOW_AUTHOR_/u)
    }
  })

  it.each([
    (input: any) => { input.projectionVersion = 'unknown' },
    (input: any) => { input.payload = { data: input.data } },
    (input: any) => { delete input.data },
    (input: any) => { input.revision = 100 },
  ])('rejects old/mixed envelopes rather than repairing the native submission', (change) => {
    const input = raw() as any; change(input)
    expect(() => compileWorkflowAuthorProjection(input, context())).toThrow(/WORKFLOW_AUTHOR_/u)
  })

  it('freezes its source snapshot against subsequent mutations and replays from the actual native submission', () => {
    const sources = trusted(), input = raw()
    const frozen = createWorkflowAuthorContext({ ...sources, capturedAt: '2026-09-26T13:00:00Z' })
    sources.upstream[0]!.value.data.decision = 'later mutation'
    const audit = createWorkflowAuthorAudit(input, frozen, 'actual-native-child')
    expect(replayWorkflowAuthorProjection(audit, { childId: 'actual-native-child', raw: input }, trusted()))
      .toEqual(compileWorkflowAuthorProjection(input, frozen))
  })

  it.each(['raw', 'context', 'compiledHash', 'childId', 'nativeRaw', 'trustedResearch', 'trustedUpstream', 'trustedProject'] as const)
    ('rejects tampered %s during replay', (part) => {
      const input = raw(), audit = createWorkflowAuthorAudit(input, context(), 'actual-native-child') as any
      const receipt = { childId: 'actual-native-child', raw: structuredClone(input) } as any
      const sources = trusted() as any
      if (part === 'raw') audit.raw.data.amount = 1
      if (part === 'context') audit.context.capturedAt = '2999-01-01T00:00:00Z'
      if (part === 'compiledHash') audit.compiledHash = '0'.repeat(64)
      if (part === 'childId') receipt.childId = 'other-child'
      if (part === 'nativeRaw') receipt.raw.data.amount = 1
      if (part === 'trustedResearch') sources.researchEvidence[0].contentHash = 'f'.repeat(64)
      if (part === 'trustedUpstream') sources.upstream[0].revision = 7
      if (part === 'trustedProject') sources.projectId = 'other-project'
      expect(() => replayWorkflowAuthorProjection(audit, receipt, sources)).toThrow(/WORKFLOW_AUTHOR_/u)
    })
})
