import type { PlanningChildRequest as SubagentStartRequest } from '../src/runtime/dsh-subagents.ts'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { SubagentResult } from '@deepseek-ai/dsh-subagent'
import { assertObjectJsonSchema, validateJsonSchemaValue, type ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import * as SchemaValidation from '@deepseek-ai/dsh-tools'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentClassService } from '../src/agent-classes/service.ts'
import { captureMaterialCorpus, materialCorpusFingerprint } from '../src/materials/research-evidence.ts'
import sharp from 'sharp'
import { getModuleFieldContracts, validateModuleOutputs } from '../src/research-v2/module-contracts.ts'
import { getResearchModuleSpec } from '../src/research-v2/specification.ts'
import { loadPlanningCatalog } from '../src/research-v2/catalog.ts'
import { readModuleExecutionResult, type ModuleExecutionSummary } from '../src/research-v2/module-execution.ts'
import { materialPdf } from './support/material-pdf.ts'
import { sha256CanonicalJson } from '../src/presentation/canonical-json.ts'
import { expandModuleReferencePromptView } from '../src/research-v2/module-reference-context.ts'
import * as PromptContext from '../src/research-v2/module-prompt-context.ts'
import * as ContextBudget from '../src/research-v2/native-module-context-budget.ts'
import { NATIVE_MODULE_JSON_WIRE_VERSION, NATIVE_MODULE_FROZEN_JSON_WIRE_VERSION } from '../src/research-v2/native-submission-wire.ts'
import { expandNativeSchemaDescription } from '../src/research-v2/native-schema-reference.ts'
import {moduleSynthesisSteps} from '../src/research-v2/module-synthesis.ts'
import { recoverModuleAuthorGroups } from '../src/research-v2/module-group-recovery.ts'

vi.mock('@deepseek-ai/dsh-tools', async importOriginal => {
  const actual = await importOriginal<typeof import('@deepseek-ai/dsh-tools')>()
  return { ...actual, assertObjectJsonSchema: vi.fn(actual.assertObjectJsonSchema) }
})

const apiUrl = new URL('../src/research-v2/native-module-runtime.ts', import.meta.url)
describe('source planning reaches native JSON transport after capacity failures',()=>{
 it('requests four fixed native synthesis step keys and independently reviews the unchanged raw judgment',async()=>{
  const {createNativeModuleRuntime}=await api(false),f=await fixture()
  const run=await createNativeModuleRuntime({synthesizeGroups:true,agentClasses:f.classes,subagents:f.subagents,readNativeEvents:f.readNativeEvents}).execute(f.parent,f.request)
  expect(run.results,run.moduleRuns[0]?.error).toHaveLength(1)
  const input=f.start.mock.calls.map(([,value])=>value).find(value=>value.label?.endsWith(':module-synthesis'))!
  expect(input.outputSchema!.properties!.steps).toBeUndefined()
  expect(Object.keys(input.outputSchema!.properties!.stepResults.properties!)).toEqual(['step1','step2','step3','step4'])
  expect(run.results[0].execution!.synthesis!.judgment.version).toBe('module-research-synthesis.v4')
  expect(run.results[0].execution!.reviewReceipts).toHaveLength(1)
 })
 it.each([false,true])('lets the original provider decide conservative review capacity after verified synthesis; provider rejects=%s',async rejects=>{
  const {createNativeModuleRuntime}=await api(false)
  const large={context:{contextWindow:872000},defaultMaxTokens:128000}
  const f=await fixture('success',{text:large,review:large,backup:large})
  await f.classes.save(1,{image:textRoute,web:textRoute,text:textRoute,review:reviewRoute},{text:[backup],review:[]})
  const originalSchemaCheck=(await vi.importActual<typeof SchemaValidation>('@deepseek-ai/dsh-tools')).assertObjectJsonSchema
  const descriptions=vi.spyOn(SchemaValidation,'assertObjectJsonSchema').mockImplementation(schema=>{
   const schemaView=schema as ObjectJsonSchema
   if(schemaView.properties?.checks){
    const description='Complete repeated review guidance. '.repeat(1000)
    Object.assign(schemaView,{description});Object.assign(schemaView.properties.checks,{description})
    Object.assign(schemaView.properties.checks.items!,{description})
   }
   return originalSchemaCheck(schema)
  })
  const check=ContextBudget.assertNativeModuleContext
  const capacity=vi.spyOn(ContextBudget,'assertNativeModuleContext').mockImplementation((limits,prompt,schema,blocks)=>{
   if(prompt.includes('你是独立专业审查子会话'))throw new ContextBudget.NativeModuleContextBudgetError('synthetic UTF-8 upper bound exceeds capacity')
   return check(limits,prompt,schema,blocks)
  })
  let actualReviews=0
  const reviewSchemas: ObjectJsonSchema[]=[]
  const subagents={...f.subagents,start:async(provider:string,input:SubagentStartRequest)=>{
   if(input.agentOptions?.model==='review'){
    actualReviews++
    reviewSchemas.push(input.outputSchema!)
    expect(fixturePromptContext(input.prompt.filter(b=>b.type==='text').map(b=>b.text).join('\n'),'candidate').candidate.claims.length).toBeGreaterThan(0)
    if(rejects)throw new Error('PROVIDER_CONTEXT_LENGTH_EXCEEDED')
   }
   return f.subagents.start(provider,input)
  }}
  try{
   const run=await createNativeModuleRuntime({synthesizeGroups:true,agentClasses:f.classes,subagents,readNativeEvents:f.readNativeEvents}).execute(f.parent,f.request)
   expect(reviewSchemas[0].properties?.checks, 'provider capacity admission must retain native criterion and claim choices').toBeDefined()
   expect(reviewSchemas[0].properties?.submissionJson).toBeUndefined()
   expect(actualReviews,run.moduleRuns[0]?.error).toBe(1)
   if(rejects){
    expect(run.results).toHaveLength(0);expect(run.moduleRuns[0].error).toContain('PROVIDER_CONTEXT_LENGTH_EXCEEDED')
    const failed:any=run.moduleRuns[0].executionAudit!.attempts!.find((row:any)=>row.classId==='review'&&row.status==='failed')
    expect(failed.contextBudget).toMatchObject({admission:'native-provider',actualTokenCountKnown:false,contextWindow:872000,outputReservedTokens:128000})
   }
   else{
    expect(run.results).toHaveLength(1)
    const attempt:any=run.results[0].execution!.attempts!.find((row:any)=>row.classId==='review'&&row.status==='completed')
    expect(attempt.contextBudget).toMatchObject({admission:'native-provider',actualTokenCountKnown:false,contextWindow:872000,outputReservedTokens:128000})
    expect(run.results[0].execution!.reviewReceipts![0].verdict).toBe('limited')
   }
  }finally{capacity.mockRestore();descriptions.mockRestore()}
 })
 it.each([false,true])('lets the original provider admit the complete overall review and preserves provider rejection; rejects=%s',async rejects=>{
  const {createNativeModuleRuntime}=await api(false),large={context:{contextWindow:872000},defaultMaxTokens:128000}
  const f=await fixture('project-task-bound',{text:large,review:large,backup:large})
  await f.classes.save(1,{image:textRoute,web:textRoute,text:textRoute,review:reviewRoute},{text:[backup],review:[]})
  const taskBrief=JSON.stringify({sessionId:'synthetic-request',seq:17,time:'2026-10-08T10:00:00.000Z',text:'Compare bounded planning options; do not assert verified rights.'})
  const check=ContextBudget.assertNativeModuleContext
  const capacity=vi.spyOn(ContextBudget,'assertNativeModuleContext').mockImplementation((limits,prompt,schema,blocks)=>{
   if(prompt.includes('你是独立的整体研究回看子会话'))throw new ContextBudget.NativeModuleContextBudgetError('synthetic overall-review byte upper bound exceeds capacity')
   return check(limits,prompt,schema,blocks)
  })
  const admitted:SubagentStartRequest[]=[]
  const subagents={...f.subagents,start:async(provider:string,input:SubagentStartRequest)=>{
   if(input.label?.endsWith(':progress-review')){
    admitted.push(input)
    const view=fixturePromptContext(input.prompt.filter(b=>b.type==='text').map(b=>b.text).join('\n'),'progressReview').progressReview
    expect(view.modules).toHaveLength(1);expect(view.binding.requiredConditions.length).toBeGreaterThan(0)
    expect(input.outputSchema?.properties?.requestHash.const).toBe(view.binding.requestHash)
    expect(input.outputSchema?.properties?.conditions).toBeDefined()
    expect(input.outputSchema?.properties?.submissionJson).toBeUndefined()
    expect(input.agentOptions?.model).toBe('review')
    if(rejects)throw new Error('PROVIDER_CONTEXT_LENGTH_EXCEEDED')
   }
   return f.subagents.start(provider,input)
  }}
  try{
   const run=await createNativeModuleRuntime({synthesizeGroups:true,progressReview:true,agentClasses:f.classes,subagents,readNativeEvents:f.readNativeEvents}).execute(f.parent,{...f.request,taskBrief})
   expect(admitted,run.researchProgress?.failure).toHaveLength(1)
   expect(run.results).toHaveLength(1)
   if(rejects){expect(run.researchProgress?.failure).toContain('PROVIDER_CONTEXT_LENGTH_EXCEEDED');expect(run.researchProgress?.reviews).toHaveLength(0)}
   else{
    expect(run.researchProgress?.failure).toBeUndefined();expect(run.researchProgress?.reviews).toHaveLength(1)
    const receipt=run.researchProgress!.reviews[0]
    const attempt=receipt.attempts!.find((row:any)=>row.status==='completed') as any
    expect(attempt.contextBudget).toMatchObject({admission:'native-provider',actualTokenCountKnown:false,contextWindow:872000,outputReservedTokens:128000})
    expect(receipt.decision.conditions).toHaveLength(receipt.binding.requiredConditions.length)
   }
  }finally{capacity.mockRestore()}
 })
 it.each(['accepted','provider-rejected','invalid-content'] as const)('keeps complete native author fields under a conservative byte bound; outcome=%s',async outcome=>{
  const {createNativeModuleRuntime}=await api(false),large={context:{contextWindow:872000},defaultMaxTokens:128000}
  const f=await fixture(outcome==='invalid-content'?'unsupported-source':'success',{text:large,review:large,backup:large})
  await f.classes.save(1,{image:textRoute,web:textRoute,text:textRoute,review:reviewRoute},{text:[],review:[]})
  const check=ContextBudget.assertNativeModuleContext
  const capacity=vi.spyOn(ContextBudget,'assertNativeModuleContext').mockImplementation((limits,prompt,schema,blocks)=>{
   if(JSON.parse(schema).properties?.groupId)throw new ContextBudget.NativeModuleContextBudgetError('synthetic author byte upper bound exceeds capacity')
   return check(limits,prompt,schema,blocks)
  })
  const authors:SubagentStartRequest[]=[]
  const subagents={...f.subagents,start:async(provider:string,input:SubagentStartRequest)=>{
   if(input.label?.startsWith('preplanning_module_text:')){
    authors.push(input)
    if(outcome==='provider-rejected')throw new Error('PROVIDER_CONTEXT_LENGTH_EXCEEDED')
   }
   return f.subagents.start(provider,input)
  }}
  try{
   const run=await createNativeModuleRuntime({agentClasses:f.classes,subagents,readNativeEvents:f.readNativeEvents}).execute(f.parent,f.request)
   expect(authors.length,run.moduleRuns[0]?.error).toBeGreaterThan(0)
   expect(authors[0].outputSchema?.properties?.outputs).toBeDefined()
   expect(authors[0].outputSchema?.properties?.submissionJson).toBeUndefined()
   expect(authors[0].agentOptions).toMatchObject(textRoute)
   const attempts=(run.results[0]?.execution?.attempts??run.moduleRuns[0].executionAudit?.attempts??[]) as any[]
   const author=attempts.find(row=>row.classId==='text')
   expect(author.contextBudget).toMatchObject({admission:'native-provider',actualTokenCountKnown:false,contextWindow:872000,outputReservedTokens:128000})
   if(outcome==='accepted'){
    expect(run.results,run.moduleRuns[0]?.error).toHaveLength(1)
    expect(run.results[0].outputs.project_brief.records[0].formalName.value).toBe('Shaotanhe Reservoir')
    expect(run.results[0].execution!.reviewReceipts).toHaveLength(1)
    await expect(readModuleExecutionResult(f.root,run.moduleRuns[0].bundleRunId!)).resolves.toEqual(run.results[0])
   }else{
    expect(run.results).toHaveLength(0)
    expect(run.moduleRuns[0].error).toMatch(outcome==='provider-rejected'?/PROVIDER_CONTEXT_LENGTH_EXCEEDED/:/SOURCE_VALUE/)
    expect(attempts.every(row=>row.classId==='text')).toBe(true)
    if(outcome==='provider-rejected')expect(authors).toHaveLength(1)
   }
  }finally{capacity.mockRestore()}
 })
 it.each(['known','unknown','provider-rejected'] as const)('preserves bounded complete source spans after conservative planning failure; route=%s',async mode=>{
  const {createNativeModuleRuntime}=await api(false),large={context:{contextWindow:872000},defaultMaxTokens:128000}
  const f=await fixture('success',mode==='unknown'?undefined:{text:large,review:large,backup:large})
  await f.classes.save(1,{image:textRoute,web:textRoute,text:textRoute,review:reviewRoute},{text:[],review:[]})
  const allocation=vi.spyOn(ContextBudget,'allocateModuleMaterialChars').mockReturnValue(1)
  const equivalent=vi.spyOn(ContextBudget,'allocateModuleMaterialCharsForEquivalentSchemas').mockReturnValue(1)
  const shared=vi.spyOn(ContextBudget,'allocateModuleMaterialCharsForSharedInput').mockReturnValue(1)
  const wire=vi.spyOn(ContextBudget,'allocateModuleMaterialCharsForSubmissionWire').mockReturnValue(1)
  const authors:SubagentStartRequest[]=[]
  const subagents={...f.subagents,start:async(provider:string,input:SubagentStartRequest)=>{
   if(input.label?.startsWith('preplanning_module_text:')){
    authors.push(input)
    if(mode==='provider-rejected')throw new Error('PROVIDER_CONTEXT_LENGTH_EXCEEDED')
   }
   return f.subagents.start(provider,input)
  }}
  try{
   const run=await createNativeModuleRuntime({agentClasses:f.classes,subagents,readNativeEvents:f.readNativeEvents}).execute(f.parent,f.request)
   if(mode==='unknown'){
    expect(authors).toHaveLength(0);expect(run.results).toHaveLength(0)
    expect(run.moduleRuns[0].error).toContain('MODULE_PROMPT_BUDGET_EXCEEDED');return
   }
   expect(authors.length,run.moduleRuns[0]?.error).toBeGreaterThan(0)
   const prompt=authors[0].prompt.filter(part=>part.type==='text').map(part=>part.text).join('\n')
   const sources=expandModuleReferencePromptView(fixturePromptContext(prompt,'sources').sources) as any
   expect(sources.corpus.selection.maxMaterialChars).toBeLessThanOrEqual(48000)
   expect(sources.corpus.originalFingerprint).toBe(f.request.corpus.fingerprint)
   expect(sources.corpus.documents.length).toBeGreaterThan(0)
   for(const document of sources.corpus.documents){
    const original=f.request.corpus.documents.find(row=>row.path===document.path)!
    expect(original.contentHash).toBe(document.contentHash)
    for(const page of document.pages??[])expect(original.pages?.find(row=>row.page===page.page)?.text).toBe(page.text)
    for(const span of document.paragraphs??[])expect(original.text?.slice(span.startOffset,span.endOffset)).toBe(span.text)
   }
   if(mode==='provider-rejected'){
    expect(run.results).toHaveLength(0);expect(run.moduleRuns[0].error).toContain('PROVIDER_CONTEXT_LENGTH_EXCEEDED')
    expect(authors).toHaveLength(1)
   }else{
    expect(run.results,run.moduleRuns[0]?.error).toHaveLength(1)
    await expect(readModuleExecutionResult(f.root,run.moduleRuns[0].bundleRunId!)).resolves.toEqual(run.results[0])
   }
  }finally{allocation.mockRestore();equivalent.mockRestore();shared.mockRestore();wire.mockRestore()}
 })
 it('resumes verified overall review history but still performs a fresh native baseline before remaining work',async()=>{
  const {createNativeModuleRuntime}=await api(false),f=await fixture('project-task-bound')
  const taskBrief=JSON.stringify({sessionId:'synthetic-request',seq:17,time:'2026-10-08T10:00:00.000Z',text:'Compare bounded planning options; do not assert verified rights.'})
  const subagents={...f.subagents,start:async(provider:string,request:SubagentStartRequest)=>{
   if(request.label?.startsWith('preplanning_module_text:')&&request.label.split(':')[2]!=='1.01')throw new Error('Synthetic remaining-module author is unavailable')
   return f.subagents.start(provider,request)
  }}
  const runtime=createNativeModuleRuntime({synthesizeGroups:true,progressReview:true,agentClasses:f.classes,subagents,readNativeEvents:f.readNativeEvents})
  const first=await runtime.execute(f.parent,{...f.request,moduleIds:undefined,taskBrief})
  expect(first.results,JSON.stringify(first.moduleRuns)).toHaveLength(1)
  const original=structuredClone(first.researchProgress!),calls=f.start.mock.calls.length
  const resumed=await runtime.execute(f.parent,{...f.request,moduleIds:undefined,taskBrief,resumeRunIds:[first.manifestRunId]})
  expect(resumed.results,JSON.stringify(resumed.moduleRuns)).toHaveLength(1)
  expect(resumed.researchProgress!.reviews.slice(0,original.reviews.length)).toEqual(original.reviews)
  const fresh=resumed.researchProgress!.reviews.slice(original.reviews.length)
  expect(fresh.map((r:any)=>r.binding.reason)).toEqual(['baseline','phase-end'])
  expect(fresh.every((r:any)=>!original.reviews.some((saved:any)=>saved.execution.childId===r.execution.childId))).toBe(true)
  const baseline=f.start.mock.calls.slice(calls).map(([,request])=>request.prompt.filter(b=>b.type==='text').map(b=>b.text).join('\n'))
   .map(prompt=>fixturePromptContext(prompt,'progressReview')?.progressReview).find(view=>view?.binding.reason==='baseline')
  expect(baseline.previousReview.hash).toBe(original.reviews.at(-1)!.hash)
  expect(first.researchProgress).toEqual(original)
 })
 it.each(['initial-allocation','later-allocation'] as const)('retains original sources and dispatches after %s fails',async stage=>{
  const {createNativeModuleRuntime}=await api(false)
  const large={context:{contextWindow:872000},defaultMaxTokens:128000}
  const f=await fixture('success',{text:large,review:large,backup:large})
  const before=sha256CanonicalJson(f.request.corpus)
  const spies:any[]=[]
  if(stage==='initial-allocation')spies.push(vi.spyOn(ContextBudget,'allocateModuleMaterialChars').mockImplementation(()=>{
   throw new ContextBudget.NativeModuleContextBudgetError('synthetic expanded declaration exhaustion')
  }))
  else{
   const slice=PromptContext.sliceModuleCorpus
   spies.push(vi.spyOn(PromptContext,'sliceModuleCorpus').mockImplementation((corpus,options)=>{
    if(options.maxMaterialUtf8Bytes!==undefined&&options.materialByteEncoding===undefined)
     throw new Error('MODULE_PROMPT_BUDGET_EXCEEDED: synthetic mandatory original source floor')
    return slice(corpus,options)
   }))
   spies.push(vi.spyOn(ContextBudget,'allocateModuleMaterialCharsForEquivalentSchemas').mockImplementation(()=>{
    throw new ContextBudget.NativeModuleContextBudgetError('synthetic equivalent declaration exhaustion')
   }))
  }
  try{
   const run=await createNativeModuleRuntime({subagents:f.subagents,agentClasses:f.classes,readNativeEvents:f.readNativeEvents}).execute(f.parent,f.request)
   expect(run.results,JSON.stringify(run.moduleRuns)).toHaveLength(1)
   expect(f.start.mock.calls.length).toBeGreaterThan(0)
   expect(sha256CanonicalJson(f.request.corpus)).toBe(before)
  }finally{spies.forEach(spy=>spy.mockRestore())}
 })
})
async function api(singleV2 = true) {
  expect(existsSync(apiUrl), 'native module runtime is implemented').toBe(true)
  const loaded = await import(apiUrl.href)
  return singleV2 ? { ...loaded, createNativeModuleRuntime: (dependencies: any) => loaded.createNativeModuleRuntime({ ...dependencies, authorProtocol: 'json-v2' }) } : loaded
}
const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
const textRoute = { provider: 'native', model: 'text' }, reviewRoute = { provider: 'native', model: 'review' }
const backup = { provider: 'native', model: 'backup' }
const spec = getResearchModuleSpec('1.01')
const limitation = '只具备历史名称；委托范围、行政区与权属仍须核验。'
// Decode only the read-only native input envelope. Both legacy separate blocks
// and complete-stage/ordered shared blocks must expose the same original data.
function fixturePromptContext(prompt: string, key: string): any {
  for (const line of prompt.split('\n')) {
    let parsed: unknown
    try { parsed = JSON.parse(line) } catch { continue }
    const context = expandModuleReferencePromptView(parsed) as any
    if (context && typeof context === 'object' && Object.hasOwn(context, key)) return context
    if (Array.isArray(context?.orderedNativeInput)) {
      for (const part of context.orderedNativeInput) {
        const original = expandModuleReferencePromptView(part.json) as any
        if (original && typeof original === 'object' && Object.hasOwn(original, key)) return original
      }
    }
  }
  throw new Error('Missing fixture prompt context: ' + key)
}
type Mode = 'gateway-cross-kind-once' | 'planning-pass-review' | 'owner-evidence-once' | 'success' | 'schema-once' | 'unsupported-source' | 'review-once' | 'review-always-fail' | 'review-missing-criteria' | 'review-unknown-claim' | 'wrong-model' | 'cancel' | 'empty-output'
  | 'source-text-once' | 'source-binding-progress-once' | 'source-quote-whitespace-once' | 'source-quote-whitespace-empty-once' | 'missing-source-path-once' | 'missing-web-path-and-text-once' | 'local-reference-once' | 'prior-group-reference-once' | 'unit-once' | 'duplicate-evidence-once'
  | 'boundary-success' | 'boundary-scope-missing' | 'boundary-all-missing' | 'boundary-provisional'
  | 'separate-deadlines' | 'cancel-review' | 'model-timeout' | 'model-timeout-once' | 'accepted-limited-once' | 'text-only' | 'misnested-metadata' | 'legacy-candidate'
  | 'legacy-projection' | 'legacy-string-projection' | 'duplicate-json'
  | 'group-review-same-author' | 'group-fail-last' | 'group-missing-reason' | 'group-uncovered-alias' | 'group-uncovered-cycle'
  | 'group-step-string' | 'group-step-empty' | 'group-step-missing' | 'group-legacy-v3'
  | 'same-route' | 'schema-twice' | 'malformed-json-once' | 'oversized-schema-once' | 'compactable-schema-once' | 'missing-evidence-oversized-once' | 'availability-once'
  | 'review-websocket-once' | 'review-websocket-always'
  | 'kind-evidence-oversized-once' | 'kind-evidence-oversized-empty-once' | 'kind-evidence-oversized-wire-once'
  | 'step-evidence-oversized-once'
  | 'availability-after-corrections' | 'availability-after-corrections-exhausted' | 'overload-after-corrections'
  | 'native-schema-stop-once' | 'business-then-native-schema'
  | 'project-task-bound' | 'project-task-binding-missing-once' | 'project-task-reference-invalid-once'

// Test fixture adapter only. Production must never unwrap/convert an old failed
// model payload into the new protocol: it accepts explicit versioned projection.
function fixtureProjection(candidate: any) {
  const outputs = structuredClone(candidate.outputs)
  for (const port of Object.values(outputs) as any[]) {
    delete port.claimRefs
    for (const row of port.records) for (const [key, field] of Object.entries(row)) if (!['recordId', 'resultClass'].includes(key)) delete (field as any).claimRefs
  }
  const addresses = new Map<string, any>()
  const evidence = candidate.claims.map((claim: any) => {
    const match = /^\/outputs\/([^/]+)\/records\/(\d+)\/([^/]+)\/value(.*)$/.exec(claim.selector)!
    const target = { port: match[1], recordId: candidate.outputs[match[1]].records[Number(match[2])].recordId, field: match[3], at: match[4] }
    addresses.set(claim.claimId, target)
    const source = candidate.sourceValues.find((s: any) => s.sourceId === claim.sourceId)
    return { target, kind: claim.kind, ...(claim.rationale ? { rationale: claim.rationale } : {}), ...(source ? { source: {
      path: source.path, ...(source.page === undefined ? {} : { page: source.page }), quote: source.quote,
      ...(source.valueQuote === undefined ? {} : { valueQuote: source.valueQuote }),
    } } : {}) }
  })
  return { projectionVersion: 'module-author-projection-json.v2', outputsJson: JSON.stringify(outputs), evidence, limitations: candidate.limitations,
    steps: candidate.steps.map(({ claimRefs, ...step }: any) => ({ ...step, fieldRefs: claimRefs.map((id: string) => addresses.get(id)) })) }
}

function boundaryCandidate(): any {
  const contract = getModuleFieldContracts('1.02').ports.boundaries
  const row: any = { recordId: 'boundary', resultClass: 'proposal' }
  for (const f of contract.fields) row[f.name] = { value: null, claimRefs: [], claimClass: 'missing', limitations: ['Synthetic test lacks legal vectors'] }
  const values: Record<string, unknown> = { boundaryId:'BND-1', scopeKind:'research', geometry:{type:'Polygon',coordinates:[[[114,30],[114.01,30],[114.01,30.01],[114,30.01],[114,30]]]},
    crs:'EPSG:4326', axisOrder:'xy', legalStatus:'Research scenario, not approved', version:'synthetic-v1' }
  const claims: any[] = []
  for (const [field,value] of Object.entries(values)) {
    const ids: string[] = []
    const visit = (value: unknown, path: string) => {
      if (value && typeof value === 'object') { for (const [k,v] of Object.entries(value)) visit(v,`${path}/${k}`); return }
      const claimId=`b-${claims.length}`; ids.push(claimId)
      claims.push({claimId,selector:`/outputs/boundaries/records/0/${field}/value${path}`,kind:'assumption',value,
        rationale:'Synthetic coordinates exercise program calculations only; not project facts or a survey.'})
    }
    visit(value,'')
    row[field]={value,claimRefs:ids,claimClass:'assumption',limitations:['Synthetic test scenario']}
  }
  const claimRefs=claims.map(c=>c.claimId)
  return {outputs:{boundaries:{type:contract.type,quality:'limited',records:[row],claimRefs,limitations:['Synthetic boundary, not legal'],scope:'Test research',asOf:'2026-09-28'}},
    claims,sourceValues:[],limitations:['Synthetic scenario'],steps:getResearchModuleSpec('1.02').steps.map((_,index)=>({step:index+1,status:'limited',summary:'Synthetic test boundary',claimRefs,limitations:['Not a real project']}))}
}
async function fixture(mode: Mode = 'success', modelLimits?: Record<string, { context?: { contextWindow: number }; defaultMaxTokens?: number }>, provider='native') {
  const textRoute={provider,model:'text'},reviewRoute={provider,model:'review'},backup={provider,model:'backup'}
  const root = await mkdtemp(join(tmpdir(), 'native-module-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, '原始资料'))
  const whitespaceQuoteMode=mode.startsWith('source-quote-whitespace-')
  const sourceName=whitespaceQuoteMode?'Shaotanhe Reservoir,\nproject-id':'Shaotanhe Reservoir'
  if(whitespaceQuoteMode)await writeFile(join(root,'原始资料','source.txt'),sourceName)
  else await writeFile(join(root, '原始资料', 'source.pdf'), materialPdf(['Cover', 'Shaotanhe Reservoir project-id']))
  const corpus = await captureMaterialCorpus(root)
  const document = corpus.documents[0]
  const parent = { id: 'parent', options: { provider: 'parent', model: 'unrelated' }, session: { id: 'parent', header: { cwd: root } } }
  const controller = new AbortController()
  const request = { workspaceRoot: root, projectId: 'project', snapshotId: 'snapshot', corpus, moduleIds: [mode.startsWith('boundary-') ? '1.02' : '1.01'],
    flags: { industryPlanning: false, existingBuildings: false, externalPartners: false, marketing: false }, signal: controller.signal }
  const contracts = getModuleFieldContracts('1.01')
  const candidate = () => {
    const row: Record<string, unknown> = { recordId: 'project-row', resultClass: 'observation_summary' }
    for (const field of contracts.ports.project_brief.fields) row[field.name] = { value: null, claimRefs: [], claimClass: 'missing', limitations: [limitation] }
    row.formalName = { value: sourceName, claimRefs: ['name'], claimClass: 'source_conclusion', limitations: [limitation] }
    if(mode==='source-binding-progress-once')row.aliases={value:[sourceName],claimRefs:['alias-name'],claimClass:'source_conclusion',limitations:[limitation]}
    row.commissionScope = { value: '本轮先建立身份核验任务，不作建设审批判断。', claimRefs: ['scope'], claimClass: 'decision', limitations: [limitation] }
    return {
      outputs: { project_brief: { type: contracts.ports.project_brief.type, quality: 'limited', records: [row], claimRefs: ['name', 'scope',...(mode==='source-binding-progress-once'?['alias-name']:[])], limitations: [limitation], scope: '少潭河历史资料研究', asOf: '2026-09-26' } },
      claims: [
        { claimId: 'name', selector: '/outputs/project_brief/records/0/formalName/value', kind: 'source', value: sourceName, sourceId: 'original-name' },
        ...(mode==='source-binding-progress-once'?[{claimId:'alias-name',selector:'/outputs/project_brief/records/0/aliases/value/0',kind:'source',value:sourceName,sourceId:'original-name'}]:[]),
        { claimId: 'scope', selector: '/outputs/project_brief/records/0/commissionScope/value', kind: 'proposal', value: '本轮先建立身份核验任务，不作建设审批判断。', rationale: '依本项fallback限定为身份核验研究，未声称已获得建设许可。' },
      ],
      sourceValues: [{ sourceId: 'original-name', path: document.path, ...(whitespaceQuoteMode?{}:{page:2}), contentHash: document.contentHash, quote: sourceName, rawValue: sourceName }],
      limitations: [limitation],
      steps: spec.steps.map((_, index) => ({ step: index + 1, status: 'limited', summary: '已依据现有资料核对名称并形成任务边界；当前缺失内容保留核验任务。', claimRefs: ['name', 'scope'], limitations: [limitation] })),
    }
  }
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(root, 'storage') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  const children = new Map<string, { type: string; data: unknown }[]>()
  const nativeLogs = new Map<string, any[]>()
  const classes = await AgentClassService.open(ctx.storage.domain, {
    llm: { listProviders: () => [{ id: provider, name: 'Native' }], listConfigurableProviders: () => [],
      ...(modelLimits ? { resolveModelInfo: async (_provider: string, model: string) => modelLimits[model] } : {}),
      listModels: async () => [textRoute, reviewRoute, backup].map(route => ({ id: route.model, name: route.model, provider: route.provider })) } as never,
    sessions: { get: id => children.has(id) ? { snapshotEvents: () => children.get(id)! } : undefined },
    readPersistedEvents: async id => nativeLogs.get(id),
  })
  cleanups.push(() => classes.close())
  await classes.save(0, { image: textRoute, web: textRoute, text: textRoute, review: mode === 'same-route' ? textRoute : reviewRoute },
    mode === 'same-route' ? { text: [], review: [] } : { text: [backup], review: [backup] })
  let textCount = 0, reviewCount = 0
  let candidateClaimIds = ['name', 'scope']
  const disposed: string[] = []
  const start = vi.fn(async (_provider: string, input: SubagentStartRequest) => {
    assertObjectJsonSchema(input.outputSchema)
    const review = input.label?.startsWith('preplanning_module_review:') === true
    if (review) reviewCount++; else textCount++
    const childId = review && mode === 'group-review-same-author' ? 'text-1' : `${review ? 'review' : 'text'}-${review ? reviewCount : textCount}`
    const actual = mode === 'wrong-model' ? backup : input.agentOptions
    const events: { type: string; data: unknown }[] = [
      { type: 'request/header', data: { header: { config: actual } } },
      { type: 'turn/end', data: { reason: { kind: 'completed' } } },
    ]
    children.set(childId, events)
    const nativeStartedAt = Date.now()
    const specialPrompt=input.prompt.map(part=>part.type==='text'?part.text:'').join('\n')
    if(input.outputSchema.properties?.requestHash||['module-research-synthesis.v3','module-research-synthesis.v4'].includes(String(input.outputSchema.properties?.version?.const))){
      const specialSchema=input.outputSchema.properties!
      let structured:unknown
      if(specialSchema.requestHash){
        const payload=fixturePromptContext(specialPrompt,'progressReview').progressReview
        structured={requestHash:payload.binding.requestHash,verdict:'continue',rationale:'The options study stays within the user task and recorded protections.',
          conditions:payload.binding.requiredConditions.map((c:any)=>({...c,permission:'proceed',reason:'Bounded research only; current rights remain unknown.',verification:'Review after the next three substantive modules or changed premises.',scope:{kind:'none',allowedUses:[],heldUses:[],reviewAfterModules:3}})),driftFindings:[]}
      }else{
        const {candidate,candidateHash}=expandModuleReferencePromptView(fixturePromptContext(specialPrompt,'researchSynthesis').researchSynthesis) as any
        const claimRefs=candidate.claims.map((c:any)=>c.claimId)
        structured={version:'module-research-synthesis.v3',candidateHash,limitationBasisHash:specialSchema.limitationBasisHash.const,analysis:'Use the original name and working task to compare options; ownership remains unverified.',
          conclusion:'Proceed with the explicitly bounded options study.',claimRefs,steps:candidate.steps.map((s:any,index:number)=>({...s,claimRefs:index===2&&s.status==='limited'?[]:claimRefs})),
          handoff:[{moduleId:'preplan.research.01.02',use:'Use the stated working research task.',claimRefs,conditions:['No implementation approval or verified ownership.']}],limitations:candidate.limitations}
        if(specialSchema.stepResults){
          const {steps,...rest}=structured as any
          structured={...rest,version:'module-research-synthesis.v4',stepResults:Object.fromEntries(steps.map(({step,...value}:any)=>['step'+step,value]))}
        }
      }
      nativeLogs.set(childId,[{type:'request/header',data:{header:{config:actual,tools:[{name:'structured_output',parameters:input.outputSchema}]}}},
        {type:'tool/call',data:{name:'structured_output',callId:childId,arguments:JSON.stringify(structured)}},
        {type:'tool/result',data:{message:{content:[{type:'tool-result',toolCallId:childId,isError:false}]}}},
        {type:'turn/end',data:{reason:{kind:'completed'}}}])
      return {id:childId as never,localAgent:undefined,result:Promise.resolve<SubagentResult>({stopReason:'completed',output:[],structured}),dispose:async()=>{disposed.push(childId)}}
    }
    const itemId = input.label?.split(':')[2] ?? '1.01'
    const proposal = itemId === '1.02' ? boundaryCandidate() : candidate()
    if (!review && itemId==='1.01'&&['project-task-bound','project-task-binding-missing-once','project-task-reference-invalid-once'].includes(mode)) {
      const reference = JSON.parse(input.prompt.map(part => part.type === 'text' ? part.text : '').join('\n').split('\n').find(line => line.startsWith('{"task":'))!)
      const statement = reference.taskContext.taskBrief.split('\n').map((line:string)=>{try{return JSON.parse(line)}catch{return undefined}}).find((r:any)=>r?.sessionId&&Number.isSafeInteger(r.seq))
      const taskRef='task_statement_refs='+JSON.stringify([{sessionId:statement.sessionId,seq:statement.seq,quote:statement.text}])
      proposal.outputs.project_brief.records[0].originalStatement={value:statement.text,claimRefs:['request'],claimClass:'decision',limitations:['User research request only; formal commission unknown']}
      proposal.claims.find((c:any)=>c.claimId==='scope')!.rationale+='\n'+taskRef
      proposal.claims.push({claimId:'request',selector:'/outputs/project_brief/records/0/originalStatement/value',kind:'proposal',value:statement.text,rationale:'Working task quote only.\n'+taskRef})
      proposal.outputs.project_brief.claimRefs.push('request')
      proposal.steps.forEach((s:any)=>s.claimRefs.push('request'))
      if(mode==='project-task-reference-invalid-once'&&input.outputSchema?.properties?.groupId?.const==='project_brief:3'
        &&!input.prompt.some(part=>part.type==='text'&&part.text.includes('"invalidMember"')))
        proposal.claims.find((c:any)=>c.claimId==='scope')!.rationale+='}'
      if(mode==='project-task-binding-missing-once'&&input.outputSchema?.properties?.groupId?.const==='project_brief:3'
        &&!input.prompt.some(part=>part.type==='text'&&part.text.includes('"projectTaskBindingDiagnostic"'))){
        proposal.claims.find((c:any)=>c.claimId==='scope')!.rationale='The supplied user message requests this working task; no formal approval.'
        proposal.outputs.project_brief.records[0].originalStatement.claimClass='source_conclusion'
        const original=proposal.claims.find((c:any)=>c.claimId==='request')!
        original.kind='source';delete original.rationale;original.sourceId='misbound-task-source'
        const material=proposal.sourceValues[0]
        proposal.sourceValues.push({...material,sourceId:'misbound-task-source',quote:statement.text,rawValue:statement.text})
      }
    }
    if (!review && itemId === '1.02' && ['boundary-all-missing', 'boundary-provisional'].includes(mode)) {
      const reference = JSON.parse(input.prompt.map(part => part.type === 'text' ? part.text : '').join('\n').split('\n').find(line => line.startsWith('{"task":'))!)
      const row = proposal.outputs.boundaries.records[0]
      for (const field of getModuleFieldContracts('1.02').ports.boundaries.fields) row[field.name] = {
        value: null, claimRefs: [], claimClass: 'missing', limitations: ['Synthetic test has no survey, legal redline or approval.'],
      }
      proposal.claims = []; proposal.sourceValues = []
      // The native boundary double consumes only the assigned research guidance.
      // Without it, reproduce the observed all-null submission, not geometry.
      const guidance = mode === 'boundary-provisional' ? reference.task.scopeFallback : undefined
      if (guidance?.kind === 'provisional-research-only' && reference.taskContext?.taskBrief) {
        const values: Record<string, unknown> = {
          scopeKind: 'research',
          legalStatus: 'Compare research directions only; implementation authority remains unverified.',
          locationBasis: 'Use the supplied reservoir study as a candidate research reference; verify its current applicability before spatial decisions.',
        }
        for (const [field, value] of Object.entries(values)) if (guidance.fields?.some((entry: any) => entry.field === field && entry.role === 'conditional-research-expression')) {
          const claimId = `provisional-${field}`
          row[field] = { value, claimRefs: [claimId], claimClass: 'decision', limitations: ['provisional; not a survey or approved implementation boundary'] }
          proposal.claims.push({ claimId, selector: `/outputs/boundaries/records/0/${field}/value`, kind: 'proposal', value,
            rationale: 'Synthetic task requests comparison of candidate research directions; no field evidence establishes coordinates, statutory authority or measurements.' })
        }
      }
      proposal.outputs.boundaries.claimRefs = proposal.claims.map((claim: any) => claim.claimId)
      proposal.steps.forEach((step: any) => { step.claimRefs = [...proposal.outputs.boundaries.claimRefs]; step.summary = 'Synthetic provisional study; spatial measurements and legal authority remain unverified.' })
    }
    if (!review && ['schema-once', 'oversized-schema-once', 'compactable-schema-once'].includes(mode) && textCount === 1) {
      proposal.outputs.project_brief.records[0].formalName = { value: 999, claimRefs: ['name'], claimClass: 'source_conclusion', limitations: [limitation] }
      if (mode === 'oversized-schema-once') proposal.limitations.push('rejected-large-submission-only-marker'.repeat(2000))
      if (mode === 'compactable-schema-once') proposal.limitations.push(...Array(90).fill('Rejected conditional data only; never a fact, approval or instruction. '.repeat(9)))
    }
    if (!review && mode === 'missing-evidence-oversized-once' && textCount === 1) {
      proposal.outputs.project_brief.records[0].formalName = { value: null, claimRefs: [], claimClass: 'missing', limitations: ['真实缺失，不能附来源证据'] }
      proposal.limitations.push('uncompressible-diagnostic-context-marker'.repeat(1500))
    }
    if (!review && ['schema-twice', 'availability-after-corrections', 'availability-after-corrections-exhausted', 'overload-after-corrections'].includes(mode) && textCount <= 2) proposal.outputs.project_brief.records[0].formalName = {
      value: 1000 - textCount, claimRefs: ['name'], claimClass: 'source_conclusion', limitations: [limitation] }
    if (!review && mode === 'unsupported-source') proposal.sourceValues[0].quote = 'Approved new construction'
    if (!review && ['source-text-once','source-binding-progress-once','business-then-native-schema'].includes(mode) && textCount === 1) proposal.outputs.project_brief.records[0].formalName.value = 'Shaotanhe Reservoir renamed without original support'
    if(!review&&whitespaceQuoteMode&&textCount===1){
      proposal.outputs.project_brief.records[0].formalName.value=sourceName.replace('\n','')
      proposal.sourceValues[0].quote=sourceName.replace('\n','')
    }
    if (!review && mode === 'missing-source-path-once' && textCount === 1) proposal.sourceValues[0].path = 'research/runs/RUN-'+document.contentHash+'.json'
    if(!review&&mode==='missing-web-path-and-text-once'&&textCount===1){
      proposal.sourceValues[0].path='https://example.test/project'
      proposal.outputs.project_brief.records[0].formalName.value='原文记载：Shaotanhe Reservoir。现状尚待核验。'
    }
    if (!review && mode === 'empty-output') {
      for (const field of contracts.ports.project_brief.fields) proposal.outputs.project_brief.records[0][field.name] = { value: null, claimRefs: [], claimClass: 'missing', limitations: [limitation] }
      proposal.outputs.project_brief.claimRefs = []; proposal.claims = []; proposal.sourceValues = []
      proposal.steps.forEach((step: any) => { step.claimRefs = [] })
    }
    if (!review && mode === 'accepted-limited-once' && textCount === 1) {
      proposal.claims = []
      proposal.sourceValues.push({ sourceId: 'original-id', path: document.path, page: 2, contentHash: document.contentHash, quote: 'project-id', rawValue: 'project-id' })
      for (const field of contracts.ports.project_brief.fields) {
        const value = field.kind === 'id' ? 'project-id' : 'Shaotanhe Reservoir'
        const claimId = `source-${field.name}`
        proposal.outputs.project_brief.records[0][field.name] = { value: field.kind === 'texts' ? [value] : value,
          claimRefs: [claimId], claimClass: 'source_conclusion', limitations: [limitation] }
        proposal.claims.push({ claimId, selector: `/outputs/project_brief/records/0/${field.name}/value${field.kind === 'texts' ? '/0' : ''}`,
          kind: 'source', value, sourceId: field.kind === 'id' ? 'original-id' : 'original-name' })
      }
      proposal.outputs.project_brief.quality = 'accepted'
      proposal.outputs.project_brief.claimRefs = proposal.claims.map((claim: any) => claim.claimId)
      proposal.steps.forEach((step: any) => { step.claimRefs = [...proposal.outputs.project_brief.claimRefs] })
    }
    const prompt = input.prompt.map(part => part.type === 'text' ? part.text : '').join('\n')
    if (review) {
      candidateClaimIds = fixturePromptContext(prompt, 'candidateHash').candidate.claims.map((claim: any) => claim.claimId)
    }
    const rejected = mode === 'review-always-fail' || mode === 'review-once' && reviewCount === 1
    const provisionalReview = ['boundary-all-missing', 'boundary-provisional'].includes(mode)
    const reviewOutput = { ...(input.outputSchema.properties?.boundaryAuditHash ? {boundaryAuditHash:input.outputSchema.properties.boundaryAuditHash.const}:{}),
      ...(input.outputSchema.properties?.progressRestrictionsHash?{progressRestrictionsHash:input.outputSchema.properties.progressRestrictionsHash.const}:{}),
      ...(input.outputSchema.properties?.synthesisHash?{synthesisHash:input.outputSchema.properties.synthesisHash.const}:{}),
      ...(input.outputSchema.properties?.projectTaskAuditHash ? {projectTaskAuditHash:input.outputSchema.properties.projectTaskAuditHash.const}:{}),
      verdict: rejected ? 'fail' : mode==='planning-pass-review'||itemId === '1.02' && !provisionalReview ? 'pass' : 'limited',
      checks: (review ? fixturePromptContext(prompt, 'reviewCriteria').reviewCriteria as string[] : getResearchModuleSpec(itemId).qa).map((criterion, index) => ({ criterion, status: rejected && index === 0 ? 'fail' : criterion.startsWith('遵守整体回看 ')?'pass':mode==='planning-pass-review'||itemId === '1.02' && !provisionalReview ? 'pass' : 'limited',
        rationale: rejected && index === 0 ? '需要更明确排除同名异地项目。' : '仅支持原文记载，身份与权属仍待核验。', claimRefs: candidateClaimIds })), limitations: [limitation] }
    if (mode === 'review-missing-criteria') reviewOutput.checks = []
    if (mode === 'review-unknown-claim') reviewOutput.checks[0]!.claimRefs = ['claim-not-in-frozen-candidate']
    if (mode === 'boundary-scope-missing') reviewOutput.checks = reviewOutput.checks.filter(check => getResearchModuleSpec(itemId).qa.includes(check.criterion))
    let authorOutput: any = fixtureProjection(proposal)
    const groupId = input.outputSchema.properties?.groupId?.const
    if (!review && typeof groupId === 'string') {
      const { getModuleAuthorFieldGroups } = await import('../src/research-v2/module-author-groups.ts')
      const groups = getModuleAuthorFieldGroups(itemId), group = groups.find(g => g.groupId === groupId)!
      const outputs = JSON.parse(authorOutput.outputsJson), port = outputs[group.port]
      const { steps: authorSteps, ...authorBase } = authorOutput
      authorOutput = { ...authorBase, projectionVersion: 'module-author-field-group-json.v4', groupId,
        outputsJson: JSON.stringify({ [group.port]: { ...port, records: port.records.map((r: any) => ({ recordId: r.recordId, resultClass: r.resultClass,
          ...Object.fromEntries(group.fields.map(field => [field, r[field]])) })) } }),
        evidence: authorOutput.evidence.filter((e: any) => group.fields.includes(e.target.field)),
        stepResults: Object.fromEntries(authorSteps.map(({ step, ...entry }: any) => [`step${step}`, {
          ...entry, fieldRefs: entry.fieldRefs.filter((r: any) => group.fields.includes(r.field)),
        }])),
      }
      if (mode === 'group-step-string') { delete authorOutput.stepResults; authorOutput.steps = JSON.stringify(authorSteps).slice(0, -1) }
      if (mode === 'group-step-empty') { delete authorOutput.stepResults; authorOutput.steps = [] }
      if (mode === 'group-step-missing') delete authorOutput.stepResults.step3
      if (mode === 'group-legacy-v3') {
        delete authorOutput.stepResults; authorOutput.projectionVersion = 'module-author-field-group-json.v3'; authorOutput.steps = authorSteps
      }
      if (mode === 'group-fail-last' && group === groups.at(-1)) authorOutput.outputsJson = '{}'
      if (group === groups[0] && ['group-missing-reason', 'group-uncovered-alias', 'group-uncovered-cycle'].includes(mode)) {
        const invalid = JSON.parse(authorOutput.outputsJson), row = invalid[group.port].records[0]
        if (mode === 'group-missing-reason') row.administrativeCode.notApplicableReason = '历史原文未记载当前行政代码'
        else {
          row.aliases = { value: ['Shaotanhe Reservoir', 'Unsupported alias'], claimClass: 'source_conclusion', limitations: [limitation] }
          authorOutput.evidence.push({ target: { port: group.port, recordId: row.recordId, field: 'aliases', at: '/0' }, kind: 'source',
            source: { path: document.path, page: 2, quote: 'Shaotanhe Reservoir' } })
          if(mode==='group-uncovered-cycle'){
            row.aliases.claimClass='agent_inference'
            const entry=authorOutput.evidence.at(-1)
            entry.kind='inference';delete entry.source;entry.rationale='Synthetic self-reference, never accepted as independent evidence'
            entry.inputRefs=[{local:{...entry.target}}]
          }
        }
        authorOutput.outputsJson = JSON.stringify(invalid)
      }
      if (authorOutput.projectionVersion === 'module-author-field-group-json.v4') {
        const { outputsJson, ...native } = authorOutput
        authorOutput = { ...native, projectionVersion: input.outputSchema.properties!.projectionVersion.const, outputs: JSON.parse(outputsJson) }
      }
    }
    if (!review && mode === 'local-reference-once' && textCount === 1) {
      authorOutput.outputs.project_brief.records[0].formalName.claimClass='agent_inference'
      const evidence=authorOutput.evidence.find((e:any)=>e.target.field==='formalName')
      evidence.kind='inference';delete evidence.source;evidence.rationale='Synthetic failed inference for reference diagnostics only'
      evidence.inputRefs=[{local:{...evidence.target,field:'aliases',at:'/0'}}]
    }
    if (!review && mode === 'duplicate-evidence-once' && textCount === 1) authorOutput.evidence.push(structuredClone(authorOutput.evidence[0]))
    if (!review && mode === 'owner-evidence-once' && textCount === 1) authorOutput.evidence[0].target.recordId='synthetic-owner-typo'
    if (!review && mode === 'gateway-cross-kind-once' && textCount === 1) {
      authorOutput.evidence[0].kind='proposal'
      authorOutput.evidence[0].rationale='Synthetic invalid crossed evidence must be rejected by the original contract'
    }
    if (!review && mode === 'unit-once' && textCount === 1) authorOutput.evidence[0].unit = '元'
    if (!review && mode === 'prior-group-reference-once' && textCount === 2) {
      const row=authorOutput.outputs.project_brief.records[0],target={port:'project_brief',recordId:row.recordId,field:'principal',at:''}
      row.principal={value:'Synthetic rejected inference only',claimClass:'agent_inference',limitations:[limitation]}
      authorOutput.evidence.push({target,kind:'inference',rationale:'Synthetic conflicting evidence fixture',
        source:{path:document.path,page:2,quote:'Shaotanhe Reservoir'},inputRefs:[{local:{...target,field:'aliases',at:'/0'}}]})
      for(const step of Object.values(authorOutput.stepResults) as any[])step.fieldRefs.push(target)
    }
    if (!review && mode.startsWith('kind-evidence-oversized') && textCount === 1) {
      authorOutput.evidence[0].kind = 'proposal'
      authorOutput.evidence[0].rationale = 'Synthetic proposal; source member deliberately conflicts with the protocol.'
      authorOutput.limitations.push('uncompressible-kind-rejection-marker'.repeat(1600))
    }
    if (!review && mode === 'step-evidence-oversized-once' && textCount === 1) {
      authorOutput.evidence=[]
      authorOutput.limitations.push('uncompressible-step-rejection-marker'.repeat(1600))
    }
    if (!review && (mode.startsWith('availability-after-corrections') || mode === 'overload-after-corrections') && groupId === 'project_brief:1'
      && (textCount === 4 || mode.endsWith('-exhausted') && textCount >= 4)) {
      // The backup makes a new semantic error: an absent array is not an empty array.
      authorOutput.outputs.project_brief.records[0].aliases.value = []
    }
    let result: Promise<SubagentResult> = Promise.resolve({ stopReason: 'completed', output: [], structured: review ? reviewOutput : authorOutput })
    if (!review && mode.startsWith('availability-after-corrections') && textCount === 3) {
      events[1] = { type: 'turn/end', data: { reason: { kind: 'max-tokens' } } }
      result = Promise.resolve({ stopReason: 'max-tokens', output: [] })
    }
    if (!review && mode === 'overload-after-corrections' && textCount === 3) {
      events[1] = { type: 'turn/end', data: { reason: { kind: 'error', error: { code: 'PI_AI_ERROR',
        message: 'Codex error: Our servers are currently overloaded. Please try again later.' } } } }
      result = Promise.resolve({ stopReason: 'error', output: [] })
    }
    if (!review && mode === 'kind-evidence-oversized-empty-once' && textCount === 2) result = Promise.resolve({ stopReason: 'completed', output: [] })
    if (!review && mode === 'kind-evidence-oversized-wire-once' && textCount === 2) result = Promise.resolve({ stopReason: 'completed', output: [],
      structured: {wireVersion:'native-frozen-submission.v2',fullNativeSchemaHash:'f'.repeat(64),submissionJson:'{}',records:[{port:'project_brief',recordId:'project-row',recordJson:'{"broken":'}]} })
    if(!review&&mode==='source-quote-whitespace-empty-once'&&textCount===2)result=Promise.resolve({stopReason:'completed',output:[]})
    if (!review && mode === 'malformed-json-once' && textCount === 1) {
      if (groupId) authorOutput.outputs = JSON.stringify(authorOutput.outputs).slice(0, -1)
      else authorOutput.outputsJson = authorOutput.outputsJson.slice(0, -1)
    }
    if (!review && mode === 'availability-once' && textCount === 1) {
      events[1] = { type: 'turn/end', data: { reason: { kind: 'error', error: { code: 'TRANSPORT', message: 'provider unavailable' } } } }
      result = Promise.resolve({ stopReason: 'error', output: [] })
    }
    if (!review && (['legacy-projection', 'legacy-string-projection'].includes(mode)||input.outputSchema?.properties?.projectionVersion?.const==='module-author-projection.v1')) {
      const { outputsJson, ...rest } = authorOutput
      result = Promise.resolve({ stopReason: 'completed', output: [], structured: { ...rest, projectionVersion: 'module-author-projection.v1',
        outputs: mode === 'legacy-string-projection' ? outputsJson : JSON.parse(outputsJson) } })
    }
    if (!review && mode === 'duplicate-json') result = Promise.resolve({ stopReason: 'completed', output: [], structured: {
      ...authorOutput, outputsJson: authorOutput.outputsJson.replace('{', '{"project_brief":null,'),
    } })
    if (!review && mode === 'legacy-candidate') result = Promise.resolve({ stopReason: 'completed', output: [], structured: proposal })
    if (!review && mode === 'text-only') result = Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: JSON.stringify(proposal) }] })
    if (!review && mode === 'misnested-metadata') result = Promise.resolve({ stopReason: 'completed', output: [], structured: {
      outputs: { ...proposal.outputs, claims: proposal.claims, sourceValues: proposal.sourceValues }, steps: proposal.steps,
    } })
    if (mode === 'separate-deadlines') result = new Promise(resolve => setTimeout(() => {
      resolve({ stopReason: 'completed', output: [], structured: review ? reviewOutput : authorOutput })
    }, 110))
    if (mode === 'cancel' || mode === 'model-timeout' || mode === 'model-timeout-once' && !review && textCount === 1 || mode === 'cancel-review' && review) {
      result = new Promise(resolve => input.signal.addEventListener('abort', () => {
        events[1] = { type: 'turn/end', data: { reason: { kind: 'aborted' } } }
        resolve({ stopReason: 'aborted', output: [] })
      }, { once: true }))
      if (mode !== 'model-timeout' && mode !== 'model-timeout-once') queueMicrotask(() => controller.abort(new Error('user cancelled module')))
    }
    if (review && (mode === 'review-websocket-always' || mode === 'review-websocket-once' && reviewCount === 1)) {
      events[1] = { type: 'turn/end', data: { reason: { kind: 'error', error: { code: 'PI_AI_ERROR', message: 'WebSocket error' } } } }
      result = Promise.resolve({ stopReason: 'error', output: [] })
    }
    const rejectedNativeDraft = !review && (mode === 'native-schema-stop-once' && textCount === 1 || mode === 'business-then-native-schema' && textCount === 2)
      ? { ...authorOutput, evidence: authorOutput.evidence.map((row: any, index: number) => index ? row : { ...row, quote: 'invalid outer quote' }) } : undefined
    if (rejectedNativeDraft) result = Promise.resolve({ stopReason: 'error', output: [] })
    result = result.then(value => {
      nativeLogs.set(childId, [
        { seq: 1, time: nativeStartedAt, type: 'turn/start', data: { turn: 1 } },
        { seq: 2, type: 'request/header', data: { turn: 1, step: 1, header: { config: actual, tools: [{ name: 'structured_output', parameters: input.outputSchema }] } } },
        ...(value.structured === undefined && !rejectedNativeDraft ? [] : [
          { seq: 3, type: 'tool/call', data: { turn: 1, step: 1, name: 'structured_output', callId: childId, arguments: JSON.stringify(rejectedNativeDraft ?? value.structured) } },
          { seq: 4, type: 'tool/result', data: { turn: 1, step: 1, message: { content: [{ type: 'tool-result', toolCallId: childId, isError: Boolean(rejectedNativeDraft) }] } } },
        ]),
        { seq: 5, time: Date.now(), type: 'turn/end', data: { turn: 1, reason: rejectedNativeDraft ? { kind: 'completed' } : value.stopReason === 'error' ? (events[1].data as any).reason : { kind: value.stopReason } } },
      ])
      if (value.stopReason === 'aborted') children.set(childId, nativeLogs.get(childId)!)
      return value
    })
    return { id: childId as never, localAgent: undefined, result, dispose: async () => { disposed.push(childId) } }
  })
  return { root, request, parent, classes, start, disposed, nativeLogs, children,
    readNativeEvents: async (id: string) => nativeLogs.get(id), setMode: (next: Mode) => { mode = next },
    subagents: { start, getProvider: () => ({}) as never } }
}

describe('gateway union compatibility in real module execution',()=>{
 it.each(['success','gateway-cross-kind-once'] as const)('retains planning choices and validates the unchanged %s submission against the full original contract',async mode=>{
  const {createNativeModuleRuntime}=await api(false),f=await fixture(mode,undefined,'antigravity')
  let authorCalls=0
  const subagents={...f.subagents,start:async(provider:string,input:SubagentStartRequest)=>{
   if(input.outputSchema?.properties?.outputs){
    authorCalls++
    expect(input.outputSchema.properties.evidence.items!.properties!.kind.enum).toContain('proposal')
    expect(input.outputSchema.properties.evidence.items!.required).not.toContain('source')
    expect(input.prompt.some(part=>part.type==='text'&&part.text.includes('nativeGatewayOriginalSchema'))).toBe(true)
   }
   return f.subagents.start(provider,input)
  }}
  const run=await createNativeModuleRuntime({agentClasses:f.classes,subagents,readNativeEvents:f.readNativeEvents}).execute(f.parent,f.request)
  expect(authorCalls).toBeGreaterThan(0)
  expect(run.results,run.moduleRuns[0]?.error).toHaveLength(1)
  expect(run.results[0].execution!.reviewReceipts).toHaveLength(1)
  if(mode==='gateway-cross-kind-once'){
   const rejected:any=run.results[0].execution!.attempts!.find((attempt:any)=>attempt.classId==='text'&&attempt.status==='failed')
   expect(rejected.error).toContain('MODULE_NATIVE_SCHEMA_INVALID')
   expect(rejected.structuredOutput.evidence[0]).toMatchObject({kind:'proposal',source:{path:'原始资料/source.pdf'}})
  }
 })
})

describe('explicit whole-module author selection',()=>{
 it('declares canonical fields as native objects for selected whole-module authors and replays their reviewed result',async()=>{
  const {createNativeModuleRuntime}=await api(false),f=await fixture()
  const runtime=createNativeModuleRuntime({agentClasses:f.classes,subagents:f.subagents,readNativeEvents:f.readNativeEvents,
   wholeModuleAuthorIds:['1.01']})
  const run=await runtime.execute(f.parent,f.request)
  expect(run.results,run.moduleRuns[0]?.error).toHaveLength(1)
  const input=f.start.mock.calls.find(([,request])=>request.label?.startsWith('preplanning_module_text:'))![1]
  expect(input.outputSchema!.properties!.projectionVersion.const).toBe('module-author-projection.v1')
  expect(input.outputSchema!.properties!.outputsJson).toBeUndefined()
  expect(input.outputSchema!.properties!.wireVersion).toBeUndefined()
  const schema=input.outputSchema!,saved=run.results[0]!,raw=saved.execution!.authorProjection!.raw as any
  expect(validateJsonSchemaValue(schema,raw)).toEqual([])
  const unwrapped=structuredClone(raw);unwrapped.outputs.project_brief.records[0].formalName='Bare value'
  expect(validateJsonSchemaValue(schema,unwrapped).some(error=>error.includes('formalName'))).toBe(true)
  expect(saved.execution!.reviewReceipts).toHaveLength(1)
  expect(saved.execution!.reviewReceipts![0]!.childId).not.toBe(saved.execution!.childId)
  await expect(readModuleExecutionResult(f.root,run.moduleRuns[0]!.bundleRunId!)).resolves.toBeDefined()
 })
 it('keeps typed whole-module fields mandatory when context admission cannot fit the object contract',async()=>{
  const {createNativeModuleRuntime}=await api(false),f=await fixture(),originalGuard=ContextBudget.assertNativeModuleContext
  const guard=vi.spyOn(ContextBudget,'assertNativeModuleContext').mockImplementation((limits,prompt,schema,images)=>{
   const value=JSON.parse(schema)
   if(value.properties?.projectionVersion?.const==='module-author-projection.v1')throw new ContextBudget.NativeModuleContextBudgetError('Typed object does not fit')
   return originalGuard(limits,prompt,schema,images)
  })
  try{
   const runtime=createNativeModuleRuntime({agentClasses:f.classes,subagents:f.subagents,readNativeEvents:f.readNativeEvents,wholeModuleAuthorIds:['1.01']})
   const run=await runtime.execute(f.parent,f.request)
   expect(run.results).toEqual([])
   expect(f.start.mock.calls.every(([,input])=>!input.outputSchema?.properties?.wireVersion)).toBe(true)
   expect(run.moduleRuns[0]?.status).toBe('failed')
  }finally{guard.mockRestore()}
 })
 it('still blocks unsupported source content after whole-module corrections instead of sending it to the format backup',async()=>{
  const {createNativeModuleRuntime}=await api(false),f=await fixture('unsupported-source'),originalGuard=ContextBudget.assertNativeModuleContext
  const guard=vi.spyOn(ContextBudget,'assertNativeModuleContext').mockImplementation((limits,prompt,schema,images)=>{
   if(JSON.parse(schema).properties?.outputsJson)throw new ContextBudget.NativeModuleContextBudgetError('Synthetic whole-module wire branch')
   return originalGuard(limits,prompt,schema,images)
  })
  try{
   const runtime=createNativeModuleRuntime({agentClasses:f.classes,readNativeEvents:f.readNativeEvents,wholeModuleAuthorIds:['1.01'],authorProtocol:'json-v2',
    subagents:{...f.subagents,start:async(provider:string,input:SubagentStartRequest)=>{
     const version=input.outputSchema?.properties?.wireVersion?.const
     if(!version)return f.subagents.start(provider,input)
     const prompt=input.prompt.map(part=>part.type==='text'?part.text:'').join('\n')
     const full=expandNativeSchemaDescription(fixturePromptContext(prompt,'nativeSubmissionWire').nativeSubmissionWire.fullNativeSchema)
     const child=await f.subagents.start(provider,{...input,outputSchema:full}),result=await child.result
     const native={wireVersion:version,submissionJson:JSON.stringify(result.structured)},events=f.nativeLogs.get(String(child.id))! as any[]
     events.find(event=>event.type==='request/header').data.header.tools[0].parameters=input.outputSchema
     events.find(event=>event.type==='tool/call').data.arguments=JSON.stringify(native)
     events.splice(1,0,{type:'user/message',data:{content:[{type:'text',text:prompt}]}})
     events.forEach((event,index)=>{event.seq=index+1})
     return {...child,result:Promise.resolve({...result,structured:native})}
    }}})
   const run=await runtime.execute(f.parent,f.request)
   expect(run.results).toEqual([])
   expect(run.moduleRuns[0]?.error).toMatch(/MODULE_SOURCE_VALUE_(?:QUOTE|TEXT|LOCATION)/)
   expect(f.start).toHaveBeenCalledTimes(3)
   expect(f.start.mock.calls.every(([,input])=>input.agentOptions?.model===textRoute.model)).toBe(true)
  }finally{guard.mockRestore()}
 },30000)
 it('hands an owned whole-module pointer, missing-null and wire-format loop to the configured backup without repairing drafts',async()=>{
  const {createNativeModuleRuntime}=await api(false),f=await fixture(),before=structuredClone(f.classes.settings())
  const originalGuard=ContextBudget.assertNativeModuleContext
  const guard=vi.spyOn(ContextBudget,'assertNativeModuleContext').mockImplementation((limits,prompt,schema,images)=>{
   if(JSON.parse(schema).properties?.outputsJson)throw new ContextBudget.NativeModuleContextBudgetError('Synthetic whole-module wire branch')
   return originalGuard(limits,prompt,schema,images)
  })
  let primary=0
  try{
   const runtime=createNativeModuleRuntime({agentClasses:f.classes,readNativeEvents:f.readNativeEvents,wholeModuleAuthorIds:['1.01'],authorProtocol:'json-v2',
    subagents:{...f.subagents,start:async(provider:string,input:SubagentStartRequest)=>{
     const version=input.outputSchema?.properties?.wireVersion?.const
     if(!version)return f.subagents.start(provider,input)
     const prompt=input.prompt.map(part=>part.type==='text'?part.text:'').join('\n')
     const full=expandNativeSchemaDescription(fixturePromptContext(prompt,'nativeSubmissionWire').nativeSubmissionWire.fullNativeSchema)
     const child=await f.subagents.start(provider,{...input,outputSchema:full}),result=await child.result
     const decoded=structuredClone(result.structured) as any
     if(input.agentOptions?.model===textRoute.model){
      primary++
      if(primary===1)decoded.evidence[0].target.at='/absent-leaf'
      if(primary===2){const outputs=JSON.parse(decoded.outputsJson);outputs.project_brief.records[0].administrativeCode.value='unverified-not-null';decoded.outputsJson=JSON.stringify(outputs)}
      if(primary===3)decoded.evidence[1].kind='decision'
     }
     const native={wireVersion:version,submissionJson:JSON.stringify(decoded)},events=f.nativeLogs.get(String(child.id))! as any[]
     events.find(event=>event.type==='request/header').data.header.tools[0].parameters=input.outputSchema
     events.find(event=>event.type==='tool/call').data.arguments=JSON.stringify(native)
     events.splice(1,0,{type:'user/message',data:{content:[{type:'text',text:prompt}]}})
     events.forEach((event,index)=>{event.seq=index+1})
     return {...child,result:Promise.resolve({...result,structured:native})}
    }}})
   const run=await runtime.execute(f.parent,f.request)
   expect(run.results,run.moduleRuns[0]?.error).toHaveLength(1)
   const trace=run.results[0]!.execution!,attempts=(trace.attempts as any[]).filter(row=>row.classId==='text')
   expect(attempts.slice(0,3).map(row=>row.status)).toEqual(['failed','failed','failed'])
   expect(attempts[0].error).toMatch(/^MODULE_PROJECTION_POINTER:/)
   expect(attempts[1].error).toContain('MISSING_REQUIRES_JSON_NULL')
   expect(attempts[2].error).toMatch(/^MODULE_NATIVE_JSON_WIRE_INVALID:/)
   expect(attempts[3]).toMatchObject({status:'completed',actualModel:backup})
   const owner=f.classes.execution(attempts[3].executionId)!
   expect(owner.fallbackFromExecutionId).toBe(attempts[2].executionId)
   expect(trace.authorProjection?.raw).not.toEqual(attempts[1].structuredOutput)
   expect(trace.reviewReceipts).toHaveLength(1)
   await expect(readModuleExecutionResult(f.root,run.moduleRuns[0]!.bundleRunId!)).resolves.toBeDefined()
   expect(f.classes.settings()).toEqual(before)
  }finally{guard.mockRestore()}
 },30000)
 it('uses the existing complete JSON projection and fresh review only for an explicitly selected module',async()=>{
  const {createNativeModuleRuntime}=await api(false),f=await fixture()
  const runtime=createNativeModuleRuntime({agentClasses:f.classes,subagents:f.subagents,readNativeEvents:f.readNativeEvents,
   wholeModuleAuthorIds:['1.01']} as any)
  const result=await runtime.execute(f.parent,f.request)
  expect(result.moduleRuns[0]?.status).toBe('limited')
  const saved=await readModuleExecutionResult(f.root,result.moduleRuns[0]!.bundleRunId!)
  expect(saved.execution).toBeDefined()
  const execution=saved.execution!
  expect(execution.authorGroups).toBeUndefined()
  expect(execution.authorProjection?.version).toBe('module-author-projection.v1')
  expect(execution.reviewReceipts).toHaveLength(1)
  expect(execution.reviewReceipts?.[0]?.childId).not.toBe(execution.childId)
  expect(saved.outputs.project_brief).toBeDefined()
 })
 it('retains native field-group receipts for modules outside the explicit selection',async()=>{
  const {createNativeModuleRuntime}=await api(false),f=await fixture()
  const runtime=createNativeModuleRuntime({agentClasses:f.classes,subagents:f.subagents,readNativeEvents:f.readNativeEvents,
   wholeModuleAuthorIds:['6.01']} as any)
  const result=await runtime.execute(f.parent,f.request)
  const saved=await readModuleExecutionResult(f.root,result.moduleRuns[0]!.bundleRunId!)
  expect(saved.execution?.authorGroups?.groups.length).toBeGreaterThan(0)
  expect(saved.execution?.reviewReceipts).toHaveLength(1)
 })
 it('uses object-only grouped authors ahead of the whole-module selection and preserves strict readback',async()=>{
  const {createNativeModuleRuntime}=await api(false),f=await fixture(),requests:SubagentStartRequest[]=[]
  const before=f.classes.settings()
  const runtime=createNativeModuleRuntime({agentClasses:f.classes,readNativeEvents:f.readNativeEvents,
   wholeModuleAuthorIds:['1.01'],objectGroupAuthorIds:['1.01'],subagents:{...f.subagents,
    start:async(provider:string,input:SubagentStartRequest)=>{requests.push(input);return f.subagents.start(provider,input)}}} as any)
  const run=await runtime.execute(f.parent,f.request)
  expect(run.moduleRuns[0]?.status,run.moduleRuns[0]?.error).toBe('limited')
  const saved=await readModuleExecutionResult(f.root,run.moduleRuns[0]!.bundleRunId!)
  expect(saved.execution?.kind).toBe('author-field-groups-v3')
  expect(saved.execution?.authorGroups?.groups).toHaveLength(4)
  expect(saved.execution?.authorProjection).toBeUndefined()
  const authors=requests.filter(input=>input.label?.startsWith('preplanning_module_text:'))
  expect(authors).toHaveLength(4)
  for(const request of authors){
   expect(request.outputSchema?.properties?.outputs).toBeDefined()
   expect(request.outputSchema?.properties?.stepResults.required).toEqual(['step1','step2','step3','step4'])
   expect(request.outputSchema?.properties?.wireVersion).toBeUndefined()
   expect(request.outputSchema?.properties?.submissionJson).toBeUndefined()
  }
  expect(saved.execution?.reviewReceipts).toHaveLength(1)
  expect(f.classes.settings()).toEqual(before)
 })
 it('rejects object-only grouped capacity without dispatching a string envelope or changing saved prior groups',async()=>{
  const {createNativeModuleRuntime}=await api(false),f=await fixture(),originalAssert=SchemaValidation.assertObjectJsonSchema
  const descriptions=vi.spyOn(SchemaValidation,'assertObjectJsonSchema').mockImplementation(schema=>{
   const node=schema as ObjectJsonSchema
   if(node.properties?.stepResults&&node.properties?.outputs?.properties?.project_brief?.properties?.scope?.const)
    node.description='Synthetic typed group capacity annotation. '.repeat(1000)
   return originalAssert(schema)
  })
  const originalGuard=ContextBudget.assertNativeModuleContext
  const guard=vi.spyOn(ContextBudget,'assertNativeModuleContext').mockImplementation((limits,prompt,schema,images)=>{
   const node=JSON.parse(schema)
   if(node.properties?.stepResults&&node.properties?.outputs?.properties?.project_brief?.properties?.scope?.const)
    throw new ContextBudget.NativeModuleContextBudgetError('Synthetic object-only grouped capacity exceeded')
   return originalGuard(limits,prompt,schema,images)
  })
  const requests:SubagentStartRequest[]=[]
  try{
   const runtime=createNativeModuleRuntime({agentClasses:f.classes,readNativeEvents:f.readNativeEvents,
    objectGroupAuthorIds:['1.01'],subagents:{...f.subagents,
     start:async(provider:string,input:SubagentStartRequest)=>{requests.push(input);return f.subagents.start(provider,input)}}} as any)
   const run=await runtime.execute(f.parent,f.request)
   expect(requests.some(input=>input.outputSchema?.properties?.wireVersion)).toBe(false)
   expect(run.results).toEqual([])
   expect(run.moduleRuns[0]?.error).toContain('MODULE_MODEL_CONTEXT_BUDGET_EXCEEDED')
   const accepted=run.moduleRuns[0]!.executionAudit!.attempts!.filter((attempt:any)=>attempt.status==='completed') as any[]
   expect(accepted).toHaveLength(1)
   expect(accepted[0].structuredOutput.outputs.project_brief.records[0].formalName.value).toBe('Shaotanhe Reservoir')
   expect(accepted[0].structuredHash).toBe(sha256CanonicalJson(accepted[0].structuredOutput))
  }finally{guard.mockRestore();descriptions.mockRestore()}
 },30000)
})

describe('review-only reuse of validated research',()=>{
 it('explains the exact QA fold in a fresh correction request when all checks pass but the submitted total is limited',async()=>{
  const {createNativeModuleRuntime}=await api(false),f=await fixture('project-task-bound')
  let first=true
  const runtime=createNativeModuleRuntime({agentClasses:f.classes,readNativeEvents:f.readNativeEvents,subagents:{...f.subagents,
   start:async(provider:string,input:SubagentStartRequest)=>{
    if(input.label?.startsWith('preplanning_module_review:'))f.setMode('planning-pass-review')
    const child=await f.subagents.start(provider,input)
    if(first&&input.label?.startsWith('preplanning_module_review:')){
      first=false;const raw=await child.result,structured=structuredClone(raw.structured) as any
      expect(structured.checks.every((check:any)=>check.status==='pass')).toBe(true)
      structured.verdict='limited';structured.limitations=['Implementation still requires human confirmation.']
      f.nativeLogs.get(String(child.id))!.find(event=>event.type==='tool/call')!.data.arguments=JSON.stringify(structured)
      return {...child,result:Promise.resolve({...raw,structured})}
    }
    return child
   }}})
  const taskBrief=JSON.stringify({sessionId:'synthetic-request',seq:17,time:'2026-10-08T10:00:00.000Z',text:'Compare bounded planning options and deliver the complete report.'})
  const summary=await runtime.execute(f.parent,{...f.request,taskBrief})
  const calls=f.start.mock.calls.filter(([,input])=>input.label?.startsWith('preplanning_module_review:'))
  expect(calls).toHaveLength(2)
  expect((calls[1]![1].prompt as any[])[0].text).toContain('3 pass, 0 limited, 0 fail')
  expect((calls[1]![1].prompt as any[])[0].text).toContain('checks imply pass')
  expect(summary.moduleRuns[0].status).toBe('completed')
  const rejected=(summary.results[0].execution!.attempts as any[]).find(attempt=>attempt.classId==='review'&&attempt.status==='failed')
  expect(rejected.structuredOutput.verdict).toBe('limited')
  expect(rejected.structuredOutput.checks.every((check:any)=>check.status==='pass')).toBe(true)
 })
 it.each([true,false])('preserves the newest limited review when the next continuation also includes its older full checkpoint (explicit review %s)',async reviewOnly=>{
  const {createNativeModuleRuntime}=await api(false),f=await fixture('project-task-bound')
  const runtime=createNativeModuleRuntime({agentClasses:f.classes,readNativeEvents:f.readNativeEvents,subagents:{...f.subagents,
   start:async(provider:string,input:SubagentStartRequest)=>{
    const child=await f.subagents.start(provider,input)
    if(input.label?.startsWith('preplanning_module_review:')&&input.label.endsWith(':1.02')){
      const raw=await child.result,structured=structuredClone(raw.structured) as any
      structured.verdict='limited';structured.checks[0].status='limited';structured.checks[0].rationale='Synthetic boundary geometry remains unavailable for precision claims.'
      structured.limitations=['Boundary geometry precision remains limited.']
      f.nativeLogs.get(String(child.id))!.find(event=>event.type==='tool/call')!.data.arguments=JSON.stringify(structured)
      return {...child,result:Promise.resolve({...raw,structured})}
    }
    return child
   }}})
  const taskBrief=JSON.stringify({sessionId:'synthetic-request',seq:17,time:'2026-10-08T10:00:00.000Z',text:'Compare bounded planning options and deliver the complete report.'})
  const original=await runtime.execute(f.parent,{...f.request,moduleIds:['1.02'],taskBrief})
  expect(original.moduleRuns.map((row:any)=>row.status)).toEqual(['limited','limited'])
  f.setMode('planning-pass-review')
  const freshRoot=await runtime.execute(f.parent,{...f.request,taskBrief,reviewOnly:true,resumeRunIds:[original.manifestRunId]})
  const dependent=await runtime.execute(f.parent,{...f.request,moduleIds:[reviewOnly?'1.02':'1.03'],taskBrief,reviewOnly,
   resumeRunIds:[freshRoot.manifestRunId,original.manifestRunId]})
  expect(dependent.moduleRuns.slice(0,2).map((row:any)=>row.status)).toEqual(['completed','limited'])
  const old=original.results.find((row:any)=>row.itemId==='1.02')!,updated=dependent.results.find((row:any)=>row.itemId==='1.02')!
  expect(updated.reviewOnlyReuse?.sourceResultHash).toBe(sha256CanonicalJson(old))
  expect(updated.execution!.authorGroups).toEqual(old.execution!.authorGroups)
  const before=f.start.mock.calls.length
  const continued=await runtime.execute(f.parent,{...f.request,moduleIds:['1.03'],taskBrief,
   resumeRunIds:[dependent.manifestRunId,original.manifestRunId]})
  expect(continued.moduleRuns.slice(0,2).map((row:any)=>row.status)).toEqual(['completed','limited'])
  const latest=continued.results.find((row:any)=>row.itemId==='1.02')!
  if(sha256CanonicalJson(latest)!==sha256CanonicalJson(updated))expect(latest.reviewOnlyReuse?.sourceResultHash).toBe(sha256CanonicalJson(updated))
  expect(latest.execution!.authorGroups).toEqual(updated.execution!.authorGroups)
  expect(f.start.mock.calls.slice(before).filter(([,input])=>input.label?.endsWith(':1.02')).every(([,input])=>input.label?.startsWith('preplanning_module_review:'))).toBe(true)
  const {readModuleExecutionSummary}=await import('../src/research-v2/module-execution.ts')
  await expect(readModuleExecutionSummary(f.root,continued.manifestRunId)).resolves.toMatchObject(continued)
 }, 15_000) // Four native executions and full immutable replay take 5-7s on Linux; preserve every assertion.
 it('keeps a newer rejected review checkpoint when its exact prior limited draft is supplied again',async()=>{
  const {createNativeModuleRuntime}=await api(false),f=await fixture('project-task-bound')
  let reject=false
  const runtime=createNativeModuleRuntime({agentClasses:f.classes,readNativeEvents:f.readNativeEvents,subagents:{...f.subagents,
   start:async(provider:string,input:SubagentStartRequest)=>{
    const child=await f.subagents.start(provider,input)
    if(input.label?.startsWith('preplanning_module_review:')&&input.label.endsWith(':1.02')){
      const raw=await child.result,structured=structuredClone(raw.structured) as any
      structured.verdict=reject?'fail':'limited';structured.checks[0].status=structured.verdict
      structured.checks[0].rationale='Synthetic precision QA remains unresolved.';structured.limitations=['Precision QA remains unresolved.']
      f.nativeLogs.get(String(child.id))!.find(event=>event.type==='tool/call')!.data.arguments=JSON.stringify(structured)
      return {...child,result:Promise.resolve({...raw,structured})}
    }
    return child
   }}})
  const taskBrief=JSON.stringify({sessionId:'synthetic-request',seq:17,time:'2026-10-08T10:00:00.000Z',text:'Compare bounded planning options and deliver the complete report.'})
  const original=await runtime.execute(f.parent,{...f.request,moduleIds:['1.02'],taskBrief})
  f.setMode('planning-pass-review')
  const freshRoot=await runtime.execute(f.parent,{...f.request,taskBrief,reviewOnly:true,resumeRunIds:[original.manifestRunId]})
  reject=true
  const rejected=await runtime.execute(f.parent,{...f.request,moduleIds:['1.02'],taskBrief,reviewOnly:true,
   resumeRunIds:[freshRoot.manifestRunId,original.manifestRunId]})
  expect(rejected.moduleRuns.map((row:any)=>row.status)).toEqual(['completed','failed'])
  const before=f.start.mock.calls.length
  const retried=await runtime.execute(f.parent,{...f.request,moduleIds:['1.02','1.03'],taskBrief,reviewOnly:true,
   resumeRunIds:[rejected.manifestRunId,original.manifestRunId]})
  expect(retried.moduleRuns.map((row:any)=>row.status)).toEqual(['completed','failed','blocked'])
  expect(f.start.mock.calls.slice(before).every(([,input])=>input.label?.startsWith('preplanning_module_review:'))).toBe(true)
  expect(retried.moduleRuns[1].priorModuleReview).toEqual(rejected.moduleRuns[1].priorModuleReview)
  const {readModuleExecutionSummary}=await import('../src/research-v2/module-execution.ts')
  await expect(readModuleExecutionSummary(f.root,retried.manifestRunId)).resolves.toMatchObject(retried)
 })
 it('reauthors a professionally rejected candidate during normal continuation even when only upstream review receipts changed',async()=>{
  const {createNativeModuleRuntime}=await api(false),f=await fixture('project-task-bound')
  let reject=false
  const runtime=createNativeModuleRuntime({agentClasses:f.classes,readNativeEvents:f.readNativeEvents,subagents:{...f.subagents,
   start:async(provider:string,input:SubagentStartRequest)=>{
    const child=await f.subagents.start(provider,input)
    if(input.label?.startsWith('preplanning_module_review:')&&input.label.endsWith(':1.02')){
      const raw=await child.result,structured=structuredClone(raw.structured) as any
      structured.verdict=reject?'fail':'limited';structured.checks[0].status=structured.verdict
      structured.checks[0].rationale='Synthetic professional finding: the candidate lacks the required object-level evidence.'
      structured.limitations=['The actual research requires revision, not another review of the unchanged candidate.']
      f.nativeLogs.get(String(child.id))!.find(event=>event.type==='tool/call')!.data.arguments=JSON.stringify(structured)
      return {...child,result:Promise.resolve({...raw,structured})}
    }
    return child
   }}})
  const taskBrief=JSON.stringify({sessionId:'synthetic-request',seq:17,time:'2026-10-08T10:00:00.000Z',text:'Compare bounded planning options and deliver the complete report.'})
  const original=await runtime.execute(f.parent,{...f.request,moduleIds:['1.02'],taskBrief})
  const old=original.results.find((row:any)=>row.itemId==='1.02')!
  f.setMode('planning-pass-review')
  const freshRoot=await runtime.execute(f.parent,{...f.request,taskBrief,reviewOnly:true,resumeRunIds:[original.manifestRunId]})
  reject=true
  const rejected=await runtime.execute(f.parent,{...f.request,moduleIds:['1.02'],taskBrief,reviewOnly:true,
   resumeRunIds:[freshRoot.manifestRunId,original.manifestRunId]})
  expect(rejected.moduleRuns.map((row:any)=>row.status)).toEqual(['completed','failed'])
  expect(rejected.moduleRuns[1].error).toContain('MODULE_REVIEW_FAILED')
  const before=f.start.mock.calls.length
  const next=await runtime.execute(f.parent,{...f.request,moduleIds:['1.03'],taskBrief,
   resumeRunIds:[rejected.manifestRunId,original.moduleRuns.find((row:any)=>row.itemId==='1.02')!.bundleRunId]})
  const authors=f.start.mock.calls.slice(before).filter(([,input])=>input.label?.startsWith('preplanning_module_text:')&&input.label.includes(':1.02:'))
  expect(authors.length,'a professional rejection must reach fresh field research before the next independent review').toBeGreaterThan(0)
  const prompt=authors[0][1].prompt.map((part:any)=>part.type==='text'?part.text:'').join('\n')
  const feedback=JSON.parse(prompt.split('\n').find((line:string)=>line.startsWith('{"previousRejection":'))!).previousRejection
  expect(feedback.moduleError).toBe(rejected.moduleRuns[1].error)
  expect(feedback.reviewIssues.join('\n')).toContain('object-level evidence')
  // The fixture deliberately returns the same professional failure: fresh
  // authors do not turn missing evidence into acceptance.
  expect(next.moduleRuns.map((row:any)=>row.status)).toEqual(['completed','failed','blocked'])
  expect(await readModuleExecutionResult(f.root,original.moduleRuns.find((row:any)=>row.itemId==='1.02')!.bundleRunId)).toEqual(old)
  const {readModuleExecutionSummary}=await import('../src/research-v2/module-execution.ts')
  await expect(readModuleExecutionSummary(f.root,rejected.manifestRunId)).resolves.toMatchObject(rejected)
  await expect(readModuleExecutionSummary(f.root,next.manifestRunId)).resolves.toMatchObject(next)
 // Four native executions plus immutable replay take over five seconds even in isolation.
 },15_000)
 it('withdraws an old accepted candidate after fresh QA fails and blocks cached dependent results',async()=>{
  const {createNativeModuleRuntime}=await api(false),f=await fixture('project-task-bound')
  const taskBrief=JSON.stringify({sessionId:'synthetic-request',seq:17,time:'2026-10-08T10:00:00.000Z',text:'Compare bounded planning options and deliver the complete report.'})
  const runtime=createNativeModuleRuntime({subagents:f.subagents,agentClasses:f.classes,readNativeEvents:f.readNativeEvents})
  const original=await runtime.execute(f.parent,{...f.request,moduleIds:['1.02'],taskBrief})
  f.setMode('planning-pass-review')
  const freshRoot=await runtime.execute(f.parent,{...f.request,taskBrief,reviewOnly:true,resumeRunIds:[original.manifestRunId]})
  const before=f.start.mock.calls.length
  const rejecting=createNativeModuleRuntime({agentClasses:f.classes,readNativeEvents:f.readNativeEvents,subagents:{...f.subagents,
   start:async(provider:string,input:SubagentStartRequest)=>{
    const child=await f.subagents.start(provider,input)
    if(input.label?.startsWith('preplanning_module_review:')&&input.label.endsWith(':1.01')){
      const raw=await child.result,structured=structuredClone(raw.structured) as any
      structured.verdict='fail';structured.checks[0].status='fail';structured.checks[0].rationale='Synthetic fresh QA rejects the current candidate.'
      f.nativeLogs.get(String(child.id))!.find(event=>event.type==='tool/call')!.data.arguments=JSON.stringify(structured)
      return {...child,result:Promise.resolve({...raw,structured})}
    }
    return child
   }}})
  const next=await rejecting.execute(f.parent,{...f.request,moduleIds:['1.01','1.02'],taskBrief,reviewOnly:true,
   resumeRunIds:[freshRoot.manifestRunId,original.manifestRunId]})
  expect(next.moduleRuns.map((row:any)=>row.status)).toEqual(['failed','blocked'])
  expect(next.results).toEqual([])
  expect(f.start.mock.calls.slice(before).some(([,input])=>input.label?.endsWith(':1.02'))).toBe(false)
  const {readModuleExecutionSummary}=await import('../src/research-v2/module-execution.ts')
  await expect(readModuleExecutionSummary(f.root,next.manifestRunId)).resolves.toMatchObject(next)
 })
 it.each([true,false])('retains a new upstream review while reviewing unchanged dependent research from the previous full checkpoint (explicit review %s)',async reviewOnly=>{
  const {createNativeModuleRuntime}=await api(false),f=await fixture('project-task-bound')
  const runtime=createNativeModuleRuntime({subagents:f.subagents,agentClasses:f.classes,readNativeEvents:f.readNativeEvents})
  const taskBrief=JSON.stringify({sessionId:'synthetic-request',seq:17,time:'2026-10-08T10:00:00.000Z',text:'Compare bounded planning options and deliver the complete report.'})
  const original:ModuleExecutionSummary=await runtime.execute(f.parent,{...f.request,moduleIds:['1.02'],taskBrief})
  expect(original.moduleRuns.find(row=>row.itemId==='1.02')?.status).toBe('completed')
  f.setMode('planning-pass-review')
  const freshRoot:ModuleExecutionSummary=await runtime.execute(f.parent,{...f.request,taskBrief,reviewOnly:true,resumeRunIds:[original.manifestRunId]})
  expect(freshRoot.moduleRuns[0].status).toBe('completed')
  const before=f.start.mock.calls.length
  const dependent:ModuleExecutionSummary=await runtime.execute(f.parent,{...f.request,moduleIds:['1.02'],taskBrief,reviewOnly,
   resumeRunIds:[freshRoot.manifestRunId,original.manifestRunId]})
  expect(dependent.moduleRuns.map(row=>row.status)).toEqual(['completed','completed'])
  expect(f.start.mock.calls.slice(before)).toHaveLength(1)
  expect(f.start.mock.calls[before][1].label).toMatch(/^preplanning_module_review:/)
  const old=original.results.find(row=>row.itemId==='1.02')!,next=dependent.results.find(row=>row.itemId==='1.02')!
  expect(next.outputs).toEqual(old.outputs);expect(next.claims).toEqual(old.claims)
  expect(next.execution!.authorGroups).toEqual(old.execution!.authorGroups)
  expect(next.inputRefs[0].bundleRunId).toBe(freshRoot.moduleRuns[0].bundleRunId)
  expect(next.reviewOnlyReuse).toMatchObject({sourceBundleRunId:original.moduleRuns.find(row=>row.itemId==='1.02')!.bundleRunId,
   sourceResultHash:sha256CanonicalJson(old),candidateHash:sha256CanonicalJson(old.reviewedCandidate)})
  const {readModuleExecutionSummary}=await import('../src/research-v2/module-execution.ts')
  expect((await readModuleExecutionSummary(f.root,dependent.manifestRunId)).moduleRuns).toEqual(dependent.moduleRuns)
  expect(await readModuleExecutionResult(f.root,original.moduleRuns.find(row=>row.itemId==='1.02')!.bundleRunId!)).toEqual(old)
  const folder=join(f.root,'research/runs',dependent.moduleRuns.find(row=>row.itemId==='1.02')!.bundleRunId!)
  const stored=JSON.parse(await readFile(join(folder,'result.json'),'utf8'))
  stored.reviewOnlyReuse.candidateHash='0'.repeat(64)
  const content=JSON.stringify(stored),manifest=JSON.parse(await readFile(join(folder,'manifest.json'),'utf8'))
  const entry=manifest.files.find((file:any)=>file.path==='result.json')
  entry.sha256=createHash('sha256').update(content).digest('hex');entry.sizeBytes=Buffer.byteLength(content)
  const {manifestHash:_old,...core}=manifest;manifest.manifestHash=sha256CanonicalJson(core)
  await writeFile(join(folder,'result.json'),content);await writeFile(join(folder,'manifest.json'),JSON.stringify(manifest))
  await expect(readModuleExecutionResult(f.root,dependent.moduleRuns.find(row=>row.itemId==='1.02')!.bundleRunId!)).rejects.toThrow('MODULE_REVIEW_REUSE_INVALID')
 })
 it('rejects independently rewritten upstream research instead of treating equal output values as a review-only change',async()=>{
  const {createNativeModuleRuntime}=await api(false),f=await fixture('project-task-bound')
  const runtime=createNativeModuleRuntime({subagents:f.subagents,agentClasses:f.classes,readNativeEvents:f.readNativeEvents})
  const taskBrief=JSON.stringify({sessionId:'synthetic-request',seq:17,time:'2026-10-08T10:00:00.000Z',text:'Compare bounded planning options and deliver the complete report.'})
  const original=await runtime.execute(f.parent,{...f.request,moduleIds:['1.02'],taskBrief})
  const rewritten=await runtime.execute(f.parent,{...f.request,taskBrief})
  expect(rewritten.results[0].outputs).toEqual(original.results[0].outputs)
  const before=f.start.mock.calls.length
  await expect(runtime.execute(f.parent,{...f.request,moduleIds:['1.02'],taskBrief,reviewOnly:true,
   resumeRunIds:[rewritten.manifestRunId,original.manifestRunId]})).rejects.toThrow('MODULE_RESUME_AMBIGUOUS')
  expect(f.start.mock.calls).toHaveLength(before)
 })
 it.each(['success','planning-pass-review'] as const)('uses only a new independent review and preserves source fields for %s',async mode=>{
  const {createNativeModuleRuntime}=await api(false),f=await fixture('project-task-bound')
  const runtime=createNativeModuleRuntime({subagents:f.subagents,agentClasses:f.classes,readNativeEvents:f.readNativeEvents})
  const input={...f.request,taskBrief:JSON.stringify({sessionId:'synthetic-request',seq:17,time:'2026-10-08T10:00:00.000Z',text:'Deliver the complete software test report.'})}
  const first=await runtime.execute(f.parent,input),old=first.results[0],before=f.start.mock.calls.length
  expect(first.moduleRuns[0].status).toBe('limited')
  f.setMode(mode)
  const revised=await runtime.execute(f.parent,{...input,reviewOnly:true,resumeRunIds:[first.manifestRunId]})
  expect(revised.moduleRuns[0].error).toBeUndefined()
  expect(f.start.mock.calls.slice(before)).toHaveLength(1)
  expect(f.start.mock.calls[before][1].label).toMatch(/^preplanning_module_review:/)
  expect((f.start.mock.calls[before][1].prompt as any[])[0].text).toContain('仅剩人工确认实施条件时可pass')
  expect(revised.moduleRuns[0].status).toBe(mode==='planning-pass-review'?'completed':'limited')
  expect(revised.results[0].outputs).toEqual(old.outputs)
  expect(revised.results[0].execution!.authorGroups).toEqual(old.execution!.authorGroups)
  expect(revised.results[0].execution!.reviewReceipts).toHaveLength(1)
  expect(revised.results[0].execution!.reviewReceipts[0].candidateHash).toBe(old.execution!.reviewReceipts[0].candidateHash)
  expect(revised.results[0].execution!.reviewReceipts[0].childId).not.toBe(old.execution!.reviewReceipts[0].childId)
  expect(await readModuleExecutionResult(f.root,first.moduleRuns[0].bundleRunId!)).toEqual(old)
 })
 it('refuses review-only without an existing validated candidate before making a model request',async()=>{
  const {createNativeModuleRuntime}=await api(false),f=await fixture()
  const run=await createNativeModuleRuntime({subagents:f.subagents,agentClasses:f.classes}).execute(f.parent,{...f.request,reviewOnly:true})
  expect(run.moduleRuns[0].error).toContain('MODULE_REVIEW_CANDIDATE_REQUIRED')
  expect(f.start).not.toHaveBeenCalled()
 })
 it('verifies original native records outside the recent 100-row UI page',async()=>{
  const {createNativeModuleRuntime}=await api(false),f=await fixture()
  const runtime=createNativeModuleRuntime({subagents:f.subagents,agentClasses:f.classes,readNativeEvents:f.readNativeEvents})
  const first=await runtime.execute(f.parent,f.request)
  for(let i=0;i<101;i++){
    const record=await f.classes.begin('project','text','Synthetic later record '+i,f.parent as never)
    await f.classes.finish(record.id,'failed','Synthetic terminal record; no model run')
  }
  const sourceId=first.results[0].execution!.authorGroups!.groups[0].receipt.executionId
  expect((await f.classes.executions('project')).some(row=>row.id===sourceId)).toBe(false)
  const before=f.start.mock.calls.length
  const revised=await runtime.execute(f.parent,{...f.request,reviewOnly:true,resumeRunIds:[first.manifestRunId]})
  expect(revised.moduleRuns[0].status).toBe('limited')
  expect(f.start.mock.calls.slice(before)).toHaveLength(1)
  expect(revised.results[0].execution!.authorGroups).toEqual(first.results[0].execution!.authorGroups)
 })
 it('preserves a fresh failed verdict without replacing the old limited result',async()=>{
  const {createNativeModuleRuntime}=await api(false),f=await fixture()
  const runtime=createNativeModuleRuntime({subagents:f.subagents,agentClasses:f.classes,readNativeEvents:f.readNativeEvents})
  const first=await runtime.execute(f.parent,f.request),before=f.start.mock.calls.length
  f.setMode('review-always-fail')
  const revised=await runtime.execute(f.parent,{...f.request,reviewOnly:true,resumeRunIds:[first.manifestRunId]})
  expect(f.start.mock.calls.slice(before)).toHaveLength(1)
  expect(revised.moduleRuns[0].error).toContain('MODULE_REVIEW_FAILED')
  expect(revised.results).toEqual([])
  expect(await readModuleExecutionResult(f.root,first.moduleRuns[0].bundleRunId!)).toEqual(first.results[0])
 })
 it('rejects altered native source request evidence before paying for another review',async()=>{
  const {createNativeModuleRuntime}=await api(false),f=await fixture()
  const runtime=createNativeModuleRuntime({subagents:f.subagents,agentClasses:f.classes,readNativeEvents:f.readNativeEvents})
  const first=await runtime.execute(f.parent,f.request),before=f.start.mock.calls.length
  const id=first.results[0].execution!.authorGroups!.groups[0].receipt.childId
  const header=f.nativeLogs.get(id)!.find(event=>event.type==='request/header')!
  header.data.header.config={provider:'unrelated',model:'unrelated'}
  const revised=await runtime.execute(f.parent,{...f.request,reviewOnly:true,resumeRunIds:[first.manifestRunId]})
  expect(revised.moduleRuns[0].status).toBe('failed')
  expect(revised.moduleRuns[0].error).toContain('MODULE_GROUP_RECOVERY_INVALID: native route')
  expect(f.start.mock.calls).toHaveLength(before)
 })
 it('refuses a changed task snapshot even when ordinary input reuse was requested',async()=>{
  const {createNativeModuleRuntime}=await api(false),f=await fixture()
  const runtime=createNativeModuleRuntime({subagents:f.subagents,agentClasses:f.classes,readNativeEvents:f.readNativeEvents})
  const first=await runtime.execute(f.parent,f.request),before=f.start.mock.calls.length
  const revised=await runtime.execute(f.parent,{...f.request,snapshotId:'changed-task-snapshot',taskBrief:'A changed research request.',
   allowInputReuse:true,reviewOnly:true,resumeRunIds:[first.manifestRunId]})
  expect(revised.moduleRuns[0].status).toBe('failed')
  expect(revised.moduleRuns[0].error).toMatch(/INPUT|IDENTITY|SNAPSHOT/)
  expect(f.start.mock.calls).toHaveLength(before)
 })
})

describe('native model capacity and complete mandatory sources', () => {
  it('carries a scoped overall hold into actual native author, synthesis and independent QA requests without freezing background research',async()=>{
    const {createNativeModuleRuntime}=await api(false),f=await fixture('project-task-bound')
    const taskBrief=JSON.stringify({sessionId:'synthetic-request',seq:17,time:'2026-10-08T10:00:00.000Z',text:'Compare bounded planning options; do not assert verified rights.'})
    const runtime=createNativeModuleRuntime({synthesizeGroups:true,progressReview:true,agentClasses:f.classes,readNativeEvents:f.readNativeEvents,
      subagents:{...f.subagents,start:async(provider:string,input:SubagentStartRequest)=>{
        const child=await f.subagents.start(provider,input)
        if(input.outputSchema?.properties?.requestHash){
          const original=await child.result,raw=original.structured as any
          const structured={...raw,verdict:'pause',conditions:raw.conditions.map((c:any,i:number)=>i?c:{...c,permission:'hold',
            scope:{kind:'conclusions',allowedUses:['Compare background and conditional planning options'],heldUses:['Verified rights or implementation authorization'],reviewAfterModules:3}})}
          const call=f.nativeLogs.get(String(child.id))!.find(e=>e.type==='tool/call')!;call.data.arguments=JSON.stringify(structured)
          return {...child,result:Promise.resolve({...original,structured})}
        }
        return child
      }}})
    const first=await runtime.execute(f.parent,{...f.request,taskBrief})
    const next=await runtime.execute(f.parent,{...f.request,moduleIds:['1.02'],taskBrief,resumeRunIds:[first.manifestRunId]})
    const result=next.results.find((row:any)=>row.itemId==='1.02')
    expect(result,JSON.stringify(next.moduleRuns)).toBeTruthy()
    const audit=result.execution.researchRestrictions
    expect(audit.conditions[0].scope.heldUses).toContain('Verified rights or implementation authorization')
    expect(result.execution.reviewReceipts.at(-1).progressRestrictionsHash).toBe(audit.hash)
    const boundedCalls=f.start.mock.calls.map(([,input])=>input).filter(input=>input.prompt.some(part=>part.type==='text'&&part.text.includes('"researchRestrictions":')))
    expect(boundedCalls.some(input=>input.label?.includes('text:project:1.02'))).toBe(true)
    expect(boundedCalls.some(input=>input.outputSchema?.properties?.version?.const==='module-research-synthesis.v4')).toBe(true)
    expect(boundedCalls.some(input=>input.outputSchema?.properties?.progressRestrictionsHash?.const===audit.hash)).toBe(true)
    const restrictionReviews=boundedCalls.filter(input=>input.outputSchema?.properties?.progressRestrictionsHash?.const===audit.hash)
    expect(restrictionReviews.every(input=>input.prompt.some(part=>part.type==='text'&&part.text.includes('模块总体limited不自动决定追加限制QA')))).toBe(true)
    for(const input of restrictionReviews){
      const prompt=input.prompt.map(part=>part.type==='text'?part.text:'').join('\n')
      const criteria=fixturePromptContext(prompt,'reviewCriteria').reviewCriteria
      expect((input.outputSchema!.properties!.checks as any).items.properties.criterion.enum).toEqual(criteria)
      const sample={verdict:'pass',checks:criteria.map((criterion:string)=>({criterion,status:'pass',rationale:'Synthetic permitted-use QA',claimRefs:[]})),limitations:[],
        ...Object.fromEntries(Object.entries(input.outputSchema!.properties!).filter(([key])=>key.endsWith('Hash')).map(([key,schema])=>[key,schema.const]))}
      expect(validateJsonSchemaValue(input.outputSchema!,sample)).toEqual([])
      sample.checks[0].criterion='Additional full project qualification is incomplete'
      expect(validateJsonSchemaValue(input.outputSchema!,sample).length).toBeGreaterThan(0)
    }
    const {controlledResearchReady}=await import('../src/research-v2/module-progress-review.ts')
    expect(next.researchProgress.reviews.at(-1).decision.verdict).toBe('pause')
    expect(controlledResearchReady(next)).toBe(true)
    await expect((await import('../src/research-v2/module-execution.ts')).readModuleExecutionSummary(f.root,next.manifestRunId)).resolves.toMatchObject(next)
  })
  it.each([
    {name:'retains evidence-limited research with a verified held-use boundary',mode:'limited',status:'limited'},
    {name:'rejects a failed held-use boundary despite permitted background research',mode:'fail',status:'failed'},
    {name:'records a limited held-use boundary review without asking the reviewer to change its judgment',mode:'held-limited',status:'failed'},
    {name:'rejects an omitted held-use boundary check',mode:'missing',status:'failed'},
  ] as const)('$name',async({mode,status})=>{
    const {createNativeModuleRuntime}=await api(false),f=await fixture('project-task-bound')
    const taskBrief=JSON.stringify({sessionId:'synthetic-request',seq:17,time:'2026-10-08T10:00:00.000Z',text:'Compare conditional planning options; verified rights remain unknown.'})
    const runtime=createNativeModuleRuntime({synthesizeGroups:true,progressReview:true,agentClasses:f.classes,readNativeEvents:f.readNativeEvents,
      subagents:{...f.subagents,start:async(provider:string,input:SubagentStartRequest)=>{
        const child=await f.subagents.start(provider,input),original=await child.result
        let structured=original.structured as any
        if(input.outputSchema?.properties?.requestHash){
          structured={...structured,verdict:'pause',conditions:structured.conditions.map((c:any,i:number)=>i?c:{...c,permission:'hold',
            scope:{kind:'conclusions',allowedUses:['Compare conditional planning options'],heldUses:['Verified rights or implementation authorization'],reviewAfterModules:3}})}
        }else if(input.outputSchema?.properties?.progressRestrictionsHash){
          const checks=structured.checks.map((c:any)=>({...c})),restricted=checks.flatMap((c:any,i:number)=>c.criterion.startsWith('遵守整体回看 ')?[i]:[])
          checks[restricted[0]].status='limited'
          checks[restricted[0]].rationale='No actual trial or channel sample; use only the conditional validation plan.'
          if(mode==='fail')checks[restricted.at(-1)!].status='fail'
          if(mode==='held-limited')checks[restricted.at(-1)!].status='limited'
          if(mode==='missing')checks.splice(restricted.at(-1)!,1)
          structured={...structured,verdict:mode==='fail'?'fail':'limited',checks,
            limitations:['Actual trial and channel evidence remain missing; verified rights and implementation remain held.']}
        }else return child
        const call=f.nativeLogs.get(String(child.id))!.find(e=>e.type==='tool/call')!;call.data.arguments=JSON.stringify(structured)
        return {...child,result:Promise.resolve({...original,structured})}
      }}})
    const first=await runtime.execute(f.parent,{...f.request,taskBrief})
    const next:ModuleExecutionSummary=await runtime.execute(f.parent,{...f.request,moduleIds:['1.02'],taskBrief,resumeRunIds:[first.manifestRunId]})
    const entry=next.moduleRuns.find(row=>row.itemId==='1.02')!
    expect(entry.status,entry.error).toBe(status)
    if(mode==='limited'){
      const result=next.results.find(row=>row.itemId==='1.02')!,review=result.execution!.reviewReceipts!.at(-1)!
      expect(review.verdict).toBe('limited')
      expect(review.checks.filter(c=>c.criterion.startsWith('遵守整体回看 ')).map(c=>c.status)).toEqual(['limited','pass'])
      expect(result.execution!.researchRestrictions!.conditions[0].scope.heldUses).toContain('Verified rights or implementation authorization')
      await expect(readModuleExecutionResult(f.root,entry.bundleRunId!)).resolves.toEqual(result)
      const {controlledResearchReady}=await import('../src/research-v2/module-progress-review.ts')
      expect(controlledResearchReady(next)).toBe(true)
    }else{
      expect(entry.bundleRunId).toBeUndefined()
      expect(next.results.some(row=>row.itemId==='1.02')).toBe(false)
      expect(entry.error).toContain(mode==='fail'?'MODULE_REVIEW_FAILED':mode==='held-limited'?'MODULE_RESTRICTION_REVIEW_UNVERIFIED':'MODULE_REVIEW_CRITERIA_INCOMPLETE')
      if(mode==='fail'||mode==='held-limited'){
        expect(entry.executionAudit!.reviewReceipts).toHaveLength(1)
        expect((entry.executionAudit!.reviewReceipts[0] as any).verdict).toBe(mode==='fail'?'fail':'limited')
        const reviews=(entry.executionAudit!.attempts as any[]).filter(attempt=>attempt.classId==='review')
        expect(reviews).toHaveLength(1)
        expect(reviews[0].status).toBe('completed')
      }
    }
  })
  it('delivers the previous independent rejection to the fresh synthesis author while leaving the next reviewer unprimed',async()=>{
    const {createNativeModuleRuntime}=await api(false),f=await fixture('project-task-bound')
    const issue='Original review: distinguish missing proof from confirmed absent rights and keep external payments as costs.'
    let reject=true
    const runtime=createNativeModuleRuntime({synthesizeGroups:true,agentClasses:f.classes,readNativeEvents:f.readNativeEvents,subagents:{...f.subagents,start:async(provider:string,input:SubagentStartRequest)=>{
      const child=await f.subagents.start(provider,input)
      if(reject&&input.label?.startsWith('preplanning_module_review:')){
        const original=await child.result,structured=structuredClone(original.structured) as any
        structured.verdict='fail';structured.checks[0]={...structured.checks[0],status:'fail',rationale:issue};structured.limitations=[issue]
        f.nativeLogs.get(String(child.id))!.find(event=>event.type==='tool/call')!.data.arguments=JSON.stringify(structured)
        return {...child,result:Promise.resolve({...original,structured})}
      }
      return child
    }}})
    const taskBrief=JSON.stringify({sessionId:'synthetic-request',seq:17,time:'2026-10-08T10:00:00.000Z',text:'Deliver the complete software test report.'})
    const first=await runtime.execute(f.parent,{...f.request,taskBrief})
    expect(first.moduleRuns[0].error).toContain('MODULE_REVIEW_FAILED')
    const before=f.start.mock.calls.length;reject=false
    const next=await runtime.execute(f.parent,{...f.request,taskBrief,resumeRunIds:[first.manifestRunId]})
    expect(next.moduleRuns[0].status,JSON.stringify(next.moduleRuns)).toBe('limited')
    const fresh=f.start.mock.calls.slice(before).map(([,input])=>input)
    const synthesis=fresh.find(input=>input.outputSchema?.properties?.version?.const==='module-research-synthesis.v4')!
    expect((synthesis.prompt as any[])[0].text).toContain(issue)
    const review=fresh.find(input=>input.label?.startsWith('preplanning_module_review:'))!
    expect((review.prompt as any[])[0].text).not.toContain('previousRejection')
  })
  it('reuses the verified complete field prefix after synthesis rejection, with fresh synthesis and independent QA',async()=>{
    const {createNativeModuleRuntime}=await api(false),f=await fixture('project-task-bound')
    const taskBrief=JSON.stringify({sessionId:'synthetic-request',seq:17,time:'2026-10-08T10:00:00.000Z',text:'Deliver the complete software test report.'})
    let invalid=true
    const runtime=createNativeModuleRuntime({synthesizeGroups:true,agentClasses:f.classes,readNativeEvents:f.readNativeEvents,subagents:{...f.subagents,start:async(provider:string,input:SubagentStartRequest)=>{
      const child=await f.subagents.start(provider,input)
      if(invalid&&input.outputSchema?.properties?.version?.const==='module-research-synthesis.v4'){
        const original=await child.result,structured={...(original.structured as any),handoff:[{...(original.structured as any).handoff[0],moduleId:'preplan.research.99.99'}]}
        const call=f.nativeLogs.get(String(child.id))!.find(e=>e.type==='tool/call')!;call.data.arguments=JSON.stringify(structured)
        return {...child,result:Promise.resolve({...original,structured})}
      }
      return child
    }}})
    const input={...f.request,taskBrief},first=await runtime.execute(f.parent,input)
    expect(first.moduleRuns[0].status).toBe('failed')
    const originals=(first.moduleRuns[0].executionAudit!.attempts as any[]).filter(a=>a.classId==='text'&&a.status==='completed')
    expect(originals).toHaveLength(4)
    invalid=false
    const next=await runtime.execute(f.parent,{...input,resumeRunIds:[first.manifestRunId]})
    expect(next.moduleRuns[0].status,JSON.stringify(next.moduleRuns)).toBe('limited')
    expect(f.start.mock.calls.filter(([,call])=>call.outputSchema?.properties?.groupId)).toHaveLength(4)
    expect(next.results[0].execution!.authorGroups!.groups.map((g:{receipt:{childId:string}})=>g.receipt.childId)).toEqual(originals.map(a=>a.childId))
    expect(next.results[0].execution!.synthesis!.execution.childId).not.toBe(originals[0].childId)
  })
  it('runs a real isolated synthesis then independent module and overall review, with replayable conditional permission',async()=>{
    const {createNativeModuleRuntime}=await api(false),f=await fixture('project-task-bound')
    const taskBrief=JSON.stringify({sessionId:'synthetic-request',seq:17,time:'2026-10-08T10:00:00.000Z',text:'Deliver the complete software test report.'})
    const run=await createNativeModuleRuntime({subagents:f.subagents,agentClasses:f.classes,readNativeEvents:f.readNativeEvents,synthesizeGroups:true,progressReview:true}).execute(f.parent,{...f.request,taskBrief})
    expect(run.moduleRuns[0].status,JSON.stringify(run.moduleRuns)).toBe('limited')
    const result=await readModuleExecutionResult(f.root,run.moduleRuns[0].bundleRunId!)
    expect(result.execution!.synthesis!.judgment.conclusion).toContain('bounded')
    const synthesisCall=f.start.mock.calls.find(([,input])=>input.outputSchema?.properties?.version?.const==='module-research-synthesis.v4')![1]
    const synthesisPrompt=synthesisCall.prompt.filter(block=>block.type==='text').map(block=>block.text).join('\n')
    const synthesisView=JSON.parse(synthesisPrompt.split('\n').at(-1)!)
    expect(synthesisView.encoding).toBe('research-reference.v1')
    const synthesisContext=expandModuleReferencePromptView(synthesisView) as any
    const originalSynthesis=synthesisContext.researchSynthesis
    expect(synthesisContext.spec).toEqual(getResearchModuleSpec('1.01'))
    expect(synthesisContext.sources.corpus.documents[0].contentHash).toBe(f.request.corpus.documents[0].contentHash)
    expect(originalSynthesis.candidate).toEqual(result.reviewedCandidate)
    expect(originalSynthesis.candidateHash).toBe(sha256CanonicalJson(result.reviewedCandidate))
    expect(originalSynthesis.taskBrief).toBe(taskBrief)
    expect(moduleSynthesisSteps(result.execution!.synthesis!.judgment)[2]).toMatchObject({status:'limited',claimRefs:[]})
    const calls=f.start.mock.calls.map(([,input])=>input.label)
    expect(calls.at(-3)).toContain('module-synthesis')
    expect(calls.at(-2)).toBe('preplanning_module_review:'+f.request.projectId+':1.01')
    expect(calls.at(-1)).toContain('progress-review')
    expect(run.researchProgress!.reviews[0].execution.childId).not.toBe(result.execution!.reviewReceipts!.at(-1)!.childId)
    const {controlledResearchReady}=await import('../src/research-v2/module-progress-review.ts')
    expect(controlledResearchReady(run)).toBe(true)
    await expect((await import('../src/research-v2/module-execution.ts')).readModuleExecutionSummary(f.root,run.manifestRunId)).resolves.toMatchObject(run)
  })
  it('recovers an unchanged material prefix from the original scoped native request while requiring fresh synthesis and review',async()=>{
    const {createNativeModuleRuntime}=await api(false),f=await fixture('project-task-bound')
    const taskBrief=JSON.stringify({sessionId:'synthetic-request',seq:17,time:'2026-10-08T10:00:00.000Z',text:'Compare conditional planning options.'})
    const runtime=createNativeModuleRuntime({synthesizeGroups:true,agentClasses:f.classes,readNativeEvents:f.readNativeEvents,
      subagents:{...f.subagents,start:async(provider:string,input:SubagentStartRequest)=>{
        const child=await f.subagents.start(provider,input)
        if(input.outputSchema?.properties?.version?.const==='module-research-synthesis.v4'){
          const original=await child.result,structured={...(original.structured as any),limitationBasisHash:'invalid'}
          f.nativeLogs.get(String(child.id))!.find(e=>e.type==='tool/call')!.data.arguments=JSON.stringify(structured)
          return {...child,result:Promise.resolve({...original,structured})}
        }
        return child
      }}})
    const failed=await runtime.execute(f.parent,{...f.request,taskBrief})
    expect(failed.moduleRuns[0].status).toBe('failed')
    const audit=structuredClone(failed.moduleRuns[0].executionAudit!) as any
    const sources={corpus:f.request.corpus,upstream:[],sourceValues:[],inputRefs:[]}
    const core={version:'module-research-restrictions.v1',reviewHash:'original-overall-review',conditions:[{itemId:'1.02',criterion:'Boundary incomplete',
      scope:{kind:'conclusions',allowedUses:['Background comparison'],heldUses:['Approved implementation'],reviewAfterModules:3}}]}
    const original={...core,hash:sha256CanonicalJson(core)},updatedCore={...core,reviewHash:'new-overall-review',conditions:[{...core.conditions[0],
      scope:{...core.conditions[0].scope,allowedUses:['Background and conditional comparison']}}]}
    const current={...updatedCore,hash:sha256CanonicalJson(updatedCore)}
    for(const a of audit.attempts.filter((a:any)=>a.status==='completed'&&a.groupId!=='module-synthesis')){
      a.sourceContextFingerprint=sha256CanonicalJson({sources,restrictions:original.conditions})
      f.nativeLogs.get(a.childId)!.unshift({seq:0,type:'user/message',data:{content:[{type:'text',text:JSON.stringify({researchRestrictions:original})}]}})
    }
    const before=sha256CanonicalJson(audit),context:any={...f.request,taskBrief,module:loadPlanningCatalog().modules.find(m=>m.id==='1.01'),
      upstream:[],sourceValues:[],inputRefs:[],researchRestrictions:current,resumeExecutionAudit:audit,resumeExecutionError:failed.moduleRuns[0].error}
    const recover=()=>recoverModuleAuthorGroups(context,f.parent as never,f.classes,f.readNativeEvents,sha256CanonicalJson(sources),sources)
    const recovered=await recover()
    expect(recovered.submissions).toHaveLength(4)
    expect(recovered.submissions.map(g=>g.receipt.childId)).toEqual(audit.attempts.filter((a:any)=>a.status==='completed').map((a:any)=>a.childId))
    expect(sha256CanonicalJson(audit)).toBe(before)
    expect(recovered.attempts.some((a:any)=>a.groupId==='module-synthesis'&&a.status==='completed')).toBe(false)
    const changedSources={...sources,upstream:[{claimId:'Changed premise'}]}
    expect((await recoverModuleAuthorGroups(context,f.parent as never,f.classes,f.readNativeEvents,sha256CanonicalJson(changedSources),changedSources)).submissions).toHaveLength(0)
    const foreignAudit=structuredClone(audit)
    for(const a of foreignAudit.attempts.filter((a:any)=>a.status==='completed'))a.sourceContextFingerprint=sha256CanonicalJson({sources,restrictions:current.conditions})
    expect((await recoverModuleAuthorGroups({...context,resumeExecutionAudit:foreignAudit},f.parent as never,f.classes,f.readNativeEvents,sha256CanonicalJson(sources),sources)).submissions).toHaveLength(0)
    const firstChild=recovered.submissions[0].receipt.childId,originalPrompt=f.nativeLogs.get(firstChild)![0].data
    f.nativeLogs.get(firstChild)![0].data={content:[{type:'text',text:JSON.stringify({researchRestrictions:{...original,hash:'forged'}})}]}
    expect((await recover()).submissions).toHaveLength(0)
    f.nativeLogs.get(firstChild)![0].data=originalPrompt
    for(const a of audit.attempts.filter((a:any)=>a.status==='completed'))f.nativeLogs.set(a.childId,f.nativeLogs.get(a.childId)!.filter(e=>e.type!=='user/message'))
    expect((await recover()).submissions).toHaveLength(0)
  })
  it('hands the complete current task to M01 through the real module entry before independent review',async()=>{
    const {createNativeModuleRuntime}=await api(false),f=await fixture('project-task-bound')
    const taskBrief=JSON.stringify({sessionId:'synthetic-request',seq:17,time:'2026-10-08T10:00:00.000Z',text:'Deliver the complete software test report.'})
    const run=await createNativeModuleRuntime({subagents:f.subagents,agentClasses:f.classes}).execute(f.parent,{...f.request,taskBrief})
    const stored=await readModuleExecutionResult(f.root,run.moduleRuns[0].bundleRunId!)
    const handoff=stored.execution!.projectTaskAudit!.taskConfiguration!
    expect(handoff).toMatchObject({receiver:'M01',projectId:stored.projectId,snapshotId:stored.snapshotId,planHash:stored.planHash,
      taskFieldsHash:sha256CanonicalJson(stored.reviewedCandidate!.outputs.project_brief),qualificationGranted:false})
    const reviewPrompt=f.start.mock.calls.map(([,input])=>input.prompt.map(part=>part.type==='text'?part.text:'').join('\n'))
      .find(prompt=>prompt.includes('"taskConfiguration"'))!
    expect(reviewPrompt).toContain('"receiver":"M01"')
    expect(stored.execution!.reviewReceipts!.at(-1)!.projectTaskAuditHash).toBe(sha256CanonicalJson(stored.execution!.projectTaskAudit))
    expect(stored.outputs.project_brief).toEqual(stored.reviewedCandidate!.outputs.project_brief)
  })
  it('sends the exact native task-reference parse failure to a fresh author before independent review',async()=>{
    const {createNativeModuleRuntime}=await api(false),f=await fixture('project-task-reference-invalid-once')
    const taskBrief=JSON.stringify({sessionId:'synthetic-request',seq:17,time:'2026-10-08T10:00:00.000Z',text:'Deliver the complete software test report.'})
    const run=await createNativeModuleRuntime({subagents:f.subagents,agentClasses:f.classes}).execute(f.parent,{...f.request,taskBrief})
    expect(run.moduleRuns[0].status).toBe('limited')
    const stored=await readModuleExecutionResult(f.root,run.moduleRuns[0].bundleRunId!)
    const failed=(stored.execution!.attempts as any[]).filter(row=>row.status==='failed')
    expect(failed).toHaveLength(1);expect(failed[0].error).toContain('MODULE_PROJECT_TASK_STATEMENT_INVALID')
    const prompt=f.start.mock.calls.map(([,input])=>input.prompt.map(part=>part.type==='text'?part.text:'').join('\n'))
      .find(prompt=>prompt.includes('"invalidMember"'))!
    expect(prompt).toBeDefined()
    const diagnostic=JSON.parse(prompt.split('\n').find(line=>line.startsWith('{"projectTaskBindingDiagnostic":'))!).projectTaskBindingDiagnostic
    expect(diagnostic).toMatchObject({acceptanceGranted:false,originalSubmissionHash:failed[0].structuredHash,
      conflicts:[{target:{field:'commissionScope'},invalidMember:'rationale.task_statement_refs'}]})
    expect(stored.execution!.reviewReceipts!.at(-1)!.childId).not.toBe(failed[0].childId)
  })
  it('corrects a missing task binding from the native rejected target before starting the independent reviewer',async()=>{
    const {createNativeModuleRuntime}=await api(false),f=await fixture('project-task-binding-missing-once')
    const taskBrief=JSON.stringify({sessionId:'synthetic-request',seq:17,time:'2026-10-08T10:00:00.000Z',text:'Deliver the complete software test report.'})
    const run=await createNativeModuleRuntime({subagents:f.subagents,agentClasses:f.classes}).execute(f.parent,{...f.request,taskBrief})
    expect(run.moduleRuns[0].status).toBe('limited')
    const stored=await readModuleExecutionResult(f.root,run.moduleRuns[0].bundleRunId!)
    const attempts=stored.execution!.attempts as any[]
    const failed=attempts.filter(a=>a.status==='failed')
    expect(failed).toHaveLength(1)
    expect(failed[0]).toMatchObject({groupId:'project_brief:3',error:expect.stringMatching(/MODULE_PROJECT_TASK_STATEMENT_REQUIRED: commissionScope/)})
    const correction=f.start.mock.calls.map(([,input])=>input.prompt.map(part=>part.type==='text'?part.text:'').join('\n'))
      .find(prompt=>prompt.includes('"projectTaskBindingDiagnostic"'))!
    expect(correction).toBeDefined()
    const diagnostic=JSON.parse(correction.split('\n').find(line=>line.startsWith('{"projectTaskBindingDiagnostic":'))!).projectTaskBindingDiagnostic
    expect(diagnostic).toMatchObject({acceptanceGranted:false,originalSubmissionHash:failed[0].structuredHash,
      conflicts:[{target:{field:'commissionScope'},missingMember:'rationale.task_statement_refs'}]})
    const sourceDiagnostic=JSON.parse(correction.split('\n').find(line=>line.startsWith('{"correctionContext":'))!).correctionContext.diagnosticExcerpt
    expect(sourceDiagnostic,'a missing task marker must not hide the same draft attaching a task quote to a material that does not contain it')
      .toMatchObject({originalSubmissionHash:failed[0].structuredHash,fieldTextConflicts:[{
        target:{field:'originalStatement'},diagnosticCode:'MODULE_SOURCE_VALUE_QUOTE',
      }]})
    expect(f.start.mock.calls.some(([,input])=>input.label?.startsWith('preplanning_module_review:'))).toBe(true)
    expect(stored.execution!.reviewReceipts!.at(-1)!.childId).not.toBe(failed[0].childId)
  })
  it('separates exact frozen user messages from program paraphrases in author context',async()=>{
    const {createNativeModuleRuntime}=await api(false),f=await fixture('project-task-bound')
    const statement={sessionId:'synthetic-request',seq:17,time:'2026-10-08T10:00:00.000Z',text:'The research object is the supplied lake. Deliver the complete test report.'}
    const taskBrief='Program paraphrase: the research object remains the lake; this line has no message identity.\n'+JSON.stringify(statement)
    const run=await createNativeModuleRuntime({subagents:f.subagents,agentClasses:f.classes}).execute(f.parent,{...f.request,taskBrief})
    expect(run.moduleRuns[0].status).toBe('limited')
    const authors=f.start.mock.calls.filter(([,input])=>!input.label?.includes('review'))
    expect(authors.length).toBeGreaterThan(0)
    for(const [,input] of authors){
      const prompt=input.prompt.map(part=>part.type==='text'?part.text:'').join('\n')
      const context=JSON.parse(prompt.split('\n').find(line=>line.startsWith('{"task":'))!).taskContext
      expect(context.projectTaskStatements).toEqual([statement])
      expect(context.taskBrief).toBe(taskBrief)
    }
  })
  it('refuses to erase frozen user requests solely because a formal commission is missing',async()=>{
    const {createNativeModuleRuntime}=await api(false),f=await fixture('success')
    const taskBrief=JSON.stringify({sessionId:'synthetic-request',seq:17,time:'2026-10-08T10:00:00.000Z',text:'Deliver the complete software test report.'})
    const run=await createNativeModuleRuntime({subagents:f.subagents,agentClasses:f.classes}).execute(f.parent,{...f.request,taskBrief})
    expect(run.moduleRuns[0]).toMatchObject({status:'failed',error:expect.stringMatching(/MODULE_PROJECT_TASK_REQUEST_UNREAD/)})
    expect(f.start.mock.calls.some(([,input])=>input.label?.includes(':review:'))).toBe(false)
  })
  it('executes and binds task identity probes before a separate review and replays both receipts',async()=>{
    const {createNativeModuleRuntime}=await api(false),f=await fixture('project-task-bound')
    const taskBrief=JSON.stringify({sessionId:'synthetic-request',seq:17,time:'2026-10-08T10:00:00.000Z',text:'Deliver the complete software test report.'})
    const before=sha256CanonicalJson(f.request.corpus)
    const run=await createNativeModuleRuntime({subagents:f.subagents,agentClasses:f.classes}).execute(f.parent,{...f.request,taskBrief})
    expect(run.moduleRuns[0].status).toBe('limited')
    const result=await readModuleExecutionResult(f.root,run.moduleRuns[0].bundleRunId!)
    expect(result.execution!.projectTaskAudit).toMatchObject({taskRequestLocated:true,identityProbe:{sameNameDifferentLocationRejected:true,incompleteIdentityRejected:true}})
    expect(result.execution!.reviewReceipts!.at(-1)!.projectTaskAuditHash).toBe(sha256CanonicalJson(result.execution!.projectTaskAudit))
    expect(sha256CanonicalJson(f.request.corpus)).toBe(before)
  })
  it('delivers approved output, dataset and artifact specifications to each native author group', async () => {
    const { createNativeModuleRuntime } = await api(false), f = await fixture('success')
    await createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes }).execute(f.parent, f.request)
    const prompt = f.start.mock.calls[0][1].prompt.map((part: any) => part.type === 'text' ? part.text : '').join('\n')
    const task = JSON.parse(prompt.split('\n').find((line: string) => line.startsWith('{"task":'))!).task
    const spec = getResearchModuleSpec('1.01')
    expect(task.approvedOutput).toEqual(spec.approvedOutput)
    expect(task).not.toHaveProperty('figures')
    expect(task.table).toEqual(spec.table)
    expect(task.dataset).toEqual(spec.dataset)
  })
  const large = { context: { contextWindow: 872000 }, defaultMaxTokens: 128000 }
  const secondary = { context: { contextWindow: 1048576 }, defaultMaxTokens: 65536 }
  it.each([false, true])('uses the actual serialized source bytes on a known narrow route without discarding complete ASCII pages; legacy protocol=%s', async legacy => {
    const { createNativeModuleRuntime } = await api(legacy)
    const narrow = { context: { contextWindow: 320000 }, defaultMaxTokens: 128000 }
    const f = await fixture('success', { text: narrow, review: narrow, backup: narrow })
    const documents = f.request.corpus.documents.map(document => ({ ...document, pages: document.pages!.map(page => page.page === 1
      ? { ...page, text: JSON.stringify({ record: 'original', details: 'a'.repeat(30000) }) } : page) }))
    const body = { ...f.request.corpus, documents }, corpus = { ...body, fingerprint: materialCorpusFingerprint(body) }
    const before = sha256CanonicalJson(corpus)
    const run = await createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes }).execute(f.parent, { ...f.request, corpus })
    expect(run.moduleRuns[0].status).toBe('limited')
    const first = f.start.mock.calls[0][1], prompt = first.prompt.map(block => block.type === 'text' ? block.text : '').join('\n')
    const reference = fixturePromptContext(prompt, 'sources')
    const sources = expandModuleReferencePromptView(reference.sources) as any
    expect(sources.corpus.documents[0].pages[0].text).toBe(documents[0].pages![0].text)
    expect(sources.corpus.selection.maxMaterialChars).toBe(48000)
    expect(Buffer.byteLength(JSON.stringify(sources.corpus), 'utf8')).toBeLessThanOrEqual(sources.corpus.selection.maxMaterialUtf8Bytes)
    expect(first.agentOptions?.maxTokens).toBeUndefined()
    expect(sha256CanonicalJson(corpus)).toBe(before)
  })
  it('refuses to dispatch when the complete current-module native search log cannot fit, rather than silently dropping its calls', async () => {
    const { createNativeModuleRuntime } = await api(false), f = await fixture('success', { text: large, review: large, backup: secondary })
    const text = JSON.stringify({ version: 'native-search-log.v1', queryKey: '1.01:0', executionId: 'synthetic-web-execution',
      childId: 'synthetic-web-child', retrievedAt: '2026-10-06T00:00:00Z', toolCallBudget: 9,
      calls: [{ tool: 'web_search', query: 'query-only', result: '检索原始记录。'.repeat(30000) }], boundary: '搜索不证明事实或通过。' })
    const log = { path: 'research/search-log.json', text, contentHash: createHash('sha256').update(text).digest('hex'), byteLength: Buffer.byteLength(text),
      provenance: { sourceUri: 'workspace:native-web-query/synthetic-query', retrievedAt: '2026-10-06T00:00:00Z', rawHash: createHash('sha256').update(text).digest('hex'), claimClass: 'source_conclusion' as const, queryKeys: ['1.01:0'] } }
    const body = { ...f.request.corpus, documents: [...f.request.corpus.documents, log], fingerprint: undefined }
    const corpus = { ...body, fingerprint: materialCorpusFingerprint(body) }
    const run = await createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes }).execute(f.parent, { ...f.request, corpus })
    expect(run.moduleRuns[0].status).toBe('failed')
    expect(run.moduleRuns[0].error).toContain('MODULE_PROMPT_BUDGET_EXCEEDED')
    expect(f.start).not.toHaveBeenCalled()
  })
  function withLargeOriginal(f: Awaited<ReturnType<typeof fixture>>) {
    const original = f.request.corpus
    const documents = original.documents.map(d => ({ ...d, pages: d.pages!.map(p => p.page === 1
      ? { ...p, text: '完整必保留历史原文和研究限制。'.repeat(4000) } : p) }))
    const body = { ...original, documents, fingerprint: undefined }
    return { ...body, fingerprint: materialCorpusFingerprint(body) }
  }
  it.each([false, true])('keeps unrelated module web paths out of the native declaration while retaining the complete frozen corpus; legacy protocol=%s', async legacy => {
    const { createNativeModuleRuntime } = await api(legacy)
    const f = await fixture('success', { text: large, review: large, backup: secondary })
    const documents = [...f.request.corpus.documents, ...Array.from({ length: 80 }, (_, index) => {
      const text = `Unrelated module original ${index}`
      const contentHash = createHash('sha256').update(text).digest('hex')
      return { path: `research/runs/RUN-11111111-1111-4111-8111-111111111111/sources/${contentHash}.json`,
        text, contentHash, byteLength: Buffer.byteLength(text), provenance: {
          sourceUri: `workspace:native-web-query/unrelated-${index}`, retrievedAt: '2026-10-07T09:00:00.000Z',
          rawHash: contentHash, claimClass: 'source_conclusion' as const, queryKeys: ['3.02:0'],
        } }
    })]
    const body = { ...f.request.corpus, documents }, corpus = { ...body, fingerprint: materialCorpusFingerprint(body) }
    const provided=documents[f.request.corpus.documents.length],sourceValues=[{
      sourceId:'source-'+provided.contentHash,path:provided.path,contentHash:provided.contentHash,quote:provided.text!,rawValue:provided.text!,
    }]
    const before = sha256CanonicalJson(corpus), foreignPaths = new Set(documents.slice(f.request.corpus.documents.length+1).map(d => d.path))
    const run = await createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes }).execute(f.parent, { ...f.request, corpus,sourceValues })
    expect(run.moduleRuns[0].status).toBe('limited')
    let authorDeclarations = 0
    for (const [, input] of f.start.mock.calls) {
      if (!input.label?.startsWith('preplanning_module_text:')) continue
      authorDeclarations++
      const paths: string[] = []
      const visit = (value: any) => {
        if (!value || typeof value !== 'object') return
        if (value.properties?.path?.enum) paths.push(...value.properties.path.enum)
        Object.values(value).forEach(part => { if (Array.isArray(part)) part.forEach(visit); else visit(part) })
      }
      visit(input.outputSchema)
      expect(paths.length).toBeGreaterThan(0)
      expect(paths.some(path => foreignPaths.has(path))).toBe(false)
      expect(paths).toContain(provided.path)
      expect(f.request.corpus.documents.every(document => paths.includes(document.path))).toBe(true)
    }
    expect(authorDeclarations).toBeGreaterThan(0)
    expect(sha256CanonicalJson(corpus)).toBe(before)
    expect(corpus.documents).toHaveLength(f.request.corpus.documents.length + 80)
  })
  it.each([false, true])('dispatches complete sources beyond 48000 characters with known native capacity; legacy protocol=%s', async legacy => {
    const { createNativeModuleRuntime } = await api(legacy)
    const f = await fixture('success', { text: large, review: large, backup: secondary })
    const corpus = withLargeOriginal(f), before = sha256CanonicalJson(corpus)
    const run = await createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes }).execute(f.parent, { ...f.request, corpus })
    expect(run.moduleRuns[0].status).toBe('limited')
    const { expandModuleReferencePromptView } = await import('../src/research-v2/module-reference-context.ts')
    for (const [, input] of f.start.mock.calls) {
      const prompt = input.prompt.filter(block => block.type === 'text').map(block => block.text).join('\n')
      const reference = fixturePromptContext(prompt, 'sources')
      const sources = reference.sources.encoding ? expandModuleReferencePromptView(reference.sources) : reference.sources
      expect(sources.corpus.documents[0].pages[0].text).toBe(corpus.documents[0].pages![0].text)
      expect(sources.corpus.documents[0].pages[1]).toMatchObject({ page: 2, text: 'Shaotanhe Reservoir project-id' })
      expect(sources.corpus.selection.maxMaterialChars).toBeGreaterThan(48000)
      expect(input.agentOptions?.maxTokens).toBeUndefined()
    }
    expect(f.start.mock.calls.some(([, input]) => input.label?.startsWith('preplanning_module_review:'))).toBe(true)
    expect(sha256CanonicalJson(corpus)).toBe(before)
  })
  it.each(['review', 'backup', 'unknown-backup'])('stops before paying for an author when the authorized %s cannot fit mandatory sources', async restricted => {
    const { createNativeModuleRuntime } = await api(false)
    const capacities = { text: large, review: large, backup: secondary } as Record<string, typeof large | typeof secondary | {}>
    capacities[restricted === 'unknown-backup' ? 'backup' : restricted] = restricted === 'unknown-backup' ? {} : { context: { contextWindow: 96000 }, defaultMaxTokens: 65536 }
    const f = await fixture('success', capacities), corpus = withLargeOriginal(f)
    const run = await createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes }).execute(f.parent, { ...f.request, corpus })
    expect(run.moduleRuns[0].status).toBe('failed')
    expect(run.moduleRuns[0].error).toMatch(/MODULE_PROMPT_BUDGET_EXCEEDED|MODULE_MODEL_CONTEXT_BUDGET_EXCEEDED/)
    expect(f.start).not.toHaveBeenCalled()
  })
  it.each(['review', 'backup'] as const)('rechecks the selected %s capacity before its first paid request and does not retry an unchanged oversized prompt', async restricted => {
    const { createNativeModuleRuntime } = await api(false)
    const f = await fixture(restricted === 'backup' ? 'availability-once' : 'success', { text: large, review: large, backup: secondary })
    const resolveLimits = f.classes.modelLimits.bind(f.classes)
    vi.spyOn(f.classes, 'modelLimits').mockImplementation(route => route.model === restricted && f.start.mock.calls.length > 0
      ? Promise.resolve({ contextWindow: 10000, outputTokenLimit: 9000 }) : resolveLimits(route))
    const run = await createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes }).execute(f.parent, f.request)
    expect(run.moduleRuns[0].status).toBe('failed')
    expect(run.moduleRuns[0].error).toContain('MODULE_MODEL_CONTEXT_BUDGET_EXCEEDED')
    expect(f.start.mock.calls.every(([, input]) => input.agentOptions?.model === 'text')).toBe(true)
    expect(run.moduleRuns[0].executionAudit!.attempts.filter((a: any) => !a.childId)).toHaveLength(1)
  })
  it('preserves the exact accepted native prefix when newly available model metadata still fits its original source context', async () => {
    const { createNativeModuleRuntime } = await api(false)
    const capacities = { text: {}, review: {}, backup: {} } as Record<string, typeof large | {}>
    const f = await fixture('group-fail-last', capacities)
    const runtime = createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes, readNativeEvents: f.readNativeEvents })
    const first = await runtime.execute(f.parent, f.request)
    const authors = first.moduleRuns[0].executionAudit!.attempts.filter((a: any) => a.classId === 'text' && a.status === 'completed')
    expect(authors).toHaveLength(3)
    Object.assign(capacities, { text: large, review: large, backup: secondary })
    f.setMode('success')
    const before = f.start.mock.calls.length
    const resumed = await runtime.execute(f.parent, { ...f.request, resumeRunIds: [first.manifestRunId] })
    expect(resumed.moduleRuns[0].status).toBe('limited')
    expect(f.start.mock.calls.slice(before)).toHaveLength(2)
    expect(resumed.results[0].execution!.authorGroups!.groups.slice(0, 3).map((g: any) => g.receipt.childId)).toEqual(authors.map((a: any) => a.childId))
  })
  it('retains an exact frozen author prefix when its complete request fits despite a smaller new material planning target', async () => {
    const { createNativeModuleRuntime } = await api(false)
    const budget = await import('../src/research-v2/native-module-context-budget.ts')
    const capacities = { text: {}, review: {}, backup: {} } as Record<string, typeof large | {}>
    const f = await fixture('group-fail-last', capacities)
    const runtime = createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes, readNativeEvents: f.readNativeEvents })
    const first = await runtime.execute(f.parent, f.request)
    const authors = first.moduleRuns[0].executionAudit!.attempts.filter((attempt: any) => attempt.classId === 'text' && attempt.status === 'completed')
    expect(authors).toHaveLength(3)
    Object.assign(capacities, { text: large, review: large, backup: secondary })
    f.setMode('success')
    const before = f.start.mock.calls.length
    const target = vi.spyOn(budget, 'allocateModuleMaterialChars').mockReturnValue(1)
    try {
      const resumed = await runtime.execute(f.parent, { ...f.request, resumeRunIds: [first.manifestRunId] })
      expect(resumed.moduleRuns[0].status).toBe('limited')
      expect(f.start.mock.calls.slice(before)).toHaveLength(2)
      expect(resumed.results[0].execution!.authorGroups!.groups.slice(0, 3).map((group: any) => group.receipt.childId)).toEqual(authors.map((attempt: any) => attempt.childId))
    } finally { target.mockRestore() }
  })
})

describe('native author acquisition audit context', () => {
  it.each(['module-records', 'other-module-only', 'no-acquisition'] as const)('delivers only the current module frozen acquisition records to every author: %s', async mode => {
    const {createNativeModuleRuntime}=await api(false),f=await fixture()
    const original=f.request.corpus,path=original.documents[0].path
    const relevant=[
      {key:'synthetic-acquired',moduleId:'1.01',queryIndex:0,status:'acquired' as const,sourcePaths:[path]},
      {key:'synthetic-empty',moduleId:'1.01',queryIndex:1,status:'searched-empty' as const,sourcePaths:[]},
      {key:'synthetic-failed',moduleId:'1.01',queryIndex:2,status:'failed' as const,sourcePaths:[],error:'Synthetic unavailable public source'},
    ]
    const other={key:'synthetic-other-module',moduleId:'3.04',queryIndex:0,status:'acquired' as const,sourcePaths:[path]}
    const acquisition=mode==='no-acquisition'?undefined:{version:'module-web-acquisition.v1' as const,originalFingerprint:original.fingerprint,
      bundles:[],queries:mode==='module-records'?[relevant[0],other,...relevant.slice(1)]:[other]}
    const body={...original,...(acquisition?{acquisition}:{}),fingerprint:undefined}
    const corpus={...body,fingerprint:materialCorpusFingerprint(body)},before=sha256CanonicalJson(corpus)
    const run=await createNativeModuleRuntime({subagents:f.subagents,agentClasses:f.classes}).execute(f.parent,{...f.request,corpus})
    expect(run.moduleRuns[0].status).toBe('limited')
    const authors=f.start.mock.calls.map(([,input])=>input).filter(input=>!input.label?.startsWith('preplanning_module_review:'))
    expect(authors.length).toBeGreaterThan(1)
    for(const input of authors){
      const text=input.prompt.filter(part=>part.type==='text').map(part=>part.text).join('\n')
      const reference=JSON.parse(text.split('\n').find(line=>line.startsWith('{"task":'))!)
      expect(reference.acquisition).toEqual(mode==='module-records'?relevant:mode==='other-module-only'?[]:undefined)
    }
    expect(sha256CanonicalJson(corpus)).toBe(before)
  })
})

describe('native field group recovery', () => {
  it.each(['none', 'schema-rejected', 'route', 'call', 'time', 'log'] as const)('recovers a legacy unsubmitted deadline from its exact native checkpoint: %s', async damage => {
    const { createNativeModuleRuntime } = await api(false), f = await fixture('model-timeout')
    const original = (f.classes as any).fallbackTimedOut
    ;(f.classes as any).fallbackTimedOut = async () => undefined // Previous installed runtime stopped before fallback.
    const start = f.start.getMockImplementation()!
    // Advance the original model call only; file writes must not consume the
    // synthetic 60ms deadline of a successful recovered call under suite load.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    f.start.mockImplementation(async (...args) => {
      const child = await start(...args)
      if (f.start.mock.calls.length === 1) await vi.advanceTimersByTimeAsync(60)
      return child
    })
    try {
      const runtime = createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes, readNativeEvents: f.readNativeEvents, timeoutMs: 60 })
      const first = await runtime.execute(f.parent, f.request)
      ;(f.classes as any).fallbackTimedOut = original
      expect(first.moduleRuns[0].status).toBe('failed')
      const attempt: any = first.moduleRuns[0].executionAudit!.attempts[0], before = f.start.mock.calls.length
      const events = f.nativeLogs.get(attempt.childId)!
      if (damage === 'schema-rejected') {
        const schema = { type: 'object', properties: { value: { type: 'number' } }, required: ['value'] }
        events.find(e => e.type === 'request/header').data.header.tools = [{ name: 'structured_output', parameters: schema }]
        const turn = events.find(e => e.type === 'turn/start').data.turn
        events.splice(events.findIndex(e => e.type === 'turn/end'), 0,
          { seq: 0, time: events[0].time + 1, type: 'tool/call', data: { turn, step: 1, callId: 'rejected-call', name: 'structured_output', arguments: '{"value":"invalid"}' } },
          { seq: 0, time: events[0].time + 2, type: 'tool/result', data: { turn, step: 1, message: { content: [{ type: 'tool-result', toolCallId: 'rejected-call', isError: true }] } } })
        events.forEach((event, index) => { event.seq = index + 1 })
      }
      if (damage === 'route') events.find(e => e.type === 'request/header').data.header.config = backup
      if (damage === 'call') events.splice(2, 0, { seq: 3, type: 'tool/call', data: { name: 'structured_output', arguments: '{}' } })
      if (damage === 'time') events.at(-1).time = events[0].time + 1
      if (damage === 'log') f.nativeLogs.delete(attempt.childId)
      f.children.delete(attempt.childId); f.setMode('success')
      const next = await runtime.execute(f.parent, { ...f.request, resumeRunIds: [first.manifestRunId] })
      if (damage !== 'none' && damage !== 'schema-rejected') {
        expect(next.moduleRuns[0].status).toBe('failed')
        expect(next.moduleRuns[0].error).toContain('MODULE_DEADLINE_RECOVERY_INVALID')
        expect(f.start.mock.calls).toHaveLength(before)
        return
      }
      expect(next.moduleRuns[0].status, next.moduleRuns[0].error).toBe('limited')
      expect(f.start.mock.calls[before][1].agentOptions).toMatchObject(backup)
      expect(f.classes.execution(attempt.executionId)).toMatchObject({ status: 'failed', modelCallDeadline: { timeoutMs: 60 } })
      expect(JSON.parse(await readFile(join(f.root, 'research/runs', first.manifestRunId, 'run.json'), 'utf8')).moduleRuns[0].executionAudit)
        .toEqual(first.moduleRuns[0].executionAudit)
    } finally { vi.useRealTimers() }
  })
  it('reauthors a legacy scenario calculation owner and later groups while preserving original receipts',async()=>{
    const {createNativeModuleRuntime}=await api(false),f=await fixture('group-fail-last')
    const runtime=createNativeModuleRuntime({subagents:f.subagents,agentClasses:f.classes,readNativeEvents:f.readNativeEvents})
    const first=await runtime.execute(f.parent,f.request),file=join(f.root,'research','runs',first.manifestRunId,'run.json')
    const manifest=JSON.parse(await readFile(file,'utf8')),module=manifest.moduleRuns[0],audit=module.executionAudit
    const authors=audit.attempts.filter((a:any)=>a.classId==='text'&&a.status==='completed');expect(authors).toHaveLength(3)
    const owner=authors[0],evidence=owner.structuredOutput.evidence[0]
    evidence.kind='calculation';delete evidence.source;delete evidence.rationale
    evidence.calculation={basis:'scenario',operation:'product',operands:[
      {scenarioAssumption:{value:40,unit:'次/年',rationale:'测试年度频次假设。'}},
      {scenarioAssumption:{value:50,unit:'CNY/次',rationale:'测试沟通单价假设。'}},
    ]}
    owner.structuredHash=sha256CanonicalJson(owner.structuredOutput)
    f.nativeLogs.get(owner.childId)!.find(e=>e.type==='tool/call').data.arguments=JSON.stringify(owner.structuredOutput)
    module.error='MODULE_CALCULATION_SCENARIO_RATIONALE_REQUIRED: legacy-owner';manifest.limitations.push(module.error)
    const body=JSON.stringify(manifest);await writeFile(file,body)
    const envelopePath=join(f.root,'research','runs',first.manifestRunId,'manifest.json'),envelope=JSON.parse(await readFile(envelopePath,'utf8'))
    const entry=envelope.files.find((e:any)=>e.path==='run.json');entry.sha256=createHash('sha256').update(body).digest('hex');entry.sizeBytes=Buffer.byteLength(body)
    const {manifestHash:_old,...core}=envelope;envelope.manifestHash=sha256CanonicalJson(core);await writeFile(envelopePath,JSON.stringify(envelope))
    const original=structuredClone(audit),before=f.start.mock.calls.length;f.setMode('success')
    const next=await runtime.execute(f.parent,{...f.request,resumeRunIds:[first.manifestRunId]})
    expect(next.moduleRuns[0].status,next.moduleRuns[0].error).toBe('limited')
    expect(f.start.mock.calls.slice(before).map(([,r])=>r.outputSchema?.properties?.groupId?.const??'independent-review'))
      .toEqual(['project_brief:1','project_brief:2','project_brief:3','project_brief:4','independent-review'])
    const stored=await readModuleExecutionResult(f.root,next.moduleRuns[0].bundleRunId!)
    expect(stored.execution!.authorGroups!.groups[0].receipt.childId).not.toBe(owner.childId)
    expect(JSON.parse(await readFile(file,'utf8')).moduleRuns[0].executionAudit).toEqual(original)
  })
  it.each(['none','payload','route'] as const)('reauthors a legacy unit-invalid owner, verifies the untouched suffix (%s) and still requires fresh independent review',async damage=>{
    const {createNativeModuleRuntime}=await api(false),f=await fixture('group-fail-last')
    const runtime=createNativeModuleRuntime({subagents:f.subagents,agentClasses:f.classes,readNativeEvents:f.readNativeEvents})
    const first=await runtime.execute(f.parent,f.request),file=join(f.root,'research','runs',first.manifestRunId,'run.json')
    const manifest=JSON.parse(await readFile(file,'utf8')),module=manifest.moduleRuns[0],audit=module.executionAudit
    const authors=audit.attempts.filter((a:any)=>a.classId==='text'&&a.status==='completed');expect(authors).toHaveLength(3)
    const owner=authors[0];owner.structuredOutput.evidence[0].unit='元';owner.structuredHash=sha256CanonicalJson(owner.structuredOutput)
    const call=f.nativeLogs.get(owner.childId)!.find(e=>e.type==='tool/call');call.data.arguments=JSON.stringify(owner.structuredOutput)
    module.error='MODULE_CLAIM_UNIT_MISMATCH: legacy-owner';manifest.limitations.push(module.error);const body=JSON.stringify(manifest);await writeFile(file,body)
    const envelopePath=join(f.root,'research','runs',first.manifestRunId,'manifest.json'),envelope=JSON.parse(await readFile(envelopePath,'utf8'))
    const entry=envelope.files.find((e:any)=>e.path==='run.json');entry.sha256=createHash('sha256').update(body).digest('hex');entry.sizeBytes=Buffer.byteLength(body)
    const {manifestHash:_old,...core}=envelope;envelope.manifestHash=sha256CanonicalJson(core);await writeFile(envelopePath,JSON.stringify(envelope))
    if(damage==='payload')f.nativeLogs.get(authors[1].childId)!.find(e=>e.type==='tool/call').data.arguments='{}'
    if(damage==='route')f.nativeLogs.get(authors[1].childId)!.find(e=>e.type==='request/header').data.header.config=reviewRoute
    const original=structuredClone(audit),before=f.start.mock.calls.length;f.setMode('success')
    const next=await runtime.execute(f.parent,{...f.request,resumeRunIds:[first.manifestRunId]})
    if(damage!=='none'){
      expect(next.moduleRuns[0].status).toBe('failed');expect(next.moduleRuns[0].error).toContain('MODULE_GROUP_RECOVERY_INVALID')
      expect(f.start.mock.calls.slice(before).map(([,r])=>r.outputSchema?.properties?.groupId?.const)).toEqual(['project_brief:1'])
      expect(JSON.parse(await readFile(file,'utf8')).moduleRuns[0].executionAudit).toEqual(original);return
    }
    expect(next.moduleRuns[0].status).toBe('limited')
    expect(f.start.mock.calls.slice(before).map(([,r])=>r.outputSchema?.properties?.groupId?.const??'independent-review')).toEqual(['project_brief:1','project_brief:4','independent-review'])
    const stored=await readModuleExecutionResult(f.root,next.moduleRuns[0].bundleRunId!)
    expect(stored.execution!.authorGroups!.groups.slice(1,3).map(g=>g.projectionHash)).toEqual(authors.slice(1).map((a:any)=>a.structuredHash))
    expect(stored.execution!.authorGroups!.groups[0].receipt.childId).not.toBe(owner.childId)
    expect(JSON.parse(await readFile(file,'utf8')).moduleRuns[0].executionAudit).toEqual(original)
    const prompt=f.start.mock.calls[before][1].prompt.map(p=>p.type==='text'?p.text:'').join('\n')
    expect(prompt).toContain('fieldUnitConflicts');expect(prompt).toContain(owner.structuredHash)
  })
  it('reauthors the original cycle owner, strictly replays the untouched suffix and starts a fresh independent review', async () => {
    const {createNativeModuleRuntime} = await api(false), f = await fixture('group-fail-last')
    const runtime = createNativeModuleRuntime({subagents: f.subagents, agentClasses: f.classes, readNativeEvents: f.readNativeEvents})
    const first = await runtime.execute(f.parent, f.request), file = join(f.root, 'research/runs', first.manifestRunId, 'run.json')
    const manifest = JSON.parse(await readFile(file, 'utf8')), module = manifest.moduleRuns[0], audit = module.executionAudit
    const authors = audit.attempts.filter((a: any) => a.classId === 'text' && a.status === 'completed'), owner = authors[0]
    expect(authors).toHaveLength(3)
    const record = owner.structuredOutput.outputs.project_brief.records[0]
    record.formalName.claimClass = 'agent_inference'
    record.aliases = {value: ['Synthetic alias'], claimClass: 'agent_inference', limitations: ['Synthetic historical cycle fixture']}
    const address = (field: string, at = '') => ({port: 'project_brief', recordId: record.recordId, field, at})
    owner.structuredOutput.evidence = [
      {target: address('formalName'), kind: 'inference', rationale: 'Synthetic historical cycle only', inputRefs: [{local: address('aliases', '/0')}]},
      {target: address('aliases', '/0'), kind: 'inference', rationale: 'Synthetic historical cycle only', inputRefs: [{local: address('formalName')}]}
    ]
    owner.structuredHash = sha256CanonicalJson(owner.structuredOutput)
    owner.outputsJsonHash = sha256CanonicalJson(owner.structuredOutput.outputs)
    f.nativeLogs.get(owner.childId)!.find(e => e.type === 'tool/call').data.arguments = JSON.stringify(owner.structuredOutput)
    module.error = 'MODULE_CLAIM_CYCLE: synthetic-historical-owner'; manifest.limitations.push(module.error)
    const body = JSON.stringify(manifest); await writeFile(file, body)
    const envelopePath = join(f.root, 'research/runs', first.manifestRunId, 'manifest.json'), envelope = JSON.parse(await readFile(envelopePath, 'utf8'))
    const entry = envelope.files.find((e: any) => e.path === 'run.json')
    entry.sha256 = createHash('sha256').update(body).digest('hex'); entry.sizeBytes = Buffer.byteLength(body)
    const {manifestHash: _old, ...core} = envelope; envelope.manifestHash = sha256CanonicalJson(core)
    await writeFile(envelopePath, JSON.stringify(envelope))
    const original = structuredClone(audit), before = f.start.mock.calls.length; f.setMode('success')
    const next = await runtime.execute(f.parent, {...f.request, resumeRunIds: [first.manifestRunId]})
    expect(next.moduleRuns[0].status, next.moduleRuns[0].error).toBe('limited')
    expect(f.start.mock.calls.slice(before).map(([, r]) => r.outputSchema?.properties?.groupId?.const ?? 'independent-review'))
      .toEqual(['project_brief:1', 'project_brief:4', 'independent-review'])
    const stored = await readModuleExecutionResult(f.root, next.moduleRuns[0].bundleRunId!)
    expect(stored.execution!.authorGroups!.groups.slice(1, 3).map(g => g.projectionHash)).toEqual(authors.slice(1).map((a: any) => a.structuredHash))
    expect(stored.execution!.authorGroups!.groups[0].receipt.childId).not.toBe(owner.childId)
    expect(stored.execution!.reviewReceipts![0].childId).not.toBe(stored.execution!.authorGroups!.groups[0].receipt.childId)
    expect(JSON.parse(await readFile(file, 'utf8')).moduleRuns[0].executionAudit).toEqual(original)
    const prompt = f.start.mock.calls[before][1].prompt.map(p => p.type === 'text' ? p.text : '').join('\n')
    expect(prompt).toContain('module-claim-cycle-readback.v1'); expect(prompt).toContain(owner.structuredHash)
  })
  it('uses the configured independent review backup after a native WebSocket failure without regenerating authors', async () => {
    const { createNativeModuleRuntime } = await api(false), f = await fixture('review-websocket-once')
    const run = await createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes, readNativeEvents: f.readNativeEvents }).execute(f.parent, f.request)
    expect(run.moduleRuns[0].status).toBe('limited')
    expect(f.start.mock.calls.map(([, input]) => input.agentOptions)).toMatchObject([textRoute, textRoute, textRoute, textRoute, reviewRoute, backup])
    expect(f.start.mock.calls.at(-1)![1].prompt).toEqual(f.start.mock.calls.at(-2)![1].prompt)
    expect(run.results[0].execution.reviewReceipts).toHaveLength(1)
    expect(run.results[0].execution.reviewReceipts[0].actualModel).toEqual(backup)
  })
  it('recovers all original native authors after an unsubmitted transport-failed review and starts only a fresh independent review', async () => {
    const { createNativeModuleRuntime } = await api(false), f = await fixture('review-websocket-always')
    await f.classes.save(1, { image: textRoute, web: textRoute, text: textRoute, review: reviewRoute }, { review: [] })
    const runtime = createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes, readNativeEvents: f.readNativeEvents })
    const first = await runtime.execute(f.parent, f.request)
    expect(first.moduleRuns[0].status).toBe('failed')
    const audit = structuredClone(first.moduleRuns[0].executionAudit!), before = f.start.mock.calls.length
    const authors = (audit.attempts as any[]).filter(a => a.classId === 'text' && a.status === 'completed')
    expect(authors).toHaveLength(4); expect(audit.reviewReceipts).toHaveLength(0)
    f.setMode('success')
    const next = await runtime.execute(f.parent, { ...f.request, resumeRunIds: [first.manifestRunId] })
    expect(f.start.mock.calls.slice(before).map(([, input]) => input.outputSchema?.properties?.groupId?.const ?? 'independent-review')).toEqual(['independent-review'])
    expect(next.moduleRuns[0].status).toBe('limited')
    const stored = await readModuleExecutionResult(f.root, next.moduleRuns[0].bundleRunId!)
    expect(stored.execution!.authorGroups!.groups.map(g => g.receipt.childId)).toEqual(authors.map(a => a.childId))
    expect(stored.execution!.authorGroups!.groups.map(g => g.projectionHash)).toEqual(authors.map(a => a.structuredHash))
    expect(stored.execution!.reviewReceipts).toHaveLength(1)
    expect(stored.execution!.reviewReceipts![0].childId).not.toBe((audit.attempts as any[]).at(-1).childId)
    expect(first.moduleRuns[0].executionAudit).toEqual(audit)
  })
  async function reviewBudgetFailure() {
    const { createNativeModuleRuntime } = await api(false), f = await fixture()
    await f.classes.save(1, { image: textRoute, web: textRoute, text: textRoute, review: reviewRoute }, { review: [] })
    const limits = f.classes.modelLimits.bind(f.classes)
    const capacity = vi.spyOn(f.classes, 'modelLimits').mockImplementation(route => route.model === 'review' && f.start.mock.calls.length === 4
      ? Promise.resolve({ contextWindow: 10000, outputTokenLimit: 9000 }) : limits(route))
    const runtime = createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes, readNativeEvents: f.readNativeEvents })
    try {
      const first = await runtime.execute(f.parent, f.request)
      expect(first.moduleRuns[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('MODULE_MODEL_CONTEXT_BUDGET_EXCEEDED') })
      expect(f.start.mock.calls.map(([, input]) => input.agentOptions?.model)).toEqual(['text', 'text', 'text', 'text'])
      const audit = structuredClone(first.moduleRuns[0].executionAudit!)
      const failed = (audit.attempts as any[]).at(-1)
      expect(failed).toMatchObject({ classId: 'review', status: 'failed', submissionState: 'not-submitted', error: first.moduleRuns[0].error })
      expect(failed.childId).toBeUndefined(); expect(failed.actualModel).toBeUndefined()
      expect(audit.reviewReceipts).toEqual([])
      return { f, runtime, first, audit, failed }
    } finally { capacity.mockRestore() }
  }
  it('recovers all original native authors after an independent review budget failure before spawn and starts only a fresh review', async () => {
    const { f, runtime, first, audit, failed } = await reviewBudgetFailure()
    const authors = (audit.attempts as any[]).filter(a => a.classId === 'text' && a.status === 'completed')
    const file = join(f.root, 'research/runs', first.manifestRunId, 'run.json'), original = await readFile(file, 'utf8')
    const next = await runtime.execute(f.parent, { ...f.request, resumeRunIds: [first.manifestRunId] })
    expect(next.moduleRuns[0].status, next.moduleRuns[0].error).toBe('limited')
    expect(f.start.mock.calls.slice(4).map(([, input]) => input.outputSchema?.properties?.groupId?.const ?? 'independent-review')).toEqual(['independent-review'])
    const stored = await readModuleExecutionResult(f.root, next.moduleRuns[0].bundleRunId!)
    expect(stored.execution!.authorGroups!.groups.map(g => g.receipt.childId)).toEqual(authors.map(a => a.childId))
    expect(stored.execution!.authorGroups!.groups.map(g => g.projectionHash)).toEqual(authors.map(a => a.structuredHash))
    expect(stored.execution!.reviewReceipts).toHaveLength(1)
    expect(stored.execution!.attempts).toContainEqual(failed)
    expect(await readFile(file, 'utf8')).toBe(original)
    expect(first.moduleRuns[0].executionAudit).toEqual(audit)
  })
  it.each(['project', 'parent', 'class', 'status', 'child', 'actual', 'terminal', 'activity', 'task',
    'availability', 'deadline', 'attempt-child', 'attempt-actual', 'attempt-terminal', 'attempt-output-hash',
    'attempt-stall', 'attempt-deadline', 'unrelated-error', 'non-overflow-error', 'error-mismatch', 'author-payload'] as const)
  ('refuses pre-spawn review budget recovery when its %s proof is inconsistent', async damage => {
    const { f, first, audit, failed } = await reviewBudgetFailure()
    const original = f.classes.execution.bind(f.classes), ledger = original(failed.executionId)!
    const changed: any = { ...ledger }
    if (damage === 'project') changed.projectId = 'other-project'
    if (damage === 'parent') changed.parentId = 'other-parent'
    if (damage === 'class') changed.classId = 'text'
    if (damage === 'status') changed.status = 'completed'
    if (damage === 'child') changed.childId = 'hidden-child'
    if (damage === 'actual') changed.actual = reviewRoute
    if (damage === 'terminal') changed.childStopReason = 'error'
    if (damage === 'activity') changed.activity = 'running'
    if (damage === 'task') changed.task = '1.02 other-module review'
    if (damage === 'availability') changed.availabilityFailure = 'catalog'
    if (damage === 'deadline') changed.modelCallDeadline = { kind: 'owned-model-call-deadline.v1' }
    if (damage === 'attempt-child') failed.childId = 'hidden-child'
    if (damage === 'attempt-actual') failed.actualModel = reviewRoute
    if (damage === 'attempt-terminal') failed.stopReason = 'error'
    if (damage === 'attempt-output-hash') failed.outputsJsonHash = 'hidden-submission'
    if (damage === 'attempt-stall') failed.nativeToolStall = {}
    if (damage === 'attempt-deadline') failed.modelCallDeadline = {}
    if (damage === 'unrelated-error') failed.error = 'MODULE_NATIVE_SPAWN_UNAVAILABLE'
    if (damage === 'non-overflow-error') failed.error = 'MODULE_MODEL_CONTEXT_BUDGET_EXCEEDED: estimated input 1 tokens plus reserved output 1 exceed route context 10000; split the task or supply a narrower complete source context'
    if (damage === 'author-payload') f.nativeLogs.get((audit.attempts as any[])[0].childId)![2].data.arguments = '{}'
    const execution = vi.spyOn(f.classes, 'execution').mockImplementation(id => id === failed.executionId ? changed : original(id))
    const context: any = { ...f.request, module: loadPlanningCatalog().modules.find(m => m.id === '1.01'), upstream: [], inputRefs: [],
      resumeExecutionAudit: audit, resumeExecutionError: damage === 'error-mismatch' ? 'MODULE_NATIVE_error' : failed.error }
    try {
      await expect(recoverModuleAuthorGroups(context, f.parent as never, f.classes, f.readNativeEvents,
        (audit.attempts as any[])[0].sourceContextFingerprint)).rejects.toThrow('MODULE_GROUP_RECOVERY_INVALID')
      expect(f.start.mock.calls).toHaveLength(4)
      expect(first.moduleRuns[0].status).toBe('failed')
    } finally { execution.mockRestore() }
  })
  it.each(['review-call', 'review-route', 'author-payload', 'review-log-missing'] as const)('refuses a transport-only review recovery with changed native %s', async damage => {
    const { createNativeModuleRuntime } = await api(false), f = await fixture('review-websocket-always')
    await f.classes.save(1, { image: textRoute, web: textRoute, text: textRoute, review: reviewRoute }, { review: [] })
    const runtime = createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes, readNativeEvents: f.readNativeEvents })
    const first = await runtime.execute(f.parent, f.request), attempts = first.moduleRuns[0].executionAudit!.attempts as any[]
    const reviewer = attempts.at(-1), events = f.nativeLogs.get(reviewer.childId)!
    if (damage === 'review-call') { events.splice(2, 0, { type: 'tool/call', data: { turn: 1, name: 'structured_output', arguments: '{}' } }); events.forEach((e,i)=>{e.seq=i+1}) }
    if (damage === 'review-route') events[1].data.header.config = textRoute
    if (damage === 'author-payload') f.nativeLogs.get(attempts[0].childId)![2].data.arguments = '{}'
    if (damage === 'review-log-missing') f.nativeLogs.delete(reviewer.childId)
    const before = f.start.mock.calls.length; f.setMode('success')
    const next = await runtime.execute(f.parent, { ...f.request, resumeRunIds: [first.manifestRunId] })
    expect(next.moduleRuns[0].status).toBe('failed')
    expect(next.moduleRuns[0].error).toContain('MODULE_GROUP_RECOVERY_INVALID')
    expect(f.start.mock.calls).toHaveLength(before)
  })
  it('does not repeatedly copy large inherited restrictions into every author and review prompt', async () => {
    const { createNativeModuleRuntime } = await api(false), f = await fixture()
    const original = PromptContext.sliceModuleCorpus
    const body = 'Exact inherited condition, not a new fact or approval. '.repeat(30)
    const spy = vi.spyOn(PromptContext, 'sliceModuleCorpus').mockImplementation((corpus, options) => {
      const slice = original(corpus, options)
      return { ...slice, limitations: Array.from({ length: 80 }, (_, i) => `claim-${String(i).padStart(32, '0')} [proposal]: ${body}`) }
    })
    try {
      const result = await createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes }).execute(f.parent, f.request)
      expect(result.moduleRuns[0].status).toBe('limited')
      for (const [, input] of f.start.mock.calls) {
        const prompt = input.prompt.map(part => part.type === 'text' ? part.text : '').join('\n')
        expect(prompt.length).toBeLessThan(40_000)
        const reference = prompt.split('\n').map(line => { try { return JSON.parse(line) } catch { return null } }).find(value => value?.sources || value?.encoding === 'research-reference.v1')
        expect(reference.encoding ?? reference.sources.encoding).toBe('research-reference.v1')
        const restored = fixturePromptContext(prompt, 'sources')
        const sources = expandModuleReferencePromptView(restored.sources) as any
        expect(sources.corpus.limitations).toHaveLength(80)
        expect(prompt).toContain('输入视图')
      }
    } finally { spy.mockRestore() }
  })

  it('regenerates partial authors when the bounded source context changes, then runs a fresh review', async () => {
    const { createNativeModuleRuntime } = await api(false), f = await fixture('group-fail-last')
    const runtime = createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes, readNativeEvents: f.readNativeEvents })
    const first = await runtime.execute(f.parent, f.request)
    const before = f.start.mock.calls.length
    const original = PromptContext.sliceModuleCorpus
    const spy = vi.spyOn(PromptContext, 'sliceModuleCorpus').mockImplementation((corpus, options) => {
      const slice = original(corpus, options)
      return { ...slice, limitations: [...slice.limitations, 'Newly visible context boundary; previous authors must be regenerated.'] }
    })
    f.setMode('success')
    try {
      const next = await runtime.execute(f.parent, { ...f.request, resumeRunIds: [first.manifestRunId] })
      expect(f.start.mock.calls.slice(before).map(([, input]) => input.outputSchema?.properties?.groupId?.const ?? 'independent-review'))
        .toEqual(['project_brief:1', 'project_brief:2', 'project_brief:3', 'project_brief:4', 'independent-review'])
      expect(next.moduleRuns[0].status).toBe('limited')
    } finally { spy.mockRestore() }
  })

  it.each([true, false])('accepts an earlier in-child correction only when its tool result failed (failed=%s)', async failed => {
    const { createNativeModuleRuntime } = await api(false), f = await fixture('group-fail-last')
    const runtime = createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes, readNativeEvents: f.readNativeEvents })
    const first = await runtime.execute(f.parent, f.request)
    const saved = first.moduleRuns[0].executionAudit!.attempts.find((a: any) => a.status === 'completed') as any
    const events = f.nativeLogs.get(saved.childId)!
    events.splice(2, 0,
      { type: 'tool/call', data: { turn: 1, step: 0, name: 'structured_output', callId: 'rejected', arguments: '{}' } },
      { type: 'tool/result', data: { turn: 1, step: 0, message: { content: [{ type: 'tool-result', toolCallId: 'rejected', isError: failed }] } } })
    events.forEach((event, index) => { event.seq = index + 1 })
    f.setMode('success')
    const next = await runtime.execute(f.parent, { ...f.request, resumeRunIds: [first.manifestRunId] })
    expect(next.moduleRuns[0].status).toBe(failed ? 'limited' : 'failed')
    if (!failed) expect(next.moduleRuns[0].error).toContain('MODULE_GROUP_RECOVERY')
  })

  it('rejects a changed task before reusing any partial author result', async () => {
    const { createNativeModuleRuntime } = await api(false), f = await fixture('group-fail-last')
    const runtime = createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes, readNativeEvents: f.readNativeEvents })
    const first = await runtime.execute(f.parent, { ...f.request, taskBrief: 'Original task' })
    const before = f.start.mock.calls.length
    await expect(runtime.execute(f.parent, { ...f.request, taskBrief: 'Changed task', resumeRunIds: [first.manifestRunId] }))
      .rejects.toThrow(/MODULE_.*IDENTITY|MODULE_.*MISMATCH/)
    expect(f.start.mock.calls).toHaveLength(before)
  })

  it('regenerates the authors when the previous complete candidate was rejected by independent review', async () => {
    const { createNativeModuleRuntime } = await api(false), f = await fixture('review-always-fail')
    const runtime = createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes, readNativeEvents: f.readNativeEvents })
    const first = await runtime.execute(f.parent, f.request)
    expect(first.moduleRuns[0].status).toBe('failed')
    const before = f.start.mock.calls.length
    f.setMode('success')
    const next = await runtime.execute(f.parent, { ...f.request, resumeRunIds: [first.manifestRunId] })
    expect(f.start.mock.calls.slice(before).map(([, input]) => input.outputSchema?.properties?.groupId?.const ?? 'independent-review'))
      .toEqual(['project_brief:1', 'project_brief:2', 'project_brief:3', 'project_brief:4', 'independent-review'])
    for (const [, input] of f.start.mock.calls.slice(before, -1)) {
      const prompt = input.prompt.map(part => part.type === 'text' ? part.text : '').join('\n')
      expect(prompt).toContain('需要更明确排除同名异地项目。')
      expect(prompt).toContain('不是事实来源')
    }
    const independentPrompt = f.start.mock.calls.at(-1)![1].prompt.map(part => part.type === 'text' ? part.text : '').join('\n')
    expect(independentPrompt).not.toContain('需要更明确排除同名异地项目。')
    expect(next.moduleRuns[0].status).toBe('limited')
  })

  it('replays only a verified prefix from an unfinished module and still performs a fresh independent review', async () => {
    const { createNativeModuleRuntime } = await api(false), f = await fixture('group-fail-last')
    const runtime = createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes, readNativeEvents: f.readNativeEvents })
    const first = await runtime.execute(f.parent, f.request)
    expect(first.moduleRuns[0].status).toBe('failed')
    expect(first.results).toHaveLength(0)
    const attempts: any[] = first.moduleRuns[0].executionAudit!.attempts as any[]
    const prefix = attempts.filter(a => a.status === 'completed')
    expect(prefix.length).toBeGreaterThan(0)
    const before = f.start.mock.calls.length
    f.setMode('success')
    const next = await runtime.execute(f.parent, { ...f.request, resumeRunIds: [first.manifestRunId] })
    expect(f.start.mock.calls.slice(before).map(([, input]) => input.outputSchema?.properties?.groupId?.const ?? 'independent-review'))
      .toEqual(['project_brief:4', 'independent-review'])
    const lastRejected = attempts.findLast(a => a.classId === 'text' && a.status === 'failed' && a.structuredOutput)
    const resumedPrompt = f.start.mock.calls[before][1].prompt.map(p => p.type === 'text' ? p.text : '').join('\n')
    const previous = JSON.parse(resumedPrompt.split('\n').find(line => line.startsWith('{"previousRejection":'))!).previousRejection
    expect(previous.rejectedSubmission).toMatchObject({accepted:false,untrusted:true,groupId:lastRejected.groupId,
      originalSubmissionHash:lastRejected.structuredHash,authorExecutionId:lastRejected.executionId,authorChildId:lastRejected.childId,
      submissionState:'included',structuredOutput:lastRejected.structuredOutput})
    const reviewPrompt = f.start.mock.calls.at(-1)![1].prompt.map(p => p.type === 'text' ? p.text : '').join('\n')
    expect(reviewPrompt).not.toContain('rejectedSubmission')
    // Fixture review is intentionally limited: execution/reuse cannot promote it.
    expect(next.moduleRuns[0].status).toBe('limited')
    const loaded = await readModuleExecutionResult(f.root, next.moduleRuns[0].bundleRunId!)
    expect(loaded.execution!.authorGroups!.groups.slice(0, prefix.length).map(g => g.receipt.childId)).toEqual(prefix.map(a => a.childId))
    expect(loaded.execution!.reviewReceipts).toHaveLength(1)
  })

  it.each(['arguments', 'model', 'late-model', 'terminal', 'result', 'missing-log'] as const)('refuses a saved group with mismatched native %s before dispatching more work', async damage => {
    const { createNativeModuleRuntime } = await api(false), f = await fixture('group-fail-last')
    const runtime = createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes, readNativeEvents: f.readNativeEvents })
    const first = await runtime.execute(f.parent, f.request)
    const saved = first.moduleRuns[0].executionAudit!.attempts.find((a: any) => a.status === 'completed') as any
    const events = f.nativeLogs.get(saved.childId)!
    if (damage === 'arguments') events[2].data.arguments = '{}'
    if (damage === 'model') events[1].data.header.config = { provider: 'other', model: 'other' }
    if (damage === 'late-model') {
      events.splice(4, 0, { type: 'request/header', data: { header: { config: { provider: 'other', model: 'other' } } } })
      events.forEach((event, index) => { event.seq = index + 1 })
    }
    if (damage === 'terminal') events[4].data.reason.kind = 'max-tokens'
    if (damage === 'result') events[3].data.message.content[0].isError = true
    if (damage === 'missing-log') f.nativeLogs.delete(saved.childId)
    f.setMode('success')
    const before = f.start.mock.calls.length
    const next = await runtime.execute(f.parent, { ...f.request, resumeRunIds: [first.manifestRunId] })
    expect(next.moduleRuns[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('MODULE_GROUP_RECOVERY') })
    expect(next.results).toHaveLength(0)
    expect(f.start.mock.calls).toHaveLength(before)
  })
})

describe('pinned v2 native professional module runtime compatibility', () => {
  it('reauthors an all-null boundary with scoped provisional research while preserving unknown measurements and requiring independent limited review', async () => {
    const { createNativeModuleRuntime } = await api(false), f = await fixture('boundary-all-missing')
    const taskBrief = 'Compare candidate reservoir research directions; no formal redline, surveyed geometry, entrance coordinates or statutory approval is available.'
    const runtime = createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes, readNativeEvents: f.readNativeEvents })
    const first = await runtime.execute(f.parent, { ...f.request, taskBrief })
    const failedBoundary = first.moduleRuns.find((row: any) => row.itemId === '1.02')!
    expect(failedBoundary.error).toContain('MODULE_EMPTY_PROFESSIONAL_CONCLUSION')
    expect(first.results.some((result: any) => result.itemId === '1.02')).toBe(false)
    expect(failedBoundary.executionAudit?.reviewReceipts).toEqual([])
    const firstPath = join(f.root, 'research/runs', first.manifestRunId, 'run.json')
    const originalHash = createHash('sha256').update(await readFile(firstPath)).digest('hex')
    const before = f.start.mock.calls.length
    f.setMode('boundary-provisional')
    const next = await runtime.execute(f.parent, { ...f.request, taskBrief, resumeRunIds: [first.manifestRunId] })
    const nextBoundary = next.moduleRuns.find((row: any) => row.itemId === '1.02')!
    expect(nextBoundary.status, nextBoundary.error).toBe('limited')
    const loaded = await readModuleExecutionResult(f.root, nextBoundary.bundleRunId!)
    const row = (loaded.outputs.boundaries as any).records[0]
    expect(row.scopeKind).toMatchObject({ value: 'research', claimClass: 'decision' })
    expect(row.legalStatus.value).toContain('authority remains unverified')
    expect(row.locationBasis.value).toContain('candidate research reference')
    for (const field of ['geometry', 'crs', 'axisOrder', 'area', 'effectiveDate', 'entranceIds']) expect(row[field]).toMatchObject({ value: null, claimClass: 'missing', claimRefs: [] })
    expect(loaded.claims.some(claim => ['source', 'calculation'].includes(claim.kind))).toBe(false)
    expect(loaded.execution!.boundaryAudit!.boundaries[0].status).toBe('unavailable')
    expect((loaded.execution!.reviewReceipts!.at(-1) as any).verdict).toBe('limited')
    expect(f.start.mock.calls.slice(before).map(([, input]) => input.outputSchema?.properties?.groupId?.const ?? 'review')).toEqual(['boundaries:1', 'boundaries:2', 'boundaries:3.1', 'boundaries:3.2', 'review'])
    expect(f.start.mock.calls.slice(before).map(([, input]) => input.agentOptions)).toMatchObject([textRoute, textRoute, textRoute, textRoute, reviewRoute])
    const boundaryAuthors = f.start.mock.calls.slice(before).filter(([, input]) => input.outputSchema?.properties?.groupId)
    for (const [, input] of boundaryAuthors) {
      const prompt = input.prompt.map(part => part.type === 'text' ? part.text : '').join('\n')
      const task = JSON.parse(prompt.split('\n').find(line => line.startsWith('{"task":'))!).task
      expect(task.scopeFallback.evidenceResponsibility).toContain('非空decision字段')
      expect(task.scopeFallback.evidenceResponsibility).toContain('decision+proposal')
      expect(task.scopeFallback.evidenceResponsibility).toContain('claimRefs由编译器')
      expect(task.scopeFallback.evidenceResponsibility).toContain('不能把未核事实改标')
      expect(prompt).toContain('本组输出组织：')
      expect(prompt).toContain('不输出内在思考过程')
    }
    expect(createHash('sha256').update(await readFile(firstPath)).digest('hex')).toBe(originalHash)
  })
  it('rejects a boundary review that passes the original QA but skips area scope and method review', async () => {
    const { createNativeModuleRuntime } = await api(false), f = await fixture('boundary-scope-missing')
    const run = await createNativeModuleRuntime({subagents:f.subagents,agentClasses:f.classes}).execute(f.parent,f.request)
    const entry = run.moduleRuns.find((r: any) => r.itemId === '1.02')
    expect(entry?.status).toBe('failed')
    expect(entry?.error).toContain('MODULE_REVIEW_CRITERIA_INCOMPLETE')
  })
  it.each([true, false])('binds the actual boundary audit to native independent review and immutable replay (v2=%s)', async singleV2 => {
    const { createNativeModuleRuntime } = await api(singleV2), f = await fixture('boundary-success')
    const run = await createNativeModuleRuntime({ subagents:f.subagents,agentClasses:f.classes }).execute(f.parent,f.request)
    const entry=run.moduleRuns.find((r: any)=>r.itemId==='1.02')
    expect(entry?.status,JSON.stringify(entry)).toBe('completed')
    const loaded=await readModuleExecutionResult(f.root,entry.bundleRunId)
    const audit=loaded.execution!.boundaryAudit!
    expect(audit.boundaries[0].status).toBe('computed')
    if (audit.boundaries[0].status !== 'computed') throw Error('Expected computed boundary audit')
    expect(audit.boundaries[0].vertexProbe.staleDependencyRejected).toBe(true)
    expect(loaded.execution!.reviewReceipts!.at(-1)!.boundaryAuditHash).toBe(sha256CanonicalJson(audit))
    expect(loaded.execution!.reviewReceipts!.at(-1)!.checks.map(check => check.criterion)).toContain(
      '边界面积的来源、计算方法和适用范围必须一致；图幅、管理范围与项目实施范围不得混用，差异需逐项说明。')
    const review=f.start.mock.calls.find(([,r])=>r.label==='preplanning_module_review:project:1.02')![1]
    const prompt=review.prompt.map(p=>p.type==='text'?p.text:'').join('\n')
    expect(fixturePromptContext(prompt,'boundaryAudit').boundaryAudit).toEqual(audit)
    expect(prompt).toContain('缺少法定实施/影响矢量时，按spec.fallback')
    expect(review.outputSchema?.properties?.boundaryAuditHash?.const).toBe(sha256CanonicalJson(audit))
    const attempt=loaded.execution!.attempts!.find((a: any)=>a.classId==='review') as any
    expect(attempt.structuredOutput.boundaryAuditHash).toBe(sha256CanonicalJson(audit))
  })
  it('sends bounded original page slices to author and reviewer while keeping the full corpus for verification', async () => {
    const { createNativeModuleRuntime } = await api()
    const f = await fixture('success')
    await writeFile(join(f.root, '原始资料', 'appendix.txt'), Array.from({ length: 60 }, () => 'Unrelated archival appendix. '.repeat(30)).join('\n\n'))
    f.request.corpus = await captureMaterialCorpus(f.root)
    const original = structuredClone(f.request.corpus)
    const result = await createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes }).execute(f.parent, f.request)
    expect(result.status).toBe('partial')
    expect(f.request.corpus).toEqual(original)
    for (const [, request] of f.start.mock.calls) {
      const prompt = request.prompt.map(part => part.type === 'text' ? part.text : '').join('\n')
      expect(prompt).toContain('"originalFingerprint"')
      expect(prompt).toContain('"omitted"')
      expect(prompt.length).toBeLessThan(JSON.stringify(original).length)
      expect(prompt).toContain('Shaotanhe Reservoir')
    }
    const verified = await readModuleExecutionResult(f.root, result.moduleRuns[0].bundleRunId)
    expect(verified.sourceValues[0].page).toBe(2)
  })
  it('compiles all 62 professional output contracts into the actual DSH structured-output subset', async () => {
    const { getNativeModuleCandidateSchema } = await api()
    for (const module of loadPlanningCatalog().modules) {
      expect(() => assertObjectJsonSchema(getNativeModuleCandidateSchema(module.id)), module.id).not.toThrow()
    }
  })
  it('folds repeated wire envelopes for all 62 modules while retaining closed records and typed field values', async () => {
    const { getNativeModuleCandidateSchema } = await api()
    for (const module of loadPlanningCatalog().modules) {
      const schema = getNativeModuleCandidateSchema(module.id)
      for (const [name, port] of Object.entries(getModuleFieldContracts(module.id).ports)) {
        const row = schema.properties!.outputs.properties![name].properties!.records.items!
        expect(row.additionalProperties, `${module.id}/${name}`).toBe(false)
        for (const field of port.fields) {
          const envelope = row.properties![field.name]
          expect(envelope.type, `${module.id}/${name}/${field.name}`).toBe('object')
          expect(envelope.oneOf).toBeUndefined()
          const value = envelope.properties!.value
          expect(validateJsonSchemaValue(value, null)).toEqual([])
          expect(validateJsonSchemaValue(value, { unexpected: 'untyped value' }).length).toBeGreaterThan(0)
          if (field.kind === 'text') {
            expect(validateJsonSchemaValue(value, '原文')).toEqual([])
            expect(validateJsonSchemaValue(value, 42).length).toBeGreaterThan(0)
          }
          if (field.kind === 'texts') {
            expect(validateJsonSchemaValue(value, ['原文'])).toEqual([])
            expect(validateJsonSchemaValue(value, [42]).length).toBeGreaterThan(0)
          }
          if (field.kind === 'geometry') {
            if (module.id === '1.02') {
              expect(validateJsonSchemaValue(value, {type:'Point',coordinates:[114,30]}).length).toBeGreaterThan(0)
              expect(validateJsonSchemaValue(value, {type:'Polygon',coordinates:[[[114,30],[115,30],[115,31],[114,30]]]})).toEqual([])
            } else expect(validateJsonSchemaValue(value, { type: 'Point', coordinates: [114, 30] })).toEqual([])
            expect(validateJsonSchemaValue(value, { type: 'Point', coordinates: ['invented', 30] }).length).toBeGreaterThan(0)
          }
        }
      }
    }
    // Observed pre-change 1.01 schema was 19,393 chars; the budget protects the
    // transport reduction without freezing the entire schema serialization.
    expect(JSON.stringify(getNativeModuleCandidateSchema('1.01')).length).toBeLessThan(12_000)
  })
  it.each([
    ['missing with a value', { value: '不得作为missing', claimRefs: [], claimClass: 'missing', limitations: [limitation] }],
    ['decision-null without a reason', { value: null, claimRefs: ['name'], claimClass: 'decision', limitations: [limitation] }],
    ['invalid claim class', { value: '名称', claimRefs: ['name'], claimClass: 'invented', limitations: [limitation] }],
  ])('keeps the full central contract rejecting %s after wire-envelope folding', async (_name, malformed) => {
    const row: Record<string, unknown> = { recordId: 'row-1', resultClass: 'observation_summary' }
    const port = getModuleFieldContracts('1.01').ports.project_brief
    for (const field of port.fields) row[field.name] = { value: null, claimRefs: [], claimClass: 'missing', limitations: [limitation] }
    row.formalName = { value: '名称', claimRefs: ['name'], claimClass: 'source_conclusion', limitations: [limitation] }
    const outputs = { project_brief: { type: port.type, records: [row], quality: 'limited', claimRefs: ['name'], limitations: [limitation], scope: '来源核对', asOf: '2026-09-26' } }
    expect(validateModuleOutputs('1.01', outputs).valid).toBe(true)
    row.formalName = malformed
    expect(validateModuleOutputs('1.01', outputs).valid).toBe(false)
  })
  it('requires structured_output submission for both author and reviewer while prohibiting business and delegation tools', async () => {
    const { createNativeModuleRuntime } = await api(), f = await fixture()
    const run = await createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes }).execute(f.parent, f.request)
    expect(run.status).toBe('partial')
    expect(f.start.mock.calls).toHaveLength(2)
    for (const [, request] of f.start.mock.calls) {
      const prompt = request.prompt.map(part => part.type === 'text' ? part.text : '').join('\n')
      expect(prompt).toContain('必须调用一次 structured_output')
      expect(prompt).toContain('普通文本不作为结果')
      expect(prompt).toContain('禁止业务工具和委派工具')
      expect(prompt).not.toContain('不得调用工具')
    }
  })
  it('rejects a plain-text JSON answer without a structured_output result before review or persistence', async () => {
    const { createNativeModuleRuntime } = await api(), f = await fixture('text-only')
    const run = await createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes }).execute(f.parent, f.request)
    expect(run.status).toBe('partial')
    expect(run.results).toHaveLength(0)
    expect(run.moduleRuns[0].error).toContain('MODULE_NATIVE_SCHEMA_INVALID')
    expect(f.start.mock.calls.every(([, request]) => request.agentOptions?.model !== 'review')).toBe(true)
    const correction = f.start.mock.calls[1][1].prompt.map(part => part.type === 'text' ? part.text : '').join('\n')
    const contextLine = correction.split('\n').find(line => line.startsWith('{"correctionContext":'))
    expect(contextLine).toBeDefined()
    const context = JSON.parse(contextLine!).correctionContext
    expect(context.submissionState).toBe('not-submitted')
    expect(context).not.toHaveProperty('structuredOutput')
  })
  it('gives the author the explicit projection hierarchy without canonical claim values, IDs or prefilled facts', async () => {
    const { createNativeModuleRuntime } = await api(), f = await fixture()
    const run = await createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes }).execute(f.parent, f.request)
    expect(run.status).toBe('partial')
    const prompt = f.start.mock.calls[0][1].prompt.map(part => part.type === 'text' ? part.text : '').join('\n')
    expect(prompt).toContain('顶层必须且仅包含 projectionVersion、outputsJson、evidence、limitations、steps 五个键')
    expect(prompt).toContain('不要输出 claims、sourceValues、claimRefs、claim.value 或完整 selector')
    expect(prompt).toContain('outputsJson 解析后的对象必须且仅包含本模块端口：project_brief')
    expect(prompt).toContain('"projectionVersion":"module-author-projection-json.v2"')
    expect(prompt).toContain('"outputsJson":<完整端口对象的JSON字符串>')
    expect(prompt).toContain('"evidence":[<局部证据描述>]')
    expect(prompt).toContain('仅结构示意，不是可提交值，不预填事实或空数组')
    expect(prompt).toContain('value.* 只是校验器的错误根路径，不是包装参数')
    const { getModuleAuthorProjectionSchema } = await import('../src/research-v2/module-author-projection.ts')
    expect(prompt).toContain(JSON.stringify(getModuleAuthorProjectionSchema('1.01').properties!.outputs))
  })
  it('rejects the observed outputs.claims/sourceValues nesting and missing top-level keys without auto-unwrapping', async () => {
    const { createNativeModuleRuntime } = await api(), f = await fixture('misnested-metadata')
    const run = await createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes }).execute(f.parent, f.request)
    expect(run.status).toBe('partial')
    expect(run.results).toHaveLength(0)
    expect(run.moduleRuns[0].error).toContain('MODULE_NATIVE_SCHEMA_INVALID')
    for (const path of ['value.projectionVersion', 'value.outputsJson', 'value.evidence', 'value.limitations', 'value.outputs']) expect(run.moduleRuns[0].error).toContain(path)
    expect(f.start.mock.calls.every(([, request]) => request.agentOptions?.model !== 'review')).toBe(true)
  })
  it('requires an explicit projection instead of accepting an old full candidate as new author output', async () => {
    const { createNativeModuleRuntime } = await api(), f = await fixture('legacy-candidate')
    const run = await createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes }).execute(f.parent, f.request)
    expect(run.status).toBe('partial'); expect(run.results).toHaveLength(0)
    expect(run.moduleRuns[0].error).toContain('MODULE_NATIVE_SCHEMA_INVALID')
  })
  it.each(['legacy-projection', 'legacy-string-projection', 'duplicate-json'] as const)('rejects %s before independent review instead of converting it', async mode => {
    const { createNativeModuleRuntime } = await api(), f = await fixture(mode)
    const run = await createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes }).execute(f.parent, f.request)
    expect(run.status).toBe('partial'); expect(run.results).toHaveLength(0)
    expect(run.moduleRuns[0].error).toContain(mode === 'duplicate-json' ? 'MODULE_PROJECTION_JSON_DUPLICATE_KEY' : 'MODULE_NATIVE_SCHEMA_INVALID')
    expect(f.start.mock.calls.every(([, request]) => request.agentOptions?.model !== 'review')).toBe(true)
  })
  it('archives the actual projection separately and replays it against the reviewed candidate and author receipt', async () => {
    const { createNativeModuleRuntime } = await api(), f = await fixture()
    const run = await createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes }).execute(f.parent, f.request)
    expect(run.status).toBe('partial')
    const stored = await readModuleExecutionResult(f.root, run.moduleRuns[0].bundleRunId)
    expect(stored.execution?.kind).toBe('author-projection-json-v2')
    if (!stored.execution || stored.execution.kind !== 'author-projection-json-v2') throw new Error('projection execution receipt required')
    expect(stored.execution.authorProjection.raw.projectionVersion).toBe('module-author-projection-json.v2')
    expect(stored.execution.authorProjection.raw).not.toHaveProperty('claims')
    expect(stored.execution.authorProjection.compiledCandidateHash).toBe(sha256CanonicalJson(stored.reviewedCandidate))
    expect(stored.execution.authorProjection.projectionHash).toBe(sha256CanonicalJson(stored.execution.authorProjection.raw))
    expect(stored.execution.authorProjection.outputsJsonHash).toBe(createHash('sha256').update(stored.execution.authorProjection.raw.outputsJson, 'utf8').digest('hex'))
    expect(stored.execution.childId).toBe('text-1')
    expect(stored.execution.attempts).toContainEqual(expect.objectContaining({ childId: 'text-1', structuredHash: stored.execution.authorProjection.projectionHash,
      outputsJsonHash: stored.execution.authorProjection.outputsJsonHash }))
    const folder = join(f.root, 'research/runs', run.moduleRuns[0].bundleRunId)
    const original = JSON.parse(await readFile(join(folder, 'result.json'), 'utf8'))
    const manifest = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8'))
    for (const mutate of [
      (v: any) => { v.execution.authorProjection.raw.limitations.push('篡改投影') },
      (v: any) => { v.execution.childId = 'invented-author-child' },
      (v: any) => { v.execution.attempts.find((a: any) => a.classId === 'text' && a.status === 'completed').structuredHash = '0'.repeat(64) },
      (v: any) => { v.execution.attempts.find((a: any) => a.classId === 'text' && a.status === 'completed').outputsJsonHash = '0'.repeat(64) },
      (v: any) => { delete v.execution.attempts.find((a: any) => a.classId === 'text' && a.status === 'completed').outputsJsonHash },
      (v: any) => { v.execution.authorProjection.raw.outputsJson += ' ' },
      (v: any) => { delete v.execution.authorProjection.outputsJsonHash },
      (v: any) => { v.execution.kind = 'author-projection-v1' },
      (v: any) => { v.execution.authorProjection.version = 'module-author-projection.v1' },
      (v: any) => { v.outputs.project_brief.records[0].formalName.limitations.push('篡改编译结果'); v.reviewedCandidate.outputs = structuredClone(v.outputs);
        v.execution.reviewReceipts.at(-1).candidateHash = sha256CanonicalJson(v.reviewedCandidate) },
      (v: any) => { delete v.execution.kind },
    ]) {
      const changed = structuredClone(original); mutate(changed)
      const content = JSON.stringify(changed), nextManifest = structuredClone(manifest)
      const entry = nextManifest.files.find((e: any) => e.path === 'result.json')
      entry.sha256 = createHash('sha256').update(content).digest('hex'); entry.sizeBytes = Buffer.byteLength(content)
      const { manifestHash: _old, ...core } = nextManifest; nextManifest.manifestHash = sha256CanonicalJson(core)
      await writeFile(join(folder, 'result.json'), content); await writeFile(join(folder, 'manifest.json'), JSON.stringify(nextManifest))
      await expect(readModuleExecutionResult(f.root, run.moduleRuns[0].bundleRunId)).rejects.toThrow(/MODULE_PROJECTION/)
    }
    // A historical valid v1 bundle is a separate fixture, never a production migration of failed model output.
    const legacy = structuredClone(original), { outputsJson, ...raw } = legacy.execution.authorProjection.raw
    const v1 = { ...raw, projectionVersion: 'module-author-projection.v1' as const, outputs: JSON.parse(outputsJson) }
    const { createModuleProjectionAudit } = await import('../src/research-v2/module-author-projection.ts')
    legacy.execution.kind = 'author-projection-v1'
    legacy.execution.authorProjection = createModuleProjectionAudit(v1, legacy.reviewedCandidate, legacy.execution)
    const attempt = legacy.execution.attempts.find((a: any) => a.classId === 'text' && a.status === 'completed')
    attempt.structuredHash = legacy.execution.authorProjection.projectionHash; delete attempt.outputsJsonHash
    const content = JSON.stringify(legacy), nextManifest = structuredClone(manifest)
    const entry = nextManifest.files.find((e: any) => e.path === 'result.json')
    entry.sha256 = createHash('sha256').update(content).digest('hex'); entry.sizeBytes = Buffer.byteLength(content)
    const { manifestHash: _old, ...core } = nextManifest; nextManifest.manifestHash = sha256CanonicalJson(core)
    await writeFile(join(folder, 'result.json'), content); await writeFile(join(folder, 'manifest.json'), JSON.stringify(nextManifest))
    expect((await readModuleExecutionResult(f.root, run.moduleRuns[0].bundleRunId)).execution?.kind).toBe('author-projection-v1')
  })
  it('executes text and independent review children, validates original quotes, and persists their receipts', async () => {
    const { createNativeModuleRuntime } = await api(), f = await fixture()
    const runtime = createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes })
    const run = await runtime.execute(f.parent, f.request)
    expect(run.status).toBe('partial')
    expect(run.results).toHaveLength(1)
    expect(f.start.mock.calls.map(call => call[1].agentOptions)).toMatchObject([textRoute, reviewRoute]); expect(f.start.mock.calls.map(call => call[1].agentOptions?.maxTokens)).toEqual([undefined,undefined])
    for (const [provider, request] of f.start.mock.calls) {
      expect(provider).toBe('spawn'); expect(request.parent).toBe(f.parent)
      expect(request.toolFilter).toEqual({ allow: [] }); expect(request.maxDepth).toBe(1)
      const prompt = request.prompt.map(part => part.type === 'text' ? part.text : '').join('\n')
      expect(prompt).toContain('Shaotanhe Reservoir'); expect(prompt).toContain(spec.fallback)
      for (const step of spec.steps) expect(prompt).toContain(step)
    }
    const result = await readModuleExecutionResult(f.root, run.moduleRuns[0].bundleRunId)
    expect(result.execution).toMatchObject({ childId: 'text-1', actualModel: textRoute, stopReason: 'completed' })
    expect((result.execution as any).steps).toHaveLength(4)
    expect((result.execution as any).reviewReceipts).toMatchObject([{ childId: 'review-1', actualModel: reviewRoute, verdict: 'limited' }])
    expect((result.execution as any).reviewReceipts[0].checks).toHaveLength(spec.qa.length)
    expect(f.disposed.sort()).toEqual(['review-1', 'text-1'])
  })

  it('corrects professional schema errors once on the same text route before independent review', async () => {
    const { createNativeModuleRuntime } = await api(), f = await fixture('schema-once')
    const run = await createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes }).execute(f.parent, f.request)
    expect(run.status).toBe('partial')
    expect(f.start.mock.calls.map(call => call[1].agentOptions)).toMatchObject([textRoute, textRoute, reviewRoute])
    const executions = await f.classes.executions('project')
    const first = executions.find(row => row.childId === 'text-1')!
    expect(first.status).toBe('failed')
    expect(executions.find(row => row.childId === 'text-2')).toMatchObject({ status: 'completed', correctionFromExecutionId: first.id })
    expect(f.disposed.sort()).toEqual(['review-1', 'text-1', 'text-2'])
  })

  it('uses the latest verified schema draft after a business rejection without stacking stale hot-correction diagnostics', async () => {
    const { createNativeModuleRuntime } = await api(false), f = await fixture('business-then-native-schema')
    const run = await createNativeModuleRuntime({subagents:f.subagents,agentClasses:f.classes,readNativeEvents:f.readNativeEvents}).execute(f.parent,f.request)
    expect(run.results).toHaveLength(1)
    const prompt=(f.start.mock.calls[2][1].prompt as any[])[0].text
    const latest:any=f.nativeLogs.get('text-2')!.find((e:any)=>e.type==='tool/call')
    expect(prompt).toContain(sha256CanonicalJson(JSON.parse(latest.data.arguments)))
    expect(prompt).toContain('fieldReadbackDiagnostics')
    expect(prompt).not.toContain('previousStructuredRejection')
    expect(prompt).not.toContain('Shaotanhe Reservoir renamed without original support')
    expect(run.results[0].execution.attempts.slice(0,3)).toMatchObject([{status:'failed'},{status:'failed',submissionState:'not-submitted'},{status:'completed'}])
    expect(run.results[0].execution.reviewReceipts).toHaveLength(1)
  })

  it('delivers original native schema rejection details to the finite content correction after a completed turn without structured output', async () => {
    const { createNativeModuleRuntime } = await api(), f = await fixture('native-schema-stop-once')
    const run = await createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes, readNativeEvents: f.readNativeEvents }).execute(f.parent, f.request)
    expect(run.status).toBe('partial')
    expect(f.start.mock.calls.map(call => call[1].agentOptions)).toMatchObject([textRoute, textRoute, reviewRoute])
    const correctionPrompt = (f.start.mock.calls[1][1].prompt as any[])[0].text
    const firstCall: any = f.nativeLogs.get('text-1')!.find((e: any) => e.type === 'tool/call')
    expect(correctionPrompt).toContain(sha256CanonicalJson(JSON.parse(firstCall.data.arguments)))
    expect(correctionPrompt).toContain('"unexpectedMembers":["quote"]')
    expect(correctionPrompt).toContain('"submissionState":"included-unaccepted"')
    expect(correctionPrompt).not.toContain('随后调用超时')
    expect((await f.classes.executions('project')).find(row => row.childId === 'text-1')!.status).toBe('failed')
  })

  it('retains failed review receipts and reruns independent review after the text correction', async () => {
    const { createNativeModuleRuntime } = await api(), f = await fixture('review-once')
    const run = await createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes }).execute(f.parent, f.request)
    expect(run.status).toBe('partial')
    expect(f.start.mock.calls.map(call => call[1].agentOptions)).toMatchObject([textRoute, reviewRoute, textRoute, reviewRoute])
    expect(run.results[0].execution.reviewReceipts.map((receipt: any) => receipt.verdict)).toEqual(['fail', 'limited'])
    const executions = await f.classes.executions('project')
    const first = executions.find(row => row.childId === 'text-1')!
    expect(first.status).toBe('failed')
    expect(executions.find(row => row.childId === 'text-2')?.correctionFromExecutionId).toBe(first.id)
    expect(f.disposed.sort()).toEqual(['review-1', 'review-2', 'text-1', 'text-2'])
  })

  it('requires author correction and a new bound review when limited review contradicts accepted ports', async () => {
    const { createNativeModuleRuntime } = await api(), f = await fixture('accepted-limited-once')
    const run = await createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes }).execute(f.parent, f.request)
    expect(run.status).toBe('partial')
    expect(f.start.mock.calls.map(call => call[1].agentOptions)).toMatchObject([textRoute, reviewRoute, textRoute, reviewRoute])
    const result = run.results[0]
    expect(result.outputs.project_brief.quality).toBe('limited')
    expect(result.outputs.project_brief.limitations).toContain(limitation)
    expect(result.execution.reviewReceipts).toHaveLength(2)
    expect(result.execution.reviewReceipts[0].candidateHash).not.toBe(result.execution.reviewReceipts[1].candidateHash)
    const executions = await f.classes.executions('project')
    const first = executions.find(row => row.childId === 'text-1')!
    expect(first.status).toBe('failed')
    expect(executions.find(row => row.childId === 'text-2')).toMatchObject({ status: 'completed', correctionFromExecutionId: first.id })
  })

  it.each(['unsupported-source', 'empty-output'] as const)('never persists %s despite a model completed result', async mode => {
    const { createNativeModuleRuntime } = await api(), f = await fixture(mode)
    const run = await createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes }).execute(f.parent, f.request)
    expect(run.status).toBe('partial'); expect(run.results).toEqual([])
    expect(f.start.mock.calls.map(call => call[1].agentOptions)).toMatchObject([textRoute, textRoute, textRoute])
    expect(run.moduleRuns[0].error).toMatch(mode === 'unsupported-source' ? /SOURCE_VALUE/ : /EMPTY_PROFESSIONAL/)
    expect(f.disposed.sort()).toEqual(['text-1', 'text-2', 'text-3'])
  })

  it('refuses a model route mismatch without content retries or review', async () => {
    const { createNativeModuleRuntime } = await api(), f = await fixture('wrong-model')
    const run = await createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes }).execute(f.parent, f.request)
    expect(run.status).toBe('partial'); expect(run.results).toEqual([])
    expect(run.moduleRuns[0].error).toMatch(/MODEL_ROUTE_MISMATCH/)
    expect(f.start).toHaveBeenCalledTimes(1); expect(f.disposed).toEqual(['text-1'])
  })

  it('refuses an incomplete independent review after two review corrections without multiplying author retries', async () => {
    const { createNativeModuleRuntime } = await api(), f = await fixture('review-missing-criteria')
    const run = await createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes }).execute(f.parent, f.request)
    expect(run.status).toBe('partial'); expect(run.results).toEqual([])
    expect(run.moduleRuns[0].error).toMatch(/REVIEW_CRITERIA_INCOMPLETE/)
    expect(run.moduleRuns[0].error).toContain('missing criterion')
    expect(f.start.mock.calls.map(call => call[1].agentOptions)).toMatchObject([textRoute, reviewRoute, reviewRoute, reviewRoute])
    expect(f.disposed.sort()).toEqual(['review-1', 'review-2', 'review-3', 'text-1'])
  })

  it('identifies the exact invalid review claim reference while keeping the reviewer independent', async () => {
    const { createNativeModuleRuntime } = await api(), f = await fixture('review-unknown-claim')
    const run = await createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes }).execute(f.parent, f.request)
    expect(run.status).toBe('partial'); expect(run.results).toEqual([])
    expect(run.moduleRuns[0].error).toContain('MODULE_NATIVE_SCHEMA_INVALID')
    expect(run.moduleRuns[0].error).toContain('value.checks[0].claimRefs[0]')
    expect(run.moduleRuns[0].executionAudit!.attempts.filter((attempt: any) => attempt.classId === 'review')
      .every((attempt: any) => attempt.structuredOutput.checks[0].claimRefs[0] === 'claim-not-in-frozen-candidate')).toBe(true)
    const prompts = f.start.mock.calls.map(call => call[1].prompt.map((part: any) => part.text ?? '').join('\n'))
    expect(prompts[2]).toContain('claim-not-in-frozen-candidate')
    expect(prompts[2]).toContain('must be one of')
    expect(f.start.mock.calls.map(call => call[1].agentOptions)).toMatchObject([textRoute, reviewRoute, reviewRoute, reviewRoute])
  })

  it.each([true, false])('limits native reviewer claim choices to its actual candidate (json-v2=%s)', async singleV2 => {
    const { createNativeModuleRuntime } = await api(singleV2), f = await fixture()
    const run = await createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes }).execute(f.parent, f.request)
    expect(run.results).toHaveLength(1)
    const requests = f.start.mock.calls.map(call => call[1]).filter(input => input.label?.startsWith('preplanning_module_review:'))
    expect(requests).toHaveLength(1)
    const input = requests[0]!, prompt = input.prompt.map(part => part.type === 'text' ? part.text : '').join('\n')
    assertObjectJsonSchema(input.outputSchema)
    const candidate = fixturePromptContext(prompt, 'candidateHash').candidate
    const claimSchema = (input.outputSchema.properties!.checks as any).items.properties.claimRefs
    expect(claimSchema.items.enum).toEqual(candidate.claims.map((claim: any) => claim.claimId))
    const receipt = run.results[0]!.execution!.reviewReceipts!.at(-1)!
    const events = f.nativeLogs.get(receipt.childId)!
    const original = JSON.parse((events.find(event => event.type === 'tool/call')!.data as any).arguments)
    expect(validateJsonSchemaValue(input.outputSchema, original)).toEqual([])
    const incorrect = structuredClone(original)
    incorrect.checks[0].claimRefs = ['claim-not-in-frozen-candidate']
    expect(validateJsonSchemaValue(input.outputSchema, incorrect).some(error => error.includes('claimRefs'))).toBe(true)
    const copiedIncorrectly = structuredClone(original)
    copiedIncorrectly.checks[0].claimRefs = [candidate.claims[0].claimId.slice(0, -1)]
    expect(validateJsonSchemaValue(input.outputSchema, copiedIncorrectly).some(error => error.includes('claimRefs'))).toBe(true)
    expect(original.checks[0].claimRefs).toEqual(candidate.claims.map((claim: any) => claim.claimId))
  })

  it.each([false,true])('validates the decoded complete wire submission and retains rejected originals (invalid=%s)', async invalidWire => {
    const { createNativeModuleRuntime } = await api(false), f = await fixture()
    const originalSchemaCheck = (await vi.importActual<typeof SchemaValidation>('@deepseek-ai/dsh-tools')).assertObjectJsonSchema
    const descriptions = vi.spyOn(SchemaValidation, 'assertObjectJsonSchema').mockImplementation(schema => {
      const schemaView = schema as ObjectJsonSchema
      if (schemaView.properties?.checks) {
        const description = 'Synthetic repeated complete native-schema guidance. '.repeat(1000)
        const checks = schemaView.properties.checks as any
        Object.assign(schemaView, { description }); checks.description = description; checks.items.description = description
      }
      return originalSchemaCheck(schema)
    })
    const originalGuard = ContextBudget.assertNativeModuleContext
    const guard = vi.spyOn(ContextBudget, 'assertNativeModuleContext').mockImplementation((limits, prompt, schema, images) => {
      if (JSON.parse(schema).properties?.checks) throw new ContextBudget.NativeModuleContextBudgetError('Synthetic forced review-wire branch')
      return originalGuard(limits, prompt, schema, images)
    })
    const wireCalls: { native: any; decoded: any }[] = []
    try {
      const runtime = createNativeModuleRuntime({ agentClasses: f.classes, readNativeEvents: f.readNativeEvents, subagents: {
        ...f.subagents, start: async (provider: string, input: SubagentStartRequest) => {
          assertObjectJsonSchema(input.outputSchema)
          if (input.outputSchema.properties?.wireVersion?.const !== NATIVE_MODULE_JSON_WIRE_VERSION) return f.subagents.start(provider, input)
          const prompt = input.prompt.map(part => part.type === 'text' ? part.text : '').join('\n')
          const binding = fixturePromptContext(prompt, 'nativeSubmissionWire').nativeSubmissionWire
          const child = await f.subagents.start(provider, { ...input, outputSchema: binding.fullNativeSchema })
          const result = await child.result, decoded = structuredClone(result.structured)
          if(invalidWire)(decoded as any).checks[0].claimRefs=['claim-not-in-frozen-candidate']
          const native = { wireVersion: NATIVE_MODULE_JSON_WIRE_VERSION, submissionJson: JSON.stringify(decoded) }
          const events = f.nativeLogs.get(String(child.id))! as any[]
          events.find(event => event.type === 'request/header').data.header.tools[0].parameters = input.outputSchema
          events.find(event => event.type === 'tool/call').data.arguments = JSON.stringify(native)
          events.splice(1, 0, { type: 'user/message', data: { turn: 1, content: [{ type: 'text', text: prompt }] } })
          events.forEach((event, index) => { event.seq = index + 1 })
          wireCalls.push({ native: structuredClone(native), decoded })
          return { ...child, result: Promise.resolve({ ...result, structured: native }) }
        },
      } })
      const run = await runtime.execute(f.parent, f.request)
      expect(wireCalls.length).toBeGreaterThan(0)
      if(invalidWire){
        expect(run.results).toEqual([])
        expect(run.moduleRuns[0]!.error).toContain('MODULE_NATIVE_JSON_WIRE_INVALID')
        const attempts=(run.moduleRuns[0]!.executionAudit!.attempts as any[]).filter(value=>value.classId==='review')
        expect(attempts).toHaveLength(3);expect(wireCalls).toHaveLength(3)
        for(const [index,attempt] of attempts.entries()){
          expect(attempt.status).toBe('failed')
          expect(attempt.structuredOutput).toEqual(wireCalls[index]!.decoded)
          expect(attempt.nativeSubmissionWire.nativeArgumentsHash).toBe(sha256CanonicalJson(wireCalls[index]!.native))
          expect(attempt.nativeSubmissionWire.decodedSubmissionHash).toBe(sha256CanonicalJson(wireCalls[index]!.decoded))
        }
        expect(run.moduleRuns[0]!.executionAudit!.reviewReceipts).toEqual([])
        const request=f.start.mock.calls.filter(call=>call[1].label?.startsWith('preplanning_module_review:'))[1]![1]
        const prompt=request.prompt.map(part=>part.type==='text'?part.text:'').join('\n')
        const feedback=fixturePromptContext(prompt,'correctionContext').correctionContext
        expect(feedback.submissionState).toBe('included')
        expect(feedback.structuredOutput).toEqual(wireCalls[0]!.decoded)
        return
      }
      expect(run.results, run.moduleRuns[0]?.error).toHaveLength(1)
      expect(wireCalls).toHaveLength(1)
      const attempt = (run.results[0]!.execution!.attempts as any[]).find(value => value.nativeSubmissionWire)
      expect(attempt.structuredOutput).toEqual(wireCalls[0]!.decoded)
      expect(attempt.nativeSubmissionWire.nativeArgumentsHash).toBe(sha256CanonicalJson(wireCalls[0]!.native))
      expect(attempt.nativeSubmissionWire.decodedSubmissionHash).toBe(sha256CanonicalJson(wireCalls[0]!.decoded))
      expect(run.results[0]!.execution!.reviewReceipts![0]!.verdict).toBe(wireCalls[0]!.decoded.verdict)
    } finally { guard.mockRestore(); descriptions.mockRestore() }
  })

  it('uses equivalent native objects when repeated schema choices exceed capacity',async()=>{
    const {createNativeModuleRuntime}=await api(false),f=await fixture(),originalAssert=SchemaValidation.assertObjectJsonSchema
    const descriptions=vi.spyOn(SchemaValidation,'assertObjectJsonSchema').mockImplementation(schema=>{
      const node=schema as ObjectJsonSchema
      if(node.properties?.outputs?.properties?.project_brief?.properties?.scope?.const&&!node.properties.syntheticCapacityFixture){
        const repeated='Synthetic invariant schema annotation. '.repeat(2000)
        node.properties.syntheticCapacityFixture={oneOf:Array.from({length:80},(_,index)=>({type:'object',
          additionalProperties:false,required:['id'],description:repeated,properties:{id:{type:'string',const:'synthetic-choice-'+index}}}))}
      }
      return originalAssert(schema)
    })
    const originalLimits=f.classes.modelLimits.bind(f.classes)
    const limits=vi.spyOn(f.classes,'modelLimits').mockImplementation(route=>f.start.mock.calls.length
      ?Promise.resolve({contextWindow:872000,outputTokenLimit:128000}):originalLimits(route))
    let typedRequests=0,wireRequests=0
    try{
      const runtime=createNativeModuleRuntime({agentClasses:f.classes,readNativeEvents:f.readNativeEvents,subagents:{...f.subagents,
        start:async(provider:Parameters<typeof f.subagents.start>[0],input:SubagentStartRequest)=>{
          if(input.outputSchema?.properties?.wireVersion)wireRequests++
          if(input.outputSchema?.properties?.syntheticCapacityFixture){
            typedRequests++
            expect(JSON.stringify(input.outputSchema).length).toBeLessThan(200000)
          }
          return f.subagents.start(provider,input)
        }}})
      const run=await runtime.execute(f.parent,f.request)
      expect(typedRequests).toBeGreaterThan(0);expect(wireRequests).toBe(0)
      expect(run.moduleRuns[0].error).toBeUndefined()
      expect(run.results).toHaveLength(1)
      expect(run.results[0].outputs.project_brief.records[0].formalName.value).toBe('Shaotanhe Reservoir')
    }finally{descriptions.mockRestore();limits.mockRestore()}
  })

  it.each([false,true,'evidence-once'])('executes an explicit frozen-identity wire without filling business fields (invalid draft=%s)', async invalidRecord => {
    const {createNativeModuleRuntime}=await api(false),f=await fixture(),originalAssert=SchemaValidation.assertObjectJsonSchema
    const descriptions=vi.spyOn(SchemaValidation,'assertObjectJsonSchema').mockImplementation(schema=>{
      const node=schema as ObjectJsonSchema
      if(node.properties?.outputs?.properties?.project_brief?.properties?.scope?.const){
        const repeated='Synthetic repeated frozen-group schema guidance. '.repeat(1000)
        node.description=repeated;node.properties.outputs.description=repeated
      }
      return originalAssert(schema)
    })
    const originalGuard=ContextBudget.assertNativeModuleContext
    const guard=vi.spyOn(ContextBudget,'assertNativeModuleContext').mockImplementation((limits,prompt,schema,images)=>{
      if(JSON.parse(schema).properties?.outputs?.properties?.project_brief?.properties?.scope?.const)
        throw new ContextBudget.NativeModuleContextBudgetError('Synthetic forced frozen-group wire')
      return originalGuard(limits,prompt,schema,images)
    })
    const calls:{native:any;decoded:any}[]=[]
    try{
      const runtime=createNativeModuleRuntime({agentClasses:f.classes,readNativeEvents:f.readNativeEvents,subagents:{...f.subagents,
        start:async(provider:Parameters<typeof f.subagents.start>[0],input:SubagentStartRequest)=>{
          if(input.outputSchema?.properties?.wireVersion?.const!==NATIVE_MODULE_FROZEN_JSON_WIRE_VERSION)return f.subagents.start(provider,input)
          const prompt=input.prompt.map(part=>part.type==='text'?part.text:'').join('\n')
          const full=expandNativeSchemaDescription(fixturePromptContext(prompt,'nativeSubmissionWire').nativeSubmissionWire.fullNativeSchema)
          const run=await f.subagents.start(provider,{...input,outputSchema:full})
          return {...run,result:run.result.then(result=>{
            const decoded=result.structured as any
            if(invalidRecord==='evidence-once'&&!calls.length)decoded.evidence.push({target:{port:'project_brief',
              recordId:decoded.outputs.project_brief.records[0].recordId,field:'principal',at:''},kind:'proposal',
              rationale:'Synthetic malformed evidence fixture only.',quote:'Synthetic misplaced member.'})
            const body=structuredClone(decoded),port=body.outputs.project_brief
            const records=port.records.map(({recordId,...record}:any)=>{
              if(invalidRecord===true)delete record.resultClass
              return {port:'project_brief',recordId,recordJson:JSON.stringify(record)}
            })
            for(const key of ['records','type','scope','asOf'])delete port[key]
            const native={wireVersion:NATIVE_MODULE_FROZEN_JSON_WIRE_VERSION,fullNativeSchemaHash:sha256CanonicalJson(full),submissionJson:JSON.stringify(body),records}
            const events=f.nativeLogs.get(String(run.id))!
            const header=events.find(event=>event.type==='request/header')! as any
            header.data.header.tools[0].parameters=input.outputSchema
            const call=events.find(event=>event.type==='tool/call')! as any;call.data.arguments=JSON.stringify(native)
            for(const event of events.slice(1))event.seq++
            events.splice(1,0,{seq:2,type:'user/message',data:{content:[{type:'text',text:prompt}]}})
            calls.push({native,decoded});return {...result,structured:native}
          })}
        }}})
      const run=await runtime.execute(f.parent,f.request)
      expect(calls.length).toBeGreaterThan(0)
      if(invalidRecord===true){
        expect(run.results).toEqual([]);expect(run.moduleRuns[0]!.error).toContain('original field schema rejected')
        const failed=run.moduleRuns[0]!.executionAudit!.attempts.filter((row:any)=>row.groupId==='project_brief:2')
        expect(failed).toHaveLength(6)
        expect(failed.slice(0,3).map((row:any)=>row.actualModel)).toEqual([textRoute,textRoute,textRoute])
        expect(failed.slice(3).map((row:any)=>row.actualModel)).toEqual([backup,backup,backup])
        for(const attempt of failed){
          expect(attempt.nativeSubmissionWire?.version).toBe(NATIVE_MODULE_FROZEN_JSON_WIRE_VERSION)
          expect((attempt.structuredOutput as any).outputs.project_brief.records[0].resultClass).toBeUndefined()
        }
      }else{
        expect(run.results,run.moduleRuns[0]?.error).toHaveLength(1)
        const attempts=run.results[0]!.execution!.attempts.filter((row:any)=>row.nativeSubmissionWire)
        expect(attempts).toHaveLength(calls.length)
        for(const [index,attempt] of attempts.entries()){
          expect(attempt.structuredOutput).toEqual(calls[index]!.decoded)
          expect(attempt.nativeSubmissionWire?.version).toBe(NATIVE_MODULE_FROZEN_JSON_WIRE_VERSION)
          expect(attempt.nativeSubmissionWire?.nativeArgumentsHash).toBe(sha256CanonicalJson(calls[index]!.native))
        }
        expect(await readModuleExecutionResult(f.root,run.moduleRuns[0]!.bundleRunId!)).toMatchObject({execution:{reviewReceipts:expect.any(Array)}})
        if(invalidRecord==='evidence-once'){
          const corrections=f.start.mock.calls.filter(call=>call[1].label?.endsWith(':project_brief:2'))
          expect(corrections).toHaveLength(2)
          const prompt=corrections[1]![1].prompt.map(part=>part.type==='text'?part.text:'').join('\n')
          const original=fixturePromptContext(prompt,'rejectedNativeSchema').rejectedNativeSchema
          expect(original.fieldDiagnostics[0].unexpectedMembers).toEqual(['quote'])
          expect(original.originalSubmissionHash).toBe(sha256CanonicalJson(calls[0]!.decoded))
        }
      }
    }finally{guard.mockRestore();descriptions.mockRestore()}
  })

  it('preserves all independent failed review receipts when author corrections are exhausted', async () => {
    const { createNativeModuleRuntime } = await api(), f = await fixture('review-always-fail')
    const run = await createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes }).execute(f.parent, f.request)
    expect(run.status).toBe('partial'); expect(run.results).toEqual([])
    expect(run.moduleRuns[0].executionAudit.reviewReceipts.map((receipt: any) => receipt.verdict)).toEqual(['fail', 'fail', 'fail'])
    expect(run.moduleRuns[0].executionAudit.attempts).toHaveLength(6)
    expect(f.start.mock.calls.map(call => call[1].agentOptions)).toMatchObject([textRoute, reviewRoute, textRoute, reviewRoute, textRoute, reviewRoute])
    expect(f.disposed).toHaveLength(6)
  })

  it('passes progress and a changed-project guard to central persistence', async () => {
    const { createNativeModuleRuntime } = await api(), f = await fixture()
    const onProgress = vi.fn()
    let checks = 0
    const run = await createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes }).execute(f.parent, f.request, {
      onProgress, assertCurrent: () => { if (++checks > 1) throw new Error('source snapshot changed') },
    })
    expect(run.status).toBe('partial'); expect(run.results).toEqual([])
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ itemId: '1.01', status: 'failed', error: 'source snapshot changed' }))
  })

  it('passes the current task separately from original source facts to both author and reviewer', async () => {
    const { createNativeModuleRuntime } = await api(), f = await fixture()
    const taskBrief = '本轮比较两种研究方向，不据此认定现场条件或建设批准。'
    const run = await createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes }).execute(f.parent, { ...f.request, taskBrief })
    expect(run.status).toBe('partial')
    const prompt = f.start.mock.calls[0][1].prompt.map(part => part.type === 'text' ? part.text : '').join('\n')
    const reference = JSON.parse(prompt.split('\n').at(-1)!)
    expect(reference.taskContext).toMatchObject({ taskBrief })
    expect(reference.taskContext.claimBoundary).toContain('不是原始事实')
    expect(JSON.stringify(reference.sources)).not.toContain(taskBrief)
    expect(f.start.mock.calls[1][1].prompt.map(part => part.type === 'text' ? part.text : '').join('\n')).toContain(taskBrief)
  })

  it('cancels an active native run and releases it without publishing module results', async () => {
    const { createNativeModuleRuntime } = await api(), f = await fixture('cancel')
    const run = await createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes }).execute(f.parent, f.request)
    expect(run.status).toBe('cancelled'); expect(run.results).toEqual([])
    expect((await f.classes.executions('project'))[0]).toMatchObject({ status: 'cancelled', childId: 'text-1' })
    expect(f.disposed).toEqual(['text-1'])
  })

  it('sends the same hash-bound original image pixels to the native author and independent reviewer', async () => {
    const { createNativeModuleRuntime } = await api(), f = await fixture('boundary-success')
    const bytes = await sharp({ create: { width: 20, height: 10, channels: 3, background: '#123456' } }).jpeg().toBuffer()
    await writeFile(join(f.request.workspaceRoot, '原始资料', 'point-photo.jpg'), bytes)
    f.request.corpus = await captureMaterialCorpus(f.request.workspaceRoot)
    const saved: Uint8Array[] = []
    const attachments = { saveImage: async ({ data }: { data: Uint8Array }) => { saved.push(data); return { id: 'source-photo-ref' } } }
    const run = await createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes, attachments }).execute(f.parent, f.request)
    expect(run.results).toHaveLength(2)
    expect(saved).toHaveLength(1)
    for (const [, request] of f.start.mock.calls.filter(([, request]: any) => request.label.endsWith(':1.02'))) expect(request.prompt.filter((b: any) => b.type === 'image')).toEqual([{ type: 'image', attachment: { id: 'source-photo-ref' } }])
    expect(run.results.find((r: any) => r.itemId === '1.02').execution.attempts.filter((a: any) => a.status === 'completed').map((a: any) => a.sourceImages[0])).toEqual([
      expect.objectContaining({ path: '原始资料/point-photo.jpg', previewHash: expect.stringMatching(/^[a-f0-9]{64}$/u) }),
      expect.objectContaining({ path: '原始资料/point-photo.jpg', previewHash: expect.stringMatching(/^[a-f0-9]{64}$/u) }),
    ])
  })
  it('fits each actual native request after its route capacity changes while retaining the frozen source context and truthful image omissions', async () => {
    const { createNativeModuleRuntime } = await api(), f = await fixture('boundary-success')
    for (let i = 0; i < 16; i++) {
      const folder = join(f.request.workspaceRoot, '原始资料', `point-${String(i).padStart(2, '0')}`)
      await mkdir(folder, { recursive: true })
      await writeFile(join(folder, 'photo.jpg'), await sharp({ create: { width: 20 + i, height: 10, channels: 3, background: '#123456' } }).jpeg().toBuffer())
    }
    f.request.corpus = await captureMaterialCorpus(f.request.workspaceRoot)
    const before = sha256CanonicalJson(f.request.corpus), begin = f.classes.begin.bind(f.classes)
    let actualRequest = false
    vi.spyOn(f.classes, 'modelLimits').mockImplementation(async () => ({ contextWindow: actualRequest ? 260000 : 1000000, outputTokenLimit: 128000 }))
    vi.spyOn(f.classes, 'begin').mockImplementation(async (...args) => {
      const execution = await begin(...args)
      if (args[2].startsWith('1.02 ')) actualRequest = true
      return execution
    })
    const attachments = { saveImage: async ({ data }: { data: Uint8Array }) => ({ id: createHash('sha256').update(data).digest('hex') }) }
    const run = await createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes, attachments }).execute(f.parent, f.request)
    const module = run.moduleRuns.find((row: any) => row.itemId === '1.02')
    expect(module?.status, module?.error).toBe('completed')
    const requests = f.start.mock.calls.map(([, input]) => input).filter(input => input.label?.includes(':1.02'))
    expect(requests).toHaveLength(2)
    const reviewed = fixturePromptContext(requests[1].prompt.filter(part => part.type === 'text').map(part => part.text).join('\n'), 'candidateHash')
    expect(reviewed.candidate).toEqual(run.results.find((row: any) => row.itemId === '1.02')!.reviewedCandidate)
    expect(reviewed.candidateHash).toBe(sha256CanonicalJson(reviewed.candidate))
    for (const input of requests) {
      const text = input.prompt.filter(part => part.type === 'text').map(part => part.text).join('\n')
      const sources = expandModuleReferencePromptView(fixturePromptContext(text, 'sources').sources) as any
      const selected = fixturePromptContext(text, 'nativeRequestImageSelection').nativeRequestImageSelection
      const count = input.prompt.filter(part => part.type === 'image').length
      expect(count).toBeGreaterThan(0); expect(count).toBeLessThan(16)
      expect(sources.images.sources).toHaveLength(16)
      expect(selected.sources).toHaveLength(count); expect(selected.omitted).toHaveLength(16 - count)
      expect(selected.originalImageSourcesHash).toBe(sha256CanonicalJson(sources.images.sources))
      const attempt = run.results.find((row: any) => row.itemId === '1.02')!.execution!.attempts.find((row: any) => row.sourceImages?.length === count)
      expect(attempt?.sourceImages).toEqual(selected.sources)
    }
    expect(sha256CanonicalJson(f.request.corpus)).toBe(before)
  })
  it('fits representative source pictures before any native dispatch and keeps the same selection for the independent review', async () => {
    const { createNativeModuleRuntime } = await api()
    const limit = { context: { contextWindow: 360000 }, defaultMaxTokens: 128000 }
    const f = await fixture('boundary-success', { text: limit, review: limit, backup: limit })
    for (let i = 0; i < 16; i++) {
      const folder = join(f.request.workspaceRoot, '原始资料', `point-${String(i).padStart(2, '0')}`)
      await mkdir(folder, { recursive: true })
      await writeFile(join(folder, 'photo.jpg'), await sharp({ create: { width: 20 + i, height: 10, channels: 3, background: '#123456' } }).jpeg().toBuffer())
    }
    f.request.corpus = await captureMaterialCorpus(f.request.workspaceRoot)
    const before = sha256CanonicalJson(f.request.corpus)
    const attachments = { saveImage: async ({ data }: { data: Uint8Array }) => ({ id: createHash('sha256').update(data).digest('hex') }) }
    const run = await createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes, attachments }).execute(f.parent, f.request)
    expect(run.moduleRuns.find((row: any) => row.itemId === '1.02')?.status).toBe('completed')
    const calls = f.start.mock.calls.filter(([, request]: any) => request.label.endsWith(':1.02'))
    expect(calls).toHaveLength(2)
    const selected = calls[0][1].prompt.filter((block: any) => block.type === 'image')
    expect(selected.length).toBeGreaterThanOrEqual(2)
    expect(selected.length).toBeLessThanOrEqual(8)
    for (const [, request] of calls) {
      expect(request.prompt.filter((block: any) => block.type === 'image')).toEqual(selected)
      const text = request.prompt.filter((block: any) => block.type === 'text').map((block: any) => block.text).join('\n')
      const sources = expandModuleReferencePromptView(fixturePromptContext(text, 'sources').sources) as any
      expect(sources.images.sources).toHaveLength(selected.length)
      expect(sources.images.omitted).toHaveLength(16 - selected.length)
      expect(request.agentOptions?.maxTokens).toBeUndefined()
    }
    expect(sha256CanonicalJson(f.request.corpus)).toBe(before)
  })
  it('gives text and independent review separate model deadlines even when their total exceeds one deadline', async () => {
    const { createNativeModuleRuntime } = await api(), f = await fixture('separate-deadlines')
    const start = f.start.getMockImplementation()!
    // Advance only model latency; filesystem scheduling must not consume this synthetic deadline.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const startedAt = Date.now()
    f.start.mockImplementation(async (...args) => {
      const child = await start(...args)
      await vi.advanceTimersByTimeAsync(110)
      return child
    })
    try {
      const run = await createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes, timeoutMs: 160 }).execute(f.parent, f.request)
      expect(Date.now() - startedAt).toBe(220)
      expect(run.status).toBe('partial'); expect(run.results, JSON.stringify(run.moduleRuns)).toHaveLength(1)
      expect(f.start.mock.calls.map(call => call[1].agentOptions)).toMatchObject([textRoute, reviewRoute])
      expect(f.start.mock.calls.every(call => !call[1].signal.aborted)).toBe(true)
      expect(f.disposed.sort()).toEqual(['review-1', 'text-1'])
    } finally { vi.useRealTimers() }
  })

  it('still cancels both executions when the user stops during independent review', async () => {
    const { createNativeModuleRuntime } = await api(), f = await fixture('cancel-review')
    const run = await createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes }).execute(f.parent, f.request)
    expect(run.status).toBe('cancelled'); expect(run.results).toEqual([])
    expect(f.start.mock.calls.map(call => call[1].agentOptions)).toMatchObject([textRoute, reviewRoute])
    expect(f.start.mock.calls.every(call => call[1].signal.aborted)).toBe(true)
    expect((await f.classes.executions('project')).map(row => row.status)).toEqual(['cancelled', 'cancelled'])
    expect(f.disposed.sort()).toEqual(['review-1', 'text-1'])
  })

  it('exhausts the finite original backup chain when all calls exceed their own deadline', async () => {
    const { createNativeModuleRuntime } = await api(), f = await fixture('model-timeout')
    const start = f.start.getMockImplementation()!
    // Advance owned model time after spawn; real filesystem latency must not
    // decide whether the second fixture call gets its own deadline.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    f.start.mockImplementation(async (...args) => {
      const child = await start(...args)
      await vi.advanceTimersByTimeAsync(70)
      return child
    })
    try {
      const run = await createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes, timeoutMs: 60 }).execute(f.parent, f.request)
      expect(run.status).toBe('partial'); expect(run.results).toEqual([])
      expect(run.moduleRuns[0].error).toMatch(/timeout|timed out/i)
      expect(f.start).toHaveBeenCalledTimes(2)
      expect((await f.classes.executions('project'))[0].status).toBe('failed')
      expect(f.disposed.sort()).toEqual(['text-1', 'text-2'])
      expect((run.moduleRuns[0].executionAudit!.attempts as any[]).map(attempt => attempt.modelCallDeadline?.timeoutMs)).toEqual([60, 60])
    } finally { vi.useRealTimers() }
  })

  it('continues an unsubmitted owner timeout on the configured backup and performs independent review', async () => {
    const { createNativeModuleRuntime } = await api(false), f = await fixture('model-timeout-once')
    // The first fixture request waits for abort at any deadline. Allow the
    // backup's real host setup and strict validation enough time in a full run.
    const timeoutMs = 1000
    const run = await createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes,
      readNativeEvents: f.readNativeEvents, timeoutMs }).execute(f.parent, f.request)
    expect(run.moduleRuns[0].status, run.moduleRuns[0].error).toBe('limited')
    expect(f.start.mock.calls.slice(0, 2).map(([, input]) => input.agentOptions)).toMatchObject([textRoute, backup])
    const stored = await readModuleExecutionResult(f.root, run.moduleRuns[0].bundleRunId!)
    expect(stored.execution!.reviewReceipts).toHaveLength(1)
    expect((stored.execution!.attempts as any[])[0]).toMatchObject({ submissionState: 'not-submitted', modelCallDeadline: { timeoutMs } })
    expect(f.classes.execution((stored.execution!.attempts as any[])[0].executionId)).toMatchObject({ status: 'failed', childStopReason: 'aborted' })
  })
})

describe('default complete-field grouped native module runtime', () => {
  it.each(['availability-after-corrections', 'overload-after-corrections'] as const)('gives an availability backup its own bounded corrections and the latest rejection context: %s', async mode => {
    const { createNativeModuleRuntime } = await api(false), f = await fixture(mode)
    const nativeError = mode === 'overload-after-corrections' ? 'MODULE_NATIVE_error' : 'MODULE_NATIVE_max-tokens'
    const run = await createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes }).execute(f.parent, f.request)
    expect(run.results).toHaveLength(1)
    const attempts = run.results[0].execution.attempts as any[]
    expect(attempts.slice(0, 5).map(a => [a.childId, a.status])).toEqual([
      ['text-1', 'failed'], ['text-2', 'failed'], ['text-3', 'failed'], ['text-4', 'failed'], ['text-5', 'completed'],
    ])
    expect(attempts[2]).toMatchObject({ error: nativeError, submissionState: 'not-submitted' })
    expect(attempts[3].error).toContain('MISSING_REQUIRES_JSON_NULL')
    const executions = await f.classes.executions('project')
    const exhaustedPrimary = executions.find(e => e.childId === 'text-3')!
    const backupDraft = executions.find(e => e.childId === 'text-4')!
    expect(exhaustedPrimary).toMatchObject({ availabilityFailure: mode === 'overload-after-corrections' ? 'server' : 'output-limit' })
    expect(backupDraft).toMatchObject({ selected: backup, fallbackFromExecutionId: exhaustedPrimary.id })
    expect(executions.find(e => e.childId === 'text-5')).toMatchObject({ selected: backup, correctionFromExecutionId: backupDraft.id })
    const contextFor = (call: number) => JSON.parse(f.start.mock.calls[call][1].prompt.map(p => p.type === 'text' ? p.text : '').join('\n')
      .split('\n').find(line => line.startsWith('{"correctionContext":'))!).correctionContext
    expect(contextFor(3)).toMatchObject({ accepted: false, untrusted: true, error: nativeError, submissionState: 'not-submitted',
      previousStructuredRejection: { originalSubmissionHash: attempts[1].structuredHash, authorExecutionId: attempts[1].executionId } })
    expect(contextFor(4)).toMatchObject({ accepted: false, untrusted: true, error: attempts[3].error,
      diagnosticExcerpt: { scope: 'missing-field-null-conflicts-only', originalSubmissionHash: attempts[3].structuredHash,
        fieldNullConflicts: [{ target: { port: 'project_brief', recordId: 'project-row', field: 'aliases', at: '' }, receivedType: 'array' }] } })
    expect(contextFor(4)).not.toHaveProperty('previousStructuredRejection')
    expect(attempts.filter(a => a.classId === 'review' && a.status === 'completed')).toHaveLength(1)
    expect(run.moduleRuns[0].status).toBe('limited')
  })

  it('stops after the availability backup exhausts its own corrections without restarting the primary', async () => {
    const { createNativeModuleRuntime } = await api(false), f = await fixture('availability-after-corrections-exhausted')
    const run = await createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes }).execute(f.parent, f.request)
    expect(run.results).toEqual([])
    expect(run.moduleRuns[0].error).toContain('MISSING_REQUIRES_JSON_NULL')
    expect(f.start.mock.calls.map(call => call[1].agentOptions)).toMatchObject([
      textRoute, textRoute, textRoute, backup, backup, backup,
    ])
    expect(f.disposed).toHaveLength(6)
    expect(run.moduleRuns[0].executionAudit.attempts).toHaveLength(6)
  })

  it('continues a complete unsent author request on an admitted configured backup without changing its sources or reserve', async () => {
    const { createNativeModuleRuntime } = await api(false), f = await fixture('success')
    const before = structuredClone(f.classes.settings()), originalBegin = f.classes.begin.bind(f.classes), originalCorpus=sha256CanonicalJson(f.request.corpus)
    let actualRequest = false
    vi.spyOn(f.classes, 'begin').mockImplementation(async (...args) => {
      const execution = await originalBegin(...args)
      if (args[1] === 'text') actualRequest = true
      return execution
    })
    vi.spyOn(f.classes, 'modelLimits').mockImplementation(async route => ({
      contextWindow: actualRequest && route.model === textRoute.model ? 1000 : 1000000,
      outputTokenLimit: 32768,
    }))
    const run = await createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes, readNativeEvents: f.readNativeEvents }).execute(f.parent, f.request)
    expect(run.results, run.moduleRuns[0]?.error).toHaveLength(1)
    const attempts = (run.results[0]!.execution.attempts as any[]).filter(row => row.groupId === 'project_brief:1')
    expect(attempts[0]).toMatchObject({ status: 'failed', submissionState: 'not-submitted', error: expect.stringContaining('MODULE_MODEL_CONTEXT_BUDGET_EXCEEDED') })
    expect(attempts[0].childId).toBeUndefined(); expect(attempts[0].actualModel).toBeUndefined()
    expect(attempts[1]).toMatchObject({ status: 'completed', actualModel: backup })
    expect(attempts[1].contextBudget.outputReservedTokens).toBe(32768)
    const unused = f.classes.execution(attempts[0].executionId)!, resumed = f.classes.execution(attempts[1].executionId)!
    expect(unused.childId).toBeUndefined(); expect(unused.actual).toBeUndefined()
    expect(resumed).toMatchObject({ routeIndex: 1, fallbackFromExecutionId: unused.id, configurationRevision: unused.configurationRevision })
    expect(f.start.mock.calls[0]![1].agentOptions).toMatchObject(backup)
    expect(run.results[0]!.execution.reviewReceipts).toHaveLength(1)
    expect(f.classes.settings()).toEqual(before)
    expect(sha256CanonicalJson(f.request.corpus)).toBe(originalCorpus)
  }, 30000)

  it('hands three completed native JSON-wire format rejections to the snapshotted backup without accepting a rejected draft', async () => {
    const { createNativeModuleRuntime } = await api(false), f = await fixture('success')
    const before = structuredClone(f.classes.settings()), originalGuard = ContextBudget.assertNativeModuleContext
    const guard = vi.spyOn(ContextBudget, 'assertNativeModuleContext').mockImplementation((limits, prompt, schema, images) => {
      if (JSON.parse(schema).properties?.outputs) throw new ContextBudget.NativeModuleContextBudgetError('Synthetic author-wire branch')
      return originalGuard(limits, prompt, schema, images)
    })
    try {
      const runtime = createNativeModuleRuntime({ agentClasses: f.classes, readNativeEvents: f.readNativeEvents,
        subagents: { ...f.subagents, start: async (provider: string, input: SubagentStartRequest) => {
          const version = input.outputSchema?.properties?.wireVersion?.const
          if (!version) return f.subagents.start(provider, input)
          const prompt = input.prompt.map(part => part.type === 'text' ? part.text : '').join('\n')
          const full = expandNativeSchemaDescription(fixturePromptContext(prompt, 'nativeSubmissionWire').nativeSubmissionWire.fullNativeSchema)
          const child = await f.subagents.start(provider, { ...input, outputSchema: full })
          const result = await child.result, decoded = structuredClone(result.structured) as any
          const failPrimary = input.label?.endsWith(':project_brief:1') && input.agentOptions?.model === textRoute.model
          let native: any
          if (version === NATIVE_MODULE_FROZEN_JSON_WIRE_VERSION) {
            const portName = Object.keys(decoded.outputs)[0]!, port = decoded.outputs[portName]
            const records = port.records.map(({ recordId, ...record }: any) => ({ port: portName, recordId, recordJson: JSON.stringify(record) }))
            for (const key of ['records', 'type', 'scope', 'asOf']) delete port[key]
            native = { wireVersion: version, fullNativeSchemaHash: sha256CanonicalJson(full), submissionJson: JSON.stringify(decoded), records }
          } else native = { wireVersion: version, submissionJson: JSON.stringify(decoded) }
          if (failPrimary) native.submissionJson = '{"original_rejected_json":'
          const events = f.nativeLogs.get(String(child.id))! as any[]
          events.find(event => event.type === 'request/header').data.header.tools[0].parameters = input.outputSchema
          events.find(event => event.type === 'tool/call').data.arguments = JSON.stringify(native)
          events.splice(1, 0, { type: 'user/message', data: { content: [{ type: 'text', text: prompt }] } })
          events.forEach((event, index) => { event.seq = index + 1 })
          return { ...child, result: Promise.resolve({ ...result, structured: native }) }
        } } })
      const run = await runtime.execute(f.parent, f.request)
      expect(run.results, run.moduleRuns[0]?.error).toHaveLength(1)
      const attempts = (run.results[0]!.execution.attempts as any[]).filter(row => row.groupId === 'project_brief:1')
      expect(attempts.slice(0, 3).map(row => row.status)).toEqual(['failed', 'failed', 'failed'])
      expect(attempts.slice(0, 3).every(row => row.error.startsWith('MODULE_NATIVE_JSON_WIRE_INVALID:'))).toBe(true)
      expect(attempts[3]).toMatchObject({ status: 'completed', actualModel: backup })
      const primary = f.classes.execution(attempts[2].executionId)!, fallback = f.classes.execution(attempts[3].executionId)!
      expect(primary.childStopReason).toBe('completed')
      expect(fallback).toMatchObject({ routeIndex: 1, fallbackFromExecutionId: primary.id, correctionFromExecutionId: primary.id })
      expect(fallback.availabilityFailure).toBeUndefined()
      expect(run.results[0]!.execution.reviewReceipts).toHaveLength(1)
      expect(f.start.mock.calls.at(-1)![1].agentOptions).toMatchObject(reviewRoute)
      expect(f.classes.settings()).toEqual(before)
    } finally { guard.mockRestore() }
  }, 30000)

  it('uses the configured backup after an owned native schema-stall abort and retains independent review and failed receipts', async () => {
    const { createNativeModuleRuntime } = await api(false), f = await fixture('success')
    const originalStart = f.start.getMockImplementation()!
    const stalled = new Set<string>()
    const rejectedArguments = JSON.stringify({ projectionVersion: 'module-author-field-group.v8', groupId: 'project_brief:1',
      outputs: '{"project_brief":{}}', evidence: [], limitations: [], stepResults: {} })
    const readNativeEvents = vi.fn(async (childId: string) => stalled.has(childId) ? [
      { seq: 1, type: 'turn/start', data: { turn: 1 } },
      ...Array.from({ length: 3 }, (_, i) => [
        { seq: 2 + i * 2, type: 'tool/call', data: { turn: 1, step: i, name: 'structured_output', callId: `bad-${i}`,
          arguments: JSON.stringify({ ...JSON.parse(rejectedArguments), limitations: [`changed invalid draft ${i}`] }) } },
        { seq: 3 + i * 2, type: 'tool/result', data: { turn: 1, step: i, message: { content: [{ type: 'tool-result', toolCallId: `bad-${i}`, isError: true,
          content: [{ type: 'text', text: 'Error: invalid arguments: "value.outputs" must be an object' }] }] } } },
      ]).flat(),
    ] : [])
    f.start.mockImplementation(async (...args) => {
      const child = await originalStart(...args), request = args[1]
      if (!request.label?.endsWith(':project_brief:1') || request.agentOptions?.model !== textRoute.model) return child
      stalled.add(String(child.id))
      f.children.get(String(child.id))!.splice(1)
      return { ...child, result: new Promise(resolve => request.signal.addEventListener('abort', () => {
        f.children.get(String(child.id))!.push({ type: 'turn/end', data: { reason: { kind: 'aborted' } } })
        resolve({ stopReason: 'aborted', output: [] })
      }, { once: true })) }
    })
    const run = await createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes, readNativeEvents }).execute(f.parent, f.request)
    expect(run.results).toHaveLength(1)
    const requests = f.start.mock.calls.map(([, request]) => request)
    expect(requests.slice(0, 2).map(request => request.agentOptions)).toMatchObject([textRoute, backup])
    const correction = requests[1].prompt.filter(part => part.type === 'text').map(part => part.text).join('\n')
    expect(correction).toContain('MODULE_NATIVE_TOOL_STALLED')
    expect(correction).toContain('outputs必须是原生对象')
    const attempts = run.results[0].execution.attempts as any[]
    expect(attempts[0]).toMatchObject({ status: 'failed', nativeToolStall: { repeatedCalls: 3, match: 'same-validation-errors' }, submissionState: 'not-submitted' })
    expect(attempts[1]).toMatchObject({ status: 'completed', actualModel: backup })
    expect(run.results[0].execution.reviewReceipts).toHaveLength(1)
    expect(requests.at(-1)!.agentOptions).toMatchObject(reviewRoute)
    const executions = await f.classes.executions('project'), first = executions.find(row => row.childId === 'text-1')!, fallback = executions.find(row => row.childId === 'text-2')!
    expect(first).toMatchObject({ status: 'failed', childStopReason: 'aborted', actual: textRoute })
    expect(fallback).toMatchObject({ routeIndex: 1, selected: backup, fallbackFromExecutionId: first.id, correctionFromExecutionId: first.id })
    expect(fallback.availabilityFailure).toBeUndefined()
    expect(f.classes.settings().fallbacks?.text).toEqual([backup])
  })
  it('stops identical rejected native tool calls and uses only the existing finite content corrections', async () => {
    const { createNativeModuleRuntime } = await api(false), f = await fixture('success')
    const settings = f.classes.settings()
    await f.classes.save(settings.revision, settings.routes, { ...settings.fallbacks, text: [] })
    const originalStart = f.start.getMockImplementation()!
    const rejectedArguments = JSON.stringify({ projectionVersion: 'module-author-field-group.v6', groupId: 'project_brief:1',
      outputs: '{"project_brief":{}}', evidence: [], limitations: [], stepResults: {} })
    const readNativeEvents = vi.fn(async () => [
      { seq: 1, type: 'turn/start', data: { turn: 1 } },
      ...Array.from({ length: 3 }, (_, i) => [
        { seq: 2 + i * 2, type: 'tool/call', data: { turn: 1, step: i, name: 'structured_output', callId: `bad-${i}`, arguments: rejectedArguments } },
        { seq: 3 + i * 2, type: 'tool/result', data: { turn: 1, step: i, message: { content: [{ type: 'tool-result', toolCallId: `bad-${i}`, isError: true,
          content: [{ type: 'text', text: 'Error: invalid arguments: "value.outputs" must be an object' }] }] } } },
      ]).flat(),
    ])
    f.start.mockImplementation(async (...args) => {
      const child = await originalStart(...args)
      return { ...child, result: new Promise(resolve => args[1].signal.addEventListener('abort', () =>
        resolve({ stopReason: 'aborted', output: [] }), { once: true })) }
    })
    // This case verifies immediate schema-stall cancellation and finite corrections.
    // An 80ms wall-clock deadline races filesystem/class setup under the full suite;
    // model deadline cancellation has its own test above. Keep the production limit.
    const run = await createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes, readNativeEvents }).execute(f.parent, f.request)
    expect(run.status).toBe('partial'); expect(run.results).toEqual([])
    expect(run.moduleRuns[0].error).toContain('MODULE_NATIVE_TOOL_STALLED')
    expect(f.start.mock.calls.map(([, request]) => request.agentOptions)).toMatchObject([textRoute, textRoute, textRoute])
    expect(f.disposed).toEqual(['text-1', 'text-2', 'text-3'])
    const correction = f.start.mock.calls[1][1].prompt.map(part => part.type === 'text' ? part.text : '').join('\n')
    expect(correction).toContain('value.outputs')
    expect(correction).toContain('outputs必须是原生对象')
    const attempts = run.moduleRuns[0].executionAudit.attempts as any[]
    expect(attempts).toHaveLength(3)
    expect(attempts.every(a => a.submissionState === 'not-submitted' && !a.structuredOutput)).toBe(true)
    expect(attempts.every(a => a.nativeToolStall.repeatedCalls === 3)).toBe(true)
    expect(rejectedArguments).toContain('"outputs":"{\\"project_brief\\":{}}"')
  })
  it.each(['group-step-string', 'group-step-empty', 'group-step-missing', 'group-legacy-v3'] as const)(
    'rejects %s at the v5 native boundary without coercion, route changes, or an independent review', async mode => {
      const { createNativeModuleRuntime } = await api(false), f = await fixture(mode)
      const run = await createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes }).execute(f.parent, f.request)
      expect(run.status).toBe('partial'); expect(run.results).toEqual([])
      expect(run.moduleRuns[0].error).toContain('MODULE_NATIVE_SCHEMA_INVALID')
      expect(f.start.mock.calls.map(([, request]) => request.agentOptions)).toMatchObject([textRoute, textRoute, textRoute])
      for (const [, request] of f.start.mock.calls) {
        expect(request.outputSchema?.properties?.projectionVersion.const).toBe('module-author-field-group.v8')
        expect(request.outputSchema?.required).toContain('stepResults'); expect(request.outputSchema?.properties).not.toHaveProperty('steps')
      }
    })
  it.each(['schema-once', 'malformed-json-once'] as const)('sends the exact rejected %s submission and error to the fresh correction child as untrusted data', async mode => {
    const { createNativeModuleRuntime } = await api(false), f = await fixture(mode)
    const run = await createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes }).execute(f.parent, f.request)
    expect(run.status).toBe('partial')
    expect(f.start.mock.calls.map(([, request]) => request.agentOptions)).toMatchObject([textRoute, textRoute, textRoute, textRoute, textRoute, reviewRoute])
    const first = run.results[0].execution.attempts.find((attempt: any) => attempt.childId === 'text-1')
    const correction = f.start.mock.calls[1][1].prompt.map(part => part.type === 'text' ? part.text : '').join('\n')
    const contextLine = correction.split('\n').find(line => line.startsWith('{"correctionContext":'))
    expect(contextLine).toBeDefined()
    expect(JSON.parse(contextLine!).correctionContext).toMatchObject({ accepted: false, untrusted: true, error: first.error,
      submissionState: 'included', structuredOutput: first.structuredOutput })
    expect(first.status).toBe('failed')
    expect(first.structuredHash).toBe(sha256CanonicalJson(first.structuredOutput))
    const executions = await f.classes.executions('project')
    expect(executions.find(row => row.childId === 'text-2')?.correctionFromExecutionId).toBe(first.executionId)
  })
  it('omits an oversized rejected submission as a whole JSON value while retaining the exact error and original audit payload', async () => {
    const { createNativeModuleRuntime } = await api(false), f = await fixture('oversized-schema-once')
    const run = await createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes }).execute(f.parent, f.request)
    expect(run.status).toBe('partial')
    const first = run.results[0].execution.attempts.find((attempt: any) => attempt.childId === 'text-1')
    const correction = f.start.mock.calls[1][1].prompt.map(part => part.type === 'text' ? part.text : '').join('\n')
    const contextLine = correction.split('\n').find(line => line.startsWith('{"correctionContext":'))
    expect(contextLine).toBeDefined()
    const context = JSON.parse(contextLine!).correctionContext
    expect(context).toMatchObject({ accepted: false, untrusted: true, error: first.error, submissionState: 'omitted',
      serializedChars: JSON.stringify(first.structuredOutput).length, maxSubmissionChars: 24_000 })
    expect(context).not.toHaveProperty('structuredOutput')
    expect(context.omissionReason).toBe('complete submission exceeds correction context budget')
    expect(correction).not.toContain('rejected-large-submission-only-marker')
    expect(JSON.stringify(first.structuredOutput)).toContain('rejected-large-submission-only-marker')
  })
  it('gives the native correction child a complete lossless readonly view when a rejected draft fits only after sharing repeated context', async () => {
    const { createNativeModuleRuntime } = await api(false), f = await fixture('compactable-schema-once')
    const { expandModuleReferencePromptView } = await import('../src/research-v2/module-reference-context.ts')
    const run = await createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes }).execute(f.parent, f.request)
    const first = run.results[0].execution.attempts.find((attempt: any) => attempt.childId === 'text-1')
    const correction = f.start.mock.calls[1][1].prompt.map(part => part.type === 'text' ? part.text : '').join('\n')
    const context = JSON.parse(correction.split('\n').find(line => line.startsWith('{"correctionContext":'))!).correctionContext
    expect(context).toMatchObject({ accepted: false, untrusted: true, error: first.error, submissionState: 'included-readonly-view', serializedChars: JSON.stringify(first.structuredOutput).length })
    expect(context.serializedChars).toBeGreaterThan(24_000)
    expect(JSON.stringify(context.structuredOutputView).length).toBeLessThanOrEqual(24_000)
    expect(expandModuleReferencePromptView(context.structuredOutputView)).toEqual(first.structuredOutput)
    expect(first.structuredHash).toBe(sha256CanonicalJson(first.structuredOutput))
    expect(first.status).toBe('failed')
    expect(correction).toContain('structuredOutputView')
  })
  it('keeps exact missing-field diagnostic excerpts when the complete rejected submission still exceeds the correction budget', async () => {
    const { createNativeModuleRuntime } = await api(false), f = await fixture('missing-evidence-oversized-once')
    const run = await createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes }).execute(f.parent, f.request)
    const first = run.results[0].execution.attempts.find((attempt: any) => attempt.childId === 'text-1')
    const correction = f.start.mock.calls[1][1].prompt.map(part => part.type === 'text' ? part.text : '').join('\n')
    const context = JSON.parse(correction.split('\n').find(line => line.startsWith('{"correctionContext":'))!).correctionContext
    expect(context.submissionState).toBe('omitted')
    expect(context.diagnosticExcerpt).toMatchObject({ scope: 'missing-field-evidence-conflicts-only', completeSubmission: false, originalSubmissionHash: first.structuredHash })
    expect(context.diagnosticExcerpt.fieldEvidenceConflicts).toHaveLength(1)
    const excerpt = context.diagnosticExcerpt.fieldEvidenceConflicts[0]
    expect(excerpt.target).toEqual(first.structuredOutput.evidence[excerpt.evidenceIndex].target)
    expect(excerpt.field).toEqual(first.structuredOutput.outputs.project_brief.records[0].formalName)
    expect(excerpt.field).toMatchObject({ value: null, claimClass: 'missing' })
    expect(JSON.stringify(context.diagnosticExcerpt).length).toBeLessThanOrEqual(24_000)
    expect(first.status).toBe('failed')
    expect(first.structuredHash).toBe(sha256CanonicalJson(first.structuredOutput))
  })
  it('retains precise kind/member conflicts when an oversized rejected native draft is omitted', async () => {
    const { createNativeModuleRuntime } = await api(false), f = await fixture('kind-evidence-oversized-once')
    const run = await createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes }).execute(f.parent, f.request)
    const first = run.results[0].execution.attempts.find((a:any) => a.childId === 'text-1')
    const prompt = f.start.mock.calls[1][1].prompt.map(p => p.type === 'text' ? p.text : '').join('\n')
    const context = JSON.parse(prompt.split('\n').find(line => line.startsWith('{"correctionContext":'))!).correctionContext
    expect(context.submissionState).toBe('omitted')
    expect(context.diagnosticExcerpt).toMatchObject({scope:'evidence-kind-member-conflicts-only',completeSubmission:false,originalSubmissionHash:first.structuredHash})
    expect(context.diagnosticExcerpt.fieldEvidenceKindConflicts).toEqual([{evidenceIndex:0,target:first.structuredOutput.evidence[0].target,kind:'proposal',memberPresence:{source:true,calculation:false},diagnostic:'source must be absent for kind=proposal (received present)'}])
    expect(context).not.toHaveProperty('structuredOutput')
    expect(JSON.stringify(context.diagnosticExcerpt)).not.toContain('uncompressible-kind-rejection-marker')
    expect(first.structuredHash).toBe(sha256CanonicalJson(first.structuredOutput))
    expect(first.structuredOutput.evidence[0]).toHaveProperty('source')
    expect(run.status).toBe('partial')
  })
  it('returns both repeated evidence identities to the native correction and retains the original rejection',async()=>{
    const {createNativeModuleRuntime}=await api(false),f=await fixture('duplicate-evidence-once')
    const run=await createNativeModuleRuntime({subagents:f.subagents,agentClasses:f.classes}).execute(f.parent,f.request)
    const first=run.results[0].execution.attempts.find((a:any)=>a.childId==='text-1')
    expect(first.status).toBe('failed');expect(first.error).toContain('MODULE_GROUP_EVIDENCE_DUPLICATE')
    const prompt=f.start.mock.calls[1][1].prompt.map(p=>p.type==='text'?p.text:'').join('\n'),context=JSON.parse(prompt.split('\n').find(l=>l.startsWith('{"correctionContext":'))!).correctionContext
    expect(context.diagnosticExcerpt).toMatchObject({scope:'field-evidence-target-duplicates-only',originalSubmissionHash:first.structuredHash,
      fieldEvidenceDuplicateConflicts:[{target:first.structuredOutput.evidence[0].target,repeatCount:2,evidenceIndexes:[0,first.structuredOutput.evidence.length-1]}]})
    expect(prompt).toContain('同一个精确target只能有一条evidence')
    expect(first.structuredOutput.evidence.at(-1)).toEqual(first.structuredOutput.evidence[0])
  })
  it('returns the exact owner error to the native correction without changing its original receipt',async()=>{
    const {createNativeModuleRuntime}=await api(false),f=await fixture('owner-evidence-once')
    const run=await createNativeModuleRuntime({subagents:f.subagents,agentClasses:f.classes}).execute(f.parent,f.request)
    const first=run.results[0].execution.attempts.find((a:any)=>a.childId==='text-1')
    expect(first.status).toBe('failed');expect(first.error).toContain('MODULE_GROUP_EVIDENCE_OWNER')
    const prompt=f.start.mock.calls[1][1].prompt.map(p=>p.type==='text'?p.text:'').join('\n')
    const context=JSON.parse(prompt.split('\n').find(l=>l.startsWith('{"correctionContext":'))!).correctionContext
    expect(context.diagnosticExcerpt).toMatchObject({originalSubmissionHash:first.structuredHash,
      fieldEvidenceOwnerConflicts:[{target:first.structuredOutput.evidence[0].target,reasons:['record-not-in-submission']}]})
    expect(prompt).toContain('不选择替代recordId')
    expect(first.structuredOutput.evidence[0].target.recordId).toBe('synthetic-owner-typo')
    expect(first.structuredHash).toBe(sha256CanonicalJson(first.structuredOutput))
  })
  it('sends owning field and missing dependency diagnostics to an immediate local-reference correction',async()=>{
    const {createNativeModuleRuntime}=await api(false),f=await fixture('local-reference-once')
    const run=await createNativeModuleRuntime({subagents:f.subagents,agentClasses:f.classes}).execute(f.parent,f.request)
    const first=run.results[0].execution.attempts.find((a:any)=>a.childId==='text-1')
    expect(first.error).toContain('MODULE_PROJECTION_REFERENCE');expect(first.status).toBe('failed')
    const prompt=f.start.mock.calls[1][1].prompt.map(p=>p.type==='text'?p.text:'').join('\n'),context=JSON.parse(prompt.split('\n').find(l=>l.startsWith('{"correctionContext":'))!).correctionContext
    expect(context.diagnosticExcerpt).toMatchObject({scope:'local-reference-address-conflicts-only',completeSubmission:false,originalSubmissionHash:first.structuredHash,
      fieldLocalReferenceConflicts:[{target:{port:'project_brief',recordId:'project-row',field:'formalName',at:''},referencedTarget:{port:'project_brief',recordId:'project-row',field:'aliases',at:'/0'},reason:'field-missing',registeredEvidenceTargets:[]}]})
    expect(prompt).toContain('规模不能证明营业状态');expect(first.structuredOutput.outputs.project_brief.records[0].aliases.claimClass).toBe('missing')
  })
  it('uses the centrally accepted prior group for immediate combined member and dependency diagnostics',async()=>{
    const {createNativeModuleRuntime}=await api(false),f=await fixture('prior-group-reference-once')
    const run=await createNativeModuleRuntime({subagents:f.subagents,agentClasses:f.classes}).execute(f.parent,f.request)
    const attempts=run.results[0].execution.attempts as any[],prior=attempts.find(a=>a.childId==='text-1'),first=attempts.find(a=>a.childId==='text-2')
    expect(prior.status).toBe('completed');expect(first.status).toBe('failed')
    const prompt=f.start.mock.calls[2][1].prompt.map(p=>p.type==='text'?p.text:'').join('\n')
    const context=JSON.parse(prompt.split('\n').find(l=>l.startsWith('{"correctionContext":'))!).correctionContext
    expect(context.diagnosticExcerpt).toMatchObject({scope:'field-protocol-conflicts-only',completeSubmission:false,originalSubmissionHash:first.structuredHash,
      fieldLocalReferenceConflicts:[{evidenceIndex:0,target:{port:'project_brief',recordId:'project-row',field:'principal',at:''},
        referencedTarget:{port:'project_brief',recordId:'project-row',field:'aliases',at:'/0'},reason:'field-missing',registeredEvidenceTargets:[]}]})
    expect(context.diagnosticExcerpt.fieldEvidenceKindConflicts).toHaveLength(1)
    expect(first.structuredHash).toBe(sha256CanonicalJson(first.structuredOutput))
    expect(prior.structuredHash).toBe(sha256CanonicalJson(prior.structuredOutput))
    expect(prior.structuredOutput.outputs.project_brief.records[0].aliases).toMatchObject({value:null,claimClass:'missing'})
    expect(prompt).toContain('field-missing表示依赖字段缺失')
  })
  it('carries literal-binding progress into the immediate native correction while its previous draft remains rejected',async()=>{
    const {createNativeModuleRuntime}=await api(false),f=await fixture('source-binding-progress-once')
    const run=await createNativeModuleRuntime({subagents:f.subagents,agentClasses:f.classes}).execute(f.parent,f.request)
    const first=(run.results[0].execution.attempts as any[]).find(value=>value.childId==='text-1')
    const prompt=f.start.mock.calls[1][1].prompt.map(value=>value.type==='text'?value.text:'').join('\n')
    const correction=JSON.parse(prompt.split('\n').find(line=>line.startsWith('{"correctionContext":'))!).correctionContext
    expect(first.status).toBe('failed');expect(correction.accepted).toBe(false)
    expect(correction.sourceBindingProgress).toMatchObject({scope:'literal-source-bindings-only',originalSubmissionHash:first.structuredHash,
      verifiedBindingCount:1,bindings:[{target:{port:'project_brief',recordId:'project-row',field:'aliases',at:'/0'},path:'原始资料/source.pdf',page:2}]})
    expect(prompt).toContain('保持已经核验的path/page/quote与字段值绑定')
    expect(run.results[0].execution.reviewReceipts.at(-1).childId).toBe('review-1')
    expect(first.structuredHash).toBe(sha256CanonicalJson(first.structuredOutput))
  })
  it.each(['source-text-once','unsupported-source','missing-source-path-once','missing-web-path-and-text-once','source-quote-whitespace-once','source-quote-whitespace-empty-once'] as const)('sends exact field source diagnostics to an immediate %s correction without accepting the rejected draft',async mode=>{
    const {createNativeModuleRuntime}=await api(false),f=await fixture(mode)
    const run=await createNativeModuleRuntime({subagents:f.subagents,agentClasses:f.classes}).execute(f.parent,f.request)
    const attempts=(run.moduleRuns[0].executionAudit?.attempts??run.results[0]?.execution.attempts) as any[]
    const first=attempts.find(a=>a.childId==='text-1'),prompt=f.start.mock.calls[1][1].prompt.map(p=>p.type==='text'?p.text:'').join('\n')
    const correction=JSON.parse(prompt.split('\n').find(line=>line.startsWith('{"correctionContext":'))!).correctionContext
    expect(first.status).toBe('failed');expect(first.error).toMatch(/MODULE_SOURCE_VALUE_(TEXT|QUOTE)|MODULE_PROJECTION_SOURCE_LOCATION/u)
    expect(correction.diagnosticExcerpt).toMatchObject({scope:'source-text-bindings-only',completeSubmission:false,originalSubmissionHash:first.structuredHash})
    const expectedCode=mode==='source-text-once'?'MODULE_SOURCE_VALUE_TEXT':mode.startsWith('missing-')?'MODULE_PROJECTION_SOURCE_LOCATION':'MODULE_SOURCE_VALUE_QUOTE'
    expect(correction.diagnosticExcerpt.fieldTextConflicts).toHaveLength(1)
    expect(correction.diagnosticExcerpt.fieldTextConflicts[0]).toMatchObject({target:first.structuredOutput.evidence[0].target,diagnosticCode:expectedCode})
    if(mode==='missing-source-path-once')expect(correction.diagnosticExcerpt.fieldTextConflicts[0].quoteLocationMatches).toMatchObject([{path:'原始资料/source.pdf',page:2,literalExactMatch:true}])
    if(mode==='missing-web-path-and-text-once'){
      expect(correction.diagnosticExcerpt.fieldTextConflicts[0].sourceValueSupportDiagnostic).toMatchObject({diagnosticOnly:true,unchangedValueRejectedAtEveryQuotedLocation:true,
        checkedLocations:[{path:'原始资料/source.pdf',page:2,diagnosticCode:'MODULE_SOURCE_VALUE_TEXT'}]})
      expect(prompt).toContain('source.path须逐字复制冻结documents.path')
      expect(run.results[0].outputs.project_brief.records[0].formalName.value).toBe('Shaotanhe Reservoir')
      expect(run.results[0].execution.reviewReceipts[0].childId).toBe('review-1')
    }
    if(mode.startsWith('source-quote-whitespace-')){
      const conflict=correction.diagnosticExcerpt.fieldTextConflicts[0]
      expect(conflict.sourceQuoteWhitespaceDiagnostic).toMatchObject({diagnosticOnly:true,sourceExcerpt:'Shaotanhe Reservoir,\nproject-id',sourceExcerptStart:0,
        sourceWhitespaceContexts:expect.arrayContaining([{sourceOffset:20,codePoints:['U+000A'],before:'ervoir,',after:'project'}])})
      expect(prompt).toContain('quote和绑定字段value须同时核对')
      expect(run.results[0].outputs.project_brief.records[0].formalName.value).toBe('Shaotanhe Reservoir,\nproject-id')
      expect(run.results[0].execution.reviewReceipts[0].childId).toBe('review-1')
      if(mode==='source-quote-whitespace-empty-once'){
        const thirdPrompt=f.start.mock.calls[2][1].prompt.map(p=>p.type==='text'?p.text:'').join('\n')
        const third=JSON.parse(thirdPrompt.split('\n').find(line=>line.startsWith('{"correctionContext":'))!).correctionContext
        expect(third).toMatchObject({submissionState:'not-submitted',previousStructuredRejection:{originalSubmissionHash:first.structuredHash,
          diagnosticExcerpt:{fieldTextConflicts:[{target:conflict.target,sourceQuoteWhitespaceDiagnostic:conflict.sourceQuoteWhitespaceDiagnostic}]}}})
        expect(thirdPrompt).toContain('quote和绑定字段value须同时核对')
      }
    }
    expect(first.structuredHash).toBe(sha256CanonicalJson(first.structuredOutput))
    expect(prompt).toContain('fieldTextConflicts');expect(prompt).toContain('不能冒充原文')
  })
  it('rejects scalar text unit declarations before complete merge and sends original targets to its finite native correction',async()=>{
    const {createNativeModuleRuntime}=await api(false),f=await fixture('unit-once')
    const run=await createNativeModuleRuntime({subagents:f.subagents,agentClasses:f.classes}).execute(f.parent,f.request)
    // Inspect the actual first native request contract, before any rejection.
    // Late correction feedback cannot prevent exhausting the finite attempts.
    const initialPrompt=f.start.mock.calls[0][1].prompt.map(p=>p.type==='text'?p.text:'').join('\n')
    expect(initialPrompt).toContain('evidence.unit')
    expect(initialPrompt).toContain('日期表示格式')
    expect(initialPrompt).toContain('目标实际选中的value容器')
    const attempts=run.moduleRuns[0].executionAudit?.attempts??run.results[0]?.execution.attempts
    const first=attempts.find((a:any)=>a.childId==='text-1') as any
    expect(first.status).toBe('failed');expect(first.error).toContain('MODULE_CLAIM_UNIT_MISMATCH')
    const prompt=f.start.mock.calls[1][1].prompt.map(p=>p.type==='text'?p.text:'').join('\n')
    const context=JSON.parse(prompt.split('\n').find(l=>l.startsWith('{"correctionContext":'))!).correctionContext
    expect(context.diagnosticExcerpt).toMatchObject({scope:'unit-bindings-only',completeSubmission:false,originalSubmissionHash:first.structuredHash})
    expect(context.diagnosticExcerpt.fieldUnitConflicts).toMatchObject([{target:first.structuredOutput.evidence[0].target,declaredUnit:'元',containerUnit:null}])
    expect(run.moduleRuns[0].status).toBe('limited')
  })
  it.each(['kind-evidence-oversized-empty-once','kind-evidence-oversized-wire-once'] as const)('keeps the last precise structured rejection hash and addresses across %s', async mode => {
    const { createNativeModuleRuntime } = await api(false), f = await fixture(mode)
    const run = await createNativeModuleRuntime({ subagents:f.subagents,agentClasses:f.classes }).execute(f.parent,f.request)
    const attempts = run.results[0].execution.attempts as any[], first=attempts.find(a=>a.childId==='text-1'),empty=attempts.find(a=>a.childId==='text-2')
    const prompt=f.start.mock.calls[2][1].prompt.map(p=>p.type==='text'?p.text:'').join('\n')
    const contexts=prompt.split('\n').filter(line=>line.startsWith('{"correctionContext":'))
    expect(contexts).toHaveLength(1)
    const context=JSON.parse(contexts[0]).correctionContext
    expect(context.submissionState).toBe(mode==='kind-evidence-oversized-empty-once'?'not-submitted':'included')
    expect(context.error).toBe(empty.error)
    expect(context.previousStructuredRejection).toMatchObject({error:first.error,originalSubmissionHash:first.structuredHash,authorExecutionId:first.executionId,authorChildId:first.childId,
      diagnosticExcerpt:{scope:'evidence-kind-member-conflicts-only',completeSubmission:false,originalSubmissionHash:first.structuredHash}})
    expect(context.previousStructuredRejection.diagnosticExcerpt.fieldEvidenceKindConflicts[0].target).toEqual(first.structuredOutput.evidence[0].target)
    expect(context.previousStructuredRejection).not.toHaveProperty('structuredOutput')
    if(mode==='kind-evidence-oversized-empty-once')expect(empty).not.toHaveProperty('structuredOutput')
    else expect(empty.structuredOutput).toMatchObject({wireVersion:'native-frozen-submission.v2',records:[{recordJson:'{"broken":'}]})
    expect(run.status).toBe('partial')
  })
  it('binds member alternatives to the actual native tool while preserving specific central rejection diagnostics',async()=>{
    const {createNativeModuleRuntime}=await api(false),f=await fixture('kind-evidence-oversized-once')
    const run=await createNativeModuleRuntime({subagents:f.subagents,agentClasses:f.classes}).execute(f.parent,f.request)
    const nativeSchema=f.start.mock.calls[0][1].outputSchema
    expect(validateJsonSchemaValue(nativeSchema!.properties!.evidence.items!,{
      target:{port:'project_brief',recordId:'row-1',field:'formalName',at:''},kind:'proposal',
    })).not.toEqual([])
    const frozenPaths=[...new Set(f.request.corpus.documents.map(document=>document.path))]
    let sourceLocations=0
    function assertFrozenPaths(node:any){
      if(node?.properties?.path&&node.properties.quote){
        sourceLocations++;expect(node.properties.path.enum).toEqual(frozenPaths)
        expect(node.properties.quote.enum).toBeUndefined()
      }
      Object.values(node?.properties??{}).forEach(assertFrozenPaths)
      if(node?.items)assertFrozenPaths(node.items)
      node?.oneOf?.forEach(assertFrozenPaths)
    }
    assertFrozenPaths(nativeSchema?.properties?.evidence.items);expect(sourceLocations).toBeGreaterThan(1)
    const attempts=run.results[0].execution.attempts as any[]
    expect(attempts.find(a=>a.childId==='text-1').error).toContain('MODULE_PROJECTION_EVIDENCE_KIND')
    const prompt=f.start.mock.calls[1][1].prompt.map(p=>p.type==='text'?p.text:'').join('\n')
    expect(prompt).toContain('evidence-kind-member-conflicts-only')
  })
  it('keeps all unmatched step evidence addresses when the oversized rejected draft is omitted',async()=>{
    const {createNativeModuleRuntime}=await api(false),f=await fixture('step-evidence-oversized-once')
    const run=await createNativeModuleRuntime({subagents:f.subagents,agentClasses:f.classes}).execute(f.parent,f.request)
    const first=run.results[0].execution.attempts.find((a:any)=>a.childId==='text-1')
    const prompt=f.start.mock.calls[1][1].prompt.map(p=>p.type==='text'?p.text:'').join('\n')
    const context=JSON.parse(prompt.split('\n').find(l=>l.startsWith('{"correctionContext":'))!).correctionContext
    expect(context.submissionState).toBe('omitted')
    expect(context.diagnosticExcerpt).toMatchObject({scope:'field-protocol-conflicts-only',completeSubmission:false,originalSubmissionHash:first.structuredHash,
      stepEvidenceConflicts:[{target:first.structuredOutput.stepResults.step1.fieldRefs[0],fieldRefPaths:['/stepResults/step1/fieldRefs/0','/stepResults/step2/fieldRefs/0','/stepResults/step3/fieldRefs/0','/stepResults/step4/fieldRefs/0']}]})
    expect(context.diagnosticExcerpt.fieldEvidenceCoverageGaps).toContainEqual(expect.objectContaining({target:first.structuredOutput.stepResults.step1.fieldRefs[0],evidenceCount:0}))
    expect(first.structuredOutput.evidence).toEqual([])
    expect(context).not.toHaveProperty('structuredOutput')
    expect(run.status).toBe('partial')
  })
  it('replaces correction context with the most recent rejected submission without accumulating older payloads', async () => {
    const { createNativeModuleRuntime } = await api(false), f = await fixture('schema-twice')
    const run = await createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes }).execute(f.parent, f.request)
    expect(run.status).toBe('partial')
    const attempts = run.results[0].execution.attempts as any[]
    const first = attempts.find(attempt => attempt.childId === 'text-1'), second = attempts.find(attempt => attempt.childId === 'text-2')
    const correction = f.start.mock.calls[2][1].prompt.map(part => part.type === 'text' ? part.text : '').join('\n')
    const contextLines = correction.split('\n').filter(line => line.startsWith('{"correctionContext":'))
    expect(contextLines).toHaveLength(1)
    const context = JSON.parse(contextLines[0]).correctionContext
    expect(context.structuredOutput).toEqual(second.structuredOutput)
    expect(context.structuredOutput).not.toEqual(first.structuredOutput)
    expect(context.error).toBe(second.error)
    expect(f.start.mock.calls.map(([, request]) => request.agentOptions)).toMatchObject([textRoute, textRoute, textRoute, textRoute, textRoute, textRoute, reviewRoute])
  })
  it('keeps an authorized availability fallback on the original prompt without manufacturing a rejected submission', async () => {
    const { createNativeModuleRuntime } = await api(false), f = await fixture('availability-once')
    const run = await createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes }).execute(f.parent, f.request)
    expect(run.status).toBe('partial')
    expect(f.start.mock.calls.map(([, request]) => request.agentOptions)).toMatchObject([textRoute, backup, textRoute, textRoute, textRoute, reviewRoute])
    expect(f.start.mock.calls[1][1].prompt).toEqual(f.start.mock.calls[0][1].prompt)
    const first = run.results[0].execution.attempts.find((attempt: any) => attempt.childId === 'text-1')
    expect(first.submissionState).toBe('not-submitted'); expect(first).not.toHaveProperty('structuredOutput')
    const executions = await f.classes.executions('project')
    expect(executions.find(row => row.childId === 'text-2')?.fallbackFromExecutionId).toBe(first.executionId)
  })
  it('keeps one configured model and no fallback while requiring separate author and reviewer sessions', async () => {
    const { createNativeModuleRuntime } = await api(false), f = await fixture('same-route')
    const run = await createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes }).execute(f.parent, f.request)
    expect(run.status).toBe('partial')
    expect(f.start.mock.calls.map(([, r]) => r.agentOptions)).toMatchObject(Array.from({ length: 5 }, () => textRoute))
    expect(new Set(run.results[0].execution.attempts.map((a: any) => a.childId)).size).toBe(5)
  })
  it('delivers the central all-missing rejection to fresh native groups without accepting the unchanged empty candidate', async () => {
    const { createNativeModuleRuntime } = await api(false), f = await fixture('empty-output')
    const runtime = createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes })
    const first = await runtime.execute(f.parent, f.request)
    expect(first.moduleRuns[0].error).toContain('MODULE_EMPTY_PROFESSIONAL_CONCLUSION')
    expect(first.moduleRuns[0].executionAudit?.attempts).toHaveLength(4)
    expect(first.moduleRuns[0].executionAudit?.reviewReceipts).toEqual([])
    const next = await runtime.execute(f.parent, { ...f.request, resumeRunIds: [first.manifestRunId] })
    const prompt = f.start.mock.calls[4][1].prompt.map((part: any) => part.type === 'text' ? part.text : '').join('\n')
    const line = prompt.split('\n').find((line: string) => line.startsWith('{"previousRejection":'))
    expect(line).toBeDefined()
    expect(JSON.parse(line!).previousRejection.moduleError).toBe(first.moduleRuns[0].error)
    expect(prompt).toContain('不得填占位值')
    expect(next.moduleRuns[0].error).toContain('MODULE_EMPTY_PROFESSIONAL_CONCLUSION')
    expect(next.results).toEqual([])
    expect(next.moduleRuns[0].executionAudit?.reviewReceipts).toEqual([])
  })
  it('uses four bounded native authors then one independent reviewer with unchanged routes and previous raw values', async () => {
    const { createNativeModuleRuntime } = await api(false), f = await fixture()
    const run = await createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes }).execute(f.parent, f.request)
    expect(run.status).toBe('partial')
    expect(f.start.mock.calls.map(([, r]) => r.agentOptions)).toMatchObject([textRoute, textRoute, textRoute, textRoute, reviewRoute])
    const stored = await readModuleExecutionResult(f.root, run.moduleRuns[0].bundleRunId)
    expect(stored.execution?.kind).toBe('author-field-groups-v3')
    if (!stored.execution || stored.execution.kind !== 'author-field-groups-v3') throw new Error('grouped execution required')
    expect(stored.execution.authorGroups.groups).toHaveLength(4)
    expect(stored.execution.authorGroups.version).toBe('module-author-field-group.v8')
    for (const group of stored.execution.authorGroups.groups) {
      expect(group.raw.projectionVersion).toBe('module-author-field-group.v8')
      expect(group.raw).not.toHaveProperty('outputsJson')
      expect(group.raw).not.toHaveProperty('steps')
      expect(Object.keys((group.raw as any).stepResults)).toEqual(['step1', 'step2', 'step3', 'step4'])
    }
    expect(stored.execution.authorGroups.groups.map(g => g.receipt.childId)).toEqual(['text-1', 'text-2', 'text-3', 'text-4'])
    expect(stored.execution.attempts).toHaveLength(5)
    for (const group of stored.execution.authorGroups.groups) expect(stored.execution.attempts).toContainEqual(expect.objectContaining({
      childId: group.receipt.childId, groupId: group.raw.groupId, structuredOutput: group.raw, structuredHash: group.projectionHash, outputsJsonHash: group.outputsJsonHash,
    }))
    const second = f.start.mock.calls[1][1].prompt.map(p => p.type === 'text' ? p.text : '').join('\n')
    expect(second).toContain('previousAuthorGroups'); expect(second).toContain('Shaotanhe Reservoir')
    const { expandModuleReferencePromptView } = await import('../src/research-v2/module-reference-context.ts')
    const previous: any = expandModuleReferencePromptView(JSON.parse(second.split('\n').find(line => line.startsWith('{"currentGroup":'))!).previousAuthorGroups)
    const portSchema = f.start.mock.calls[1]![1].outputSchema!.properties!.outputs.properties!.project_brief
    const frozenLine = second.split('\n').find(line => line.startsWith('{"frozenGroupAnchors":'))
    expect(frozenLine, 'later authors receive exact immutable metadata outside the large source and schema blocks').toBeDefined()
    expect(JSON.parse(frozenLine!).frozenGroupAnchors).toEqual({
      port: 'project_brief', type: previous.outputs.project_brief.type,
      scope: previous.outputs.project_brief.scope, asOf: previous.outputs.project_brief.asOf,
      records: previous.outputs.project_brief.records.map(({ recordId, resultClass }: any) => ({ recordId, resultClass })),
    })
    expect(second.indexOf(frozenLine!)).toBeLessThan(second.indexOf('本组完整输出Schema'))
    expect(frozenLine).not.toContain('formalName')
    expect(f.start.mock.calls[0][1].prompt.map(p => p.type === 'text' ? p.text : '').join('\n')).not.toContain('"frozenGroupAnchors"')
    expect(second).toContain('本组字段范围变化不能改写端口scope')
    expect(portSchema.properties!.scope.const).toBe(previous.outputs.project_brief.scope)
    expect(portSchema.properties!.asOf.const).toBe(previous.outputs.project_brief.asOf)
    expect(portSchema.properties!.records.items!.properties!.recordId.enum).toEqual(previous.outputs.project_brief.records.map((record: any) => record.recordId))
    expect(previous.outputs.project_brief.records[0].formalName.value).toBe('Shaotanhe Reservoir')
    expect(previous.groupReceipts).toHaveLength(1)
    expect(previous).not.toHaveProperty('evidence')
    expect(previous.outputs.project_brief.records[0].formalName).toMatchObject({ value: 'Shaotanhe Reservoir' })
    expect(second).toContain('missing字段禁止notApplicableReason')
    expect(second).toContain('不得替代当前策划委托方、业务授权或决策依据')
    expect(second).toContain('中央只展开固定步骤身份，不补写方法、说明、状态或引用')
    const scoped = JSON.parse(second.split('\n').find(line => line.startsWith('{"task":'))!)
    expect(scoped).not.toHaveProperty('spec'); expect(scoped.task).not.toHaveProperty('figures')
    expect(scoped.task.fields.map((f: any) => f.name)).toEqual(['principal', 'projectNature', 'initiationBasis', 'decisionsSupported'])
    expect(scoped.task.qa).toEqual(getResearchModuleSpec('1.01').qa)
    expect(scoped.task.workPlan).toMatchObject({
      version: 'module-group-work-plan.v1', groupId: 'project_brief:2',
      assignedFields: ['principal', 'projectNature', 'initiationBasis', 'decisionsSupported'],
      otherGroups: expect.arrayContaining([expect.objectContaining({ groupId: 'project_brief:1' })]),
      unresolvedDependencies: 'preserve-limitations-no-substitution',
      completionAuthority: 'merged-candidate-and-independent-review',
    })
    expect(scoped.task.steps.map((step: any) => step.instruction)).toEqual(getResearchModuleSpec('1.01').steps)
    expect(second).toContain('本组工作分工')
    expect(second).toContain('不能通过反复推演、扩大字段范围或删去限制补足缺失资料')
    const review = f.start.mock.calls.at(-1)![1].prompt.map(p => p.type === 'text' ? p.text : '').join('\n')
    expect(review).not.toContain('"frozenGroupAnchors"')
    expect(review).toContain(stored.execution.authorGroups.compiledCandidateHash)
    for (const prompt of [second, review]) {
      expect(prompt).toContain('calculation.basis="scenario"')
      expect(prompt).toContain('禁止补写01')
      expect(prompt).toContain('质量验收与法定审批分别判断')
      expect(prompt).toContain('acquired的error是未采纳候选的失败诊断')
      expect(prompt).toContain('关键研究确实缺失时仍须limited')
    }
    expect(stored.execution.steps?.every(s => s.status === 'limited')).toBe(true)
  })
  it.each(['group-review-same-author', 'group-fail-last'] as const)('does not publish %s and preserves every submitted author payload', async mode => {
    const { createNativeModuleRuntime } = await api(false), f = await fixture(mode)
    const run = await createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes }).execute(f.parent, f.request)
    expect(run.status).toBe('partial'); expect(run.results).toHaveLength(0)
    expect(run.moduleRuns[0].error).toMatch(mode === 'group-review-same-author' ? /MODULE_REVIEW/ : /MODULE_NATIVE_SCHEMA_INVALID/)
    const attempts = run.moduleRuns[0].executionAudit!.attempts as any[]
    expect(attempts.filter(a => a.classId === 'text' && a.status === 'completed').length).toBeGreaterThanOrEqual(3)
    expect(attempts.filter(a => a.classId === 'text').every(a => a.structuredOutput && a.structuredHash && a.outputsJsonHash)).toBe(true)
  })
  it.each([
    ['unsupported-source', 'MODULE_SOURCE_VALUE_QUOTE'],
    ['group-missing-reason', 'administrativeCode'],
    ['group-uncovered-alias', 'MODULE_CLAIM_VALUE_UNCOVERED: /outputs/project_brief/records/0/aliases/value/1'],
    ['group-uncovered-cycle', 'MODULE_CLAIM_VALUE_UNCOVERED: /outputs/project_brief/records/0/aliases/value/1'],
  ] as const)('corrects only the current group for %s and preserves invalid native submissions before any later group or review', async (mode, error) => {
    const { createNativeModuleRuntime } = await api(false), f = await fixture(mode)
    const run = await createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes }).execute(f.parent, f.request)
    expect(run.status).toBe('partial'); expect(run.results).toHaveLength(0)
    expect(run.moduleRuns[0].error).toContain(error)
    expect(f.start.mock.calls.length).toBeGreaterThan(1)
    expect(f.start.mock.calls.every(([, r]) => r.outputSchema?.properties?.groupId?.const === 'project_brief:1')).toBe(true)
    const correction = f.start.mock.calls[1][1].prompt.map(p => p.type === 'text' ? p.text : '').join('\n')
    expect(correction).toContain(error)
    if(mode==='group-uncovered-alias'||mode==='group-uncovered-cycle'){
      const {moduleFieldEvidenceLeafCoverageProtocol}=await import('../src/research-v2/module-field-protocol-diagnostics.ts')
      expect(correction).toContain(moduleFieldEvidenceLeafCoverageProtocol)
      const context=JSON.parse(correction.split('\n').find(line=>line.startsWith('{"correctionContext":'))!).correctionContext
      expect(context.diagnosticExcerpt).toMatchObject({originalSubmissionHash:sha256CanonicalJson(context.structuredOutput),fieldEvidenceLeafCoverageGaps:[
        {target:{port:'project_brief',field:'aliases',at:'/1'}}]})
      if(mode==='group-uncovered-cycle'){
        expect(correction).toContain('module-claim-cycle-readback.v1')
        expect(context.diagnosticExcerpt.fieldClaimCycles).toHaveLength(1)
        expect(context.diagnosticExcerpt.fieldClaimCycles[0].edges[0]).toMatchObject({groupId:'project_brief:1',
          originalSubmissionHash:sha256CanonicalJson(context.structuredOutput),refPath:'inputRefs/0',
          target:{port:'project_brief',field:'aliases',at:'/0'},referencedTarget:{port:'project_brief',field:'aliases',at:'/0'}})
      }
    }
    const attempts = run.moduleRuns[0].executionAudit!.attempts as any[]
    expect(attempts).toHaveLength(f.start.mock.calls.length)
    for (const attempt of attempts) {
      expect(attempt.classId).toBe('text'); expect(attempt.groupId).toBe('project_brief:1')
      expect(attempt.error).toContain(error)
      expect(attempt.structuredHash).toBe(sha256CanonicalJson(attempt.structuredOutput))
      expect(attempt.outputsJsonHash).toBe(sha256CanonicalJson(attempt.structuredOutput.outputs))
    }
  })
  it('replays the complete raw group set and rejects coherent outer-manifest rewrites', async () => {
    const { createNativeModuleRuntime } = await api(false), f = await fixture()
    const run = await createNativeModuleRuntime({ subagents: f.subagents, agentClasses: f.classes }).execute(f.parent, f.request)
    expect(run.status).toBe('partial')
    const folder = join(f.root, 'research/runs', run.moduleRuns[0].bundleRunId)
    const original = JSON.parse(await readFile(join(folder, 'result.json'), 'utf8')), manifest = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8'))
    for (const mutate of [
      (v: any) => { v.execution.authorGroups.groups.pop() },
      (v: any) => { v.execution.authorGroups.groups[1].raw.outputsJson += ' ' },
      (v: any) => { v.execution.authorGroups.groups[1].receipt = v.execution.authorGroups.groups[0].receipt },
      (v: any) => { v.execution.attempts.find((a: any) => a.childId === 'text-2').structuredOutput.outputsJson += ' ' },
      (v: any) => { v.execution.attempts.find((a: any) => a.childId === 'text-2').outputsJsonHash = '0'.repeat(64) },
      (v: any) => { v.execution.reviewReceipts.at(-1).childId = 'text-3' },
      (v: any) => { v.execution.reviewReceipts.at(-1).authorGroupsHash = '0'.repeat(64) },
      (v: any) => { v.execution.attempts.find((a: any) => a.classId === 'review').structuredOutput.checks[0].rationale = '被改写的复核内容' },
      (v: any) => { v.execution.kind = 'author-projection-json-v2' },
    ]) {
      const changed = structuredClone(original); mutate(changed)
      const content = JSON.stringify(changed), next = structuredClone(manifest), entry = next.files.find((e: any) => e.path === 'result.json')
      entry.sha256 = createHash('sha256').update(content).digest('hex'); entry.sizeBytes = Buffer.byteLength(content)
      const { manifestHash: _old, ...core } = next; next.manifestHash = sha256CanonicalJson(core)
      await writeFile(join(folder, 'result.json'), content); await writeFile(join(folder, 'manifest.json'), JSON.stringify(next))
      await expect(readModuleExecutionResult(f.root, run.moduleRuns[0].bundleRunId)).rejects.toThrow(/MODULE_(GROUP|PROJECTION|REVIEW)/)
    }
  })
})
