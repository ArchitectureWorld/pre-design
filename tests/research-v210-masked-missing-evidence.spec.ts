import {createHash} from 'node:crypto'
import {describe,expect,it} from 'vitest'
import {materialCorpusFingerprint} from '../src/materials/research-evidence.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'
import {loadPlanningCatalog} from '../src/research-v2/catalog.ts'
import {moduleFieldProtocolDiagnostic} from '../src/research-v2/module-field-protocol-diagnostics.ts'
import {moduleRecoveryFeedback} from '../src/research-v2/module-recovery-feedback.ts'

const groupId='market_context:2.2',error='MODULE_GROUP_EVIDENCE_OWNER: '+groupId
const target=(recordId:string,field:string,port='market_context')=>({port,recordId,field,at:''})
const missing=()=>({value:null,claimClass:'missing',limitations:['Synthetic missing source information']})
const text='Synthetic metric alpha',path='sources/synthetic.txt'
const base={documents:[{path,text,contentHash:createHash('sha256').update(text).digest('hex'),byteLength:Buffer.byteLength(text)}],limitations:[]}
const corpus={...base,fingerprint:materialCorpusFingerprint(base)}
const draft=()=>({projectionVersion:'module-author-field-group.v13',groupId,
 outputs:{market_context:{records:[{recordId:'synthetic-a',classification:{value:text,claimClass:'source_conclusion',limitations:[]},statisticalBasis:missing()},
  {recordId:'synthetic-b',classification:missing(),statisticalBasis:missing()}]}},
 evidence:[{target:target('synthetic-a','classification'),kind:'source',source:{path,quote:text}},
  {target:target('synthetic-b','classification','synthetic-b'),kind:'source',source:{path,quote:text}},
  {target:target('synthetic-b','statisticalBasis'),kind:'source',source:{path,quote:text}}]})
const diagnose=(error:string,raw:unknown)=>moduleFieldProtocolDiagnostic(error,raw,[],'3.01',corpus) as any

describe('early owner and step errors retain same-draft missing evidence diagnostics',()=>{
 it.each([error,'MODULE_GROUP_STEPS: synthetic step error'])('reports the owned missing target after %s rejects first',rejection=>{
  const raw=draft(),before=hash(raw),diagnostic=diagnose(rejection,raw)
  expect(diagnostic).toMatchObject({completeSubmission:false,originalSubmissionHash:before,
   fieldEvidenceConflicts:[{evidenceIndex:2,target:target('synthetic-b','statisticalBasis'),field:{value:null,claimClass:'missing'}}]})
  if(rejection===error)expect(diagnostic.fieldEvidenceOwnerConflicts).toMatchObject([{evidenceIndex:1,reasons:['port-not-assigned-to-group']}])
  expect(diagnostic.fieldEvidenceConflicts).toHaveLength(1)
  expect(hash(raw)).toBe(before)
 })
 it('delivers both precise problems and the missing/null rule from the latest checkpoint rejection',()=>{
  const raw=draft(),audit={reviewReceipts:[],attempts:[{classId:'text',groupId,status:'failed',executionId:'synthetic-execution',childId:'synthetic-child',structuredOutput:raw,structuredHash:hash(raw),error}]},before=hash(audit)
  const feedback=moduleRecoveryFeedback({module:loadPlanningCatalog().modules.find(m=>m.id==='3.01')!,resumeExecutionAudit:audit,corpus},groupId)
  const previous=JSON.parse(feedback.split('\n').at(-1)!).previousRejection
  expect(previous.diagnosticExcerpt.fieldEvidenceOwnerConflicts).toHaveLength(1)
  expect(previous.diagnosticExcerpt.fieldEvidenceConflicts[0].target).toEqual(target('synthetic-b','statisticalBasis'))
  expect(previous.rejectedSubmission).toMatchObject({accepted:false,untrusted:true,originalSubmissionHash:hash(raw)})
  expect(feedback).toContain('fields marked missing/null must not carry evidence')
  expect(feedback).toContain('never invent values or reclassify to pass')
  expect(hash(audit)).toBe(before)
 })
 it('retains original serialized receipts and does not assign the wrong port to a replacement field',()=>{
  const {outputs,...rest}=draft(),raw={...rest,outputsJson:JSON.stringify(outputs)},before=hash(raw),diagnostic=diagnose(error,raw)
  expect(diagnostic.fieldEvidenceOwnerConflicts[0]).not.toHaveProperty('replacementTarget')
  expect(diagnostic.fieldEvidenceConflicts.map((row:any)=>row.evidenceIndex)).toEqual([2])
  expect(hash(raw)).toBe(before)
 })
 it('does not fabricate a missing-field conflict when only the wrong owner remains',()=>{
  const raw=draft();raw.evidence.pop()
  expect(diagnose(error,raw).fieldEvidenceOwnerConflicts).toHaveLength(1)
  expect(diagnose(error,raw)).not.toHaveProperty('fieldEvidenceConflicts')
 })
})
