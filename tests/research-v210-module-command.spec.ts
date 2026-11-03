import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createModuleResearchCommands } from '../src/research-v2/module-command.ts'
import { acquireModuleWebCorpus } from '../src/research-v2/module-web-acquisition.ts'
import * as materialEvidence from '../src/materials/research-evidence.ts'

const roots: string[] = []
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture(execute: ReturnType<typeof vi.fn>) {
  const root = await mkdtemp(join(tmpdir(), 'pre-module-command-')); roots.push(root)
  await writeFile(join(root, 'project.json'), JSON.stringify({ projectId: 'standard-test' }))
  await mkdir(join(root, '原始资料')); await writeFile(join(root, '原始资料/brief.txt'), 'Historical source')
  const project = { projectId: 'p1', currentRevision: 0 }
  const service = createModuleResearchCommands({ readContext: () => ({ project }),
    resolveBinding: () => ({ root, standardProjectId: 'standard-test' }), now: () => new Date(), runtime: { execute } })
  const invocation = { agent: { id: 'session', session: { header: { cwd: root } } }, rawInput: '--all-modules' }
  return { root, service, invocation, project }
}
describe('native full research command', () => {
  it('passes selected corrections through a frozen full continuation without changing the remaining module selection', async()=>{
    const execute=vi.fn(async(_parent:unknown,_request:unknown)=>({status:'partial',moduleRuns:[],results:[]})),f=await fixture(execute)
    const id='RUN-11111111-1111-1111-1111-111111111111'
    await mkdir(join(f.root,'research/runs',id),{recursive:true})
    await writeFile(join(f.root,'research/runs',id,'snapshot.json'),JSON.stringify({corpus:await materialEvidence.captureMaterialCorpus(f.root),taskBrief:'Frozen concept brief'}))
    vi.spyOn(await import('../src/research-v2/module-web-acquisition.ts'),'replayModuleWebCorpus').mockImplementation(async(_root,corpus)=>corpus)
    const response=await f.service.commands[0].handler({...f.invocation,rawInput:`--all-modules --resume=${id} --revise=1.06,1.07`} as never)
    expect(response.kind).toBe('success');await f.service.whenIdle('p1')
    expect(execute.mock.calls[0]?.[1]).toMatchObject({resumeRunIds:[id],reviseModuleIds:['1.06','1.07'],taskBrief:'Frozen concept brief'})
    expect(execute.mock.calls[0]?.[1]).not.toHaveProperty('moduleIds')
    for(const rawInput of [
      '--all-modules --revise=1.06',
      `--all-modules --resume=${id} --revise=1.06,1.06`,
      `--all-modules --resume=${id} --revise=9.01`,
      `--all-modules --resume=${id} --item=1.06 --revise=1.07`,
      `--all-modules --resume=${id} --item=1.06 --revise=1.06,1.07`,
      `--all-modules --resume=${id} --item=1.06 --reviewOnly=true --revise=1.06`,
    ])expect((await f.service.commands[0].handler({...f.invocation,rawInput} as never)).kind).toBe('error')
    expect(execute).toHaveBeenCalledTimes(1)
  })
  it('starts a fresh single-module revision from a frozen checkpoint without dispatching a partial report', async()=>{
    const execute=vi.fn(async(_parent:unknown,_request:unknown)=>({status:'completed',moduleRuns:[],results:[]} as never)),f=await fixture(execute)
    const id='RUN-11111111-1111-1111-1111-111111111111'
    await mkdir(join(f.root,'research/runs',id),{recursive:true})
    await writeFile(join(f.root,'research/runs',id,'snapshot.json'),JSON.stringify({corpus:await materialEvidence.captureMaterialCorpus(f.root),taskBrief:'Frozen concept brief'}))
    vi.spyOn(await import('../src/research-v2/module-web-acquisition.ts'),'replayModuleWebCorpus').mockImplementation(async(_root,corpus)=>corpus)
    let reportDispatches=0
    const service=createModuleResearchCommands({readContext:()=>({project:f.project}),
      resolveBinding:()=>({root:f.root,standardProjectId:'standard-test'}),now:()=>new Date(),runtime:{execute},
      onComplete:async()=>{reportDispatches++}})
    const response=await service.commands[0].handler({...f.invocation,rawInput:`--all-modules --item=6.01 --resume=${id} --revise=6.01`} as never)
    expect(response.kind).toBe('success');await service.whenIdle('p1')
    expect(execute.mock.calls[0]?.[1]).toMatchObject({moduleIds:['6.01'],reviseModuleIds:['6.01'],resumeRunIds:[id],taskBrief:'Frozen concept brief'})
    expect(execute).toHaveBeenCalledTimes(1)
    expect(reportDispatches).toBe(0)
  })
  it.each([{targeted:false,reviewOnly:false},{targeted:true,reviewOnly:false},{targeted:true,reviewOnly:true}])('keeps frozen sources during full continuation while retaining explicit peer source correction (%j)',async({targeted,reviewOnly})=>{
    const execute=vi.fn(async(_parent:unknown,_request:unknown)=>({status:'partial',moduleRuns:[],results:[]} as never)),f=await fixture(execute)
    const original=await materialEvidence.captureMaterialCorpus(f.root)
    const {loadPlanningCatalog}=await import('../src/research-v2/catalog.ts')
    const corpus=await acquireModuleWebCorpus(f.invocation.agent as never,{workspaceRoot:f.root,projectId:'p1',corpus:original,
      moduleIds:loadPlanningCatalog().modules.map(item=>item.id),signal:new AbortController().signal},{web:{query:async()=>({
        executionId:'synthetic-empty',childId:'synthetic-child',verifiedEvidence:false,summary:'[]',
        retrievals:[{tool:'web_search',callId:'synthetic-search',text:'No results.'}],
      })} as never})
    const id='RUN-11111111-1111-1111-1111-111111111111',taskBrief='Bounded concept study with unchanged frozen sources.'
    await mkdir(join(f.root,'research/runs',id),{recursive:true})
    await writeFile(join(f.root,'research/runs',id,'snapshot.json'),JSON.stringify({corpus,taskBrief}))
    vi.spyOn(await import('../src/research-v2/module-web-acquisition.ts'),'replayModuleWebCorpus').mockImplementation(async(_root,value)=>value)
    vi.spyOn(await import('../src/research-v2/module-execution.ts'),'readModuleExecutionSummary').mockResolvedValue({projectId:'p1',results:[{itemId:'3.04',
      execution:{reviewReceipts:[{verdict:'limited',checks:[{status:'limited',criterion:'地图覆盖范围须有停止条件',rationale:'Current map coverage remains unverified.'}]}]}}]} as never)
    const prepareSources=vi.fn(async(_parent:unknown,_request:unknown)=>corpus)
    const service=createModuleResearchCommands({readContext:()=>({project:f.project}),resolveBinding:()=>({root:f.root,standardProjectId:'standard-test'}),
      now:()=>new Date(),prepareSources,runtime:{execute}})
    const response=await service.commands[0].handler({...f.invocation,rawInput:`--all-modules ${targeted?'--item=3.04 ':''}--resume=${id}${reviewOnly?' --reviewOnly=true':''}`} as never)
    expect(response.kind).toBe('success');await service.whenIdle('p1')
    if(targeted&&!reviewOnly){
      expect(prepareSources).toHaveBeenCalledTimes(1)
      expect(prepareSources.mock.calls[0][1]).toMatchObject({sourceRecovery:{moduleId:'3.04',queryKeys:['3.04:2']}})
      // An explicit correction cannot pretend an unchanged source is new.
      expect(execute).not.toHaveBeenCalled()
      expect((await service.commands[1].handler(f.invocation as never)).text).toContain('MODULE_WEB_RECOVERY_UNCHANGED')
    }else{
      expect(prepareSources,'a limited map check must not replace the frozen inputs of a normal full continuation').not.toHaveBeenCalled()
      expect(execute).toHaveBeenCalledTimes(1)
      expect(execute.mock.calls[0][1]).toMatchObject({corpus,taskBrief,resumeRunIds:[id]})
      expect(execute.mock.calls[0][1]).not.toHaveProperty('allowInputReuse')
      if(reviewOnly)expect(execute.mock.calls[0][1]).toMatchObject({reviewOnly:true,moduleIds:['3.04']})
    }
  })
  it('resumes a latest checkpoint with one verified original bundle per module without mixing older failed coordinators',async()=>{
    const execute=vi.fn(async(_parent:unknown,_request:unknown)=>({status:'partial',moduleRuns:[],results:[]})),f=await fixture(execute)
    const ids=Array.from({length:63},(_,index)=>`RUN-${(index+1).toString(16).padStart(8,'0')}-1111-1111-1111-111111111111`)
    await mkdir(join(f.root,'research/runs',ids[0]),{recursive:true})
    await writeFile(join(f.root,'research/runs',ids[0],'snapshot.json'),JSON.stringify({corpus:{documents:[],limitations:[],fingerprint:'test'}}))
    vi.spyOn(await import('../src/research-v2/module-web-acquisition.ts'),'replayModuleWebCorpus').mockImplementation(async(_root,corpus)=>corpus)
    vi.spyOn(await import('../src/research-v2/module-execution.ts'),'readModuleExecutionSummary').mockResolvedValue({projectId:'p1',results:[]} as never)
    const response=await f.service.commands[0].handler({...f.invocation,rawInput:`--all-modules --resume=${ids.join(',')}`} as never)
    expect(response.kind).toBe('success');await f.service.whenIdle('p1')
    expect(execute.mock.calls[0]?.[1]).toMatchObject({resumeRunIds:ids})
    for(const invalid of [[...ids,ids[0]],[...ids,'RUN-ffffffff-1111-1111-1111-111111111111'],[...ids.slice(0,9),'../outside']]){
      expect((await f.service.commands[0].handler({...f.invocation,rawInput:`--all-modules --resume=${invalid.join(',')}`} as never)).kind).toBe('error')
    }
    expect(execute).toHaveBeenCalledTimes(1)
  })
  it('passes explicit review-only intent through the normal command and requires a target checkpoint',async()=>{
    const execute=vi.fn(async(_parent:unknown,_request:unknown)=>({status:'partial',moduleRuns:[],results:[]})),f=await fixture(execute)
    const id='RUN-11111111-1111-1111-1111-111111111111'
    await mkdir(join(f.root,'research/runs',id),{recursive:true})
    await writeFile(join(f.root,'research/runs',id,'snapshot.json'),JSON.stringify({corpus:{documents:[],limitations:[],fingerprint:'test'}}))
    vi.spyOn(await import('../src/research-v2/module-web-acquisition.ts'),'replayModuleWebCorpus').mockImplementation(async(_root,corpus)=>corpus)
    const response=await f.service.commands[0].handler({...f.invocation,rawInput:`--all-modules --item=1.01 --resume=${id} --reviewOnly=true`} as never)
    expect(response.kind).toBe('success');await f.service.whenIdle('p1')
    expect(execute.mock.calls[0]?.[1]).toMatchObject({moduleIds:['1.01'],resumeRunIds:[id],reviewOnly:true})
    const invalid=await f.service.commands[0].handler({...f.invocation,rawInput:'--all-modules --reviewOnly=true'} as never)
    expect(invalid.kind).toBe('error');expect(invalid.text).toContain('MODULE_REVIEW_TARGET_REQUIRED')
    expect(execute).toHaveBeenCalledTimes(1)
  })
  it('passes ordered checkpoint identities through the existing resume command', async () => {
    const execute = vi.fn(async (_parent: unknown, _request: unknown) => ({ status: 'partial', moduleRuns: [], results: [] })), f = await fixture(execute)
    const ids = ['RUN-11111111-1111-1111-1111-111111111111', 'RUN-22222222-2222-2222-2222-222222222222']
    await mkdir(join(f.root, 'research/runs', ids[0]), { recursive: true })
    await writeFile(join(f.root, 'research/runs', ids[0], 'snapshot.json'), JSON.stringify({ corpus: { documents: [], limitations: [], fingerprint: 'test' } }))
    const replay = vi.spyOn(await import('../src/research-v2/module-web-acquisition.ts'), 'replayModuleWebCorpus').mockImplementation(async (_root, corpus) => corpus)
    const response = await f.service.commands[0].handler({ ...f.invocation, rawInput: `--all-modules --item=2.02 --resume=${ids.join(',')}` } as never)
    expect(response.kind).toBe('success'); await f.service.whenIdle('p1')
    expect(execute.mock.calls[0]?.[1]).toMatchObject({ resumeRunIds: ids, moduleIds: ['2.02'] })
    expect(replay).toHaveBeenCalledTimes(1)
  })
  it('starts a new source snapshot for targeted refresh instead of resuming accepted outputs from the previous snapshot', async () => {
    let actual: unknown
    const f = await fixture(vi.fn())
    const service = createModuleResearchCommands({ readContext: () => ({ project: f.project }),
      resolveBinding: () => ({ root: f.root, standardProjectId: 'standard-test' }), now: () => new Date(),
      prepareSources: (parent, request) => acquireModuleWebCorpus(parent, request, { web: { query: async () => ({
        executionId: 'web-empty', childId: 'child-empty', verifiedEvidence: false, summary: '[]',
        retrievals: [{ tool: 'web_search', callId: 'query', text: 'No results.' }],
      }) } as never }),
      runtime: { execute: async (_parent, request) => { actual = request; return { status: 'partial', moduleRuns: [], results: [] } as never } } })
    const started = await service.commands[0].handler({ ...f.invocation, rawInput: '--all-modules --item=1.01 --refreshQuery=1.01:0 --sourceHints=https://example.gov.cn/source' } as never)
    expect(started.kind).toBe('success')
    expect(started.text).toContain('新资料快照')
    await service.whenIdle('p1')
    expect(actual).toMatchObject({ corpus: { acquisition: { queries: [{ key: '1.01:0', status: 'searched-empty' }, { key: '1.01:1', status: 'searched-empty' }] } } })
    expect(actual).not.toHaveProperty('resumeRunIds')
  })
  it.each([
    '--all-modules --resume=RUN-11111111-1111-1111-1111-111111111111 --refreshQuery=1.05:2',
    '--all-modules --sourceHints=https://example.gov.cn/source',
    '--all-modules --item=1.01 --refreshQuery=1.05:2',
  ])('rejects incompatible refresh flags without starting a run: %s', async rawInput => {
    const f = await fixture(vi.fn())
    const response = await f.service.commands[0].handler({ ...f.invocation, rawInput } as never)
    expect(response.kind).toBe('error')
    expect((await f.service.commands[1].handler(f.invocation as never)).text).toContain('没有活动')
  })
  it('keeps original-only research stable across unrelated legacy revisions but rejects a changed project binding', async () => {
    let guarded!: () => Promise<void>
    const execute = vi.fn(async (_parent, _request, options) => {
      guarded = options.assertCurrent
      f.project.currentRevision++
      await guarded()
      return { status: 'completed', moduleRuns: [], results: [] }
    })
    const f = await fixture(execute)
    await f.service.commands[0].handler(f.invocation as never)
    await f.service.whenIdle('p1')
    expect((await f.service.commands[1].handler(f.invocation as never)).text).toContain('completed')
    f.project.projectId = 'different-project'
    await expect(guarded()).rejects.toThrow('MODULE_PROJECT_SNAPSHOT_CHANGED')
  })
  it.each(['command', 'invocation'])('honors %s cancellation during original material capture without dispatching a model', async mode => {
    const execute = vi.fn(async () => ({ status: 'completed' }))
    const f = await fixture(execute)
    const capture = materialEvidence.captureMaterialCorpus
    let release!: () => void, entered!: () => void
    const ready = new Promise<void>(resolve => { entered = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    vi.spyOn(materialEvidence, 'captureMaterialCorpus').mockImplementationOnce(async (root, options) => {
      entered(); await gate
      options?.signal?.throwIfAborted()
      return capture(root, options)
    })
    const controller = new AbortController()
    const start = f.service.commands[0].handler({ ...f.invocation, signal: controller.signal } as never)
    await ready
    if (mode === 'command') await f.service.commands[2].handler(f.invocation as never)
    else controller.abort(new Error('REQUEST_CANCELLED'))
    release(); await start; await f.service.whenIdle('p1')
    expect(execute).not.toHaveBeenCalled()
    expect((await f.service.commands[1].handler(f.invocation as never)).text).toContain('cancelled')
  })
  it('starts a real runtime on a frozen original corpus, deduplicates concurrent requests and supports cancellation', async () => {
    let release!: (value: unknown) => void
    const execute = vi.fn((_parent, request) => new Promise(resolve => { release = resolve; request.signal.addEventListener('abort', () => resolve({ status: 'cancelled', moduleRuns: [], results: [], manifestRunId: 'RUN-cancelled' })) }))
    const f = await fixture(execute)
    const first = await f.service.commands[0].handler(f.invocation as never)
    expect(first.kind).toBe('success')
    await f.service.commands[0].handler(f.invocation as never)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute.mock.calls[0][1]).toMatchObject({ projectId: 'p1', flags: { industryPlanning: true, existingBuildings: true, externalPartners: true, marketing: true }, corpus: { documents: [{ path: '原始资料/brief.txt' }] } })
    expect((await f.service.commands[1].handler({ ...f.invocation, rawInput: '' } as never)).text).toContain('running')
    await f.service.commands[2].handler({ ...f.invocation, rawInput: '' } as never)
    await f.service.whenIdle('p1')
    expect((await f.service.commands[1].handler({ ...f.invocation, rawInput: '' } as never)).text).toContain('cancelled')
    void release
  })
  it('does not dispatch an unknown condition plan or silently treat it as false', async () => {
    const execute = vi.fn()
    const f = await fixture(execute)
    expect((await f.service.commands[0].handler({ ...f.invocation, rawInput: '' } as never)).kind).toBe('error')
    expect(execute).not.toHaveBeenCalled()
  })
  it('records runtime failure and checks current source identity before committing', async () => {
    const execute = vi.fn(async (_parent, _request, options) => {
      await writeFile(join(f.root, '原始资料/brief.txt'), 'mutated')
      await options.assertCurrent()
      throw Error('should not reach')
    })
    const f = await fixture(execute)
    await f.service.commands[0].handler(f.invocation as never)
    await f.service.whenIdle('p1')
    const status = await f.service.commands[1].handler({ ...f.invocation, rawInput: '' } as never)
    expect(status.text).toContain('MODULE_SOURCE_SNAPSHOT_CHANGED')
  })
})

it.each(['completed','partial'])('only full completed research enters the native report chain: %s',async status=>{const f=await fixture(vi.fn());let completed=0;const service=createModuleResearchCommands({readContext:()=>({project:f.project}),resolveBinding:()=>({root:f.root,standardProjectId:'standard-test'}),now:()=>new Date(),runtime:{execute:async()=>({status,moduleRuns:[],results:[]}) as never},onComplete:async()=>{completed++}});await service.commands[0].handler(f.invocation as never);await service.whenIdle('p1');expect(completed).toBe(status==='completed'?1:0)})

it('补齐全62项缺少的查询并冻结同一任务背景，再进入作者阶段',async()=>{
 const f=await fixture(vi.fn()),id='RUN-33333333-3333-3333-3333-333333333333'
 const original=await materialEvidence.captureMaterialCorpus(f.root)
 await mkdir(join(f.root,'research/runs',id),{recursive:true});await writeFile(join(f.root,'research/runs',id,'snapshot.json'),JSON.stringify({corpus:original,taskBrief:'冻结任务'}))
 vi.spyOn(await import('../src/research-v2/module-execution.ts'),'readModuleExecutionSummary').mockResolvedValue({projectId:'p1',results:[]} as never)
 let actual:any,count=0
 const service=createModuleResearchCommands({readContext:()=>({project:f.project}),resolveBinding:()=>({root:f.root,standardProjectId:'standard-test'}),now:()=>new Date(),
 prepareSources:(parent,request)=>acquireModuleWebCorpus(parent,request,{web:{query:async()=>({executionId:'web-'+(++count),childId:'web-child-'+count,verifiedEvidence:false,summary:'[]',retrievals:[{tool:'web_search',callId:'search',text:'No results.'}]})} as never}),
 runtime:{execute:async(_parent,request)=>{actual=request;return {status:'partial',moduleRuns:[],results:[]} as never}}})
 await service.commands[0].handler({...f.invocation,rawInput:'--all-modules --resume='+id} as never);await service.whenIdle('p1')
 const {moduleWebQueries}=await import('../src/research-v2/module-web-acquisition.ts');const {loadPlanningCatalog}=await import('../src/research-v2/catalog.ts')
 expect(actual.corpus.acquisition.queries).toHaveLength(moduleWebQueries(loadPlanningCatalog().modules.map(m=>m.id)).length)
 expect(actual.taskBrief).toBe('冻结任务');expect(actual.allowInputReuse).toBe(true)
})

describe('controlled Web research access', () => {
  const flags = { industryPlanning: false, existingBuildings: false, externalPartners: false, marketing: false }
  it('exposes the exact catalog and dependency closure without dispatching a model', async () => {
    const f = await fixture(vi.fn())
    const api = f.service as any
    expect(typeof api.catalog).toBe('function')
    expect(api.catalog().modules).toHaveLength(62)
    expect(api.plan({ moduleIds: ['1.02'], flags })).toMatchObject({ requestedModuleIds: ['1.02'], dependencyModuleIds: ['1.01'], missingDependencies: ['1.01'] })
    expect(api.plan({ moduleIds: ['1.01', '1.02'], flags }).missingDependencies).toEqual([])
    expect(api.plan({ moduleIds: ['1.01'], flags: {} }).pendingModuleIds.length).toBeGreaterThan(0)
    for (const moduleIds of [[], ['1.01', '1.01'], ['99.99']]) expect(() => api.plan({ moduleIds, flags })).toThrow()
  })
  it('keeps an explicit selection and exposes cancellation plus the actual final receipt', async () => {
    let resolve!: (value: unknown) => void, cancelled = false, reportDispatches = 0
    const execute = vi.fn(async (_parent: unknown, request: any) => {
      request.signal.addEventListener('abort', () => { cancelled = true; resolve({ status: 'cancelled', moduleRuns: [{ itemId: '1.01', status: 'cancelled' }], manifestRunId: 'saved-cancel', limitations: [] }) })
      return new Promise<any>(r => { resolve = r })
    })
    const f = await fixture(execute)
    const service = createModuleResearchCommands({ readContext: () => ({ project: f.project }), resolveBinding: () => ({ root: f.root, standardProjectId: 'standard-test' }), now: () => new Date(), runtime: { execute }, onComplete: async () => { reportDispatches++ } }) as any
    expect(typeof service.run).toBe('function')
    expect(service.status('p1')).toMatchObject({ status: 'idle', modules: [] })
    const result = await service.run(f.invocation.agent, { moduleIds: ['1.01'], flags }, new AbortController().signal)
    expect(result.kind).toBe('success')
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1))
    expect(execute.mock.calls[0][1]).toMatchObject({ moduleIds: ['1.01'], strictModuleSelection: true, flags })
    expect(service.status('p1').status).toBe('running')
    expect(service.progress('p1').total).toBe(1)
    service.cancel('p1'); await service.whenIdle('p1')
    expect(cancelled).toBe(true)
    expect(service.status('p1')).toMatchObject({ status: 'cancelled', manifestRunId: 'saved-cancel', modules: [{ itemId: '1.01', status: 'cancelled' }] })
    expect(reportDispatches).toBe(0)
  })
  it('rejects incomplete flags, missing unselected dependencies and forged fields before execution', async () => {
    const execute = vi.fn(), f = await fixture(execute), api = f.service as any
    expect(typeof api.run).toBe('function')
    for (const selection of [{ moduleIds: ['1.01'], flags: {} }, { moduleIds: ['1.02'], flags }, { moduleIds: ['1.01'], flags, provider: 'override' }]) {
      await expect(api.run(f.invocation.agent, selection, new AbortController().signal)).rejects.toThrow()
    }
    expect(execute).not.toHaveBeenCalled()
  })
})
