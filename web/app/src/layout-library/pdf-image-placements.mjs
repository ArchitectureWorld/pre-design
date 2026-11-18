/** Private drawing-occurrence evidence, not a visible-pixel or asset-rights inventory. */
import { createHash } from 'node:crypto'
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
const fail=(code)=>Object.assign(new Error(code),{code})
const bounded=(v,lo,hi)=>Number.isInteger(v)&&v>=lo&&v<=hi
const hash=b=>createHash('sha256').update(b).digest('hex')
export async function extractPdfImagePlacements({bytes,sourceSha256,selectedPages,signal,timeoutMs=30000,maxBytes=100*1024*1024,maxOperators=100000,maxOccurrences=1024}={}) {
 signal?.throwIfAborted()
 if(!bounded(timeoutMs,1,30000)||!bounded(maxBytes,1,100*1024*1024)||!bounded(maxOperators,1,100000)||!bounded(maxOccurrences,1,1024)||!(bytes instanceof Uint8Array)||bytes.length>maxBytes||!bytes.length||!/^[a-f0-9]{64}$/.test(sourceSha256??'')||hash(bytes)!==sourceSha256||!Array.isArray(selectedPages)||selectedPages.length<1||selectedPages.length>6||new Set(selectedPages).size!==selectedPages.length||selectedPages.some(p=>!bounded(p,1,100000)))throw fail('PDF_PLACEMENTS_INPUT')
 const copy=Uint8Array.from(bytes)
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL(import.meta.url),{workerData:{kind:'pdf-image-placements-v1',bytes:copy,sourceSha256,selectedPages,maxOperators,maxOccurrences},transferList:[copy.buffer],resourceLimits:{maxOldGenerationSizeMb:256}})
  let done=false
  const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);void worker.terminate().then(()=>error?reject(error):resolve(value),()=>reject(fail('PDF_PLACEMENTS_WORKER')))}
  const abort=()=>finish(signal.reason??fail('PDF_PLACEMENTS_CANCELLED'))
  const timer=setTimeout(()=>finish(fail('PDF_PLACEMENTS_TIMEOUT')),timeoutMs)
  worker.once('message',r=>r.error?finish(fail(r.error)):finish(null,r.result))
  worker.once('error',()=>finish(fail('PDF_PLACEMENTS_WORKER')))
  worker.once('exit',()=>{if(!done)finish(fail('PDF_PLACEMENTS_WORKER'))})
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort()
 })
}
const matrix=m=>{if(!(Array.isArray(m)||m instanceof Float32Array||m instanceof Float64Array)||m.length!==6||m.some(x=>!Number.isFinite(x)||Math.abs(x)>1e9))throw fail('PDF_PLACEMENTS_GEOMETRY');return Array.from(m)}
const mul=(a,b)=>matrix([a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]])
async function extract(input){
 const {getDocument,OPS,PermissionFlag}=await import('pdfjs-dist/legacy/build/pdf.mjs')
 const task=getDocument({data:input.bytes,verbosity:0,isEvalSupported:false,useSystemFonts:false,disableFontFace:true,useWorkerFetch:false,stopAtErrors:true,maxImageSize:16000000})
 try {
  const doc=await task.promise,permissions=await doc.getPermissions(),pages=[];
  if(permissions===null){
   const metadata=await doc.getMetadata()
   if(metadata?.info?.EncryptFilterName!==null)throw fail('PDF_PLACEMENTS_COPY_RESTRICTED')
  }else if(!(permissions instanceof Set)||!permissions.has(PermissionFlag.COPY))throw fail('PDF_PLACEMENTS_COPY_RESTRICTED')
  let operators=0,count=0
  for(const pageNumber of input.selectedPages){
   if(pageNumber>doc.numPages)throw fail('PDF_PLACEMENTS_PAGE')
   const page=await doc.getPage(pageNumber),viewport=page.getViewport({scale:1}),list=await page.getOperatorList()
   operators+=list.fnArray.length;if(operators>input.maxOperators)throw fail('PDF_PLACEMENTS_LIMIT')
   const {width,height}=viewport;if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0||width>1e7||height>1e7)throw fail('PDF_PLACEMENTS_GEOMETRY')
   let state={ctm:matrix(viewport.transform),clip:false,uncertainties:[]};const stack=[],occurrences=[]
   const save=()=>{if(stack.length>=256)throw fail('PDF_PLACEMENTS_LIMIT');stack.push({...state,ctm:[...state.ctm],uncertainties:[...state.uncertainties]})}
   const restore=()=>{if(!stack.length)throw fail('PDF_PLACEMENTS_STATE');state=stack.pop()}
   const draw=(identity,extra)=>{
    if(++count>input.maxOccurrences)throw fail('PDF_PLACEMENTS_LIMIT')
    const m=extra?mul(state.ctm,matrix(extra)):state.ctm
    const quad=[[0,0],[1,0],[1,1],[0,1]].map(([x,y])=>({x:(m[0]*x+m[2]*y+m[4])/width,y:(m[1]*x+m[3]*y+m[5])/height}))
    const xs=quad.map(p=>p.x),ys=quad.map(p=>p.y),x=Math.min(...xs),y=Math.min(...ys),w=Math.max(...xs)-x,h=Math.max(...ys)-y
    if(![x,y,w,h].every(Number.isFinite)||w<=0||h<=0)throw fail('PDF_PLACEMENTS_GEOMETRY')
    occurrences.push({id:`p${pageNumber}-draw${occurrences.length+1}`,referenceKey:typeof identity==='string'?hash(`${input.sourceSha256}:${identity}`):null,referenceKind:typeof identity==='string'?'pdfjs-decoded-object-id':'unknown-inline',transform:[...m],quad,bounds:{x,y,w,h},clipStatus:state.clip?'unknown':'page-boundary-only',uncertainties:[...new Set([...state.uncertainties,...(state.clip?['clipping']:[])])],visiblePixels:'unknown'})
   }
   for(let i=0;i<list.fnArray.length;i++){
    const op=list.fnArray[i],a=list.argsArray[i]??[]
    if(op===OPS.save)save()
    else if(op===OPS.restore)restore()
    else if(op===OPS.transform)state.ctm=mul(state.ctm,matrix(a))
    else if(op===OPS.clip||op===OPS.eoClip||(op===OPS.setTextRenderingMode&&a[0]>=4))state.clip=true
    else if(op===OPS.beginAnnotation||op===OPS.endAnnotation)throw fail('PDF_PLACEMENTS_UNSUPPORTED_ANNOTATION')
    else if(op===OPS.paintFormXObjectBegin){save();if(a[0])state.ctm=mul(state.ctm,matrix(a[0]));if(a[1])state.clip=true}
    else if(op===OPS.paintFormXObjectEnd)restore()
    else if(op===OPS.beginGroup||op===OPS.endGroup||op===OPS.paintImageMaskXObject||op===OPS.paintImageMaskXObjectGroup||op===OPS.paintImageMaskXObjectRepeat||op===OPS.paintSolidColorImageMask)throw fail('PDF_PLACEMENTS_UNSUPPORTED_GROUP_OR_MASK')
    else if(op===OPS.setGState)state.uncertainties=[...new Set([...state.uncertainties,'graphics-state-compositing'])]
    else if(op===OPS.beginMarkedContentProps)state.uncertainties=[...new Set([...state.uncertainties,'marked-content-visibility'])]
    else if(op===OPS.paintImageXObject)draw(a[0])
    else if(op===OPS.paintInlineImageXObject)draw(null)
    else if(op===OPS.paintImageXObjectRepeat){const [id,sx,sy,positions]=a;if(!positions||positions.length%2||positions.length>input.maxOccurrences*2)throw fail('PDF_PLACEMENTS_LIMIT');for(let j=0;j<positions.length;j+=2)draw(id,[sx,0,0,sy,positions[j],positions[j+1]])}
    else if(op===OPS.paintInlineImageXObjectGroup){if(!Array.isArray(a[1])||a[1].length>input.maxOccurrences)throw fail('PDF_PLACEMENTS_LIMIT');for(const entry of a[1])draw(null,entry.transform)}
   }
   if(stack.length)throw fail('PDF_PLACEMENTS_STATE')
   pages.push({page:pageNumber,width,height,rotation:viewport.rotation,occurrences});page.cleanup()
  }
  return {version:'pre-design.pdf-image-placements.v1',copyPermission:'verified',sourceSha256:input.sourceSha256,shareAllowed:false,selectionStatus:'requires-inspection',evidenceKind:'native-image-placement',coverage:'operator-list-only',limitations:['Not a visible-pixel inventory; clipping, occlusion and compositing are not resolved.','PDF.js may omit oversized or unsupported images; occurrence count is not proof of complete page coverage.','Reference keys identify decoded objects, not original PDF xref numbers.','No asset selection, editability or sharing permission is inferred.'],pages}
 }finally{await task.destroy()}
}
if(!isMainThread&&workerData?.kind==='pdf-image-placements-v1')extract(workerData).then(result=>parentPort.postMessage({result}),error=>parentPort.postMessage({error:/^PDF_PLACEMENTS_[A-Z_]+$/.test(error?.code??'')?error.code:'PDF_PLACEMENTS_PARSE'}))
