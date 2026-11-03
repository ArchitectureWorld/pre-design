import {describe,it,expect} from 'vitest'
import {validateJsonSchemaValue,assertObjectJsonSchema,type ObjectJsonSchema} from '@deepseek-ai/dsh-tools'
import {compactNativeModuleSchema} from '../src/research-v2/native-schema-compaction.ts'
import {assertNativeModuleContext} from '../src/research-v2/native-module-context-budget.ts'
import {findRejectedNativeSchemaSubmission} from '../src/research-v2/native-schema-recovery.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'
const valid=(schema:ObjectJsonSchema,value:unknown)=>validateJsonSchemaValue(schema,value).length===0
function fixture():ObjectJsonSchema{
 const refs=['a','b'].flatMap(moduleId=>Array.from({length:40},(_,index)=>({type:'object' as const,additionalProperties:false,
  required:['upstream'],description:'Synthetic shared invariant source guidance. '.repeat(500),properties:{upstream:{type:'object' as const,
  additionalProperties:false,required:['moduleId','claimId'],properties:{moduleId:{type:'string' as const,const:moduleId},claimId:{type:'string' as const,const:moduleId+':'+index}}}}})))
 return {type:'object',additionalProperties:false,required:['reference'],properties:{reference:{oneOf:refs}}}
}
describe('equivalent native Schema compaction',()=>{
 it('fits the native context budget while preserving all declared reference choices',()=>{
  const schema=fixture(),before=hash(schema),compact=compactNativeModuleSchema(schema),limits={contextWindow:872000,outputTokenLimit:128000}
  expect(()=>assertObjectJsonSchema(compact)).not.toThrow()
  expect(()=>assertNativeModuleContext(limits,'Unchanged synthetic input',JSON.stringify(schema),[])).toThrow()
  expect(()=>assertNativeModuleContext(limits,'Unchanged synthetic input',JSON.stringify(compact),[])).not.toThrow()
  for(const moduleId of ['a','b'])for(let index=0;index<40;index++){
   const value={reference:{upstream:{moduleId,claimId:moduleId+':'+index}}}
   expect(valid(schema,value)).toBe(true);expect(valid(compact,value)).toBe(true)
  }
  expect(hash(schema)).toBe(before)
 })
 it('keeps module and claim correlation and rejects unknown or crossed references',()=>{
  const schema=fixture(),compact=compactNativeModuleSchema(schema)
  for(const moduleId of ['a','b','unknown'])for(const claimId of ['a:0','b:0','missing']){
   const value={reference:{upstream:{moduleId,claimId}}}
   expect(valid(compact,value)).toBe(valid(schema,value))
  }
 })
 it('keeps a shared set of choices admissible to the native SDK',()=>{
  const schema=fixture()
  schema.properties!.reference.oneOf=schema.properties!.reference.oneOf!.filter((row:any)=>row.properties.upstream.properties.moduleId.const==='a')
  const compact=compactNativeModuleSchema(schema)
  expect(()=>assertObjectJsonSchema(compact)).not.toThrow()
  for(const claimId of ['a:0','a:39','missing']){
   const value={reference:{upstream:{moduleId:'a',claimId}}}
   expect(valid(compact,value)).toBe(valid(schema,value))
  }
 })
 it('preserves oneOf rejection when enum alternatives overlap',()=>{
  const schema:ObjectJsonSchema={type:'object',properties:{value:{oneOf:[{type:'string',enum:['a','b']},{type:'string',enum:['b','c']}]}}}
  const compact=compactNativeModuleSchema(schema)
  for(const value of ['a','b','c','d'])expect(valid(compact,{value})).toBe(valid(schema,{value}))
  expect(valid(compact,{value:'b'})).toBe(false)
 })
 it('does not turn absent optional properties from ambiguous branches into success',()=>{
  const schema:ObjectJsonSchema={type:'object',properties:{value:{oneOf:[
   {type:'object',additionalProperties:false,properties:{id:{type:'string',const:'a'}}},
   {type:'object',additionalProperties:false,properties:{id:{type:'string',const:'b'}}},
   {type:'object',required:['other'],properties:{other:{type:'string'}}}]}}}
  const compact=compactNativeModuleSchema(schema)
  expect(valid(schema,{value:{}})).toBe(false);expect(valid(compact,{value:{}})).toBe(false)
  for(const value of [{id:'a'},{id:'b'},{other:'x'}])expect(valid(compact,{value})).toBe(valid(schema,{value}))
 })
 it('preserves ambiguity for empty arrays and alternative validation paths',()=>{
  const schema:ObjectJsonSchema={type:'object',properties:{value:{oneOf:[
   {type:'object',required:['items'],properties:{items:{type:'array',items:{type:'string',const:'a'}}}},
   {type:'object',required:['items'],properties:{items:{type:'array',items:{type:'string',const:'b'}}}},
   {type:'object',required:['other'],properties:{other:{type:'boolean'}}}]}}}
  const compact=compactNativeModuleSchema(schema)
  expect(valid(schema,{value:{items:[]}})).toBe(false);expect(valid(compact,{value:{items:[]}})).toBe(false)
  for(const value of [{items:['a']},{items:['b']},{other:true}])expect(valid(compact,{value})).toBe(valid(schema,{value}))
 })
 it('does not combine contradictory const and enum constraints',()=>{
  const schema:ObjectJsonSchema={type:'object',properties:{value:{oneOf:[{type:'string',const:'a',enum:['b']},{type:'string',const:'b',enum:['a']}]}}}
  const compact=compactNativeModuleSchema(schema)
  expect(hash(compact)).toBe(hash(schema))
  for(const value of ['a','b'])expect(valid(compact,{value})).toBe(false)
 })
 it('never traverses business constant, enum or default payloads as schemas',()=>{
  const payload={oneOf:[{type:'string',const:'a'},{type:'string',const:'b'}]}
  const schema={type:'object',properties:{constant:{const:payload},choices:{enum:[payload]},fallback:{default:payload}}} as unknown as ObjectJsonSchema
  expect(hash(compactNativeModuleSchema(schema))).toBe(hash(schema))
 })
 it('retains different sibling constraints and annotations',()=>{
  const schema:ObjectJsonSchema={type:'object',properties:{value:{oneOf:[{type:'object',description:'First',properties:{kind:{type:'string',const:'a'},detail:{type:'string'}}},
   {type:'object',description:'Second',properties:{kind:{type:'string',const:'b'},detail:{type:'number'}}}]}}}
  const compact=compactNativeModuleSchema(schema)
  expect(hash(compact)).toBe(hash(schema));expect(valid(compact,{value:{kind:'a',detail:1}})).toBe(false);expect(valid(compact,{value:{kind:'b',detail:1}})).toBe(true)
 })
 it('leaves object-valued enum alternatives and branch order unchanged',()=>{
  const schema={type:'object',properties:{value:{oneOf:[{enum:[{kind:'a'}]},{enum:[{kind:'b'}]}]}}} as unknown as ObjectJsonSchema
  const compact=compactNativeModuleSchema(schema)
  expect(hash(compact)).toBe(hash(schema));expect(compact).not.toBe(schema)
 })
 it('diagnoses original field errors only against the exact equivalent advertised Schema',()=>{
  const schema=fixture(),ref=schema.properties!.reference
  schema.required!.push('evidence');schema.properties!.evidence={type:'array',items:{oneOf:[{type:'object',additionalProperties:false,
   required:['kind','inputRefs'],properties:{kind:{type:'string',const:'proposal'},inputRefs:{type:'array',items:ref}}},
   {type:'object',additionalProperties:false,required:['kind','inputRefs'],properties:{kind:{type:'string',const:'assumption'},inputRefs:{type:'array',items:ref}}}]}}
  const compact=compactNativeModuleSchema(schema),original={reference:{upstream:{moduleId:'a',claimId:'a:0'}},
   evidence:[{kind:'proposal',inputRefs:[{upstream:{moduleId:'a',claimId:'b:0'}}]}]}
  const events:any[]=[{seq:1,type:'turn/start',data:{turn:1}},{seq:2,type:'request/header',data:{header:{tools:[{name:'structured_output',parameters:compact}]}}},
   {seq:3,type:'tool/call',data:{turn:1,step:1,callId:'synthetic-call',name:'structured_output',arguments:JSON.stringify(original)}},
   {seq:4,type:'tool/result',data:{turn:1,step:1,message:{content:[{type:'tool-result',toolCallId:'synthetic-call',isError:true}]}}}]
  const rejection=findRejectedNativeSchemaSubmission(events,schema)
  expect(rejection?.originalSubmissionHash).toBe(hash(original));expect(rejection?.fieldDiagnostics).toHaveLength(1)
  const changed=structuredClone(events);changed[1].data.header.tools[0].parameters.description='Unbound change'
  expect(findRejectedNativeSchemaSubmission(changed,schema)).toBeUndefined();expect(valid(compact,original)).toBe(false)
 })
})
