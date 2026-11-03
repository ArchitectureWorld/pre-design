import {expect,it} from 'vitest'
import {createHash} from 'node:crypto'
import {verifyModuleSourceValues} from '../src/research-v2/module-claims.ts'
import {validateModuleProjectionFields} from '../src/research-v2/module-author-projection.ts'
import {materialCorpusFingerprint} from '../src/materials/research-evidence.ts'
import {moduleAuthorGroupSourceContext} from '../src/research-v2/module-group-source-context.ts'
import {moduleRecoveryFeedback} from '../src/research-v2/module-recovery-feedback.ts'
import {sha256CanonicalJson} from '../src/presentation/canonical-json.ts'
import * as groups from '../src/research-v2/module-author-groups.ts'
import {sliceModuleCorpus} from '../src/research-v2/module-prompt-context.ts'
const original='2026:09:15 15:15:32',quote='"dateTimeOriginal":"'+original+'"'
const text=JSON.stringify({kind:'source-image-metadata.v1',capture:{dateTimeOriginal:original,timeZone:null,latitude:30.85,longitude:114.96},limitations:['Uncalibrated camera tags; no timezone.'],unrelated:'irrelevant '.repeat(1000)})
const document={path:'original/photo.jpg',text,contentHash:createHash('sha256').update(text).digest('hex'),byteLength:100,image:{mimeType:'image/jpeg' as const,width:10,height:10}}
const base={documents:[document],limitations:[]},corpus={...base,fingerprint:materialCorpusFingerprint(base)}
const dateMapping={kind:'photo-exif-calendar-date.v1' as const,dateTimeOriginalQuote:original}
const source=()=>({sourceId:'s1',path:document.path,contentHash:document.contentHash,quote,rawValue:'2026-09-15',dateMapping})
it('requires a declared deterministic EXIF calendar representation and retains the exact camera timestamp without guessing timezone',()=>{
 const s=source(),before=structuredClone(s)
 expect(verifyModuleSourceValues(corpus,[s])).toEqual([s])
 for(const altered of [{...s,rawValue:'2026-09-16'},{...s,dateMapping:{...dateMapping,dateTimeOriginalQuote:'2026:09:15'}},
  {...s,quote:'"timeZone":null'},{...s,contentHash:'0'.repeat(64)},{...s,coordinateMapping:{kind:'photo-gps-axis-order.v1',axisOrder:'xy',xValueQuote:'114.96',yValueQuote:'30.85'}}]){
  expect(()=>verifyModuleSourceValues(corpus,[altered as any])).toThrow()
 }
 const {dateMapping:_mapping,...literal}=s
 expect(()=>verifyModuleSourceValues(corpus,[literal])).toThrow(/MODULE_SOURCE_VALUE_TEXT/)
 for(const invalid of ['2026:02:30 12:00:00','2026:09:15 25:00:00','2026:09:15 12:60:00','2026:09:15 12:00:60']){
  const badText=JSON.stringify({kind:'source-image-metadata.v1',capture:{dateTimeOriginal:invalid,timeZone:null}})
  const badDoc={...document,text:badText},badBase={documents:[badDoc],limitations:[]}
  expect(()=>verifyModuleSourceValues({...badBase,fingerprint:materialCorpusFingerprint(badBase)},[{...s,quote:'"dateTimeOriginal":"'+invalid+'"',dateMapping:{...dateMapping,dateTimeOriginalQuote:invalid}}])).toThrow()
 }
 const {image:_image,...notImage}=document,fakeBase={documents:[notImage],limitations:[]}
 expect(()=>verifyModuleSourceValues({...fakeBase,fingerprint:materialCorpusFingerprint(fakeBase)},[s])).toThrow()
 expect(s).toEqual(before)
})
it('accepts the mapping only on original-image photoDate and replays complete native authors without filling or rewriting any draft',()=>{
 const raws=groups.getModuleAuthorFieldGroups('1.07').map(g=>({projectionVersion:groups.MODULE_AUTHOR_GROUP_VERSION,groupId:g.groupId,
  outputs:{site_use:{type:'planning.site_use.v1.2',quality:'limited',scope:'synthetic date mapping replay',asOf:'2026-09-30',limitations:['Camera date only'],records:[{recordId:'r0',resultClass:'observation_summary',...Object.fromEntries(g.fields.map(f=>[f,{value:null,claimClass:'missing',limitations:['No original support']}]))}]}},
  evidence:[],limitations:['Camera date only'],stepResults:Object.fromEntries([1,2,3,4].map(n=>['step'+n,{status:'limited',summary:'Original camera calendar date only',fieldRefs:[],limitations:['No other source']}]))})) as any[]
 const raw=raws.find(r=>r.groupId==='site_use:4.2')
 raw.outputs.site_use.records[0].photoDate={value:'2026-09-15',claimClass:'source_conclusion',limitations:['Calendar representation of original EXIF; no timezone conversion.']}
 raw.evidence=[{kind:'source',target:{port:'site_use',recordId:'r0',field:'photoDate',at:''},source:{path:document.path,quote,dateMapping}}]
 const before=structuredClone(raws),candidate=groups.compileModuleAuthorGroups('1.07',raws,corpus)
 const audit=groups.createModuleAuthorGroupsAudit('1.07',raws.map((raw,i)=>({raw,receipt:{executionId:'e'+i,childId:'c'+i,actualModel:{provider:'test',model:'test'},stopReason:'completed'}})),candidate)
 expect(groups.replayModuleAuthorGroups('1.07',corpus,audit)).toEqual(candidate)
 expect(candidate.sourceValues.find(s=>s.rawValue==='2026-09-15')).toMatchObject({dateMapping})
 const moved=structuredClone(raw);moved.evidence[0].target.field='photoDirection'
 moved.outputs.site_use.records[0].photoDirection=moved.outputs.site_use.records[0].photoDate;delete moved.outputs.site_use.records[0].photoDate
 expect(()=>validateModuleProjectionFields('1.07',moved,{site_use:['photoDirection']},corpus)).toThrow(/MODULE_SOURCE_DATE_MAPPING/)
 const schema=groups.getModuleAuthorGroupSchema('1.07','site_use:4.2')
 expect(schema.properties!.evidence.items!.properties!.source.properties!.dateMapping.properties!.kind.const).toBe('photo-exif-calendar-date.v1')
 expect(raws).toEqual(before)
})
it('returns precise hash-bound date diagnostics rather than an implicit conversion or repeated unmodified rejection',()=>{
 const raw={projectionVersion:groups.MODULE_AUTHOR_GROUP_VERSION,groupId:'site_use:4.2',outputs:{site_use:{records:[{recordId:'r0',photoDate:{value:'2026-09-15',claimClass:'source_conclusion',limitations:['No timezone.']}}]}},evidence:[{kind:'source',target:{port:'site_use',recordId:'r0',field:'photoDate',at:''},source:{path:document.path,quote,valueQuote:'2026:09:15'}}]}
 const feedback=moduleRecoveryFeedback({resumeExecutionAudit:{attempts:[{classId:'text',status:'failed',groupId:'site_use:4.2',error:'MODULE_SOURCE_VALUE_TEXT',structuredOutput:raw}],reviewReceipts:[]},corpus} as any,'site_use:4.2')
 const excerpt=JSON.parse(feedback.split('\n').at(-1)!).previousRejection.diagnosticExcerpt
 expect(excerpt).toMatchObject({scope:'photo-date-representation-conflicts-only',originalSubmissionHash:sha256CanonicalJson(raw),completeSubmission:false})
 expect(excerpt.fieldDateMappingConflicts).toHaveLength(1)
 expect(feedback).toContain('须由你明确提交dateMapping=')
 expect(excerpt.fieldDateMappingConflicts[0]).toMatchObject({target:raw.evidence[0].target,sourcePath:document.path,dateTimeOriginalQuote:original,receivedDate:'2026-09-15'})
})
it('scopes photoDate prompts to exact original timestamp tags, keeps identity and original timezone, and retains full originals for other groups',()=>{
 const sources={corpus,sourceValues:[{sourceId:'unrelated-source'}],inputRefs:[],upstream:[],images:{sources:[{path:document.path}]}},before=structuredClone(sources)
 const result=moduleAuthorGroupSourceContext('1.07',['photoDate'],sources)
 expect(JSON.stringify(result).length).toBeLessThan(JSON.stringify(sources).length/2)
 expect(result.corpus.documents[0]).toMatchObject({path:document.path,contentHash:document.contentHash,text:quote+'\n"timeZone":null'})
 expect(result.groupSourceScope).toMatchObject({fullSourceContextHash:sha256CanonicalJson(sources),photoDateExcerptsOnly:true})
 expect(JSON.stringify(result)).not.toContain('unrelated-source')
 expect(moduleAuthorGroupSourceContext('1.07',['photoLocation','photoDirection'],sources).corpus).toEqual(corpus)
 expect(moduleAuthorGroupSourceContext('1.07',['conflicts'],sources)).toBe(sources)
 expect(sources).toEqual(before)
})
it('scopes the actual native paragraph slice with exact original offsets instead of requiring full-image fields that the prompt does not contain',()=>{
 const sliced=sliceModuleCorpus(corpus,{moduleId:'1.07',query:'photo date'}),sources={corpus:sliced,sourceValues:[{sourceId:'unrelated-source'}],inputRefs:[],upstream:[]}
 const before=structuredClone(sources),result=moduleAuthorGroupSourceContext('1.07',['photoDate'],sources)
 expect(JSON.stringify(result).length).toBeLessThan(JSON.stringify(sources).length/2)
 expect(result.corpus.originalFingerprint).toBe(sliced.originalFingerprint)
 const tags=result.corpus.documents[0].paragraphs!
 expect(tags.map(p=>p.text)).toEqual([quote,'"timeZone":null'])
 for(const span of tags)expect(text.slice(span.startOffset,span.endOffset)).toBe(span.text)
 expect(result.groupSourceScope).toMatchObject({fullSourceContextHash:sha256CanonicalJson(sources),photoDateExcerptsOnly:true})
 expect(sources).toEqual(before)
})
