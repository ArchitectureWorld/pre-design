import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it } from 'vitest'
import { PlanningManuscriptService } from '../src/report/manuscript/service.ts'
import { validatePlanningManuscript } from '../src/report/manuscript/validation.ts'
import { sha256CanonicalJson as hash } from '../src/presentation/canonical-json.ts'
import type { FrozenProjectInput } from '../src/report/types.ts'
import { normalizeApprovedChapterMetadata, buildApprovedChapterPrompt } from '../src/report/chapter-plan.ts'
import { validatePlanningChapter } from '../src/report/manuscript/validation.ts'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
const input: FrozenProjectInput = { projectId: 'chapter-project', projectName: '湖山项目', revision: 4,
  generatedAt: '2026-10-15T00:00:00Z', recommendation: '旧推荐仅供研究参考', decisionItems: [], gates: [], visualAssets: [], stateObjects: [] }
const parent = { id: 'parent' } as never
const sources = [{ id: 'original-photo', objectId: 'original', fieldPath: 'photo', text: '现场存在茶园和村落道路。', basis: '用户原图', evidenceIds: [] }]
function brief() {
  const plan = { chapterId: 'opportunity', title: '发展机会与项目价值', summary: '以茶事和山居组织停留',
    pages: [{ id: 'opportunity-resource', title: '茶园连接生产与游憩', content: { points: ['采茶、识茶与短程慢行。'] } }], sources }
  return { plan, approval: { origin: 'user-message', message: '继续下一步吧', approvedAt: input.generatedAt, planHash: hash(plan) } } as any
}
const chapter = { id: 'opportunity', title: '发展机会与项目价值', thesis: '依托茶园和村落形成周末停留。', pages: [{
  id: 'opportunity-resource', kind: 'argument', title: '茶园连接生产与游憩', claim: '茶事体验与村落服务组成半日活动。',
  body: ['沿已有道路安排茶园体验，村落提供休憩服务。'], sourceRefs: ['original-photo'], notes: ['经营主体与场地权利需人工确认。'],
  visual: { kind: 'source', subject: '茶园现状', purpose: '说明已有资源', caption: '茶田与村落道路' },
}] }

it('normalizes an opportunity label without changing copy, sources or the original payload', () => {
  const raw = structuredClone(chapter); raw.pages[0]!.kind = 'product'
  const fixed = normalizeApprovedChapterMetadata(raw, brief())
  expect(fixed.changes).toEqual([{ pageId: raw.pages[0]!.id, field: 'kind', from: 'product', to: 'argument' }])
  expect(fixed.value).toEqual(chapter)
  expect(raw.pages[0]!.kind).toBe('product')
  expect(normalizeApprovedChapterMetadata(raw, { ...brief(), plan: { ...brief().plan, chapterId: 'products' } }).changes).toEqual([])
  const genuine = { ...raw, pages: [{ ...raw.pages[0], product: { name: 'incomplete' } }] }
  expect(() => validatePlanningChapter(normalizeApprovedChapterMetadata(genuine, brief()).value, 'opportunity', sources)).toThrow('MANUSCRIPT_PRODUCT')
})

it.each([true,false])('gives one verified legacy diagram contract repair, preserving failed history: %s',async succeeds=>{
 const root=await workspace(),bad:any=structuredClone(chapter)
 bad.pages[0].visual.kind='concept';bad.pages[0].visual.diagram={nodes:[{id:'a',label:'茶园',column:0,row:0}],edges:[]}
 const first=host(async()=>bad)
 await expect(new PlanningManuscriptService(first.dependencies as never).prepareChapter(input,root,parent,new AbortController().signal,()=>{},brief())).rejects.toThrow('MANUSCRIPT_DIAGRAM')
 const folder=join(root,'.pre-design/report-chapters/opportunity'),fingerprint=(await readdir(folder))[0]!,path=join(folder,fingerprint,'checkpoint.json')
 const checkpoint=JSON.parse(await readFile(path,'utf8'))
 for(const a of checkpoint.chapters.opportunity.attempts)delete a.diagramContractVersion
 await writeFile(path,JSON.stringify(checkpoint));const previous=structuredClone(checkpoint.chapters.opportunity.attempts),last=previous.at(-1),route={provider:'configured',model:'configured-text'}
 const events=[{seq:1,type:'turn/start',data:{turn:1}},{seq:2,type:'request/header',data:{header:{config:route}}},
 {seq:3,type:'tool/call',data:{turn:1,step:0,name:'structured_output',callId:'c',arguments:JSON.stringify(bad)}},
 {seq:4,type:'tool/result',data:{turn:1,step:0,message:{content:[{type:'tool-result',toolCallId:'c',isError:false}]}}},{seq:5,type:'turn/end',data:{turn:1,reason:{kind:'completed'}}}]
 const h=host(async()=>{const fixed=structuredClone(bad);if(succeeds)fixed.pages[0].visual.kind='diagram';return fixed})
 const deps={...h.dependencies,readEvents:async()=>events,agentClasses:{...h.dependencies.agentClasses,execution:()=>({id:last.executionId,projectId:input.projectId,classId:'text',childId:last.childId,parentId:'parent',status:'failed',childStopReason:'completed',selected:route,actual:route})}}
 const invoke=()=>new PlanningManuscriptService(deps as never).prepareChapter(input,root,parent,new AbortController().signal,()=>{},brief())
 if(succeeds)expect((await invoke()).chapter.pages[0]!.body).toEqual(bad.pages[0].body)
 else{await expect(invoke()).rejects.toThrow('MANUSCRIPT_DIAGRAM');await expect(invoke()).rejects.toThrow('MANUSCRIPT_CORRECTION_LIMIT')}
 expect(h.requests).toHaveLength(1);expect(h.requests[0].prompt[0].text).toContain('不能当作任意主次分类标签')
 const saved=JSON.parse(await readFile(path,'utf8'));expect(saved.correctionsUsed).toBe(2)
 expect(saved.chapters.opportunity.attempts.slice(0,previous.length)).toEqual(previous)
 expect(saved.chapters.opportunity.attempts.at(-1)).toMatchObject({diagramContractRepair:true,validationCorrection:false})
})

it('keeps internal visual instructions separate from public copy validation', () => {
  const raw = structuredClone(chapter); raw.pages[0]!.visual.purpose = '本页使用茶田原图说明现场场景。'
  expect(validatePlanningChapter(raw, 'opportunity', sources).pages[0]!.visual.purpose).toBe(raw.pages[0]!.visual.purpose)
  raw.pages[0]!.title = '本页介绍茶园'
  expect(() => validatePlanningChapter(raw, 'opportunity', sources)).toThrow('MANUSCRIPT_AUDIENCE')
})
function host(result: () => Promise<unknown> = async () => chapter) {
  const requests: any[] = []
  return { requests, dependencies: {
    subagents: { getProvider: () => ({}), start: async (_: string, request: any) => {
      requests.push(request)
      return { id: `native-child-${requests.length}`, result: result().then(structured => ({ structured, stopReason: 'completed' })), dispose: async () => {} }
    } },
    agentClasses: { begin: async () => ({ id: 'native-execution', selected: { provider: 'configured', model: 'configured-text' } }),
      attach: async () => {}, finish: async () => {} },
  } }
}
async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'chapter-delivery-')); roots.push(root)
  await mkdir(join(root, '.pre-design'), { recursive: true })
  await writeFile(join(root, '.pre-design/report-manuscript.json'), 'existing full report')
  return root
}

it('writes only the approved chapter and preserves the full-report artifact', async () => {
  const root = await workspace(), h = host(), service = new PlanningManuscriptService(h.dependencies as never)
  const result = await (service as any).prepareChapter(input, root, parent, new AbortController().signal, () => {}, brief())
  expect(result).toMatchObject({ scope: 'chapter', projectName: input.projectName, chapterId: 'opportunity', status: 'draft_ready', userReview: 'pending', chapter })
  expect(JSON.parse(await readFile(result.artifactPaths.chapter, 'utf8')).chapter.pages).toHaveLength(1)
  expect(await readFile(join(root, '.pre-design/report-manuscript.json'), 'utf8')).toBe('existing full report')
  expect(h.requests).toHaveLength(1)
  expect(h.requests[0].agentOptions).toMatchObject({ provider: 'configured', model: 'configured-text' })
  expect(() => validatePlanningManuscript(result, input)).toThrow()
})

it('returns a diagram metadata error to the native author within the bounded correction budget',async()=>{
  let calls=0
  const h=host(async()=>{const value=structuredClone(chapter);if(++calls===1)Object.assign(value.pages[0]!.visual,{kind:'concept',diagram:{nodes:[{id:'n',label:'场景',column:0,row:0}],edges:[]}});return value})
  const service=new PlanningManuscriptService(h.dependencies as never)
  const result=await service.prepareChapter(input,await workspace(),parent,new AbortController().signal,()=>{},brief())
  expect(calls).toBe(2);expect(result.chapter).toEqual(chapter)
  expect(h.requests[1].prompt[0].text).toContain('MANUSCRIPT_DIAGRAM')
})

it('reuses a completed chapter without another native request and shares an in-flight request', async () => {
  const root = await workspace()
  let release!: (value: unknown) => void
  const pending = new Promise(resolve => { release = resolve }), h = host(() => pending)
  const service = new PlanningManuscriptService(h.dependencies as never), b = brief(), signal = new AbortController().signal
  const first = (service as any).prepareChapter(input, root, parent, signal, () => {}, b)
  const second = (service as any).prepareChapter(input, root, parent, signal, () => {}, b)
  release(chapter)
  const [one, two] = await Promise.all([first, second])
  expect(one).toEqual(two)
  await (service as any).prepareChapter(input, root, parent, signal, () => {}, b)
  expect(h.requests).toHaveLength(1)
})

it('allows only one final correction bound to the current draft and native review after the normal budget', async () => {
  const root = await workspace(), h = host(), service = new PlanningManuscriptService(h.dependencies as never)
  const b = brief(), signal = new AbortController().signal
  let draft = await service.prepareChapter(input, root, parent, signal, () => {}, b)
  const review = (n: number): any => ({ status: 'needs_revision', planHash: b.approval.planHash,
    manuscriptHash: hash(draft.chapter), path: `review-${n}.json`, receipt: { outputHash: `native-review-${n}`,
      output: { findings: [{ pageId: chapter.pages[0]!.id, reason: `限定修正${n}` }] } } })
  for (const n of [1, 2]) draft = await service.reviseChapter(input, root, parent, signal, () => {}, b, draft, review(n))
  const third = review(3)
  await expect(service.reviseChapter(input, root, parent, signal, () => {}, b, draft, third)).rejects.toThrow('CHAPTER_CONTENT_REVISION_LIMIT')
  const folder = join(root, '.pre-design/report-chapter-editorial-input')
  await mkdir(folder, { recursive: true })
  const request = { kind: 'one-final-revision', baseManuscriptHash: hash(draft.chapter), reviewOutputHash: third.receipt.outputHash,
    reason: '保留原生历史，限定修正本次术语与备注冲突。' }
  const path = join(folder, 'opportunity-final-correction.json')
  await writeFile(path, JSON.stringify({ ...request, baseManuscriptHash: 'stale' }))
  await expect(service.reviseChapter(input, root, parent, signal, () => {}, b, draft, third)).rejects.toThrow('CHAPTER_FINAL_CORRECTION_CHANGED')
  await writeFile(path, JSON.stringify(request))
  draft = await service.reviseChapter(input, root, parent, signal, () => {}, b, draft, third)
  const ledger = JSON.parse(await readFile(join(root, '.pre-design/report-chapters/opportunity/content-revisions.json'), 'utf8'))
  expect(ledger.revisions).toHaveLength(3)
  expect(ledger.revisions[2].finalCorrection).toEqual(request)
  expect(await service.reviseChapter(input, root, parent, signal, () => {}, b, draft, third)).toEqual(draft)
  expect(h.requests).toHaveLength(4)
  await expect(service.reviseChapter(input, root, parent, signal, () => {}, b, draft, review(4))).rejects.toThrow('CHAPTER_CONTENT_REVISION_LIMIT')
})

it('rejects an unapproved plan change before calling the native model', async () => {
  const h = host(), service = new PlanningManuscriptService(h.dependencies as never), b = brief()
  b.plan.pages[0].title = '未经确认的新页题'
  await expect((service as any).prepareChapter(input, await workspace(), parent, new AbortController().signal, () => {}, b)).rejects.toThrow('CHAPTER_PLAN_APPROVAL_INVALID')
  expect(h.requests).toHaveLength(0)
})

it('retains a rejected native submission when it omits an approved page', async () => {
  const h = host(), service = new PlanningManuscriptService(h.dependencies as never), b = brief(), root = await workspace()
  b.plan.pages.push({ id: 'opportunity-market', title: '市场需求', content: {} }); b.approval.planHash = hash(b.plan)
  await expect((service as any).prepareChapter(input, root, parent, new AbortController().signal, () => {}, b)).rejects.toThrow('MANUSCRIPT_SHAPE')
  expect(h.requests).toHaveLength(3)
  expect(await readFile(join(root, '.pre-design/report-manuscript.json'), 'utf8')).toBe('existing full report')
})

it('uses the real chapter request instead of claiming ideal conditions or an inherited tourism program', () => {
  const selected=brief();selected.approval.message='以已知现状提出工业遗产更新方案，保留未知条件。'
  const prompt=buildApprovedChapterPrompt(selected)
  expect(prompt).toContain(selected.approval.message)
  expect(prompt).not.toMatch(/用户明确要求理想条件下的汇报方案|少潭河|木兰系|正文展开湖山户外/)
  expect(prompt).toContain('只有用户明确要求理想条件')
  expect(prompt).toContain('不得把建议')
})
