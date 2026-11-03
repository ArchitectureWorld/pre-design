import {describe,expect,it} from 'vitest'
import Ajv from 'ajv'
import {bindNativeModuleEvidenceSchema,getModuleAuthorProjectionSchema} from '../src/research-v2/module-author-projection.ts'
const target={port:'peer_supply',recordId:'p',field:'peerId',at:''}
const source={path:'original.txt',quote:'original quotation'}
const calculation={operation:'sum',operands:[{sourceId:'s'}]}
const validate=(itemId='3.04')=>new Ajv({strict:false,allErrors:true}).compile(bindNativeModuleEvidenceSchema(getModuleAuthorProjectionSchema(itemId)).properties!.evidence.items!)
describe('native evidence tool members match the existing central kind boundary',()=>{
 it.each(['proposal','assumption','inference'])('rejects a source attached to %s before author submission',kind=>{
  expect(validate()({target,kind,source,rationale:'Synthetic schema probe only'})).toBe(false)
 })
 it.each(['proposal','assumption','inference'])('rejects calculation members attached to %s',kind=>{
  expect(validate()({target,kind,calculation,rationale:'Synthetic schema probe only'})).toBe(false)
 })
 it('requires the selected source/calculation member and rejects the opposite member',()=>{
  const check=validate()
  for(const evidence of [{target,kind:'source'},{target,kind:'calculation'},{target,kind:'source',source,calculation},{target,kind:'calculation',calculation,source}])expect(check(evidence)).toBe(false)
 })
 it('retains the existing valid evidence vocabulary without rewriting declarations',()=>{
  const check=validate()
  for(const evidence of [{target,kind:'source',source,unit:'元',rationale:'Source explanation'},
   {target,kind:'calculation',calculation,unit:'元'},...['proposal','assumption','inference'].map(kind=>({target,kind,rationale:'Explicit synthetic condition',inputRefs:[{local:target}]}))]){
   const before=JSON.stringify(evidence);expect(check(evidence)).toBe(true);expect(JSON.stringify(evidence)).toBe(before)
  }
 })
 it('retains the explicit photo source mappings in the source alternative',()=>{
  const evidence={target:{port:'site_use',recordId:'photo',field:'photoDate',at:''},kind:'source',source:{...source,dateMapping:{kind:'photo-exif-calendar-date.v1',dateTimeOriginalQuote:'2020:01:01 10:20:30'}}}
  expect(validate('1.07')(evidence)).toBe(true)
  expect(validate('1.07')({...evidence,kind:'proposal'})).toBe(false)
 })
 it('keeps replay schemas and review tools unchanged while binding only the new native author transport',()=>{
  const schema=getModuleAuthorProjectionSchema('1.01'),before=JSON.stringify(schema)
  const bound=bindNativeModuleEvidenceSchema(schema)
  const check=new Ajv({strict:false}).compile(bound.properties!.evidence.items!)
  expect(check({target:{port:'project_brief',recordId:'r',field:'formalName',at:''},kind:'proposal'})).toBe(false)
  expect(JSON.stringify(schema)).toBe(before)
  expect(JSON.stringify(schema).length).toBeLessThan(13000)
  const review={type:'object' as const,properties:{verdict:{type:'string' as const}},required:['verdict'],additionalProperties:false}
  expect(bindNativeModuleEvidenceSchema(review)).toEqual(review)
 })
})
