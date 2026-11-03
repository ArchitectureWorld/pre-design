import {describe,it,expect} from 'vitest'
import {materialCorpusFingerprint} from '../src/materials/research-evidence.ts'
import {moduleRecoveryFeedback} from '../src/research-v2/module-recovery-feedback.ts'
import {moduleProjectionUnitConflicts,validateModuleProjectionFields} from '../src/research-v2/module-author-projection.ts'
import {sha256CanonicalJson} from '../src/presentation/canonical-json.ts'
const target={port:'market_context',recordId:'mc',field:'formula',at:''}
const raw={outputs:{market_context:{records:[{recordId:'mc',formula:{value:'按原文直接取值',claimClass:'source_conclusion',limitations:[]}}]}},
 evidence:[{target,kind:'source',unit:'元',source:{path:'original.txt',quote:'按原文直接取值'}}]}
const base={documents:[],limitations:[]},corpus={...base,fingerprint:materialCorpusFingerprint(base)}
describe('exact unit bindings at author and recovery boundaries',()=>{
 it('keeps date display formats out of text units while preserving the unchanged date values',()=>{
  const dates={outputs:{planning_conditions:{records:[{recordId:'PC-04',effectiveDate:{value:'2024-08-01',claimClass:'source_conclusion',limitations:[]}},
   {recordId:'PC-05',effectiveDate:{value:'2024-08-15',claimClass:'source_conclusion',limitations:[]}}]}},
   evidence:['PC-04','PC-05'].map(recordId=>({target:{port:'planning_conditions',recordId,field:'effectiveDate',at:''},kind:'source',unit:'YYYY-MM-DD'}))}
  const before=sha256CanonicalJson(dates)
  expect(moduleProjectionUnitConflicts(dates)).toMatchObject([
   {target:{recordId:'PC-04',field:'effectiveDate'},declaredUnit:'YYYY-MM-DD',containerUnit:null,valueType:'string'},
   {target:{recordId:'PC-05',field:'effectiveDate'},declaredUnit:'YYYY-MM-DD',containerUnit:null,valueType:'string'}])
  expect(sha256CanonicalJson(dates)).toBe(before)
 })
 it('diagnoses the original text field unit without rewriting it',()=>{
  const before=sha256CanonicalJson(raw),conflicts=moduleProjectionUnitConflicts(raw)
  expect(conflicts).toMatchObject([{evidenceIndex:0,target,declaredUnit:'元',containerUnit:null,valueType:'string',rawValueHash:sha256CanonicalJson('按原文直接取值')}])
  expect(sha256CanonicalJson(raw)).toBe(before)
 })
 it('preserves exact measure/currency bindings and rejects mismatched nested units',()=>{
  for(const [member,unit] of [['unit','万元'],['currency','CNY']]){
   const projection={outputs:{p:{records:[{recordId:'r',measure:{value:{amount:12,[member]:unit}}}]}},
    evidence:[{target:{port:'p',recordId:'r',field:'measure',at:'/amount'},kind:'source',unit}]}
   expect(moduleProjectionUnitConflicts(projection)).toEqual([])
   expect(moduleProjectionUnitConflicts({...projection,evidence:[{...projection.evidence[0],unit:'元'}]})).toMatchObject([{declaredUnit:'元',containerUnit:unit,valueType:'number'}])
  }
 })
 it('does not invent a unit requirement for absent declarations or change non-unit selected addresses',()=>{
  expect(moduleProjectionUnitConflicts({...raw,evidence:[{...raw.evidence[0],unit:undefined}]})).toEqual([])
  expect(moduleProjectionUnitConflicts({outputs:{p:{records:[{recordId:'r',point:{value:{x:12}}}]}},
   evidence:[{target:{port:'p',recordId:'r',field:'point',at:'/x'},kind:'source',unit:'m'}]})).toEqual([])
 })
 it('delivers full-merge unit errors from a previously completed owning group with its unchanged original hash',()=>{
  const original={...raw,groupId:'market_context:3.2.2.3'},audit={reviewReceipts:[],attempts:[{classId:'text',status:'completed',groupId:original.groupId,structuredOutput:original}]},before=sha256CanonicalJson(audit)
  const feedback=moduleRecoveryFeedback({resumeExecutionAudit:audit,resumeExecutionError:'MODULE_CLAIM_UNIT_MISMATCH: original',corpus},original.groupId)
  const excerpt=JSON.parse(feedback.split('\n').at(-1)!).previousRejection.diagnosticExcerpt
  expect(excerpt).toMatchObject({scope:'unit-bindings-only',completeSubmission:false,originalSubmissionHash:sha256CanonicalJson(original)})
  expect(excerpt.fieldUnitConflicts).toMatchObject([{target,declaredUnit:'元',containerUnit:null}])
  expect(feedback).toContain('不得机械删除单位')
  expect(moduleRecoveryFeedback({resumeExecutionAudit:audit,resumeExecutionError:'MODULE_CLAIM_UNIT_MISMATCH: original',corpus},'market_context:4.1')).not.toContain('fieldUnitConflicts')
  expect(sha256CanonicalJson(audit)).toBe(before)
 })
})
