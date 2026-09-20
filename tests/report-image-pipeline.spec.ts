import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { ImageIdentityIndex } from '../src/visual/image-identity.ts'
import { jpeg, png, resize, scene } from './support/image-identity/fixtures.ts'
import { expect, it, vi } from 'vitest'
import { ReportImagePipeline } from '../src/presentation/report-image-pipeline.ts'
import { imageSourceContextHash } from '../src/visual/image-inspection.ts'
import { imageBriefHash } from '../src/visual/image-policy.ts'
import { manuscriptSourceFingerprint } from '../src/report/manuscript/source.ts'
import type { FrozenProjectInput } from '../src/report/types.ts'
import type { PresentationAdoptedAssetInput } from '../src/presentation/standard-project-types.ts'
import { createConditionalReportBundle, planConditionalPages } from '../src/report/conditional-report.ts'
import { auditRegularVisuals } from '../src/report/regular/visual-audit.ts'
import { createAutomaticVisualCompletion } from '../src/presentation/automatic-visuals.ts'
import { verifiedRasterImageDimensions } from '../src/governance/site-boundary-asset-store.ts'

function project(): FrozenProjectInput {
  const input: FrozenProjectInput = { projectId: 'test-images', projectName: '滨河公园', revision: 1, generatedAt: '2026-09-19', recommendation: '林下休闲与滨水漫步',
    decisionItems: [], gates: [], visualAssets: [], stateObjects: [{ objectId: 's', chapterId: '01', workItemId: '01-01', title: '定位', summary: '林下休闲与滨水漫步', facts: [] }] }
  return { ...input, manuscript: { schemaVersion: 'pre-design.planning-manuscript.v1', policyVersion: 'fixture', sourceFingerprint: manuscriptSourceFingerprint(input), sourceRevision: 1,
    projectId: input.projectId, generatedAt: input.generatedAt, title: '滨河公园策划汇报', chapters: [{ id: 'spatial', title: '空间组织', thesis: input.recommendation,
      pages: ['林下座椅休憩', '滨水步道漫游'].map((subject,i) => ({ id: `scene-${i}`, kind: 'argument', title: subject, claim: `${subject}构成公园日间游览体验`, body: ['保留完整空间关系与活动场景。'], sourceRefs: [], notes: [], editorialSummary: true,
        visual: { kind: 'concept', subject, purpose: subject, caption: subject } })) }] } }
}
async function material(root: string, name: string, index: number, height = 1200): Promise<PresentationAdoptedAssetInput> {
  const path = join(root, `${index}.png`); await writeFile(path, png(resize(scene(7 + index * 137), 1600, height)))
  return { sourceKey: `asset-${index}`, sourcePath: path, originalFileName: `${index}.png`, displayName: name, mimeType: 'image/png', widthPx: 1600, heightPx: height,
    semanticRole: 'concept_visual', createdAt: '2026-09-19', adoptedAt: '2026-09-19', objectIds: [], evidenceIds: [], pageBindingOnly: true,
    pageBindings: [{ findingId: `manuscript:scene-${index}` }], origin: { type: 'generated_by_plugin', sourceMaterialKeys: [], parentAssetKeys: [], sourceTool: null, method: JSON.stringify({ prompt: name }) } }
}
it.each([['normal', false, 1200], ['scarce', true, 1200], ['panorama', false, 400], ['large-original', false, 3000], ['large-generated', false, 3000], ['padded-jpeg', false, 1200]] as const)('finishes %s source review, physical placement and cache replay without regeneration', async (_name, scarce, height) => {
  const root = await mkdtemp(join(tmpdir(),'image-pipeline-')), input = project(), route = { provider: 'fixture', model: 'fixture-vision' }
  try {
    const names = scarce ? ['林下座椅休憩；滨水步道漫游', '林下座椅休憩'] : ['林下座椅休憩','滨水步道漫游']
    const assets = await Promise.all(names.map((name,i) => material(root,name,i,height)))
    if (_name === 'padded-jpeg') for (let i = 0; i < assets.length; i++) {
      const sourcePath = join(root, `${i}.jpg`)
      await writeFile(sourcePath, Buffer.concat([jpeg(resize(scene(7 + i * 137), 1600, height)), Buffer.alloc(16)]))
      assets[i] = { ...assets[i]!, sourcePath, originalFileName: `${i}.jpg`, mimeType: 'image/jpeg' }
    }
    if (scarce) assets[1] = { ...assets[1]!, pageBindings: [{ findingId: 'manuscript:scene-0' }] }
    const identityIndex = new ImageIdentityIndex()
    const identities = []
    for (const asset of assets) { const result = identityIndex.identify({ bytes: await readFile(asset.sourcePath), mimeType: asset.mimeType as 'image/png' | 'image/jpeg' }); expect(result.status).toBe('identified'); identities.push(result.identity?.originalId) }
    expect(new Set(identities).size).toBe(assets.length)
    const inspect = vi.fn(async (_parent: unknown, request: any) => { verifiedRasterImageDimensions(request.mimeType, request.bytes); return request.slots.map((slot: any) => ({ schemaVersion: 'pre-design.image-inspection.v1',
      imageSha256: createHash('sha256').update(request.bytes).digest('hex'), requirementHash: imageBriefHash(slot.brief), usageId: slot.brief.id,
      placementHash: slot.placementHash, inspectedAt: '2026-09-19', actualImageInput: true, actualModel: route, executionId: 'fixture-run', contentKind: 'render',
      relevant: true, matchedSubjects: slot.brief.subjects, mismatches: [], domesticContext: 'supported', textLanguages: [], textLegible: true, watermark: 'none', quality: 'pass',
      essentialBounds: [{ x: 0, y: 0, width: 1, height: 1 }], decision: 'approved', sourceContextHash: imageSourceContextHash(request) })) })
    const adopt = vi.fn(async () => {})
    const generate = vi.fn(async (demand: any) => {
      if (_name === 'large-generated' && demand.brief.pageId === 'scene-1') return { material: assets[1]!, adopt }
      throw new Error(`unexpected-generation:${demand.brief.id};reviews:${inspect.mock.calls.length}`)
    }), pipeline = new ReportImagePipeline({ classes: { settings: () => ({ routes: { review: route } }), execution: () => ({ classId: 'review', status: 'completed', actual: route }) } as never,
      inspection: { inspect } as never, candidates: async () => _name === 'large-generated' ? [assets[0]!] : assets, generate })
    const result = await pipeline.prepare(input, root, {} as never, AbortSignal.timeout(20_000), () => {})
    const bundle = createConditionalReportBundle(input, result), plan = planConditionalPages(bundle,'html'), audit = auditRegularVisuals(plan,bundle.report,{ requireInspectedImages: true })
    expect(audit.unreviewedImages).toEqual([]); expect(audit.repeatedOriginals).toEqual([]); expect(audit.samePageDuplicates).toEqual([])
    expect(audit.textOnlyRatio).toBeLessThanOrEqual(.15)
    if (_name === 'large-generated') { expect(generate).toHaveBeenCalledOnce(); expect(adopt).toHaveBeenCalledOnce() }
    else expect(generate).not.toHaveBeenCalled()
    const calls = inspect.mock.calls.length
    expect(await pipeline.prepare(input,root,{} as never,AbortSignal.timeout(20_000),()=>{})).toEqual(result)
    expect(inspect).toHaveBeenCalledTimes(calls)
    if (height === 3000) {
      expect(result.every(asset => asset.widthPx! * asset.heightPx! <= 4 * 1024 * 1024)).toBe(true)
      expect(result.every(asset => asset.imagePreparation?.version === 'report-raster-v1')).toBe(true)
      expect(new Set(result.map(asset => asset.imagePreparation?.sourcePath))).toEqual(new Set(assets.map(asset => asset.sourcePath)))
      for (const asset of result) expect(createHash('sha256').update(await readFile(asset.imagePreparation!.sourcePath)).digest('hex')).toBe(asset.imagePreparation!.sourceSha256)
      await writeFile(assets[0]!.sourcePath, Buffer.from('changed original'))
      expect(await pipeline.load(input, root)).toBeUndefined()
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})
it('runs source-image quality preparation even when new image generation is disabled', async () => {
  const prepareImageQuality = vi.fn(), pageVisualFill = { plan: vi.fn(), generate: vi.fn(), adopt: vi.fn() }, sync = vi.fn()
  const complete = createAutomaticVisualCompletion({ prepareImageQuality, pageVisualFill, sync, target: () => 0,
    input: async () => ({ frozenProject: project(), workspaceRoot: 'isolated-not-used' }), assertCurrent: () => {} })
  await complete('test-images',1,{} as never,AbortSignal.timeout(1000))
  expect(prepareImageQuality).toHaveBeenCalledWith(expect.anything(),expect.anything(),expect.anything(),expect.any(Function),0)
  expect(pageVisualFill.generate).not.toHaveBeenCalled(); expect(sync).toHaveBeenCalledOnce()
})
it('reports unresolved gaps without generating when the generation policy is disabled', async () => {
  const root = await mkdtemp(join(tmpdir(),'image-pipeline-')), generate = vi.fn()
  try {
    const pipeline = new ReportImagePipeline({ classes: { settings: () => ({ routes: { review: { provider: 'fixture', model: 'vision' } } }) } as never,
      inspection: {} as never, candidates: async () => [], generate })
    await expect(pipeline.prepare(project(),root,{} as never,AbortSignal.timeout(1000),()=>{}, { maxGenerations: 0 })).rejects.toThrow('REPORT_IMAGE_GAPS')
    expect(generate).not.toHaveBeenCalled()
  } finally { await rm(root,{recursive:true,force:true}) }
})
it('does no source acquisition or generation until an explicit review route exists', async () => {
  const root = await mkdtemp(join(tmpdir(),'image-pipeline-')), candidates = vi.fn(), generate = vi.fn()
  try {
    const pipeline = new ReportImagePipeline({ classes: { settings: () => ({ routes: {} }) } as never, inspection: {} as never, candidates, generate })
    await expect(pipeline.prepare(project(),root,{} as never,AbortSignal.timeout(1000),()=>{})).rejects.toThrow('IMAGE_REVIEW_MODEL_REQUIRED')
    expect(candidates).not.toHaveBeenCalled(); expect(generate).not.toHaveBeenCalled()
  } finally { await rm(root,{recursive:true,force:true}) }
})
it('resolves scene intent before inspecting or acquiring images and propagates unresolved context instead of falling back', async () => {
  const root = await mkdtemp(join(tmpdir(),'image-scene-demand-')), candidates = vi.fn(async () => []), generate = vi.fn()
  const resolveDemands = vi.fn(async () => { throw new Error('SCENE_SPEC_CONTEXT_REQUIRED') })
  try {
    const pipeline = new ReportImagePipeline({ classes: { settings: () => ({ routes: { review: { provider: 'fixture', model: 'vision' } } }) } as never,
      inspection: {} as never, candidates, generate, resolveDemands })
    await expect(pipeline.prepare(project(),root,{} as never,AbortSignal.timeout(1000),()=>{})).rejects.toThrow('SCENE_SPEC_CONTEXT_REQUIRED')
    expect(resolveDemands).toHaveBeenCalledOnce()
    expect(candidates).not.toHaveBeenCalled(); expect(generate).not.toHaveBeenCalled()
  } finally { await rm(root,{recursive:true,force:true}) }
})
it.each([
  ['transport result unknown', 'IMAGE_REVIEW_ATTEMPT_REQUIRES_ATTENTION', 1],
  ['PREPLANNING_MODEL_TURN_LIMIT: no authorization', 'PREPLANNING_MODEL_TURN_LIMIT', 2],
] as const)('preserves failed attempt accounting and safely resumes only undispatched work: %s', async (failure, nextError, expectedCalls) => {
  const root = await mkdtemp(join(tmpdir(),'image-pipeline-'))
  try {
    const asset = await material(root,'林下座椅休憩',0), inspect = vi.fn(async () => { throw new Error(failure) }), generate = vi.fn()
    const pipeline = new ReportImagePipeline({ classes: { settings: () => ({ routes: { review: { provider: 'fixture', model: 'vision' } } }) } as never,
      inspection: { inspect } as never, candidates: async () => [asset], generate })
    await expect(pipeline.prepare(project(),root,{} as never,AbortSignal.timeout(20_000),()=>{})).rejects.toThrow(failure)
    await expect(pipeline.prepare(project(),root,{} as never,AbortSignal.timeout(20_000),()=>{})).rejects.toThrow(nextError)
    expect(inspect).toHaveBeenCalledTimes(expectedCalls); expect(generate).not.toHaveBeenCalled()
  } finally { await rm(root,{recursive:true,force:true}) }
})
it('propagates cancellation even when source collection returns no assets', async () => {
  const root = await mkdtemp(join(tmpdir(),'image-pipeline-')), controller = new AbortController(), inspect = vi.fn(), generate = vi.fn()
  try {
    const pipeline = new ReportImagePipeline({ classes: { settings: () => ({ routes: { review: { provider: 'fixture', model: 'vision' } } }) } as never,
      inspection: { inspect } as never, candidates: async () => { controller.abort(new Error('cancelled by user')); return [] }, generate })
    await expect(pipeline.prepare(project(),root,{} as never,controller.signal,()=>{})).rejects.toThrow('cancelled by user')
    expect(inspect).not.toHaveBeenCalled(); expect(generate).not.toHaveBeenCalled()
  } finally { await rm(root,{recursive:true,force:true}) }
})

async function schedulingFixture(root: string, count = 7) {
  const base = project(), names = ['松林廊亭','芦苇湿地','竹园茶室','稻田栈桥','荷塘驿站','梅园书屋','石径花圃']
  const pages = names.slice(0,count).map((name,i) => ({ ...base.manuscript!.chapters[0]!.pages[0]!, id:`scheduled-${i}`, title:name, claim:name,
    visual:{kind:'concept' as const,subject:name,purpose:name,caption:name} }))
  const input = {...base,manuscript:{...base.manuscript!,chapters:[{...base.manuscript!.chapters[0]!,pages}]}}
  const assets = await Promise.all(names.slice(0,count).map(async (name,i) => ({...await material(root,name,i),pageBindings:[{findingId:`manuscript:scheduled-${i}`}]})))
  return {input,assets}
}
it.each(['normal','error','cancel'] as const)('bounds real review concurrency at five, claims each pair once and drains on %s', async mode => {
  const root=await mkdtemp(join(tmpdir(),'image-scheduling-')), controller=new AbortController()
  try {
    const {input,assets}=await schedulingFixture(root);let active=0,peak=0,calls=0,settled=0;const pairs=new Set<string>()
    const inspect=vi.fn(async (_:unknown,request:any)=>{const call=++calls;active++;peak=Math.max(peak,active)
      const digest=createHash('sha256').update(request.bytes).digest('hex')
      for(const slot of request.slots){const key=digest+slot.brief.id;expect(pairs.has(key)).toBe(false);pairs.add(key)}
      try {await new Promise(resolve=>setTimeout(resolve,call===1?10:40));if(call===1&&mode==='error')throw Error('review fixture failed')
        if(call===1&&mode==='cancel')controller.abort(new Error('fixture cancellation'))
        return request.slots.map((slot:any)=>({schemaVersion:'pre-design.image-inspection.v1',imageSha256:digest,requirementHash:imageBriefHash(slot.brief),usageId:slot.brief.id,placementHash:slot.placementHash,
          inspectedAt:'fixture',actualImageInput:true,actualModel:{provider:'fixture',model:'vision'},executionId:'fixture-run',contentKind:'render',relevant:false,matchedSubjects:[],mismatches:['fixture mismatch'],domesticContext:'supported',textLanguages:[],textLegible:true,watermark:'none',quality:'pass',essentialBounds:[],decision:'rejected',sourceContextHash:imageSourceContextHash(request)}))
      }finally{active--;settled++}})
    const pipeline=new ReportImagePipeline({classes:{settings:()=>({routes:{review:{provider:'fixture',model:'vision'}}}),execution:()=>undefined} as never,inspection:{inspect} as never,candidates:async()=>assets})
    await expect(pipeline.prepare(input,root,{} as never,controller.signal,()=>{})).rejects.toThrow(mode==='normal'?'REPORT_IMAGE_GAPS':mode==='error'?'review fixture failed':'fixture cancellation')
    expect(peak).toBe(5);expect(active).toBe(0);expect(settled).toBe(calls)
    if(mode!=='normal')expect(calls).toBe(5)
  } finally {await rm(root,{recursive:true,force:true})}
},30_000)
it('does not recall an unrelated candidate from prohibited scenery in provenance prose',async()=>{
 const root=await mkdtemp(join(tmpdir(),'image-recall-'))
 try{const asset={...await material(root,'沙漠营地',0),pageBindings:[],origin:{type:'generated_by_plugin' as const,sourceMaterialKeys:[],parentAssetKeys:[],sourceTool:null,method:JSON.stringify({prompt:'禁止林下座椅休憩，禁止滨水步道漫游'})}}
 const inspect=vi.fn(async()=>{throw Error('unrelated candidate recalled')})
 const pipeline=new ReportImagePipeline({classes:{settings:()=>({routes:{review:{provider:'fixture',model:'vision'}}})} as never,inspection:{inspect} as never,candidates:async()=>[asset]})
 await expect(pipeline.prepare(project(),root,{} as never,AbortSignal.timeout(20_000),()=>{})).rejects.toThrow('REPORT_IMAGE_GAPS');expect(inspect).not.toHaveBeenCalled()
 }finally{await rm(root,{recursive:true,force:true})}
},30_000)

it('drains each source tier before dispatching the next tier',async()=>{
 const root=await mkdtemp(join(tmpdir(),'image-source-waves-'))
 try{const {input,assets}=await schedulingFixture(root,6);const order:string[]=[],active=new Set<string>()
 const sources=['generated','web','project','generated','web','project']
 const mixed=assets.map((asset,i)=>({...asset,semanticRole:sources[i]==='generated'?'concept_visual':'reference',origin:{...asset.origin,method:sources[i]==='web'?'case-reference':'fixture'}}))
 const inspect=vi.fn(async(_:unknown,request:any)=>{expect([...active].every(source=>source===request.sourceType)).toBe(true);active.add(request.sourceType);order.push(request.sourceType)
 await new Promise(resolve=>setTimeout(resolve,20));active.delete(request.sourceType)
 return request.slots.map((slot:any)=>({schemaVersion:'pre-design.image-inspection.v1',imageSha256:createHash('sha256').update(request.bytes).digest('hex'),requirementHash:imageBriefHash(slot.brief),usageId:slot.brief.id,placementHash:slot.placementHash,inspectedAt:'fixture',actualImageInput:true,actualModel:{provider:'fixture',model:'vision'},executionId:'fixture-run',contentKind:'render',relevant:false,matchedSubjects:[],mismatches:['fixture'],domesticContext:'supported',textLanguages:[],textLegible:true,watermark:'none',quality:'pass',essentialBounds:[],decision:'rejected',sourceContextHash:imageSourceContextHash(request)}))})
 const pipeline=new ReportImagePipeline({classes:{settings:()=>({routes:{review:{provider:'fixture',model:'vision'}}}),execution:()=>undefined} as never,inspection:{inspect} as never,candidates:async()=>mixed})
 await expect(pipeline.prepare(input,root,{} as never,AbortSignal.timeout(20_000),()=>{})).rejects.toThrow('REPORT_IMAGE_GAPS')
 expect(order).toEqual(['project','project','web','web','generated','generated'])
 }finally{await rm(root,{recursive:true,force:true})}
},30_000)
it('keeps a finite old candidate frontier while reviewing new acquisitions and every explicit binding',async()=>{
 const root=await mkdtemp(join(tmpdir(),'image-incremental-waves-'))
 try{const assets=await Promise.all(Array.from({length:9},async(_,i)=>({...await material(root,'林下座椅休憩；滨水步道漫游',i),pageBindings:i===7?[{findingId:'manuscript:scene-1'}]:[]})))
 const calls=new Map<string,number>(),digests=await Promise.all(assets.map(async a=>createHash('sha256').update(await readFile(a.sourcePath)).digest('hex')))
 const inspect=vi.fn(async(_:unknown,request:any)=>{const digest=createHash('sha256').update(request.bytes).digest('hex');calls.set(digest,(calls.get(digest)??0)+1)
 expect(request.slots.length).toBeLessThanOrEqual(8)
 return request.slots.map((slot:any)=>({schemaVersion:'pre-design.image-inspection.v1',imageSha256:digest,requirementHash:imageBriefHash(slot.brief),usageId:slot.brief.id,placementHash:slot.placementHash,inspectedAt:'fixture',actualImageInput:true,actualModel:{provider:'fixture',model:'vision'},executionId:'fixture-run',contentKind:'render',relevant:false,matchedSubjects:[],mismatches:['fixture'],domesticContext:'supported',textLanguages:[],textLegible:true,watermark:'none',quality:'pass',essentialBounds:[],decision:'rejected',sourceContextHash:imageSourceContextHash(request)}))})
 let searches=0
 const pipeline=new ReportImagePipeline({classes:{settings:()=>({routes:{review:{provider:'fixture',model:'vision'}}}),execution:()=>undefined} as never,inspection:{inspect} as never,candidates:async()=>assets.slice(0,8),search:async()=>++searches===1?[assets[8]!]:[]})
 await expect(pipeline.prepare(project(),root,{} as never,AbortSignal.timeout(20_000),()=>{})).rejects.toThrow('REPORT_IMAGE_GAPS')
 expect(calls.has(digests[6]!)).toBe(false);expect(calls.has(digests[7]!)).toBe(true);expect(calls.has(digests[8]!)).toBe(true)
 expect([...calls.values()].every(n=>n===1)).toBe(true);expect(searches).toBe(3)
 }finally{await rm(root,{recursive:true,force:true})}
},30_000)

it.each(['unrelated','augment','same-page','discovery'] as const)('reviews an acquisition only for the remaining gap or necessary saturated-family relocation: %s', async mode => {
 const root=await mkdtemp(join(tmpdir(),'image-gap-directed-'))
 try {
  const count=mode==='augment'||mode==='same-page'?4:17
  const demands=Array.from({length:count},(_,i)=>({findingId:`gap-${i}`,brief:{id:`gap-${i}:main`,pageId:mode==='same-page'&&i<2?'shared-page':`gap-${i}`,version:'gap-fixture',conclusion:'茶园漫行',subjects:['茶园漫行'],activities:[],environment:'茶园',scale:'scene',allowedKinds:['render'],allowedSources:['generated'],locale:'domestic'}}))
  const oldCount=mode==='unrelated'?8:mode==='discovery'?0:2
  const assets=await Promise.all(Array.from({length:oldCount+1},async(_,i)=>({...await material(root,'茶园漫行',i),pageBindings:[{findingId:`gap-${i*2}`},{findingId:`gap-${i*2+1}`}]})))
  const digests=await Promise.all(assets.map(async a=>createHash('sha256').update(await readFile(a.sourcePath)).digest('hex')))
  const calls:{asset:number,ids:string[]}[]=[];let searches=0
  const inspect=vi.fn(async(_:unknown,request:any)=>{const digest=createHash('sha256').update(request.bytes).digest('hex'),asset=digests.indexOf(digest);calls.push({asset,ids:request.slots.map((s:any)=>s.brief.id)})
   return request.slots.map((s:any)=>{const id=Number(s.brief.id.split('-')[1].split(':')[0]);const approved=mode==='discovery'?false:mode==='same-page'?(asset===0&&id<2||asset===1&&id>=2||asset===2&&id===0):mode==='unrelated'?(asset<oldCount&&[asset*2,asset*2+1].includes(id)):(asset===0&&id<3||asset===1&&id===3||asset===2&&id===0)
    return {schemaVersion:'pre-design.image-inspection.v1',imageSha256:digest,requirementHash:imageBriefHash(s.brief),usageId:s.brief.id,placementHash:s.placementHash,inspectedAt:'fixture',actualImageInput:true,actualModel:{provider:'fixture',model:'vision'},executionId:'fixture-run',contentKind:'render',relevant:approved,matchedSubjects:approved?s.brief.subjects:[],mismatches:approved?[]:['fixture'],domesticContext:'supported',textLanguages:[],textLegible:true,watermark:'none',quality:'pass',essentialBounds:approved?[{x:0,y:0,width:1,height:1}]:[],decision:approved?'approved':'rejected',sourceContextHash:imageSourceContextHash(request)}})})
  const pipeline=new ReportImagePipeline({classes:{settings:()=>({routes:{review:{provider:'fixture',model:'vision'}}}),execution:()=>({classId:'review',status:'completed',actual:{provider:'fixture',model:'vision'}})} as never,inspection:{inspect} as never,resolveDemands:async()=>demands as never,candidates:async()=>assets.slice(0,oldCount),search:async()=>++searches===1?[assets[oldCount]!]:[]})
  // Synthetic demand IDs intentionally stop at physical-report validation if all become allocated.
  let error='';try{await pipeline.prepare(project(),root,{} as never,AbortSignal.timeout(20_000),()=>{})}catch(e){error=(e as Error).message}
  const acquired=calls.filter(c=>c.asset===oldCount)
  if(mode==='unrelated'){expect(error).toContain('REPORT_IMAGE_GAPS: 1 ');expect(acquired).toEqual([{asset:8,ids:['gap-16:main']}])}
  else if(mode==='discovery'){expect(error).toContain('REPORT_IMAGE_GAPS: 17 ');expect(acquired).toHaveLength(1);expect(acquired[0]!.ids).toHaveLength(8);expect(acquired[0]!.ids[0]).toBe('gap-0:main')}
  else {expect(error).not.toContain('REPORT_IMAGE_GAPS');expect(acquired[0]?.ids).toEqual([mode==='same-page'?'gap-1:main':'gap-2:main']);expect(acquired.flatMap(c=>c.ids)).toContain('gap-0:main');expect(acquired.flatMap(c=>c.ids)).not.toContain('gap-3:main')}
 } finally {await rm(root,{recursive:true,force:true})}
},30_000)
