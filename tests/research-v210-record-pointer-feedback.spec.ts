import {describe,expect,it} from 'vitest'
import {assertObjectJsonSchema,validateJsonSchemaValue} from '@deepseek-ai/dsh-tools'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'
import {materialCorpusFingerprint} from '../src/materials/research-evidence.ts'
import {getModuleAuthorExecutionFieldGroups,getModuleAuthorGroupSchema,getModuleAuthorGroupOutputsSchema,validateModuleAuthorGroup} from '../src/research-v2/module-author-groups.ts'
import {getModuleFieldContracts} from '../src/research-v2/module-contracts.ts'
import {moduleGroupPointerDiagnostics} from '../src/research-v2/module-group-pointer-diagnostics.ts'
import {moduleRecoveryFeedback} from '../src/research-v2/module-recovery-feedback.ts'
import {moduleFieldProtocolDiagnostic} from '../src/research-v2/module-field-protocol-diagnostics.ts'

const base={documents:[],limitations:['Synthetic protocol regression; no endpoints or measurements']}
const corpus={...base,fingerprint:materialCorpusFingerprint(base)}
function regional(recordIds:string[]=[]):any{
 const group=getModuleAuthorExecutionFieldGroups('2.03')[0]
 return {projectionVersion:'module-author-field-group.v8',groupId:group.groupId,
  outputs:{regional_od:{type:getModuleFieldContracts('2.03').ports.regional_od.type,quality:'limited',scope:'Synthetic missing endpoint study',asOf:'2026-10-06',limitations:base.limitations,
   records:recordIds.map(recordId=>({recordId,resultClass:'observation_summary',...Object.fromEntries(group.fields.map(field=>[field,{value:null,claimClass:'missing',limitations:base.limitations}]))}))}},
  evidence:[],limitations:base.limitations,stepResults:Object.fromEntries([1,2,3,4].map(step=>['step'+step,{status:'limited',summary:'Missing original endpoints',fieldRefs:[],limitations:base.limitations}]))}
}
function feedback(raw:any,error:string){
 const audit:any={reviewReceipts:[],attempts:[{classId:'text',groupId:raw.groupId,status:'failed',executionId:'synthetic-execution',childId:'synthetic-child',
  structuredOutput:raw,structuredHash:hash(raw),error}]},before=hash(audit)
 const text=moduleRecoveryFeedback({module:{id:'2.03'} as any,corpus,resumeExecutionAudit:audit},raw.groupId)
 expect(hash(audit)).toBe(before)
 return text
}

describe('native record identity constraints preserve missing real-world endpoints',()=>{
 it('exposes the central nonempty and unique identity rules in the actual first native tool schema',()=>{
  const raw=regional(),schema=getModuleAuthorGroupSchema('2.03',raw.groupId),records=schema.properties!.outputs!.properties!.regional_od.properties!.records
  expect(()=>assertObjectJsonSchema(schema)).not.toThrow()
  expect(records.description).toContain('至少1条记录')
  expect(records.description).toContain('recordId唯一')
  expect(records.description).toContain('missing/null')
  expect(records.description).toContain('不能')
  expect(records).not.toHaveProperty('minItems');expect(records).not.toHaveProperty('maxItems')
  // Native transport accepts this shape; the existing central gate still rejects it.
  expect(validateJsonSchemaValue(schema,raw)).toEqual([])
  expect(()=>validateModuleAuthorGroup('2.03',raw,[],corpus)).toThrow('MODULE_GROUP_RECORDS')
 })
 it.each([{ids:[]},{ids:['same-record','same-record']}])('returns actual counts and original hash for rejected identities $ids',({ids})=>{
  const raw=regional(ids),before=hash(raw)
  let error='';try{validateModuleAuthorGroup('2.03',raw,[],corpus)}catch(e){error=(e as Error).message}
  expect(error).toContain('MODULE_GROUP_RECORDS')
  expect(error).toContain('"recordCount":'+ids.length)
  expect(error).toContain('"distinctRecordCount":'+new Set(ids).size)
  expect(error).toContain(before)
  expect(error).toContain('missing/null')
  const previous=JSON.parse(feedback(raw,error).split('\n').at(-1)!).previousRejection
  expect(previous.authorErrors.join('\n')).toContain('"recordCount":'+ids.length)
  expect(hash(raw)).toBe(before)
 })
 it('continues to accept authored record identities with missing fields without filling endpoints or claiming a qualified result',()=>{
  const raw=regional(['conditional-study-row']),before=hash(raw)
  expect(validateModuleAuthorGroup('2.03',raw,[],corpus)).toEqual(raw)
  expect(raw.outputs.regional_od.quality).toBe('limited')
  expect(hash(raw)).toBe(before)
 })
 it('preserves the exact frozen record count and identities on later groups',()=>{
  const first=regional(['conditional-a','conditional-b']),group=getModuleAuthorExecutionFieldGroups('2.03',[first])[1]
  const schema=getModuleAuthorGroupOutputsSchema('2.03',group.groupId,[first]),records=schema.properties!.regional_od.properties!.records
  expect(records.description).toContain('恰有2条记录')
  expect(records.items!.properties!.recordId.enum).toEqual(['conditional-a','conditional-b'])
 })
})

describe('array pointer failures give original structure without replacement values or addresses',()=>{
 const target={port:'peer_products',recordId:'synthetic-peer',field:'supportingFormats',at:'/3'}
 function raw(at='/3'):any{return {groupId:'peer_products:2.1.3',outputs:{peer_products:{records:[{recordId:target.recordId,
  supportingFormats:{value:['private-value-a','private-value-b','private-value-c'],claimClass:'source_conclusion'}}]}},evidence:[{target:{...target,at},kind:'source'}]}}
 it('binds the rejected fourth-item reference to the three-item array length and hash without exposing its contents',()=>{
  const draft=raw(),before=hash(draft),errors=moduleGroupPointerDiagnostics(draft)
  expect(errors).toHaveLength(1)
  expect(errors[0]).toContain('"arrayLength":3')
  expect(errors[0]).toContain(hash(draft.outputs.peer_products.records[0].supportingFormats.value))
  expect(errors[0]).toContain('"at":"/3"')
  expect(errors[0]).not.toContain('private-value')
  expect(hash(draft)).toBe(before)
 })
 it('keeps valid array references free of conflict diagnostics',()=>{
  const draft=raw('/2'),before=hash(draft)
  expect(moduleGroupPointerDiagnostics(draft)).toEqual([])
  expect(hash(draft)).toBe(before)
 })
 it('delivers the structure in same-turn and checkpoint correction diagnostics while preserving receipts',()=>{
  const draft=raw(),before=hash(draft),error='MODULE_GROUP_POINTER: original array pointer rejected'
  const diagnostic=moduleFieldProtocolDiagnostic(error,draft)
  expect(diagnostic?.fieldPointerConflicts?.[0]).toContain('"arrayLength":3')
  expect(feedback(draft,error)).toContain('arrayLength')
  expect(hash(draft)).toBe(before)
 })
})
