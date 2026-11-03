import {describe,expect,it} from 'vitest'
import {allocateModuleMaterialChars,allocateModuleMaterialCharsForEquivalentSchemas,assertNativeModuleContext} from '../src/research-v2/native-module-context-budget.ts'
import {sliceModuleCorpus} from '../src/research-v2/module-prompt-context.ts'
import {materialCorpusFingerprint} from '../src/materials/research-evidence.ts'
import {moduleAuthorFrozenSourceBudget,moduleAuthorSourceFingerprintMatches} from '../src/research-v2/module-group-recovery.ts'
import {moduleReferencePromptView,expandModuleReferencePromptView} from '../src/research-v2/module-reference-context.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'
import {compactNativeModuleSchema} from '../src/research-v2/native-schema-compaction.ts'
import type {ObjectJsonSchema} from '@deepseek-ai/dsh-tools'

function corpus(){const input={documents:[{path:'原始资料/required.txt',contentHash:'a'.repeat(64),byteLength:31500,text:'汉'.repeat(10500)}],limitations:[]}
 return {...input,fingerprint:materialCorpusFingerprint(input)}}
function declaration():ObjectJsonSchema{return {type:'object',additionalProperties:false,required:['choice'],properties:{choice:{oneOf:['a','b','c'].map(kind=>({
 type:'object' as const,additionalProperties:false,required:['kind','value'],properties:{kind:{type:'string' as const,const:kind},value:{type:'string' as const,description:'original schema explanation '.repeat(480)}}}))}}}}

describe('equivalent schema source planning and exact byte-budget recovery',()=>{
 it('retains complete mandatory original text when an equivalent declaration fits the same route',()=>{
  const schema=declaration(),limits=[{contextWindow:Buffer.byteLength(JSON.stringify(schema))+1000+32768+60000,outputTokenLimit:1000}],original=corpus(),before=hash(original)
  const old=allocateModuleMaterialChars(limits,'',[],JSON.stringify(schema))!
  expect(()=>sliceModuleCorpus(original,{query:'required',maxMaterialChars:48000,maxMaterialUtf8Bytes:old*3})).toThrow('MODULE_PROMPT_BUDGET_EXCEEDED')
  const capacity=allocateModuleMaterialCharsForEquivalentSchemas(limits,'',[],[schema])!
  const selected=sliceModuleCorpus(original,{query:'required',maxMaterialChars:48000,maxMaterialUtf8Bytes:capacity*3})
  expect(selected.documents[0].paragraphs![0].text).toBe(original.documents[0].text)
  expect(hash(original)).toBe(before)
  expect(assertNativeModuleContext(limits[0],JSON.stringify(selected),JSON.stringify(compactNativeModuleSchema(schema)),[])?.estimatedInputTokens).toBeLessThan(limits[0].contextWindow-1000)
 })
 it('does not invent capacity for unknown routes or waive a truly insufficient declaration',()=>{
  expect(allocateModuleMaterialCharsForEquivalentSchemas([{}],'',[],[declaration()])).toBeUndefined()
  expect(()=>allocateModuleMaterialCharsForEquivalentSchemas([{contextWindow:2000,outputTokenLimit:1000}],'',[],[declaration()])).toThrow('MODULE_MODEL_CONTEXT_BUDGET_EXCEEDED')
 })
 it('measures an explicitly encoded complete source packet without truncating mandatory original spans',()=>{
  const original=corpus(),before=hash(original)
  const prose='先保留原始资料中的完整文字和全部定位身份；审批及运营条件仅供人工复核。'.repeat(35)
  const input={...original,limitations:Array.from({length:12},(_,index)=>`事项${index}：${prose}`)}
  const raw={...input,fingerprint:materialCorpusFingerprint(input)}
  const byteLimit=Buffer.byteLength(JSON.stringify(sliceModuleCorpus(raw,{query:'required',maxMaterialChars:48000})))-1500
  expect(()=>sliceModuleCorpus(raw,{query:'required',maxMaterialChars:48000,maxMaterialUtf8Bytes:byteLimit})).toThrow('MODULE_PROMPT_BUDGET_EXCEEDED')
  const selected=sliceModuleCorpus(raw,{query:'required',maxMaterialChars:48000,maxMaterialUtf8Bytes:byteLimit,materialByteEncoding:'readonly-reference'} as any)
  const wire=moduleReferencePromptView(selected,true)
  expect(Buffer.byteLength(JSON.stringify(wire))).toBeLessThanOrEqual(byteLimit)
  expect(expandModuleReferencePromptView(wire)).toEqual(selected)
  expect(selected.documents[0].paragraphs![0].text).toBe(original.documents[0].text)
  expect(selected.limitations).toEqual(input.limitations)
  expect((selected.selection as any).materialByteEncoding).toBe('readonly-reference')
  const sources={corpus:selected,inputRefs:[],upstream:[],sourceValues:[]},events:any[]=[{seq:1,type:'user/message',data:{content:[{type:'text',text:JSON.stringify({sources})}]}}]
  const budget=moduleAuthorFrozenSourceBudget(hash(sources),events)
  expect(budget).toEqual({maxMaterialChars:48000,maxMaterialUtf8Bytes:byteLimit,materialByteEncoding:'readonly-reference'})
  expect(hash({...sources,corpus:sliceModuleCorpus(raw,{query:'required',...budget})})).toBe(hash(sources))
  expect(()=>sliceModuleCorpus(raw,{query:'required',maxMaterialChars:48000,maxMaterialUtf8Bytes:100,materialByteEncoding:'readonly-reference'} as any)).toThrow('MODULE_PROMPT_BUDGET_EXCEEDED')
  expect(hash(original)).toBe(before)
 })
 it.each([false,true])('reproduces a hash-bound byte slice from original native request data (shared=%s)',shared=>{
  const original=corpus(),selected=sliceModuleCorpus(original,{query:'required',maxMaterialChars:48000,maxMaterialUtf8Bytes:36000})
  const sources={corpus:selected,inputRefs:[],upstream:[],sourceValues:[]},fingerprint=hash(sources)
  const packet=shared?moduleReferencePromptView({orderedNativeInput:[{json:{sources:moduleReferencePromptView(sources)}}]},true):{sources}
  const events:any[]=[{seq:1,type:'user/message',data:{content:[{type:'text',text:JSON.stringify(packet)}]}}]
  const budget=moduleAuthorFrozenSourceBudget(fingerprint,events)
  expect(budget).toEqual({maxMaterialChars:48000,maxMaterialUtf8Bytes:36000})
  const reconstructed={...sources,corpus:sliceModuleCorpus(original,{query:'required',...budget})}
  expect(moduleAuthorSourceFingerprintMatches(fingerprint,reconstructed)).toBe(true)
  expect(hash({...sources,corpus:sliceModuleCorpus(original,{query:'required'})})).not.toBe(fingerprint)
  expect(moduleAuthorFrozenSourceBudget('b'.repeat(64),events)).toBeUndefined()
  expect(moduleAuthorFrozenSourceBudget(fingerprint,[{seq:1,type:'assistant/message',data:events[0].data}] as any)).toBeUndefined()
 })
})
