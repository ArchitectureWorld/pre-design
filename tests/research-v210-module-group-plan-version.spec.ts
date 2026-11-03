import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { getModuleFieldContracts } from '../src/research-v2/module-contracts.ts'
import { sha256CanonicalJson } from '../src/presentation/canonical-json.ts'
import * as groups from '../src/research-v2/module-author-groups.ts'
import { recoverModuleAuthorGroups } from '../src/research-v2/module-group-recovery.ts'

const legacy = 'module-author-field-group.v5' as const
const split = 'module-author-field-group.v6' as const
const current = 'module-author-field-group.v7' as const
const newest = 'module-author-field-group.v8' as const
const base = { documents: [], limitations: ['Synthetic replay test only'] }
const corpus = { ...base, fingerprint: createHash('sha256').update(JSON.stringify(base)).digest('hex') }
function submissions(version: typeof legacy | typeof split | typeof current | typeof newest) {
  return groups.getModuleAuthorFieldGroups('1.07', version).map(group => ({
    projectionVersion: version, groupId: group.groupId,
    outputs: { site_use: { type: getModuleFieldContracts('1.07').ports.site_use.type,
      scope: 'Synthetic version replay', asOf: '2026-09-30', quality: 'limited' as const,
      limitations: ['No field observations'], records: [{ recordId: 'synthetic-row', resultClass: 'observation_summary',
        ...Object.fromEntries(group.fields.map(field => [field, { value: null, claimClass: 'missing', limitations: ['No original evidence'] }])) }] } },
    evidence: [], limitations: ['Synthetic test only'],
    stepResults: Object.fromEntries([1, 2, 3, 4].map(step => [`step${step}`, {
      status: 'limited', summary: 'Synthetic incomplete research', fieldRefs: [], limitations: ['No actual execution'] }])) as any,
  }))
}
const receipt = (index: number) => ({ executionId: `test-execution-${index}`, childId: `test-child-${index}`,
  actualModel: { provider: 'test', model: 'test' }, stopReason: 'completed' })

describe('version-bound reduction of the oversized site-use group', () => {
  it('bounds new spatial authors separately without changing any historical v7 field plan', () => {
    const historical=groups.getModuleAuthorFieldGroups('1.07','module-author-field-group.v7')
    const latest=groups.getModuleAuthorFieldGroups('1.07')
    expect(latest.slice(0,2)).toEqual([
      {groupId:'site_use:1.1',port:'site_use',fields:['spaceId','assetId']},
      {groupId:'site_use:1.2',port:'site_use',fields:['geometry','geometryVersion']}])
    expect(latest.slice(2)).toEqual(historical.slice(1))
    expect(latest.flatMap(group=>group.fields)).toEqual(historical.flatMap(group=>group.fields))
    expect(historical[0].groupId).toBe('site_use:1')
    expect(groups.isCurrentModuleAuthorPrefix('1.07',submissions(current).slice(0,3))).toBe(false)
  })
  it('recovers only the original native-verified v8 prefix and rejects payload drift', async () => {
    const raws = submissions(newest).slice(0, 3), route = { provider: 'test', model: 'test' }
    const attempts = raws.map((raw, index) => ({ classId: 'text', groupId: raw.groupId, status: 'completed',
      structuredOutput: raw, structuredHash: sha256CanonicalJson(raw), outputsJsonHash: sha256CanonicalJson(raw.outputs),
      executionId: `e${index}`, childId: `c${index}`, actualModel: route, stopReason: 'completed', sourceContextFingerprint: 'source-fingerprint' }))
    const context = { module: { id: '1.07' }, projectId: 'p', corpus, upstream: [], signal: new AbortController().signal,
      resumeExecutionAudit: { attempts, reviewReceipts: [] } }
    const classes = { execution: (id: string) => ({ ...attempts.find(a => a.executionId === id), projectId: 'p',
      parentId: 'parent', actual: route, childStopReason: 'completed', activity: 'idle', task: '1.07 synthetic native recovery' }) }
    const events = async (id: string) => {
      const raw = raws[Number(id.slice(1))]
      return [
        { seq: 1, type: 'turn/start', data: { turn: 1 } },
        { seq: 2, type: 'request/header', data: { header: { config: route } } },
        { seq: 3, type: 'tool/call', data: { turn: 1, step: 0, callId: 'call', name: 'structured_output', arguments: JSON.stringify(raw) } },
        { seq: 4, type: 'tool/result', data: { turn: 1, step: 0, message: { content: [{ type: 'tool-result', toolCallId: 'call', isError: false }] } } },
        { seq: 5, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
      ]
    }
    const before = structuredClone(context.resumeExecutionAudit)
    const recovered = await recoverModuleAuthorGroups(context as never, { id: 'parent' } as never, classes as never, events, 'source-fingerprint')
    expect(recovered.submissions.map(s => s.raw)).toEqual(raws)
    expect(context.resumeExecutionAudit).toEqual(before)
    attempts[0].structuredOutput = structuredClone(raws[0]); attempts[0].structuredOutput.limitations.push('altered')
    attempts[0].structuredHash = sha256CanonicalJson(attempts[0].structuredOutput)
    await expect(recoverModuleAuthorGroups(context as never, { id: 'parent' } as never, classes as never, events, 'source-fingerprint'))
      .rejects.toThrow('native payload mismatch')
    expect(groups.isCurrentModuleAuthorPrefix('1.07', submissions(split).slice(0, 4))).toBe(false)
    expect(groups.isCurrentModuleAuthorPrefix('1.02', raws)).toBe(false)
  })
  it('requires new authors for an unfinished historical plan without relabelling its native prefix', async () => {
    const audit = { attempts: [{ status: 'completed', structuredOutput: submissions(legacy)[0] }], reviewReceipts: [] }
    const before = structuredClone(audit)
    const context = { module: { id: '1.07' }, projectId: 'p', corpus, upstream: [],
      signal: new AbortController().signal, resumeExecutionAudit: audit }
    const result = await recoverModuleAuthorGroups(context as never, {} as never, {} as never,
      async () => { throw new Error('Historical prefix must not be rebound to the current plan') })
    expect(result).toEqual({ submissions: [], attempts: [] })
    expect(audit).toEqual(before)
  })
  it('splits only the four-field photo/conflicts group while preserving every complete field and the first three groups', () => {
    const old = groups.getModuleAuthorFieldGroups('1.07', legacy), next = groups.getModuleAuthorFieldGroups('1.07',current)
    expect(next.slice(0, 3)).toEqual(old.slice(0, 3))
    expect(next.slice(3).map(group => group.fields)).toEqual([['photoLocation', 'photoDirection'], ['photoDate'], ['conflicts']])
    expect(next.slice(3).map(group => group.groupId)).toEqual(['site_use:4.1', 'site_use:4.2', 'site_use:4.3'])
    expect(next.flatMap(group => group.fields)).toEqual(old.flatMap(group => group.fields))
    expect(groups.getModuleAuthorFieldGroups('2.02', current)).toEqual(groups.getModuleAuthorFieldGroups('2.02', legacy))
    expect(groups.getModuleAuthorGroupSchema('1.07', 'site_use:4.2').properties!.projectionVersion.const).toBe(newest)
  })
  it('replays an unchanged native v5 audit using its original four-field plan and rejects a relabelled audit', () => {
    const raws = submissions(legacy), candidate = groups.compileModuleAuthorGroups('1.07', raws, corpus)
    const audit = groups.createModuleAuthorGroupsAudit('1.07', raws.map((raw, index) => ({ raw, receipt: receipt(index) })), candidate)
    expect(audit.planHash).toBe(sha256CanonicalJson({ version: legacy, itemId: '1.07', groups: groups.getModuleAuthorFieldGroups('1.07', legacy) }))
    expect(groups.replayModuleAuthorGroups('1.07', corpus, audit)).toEqual(candidate)
    expect(() => groups.replayModuleAuthorGroups('1.07', corpus, { ...audit, version: current })).toThrow('MODULE_GROUP_AUDIT')
  })
  it.each([split, current, newest])('validates the split native %s receipts without migrating or mixing historical payloads', version => {
    const raws = submissions(version), before = structuredClone(raws)
    for (let index = 0; index < raws.length; index++) expect(groups.validateModuleAuthorGroup('1.07', raws[index], raws.slice(0, index), corpus)).toEqual(raws[index])
    const candidate = groups.compileModuleAuthorGroups('1.07', raws, corpus)
    const audit = groups.createModuleAuthorGroupsAudit('1.07', raws.map((raw, index) => ({ raw, receipt: receipt(index) })), candidate)
    expect(audit.version).toBe(version)
    expect(groups.replayModuleAuthorGroups('1.07', corpus, audit)).toEqual(candidate)
    expect(raws).toEqual(before)
    const mixed = structuredClone(raws); mixed[1].projectionVersion = legacy
    expect(() => groups.compileModuleAuthorGroups('1.07', mixed, corpus)).toThrow('MODULE_GROUP_VERSION_MIXED')
  })
})
