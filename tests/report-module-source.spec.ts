import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { captureMaterialCorpus } from '../src/materials/research-evidence.ts'
import { sha256CanonicalJson } from '../src/presentation/canonical-json.ts'
import { runModuleExecution, readModuleExecutionSummary, moduleReviewIsCurrent, type ModuleAnalysisContext, type ModuleExecutionRequest, type ModuleExecutionSummary, type ModuleClaim } from '../src/research-v2/module-execution.ts'
import { buildProjectTaskAudit, projectTaskStatements } from '../src/research-v2/project-task-audit.ts'
import { getModuleFieldContracts } from '../src/research-v2/module-contracts.ts'
import { getResearchModuleSpec } from '../src/research-v2/specification.ts'
import { boundaryReviewCriteria, buildBoundaryResearchAudit } from '../src/research-v2/boundary-audit.ts'
import { buildPeerProductArtifacts } from '../src/research-v2/peer-product-artifacts.ts'
import type { ClassExecution } from '../src/agent-classes/types.ts'
import { acquireModuleWebCorpus } from '../src/research-v2/module-web-acquisition.ts'
import { loadResearchSpecification } from '../src/research-v2/specification.ts'
import {acceptProgressReview,controlledResearchReady} from '../src/research-v2/module-progress-review.ts'
import {progressReviewSchema} from '../src/research-v2/native-progress-review.ts'
import {saveResearchAuditBundle} from '../src/research-v2/run-store.ts'

const url = new URL('../src/report/module-source.ts', import.meta.url)
async function api() { expect(existsSync(url), 'verified report module sources are implemented').toBe(true); return import(url.href) }
const originals = '少潭河项目，历史来源。'
const flags = { industryPlanning: true, existingBuildings: true, externalPartners: true, marketing: true }
let root: string, request: ModuleExecutionRequest, summary: ModuleExecutionSummary, subset: ModuleExecutionSummary, legacySummary: ModuleExecutionSummary, legacyTaskSummary: ModuleExecutionSummary
const executions: ClassExecution[] = []
const webEvents = new Map<string, {seq?:number; type: string; data: unknown }[]>()
const binding = () => ({ projectId: 'report-project', workspaceRoot: root, standardProjectId: 'standard-project' })
const native = { executions: async () => structuredClone(executions), readEvents: async (id: string) => webEvents.get(id) ?? [] }
function analysis(context: ModuleAnalysisContext, legacy = false, omitTaskAudit = false,limitedQa=false) {
  const contract = getModuleFieldContracts(context.module.id)
  const outputs = Object.fromEntries(Object.entries(contract.ports).map(([name, port]) => [name, {
    type: port.type, quality: 'limited', records: [{ recordId: 'record-1', resultClass: 'observation_summary',
      ...Object.fromEntries(port.fields.map(field => [field.name, { value: null, claimRefs: [], claimClass: 'missing', limitations: ['没有原始依据，保留缺项'] }])) }],
    claimRefs: [], limitations: ['历史资料有限'], scope: '原始资料可支持范围', asOf: '2026-09-27',
  }]))
  const claims: ModuleClaim[] = []
  for (const [name, port] of Object.entries(contract.ports)) {
    const field = port.fields.find(field => field.kind === 'text') ?? port.fields.find(field => field.kind === 'texts')!
    const claimId = `${name}-source`
    Object.assign(outputs[name].records[0], { [field.name]: { value: field.kind === 'texts' ? ['少潭河'] : '少潭河', claimRefs: [claimId], claimClass: 'source_conclusion', limitations: ['仅作为合同回归夹具'] } })
    ;(outputs[name].claimRefs as string[]).push(claimId)
    claims.push({ claimId, selector: `/outputs/${name}/records/0/${field.name}/value${field.kind === 'texts' ? '/0' : ''}`, kind: 'source', value: '少潭河', sourceId: 'original-name' })
  }
  if (context.module.id === '1.01') {
    const statement = projectTaskStatements(context.taskBrief)[0]
    const ref = { sessionId: statement.sessionId, seq: statement.seq, quote: statement.text }
    Object.assign(outputs.project_brief.records[0], { originalStatement: { value: statement.text, claimRefs: ['research-request'], claimClass: 'decision', limitations: ['Synthetic user research request; no formal approval'] } })
    ;(outputs.project_brief.claimRefs as string[]).push('research-request')
    claims.push({ claimId: 'research-request', selector: '/outputs/project_brief/records/0/originalStatement/value', kind: 'proposal', value: statement.text,
      rationale: 'Research task in this fixture only.\ntask_statement_refs=' + JSON.stringify([ref]) })
  }
  const document = context.corpus.documents[0]
  const candidate = { outputs, claims, sourceValues: [{ sourceId: 'original-name', path: document.path, contentHash: document.contentHash, quote: originals, rawValue: '少潭河' }], limitations: ['历史资料有限'] }
  const steps = [1, 2, 3, 4].map(step => ({ step, status: 'limited' as const, summary: '检查原始资料并保留缺项', claimRefs: [], limitations: ['资料有限'] }))
  const receipt = (classId: 'text' | 'review') => {
    const id = `${context.runId}-${context.module.id}-${classId}`
    executions.push({ id, projectId: context.projectId, classId, task: `${context.module.id} ${context.module.title} ${classId}`, parentId: 'parent-session',
      configurationRevision: 1, selected: { provider: 'fixture', model: classId, reasoningEffort: 'high' }, actual: { provider: 'fixture', model: classId, reasoningEffort: 'high' },
      childId: `${id}-child`, status: 'completed', childStopReason: 'completed', startedAt: '2026-09-27T00:00:00Z', updatedAt: '2026-09-27T00:00:01Z' })
    return { executionId: id, childId: `${id}-child`, actualModel: { provider: 'fixture', model: classId, ...(legacy ? {} : { reasoningEffort: 'high' }) }, stopReason: 'completed' }
  }
  const boundaryAudit=context.module.id==='1.02'?buildBoundaryResearchAudit(outputs, legacy ? 'research-boundary-audit.v2' : undefined):undefined
  const projectTaskAudit=context.module.id==='1.01'&&!omitTaskAudit?buildProjectTaskAudit({...candidate,steps},context.taskBrief):undefined
  const peerProductArtifacts=context.module.id==='3.05'?buildPeerProductArtifacts({...candidate,steps}):undefined
  const review={...receipt('review'),candidateHash:sha256CanonicalJson({...candidate,steps}),
    checks:boundaryReviewCriteria(getResearchModuleSpec(context.module.id).qa,boundaryAudit).map((criterion,index)=>({criterion,status:limitedQa&&context.module.id==='1.01'&&index===0?'limited' as const:'pass' as const,rationale:'原件绑定的测试夹具：条件方案的范围与限制通过本测试复核'})),limitations:['历史资料有限'],
    ...(boundaryAudit?{boundaryAuditHash:sha256CanonicalJson(boundaryAudit)}:{}),
    ...(projectTaskAudit?{projectTaskAuditHash:sha256CanonicalJson(projectTaskAudit)}:{}),
    ...(peerProductArtifacts?{peerProductArtifactsHash:sha256CanonicalJson(peerProductArtifacts)}:{})}
  const structuredOutput={checks:review.checks,limitations:review.limitations,...(boundaryAudit?{boundaryAuditHash:review.boundaryAuditHash}:{})}
  return {...candidate,execution:{...receipt('text'),steps,reviewReceipts:[review],...(projectTaskAudit?{projectTaskAudit}:{}),...(peerProductArtifacts?{peerProductArtifacts}:{}),...(boundaryAudit?{boundaryAudit,
    attempts:[{...review,classId:'review',status:'completed',structuredOutput,structuredHash:sha256CanonicalJson(structuredOutput)}]}:{})}}
}
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'report-module-source-'))
  await mkdir(join(root, '原始资料'))
  await writeFile(join(root, '原始资料', '项目.txt'), originals)
  const corpus = await acquireModuleWebCorpus({ id: 'parent-session' } as never, { workspaceRoot: root, projectId: binding().projectId, corpus: await captureMaterialCorpus(root),
    moduleIds: loadResearchSpecification().items.map(item => item.id), signal: new AbortController().signal }, { web: { query: async (_parent, _projectId, query) => {
      const id = `web-${executions.length}`, childId = `${id}-child`
      executions.push({ id, projectId: binding().projectId, parentId: 'parent-session', classId: 'web', task: query.slice(0, 300), status: 'completed', childId, childStopReason: 'completed',
        actual: { provider: 'fixture', model: 'web' }, selected: { provider: 'fixture', model: 'web' }, configurationRevision: 1, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
      webEvents.set(childId, [ { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: `网络查询任务：${query}` }] } },
        { type: 'tool/call', data: { callId: id, name: 'web_search' } },
        { type: 'tool/result', data: { message: { content: [{ type: 'tool-result', toolCallId: id, content: [{ type: 'text', text: 'No results' }] }] } } } ])
      return { executionId: id, childId, summary: '[]', retrievals: [{ tool: 'web_search', callId: id, text: 'No results' }], verifiedEvidence: false, guidance: 'test fixture' }
    } } })
  const taskBrief = 'Synthetic research request, not a construction approval.\n' + JSON.stringify({ sessionId: 'parent-session', seq: 1, time: '2026-09-27T00:00:00Z', text: '少潭河生态游憩条件式策划。' })
  const context = { projectId: binding().projectId, root, standardProjectId: binding().standardProjectId }
  request = { workspaceRoot: root, projectId: context.projectId, corpus, flags, taskBrief,
    snapshotId: `snapshot-${sha256CanonicalJson({ context, fingerprint: corpus.fingerprint, flags, taskBrief })}` }
  summary = await runModuleExecution(request, { analyze: async context => analysis(context) })
  expect(summary.status, JSON.stringify(summary.moduleRuns.filter(row => row.status !== 'completed').slice(0, 3))).toBe('completed')
  expect(summary.results).toHaveLength(62)
  subset = await runModuleExecution({ ...request, moduleIds: ['1.01'] }, { analyze: async context => analysis(context) })
  expect(subset.status).toBe('completed')
  legacySummary = await runModuleExecution(request, { analyze: async context => analysis(context, true) })
  expect(legacySummary.status).toBe('completed')
  legacyTaskSummary = await runModuleExecution({ ...request, moduleIds: ['1.01'] }, { analyze: async context => analysis(context, false, true) })
  expect(legacyTaskSummary.status).toBe('completed')
}, 90_000)
afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }) })

describe('verified research selection for report consumption', { timeout: 20_000 }, () => {
  it('consumes fully covered conditional research only with independently verified final progress permission and carries its limits into report sources',async()=>{
    const m=await api(),selection=await m.beginReportResearchSelection(binding(),request,{parentId:'parent-session'})
    const reviewProgress:NonNullable<import('../src/research-v2/module-execution.ts').ModuleExecutionDependencies['reviewProgress']>=async checkpoint=>{
      const id='progress-'+checkpoint.requestHash,childId=id+'-child',route={provider:'fixture',model:'review',reasoningEffort:'high'}
      const scoped=checkpoint.reason==='phase-end'
      const decision={requestHash:checkpoint.requestHash,verdict:scoped?'pause' as const:'continue' as const,rationale:'Options remain inside the explicitly bounded task; verified implementation rights stay held.',
        conditions:checkpoint.requiredConditions.map((c,i)=>({...c,permission:scoped&&i===0?'hold' as const:'proceed' as const,reason:'Historical only; implementation rights remain unknown.',verification:'Next three substantive modules or changed premises.',
          scope:scoped&&i===0?{kind:'conclusions' as const,allowedUses:['Conditional planning comparison'],heldUses:['Verified implementation rights'],reviewAfterModules:3 as const}:
            {kind:'none' as const,allowedUses:[],heldUses:[],reviewAfterModules:3 as const}})),driftFindings:[]}
      executions.push({id,childId,projectId:request.projectId,parentId:'parent-session',classId:'review',task:checkpoint.results.at(-1)!.itemId+' progress-review',
        configurationRevision:1,selected:route,actual:route,status:'completed',childStopReason:'completed',startedAt:new Date().toISOString(),updatedAt:new Date().toISOString()})
      webEvents.set(childId,[{seq:1,type:'turn/start',data:{turn:1}},{seq:2,type:'request/header',data:{turn:1,header:{config:route,tools:[{name:'structured_output',parameters:progressReviewSchema(checkpoint)}]}}},
        {seq:3,type:'tool/call',data:{turn:1,name:'structured_output',callId:id,arguments:JSON.stringify(decision)}},
        {seq:4,type:'tool/result',data:{turn:1,message:{content:[{type:'tool-result',toolCallId:id,isError:false}]}}},
        {seq:5,type:'turn/end',data:{turn:1,reason:{kind:'completed'}}}])
      return acceptProgressReview(checkpoint,decision,{executionId:id,childId,actualModel:route,stopReason:'completed'})
    }
    const conditional=await runModuleExecution(request,{analyze:async context=>analysis(context,false,false,true),reviewProgress})
    expect(conditional.status).toBe('partial')
    expect(conditional.researchProgress!.reviews.at(-1)!.decision.verdict).toBe('pause')
    expect(controlledResearchReady(conditional)).toBe(true)
    await m.acceptReportResearchSelection(binding(),selection,conditional,native)
    const load=await m.loadReportModuleResearch(binding(),native)
    expect(load.status).toBe('ready')
    expect(load.research.deliveryMode).toBe('conditional')
    expect(load.research.moduleRuns[0].status).toBe('limited')
    const {makeModuleManuscriptSources}=await import('../src/report/manuscript/module-sources.ts')
    const sources=makeModuleManuscriptSources(load.research)
    expect(sources.find(source=>source.moduleLineage?.itemId==='1.01')!.basis).toContain('implementation rights remain unknown')
    expect(sources.find(source=>source.moduleLineage?.itemId==='1.01')!.basis).toContain('Verified implementation rights')
    const analyzed:string[]=[]
    const resumed=await runModuleExecution({...request,resumeRunIds:[conditional.manifestRunId]},{reviewProgress,
      analyze:async context=>{analyzed.push(context.module.id);return analysis(context,false,false,true)}})
    expect(analyzed,'unchanged reviewed fields must not be reauthored to refresh conditional permission').toEqual([])
    expect(resumed.results).toEqual(conditional.results)
    const previousProgress=conditional.researchProgress!,resumedProgress=resumed.researchProgress!
    expect(resumedProgress.steps).toEqual(previousProgress.steps)
    expect(resumedProgress.reviews.slice(0,-1)).toEqual(previousProgress.reviews)
    expect(resumedProgress.reviews).toHaveLength(previousProgress.reviews.length+1)
    const freshReview=resumedProgress.reviews.at(-1)!
    expect(freshReview.binding).toMatchObject({reason:'phase-end',afterStep:previousProgress.steps.length,
      previousReviewHashes:previousProgress.reviews.map(review=>review.hash)})
    expect(previousProgress.reviews.map(review=>review.hash)).not.toContain(freshReview.hash)
    expect(previousProgress.reviews.map(review=>review.execution.executionId)).not.toContain(freshReview.execution.executionId)
    expect(previousProgress.reviews.map(review=>review.execution.childId)).not.toContain(freshReview.execution.childId)
    expect(await readModuleExecutionSummary(root,conditional.manifestRunId)).toMatchObject(conditional)
    expect(controlledResearchReady(resumed)).toBe(true)
    await m.acceptReportResearchSelection(binding(),selection,resumed,native)
    const resumedLoad=await m.loadReportModuleResearch(binding(),native)
    expect(resumedLoad.status).toBe('ready')
    expect(resumedLoad.research.manifestRunId).toBe(resumed.manifestRunId)
    await expect(m.acceptReportResearchSelection(binding(),selection,resumed,{...native,
      executions:async()=>executions.filter(row=>row.id!==freshReview.execution.executionId)})).rejects.toThrow(/NATIVE/)
    await expect(m.acceptReportResearchSelection(binding(),selection,resumed,{...native,
      readEvents:async(id:string)=>id===freshReview.execution.childId?[]:native.readEvents(id)})).rejects.toThrow(/native/)
    const absent=await runModuleExecution({...request,moduleIds:['1.01']},{analyze:async context=>analysis(context,false,false,true)})
    expect(controlledResearchReady(absent)).toBe(false)
    await expect(m.acceptReportResearchSelection(binding(),selection,absent,native)).rejects.toThrow(/COVERAGE/)
    await rm(join(root,'.pre-design','report-research','report-project','selection.json'),{force:true})
  },120000)
  it('keeps a historical task review readable but requires fresh task audit and independent review before reuse', async () => {
    const before = await readModuleExecutionSummary(root, legacyTaskSummary.manifestRunId)
    expect(before).toMatchObject(legacyTaskSummary)
    expect(before.status).toBe('completed')
    expect(moduleReviewIsCurrent(legacyTaskSummary.results[0])).toBe(false)
    const analyzed: string[] = []
    const resumed = await runModuleExecution({ ...request, moduleIds: ['1.01'], resumeRunIds: [legacyTaskSummary.manifestRunId] }, {
      analyze: async context => { analyzed.push(context.module.id); return analysis(context) },
    })
    expect(analyzed).toEqual(['1.01'])
    expect(resumed.status).toBe('completed')
    expect(moduleReviewIsCurrent(resumed.results[0])).toBe(true)
    expect(resumed.moduleRuns[0].bundleRunId).not.toBe(legacyTaskSummary.moduleRuns[0].bundleRunId)
    expect(await readModuleExecutionSummary(root, legacyTaskSummary.manifestRunId)).toEqual(before)
  })
  it('keeps old reviewed research readable but rejects report acceptance without the current precision review', async () => {
    const m=await api()
    const selection=await m.beginReportResearchSelection(binding(),request,{parentId:'parent-session'})
    try { await expect(m.acceptReportResearchSelection(binding(),selection,legacySummary,native)).rejects.toThrow('REPORT_MODULE_REVIEW_VERSION') }
    finally { await rm(join(root,'.pre-design','report-research','report-project','selection.json'),{force:true}) }
  })
  it('rebuilds an outdated boundary review and all its descendants while reusing its unaffected ancestor', async () => {
    const analyzed: string[]=[]
    const resumed=await runModuleExecution({...request,resumeRunIds:[legacySummary.manifestRunId]}, {analyze:async context=>{analyzed.push(context.module.id);return analysis(context)}})
    expect(resumed.status).toBe('completed')
    expect(analyzed).toHaveLength(61)
    expect(analyzed).not.toContain('1.01')
    expect(resumed.moduleRuns.find(x=>x.itemId==='1.01')?.bundleRunId).toBe(legacySummary.moduleRuns.find(x=>x.itemId==='1.01')?.bundleRunId)
    expect(resumed.moduleRuns.find(x=>x.itemId==='1.02')?.bundleRunId).not.toBe(legacySummary.moduleRuns.find(x=>x.itemId==='1.02')?.bundleRunId)
  })
  it('keeps legacy projects explicit and replays all 62 sources against current original files and host receipts', async () => {
    const m = await api()
    expect((await m.loadReportModuleResearch(binding(), native)).status).toBe('not_requested')
    const selection = await m.beginReportResearchSelection(binding(), request, { parentId: 'parent-session' })
    expect((await m.loadReportModuleResearch(binding(), native)).status).toBe('not_ready')
    await m.acceptReportResearchSelection(binding(), selection, summary, native)
    const loaded = await m.loadReportModuleResearch(binding(), native)
    expect(loaded.status).toBe('ready')
    expect(loaded.research.results).toHaveLength(62)
    expect(loaded.research.manifestRunId).toBe(summary.manifestRunId)
    expect(loaded.research.taskBrief).toBe(request.taskBrief)
    expect((await m.loadReportModuleResearch(binding(), native)).research.fingerprint).toBe(loaded.research.fingerprint)
  })
  it('shares simultaneous report guards without retaining a completed or failed verification', async () => {
    const m=await api(),selection=await m.beginReportResearchSelection(binding(),request,{parentId:'parent-session'})
    await m.acceptReportResearchSelection(binding(),selection,summary,native)
    let calls=0,missing=false
    const load=m.createReportModuleResearchLoader({...native,executions:async()=>{calls++;return missing?[]:native.executions()}})
    const rows=await Promise.all([load(binding()),load(binding()),load(binding())])
    expect(rows.every(row=>row.status==='ready')).toBe(true);expect(calls).toBe(1)
    missing=true
    await expect(load(binding())).rejects.toThrow(/NATIVE/);expect(calls).toBe(2)
    missing=false
    expect((await load(binding())).status).toBe('ready');expect(calls).toBe(3)
  })
  it('reuses the deterministic replay while still rejecting changed native receipts, originals and expired research', async () => {
    const m = await api(), selection = await m.beginReportResearchSelection(binding(), request, { parentId: 'parent-session' })
    await m.acceptReportResearchSelection(binding(), selection, summary, native)
    let missingNative = false, now = new Date()
    const load = m.createReportModuleResearchLoader({ ...native, executions: async () => missingNative ? [] : native.executions(), now: () => now })
    const first = await load(binding()), again = await load(binding())
    expect(first.status).toBe('ready'); expect(again.research.results).toBe(first.research.results)
    missingNative = true
    await expect(load(binding())).rejects.toThrow(/NATIVE/)
    missingNative = false
    await writeFile(join(root, '原始资料', '项目.txt'), '资料已变更')
    try { await expect(load(binding())).rejects.toThrow(/SOURCE|SNAPSHOT/) }
    finally { await writeFile(join(root, '原始资料', '项目.txt'), originals) }
    now = new Date(Date.now() + 91 * 86400000)
    await expect(load(binding())).rejects.toThrow('REPORT_MODULE_EXPIRED')
  })
  it('accepts a full audit larger than the request-file limit without dropping source or native receipt verification', async () => {
    const directory = join(root, 'research', 'runs', summary.manifestRunId)
    const original = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'))
    const files = Object.fromEntries(await Promise.all(original.files.map(async (entry: {path: string}) =>
      [entry.path, await readFile(join(directory, entry.path), 'utf8')])))
    // Valid JSON whitespace grows the stored audit while leaving every research value unchanged.
    files['run.json'] = ' '.repeat(3 * 1024 * 1024) + files['run.json']
    const {manifestHash: _oldHash, ...core} = original
    core.files = original.files.map((entry: {path: string}) => ({path: entry.path,
      sha256: createHash('sha256').update(files[entry.path]).digest('hex'), sizeBytes: Buffer.byteLength(files[entry.path])}))
    const saved = await saveResearchAuditBundle(root, {files, manifest: {...core, manifestHash: sha256CanonicalJson(core)}}, () => {})
    const large = await readModuleExecutionSummary(root, saved.runId)
    expect(large.results).toEqual(summary.results)
    const m = await api(), selection = await m.beginReportResearchSelection(binding(), request, {parentId: 'parent-session'})
    await m.acceptReportResearchSelection(binding(), selection, large, native)
    const loaded = await m.loadReportModuleResearch(binding(), native)
    expect(loaded.status).toBe('ready')
    expect(loaded.research.results).toHaveLength(62)
    await expect(m.loadReportModuleResearch(binding(), {...native, now: () => new Date(Date.now() + 91 * 86400000)})).rejects.toThrow('REPORT_MODULE_EXPIRED')
    await expect(m.loadReportModuleResearch(binding(), {...native, executions: async () => []})).rejects.toThrow(/NATIVE/)
  })
  it('rejects completed subsets, absent native records and receipts borrowed from another project', async () => {
    const m = await api(), selection = await m.beginReportResearchSelection(binding(), request, { parentId: 'parent-session' })
    await expect(m.acceptReportResearchSelection(binding(), selection, subset, native)).rejects.toThrow(/COVERAGE/)
    await expect(m.acceptReportResearchSelection(binding(), selection, summary, { executions: async () => [] })).rejects.toThrow(/NATIVE/)
    await expect(m.acceptReportResearchSelection(binding(), selection, summary, { executions: async () => executions.map(e => ({ ...e, projectId: 'another-project' })) })).rejects.toThrow(/NATIVE/)
    await expect(m.acceptReportResearchSelection({ ...binding(), standardProjectId: 'another-standard-project' }, selection, summary, native)).rejects.toThrow(/BINDING|SNAPSHOT/)
  })
  it('rejects author or reviewer native records that used a different explicit reasoning depth', async () => {
    const m = await api(), selection = await m.beginReportResearchSelection(binding(), request, { parentId: 'parent-session' })
    for (const classId of ['text', 'review']) {
      await expect(m.acceptReportResearchSelection(binding(), selection, summary, {
        ...native, executions: async () => executions.map(row => row.classId === classId
          ? { ...row, actual: { ...row.actual!, reasoningEffort: 'low' } } : row),
      })).rejects.toThrow('REPORT_MODULE_NATIVE_UNVERIFIED')
    }
  })
  it('expires current research after its review window without discarding historical original material', async()=>{
    const m=await api(),selection=await m.beginReportResearchSelection(binding(),request,{parentId:'parent-session'})
    await m.acceptReportResearchSelection(binding(),selection,summary,native)
    expect((await m.loadReportModuleResearch(binding(),native)).status).toBe('ready')
    await expect(m.loadReportModuleResearch(binding(),{...native,now:()=>new Date(Date.now()+91*86400000)})).rejects.toThrow('REPORT_MODULE_EXPIRED')
  })
  it('rejects a web receipt borrowed from an unrelated native task or rewritten tool output', async () => {
    const m = await api(), selection = await m.beginReportResearchSelection(binding(), request, { parentId: 'parent-session' })
    await expect(m.acceptReportResearchSelection(binding(), selection, summary, { ...native, executions: async () => executions.map(row => row.classId === 'web' ? { ...row, task: 'unrelated cover illustration' } : row) })).rejects.toThrow('REPORT_MODULE_WEB_NATIVE_UNVERIFIED')
    await expect(m.acceptReportResearchSelection(binding(), selection, summary, { ...native, readEvents: async () => [] })).rejects.toThrow('REPORT_MODULE_WEB_NATIVE_UNVERIFIED')
  })
  it('expires every previous success when a new full run starts and rejects a late old completion', async () => {
    const m = await api(), first = await m.beginReportResearchSelection(binding(), request, { parentId: 'parent-session' })
    await m.acceptReportResearchSelection(binding(), first, summary, native)
    const second = await m.beginReportResearchSelection(binding(), request, { parentId: 'parent-session' })
    expect(second.selectionId).not.toBe(first.selectionId)
    expect((await m.loadReportModuleResearch(binding(), native)).status).toBe('not_ready')
    await expect(m.acceptReportResearchSelection(binding(), first, summary, native)).rejects.toThrow(/SELECTION_CHANGED/)
    expect((await m.loadReportModuleResearch(binding(), native)).status).toBe('not_ready')
  })
  it('does not consume an earlier snapshot or a changed original even if the old revision did not change', async () => {
    const m = await api(), selection = await m.beginReportResearchSelection(binding(), request, { parentId: 'parent-session' })
    await m.acceptReportResearchSelection(binding(), selection, summary, native)
    await writeFile(join(root, '原始资料', '项目.txt'), '同名原件已经替换。')
    try { await expect(m.loadReportModuleResearch(binding(), native)).rejects.toThrow(/SOURCE|SNAPSHOT/) }
    finally { await writeFile(join(root, '原始资料', '项目.txt'), originals) }
    const changed = { ...request, taskBrief: '用户改变任务为其他项目研究', snapshotId: 'snapshot-other' }
    const current = await m.beginReportResearchSelection(binding(), changed, { parentId: 'parent-session' })
    await expect(m.acceptReportResearchSelection(binding(), current, summary, native)).rejects.toThrow(/SNAPSHOT/)
  })
  it('keeps the frozen brief for operational commands but rejects new business task messages', async () => {
    const m = await api()
    const original = { sessionId: 'parent-session', seq: 1, time: '2026-09-27T00:00:00Z', text: '开展生态研学策划' }
    const selection = await m.beginReportResearchSelection(binding(), request, { parentId: 'parent-session', statements: [original] })
    const load = { status: 'not_ready', selection }
    for (const text of ['/preplan-export', '/preplan-export --reuse-images', '/preplan-status', '/preplan-research-status', '/preplan-pause', '/preplan-run', '/preplan-mode automatic 0 standard']) {
      expect(() => m.assertReportTaskUnchanged(load, [original, { ...original, seq: 2, text }]), text).not.toThrow()
    }
    for (const text of ['改为大规模商业建设策划', '/preplan-revise --source PS03 将研究范围调整为商业开发', '/preplan-new 新任务', '/preplan-export 将范围扩大', '/preplan-status\n将范围扩大']) {
      expect(() => m.assertReportTaskUnchanged(load, [original, { ...original, seq: 2, text }]), text).toThrow(/TASK_CHANGED/)
    }
  })
})
