import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'
import { PDFDocument, PDFName, PDFHexString } from 'pdf-lib'
import type { ChapterDraftRecord } from './chapter-plan.ts'
import { renderChapterHtml, collectChapterNotes, projectChapterCaption, CHAPTER_RENDER_VERSION, CHAPTER_PROCESS_LANGUAGE, type ChapterPageLayout, type ChapterRenderAsset } from './chapter-render.ts'
import { Cdp } from './html-browser.ts'
import { resolveBrowserExecutable } from './browser-executable.ts'
import { sha256CanonicalJson as hash } from '../presentation/canonical-json.ts'
import { auditChapterImageUse,assertChapterImageUse,type ChapterImageUse } from './chapter-visual-policy.ts'
import type { OriginalImageIdentity } from '../visual/image-policy.ts'
import type { ChapterTerrainAnchor } from './chapter-graphics.ts'
import { chapterProfile, chapterExportStem } from './chapter-profile.ts'
import { planningDiagramText } from '../presentation/manuscript-diagrams.ts'
import { auditClientVisuals, assertClientVisuals } from './chapter-client-visuals.ts'

export interface ChapterAssetInput {id:string;path:string;sha256:string;width:number;height:number;label:string;sourceNote:string;visualKind?:import('./chapter-client-visuals.ts').ChapterVisualKind;imageIdentity?:OriginalImageIdentity;terrainAnchors?:ChapterTerrainAnchor[]}
const digest=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex')

/** Product-owned export. Original images and native copy remain immutable. */
export async function exportNativeChapter(root:string,draft:ChapterDraftRecord,layouts:ChapterPageLayout[],inputs:ChapterAssetInput[],signal:AbortSignal,options:{previousImageUse?:ChapterImageUse[];versionId?:string;clientVisuals?:{preceding:ChapterPageLayout[]}}={}){
  const profile=chapterProfile(draft.chapterId??draft.chapter.id??'opportunity')
  if(options.versionId&&!/^[a-f0-9]{12}$/.test(options.versionId))throw new Error('CHAPTER_EXPORT_VERSION')
  const folder=join(root,options.versionId?'export-'+options.versionId:'export'),qa=join(folder,'逐页检查');await mkdir(qa,{recursive:true})
  if(options.clientVisuals){
    const audit=auditClientVisuals(layouts,inputs,options.clientVisuals.preceding)
    await writeFile(join(folder,'场景配图与连续版式检查.json'),JSON.stringify(audit,null,2))
    assertClientVisuals(audit)
  }
  const imageUsage=auditChapterImageUse(draft.chapterId??draft.chapter.id??'chapter',layouts,inputs,options.previousImageUse)
  const imageUsagePath=join(folder,'原图复用检查.json')
  await writeFile(imageUsagePath,JSON.stringify(imageUsage,null,2));assertChapterImageUse(imageUsage)
  const usageLines=[`# ${profile.ordinal}逐页用图清单`,'',`同一原图在当前汇报中最多 ${imageUsage.maxOriginalUses} 次；缩放、裁剪仍累计，同页不得重复。`,'','| 页码 | 图片 | 图注 | 原图累计次数 |','| --- | --- | --- | --- |',...imageUsage.uses.filter(u=>u.chapterId===profile.id).map(u=>{
    const group=imageUsage.originals.find(g=>g.uses.some(v=>v===u))!;return `| ${u.page} | ${inputs.find(a=>a.id===u.id)?.label??u.id} | ${projectChapterCaption(u.caption).caption.replaceAll('|','／')} | ${group.count} |`
  })]
  await writeFile(join(folder,'逐页用图清单.md'),usageLines.join('\n')+'\n')
  const ids=new Set(layouts.flatMap(l=>l.elements.filter(e=>e.type==='figure').map(e=>e.assetId)))
  const assets:ChapterRenderAsset[]=[],assetRecords:unknown[]=[]
  for(const a of inputs.filter(a=>ids.has(a.id))){
    signal.throwIfAborted();const bytes=await readFile(a.path)
    if(digest(bytes)!==a.sha256)throw new Error('CHAPTER_ASSET_CHANGED: '+a.id)
    let pipeline=sharp(bytes).rotate()
    // Remove the uniform background margin of the terrain preview; preserve its source hash.
    if(a.id==='terrain')pipeline=pipeline.trim({threshold:16})
    const {data,info}=await pipeline.resize({width:2400,height:1800,fit:'inside',withoutEnlargement:true}).jpeg({quality:90}).toBuffer({resolveWithObject:true})
    assets.push({...a,width:info.width,height:info.height,dataUrl:'data:image/jpeg;base64,'+data.toString('base64')})
    assetRecords.push({...a,embedded:{width:info.width,height:info.height,sha256:digest(data)},processing:a.id==='terrain'?'uniform-edge-trim; resize; jpeg':'resize; jpeg'})
  }
  const html=renderChapterHtml(draft,layouts,assets),stem=chapterExportStem(draft.projectName,profile.id)
  const htmlPath=join(folder,stem+'.html'),pdfPath=join(folder,stem+'.pdf')
  await writeFile(htmlPath,html)
  const notes=collectChapterNotes(draft,layouts,assets)
  await writeFile(join(folder,profile.ordinal+'_备注与来源.json'),JSON.stringify({pages:notes},null,2))
  await writeFile(join(folder,profile.ordinal+'_原生正文.json'),JSON.stringify(draft,null,2))
  await writeFile(join(folder,'版面与图件.json'),JSON.stringify({layouts,assets:assetRecords,manuscriptHash:hash(draft.chapter)},null,2))
  const browserProfile=await mkdtemp(join(tmpdir(),'dsh-chapter-export-'))
  let child:ReturnType<typeof spawn>|undefined,cdp:Cdp|undefined
  const rows:any[]=[]
  try{
    const endpoint=await new Promise<string>((done,fail)=>{
      child=spawn(resolveBrowserExecutable(),['--headless=new','--edge-skip-compat-layer-relaunch','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0',`--user-data-dir=${browserProfile}`,'about:blank'],{shell:false,windowsHide:true,stdio:['ignore','ignore','pipe']})
      let buffer='';const abort=()=>fail(signal.reason??new Error('CHAPTER_EXPORT_ABORTED'));signal.addEventListener('abort',abort,{once:true})
      child.once('error',fail);child.once('exit',()=>fail(new Error('CHAPTER_BROWSER_EXIT')))
      child.stderr!.on('data',chunk=>{buffer=(buffer+String(chunk)).slice(-8192);const m=/DevTools listening on (ws:\/\/[^\s]+)/.exec(buffer);if(m){signal.removeEventListener('abort',abort);done(m[1]!)}})
    })
    cdp=new Cdp(new WebSocket(endpoint),signal);await cdp.ready
    const target=await cdp.send('Target.createTarget',{url:'about:blank'}),attached=await cdp.send('Target.attachToTarget',{targetId:target.targetId,flatten:true})
    const send=(m:string,p:Record<string,unknown>={})=>cdp!.send(m,p,String(attached.sessionId))
    const evaluate=async(expression:string)=>{signal.throwIfAborted();const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error('CHAPTER_BROWSER_SCRIPT: '+JSON.stringify(r.exceptionDetails));return r.result.value}
    await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:1600,height:954,deviceScaleFactor:1,mobile:false})
    await send('Page.navigate',{url:pathToFileURL(htmlPath).href})
    await evaluate(`new Promise(resolve=>{if(document.readyState==='complete')resolve(true);else addEventListener('load',()=>resolve(true),{once:true})})`)
    await evaluate('window.chapterReady.then(()=>true)')
    for(let i=0;i<draft.chapter.pages.length;i++){
      await evaluate(`(()=>{const s=document.querySelector('#page-select');s.value=${i};s.dispatchEvent(new Event('change'));return new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))})()`)
      const row=await evaluate(`(()=>{
        const p=document.querySelector('.report-page.active'),bounds=p.getBoundingClientRect();
        const outside=(r,b)=>r.left<b.left-1||r.top<b.top-1||r.right>b.right+1||r.bottom>b.bottom+1;
        const overflow=[...p.querySelectorAll('.body p,.claim,h1,.caption,td,th,footer>span,.label,.sequence-label,.sequence-node-title,.sequence-node-detail,.graphic-label')].filter(e=>{if(!e.getClientRects().length)return false;const r=e.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(e);return outside(r,bounds)||outside(range.getBoundingClientRect(),e.closest('.body')?.getBoundingClientRect()??e.closest('.sequence')?.getBoundingClientRect()??r)||e.scrollWidth>e.clientWidth+1}).map(e=>e.textContent);
        const graphicOverflow=[...p.querySelectorAll('svg [data-graphic-label]')].filter(e=>outside(e.getBoundingClientRect(),e.closest('svg').getBoundingClientRect())).map(e=>e.textContent);overflow.push(...graphicOverflow);
        const tableOverflow=[...p.querySelectorAll('.table-wrap table')].filter(e=>outside(e.getBoundingClientRect(),e.parentElement.getBoundingClientRect())).map(e=>e.textContent);overflow.push(...tableOverflow);
        const captions=[...p.querySelectorAll('.caption')].map(e=>{const f=document.getElementById(e.dataset.figureId),r=f.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(e);const t=range.getBoundingClientRect(),align=e.dataset.align;return{text:e.textContent,align,offset:align==='left'?t.left-r.left:align==='right'?t.right-r.right:(t.left+t.right-r.left-r.right)/2,loaded:f.querySelector('img').naturalWidth>0}});
        const collisions=[],blocks=[...p.querySelectorAll('.block,.title-row,.claim,footer')].filter(e=>e.getClientRects().length).map(e=>({e,r:e.getBoundingClientRect()}));
        for(let a=0;a<blocks.length;a++)for(let b=a+1;b<blocks.length;b++){const x=blocks[a],y=blocks[b];if((x.e.dataset.overlayFor&&x.e.dataset.overlayFor===y.e.id)||(y.e.dataset.overlayFor&&y.e.dataset.overlayFor===x.e.id))continue;if(Math.min(x.r.right,y.r.right)-Math.max(x.r.left,y.r.left)>2&&Math.min(x.r.bottom,y.r.bottom)-Math.max(x.r.top,y.r.top)>2)collisions.push([x.e.className,y.e.className])}
        const overlayOcclusions=[],overlays=[...p.querySelectorAll('[data-overlay-for]')].map(e=>{const f=document.getElementById(e.dataset.overlayFor),r=e.getBoundingClientRect(),fr=f.getBoundingClientRect();for(const b of JSON.parse(f.dataset.protectedAreas)){const s=bounds.width/1600,protectedRect={left:bounds.left+b.x*s,top:bounds.top+b.y*s,right:bounds.left+(b.x+b.width)*s,bottom:bounds.top+(b.y+b.height)*s};if(Math.min(r.right,protectedRect.right)>Math.max(r.left,protectedRect.left)+1&&Math.min(r.bottom,protectedRect.bottom)>Math.max(r.top,protectedRect.top)+1)overlayOcclusions.push(e.textContent)}const expected=[e.style.left,e.style.top,e.style.width,e.style.height].map(parseFloat),actual=[e.offsetLeft,e.offsetTop,e.offsetWidth,e.offsetHeight];return{target:e.tagName,rect:{x:e.offsetLeft,y:e.offsetTop,width:e.offsetWidth,height:e.offsetHeight},matchesNativeBounds:expected.every((v,i)=>Number.isFinite(v)&&Math.abs(v-actual[i])<1),insideImage:!outside(r,fr),transparentContainer:getComputedStyle(e).backgroundColor==='rgba(0, 0, 0, 0)'}});
        const title=getComputedStyle(p.querySelector('h1')),folio=getComputedStyle(p.querySelector('.folio'));
        return{annotationAlignment:[...p.querySelectorAll('[data-map-align]')].map(t=>{const r=t.getBoundingClientRect(),s=t.closest('svg').getBoundingClientRect(),a=t.dataset.mapAlign;return a==='left'?r.left-s.left:a==='right'?r.right-s.right:(r.left+r.right-s.left-s.right)/2}),graphics:[...p.querySelectorAll('.graphic-label,svg [data-graphic-label],.label')].map(e=>e.textContent),pageId:p.id,overflow,captions,collisions,overlays,overlayOcclusions,title:p.querySelector('h1').textContent,claim:p.querySelector('.claim').textContent,body:[...p.querySelectorAll('.body p')].map(e=>e.textContent),table:[...p.querySelectorAll('th,td')].map(e=>e.textContent),sequence:[...p.querySelectorAll('.sequence-label,.sequence-node-title,.sequence-node-detail')].map(e=>e.textContent),typographyMetrics:{title:{fontSize:title.fontSize,fontWeight:title.fontWeight,fontFamily:title.fontFamily,color:title.color},folio:{fontSize:folio.fontSize,fontWeight:folio.fontWeight,fontFamily:folio.fontFamily,color:folio.color}},typography:title.fontSize===folio.fontSize&&title.fontWeight===folio.fontWeight&&title.fontFamily===folio.fontFamily,notes:document.querySelector('#note-'+p.id).textContent,bodyRects:[...p.querySelectorAll('.body')].map(e=>({x:e.offsetLeft,y:e.offsetTop,width:e.offsetWidth}))};
      })()`)
      const p=draft.chapter.pages[i]!,table=p.table?[p.table.columns,...p.table.rows].flat():[]
      const sequence=layouts[i]!.elements.filter(e=>e.type==='sequence').flatMap(e=>[e.label,...e.nodes.flatMap((n,j)=>[String(j+1).padStart(2,'0')+n.title,n.detail])]);
      const graphicText=layouts[i]!.elements.flatMap(e=>e.type==='graphic'?[e.label,...planningDiagramText(e.graph)]:e.type==='label'?[e.text]:e.type==='figure'&&e.annotations?e.annotations.markers.map(m=>m.label):[])
      const normalized=(v:string[])=>JSON.stringify(v.map(t=>t.replace(/\s/g,'')).sort())
      row.exactGraphics=normalized(row.graphics)===normalized(graphicText)
      row.exactSequence=JSON.stringify(row.sequence)===JSON.stringify(sequence)
      row.exactCopy=row.title===p.title&&row.claim===p.claim&&JSON.stringify(row.body)===JSON.stringify(p.body)&&JSON.stringify(row.table)===JSON.stringify(table)
      row.notesComplete=notes[i]!.notes.every(n=>row.notes.includes(n));delete row.notes
      row.processLanguage=CHAPTER_PROCESS_LANGUAGE.test([row.title,row.claim,...row.body,...row.table,...row.sequence,...row.graphics,...row.captions.map((c:any)=>c.text)].join(' '))
      const capture=await send('Page.captureScreenshot',{format:'png',clip:{x:0,y:0,width:1600,height:900,scale:1}})
      row.screenshot=join(qa,`page-${String(i+1).padStart(2,'0')}.png`);await writeFile(row.screenshot,Buffer.from(capture.data,'base64'));rows.push(row)
    }
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}));document.querySelector('#notes-button').click()`)
    const notesOpen=await evaluate('document.querySelector("#notes").open');await evaluate('document.querySelector("#close-notes").click()')
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))`)
    const navigation=await evaluate('document.querySelector("#page-select").value')===String(Math.min(1,rows.length-1))
    const sixth=profile.id==='opportunity'?rows[5]?.bodyRects:undefined,aligned=!sixth||new Set(sixth.map((b:any)=>b.y)).size===1&&new Set(sixth.map((b:any)=>b.width)).size===1
    const alignedBodyGroups=rows.every((r,i)=>!['triptych','pair-bottom','table-main','table-bottom'].includes(layouts[i]!.name)||new Set(r.bodyRects.map((b:any)=>b.y)).size===1&&new Set(r.bodyRects.map((b:any)=>b.width)).size===1)
    const pass=imageUsage.pass&&notesOpen&&navigation&&aligned&&alignedBodyGroups&&rows.every(r=>r.exactCopy&&r.exactSequence&&r.exactGraphics&&r.annotationAlignment.every((offset:number)=>Math.abs(offset)<1)&&r.notesComplete&&r.typography&&!r.processLanguage&&!r.overflow.length&&!r.collisions.length&&!r.overlayOcclusions.length&&r.overlays.every((o:any)=>o.insideImage&&o.transparentContainer&&o.matchesNativeBounds)&&r.captions.every((c:any)=>c.loaded&&Math.abs(c.offset)<1))
    await writeFile(join(qa,'显示核验.json'),JSON.stringify({pass,scope:'technical-only',visualReviewRequired:true,notesOpen,navigation,sixthPageAligned:aligned,alignedBodyGroups,pages:rows},null,2))
    const tiles=await Promise.all(rows.map(r=>sharp(r.screenshot).resize(640,360).toBuffer()))
    await sharp({create:{width:1320,height:Math.ceil(rows.length/2)*390+20,channels:3,background:'#e6e8df'}}).composite(tiles.map((input,i)=>({input,left:10+i%2*650,top:10+Math.floor(i/2)*390}))).png().toFile(join(qa,'全章缩略图.png'))
    if(!pass)throw new Error('CHAPTER_VISUAL_CHECK: '+join(qa,'显示核验.json'))
    const printed=await send('Page.printToPDF',{printBackground:true,preferCSSPageSize:true,displayHeaderFooter:false})
    const pdf=await PDFDocument.load(Buffer.from(printed.data,'base64'))
    if(pdf.getPageCount()!==draft.chapter.pages.length)throw new Error('CHAPTER_PDF_PAGE_COUNT')
    for(const [i,page] of pdf.getPages().entries()){
      const text=notes[i]!.title+'\n\n'+notes[i]!.notes.join('\n\n')
      const annotation=pdf.context.obj({Type:'Annot',Subtype:'Text',Rect:[page.getWidth()-18,page.getHeight()-18,page.getWidth()-6,page.getHeight()-6],
        Contents:PDFHexString.fromText(text),T:PDFHexString.fromText('来源、说明与人工确认事项'),Name:'Comment',F:0,Open:false})
      page.node.addAnnot(pdf.context.register(annotation))
    }
    pdf.setTitle(draft.chapter.title);pdf.setSubject('DSH原生章节汇报；备注见各页批注');pdf.setProducer('DSH Preplanning Chapter Production')
    pdf.catalog.set(PDFName.of('Lang'),PDFHexString.fromText('zh-CN'))
    await writeFile(pdfPath,await pdf.save())
    const result={htmlPath,pdfPath,pageCount:rows.length,manuscriptHash:hash(draft.chapter),htmlSha256:digest(await readFile(htmlPath)),pdfSha256:digest(await readFile(pdfPath)),browserQa:join(qa,'显示核验.json'),imageUsagePath,renderVersion:CHAPTER_RENDER_VERSION,producer:'DSH native plugin',userReview:'pending'}
    await writeFile(join(folder,'导出记录.json'),JSON.stringify(result,null,2));return result
  }finally{
    cdp?.close();if(child&&child.exitCode===null){child.kill();await new Promise<void>(done=>{const t=setTimeout(done,3000);child!.once('exit',()=>{clearTimeout(t);done()})})}
    await rm(browserProfile,{recursive:true,force:true,maxRetries:3,retryDelay:100}).catch(()=>{})
  }
}
