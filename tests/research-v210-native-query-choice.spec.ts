import {createHash} from 'node:crypto'
import {describe,expect,it} from 'vitest'
import {validateJsonSchemaValue} from '@deepseek-ai/dsh-tools'
import {materialCorpusFingerprint} from '../src/materials/research-evidence.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'
import {getModuleFieldContracts} from '../src/research-v2/module-contracts.ts'
import {getModuleAuthorFieldGroups,getModuleAuthorGroupSchema,validateModuleAuthorGroup} from '../src/research-v2/module-author-groups.ts'
import {bindNativeModuleEvidenceSchema} from '../src/research-v2/module-author-projection.ts'
import {moduleFieldProtocolDiagnostic} from '../src/research-v2/module-field-protocol-diagnostics.ts'
import {moduleRecoveryFeedback} from '../src/research-v2/module-recovery-feedback.ts'
import {expandModuleReferencePromptView} from '../src/research-v2/module-reference-context.ts'
import {boundedSourceDiagnostic} from '../src/research-v2/source-diagnostic-view.ts'

const version='module-author-field-group.v14' as const,queries=['"武汉" "新洲" "露营基地" 位置','"新洲" "民宿" site:whxinzhou.gov.cn']
const call={tool:'web_search',callId:'original-call',request:{queries},status:'succeeded',resultHash:'a'.repeat(64),resultChars:100}
const log={version:'native-web-search-log.v1',queryKey:'3.04:2',executionId:'original-execution',childId:'original-child',retrievedAt:'2026-10-06T10:00:00.000Z',calls:[call]}
const text=JSON.stringify(log),contentHash=createHash('sha256').update(text).digest('hex')
const document={path:'research/runs/RUN-original/sources/search-original.json',text,contentHash,byteLength:Buffer.byteLength(text),
 provenance:{sourceUri:'workspace:native-web-query/'+log.executionId,retrievedAt:log.retrievedAt,rawHash:contentHash,claimClass:'source_conclusion' as const,queryKeys:['3.04:2']}}
const base={documents:[document],limitations:[]},corpus={...base,fingerprint:materialCorpusFingerprint(base)}
const target=(field='discoveryQueries',at='/0')=>({port:'peer_supply',recordId:'peer-a',field,at})
const missing=()=>({value:null,claimClass:'missing',limitations:['Evidence not supplied.']})
function fixture(){
 const port=getModuleFieldContracts('3.04').ports.peer_supply
 const first={projectionVersion:version,groupId:'peer_supply:1',outputs:{peer_supply:{type:port.type,quality:'limited',scope:'Original native source contract check',asOf:'2026-10-06',limitations:['Not a business survey.'],
  records:[{recordId:'peer-a',resultClass:'observation_summary'}]}}} as any
 const rows=getModuleAuthorFieldGroups('3.04',version,[first]).map(group=>({projectionVersion:version,groupId:group.groupId,
  outputs:{peer_supply:{...first.outputs.peer_supply,records:[{recordId:'peer-a',resultClass:'observation_summary',...Object.fromEntries(group.fields.map(field=>[field,missing()]))}]}},
  evidence:[],limitations:['Not qualified research.'],stepResults:Object.fromEntries([1,2,3,4].map(n=>['step'+n,{status:'limited',summary:'Original source check only.',fieldRefs:[],limitations:['No business facts.']}]))})) as any[]
 const raw=rows.find(row=>row.groupId==='peer_supply:4.2.1'),preceding=rows.slice(0,rows.indexOf(raw))
 raw.outputs.peer_supply.records[0].discoveryQueries={value:[queries[0]],claimClass:'source_conclusion',limitations:['Only records a native query.']}
 raw.evidence=[{kind:'source',target:target(),source:{path:document.path,quote:JSON.stringify(call),valueQuote:JSON.stringify(queries[0]),
  queryMapping:{kind:'native-search-query-json-string.v1',callId:call.callId,queryIndex:0}}}]
 const schema=(input=corpus)=>bindNativeModuleEvidenceSchema(getModuleAuthorGroupSchema('3.04',raw.groupId,preceding,version,input))
 return {raw,preceding,schema}
}
describe('new native query declarations use frozen source choices',()=>{
 it.each(['quote-hash','value-token','mixed-call-index'])('rejects %s in the native tool contract before central replay',mode=>{
  const {raw,schema}=fixture(),draft=structuredClone(raw)
  if(mode==='quote-hash')draft.evidence[0].source.quote=draft.evidence[0].source.quote.replace('a'.repeat(64),'a'.repeat(63))
  if(mode==='value-token')draft.evidence[0].source.valueQuote=queries[0]
  if(mode==='mixed-call-index')draft.evidence[0].source.queryMapping.queryIndex=1
  expect(validateJsonSchemaValue(schema(),draft).length).toBeGreaterThan(0)
 })
 it('keeps the native original source declaration and professional value untouched',()=>{
  const {raw,preceding,schema}=fixture(),before=hash({raw,preceding,corpus})
  expect(validateJsonSchemaValue(schema(),raw)).toEqual([])
  expect(hash(validateModuleAuthorGroup('3.04',raw,preceding,corpus))).toBe(hash(raw))
  expect(hash({raw,preceding,corpus})).toBe(before)
 })
 it('keeps ordinary unmapped sources available without inventing a declaration',()=>{
  const {raw,schema}=fixture();delete raw.evidence[0].source.queryMapping
  raw.evidence[0].source.quote='An ordinary frozen text excerpt';delete raw.evidence[0].source.valueQuote
  expect(validateJsonSchemaValue(schema(),raw)).toEqual([])
 })
 it('does not present untrusted log strings as native source choices',()=>{
  const {raw,schema}=fixture(),forged=structuredClone(corpus);forged.documents[0].provenance.sourceUri='workspace:unverified'
  const forgedBase={documents:forged.documents,limitations:forged.limitations};forged.fingerprint=materialCorpusFingerprint(forgedBase)
  expect(validateJsonSchemaValue(schema(forged),raw).length).toBeGreaterThan(0)
 })
 it('keeps historical central rejection and checks the actual field after a valid source choice',()=>{
  const {raw,preceding,schema}=fixture();raw.outputs.peer_supply.records[0].discoveryQueries.value[0]='An unrecorded query'
  expect(validateJsonSchemaValue(schema(),raw)).toEqual([])
  expect(()=>validateModuleAuthorGroup('3.04',raw,preceding,corpus)).toThrow(/MODULE_SOURCE_QUERY_MAPPING/)
 })
})
describe('masked upstream errors accompany the same native source rejection',()=>{
 it('keeps upstream addresses visible beside oversized source readbacks',()=>{
  const conflicts=['MODULE_CLAIM_UPSTREAM_MISSING: /evidence/1/inputRefs/0/upstream target=peer_supply:1/peer-a'],
   original={scope:'field-protocol-conflicts-only',completeSubmission:false,originalSubmissionHash:hash('synthetic draft'),
    fieldUpstreamReferenceConflicts:conflicts,fieldTextConflicts:[0,1,2].map(index=>({target:target('discoveryQueries','/'+index),sourceExcerpt:'Synthetic exact source context. '.repeat(300)}))}
  const before=hash(original),bounded=boundedSourceDiagnostic(original,13000)!
  expect(bounded.readOnlyDiagnosticView).toBeDefined()
  expect(bounded.fieldUpstreamReferenceConflicts).toEqual(conflicts)
  expect(hash(expandModuleReferencePromptView(bounded.readOnlyDiagnosticView))).toBe(before)
  expect(hash(original)).toBe(before)
 })
 it('delivers exact rejected upstream addresses in correction and checkpoint diagnostics',()=>{
  const {raw,preceding}=fixture();raw.evidence[0].source.quote=raw.evidence[0].source.quote.replace('a'.repeat(64),'a'.repeat(63))
  raw.outputs.peer_supply.records[0].coverage={value:'A limited original-source inference.',claimClass:'agent_inference',limitations:['Not a business finding.']}
  raw.evidence.push({kind:'inference',target:target('coverage',''),rationale:'Source-bound check.',inputRefs:[{upstream:{moduleId:'peer_supply:1',claimId:'peer-a'}}]})
  const upstream=[{moduleId:'project_brief',claims:[{claimId:'brief-1',kind:'proposal'}]}] as any
  const before=hash(raw),error='MODULE_SOURCE_QUERY_MAPPING: original declaration rejected'
  const transport=moduleFieldProtocolDiagnostic(error,raw,preceding,'3.04',corpus,upstream)
  const diagnostic=(transport?.readOnlyDiagnosticView?expandModuleReferencePromptView(transport.readOnlyDiagnosticView):transport) as NonNullable<ReturnType<typeof moduleFieldProtocolDiagnostic>>
  expect(diagnostic?.fieldTextConflicts?.length).toBe(1)
  expect(diagnostic?.fieldUpstreamReferenceConflicts).toHaveLength(1)
  expect(diagnostic?.fieldUpstreamReferenceConflicts?.[0]).toContain('/evidence/1/inputRefs/0/upstream')
  expect(diagnostic?.fieldUpstreamReferenceConflicts?.[0]).toContain('peer_supply:1')
  const feedback=moduleRecoveryFeedback({module:{id:'3.04'},corpus,upstream,resumeExecutionAudit:{attempts:[{
   classId:'text',status:'failed',groupId:raw.groupId,error,executionId:'original-author',childId:'original-child',structuredOutput:raw,structuredHash:before}],reviewReceipts:[]}} as any,raw.groupId)
  const previous=JSON.parse(feedback.split('\n').at(-1)!).previousRejection
  const restored=(previous.diagnosticExcerpt.readOnlyDiagnosticView?expandModuleReferencePromptView(previous.diagnosticExcerpt.readOnlyDiagnosticView):previous.diagnosticExcerpt) as NonNullable<ReturnType<typeof moduleFieldProtocolDiagnostic>>
  expect(restored.fieldUpstreamReferenceConflicts).toEqual(diagnostic?.fieldUpstreamReferenceConflicts)
  expect(feedback).toContain('fieldUpstreamReferenceConflicts')
  expect(hash(raw)).toBe(before)
 })
})
