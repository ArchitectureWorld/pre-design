import { it,expect } from 'vitest'
import { mkdtemp,readFile,writeFile,rm } from 'node:fs/promises'
import { join, resolve, basename, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { PDFDocument,PDFName } from 'pdf-lib'
import { exportNativeChapter } from '../src/report/chapter-production-export.ts'
import { compileNativeChapterLayout } from '../src/report/chapter-production-contract.ts'
import { REPORT_DESIGN_RULES } from '../src/report/design-rules.ts'

it('exports a photo-free comparison and rejects text extending beyond its allocated table area',async()=>{
  const root=await mkdtemp(join(tmpdir(),'chapter-matrix-export-'))
  try{
    const draft:any={chapterId:'positioning',scope:'chapter',planHash:'fixture',rulesVersion:REPORT_DESIGN_RULES.version,chapter:{id:'positioning',title:'案例方法比较',pages:[{
      id:'positioning-cases',title:'不同案例形成可借鉴的组织方法',claim:'比较组织方式，提炼适合本项目的体验策略。',body:['以本地资源转译内容。','组合完整的游程与服务。','区分经验借鉴与项目方案。'],sourceRefs:['T'],notes:['案例出处保留于备注。'],visual:{caption:'案例比较'},
      table:{columns:['案例','体验组织','可借鉴内容','适用边界'],rows:[['案例甲','线路连接多个体验节点','分段游程与内容接续','借鉴组织方法，结合项目条件转译'],['案例乙','住宿、活动与教育分区','主次协同的服务系统','依据项目特点确定内容和规模'],['案例丙','地方文化主题体验','持续更新主题内容','形成自身文化表达']]},
    }]}}
    const layouts=compileNativeChapterLayout(draft,{pages:[{pageId:'positioning-cases',template:'table-main',assetIds:[],captions:[],mainRatio:.64,reason:'完整矩阵',contextLabel:'组织方法比较示意'}]},[])
    const result=await exportNativeChapter(root,draft,layouts,[],AbortSignal.timeout(45000),{versionId:'000000000001'})
    const qa=JSON.parse(await readFile(result.browserQa,'utf8'))
    expect(qa.pass).toBe(true);expect(qa.pages[0].exactCopy).toBe(true)
    expect(qa.pages[0].graphics).toContain('组织方法比较示意')
    expect(qa.pages[0].exactGraphics).toBe(true)
    const cramped=layouts.map(p=>({...p,elements:p.elements.map(e=>e.type==='table'?{...e,rect:{...e.rect,height:80}}:e)}))
    await expect(exportNativeChapter(root,draft,cramped,[],AbortSignal.timeout(45000),{versionId:'000000000002'})).rejects.toThrow('CHAPTER_VISUAL_CHECK')
    const rejected=JSON.parse(await readFile(join(root,'export-000000000002','逐页检查','显示核验.json'),'utf8'))
    expect(rejected.pages[0].overflow.length).toBeGreaterThan(0)
  }finally{
    if(!resolve(root).startsWith(resolve(tmpdir())+sep)||!basename(root).startsWith('chapter-matrix-export-'))throw new Error('Unexpected test directory')
    await rm(root,{recursive:true,force:true})
  }
},60000)

it.each([
  { align:'center', caption:'山水环境，经营条件待核', blocked:false },
  { align:'right', caption:'山水环境，经营条件待核', blocked:false },
  { align:'center', caption:'会议纪要', blocked:true },
  { align:'center', caption:'山水环境，经营条件待核', blocked:false, chapterId:'site' },
] as const)('exports native copy and audits the public caption: $align / $caption',async(testCase)=>{
  const {align,caption,blocked}=testCase,chapterId='chapterId' in testCase?testCase.chapterId:'opportunity'
  const root=await mkdtemp(join(tmpdir(),'chapter-export-test-'))
  try{
    const bytes=await sharp({create:{width:1600,height:1200,channels:3,background:'#668c69'}}).png().toBuffer(),path=join(root,'photo.png')
    await writeFile(path,bytes)
    const assets=[{id:'photo',path,sha256:createHash('sha256').update(bytes).digest('hex'),width:1600,height:1200,label:'测试图',sourceNote:'测试图注出处'}]
    const draft:any={scope:'chapter',planHash:'fixture',rulesVersion:REPORT_DESIGN_RULES.version,chapter:{title:'章节测试',pages:[{id:'opportunity-one',title:'自然与体验',claim:'将山水资源组织为完整体验。',body:['在湖山环境中组织户外活动。','将村落服务与茶事体验相互衔接。','以游客停留和在地参与形成持续价值。'],notes:['这是一条测试备注，不在正文中展示。'],sourceRefs:['T'],visual:{caption:'湖山关系'}}]}}
    draft.chapterId=chapterId;draft.chapter.id=chapterId
    const layouts=compileNativeChapterLayout(draft,{pages:[{pageId:'opportunity-one',template:'hero-left',assetIds:['photo'],captions:[caption],mainRatio:0.65,reason:'测试',
      protectedAreas:[{figureIndex:0,rect:{x:.15,y:.4,width:.7,height:.4},reason:'主体'}],
      overlays:[{target:'title',figureIndex:0,rect:{x:.05,y:.06,width:.9,height:.18},align:'left',tone:'light',reason:'空白处'},
        {target:'caption',figureIndex:0,rect:{x:0,y:.94,width:1,height:.04},align,tone:'light',reason:'空白处'}]}]},assets)
    if(blocked){
      await expect(exportNativeChapter(root,draft,layouts,assets,AbortSignal.timeout(45000))).rejects.toThrow('CHAPTER_VISUAL_CHECK')
      const qa=JSON.parse(await readFile(join(root,'export','逐页检查','显示核验.json'),'utf8'))
      expect(qa.pages[0].processLanguage).toBe(true)
      return
    }
    const result=await exportNativeChapter(root,draft,layouts,assets,AbortSignal.timeout(45000))
    const pdf=await PDFDocument.load(await readFile(result.pdfPath)),qa=JSON.parse(await readFile(result.browserQa,'utf8'))
    expect(pdf.getPageCount()).toBe(1);expect(pdf.getPage(0).node.get(PDFName.of('Annots'))).toBeDefined()
    expect(qa.pass).toBe(true);expect(qa.pages[0].exactCopy).toBe(true)
    expect(qa.pages[0].overlays).toHaveLength(2)
    expect(qa.pages[0].overlays.every((o:any)=>o.insideImage&&o.transparentContainer)).toBe(true)
    expect(qa.pages[0].overlays[1].rect.y).toBe(846)
    expect(qa.pages[0].overlayOcclusions).toEqual([])
    expect(qa.pages[0].captions[0].text).toBe('山水环境')
    const ordinal=chapterId==='site'?'第二章':'第一章'
    expect(result.pdfPath).toContain(ordinal)
    const notes=JSON.parse(await readFile(join(root,'export',ordinal+'_备注与来源.json'),'utf8'))
    expect(notes.pages[0].notes).toContain('原生图注：山水环境，经营条件待核')
    expect(JSON.parse(await readFile(result.imageUsagePath,'utf8')).originals[0].count).toBe(1)
  }finally{await rm(root,{recursive:true,force:true})}
},60000)

it.each([false,true])('keeps native graph and map labels in browser/PDF output and their provenance in notes (lanes=%s)',async(lanes)=>{
  const root=await mkdtemp(join(tmpdir(),'chapter-graphics-export-'))
  try{
    const bytes=await sharp({create:{width:660,height:749,channels:3,background:'#56735c'}}).png().toBuffer(),path=join(root,'map.png');await writeFile(path,bytes)
    const assets=[{id:'map',path,sha256:createHash('sha256').update(bytes).digest('hex'),width:660,height:749,label:'测试底图',sourceNote:'测试底图依据'}]
    const copy={title:'山水空间关系',claim:'联系水岸与村落，组织分散的游览节点。',body:['形成相互联系的体验与服务空间。'],sourceRefs:['T'],notes:['原生正文备注'],visual:{caption:'空间关系'}}
    const draft:any={chapterId:'site',scope:'chapter',planHash:'fixture',rulesVersion:REPORT_DESIGN_RULES.version,chapter:{id:'site',title:'图件导出测试',pages:[{id:'site-01',...copy},{id:'site-02',...copy}]}}
    const graph:any={nodes:[{id:'a',label:'起点',column:0,row:0},{id:'b',label:'水岸',column:1,row:0},{id:'c',label:'村落',column:1,row:1}],edges:[{from:'a',to:'b'},{from:'a',to:'c'}]}
    if(lanes){graph.edges.push({from:'c',to:'b'});graph.presentation={kind:'primary-secondary',primaryNodeIds:['a','b'],secondaryNodeIds:['a','c','b'],primaryLabel:'游览主线',secondaryLabel:'服务辅线'}}
    const decisions:any={pages:[{pageId:'site-01',template:'diagram-main',assetIds:[],captions:[],mainRatio:.65,reason:'原生关系图',composition:{title:{x:56,y:68,width:1488,height:54},claim:{x:56,y:130,width:1488,height:44},figures:[],bodies:[{index:0,rect:{x:56,y:720,width:1488,height:80}}],sequences:[],graphics:[{rect:{x:56,y:200,width:1488,height:470},label:'游览联系示意',graph,sourceRefs:['T'],notes:['关系图概念依据']}]}},
    {pageId:'site-02',template:'analysis-map',assetIds:['map'],captions:['水岸与地形关系示意'],mainRatio:.65,reason:'原生图上标注',composition:{title:{x:800,y:80,width:744,height:108},claim:{x:800,y:220,width:744,height:80},figures:[{rect:{x:56,y:64,width:660,height:749},fit:'contain',captionAlign:'center',annotations:{sourceRefs:['T'],notes:['标注为概念建议'],markers:[{label:'水岸节点',point:{x:.5,y:.6},labelRect:{x:0,y:.2,width:.3,height:.07},align:'left'},{label:'谷地聚落',point:{x:.2,y:.3},labelRect:{x:.7,y:.4,width:.3,height:.07},align:'right'}],paths:[]}}],bodies:[{index:0,rect:{x:800,y:360,width:744,height:170}}],sequences:[]}}]}
    const layouts=compileNativeChapterLayout(draft,decisions,assets),result=await exportNativeChapter(root,draft,layouts,assets,AbortSignal.timeout(45000))
    const qa=JSON.parse(await readFile(result.browserQa,'utf8')),notes=JSON.parse(await readFile(join(root,'export','第二章_备注与来源.json'),'utf8'))
    expect(qa.pass).toBe(true);expect(qa.pages.every((p:any)=>p.exactGraphics)).toBe(true)
    expect(qa.pages[0].graphics).toEqual(expect.arrayContaining(['起点','水岸','村落']))
    if(lanes)expect(qa.pages[0].graphics).toEqual(expect.arrayContaining(['游览主线','服务辅线']))
    expect(qa.pages[1].graphics).toEqual(['水岸节点','谷地聚落'])
    expect(qa.pages[1].annotationAlignment.every((offset:number)=>Math.abs(offset)<1)).toBe(true)
    expect(notes.pages[0].notes).toContain('关系图概念依据');expect(notes.pages[1].notes).toContain('标注为概念建议')
    const pdf=await PDFDocument.load(await readFile(result.pdfPath));expect(pdf.getPageCount()).toBe(2)
  }finally{await rm(root,{recursive:true,force:true})}
},60000)
