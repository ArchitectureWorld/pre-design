import {componentDecorationSchema} from './component-decorations.mjs'
import {deriveProjectSourceFooter} from './project-source-footer.mjs'
import {proposeVisualPresentation} from './reference-component-semantics.mjs'
import {deriveContentFitPolicy} from './content-fit-policy.mjs'
import {deriveTitleReuse} from './title-reuse.mjs'
import {referenceProfileSchema} from './reference-profile.mjs'
import {z} from 'zod'
import {validateComponentObservation} from './reference-components.mjs'
import {adaptObservedComponents} from './component-layout-adapter.mjs'
import {compositionStyleSchema} from './composition-contract.mjs'
import {deriveReadableTheme} from './accessible-theme.mjs'
const fail=(code='REFERENCE_COMPONENT_PROFILE_INVALID')=>{throw Object.assign(Error('组件与原型来源、独立内容数量或适配结果不一致，请核对参考页。'),{code})}
const key=s=>s.fileSha256+':'+s.pageNumber
const plain=o=>({source:o.source,components:o.components})
export const componentAdaptationContract='仅输出 {styles,maxTextCharacters,maxTableRows?,maxTableColumns?,adjustments,decorations,componentStyles}。这是派生适配提案，不是原始设计事实。styles按title/label/heading/subheading/body/conclusion/image/table提供受限样式；文字fontSize至少22，title至少32，lineHeight至少1.2，不复制业务原文。componentStyles可按真实组件ID覆盖样式。不得改组件ID、角色、来源或数量。adjustments按组件ID提供{rect:{x,y,w,h},reason:readable-text-height|reusable-title-capacity|content-width}，仅需要时明确扩大可读空间，不隐式缩小字体或截断。decorations为[{componentId,shape:rect|diamond,fill:#六位HEX,provenance:derived-adaptation}]，只能映射已有decoration，无法表达的保持缺失；不得绘制文字/照片或添加SVG/图片。maxTextCharacters为全部局部文字容量整数，至少局部文字槽数量，最多50000，必须在实际文字框里容纳，图注自带不透明主题底。表格提供maxTableRows/maxTableColumns正整数，行容量不得超过Profile.tableRows；只是可替换结构容量，不证明原表合并关系或原数据提取。完整几何/文字覆盖/对比度不足会拒绝，不能伪造验收或授权。'
export function componentAdaptationContractFor(version){
 if(version===undefined)return componentAdaptationContract
 if(version!==1)fail('REFERENCE_DECORATION_VERSION_INVALID')
 return componentAdaptationContract.replace('decorations为[{componentId,shape:rect|diamond,fill:#六位HEX,provenance:derived-adaptation}]，只能映射已有decoration，无法表达的保持缺失；不得绘制文字/照片或添加SVG/图片。','装饰语法v1：decorations仅映射本页已有decoration组件ID与原边界，provenance固定derived-adaptation。shape可为rect/diamond（fill）、rounded-rect圆角矩形（fill,radiusRatio，短边比例大于0且不超过0.5）、ellipse椭圆（fill），或line直线（stroke,strokeWidthRatio，短边比例大于0且不超过1，direction为horizontal|vertical|diagonal-down|diagonal-up）。颜色为六位HEX；填充形状不含描边，直线不含fill，端点重合的退化直线会拒绝。全部是图像引导派生背景几何，不是原矢量提取；只有无描边普通rect可作为包住文字的不透明背景，其余形状不得与文字框相交。不得复制字形、照片、业务正文、纹理，不得添加SVG/路径/图片/前景层；无法表达的继续保持缺失。')
}
export function componentSourceForArchetype(profile,archetype,observations){
 const evidence=new Map(profile.evidence.map(e=>[e.id,e])),sources=new Set(),visited=new Set()
 const visit=id=>{if(visited.has(id))return;visited.add(id);const e=evidence.get(id);if(!e)fail();if(e.fileSha256&&e.pageNumber)sources.add(key(e));for(const dep of e.dependsOn??[])visit(dep)}
 archetype.evidenceIds.forEach(visit)
 if(sources.size!==1)fail()
 const matches=observations.filter(o=>sources.has(key(o.source)))
 if(matches.length!==1)fail()
 return matches[0]
}
export function validateComponentProfile(profile,observations){
 const mapped=new Set()
 for(const a of profile.archetypes){
  const o=componentSourceForArchetype(profile,a,observations),v=validateComponentObservation(plain(o),[o.source]),k=key(o.source)
  if(mapped.has(k))fail();mapped.add(k)
  const titles=v.components.filter(c=>c.kind==='text'&&c.purpose==='title').length,text=v.components.filter(c=>c.kind==='text'&&c.purpose!=='title').length,images=v.components.filter(c=>c.kind==='image').length
  const tables=v.components.filter(c=>c.kind==='table').length
  if(tables>1)fail('REFERENCE_COMPONENT_MULTIPLE_TABLES_UNSUPPORTED')
  if(titles!==1)fail()
  const roles=['title',...(text?['text']:[]),...(images?['image']:[]),...(tables?['table']:[])]
  if(a.roles.length!==roles.length||roles.some(r=>!a.roles.includes(r))||(a.capacity.textBlocks??0)!==text||a.capacity.images!==images||a.capacity.bodyPoints!==0||(tables?!(Number.isSafeInteger(a.capacity.tableRows)&&a.capacity.tableRows>0):a.capacity.tableRows!==0))fail()
 }
 if(mapped.size!==observations.length)fail()
 return profile
}
const rect=z.object({x:z.number().min(0).max(1),y:z.number().min(0).max(1),w:z.number().positive().max(1),h:z.number().positive().max(1)}).strict()
const shortId=z.string().regex(/^[a-z][a-z0-9-]{0,47}$/)
// Preserve existing model prompt/schema/checkpoint identity. Presentation v1 is
// currently a manual opt-in; a future model observation version must enable it.
const modelStyleSchema=compositionStyleSchema.omit({presentationVersion:true,textMarker:true,captionPolicy:true})
const schema=z.object({
 styles:z.record(shortId,modelStyleSchema),
 maxTextCharacters:z.number().int().min(0).max(50000),
 maxTableRows:z.number().int().min(0).max(100).optional(),maxTableColumns:z.number().int().min(0).max(12).optional(),
 adjustments:z.record(shortId,z.object({rect,reason:z.enum(['readable-text-height','reusable-title-capacity','content-width'])}).strict()),
 decorations:z.array(z.object({componentId:shortId,shape:z.enum(['rect','diamond']),fill:z.string().regex(/^#[0-9a-fA-F]{6}$/),provenance:z.literal('derived-adaptation')}).strict()).max(64),
 componentStyles:z.record(shortId,modelStyleSchema)
}).strict()
export function adaptComponentProposal({raw,profile,archetype,observation,index,titleReuse=false,contentFitPolicy=false,visualSemantics,projectSourceFooter=false,decorationVersion}){
 const input=adaptationSchema(decorationVersion).parse(raw),system=profile.designSystem,theme=deriveReadableTheme({...system.colors,...system.typography}).theme
 if((input.maxTableRows??0)>archetype.capacity.tableRows)fail()
 const reuse=titleReuse===true?deriveTitleReuse({observation:plain(observation),input,canvas:system.canvas,rightMargin:system.spacing.margin}):null
 const presentation=visualSemantics?proposeVisualPresentation({version:visualSemantics.version,source:visualSemantics.source,components:visualSemantics.components},plain(observation),[observation.source]):null
 const componentStyles=structuredClone(input.componentStyles)
 for(const hint of presentation?.hints??[])componentStyles[hint.componentId]={...(componentStyles[hint.componentId]??{}),...hint.style}
 const result=adaptObservedComponents({...input,componentStyles,...(decorationVersion!==undefined?{decorationVersion}:{}),...(reuse?{adjustments:reuse.adjustments,maxTitleCharacters:reuse.maxTitleCharacters}:{}),observation:plain(observation),allowedSources:[observation.source],canvas:system.canvas,theme,id:'component-page-'+(index+1),label:'逐组件提取 · 待视觉审阅',archetypeId:archetype.id})
 if(decorationVersion!==undefined)result.review.decorationVersion=decorationVersion
 if(projectSourceFooter){result.layout=deriveProjectSourceFooter(result.layout,system.canvas,theme,observation);result.review.projectSourceFooter={version:1,provenance:'derived-project-metadata',visualAcceptance:'pending'}}
 if(presentation)result.review.visualSemantics=presentation
 if(reuse)result.review.titleReuse=reuse.review
 if(contentFitPolicy===true){
  try{const policy=deriveContentFitPolicy({observation:plain(observation),allowedSources:[observation.source],layout:result.layout});if(policy)result.layout.contentAdaptationPolicy=policy;result.review.contentFitPolicy={status:policy?'explicit-preview-available':'unavailable',reason:policy?'source-parent-bounds':'no-grouped-text'}}
  catch(error){if(error.code!=='CONTENT_FIT_POLICY_INVALID')throw error;result.review.contentFitPolicy={status:'unavailable',reason:'parent-boundary-incompatible'}}
 }
 // Nothing from the model can grant sharing or turn this structural review into fidelity acceptance.
 return result
}
/** Safe reusable review summary: no source text, images, credentials or rights claims. */
export function componentFidelityFeatures(layout,review,observation,{emphasisCandidates=false}={}){
 const base={layoutId:layout.id,source:{sha256:observation.source.fileSha256,page:observation.source.pageNumber},evidenceKind:'image'},features=[]
 for(const [roles,feature,editability]of [[['title','text'],'hierarchy','text'],[['image'],'image-group','replaceable-image'],[['table'],'table-structure','structured-data']]){
  const slots=layout.slots.filter(s=>roles.includes(s.role))
  for(let offset=0;offset<slots.length;offset+=32)features.push({...base,feature,observed:'逐组件图像观察：'+slots.length+' 个对应内容区；源位置保留于私有观察记录。',representation:'derived',reason:'以独立可替换内容槽表达；字体、配色及可读空间属于派生适配，未证明原稿视觉一致或原表合并关系；项目真实结构必须另行映射。',slotIds:slots.slice(offset,offset+32).map(s=>s.id),editability})
 }
 for(const candidate of emphasisCandidates?(review.visualSemantics?.emphasisCandidates??[]):[]){
  const slot=layout.slots.find(s=>s.id===candidate.componentId)
  if(!slot||!['text','title'].includes(slot.role))continue
  features.push({...base,feature:'rich-text',observed:'图像观察的局部强调候选：'+candidate.regions.length+' 个原页区域。',representation:'unverified',reason:'区域不等于文字字符位置；必须在项目原文中显式选择片段，样式为用户选择，不能推断原字体/色值或视觉合格。',slotIds:[slot.id],editability:'unknown',emphasisCandidate:structuredClone(candidate)})
 }
 const total=observation.components.filter(c=>c.kind==='decoration').length,mapped=review.mappedDecorations.length
 if(total)features.push({...base,feature:'decoration',observed:'观察到 '+total+' 个装饰区，参数化适配 '+mapped+' 个，未表达 '+(total-mapped)+' 个。',representation:mapped?'derived':'missing',reason:review.decorationVersion===1?'依据已核验页图进行有界矩形、菱形、圆角、椭圆或直线背景派生；不是原矢量提取，源纹理、具体形状与颜色仍待视觉对照。':'仅支持已观察矩形/菱形的参数化派生；源纹理、形状、颜色和缺失特征仍需对照，不代表完整还原。',slotIds:[],editability:mapped?'unknown':'none'})
 features.push({...base,feature:'typography',observed:'图像组件观察不提供已验证字体及字体授权。',representation:'unverified',reason:'使用受限派生字体；自动产物必须人工审阅，未知特征不能按成功计分。',slotIds:[],editability:'unknown'})
 return features
}

function adaptationSchema(version){
 if(version===undefined)return schema
 if(version!==1)fail('REFERENCE_DECORATION_VERSION_INVALID')
 return schema.extend({decorations:componentDecorationSchema(version)})
}
export const componentAdaptationSchema=version=>z.toJSONSchema(adaptationSchema(version))

// V3 has an independent per-component geometry inventory. The legacy optional
// coarse-region list is intentionally absent; never trim component 25 to fit it.
export const componentProfileSchema=referenceProfileSchema.extend({archetypes:z.array(referenceProfileSchema.shape.archetypes.element.omit({regions:true})).min(1).max(24)})
export const componentProfileJsonSchema=()=>z.toJSONSchema(componentProfileSchema)
export function validateComponentProfileFormat(raw){
 const parsed=componentProfileSchema.safeParse(raw)
 if(!parsed.success)throw Object.assign(Error('逐组件Profile格式不合法：不得重复输出regions；完整组件几何保存在独立观察清单中。'),{code:'REFERENCE_COMPONENT_PROFILE_FORMAT_INVALID',statusCode:409})
 return parsed.data
}
