import {createHash} from 'node:crypto'
import {expect,it} from 'vitest'
import {materialCorpusFingerprint} from '../src/materials/research-evidence.ts'
import {moduleRecoveryFeedback} from '../src/research-v2/module-recovery-feedback.ts'
import {moduleDecisionTextEvidenceProtocol} from '../src/research-v2/module-decision-text-evidence-protocol.ts'
import {getModuleAuthorGroupVersion,validateModuleAuthorGroup} from '../src/research-v2/module-author-groups.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'
const groupId='planning_conditions:1',issuer='Synthetic Policy Authority A'
const doc=(path:string,text:string)=>({path,text,byteLength:Buffer.byteLength(text),contentHash:createHash('sha256').update(text).digest('hex')})
const base={documents:[doc('policy-A.txt',issuer),doc('policy-B.txt','Synthetic Policy Authority B')],limitations:[]},corpus={...base,fingerprint:materialCorpusFingerprint(base)}
const target=(recordId:string,field='issuer')=>({port:'planning_conditions',recordId,field,at:''})
const draft=():any=>({projectionVersion:getModuleAuthorGroupVersion('1.03'),groupId,
 outputs:{planning_conditions:{type:'planning.planning_conditions.v1.2',quality:'limited',scope:'Synthetic policy binding',asOf:'2026-10-07',limitations:['Synthetic fixture only'],records:[{
  recordId:'POLICY-A',resultClass:'observation_summary',documentId:{value:'working-policy-A',claimClass:'decision',limitations:['Not official']},
  documentNumber:{value:null,claimClass:'missing',limitations:['No number']},issuer:{value:issuer,claimClass:'source_conclusion',limitations:['Synthetic fixture only']},publishedDate:{value:null,claimClass:'missing',limitations:['No complete date']}}]}},
 evidence:[{target:target('POLICY-A','documentId'),kind:'proposal',rationale:'Author-selected synthetic research key'},
  {target:target('POLICY-A'),kind:'source',source:{path:'policy-B.txt',quote:issuer}}],limitations:['Synthetic only'],
 stepResults:Object.fromEntries([1,2,3,4].map(i=>['step'+i,{status:'limited',summary:'Synthetic source binding review',fieldRefs:[],limitations:['Synthetic only']}]))})
function feedback(raw:any,itemId='1.03',requestedGroup=groupId){const audit={reviewReceipts:[],attempts:[{classId:'text',groupId,status:'failed',error:'MODULE_SOURCE_VALUE_QUOTE: synthetic',structuredOutput:raw}]};return moduleRecoveryFeedback({module:{id:itemId},corpus,resumeExecutionAudit:audit} as any,requestedGroup)}
function readback(text:string){return text.split('\n').map(line=>{try{return JSON.parse(line)}catch{return null}}).find(row=>row?.sourceRecordBindingReadback)?.sourceRecordBindingReadback}

it('emits a hash-bound source identity mismatch table without assigning a replacement field value, quote or source',()=>{
 const raw=draft(),before=hash({raw,corpus}),text=feedback(raw),table=readback(text)
 expect(table).toMatchObject({version:'policy-source-record-binding-readback.v1',originalSubmissionHash:hash(raw),completeSubmission:false,sourceBindingsApproved:false,conflicts:[{
  target:target('POLICY-A'),declaredSource:{path:'policy-B.txt',contentHash:base.documents[1].contentHash},quoteHash:hash(issuer),rawValueHash:hash(issuer),differentSourceIdentityObserved:true,
  actualQuoteLocations:[{path:'policy-A.txt',contentHash:base.documents[0].contentHash,literalExactMatch:true}]}]})
 expect(text).toContain('仅修订quote');expect(text).toContain('source.path')
 expect(table?.conflicts[0]).not.toHaveProperty('replacementSource');expect(table?.conflicts[0]).not.toHaveProperty('quote');expect(table?.conflicts[0]).not.toHaveProperty('value')
 expect(hash({raw,corpus})).toBe(before)
})

it('keeps source identity and original scope guidance in the first and immediate-correction policy protocol',()=>{
 const text=moduleDecisionTextEvidenceProtocol('1.03',groupId)
 expect(text).toContain('policy-source-record-binding.v1');expect(text).toContain('原始审计')
 expect(text).toContain('实际文件');expect(text).toContain('独立审查')
})

it('does not report a different-file conflict for an already corresponding literal source binding',()=>{
 const raw=draft();raw.evidence[1].source.path='policy-A.txt'
 expect(readback(feedback(raw))).toBeUndefined()
 expect(()=>validateModuleAuthorGroup('1.03',raw,[],corpus)).not.toThrow()
})

it('limits the source binding table to the failed policy identity group',()=>{
 expect(readback(feedback(draft(),'3.01'))).toBeUndefined()
 expect(readback(feedback(draft(),'1.03','planning_conditions:2'))).toBeUndefined()
})

it('leaves strict source validation and original rejected evidence intact when an author corrects a file binding',()=>{
 const raw=draft(),before=hash(raw)
 expect(()=>validateModuleAuthorGroup('1.03',raw,[],corpus)).toThrow('MODULE_SOURCE_VALUE_QUOTE')
 const revised=structuredClone(raw);revised.evidence[1].source.path='policy-A.txt'
 const accepted=validateModuleAuthorGroup('1.03',revised,[],corpus)
 expect(accepted.outputs).toEqual(raw.outputs);expect(accepted.evidence[0]).toEqual(raw.evidence[0]);expect(hash(raw)).toBe(before)
})
