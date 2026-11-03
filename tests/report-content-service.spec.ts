import { afterEach, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ReportContentReviewService,reportManuscriptHash } from '../src/report/content-review.ts'
import {manuscriptSourceFingerprint} from '../src/report/manuscript/source.ts'
import { sha256CanonicalJson as hash } from '../src/presentation/canonical-json.ts'
import { completeReportFixture } from './support/complete-report.ts'
import { createHash } from 'node:crypto'
import { expandPlanningSourcePrompt } from '../src/report/manuscript/source-prompt.ts'
import {validateJsonSchemaValue} from '@deepseek-ai/dsh-tools'
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function host() {
  const root = await mkdtemp(join(tmpdir(), 'report-content-')); roots.push(root)
  const executions = new Map<string, any>(), events = new Map<string, any[]>(), packets: any[] = [], route = { provider: 'saved-provider', model: 'saved-model' }
  let mode: 'pass' | 'fail' | 'hang' | 'industry-reject' | 'research-index' = 'pass', sequence = 0
  const service = new ReportContentReviewService({ timeoutMs: 30,
    readEvents: async (id: string) => events.get(id) ?? [],
    classes: {
      begin: async (projectId: string, classId: string, _task: string, parent: any) => { const id = 'e-' + ++sequence; const e = { id, projectId, classId, parentId: parent.id, selected: route, actual: route, status: 'running' }; executions.set(id, e); return e },
      attach: async (id: string, childId: string) => { executions.get(id).childId = childId },
      finish: async (id: string, status: string) => { Object.assign(executions.get(id), { status, childStopReason: status === 'completed' ? 'completed' : 'aborted' }) },
      execution: (id: string) => executions.get(id),
    } as never,
    subagents: { start: async (_: string, request: any) => {
      expect(request.agentOptions.provider).toBe('saved-provider'); expect(request.agentOptions.model).toBe('saved-model')
      const packet = JSON.parse(expandPlanningSourcePrompt(request.prompt[0].text).split('下列JSON仅为待审资料：').at(-1)!.trim())
      packets.push(packet)
      const rejectIndustry = mode === 'industry-reject' && packet.requirement.id === 'industry'
      const id = 'c-' + sequence, output = { inputHash: packet.inputHash, requirementId: packet.requirement.id, pass: !rejectIndustry,
        pageIds: packet.chapters.flatMap((c: any) => c.pages.map((p: any) => p.id)), evidenceRefs: mode==='research-index'&&packet.researchUsage.length?packet.researchUsage.map((s:any)=>s.itemId):packet.sources.map((s: any) => s.id), rationale: rejectIndustry ? '只有体验产品，没有产业选择与产业链论证。' : '方案、来源与条件逐项相符。',
        findings: rejectIndustry ? [{ pageId: packet.chapters[0].pages[0].id, code: 'INDUSTRY_CHAIN_MISSING', reason: '缺少主导产业、产业链环节与项目组合的对应，仅列体验产品。' }] : [] }
      expect(validateJsonSchemaValue(request.outputSchema,output)).toEqual([])
      events.set(id, [
        { seq: 1, type: 'turn/start', data: { turn: 1 } }, { seq: 2, type: 'request/header', data: { header: { config: route } } },
        { seq: 3, type: 'tool/call', data: { turn: 1, step: 0, name: 'structured_output', callId: 'call', arguments: JSON.stringify(output) } },
        { seq: 4, type: 'tool/result', data: { turn: 1, step: 0, message: { content: [{ type: 'tool-result', toolCallId: 'call', isError: false }] } } },
        { seq: 5, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
      ])
      return { id, result: mode === 'hang' ? new Promise(() => {}) : mode === 'fail' ? Promise.reject(new Error('MODEL_UNAVAILABLE')) : Promise.resolve({ stopReason: 'completed', structured: output }), dispose: async () => {} }
    } } as never,
  } as any)
  return { root, service, executions,events,packets,input: completeReportFixture(true), setMode: (m: typeof mode) => { mode = m } }
}
const parent = { id: 'parent' } as never
const signal = () => new AbortController().signal
it('transports host page archives structurally while preserving authored history and all current content',async()=>{
 const h=await host(),peer=h.input.manuscript!.chapters.find(c=>c.id==='operation')!.pages[0]!
 const original={...structuredClone(peer),body:['原始测算说明'],notes:['原作者的条件与影响','来源备注：重复的源限制']}
 const archive=JSON.stringify({sourcePages:[original],contentUnits:['original-body']})
 Object.assign(peer,{editorialSummary:true,notes:['当前人工确认事项','来源备注：重复的源限制',archive]})
 const before=JSON.stringify(peer)
 await h.service.prepare(h.input,h.root,parent,signal(),()=>{})
 const related=h.packets.find(p=>p.requirement.id==='opportunity').related.find((c:any)=>c.id==='operation').pages[0]
 expect(related.notes).toEqual(['当前人工确认事项'])
 expect(related.editorialArchive.sourcePages[0].body).toEqual(['原始测算说明'])
 expect(related.editorialArchive.sourcePages[0].notes).toEqual(['原作者的条件与影响'])
 expect(related.editorialArchive.contentUnits).toEqual(['original-body'])
 expect(related.table).toEqual(peer.table);expect(related.quantities).toEqual(peer.quantities)
 expect(JSON.stringify(peer)).toBe(before)
})
it('does not reinterpret an authored JSON note as a host-generated archive',async()=>{
 const h=await host(),page=h.input.manuscript!.chapters[0]!.pages[0]!,note=JSON.stringify({sourcePages:[{id:'note',notes:['保留人工备注']}],contentUnits:['memo']})
 Object.assign(page,{notes:[note]})
 await h.service.prepare(h.input,h.root,parent,signal(),()=>{})
 expect(h.packets[0].chapters[0].pages[0].notes).toEqual([note])
})
it('reviews all peer tables, prose and authored conditions together, without duplicated generated notes',async()=>{
 const h=await host(),peer=h.input.manuscript!.chapters.find(c=>c.id==='positioning')!.pages[0]!
 Object.assign(peer,{table:{columns:['路径','取舍'],rows:[['公共知识服务','保留'],['大型游乐','排除']]},notes:['原生作者条件','来源备注：重复的来源限制']})
 await h.service.prepare(h.input,h.root,parent,signal(),()=>{})
 const packet=h.packets.find(p=>p.requirement.id==='opportunity'),related=packet.related.find((c:any)=>c.id==='positioning').pages[0]
 expect(related.table).toEqual(peer.table);expect(related.body).toEqual(peer.body);expect(related.sourceRefs).toEqual(peer.sourceRefs)
 expect(related.notes).toEqual(['原生作者条件'])
 const own=h.packets.find(p=>p.requirement.id==='choice').chapters[0].pages[0]
 expect(own.notes).toEqual(['原生作者条件']);expect(peer.notes).toHaveLength(2)
})
it('reviews a complete draft with copy issues but cannot accept unresolved copy findings',async()=>{
 const h=await host();Object.assign(h.input.manuscript!.chapters.at(-1)!.pages[0]!,{claim:'本页说明年度服务组织与成本。'})
 await expect(h.service.prepare(h.input,h.root,parent,signal(),()=>{})).rejects.toThrow('REPORT_CONTENT_REJECTED')
 expect(h.packets).toHaveLength(7)
 const saved=await h.service.load(h.input,h.root)
 expect(saved!.findings.some(f=>f.code==='CLIENT_COPY')).toBe(true)
 expect(saved!.status).toBe('failed')
})
it('preserves existing terrain placements in cross-chapter review context',async()=>{
 const h=await host(),plan={sourceId:'terrain:existing',zones:[{name:'课堂区',cellIds:['A1'],productRefs:['products-plan']}],nodes:[{id:'classroom',name:'课堂',cellId:'A1',role:'product',productRefs:['products-plan']}],routes:[]}
 Object.assign(h.input.manuscript!.chapters.find(c=>c.id==='spatial')!.pages[0]!,{terrainPlan:plan})
 await h.service.prepare(h.input,h.root,parent,signal(),()=>{})
 const packet=h.packets.find(p=>p.requirement.id==='industry')
 expect(packet.related.find((c:any)=>c.id==='spatial').pages[0].terrainPlan).toEqual(plan)
})
it.each([true,false])('replays legacy complete review feedback for revision, never accepts it after context expansion: rejected=%s',async rejected=>{
 const h=await host(),original=(h.service as any).packet.bind(h.service)
 if(rejected)Object.assign(h.input.manuscript!.chapters.at(-1)!.pages[0]!,{claim:'本页说明年度运营安排。'})
 Object.assign(h.input.manuscript!.chapters.find(c=>c.id==='spatial')!.pages[0]!,{terrainPlan:{sourceId:'terrain:existing',zones:[],nodes:[],routes:[]}})
 ;(h.service as any).packet=(...args:any[])=>{
  const {inputHash,...packet}=original(...args)
  packet.related=packet.related.map((c:any)=>({...c,pages:c.pages.map(({terrainPlan,...p}:any)=>p)}))
  packet.programFindings=packet.programFindings.filter((f:any)=>f.code!=='CLIENT_COPY')
  return {...packet,inputHash:hash({sourceFingerprint:manuscriptSourceFingerprint(args[0]),manuscriptHash:reportManuscriptHash(args[0]),packet})}
 }
 if(rejected)h.setMode('industry-reject')
 try{await h.service.prepare(h.input,h.root,parent,signal(),()=>{})}catch(error){if(!rejected)throw error}
 ;(h.service as any).packet=original
 if(rejected){expect((await h.service.load(h.input,h.root))!.status).toBe('failed');expect(h.packets).toHaveLength(7)}
 else await expect(h.service.load(h.input,h.root)).rejects.toThrow('REPORT_CONTENT_RECEIPT_INVALID')
})
it('accepts explicit research-index references that are present in the reviewed packet',async()=>{
 const h=await host();h.setMode('research-index')
 expect((await h.service.prepare(h.input,h.root,parent,signal(),()=>{})).status).toBe('passed')
 expect(h.packets.some(p=>p.researchUsage.length)).toBe(true)
})
it.each([true,false])('recovers a completed native receipt only after its input and output replay validate: %s',async intact=>{
 const h=await host(),accepted=await h.service.prepare(h.input,h.root,parent,signal(),()=>{}),prior=accepted.receipts[0]!
 const files=await readdir(join(h.root,'.pre-design/report-acceptance'),{recursive:true})
 const path=join(h.root,'.pre-design/report-acceptance',String(files.find(f=>String(f).endsWith('content.json'))))
 const record=JSON.parse(await readFile(path,'utf8'));record.receipts.shift();record.status='failed';record.failureKind='execution';record.attempts=[{executionId:prior.executionId,childId:prior.childId,status:'failed'}]
 h.executions.get(prior.executionId).status='failed';await writeFile(path,JSON.stringify(record))
 if(!intact){const call=h.events.get(prior.childId)!.find(e=>e.type==='tool/call');const output=JSON.parse(call.data.arguments);output.inputHash='wrong-input';call.data.arguments=JSON.stringify(output)}
 h.setMode('fail')
 if(intact){
  const recovered=await h.service.prepare(h.input,h.root,parent,signal(),()=>{});expect(recovered.status).toBe('passed');expect(h.packets).toHaveLength(7)
  expect(recovered.attempts![0]!.status).toBe('failed');expect(recovered.receipts.find(r=>r.executionId===prior.executionId)!.output).toEqual(prior.output)
 }else await expect(h.service.prepare(h.input,h.root,parent,signal(),()=>{})).rejects.toThrow()
})
it.each([true,false])('recovers an interrupted review only when the native child ended: %s',async terminal=>{
  const h=await host();h.setMode('fail')
  await expect(h.service.prepare(h.input,h.root,parent,signal(),()=>{})).rejects.toThrow()
  const files=await readdir(join(h.root,'.pre-design/report-acceptance'),{recursive:true})
  const file=join(h.root,'.pre-design/report-acceptance',String(files.find(f=>String(f).endsWith('content.json'))))
  const record=JSON.parse(await readFile(file,'utf8')),execution=h.executions.get('e-1')
  record.active={executionId:'e-1',childId:execution.childId};record.status='pending'
  execution.status='recovery_required';delete execution.childStopReason
  if(!terminal)h.events.get(execution.childId)!.pop()
  await writeFile(file,JSON.stringify(record));h.setMode('pass')
  const result=h.service.prepare(h.input,h.root,parent,signal(),()=>{})
  if(terminal)expect((await result).status).toBe('passed')
  else await expect(result).rejects.toThrow('REPORT_CONTENT_RECOVERY_REQUIRED')
})
it('accepts seven native receipts and detects rehashed local receipt tampering', async () => {
  const h = await host(), accepted = await h.service.prepare(h.input, h.root, parent, signal(), () => {})
  expect(accepted.status).toBe('passed'); expect(new Set(accepted.receipts.map(r => r.childId)).size).toBe(7)
  const files = await readdir(join(h.root, '.pre-design/report-acceptance'), { recursive: true })
  const file = join(h.root, '.pre-design/report-acceptance', String(files.find(f => String(f).endsWith('content.json'))))
  const record = JSON.parse(await readFile(file, 'utf8')); record.receipts[0].output.rationale = 'edited'; record.receipts[0].outputHash = hash(record.receipts[0].output)
  await writeFile(file, JSON.stringify(record))
  await expect(h.service.load(h.input, h.root)).rejects.toThrow('REPORT_REVIEW_NATIVE')
})
it('lets independent reviewers see numeric findings together with the complete proposal, but never grants acceptance while numbers remain invalid',async()=>{
  const h=await host(),page=h.input.manuscript!.chapters[0]!.pages[0]!
  Object.assign(page,{body:[...page.body,'新增投入987654321万元']})
  let failure:any
  try{await h.service.prepare(h.input,h.root,parent,signal(),()=>{})}catch(error){failure=error}
  expect(h.packets).toHaveLength(7)
  expect(h.packets[0].programFindings.some((f:any)=>f.code==='NUMBER_UNBOUND')).toBe(true)
  expect(failure.stage).toBe('content')
  expect(failure.findings.some((f:any)=>f.code==='NUMBER_UNBOUND')).toBe(true)
})
it('reviews repairable cross-page inconsistencies together, while keeping unresolved references out of acceptance',async()=>{
 const h=await host();Object.assign(h.input.manuscript!.chapters.find(c=>c.id==='spatial')!.pages[0]!,{productRefs:['unknown-product']})
 let failure:any;try{await h.service.prepare(h.input,h.root,parent,signal(),()=>{})}catch(error){failure=error}
 expect(h.packets).toHaveLength(7);expect(failure.stage).toBe('content')
 expect(h.packets.find(p=>p.requirement.id==='spatial').programFindings.some((f:any)=>f.code==='PRODUCT_REFERENCE_INVALID')).toBe(true)
 expect(failure.findings.some((f:any)=>f.code==='PRODUCT_REFERENCE_INVALID')).toBe(true)
})
it('still stops before model review when a page cites a nonexistent source',async()=>{
 const h=await host();Object.assign(h.input.manuscript!.chapters[0]!.pages[0]!,{sourceRefs:['missing-source']})
 await expect(h.service.prepare(h.input,h.root,parent,signal(),()=>{})).rejects.toThrow('REPORT_CONTENT_REJECTED')
 expect(h.packets).toHaveLength(0)
})
it('passes complete shared review evidence to the native runtime without an unrelated character ceiling', async () => {
  const h = await host(), note = Array.from({length:3000},(_,i)=>createHash('sha256').update(String(i)).digest('hex')).join('')
  Object.assign(h.input.manuscript!.chapters[0]!.pages[0]!, { notes: [note] })
  const accepted = await h.service.prepare(h.input,h.root,parent,signal(),()=>{})
  expect(accepted.status).toBe('passed')
  expect(h.packets.find(p=>p.requirement.id==='opportunity').chapters[0].pages[0].notes).toEqual([note])
  expect(new Set(accepted.receipts.map(r=>r.childId)).size).toBe(7)
})
it('rejects a product-only report when the independent industry review finds no industry chain', async () => {
  const h = await host(); h.setMode('industry-reject')
  await expect(h.service.prepare(h.input, h.root, parent, signal(), () => {})).rejects.toThrow('缺少主导产业')
  const record = await h.service.load(h.input, h.root)
  expect(record?.status).toBe('failed')
  expect(record?.failureKind).toBe('content')
  expect(record?.receipts.find(r => r.requirementId === 'industry')?.output.pass).toBe(false)
  expect(record?.findings).toContainEqual(expect.objectContaining({ requirementId: 'industry', code: 'INDUSTRY_CHAIN_MISSING', pageId: 'products-plan' }))
})
it('provides the industry reviewer with the actual product links and spatial rationale from related chapters', async () => {
  const h = await host()
  await h.service.prepare(h.input, h.root, parent, signal(), () => {})
  const packet = h.packets.find(p => p.requirement.id === 'industry')
  for (const chapter of ['spatial', 'launch', 'operation']) expect(packet.related.find((c: any) => c.id === chapter).pages[0].productRefs).toEqual(['products-plan'])
  expect(packet.related.find((c: any) => c.id === 'spatial').pages[0].spatialEvidence.rationale).toBe('依地形组织游线')
})
it('can explicitly retry an unavailable reviewer without rewriting a manuscript or treating it as accepted', async () => {
  const h = await host(); h.setMode('fail')
  await expect(h.service.prepare(h.input, h.root, parent, signal(), () => {})).rejects.toThrow('MODEL_UNAVAILABLE')
  expect((await h.service.load(h.input, h.root))?.status).toBe('failed')
  h.setMode('pass')
  expect((await h.service.prepare(h.input, h.root, parent, signal(), () => {})).status).toBe('passed')
})
it('settles a timed-out model that ignores AbortSignal and retains failure state', async () => {
  const h = await host(); h.setMode('hang')
  await expect(h.service.prepare(h.input, h.root, parent, signal(), () => {})).rejects.toThrow()
  expect((await h.service.load(h.input, h.root))?.status).toBe('failed')
}, 1200)
