import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import type { FrozenProjectInput } from '../src/report/types.ts'
import {reportModuleResearchFixture} from './support/report-module-research.ts'
import {getModuleFieldContracts} from '../src/research-v2/module-contracts.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'
import * as chapterPrompts from '../src/report/manuscript/prompts.ts'
import {DEFAULT_REPORT_DELIVERY_CONTRACT,inspectReportCoverage} from '../src/report/delivery-contract.ts'

import * as manuscript from '../src/report/manuscript/index.ts'
const ids = ['opportunity', 'site', 'positioning', 'products', 'spatial', 'launch', 'operation'] as const
const input: FrozenProjectInput = {
  projectId: 'p-one', projectName: '山地自然研学项目', revision: 4, generatedAt: '2026-09-17T00:00:00Z',
  recommendation: '建议以自然研学作为首期方向', decisionItems: [], gates: [], visualAssets: [],
  stateObjects: [{ objectId: 'PG04', chapterId: '06', title: '产品组合', summary: '两个产品分别提供课程和休闲体验', facts: [],
    reportSections: [{ key: 'products', title: '产品', entries: [
      { key: 'tea', fieldPath: 'data.products[0]', text: '茶园自然课堂；面向亲子家庭；设置采茶和自然观察课程', basis: '用户原始材料', evidenceRefs: [{ evidenceId: 'e-tea' }] },
      { key: 'trail', fieldPath: 'data.products[1]', text: '林间慢行环线；面向周末游客；串联现有林间道路', basis: '策划建议' },
    ] }] }],
}
const roots: string[] = []
async function workspace() { const root = await mkdtemp(join(tmpdir(), 'planning-manuscript-')); roots.push(root); return root }
async function checkpointAt(root: string) {
  const folder = join(root, '.pre-design/report-manuscript-checkpoints'), directories = await readdir(folder)
  const file = join(folder, directories[0]!, 'chapters.json')
  return { file, checkpoint: JSON.parse(await readFile(file, 'utf8')) }
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
const agent = { id: 'parent-one' } as never

it('saves native draft copy issues for whole-report review without weakening source checks',async()=>{
 const full={...input,deliveryContract:DEFAULT_REPORT_DELIVERY_CONTRACT},refs=manuscript.makeSourceIndex(full).map(s=>s.id)
 const h=host(async id=>{const c=chapter(id,refs);if(id==='operation')c.pages[0]!.claim='本页按全年服务安排说明人员和运营成本。';return c})
 const draft=await new manuscript.PlanningManuscriptService(h.dependencies as never).prepare(full,await workspace(),agent,new AbortController().signal,()=>{})
 expect(draft.chapters.at(-1)!.pages[0]!.claim).toContain('本页')
 expect(inspectReportCoverage({...full,manuscript:draft}).some(f=>f.code==='CLIENT_COPY'&&f.pageId==='operation-basis')).toBe(true)
 const invalid=structuredClone(draft);Object.assign(invalid.chapters[0]!.pages[0]!,{sourceRefs:['invented']})
 expect(()=>manuscript.validatePlanningManuscript(invalid,full)).toThrow('MANUSCRIPT_SOURCE')
})

it('pins cross-chapter product and terrain references to the actual product catalog',()=>{
 const schema=chapterPrompts.planningChapterOutputSchema(manuscript.makeSourceIndex(input),['products-tea','products-trail'])
 const fields=schema.properties!.pages!.items!.properties!
 expect(validateJsonSchemaValue(fields.productRefs!,['products-tea'])).toEqual([])
 expect(validateJsonSchemaValue(fields.productRefs!,['community_assisted_service'])).not.toEqual([])
 expect(validateJsonSchemaValue(fields.terrainPlan!.properties!.nodes!.items!.properties!.productRefs!,['invented'])).not.toEqual([])
})

it('inherits explicitly cited quantity sources into the page without accepting unknown sources',()=>{
 const sources=manuscript.makeSourceIndex(input),draft=chapter('operation',[sources[0]!.id])
 Object.assign(draft.pages[0]!,{quantities:[{id:'sessions',label:'年度场次',value:40,unit:'场/年',kind:'assumption',sourceRefs:[sources[1]!.id],rationale:'按服务日组织的工作量情景。'}]})
 const saved=manuscript.validatePlanningChapter(draft,'operation',sources)
 expect(saved.pages[0]!.sourceRefs).toEqual(sources.map(s=>s.id))
 expect(saved.pages[0]!.body).toEqual(draft.pages[0]!.body)
 ;(draft.pages[0] as any).quantities[0].sourceRefs=['unknown']
 expect(()=>manuscript.validatePlanningChapter(draft,'operation',sources)).toThrow('MANUSCRIPT_SOURCE')
})

it.each([true,false])('recovers a rejected native draft without redispatch only with exact native evidence: %s',async matches=>{
 const root=await workspace(),refs=manuscript.makeSourceIndex(input).map(s=>s.id)
 const h=host(async id=>{const c=chapter(id,refs);if(id==='operation')c.pages[0]!.claim='本页说明全年运营安排。';return c})
 await expect(new manuscript.PlanningManuscriptService(h.dependencies as never).prepare(input,root,agent,new AbortController().signal,()=>{})).rejects.toThrow('MANUSCRIPT_AUDIENCE')
 const before=await checkpointAt(root),attempt=before.checkpoint.chapters.operation.attempts.at(-1),count=h.dispatched.length
 const route={provider:'configured-provider',model:'configured-text-model'}
 const events=[{seq:1,type:'turn/start',data:{turn:1}},{seq:2,type:'request/header',data:{header:{config:route}}},
  {seq:3,type:'tool/call',data:{turn:1,step:0,name:'structured_output',callId:'call',arguments:JSON.stringify(matches?attempt.returnedContent:{tampered:true})}},
  {seq:4,type:'tool/result',data:{turn:1,step:0,message:{content:[{type:'tool-result',toolCallId:'call',isError:false}]}}},
  {seq:5,type:'turn/end',data:{turn:1,reason:{kind:'completed'}}}]
 const deps={...h.dependencies,readEvents:async()=>events,agentClasses:{...h.dependencies.agentClasses,
  execution:()=>({id:attempt.executionId,projectId:input.projectId,classId:'text',childId:attempt.childId,parentId:'parent-one',status:'failed',childStopReason:'completed',selected:route,actual:route})}}
 const service=new manuscript.PlanningManuscriptService(deps as never),full={...input,deliveryContract:DEFAULT_REPORT_DELIVERY_CONTRACT}
 if(matches){
  const draft=await service.prepare(full,root,agent,new AbortController().signal,()=>{})
  expect(draft.chapters.at(-1)!.pages[0]!.claim).toContain('本页')
  const saved=(await checkpointAt(root)).checkpoint
  expect(saved.correctionsUsed).toBe(2)
  expect(saved.chapters.operation.attempts.slice(0,-1)).toEqual(before.checkpoint.chapters.operation.attempts)
  expect(saved.chapters.operation.attempts.at(-1)).toMatchObject({recoveredFromAttempt:attempt.id,validationCorrection:false})
 }else await expect(service.prepare(full,root,agent,new AbortController().signal,()=>{})).rejects.toThrow('MODULE_GROUP_RECOVERY_INVALID')
 expect(h.dispatched).toHaveLength(count)
})

function chapter(id: string, sourceRefs: string[]) {
  return { id, title: id === 'products' ? '以自然学习和林间休闲构成产品组合' : `项目研究与${id}策略`,
    thesis: '依托已有场地资源，建议形成可分期投入的自然体验项目。',
    pages: id === 'products' ? [productPage('products-tea', '茶园自然课堂', sourceRefs[0]!), productPage('products-trail', '林间慢行环线', sourceRefs[1]!)] : [{ id: `${id}-basis`, kind: 'argument', title: '既有资源可以承载轻量体验', claim: '建议以课程和慢行组织周末停留。',
      body: ['茶园课程与林间慢行承担不同使用需求，首期可依托已有道路和现状茶园组织活动。'], sourceRefs,
      visual: { kind: 'diagram', subject: '课程与慢行的体验关系', purpose: '说明两项产品如何互补', caption: '建议产品关系' }, notes: [] }] }
}
function productPage(id: string, name: string, sourceRef: string) {
  return { id, kind: 'product', title: name, claim: `${name}以具体体验形成停留理由。`, body: ['建议采用预约制小组活动组织接待。'], sourceRefs: [sourceRef],
    product: { name, audience: '周末亲子家庭', experience: '采茶、识茶与自然观察课程', location: '现状茶园，利用已有可达道路',
      scale: '按已有道路及日常管理承载能力确定每组人数，具体规模待现场核实', operations: '课程预约与小组带领，优先使用已有设施' },
    visual: { kind: 'concept', subject: name, purpose: '表现人群活动与轻量设施的关系', caption: '产品体验建议' }, notes: [] }
}
function validManuscript() {
  const refs = manuscript.makeSourceIndex(input).map(row => row.id)
  const chapters = ids.map(id => chapter(id, refs))
  chapters.find(row => row.id === 'products')!.pages = [productPage('products-tea', '茶园自然课堂', refs[0]!), productPage('products-trail', '林间慢行环线', refs[1]!)] as never
  return { schemaVersion: 'pre-design.planning-manuscript.v1', policyVersion: manuscript.PLANNING_MANUSCRIPT_POLICY_VERSION,
    projectId: input.projectId, sourceRevision: input.revision, sourceFingerprint: manuscript.manuscriptSourceFingerprint(input),
    generatedAt: input.generatedAt, title: '山地自然研学项目前期策划汇报文案', chapters }
}

it('passes complete shared quantities, scope, tables and terrain to a chapter author',()=>{
 const draft=validManuscript() as any,op=draft.chapters.find((c:any)=>c.id==='operation').pages[0]
 op.body=['统一首期服务范围标记'];op.notes=['后续扩展单列标记']
 op.table={columns:['项目','情景'],rows:[['首期支出','174200元']]}
 op.quantities=[{id:'shared-cost',label:'首期支出',value:174200,unit:'元',kind:'assumption',sourceRefs:op.sourceRefs,rationale:'统一测算基准'}]
 op.terrainPlan={sourceId:'terrain-test',zones:[],nodes:[],routes:[]}
 const prompt=chapterPrompts.buildPlanningChapterPrompt({...input,manuscript:draft},'products',manuscript.makeSourceIndex(input))
 for(const value of [op.body,op.notes,op.table,op.quantities,op.terrainPlan])expect(prompt).toContain(JSON.stringify(value))
 op.notes.push('来源备注：程序重复附加的限制标记')
 const context=chapterPrompts.planningChapterContext({...input,manuscript:draft},'products')!
 expect(context.find(c=>c.id==='operation')!.pages[0]!.notes).toEqual(['后续扩展单列标记'])
 expect(op.notes).toHaveLength(2)
})

it('finishes native editing for a saved revision whose inherited editorial receipt predates the revision',async()=>{
 const root=await workspace(),draft={...validManuscript(),generatedAt:'2026-10-15T00:00:00Z',editorial:{version:'editor-test',draftFingerprint:'a'.repeat(64),editedAt:'2026-10-14T00:00:00Z'}}
 await mkdir(join(root,'.pre-design'),{recursive:true});await writeFile(join(root,'.pre-design/report-manuscript.json'),JSON.stringify(draft))
 const runtime=host(),edit=vi.fn(async(d:any,_i:any,_r:any,_a:any,_s:any,_g:any,available:number)=>{
  expect(available).toBe(0);return {...d,editorial:{version:'editor-test',draftFingerprint:'b'.repeat(64),editedAt:'2026-10-15T01:00:00Z'}}
 }),service=new manuscript.PlanningManuscriptService({...runtime.dependencies,editor:{version:'editor-test',edit}} as never)
 const full={...input,deliveryContract:DEFAULT_REPORT_DELIVERY_CONTRACT}
 const result=await service.prepare(full,root,agent,new AbortController().signal,()=>{})
 expect(result.editorial?.draftFingerprint).toBe('b'.repeat(64));expect(edit).toHaveBeenCalledOnce();expect(runtime.dispatched).toHaveLength(0)
 expect(JSON.parse(await readFile(join(root,'.pre-design/report-manuscript.json'),'utf8')).editorial.draftFingerprint).toBe('b'.repeat(64))
 await service.prepare(full,root,agent,new AbortController().signal,()=>{});expect(edit).toHaveBeenCalledOnce()
})

it('repairs saved legacy financial summaries within the reserved revision and preserves both old chapters and budgets',async()=>{
 const root=await workspace(),draft=validManuscript() as any,full={...input,deliveryContract:DEFAULT_REPORT_DELIVERY_CONTRACT,manuscript:draft}
 const findings=ids.filter(id=>id!=='positioning').map(id=>({code:'PROPOSAL_DETAIL',pageId:draft.chapters.find((c:any)=>c.id===id).pages[0].id,message:'统一完整方案。'}))
 const folder=join(root,'.pre-design/report-manuscript-revisions',draft.sourceFingerprint),key=hash({draft,findings}),path=join(folder,key,'chapters.json')
 await mkdir(join(folder,key),{recursive:true})
 const saved:any={schemaVersion:'pre-design.planning-manuscript-checkpoint.v1',policyVersion:manuscript.PLANNING_MANUSCRIPT_POLICY_VERSION,projectId:input.projectId,sourceRevision:input.revision,sourceFingerprint:draft.sourceFingerprint,correctionsUsed:0,chapters:{}}
 for(const id of ['opportunity','site','products','spatial']){
  const c=structuredClone(draft.chapters.find((c:any)=>c.id===id));if(id==='opportunity'||id==='products')c.pages.push({...c.pages[0],id:id+'-legacy-finance',kind:'financial',product:undefined})
  saved.chapters[id]={chapter:c,attempts:[{id:'legacy-'+id,status:'completed',startedAt:input.generatedAt,validationCorrection:false,authoringContractVersion:'ideal-proposal-20261015.1'}]}
 }
 await writeFile(path,JSON.stringify(saved));await writeFile(join(folder,'index.json'),JSON.stringify([key]));await writeFile(join(folder,'budget-v2.json'),JSON.stringify({version:'report-revision-budget.v2',entries:[{key,stage:'content'}]}))
 const runtime=host(async(id,_attempt,request)=>{
  const result=chapter(id,manuscript.makeSourceIndex(input).map(s=>s.id))
  if(id==='operation')result.pages[0]!.body=['共同运营测算已确定']
  if(id==='opportunity'||id==='products')expect(request.prompt[0].text).toContain('共同运营测算已确定')
  return result
 }),service=new manuscript.PlanningManuscriptService(runtime.dependencies as never)
 const result=await service.revise(full,draft,findings,root,agent,new AbortController().signal,()=>{})
 expect(runtime.dispatched.map(r=>r.id)).toEqual(['operation','opportunity','products','launch'])
 const actual=JSON.parse(await readFile(path,'utf8'))
 expect(actual.correctionsUsed).toBe(2)
 for(const id of ['opportunity','products']){
  expect(actual.chapters[id].contextRepair.chapter).toEqual(JSON.parse(JSON.stringify(saved.chapters[id].chapter)))
  expect(actual.chapters[id].attempts[0]).toEqual(saved.chapters[id].attempts[0])
  expect(actual.chapters[id].attempts[1]).toMatchObject({validationCorrection:true,contextContractRepair:true})
 }
 expect(result.chapters.find(c=>c.id==='site')).toEqual(saved.chapters.site.chapter)
 expect(result.chapters.find(c=>c.id==='spatial')).toEqual(saved.chapters.spatial.chapter)
 expect(JSON.parse(await readFile(join(folder,'budget-v2.json'),'utf8')).entries).toEqual([{key,stage:'content'}])
 await writeFile(join(root,'.pre-design/report-manuscript.json'),JSON.stringify(draft))
 await service.revise(full,draft,findings,root,agent,new AbortController().signal,()=>{})
 expect(runtime.dispatched).toHaveLength(4)
 expect(JSON.parse(await readFile(path,'utf8')).correctionsUsed).toBe(2)
})

it.each([true,false])('repairs legacy audience instructions once without resetting charged corrections: %s',async succeeds=>{
 const root=await workspace(),refs=manuscript.makeSourceIndex(input).map(s=>s.id)
 const bad=(id:string)=>{const row=chapter(id,refs);if(id==='spatial')row.thesis='保存的地形仅为概念示意，不替代测绘。';return row}
 const first=host(async id=>bad(id))
 await expect(new manuscript.PlanningManuscriptService(first.dependencies as never).prepare(input,root,agent,new AbortController().signal,()=>{})).rejects.toThrow('MANUSCRIPT_AUDIENCE')
 const {file,checkpoint}=await checkpointAt(root)
 for(const attempt of checkpoint.chapters.spatial.attempts){delete attempt.authoringContractVersion;delete attempt.authoringContractRepair}
 await writeFile(file,JSON.stringify(checkpoint));const original=structuredClone(checkpoint.chapters.spatial.attempts)
 const resumed=host(async id=>succeeds?chapter(id,refs):bad(id)),service=new manuscript.PlanningManuscriptService(resumed.dependencies as never)
 if(succeeds)expect((await service.prepare(input,root,agent,new AbortController().signal,()=>{})).chapters).toHaveLength(7)
 else await expect(service.prepare(input,root,agent,new AbortController().signal,()=>{})).rejects.toThrow('MANUSCRIPT_AUDIENCE')
 const saved=(await checkpointAt(root)).checkpoint
 expect(saved.correctionsUsed).toBe(2);expect(saved.chapters.spatial.attempts.slice(0,original.length)).toEqual(original)
 expect(saved.chapters.spatial.attempts.at(-1)).toMatchObject({authoringContractRepair:true,validationCorrection:false})
 if(!succeeds){const count=resumed.dispatched.length;await expect(service.prepare(input,root,agent,new AbortController().signal,()=>{})).rejects.toThrow('MANUSCRIPT_CORRECTION_LIMIT');expect(resumed.dispatched).toHaveLength(count)}
})

it('starts the unchanged native deadline after synchronous evidence packaging',async()=>{
 const original=chapterPrompts.buildPlanningChapterPrompt
 const spy=vi.spyOn(chapterPrompts,'buildPlanningChapterPrompt').mockImplementation((...args)=>{
   const result=original(...args),end=Date.now()+150;while(Date.now()<end){};return result
 })
 try{
  const refs=manuscript.makeSourceIndex(input).map(s=>s.id),h=host(async id=>{await new Promise(done=>setTimeout(done,10));return chapter(id,refs)})
  const service=new manuscript.PlanningManuscriptService({...h.dependencies,timeoutMs:75} as never)
  expect((await service.prepare(input,await workspace(),agent,new AbortController().signal,()=>{})).chapters).toHaveLength(7)
 }finally{spy.mockRestore()}
})

it.each([true,false])('only proven legacy program repairs are separated from the content revision budget: %s',async proven=>{
  const root=await workspace(), draft=validManuscript(), fingerprint=draft.sourceFingerprint
  const folder=join(root,'.pre-design/report-manuscript-revisions',fingerprint),history=join(root,'.pre-design/report-manuscript-history')
  await mkdir(folder,{recursive:true});await mkdir(history,{recursive:true})
  const keys:string[]=[]
  for(let i=0;i<2;i++){
    const previous={...draft,generatedAt:`2026-09-1${i}T00:00:00Z`},findings=[{code:'NUMBER_UNBOUND',pageId:'opportunity-basis',message:'数值检查 '+i}]
    keys.push(hash({draft:previous,findings}));await writeFile(join(history,hash(previous)+'.json'),JSON.stringify(previous))
    const dir=join(root,'.pre-design/report-acceptance',fingerprint,hash(previous),'research-index-v1');await mkdir(dir,{recursive:true})
    await writeFile(join(dir,'content.json'),JSON.stringify({sourceFingerprint:fingerprint,manuscriptHash:hash(previous),status:'failed',failureKind:'content',receipts:proven?[]:[{requirementId:'opportunity'}],findings}))
  }
  await writeFile(join(folder,'index.json'),JSON.stringify(keys))
  const service=new manuscript.PlanningManuscriptService(host().dependencies as never)
  const revise=()=>service.revise(input,draft as never,[{code:'PROPOSAL_DETAIL',pageId:'opportunity-basis',message:'给出具体产品安排'}],root,agent,new AbortController().signal,()=>{})
  if(proven){
    expect((await revise()).chapters).toHaveLength(7)
    expect(JSON.parse(await readFile(join(folder,'index.json'),'utf8')).slice(0,2)).toEqual(keys)
    const ledger=JSON.parse(await readFile(join(folder,'budget-v2.json'),'utf8'))
    expect(ledger.entries.map((e:any)=>e.stage)).toEqual(['program','program','content'])
  }else await expect(revise()).rejects.toThrow('MANUSCRIPT_REVISION_LIMIT')
})

it('retains source confirmation notes on the directly returned revised chapter and in its saved manuscript',async()=>{
  const qualified={...input,moduleResearch:reportModuleResearchFixture()}
  const result=qualified.moduleResearch.results[0]!
  for(const [name,port] of Object.entries(getModuleFieldContracts('1.01').ports))Object.assign(result.outputs[name] as object,
    {records:[{recordId:'task',...Object.fromEntries(port.fields.map(field=>[field.name,{value:null,claimClass:'missing',claimRefs:[],limitations:['实施条件未核实。']}]))}]})
  Object.assign(result,{execution:{executionId:'test-author',childId:'test-author-child',actualModel:{provider:'test',model:'test'},stopReason:'completed'}})
  const source=manuscript.makeSourceIndex(qualified).find(row=>row.moduleLineage)!
  const draft={...validManuscript(),sourceFingerprint:manuscript.manuscriptSourceFingerprint(qualified)}
  draft.chapters[0]!.pages[0]!.sourceRefs=[source.id]
  const runtime=host(async id=>chapter(id,[source.id])),root=await workspace()
  const service=new manuscript.PlanningManuscriptService(runtime.dependencies as never)
  const revised=await service.revise(qualified,draft as never,[{code:'PROPOSAL_DETAIL',pageId:'opportunity-basis',message:'展开具体的方案动作。'}],root,agent,new AbortController().signal,()=>{})
  const page=revised.chapters[0]!.pages[0]!
  expect(page.notes).toContain('来源备注：委托范围仍须业主确认。')
  expect(page.body.join('\n')).not.toContain('委托范围仍须业主确认')
  const stored=JSON.parse(await readFile(join(root,'.pre-design/report-manuscript.json'),'utf8'))
  expect(stored.chapters[0].pages[0].notes).toEqual(page.notes)
})

function host(respond?: (id: string, attempt: number, request: any) => Promise<any>) {
  const dispatched: { id: string; request: any; classId: string }[] = []
  const classes: { executionId: string; classId: string; status?: string }[] = []
  let attached = 0, disposed = 0
  const attempts = new Map<string, number>()
  const dependencies = {
    maxConcurrency: 1,
    agentClasses: {
      modelLimits: async () => ({ contextWindow: 1050000, outputTokenLimit: 128000 }),
      begin: async (_projectId: string, classId: string) => { const executionId = `execution-${classes.length}`; classes.push({ executionId, classId }); return { id: executionId, selected: { provider: 'configured-provider', model: 'configured-text-model' } } },
      attach: async () => { attached++ },
      finish: async (executionId: string, status: string) => { classes.find(row => row.executionId === executionId)!.status = status },
    },
    subagents: {
      getProvider: () => ({}),
      start: async (provider: string, request: any) => {
        expect(provider).toBe('spawn')
        const id = request.label.split(':').at(-1)!
        const attempt = (attempts.get(id) ?? 0) + 1; attempts.set(id, attempt)
        dispatched.push({ id, request, classId: classes.at(-1)!.classId })
        const result = respond ? respond(id, attempt, request) : Promise.resolve(chapter(id, manuscript.makeSourceIndex(input).map(row => row.id)))
        return { id: `child-${dispatched.length}`, result: result.then(structured => ({ stopReason: 'completed', structured })), dispose: async () => { disposed++ } }
      },
    },
  }
  return { dependencies, dispatched, classes, counts: () => ({ attached, disposed }) }
}

describe('planning manuscript source and content contract', () => {
  it('source contract rejects unknown page and quantity references inside the native submission tool', async () => {
    const root = await workspace(), runtime = host()
    await new manuscript.PlanningManuscriptService(runtime.dependencies as never).prepare(input, root, agent, new AbortController().signal, () => {})
    const request = runtime.dispatched.find(row => row.id === 'products')!.request
    const draft: any = chapter('products', manuscript.makeSourceIndex(input).map(row => row.id))
    expect(validateJsonSchemaValue(request.outputSchema, draft)).toEqual([])
    draft.pages[0].sourceRefs = ['source:module:5.06:invented-source-id']
    expect(validateJsonSchemaValue(request.outputSchema, draft).length).toBeGreaterThan(0)
    draft.pages[0].sourceRefs = [manuscript.makeSourceIndex(input)[0]!.id]
    draft.pages[0].quantities = [{ id: 'visits', label: '情景场次', value: 3, unit: '场', kind: 'assumption', sourceRefs: ['source:unknown'], rationale: '预约试行情景' }]
    expect(validateJsonSchemaValue(request.outputSchema, draft).length).toBeGreaterThan(0)
  })
  it('source contract feedback identifies the actual invalid reference and its exact index', () => {
    const sources = manuscript.makeSourceIndex(input), draft = chapter('opportunity', sources.map(row => row.id))
    draft.pages[0]!.sourceRefs.push('source:module:5.06:invented-source-id')
    expect(() => manuscript.validatePlanningChapter(draft, 'opportunity', sources)).toThrow(/sourceRefs\[2\].*source:module:5\.06:invented-source-id/)
  })
  it.each([true, false])('source contract grants one bounded legacy repair without resetting historical corrections: succeeds=%s', async succeeds => {
    const root = await workspace(), refs = manuscript.makeSourceIndex(input).map(row => row.id)
    const original = host(async id => {
      const draft = chapter(id, refs)
      if (id === 'opportunity') draft.pages[0]!.sourceRefs = ['source:module:5.06:invented-source-id']
      return draft
    })
    await expect(new manuscript.PlanningManuscriptService(original.dependencies as never).prepare(input, root, agent, new AbortController().signal, () => {})).rejects.toThrow('MANUSCRIPT_SOURCE')
    const { file, checkpoint } = await checkpointAt(root)
    for (const attempt of checkpoint.chapters.opportunity.attempts) {
      delete attempt.sourceContractVersion; delete attempt.sourceContractRepair
      attempt.validationFeedback = 'MANUSCRIPT_SOURCE: opportunity.pages[0].sourceRefs'
    }
    await writeFile(file, JSON.stringify(checkpoint))
    const originalAttempts = structuredClone(checkpoint.chapters.opportunity.attempts)
    const originalPeers = structuredClone(Object.fromEntries(Object.entries(checkpoint.chapters).filter(([id]) => id !== 'opportunity')))
    const resumed = host(async (id, _attempt, request) => {
      expect(request.prompt[0].text).toContain('source:module:5.06:invented-source-id')
      expect(request.prompt[0].text).toContain('sourceRefs[0]')
      const draft = chapter(id, refs)
      if (!succeeds) draft.pages[0]!.sourceRefs = ['source:still-unknown']
      return draft
    })
    const service = new manuscript.PlanningManuscriptService(resumed.dependencies as never)
    if (succeeds) expect((await service.prepare(input, root, agent, new AbortController().signal, () => {})).chapters).toHaveLength(7)
    else await expect(service.prepare(input, root, agent, new AbortController().signal, () => {})).rejects.toThrow('MANUSCRIPT_SOURCE')
    expect(resumed.dispatched.map(row => row.id)).toEqual(['opportunity'])
    const saved = (await checkpointAt(root)).checkpoint
    expect(saved.correctionsUsed).toBe(2)
    expect(saved.chapters.opportunity.attempts.slice(0, originalAttempts.length)).toEqual(originalAttempts)
    expect(Object.fromEntries(Object.entries(saved.chapters).filter(([id]) => id !== 'opportunity'))).toEqual(originalPeers)
    expect(saved.chapters.opportunity.attempts.at(-1)).toMatchObject({ sourceContractRepair: true, validationCorrection: false })
    if (!succeeds) {
      await expect(new manuscript.PlanningManuscriptService(resumed.dependencies as never).prepare(input, root, agent, new AbortController().signal, () => {})).rejects.toThrow('MANUSCRIPT_CORRECTION_LIMIT')
      expect(resumed.dispatched).toHaveLength(1)
    }
  })
  it('revises only chapters named by acceptance findings and preserves the rejected draft in history', async () => {
    const root = await workspace(), h = host(), service = new manuscript.PlanningManuscriptService(h.dependencies as never)
    const draft = await service.prepare(input, root, agent, new AbortController().signal, () => {})
    h.dispatched.splice(0)
    const revised = await service.revise(input, draft, [{ code: 'PRODUCT_LOCATION', pageId: 'products-tea', message: '需要解释课堂与空间节点的对应。' }], root, agent, new AbortController().signal, () => {})
    expect(h.dispatched.map(r => r.id)).toEqual(['products'])
    expect(h.dispatched[0]!.request.prompt[0].text).toContain('需要解释课堂与空间节点的对应')
    expect(revised.chapters.filter(c => c.id !== 'products')).toEqual(draft.chapters.filter(c => c.id !== 'products'))
    expect((await readdir(join(root, '.pre-design/report-manuscript-history'))).length).toBeGreaterThan(0)
  })
  it('provides authored product identities to the spatial chapter under the complete delivery contract', async () => {
    const root = await workspace(), h = host()
    const { DEFAULT_REPORT_DELIVERY_CONTRACT } = await import('../src/report/delivery-contract.ts')
    await new manuscript.PlanningManuscriptService(h.dependencies as never).prepare({ ...input, deliveryContract: DEFAULT_REPORT_DELIVERY_CONTRACT }, root, agent, new AbortController().signal, () => {})
    expect(h.dispatched.find(r => r.id === 'spatial')!.request.prompt[0].text).toContain('products-tea')
  })
  it('retains validated delivery links and calculation inputs through manuscript normalization', () => {
    const draft = validManuscript(), page = draft.chapters.find(c=>c.id==='spatial')!.pages[0]! as any
    page.productRefs=['products-tea']; page.quantities=[{id:'q',label:'情景场次',value:3,unit:'场',kind:'assumption',sourceRefs:page.sourceRefs,rationale:'预约试行假设'}]
    const normalized=manuscript.validatePlanningManuscript(draft,input).chapters.find(c=>c.id==='spatial')!.pages[0]!
    expect(normalized.productRefs).toEqual(['products-tea']);expect(normalized.quantities?.[0]?.value).toBe(3)
    page.quantities[0].value='invented'
    expect(()=>manuscript.validatePlanningManuscript(draft,input)).toThrow('MANUSCRIPT_SHAPE')
  })
  it('keeps source identities and fingerprints stable across image generation, but invalidates changed business content', () => {
    const sources = manuscript.makeSourceIndex(input)
    expect(sources).toHaveLength(2)
    expect(sources[0]).toMatchObject({ objectId: 'PG04', fieldPath: 'data.products[0]', text: '茶园自然课堂；面向亲子家庭；设置采茶和自然观察课程', evidenceIds: ['e-tea'] })
    const visuals: FrozenProjectInput = { ...input, generatedAt: '2026-09-18', adoptedAssetIds: ['new-image'], visualAssets: [{ assetId: 'new-image', kind: 'concept', caption: '新图', sourcePath: '/new.png', mimeType: 'image/png' }] }
    expect(manuscript.manuscriptSourceFingerprint(visuals)).toBe(manuscript.manuscriptSourceFingerprint(input))
    expect(manuscript.manuscriptSourceFingerprint({ ...input, revision: 5 })).not.toBe(manuscript.manuscriptSourceFingerprint(input))
    expect(manuscript.manuscriptSourceFingerprint({ ...input, projectName: '另一项目' })).not.toBe(manuscript.manuscriptSourceFingerprint(input))
  })
  it('preserves separate core-product pages and real comparison tables', () => {
    const draft = validManuscript()
    Object.assign(draft.chapters[2]!.pages[0]!, { kind: 'comparison', table: { columns: ['路径', '选择依据'], rows: [['课程优先', '利用现状茶园'], ['扩建优先', '新增建设条件尚不明确']] } })
    const accepted = manuscript.validatePlanningManuscript(draft, input)
    expect(accepted.chapters[3]!.pages.map(row => row.title)).toEqual(['茶园自然课堂', '林间慢行环线'])
    expect(accepted.chapters[2]!.pages[0]!.table?.rows[1]).toEqual(['扩建优先', '新增建设条件尚不明确'])
  })
  it.each([{ refs: [] }, { refs: ['not-an-actual-source'] }])('rejects unsupported page source references $refs', ({ refs }) => {
    const draft = validManuscript(); draft.chapters[0]!.pages[0]!.sourceRefs = refs
    expect(() => manuscript.validatePlanningManuscript(draft, input)).toThrow(/MANUSCRIPT_SOURCE/)
  })
  it('rejects a product page that never describes the experience', () => {
    const draft = validManuscript(); (draft.chapters[3]!.pages[0] as any).product.experience = ''
    expect(() => manuscript.validatePlanningManuscript(draft, input)).toThrow(/MANUSCRIPT_PRODUCT/)
  })
  it.each(['根据实际情况确定', '具体规模待核实', '视实际情况调整'])('rejects a product scale placeholder without a sizing principle: %s', scale => {
    const draft = validManuscript(); (draft.chapters[3]!.pages[0] as any).product.scale = scale
    expect(() => manuscript.validatePlanningManuscript(draft, input)).toThrow(/MANUSCRIPT_PRODUCT/)
  })
  it('accepts a specific product-name title but rejects an empty slogan as its planning claim', () => {
    const draft = validManuscript()
    expect(() => manuscript.validatePlanningManuscript(draft, input)).not.toThrow()
    draft.chapters[3]!.pages[0]!.claim = '赋能文旅融合，打造区域标杆。'
    expect(() => manuscript.validatePlanningManuscript(draft, input)).toThrow(/MANUSCRIPT_AUDIENCE/)
  })
  it.each(['本页我们将介绍项目定位。', '下一步填写投资估算，任务状态已完成。', '置信等级较高，质量守卫通过。'])('rejects internal meeting or execution copy: %s', text => {
    const draft = validManuscript(); draft.chapters[0]!.pages[0]!.body = [text]
    expect(() => manuscript.validatePlanningManuscript(draft, input)).toThrow(/MANUSCRIPT_AUDIENCE/)
  })
  it('rejects a whole products chapter that avoids defining any product', () => {
    const draft = validManuscript(); draft.chapters[3]!.pages = [chapter('site', manuscript.makeSourceIndex(input).map(row => row.id)).pages[0]!] as never
    Object.assign(draft.chapters[3]!.pages[0]!, { id: 'products-abstract' })
    expect(() => manuscript.validatePlanningManuscript(draft, input)).toThrow(/MANUSCRIPT_PRODUCT/)
  })
  it.each(['需进一步明确项目定位，后续补充细节。', '下一步核实资料后再确定产品内容。'])('rejects an administrative to-do presented as the page claim: %s', claim => {
    const draft = validManuscript(); draft.chapters[0]!.pages[0]!.claim = claim
    expect(() => manuscript.validatePlanningManuscript(draft, input)).toThrow(/MANUSCRIPT_AUDIENCE/)
  })
  it('rejects a page whose entire body is missing-data follow-up while accepting concrete planning propositions', () => {
    const draft = validManuscript(); draft.chapters[0]!.pages[0]!.body = ['需进一步明确目标客群。', '后续补充资源信息。', '下一步核实场地情况。']
    expect(() => manuscript.validatePlanningManuscript(draft, input)).toThrow(/MANUSCRIPT_AUDIENCE/)
    draft.chapters[0]!.pages[0]!.body = ['建议构建课程与慢行相互补充的产品体系，以自然观察串联现状场地。', '实施前应核实道路承载能力。']
    expect(() => manuscript.validatePlanningManuscript(draft, input)).not.toThrow()
  })
})

describe('planning manuscript production and durable recovery', () => {
  it('uses the configured text child route, persists all chapters and reuses an unchanged cached manuscript', async () => {
    const root = await workspace(), runtime = host()
    const service = new manuscript.PlanningManuscriptService(runtime.dependencies as never)
    const result = await service.prepare(input, root, agent, new AbortController().signal, () => {})
    expect(result.chapters.map(row => row.id)).toEqual(ids)
    expect(runtime.dispatched).toHaveLength(7)
    for (const dispatch of runtime.dispatched) {
      expect(dispatch.classId).toBe('text')
      expect(dispatch.request.agentOptions).toMatchObject({ provider: 'configured-provider', model: 'configured-text-model' })
      expect(dispatch.request.agentOptions).toHaveProperty('maxTokens', undefined)
      expect(dispatch.request.toolFilter).toEqual({ allow: [] })
      expect(dispatch.request.persona).toContain('禁止调用业务工具和委派工具')
      expect(dispatch.request.persona).toContain('structured_output')
      expect(dispatch.request.persona).not.toContain('不调用工具，')
      expect(dispatch.request.prompt[0].text).toContain('最终必须调用 structured_output 一次')
      expect(dispatch.request.prompt[0].text).toContain('普通文本不被接收为结果')
    }
    expect(runtime.counts()).toEqual({ attached: 7, disposed: 7 })
    const saved = JSON.parse(await readFile(join(root, '.pre-design/report-manuscript.json'), 'utf8'))
    expect(saved.chapters).toHaveLength(7)
    const readable = await readFile(join(root, '.pre-design/report-manuscript.md'), 'utf8')
    expect(readable).toContain('茶园自然课堂')
    expect(readable).toContain('采茶、识茶与自然观察课程')
    expect(readable).toContain('课程预约与小组带领')
    expect(readable).not.toContain('图文职责')
    expect(readable).not.toContain('来源索引')
    const evidence = await readFile(join(root, '.pre-design/report-manuscript-sources.md'), 'utf8')
    expect(evidence).toContain('图文职责')
    expect(evidence).toContain('用户原始材料')
    const freshService = new manuscript.PlanningManuscriptService(runtime.dependencies as never)
    expect(await freshService.load(input, root)).toEqual(result)
    expect(await freshService.load({ ...input, revision: 5 }, root)).toBeUndefined()
    await freshService.prepare({ ...input, generatedAt: 'later' }, root, agent, new AbortController().signal, () => {})
    expect(runtime.dispatched).toHaveLength(7)
  })
  it('requires editorial publication in production and reuses chapter checkpoints when upgrading a raw draft', async () => {
    const root = await workspace(), runtime = host()
    await new manuscript.PlanningManuscriptService(runtime.dependencies as never).prepare(input, root, agent, new AbortController().signal, () => {})
    let edits = 0
    const editor = { version: 'test-editorial', edit: async (draft: manuscript.PlanningManuscript) => {
      edits++
      return { ...draft, editorial: { version: 'test-editorial', draftFingerprint: 'a'.repeat(64), editedAt: input.generatedAt } }
    } }
    const production = new manuscript.PlanningManuscriptService({ ...runtime.dependencies, editor } as never)
    expect(await production.load(input, root)).toBeUndefined()
    const edited = await production.prepare(input, root, agent, new AbortController().signal, () => {})
    expect(edited.editorial?.version).toBe(editor.version)
    expect(runtime.dispatched).toHaveLength(7)
    await production.prepare(input, root, agent, new AbortController().signal, () => {})
    expect(edits).toBe(1)
  })
  it('does not publish a chapter draft when final editing fails', async () => {
    const root = await workspace(), runtime = host()
    const editor = { version: 'test-editorial', edit: async () => { throw new Error('MANUSCRIPT_EDITORIAL_FAILED') } }
    const service = new manuscript.PlanningManuscriptService({ ...runtime.dependencies, editor } as never)
    await expect(service.prepare(input, root, agent, new AbortController().signal, () => {})).rejects.toThrow('MANUSCRIPT_EDITORIAL_FAILED')
    expect(await service.load(input, root)).toBeUndefined()
    const { checkpoint } = await checkpointAt(root)
    expect(Object.values(checkpoint.chapters).every((row: any) => row.chapter)).toBe(true)
  })
  it('singleflights concurrent completion calls instead of paying twice for the same chapters', async () => {
    const root = await workspace(), runtime = host()
    const service = new manuscript.PlanningManuscriptService(runtime.dependencies as never), signal = new AbortController().signal
    const [first, second] = await Promise.all([service.prepare(input, root, agent, signal, () => {}), service.prepare(input, root, agent, signal, () => {})])
    expect(first).toEqual(second); expect(runtime.dispatched).toHaveLength(7)
  })
  it('checks each joined caller before returning a manuscript even when generation is shared', async () => {
    const root = await workspace(), runtime = host(), service = new manuscript.PlanningManuscriptService(runtime.dependencies as never)
    const signal = new AbortController().signal
    const results = await Promise.allSettled([
      service.prepare(input, root, agent, signal, () => {}),
      service.prepare(input, root, { id: 'different-parent' } as never, signal, () => { throw new Error('session changed') }),
    ])
    expect(results[0]!.status).toBe('fulfilled')
    expect(results[1]).toMatchObject({ status: 'rejected', reason: expect.objectContaining({ message: 'session changed' }) })
    expect(runtime.dispatched).toHaveLength(7)
  })
  it('schedules every chapter exactly once at the configured concurrency, including the final short batch', async () => {
    const root = await workspace(); let active = 0, maximum = 0
    const ready = new Map<number, (() => void)[]>()
    const runtime = host(async id => {
      active++; maximum = Math.max(maximum, active)
      const index = ids.indexOf(id as typeof ids[number]), batch = Math.floor(index / 3)
      await new Promise<void>(resolve => {
        const waits = ready.get(batch) ?? []; waits.push(resolve); ready.set(batch, waits)
        if (waits.length === Math.min(3, ids.length - batch * 3)) waits.forEach(release => release())
      })
      active--; return chapter(id, manuscript.makeSourceIndex(input).map(row => row.id))
    })
    const service = new manuscript.PlanningManuscriptService({ ...runtime.dependencies, maxConcurrency: 3 } as never)
    const result = await service.prepare(input, root, agent, new AbortController().signal, async () => { await new Promise(resolve => setTimeout(resolve, 2)) })
    expect(result.chapters).toHaveLength(7); expect(runtime.dispatched).toHaveLength(7)
    expect(new Set(runtime.dispatched.map(row => row.id))).toHaveLength(7)
    expect(maximum).toBeGreaterThan(1); expect(maximum).toBeLessThanOrEqual(3)
  })
  it('cancellation during the child result never adopts a manuscript or dispatches the next chapter', async () => {
    const root = await workspace(), controller = new AbortController()
    const runtime = host(async id => { controller.abort(new Error('paused')); return chapter(id, manuscript.makeSourceIndex(input).map(row => row.id)) })
    const service = new manuscript.PlanningManuscriptService(runtime.dependencies as never)
    await expect(service.prepare(input, root, agent, controller.signal, () => {})).rejects.toThrow('paused')
    expect(runtime.dispatched).toHaveLength(1)
    expect(await service.load(input, root)).toBeUndefined()
    expect(runtime.classes[0]!.status).toBe('cancelled')
    expect(runtime.counts().disposed).toBe(1)
  })
  it('rejects a changed revision before dispatch and before adopting returned content', async () => {
    const root = await workspace(), runtime = host()
    const service = new manuscript.PlanningManuscriptService(runtime.dependencies as never)
    await expect(service.prepare(input, root, agent, new AbortController().signal, () => { throw new Error('changed revision') })).rejects.toThrow('changed revision')
    expect(runtime.dispatched).toHaveLength(0)
    let changed = false
    const runtime2 = host(async id => { changed = true; return chapter(id, manuscript.makeSourceIndex(input).map(row => row.id)) })
    const service2 = new manuscript.PlanningManuscriptService(runtime2.dependencies as never)
    await expect(service2.prepare(input, root, agent, new AbortController().signal, () => { if (changed) throw new Error('changed revision') })).rejects.toThrow('changed revision')
    expect(await service2.load(input, root)).toBeUndefined()
  })
  it('keeps successful chapter checkpoints after failure and resumes only unfinished chapters', async () => {
    const root = await workspace()
    const runtime = host(async id => { if (id === 'positioning') throw new Error('provider failed'); return chapter(id, manuscript.makeSourceIndex(input).map(row => row.id)) })
    const service = new manuscript.PlanningManuscriptService(runtime.dependencies as never)
    await expect(service.prepare(input, root, agent, new AbortController().signal, () => {})).rejects.toThrow()
    expect(await service.load(input, root)).toBeUndefined()
    expect((await readdir(join(root, '.pre-design/report-manuscript-checkpoints'))).length).toBeGreaterThan(0)
    const recovery = host(), resumed = new manuscript.PlanningManuscriptService(recovery.dependencies as never)
    const result = await resumed.prepare(input, root, agent, new AbortController().signal, () => {})
    expect(result.chapters).toHaveLength(7)
    expect(runtime.dispatched.map(row => row.id)).toEqual(['opportunity', 'site', 'positioning', 'products', 'spatial', 'launch', 'operation'])
    expect(recovery.dispatched.map(row => row.id)).toEqual(['positioning'])
  })
  it('diagnoses max-tokens as an output or context limit and keeps the stop reason in its checkpoint', async () => {
    const root = await workspace(), runtime = host()
    const start = runtime.dependencies.subagents.start
    runtime.dependencies.subagents.start = async (provider, request) => {
      const run = await start(provider, request)
      return { ...run, result: run.result.then(result => ({ ...result, stopReason: 'max-tokens' })) }
    }
    const service = new manuscript.PlanningManuscriptService(runtime.dependencies as never)
    await expect(service.prepare(input, root, agent, new AbortController().signal, () => {})).rejects.toThrow(/MANUSCRIPT_OUTPUT_LIMIT:.*max-tokens.*128000/)
    expect(runtime.dispatched).toHaveLength(7)
    expect(await service.load(input, root)).toBeUndefined()
    const { checkpoint } = await checkpointAt(root)
    expect(checkpoint.chapters.opportunity.attempts[0]).toMatchObject({ status: 'failed', errorCode: 'MANUSCRIPT_OUTPUT_LIMIT', stopReason: 'max-tokens', outputTokenLimit: 128000, contextWindow: 1050000 })
  })
  it.each([false, true])('continues later chapters after a peer failure and retains bounded correction history: %s', async invalidSibling => {
    const root = await workspace(), allStarted = deferred<void>(), failedDisposed = deferred<void>(), siblings = deferred<void>(), failure = deferred<never>()
    let started = 0
    const runtime = host(async id => {
      if (++started === 3) allStarted.resolve()
      if (id === 'opportunity') return failure.promise
      await siblings.promise
      const candidate = chapter(id, manuscript.makeSourceIndex(input).map(row => row.id))
      if (invalidSibling && id === 'site') candidate.pages[0]!.sourceRefs = ['invalid']
      return candidate
    })
    const start = runtime.dependencies.subagents.start
    runtime.dependencies.subagents.start = async (provider, request) => {
      const run = await start(provider, request)
      return { ...run, dispose: async () => { await run.dispose(); if (request.label.endsWith(':opportunity')) failedDisposed.resolve() } }
    }
    const service = new manuscript.PlanningManuscriptService({ ...runtime.dependencies, maxConcurrency: 3 } as never)
    const finished = service.prepare(input, root, agent, new AbortController().signal, () => {}).then(() => undefined, error => error)
    await allStarted.promise
    failure.reject(new Error('opportunity provider failed'))
    await failedDisposed.promise
    await new Promise<void>(resolve => setImmediate(resolve))
    const siblingSignals = runtime.dispatched.filter(row => row.id !== 'opportunity').map(row => row.request.signal.aborted)
    siblings.resolve()
    expect(await finished).toMatchObject({ message: 'opportunity provider failed' })
    expect(siblingSignals.every(value => value === false)).toBe(true)
    expect(new Set(runtime.dispatched.map(row => row.id))).toEqual(new Set(['opportunity', 'site', 'positioning', 'products', 'spatial', 'launch', 'operation']))
    const { checkpoint } = await checkpointAt(root)
    expect(checkpoint.chapters.positioning.chapter.id).toBe('positioning')
    expect(checkpoint.chapters.site.attempts[0].status).toBe(invalidSibling ? 'failed' : 'completed')
    expect(checkpoint.correctionsUsed).toBe(invalidSibling ? 2 : 0)
    const recovery = host(), resumed = new manuscript.PlanningManuscriptService(recovery.dependencies as never)
    if (invalidSibling) await expect(resumed.prepare(input, root, agent, new AbortController().signal, () => {})).rejects.toThrow('MANUSCRIPT_CORRECTION_LIMIT')
    else expect((await resumed.prepare(input, root, agent, new AbortController().signal, () => {})).chapters).toHaveLength(7)
    expect(recovery.dispatched.map(row => row.id)).toEqual(['opportunity'])
  })
  it.each(['failed', 'cancelled'])('resumes repeated terminal %s attempts without spending content corrections, including legacy counts', async status => {
    const root = await workspace(); let controller = new AbortController()
    const runtime = host(async (id, attempt) => {
      if (id === 'site' && attempt <= 3) {
        if (status === 'cancelled') controller.abort(new Error('paused'))
        throw new Error('provider failed')
      }
      return chapter(id, manuscript.makeSourceIndex(input).map(row => row.id))
    })
    for (let retry = 0; retry < 3; retry++) {
      controller = new AbortController()
      const service = new manuscript.PlanningManuscriptService(runtime.dependencies as never)
      await expect(service.prepare(input, root, agent, controller.signal, () => {})).rejects.toThrow(status === 'cancelled' ? 'paused' : 'provider failed')
    }
    const { file, checkpoint } = await checkpointAt(root)
    expect(checkpoint.chapters.site.attempts.map((attempt: any) => attempt.status)).toEqual([status, status, status])
    // Older service versions counted every resumed execution as a content correction.
    checkpoint.correctionsUsed = 2
    for (const row of Object.values(checkpoint.chapters) as any[]) for (const attempt of row.attempts) delete attempt.validationCorrection
    await writeFile(file, JSON.stringify(checkpoint))
    controller = new AbortController()
    const resumed = new manuscript.PlanningManuscriptService(runtime.dependencies as never)
    expect((await resumed.prepare(input, root, agent, controller.signal, () => {})).chapters).toHaveLength(7)
    expect(runtime.dispatched.filter(row => row.id === 'opportunity')).toHaveLength(1)
    expect(runtime.dispatched.filter(row => row.id === 'site')).toHaveLength(4)
    expect((await checkpointAt(root)).checkpoint.correctionsUsed).toBe(0)
  })
  it('continues an admitted peer after validation failure without assigning it another chapter feedback', async () => {
    const root = await workspace(), admission = deferred<void>(), runtime = host(async id => ({ ...chapter(id, []), pages: [] }))
    const begin = runtime.dependencies.agentClasses.begin, finish = runtime.dependencies.agentClasses.finish
    let admitted = 0, failed = 0
    runtime.dependencies.agentClasses.begin = async (projectId, classId) => {
      const execution = await begin(projectId, classId)
      if (++admitted === 2) await admission.promise
      return execution
    }
    runtime.dependencies.agentClasses.finish = async (executionId, status) => {
      await finish(executionId, status)
      if (status === 'failed' && ++failed === 3) admission.resolve()
    }
    const service = new manuscript.PlanningManuscriptService({ ...runtime.dependencies, maxConcurrency: 2 } as never)
    await expect(service.prepare(input, root, agent, new AbortController().signal, () => {})).rejects.toThrow(/MANUSCRIPT_SHAPE/)
    expect(runtime.dispatched).toHaveLength(9)
    expect(new Set(runtime.dispatched.map(row => row.id)).size).toBe(7)
    const { checkpoint } = await checkpointAt(root)
    expect(checkpoint.chapters.site.attempts[0]).toMatchObject({ status: 'failed', validationCorrection: false })
    expect(checkpoint.chapters.site.attempts[0].validationFeedback).toContain('MANUSCRIPT_SHAPE')
    expect(runtime.dispatched.find(row => row.id === 'site')!.request.prompt[0].text).not.toContain('rejectedDraft')
    expect(checkpoint.correctionsUsed).toBe(2)
  })
  it('retains validation feedback after a failed correction execution without charging that execution retry again', async () => {
    const root = await workspace()
    const runtime = host(async (id, attempt, request) => {
      const candidate = chapter(id, manuscript.makeSourceIndex(input).map(row => row.id))
      if (id === 'opportunity' && attempt === 1) { candidate.pages[0]!.sourceRefs = ['invalid']; candidate.pages[0]!.body = ['茶园课程与现状林间道路共同组织亲子体验。'] }
      if (id === 'opportunity' && attempt === 2) throw new Error('correction provider failed')
      if (id === 'opportunity' && attempt === 3) {
        expect(request.prompt[0].text).toContain('MANUSCRIPT_SOURCE')
        expect(request.prompt[0].text).toContain('茶园课程与现状林间道路共同组织亲子体验。')
      }
      if (id === 'site' && attempt === 1) candidate.pages[0]!.sourceRefs = ['invalid']
      return candidate
    })
    const service = new manuscript.PlanningManuscriptService(runtime.dependencies as never)
    await expect(service.prepare(input, root, agent, new AbortController().signal, () => {})).rejects.toThrow('correction provider failed')
    const resumed = new manuscript.PlanningManuscriptService(runtime.dependencies as never)
    expect((await resumed.prepare(input, root, agent, new AbortController().signal, () => {})).chapters).toHaveLength(7)
    const { checkpoint } = await checkpointAt(root)
    expect(checkpoint.correctionsUsed).toBe(2)
    expect(checkpoint.chapters.opportunity.attempts.map((attempt: any) => attempt.validationCorrection)).toEqual([false, true, false])
    expect(runtime.dispatched).toHaveLength(10)
  })
  it('bounds corrections across the whole manuscript and never reports invalid content as complete', async () => {
    const root = await workspace()
    const runtime = host(async id => ({ ...chapter(id, []), pages: [] }))
    const service = new manuscript.PlanningManuscriptService(runtime.dependencies as never)
    await expect(service.prepare(input, root, agent, new AbortController().signal, () => {})).rejects.toThrow(/MANUSCRIPT/)
    expect(runtime.dispatched).toHaveLength(9)
    expect(await service.load(input, root)).toBeUndefined()
    const { file, checkpoint } = await checkpointAt(root)
    for (const attempt of checkpoint.chapters.opportunity.attempts) delete attempt.validationCorrection
    await writeFile(file, JSON.stringify(checkpoint))
    const retry = new manuscript.PlanningManuscriptService(runtime.dependencies as never)
    await expect(retry.prepare(input, root, agent, new AbortController().signal, () => {})).rejects.toThrow(/MANUSCRIPT_CORRECTION_LIMIT/)
    expect(runtime.dispatched).toHaveLength(9)
  })
  it('sends the rejected draft and targeted feedback to the correction child instead of asking it to start blind', async () => {
    const root = await workspace()
    const runtime = host(async (id, attempt, request) => {
      const candidate = chapter(id, manuscript.makeSourceIndex(input).map(row => row.id))
      if (id === 'opportunity' && attempt === 1) { candidate.pages[0]!.sourceRefs = ['invalid']; candidate.pages[0]!.body = ['保留茶园课程与现有道路相结合的方案，按周末预约安排体验。'] }
      if (id === 'opportunity' && attempt === 2) {
        expect(request.prompt[0].text).toContain('保留茶园课程与现有道路相结合的方案，按周末预约安排体验。')
        expect(request.prompt[0].text).toContain('MANUSCRIPT_SOURCE')
      }
      return candidate
    })
    const service = new manuscript.PlanningManuscriptService(runtime.dependencies as never)
    expect((await service.prepare(input, root, agent, new AbortController().signal, () => {})).chapters).toHaveLength(7)
    expect(runtime.dispatched).toHaveLength(8)
  })
  it('refuses to adopt content if the configured class cannot verify the actual child model execution', async () => {
    const root = await workspace(), runtime = host()
    const service = new manuscript.PlanningManuscriptService({ ...runtime.dependencies, agentClasses: { ...runtime.dependencies.agentClasses,
      finish: async (_id: string, status: string) => { if (status === 'completed') throw new Error('MODEL_EXECUTION_UNVERIFIED') },
    } } as never)
    await expect(service.prepare(input, root, agent, new AbortController().signal, () => {})).rejects.toThrow('MODEL_EXECUTION_UNVERIFIED')
    expect(await service.load(input, root)).toBeUndefined(); expect(runtime.dispatched).toHaveLength(7)
  })
  it('times out an unresponsive child and preserves failure instead of accepting a partial manuscript', async () => {
    const root = await workspace(), runtime = host(async () => new Promise(() => {}))
    const service = new manuscript.PlanningManuscriptService({ ...runtime.dependencies, timeoutMs: 10 } as never)
    await expect(service.prepare(input, root, agent, new AbortController().signal, () => {})).rejects.toThrow(/MANUSCRIPT_CHILD_TIMEOUT/)
    expect(await service.load(input, root)).toBeUndefined(); expect(runtime.counts().disposed).toBe(7)
  })
  it('preserves the previous completed manuscript when a newer business revision is published', async () => {
    const root = await workspace(), runtime = host(), service = new manuscript.PlanningManuscriptService(runtime.dependencies as never)
    await service.prepare(input, root, agent, new AbortController().signal, () => {})
    await service.prepare({ ...input, revision: 5 }, root, agent, new AbortController().signal, () => {})
    const history = join(root, '.pre-design/report-manuscript-history'), files = await readdir(history)
    expect(files).toHaveLength(1)
    expect(JSON.parse(await readFile(join(history, files[0]!), 'utf8')).sourceRevision).toBe(4)
    expect((await service.load({ ...input, revision: 5 }, root))?.sourceRevision).toBe(5)
  })
  it('does not repeat a paid child whose previous running checkpoint has no verified settlement', async () => {
    const root = await workspace(), runtime = host(), service = new manuscript.PlanningManuscriptService(runtime.dependencies as never)
    await service.prepare(input, root, agent, new AbortController().signal, () => {})
    await rm(join(root, '.pre-design/report-manuscript.json'))
    const folder = join(root, '.pre-design/report-manuscript-checkpoints'), directories = await readdir(folder)
    const file = join(folder, directories[0]!, 'chapters.json'), checkpoint = JSON.parse(await readFile(file, 'utf8'))
    delete checkpoint.chapters.opportunity.chapter
    checkpoint.chapters.opportunity.attempts[0].status = 'running'
    await writeFile(file, JSON.stringify(checkpoint))
    const resumed = new manuscript.PlanningManuscriptService(runtime.dependencies as never)
    await expect(resumed.prepare(input, root, agent, new AbortController().signal, () => {})).rejects.toThrow(/MANUSCRIPT_RECOVERY_REQUIRED/)
    expect(runtime.dispatched).toHaveLength(7)
  })
  it('renders the full comparison matrix and nearby planning conditions in its readable manuscript', () => {
    const draft = validManuscript()
    Object.assign(draft.chapters[2]!.pages[0]!, { table: { columns: ['路径', '成立条件'], rows: [['首期研学', '道路安全复核后实施'], ['扩展建设', '用地条件落实后实施']] } })
    const markdown = manuscript.renderPlanningManuscriptMarkdown(manuscript.validatePlanningManuscript(draft, input))
    expect(markdown).toContain('| 首期研学 | 道路安全复核后实施 |')
    expect(markdown).toContain('| 扩展建设 | 用地条件落实后实施 |')
    expect(markdown).toContain('周末亲子家庭')
  })
})
