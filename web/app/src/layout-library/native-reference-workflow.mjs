import {canDeriveComponentDesignSpec,deriveComponentDesignSpec} from './component-derived-spec.mjs'
import {adaptComponentProposal,componentSourceForArchetype,componentFidelityFeatures,componentAdaptationSchema} from './component-upload-workflow.mjs'
import {prototypePdfImageCandidates} from './pdf-image-inventory.mjs'
import {summarizeDesignFacts,compactSynthesis,groupedSynthesisInput} from './reference-design-summary.mjs'
import {z} from 'zod'
import {packageDigest,fail,validatePackage} from './contract.mjs'
import {designSpecSchema,validateDesignSpec} from './design-spec.mjs'
import {nativeLayoutSchema} from './native-design-v3.mjs'
import {compileNativeDesignPackageV3} from './native-design-compiler.mjs'
import {sanitizePrototypeSvg} from './svg-prototype.mjs'
import {runPptMasterQualityCheck} from './ppt-master-quality.mjs'
const inputLimit=200000
const bounded=input=>{if(JSON.stringify(input).length>inputLimit)throw fail('原生设计事实超过单次原型阶段容量，尚未完成原型；已完成检查点保留，原样重试不能解除此容量限制。',413,'NATIVE_DESIGN_INPUT_LIMIT');return input}
export const nativeStageContracts={
 'design-spec':'输出严格 pre-design.design-spec.v1 JSON，schemaVersion、scope(brand|style|layout|deck)、fidelity(standard|fidelity)、profile(必须原样复制已验证Profile)、masterLayoutGraph、components。masterLayoutGraph节点{id:master-N|layout-N|slide-N,kind:master|layout|slide,parentId:null或上级ID,archetypeId?:Profile原型ID,evidenceIds:[真实证据ID]}；master无父，layout父master且必须有archetypeId，slide父layout。覆盖全部Profile原型。components为{id:component-N,kind:decoration|content-slot,role?:title|claim|body|image|table|chart|timeline|diagram|source,style?:受限组合槽位style,evidenceIds}。仅content-slot有role。输入含源原生继承图时据其提炼，照片/PDF没有原生图时明确作为基于Profile证据的设计结构推导，不冒称源文件提取。不得原文、路径、文件名、图片、自由文案、业务数据、任意字段。',
 prototype:'仅输出 {"prototypes":[...]}。每项{id:小写ID,label:简短设计标签,archetypeId:已验证原型ID,slots:完整受限composition槽位,prototypeSvg:完整装饰SVG,contentFitRules:{overflow:"reject",maxTitleCharacters:整数,maxClaimCharacters:整数,maxBodyPoints:整数,maxBodyCharacters:整数,maxImages:整数,maxTableRows:整数,maxTableColumns:整数}}。不输出kind，不输出资源包或检查收执。仅返回本阶段targetArchetypeId的原型实现，全部角色和容量必须实现。以真实参考页图、Design Spec、源SVG的设计几何为依据，不套五种默认布局。SVG只含装饰性几何，可用svg/g/defs/path/rect/circle/ellipse/line/polygon/polyline/linearGradient/radialGradient/stop/clipPath，白名单几何属性；画布与Design Spec一致。禁止text/title/desc/image/use/style/script/foreignObject/事件/外链/实体/HTML及原件文字和图片。原件文字、图表、照片必须改为可编辑内容槽，不能绘成路径伪装成装饰。所有slots role只来自Profile，rect为归一化坐标，id唯一。图表等以项目真实结构数据渲染。style受限为字号、色彩、对齐、内边距等既有属性，不含CSS字符串。超量时明确拒绝，不裁剪；contentFitRules不可高于Profile容量。必须按实际HTML排版计算槽位容量，不能把PDF中文字墨迹的紧边界当成可编辑文本框。title行高1.2，其他文本使用designSystem.typography.lineHeight；实际宽高为rect.w*canvas.width与rect.h*canvas.height，内边距和边框均扣两侧。正文项目符号占1.3em宽，条目之间有0.45em间距，中文每字保守按1em，长文本必须预留换行高度及字体行盒余量。对每个槽位验证声明的字符数/条数在该宽高内可读容纳。保持参考布局关系与设计节奏，但style意图允许扩大文字框、适当减小至可读字号；structure意图不可偷偷改区域，无法容纳时明确失败。',
}
const prototypeVersions=['legacy-image-v1','role-bound-v2','component-bound-v3']
const invalidContract=()=>fail('原型槽位契约版本或原型映射无效。',409,'PROTOTYPE_CONTRACT_INVALID')
export function prototypeSlotContract(archetype,version='role-bound-v2'){
 if(!prototypeVersions.includes(version))throw invalidContract()
 const schema=z.toJSONSchema(nativeLayoutSchema.shape.slots.element)
 if(version==='legacy-image-v1')return archetype.roles.includes('image')?{contentSlotJsonSchema:schema}:{}
 const oneOf=archetype.roles.map(role=>{
  if(!schema.properties.role.enum.includes(role))throw invalidContract()
  const branch=structuredClone(schema);delete branch.$schema
  branch.properties.role={type:'string',const:role}
  if(version==='component-bound-v3'){
   if(role==='text')branch.required=[...new Set([...branch.required,'binding'])]
   else{delete branch.properties.binding;delete branch.properties.purpose}
  }
  if(!['claim','body','image'].includes(role)){delete branch.properties.index;delete branch.properties.range}
  else branch.not={required:['index','range']}
  const style=branch.properties.style.properties
  if(role!=='image')delete style.fit
  if(!['body','image'].includes(role))delete style.columns
  style.fontSize.minimum=role==='title'?32:['source','image'].includes(role)?16:22
  branch.dependentRequired={overlap:['layer']}
  return branch
 })
 return {contentSlotJsonSchema:{$schema:schema.$schema,oneOf},contentBindingRules:{
  ...(version==='component-bound-v3'?{
   text:'text 绑定 item.textBlocks 中与 binding 完全相同的唯一 key；purpose 区分局部标题、正文、结论。不可复制参考业务原文，不可借 title/source 冒充局部文字，不可丢弃未映射内容。实际项目原文通过显式内容映射选择，不推测引用。富文本 spans 使用精确 Unicode 字符区间与 quote。',
   typography:'仅使用受限 fontFamily、fontSize、letterSpacing、lineHeight、emphasisColor；无原字体时声明替代，不宣称原字体还原。表格 tableDensity/tableGrid/tableColumnWidths 仅描述派生版式，不证明源合并关系已恢复。',
   provenance:'本契约不提供原生对象目录；图片哈希、对象号、证据类型不得猜造，未知保持未知。禁止生成装饰 PNG 或复制参考图片；共享权限仍由服务端校验。'
  }:{ }),
  title:'title 固定绑定 item.title，不能用作任意卡片标题。',
  claim:'claim 固定绑定 item.paragraphs；index 从 0 起选择一段，range 为 start 包含、end 不包含且 end > start；省略选择器表示全部。',
  body:'body 固定绑定 item.points，以项目符号列表渲染；index/range 只选择真实 points，不能自造独立业务文案。',
  image:'image 固定绑定真实项目 figures，每张图片自带 caption；index/range 合法，fit 仅放 style.fit，不能另用 source 当图片说明。',
  source:'source 固定绑定页脚章节标题、资料引用与页码，不是卡片说明或图片 caption；禁止 index/range。',
  structured:'table/chart/timeline/diagram 各绑定同名完整结构内容；不得用 index/range 拆分。',
  selectors:'index 与 range 互斥；多个槽位必须完整覆盖实际内容且不重复，不得为装饰性参考文字添加新绑定。',
  overlap:'重叠须双方 overlap:allow 且显式设置不同 layer；rect 不得超出画布。'
 }}
}
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
 const versions=payload.prototypeContractVersions===undefined?{}:payload.prototypeContractVersions
 if(!versions||typeof versions!=='object'||Array.isArray(versions)||Object.entries(versions).some(([id,version])=>(payload.referencePrototypeMappingPolicy!=='matching-archetypes'&&!analysis.profile.archetypes.some(a=>a.id===id))||!prototypeVersions.includes(version)))throw invalidContract()
 if(payload.referencePrototypeMappingPolicy==='matching-archetypes')analysis.retiredPrototypeContractIds=Object.keys(versions).filter(id=>!analysis.profile.archetypes.some(a=>a.id===id))
 analysis.prototypeContractVersions=Object.fromEntries(analysis.profile.archetypes.map(a=>[a.id,versions[a.id]??([1,2,3].includes(payload.referenceComponentVersion)?'component-bound-v3':'role-bound-v2')]))
 const context={inventory:analysis.inventory,observations:analysis.observations}
 const specInput=bounded({...(payload.referenceComponentVersion===3?{designSpecJsonSchema:z.toJSONSchema(designSpecSchema)}:{}),profile:analysis.profile,scope:payload.referenceScope??'deck',fidelity:payload.referenceFidelity??'standard',nativeSources:analysis.referenceBundle.sources.map(s=>({sha256:s.sha256,coverage:s.coverage,masterLayoutGraph:s.native?.masterLayoutGraph??null})),request:payload.text})
 const derive=payload.referenceDerivedSpecVersion===1&&canDeriveComponentDesignSpec(analysis.referenceBundle)
 if(payload.referenceDerivedSpecVersion===1)analysis.designSpecDerivation=derive?{version:1,status:'applied',provenance:'derived-platform-organization',sourceNativeHierarchy:false}:{version:1,status:'not-applied',reason:'native-or-unsupported-source'}
 const acceptSpec=raw=>{
  const value=validateDesignSpec(raw,context)
  if(packageDigest(value.profile)!==analysis.profileHash)throw fail('Design Spec 改写了已验证的来源Profile。',409,'REFERENCE_PROFILE_CHANGED')
  if(value.scope!==specInput.scope||value.fidelity!==specInput.fidelity)throw fail('Design Spec 改变了本轮设计范围或保真级别。',409,'DESIGN_SPEC_INVALID')
  return value
 }
 analysis.designSpec=derive?await localStage('design-spec-derived',()=>acceptSpec(deriveComponentDesignSpec({profile:analysis.profile,scope:specInput.scope,fidelity:specInput.fidelity,context}))):await stage('design-spec',specInput,[],acceptSpec)
 analysis.prototypes=[];analysis.prototypeSources=[]
 if(payload.referenceComponentVersion===3)analysis.componentReviews=[]
 for(const [index,archetype] of analysis.profile.archetypes.entries()){
  if(payload.referenceComponentVersion===3){
   const observation=componentSourceForArchetype(analysis.profile,archetype,analysis.componentObservations)
   const image=images.find(image=>{const file=analysis.inventory.files.find(f=>image.fileId?f.id===image.fileId:f.name===image.name);return file?.sha256===observation.source.fileSha256&&(image.page??1)===observation.source.pageNumber})
   if(!image)throw fail('组件来源缺少本轮已核验图像。',409,'REFERENCE_COMPONENT_INVALID')
   const result=await stage('adapt-'+(index+1),bounded({profile:analysis.profile,targetArchetypeId:archetype.id,componentObservation:observation,adaptationJsonSchema:componentAdaptationSchema(payload.referenceDecorationVersion),...(payload.referenceDecorationVersion!==undefined?{decorationVersion:payload.referenceDecorationVersion}:{})}),[image],raw=>adaptComponentProposal({raw,profile:analysis.profile,archetype,observation,index,...(payload.referenceDecorationVersion!==undefined?{decorationVersion:payload.referenceDecorationVersion}:{}),titleReuse:payload.referenceTitleReuseVersion===1,contentFitPolicy:payload.referenceContentFitPolicyVersion===1,projectSourceFooter:payload.referenceProjectSourceVersion===1,visualSemantics:payload.referenceVisualSemanticsVersion===1?analysis.componentVisualSemantics.find(v=>v.source.fileSha256===observation.source.fileSha256&&v.source.pageNumber===observation.source.pageNumber):undefined}))
   analysis.prototypes.push(result.layout)
   analysis.componentReviews.push({...result.review,archetypeId:archetype.id})
   analysis.prototypeSources.push({archetypeId:archetype.id,selectionMethod:'single-observed-component-page',selectedPages:[observation.source],representativenessGuaranteed:false})
   continue
  }
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
  const contract=prototypeSlotContract(archetype,analysis.prototypeContractVersions[archetype.id])
  const base=()=>({designSpec:analysis.designSpec,targetArchetypeId:archetype.id,sourceSelection,observedDesignPages})
  const estimated=()=>({...base(),...contract})
  if(analysis.designSummary||JSON.stringify(estimated()).length>150000){
   const summary=await summarizeDesignFacts({analysis,stage}),originalFactCount=observedDesignPages.reduce((n,p)=>n+p.facts.length,0)
   const summarized=summary.pages.filter(page=>keys.has(page.fileSha256+':'+page.pageNumber))
   for(const limit of [8,4,2,1]){observedDesignPages=summarized.map(page=>({...page,facts:page.facts.slice(0,limit)}));sourceSelection.designFactSummary={method:'ranked-original-fact-ids',originalFactCount,selectedFactCount:observedDesignPages.reduce((n,p)=>n+p.facts.length,0),maxFactsPerPage:limit,allOriginalFactsRetainedPrivately:true};if(JSON.stringify(estimated()).length<=150000)break}
  }
  if(JSON.stringify(estimated()).length>inputLimit){
   const compact=compactSynthesis(analysis.inventory,analysis.observations,observedDesignPages)
   const inventory={...compact.inventory,files:compact.inventory.files.map(file=>({...file,pages:file.pages.filter(page=>keys.has(file.sha256+':'+page.pageNumber))})).filter(file=>file.pages.length)}
   const observations=compact.observations.map(batch=>({...batch,pages:batch.pages.filter(page=>keys.has(page.fileSha256+':'+page.pageNumber))}))
   const encoded=groupedSynthesisInput(inventory,observations,{})
   observedDesignPages={encoding:encoded.synthesisEncoding,encodingNotes:encoded.encodingNotes,files:encoded.inventory.files}
   sourceSelection.designFactSummary.encoding=encoded.synthesisEncoding
  }
  const sourceArtifacts=await localStage('native-source-'+(index+1),()=>prototypeSources(analysis.referenceBundle,selectedKeys,loadArtifact,signal,Math.max(0,inputLimit-JSON.stringify(estimated()).length-4096)))
  const sourceSvg=sourceArtifacts.sources
  if(sourceArtifacts.omitted.length)sourceSelection.omittedSourceSvg=sourceArtifacts.omitted
  // bddbd5c/d4cd215 legacy prompts placed sourceSvg before the optional slot contract.
  // Keep that exact insertion order: the checkpoint also binds the full prompt string.
  const prototypeInput={...base(),sourceSvg,...contract,...([1,2,3].includes(payload.referenceComponentVersion)?{nativeImageCandidates:prototypePdfImageCandidates(payload.referenceFiles??[],selectedPages)}:{})}
  const prototypes=await stage('prototype-'+(index+1),bounded(prototypeInput),pageImages,raw=>{
   const {prototypes}=z.object({prototypes:z.array(nativeLayoutSchema.omit({kind:true,projectSourceFooter:true})).min(1).max(24)}).strict().parse(raw)
   if(prototypes.some(p=>p.archetypeId!==archetype.id))throw fail('原型阶段返回了本轮未指定的页面原型。',409,'NATIVE_DESIGN_INVALID')
   if(prototypes.some(p=>p.slots.some(slot=>!archetype.roles.includes(slot.role))))throw fail('原型槽位包含目标原型未授权的角色。',409,'NATIVE_DESIGN_INVALID')
   return prototypes.map(p=>({...p,prototypeSvg:sanitizePrototypeSvg(p.prototypeSvg,{canvas:analysis.profile.designSystem.canvas})}))
  })
  analysis.prototypes.push(...prototypes)
 }
 analysis.nativeQuality=await localStage('upstream-validate',()=>runPptMasterQualityCheck({prototypes:analysis.prototypes,canvas:analysis.profile.designSystem.canvas,signal}))
 const pkg=await localStage('native-compile',()=>compileNativeDesignPackageV3({name:payload.name,designSpec:analysis.designSpec,prototypes:analysis.prototypes.map(({kind,...prototype})=>prototype),referenceComponentVersion:payload.referenceComponentVersion,rights:{basis:'unknown',shareAllowed:false,note:'共享发布前确认参考资料的使用依据。'},...context}))
 if(payload.referenceComponentVersion===3){
  if(payload.referenceDecorationVersion===1)pkg.source.limitations.push('装饰语法v1为图像引导的派生背景几何；不是原矢量提取，纹理、书法和未知装饰仍未还原，不改变来源或共享授权。')
  pkg.source.limitations.push('逐组件自动候选待人工视觉审阅；参数样式为派生适配，图片为可替换占位，不能证明全部特征还原或共享许可。')
  for(const review of analysis.componentReviews)if(review.contentFitPolicy?.status==='unavailable')pkg.source.limitations.push('内容适配策略不可用：缺少可兼容的观察父组范围，保留固定版式，不自动扩大为整页。')
  for(const review of analysis.componentReviews)if(review.titleReuse)pkg.source.limitations.push('标题采用可复用宽度派生，保留源位置，不缩小字体或截断；容量'+review.titleReuse.maxTitleCharacters+'字为保守估计，仍须真实内容浏览器试排；并非原稿标题几何还原。')
  if(payload.referenceProjectSourceVersion===1)pkg.source.limitations.push('底部项目来源栏为平台派生，用于完整显示当前项目引用，不是原稿提取特征；不移动原组件，没有独立空白则拒绝生成，仍需真实内容试排。')
  if(payload.referenceVisualSemanticsVersion===1)pkg.source.limitations.push('视觉语义v1仅从页面图像推导列表与图注策略；不自动转录强调词或生成文字绑定。未知、未映射强调和整体视觉均待人工审阅，已提供图注不会移除。')
  if(derive)pkg.source.limitations.push('结构声明由平台依据已校验Profile确定性组织，每页独立母版/版式/页面只是派生关系，不是源文件母版或原生继承提取；未新增设计样式或视觉验收结论。')
  pkg.fidelityFeatures=pkg.layouts.flatMap((layout,index)=>componentFidelityFeatures(layout,analysis.componentReviews[index],componentSourceForArchetype(analysis.profile,analysis.profile.archetypes.find(a=>a.id===layout.archetypeId),analysis.componentObservations),{emphasisCandidates:payload.referenceEmphasisCandidateVersion===1}))
  validatePackage(pkg)
 }
 return {reply:'已生成原生 SVG 设计候选，请以真实内容试排并与参考原页对照确认。',package:pkg}
}
