import {describe,expect,it} from 'vitest'
import {validateJsonSchemaValue,type JsonSchemaNode} from '@deepseek-ai/dsh-tools'
import {nativeGatewaySchema} from '../src/research-v2/native-gateway-schema.ts'
import {bindNativeModuleEvidenceSchema,getModuleAuthorProjectionSchema} from '../src/research-v2/module-author-projection.ts'
import {expandNativeSchemaDescription} from '../src/research-v2/native-schema-reference.ts'
const original=()=>bindNativeModuleEvidenceSchema(getModuleAuthorProjectionSchema('7.02'))
// Regression model of Antigravity 4.9.6 extract_best_schema_from_union:
// object > array > scalar > null; equal scores retain the first branch.
// The exact published Rust mapper is also replayed against saved real requests
// in the isolated control workspace; these tests require no gateway or network.
function gateway(node:JsonSchemaNode):any{
 const out:any=structuredClone(node)
 if(out.properties)out.properties=Object.fromEntries(Object.entries(out.properties).map(([k,v])=>[k,gateway(v as JsonSchemaNode)]))
 if(out.items)out.items=gateway(out.items)
 if(out.oneOf){
  const score=(v:any)=>v.type==='object'?3:v.type==='array'?2:v.type&&v.type!=='null'?1:0
  const choices=out.oneOf.map(gateway),best=choices.reduce((a:any,b:any)=>score(a)>=score(b)?a:b)
  Object.assign(out,best);delete out.oneOf
 }
 if(Object.hasOwn(out,'const')){out.enum=[out.const];delete out.const}
 if(out.enum?.length){out.enum=out.enum.map(String);out.type='string'}
 return out
}
describe('gateway tool schema retains all research choices',()=>{
 it('keeps decision fields and proposal evidence visible after the gateway branch selection',()=>{
  const input=original(),before=JSON.stringify(input),prepared=nativeGatewaySchema(input,'antigravity')
  const wire=gateway(prepared?.schema??input)
  expect(wire.properties.outputs.properties.business_model.properties.records.items.properties.businessId.properties.claimClass.enum).toContain('decision')
  expect(wire.properties.evidence.items.properties.kind.enum).toEqual(expect.arrayContaining(['source','calculation','assumption','proposal','inference']))
  expect(wire.properties.evidence.items.required).not.toContain('source')
  expect(wire.properties.evidence.items.properties.inputRefs.items.properties.upstream).toBeDefined()
  expect(JSON.stringify(input)).toBe(before)
 })
 it('retains the complete original contract for validation rather than accepting crossed evidence members',()=>{
  const input=original(),prepared=nativeGatewaySchema(input,'antigravity')
  expect(prepared).toBeDefined()
  const descriptor=JSON.parse(prepared!.instruction.split('\n').find(line=>line.startsWith('{"nativeGatewayOriginalSchema":'))!).nativeGatewayOriginalSchema
  expect(expandNativeSchemaDescription(descriptor)).toEqual(input)
  const target={port:'business_model',recordId:'study-option',field:'businessId',at:''}
  const proposal={target,kind:'proposal',rationale:'Synthetic planning choice; not an approved operator.'}
  expect(validateJsonSchemaValue(input.properties!.evidence.items!,proposal)).toEqual([])
  const crossed={...proposal,source:{path:'unrelated.pdf',quote:'Does not establish the proposal'}}
  expect(validateJsonSchemaValue(prepared!.schema.properties!.evidence.items!,crossed)).toEqual([])
  expect(validateJsonSchemaValue(input.properties!.evidence.items!,crossed).length).toBeGreaterThan(0)
  const missing={value:'invented',claimClass:'missing',limitations:['unverified']}
  const field=input.properties!.outputs.properties!.business_model.properties!.records.items!.properties!.businessId
  expect(validateJsonSchemaValue(field,missing).length).toBeGreaterThan(0)
 })
 it('does not change other providers or union-free review contracts',()=>{
  const input=original()
  expect(nativeGatewaySchema(input,'native')).toBeUndefined()
  expect(nativeGatewaySchema({type:'object',properties:{verdict:{type:'string',enum:['pass','limited','fail']}},required:['verdict']},'antigravity')).toBeUndefined()
 })
 it('preserves numeric and boolean types when the gateway would stringify their literal choices',()=>{
  const input:any={type:'object',properties:{page:{type:'integer',enum:[1,2]},verified:{type:'boolean',const:false}},required:['page','verified']}
  const prepared=nativeGatewaySchema(input,'antigravity'),wire=gateway(prepared?.schema??input)
  expect(wire.properties.page.type).toBe('integer')
  expect(wire.properties.verified.type).toBe('boolean')
  expect(validateJsonSchemaValue(input,{page:3,verified:false}).length).toBeGreaterThan(0)
  expect(validateJsonSchemaValue(input,{page:1,verified:false})).toEqual([])
 })
})
