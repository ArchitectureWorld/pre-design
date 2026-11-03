import {describe, expect, it, vi} from 'vitest'
import {getModuleFieldContracts} from '../src/research-v2/module-contracts.ts'
import {getModuleAuthorFieldGroups, getModuleAuthorGroupVersion} from '../src/research-v2/module-author-groups.ts'
import {validateModuleProjectionFields} from '../src/research-v2/module-author-projection.ts'
import {recoverModuleAuthorGroups} from '../src/research-v2/module-group-recovery.ts'
import {moduleRecoveryFeedback} from '../src/research-v2/module-recovery-feedback.ts'
import {materialCorpusFingerprint} from '../src/materials/research-evidence.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'

const base = {documents: [], limitations: ['No survey or original numeric operands']}
const corpus = {...base, fingerprint: materialCorpusFingerprint(base)}
const route = {provider: 'test', model: 'native-fixture'}
const address = {port: 'market_context', recordId: 'r', field: 'formula', at: ''}
const calculation = {operation: 'ratio', operands: [{sourceId: 'a'}, {sourceId: 'b'}]}
function marketGroups() {
  const contract = getModuleFieldContracts('3.01').ports.market_context
  return getModuleAuthorFieldGroups('3.01').map(group => ({projectionVersion: getModuleAuthorGroupVersion('3.01'), groupId: group.groupId,
    outputs: {market_context: {type: contract.type, quality: 'limited', scope: 'Synthetic recovery boundary', asOf: '2026-10-02', limitations: base.limitations,
      records: [{recordId: 'r', resultClass: 'observation_summary', ...Object.fromEntries(group.fields.map(field => [field, {value: null, claimClass: 'missing', limitations: base.limitations}]))}]}},
    evidence: [] as any[], limitations: base.limitations,
    stepResults: Object.fromEntries([1, 2, 3, 4].map(step => ['step' + step, {status: 'limited', summary: 'Synthetic boundary only', fieldRefs: [], limitations: base.limitations}]))})) as any[]
}
function invalidFormula() {
  const raw = marketGroups().find(raw => raw.groupId === 'market_context:3.2.2')!
  raw.outputs.market_context.records[0].formula = {value: 'GDP / population', claimClass: 'agent_inference', limitations: base.limitations}
  raw.evidence = [{target: address, kind: 'calculation', calculation}]
  return raw
}
function fixture() {
  const raws = marketGroups(), bad = invalidFormula()
  raws[5] = bad
  const attempts = raws.map((raw, i) => ({classId: 'text', status: 'completed', groupId: raw.groupId, structuredOutput: raw,
    structuredHash: hash(raw), outputsJsonHash: hash(raw.outputs), executionId: 'exec-' + i, childId: 'child-' + i, actualModel: route, stopReason: 'completed'}))
  const audit = {attempts, reviewReceipts: [] as any[]}
  const executions = attempts.map(a => ({id: a.executionId, projectId: 'project', parentId: 'parent', classId: 'text', childId: a.childId,
    status: 'completed', childStopReason: 'completed', activity: 'idle', actual: route, task: '3.01 synthetic native author'}))
  const events = raws.map((raw, i) => [
    {seq: 1, type: 'turn/start', data: {turn: 1}},
    {seq: 2, type: 'request/header', data: {header: {config: route}}},
    {seq: 3, type: 'tool/call', data: {turn: 1, step: 1, callId: 'call-' + i, name: 'structured_output', arguments: JSON.stringify(raw)}},
    {seq: 4, type: 'tool/result', data: {turn: 1, step: 1, message: {content: [{type: 'tool-result', toolCallId: 'call-' + i, isError: false}]}}},
    {seq: 5, type: 'turn/end', data: {turn: 1, reason: {kind: 'completed'}}},
  ])
  const context = {module: {id: '3.01'}, projectId: 'project', corpus, upstream: [], resumeExecutionAudit: audit,
    resumeExecutionError: 'MODULE_CALCULATION_REQUIRED: rejected-string-claim', signal: new AbortController().signal}
  const classes = {execution: (id: string) => executions.find(e => e.id === id)}
  const readEvents = vi.fn(async (id: string) => events[Number(id.split('-')[1])])
  return {context, audit, raws, events, classes, readEvents}
}

describe('numeric calculation results before complete merge', () => {
  it('rejects text formula evidence as calculation during field validation without rewriting it', () => {
    const raw = invalidFormula(), before = hash(raw)
    expect(() => validateModuleProjectionFields('3.01', raw, {market_context: ['formula']}, corpus)).toThrow(/MODULE_CALCULATION_REQUIRED.*resultTypeConflicts/)
    expect(hash(raw)).toBe(before)
  })
  it('allows a supported conditional text-method decision without turning it into a computed number', () => {
    const raw = invalidFormula()
    raw.outputs.market_context.records[0].formula.claimClass = 'decision'
    raw.evidence = [{target: address, kind: 'proposal', rationale: 'Proposed method only; inputs unavailable, no numerical result or completed calculation.'}]
    expect(() => validateModuleProjectionFields('3.01', raw, {market_context: ['formula']}, corpus)).not.toThrow()
  })
  it('keeps cross-group arithmetic deferred for actual numeric result leaves', () => {
    const port = getModuleFieldContracts('1.02').ports.boundaries
    const raw: any = {outputs: {boundaries: {type: port.type, quality: 'limited', scope: 'Synthetic quantity', asOf: '2026-10-02', limitations: base.limitations,
      records: [{recordId: 'r', resultClass: 'observation_summary', area: {value: {value: 15, unit: '平方米', basis: 'Unverified operand fixture'}, claimClass: 'agent_inference', limitations: base.limitations}}]}},
      evidence: [{target: {port: 'boundaries', recordId: 'r', field: 'area', at: '/value'}, kind: 'calculation', calculation: {...calculation, operation: 'sum'}}]}
    expect(() => validateModuleProjectionFields('1.02', raw, {boundaries: ['area']}, corpus)).not.toThrow()
  })
  it('recovers only the native-verified prefix before an invalid complete author group, preserving original audit', async () => {
    const f = fixture(), before = hash(f.audit)
    const recovered = await recoverModuleAuthorGroups(f.context as any, {id: 'parent'} as any, f.classes as any, f.readEvents)
    expect(recovered.submissions.map(s => s.raw.groupId)).toEqual(f.raws.slice(0, 5).map(r => r.groupId))
    expect(recovered.attempts).toHaveLength(5)
    expect(f.readEvents).toHaveBeenCalledTimes(5)
    expect(hash(f.audit)).toBe(before)
  })
  it('still rejects corrupted native payloads in the preserved prefix', async () => {
    const f = fixture()
    f.events[0][2].data.arguments = '{}'
    await expect(recoverModuleAuthorGroups(f.context as any, {id: 'parent'} as any, f.classes as any, f.readEvents)).rejects.toThrow(/native payload mismatch/)
  })
  it('does not bypass an actual independent review rejection through prefix recovery', async () => {
    const f = fixture()
    f.audit.reviewReceipts.push({verdict: 'fail'})
    const recovered = await recoverModuleAuthorGroups(f.context as any, {id: 'parent'} as any, f.classes as any, f.readEvents)
    expect(recovered.submissions).toEqual([])
    expect(f.readEvents).not.toHaveBeenCalled()
  })
  it('delivers all actual calculation type conflicts to the owning native author, bound to original receipt', () => {
    const f = fixture(), before = hash(f.audit), raw = f.raws[5]
    const feedback = moduleRecoveryFeedback(f.context as any, raw.groupId)
    const rejected = JSON.parse(feedback.split('\n').at(-1)!).previousRejection
    expect(rejected.diagnosticExcerpt.scope).toBe('calculation-result-types-only')
    expect(rejected.diagnosticExcerpt.originalSubmissionHash).toBe(hash(raw))
    expect(rejected.diagnosticExcerpt.fieldCalculationConflicts).toContainEqual(expect.objectContaining({target: address, valueType: 'string'}))
    expect(feedback).not.toContain('GDP / population')
    expect(feedback).toContain('finite numeric result')
    expect(hash(f.audit)).toBe(before)
    expect(moduleRecoveryFeedback(f.context as any, 'market_context:4.1')).not.toContain('fieldCalculationConflicts')
  })
})
