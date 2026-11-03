import {createHash} from 'node:crypto'
import {describe,expect,it} from 'vitest'
import {materialCorpusFingerprint} from '../src/materials/research-evidence.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'
import {moduleFieldProtocolDiagnostic} from '../src/research-v2/module-field-protocol-diagnostics.ts'
import {moduleRecoveryFeedback} from '../src/research-v2/module-recovery-feedback.ts'
import {moduleSourceTextConflicts} from '../src/research-v2/module-source-text-diagnostics.ts'
import {boundedSourceDiagnostic} from '../src/research-v2/source-diagnostic-view.ts'
import {expandModuleReferencePromptView} from '../src/research-v2/module-reference-context.ts'

const groupId='peer_supply:1',ids=['synthetic-a','synthetic-b','synthetic-c']
const names=['Synthetic Alpha Lodge','Synthetic Beta Park','Synthetic Gamma Camp']
const text=names.map(name=>name+' was named in the original announcement.').join('\n')
const document=(path:string,text:string)=>({path,text,contentHash:createHash('sha256').update(text).digest('hex'),byteLength:Buffer.byteLength(text)})
const base={documents:[document('sources/actual.json',text),document('sources/other.json','Unrelated original source body.')],limitations:[]}
const corpus={...base,fingerprint:materialCorpusFingerprint(base)}
const target=(recordId:string,field:string)=>({port:'peer_supply',recordId,field,at:''})
const rawDraft=()=>({groupId,outputs:{peer_supply:{records:ids.map((recordId,index)=>({recordId,
 peerId:{value:recordId,claimClass:'decision',limitations:['Synthetic internal working identifier only']},
 formalName:{value:names[index],claimClass:'source_conclusion',limitations:[]},
 operator:{value:null,claimClass:'missing',limitations:['No operator evidence']}}))}},
 evidence:ids.map((recordId,index)=>({target:target(recordId,'formalName'),kind:'source',source:{path:'sources/other.json',quote:names[index]+' was named in the original announcement.'}}))})
const claimError='MODULE_PROJECTION_OUTPUT_INVALID: peer_supply.records.0.peerId.claimRefs: Too small: expected array to have >=1 items'
const diagnose=(error:string,raw:unknown)=> (moduleFieldProtocolDiagnostic as (...args:any[])=>any)(error,raw,[],'3.04',corpus)

describe('central early rejection does not hide same-draft evidence and source problems',()=>{
 it('reports the three wrong frozen source bindings alongside the three unsupported working identifiers',()=>{
  const raw=rawDraft(),before=hash({raw,corpus})
  expect(moduleSourceTextConflicts(raw,corpus)).toHaveLength(3)
  const diagnostic=diagnose(claimError,raw)
  expect(diagnostic).toMatchObject({scope:'field-protocol-conflicts-only',completeSubmission:false,originalSubmissionHash:hash(raw)})
  expect(diagnostic.fieldEvidenceCoverageGaps.map((row:any)=>row.target)).toEqual(ids.map(id=>target(id,'peerId')))
  expect(diagnostic.fieldTextConflicts).toEqual(ids.map(id=>expect.objectContaining({target:target(id,'formalName'),diagnosticCode:'MODULE_SOURCE_VALUE_QUOTE'})))
  expect(hash({raw,corpus})).toBe(before)
 })
 it('delivers both problem lists through real checkpoint feedback without accepting or rewriting the source draft',()=>{
  const raw=rawDraft(),audit={reviewReceipts:[],attempts:[{classId:'text',groupId,status:'failed',structuredOutput:raw,error:claimError}]}
  const before=hash(audit),feedback=moduleRecoveryFeedback({resumeExecutionAudit:audit,corpus},groupId)
  const diagnostic=JSON.parse(feedback.split('\n').at(-1)!).previousRejection.diagnosticExcerpt
  expect(diagnostic.fieldEvidenceCoverageGaps).toHaveLength(3)
  expect(diagnostic.fieldTextConflicts).toHaveLength(3)
  expect(feedback).toContain('claimRefs由编译器')
  expect(feedback).toContain('连续原文')
  expect(hash(audit)).toBe(before)
  expect(moduleSourceTextConflicts(raw,corpus)).toHaveLength(3)
 })
 it('keeps the unsupported positive fields and missing-field references together after steps reject first',()=>{
  const raw={...rawDraft(),evidence:[],stepResults:{step2:{status:'limited',summary:'Synthetic unverified step',limitations:['Synthetic missing evidence'],
   fieldRefs:[...ids.map(id=>target(id,'formalName')),target(ids[0],'operator')]}}}
  const before=hash(raw),diagnostic=diagnose('MODULE_GROUP_STEPS: fieldRefs have no matching evidence',raw)
  expect(diagnostic.stepEvidenceConflicts).toHaveLength(4)
  expect(diagnostic.fieldEvidenceCoverageGaps).toHaveLength(6)
  expect(diagnostic.fieldEvidenceCoverageGaps.some((row:any)=>row.target.field==='operator')).toBe(false)
  expect(diagnostic.stepEvidenceConflicts.at(-1).fieldState).toMatchObject({claimClass:'missing',valueType:'null',registeredFieldEvidenceCount:0})
  expect(hash(raw)).toBe(before)
 })
 it('retains source conflicts when an unrelated missing field wrongly carries evidence',()=>{
  const raw=rawDraft();raw.evidence.push({target:target(ids[0],'operator'),kind:'source',source:{path:'sources/other.json',quote:'Unrelated original source body.'}})
  const diagnostic=diagnose('MODULE_GROUP_MISSING_EVIDENCE: missing/null field has evidence',raw)
  expect(diagnostic.fieldEvidenceConflicts).toContainEqual(expect.objectContaining({target:target(ids[0],'operator')}))
  expect(diagnostic.fieldEvidenceCoverageGaps).toHaveLength(3)
  expect(diagnostic.fieldTextConflicts).toHaveLength(3)
 })
 it('does not invent source conflicts after the native draft has actual bindings for every positive field',()=>{
  const raw=rawDraft();raw.evidence.forEach(row=>{row.source.path='sources/actual.json'})
  const draft={...raw,evidence:[...raw.evidence,...ids.map(id=>({target:target(id,'peerId'),kind:'proposal',rationale:'Synthetic internal index choice; no official identity claim'}))]}
  expect(diagnose(claimError,draft)).toBeUndefined()
 })
 it('preserves the other problem categories when repetitive source readbacks use the existing bounded codec',()=>{
  const diagnostic={scope:'field-protocol-conflicts-only',completeSubmission:false,originalSubmissionHash:hash('synthetic draft'),
   fieldEvidenceCoverageGaps:[{target:target(ids[0],'peerId'),valueHash:hash(ids[0]),evidenceCount:0}],
   fieldEvidenceConflicts:[target(ids[0],'operator')],stepEvidenceConflicts:[{target:target(ids[0],'formalName'),fieldRefPaths:['/stepResults/step2/fieldRefs/0']}],
   fieldTextConflicts:ids.map(id=>({target:target(id,'formalName'),diagnosticCode:'MODULE_SOURCE_VALUE_QUOTE',rawValueHash:hash(id),quoteHash:hash('quote'),sourceExcerpt:'Synthetic repeated original excerpt. '.repeat(240)}))}
  const before=hash(diagnostic),bounded=boundedSourceDiagnostic(diagnostic,13000)!
  expect(bounded.readOnlyDiagnosticView).toBeDefined()
  expect(bounded.fieldEvidenceCoverageGaps).toEqual(diagnostic.fieldEvidenceCoverageGaps)
  expect(bounded.fieldEvidenceConflicts).toEqual(diagnostic.fieldEvidenceConflicts)
  expect(bounded.stepEvidenceConflicts).toEqual(diagnostic.stepEvidenceConflicts)
  expect(hash(expandModuleReferencePromptView(bounded.readOnlyDiagnosticView))).toBe(before)
  expect(hash(diagnostic)).toBe(before)
 })
})
