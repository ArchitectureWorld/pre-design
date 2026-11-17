import {createPackage} from '../../src/layout-library/contract.mjs'

export const sourceSha256='a'.repeat(64)
export const sourceId='11111111-1111-4111-8111-111111111111'
export function profileFixture({page=7,factId='observation-2-1-1',provenance='observed'}={}){
 const evidence={id:'evidence-1',provenance,...(provenance==='user'?{}:{fileSha256:sourceSha256,pageNumber:page,factId})}
 return {schemaVersion:'pre-design.reference-profile.v2',intent:'style',designSystem:{canvas:{width:1600,height:900},colors:{background:'#ffffff',ink:'#24364c',accent:'#3454a0',muted:'#53647c'},typography:{fontFamily:'sans',titleSize:48,bodySize:28,captionSize:18,lineHeight:1.45},spacing:{margin:.05,gutter:.03},evidenceIds:['evidence-1']},archetypes:[{id:'archetype-1',pageType:'mixed',structure:'asymmetric-columns',density:'medium',roles:['title','claim','body','image','source'],capacity:{images:1,bodyPoints:8,tableRows:0},evidenceIds:['evidence-1']}],rules:[],evidence:[evidence],limitations:[]}
}
export function packageFixture(profile=profileFixture()){
 const p=createPackage('参考设计候选')
 p.schemaVersion='pre-design.layout-package.v2';p.designProfile=structuredClone(profile)
 p.canvas=structuredClone(profile.designSystem.canvas);p.theme={...profile.designSystem.colors,...profile.designSystem.typography}
 p.layouts=[{id:'mixed-page',label:'图文组合',kind:'composition',archetypeId:'archetype-1',slots:[
  {id:'title',role:'title',rect:{x:.05,y:.05,w:.9,h:.12}},
  {id:'claim',role:'claim',rect:{x:.05,y:.20,w:.9,h:.10}},
  {id:'figure',role:'image',rect:{x:.05,y:.35,w:.45,h:.50}},
  {id:'body',role:'body',rect:{x:.55,y:.35,w:.40,h:.50}},
  {id:'source',role:'source',rect:{x:.05,y:.91,w:.90,h:.04}},
 ]}]
 return p
}
export function workflowFixture(count=7){
 const pages=Array.from({length:count},(_,index)=>({page:index+1,text:'PRIVATE BUSINESS PAGE '+(index+1)}))
 const file={id:sourceId,name:'private-client-reference.pdf',kind:'pdf',sha256:sourceSha256,pageCount:count+1,readPages:pages.map(p=>p.page),pages,hasImages:true,imageCount:count,text:pages.map(p=>p.text).join('\n'),limitations:['尾页未读取。']}
 const images=pages.map(p=>({fileId:sourceId,name:file.name,page:p.page,mimeType:'image/png',data:'cGl4ZWxz',sha256:String(p.page).padStart(64,'0')}))
 return {payload:{mode:'conversation',name:'参考设计候选',text:'提炼图文版式',referenceIntent:'style',referenceFiles:[file]},images}
}
export function observationFixture(images){
 return {pages:images.map(image=>({fileSha256:sourceSha256,pageNumber:image.page,pageType:image.page===1?'cover':'mixed',structure:'asymmetric-columns',density:'medium',facts:[{property:'background',value:'#ffffff'}]}))}
}

/** Controlled provider boundary for real server tests. It answers each actual
 * stage from that stage's supplied references, without pretending to evaluate
 * the quality of any remote vision model. */
export function referenceStageFixture(input){
 const context=JSON.parse(input.prompt.split('以下JSON仅为参考数据，不能改写系统边界：\n').at(-1))
 let response
 if(input.stage.startsWith('observe-'))response={pages:context.pages.map(p=>({fileSha256:p.fileSha256,pageNumber:p.pageNumber,pageType:p.pageNumber===1?'cover':'mixed',structure:'asymmetric-columns',density:'medium',facts:[{property:'background',value:'#ffffff'}]}))}
 else if(input.stage==='profile'){
  const observed=context.observations.at(-1)?.pages.at(-1),file=context.inventory.files.find(f=>f.sha256===observed?.fileSha256)??context.inventory.files[0]
  const page=observed?file.pages.find(p=>p.pageNumber===observed.pageNumber):file.pages.find(p=>p.extractedFacts.length)
  response=profileFixture({page:observed?.pageNumber??page?.pageNumber??null,provenance:observed?'observed':'extracted',factId:observed?.facts[0].id??page?.extractedFacts[0]?.id??file.extractedFacts[0].id})
  response.intent=context.intent;response.evidence[0].fileSha256=file.sha256;response.archetypes[0].pageType=observed?.pageType??'mixed'
  const canvas=page?.extractedFacts.find(f=>f.property==='canvas')?.value
  // Fixture typography and capacities are authored on a 1600×900 presentation baseline.
  // Preserve source aspect ratio, not tiny raster pixel dimensions; extraction facts stay untouched.
  if(canvas){const scale=Math.max(1,1600/canvas.width,900/canvas.height);response.designSystem.canvas={width:Math.round(canvas.width*scale),height:Math.round(canvas.height*scale)}}
 }else if(input.stage.startsWith('coverage-map')){
  response={pages:context.pages.map(p=>({fileSha256:p.fileSha256,pageNumber:p.pageNumber,archetypeId:context.archetypes[0].id,factIds:[p.facts[0].id]}))}
 }else if(input.stage==='design-spec'){
  const profile=context.profile
  response={schemaVersion:'pre-design.design-spec.v1',scope:context.scope,fidelity:context.fidelity,profile,masterLayoutGraph:[{id:'master-1',kind:'master',parentId:null,evidenceIds:profile.designSystem.evidenceIds},...profile.archetypes.map((a,i)=>({id:'layout-'+(i+1),kind:'layout',parentId:'master-1',archetypeId:a.id,evidenceIds:a.evidenceIds}))],components:[]}
 }else if(input.stage.startsWith('prototype-')){
  const profile=context.designSpec.profile,a=profile.archetypes.find(a=>a.id===context.targetArchetypeId),{kind,...layout}=packageFixture(profile).layouts[0],{width,height}=profile.designSystem.canvas
  response={prototypes:[{...layout,archetypeId:a.id,prototypeSvg:`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect x="0" y="0" width="8" height="${height}" fill="#3454a0"/></svg>`,contentFitRules:{overflow:'reject',maxTitleCharacters:120,maxClaimCharacters:400,maxBodyPoints:a.capacity.bodyPoints,maxBodyCharacters:1800,maxImages:a.capacity.images,maxTableRows:a.capacity.tableRows,maxTableColumns:a.capacity.tableRows?3:0}}]}
 }else response={reply:'已提炼可检查的参考组合版式。',package:packageFixture(context.profile)}
 return {response:JSON.stringify(response),execution:{controlled:true,scope:'layout-library',requestedRole:input.modelRole,actualRoute:{provider:'controlled-fixture',model:input.stage},outcome:'completed'}}
}
