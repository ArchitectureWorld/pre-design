import {createHash} from 'node:crypto'
import {describe,expect,it} from 'vitest'
import {validateJsonSchemaValue} from '@deepseek-ai/dsh-tools'
import {materialCorpusFingerprint} from '../src/materials/research-evidence.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'
import {getModuleFieldContracts} from '../src/research-v2/module-contracts.ts'
import {getModuleAuthorFieldGroups,getModuleAuthorGroupSchema,compileModuleAuthorGroups,createModuleAuthorGroupsAudit,replayModuleAuthorGroups,validateModuleAuthorGroup} from '../src/research-v2/module-author-groups.ts'
import {bindNativeModuleEvidenceSchema,validateModuleProjectionFields} from '../src/research-v2/module-author-projection.ts'
import {verifyModuleSourceValues} from '../src/research-v2/module-claims.ts'
import {moduleSourceTextConflicts} from '../src/research-v2/module-source-text-diagnostics.ts'
import {moduleRecoveryFeedback} from '../src/research-v2/module-recovery-feedback.ts'
import {loadPlanningCatalog} from '../src/research-v2/catalog.ts'

const version='module-author-field-group.v14' as const
const queries=['"武汉" "新洲" 露营基地 位置','营地\\路径\n开放时间']
const call={tool:'web_search',callId:'native-call-1',request:{queries},status:'succeeded',resultHash:'a'.repeat(64),resultChars:300}
const log={version:'native-web-search-log.v1',queryKey:'3.04:2',executionId:'native-execution',childId:'native-child',retrievedAt:'2026-10-06T08:00:00.000Z',calls:[call]}
const text=JSON.stringify(log),document={path:'research/runs/RUN-original/sources/search-original.json',text,
 contentHash:createHash('sha256').update(text).digest('hex'),byteLength:Buffer.byteLength(text),
 provenance:{sourceUri:'workspace:native-web-query/native-execution',retrievedAt:log.retrievedAt,rawHash:createHash('sha256').update(text).digest('hex'),claimClass:'source_conclusion' as const,queryKeys:['3.04:2']}}
const base={documents:[document],limitations:[]},corpus={...base,fingerprint:materialCorpusFingerprint(base)}
const target=(recordId='original-peer-a',field='discoveryQueries',port='peer_supply',at='/0')=>({port,recordId,field,at})
const mapping={kind:'native-search-query-json-string.v1',callId:call.callId,queryIndex:0}
const source=()=>({sourceId:'original-query',path:document.path,contentHash:document.contentHash,quote:JSON.stringify(call),
 rawValue:queries[0],valueQuote:JSON.stringify(queries[0]),queryMapping:mapping})
const missing=()=>({value:null,claimClass:'missing',limitations:['No source supplied.']})
function groups(){
 const port=getModuleFieldContracts('3.04').ports.peer_supply
 const first={projectionVersion:version,groupId:'peer_supply:1',outputs:{peer_supply:{type:port.type,quality:'limited',scope:'Synthetic source-only check',asOf:'2026-10-06',limitations:['Incomplete evidence.'],
  records:['original-peer-a','original-peer-b'].map(recordId=>({recordId,resultClass:'observation_summary'}))}}} as any
 return getModuleAuthorFieldGroups('3.04',version,[first]).map(group=>({projectionVersion:version,groupId:group.groupId,
  outputs:{peer_supply:{...first.outputs.peer_supply,records:first.outputs.peer_supply.records.filter((row:any)=>!group.recordIds||group.recordIds.includes(row.recordId))
   .map((row:any)=>({...row,...Object.fromEntries(group.fields.map(field=>[field,missing()]))}))}},evidence:[],limitations:['Incomplete evidence.'],
  stepResults:Object.fromEntries([1,2,3,4].map(n=>['step'+n,{status:'limited',summary:'Only original native query behavior is supported.',fieldRefs:[],limitations:['No business facts.']}]))})) as any[]
}
function queryGroup(){
 const rows=groups(),raw=rows.find(row=>row.groupId==='peer_supply:4.2.1')
 raw.outputs.peer_supply.records[0].discoveryQueries={value:[queries[0]],claimClass:'source_conclusion',limitations:['Query behavior only; no business conclusions.']}
 const {sourceId,contentHash,rawValue,...description}=source()
 raw.evidence=[{kind:'source',target:target(),source:description}]
 return {rows,raw}
}

describe('native peer author address ownership',()=>{
 it.each(['swapped','unknown-record','unassigned-field','step-address'])('rejects %s before accepting the native tool submission',mode=>{
  const {rows,raw}=queryGroup(),draft=structuredClone(raw)
  // This case isolates address ownership, independently of the new source declaration.
  delete draft.evidence[0].source.queryMapping
  if(mode==='swapped')draft.evidence[0].target=target('peer_supply','discoveryQueries','original-peer-a')
  if(mode==='unknown-record')draft.evidence[0].target.recordId='fabricated-peer'
  if(mode==='unassigned-field')draft.evidence[0].target.field='formalName'
  if(mode==='step-address')draft.stepResults.step1.fieldRefs=[target('fabricated-peer')]
  const schema=bindNativeModuleEvidenceSchema(getModuleAuthorGroupSchema('3.04',raw.groupId,[rows[0]],version))
  expect(validateJsonSchemaValue(schema,draft).length).toBeGreaterThan(0)
 })
 it('keeps legitimate cross-group local inputs available while constraining current evidence targets',()=>{
  const {rows,raw}=queryGroup(),draft=structuredClone(raw)
  rows[0].outputs.peer_supply.records[0].formalName={value:'Synthetic peer',claimClass:'source_conclusion',limitations:['Synthetic only.']}
  rows[0].evidence=[{target:target('original-peer-a','formalName','peer_supply',''),kind:'source',source:{path:document.path,quote:'Synthetic peer'}}]
  draft.evidence=[{target:target(),kind:'inference',rationale:'Synthetic dependency only.',inputRefs:[{local:target('original-peer-a','formalName','peer_supply','')}]}]
  const before=hash(rows),schema=bindNativeModuleEvidenceSchema(getModuleAuthorGroupSchema('3.04',raw.groupId,[rows[0]],version))
  expect(validateJsonSchemaValue(schema,draft)).toEqual([])
  const invented=structuredClone(draft)
  invented.evidence[0].inputRefs[0].local.recordId='fabricated-peer'
  expect(validateJsonSchemaValue(schema,invented)).not.toEqual([])
  expect(hash(rows)).toBe(before)
 })
})

describe('explicit frozen native query JSON string representation',()=>{
 it('verifies declared query text against the exact frozen call and retains original text and hashes',()=>{
  const before=hash(corpus),candidate=source()
  expect(verifyModuleSourceValues(corpus,[candidate as any])).toEqual([candidate])
  expect(hash(corpus)).toBe(before)
  expect(verifyModuleSourceValues(corpus,[{...candidate,rawValue:queries[1],valueQuote:JSON.stringify(queries[1]),queryMapping:{...mapping,queryIndex:1}} as any])[0].rawValue).toBe(queries[1])
 })
 it('keeps the original substring rejection when no representation is declared',()=>{
  const {queryMapping,...candidate}=source()
  expect(()=>verifyModuleSourceValues(corpus,[candidate])).toThrow(/MODULE_SOURCE_VALUE_TEXT/)
 })
 it.each(['wrong-call','wrong-index','changed-value','wrong-literal','missing-literal','token-only','page','failed-kind'])('rejects a %s representation instead of guessing or normalizing',mode=>{
  const candidate:any=structuredClone(source())
  if(mode==='wrong-call')candidate.queryMapping.callId='other-call'
  if(mode==='wrong-index')candidate.queryMapping.queryIndex=9
  if(mode==='changed-value')candidate.rawValue='Unrecorded query'
  if(mode==='wrong-literal')candidate.valueQuote=queries[0]
  if(mode==='missing-literal')delete candidate.valueQuote
  if(mode==='token-only')candidate.quote=JSON.stringify(queries[0])
  if(mode==='page')candidate.page=1
  if(mode==='failed-kind')candidate.queryMapping.kind='generic-json-decode'
  expect(()=>verifyModuleSourceValues(corpus,[candidate])).toThrow()
 })
 it('rejects generic JSON, modified hashes and duplicate call identities',()=>{
  for(const value of [{...log,version:'generic-json'}, {...log,calls:[call,call]}]){
   const changed=JSON.stringify(value),doc={...document,text:changed,contentHash:createHash('sha256').update(changed).digest('hex'),byteLength:Buffer.byteLength(changed)}
   const changedBase={documents:[doc],limitations:[]},frozen={...changedBase,fingerprint:materialCorpusFingerprint(changedBase)}
   expect(()=>verifyModuleSourceValues(frozen,[{...source(),contentHash:doc.contentHash} as any])).toThrow()
  }
  expect(()=>verifyModuleSourceValues(corpus,[{...source(),contentHash:'b'.repeat(64)} as any])).toThrow()
 })
 it('requires native acquisition provenance to match the execution, raw hash and query key',()=>{
  for(const provenance of [undefined,{...document.provenance,sourceUri:'workspace:native-web-query/other-execution'},
   {...document.provenance,rawHash:'c'.repeat(64)},{...document.provenance,queryKeys:['3.05:2']}]){
   const doc:any={...document};if(provenance)doc.provenance=provenance;else delete doc.provenance
   const changedBase={documents:[doc],limitations:[]},frozen={...changedBase,fingerprint:materialCorpusFingerprint(changedBase)}
   expect(()=>verifyModuleSourceValues(frozen,[source() as any])).toThrow(/MODULE_SOURCE_QUERY_MAPPING/)
  }
 })
 it('compiles and replays only explicitly authored discoveryQueries mappings without modifying receipts',()=>{
  const {rows,raw}=queryGroup(),before=hash(rows),candidate=compileModuleAuthorGroups('3.04',rows,corpus)
  const audit=createModuleAuthorGroupsAudit('3.04',rows.map((raw,i)=>({raw,receipt:{executionId:'e'+i,childId:'c'+i,actualModel:{provider:'test',model:'test'},stopReason:'completed'}})),candidate)
  expect(replayModuleAuthorGroups('3.04',corpus,audit)).toEqual(candidate)
  expect(candidate.sourceValues.find(row=>row.rawValue===queries[0])).toMatchObject({queryMapping:mapping,valueQuote:JSON.stringify(queries[0])})
  expect(moduleSourceTextConflicts(raw,corpus)).toEqual([])
  const moved=structuredClone(raw);moved.outputs.peer_supply.records.forEach((record:any)=>{delete record.discoveryQueries;delete record.coverage;record.formalName=missing()})
  moved.outputs.peer_supply.records[0].formalName={value:queries[0],claimClass:'source_conclusion',limitations:['Synthetic scope check.']};moved.evidence[0].target=target('original-peer-a','formalName','peer_supply','')
  expect(()=>validateModuleProjectionFields('3.04',moved,{peer_supply:['formalName']},corpus)).toThrow(/MODULE_SOURCE_QUERY_MAPPING/)
  expect(hash(rows)).toBe(before)
 })
 it('returns a source-bound representation diagnostic in native checkpoint feedback while preserving the old rejection',()=>{
  const {rows,raw}=queryGroup();delete raw.evidence[0].source.queryMapping
  const prior=rows.slice(0,rows.indexOf(raw)),before=hash(raw)
  expect(()=>validateModuleAuthorGroup('3.04',raw,prior,corpus)).toThrow(/MODULE_SOURCE_VALUE_TEXT/)
  const feedback=moduleRecoveryFeedback({module:loadPlanningCatalog().modules.find(row=>row.id==='3.04')!,corpus,
   resumeExecutionAudit:{attempts:[{classId:'text',status:'failed',groupId:raw.groupId,error:'MODULE_SOURCE_VALUE_TEXT',structuredOutput:raw}],reviewReceipts:[]}} as any,raw.groupId)
  const previous=JSON.parse(feedback.split('\n').at(-1)!).previousRejection
  expect(previous.diagnosticExcerpt.fieldTextConflicts[0].nativeQueryRepresentationDiagnostic).toMatchObject({diagnosticOnly:true,
   sourceTextHash:hash(text),executionId:'native-execution',childId:'native-child',matches:[{callId:call.callId,queryIndex:0}]})
  expect(feedback).toContain('native-search-query-json-string.v1')
  expect(hash(raw)).toBe(before)
  expect(()=>validateModuleAuthorGroup('3.04',raw,prior,corpus)).toThrow(/MODULE_SOURCE_VALUE_TEXT/)
 })
})
