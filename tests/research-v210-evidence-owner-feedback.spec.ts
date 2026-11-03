import {createHash} from 'node:crypto'
import {describe,expect,it} from 'vitest'
import {materialCorpusFingerprint} from '../src/materials/research-evidence.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'
import {loadPlanningCatalog} from '../src/research-v2/catalog.ts'
import {moduleFieldProtocolDiagnostic} from '../src/research-v2/module-field-protocol-diagnostics.ts'
import {moduleRecoveryFeedback} from '../src/research-v2/module-recovery-feedback.ts'
import {boundedSourceDiagnostic} from '../src/research-v2/source-diagnostic-view.ts'
import {expandModuleReferencePromptView} from '../src/research-v2/module-reference-context.ts'

const error='MODULE_GROUP_EVIDENCE_OWNER: peer_supply:1'
const target=(recordId='synthetic-peer',field='formalName',port='peer_supply')=>({port,recordId,field,at:''})
const draft=()=>({projectionVersion:'module-author-field-group.v14',groupId:'peer_supply:1',
 outputs:{peer_supply:{records:[{recordId:'synthetic-peer',formalName:{value:'Synthetic Lodge',claimClass:'source_conclusion',limitations:[]}}]}},
 evidence:[{target:target('synthetic-typo'),kind:'source',source:{path:'sources/original.txt',quote:'Synthetic Lodge'}}]})
const text='Synthetic Lodge is named in the supplied announcement.'
const source={path:'sources/original.txt',text,contentHash:createHash('sha256').update(text).digest('hex'),byteLength:Buffer.byteLength(text)}
const base={documents:[source],limitations:[]},corpus={...base,fingerprint:materialCorpusFingerprint(base)}
const diagnose=(raw:unknown)=>moduleFieldProtocolDiagnostic(error,raw,[],'3.04',corpus) as any

describe('rejected evidence owners remain exact, actionable native diagnostics',()=>{
 it('locates an unknown record without choosing a replacement or modifying the rejected evidence',()=>{
  const raw=draft(),before=hash(raw),diagnostic=diagnose(raw)
  expect(diagnostic).toMatchObject({completeSubmission:false,originalSubmissionHash:before,
   fieldEvidenceOwnerScope:{groupId:raw.groupId,port:'peer_supply',fields:['peerId','formalName','aliases','operator'],submittedRecordIds:['synthetic-peer']},
   fieldEvidenceOwnerConflicts:[{evidenceIndex:0,evidencePath:'/evidence/0/target',target:target('synthetic-typo'),entryHash:hash(raw.evidence[0]),reasons:['record-not-in-submission']}]})
  expect(diagnostic.fieldEvidenceOwnerConflicts[0]).not.toHaveProperty('replacementTarget')
  expect(hash(raw)).toBe(before)
 })
 it('reports unassigned ports and fields separately from a record typo',()=>{
  const raw=draft();raw.evidence[0].target=target('synthetic-peer','coverage','market_context')
  expect(diagnose(raw).fieldEvidenceOwnerConflicts[0].reasons).toEqual(['port-not-assigned-to-group','field-not-assigned-to-group'])
 })
 it('checks serialized group outputs without decoding or rewriting their native wire receipt',()=>{
  const original=draft(),{outputs,...rest}=original,raw={...rest,outputsJson:JSON.stringify(outputs)},before=hash(raw)
  expect(diagnose(raw).fieldEvidenceOwnerConflicts[0].target).toEqual(target('synthetic-typo'))
  expect(hash(raw)).toBe(before)
 })
 it('does not invent owner conflicts for an existing field and record or an unknown group',()=>{
  const raw=draft();raw.evidence[0].target=target()
  expect(diagnose(raw)).toBeUndefined()
  expect(diagnose({...raw,groupId:'peer_supply:999'})).toBeUndefined()
 })
 it('returns the owner typo and same-draft hidden source error through checkpoint feedback',()=>{
  const raw=draft();raw.evidence.push({target:target(),kind:'source',source:{path:'sources/absent.txt',quote:'Synthetic Lodge'}})
  const attempt={classId:'text',groupId:raw.groupId,status:'failed',executionId:'synthetic-execution',childId:'synthetic-child',
   structuredOutput:raw,structuredHash:hash(raw),error},audit={attempts:[attempt],reviewReceipts:[]},before=hash(audit)
  const feedback=moduleRecoveryFeedback({module:loadPlanningCatalog().modules.find(row=>row.id==='3.04')!,resumeExecutionAudit:audit,corpus},raw.groupId)
  const previous=JSON.parse(feedback.split('\n').at(-1)!).previousRejection
  expect(previous.diagnosticExcerpt.fieldEvidenceOwnerConflicts).toHaveLength(1)
  expect(previous.diagnosticExcerpt.fieldTextConflicts).toHaveLength(1)
  expect(previous.rejectedSubmission.originalSubmissionHash).toBe(hash(raw))
  expect(previous.rejectedSubmission.structuredOutput).toEqual(raw)
  expect(feedback).toContain('fieldEvidenceOwnerConflicts')
  expect(feedback).toContain('不选择替代recordId')
  expect(hash(audit)).toBe(before)
 })
 it('keeps the exact owner address visible when large source details use the lossless transport',()=>{
  const raw=draft(),owner=diagnose(raw)
  const diagnostic={...owner,fieldTextConflicts:Array.from({length:3},(_,index)=>({target:target(),evidenceIndex:index,
   diagnosticCode:'MODULE_SOURCE_VALUE_QUOTE',quoteHash:hash(text),sourceLiteralReadback:{excerpt:text.repeat(250)}}))}
  expect(JSON.stringify(diagnostic).length).toBeGreaterThan(24_000)
  const transport=boundedSourceDiagnostic(diagnostic) as any
  expect(transport.originalDiagnosticHash).toBe(hash(diagnostic))
  expect(transport.fieldEvidenceOwnerConflicts).toEqual(owner.fieldEvidenceOwnerConflicts)
  expect(transport.fieldEvidenceOwnerScope).toEqual(owner.fieldEvidenceOwnerScope)
  expect(hash(expandModuleReferencePromptView(transport.readOnlyDiagnosticView))).toBe(hash(diagnostic))
 })
})
