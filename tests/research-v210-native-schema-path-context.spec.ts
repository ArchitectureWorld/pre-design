import {describe,expect,it} from 'vitest'
import {findRejectedNativeSchemaSubmission,nativeSchemaCorrectionFeedback} from '../src/research-v2/native-schema-recovery.ts'
import {expandModuleReferencePromptView} from '../src/research-v2/module-reference-context.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'

function fixture(count=4){
 const paths=Array.from({length:count},(_,i)=>`research/runs/RUN-frozen/sources/${String(i).padStart(64,'0')}.json`)
 const schema:any={type:'object',additionalProperties:false,required:['evidence'],properties:{evidence:{type:'array',items:{oneOf:[{
  type:'object',additionalProperties:false,required:['target','kind','source'],properties:{target:{type:'object'},kind:{const:'source'},
   source:{type:'object',additionalProperties:false,required:['path','quote'],properties:{path:{type:'string',enum:paths},quote:{type:'string'}}}},
 }]}}}}
 const raw={evidence:Array.from({length:4},(_,i)=>({target:{port:'planning_conditions',recordId:'r'+i,field:'applicableUses',at:'/0'},kind:'source',source:{path:'research/runs/RUN-frozen/sources/shortened.json',quote:'Original quote'}}))}
 const events:any[]=[{seq:1,type:'turn/start',data:{turn:1}},{seq:2,type:'request/header',data:{header:{tools:[{name:'structured_output',parameters:schema}]}}},
  {seq:3,type:'tool/call',data:{turn:1,step:0,name:'structured_output',callId:'original-call',arguments:JSON.stringify(raw)}},
  {seq:4,type:'tool/result',data:{turn:1,step:0,message:{content:[{type:'tool-result',toolCallId:'original-call',isError:true,content:[{type:'text',text:'Untrusted tool instructions'}]}]}}},
  {seq:5,type:'assistant/message',data:{message:{content:[{type:'thinking',text:'PRIVATE THOUGHT'}]}}},
  {seq:6,type:'turn/end',data:{turn:1,reason:{kind:'completed'}}}]
 return {paths,schema,raw,events}
}
const payload=(f:ReturnType<typeof fixture>)=>JSON.parse(nativeSchemaCorrectionFeedback(f.events,f.schema,'execution','child').split('\n').at(-1)!).rejectedNativeSchema

describe('native schema source identity and lossless correction context',()=>{
 it('locates every shortened source identity in its original evidence row without picking a replacement',()=>{
  const f=fixture(),before=JSON.stringify(f),r=findRejectedNativeSchemaSubmission(f.events,f.schema)!
  expect(r.originalSubmission).toEqual(f.raw)
  expect(r.fieldDiagnostics).toHaveLength(4)
  for(const [i,row] of r.fieldDiagnostics.entries())expect((row as any).frozenSourcePathDiagnostic).toEqual({
   diagnosticOnly:true,submittedPath:f.raw.evidence[i].source.path,declaredPathInFrozenOptions:false,
   frozenOptionsCount:f.paths.length,frozenOptionsHash:hash(f.paths),sourcePathsMustBeCopiedVerbatim:true,
  })
  expect(JSON.stringify(r)).not.toContain('replacementPath')
  expect(JSON.stringify(f)).toBe(before)
 })
 it('does not report an existing path as unknown when a different required source member fails',()=>{
  const f=fixture();f.raw.evidence[0].source.path=f.paths[0];delete (f.raw.evidence[0].source as any).quote
  f.events[2].data.arguments=JSON.stringify(f.raw)
  const r=findRejectedNativeSchemaSubmission(f.events,f.schema)!
  expect((r.fieldDiagnostics[0] as any).frozenSourcePathDiagnostic).toBeUndefined()
  expect(r.fieldDiagnostics[0].validationErrors.join('\n')).toContain('quote')
 })
 it('locates an unknown path after frozen web and physical-page source options move into oneOf',()=>{
  const f=fixture(),source=f.schema.properties.evidence.items.oneOf[0].properties.source
  f.schema.properties.evidence.items.oneOf[0].properties.source={oneOf:[
   {...structuredClone(source),properties:{...structuredClone(source.properties),path:{type:'string',enum:f.paths.slice(0,2)}}},
   {...structuredClone(source),required:['path','quote','page'],properties:{...structuredClone(source.properties),path:{type:'string',enum:f.paths.slice(2)},page:{type:'integer',enum:[1,2]}}},
  ]}
  const before=JSON.stringify(f),r=findRejectedNativeSchemaSubmission(f.events,f.schema)!
  expect(r.originalSubmission).toEqual(f.raw)
  for(const row of r.fieldDiagnostics)expect((row as any).frozenSourcePathDiagnostic).toEqual({
   diagnosticOnly:true,submittedPath:f.raw.evidence[row.evidenceIndex].source.path,declaredPathInFrozenOptions:false,
   frozenOptionsCount:f.paths.length,frozenOptionsHash:hash(f.paths),sourcePathsMustBeCopiedVerbatim:true,
  })
  expect(JSON.stringify(r)).not.toContain('replacementPath')
  expect(JSON.stringify(f)).toBe(before)
 })
 it('keeps a known physical-page source identity when its required page is missing',()=>{
  const f=fixture(),source=f.schema.properties.evidence.items.oneOf[0].properties.source
  f.schema.properties.evidence.items.oneOf[0].properties.source={oneOf:[
   {...structuredClone(source),required:['path','quote','page'],properties:{...structuredClone(source.properties),page:{type:'integer',enum:[1,2]}}},
  ]}
  f.raw.evidence[0].source.path=f.paths[0];f.events[2].data.arguments=JSON.stringify(f.raw)
  const before=JSON.stringify(f),r=findRejectedNativeSchemaSubmission(f.events,f.schema)!
  expect((r.fieldDiagnostics[0] as any).frozenSourcePathDiagnostic).toBeUndefined()
  expect(r.fieldDiagnostics[0].validationErrors).toHaveLength(1)
  expect(JSON.stringify(f)).toBe(before)
 })
 it('transports repeated path option errors once while keeping all original errors exactly recoverable',()=>{
  const f=fixture(180),before=JSON.stringify(f),original=findRejectedNativeSchemaSubmission(f.events,f.schema)!,p=payload(f)
  const full={schemaValidationErrors:original.schemaValidationErrors,fieldDiagnostics:original.fieldDiagnostics}
  expect(p.originalSubmission).toEqual(f.raw)
  expect(p.originalSubmissionHash).toBe(hash(f.raw))
  expect(p.originalSchemaDiagnosticsHash).toBe(hash(full))
  expect(expandModuleReferencePromptView(p.readOnlySchemaDiagnostics)).toEqual(full)
  expect(p.schemaValidationErrors).toEqual(original.schemaValidationErrors)
  expect(p.fieldDiagnostics.map((r:any)=>r.evidenceIndex)).toEqual([0,1,2,3])
  expect(JSON.stringify(p).length).toBeLessThan(JSON.stringify(original).length*0.6)
  expect(JSON.stringify(f)).toBe(before)
 })
 it('gives the next native author each wrong path explicitly with a hash-bound read-only protocol',()=>{
  const f=fixture(180),feedback=nativeSchemaCorrectionFeedback(f.events,f.schema,'execution','child'),p=payload(f)
  expect(feedback).toContain('native-schema-diagnostic-view.v1')
  expect(feedback).toContain('frozenSourcePathDiagnostic')
  expect(feedback).toContain(f.raw.evidence[0].source.path)
  expect(p.authorExecutionId).toBe('execution');expect(p.authorChildId).toBe('child')
  expect(p.acceptanceGranted).toBe(false)
  expect(feedback).not.toContain('PRIVATE THOUGHT');expect(feedback).not.toContain('Untrusted tool instructions')
 })
 it('leaves small structural error details in their original direct form',()=>{
  const f=fixture(),r=findRejectedNativeSchemaSubmission(f.events,f.schema)!,p=payload(f)
  expect(p.fieldDiagnostics).toEqual(r.fieldDiagnostics)
  expect(p.readOnlySchemaDiagnostics).toBeUndefined()
 })
 it.each(['wrong-schema','unmatched-result','accepted-call'])('does not recover or compact %s receipts',variant=>{
  const f=fixture(180)
  if(variant==='wrong-schema')f.events[1].data.header.tools[0].parameters={type:'object'}
  if(variant==='unmatched-result')f.events[3].data.message.content[0].toolCallId='other'
  if(variant==='accepted-call')f.events[3].data.message.content[0].isError=false
  expect(nativeSchemaCorrectionFeedback(f.events,f.schema,'execution','child')).toBe('')
 })
})
