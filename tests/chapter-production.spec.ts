import { expect, it } from 'vitest'
import { buildChapterResearchCatalog, createProductionBrief, createNativeChapterBrief, validateResearchPlan, compileNativeChapterLayout } from '../src/report/chapter-production-contract.ts'
import { sha256CanonicalJson as hash } from '../src/presentation/canonical-json.ts'
import { auditChapterImageUse } from '../src/report/chapter-visual-policy.ts'
import * as productionContract from '../src/report/chapter-production-contract.ts'

const plan = { chapterId:'opportunity',title:'发展机会',summary:'湖山体验',pages:[{id:'opportunity-one',title:'资源价值',content:{}}],sources:[{id:'H-P03',objectId:'human',fieldPath:'page3',text:'人工稿',basis:'参考',evidenceIds:[]}] }
const brief:any = {plan,approval:{origin:'user-message',message:'继续下一步吧',approvedAt:'2026-10-15T00:00:00Z',planHash:hash(plan)}}
const research:any = {fingerprint:'research-v1',documents:[{path:'sources/official.json',contentHash:'digest',provenance:{sourceUri:'https://example.gov.cn/culture',retrievedAt:'2026-10-01'}}],results:[{
 itemId:'1.06',moduleId:'culture',runId:'r1',outputs:{local_resources:{records:[{recordId:'tea',name:{value:'茶园',claimRefs:['c1'],claimClass:'fact',limitations:[]}}]}},claims:[{claimId:'c1',kind:'fact',sourceIds:['s1']}],sourceValues:[{sourceId:'s1',path:'sources/official.json',contentHash:'digest',quote:'茶园生产与文化'}],execution:{synthesis:{judgment:{conclusion:'茶事可转化为参与体验'}}}
}],moduleRuns:[{itemId:'1.06',bundleRunId:'r1',resultHash:'hash',status:'completed'}]}

it('retains native research and original source provenance in the chapter source packet',()=>{
 const catalog=buildChapterResearchCatalog(research,'opportunity')
 expect(catalog.sources.some(s=>s.text.includes('茶园'))).toBe(true)
 expect(catalog.evidence.some(s=>s.url==='https://example.gov.cn/culture'&&s.quote==='茶园生产与文化')).toBe(true)
 expect(catalog.researchFingerprint).toBe('research-v1')
 expect(()=>buildChapterResearchCatalog(undefined,'opportunity')).toThrow('CHAPTER_RESEARCH_REQUIRED')
})
it('binds a native page plan to chapter authorization without claiming page-by-page user approval',()=>{
 const catalog=buildChapterResearchCatalog(research,'opportunity')
 const request:any={origin:'user-message',scope:'chapter',chapterId:'site',message:'这些小问题以后优化，接着往后吧',requestedAt:'2026-10-16T05:00:00Z',feedback:'继续第二章'}
 const native:any={chapterId:'site',title:'场地条件与发展判断',summary:'从现状资源推导空间动作',pages:[{id:'site-overview',title:'场地总览',question:'资源如何组织？',visualIntent:'展示现场照片和原始点位图',sourceRefs:[catalog.sources[0]!.id],notes:['许可进入备注']} ]}
 const result=createNativeChapterBrief(native,catalog,request)
 expect(result.approval).toMatchObject({scope:'chapter',planOrigin:'dsh-native',message:request.message})
 expect(result.plan.pages[0]!.content).toMatchObject({question:'资源如何组织？'})
 const perPage={pages:[{pageId:'site-overview',sourceRefs:[catalog.sources[0]!.id],judgment:'茶田与村落形成连续的参与空间。',notes:['许可进入备注']}],gaps:[]}
 expect(createProductionBrief(result,catalog,perPage,request).approval.scope).toBe('chapter')
 expect(()=>createNativeChapterBrief({...native,pages:[{...native.pages[0],id:'opportunity-wrong'}]},catalog,request)).toThrow('CHAPTER_PLAN_PAGES_INVALID')
 expect(()=>createNativeChapterBrief({...native,pages:[{...native.pages[0],sourceRefs:['invented']}]},catalog,request)).toThrow('CHAPTER_NATIVE_PLAN_SOURCE')
 expect(()=>createNativeChapterBrief(native,catalog,{...request,chapterId:'products'})).toThrow('CHAPTER_NATIVE_PLAN_SCOPE')
})
it('derives a new approved production scope without changing the earlier page plan or its revision budget',()=>{
 const before=JSON.stringify(brief),catalog=buildChapterResearchCatalog(research,'opportunity')
 const selected={pages:[{pageId:'opportunity-one',sourceRefs:[catalog.sources[0]!.id],judgment:'茶事与村落形成连续体验。',notes:['权属需确认。']}],gaps:[]}
 const request:any={origin:'user-message',message:'执行',requestedAt:'2026-10-15T01:00:00Z',basePlanHash:brief.approval.planHash,feedback:'统一标题，主图放大。'}
 const next=createProductionBrief(brief,catalog,selected,request)
 expect(next.plan.sources.some(s=>s.id===catalog.sources[0]!.id)).toBe(true)
 expect(next.plan.pages[0]!.id).toBe('opportunity-one')
 expect(next.approval.planHash).not.toBe(brief.approval.planHash)
 expect(JSON.stringify(brief)).toBe(before)
 expect(()=>validateResearchPlan({...selected,pages:[]},brief,catalog.sources)).toThrow('CHAPTER_RESEARCH_PAGES')
})
it('allows a complete product chapter to expand its sites and operating system without truncation',()=>{
 const catalog=buildChapterResearchCatalog(research,'opportunity')
 const request:any={origin:'user-message',scope:'chapter',chapterId:'products',message:'直接完成两个大章节',requestedAt:'2026-10-20T00:00:00Z',feedback:'九点位逐项展开'}
 const native:any={chapterId:'products',title:'产业规划与产品体系',summary:'产业、产品及游程组织',pages:Array.from({length:24},(_,i)=>({id:`products-${i+1}`,title:`产品任务${i+1}`,question:'如何形成完整体验？',visualIntent:'现场载体与产品关系图',sourceRefs:[catalog.sources[0]!.id],notes:[]}))}
 expect(createNativeChapterBrief(native,catalog,request).plan.pages).toHaveLength(24)
 expect(()=>createNativeChapterBrief({...native,pages:Array.from({length:33},(_,i)=>({...native.pages[0],id:`products-${i+1}`}))},catalog,request)).toThrow('CHAPTER_NATIVE_PLAN_SHAPE')
})
it('binds chapter research to the actual project, request and sources without importing a sample project',()=>{
 const query=(productionContract as any).chapterWebResearchQuery
 const context={projectName:'滨海工业遗产公园',request:'保留厂房与轨道遗产，研究产业链、研学和住宿；防洪条件需按原资料核实。',
  sources:[{id:'R-site',text:'项目位于青岛市黄岛区，现有厂房两栋。',basis:'原始调查'}]}
 const strategy=query('positioning',context),products=query('products',context),site=query('site',context)
 for(const prompt of [strategy,products,site]){
  expect(prompt).toContain(context.projectName);expect(prompt).toContain(context.request);expect(prompt).toContain(context.sources[0].text)
  expect(prompt).not.toMatch(/少潭河|九点位|三码头|武汉|木兰|天目湖|洈水|峒山/)
  expect(prompt).toContain('真实使用网页工具');expect(prompt).toContain('完整URL')
 }
 expect(strategy).toContain('定位');expect(products).toContain('产业链');expect(site).toContain('地理位置')
 expect(query('site')).not.toMatch(/少潭河|武汉|防洪灌溉/)
 const guidance=(productionContract as any).chapterPagePlanningGuidance('products')
 expect(guidance).toContain('核心产品');expect(guidance).not.toMatch(/九点位|三码头|少潭/)
})
it('records early chapter milestones before manuscript and export hashes exist',()=>{
 const identity=(productionContract as any).chapterProductionMilestoneIdentity
 expect(typeof identity).toBe('function')
 const state={basePlanHash:'native-plan'}
 const first=identity('plan',state)
 expect(first).toMatch(/^[a-f0-9]{64}$/)
 expect(identity('plan',{...state,updatedAt:'later'})).toBe(first)
 expect(identity('write',{...state,manuscriptHash:'new-copy'})).not.toBe(first)
})
it('compiles a native image/layout decision with aligned body columns and an enlarged left-edge hero',()=>{
 const draft:any={chapter:{pages:[{id:'opportunity-one',body:['一','二','三'],table:{columns:['案例'],rows:[['实例']]}}]}}
 const decisions:any={pages:[{pageId:'opportunity-one',template:'table-bottom',assetIds:['photo'],captions:['案例实景'],mainRatio:0.64,reason:'表格与图片对照，三段文字同排'}]}
 const layouts=compileNativeChapterLayout(draft,decisions,[{id:'photo'}] as any)
 const bodies=layouts[0]!.elements.filter(e=>e.type==='body')
 expect(new Set(bodies.map(e=>e.rect.y)).size).toBe(1)
 expect(new Set(bodies.map(e=>e.rect.width)).size).toBe(1)
 decisions.pages[0].template='hero-left';delete draft.chapter.pages[0].table
 expect(()=>compileNativeChapterLayout(draft,decisions,[{id:'photo'}] as any)).toThrow('CHAPTER_HERO_CAPTION_OVERLAY_REQUIRED')
 decisions.pages[0].protectedAreas=[{figureIndex:0,rect:{x:.1,y:.2,width:.8,height:.6},reason:'图像主体'}]
 decisions.pages[0].overlays=[{target:'caption',figureIndex:0,rect:{x:0,y:.9,width:1,height:.04},align:'center',tone:'light',reason:'非主体背景'}]
 const hero=compileNativeChapterLayout(draft,decisions,[{id:'photo'}] as any)[0]!.elements.find(e=>e.type==='figure')!
 expect(hero.rect.x).toBe(0);expect(hero.rect.y).toBe(0);expect(hero.rect.height).toBe(900);expect(hero.rect.width).toBeGreaterThan(1000)
 decisions.pages[0].assetIds=['missing']
 expect(()=>compileNativeChapterLayout(draft,decisions,[{id:'photo'}] as any)).toThrow('CHAPTER_LAYOUT_ASSET')
})
it('does not apply the unused hero ratio range to a native table layout',()=>{
 const draft:any={chapter:{pages:[{id:'compare',body:['一','二','三'],table:{columns:['类型'],rows:[['方案']]}}]}}
 const decision:any={pages:[{pageId:'compare',template:'table-side',assetIds:['photo'],captions:['概念场景'],mainRatio:.54,reason:'左右图表'}]}
 expect(()=>compileNativeChapterLayout(draft,decision,[{id:'photo'}] as any)).not.toThrow()
 decision.pages[0].template='hero-left';delete draft.chapter.pages[0].table
 expect(()=>compileNativeChapterLayout(draft,decision,[{id:'photo'}] as any)).toThrow('CHAPTER_HERO_RATIO')
})

// Regression: chapter production previously omitted the established original-image cap.
it('lets a native comparison use its complete matrix without an unrelated filler photo',()=>{
 const draft:any={chapter:{pages:[{id:'case-methods',body:['结论一','结论二','结论三'],table:{columns:['案例','组织方式','可借鉴','适用边界'],rows:[['甲','方式','行动','说明']]}}]}}
 const decisions:any={pages:[{pageId:'case-methods',template:'table-main',assetIds:[],captions:[],mainRatio:.64,reason:'比较矩阵是主视觉'}]}
 const layout=compileNativeChapterLayout(draft,decisions,[])[0]!
 expect(layout.elements.filter(e=>e.type==='figure')).toHaveLength(0)
 expect(layout.elements.find(e=>e.type==='table')!.rect).toEqual({x:56,y:210,width:1488,height:480})
 expect(layout.elements.filter(e=>e.type==='body').map(e=>e.index)).toEqual([0,1,2])
 delete draft.chapter.pages[0].table
 expect(()=>compileNativeChapterLayout(draft,decisions,[])).toThrow('CHAPTER_LAYOUT_TABLE_REQUIRED')
})
it('returns the actual missing page IDs rather than suggesting a geometry fix',()=>{
 const draft:any={chapter:{pages:[{id:'p1'},{id:'p2'},{id:'p3'}]}}
 expect(()=>compileNativeChapterLayout(draft,{pages:[{pageId:'p2'}]} as any,[])).toThrow('"missing":["p1","p3"]')
 expect(()=>compileNativeChapterLayout(draft,{pages:[{pageId:'p2'}]} as any,[])).toThrow('"expectedCount":3,"receivedCount":1')
})
it('never silently discards authored visual content in a fixed template',()=>{
 const draft:any={chapter:{pages:[{id:'product',body:['体验内容']}]}}
 const decision:any={pages:[{pageId:'product',template:'triptych',assetIds:['a','b','c'],captions:['甲','乙','丙'],mainRatio:.64,reason:'场地与体验',composition:{sequences:[{label:'体验流程'}]}}]}
 expect(()=>compileNativeChapterLayout(draft,decision,[{id:'a'},{id:'b'},{id:'c'}] as any)).toThrow('CHAPTER_LAYOUT_UNRENDERED_SEQUENCE')
 decision.pages[0].composition={graphics:[{label:'服务关系'}]}
 expect(()=>compileNativeChapterLayout(draft,decision,[{id:'a'},{id:'b'},{id:'c'}] as any)).toThrow('CHAPTER_LAYOUT_UNRENDERED_GRAPHIC')
})
it('allows a complete native itinerary to be the main visual without filler photographs',()=>{
 const draft:any={chapter:{pages:[{id:'journey',body:['游程内容'],sourceRefs:['R-1']}]}}
 const decision:any={pages:[{pageId:'journey',template:'composed',assetIds:[],captions:[],mainRatio:.64,reason:'游程序列',
  composition:{title:{x:56,y:68,width:1488,height:54},claim:{x:56,y:130,width:1488,height:48},figures:[],
   bodies:[{index:0,rect:{x:56,y:718,width:1488,height:122}}],
   sequences:[{rect:{x:56,y:190,width:1488,height:160},label:'概念游程',nodes:[{title:'到达',detail:'村落服务'},{title:'体验',detail:'茶园观察'}]}]}}]}
 expect(compileNativeChapterLayout(draft,decision,[])[0]!.elements.some(e=>e.type==='sequence')).toBe(true)
 decision.pages[0].composition.sequences[0].rect.height=140
 expect(()=>compileNativeChapterLayout(draft,decision,[])).toThrow('CHAPTER_COMPOSITION_SEQUENCE_SIZE')
 decision.pages[0].composition.sequences=[]
 expect(()=>compileNativeChapterLayout(draft,decision,[])).toThrow('CHAPTER_LAYOUT_ASSET')
})
it('rejects a third use even when cropped derivatives have different asset IDs and hashes',()=>{
 const draft:any={chapter:{pages:[1,2,3].map(n=>({id:'p'+n,body:['内容'],table:{columns:['类型'],rows:[['内容']]}}))}}
 const decision:any={pages:[1,2,3].map(n=>({pageId:'p'+n,template:'table-side',assetIds:['a'+n],captions:['图片'],mainRatio:.65,reason:'比较'}))}
 const assets:any=[1,2,3].map(n=>({id:'a'+n,sha256:'sha'+n,imageIdentity:{originalId:'one-original',fileSha256:'sha'+n,verification:'verified-derivative'}}))
 expect(()=>compileNativeChapterLayout(draft,decision,assets)).toThrow('CHAPTER_IMAGE_ORIGINAL_REUSE')
})
it('rejects identical source bytes under two names on the same physical page',()=>{
 const draft:any={chapter:{pages:[{id:'one',body:['内容']}]}}
 const decision:any={pages:[{pageId:'one',template:'pair-bottom',assetIds:['a','b'],captions:['甲','乙'],mainRatio:.65,reason:'比较'}]}
 expect(()=>compileNativeChapterLayout(draft,decision,[{id:'a',sha256:'same'},{id:'b',sha256:'same'}] as any)).toThrow('CHAPTER_IMAGE_SAME_PAGE_DUPLICATE')
})
it('allows intentional title and caption overlays but rejects covering a protected image subject',()=>{
 const draft:any={chapter:{pages:[{id:'one',body:['内容']}]}}
 const decision:any={pages:[{pageId:'one',template:'hero-left',assetIds:['a'],captions:['图片'],mainRatio:.65,reason:'大图',
   protectedAreas:[{figureIndex:0,rect:{x:.2,y:.35,width:.6,height:.45},reason:'湖湾主体'}],
   overlays:[{target:'title',figureIndex:0,rect:{x:.05,y:.05,width:.9,height:.18},align:'left',tone:'light',reason:'顶部背景'},
     {target:'caption',figureIndex:0,rect:{x:0,y:.93,width:1,height:.04},align:'center',tone:'dark',reason:'底部背景'}]}]}
 const layouts=compileNativeChapterLayout(draft,decision,[{id:'a',sha256:'a'}] as any)
 expect(layouts[0]).toHaveProperty('titleOverlay.rect.y',45)
 decision.pages[0].overlays[0].rect.y=.4
 expect(()=>compileNativeChapterLayout(draft,decision,[{id:'a',sha256:'a'}] as any)).toThrow('CHAPTER_OVERLAY_SUBJECT_OCCLUDED')
})
it('counts other current chapters while replacing rather than adding an older version of this chapter',()=>{
 const layouts:any=[{pageId:'new',elements:[{type:'figure',assetId:'photo',caption:'现场'}]}]
 const prior:any=[{chapterId:'opportunity',pageId:'old',id:'photo',sha256:'same',page:1,caption:''},{chapterId:'site',pageId:'site1',id:'other-id',sha256:'same',page:1,caption:''}]
 expect(auditChapterImageUse('opportunity',layouts,[{id:'photo',sha256:'same'}],prior).originals[0]?.count).toBe(2)
 prior.push({...prior[1],pageId:'site2',page:2})
 expect(auditChapterImageUse('opportunity',layouts,[{id:'photo',sha256:'same'}],prior).pass).toBe(false)
})

it('shares the exact production directory with host adapters and binds it to the current project context',()=>{
 const directory=(productionContract as any).chapterProductionDirectory
 expect(typeof directory).toBe('function')
 const project={projectId:'project-1',projectName:'滨海工业遗产'},request={origin:'user-message',message:'编排场地章',requestedAt:'2026-11-03T00:00:00Z',feedback:''}
 const root=directory('/workspace',project,'site',request)
 expect(root).toMatch(/^\/workspace\/\.pre-design\/chapter-productions\/site\/[a-f0-9]{20}$/)
 expect(directory('/workspace',project,'site',structuredClone(request))).toBe(root)
 expect(directory('/workspace',{...project,projectName:'另一个项目'},'site',request)).not.toBe(root)
 expect(directory('/workspace',project,'site',{...request,feedback:'新的要求'})).not.toBe(root)
})
