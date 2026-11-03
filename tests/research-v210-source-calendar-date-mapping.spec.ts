import {expect,it} from 'vitest'
import {createHash} from 'node:crypto'
import {verifyModuleSourceValues,validateModuleClaims} from '../src/research-v2/module-claims.ts'
import {validateModuleProjectionFields,getModuleAuthorProjectionSchema} from '../src/research-v2/module-author-projection.ts'
import {materialCorpusFingerprint} from '../src/materials/research-evidence.ts'
import {moduleRecoveryFeedback} from '../src/research-v2/module-recovery-feedback.ts'
import {sha256CanonicalJson} from '../src/presentation/canonical-json.ts'
import * as groups from '../src/research-v2/module-author-groups.ts'

const text='本决定自2024年7月1日起施行。原文件发布日期为2024年5月9日。'
const document={path:'original/policy.json',text,contentHash:createHash('sha256').update(text).digest('hex'),byteLength:Buffer.byteLength(text)}
const base={documents:[document],limitations:[]},corpus={...base,fingerprint:materialCorpusFingerprint(base)}
const quote='本决定自2024年7月1日起施行。'
const dateMapping={kind:'source-calendar-date.v1',calendarDateQuote:'2024年7月1日'} as const
const source=()=>({sourceId:'s1',path:document.path,contentHash:document.contentHash,quote,rawValue:'2024-07-01',dateMapping})
const raw=()=>({projectionVersion:'module-author-projection.v1',outputs:{planning_conditions:{type:'planning.planning_conditions.v1.2',quality:'limited',scope:'synthetic source date replay',asOf:'2026-09-26',limitations:['Only a source date; applicability unverified.'],records:[{recordId:'r0',resultClass:'observation_summary',effectiveDate:{value:'2024-07-01',claimClass:'source_conclusion',limitations:['Explicit calendar representation, not literal ISO source text.']}}]}},evidence:[{kind:'source' as const,target:{port:'planning_conditions',recordId:'r0',field:'effectiveDate',at:''},source:{path:document.path,quote,dateMapping}}],limitations:['Only a source date; applicability unverified.'],steps:[]})

it('accepts only an explicit complete Chinese calendar date representation without changing original bytes or author values',()=>{
 const s=source(),before=structuredClone(s)
 expect(verifyModuleSourceValues(corpus,[s])).toEqual([s])
 expect(s).toEqual(before)
 const {dateMapping:_mapping,...undeclared}=s
 expect(()=>verifyModuleSourceValues(corpus,[undeclared])).toThrow(/MODULE_SOURCE_VALUE_TEXT/)
 expect(()=>verifyModuleSourceValues(corpus,[{...s,rawValue:'2024-05-09'}])).toThrow()
 expect(()=>verifyModuleSourceValues(corpus,[{...s,contentHash:'0'.repeat(64)}])).toThrow()
 expect(()=>verifyModuleSourceValues(corpus,[{...s,page:1}])).toThrow(/MODULE_SOURCE_VALUE_LOCATION/)
})

it.each(['2024年7月','2024年','2024年2月30日','2023年2月29日','0000年7月1日','2024年13月1日','2024年7月0日','2024-07-01','2024年7月1日至2024年7月2日'])('rejects missing precision, invalid or ambiguous date declaration %s',(original)=>{
 const doc={...document,text:original,contentHash:createHash('sha256').update(original).digest('hex')},b={documents:[doc],limitations:[]}
 expect(()=>verifyModuleSourceValues({...b,fingerprint:materialCorpusFingerprint(b)},[{...source(),contentHash:doc.contentHash,quote:original,dateMapping:{...dateMapping,calendarDateQuote:original}}])).toThrow()
})

it('binds the declaration to an exact frozen physical page and never joins two excerpts to manufacture a date',()=>{
 const doc={path:'original/policy.pdf',contentHash:'1'.repeat(64),byteLength:100,pages:[{page:1,text:'本决定自2024年7月1日起施行。'},{page:2,text:'2024年5月9日'}]},b={documents:[doc],limitations:[]},c={...b,fingerprint:materialCorpusFingerprint(b)}
 expect(verifyModuleSourceValues(c,[{...source(),path:doc.path,contentHash:doc.contentHash,page:1}])).toHaveLength(1)
 expect(()=>verifyModuleSourceValues(c,[{...source(),path:doc.path,contentHash:doc.contentHash,page:2}])).toThrow(/MODULE_SOURCE_VALUE_QUOTE/)
 expect(()=>verifyModuleSourceValues(c,[{...source(),path:doc.path,contentHash:doc.contentHash,quote:'2024年7月1日2024年5月9日',page:1}])).toThrow(/MODULE_SOURCE_VALUE_QUOTE/)
})

it('exposes the declaration to native policy authors and restricts it to actual policy date fields',()=>{
 const schema=getModuleAuthorProjectionSchema('1.03')
 expect(schema.properties!.evidence.items!.properties!.source.properties!.dateMapping.properties!.kind.const).toBe('source-calendar-date.v1')
 const r=raw(),before=structuredClone(r)
 expect(()=>validateModuleProjectionFields('1.03',r,{planning_conditions:['effectiveDate']},corpus)).not.toThrow()
 expect(r).toEqual(before)
 const moved=raw();moved.evidence[0].target.field='issuer'
 const record=moved.outputs.planning_conditions.records[0] as any
 record.issuer=record.effectiveDate;delete record.effectiveDate
 expect(()=>validateModuleProjectionFields('1.03',moved,{planning_conditions:['issuer']},corpus)).toThrow(/MODULE_SOURCE_DATE_MAPPING/)
})

it('returns hash-bound representation diagnostics without supplying a replacement date or silently repairing the rejected draft',()=>{
 const r=raw();delete (r.evidence[0].source as any).dateMapping
 const before=structuredClone(r)
 const feedback=moduleRecoveryFeedback({module:{id:'1.03'},resumeExecutionAudit:{attempts:[{classId:'text',status:'failed',groupId:'planning_conditions:2.1',error:'MODULE_SOURCE_VALUE_TEXT',structuredOutput:r,structuredHash:sha256CanonicalJson(r)}],reviewReceipts:[]},corpus} as any,'planning_conditions:2.1')
 expect(feedback).toContain('source-calendar-date.v1')
 expect(feedback).toContain(sha256CanonicalJson(r))
 expect(feedback).toContain('calendarDateQuote')
 expect(feedback).toContain('effectiveDate')
 expect(r).toEqual(before)
})

it('replays complete author groups with their declared original representation and rejects moving it to a non-date complete claim',()=>{
 const raws=groups.getModuleAuthorFieldGroups('1.03').map(g=>({projectionVersion:groups.getModuleAuthorGroupVersion('1.03'),groupId:g.groupId,
  outputs:{planning_conditions:{...raw().outputs.planning_conditions,records:[{recordId:'r0',resultClass:'observation_summary',...Object.fromEntries(g.fields.map(f=>[f,{value:null,claimClass:'missing',limitations:['No original support']}]))}]}},
  evidence:[],limitations:['Only source date support'],stepResults:Object.fromEntries([1,2,3,4].map(n=>['step'+n,{status:'limited',summary:'Only a source date',fieldRefs:[],limitations:['No other support']}]))})) as any[]
 const date=raws.find(r=>'effectiveDate' in r.outputs.planning_conditions.records[0])
 date.outputs.planning_conditions.records[0].effectiveDate=raw().outputs.planning_conditions.records[0].effectiveDate
 date.evidence=raw().evidence
 const before=structuredClone(raws),candidate=groups.compileModuleAuthorGroups('1.03',raws,corpus)
 const audit=groups.createModuleAuthorGroupsAudit('1.03',raws.map((r,i)=>({raw:r,receipt:{executionId:'e'+i,childId:'c'+i,actualModel:{provider:'test',model:'test'},stopReason:'completed'}})),candidate)
 expect(groups.replayModuleAuthorGroups('1.03',corpus,audit)).toEqual(candidate)
 expect(candidate.sourceValues.find(s=>s.rawValue==='2024-07-01')).toMatchObject({dateMapping})
 expect(raws).toEqual(before)
 const outputs={planning_conditions:{records:[{documentTitle:{value:'2024-07-01'}}]}}
 expect(()=>validateModuleClaims({moduleId:'preplan.research.01.03',outputs,sourceValues:verifyModuleSourceValues(corpus,[source()]),claims:[{claimId:'bad-target',selector:'/outputs/planning_conditions/records/0/documentTitle/value',kind:'source',value:'2024-07-01',sourceId:'s1'}],upstream:[]})).toThrow(/MODULE_SOURCE_DATE_MAPPING/)
})
