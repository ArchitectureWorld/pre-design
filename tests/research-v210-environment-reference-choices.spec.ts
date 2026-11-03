import {describe,expect,it} from 'vitest'
import Ajv from 'ajv'
import {createHash} from 'node:crypto'
import {assertObjectJsonSchema} from '@deepseek-ai/dsh-tools'
import * as groups from '../src/research-v2/module-author-groups.ts'
import {bindNativeModuleEvidenceSchema} from '../src/research-v2/module-author-projection.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'
import {materialCorpusFingerprint} from '../src/materials/research-evidence.ts'

const text='Public DEM supports a visual baseline only.',path='synthetic-original.txt'
const corpusBase={documents:[{path,text,byteLength:text.length,contentHash:createHash('sha256').update(text).digest('hex')}],limitations:[]}
const corpus:any={...corpusBase,fingerprint:materialCorpusFingerprint(corpusBase)}
const plan=groups.getModuleAuthorExecutionFieldGroups('1.05'),version=groups.getModuleAuthorGroupVersion('1.05')
const address={port:'environment',recordId:'study-A',field:'layerType',at:''}
function draft(group:any):any{return {projectionVersion:version,groupId:group.groupId,outputs:{environment:{
 type:'planning.environment.v1.2',scope:'Synthetic environmental method test',asOf:'2026-09-26',quality:'limited',limitations:['Not a real environmental survey'],
 records:[{recordId:'study-A',resultClass:'observation_summary',...Object.fromEntries(group.fields.map((field:string)=>[field,{value:null,claimClass:'missing',limitations:['No original support']}]))}]}},
 evidence:[],limitations:['No actual environmental survey'],stepResults:Object.fromEntries([1,2,3,4].map(n=>['step'+n,{status:'limited',summary:'Synthetic incomplete step',fieldRefs:[],limitations:['Survey not completed']}]))}}
const prior=plan.slice(0,-1).map(draft)
prior[0].outputs.environment.records[0].layerType={value:text,claimClass:'source_conclusion',limitations:['Visualization only']}
prior[0].evidence=[{target:address,kind:'source',source:{path,quote:text}}]
prior[0].stepResults.step1.fieldRefs=[address]
const upstream:any=[{moduleId:'preplan.research.01.02',claims:[
 {claimId:'boundary-method',kind:'proposal',value:'Synthetic range selection',rationale:'Test only'},
 {claimId:'absent-geometry',kind:'missing',value:null,rationale:'No geometry'},
]}]
function nativeEvidence(){
 const schema=groups.getModuleAuthorGroupSchema('1.05','environment:4.2',prior,version,corpus,undefined,upstream)
 return {schema,validate:new Ajv({strict:false}).compile(bindNativeModuleEvidenceSchema(schema).properties!.evidence.items!)}
}
const inference=(ref:any)=>({target:{...address,field:'verificationTasks',at:'/0'},kind:'inference',rationale:'Synthetic follow-up derived from an available observation',inputRefs:[ref]})

describe('environmental follow-up authors receive only available original reference addresses',()=>{
 it('rejects the observed nonexistent self-module and invented external claim in the native request',()=>{
  const {validate}=nativeEvidence()
  expect(validate(inference({upstream:{moduleId:'environment',claimId:'environment-1-layerType'}}))).toBe(false)
  expect(validate(inference({upstream:{moduleId:'preplan.research.01.02',claimId:'invented-claim'}}))).toBe(false)
 })
 it('keeps exact prior evidence addresses and real nonmissing upstream claims available without choosing a basis',()=>{
  const {validate}=nativeEvidence()
  expect(validate(inference({local:address}))).toBe(true)
  expect(validate(inference({upstream:{moduleId:'preplan.research.01.02',claimId:'boundary-method'}}))).toBe(true)
  expect(validate(inference({local:{...address,field:'measuredValue',at:'/invented-leaf'}}))).toBe(false)
  expect(validate(inference({upstream:{moduleId:'preplan.research.01.02',claimId:'absent-geometry'}}))).toBe(false)
 })
 it('preserves proposals, frozen originals and preceding authors with a supported native schema',()=>{
  const before=hash([prior,upstream,corpus]),{schema,validate}=nativeEvidence()
  expect(()=>assertObjectJsonSchema(schema)).not.toThrow()
  expect(validate({target:{...address,field:'verificationTasks',at:'/0'},kind:'proposal',rationale:'An actual synthetic task selection, not a surveyed fact'})).toBe(true)
  expect(hash([prior,upstream,corpus])).toBe(before)
 })
 it('keeps historical author replay strict even when a new native request constrains addresses',()=>{
  const raw=draft(plan.at(-1)),before=hash(prior)
  raw.outputs.environment.records[0].verificationTasks={value:['Synthetic verification task'],claimClass:'agent_inference',limitations:['Not completed']}
  raw.evidence=[inference({upstream:{moduleId:'environment',claimId:'environment-1-layerType'}})]
  raw.stepResults.step4.fieldRefs=[raw.evidence[0].target]
  expect(()=>groups.validateModuleAuthorGroup('1.05',raw,prior,corpus,upstream)).toThrow('MODULE_CLAIM_UPSTREAM_MISSING')
  expect(hash(prior)).toBe(before)
 })
 it('derives the same real upstream identities for ordinary groups while keeping legacy replay separate',()=>{
  const ordinary=groups.getModuleAuthorGroupSchema('1.05','environment:1',[],version,corpus,undefined,upstream)
  const original=groups.getModuleAuthorGroupSchema('1.05','environment:1',[],version,corpus)
  expect(ordinary.properties!.outputs).toEqual(original.properties!.outputs)
  const check=new Ajv({strict:false}).compile(bindNativeModuleEvidenceSchema(ordinary).properties!.evidence.items!)
  const evidence={target:address,kind:'inference',rationale:'Synthetic context',inputRefs:[{upstream:{moduleId:'preplan.research.01.02',claimId:'boundary-method'}}]}
  expect(check(evidence)).toBe(true)
  expect(check({...evidence,inputRefs:[{upstream:{moduleId:'preplan.research.01.02',claimId:'invented'}}]})).toBe(false)
 })
})
