import {expect, it, vi} from 'vitest'
import {getModuleFieldContracts} from '../src/research-v2/module-contracts.ts'
import {getModuleAuthorFieldGroups, getModuleAuthorGroupVersion, validateModuleAuthorGroup} from '../src/research-v2/module-author-groups.ts'
import {recoverDeferredModuleAuthorGroup, recoverModuleAuthorGroups} from '../src/research-v2/module-group-recovery.ts'
import {materialCorpusFingerprint} from '../src/materials/research-evidence.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'

const base = {documents: [], limitations: ['Synthetic boundary only; no original evidence']}
const corpus = {...base, fingerprint: materialCorpusFingerprint(base)}
const route = {provider: 'test', model: 'native-cycle-fixture'}
const target = (field: string) => ({port: 'project_brief', recordId: 'r', field, at: ''})
function fixture(crossGroup = false) {
  const contract = getModuleFieldContracts('1.01').ports.project_brief
  const raws: any[] = getModuleAuthorFieldGroups('1.01').map(group => ({
    projectionVersion: getModuleAuthorGroupVersion('1.01'), groupId: group.groupId,
    outputs: {project_brief: {type: contract.type, quality: 'limited', scope: 'Synthetic cycle recovery', asOf: '2026-10-06', limitations: base.limitations,
      records: [{recordId: 'r', resultClass: 'observation_summary', ...Object.fromEntries(group.fields.map(field => [field, {value: null, claimClass: 'missing', limitations: base.limitations}]))}]}},
    evidence: [], limitations: base.limitations,
    stepResults: Object.fromEntries([1, 2, 3, 4].map(step => ['step' + step, {status: 'limited', summary: 'Synthetic recovery boundary only', fieldRefs: [], limitations: base.limitations}]))
  }))
  const other = crossGroup ? 'commissionScope' : 'projectNature', otherGroup = crossGroup ? raws[2] : raws[1]
  for (const [raw, field, dependency] of [[raws[1], 'principal', other], [otherGroup, other, 'principal']] as const) {
    raw.outputs.project_brief.records[0][field] = {value: 'Synthetic ' + field, claimClass: 'agent_inference', limitations: base.limitations}
    raw.evidence.push({target: target(field), kind: 'inference', rationale: 'Synthetic inference only', inputRefs: [{local: target(dependency)}]})
  }
  const attempts = raws.map((raw, i) => ({classId: 'text', status: 'completed', groupId: raw.groupId, structuredOutput: raw,
    structuredHash: hash(raw), outputsJsonHash: hash(raw.outputs), executionId: 'exec-' + i, childId: 'child-' + i, actualModel: route,
    stopReason: 'completed', sourceContextFingerprint: 'synthetic-source-fingerprint'}))
  const events = raws.map((raw, i) => [
    {seq: 1, type: 'turn/start', data: {turn: 1}},
    {seq: 2, type: 'request/header', data: {header: {config: route}}},
    {seq: 3, type: 'tool/call', data: {turn: 1, step: 1, callId: 'call-' + i, name: 'structured_output', arguments: JSON.stringify(raw)}},
    {seq: 4, type: 'tool/result', data: {turn: 1, step: 1, message: {content: [{type: 'tool-result', toolCallId: 'call-' + i, isError: false}]}}},
    {seq: 5, type: 'turn/end', data: {turn: 1, reason: {kind: 'completed'}}}
  ])
  const audit = {attempts, reviewReceipts: [] as any[]}
  const context = {module: {id: '1.01'}, projectId: 'project', corpus, upstream: [], resumeExecutionAudit: audit,
    resumeExecutionError: 'MODULE_CLAIM_CYCLE: original-cycle', signal: new AbortController().signal}
  const classes = {execution: (id: string) => {const a = attempts.find(a => a.executionId === id); return a && {...a,
    id, projectId: 'project', parentId: 'parent', actual: route, childStopReason: 'completed', activity: 'idle', task: '1.01 synthetic native author'}}}
  const readEvents = vi.fn(async (id: string) => events[Number(id.split('-')[1])])
  const recover = () => recoverModuleAuthorGroups(context as any, {id: 'parent'} as any, classes as any, readEvents as any, 'synthetic-source-fingerprint')
  return {raws, audit, context, classes, events, readEvents, recover}
}

it('rejects a closed same-group cycle before complete merge without changing the draft or prefix', () => {
  const f = fixture(), before = hash(f.raws)
  expect(() => validateModuleAuthorGroup('1.01', f.raws[1], f.raws.slice(0, 1), corpus, [])).toThrow('MODULE_CLAIM_CYCLE')
  expect(hash(f.raws)).toBe(before)
})
it('accepts an acyclic dependency on an actually authored independent local value', () => {
  const f = fixture(), raw = f.raws[1]
  raw.outputs.project_brief.records[0].projectNature.claimClass = 'decision'
  raw.evidence[1] = {target: target('projectNature'), kind: 'proposal', rationale: 'Synthetic conditional proposal only'}
  expect(validateModuleAuthorGroup('1.01', raw, f.raws.slice(0, 1), corpus, [])).toEqual(raw)
})
it('rejects a cross-group cycle when its final edge arrives', () => {
  const f = fixture(true), before = hash(f.raws)
  expect(() => validateModuleAuthorGroup('1.01', f.raws[2], f.raws.slice(0, 2), corpus, [])).toThrow('MODULE_CLAIM_CYCLE')
  expect(hash(f.raws)).toBe(before)
})
it.each([false, true])('retains only the original native-verified prefix before the earliest cycle owner (cross-group=%s)', async crossGroup => {
  const f = fixture(crossGroup), before = hash(f.audit), recovered = await f.recover()
  expect(recovered.submissions.map(s => s.raw)).toEqual(f.raws.slice(0, 1))
  expect(recovered.attempts).toEqual(f.audit.attempts.slice(0, 1))
  expect(recovered.deferredAttempts?.map(a => a.groupId)).toEqual(['project_brief:3', 'project_brief:4'])
  expect(f.readEvents).toHaveBeenCalledTimes(1)
  expect(hash(f.audit)).toBe(before)
})
it('requires untouched deferred suffixes to pass native replay and the new prefix before reuse', async () => {
  const f = fixture(), recovered = await f.recover()
  expect(recovered.deferredAttempts).toHaveLength(2)
  const deferred = recovered.deferredAttempts![0]
  const replacement = structuredClone(f.raws[1])
  for (const field of ['principal', 'projectNature']) replacement.outputs.project_brief.records[0][field] = {value: null, claimClass: 'missing', limitations: base.limitations}
  replacement.evidence = []
  const prior = [f.raws[0], replacement], before = hash(f.audit)
  const checked = await recoverDeferredModuleAuthorGroup(f.context as any, {id: 'parent'} as any, f.classes as any, f.readEvents as any,
    deferred, prior, 'synthetic-source-fingerprint')
  expect(checked.raw).toEqual(f.raws[2]); expect(hash(f.audit)).toBe(before)
  f.events[2][2].data.arguments = '{}'
  await expect(recoverDeferredModuleAuthorGroup(f.context as any, {id: 'parent'} as any, f.classes as any, f.readEvents as any,
    deferred, prior, 'synthetic-source-fingerprint')).rejects.toThrow('native payload mismatch')
})
it('rejects payload drift in the retained prefix instead of treating recovery as acceptance', async () => {
  const f = fixture(); f.events[0][2].data.arguments = '{}'
  await expect(f.recover()).rejects.toThrow('native payload mismatch')
})
it('does not bypass a submitted independent review or recover a prefix with a changed source binding', async () => {
  const f = fixture(); f.audit.reviewReceipts.push({verdict: 'fail'})
  expect((await f.recover()).submissions).toEqual([]); expect(f.readEvents).not.toHaveBeenCalled()
  f.audit.reviewReceipts = []; f.audit.attempts[0].sourceContextFingerprint = 'different-source'
  expect((await f.recover()).submissions).toEqual([]); expect(f.readEvents).not.toHaveBeenCalled()
})
