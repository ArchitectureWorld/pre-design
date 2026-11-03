import {describe,it,expect} from 'vitest'
import {assertObjectJsonSchema,validateJsonSchemaValue,type ObjectJsonSchema} from '@deepseek-ai/dsh-tools'
import {prepareNativeModuleJsonWire,decodeNativeModuleJsonWire,NATIVE_MODULE_JSON_WIRE_SCHEMA,NATIVE_MODULE_JSON_WIRE_VERSION} from '../src/research-v2/native-submission-wire.ts'
import {assertNativeModuleContext} from '../src/research-v2/native-module-context-budget.ts'
import {expandModuleReferencePromptView} from '../src/research-v2/module-reference-context.ts'
import {expandNativeSchemaDescription} from '../src/research-v2/native-schema-reference.ts'
import {verifyModuleNativeSubmission} from '../src/research-v2/module-group-recovery.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'

const choices=Array.from({length:180},(_,i)=>`research/source-document-${i}/records/原始引文与限定/paragraph-${i}`)
function fixture(){
 const leaf={type:'object' as const,additionalProperties:false,properties:{selector:{type:'string' as const,enum:choices},amount:{type:'number' as const},claimClass:{type:'string' as const,enum:['proposal','assumption']}},required:['selector','amount','claimClass']}
 const names=Array.from({length:12},(_,i)=>'field'+i)
 const schema:ObjectJsonSchema={type:'object',additionalProperties:false,properties:Object.fromEntries(names.map(name=>[name,structuredClone(leaf)])),required:names}
 const value=Object.fromEntries(names.map(name=>[name,{selector:choices[0],amount:3,claimClass:'assumption'}]))
 return {schema,value}
}
const wire=(value:unknown)=>({wireVersion:NATIVE_MODULE_JSON_WIRE_VERSION,submissionJson:JSON.stringify(value)})
const route={provider:'synthetic',model:'fixture'}
function events(schema:ObjectJsonSchema,value:unknown,body:unknown){return [
 {seq:1,type:'turn/start',data:{turn:1}},
 {seq:2,type:'user/message',data:{content:[{type:'text',text:JSON.stringify({nativeSubmissionWire:{version:NATIVE_MODULE_JSON_WIRE_VERSION,fullNativeSchema:schema,fullNativeSchemaHash:hash(schema)}})}]}},
 {seq:3,type:'request/header',data:{header:{config:route,tools:[{name:'structured_output',parameters:body}]}}},
 {seq:4,type:'tool/call',data:{turn:1,step:0,name:'structured_output',callId:'fixture-call',arguments:JSON.stringify(value)}},
 {seq:5,type:'tool/result',data:{turn:1,step:0,message:{content:[{type:'tool-result',toolCallId:'fixture-call',isError:false}]}}},
 {seq:6,type:'turn/end',data:{turn:1,reason:{kind:'completed'}}},
]}
describe('capacity-only full JSON native submission wire',()=>{
 it('fits repeated native constraints without changing the original request, schema or limits',()=>{
  const {schema}=fixture(),before=structuredClone(schema),sources={text:'完整来源与全部限定。'.repeat(240),value:0,missing:null}
  const prompt='原始专业指令\n'+JSON.stringify({sources}),limits={contextWindow:150000,outputTokenLimit:32000},images=[{type:'image'}]
  expect(()=>assertNativeModuleContext(limits,prompt,JSON.stringify(schema),images)).toThrow('MODULE_MODEL_CONTEXT_BUDGET_EXCEEDED')
  const prepared=prepareNativeModuleJsonWire(prompt,schema)
  assertObjectJsonSchema(prepared.schema)
  expect(()=>assertNativeModuleContext(limits,prepared.prompt,JSON.stringify(prepared.schema),images)).not.toThrow()
  const view:any=expandModuleReferencePromptView(JSON.parse(prepared.prompt.split('\n').at(-1)!))
  expect(view.orderedNativeInput.slice(0,2)).toEqual([{text:'原始专业指令'},{json:{sources}}])
  const binding=view.orderedNativeInput.find((part:any)=>part.json?.nativeSubmissionWire).json.nativeSubmissionWire
  expect(expandNativeSchemaDescription(binding.fullNativeSchema)).toEqual(schema);expect(binding.fullNativeSchemaHash).toBe(hash(schema));expect(schema).toEqual(before)
 })
 it('parses the model-owned JSON once and preserves its exact values',()=>{
  const {schema,value}=fixture(),original=wire(value),before=structuredClone(original)
  expect(decodeNativeModuleJsonWire(original,schema)).toEqual(value)
  expect(original).toEqual(before)
 })
 it('rejects malformed, untagged, fenced or non-object wire submissions',()=>{
  const {schema}=fixture()
  for(const candidate of [{submissionJson:'{}'},{wireVersion:'other',submissionJson:'{}'}, {...wire({}),extra:1},wire([]),wire(null),{wireVersion:NATIVE_MODULE_JSON_WIRE_VERSION,submissionJson:'```json\n{}\n```'}, {wireVersion:NATIVE_MODULE_JSON_WIRE_VERSION,submissionJson:'{bad'}])
   expect(()=>decodeNativeModuleJsonWire(candidate,schema)).toThrow('MODULE_NATIVE_JSON_WIRE_INVALID')
 })
 it('retains the original required fields, exact source selectors, numeric types and extra-property rejection',()=>{
  const {schema,value}=fixture(),missing=structuredClone(value);delete (missing.field0 as any).claimClass
  const selector=structuredClone(value);selector.field0.selector='research/unbound'
  const number=structuredClone(value) as any;number.field0.amount='3'
  for(const candidate of [missing,selector,number,{...value,extra:1}]){
   expect(validateJsonSchemaValue(schema,candidate).length).toBeGreaterThan(0)
   expect(()=>decodeNativeModuleJsonWire(wire(candidate),schema)).toThrow('MODULE_NATIVE_JSON_WIRE_INVALID')
  }
 })
 it('retains the parsed original in a schema rejection without repairing or accepting it',()=>{
  const {schema,value}=fixture(),rejected=structuredClone(value)
  rejected.field0.selector='research/unbound'
  const original=wire(rejected),before=structuredClone(original)
  let failure:unknown
  try{decodeNativeModuleJsonWire(original,schema)}catch(error){failure=error}
  expect(failure).toBeInstanceOf(Error)
  expect((failure as Error).message).toContain('MODULE_NATIVE_JSON_WIRE_INVALID: original field schema rejected submission')
  expect((failure as Error&{decodedSubmission?:unknown}).decodedSubmission).toEqual(rejected)
  expect(validateJsonSchemaValue(schema,rejected).length).toBeGreaterThan(0)
  expect(original).toEqual(before)
 })
 it('replays the actual tagged native call against its exact full-schema binding',()=>{
  const {schema,value}=fixture(),submitted=wire(value),native=events(schema,submitted,NATIVE_MODULE_JSON_WIRE_SCHEMA)
  expect(()=>verifyModuleNativeSubmission(native,route,value)).not.toThrow()
  const changed=structuredClone(native) as any;changed[1].data.content[0].text=JSON.stringify({nativeSubmissionWire:{version:NATIVE_MODULE_JSON_WIRE_VERSION,fullNativeSchema:schema,fullNativeSchemaHash:'0'.repeat(64)}})
  expect(()=>verifyModuleNativeSubmission(changed,route,value)).toThrow()
  expect(()=>verifyModuleNativeSubmission(events(schema,submitted,schema),route,value)).toThrow('native payload mismatch')
  expect(()=>verifyModuleNativeSubmission(native,route,{...value,extra:1})).toThrow('native payload mismatch')
 })
 it('identifies a stale local record inside nested evidence unions while keeping the submission rejected',()=>{
  const local={type:'object' as const,additionalProperties:false,required:['local'],properties:{local:{type:'object' as const,additionalProperties:false,
   required:['port','recordId'],properties:{port:{type:'string' as const,const:'business_model'},recordId:{type:'string' as const,enum:['knowledge-service','tea-content']}}}}}
  const schema:ObjectJsonSchema={type:'object',required:['evidence'],properties:{evidence:{type:'array',items:{oneOf:[
   {type:'object',required:['kind','source'],properties:{kind:{type:'string',const:'source'},source:{type:'string'}}},
   {type:'object',required:['kind','inputRefs'],properties:{kind:{type:'string',const:'proposal'},inputRefs:{type:'array',items:{oneOf:[local]}}}},
  ]}}}}
  const value={evidence:[{kind:'proposal',inputRefs:[{local:{port:'business_model',recordId:'old-placeholder'}}]}]},original=wire(value),before=structuredClone(original)
  expect(()=>decodeNativeModuleJsonWire(original,schema)).toThrow(/value\.evidence\[0\]\.inputRefs\[0\]\.local\.recordId/)
  expect(()=>decodeNativeModuleJsonWire(original,schema)).toThrow('knowledge-service')
  expect(original).toEqual(before)
 })
 it('reports the canonical upstream module even when unrelated local branches have equally few errors',()=>{
  const ref:ObjectJsonSchema={type:'object',oneOf:[
   {type:'object',additionalProperties:false,required:['local'],properties:{local:{type:'object'}}},
   {type:'object',additionalProperties:false,required:['upstream'],properties:{upstream:{type:'object',required:['moduleId','claimId'],
    properties:{moduleId:{type:'string',const:'preplan.research.05.07'},claimId:{type:'string',enum:['registered-claim']}}}}},
  ]}
  const schema:ObjectJsonSchema={type:'object',required:['inputRefs'],properties:{inputRefs:{type:'array',items:ref}}}
  const value={inputRefs:[{upstream:{moduleId:'5.07',claimId:'old-claim'}}]},original=wire(value)
  expect(()=>decodeNativeModuleJsonWire(original,schema)).toThrow('value.inputRefs[0].upstream.moduleId')
  expect(()=>decodeNativeModuleJsonWire(original,schema)).toThrow('preplan.research.05.07')
  expect(()=>decodeNativeModuleJsonWire(original,schema)).toThrow('registered-claim')
 })
 it('bounds nested union diagnostics without accepting or modifying an oversized invalid reference',()=>{
  const schema:ObjectJsonSchema={type:'object',properties:{refs:{type:'array',items:{oneOf:[{type:'object',properties:{id:{type:'string',enum:Array.from({length:90},(_,i)=>'frozen-'+i+'x'.repeat(90))}},required:['id']}]}}}}
  const original=wire({refs:Array.from({length:30},()=>({id:'unregistered'}))}),before=structuredClone(original)
  let error:Error|undefined
  try{decodeNativeModuleJsonWire(original,schema)}catch(value){error=value as Error}
  expect(error?.message).toContain('value.refs[0].id')
  expect(error!.message.length).toBeLessThan(6000)
  expect(original).toEqual(before)
 })
 it('retains ambiguity rejection when multiple union branches already match',()=>{
  const schema:ObjectJsonSchema={type:'object',properties:{ref:{oneOf:[{type:'string'},{type:'string'}]}}}
  expect(()=>decodeNativeModuleJsonWire(wire({ref:'same'}),schema)).toThrow('matched 2')
 })
 it('keeps legacy native object replay strict',()=>{
  const {schema,value}=fixture()
  expect(()=>verifyModuleNativeSubmission(events(schema,value,schema),route,value)).not.toThrow()
  expect(()=>verifyModuleNativeSubmission(events(schema,{...value,extra:1},schema),route,value)).toThrow('native payload mismatch')
 })
 it('does not bypass exhausted output reservation or accept a wire without its native schema commitment',()=>{
  const {schema,value}=fixture(),prepared=prepareNativeModuleJsonWire('完整来源与原指令',schema)
  expect(()=>assertNativeModuleContext({contextWindow:128000,outputTokenLimit:128000},prepared.prompt,JSON.stringify(prepared.schema),[])).toThrow('MODULE_MODEL_CONTEXT_BUDGET_EXCEEDED')
  const missing=events(schema,wire(value),NATIVE_MODULE_JSON_WIRE_SCHEMA).filter(event=>event.type!=='user/message')
  expect(()=>verifyModuleNativeSubmission(missing,route,value)).toThrow('exactly one native full-schema commitment required')
 })
})
