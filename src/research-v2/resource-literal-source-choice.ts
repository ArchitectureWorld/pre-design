import {assertObjectJsonSchema,type ObjectJsonSchema} from '@deepseek-ai/dsh-tools'
import type {MaterialCorpus} from '../materials/research-evidence.ts'
import type {ModuleAuthorGroupSubmission} from './module-author-groups.ts'
import {moduleSourceQuoteDiagnostic,verifyModuleSourceValues} from './module-claims.ts'

/** Native selection of frozen source bytes after a rejected quotation. It does
 * not choose a resource or repair a submission. Central verification and the
 * independent professional review remain unchanged, including old refusals. */
export function bindResourceLiteralSourceChoice(schema:ObjectJsonSchema,corpus:MaterialCorpus,rejected:ModuleAuthorGroupSubmission):ObjectJsonSchema {
 if(schema.properties?.projectionVersion?.const!=='module-author-field-group.v21'
  ||schema.properties?.groupId?.const!=='local_resources:1.1'||rejected.groupId!=='local_resources:1.1')return schema
 const field=schema.properties.outputs?.properties?.local_resources?.properties?.records?.items?.properties?.historicalSource
 const sourceNode=schema.properties.evidence?.items?.properties?.source
 if(!field?.properties?.value||!field.properties.claimClass?.enum||!sourceNode?.properties)return schema
 if(!Array.isArray(rejected.evidence)||!Array.isArray(rejected.outputs?.local_resources?.records))return schema
 const evidence=rejected.evidence.find(e=>e?.kind==='source'&&e.target?.port==='local_resources'&&e.target.field==='historicalSource'&&e.target.at==='')
 if(!evidence?.source||typeof evidence.source.quote!=='string')return schema
 const row=rejected.outputs.local_resources.records.find(r=>r?.recordId===evidence.target.recordId)
 const declared=row?.historicalSource as {claimClass?:string;value?:unknown}|undefined
 if(declared?.claimClass!=='source_conclusion'||typeof declared.value!=='string')return schema
 const source=evidence.source,document=corpus.documents.find(d=>d.path===source.path)
 if(!document)return schema
 const original=document.pages?document.pages.find(p=>p.page===source.page)?.text:source.page===undefined?document.text:undefined
 if(original===undefined)return schema
 try{
  verifyModuleSourceValues(corpus,[{...source,contentHash:document.contentHash,sourceId:'native-source-choice-diagnostic',rawValue:declared.value}])
  return schema
 }catch(error){if(!(error instanceof Error)||!error.message.startsWith('MODULE_SOURCE_VALUE_QUOTE:'))return schema}
 const diagnostic=moduleSourceQuoteDiagnostic(corpus,source),start=diagnostic?.sourceExcerptStart??0
 const excerpt=original.slice(start,start+640)
 const ends=[...excerpt.matchAll(/[。！？](?:[”』」])?/gu)].map(m=>m.index!+m[0].length)
 const candidates=[excerpt,...ends.map((end,i)=>excerpt.slice(i?ends[i-1]:0,end)),
  ...ends.slice(1).map((end,i)=>excerpt.slice(i?ends[i-1]:0,end))]
 const choices=[...new Set(candidates.map(s=>s.trim()).filter(s=>s.length>=8&&original.includes(s)))].slice(0,8)
 if(!choices.length)return schema
 const bound=structuredClone(schema),record=bound.properties!.outputs.properties!.local_resources.properties!.records.items!
 const literal=structuredClone(field),other=structuredClone(field)
 literal.properties!.value={type:'string',enum:choices,description:'选择冻结原文的连续片段；原样保留文字及换行，不将归纳或新增词写成原文。'}
 literal.properties!.claimClass={type:'string',const:'source_conclusion'}
 other.properties!.claimClass={...other.properties!.claimClass,enum:other.properties!.claimClass.enum!.filter(c=>c!=='source_conclusion')}
 record.properties!.historicalSource={oneOf:[literal,other],description:'研究者选择与实际资源相符的来源片段。字面摘录只证明原资料记载，现存、真实性、权利和可体验条件须另行核实；无支持仍可missing/null。'}
 const nativeSource=bound.properties!.evidence.items!.properties!.source,properties=nativeSource.properties!
 properties.path={...properties.path,const:source.path}
 properties.quote={...properties.quote,enum:choices}
 if(source.page!==undefined){properties.page={...properties.page,type:'integer',const:source.page};nativeSource.required=[...new Set([...(nativeSource.required??[]),'page'])]}
 else{delete properties.page;nativeSource.required=(nativeSource.required??[]).filter(k=>k!=='page')}
 assertObjectJsonSchema(bound)
 return bound
}
