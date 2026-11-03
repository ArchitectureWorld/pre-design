import { expect,it } from 'vitest'
import { chapterGraphicSvg } from '../src/report/chapter-graphics.ts'
import { compileNativeChapterLayout } from '../src/report/chapter-production-contract.ts'
import { renderChapterHtml } from '../src/report/chapter-render.ts'
import { validateScopedLayoutFeedback,mergeScopedLayoutDecision,validateNativeLayoutCandidate } from '../src/report/chapter-layout-revision.ts'
import { REPORT_DESIGN_RULES } from '../src/report/design-rules.ts'

const composition={title:{x:800,y:80,width:744,height:108},claim:{x:800,y:220,width:744,height:80},
  figures:[{rect:{x:56,y:64,width:660,height:749},fit:'contain',captionAlign:'center'}],
  bodies:[{index:0,rect:{x:800,y:360,width:744,height:170}}],sequences:[]}
const page={pageId:'site-01',template:'composed',assetIds:['map'],captions:['资源点位分布'],mainRatio:.65,reason:'主图与文字形成两组',composition}
const draft:any={chapterId:'site',rulesVersion:REPORT_DESIGN_RULES.version,planHash:'plan',chapter:{id:'site',title:'场地条件与发展判断',pages:[{id:'site-01',title:'原生标题',claim:'原生结论',body:['原生正文'],sourceRefs:[],notes:[],visual:{caption:'资源分布'}}]}}

const tableDraft:any={...draft,chapter:{...draft.chapter,pages:[{...draft.chapter.pages[0],table:{columns:['案例','方法'],rows:[['甲','较长的原生方法文字'],['乙','保留全部原生表格内容']]}}]}}
const tableComposition={...composition,figures:[{rect:{x:56,y:220,width:600,height:336},fit:'cover',captionAlign:'left'}],title:{x:56,y:68,width:1488,height:54},claim:{x:56,y:130,width:1488,height:48},bodies:[{index:0,rect:{x:56,y:640,width:600,height:140}}],table:{rect:{x:720,y:220,width:824,height:600},columnWidths:[.2,.8]}}
it('accepts native free table placement and unequal columns while retaining complete source copy',()=>{
  const layouts=compileNativeChapterLayout(tableDraft,{pages:[{...page,assetIds:['photo'],captions:['相关场景'],composition:tableComposition}]} as any,[{id:'photo'}])
  expect(layouts[0]!.elements.find(e=>e.type==='table')).toMatchObject({rect:tableComposition.table.rect,columnWidths:[.2,.8]})
  const html=renderChapterHtml(tableDraft,layouts,[{id:'photo',width:1600,height:896,dataUrl:'data:image/png;base64,AA==',label:'原图',sourceNote:'用户原图'}])
  expect(html).toContain('<colgroup><col style="width:20%"><col style="width:80%"></colgroup>')
  expect(html).toContain('保留全部原生表格内容');expect(html).toContain('原生正文')
})
it('rejects missing tables, invalid column budgets and table collisions before browser export',()=>{
  const run=(c:any)=>compileNativeChapterLayout(tableDraft,{pages:[{...page,assetIds:['photo'],composition:c}]} as any,[{id:'photo'}])
  expect(()=>run({...tableComposition,table:undefined})).toThrow('CHAPTER_COMPOSITION_TABLE')
  expect(()=>run({...tableComposition,table:{...tableComposition.table,columnWidths:[.2,.2]}})).toThrow('CHAPTER_COMPOSITION_TABLE_COLUMNS')
  expect(()=>run({...tableComposition,table:{...tableComposition.table,rect:tableComposition.figures[0]!.rect}})).toThrow('CHAPTER_COMPOSITION_COLLISION')
})
it('diagnoses insufficient heading capacity explicitly instead of suggesting missing copy',()=>{
  expect(()=>compileNativeChapterLayout(draft,{pages:[{...page,composition:{...composition,claim:{...composition.claim,height:39}}}]} as any,[{id:'map'}])).toThrow('claim.height must be at least 40')
})
it('compiles native table-side direction and column weights without requiring pixel coordinates',()=>{
  const d:any={...page,template:'table-side',assetIds:['photo'],captions:['场景'],composition:undefined,tableLayout:{imageSide:'left',columnWidths:[.2,.8]}}
  const layouts=compileNativeChapterLayout(tableDraft,{pages:[d]},[{id:'photo'}])
  expect(layouts[0]!.elements.find(e=>e.type==='figure')!.rect).toEqual({x:56,y:220,width:624,height:300})
  expect(layouts[0]!.elements.find(e=>e.type==='table')).toMatchObject({rect:{x:724,y:220,width:820,height:600},columnWidths:[.2,.8]})
  expect(()=>compileNativeChapterLayout(tableDraft,{pages:[{...d,tableLayout:{...d.tableLayout,columnWidths:[.1,.1]}}]},[{id:'photo'}])).toThrow('CHAPTER_TABLE_LAYOUT_COLUMNS')
})

it('uses native portrait geometry and retains every original body and heading in export',()=>{
  const layouts=compileNativeChapterLayout(draft,{pages:[page]} as any,[{id:'map'}])
  const figure=layouts[0]!.elements.find(e=>e.type==='figure')!
  expect(figure.rect).toEqual(composition.figures[0]!.rect)
  expect(layouts[0]!.heading).toEqual({title:composition.title,claim:composition.claim})
  const html=renderChapterHtml(draft,layouts,[{id:'map',width:660,height:749,dataUrl:'data:image/png;base64,AA==',label:'原图',sourceNote:'用户原图'}])
  expect(html).toContain('原生标题');expect(html).toContain('原生结论');expect(html).toContain('原生正文')
  expect(html).toContain('data-align="center"');expect(html).toContain('font-size:20px')
})
it('rejects missing native body copy, off-page blocks and a cropped map before export',()=>{
  const run=(p:any)=>compileNativeChapterLayout(draft,{pages:[p]},[{id:'map'}])
  expect(()=>run({...page,composition:{...composition,bodies:[]}})).toThrow('CHAPTER_COMPOSITION_CONTENT')
  expect(()=>run({...page,composition:{...composition,claim:{x:1500,y:200,width:200,height:80}}})).toThrow('CHAPTER_COMPOSITION_BOUNDS')
  expect(()=>run({...page,composition:{...composition,figures:[{...composition.figures[0],fit:'cover'}]}})).toThrow('CHAPTER_COMPOSITION_MAP_CROP')
  expect(()=>compileNativeChapterLayout({...draft,chapter:{...draft.chapter,pages:[{...draft.chapter.pages[0],body:['原生正文'.repeat(20)]}]}},{pages:[{...page,composition:{...composition,bodies:[{index:0,rect:{x:800,y:360,width:460,height:48}}]}}]} as any,[{id:'map'}])).toThrow('CHAPTER_COMPOSITION_TEXT_HEIGHT')
})
it('rejects overlapping native blocks and supports a native-authored sequence without replacing copy',()=>{
  const run=(c:any)=>compileNativeChapterLayout(draft,{pages:[{...page,composition:c}]} as any,[{id:'map'}])
  expect(()=>run({...composition,claim:composition.title})).toThrow('CHAPTER_COMPOSITION_COLLISION')
  const layouts=run({...composition,sequences:[{rect:{x:800,y:590,width:744,height:200},label:'游览组织建议',nodes:[{title:'水岸',detail:'观景停留'},{title:'村落',detail:'茶事体验'}]}]})
  const html=renderChapterHtml(draft,layouts,[{id:'map',width:660,height:749,dataUrl:'data:image/png;base64,AA==',label:'原图',sourceNote:'用户原图'}])
  expect(html).toContain('游览组织建议');expect(html).toContain('茶事体验');expect(html).toContain('原生正文')
})
it('permits a version-bound user review while rejecting stale or unspecified scope',()=>{
  const previous:any={pages:[page,{...page,pageId:'site-02'}]}
  const state={layoutHash:'current',layoutReceipt:'layout-native.json',htmlSha256:'delivered'}
  const feedback:any={origin:'user-message',message:'第1页零碎',feedback:'重排主图',requestedAt:'2026-10-16T07:00:00Z',baseLayoutHash:'current',baseReceipt:'layout-native.json',baseHtmlSha256:'delivered',pageIds:['site-01']}
  expect(validateScopedLayoutFeedback(feedback,state,previous)).toEqual(['site-01'])
  expect(()=>validateScopedLayoutFeedback({...feedback,baseHtmlSha256:'old'},state,previous)).toThrow('CHAPTER_LAYOUT_USER_REVIEW_STALE')
  expect(()=>validateScopedLayoutFeedback({...feedback,pageIds:['site-unknown']},state,previous)).toThrow('CHAPTER_LAYOUT_USER_REVIEW_SCOPE')
})
it('merges only requested pages and preserves untouched native decisions byte for byte',()=>{
  const untouched={...page,pageId:'site-02'},previous:any={pages:[page,untouched]},before=JSON.stringify(untouched)
  const replacement:any={pages:[{...page,captions:['新版图注']}]}
  const result=mergeScopedLayoutDecision(previous,replacement,['site-01'])
  expect(JSON.stringify(result.pages[1])).toBe(before);expect(result.pages[1]).toBe(untouched)
  expect(result.pages[0]!.captions).toEqual(['新版图注'])
  expect(()=>mergeScopedLayoutDecision(previous,{pages:[untouched]} as any,['site-01'])).toThrow('CHAPTER_LAYOUT_USER_REVIEW_PAGES')
})

const graph={nodes:[{id:'a',label:'上级区域',column:0,row:1},{id:'b',label:'片区',column:1,row:1},{id:'c',label:'支线一',column:2,row:0},{id:'d',label:'支线二',column:2,row:2}],edges:[{from:'a',to:'b'},{from:'b',to:'c'},{from:'b',to:'d'}]}
const graphic={rect:{x:56,y:200,width:1488,height:430},label:'区域关系示意',graph,sourceRefs:['R-1'],notes:['概念关系，不对应测绘位置。']}
const graphicDraft:any={...draft,chapter:{...draft.chapter,pages:[{...draft.chapter.pages[0],sourceRefs:['R-1']}]}}
const graphicPage:any={...page,assetIds:[],captions:[],composition:{title:{x:56,y:68,width:1488,height:54},claim:{x:56,y:130,width:1488,height:44},figures:[],sequences:[],bodies:[{index:0,rect:{x:56,y:690,width:1488,height:100}}],graphics:[graphic]}}
it('renders an authored branching graphic without requiring an unrelated photograph',()=>{
  const layouts=compileNativeChapterLayout(graphicDraft,{pages:[graphicPage]},[])
  const html=renderChapterHtml(graphicDraft,layouts,[])
  expect(html).toContain('data-edge-from="b" data-edge-to="d"')
  expect(html).toContain('区域关系示意');expect(html).toContain('原生正文')
  expect(html).toContain('概念关系，不对应测绘位置。')
  expect(html).not.toContain('<figure ')
})
it('rejects unsourced, unreadable or colliding graphics instead of silently dropping their decisions',()=>{
  const run=(g:any)=>compileNativeChapterLayout(graphicDraft,{pages:[{...graphicPage,composition:{...graphicPage.composition,graphics:[g]}}]},[])
  expect(()=>run({...graphic,sourceRefs:['invented']})).toThrow('CHAPTER_GRAPHIC_SOURCE')
  expect(()=>run({...graphic,rect:{x:56,y:200,width:350,height:120}})).toThrow('CHAPTER_GRAPHIC_SIZE')
  expect(()=>run({...graphic,rect:{...graphic.rect,y:400}})).toThrow('CHAPTER_COMPOSITION_COLLISION')
})
const annotations={sourceRefs:['R-1'],notes:['基于影像辨读，点位为概念建议。'],markers:[{label:'库湾节点',point:{x:.5,y:.6},labelRect:{x:0,y:.2,width:.3,height:.07},align:'left'}],paths:[{role:'ridge',points:[{x:.4,y:.2},{x:.5,y:.3},{x:.7,y:.4}]}]}
it('reports an actionable minimum rectangle for a rejected graph while retaining the readability threshold',()=>{
  const candidate:any={...graphic,rect:{x:56,y:200,width:930,height:450},graph:{
    nodes:Array.from({length:6},(_,i)=>({id:'n'+i,label:'节点'+i,column:Math.floor(i/3),row:i%3})),edges:[],
    presentation:{kind:'editorial',topology:'branch',primaryNodeIds:['n0'],groups:[{label:'主线',nodeIds:['n0','n1','n2','n3']},{label:'配套',nodeIds:['n4','n5']}]}}}
  let diagnostic:any
  try{chapterGraphicSvg(candidate,'capacity')}catch(error){diagnostic=JSON.parse(String(error).split('CHAPTER_GRAPHIC_SIZE: ')[1]!)}
  expect(diagnostic.minimumRect).toEqual({width:500,height:507})
  expect(()=>chapterGraphicSvg({...candidate,rect:{...candidate.rect,...diagnostic.minimumRect}},'capacity')).not.toThrow()
  expect(()=>chapterGraphicSvg({...candidate,rect:{...candidate.rect,...diagnostic.minimumRect,height:506}},'capacity')).toThrow('CHAPTER_GRAPHIC_SIZE')
  expect(candidate.rect.height).toBe(450)
})
it('lets native composition intent resolve a primary graph and aligned copy without pixel collisions',()=>{
  const candidate:any={...graphicPage,template:'diagram-main',composition:{...graphicPage.composition,graphics:[{...graphic,rect:{x:0,y:0,width:20,height:20},graph:{...graph,nodes:graph.nodes.map(n=>({...n,row:n.row===2?1:n.row}))}}]}}
  // Native graph topology/content is unchanged; template geometry is resolved by the product.
  const original=JSON.stringify(candidate)
  const layouts=compileNativeChapterLayout(graphicDraft,{pages:[candidate]},[])
  expect(layouts[0]!.elements.find(e=>e.type==='graphic')!.rect.width).toBe(1488)
  expect(JSON.stringify(candidate)).toBe(original)
  expect(renderChapterHtml(graphicDraft,layouts,[])).toContain('支线二')
})
it('fits a native analysis map to its full source ratio and derives exact edge alignment',()=>{
  const p:any={...page,template:'analysis-map',composition:{...composition,figures:[{rect:{x:0,y:0,width:800,height:400},fit:'cover',captionAlign:'center',annotations:{...annotations,markers:[{...annotations.markers[0],labelRect:{x:.02,y:.2,width:.3,height:.07}}]}}]}}
  const layouts=compileNativeChapterLayout(graphicDraft,{pages:[p]},[{id:'map',width:660,height:749}] as any)
  const f:any=layouts[0]!.elements.find(e=>e.type==='figure')
  expect(f.fit).toBe('contain');expect(f.rect.width/f.rect.height).toBeCloseTo(660/749)
  expect(f.annotations.markers[0].labelRect.x).toBe(0)
  expect(f.annotations.markers[0].point).toEqual(annotations.markers[0]!.point)
})
it('uses verified terrain anchors and rejects guessed proposed coordinates on a DEM',()=>{
  const mapped:any={...page,template:'analysis-map',composition:{...composition,figures:[{...composition.figures[0],annotations:{...annotations,paths:[],markers:[{...annotations.markers[0],kind:'proposed',terrainAnchor:'C3',point:{x:.5,y:.5}}]}}]}}
  const assets:any=[{id:'map',width:660,height:749,terrainAnchors:[{id:'C3',point:{x:.4,y:.3},water:false,elevation:80}]}]
  const f:any=compileNativeChapterLayout(graphicDraft,{pages:[mapped]},assets)[0]!.elements.find(e=>e.type==='figure')
  expect(f.annotations.markers[0].point).toEqual({x:.4,y:.3})
  mapped.composition.figures[0].annotations.markers[0].terrainAnchor='unknown'
  expect(()=>compileNativeChapterLayout(graphicDraft,{pages:[mapped]},assets)).toThrow('CHAPTER_TERRAIN_ANCHOR')
})
it('reports all affected pages together instead of revealing one page per retry',()=>{
  const d:any={...draft,chapter:{...draft.chapter,pages:[draft.chapter.pages[0],{...draft.chapter.pages[0],id:'site-02'}]}}
  const bad:any={...page,composition:{...composition,bodies:[]}}
  try{compileNativeChapterLayout(d,{pages:[bad,{...bad,pageId:'site-02'}]},[{id:'map'}]);throw new Error('expected rejection')}
  catch(e){expect(String(e)).toContain('site-01');expect(String(e)).toContain('site-02')}
})
it('renders native map annotations, preserves notes and counts the underlying original',()=>{
  const mapped:any={...page,composition:{...composition,figures:[{...composition.figures[0],annotations}]}}
  const assets=[{id:'map',sha256:'original'}]
  const layouts=compileNativeChapterLayout(graphicDraft,{pages:[mapped]},assets)
  const html=renderChapterHtml(graphicDraft,layouts,[{id:'map',width:660,height:749,dataUrl:'data:image/png;base64,AA==',label:'原图',sourceNote:'用户原图'}])
  expect(html).toContain('data-graphic-label');expect(html).toContain('库湾节点');expect(html).toContain('基于影像辨读')
  const prior:any=[{id:'x',sha256:'original',chapterId:'other',pageId:'p1'},{id:'y',sha256:'original',chapterId:'other',pageId:'p2'}]
  expect(()=>compileNativeChapterLayout(graphicDraft,{pages:[mapped]},assets,prior)).toThrow('CHAPTER_IMAGE_ORIGINAL_REUSE')
  mapped.composition.figures[0].annotations={...annotations,markers:[{...annotations.markers[0],point:{x:2,y:.5}}]}
  expect(()=>compileNativeChapterLayout(graphicDraft,{pages:[mapped]},assets)).toThrow('CHAPTER_ANNOTATION_BOUNDS')
})
