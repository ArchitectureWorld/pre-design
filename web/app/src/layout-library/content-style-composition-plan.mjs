import {z} from 'zod'
import {packageDigest,validatePackage} from './contract.mjs'
import {compileNativeDesignPackageV3} from './native-design-compiler.mjs'
import {proposeContentStyleCompositions,CONTENT_STYLE_COMPOSITION_VERSION} from './content-style-composition-policy.mjs'
const fail=message=>{throw Object.assign(Error(message),{code:'CONTENT_STYLE_COMPOSITION_PLAN_INVALID',statusCode:409})}
const freeze=o=>{if(o&&typeof o==='object'){Object.values(o).forEach(freeze);Object.freeze(o)}return o}
const positive=z.number().finite().positive()
const measurementSchema=z.object({schemaVersion:z.literal('content-style-measurement-v1'),requestHash:z.string(),textId:z.string(),fontsReady:z.literal(true),units:z.literal('canvas-pixels'),lineBoxes:z.array(z.object({x:z.number().finite().nonnegative(),y:z.number().finite(),width:positive,height:positive}).strict()).min(1).max(2048),requiredWidth:positive,requiredHeight:positive}).strict()
/** Internal experimental compiler. It neither saves resources nor approves a visual.
 * The caller supplies the existing trusted renderer-backed browser capability. */
export async function buildContentStyleCompositionPlan({sourcePackage,layoutId,item,candidate,styleAcknowledged},{measureText}={}){
 if(typeof measureText!=='function')fail('缺少可信浏览器测量能力。')
 // Capture private content before the first asynchronous capability call.
 // Hashes, measurement requests and capacities must all use the same snapshot.
 item=freeze(structuredClone(item))
 if(item?.evidenceIndexes!==undefined)z.array(z.number().int().nonnegative()).max(64).parse(item.evidenceIndexes)
 const inputContentHash=packageDigest(item)
 const sourcePackageHash=packageDigest(sourcePackage),pkg=validatePackage(structuredClone(sourcePackage))
 if(!pkg.designSpec||pkg.schemaVersion!=='pre-design.layout-package.v3')fail('需要冻结 Native V3 来源。')
 const layout=pkg.layouts.find(l=>l.id===layoutId);if(!layout)fail('源版式不存在。')
 const policy=proposeContentStyleCompositions({item,sourceStyle:pkg.designSpec.profile.designSystem,styleAcknowledged,version:candidate?.policyVersion??CONTENT_STYLE_COMPOSITION_VERSION})
 const selected=policy.candidates.find(c=>c.candidateHash===candidate?.candidateHash)
 if(!selected||packageDigest(selected)!==packageDigest(candidate))fail('候选、完整内容或来源设计规则已变化。')
 if(selected.flow.columns!==1)fail('当前实验编译器尚不支持分栏测量，未执行或伪报成功。')
 const sourceSlots=layout.slots.filter(s=>s.role==='source');if(sourceSlots.length>1)fail('页脚来源不唯一。')
 const footer=sourceSlots[0];if(item.evidenceIndexes?.length&&!footer)fail('当前内容引用需要已有页脚槽。')
 const {width,height}=pkg.canvas,frame=selected.frame,bottom=Math.min(frame.bottom,footer?.rect.y??1),gap=selected.flow.groupGap
 let y=frame.y*height;const slots=[],measurements=[],adjustments=[]
 for(const block of selected.blocks){
  const {role,index}=block.selector,text=role==='title'?item.title:role==='claim'?item.paragraphs[index]:item.points[index]
  const typography=selected.typography[role==='title'?'title':role==='claim'?'claim':'body']
  const style={...typography,fontFamily:selected.typography.fontFamily,letterSpacing:0,align:'left',padding:0}
  const base={schemaVersion:'content-style-measurement-v1',textId:block.id,role,text,width:frame.w*width,canvas:{width,height},style}
  let m,r;const attempts=[]
  for(const lineHeight of [...new Set([style.lineHeight,1.5,1.75,2].filter(n=>n>=style.lineHeight))]){
   const body={...base,style:{...style,lineHeight}};r=freeze({...body,requestHash:packageDigest(body)})
   m=measurementSchema.parse(await measureText(r));attempts.push({requestHash:r.requestHash,lineHeight,response:structuredClone(m)})
   if(m.requestHash!==r.requestHash||m.textId!==r.textId||m.requiredWidth>r.width+1/64+1e-9||m.lineBoxes.some(b=>b.x+b.width>m.requiredWidth+.01||b.y+b.height>m.requiredHeight+.01))fail('真实测量身份或边界不成立。')
   if(m.lineBoxes.every(b=>b.y>=0))break
  }
  if(m.lineBoxes.some(b=>b.y<0))fail('字体仍有上伸，未生成裁字计划。')
  if(y+m.requiredHeight>bottom*height)fail('完整内容超过单页容量；需要显式分页，未截断原文。')
  slots.push({id:block.id,role,...(index!==undefined?{index}:{}),rect:{x:frame.x,y:y/height,w:frame.w,h:m.requiredHeight/height},style:{...r.style,color:selected.colors.ink,verticalAlign:'top'}})
  measurements.push({textId:block.id,attempts,acceptedRequestHash:r.requestHash,acceptedMeasurementHash:packageDigest(m)})
  if(r.style.lineHeight!==style.lineHeight)adjustments.push({textId:block.id,sourceLineHeight:style.lineHeight,derivedLineHeight:r.style.lineHeight,provenance:'inferred',reason:'measured-font-line-box'})
  y+=m.requiredHeight+gap
 }
 let placement
 if(selected.flow.placement==='upper-balanced-group'){
  const groupTop=frame.y*height,groupBottom=(slots.at(-1).rect.y+slots.at(-1).rect.h)*height,groupHeight=groupBottom-groupTop,availableHeight=bottom*height-groupTop,free=Math.max(0,availableHeight-groupHeight),titleHeight=slots[0].rect.h*height
  const offset=Math.min(free/3,2*titleHeight,.12*height)
  for(const slot of slots)slot.rect.y+=offset/height
  if(slots.some(s=>(s.rect.y+s.rect.h)*height>bottom*height+1e-8))fail('平衡定位超出可用正文区。')
  placement={strategy:'upper-balanced-group',provenance:'inferred',units:'canvas-pixels',groupTop,groupBottom,groupHeight,availableHeight,free,titleHeight,canvasHeight:height,offset,reason:'measured-content-group-balance'}
 }
 if(footer)slots.push(structuredClone(footer))
 const key=packageDigest({sourcePackageHash,inputContentHash,layoutHash:packageDigest(layout),candidateHash:selected.candidateHash,measurements}).slice(0,16),id=`editorial-${key}`,proof=`editorial-proof-${key}`
 const original=pkg.designSpec.profile.archetypes.find(a=>a.id===layout.archetypeId),roles=[...new Set(slots.map(s=>s.role))]
 const n=1+Math.max(0,...pkg.designSpec.masterLayoutGraph.map(n=>Number(n.id.split('-').at(-1)))),c=1+Math.max(0,...pkg.designSpec.components.map(n=>Number(n.id.split('-').at(-1))))
 const delta={evidence:[{id:proof,provenance:'inferred',dependsOn:[...new Set([...original.evidenceIds,...selected.evidenceIds])]}],archetype:{id,pageType:'text',structure:'single-column',density:'medium',roles,capacity:{images:0,bodyPoints:item.points.length,tableRows:0,textBlocks:0},regions:slots.map(s=>({role:s.role,rect:{...s.rect}})),evidenceIds:[proof]},masterLayoutGraph:[{id:`master-${n}`,kind:'master',parentId:null,evidenceIds:[proof]},{id:`layout-${n}`,kind:'layout',parentId:`master-${n}`,archetypeId:id,evidenceIds:[proof]}],components:roles.map((role,i)=>({id:`component-${c+i}`,kind:'content-slot',role,evidenceIds:[proof]}))}
 const count=s=>Array.from(s).length,title=slots[0],ruleY=(title.rect.y+title.rect.h)*height+gap/2,ruleHeight=Math.min(2,gap/4)
 // The accent is a new, explicitly inferred divider, never original source art.
 const decoration=item.paragraphs.length+item.points.length?`<rect x="${frame.x*width}" y="${ruleY}" width="${frame.w*width}" height="${ruleHeight}" fill="${selected.colors.accent}"/>`:''
 const prototype={id,archetypeId:id,label:'实测编辑式构图 · 平台推导',slots,prototypeSvg:`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${decoration}</svg>`,contentFitRules:{overflow:'reject',maxTitleCharacters:count(item.title),maxClaimCharacters:item.paragraphs.reduce((n,s)=>n+count(s),0),maxBodyPoints:item.points.length,maxBodyCharacters:item.points.reduce((n,s)=>n+count(s),0),maxImages:0,maxTableRows:0,maxTableColumns:0,maxTextBlocks:0,maxTextCharacters:0}}
 const designSpec=structuredClone(pkg.designSpec);designSpec.profile.evidence.push(...delta.evidence);designSpec.profile.archetypes.push(delta.archetype);designSpec.masterLayoutGraph.push(...delta.masterLayoutGraph);designSpec.components.push(...delta.components)
 compileNativeDesignPackageV3({name:pkg.name,rights:pkg.rights,designSpec,prototypes:[...pkg.layouts.map(({kind,...l})=>l),prototype]})
 return freeze({prototype,delta,receipt:{version:policy.version,...(placement?{placement}:{}),sourcePackageHash,sourceLayoutHash:packageDigest(layout),sourceStyleHash:policy.sourceStyleHash,contentHash:policy.contentHash,inputContentHash,candidateHash:selected.candidateHash,outputHash:packageDigest({prototype,delta}),provenance:'inferred',derivations:structuredClone(selected.derivations),typographyAdjustments:adjustments,measurements,visualAcceptance:'pending',limitations:['仅单列候选；分栏未实施，单页超量须显式分页。','正文使用同 renderer 的 ul/li 测量与呈现，不声称已变成无列表符号模块。','未复制原装饰；分隔线为平台推导，页脚及整页仍需真实视觉验收。','测量回执未包含浏览器及字体文件环境指纹。']}})
}
