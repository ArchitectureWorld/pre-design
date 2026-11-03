import {expect,it} from 'vitest'
import {validateJsonSchemaValue,assertObjectJsonSchema} from '@deepseek-ai/dsh-tools'
import * as api from '../src/research-v2/module-author-groups.ts'
import {moduleRecoveryFeedback} from '../src/research-v2/module-recovery-feedback.ts'
import {sha256CanonicalJson} from '../src/presentation/canonical-json.ts'
import {expandModuleReferencePromptView} from '../src/research-v2/module-reference-context.ts'
it('rejects a missing direction encoded as string-null at the native boundary without filling the author value',()=>{
  const schema=api.getModuleAuthorGroupSchema('1.07','site_use:4.1').properties!.outputs.properties!.site_use.properties!.records.items!.properties!.photoDirection
  expect(()=>assertObjectJsonSchema(api.getModuleAuthorGroupSchema('1.07','site_use:4.1'))).not.toThrow()
  const missing={value:null,claimClass:'missing',limitations:['No direction tag']}
  expect(validateJsonSchemaValue(schema,missing)).toEqual([])
  expect(validateJsonSchemaValue(schema,{...missing,value:'null'})).not.toEqual([])
  expect(validateJsonSchemaValue(schema,{...missing,value:'north'})).not.toEqual([])
  expect(validateJsonSchemaValue(schema,{...missing,claimClass:'source_conclusion'})).not.toEqual([])
  expect(validateJsonSchemaValue(schema,{...missing,value:'north',claimClass:'source_conclusion'})).toEqual([])
  expect(missing.value).toBe(null)
})
it('binds all twelve rejected missing-value addresses to the latest raw hash and suppresses obsolete numeric failures',()=>{
  const raw={projectionVersion:'module-author-field-group.v7',groupId:'site_use:4.1',outputs:{site_use:{records:Array.from({length:12},(_,i)=>({recordId:'r'+i,
    photoDirection:{value:'null',claimClass:'missing',limitations:['No direction']}}))}},evidence:[]}
  const audit={reviewReceipts:[],attempts:[{classId:'text',status:'failed',groupId:'site_use:4.1',error:'MODULE_SOURCE_VALUE_NUMBER: obsolete',structuredOutput:{}},
    {classId:'text',status:'failed',groupId:'site_use:4.1',error:'MODULE_PROJECTION_OUTPUT_INVALID: MISSING_REQUIRES_JSON_NULL',structuredOutput:raw}]}
  const before=structuredClone(audit),feedback=moduleRecoveryFeedback({resumeExecutionAudit:audit},'site_use:4.1')
  const excerpt=JSON.parse(feedback.split('\n').at(-1)!).previousRejection.diagnosticExcerpt
  expect(excerpt).toMatchObject({scope:'missing-field-null-conflicts-only',completeSubmission:false,originalSubmissionHash:sha256CanonicalJson(raw)})
  expect(excerpt.fieldNullConflicts).toHaveLength(12)
  expect(excerpt.fieldNullConflicts.map((r:any)=>r.target)).toEqual(Array.from({length:12},(_,i)=>({port:'site_use',recordId:'r'+i,field:'photoDirection',at:''})))
  expect(feedback).not.toContain('obsolete')
  expect(feedback).toContain('JSON null')
  expect(audit).toEqual(before)
})
it('keeps original native anchors, identity fields and receipts while omitting irrelevant spatial fields only from metadata prompts',()=>{
  const a=api as any
  expect(typeof a.getModuleAuthorMetadataGroupPromptView).toBe('function')
  const raws=api.getModuleAuthorFieldGroups('1.07','module-author-field-group.v6').slice(0,3).map(g=>({projectionVersion:'module-author-field-group.v6' as const,groupId:g.groupId,
    outputs:{site_use:{type:'planning.site_use.v1.2',quality:'limited' as const,scope:'Frozen scope',asOf:'2026-09-30',limitations:['Not current facts'],
      records:[{recordId:'r0',resultClass:'observation_summary',...Object.fromEntries(g.fields.map(f=>[f,{value:null,claimClass:'missing',limitations:['No source for '+f+': '+('x'.repeat(2000))]}]))}]}},
    evidence:[],limitations:['test-only'],stepResults:Object.fromEntries([1,2,3,4].map(n=>['step'+n,{status:'limited',summary:'No source',fieldRefs:[],limitations:['No source']}]))})) as any[]
  const before=structuredClone(raws),full=api.getModuleAuthorGroupPromptContext('1.07',raws)
  const view=a.getModuleAuthorMetadataGroupPromptView('1.07',raws),expanded=expandModuleReferencePromptView(view) as any
  expect(JSON.stringify(view).length).toBeLessThan(JSON.stringify(api.getModuleAuthorGroupPromptView('1.07',raws)).length*.7)
  expect(expanded.groupReceipts).toEqual(full.groupReceipts)
  expect(expanded.outputs.site_use.records[0]).toEqual({recordId:'r0',resultClass:'observation_summary',spaceId:before[0].outputs.site_use.records[0].spaceId,assetId:before[0].outputs.site_use.records[0].assetId})
  expect(expanded.previousGroupScope.fullContextHash).toBe(sha256CanonicalJson(full))
  expect(expanded.previousGroupScope.omittedFields).toContain('geometry')
  expect(raws).toEqual(before)
})
