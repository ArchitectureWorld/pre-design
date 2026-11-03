import {describe,expect,it} from 'vitest'
import {assertObjectJsonSchema,validateJsonSchemaValue} from '@deepseek-ai/dsh-tools'
import {getModuleAuthorExecutionFieldGroups,getModuleAuthorGroupSchema,getModuleAuthorGroupVersion} from '../src/research-v2/module-author-groups.ts'
import {getModuleFieldContracts} from '../src/research-v2/module-contracts.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'

function fixture(){
 const itemId='3.05',first=getModuleAuthorExecutionFieldGroups(itemId)[0],version=getModuleAuthorGroupVersion(itemId)
 const raw:any={projectionVersion:version,groupId:first.groupId,outputs:{peer_products:{
  type:getModuleFieldContracts(itemId).ports.peer_products.type,quality:'limited',scope:'Synthetic address regression',asOf:'2026-10-06',
  records:['synthetic-peer-a','synthetic-peer-b','synthetic-peer-c'].map(recordId=>({recordId,resultClass:'observation_summary',
   ...Object.fromEntries(first.fields.map(field=>[field,{value:null,claimClass:'missing',limitations:['Synthetic only']}]))})),limitations:['Synthetic only']}},
  evidence:[],limitations:['Synthetic only'],stepResults:{}}
 const prior=[raw],before=hash(prior),group=getModuleAuthorExecutionFieldGroups(itemId,prior)[1]
 const schema=getModuleAuthorGroupSchema(itemId,group.groupId,prior,version)
 expect(hash(prior)).toBe(before)
 return {schema,group}
}
function wrapper(node:any):any{return {type:'object',additionalProperties:false,required:['address'],properties:{address:node}}}
describe('peer-product native address contract',()=>{
 it.each(['step','evidence'])('rejects a record ID in the %s port slot before accepting the native tool submission',kind=>{
  const {schema,group}=fixture()
  expect(()=>assertObjectJsonSchema(schema)).not.toThrow()
  const node=kind==='step'?schema.properties!.stepResults.properties!.step4.properties!.fieldRefs.items!:schema.properties!.evidence.items!.properties!.target
  const address={port:'peer_products',recordId:group.recordIds![0],field:group.fields[0],at:''}
  expect(validateJsonSchemaValue(wrapper(node),{address})).toEqual([])
  expect(validateJsonSchemaValue(wrapper(node),{address:{...address,port:address.recordId}}).length).toBeGreaterThan(0)
 })
 it('rejects step references to unassigned records or fields while keeping the actual frozen subset',()=>{
  const {schema,group}=fixture(),node=schema.properties!.stepResults.properties!.step3.properties!.fieldRefs.items!
  const address={port:'peer_products',recordId:group.recordIds![0],field:group.fields[0],at:''}
  expect(validateJsonSchemaValue(wrapper(node),{address})).toEqual([])
  expect(validateJsonSchemaValue(wrapper(node),{address:{...address,recordId:'synthetic-peer-c'}}).length).toBeGreaterThan(0)
  expect(validateJsonSchemaValue(wrapper(node),{address:{...address,field:'outside-group-field'}}).length).toBeGreaterThan(0)
 })
})
