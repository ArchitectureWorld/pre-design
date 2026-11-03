import {expect,it} from 'vitest'
import {assertObjectJsonSchema,validateJsonSchemaValue} from '@deepseek-ai/dsh-tools'
import {getModuleAuthorGroupSchema,validateModuleAuthorGroup} from '../src/research-v2/module-author-groups.ts'
import {bindNativeModuleEvidenceSchema,getModuleAuthorProjectionSchema} from '../src/research-v2/module-author-projection.ts'
import {getModuleFieldContracts} from '../src/research-v2/module-contracts.ts'
import {materialCorpusFingerprint} from '../src/materials/research-evidence.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'

const target={port:'market_context',recordId:'synthetic-record',field:'indicator',at:''}
const placeholder={port:'x',recordId:'x',field:'x',at:''}
const native=()=>bindNativeModuleEvidenceSchema(getModuleAuthorGroupSchema('3.01','market_context:1'))
const empty={documents:[],limitations:[]}
const corpus={...empty,fingerprint:materialCorpusFingerprint(empty)}
const draft=():any=>({projectionVersion:'module-author-field-group.v13',groupId:'market_context:1',
  outputs:{market_context:{type:getModuleFieldContracts('3.01').ports.market_context.type,quality:'limited',
    scope:'Synthetic contract test',asOf:'2026-10-06',limitations:['No real market facts'],records:[{
      recordId:target.recordId,resultClass:'observation_summary',
      ...Object.fromEntries(['indicatorId','region','period','indicator'].map(field=>[field,{
        value:null,claimClass:'missing',limitations:['No original support']}]))}]}},
  evidence:[],limitations:['Synthetic only'],stepResults:Object.fromEntries([1,2,3,4].map(step=>['step'+step,{
    status:'limited',summary:'No original support',fieldRefs:[],limitations:['No original support']}]))})

it('rejects placeholder and out-of-group addresses at each native step boundary',()=>{
  const schema=native()
  for(const step of ['step1','step2','step3','step4']){
    const refs=schema.properties!.stepResults.properties![step].properties!.fieldRefs
    for(const invalid of [placeholder,{...target,port:'regional_context'},{...target,field:'normalizedValue'}])
      expect(validateJsonSchemaValue(refs,[invalid])).not.toEqual([])
    for(const field of ['indicatorId','region','period','indicator'])
      expect(validateJsonSchemaValue(refs,[{...target,field}])).toEqual([])
  }
  expect(()=>assertObjectJsonSchema(schema)).not.toThrow()
})

it('rejects foreign targets and invented dependencies in every native evidence kind',()=>{
  const evidence=native().properties!.evidence.items!
  const entries=[{kind:'source',source:{path:'synthetic.txt',quote:'Synthetic only'}},
    {kind:'calculation',calculation:{operation:'ratio',operands:[]}},
    ...['proposal','assumption','inference'].map(kind=>({kind,rationale:'Synthetic contract only',
      ...(kind==='inference'?{inputRefs:[{local:target}]}:{})}))]
  for(const entry of entries){
    expect(validateJsonSchemaValue(evidence,{...entry,target})).toEqual([])
    for(const invalid of [placeholder,{...target,field:'statisticalBasis'},{...target,port:'peer_supply'}])
      expect(validateJsonSchemaValue(evidence,{...entry,target:invalid})).not.toEqual([])
    expect(validateJsonSchemaValue(evidence,{...entry,target,inputRefs:[{local:target}]})).toEqual([])
    expect(validateJsonSchemaValue(evidence,{...entry,target,inputRefs:[{local:{
      port:'market_context',recordId:'previous-record',field:'normalizedValue',at:'/value'}}]})).not.toEqual([])
  }
})

it('keeps native schema narrowing from mutating the general projection or later group dependencies',()=>{
  native()
  const general=getModuleAuthorProjectionSchema('3.01').properties!.steps.items!.properties!.fieldRefs
  expect(validateJsonSchemaValue(general,[placeholder])).toEqual([])
  const later=bindNativeModuleEvidenceSchema(getModuleAuthorGroupSchema('3.01','market_context:2.2',[draft()]))
  const refs=later.properties!.stepResults.properties!.step1.properties!.fieldRefs
  expect(validateJsonSchemaValue(refs,[{...target,field:'statisticalBasis'}])).toEqual([])
})

it('preserves historical central rejection and the original draft when a step cites nonexistent evidence',()=>{
  const raw=draft();raw.stepResults.step1.fieldRefs=[placeholder]
  const before=hash(raw)
  expect(()=>validateModuleAuthorGroup('3.01',raw,[],corpus)).toThrow(/MODULE_GROUP_STEPS:.*has no matching evidence.target/)
  expect(hash(raw)).toBe(before)
  raw.stepResults.step1.fieldRefs=[]
  expect(validateModuleAuthorGroup('3.01',raw,[],corpus)).toEqual(raw)
})
