import {expect,it} from 'vitest'
import {assertObjectJsonSchema,validateJsonSchemaValue} from '@deepseek-ai/dsh-tools'
import {getModuleAuthorGroupSchema,MARKET_VALUES_RECORD_GROUP_VERSION} from '../src/research-v2/module-author-groups.ts'
import {bindNativeModuleEvidenceSchema,getModuleAuthorProjectionSchema} from '../src/research-v2/module-author-projection.ts'
import {materialCorpusFingerprint} from '../src/materials/research-evidence.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'

const paths=['原始资料/Synthetic statistics.pdf',
  'research/runs/RUN-synthetic/sources/290cd3a4acb9430d7fec7d551bccf25c0141aabf17869fcd251f002207def46d.json']
const corpus=(locations=paths)=>{
  const base={documents:locations.map(path=>({path,text:'Synthetic text only',contentHash:hash('Synthetic text only'),byteLength:19})),limitations:['Synthetic only']}
  return {...base,fingerprint:materialCorpusFingerprint(base)}
}
const prior:any[]=[{projectionVersion:MARKET_VALUES_RECORD_GROUP_VERSION,groupId:'market_context:1',
  outputs:{market_context:{type:'planning.market_context.v1.2',quality:'limited',scope:'Synthetic test',asOf:'2026-10-06',limitations:['Synthetic only'],
    records:[{recordId:'synthetic',resultClass:'observation_summary',
      originalValue:{value:{value:1,unit:'人次'},claimClass:'source_conclusion',limitations:['Synthetic only']}}]}},
  evidence:[{target:{port:'market_context',recordId:'synthetic',field:'originalValue',at:'/value'},kind:'source',
    source:{path:paths[0],quote:'Synthetic text only'}}],limitations:['Synthetic only'],stepResults:{}}]
const target={port:'market_context',recordId:'synthetic',field:'revisionStatus',at:''}
const native=(frozen=corpus(),group='market_context:3.1')=>bindNativeModuleEvidenceSchema(
  getModuleAuthorGroupSchema('3.01',group,prior,MARKET_VALUES_RECORD_GROUP_VERSION,frozen))

it('rejects shortened or invented source paths at the native revision-group boundary',()=>{
  const schema=native(),evidence=schema.properties!.evidence.items!
  for(const path of ['research/runs/RUN-synthetic/sources/290cd3a4acb9430d7fec7d551948f219d? nope','Synthetic statistics.pdf'])
    expect(validateJsonSchemaValue(evidence,{target,kind:'source',source:{path,quote:'Synthetic text only'}})).not.toEqual([])
  for(const path of paths)expect(validateJsonSchemaValue(evidence,{target,kind:'source',source:{path,quote:'Synthetic text only'}})).toEqual([])
  expect(()=>assertObjectJsonSchema(schema)).not.toThrow()
})

it('also constrains numeric source operands while leaving real local dependencies available',()=>{
  const evidence=native().properties!.evidence.items!
  const entry=(path:string)=>({target,kind:'calculation',calculation:{operation:'ratio',operands:[
    {source:{path,quote:'Synthetic text only'},value:1},{local:{port:'market_context',recordId:'synthetic',field:'originalValue',at:'/value'}}]}})
  expect(validateJsonSchemaValue(evidence,entry(paths[1]))).toEqual([])
  expect(validateJsonSchemaValue(evidence,entry(paths[1].slice(0,-8)))).not.toEqual([])
})

it('binds the current frozen corpus rather than retaining paths from an older context',()=>{
  const old=native(),next=native(corpus(['原始资料/New synthetic source.txt']))
  const entry={target,kind:'source',source:{path:paths[0],quote:'Synthetic text only'}}
  expect(validateJsonSchemaValue(old.properties!.evidence.items!,entry)).toEqual([])
  expect(validateJsonSchemaValue(next.properties!.evidence.items!,entry)).not.toEqual([])
  entry.source.path='原始资料/New synthetic source.txt'
  expect(validateJsonSchemaValue(next.properties!.evidence.items!,entry)).toEqual([])
})

it('does not narrow other groups or mutate the shared replay projection schema',()=>{
  native()
  const unrelated=native(corpus(),'market_context:2.2').properties!.evidence.items!
  expect(validateJsonSchemaValue(unrelated,{target:{...target,field:'statisticalBasis'},kind:'source',source:{path:'Another context',quote:'Synthetic'}})).toEqual([])
  expect(validateJsonSchemaValue(unrelated,{target,kind:'source',source:{path:'Another context',quote:'Synthetic'}})).not.toEqual([])
  const general=getModuleAuthorProjectionSchema('3.01').properties!.evidence.items!.properties!.source
  expect(validateJsonSchemaValue(general,{path:'Another context',quote:'Synthetic'})).toEqual([])
})

it('preserves source metadata and leaves quote support to the strict central verifier',()=>{
  const frozen=corpus(),before=hash(frozen),evidence=native(frozen).properties!.evidence.items!
  expect(validateJsonSchemaValue(evidence,{target,kind:'source',source:{path:paths[0],quote:'Unsupported quote must still be centrally rejected'}})).toEqual([])
  expect(hash(frozen)).toBe(before)
})
