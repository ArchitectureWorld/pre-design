import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { assertObjectJsonSchema, validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import { loadPlanningCatalog } from '../src/research-v2/catalog.ts'
import { getModuleFieldContracts } from '../src/research-v2/module-contracts.ts'
import { compileModuleAuthorProjection } from '../src/research-v2/module-author-projection.ts'
import { validateModuleClaims } from '../src/research-v2/module-claims.ts'
import { sha256CanonicalJson } from '../src/presentation/canonical-json.ts'

async function api() { return import('../src/research-v2/module-author-groups.ts') }
const text = '正式名称：甲水库、乙水库。'
const document = { path: '原始资料/source.txt', contentHash: createHash('sha256').update(text).digest('hex'), byteLength: Buffer.byteLength(text), text }
const base = { documents: [document], limitations: ['历史资料'] }
const corpus = { ...base, fingerprint: createHash('sha256').update(JSON.stringify(base)).digest('hex') }
function full() {
  const port = getModuleFieldContracts('1.01').ports.project_brief
  return { projectionVersion: 'module-author-projection.v1', outputs: { project_brief: { type: port.type, quality: 'limited', scope: '原文核对', asOf: '2026-09-27', limitations: ['历史资料'],
    records: ['甲水库', '乙水库'].map((name, index) => ({ recordId: `r${index}`, resultClass: 'observation_summary',
      ...Object.fromEntries(port.fields.map(field => [field.name, { value: null, claimClass: 'missing', limitations: ['资料未提供'] }])),
      formalName: { value: name, claimClass: 'source_conclusion', limitations: ['历史名称'] } })) } },
    evidence: ['r0', 'r1'].map(recordId => ({ target: { port: 'project_brief', recordId, field: 'formalName', at: '' }, kind: 'source' as const, source: { path: document.path, quote: text } })),
    limitations: ['历史资料'], steps: [1, 2, 3, 4].map(step => ({ step, status: 'limited' as 'limited' | 'completed', summary: `原文名称核对步骤${step}`, fieldRefs: [], limitations: ['尚缺资料'] })) }
}
async function pieces() {
  const { getModuleAuthorFieldGroups } = await api(), raw = full()
  return getModuleAuthorFieldGroups('1.01').map(group => ({ projectionVersion: 'module-author-field-group-json.v3' as const, groupId: group.groupId,
    outputsJson: JSON.stringify({ project_brief: { ...raw.outputs.project_brief, records: raw.outputs.project_brief.records.map(record => ({
      recordId: record.recordId, resultClass: record.resultClass, ...Object.fromEntries(group.fields.map(field => [field, (record as any)[field]])),
    })) } }), evidence: raw.evidence.filter(e => group.fields.includes(e.target.field)), limitations: raw.limitations,
    steps: raw.steps.map(s => ({ ...s, summary: `${s.summary}/${group.groupId}` })) }))
}
const receipt = (i: number) => ({ executionId: `execution-${i}`, childId: `child-${i}`, actualModel: { provider: 'test', model: 'same-route' }, stopReason: 'completed' })

it('retains exact record-to-photo addresses for metadata authors without copying quotes, selecting a competing image, or changing prior receipts', async () => {
  const a=await api(),{expandModuleReferencePromptView}=await import('../src/research-v2/module-reference-context.ts')
  const raws=a.getModuleAuthorFieldGroups('1.07').slice(0,5).map(group=>({projectionVersion:a.MODULE_AUTHOR_GROUP_VERSION,groupId:group.groupId,
    outputs:{site_use:{type:getModuleFieldContracts('1.07').ports.site_use.type,quality:'limited',scope:'Synthetic camera identity test',asOf:'2026-10-01',limitations:['Unverified camera samples'],
      records:[{recordId:'r0',resultClass:'observation_summary',...Object.fromEntries(group.fields.map(field=>[field,{value:null,claimClass:'missing',limitations:['No original support']}]))}]}},
    evidence:[],limitations:['Unverified camera samples'],stepResults:Object.fromEntries([1,2,3,4].map(n=>['step'+n,{status:'limited',summary:'Unverified sample',fieldRefs:[],limitations:['No original support']}]))})) as any[]
  raws[0].outputs.site_use.records[0].spaceId={value:'working-A',claimClass:'decision',limitations:['Working identity only']}
  raws[0].evidence=[{kind:'proposal',target:{port:'site_use',recordId:'r0',field:'spaceId',at:''},rationale:'Author associates working-A with A.JPG at 15:56:21; not surveyed.'}]
  raws[1].outputs.site_use.records[0].geometry={value:{type:'Point',coordinates:[114.9,30.8]},claimClass:'source_conclusion',limitations:['Camera point only']}
  raws[1].evidence=[{kind:'source',target:{port:'site_use',recordId:'r0',field:'geometry',at:'/type'},source:{path:'photos/A.JPG',quote:'private-first-image-quote'}}]
  raws[4].outputs.site_use.records[0].photoLocation={value:{x:'114.9',y:'30.8',crs:'WGS-84',axisOrder:'xy'},claimClass:'source_conclusion',limitations:['Camera tags only']}
  raws[4].evidence=[{kind:'source',target:{port:'site_use',recordId:'r0',field:'photoLocation',at:'/x'},source:{path:'photos/B.JPG',quote:'private-second-image-quote',valueQuote:'114.9'}}]
  const before=structuredClone(raws),view=a.getModuleAuthorMetadataGroupPromptView('1.07',raws),context:any=expandModuleReferencePromptView(view)
  expect(context.photoSourceBindings).toEqual(raws.filter(raw=>raw.evidence.some((e:any)=>e.kind==='source')).map(raw=>({groupId:raw.groupId,recordId:'r0',sourcePath:raw.evidence[0].source.path,
    originalSubmissionHash:sha256CanonicalJson(raw),targets:[{field:raw.evidence[0].target.field,at:raw.evidence[0].target.at}]})))
  const identity=[{groupId:raws[0].groupId,originalSubmissionHash:sha256CanonicalJson(raws[0]),target:raws[0].evidence[0].target,
    kind:'proposal',rationale:raws[0].evidence[0].rationale}]
  expect(a.getModuleAuthorGroupPromptContext('1.07',raws).recordIdentityDiagnostics).toEqual(identity)
  expect(context.recordIdentityDiagnostics).toEqual(identity)
  expect(context.omittedPhotoFieldDiagnostics).toContainEqual({groupId:raws[1].groupId,recordId:'r0',field:'geometry',originalSubmissionHash:sha256CanonicalJson(raws[1]),
    claimClass:'source_conclusion',limitations:['Camera point only']})
  // Missing geometry carries object/time assertions too; absence of evidence must not hide them.
  const missing=structuredClone(raws)
  missing[1].outputs.site_use.records[0].geometry={value:null,claimClass:'missing',limitations:['B.JPG camera at 15:59:09; object mapping unconfirmed.']}
  missing[1].evidence=[]
  const missingContext:any=expandModuleReferencePromptView(a.getModuleAuthorMetadataGroupPromptView('1.07',missing))
  expect(missingContext.omittedPhotoFieldDiagnostics).toContainEqual({groupId:missing[1].groupId,recordId:'r0',field:'geometry',originalSubmissionHash:sha256CanonicalJson(missing[1]),
    claimClass:'missing',limitations:missing[1].outputs.site_use.records[0].geometry.limitations})
  expect(missingContext.outputs.site_use.records[0]).not.toHaveProperty('geometry')
  expect(missingContext.photoSourceBindings.some((b:any)=>b.groupId===missing[1].groupId)).toBe(false)
  expect(context.previousGroupScope.boundary).toContain('不得按记录序号或来源列表排序猜配照片')
  expect(context.outputs.site_use.records[0]).not.toHaveProperty('geometry')
  expect(JSON.stringify(view)).not.toMatch(/private-first-image-quote|private-second-image-quote/)
  expect(context.groupReceipts.map((r:any)=>r.projectionHash)).toEqual(raws.map(sha256CanonicalJson))
  expect(raws).toEqual(before)
})

it('shares repeated prior-group context without changing any complete authored value or original receipt hash', async () => {
  const a = await api() as any
  expect(typeof a.getModuleAuthorGroupPromptView).toBe('function')
  const { expandModuleReferencePromptView } = await import('../src/research-v2/module-reference-context.ts')
  const raws = await pieces()
  const constraint = 'Same inherited restriction: unverified, not approved, never a current fact. '.repeat(30)
  for (const raw of raws) {
    const outputs = JSON.parse(raw.outputsJson)
    for (const row of outputs.project_brief.records) for (const field of Object.values(row) as any[]) {
      if (field && typeof field === 'object' && Array.isArray(field.limitations)) field.limitations.push(constraint)
    }
    raw.outputsJson = JSON.stringify(outputs)
  }
  const before = structuredClone(raws), original = a.getModuleAuthorGroupPromptContext('1.01', raws)
  const view = a.getModuleAuthorGroupPromptView('1.01', raws)
  expect(view.encoding).toBe('research-reference.v1')
  expect(JSON.stringify(view).length).toBeLessThan(JSON.stringify(original).length * 0.5)
  expect(expandModuleReferencePromptView(view)).toEqual(original)
  expect(raws).toEqual(before)
})

// An independent author fixture for the new transport, not a migration of a failed native receipt.
async function fixedStepPieces() {
  return (await pieces()).map(({ steps, ...raw }) => ({ ...raw, projectionVersion: 'module-author-field-group-json.v4' as const,
    stepResults: Object.fromEntries(steps.map(({ step, ...entry }) => [`step${step}`, entry])) as Record<'step1' | 'step2' | 'step3' | 'step4', Omit<typeof steps[number], 'step'>> }))
}

describe('native object field-group submission', () => {
  it('lists every missing-field evidence address for native correction without changing missing values', async () => {
    const a = await api(), raw = (await pieces())[0], outputs = JSON.parse(raw.outputsJson)
    for (const record of outputs.project_brief.records) record.formalName = { value: null, claimClass: 'missing', limitations: ['真实缺失'] }
    raw.outputsJson = JSON.stringify(outputs)
    const before = structuredClone(raw)
    expect(() => a.validateModuleAuthorGroup('1.01', raw, [], corpus)).toThrow(/MODULE_GROUP_MISSING_EVIDENCE:.*r0.*formalName.*r1.*formalName.*remove.*evidence/)
    expect(raw).toEqual(before)
  })
  it.each(['scope', 'asOf', 'record-id', 'result-class'] as const)(
    'rejects changed %s in the native tool schema before returning the later group', async mode => {
      const a = await api(), old = await fixedStepPieces()
      const raws = old.map(({ outputsJson, ...raw }) => ({ ...raw, projectionVersion: 'module-author-field-group.v8' as const, outputs: JSON.parse(outputsJson) }))
      const schema = a.getModuleAuthorGroupSchema('1.01', raws[1].groupId, [raws[0]] as any)
      expect(() => assertObjectJsonSchema(schema)).not.toThrow()
      expect(validateJsonSchemaValue(schema, raws[1])).toEqual([])
      const bad = structuredClone(raws[1]), port = bad.outputs.project_brief
      if (mode === 'scope') port.scope = '重新概括范围'
      if (mode === 'asOf') port.asOf = '2026-09-28'
      if (mode === 'record-id') port.records[0].recordId = 'invented-record'
      if (mode === 'result-class') port.records[0].resultClass = 'proposal'
      const before = structuredClone(bad)
      expect(validateJsonSchemaValue(schema, bad)).not.toEqual([])
      expect(bad).toEqual(before)
    })

  it('keeps authored values free while preserving the exact frozen port metadata and record identities', async () => {
    const a = await api(), old = await fixedStepPieces()
    const raws = old.map(({ outputsJson, ...raw }) => ({ ...raw, projectionVersion: 'module-author-field-group.v8' as const, outputs: JSON.parse(outputsJson) }))
    const previous = structuredClone(raws[0]), schema = a.getModuleAuthorGroupSchema('1.01', raws[1].groupId, [previous] as any)
    const port = schema.properties!.outputs.properties!.project_brief
    expect(port.properties!.scope.const).toBe(previous.outputs.project_brief.scope)
    expect(port.properties!.asOf.const).toBe(previous.outputs.project_brief.asOf)
    expect(port.properties!.records.items!.properties!.recordId.enum).toEqual(['r0', 'r1'])
    expect(port.properties!.records.description).toContain('恰有2条记录')
    const field = a.getModuleAuthorFieldGroups('1.01')[1].fields[0]
    expect(port.properties!.records.items!.properties![field].const).toBeUndefined()
    expect(previous).toEqual(raws[0])
    const reordered = structuredClone(raws[1]); reordered.outputs.project_brief.records.reverse()
    expect(validateJsonSchemaValue(schema, reordered)).toEqual([])
  })

  it('accepts bounded native outputs and replays their exact values without an inner JSON string', async () => {
    const a = await api(), old = await fixedStepPieces()
    const raws = old.map(({ outputsJson, ...raw }) => ({ ...raw, projectionVersion: 'module-author-field-group.v8' as const, outputs: JSON.parse(outputsJson) }))
    const schema = a.getModuleAuthorGroupSchema('1.01', raws[0].groupId)
    expect(validateJsonSchemaValue(schema, raws[0])).toEqual([])
    expect(schema.properties?.outputsJson).toBeUndefined()
    expect(schema.properties?.outputs.type).toBe('object')
    const before = structuredClone(raws)
    const candidate = a.compileModuleAuthorGroups('1.01', raws as any, corpus)
    expect(candidate).toEqual(a.compileModuleAuthorGroups('1.01', old, corpus))
    const audit = a.createModuleAuthorGroupsAudit('1.01', raws.map((raw,i) => ({ raw, receipt: receipt(i) })) as any, candidate)
    expect(a.replayModuleAuthorGroups('1.01', corpus, audit)).toEqual(candidate)
    expect(raws).toEqual(before)
    for (const alter of [
      (g: any) => { g.outputs = JSON.stringify(g.outputs) },
      (g: any) => { g.outputsJson = JSON.stringify(g.outputs); delete g.outputs },
      (g: any) => { g.outputsJson = '{}' },
    ]) {
      const bad = structuredClone(raws[0]); alter(bad)
      expect(() => a.validateModuleAuthorGroup('1.01', bad, [], corpus)).toThrow(/MODULE_GROUP_/)
    }
    const tampered = structuredClone(audit) as any
    tampered.groups[0].raw.outputs.project_brief.records[0].formalName.value = '篡改名称'
    expect(() => a.replayModuleAuthorGroups('1.01', corpus, tampered)).toThrow(/HASH/)
  })
})

describe('fixed-key v4 author step transport', () => {
  it.each(['/value', 'value', '/~2'])('reports the exact invalid field-relative pointer %s without rewriting it', async at => {
    const a = await api(), [first] = await fixedStepPieces()
    const bad = structuredClone(first); bad.evidence[0].target.at = at
    const before = JSON.stringify(bad)
    let error = ''
    try { a.validateModuleAuthorGroup('1.01', bad, [], corpus) } catch (cause) { error = (cause as Error).message }
    expect(error).toContain('MODULE_GROUP_POINTER')
    expect(error).toContain('/evidence/0/target/at')
    expect(error).toContain('formalName')
    expect(error).toContain('scalar root')
    expect(JSON.stringify(bad)).toBe(before)
  })

  it.each(['scope', 'asOf', 'record-count', 'record-id', 'result-class'] as const)('locates changed %s anchors without rewriting submitted values', async mode => {
    const a = await api(), [first, second] = await fixedStepPieces()
    const outputs = JSON.parse(second.outputsJson), port = outputs.project_brief
    if (mode === 'scope') port.scope = '重新概括范围'
    if (mode === 'asOf') port.asOf = '2026-09-28'
    if (mode === 'record-count') port.records.pop()
    if (mode === 'record-id') port.records[0].recordId = 'replaced-record'
    if (mode === 'result-class') port.records[0].resultClass = 'proposal'
    const changed = { ...second, outputsJson: JSON.stringify(outputs) }, before = JSON.stringify(changed)
    let error = ''
    try { a.validateModuleAuthorGroup('1.01', changed, [first], corpus) } catch (cause) { error = (cause as Error).message }
    expect(error).toContain('MODULE_GROUP_ANCHOR')
    expect(error).toContain('/outputs/project_brief/')
    expect(error).toContain(mode === 'scope' || mode === 'asOf' ? mode : 'records')
    if (mode === 'scope') expect(error).toContain('原文核对')
    expect(JSON.stringify(changed)).toBe(before)
  })

  it('requires four authored objects at the native boundary instead of accepting the observed string-to-empty-array escape', async () => {
    const { getModuleAuthorGroupSchema } = await api(), [{ outputsJson, ...original }] = await fixedStepPieces()
    const raw = { ...original, projectionVersion: 'module-author-field-group.v8' as const, outputs: JSON.parse(outputsJson) }
    const schema = getModuleAuthorGroupSchema('1.01', raw.groupId)
    expect(() => assertObjectJsonSchema(schema)).not.toThrow()
    expect(validateJsonSchemaValue(schema, raw)).toEqual([])
    expect(schema.properties?.projectionVersion.const).toBe('module-author-field-group.v8')
    const { stepResults: _stepResults, ...base } = raw
    // Native seq14/19/24 encoded the four steps as a string missing its final ']'; seq29 used [].
    const recordedFailureShape = JSON.stringify(full().steps).slice(0, -1)
    for (const wrong of [{ ...base, steps: recordedFailureShape }, { ...base, steps: [] },
      { ...base, stepResults: recordedFailureShape }, { ...base, stepResults: [] }, { ...base, stepResults: {} }]) {
      expect(validateJsonSchemaValue(schema, wrong)).not.toEqual([])
    }
  })

  it.each(['missing-step', 'extra-step', 'wrong-step-type', 'missing-summary', 'extra-step-id', 'empty-summary', 'illegal-ref', 'limited-without-reason'] as const)(
    'rejects %s without filling or rewriting authored steps', async mode => {
      const { validateModuleAuthorGroup } = await api(), [raw] = await fixedStepPieces(), bad: any = structuredClone(raw)
      if (mode === 'missing-step') delete bad.stepResults.step3
      if (mode === 'extra-step') bad.stepResults.step5 = structuredClone(bad.stepResults.step4)
      if (mode === 'wrong-step-type') bad.stepResults.step2 = JSON.stringify(bad.stepResults.step2)
      if (mode === 'missing-summary') delete bad.stepResults.step1.summary
      if (mode === 'extra-step-id') bad.stepResults.step1.step = 4
      if (mode === 'empty-summary') bad.stepResults.step1.summary = '  '
      if (mode === 'illegal-ref') bad.stepResults.step2.fieldRefs = [{ port: 'project_brief', recordId: 'invented', field: 'formalName', at: '' }]
      if (mode === 'limited-without-reason') bad.stepResults.step4.limitations = []
      const before = JSON.stringify(bad)
      expect(() => validateModuleAuthorGroup('1.01', bad, [], corpus)).toThrow(/MODULE_GROUP_(SCHEMA|STEPS)/)
      expect(JSON.stringify(bad)).toBe(before)
    })

  it('only expands fixed identities, keeps all author content, and roundtrips version-bound raw receipts', async () => {
    const { compileModuleAuthorGroups, createModuleAuthorGroupsAudit, replayModuleAuthorGroups } = await api()
    const legacy = await pieces(), raws = await fixedStepPieces(), before = structuredClone(raws)
    const candidate = compileModuleAuthorGroups('1.01', raws, corpus)
    expect(candidate).toEqual(compileModuleAuthorGroups('1.01', legacy, corpus))
    expect(raws).toEqual(before)
    const audit = createModuleAuthorGroupsAudit('1.01', raws.map((raw, i) => ({ raw, receipt: receipt(i) })), candidate)
    expect(audit.version).toBe('module-author-field-group-json.v4')
    expect(audit.planHash).toBe(sha256CanonicalJson({ version: audit.version, itemId: '1.01', groups: (await api()).getModuleAuthorFieldGroups('1.01') }))
    expect(audit.groups.map(group => group.raw)).toEqual(raws)
    expect(replayModuleAuthorGroups('1.01', corpus, audit)).toEqual(candidate)
    for (const change of [
      (value: any) => { value.groups[0].raw.stepResults.step1.summary += ' changed' },
      (value: any) => { value.groups[0].raw.stepResults.step2.status = 'completed' },
      (value: any) => { value.groups[0].raw.projectionVersion = 'module-author-field-group-json.v3' },
      (value: any) => { value.version = 'module-author-field-group-json.v3' },
    ]) { const bad = structuredClone(audit); change(bad); expect(() => replayModuleAuthorGroups('1.01', corpus, bad)).toThrow(/MODULE_GROUP/) }
  })

  it('strictly replays v3 history and rejects mixed versions or old malformed steps without coercion', async () => {
    const { compileModuleAuthorGroups, createModuleAuthorGroupsAudit, replayModuleAuthorGroups, validateModuleAuthorGroup, getModuleAuthorFieldGroups } = await api()
    const raws = await pieces(), candidate = compileModuleAuthorGroups('1.01', raws, corpus)
    const audit = createModuleAuthorGroupsAudit('1.01', raws.map((raw, i) => ({ raw, receipt: receipt(i) })), candidate)
    expect(audit.version).toBe('module-author-field-group-json.v3')
    expect(audit.planHash).toBe(sha256CanonicalJson({ version: 'module-author-field-group-json.v3', itemId: '1.01', groups: getModuleAuthorFieldGroups('1.01') }))
    expect(replayModuleAuthorGroups('1.01', corpus, audit)).toEqual(candidate)
    for (const steps of [JSON.stringify(raws[0].steps), JSON.stringify(raws[0].steps).slice(0, -1), []]) {
      expect(() => validateModuleAuthorGroup('1.01', { ...raws[0], steps }, [], corpus)).toThrow(/MODULE_GROUP_(SCHEMA|STEPS)/)
    }
    const v4 = await fixedStepPieces()
    expect(() => compileModuleAuthorGroups('1.01', [raws[0], ...v4.slice(1)], corpus)).toThrow('MODULE_GROUP_VERSION_MIXED')
  })
})

describe('bounded complete-field author groups', () => {
  it.each(['module-absent', 'claim-absent', 'missing'] as const)('rejects an unavailable upstream %s while its owning author can still correct it', async mode => {
    const { validateModuleAuthorGroup } = await api(), [raw] = await pieces()
    const outputs = JSON.parse(raw.outputsJson)
    outputs.project_brief.records[0].formalName = { value: '研究采用名称', claimClass: 'agent_inference', limitations: ['条件判断'] }
    raw.outputsJson = JSON.stringify(outputs)
    raw.evidence[0] = { target: raw.evidence[0].target, kind: 'inference', rationale: '解释上游材料',
      inputRefs: [{ upstream: { moduleId: 'upstream-module', claimId: 'upstream-claim' } }] } as any
    const upstream = mode === 'module-absent' ? [] : [{ moduleId: 'upstream-module', claims: mode === 'claim-absent' ? [] : [{ claimId: 'upstream-claim', kind: 'missing', value: null }] }]
    const before = JSON.stringify({ raw, upstream })
    let error = ''
    try { (validateModuleAuthorGroup as any)('1.01', raw, [], corpus, upstream) } catch (cause) { error = String(cause) }
    expect(error).toContain('MODULE_CLAIM_UPSTREAM_MISSING')
    expect(error).toContain('group=project_brief:1')
    expect(error).toContain('/evidence/0/inputRefs/0/upstream')
    expect(error).toContain('upstream-claim')
    expect(JSON.stringify({ raw, upstream })).toBe(before)
    expect((validateModuleAuthorGroup as any)('1.01', raw, [], corpus, [{ moduleId: 'upstream-module', claims: [{ claimId: 'upstream-claim', kind: 'source', value: 'private-source-value' }] }]).groupId).toBe(raw.groupId)
  })

  it('identifies each invalid step location and preserves a mistyped reference verbatim', async () => {
    const { validateModuleAuthorGroup } = await api(), raws = await pieces(), raw = raws[0]
    raw.steps[0].fieldRefs = [{ port: 'project_brief', recordId: 'r0', field: ' formalName', at: '' }] as any
    raw.steps[1].summary = '  '
    raw.steps[2].limitations = []
    const before = structuredClone(raw)
    let error = ''
    try { validateModuleAuthorGroup('1.01', raw, [], corpus) } catch (value) { error = String(value) }
    expect(error).toContain('MODULE_GROUP_STEPS')
    expect(error).toContain('/steps/0/fieldRefs/0')
    expect(error).toContain('"field":" formalName"')
    expect(error).toContain('/steps/1/summary')
    expect(error).toContain('/steps/2/limitations')
    expect(raw).toEqual(before)
  })
  it.each(['source', 'proposal'] as const)('identifies the exact duplicate target even when the second evidence has a different %s body', async kind => {
    const { validateModuleAuthorGroup } = await api(), [raw] = await pieces(), target = structuredClone(raw.evidence[0].target)
    raw.evidence.push({ target, kind, ...(kind === 'source' ? { source: { path: document.path, quote: '甲水库' } }
      : { rationale: '本轮选择采用该名称作为研究对象。' }) } as any)
    const before = JSON.stringify(raw)
    expect(() => validateModuleAuthorGroup('1.01', raw, [], corpus)).toThrow(`MODULE_GROUP_EVIDENCE_DUPLICATE: target=${JSON.stringify(target)}`)
    expect(JSON.stringify(raw)).toBe(before)
  })
  it('rejects the exact native first submission locally for strict missing-field semantics, without modifying the raw receipt', async () => {
    const { validateModuleAuthorGroup } = await api()
    const fixture = JSON.parse(readFileSync(new URL('./fixtures/research-v210-native-group-first.json', import.meta.url), 'utf8'))
    const before = JSON.stringify(fixture.raw), base = { documents: [fixture.document], limitations: [fixture.boundary] }
    const frozen = { ...base, fingerprint: createHash('sha256').update(JSON.stringify(base)).digest('hex') }
    expect(() => validateModuleAuthorGroup('1.01', fixture.raw, [], frozen)).toThrow(/formalName|administrativeCode/)
    expect(JSON.stringify(fixture.raw)).toBe(before)
  })
  it('then rejects the real second alias leaf with no evidence, before any later group is requested', async () => {
    const { validateModuleAuthorGroup } = await api()
    const fixture = JSON.parse(readFileSync(new URL('./fixtures/research-v210-native-group-first.json', import.meta.url), 'utf8'))
    const outputs = JSON.parse(fixture.raw.outputsJson)
    // A separate corrected test input, never a migration or mutation of the real native receipt.
    delete outputs.project_brief.records[0].formalName.notApplicableReason
    delete outputs.project_brief.records[0].administrativeCode.notApplicableReason
    const corrected = { ...fixture.raw, outputsJson: JSON.stringify(outputs) }, base = { documents: [fixture.document], limitations: [fixture.boundary] }
    const frozen = { ...base, fingerprint: createHash('sha256').update(JSON.stringify(base)).digest('hex') }
    expect(() => validateModuleAuthorGroup('1.01', corrected, [], frozen)).toThrow('MODULE_CLAIM_VALUE_UNCOVERED: /outputs/project_brief/records/0/aliases/value/1')
    outputs.project_brief.records[0].aliases.value = ['少潭河水库']
    expect(validateModuleAuthorGroup('1.01', { ...fixture.raw, outputsJson: JSON.stringify(outputs) }, [], frozen).groupId).toBe('project_brief:1')
  })
  it('partitions every port exactly once into bounded complete fields without restricting record counts', async () => {
    const { getModuleAuthorFieldGroups, getModuleAuthorGroupOutputsSchema } = await api()
    for (const mod of loadPlanningCatalog().modules) {
      const groups = getModuleAuthorFieldGroups(mod.id)
      for (const [name, port] of Object.entries(getModuleFieldContracts(mod.id).ports)) {
        // Identity fields may be scheduled first; every field must still occur exactly once.
        expect(groups.filter(g => g.port === name).flatMap(g => g.fields).sort()).toEqual(port.fields.map(f => f.name).sort())
      }
      for (const group of groups) {
        expect(group.fields.length).toBeGreaterThan(0); expect(group.fields.length).toBeLessThanOrEqual(4)
        const schema = getModuleAuthorGroupOutputsSchema(mod.id, group.groupId)
        expect(Object.keys(schema.properties!)).toEqual([group.port])
        expect(Object.keys(schema.properties![group.port].properties!.records.items!.properties!)).toEqual(['recordId', 'resultClass', ...group.fields])
        for (const field of group.fields) {
          const envelope = schema.properties![group.port].properties!.records.items!.properties![field]
          const claimClasses = (envelope.oneOf ?? [envelope]).flatMap(branch => branch.properties!.claimClass.enum ?? [branch.properties!.claimClass.const])
          expect(new Set(claimClasses)).toEqual(new Set(['source_conclusion', 'agent_inference', 'assumption', 'decision', 'missing']))
        }
      }
    }
    expect(getModuleAuthorFieldGroups('1.01').map(g => g.fields.length)).toEqual([4, 4, 4, 2])
  })
  it('merges two-record submissions in original anchor order and keeps every group status and author statement', async () => {
    const { compileModuleAuthorGroups } = await api(), raws = await pieces(), before = structuredClone(raws)
    const reordered = JSON.parse(raws[1].outputsJson); reordered.project_brief.records.reverse(); raws[1].outputsJson = JSON.stringify(reordered)
    const result = compileModuleAuthorGroups('1.01', raws, corpus)
    const expected = compileModuleAuthorProjection('1.01', full(), corpus)
    expect(result.outputs).toEqual(expected.outputs); expect(result.claims).toEqual(expected.claims); expect(result.sourceValues).toEqual(expected.sourceValues)
    for (const step of result.steps) { expect(step.status).toBe('limited'); for (const raw of raws) expect(step.summary).toContain(raw.steps[step.step - 1].summary) }
    expect(raws[0]).toEqual(before[0])
  })
  it('gives later authors the actual previously submitted values and evidence, without inventing canonical claims', async () => {
    const { getModuleAuthorGroupContext } = await api(), raws = await pieces()
    const context = getModuleAuthorGroupContext('1.01', raws.slice(0, 1))
    expect((context[0].outputs.project_brief.records[0].formalName as any).value).toBe('甲水库')
    expect(context[0].evidence).toEqual(raws[0].evidence)
    expect(context[0]).not.toHaveProperty('claims'); expect(context[0]).not.toHaveProperty('sourceValues')
  })
  it('projects prior groups once for later authors, keeping all values and anchors while excluding duplicate evidence prose', async () => {
    const a = await api(), raws = await pieces(), before = structuredClone(raws)
    const context = a.getModuleAuthorGroupPromptContext('1.01', raws)
    expect(context.outputs).toEqual(full().outputs)
    expect(context.groupReceipts.map(row => row.groupId)).toEqual(raws.map(row => row.groupId))
    expect(context.groupReceipts.map(row => row.projectionHash)).toEqual(raws.map(row => sha256CanonicalJson(row)))
    expect(context.groupReceipts[0].evidenceCount).toBe(2)
    expect(context).not.toHaveProperty('evidence')
    expect(context).not.toHaveProperty('stepResults')
    expect(context.limitations).toEqual(['历史资料'])
    expect(context.evidenceOmission).toContain('原始')
    expect(JSON.stringify(context)).not.toContain('"quote"')
    expect(raws).toEqual(before)
    context.outputs.project_brief.records[0].formalName = { value: '改动副本' }
    expect(raws).toEqual(before)
  })
  it('checks the entire actual submitted prefix for central class and frozen-source errors without adding future fields', async () => {
    const { validateModuleAuthorGroup } = await api(), raws = await pieces(), original = structuredClone(raws)
    expect(validateModuleAuthorGroup('1.01', raws[1], raws.slice(0, 1), corpus)).toEqual(raws[1])
    expect(raws).toEqual(original)
    raws[0].evidence[0].source.quote = '原文没有这段话'
    expect(() => validateModuleAuthorGroup('1.01', raws[1], raws.slice(0, 1), corpus)).toThrow('MODULE_SOURCE_VALUE_QUOTE')
    raws[0] = structuredClone(original[0])
    const outputs = JSON.parse(raws[0].outputsJson); outputs.project_brief.records[0].formalName.claimClass = 'assumption'
    raws[0].outputsJson = JSON.stringify(outputs)
    expect(() => validateModuleAuthorGroup('1.01', raws[1], raws.slice(0, 1), corpus)).toThrow('MODULE_CLAIM_CLASS_MISMATCH')
  })
  it('checks calculations across groups only after collecting the actual prior values and never repairs wrong arithmetic', async () => {
    const { getModuleAuthorFieldGroups, getModuleAuthorGroupContext, compileModuleAuthorGroups, validateModuleAuthorGroup } = await api()
    const contract = getModuleFieldContracts('1.08'), sourceText = '设计容量 12.5 立方米，现用负荷 2.5 立方米。'
    const doc = { path: '原始资料/capacity.txt', contentHash: createHash('sha256').update(sourceText).digest('hex'), byteLength: Buffer.byteLength(sourceText), text: sourceText }
    const corpusBase = { documents: [doc], limitations: ['历史容量'] }, sourceCorpus = { ...corpusBase, fingerprint: createHash('sha256').update(JSON.stringify(corpusBase)).digest('hex') }
    const outputs: any = Object.fromEntries(Object.entries(contract.ports).map(([name, port]) => [name, { type: port.type, quality: 'limited', scope: '原件复算', asOf: '2026-09-27', limitations: ['未实测'], records: [{ recordId: 'r0', resultClass: 'observation_summary',
      ...Object.fromEntries(port.fields.map(field => [field.name, { value: null, claimClass: 'missing', limitations: ['未提供'] }])) }] }]))
    const address = (field: string) => ({ port: 'technical_baseline', recordId: 'r0', field, at: '/value' })
    for (const [field, value] of [['designCapacity', 12.5], ['currentLoad', 2.5], ['allocableCapacity', 10]] as const) outputs.technical_baseline.records[0][field] = {
      value: { value, unit: '立方米', basis: '原文复算' }, claimClass: field === 'allocableCapacity' ? 'agent_inference' : 'source_conclusion', limitations: ['历史原文复算，非已批准容量'] }
    const evidence: any[] = ['designCapacity', 'currentLoad'].map((field, i) => ({ target: address(field), kind: 'source', source: { path: doc.path, quote: sourceText, valueQuote: i === 0 ? '12.5' : '2.5' } }))
    evidence.push({ target: address('allocableCapacity'), kind: 'calculation', calculation: { operation: 'difference', operands: [{ local: address('designCapacity') }, { local: address('currentLoad') }] } })
    const raws = getModuleAuthorFieldGroups('1.08').map(group => ({ projectionVersion: 'module-author-field-group-json.v3' as const, groupId: group.groupId,
      outputsJson: JSON.stringify({ [group.port]: { ...outputs[group.port], records: outputs[group.port].records.map((r: any) => ({ recordId: r.recordId, resultClass: r.resultClass, ...Object.fromEntries(group.fields.map(field => [field, r[field]])) })) } }),
      evidence: evidence.filter(e => e.target.port === group.port && group.fields.includes(e.target.field)), limitations: ['历史容量'], steps: full().steps }))
    expect(getModuleAuthorGroupContext('1.08', raws.slice(0, 1))[0].outputs.technical_baseline.records[0].designCapacity).toEqual(outputs.technical_baseline.records[0].designCapacity)
    expect(() => validateModuleAuthorGroup('1.08', raws[1], raws.slice(0, 1), sourceCorpus)).not.toThrow()
    const compiled = compileModuleAuthorGroups('1.08', raws, sourceCorpus)
    expect(validateModuleClaims({ ...compiled, moduleId: contract.moduleId, upstream: [] }).claims.find(c => c.kind === 'calculation')?.value).toBe(10)
    const changed = JSON.parse(raws[1].outputsJson); changed.technical_baseline.records[0].allocableCapacity.value.value = 11; raws[1].outputsJson = JSON.stringify(changed)
    expect(() => validateModuleAuthorGroup('1.08', raws[1], raws.slice(0, 1), sourceCorpus)).not.toThrow()
    const wrong = compileModuleAuthorGroups('1.08', raws, sourceCorpus)
    expect(wrong.claims.find(c => c.kind === 'calculation')?.value).toBe(11)
    expect(() => validateModuleClaims({ ...wrong, moduleId: contract.moduleId, upstream: [] })).toThrow(/MODULE_CALCULATION_MISMATCH/)
    const forward = structuredClone(raws)
    forward[1].evidence[0].calculation.operands[0] = { local: address('futureField') }
    expect(() => validateModuleAuthorGroup('1.08', forward[1], forward.slice(0, 1), sourceCorpus)).not.toThrow()
    expect(() => compileModuleAuthorGroups('1.08', forward, sourceCorpus)).toThrow('MODULE_PROJECTION_REFERENCE')
    const sourced = structuredClone(raws)
    sourced[1].evidence[0].calculation.operands[0] = { source: { path: doc.path, quote: '不存在的容量 12.5', valueQuote: '12.5' }, value: 12.5 }
    expect(() => validateModuleAuthorGroup('1.08', sourced[1], sourced.slice(0, 1), sourceCorpus)).toThrow('MODULE_SOURCE_VALUE_QUOTE')
  })
  it('rejects a local dependency on an already known missing field during group validation', async () => {
    const { validateModuleAuthorGroup } = await api(), raws = await pieces()
    const group = raws[0] as any, outputs = JSON.parse(group.outputsJson)
    const row = outputs.project_brief.records[0]
    const missing = Object.keys(row).find(key => row[key]?.claimClass === 'missing')!
    group.evidence[0].inputRefs = [{ local: { port: 'project_brief', recordId: row.recordId, field: missing, at: '' } }]
    const original = structuredClone(raws)
    expect(() => validateModuleAuthorGroup('1.01', group, [], corpus)).toThrow(/MODULE_PROJECTION_REFERENCE.*inputRefs\/0\/local.*missing/)
    expect(raws).toEqual(original)
    expect(JSON.parse(group.outputsJson).project_brief.records[0][missing]).toMatchObject({ value: null, claimClass: 'missing' })
  })
  it('uses only conservative port metadata reductions and does not turn mixed group step states into completed', async () => {
    const { compileModuleAuthorGroups } = await api(), raws = await pieces(), first = JSON.parse(raws[0].outputsJson)
    first.project_brief.quality = 'accepted'; raws[0].outputsJson = JSON.stringify(first)
    raws[0].steps[0].status = 'completed'
    const result = compileModuleAuthorGroups('1.01', raws, corpus)
    expect((result.outputs.project_brief as any).quality).toBe('limited'); expect(result.steps[0].status).toBe('limited')
    expect((result.outputs.project_brief as any).records[0].formalName.value).toBe('甲水库')
    expect(raws[0].steps[0].status).toBe('completed')
  })
  it('fails closed on incomplete, repeated, cross-group or conflicting submissions', async () => {
    const { compileModuleAuthorGroups } = await api(), originals = await pieces()
    for (const mutate of [
      (r: any[]) => { r.pop() }, (r: any[]) => { r[1] = structuredClone(r[0]) },
      (r: any[]) => { const o = JSON.parse(r[1].outputsJson); o.project_brief.records.pop(); r[1].outputsJson = JSON.stringify(o) },
      (r: any[]) => { const o = JSON.parse(r[1].outputsJson); o.project_brief.records[0].recordId = 'invented'; r[1].outputsJson = JSON.stringify(o) },
      (r: any[]) => { const o = JSON.parse(r[1].outputsJson); o.project_brief.scope = 'changed'; r[1].outputsJson = JSON.stringify(o) },
      (r: any[]) => { const o = JSON.parse(r[1].outputsJson); o.project_brief.records[0].formalName = full().outputs.project_brief.records[0].formalName; r[1].outputsJson = JSON.stringify(o) },
      (r: any[]) => { r[1].evidence = structuredClone(r[0].evidence) },
      (r: any[]) => { r[0].steps[0].status = 'completed'; r[0].steps.pop() },
    ]) { const raws = structuredClone(originals); mutate(raws); expect(() => compileModuleAuthorGroups('1.01', raws, corpus)).toThrow(/MODULE_GROUP/) }
  })
  it.each(['unreviewed', 'rejected'])('does not upgrade a submitted %s group to accepted during metadata merge', async quality => {
    const { validateModuleAuthorGroup, compileModuleAuthorGroups } = await api(), raws = await pieces(), outputs = JSON.parse(raws[0].outputsJson)
    outputs.project_brief.quality = quality; raws[0].outputsJson = JSON.stringify(outputs)
    expect(() => validateModuleAuthorGroup('1.01', raws[0], [], corpus)).toThrow('MODULE_GROUP_QUALITY')
    expect(() => compileModuleAuthorGroups('1.01', raws, corpus)).toThrow('MODULE_GROUP_QUALITY')
  })
  it('replays all raw group submissions and rejects tampering or receipt reuse', async () => {
    const { compileModuleAuthorGroups, createModuleAuthorGroupsAudit, replayModuleAuthorGroups } = await api()
    const raws = await pieces(), candidate = compileModuleAuthorGroups('1.01', raws, corpus)
    const audit = createModuleAuthorGroupsAudit('1.01', raws.map((raw, i) => ({ raw, receipt: receipt(i) })), candidate)
    expect(replayModuleAuthorGroups('1.01', corpus, audit)).toEqual(candidate)
    for (const mutate of [
      (a: any) => { a.groups[0].raw.outputsJson += ' ' }, (a: any) => { a.groups[0].outputsJsonHash = '0'.repeat(64) },
      (a: any) => { a.groups[1].receipt = structuredClone(a.groups[0].receipt) },
      (a: any) => { a.groups[1].raw.groupId = a.groups[0].raw.groupId },
      (a: any) => { a.groups.pop() }, (a: any) => { a.planHash = '0'.repeat(64) },
      (a: any) => { a.compiledCandidateHash = sha256CanonicalJson({}) },
    ]) { const bad = structuredClone(audit); mutate(bad); expect(() => replayModuleAuthorGroups('1.01', corpus, bad)).toThrow(/MODULE_GROUP/) }
    expect(() => createModuleAuthorGroupsAudit('1.01', raws.map(raw => ({ raw, receipt: receipt(0) })), candidate)).toThrow(/MODULE_GROUP_RECEIPT/)
  })
})
