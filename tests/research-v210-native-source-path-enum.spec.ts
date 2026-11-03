import {createHash} from 'node:crypto'
import Ajv from 'ajv'
import {describe,expect,it} from 'vitest'
import {assertObjectJsonSchema} from '@deepseek-ai/dsh-tools'
import {bindNativeModuleEvidenceSchema,getModuleAuthorProjectionSchema} from '../src/research-v2/module-author-projection.ts'
import {bindNativeFrozenSourcePaths} from '../src/research-v2/native-source-path-schema.ts'
import {verifyModuleSourceValues} from '../src/research-v2/module-claims.ts'
import {materialCorpusFingerprint} from '../src/materials/research-evidence.ts'

const text='Historical report: planned facilities only.',contentHash=createHash('sha256').update(text).digest('hex')
const directory='research/runs/RUN-11111111-1111-4111-8111-111111111111/sources/'
const path=directory+contentHash+'.json',otherPath='original/source.txt'
const base={documents:[{path,contentHash,text,byteLength:Buffer.byteLength(text)},
 {path:otherPath,contentHash,text,byteLength:Buffer.byteLength(text)}],limitations:[]}
const corpus={...base,fingerprint:materialCorpusFingerprint(base)}
const target={port:'peer_products',recordId:'p',field:'coreProduct',at:''}
function nativeSchema(){return bindNativeFrozenSourcePaths(bindNativeModuleEvidenceSchema(getModuleAuthorProjectionSchema('3.05')),corpus)}
const check=()=>new Ajv({strict:false,allErrors:true}).compile(nativeSchema().properties!.evidence.items!)

describe('native author frozen path selection',()=>{
 it('rejects incomplete hashes, missing extensions and invented RUN paths before native tool acceptance',()=>{
  const validate=check()
  for(const wrong of [directory+contentHash.slice(0,44),directory+contentHash.slice(0,44)+'.json',path.replace('RUN-111','RUN-222')]){
   const evidence={target,kind:'source',source:{path:wrong,quote:text}},before=JSON.stringify(evidence)
   expect(validate(evidence)).toBe(false)
   expect(JSON.stringify(evidence)).toBe(before)
  }
 })
 it('retains all frozen locations and source declarations without selecting or rewriting a binding',()=>{
  const validate=check()
  for(const frozen of [path,otherPath]){
   const evidence={target,kind:'source',source:{path:frozen,quote:text},rationale:'Historical planning only'},before=JSON.stringify(evidence)
   expect(validate(evidence)).toBe(true);expect(JSON.stringify(evidence)).toBe(before)
  }
 })
 it('constrains the original paths in source calculation operands and weights too',()=>{
  const validate=check(),operand={source:{path,quote:text,valueQuote:'5'},value:5}
  const evidence={target,kind:'calculation',calculation:{operation:'weighted_mean',operands:[operand],weights:[operand]}}
  expect(validate(evidence)).toBe(true)
  for(const member of ['operands','weights'] as const){
   const rejected=structuredClone(evidence);rejected.calculation[member][0].source.path=directory+contentHash.slice(0,44)
   expect(validate(rejected)).toBe(false)
  }
 })
 it('does not accept unsupported business values or quotes just because the path is allowed',()=>{
  const validate=check()
  expect(validate({target,kind:'source',source:{path,quote:'Invented current operating status'}})).toBe(true)
  expect(()=>verifyModuleSourceValues(corpus,[{sourceId:'test-only',path,contentHash,quote:'Invented current operating status',rawValue:'open'}])).toThrow('MODULE_SOURCE_VALUE_QUOTE')
  expect(()=>verifyModuleSourceValues(corpus,[{sourceId:'test-only',path,contentHash,quote:text,rawValue:'open'}])).toThrow('MODULE_SOURCE_VALUE_TEXT')
 })
 it('preserves corpus and replay schema and leaves review tools unchanged',()=>{
  const schema=bindNativeModuleEvidenceSchema(getModuleAuthorProjectionSchema('3.05')),before=JSON.stringify({schema,corpus})
  const bound=bindNativeFrozenSourcePaths(schema,corpus)
  expect(()=>assertObjectJsonSchema(bound)).not.toThrow();expect(JSON.stringify({schema,corpus})).toBe(before)
  const review={type:'object' as const,properties:{verdict:{type:'string' as const}},required:['verdict'],additionalProperties:false}
  expect(bindNativeFrozenSourcePaths(review,corpus)).toEqual(review)
 })
 it('keeps an empty corpus schema valid without inventing source choices',()=>{
  const schema=bindNativeModuleEvidenceSchema(getModuleAuthorProjectionSchema('3.05'))
  expect(bindNativeFrozenSourcePaths(schema,{documents:[],limitations:[]})).toEqual(schema)
 })
})
