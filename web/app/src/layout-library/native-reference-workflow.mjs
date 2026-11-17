import {summarizeDesignFacts} from './reference-design-summary.mjs'
import {z} from 'zod'
import {packageDigest,fail} from './contract.mjs'
import {validateDesignSpec} from './design-spec.mjs'
import {nativeLayoutSchema} from './native-design-v3.mjs'
import {compileNativeDesignPackageV3} from './native-design-compiler.mjs'
import {sanitizePrototypeSvg} from './svg-prototype.mjs'
import {runPptMasterQualityCheck} from './ppt-master-quality.mjs'
const inputLimit=200000
const bounded=input=>{if(JSON.stringify(input).length>inputLimit)throw fail('原生参考设计输入超过阶段上限，请减少本轮参考页。',413,'NATIVE_DESIGN_INPUT_LIMIT');return input}
export const nativeStageContracts={
 'design-spec':'输出严格 pre-design.design-spec.v1 JSON，schemaVersion、scope(brand|style|layout|deck)、fidelity(standard|fidelity)、profile(必须原样复制已验证Profile)、masterLayoutGraph、components。masterLayoutGraph节点{id:master-N|layout-N|slide-N,kind:master|layout|slide,parentId:null或上级ID,archetypeId?:Profile原型ID,evidenceIds:[真实证据ID]}；master无父，layout父master且必须有archetypeId，slide父layout。覆盖全部Profile原型。components为{id:component-N,kind:decoration|content-slot,role?:title|claim|body|image|table|chart|timeline|diagram|source,style?:受限组合槽位style,evidenceIds}。仅content-slot有role。输入含源原生继承图时据其提炼，照片/PDF没有原生图时明确作为基于Profile证据的设计结构推导，不冒称源文件提取。不得原文、路径、文件名、图片、自由文案、业务数据、任意字段。',
 prototype:'仅输出 {"prototypes":[...]}。每项{id:小写ID,label:简短设计标签,archetypeId:已验证原型ID,slots:完整受限composition槽位,prototypeSvg:完整装饰SVG,contentFitRules:{overflow:"reject",maxTitleCharacters:整数,maxClaimCharacters:整数,maxBodyPoints:整数,maxBodyCharacters:整数,maxImages:整数,maxTableRows:整数,maxTableColumns:整数}}。不输出kind，不输出资源包或检查收执。仅返回本阶段targetArchetypeId的原型实现，全部角色和容量必须实现。以真实参考页图、Design Spec、源SVG的设计几何为依据，不套五种默认布局。SVG只含装饰性几何，可用svg/g/defs/path/rect/circle/ellipse/line/polygon/polyline/linearGradient/radialGradient/stop/clipPath，白名单几何属性；画布与Design Spec一致。禁止text/title/desc/image/use/style/script/foreignObject/事件/外链/实体/HTML及原件文字和图片。原件文字、图表、照片必须改为可编辑内容槽，不能绘成路径伪装成装饰。所有slots role只来自Profile，rect为归一化坐标，id唯一。图表等以项目真实结构数据渲染。style受限为字号、色彩、对齐、内边距等既有属性，不含CSS字符串。超量时明确拒绝，不裁剪；contentFitRules不可高于Profile容量。必须按实际HTML排版计算槽位容量，不能把PDF中文字墨迹的紧边界当成可编辑文本框。title行高1.2，其他文本使用designSystem.typography.lineHeight；实际宽高为rect.w*canvas.width与rect.h*canvas.height，内边距和边框均扣两侧。正文项目符号占1.3em宽，条目之间有0.45em间距，中文每字保守按1em，长文本必须预留换行高度及字体行盒余量。对每个槽位验证声明的字符数/条数在该宽高内可读容纳。保持参考布局关系与设计节奏，但style意图允许扩大文字框、适当减小至可读字号；structure意图不可偷偷改区域，无法容纳时明确失败。',
}
export function prototypeSlotContract(archetype){return archetype.roles.includes('image')?{contentSlotJsonSchema:z.toJSONSchema(nativeLayoutSchema.shape.slots.element)}:{}}
async function prototypeSources(bundle,wanted,loadArtifact,signal,maxCharacters=inputLimit){
 const sources=[],omitted=[]
 for(const source of bundle.sources){
  for(const artifact of source.native?.artifacts??[]){
   const match=/^svg-flat\/slide_(\d+)\.svg$/.exec(artifact.path)
   if(!match||artifact.availability!=='private-upload'||!wanted.has(source.sha256+':'+Number(match[1])))continue
   signal?.throwIfAborted()
   const identity={sourceSha256:source.sha256,pageNumber:Number(match[1]),artifactSha256:artifact.sha256}
   if(artifact.bytes>maxCharacters){omitted.push({...identity,reason:'stage-input-budget'});continue}
   if(!loadArtifact)throw fail('本轮缺少私有原生产物读取器。',409,'REFERENCE_ARTIFACT_UNAVAILABLE')
   const result=await loadArtifact(artifact.reference)
   if(result.sha256!==artifact.sha256||result.data?.length!==artifact.bytes)throw fail('原生产物与已核验来源不一致。',409,'REFERENCE_ARTIFACT_CHANGED')
   // The source SVG is private model input, NEVER rendered or copied verbatim.
   const candidate={...identity,svg:new TextDecoder('utf-8',{fatal:true}).decode(result.data)}
   if(JSON.stringify([...sources,candidate]).length>maxCharacters)omitted.push({...identity,reason:'stage-input-budget'})
   else sources.push(candidate)
  }
 }
 return {sources,omitted}
}
export async function runNativeReferenceStages({analysis,payload,stage,localStage,loadArtifact,signal,images=[]}){
 const context={inventory:analysis.inventory,observations:analysis.observations}
 const specInput=bounded({profile:analysis.profile,scope:payload.referenceScope??'deck',fidelity:payload.referenceFidelity??'standard',nativeSources:analysis.referenceBundle.sources.map(s=>({sha256:s.sha256,coverage:s.coverage,masterLayoutGraph:s.native?.masterLayoutGraph??null})),request:payload.text})
 analysis.designSpec=await stage('design-spec',specInput,[],raw=>{
  const value=validateDesignSpec(raw,context)
  if(packageDigest(value.profile)!==analysis.profileHash)throw fail('Design Spec 改写了已验证的来源Profile。',409,'REFERENCE_PROFILE_CHANGED')
  if(value.scope!==specInput.scope||value.fidelity!==specInput.fidelity)throw fail('Design Spec 改变了本轮设计范围或保真级别。',409,'DESIGN_SPEC_INVALID')
  return value
 })
 analysis.prototypes=[];analysis.prototypeSources=[]
 for(const [index,archetype] of analysis.profile.archetypes.entries()){
  const evidence=new Map(analysis.profile.evidence.map(e=>[e.id,e])),keys=new Set(),visited=new Set()
  const visit=id=>{if(visited.has(id))return;visited.add(id);const e=evidence.get(id);if(e.fileSha256&&e.pageNumber)keys.add(e.fileSha256+':'+e.pageNumber);for(const dependency of e.dependsOn??[])visit(dependency)}
  archetype.evidenceIds.forEach(visit)
  const mappedPages=(analysis.coverageMap?.pages??[]).filter(page=>page.archetypeId===archetype.id)
  for(const page of mappedPages)keys.add(page.fileSha256+':'+page.pageNumber)
  const sourceOrder=new Map(analysis.inventory.files.map((file,index)=>[file.sha256,index]))
  const compare=(a,b)=>sourceOrder.get(a.fileSha256)-sourceOrder.get(b.fileSha256)||a.pageNumber-b.pageNumber
  const allEvidencePages=[...keys].map(key=>{const [fileSha256,page]=key.split(':');return {fileSha256,pageNumber:Number(page)}}).sort(compare)
  let observedDesignPages=analysis.observations.flatMap(batch=>batch.pages).filter(page=>keys.has(page.fileSha256+':'+page.pageNumber))
  const observed=new Set(observedDesignPages.map(page=>page.fileSha256+':'+page.pageNumber)),seen=new Set()
  const candidates=images.map(image=>{const file=analysis.inventory.files.find(f=>image.fileId?f.id===image.fileId:f.name===image.name);return {image,fileSha256:file?.sha256,pageNumber:image.page??1}})
   .filter(page=>keys.has(page.fileSha256+':'+page.pageNumber)).sort(compare).filter(page=>{const key=page.fileSha256+':'+page.pageNumber;if(seen.has(key))return false;seen.add(key);return true})
  if(candidates.some(page=>!observed.has(page.fileSha256+':'+page.pageNumber)))throw fail('原型参考图缺少成功的逐页观察收执。',409,'NATIVE_DESIGN_SOURCE_UNOBSERVED')
  const selected=candidates.slice(0,6),pageImages=selected.map(page=>page.image),selectedPages=selected.map(({fileSha256,pageNumber})=>({fileSha256,pageNumber}))
  const sourceSelection={archetypeId:archetype.id,selectionMethod:'source-order-bounded',representativenessGuaranteed:false,includesCoverageMapping:mappedPages.length>0,allEvidencePages,selectedPages,notDirectlyReferencedCount:allEvidencePages.length-selectedPages.length}
  analysis.prototypeSources.push(sourceSelection)
  const selectedKeys=new Set(selectedPages.map(page=>page.fileSha256+':'+page.pageNumber))
  const base=()=>({designSpec:analysis.designSpec,targetArchetypeId:archetype.id,sourceSelection,observedDesignPages,...prototypeSlotContract(archetype)})
  if(analysis.designSummary||JSON.stringify(base()).length>150000){
   const summary=await summarizeDesignFacts({analysis,stage}),originalFactCount=observedDesignPages.reduce((n,p)=>n+p.facts.length,0)
   const summarized=summary.pages.filter(page=>keys.has(page.fileSha256+':'+page.pageNumber))
   for(const limit of [8,4,2,1]){observedDesignPages=summarized.map(page=>({...page,facts:page.facts.slice(0,limit)}));sourceSelection.designFactSummary={method:'ranked-original-fact-ids',originalFactCount,selectedFactCount:observedDesignPages.reduce((n,p)=>n+p.facts.length,0),maxFactsPerPage:limit,allOriginalFactsRetainedPrivately:true};if(JSON.stringify(base()).length<=150000)break}
  }
  const sourceArtifacts=await localStage('native-source-'+(index+1),()=>prototypeSources(analysis.referenceBundle,selectedKeys,loadArtifact,signal,Math.max(0,inputLimit-JSON.stringify(base()).length-4096)))
  const sourceSvg=sourceArtifacts.sources
  if(sourceArtifacts.omitted.length)sourceSelection.omittedSourceSvg=sourceArtifacts.omitted
  const prototypes=await stage('prototype-'+(index+1),bounded({...base(),sourceSvg}),pageImages,raw=>{
   const {prototypes}=z.object({prototypes:z.array(nativeLayoutSchema.omit({kind:true})).min(1).max(24)}).strict().parse(raw)
   if(prototypes.some(p=>p.archetypeId!==archetype.id))throw fail('原型阶段返回了本轮未指定的页面原型。',409,'NATIVE_DESIGN_INVALID')
   return prototypes.map(p=>({...p,prototypeSvg:sanitizePrototypeSvg(p.prototypeSvg,{canvas:analysis.profile.designSystem.canvas})}))
  })
  analysis.prototypes.push(...prototypes)
 }
 analysis.nativeQuality=await localStage('upstream-validate',()=>runPptMasterQualityCheck({prototypes:analysis.prototypes,canvas:analysis.profile.designSystem.canvas,signal}))
 const pkg=await localStage('native-compile',()=>compileNativeDesignPackageV3({name:payload.name,designSpec:analysis.designSpec,prototypes:analysis.prototypes,rights:{basis:'unknown',shareAllowed:false,note:'共享发布前确认参考资料的使用依据。'},...context}))
 return {reply:'已生成原生 SVG 设计候选，请以真实内容试排并与参考原页对照确认。',package:pkg}
}
