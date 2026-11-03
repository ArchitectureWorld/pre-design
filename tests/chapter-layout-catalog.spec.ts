import { expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { chapterAssetAvailability } from '../src/report/chapter-visual-policy.ts'
import { ChapterProductionService, nativeChapterLayoutSchema } from '../src/report/chapter-production.ts'
import { assertSupportedJsonSchema,validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'

it('allows irrelevant empty overlay metadata to be omitted while retaining actual schema validation',()=>{
 const schema=nativeChapterLayoutSchema({chapter:{pages:[{id:'launch-one'}]}} as any,[{id:'photo'}] as any)
 const output={pages:[{pageId:'launch-one',template:'pair-bottom',assetIds:['photo'],captions:['场景'],mainRatio:.6,reason:'图文组合'}]}
 expect(()=>assertSupportedJsonSchema(schema)).not.toThrow()
 expect(validateJsonSchemaValue(schema,output)).toEqual([])
 expect(validateJsonSchemaValue(schema,{pages:[{...output.pages[0],overlays:'invalid'}]})).not.toEqual([])
})

it('binds each page to templates that preserve its actual table state and real asset IDs',()=>{
  const schema:any=nativeChapterLayoutSchema({chapter:{pages:[{id:'site-08'},{id:'site-09',table:{}}]}} as any,[{id:'photo'}] as any)
  const page=schema.properties.pages.items
  expect(page.oneOf).toBeUndefined()
  expect(page.properties.pageId.enum).toEqual(['site-08','site-09'])
  expect(page.properties.template.enum).toContain('table-side')
  expect(page.properties.assetIds.items.enum).toEqual(['photo'])
  const semantic:any=nativeChapterLayoutSchema({chapter:{pages:[{id:'site-01',sourceRefs:['R-1']} ]}} as any,[{id:'photo'}] as any,true)
  expect(semantic.properties.pages.items.properties.template.enum).toEqual(['hero-left','triptych','pair-bottom','image-stack','map-focus','composed'])
  expect(semantic.properties.pages.items.oneOf).toBeUndefined()
  const graphics=semantic.properties.pages.items.properties.composition.properties.graphics.items.properties
  expect(graphics.sourceRefs.items.enum).toEqual(['R-1'])
  expect(graphics.graph.properties.nodes.items.properties.row.enum).toEqual([0,1,2])
})

it('uses one shared layout structure rather than repeating the full schema for every page',()=>{
 const assets=[{id:'photo'}] as any
 const one=nativeChapterLayoutSchema({chapter:{pages:[{id:'p0',sourceRefs:['R-1']}]}} as any,assets)
 const many=nativeChapterLayoutSchema({chapter:{pages:Array.from({length:12},(_,i)=>({id:'p'+i,sourceRefs:['R-1']}))}} as any,assets)
 expect(JSON.stringify(many).length).toBeLessThan(JSON.stringify(one).length*1.2)
 expect(()=>assertSupportedJsonSchema(many)).not.toThrow()
})

it('removes exhausted originals and exposes remaining uses for native selection', () => {
  const assets = [{ id: 'terrain', sha256: 'used' }, { id: 'new-name', sha256: 'used' }, { id: 'photo', sha256: 'once' }, { id: 'map', sha256: 'new' }]
  const previous: any = [{ id: 'old', sha256: 'used', chapterId: 'opportunity', pageId: 'p1', page: 1 },
    { id: 'old', sha256: 'used', chapterId: 'opportunity', pageId: 'p2', page: 2 },
    { id: 'old-photo', sha256: 'once', chapterId: 'opportunity', pageId: 'p3', page: 3 }]
  expect(chapterAssetAvailability('site', assets, previous).map(a => [a.id, a.remainingUses])).toEqual([['photo', 1], ['map', 2]])
})
it('recognizes versioned table revision receipts while rejecting non-local receipt names',async()=>{
 const service:any=new ChapterProductionService({} as any)
 await expect(service.readLayoutDecision('nonexistent-receipt-test','layout-revision-1a0243d3533c-table-v1-native.json')).rejects.toThrow('CHAPTER_LAYOUT_REVIEW_UNVERIFIED')
 await expect(service.readLayoutDecision('nonexistent-receipt-test','layout-catalog-v6-native.json')).rejects.toThrow('CHAPTER_LAYOUT_REVIEW_UNVERIFIED')
 for(const receipt of ['../layout-native.json','layout-revision-1a0243d3533c-table-v2-native.json','C:/layout-native.json']){
  await expect(service.readLayoutDecision('nonexistent-receipt-test',receipt)).rejects.toThrow('CHAPTER_LAYOUT_REVIEW_PATH')
 }
})
it('constrains a first-run strategy diagram to the actual readable canvas capacity',()=>{
 const schema:any=nativeChapterLayoutSchema({chapter:{pages:[{id:'positioning-one',sourceRefs:['R-1']}]}} as any,[{id:'photo'}] as any)
 const nodes=schema.properties.pages.items.properties.composition.properties.graphics.items.properties.graph.properties.nodes
 expect(()=>assertSupportedJsonSchema(schema)).not.toThrow()
 expect(nodes.maxItems).toBeUndefined()
 expect(nodes.items.properties.row.enum).toEqual([0,1,2])
 expect(nodes.items.properties.column.enum).toEqual([0,1,2,3])
})

it('does not reserve an unowned retry after the final native validation failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chapter-attempt-limit-'))
  const executions: any[] = [],prompts:any[]=[]; let retries = 0
  const begin = () => { const e = { id: `e${executions.length}`, status: 'starting', selected: { provider: 'p', model: 'm' } }; executions.push(e); return e }
  const service = new ChapterProductionService({
    classes: { begin: async () => begin(), attach: async (id: string, childId: string) => Object.assign(executions.find(e => e.id === id), { childId }),
      execution: (id: string) => executions.find(e => e.id === id), finish: async (id: string, status: string) => Object.assign(executions.find(e => e.id === id), { status, childStopReason: 'completed' }),
      retryContent: async () => { retries++; return begin() } },
    subagents: { start: async (_:any,args:any) => {prompts.push(args.prompt);return { id: `child${executions.length}`, result: Promise.resolve({ stopReason: 'completed', structured: {nativeCandidate:'retain-this-layout'} }), dispose: async () => {} }} },
    attachments: {}, readEvents: async () => [],
  } as any)
  try {
    await expect((service as any).native(root, 'layout', 'project', { id: 'parent' }, new AbortController().signal,
      'pick valid assets', { type: 'object' }, () => { throw new Error('CHAPTER_COMPOSITION_COLLISION: photo and process occupy the same space') })).rejects.toThrow()
    expect(JSON.parse(await readFile(join(root, 'layout-native.json'), 'utf8')).attempts).toHaveLength(4)
    expect(retries).toBe(3)
    expect(JSON.stringify(prompts[1])).toContain('retain-this-layout')
    expect(JSON.stringify(prompts[1])).toContain('受影响页的坐标不必保留')
    expect(executions.every(e => e.status === 'failed')).toBe(true)
  } finally { await rm(root, { recursive: true, force: true }) }
})
