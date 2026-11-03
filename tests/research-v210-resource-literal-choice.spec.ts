import {it,expect} from 'vitest'
import {createHash} from 'node:crypto'
import {assertObjectJsonSchema,validateJsonSchemaValue} from '@deepseek-ai/dsh-tools'
import {getModuleAuthorGroupSchema,validateModuleAuthorGroup} from '../src/research-v2/module-author-groups.ts'

const text='山中有古寨遗迹，地方档案记载其建造年代及相关历史。\n附近寺院的历史出处仍须与档案原件逐项核对，现存状态及使用授权没有资料。'
const base={documents:[{path:'original.pdf',pages:[{page:21,text},{page:22,text:'其他章节说明水库管理职责。'}],
 contentHash:createHash('sha256').update(text).digest('hex'),byteLength:Buffer.byteLength(text)}],limitations:['Synthetic source only']}
const corpus={...base,fingerprint:createHash('sha256').update(JSON.stringify(base)).digest('hex')}
const target=(field:string)=>({port:'local_resources',recordId:'resource-study-1',field,at:''})
function draft(value='据地方档案记载，山中有古寨遗迹。'):any{
 return {projectionVersion:'module-author-field-group.v21',groupId:'local_resources:1.1',outputs:{local_resources:{
  type:'planning.local_resources.v1.2',quality:'limited',scope:'Synthetic resource study',asOf:'2026-09-26',limitations:['Historical line only'],
  records:[{recordId:'resource-study-1',resultClass:'observation_summary',resourceId:{value:'temporary-study-id',claimClass:'decision',limitations:['Unofficial identifier']},
   historicalSource:{value,claimClass:'source_conclusion',limitations:['Current state not verified']},category:{value:null,claimClass:'missing',limitations:['Not assessed']}}]}},
  evidence:[{target:target('resourceId'),kind:'proposal',rationale:'The author selected a temporary record identifier for this study only.'},
   {target:target('historicalSource'),kind:'source',source:{path:'original.pdf',page:21,quote:value}}],limitations:['No current state or rights evidence'],
  stepResults:Object.fromEntries([1,2,3,4].map(i=>['step'+i,{status:'limited',summary:'Synthetic bounded step',fieldRefs:i===1?[target('historicalSource')]:[],limitations:['Incomplete verification']}]))}
}
const schema=(rejected:any=draft(),wire:any='module-author-field-group.v21')=>
 getModuleAuthorGroupSchema('1.06','local_resources:1.1',[],wire,corpus,rejected)
function choices(s:any):string[]{return s.properties.outputs.properties.local_resources.properties.records.items.properties.historicalSource.oneOf?.find((b:any)=>b.properties.claimClass.const==='source_conclusion')?.properties.value.enum??[]}

it('gives the native researcher selectable verbatim original fragments after a rejected historical quote',()=>{
 const bound=schema(),values=choices(bound)
 expect(values.length).toBeGreaterThan(0)
 expect(values).not.toContain(draft().outputs.local_resources.records[0].historicalSource.value)
 for(const value of values)expect(text.includes(value)).toBe(true)
 expect(()=>assertObjectJsonSchema(bound)).not.toThrow()
})
it('accepts a new author-selected literal and still rejects the unchanged paraphrase',()=>{
 const bound=schema(),value=choices(bound)[0]
 expect(value).toBeDefined()
 const authored=draft(value)
 expect(validateJsonSchemaValue(bound,authored)).toEqual([])
 expect(()=>validateModuleAuthorGroup('1.06',authored,[],corpus)).not.toThrow()
 expect(validateJsonSchemaValue(bound,draft()).length).toBeGreaterThan(0)
 expect(()=>validateModuleAuthorGroup('1.06',draft(),[],corpus)).toThrow('MODULE_SOURCE_VALUE_QUOTE')
})
it('keeps the physical page binding and allows the author to preserve a missing field',()=>{
 const bound=schema(),authored=draft(choices(bound)[0])
 authored.evidence[1].source.page=22
 expect(validateJsonSchemaValue(bound,authored).length).toBeGreaterThan(0)
 const missing=draft();missing.outputs.local_resources.records[0].historicalSource={value:null,claimClass:'missing',limitations:['Unresolved source support']}
 missing.evidence=missing.evidence.slice(0,1);missing.stepResults.step1.fieldRefs=[]
 expect(validateJsonSchemaValue(bound,missing)).toEqual([])
 expect(()=>validateModuleAuthorGroup('1.06',missing,[],corpus)).not.toThrow()
})
it('does not modify the rejected submission or frozen material',()=>{
 const rejected=draft(),before=JSON.stringify({rejected,corpus});schema(rejected)
 expect(JSON.stringify({rejected,corpus})).toBe(before)
})
it('does not replace a malformed historical rejection with a host error',()=>{
 const ordinary=getModuleAuthorGroupSchema('1.06','local_resources:1.1',[],'module-author-field-group.v21',corpus)
 const malformed=draft();malformed.evidence=[null]
 expect(schema(malformed)).toEqual(ordinary)
 const missingRecords=draft();missingRecords.outputs.local_resources.records=[null]
 expect(schema(missingRecords)).toEqual(ordinary)
})
it('keeps ordinary fresh schemas and older group protocols unchanged',()=>{
 const ordinary=getModuleAuthorGroupSchema('1.06','local_resources:1.1',[],'module-author-field-group.v21',corpus)
 expect(choices(ordinary)).toEqual([])
 const old=getModuleAuthorGroupSchema('1.06','local_resources:1.1',[],'module-author-field-group.v17',corpus)
 const oldWithRejection=getModuleAuthorGroupSchema('1.06','local_resources:1.1',[],'module-author-field-group.v17',corpus,draft())
 expect(oldWithRejection).toEqual(old)
})
