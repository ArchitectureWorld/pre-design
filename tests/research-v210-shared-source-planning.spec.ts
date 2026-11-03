import {describe,expect,it} from 'vitest'
import {allocateModuleMaterialCharsForEquivalentSchemas,allocateModuleMaterialCharsForSharedInput,assertNativeModuleContext} from '../src/research-v2/native-module-context-budget.ts'
import {moduleReferencePromptView,expandModuleReferencePromptView} from '../src/research-v2/module-reference-context.ts'
import {sliceModuleCorpus} from '../src/research-v2/module-prompt-context.ts'
import {materialCorpusFingerprint} from '../src/materials/research-evidence.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'
import type {ObjectJsonSchema} from '@deepseek-ai/dsh-tools'

const schema:ObjectJsonSchema={type:'object',properties:{choice:{type:'string'}},required:['choice'],additionalProperties:false}
const bytes=(value:unknown)=>Buffer.byteLength(JSON.stringify(value),'utf8')
function fixture(){
 const common='同一对象的条件和依据须逐项保留核对'
 const notes=Array.from({length:3000},(_,i)=>`第${i}条${common}${i}`)
 const fixed={taskBrief:'Synthetic planning scope only',upstream:[{limitations:notes},{limitations:notes},{limitations:notes}],
  sourceValues:[{path:'原始资料/required.txt',quote:'😀完整原文，0.03 m³/s，轴序xy，换行\n保持。'}]}
 const input={documents:[{path:'原始资料/required.txt',contentHash:'a'.repeat(64),byteLength:24000,text:'汉'.repeat(8000)}],limitations:['Synthetic original source']}
 return {fixed,corpus:{...input,fingerprint:materialCorpusFingerprint(input)}}
}

describe('complete native input sharing in the final source-planning retry',()=>{
 it('retains mandatory original text within the unchanged half-input allocation after a profitable complete-request view',()=>{
  const {fixed,corpus}=fixture(),before=hash({fixed,corpus}),fixedText=JSON.stringify(moduleReferencePromptView(fixed,true))
  const minimum=bytes(sliceModuleCorpus(corpus,{query:'required',maxMaterialChars:48000}))
  const route={contextWindow:Buffer.byteLength(fixedText)+bytes(schema)+32768+128000+minimum*2-3000,outputTokenLimit:128000}
  const old=allocateModuleMaterialCharsForEquivalentSchemas([route],fixedText,[],[schema])!
  expect(()=>sliceModuleCorpus(corpus,{query:'required',maxMaterialChars:48000,maxMaterialUtf8Bytes:old*3,materialByteEncoding:'readonly-reference'})).toThrow('MODULE_PROMPT_BUDGET_EXCEEDED')
  const capacity=allocateModuleMaterialCharsForSharedInput([route],fixed,[],[schema])!
  expect(capacity).toBeGreaterThan(old)
  const selected=sliceModuleCorpus(corpus,{query:'required',maxMaterialChars:48000,maxMaterialUtf8Bytes:capacity*3,materialByteEncoding:'readonly-reference'})
  expect(selected.documents[0].paragraphs![0].text).toBe(corpus.documents[0].text)
  const full={orderedNativeInput:[{json:{...fixed,sources:selected}}]},wire=moduleReferencePromptView(full,true)
  expect(expandModuleReferencePromptView(wire)).toEqual(full)
  const admission=assertNativeModuleContext(route,JSON.stringify(wire),JSON.stringify(schema),[])!
  expect(admission.outputReservedTokens).toBe(128000)
  expect(admission.estimatedInputTokens+admission.outputReservedTokens).toBeLessThanOrEqual(route.contextWindow)
  expect(hash({fixed,corpus})).toBe(before)
 })
 it('reserves the same images, schema, corrections and half-input headroom',()=>{
  const {fixed}=fixture(),images=[{type:'image'}],route={contextWindow:872000,outputTokenLimit:128000}
  const packet={orderedNativeInput:[{json:fixed}]},shared=moduleReferencePromptView(packet,true)
  expect(expandModuleReferencePromptView(shared)).toEqual(packet)
  const expected=allocateModuleMaterialCharsForEquivalentSchemas([route],JSON.stringify(shared),images,[schema])
  expect(allocateModuleMaterialCharsForSharedInput([route],fixed,images,[schema])).toBe(expected)
  expect(allocateModuleMaterialCharsForSharedInput([route],fixed,[],[schema])! - expected!).toBeGreaterThanOrEqual(1365)
 })
 it('does not invent limits for unknown routes or waive a fixed input that truly cannot fit',()=>{
  const {fixed}=fixture()
  expect(allocateModuleMaterialCharsForSharedInput([{}],fixed,[],[schema])).toBeUndefined()
  expect(allocateModuleMaterialCharsForSharedInput([{contextWindow:872000,outputTokenLimit:128000},{}],{},[],[schema])).toBeUndefined()
  expect(()=>allocateModuleMaterialCharsForSharedInput([{contextWindow:2000,outputTokenLimit:1000}],fixed,[],[schema])).toThrow('MODULE_MODEL_CONTEXT_BUDGET_EXCEEDED')
 })
})
