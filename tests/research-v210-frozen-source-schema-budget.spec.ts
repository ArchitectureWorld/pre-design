import {createHash} from 'node:crypto'
import {describe,expect,it} from 'vitest'
import Ajv from 'ajv'
import {assertObjectJsonSchema,validateJsonSchemaValue,type JsonSchemaNode} from '@deepseek-ai/dsh-tools'
import {materialCorpusFingerprint} from '../src/materials/research-evidence.ts'
import {getModuleAuthorGroupSchema,getModuleAuthorExecutionGroupVersion} from '../src/research-v2/module-author-groups.ts'
import {bindNativeModuleEvidenceSchema} from '../src/research-v2/module-author-projection.ts'
import {bindNativeFrozenSourcePaths} from '../src/research-v2/native-source-path-schema.ts'
import {nativeQuerySourceChoices} from '../src/research-v2/native-query-string-mapping.ts'
import {assertNativeModuleContext} from '../src/research-v2/native-module-context-budget.ts'

function fixture(){
 const documents=Array.from({length:144},(_,index)=>{
  const retrievedAt='2026-10-07T09:00:00.000Z',executionId='native-execution-'+index,queryKey='3.04:'+index
  const text=index<10?JSON.stringify({version:'native-web-search-log.v1',queryKey,executionId,childId:'native-child-'+index,retrievedAt,
   calls:[{tool:'web_search',callId:'native-call-'+index,request:{queries:Array.from({length:4},(_,query)=>'Original query '+index+' '+query)},status:'succeeded'}]}):'Original source '+index
  const contentHash=createHash('sha256').update(text).digest('hex')
  return {path:'research/runs/RUN-11111111-1111-4111-8111-111111111111/sources/'+contentHash+'.json',text,contentHash,byteLength:Buffer.byteLength(text),
   ...(index<10?{provenance:{sourceUri:'workspace:native-web-query/'+executionId,retrievedAt,rawHash:contentHash,claimClass:'source_conclusion' as const,queryKeys:[queryKey]}}:{})}
 })
 const base={documents,limitations:[]},corpus={...base,fingerprint:materialCorpusFingerprint(base)}
 const schema=bindNativeModuleEvidenceSchema(getModuleAuthorGroupSchema('3.04','peer_supply:1',[],getModuleAuthorExecutionGroupVersion('3.04'),corpus))
 return {corpus,schema,bound:bindNativeFrozenSourcePaths(schema,corpus)}
}
const target={port:'peer_supply',recordId:'peer-original',field:'formalName',at:''}
function validators(node:JsonSchemaNode){
 const ajv=new Ajv({strict:false,allErrors:true}).compile(node)
 return (value:unknown)=>[validateJsonSchemaValue(node,value).length===0,Boolean(ajv(value))]
}

describe('native frozen source schema context budget',()=>{
 it('dispatches a 144-document native query source context within the authorized input and output budget',()=>{
  const {corpus,bound}=fixture()
  expect(nativeQuerySourceChoices(corpus.documents)).toHaveLength(40)
  expect(()=>assertObjectJsonSchema(bound)).not.toThrow()
  const limits={contextWindow:872000,outputTokenLimit:128000}
  const budget=assertNativeModuleContext(limits,'x'.repeat(224063),JSON.stringify(bound),[])!
  expect(budget.estimatedInputTokens+budget.outputReservedTokens).toBeLessThanOrEqual(limits.contextWindow)
  expect(budget.outputReservedTokens).toBe(128000)
 })
 it('keeps every frozen query branch exact even when a different path is in the allowed corpus',()=>{
  const {corpus,bound}=fixture(),choice=nativeQuerySourceChoices(corpus.documents)[0]
  const sourceSchema=bound.properties!.evidence.items!.oneOf![0].properties!.source,check=validators(sourceSchema)
  expect(check(choice)).toEqual([true,true])
  const mutations=[{...choice,path:corpus.documents[1].path},{...choice,path:choice.path.slice(0,-5)},
   {...choice,quote:choice.quote+' invented'},{...choice,valueQuote:'"Different query"'},
   {...choice,queryMapping:{...choice.queryMapping,callId:'invented-call'}},
   {...choice,queryMapping:{...choice.queryMapping,queryIndex:4}},{...choice,page:1}]
  for(const wrong of mutations)expect(check(wrong)).toEqual([false,false])
 })
 it('still rejects unknown ordinary sources, operands and weights at the native tool boundary',()=>{
  const {corpus,bound}=fixture(),check=validators(bound.properties!.evidence.items!)
  const source={path:corpus.documents[143].path,quote:corpus.documents[143].text}
  expect(check({target,kind:'source',source})).toEqual([true,true])
  expect(check({target,kind:'source',source:{...source,path:'invented/source.json'}})).toEqual([false,false])
  const operand={source,value:1},evidence={target,kind:'calculation',calculation:{operation:'weighted_mean',operands:[operand],weights:[operand]}}
  expect(check(evidence)).toEqual([true,true])
  for(const member of ['operands','weights'] as const){
   const wrong=structuredClone(evidence);wrong.calculation[member][0].source.path='invented/source.json'
   expect(check(wrong)).toEqual([false,false])
  }
 })
 it('does not trust out-of-corpus const constraints or alter original schemas, sources and closed branches',()=>{
  const {corpus,schema}=fixture(),before=JSON.stringify({schema,corpus})
  const bound=bindNativeFrozenSourcePaths(schema,corpus)
  expect(JSON.stringify({schema,corpus})).toBe(before)
  const outside=structuredClone(schema),ordinary=outside.properties!.evidence.items!.oneOf![0].properties!.source.oneOf![0]
  ordinary.properties!.path={...ordinary.properties!.path,const:'outside/source.json'}
  const outsideBefore=JSON.stringify(outside)
  expect(()=>bindNativeFrozenSourcePaths(outside,corpus)).toThrow('const must be one of')
  expect(JSON.stringify(outside)).toBe(outsideBefore)
  const evidenceCheck=validators(bound.properties!.evidence.items!),source={path:corpus.documents[143].path,quote:corpus.documents[143].text}
  expect(evidenceCheck({target,kind:'source',source,calculation:{operation:'sum',operands:[]}})).toEqual([false,false])
 })
})
