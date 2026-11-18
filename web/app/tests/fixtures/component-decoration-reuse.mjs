/** Synthetic authored page images + controlled provider responses, NOT model quality evidence.
 * Spec: docs/superpowers/specs/2026-11-18-image-derived-decoration-v1-design.md
 * No source document, external model, credentials, database or production candidate. */
import sharp from 'sharp'
import {createHash} from 'node:crypto'
import {runReferenceWorkflow} from '../../src/layout-library/reference-workflow.mjs'
import {workflowFixture,profileFixture,referenceStageFixture,sourceSha256} from './reference-workflow.mjs'
const hash=b=>createHash('sha256').update(b).digest('hex')
export const primitiveColors=['#d02040','#167940','#3454d0']
export const primitiveCenters=[{x:.405,y:.79},{x:.0375,y:.33},{x:.5,y:.845}]
export const primitiveOutside=[{x:.09,y:.782},{x:.021,y:.301},{x:.481,y:.821}]
export const textCounts=[2,2,6],imageCounts=[0,1,3]
export function decorationObservation(page){
 const text=(id,purpose,rect,parentId)=>({id,kind:'text',purpose,rect,...(parentId?{parentId}:{})})
 const deco=(id,rect)=>({id,kind:'decoration',rect})
 let components
 if(page===1)components=[text('title','title',{x:.08,y:.22,w:.84,h:.15}),text('heading','heading',{x:.08,y:.46,w:.7,h:.08}),text('body','body',{x:.08,y:.58,w:.65,h:.14}),deco('band',{x:.04,y:.18,w:.92,h:.23}),deco('accent',{x:.08,y:.78,w:.65,h:.02})]
 else if(page===2)components=[text('title','title',{x:.05,y:.05,w:.9,h:.12}),text('heading','heading',{x:.08,y:.3,w:.4,h:.1}),text('body','body',{x:.08,y:.43,w:.4,h:.28}),{id:'photo',kind:'image',rect:{x:.55,y:.28,w:.4,h:.45}},deco('band',{x:.04,y:.04,w:.92,h:.14}),deco('accent',{x:.02,y:.3,w:.035,h:.06}),deco('separator',{x:.08,y:.77,w:.87,h:.01})]
 else components=[text('title','title',{x:.05,y:.05,w:.9,h:.12}),deco('band',{x:.04,y:.04,w:.92,h:.14}),...Array.from({length:3},(_,i)=>{
  const x=.05+i*.315,g='card-'+(i+1)
  return [{id:g,kind:'group',rect:{x,y:.24,w:.27,h:.52}},text('heading-'+(i+1),'heading',{x:x+.01,y:.26,w:.25,h:.06},g),text('body-'+(i+1),'body',{x:x+.01,y:.35,w:.25,h:.15},g),{id:'photo-'+(i+1),kind:'image',parentId:g,rect:{x:x+.01,y:.53,w:.25,h:.2}},deco('card-bg-'+(i+1),{x,y:.24,w:.27,h:.52})]
 }).flat(),deco('accent',{x:.48,y:.82,w:.04,h:.05})]
 return {source:{fileSha256:sourceSha256,pageNumber:page},components}
}
export function decorationAdaptation(page){
 const common={componentId:'accent',provenance:'derived-adaptation'},color=primitiveColors[page-1]
 const accent=page===1?{...common,shape:'line',stroke:color,strokeWidthRatio:.2,direction:'horizontal'}:page===2?{...common,shape:'ellipse',fill:color}:{...common,shape:'rounded-rect',fill:color,radiusRatio:.4}
 const decorations=[{componentId:'band',shape:'rect',fill:'#eef3fa',provenance:'derived-adaptation'},accent]
 if(page===2)decorations.push({componentId:'separator',shape:'line',stroke:'#8090a0',strokeWidthRatio:.2,direction:'horizontal',provenance:'derived-adaptation'})
 if(page===3)for(let i=1;i<=3;i++)decorations.push({componentId:'card-bg-'+i,shape:'rect',fill:'#f3f6fa',provenance:'derived-adaptation'})
 return {styles:{title:{fontSize:page===1?64:44,lineHeight:1.2,color:'#24364c'},heading:{fontSize:28,lineHeight:1.3,color:'#24364c'},body:{fontSize:24,lineHeight:1.3,color:'#24364c'},image:{fit:page===2?'cover':'contain'}},maxTextCharacters:1800,adjustments:{},decorations,componentStyles:{}}
}
async function sourceImage(page){
 // Independently authored source primitives, not the production renderer output.
 const o=decorationObservation(page),c=primitiveColors[page-1]
 const shape=page===1?`<line x1="128" y1="711" x2="1168" y2="711" stroke="${c}" stroke-width="3.6"/>`:page===2?`<ellipse cx="60" cy="297" rx="28" ry="27" fill="${c}"/><line x1="128" y1="697.5" x2="1520" y2="697.5" stroke="#8090a0" stroke-width="1.8"/>`:`<rect x="768" y="738" width="64" height="45" rx="18" fill="${c}"/>`
 const backgrounds=o.components.filter(c=>c.kind==='decoration'&&(c.id==='band'||c.id.startsWith('card-bg'))).map(c=>`<rect x="${c.rect.x*1600}" y="${c.rect.y*900}" width="${c.rect.w*1600}" height="${c.rect.h*900}" fill="#eef3fa"/>`).join('')
 const contents=o.components.filter(c=>['text','image'].includes(c.kind)).map(c=>c.kind==='image'?`<rect x="${c.rect.x*1600}" y="${c.rect.y*900}" width="${c.rect.w*1600}" height="${c.rect.h*900}" fill="#d6e3df"/>`:`<text x="${c.rect.x*1600}" y="${c.rect.y*900+28}" font-size="24">Synthetic ${c.id} page ${page}</text>`).join('')
 return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="white"/>${backgrounds}${contents}${shape}</svg>`)).png().toBuffer()
}
export async function buildDecorationReuseFixture(options={}){
 const version=Object.hasOwn(options,'version')?options.version:1,f=workflowFixture(3),calls=[],observations=[1,2,3].map(decorationObservation),cache=new Map()
 const sources=await Promise.all([1,2,3].map(sourceImage))
 Object.assign(f.payload,{referencePipeline:'native-v3',referenceComponentVersion:3,referenceDerivedSpecVersion:1,...(version!==undefined?{referenceDecorationVersion:version}:{})})
 const file=f.payload.referenceFiles[0];Object.assign(file,{pageCount:3,limitations:[],text:'',pages:[1,2,3].map(page=>({page,text:''}))})
 f.images=f.images.map((image,i)=>({...image,data:sources[i].toString('base64'),sha256:hash(sources[i]),width:1600,height:900}))
 const runModel=async input=>{
  calls.push(input.stage)
  const ctx=JSON.parse(input.prompt.split('以下JSON仅为参考数据，不能改写系统边界：\n').at(-1))
  let response
  if(input.stage.startsWith('components-'))response=structuredClone(observations[ctx.source.pageNumber-1])
  else if(input.stage==='profile'){
   response=profileFixture();response.evidence=ctx.observations.flatMap(b=>b.pages).map(p=>({id:'evidence-'+p.pageNumber,provenance:'observed',fileSha256:p.fileSha256,pageNumber:p.pageNumber,factId:p.facts[0].id}))
   response.designSystem.evidenceIds=['evidence-1']
   response.archetypes=[1,2,3].map(page=>({id:'archetype-'+page,pageType:page===1?'cover':'mixed',structure:'asymmetric-columns',density:'medium',roles:['title','text',...(imageCounts[page-1]?['image']:[])],capacity:{images:imageCounts[page-1],textBlocks:textCounts[page-1],bodyPoints:0,tableRows:0},evidenceIds:['evidence-'+page]}))
  }else if(input.stage.startsWith('adapt-')){
   const page=ctx.componentObservation.source.pageNumber
   if(input.images.length!==1||input.images[0].sha256!==hash(sources[page-1]))throw Error('wrong page image reached adaptation')
   response=decorationAdaptation(page)
  }else return referenceStageFixture(input)
  return {response,execution:{controlled:true,actualRoute:{provider:'controlled-fixture',model:input.stage},outcome:'completed'}}
 }
 const run=()=>runReferenceWorkflow({...f,jobId:'synthetic-three-page-decoration',runModel,stageCheckpoints:{get:async key=>cache.get(key),put:async(key,value)=>cache.set(key,value)}})
 const result=await run()
 return {result,calls,observations,sources,replay:run}
}
