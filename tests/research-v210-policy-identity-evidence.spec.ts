import {createHash} from 'node:crypto'
import {expect,it} from 'vitest'
import {materialCorpusFingerprint} from '../src/materials/research-evidence.ts'
import {getModuleAuthorGroupOutputSchemaPrompt,getModuleAuthorGroupVersion,validateModuleAuthorGroup} from '../src/research-v2/module-author-groups.ts'
import {moduleDecisionTextEvidenceProtocol} from '../src/research-v2/module-decision-text-evidence-protocol.ts'
import {moduleRecoveryFeedback} from '../src/research-v2/module-recovery-feedback.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'

const groupId='planning_conditions:1'
const sourceText='Synthetic Policy Authority'
const doc={path:'policy-synthetic.txt',text:sourceText,byteLength:Buffer.byteLength(sourceText),contentHash:createHash('sha256').update(sourceText).digest('hex')}
const base={documents:[doc],limitations:[]},corpus={...base,fingerprint:materialCorpusFingerprint(base)}
const target=(recordId:string,field='documentId')=>({port:'planning_conditions',recordId,field,at:''})
const draft=():any=>({projectionVersion:getModuleAuthorGroupVersion('1.03'),groupId,
  outputs:{planning_conditions:{type:'planning.planning_conditions.v1.2',quality:'limited',scope:'Synthetic policy identity test',asOf:'2026-10-07',limitations:['No current approval established'],
    records:Array.from({length:5},(_,i)=>({recordId:`POLICY-SYNTHETIC-${i}`,resultClass:'observation_summary',
      documentId:{value:`working-document-${i}`,claimClass:'decision',limitations:['Research link only; not an official identifier']},
      documentNumber:{value:null,claimClass:'missing',limitations:['No official number']},
      issuer:{value:sourceText,claimClass:'source_conclusion',limitations:['Synthetic fixture']},
      publishedDate:{value:null,claimClass:'missing',limitations:['No complete publication date']}}))}},
  evidence:Array.from({length:5},(_,i)=>({target:target(`POLICY-SYNTHETIC-${i}`,'issuer'),kind:'source',source:{path:doc.path,quote:sourceText}})),
  limitations:['Synthetic fixture only'],stepResults:Object.fromEntries([1,2,3,4].map(i=>['step'+i,{status:'limited',summary:'Synthetic policy identity work',fieldRefs:[],limitations:['Current applicability unverified']}]))})
const coverageError='MODULE_PROJECTION_OUTPUT_INVALID: planning_conditions.records.0.documentId.claimRefs: Too small: expected array to have >=1 items'

it('emits the policy identifier evidence duties for the first author while leaving later groups scoped to their own fields',()=>{
  const prompt=getModuleAuthorGroupOutputSchemaPrompt('1.03',groupId,[])
  expect(prompt).toContain('working-decision-evidence.v1')
  expect(prompt).toContain('policy-document-identity-evidence.v1')
  expect(prompt).toContain('documentId');expect(prompt).toContain('recordId')
  expect(prompt).toContain('decision+proposal');expect(prompt).toContain('notApplicableReason')
  expect(getModuleAuthorGroupOutputSchemaPrompt('1.03','planning_conditions:2',[])).not.toContain('policy-document-identity-evidence.v1')
})

it.each([coverageError,'MODULE_PROJECTION_OUTPUT_INVALID: Non-null field has extra notApplicableReason'])('binds checkpoint correction to the original rejected identities without rewriting their values: %s',error=>{
  const raw=draft(),audit={reviewReceipts:[],attempts:[{classId:'text',groupId,status:'failed',error,structuredOutput:raw}]},before=hash({audit,corpus})
  const feedback=moduleRecoveryFeedback({module:{id:'1.03'},resumeExecutionAudit:audit,corpus} as any,groupId)
  expect(feedback).toContain('policy-document-identity-evidence.v1')
  expect(feedback).toContain('真实rationale');expect(feedback).toContain('claimRefs由编译器')
  const receipt=JSON.parse(feedback.split('\n').at(-1)!).previousRejection
  expect(receipt.authorErrors).toContain(error)
  if(error===coverageError)expect(receipt.diagnosticExcerpt).toMatchObject({originalSubmissionHash:hash(raw),completeSubmission:false,
    fieldEvidenceCoverageGaps:Array.from({length:5},(_,i)=>({target:target(`POLICY-SYNTHETIC-${i}`)}))})
  expect(hash({audit,corpus})).toBe(before)
})

it('provides the same scoped protocol to immediate native correction without assigning a document identity or rationale',()=>{
  const protocol=moduleDecisionTextEvidenceProtocol('1.03',groupId)
  expect(protocol).toContain('policy-document-identity-evidence.v1')
  expect(protocol).toContain('每个');expect(protocol).toContain('精确target')
  expect(protocol).not.toContain('working-document-0')
  expect(moduleDecisionTextEvidenceProtocol('1.03','planning_conditions:2')).toBe('')
})

it('continues to reject uncovered working document fields and accepts independently authored proposal evidence while retaining literal source evidence',()=>{
  const original=draft(),before=hash(original)
  expect(()=>validateModuleAuthorGroup('1.03',original,[],corpus)).toThrow(/documentId.claimRefs/)
  expect(hash(original)).toBe(before)
  const revised=structuredClone(original)
  for(const row of revised.outputs.planning_conditions.records)revised.evidence.push({target:target(row.recordId),kind:'proposal',rationale:'Author-selected key to track this synthetic document in research; not official identity or applicability.'})
  const accepted=validateModuleAuthorGroup('1.03',revised,[],corpus)
  expect(accepted.evidence.filter(e=>e.kind==='source')).toEqual(original.evidence)
  expect(accepted.outputs).toEqual(original.outputs)
  expect(hash(original)).toBe(before)
})

it('keeps non-null identifier envelope rejection even after the author supplies decision evidence',()=>{
  const raw=draft()
  for(const row of raw.outputs.planning_conditions.records){row.documentId.notApplicableReason='Only current application is unknown'
    raw.evidence.push({target:target(row.recordId),kind:'proposal',rationale:'Synthetic research linkage only'})}
  expect(()=>validateModuleAuthorGroup('1.03',raw,[],corpus)).toThrow(/MODULE_PROJECTION_OUTPUT_INVALID/)
})
