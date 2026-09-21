import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveChildAgentOptions } from '@deepseek-ai/dsh-subagent'
import { ReportContentPlanner, contentPlanningPrompt, contentReviewPrompt } from '../src/report/manuscript/content-planner.ts'
import { contentPlanFingerprint, contentUnits, defaultContentPlan } from '../src/report/manuscript/content-plan.ts'
import type { PlanningManuscript } from '../src/report/manuscript/types.ts'
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(p => rm(p, { recursive: true, force: true }))) })
const source: PlanningManuscript = { schemaVersion: 'pre-design.planning-manuscript.v1', policyVersion: 'test', projectId: 'p', sourceRevision: 1,
  sourceFingerprint: 's', generatedAt: 'now', title: '汇报', chapters: [{ id: 'products', title: '章', thesis: '主张', pages: [{
    id: 'a', kind: 'argument', title: '页', claim: '主张', body: ['在老厂房内参观保留的生产设备。', '沿老厂房保留的生产设备参观。'], sourceRefs: ['s'], notes: [],
    visual: { kind: 'concept', subject: '展览', purpose: '体验', caption: '展览' },
  }] }] }
const proposal = { ...defaultContentPlan(source), equivalents: [{ duplicateId: 'a/body[0]', keepId: 'a/body[1]', reason: '相同体验' }] }
async function setup(review: unknown = { accepted: ['a/body[0]'] }, options: { unknown?: boolean; disposeFails?: boolean; artifactFails?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'content-planner-')); roots.push(root)
  const executions = new Map<string, any>(), requests: any[] = []
  const dependencies: any = {
    agentClasses: {
      begin: async (projectId: string, classId: string) => { const e = { id: `e${executions.size}`, projectId, classId, status: 'starting', selected: { provider: 'configured', model: 'text' } }; executions.set(e.id, e); return e },
      execution: (id: string) => executions.get(id),
      attach: async (id: string, childId: string) => { Object.assign(executions.get(id), { childId, status: 'running' }) },
      finish: async (id: string, status: string) => { Object.assign(executions.get(id), { status }); if (!options.unknown) Object.assign(executions.get(id), { actual: { provider: 'configured', model: 'text' }, childStopReason: 'completed' }) },
    },
    subagents: { start: async (_: string, request: any) => {
      requests.push(request); const id = `child${requests.length}`
      if (options.artifactFails && requests.length === 2) await mkdir(join(root, '.pre-design', 'report-content-plan.json'))
      const result = options.unknown ? Promise.reject(new Error('connection lost')) : Promise.resolve({ stopReason: 'completed', structured: requests.length === 1 ? proposal : review }); void result.catch(() => {})
      return { id, result,
        dispose: async () => { if (options.disposeFails) throw new Error('dispose failed') } }
    } },
  }
  const planner = new ReportContentPlanner(dependencies), prepare = () => planner.prepare(source, root, {} as never, new AbortController().signal, () => {})
  const checkpoint = async () => { const file = join(root, '.pre-design', 'report-content-plans', `${contentPlanFingerprint(source)}.json`); return { file, value: JSON.parse(await readFile(file, 'utf8')) } }
  return { root, planner, prepare, requests, executions, checkpoint, dependencies }
}
describe('durable independently reviewed report planning', () => {
  it.each(['configured', 'other'])('uses the selected model output budget rather than planner or %s parent caps', async provider => {
    const h = await setup()
    const parent = { id:'parent', options:{ provider, model:'text', maxTokens:2048 }, session:{ requestHeader:() => undefined } } as never
    await h.planner.prepare(source, h.root, parent, new AbortController().signal, () => {})
    for (const request of h.requests) {
      const resolved = resolveChildAgentOptions(parent, request.agentOptions, 1)
      expect(resolved).toMatchObject({ provider:'configured', model:'text' })
      expect(resolved.maxTokens).toBeUndefined()
    }
  })
  it('serializes every fact once and interns shared provenance instead of repeating it per unit', () => {
    const refs = ['shared-source-' + 'x'.repeat(3000), 'second-source-' + 'y'.repeat(3000)]
    const large = { ...source, chapters: [{ ...source.chapters[0]!, pages: Array.from({ length: 30 }, (_, n) => ({
      ...source.chapters[0]!.pages[0]!, id: `page-${n}`, sourceRefs: refs,
      body: Array.from({ length: 20 }, (_, i) => `事实${n}-${i}：雨天仅容纳20人，晴天40人。`),
    })) }] }
    const prompt = contentPlanningPrompt(large)
    expect(prompt.length).toBeLessThan(JSON.stringify(contentUnits(large)).length / 10)
    for (const ref of refs) expect(prompt.split(ref)).toHaveLength(2)
    const data = JSON.parse(prompt.split('\n\n').at(-1)!)
    const recovered = data.chapters.flatMap((c: any) => c.pages.flatMap((p: any) => p.units.map(([path, text]: string[]) => ({
      id: `${p.id}/${path}`, text, refs: p.refs.map((id: string) => data.sources[id]),
    }))))
    expect(recovered).toEqual(contentUnits(large).map(u => ({ id: u.id, text: u.text, refs: u.sourceRefs })))
  })
  it('independent review receives only the exact proposed pairs with full source context', () => {
    const prompt = contentReviewPrompt(source, proposal)
    const data = JSON.parse(prompt.split('\n').at(-1)!)
    expect(data.units.map((u: any) => u.id).sort()).toEqual(['a/body[0]', 'a/body[1]'])
    expect(data.units.every((u: any) => u.sourceRefs[0] === 's')).toBe(true)
    expect(data.pages).toEqual([{ id: 'a', chapterId: 'products', title: '页', claim: '主张', subject: '展览' }])
  })
  it('retains the subject context when equivalent wording belongs to different experiences', () => {
    const contextual = { ...source, chapters: [{ ...source.chapters[0]!, pages: [
      { ...source.chapters[0]!.pages[0]!, id:'boat', title:'游船体验', claim:'水上游览', body:['由专人带领参观。'] },
      { ...source.chapters[0]!.pages[0]!, id:'tea', title:'茶园体验', claim:'茶园游览', body:['参观采用专人带领。'] },
    ] }] }
    const data = JSON.parse(contentReviewPrompt(contextual, { ...defaultContentPlan(contextual), equivalents:[{
      duplicateId:'boat/body[0]', keepId:'tea/body[0]', reason:'专人引导',
    }] }).split('\n').at(-1)!)
    expect(data.pages.map((p: any) => [p.id, p.title, p.claim])).toEqual([
      ['boat', '游船体验', '水上游览'], ['tea', '茶园体验', '茶园游览'],
    ])
  })
  it('expands omitted tasks from the source defaults before validating or persisting the plan', async () => {
    const h = await setup(), start = h.dependencies.subagents.start
    h.dependencies.subagents.start = async (...args: unknown[]) => {
      const run = await start(...args)
      if (h.requests.length === 1) run.result = Promise.resolve({ stopReason: 'completed', structured: {
        groups: [{ pageIds: ['a'] }], equivalents: proposal.equivalents,
      } })
      return run
    }
    const output = await h.prepare()
    expect(output.chapters[0]!.pages[0]!.task).toEqual(defaultContentPlan(source).groups[0]!.task)
    expect(await h.planner.load(source, h.root)).toEqual(output)
  })
  it('resumes a verified old max-token terminal with a changed compact protocol, retaining history', async () => {
    const h = await setup(), file = join(h.root, '.pre-design', 'report-content-plans', `${contentPlanFingerprint(source)}.json`)
    await mkdir(join(h.root, '.pre-design', 'report-content-plans'), { recursive: true })
    h.executions.set('old', { projectId:'p', classId:'text', childId:'old-child', childStopReason:'max-tokens', status:'failed' })
    await writeFile(file, JSON.stringify({ version:'report-content-plan-2026-09-21.1', fingerprint:contentPlanFingerprint(source), attempts:[{
      phase:'plan', status:'failed', executionId:'old', childId:'old-child', stopReason:'max-tokens',
    }] }))
    await h.prepare()
    const attempts = (await h.checkpoint()).value.attempts
    expect(attempts[0].stopReason).toBe('max-tokens')
    expect(attempts[1].protocol).toBe('shared-provenance-v2')
    expect(h.requests).toHaveLength(2)
  })
  it('uses two independent text children and only deletes independently accepted equivalents', async () => {
    const h = await setup(); const output = await h.prepare()
    expect(h.requests).toHaveLength(2)
    expect(h.requests[1].prompt[0].text).toContain('独立逐条复核')
    expect(output.chapters[0]!.pages[0]!.body).not.toContain(source.chapters[0]!.pages[0]!.body[0])
    expect(await h.planner.load(source, h.root)).toEqual(output)
    expect((await h.checkpoint()).value.attempts.map((a: any) => [a.phase, a.status])).toEqual([['plan', 'completed'], ['review', 'completed']])
  })
  it('keeps original prose when independent review rejects a suggested equivalence', async () => {
    const h = await setup({ accepted: [] }), output = await h.prepare()
    expect(output.chapters[0]!.pages[0]!.body).toEqual(expect.arrayContaining([...source.chapters[0]!.pages[0]!.body]))
  })
  it('keeps original prose for invalid review output and does not spend a new review on resume', async () => {
    const h = await setup({ accepted: ['invented-unit'] })
    const output = await h.prepare()
    expect(output.chapters[0]!.pages[0]!.body).toEqual(expect.arrayContaining([...source.chapters[0]!.pages[0]!.body]))
    expect(await h.planner.load(source, h.root)).toEqual(output)
    await h.prepare(); expect(h.requests).toHaveLength(2)
  })
  it('resumes through the configured backup after three verified primary truncations without clearing history', async () => {
    const h = await setup(), file = join(h.root, '.pre-design', 'report-content-plans', `${contentPlanFingerprint(source)}.json`)
    const primary = { provider:'configured', model:'text' }, backup = { provider:'backup', model:'text' }
    const attempts = Array.from({ length:3 }, (_, index) => ({ phase:'plan', status:'failed', executionId:`old${index}`, childId:`old-child${index}`, stopReason:'max-tokens' }))
    for (const a of attempts) h.executions.set(a.executionId, { id:a.executionId, projectId:'p', classId:'text', status:'failed', selected:primary,
      childId:a.childId, childStopReason:'max-tokens', routeChain:[primary,backup], routeIndex:0 })
    const finish = h.dependencies.agentClasses.finish, begin = h.dependencies.agentClasses.begin
    h.dependencies.agentClasses.finish = async (id: string, status: string) => {
      if (id.startsWith('old')) return
      await finish(id,status); h.executions.get(id).actual = h.executions.get(id).selected
    }
    h.dependencies.agentClasses.fallback = async (id: string) => {
      expect(id).toBe('old2')
      return Object.assign(await begin('p','text'), { selected:backup, routeChain:[primary,backup], routeIndex:1 })
    }
    await mkdir(join(h.root,'.pre-design','report-content-plans'),{ recursive:true })
    await writeFile(file,JSON.stringify({ version:'report-content-plan-2026-09-21.1', fingerprint:contentPlanFingerprint(source), attempts }))
    const output = await h.prepare()
    expect(h.requests.map(r=>r.agentOptions.provider)).toEqual(['backup','configured'])
    expect((await h.checkpoint()).value.attempts.slice(0,3)).toEqual(attempts)
    expect(await h.planner.load(source,h.root)).toEqual(output)
    await h.prepare(); expect(h.requests).toHaveLength(2)
  })
  it('does not retry rejected native review settlement after a terminal model route mismatch', async () => {
    const h = await setup(), finish = h.dependencies.agentClasses.finish
    h.dependencies.agentClasses.finish = async (id: string, status: string) => {
      await finish(id, status)
      if (id === 'e1') {
        Object.assign(h.executions.get(id), { actual: { provider: 'unexpected', model: 'text' }, status: 'failed' })
        if (status === 'completed') throw new Error('MODEL_ROUTE_MISMATCH')
      }
    }
    const output = await h.prepare()
    expect(output.chapters[0]!.pages[0]!.body).toEqual(expect.arrayContaining([...source.chapters[0]!.pages[0]!.body]))
    expect(await h.prepare()).toEqual(output)
    expect(await h.planner.load(source, h.root)).toEqual(output)
    expect(h.requests).toHaveLength(2)
  })
  it.each([false,true])('keeps a backup correction on that route instead of returning to the exhausted primary (resume=%s)', async resume => {
    const h = await setup(), begin = h.dependencies.agentClasses.begin, finish = h.dependencies.agentClasses.finish
    const primary = { provider:'configured',model:'text' }, backup = { provider:'backup',model:'text' }
    h.dependencies.agentClasses.begin = async (...args: unknown[]) => Object.assign(await begin(...args),{ routeChain:[primary,backup],routeIndex:0 })
    h.dependencies.agentClasses.finish = async (id: string,status: string) => {
      await finish(id,status); Object.assign(h.executions.get(id),{ actual:h.executions.get(id).selected,childStopReason:id==='e0'?'max-tokens':'completed' })
    }
    h.dependencies.agentClasses.fallback = async () => Object.assign(await begin('p','text'),{ selected:backup,routeChain:[primary,backup],routeIndex:1 })
    let interrupted = false
    h.dependencies.agentClasses.retryContent = async (id: string) => {
      expect(h.executions.get(id).selected).toEqual(backup)
      if (resume && !interrupted) { interrupted = true; throw new Error('interrupted before correction reservation') }
      return Object.assign(await begin('p','text'),{ selected:backup,routeChain:[primary,backup],routeIndex:1 })
    }
    h.dependencies.subagents.start = async (_:string,request:any) => {
      h.requests.push(request); const n = h.requests.length
      return { id:`child${n}`,result:Promise.resolve({ stopReason:n===1?'max-tokens':'completed',
        structured:n===2?{}:n===3?proposal:{ accepted:[] } }),dispose:async()=>{} }
    }
    if (resume) await expect(h.prepare()).rejects.toThrow('interrupted before correction reservation')
    await h.prepare()
    expect(h.requests.map(r=>r.agentOptions.provider)).toEqual(['configured','backup','backup','configured'])
  })
  it('blocks unknown failed native execution on every resume, including disposal failure', async () => {
    const h = await setup(undefined, { unknown: true, disposeFails: true })
    await expect(h.prepare()).rejects.toThrow('dispose failed')
    await expect(h.prepare()).rejects.toThrow('CONTENT_PLAN_RECOVERY_REQUIRED')
    expect(h.requests).toHaveLength(1)
  })
  it('uses the configured backup only after the failed planning child has terminated', async () => {
    const h = await setup(), begin = h.dependencies.agentClasses.begin, finish = h.dependencies.agentClasses.finish
    const primary = { provider: 'configured', model: 'text' }, backup = { provider: 'backup', model: 'text' }
    let disposed = false
    h.dependencies.agentClasses.begin = async (...args: unknown[]) => Object.assign(await begin(...args), { routeChain: [primary, backup], routeIndex: 0 })
    h.dependencies.agentClasses.finish = async (id: string, status: string) => {
      await finish(id, status)
      Object.assign(h.executions.get(id), { actual: h.executions.get(id).selected, childStopReason: id === 'e0' ? 'error' : 'completed' })
    }
    h.dependencies.agentClasses.fallback = async (id: string) => {
      expect(disposed).toBe(true)
      expect(h.executions.get(id).childStopReason).toBe('error')
      return Object.assign(await begin('p', 'text'), { selected: backup, routeChain: [primary, backup], routeIndex: 1 })
    }
    h.dependencies.subagents.start = async (_: string, request: any) => {
      h.requests.push(request)
      const index = h.requests.length
      return { id: `child${index}`, result: Promise.resolve({ stopReason: index === 1 ? 'error' : 'completed',
        structured: index === 1 ? undefined : index === 2 ? proposal : { accepted: ['a/body[0]'] } }), dispose: async () => { disposed = true } }
    }
    const output = await h.prepare()
    expect(h.requests.map(request => request.agentOptions.provider)).toEqual(['configured', 'backup', 'configured'])
    expect(await h.planner.load(source, h.root)).toEqual(output)
    await h.prepare(); expect(h.requests).toHaveLength(3)
  })
  it('does not downgrade completed executions when artifact writing fails and repairs on resume', async () => {
    const h = await setup(undefined, { artifactFails: true })
    await expect(h.prepare()).rejects.toThrow()
    expect((await h.checkpoint()).value.attempts.every((a: any) => a.status === 'completed')).toBe(true)
    await rm(join(h.root, '.pre-design', 'report-content-plan.json'), { recursive: true })
    await h.prepare(); expect(h.requests).toHaveLength(2)
    expect(JSON.parse(await readFile(join(h.root, '.pre-design', 'report-content-plan.json'), 'utf8')).coverage.length).toBeGreaterThan(0)
  })
  it('rejects cached execution identity or native-terminal mismatch', async () => {
    const h = await setup(); await h.prepare()
    h.executions.get('e1').childId = 'another-child'
    await expect(h.planner.load(source, h.root)).rejects.toThrow('CONTENT_PLAN_EXECUTION_UNVERIFIED')
    h.executions.get('e1').childId = 'child2'; h.executions.get('e1').childStopReason = undefined
    await expect(h.planner.load(source, h.root)).rejects.toThrow('CONTENT_PLAN_EXECUTION_UNVERIFIED')
  })
  it('recovers persisted model output without submitting another child', async () => {
    const h = await setup(); await h.prepare(); const { file, value } = await h.checkpoint()
    value.attempts[1].status = 'running'; await writeFile(file, JSON.stringify(value))
    await h.prepare(); expect(h.requests).toHaveLength(2)
    expect((await h.checkpoint()).value.attempts[1].status).toBe('completed')
  })
  it('blocks cancelled checkpoint with missing native terminal instead of respawning', async () => {
    const h = await setup(); await h.prepare(); const { file, value } = await h.checkpoint()
    value.attempts[1].status = 'cancelled'; value.attempts[1].stopReason = undefined; value.attempts[1].proposal = undefined
    await writeFile(file, JSON.stringify(value))
    h.executions.get('e1').childStopReason = undefined
    h.dependencies.agentClasses.finish = async () => {}
    await expect(h.prepare()).rejects.toThrow('CONTENT_PLAN_RECOVERY_REQUIRED')
    expect(h.requests).toHaveLength(2)
  })
  it('does not treat an interrupted invalid review as accepted during recovery', async () => {
    const h = await setup(); await h.prepare(); const { file, value } = await h.checkpoint()
    value.attempts[1].status = 'running'; value.attempts[1].proposal = { accepted: ['made-up'] }
    await writeFile(file, JSON.stringify(value))
    const output = await h.prepare()
    expect(output.chapters[0]!.pages[0]!.body).toEqual(expect.arrayContaining([...source.chapters[0]!.pages[0]!.body]))
    expect(h.requests).toHaveLength(2)
  })

})
