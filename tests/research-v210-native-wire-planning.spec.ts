import {describe,expect,it} from 'vitest'
import type {ObjectJsonSchema} from '@deepseek-ai/dsh-tools'
import * as Budget from '../src/research-v2/native-module-context-budget.ts'
import {prepareNativeModuleJsonWire} from '../src/research-v2/native-submission-wire.ts'
import {moduleReferencePromptView,expandModuleReferencePromptView} from '../src/research-v2/module-reference-context.ts'
import {sliceModuleCorpus} from '../src/research-v2/module-prompt-context.ts'
import {materialCorpusFingerprint} from '../src/materials/research-evidence.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'

function allocate(...args:unknown[]){
 const fn=(Budget as any).allocateModuleMaterialCharsForSubmissionWire
 expect(typeof fn,'source planning reaches the existing complete native JSON transport').toBe('function')
 return fn(...args) as number|undefined
}
function fixture(){
 const fixed={taskBrief:'Synthetic scope only',upstream:[{notes:Array.from({length:1000},(_,i)=>`条件${i}须完整保留，不表示已批准。`)}]}
 const schema:ObjectJsonSchema={type:'object',additionalProperties:false,properties:Object.fromEntries(Array.from({length:2500},(_,i)=>
  [`field${i}`,{type:'string',enum:['候选条件方案','暂缺依据']}]))}
 const original={documents:[{path:'original.txt',contentHash:'a'.repeat(64),byteLength:3000,text:'汉'.repeat(1000)}],limitations:['Synthetic source']}
 return {fixed,schema,corpus:{...original,fingerprint:materialCorpusFingerprint(original)}}
}
describe('native JSON transport in source planning',()=>{
 it('retains complete mandatory source after the expanded declaration exhausts the original allowance',()=>{
  const {fixed,schema,corpus}=fixture(),before=hash({fixed,schema,corpus}),route={contextWindow:380000,outputTokenLimit:128000}
  expect(()=>Budget.allocateModuleMaterialChars([route],JSON.stringify(moduleReferencePromptView(fixed,true)),[],JSON.stringify(schema))).toThrow('MODULE_MODEL_CONTEXT_BUDGET_EXCEEDED')
  const capacity=allocate([route],fixed,[],[schema])!
  const selected=sliceModuleCorpus(corpus,{query:'original',maxMaterialChars:48000,maxMaterialUtf8Bytes:capacity*3,materialByteEncoding:'readonly-reference'})
  expect(selected.documents[0].paragraphs![0].text).toBe(corpus.documents[0].text)
  const wire=prepareNativeModuleJsonWire(JSON.stringify({...fixed,corpus:selected}),schema)
  const admission=Budget.assertNativeModuleContext(route,wire.prompt,JSON.stringify(wire.schema),[])!
  expect(admission.estimatedInputTokens+admission.outputReservedTokens).toBeLessThanOrEqual(route.contextWindow)
  const parts:any[]=wire.prompt.split('\n').flatMap(line=>{try{return [expandModuleReferencePromptView(JSON.parse(line))]}catch{return []}})
  const binding=parts.flatMap(v=>v.orderedNativeInput??[{json:v}]).find(p=>p.json?.nativeSubmissionWire)?.json.nativeSubmissionWire
  expect(binding.fullNativeSchema).toEqual(schema)
  expect(hash({fixed,schema,corpus})).toBe(before)
 })
 it('uses the most restrictive authorized schema and route and retains image and output reserves',()=>{
  const {fixed,schema}=fixture(),route={contextWindow:872000,outputTokenLimit:128000}
  const small:ObjectJsonSchema={type:'object',properties:{choice:{type:'string'}}}
  const plain=allocate([route],fixed,[],[schema])!,withImage=allocate([route],fixed,[{type:'image'}],[small,schema])!
  expect(plain-withImage).toBeGreaterThanOrEqual(1365)
  expect(allocate([route,{contextWindow:400000,outputTokenLimit:128000}],fixed,[],[small,schema])).toBeLessThan(plain)
 })
 it('does not invent unknown limits or admit an input that truly cannot fit',()=>{
  const {fixed,schema}=fixture()
  expect(allocate([{}],fixed,[],[schema])).toBeUndefined()
  expect(()=>allocate([{contextWindow:2000,outputTokenLimit:1000}],fixed,[],[schema])).toThrow('MODULE_MODEL_CONTEXT_BUDGET_EXCEEDED')
 })
})
