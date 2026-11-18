import {createHash} from 'node:crypto'
import {validateComponentObservation} from './reference-components.mjs'
const reject=reason=>({eligible:false,reason})
const inside=(a,b)=>a.x>=b.x-.001&&a.y>=b.y-.001&&a.x+a.w<=b.x+b.w+.001&&a.y+a.h<=b.y+b.h+.001
/** Conservative image-observed geometry, never source optionality or reading order.
 * Spatial left-to-right order is a platform-derived strategy, not an observed fact.
 * No content, SVG, source pixels or permissions are copied into the result. */
export function inferSparseCardFamily(raw,allowedSources){
 const observation=validateComponentObservation(raw,allowedSources)
 const groups=observation.components.filter(c=>c.kind==='group').sort((a,b)=>a.rect.x-b.rect.x)
 if(groups.length<2||groups.length>4)return reject('card-count')
 if(groups.some(g=>g.parentId))return reject('nested-groups')
 if(observation.components.some(c=>c.kind==='table'))return reject('mixed-structure')
 if(groups.some(g=>g.rect.w<.12)||groups.at(-1).rect.x+groups.at(-1).rect.w-groups[0].rect.x<.4)return reject('insufficient-span')
 const first=groups[0].rect
 for(const [i,g] of groups.entries()){
  const r=g.rect
  if(Math.abs(r.y-first.y)>.015||Math.abs(r.h-first.h)>.025)return reject('unaligned-groups')
  if(Math.abs(r.w-first.w)>Math.min(r.w,first.w)*.15)return reject('unequal-widths')
  if(i&&groups[i-1].rect.x+groups[i-1].rect.w>r.x-.003)return reject('overlapping-groups')
  const children=observation.components.filter(c=>c.parentId===g.id)
  if(children.some(c=>!inside(c.rect,r)))return reject('outside-child')
  if(!children.some(c=>c.kind==='text'&&c.purpose==='body')||!children.some(c=>c.kind==='image'||c.kind==='text'&&c.purpose==='heading'))return reject('unsupported-card')
 }
 // Ungrouped narrative within the card band makes group interpretation ambiguous.
 const top=Math.min(...groups.map(g=>g.rect.y)),bottom=Math.max(...groups.map(g=>g.rect.y+g.rect.h))
 if(observation.components.some(c=>!c.parentId&&['text','image'].includes(c.kind)&&c.rect.y<bottom&&c.rect.y+c.rect.h>top+.001))return reject('ungrouped-content')
 return {eligible:true,source:structuredClone(observation.source),derivation:'platform-sparse-card-v1',groups:groups.map(g=>({id:g.id,rect:{...g.rect},componentIds:observation.components.filter(c=>c.parentId===g.id).map(c=>c.id).sort()})),visualAcceptance:'pending',shareAllowed:false}
}

const invalid=message=>{throw Object.assign(Error(message),{code:'SPARSE_CARD_DERIVATION_INVALID'})}
/** Append explicit platform-designed variants; callers must run the unchanged
 * Native compiler, review and browser gates. Does not publish or modify a binding. */
export function appendSparseCardVariants(input,raw,allowedSources){
 const family=inferSparseCardFamily(raw,allowedSources)
 if(!family.eligible)invalid(`不能安全派生卡片变体：${family.reason}`)
 const result=structuredClone(input),spec=result.designSpec,p=spec.profile
 const proof=p.evidence.filter(e=>e.provenance==='observed'&&e.fileSha256===family.source.fileSha256&&e.pageNumber===family.source.pageNumber).map(e=>e.id)
 if(!proof.length)invalid('设计证据必须包含当前观察页。')
 const evidenceId='sparse-card-derived-v1'
 if(p.evidence.some(e=>e.id===evidenceId)||p.archetypes.some(a=>a.id.startsWith('sparse-card-')))invalid('已包含派生卡片；不能重复追加。')
 p.evidence.push({id:evidenceId,provenance:'inferred',dependsOn:proof})
 const evidenceIds=[evidenceId],{width,height}=p.designSystem.canvas,{accent}=p.designSystem.colors
 const left=family.groups[0].rect.x,right=family.groups.at(-1).rect.x+family.groups.at(-1).rect.w
 const span=right-left,gap=Math.min(.025,span/20)
 const xmlRect=(r,fill)=>`<rect x="${r.x*width}" y="${r.y*height}" width="${r.w*width}" height="${r.h*height}" fill="${fill}"/>`
 for(let count=0;count<=family.groups.length;count++){
  const nodeIndex=1+Math.max(0,...spec.masterLayoutGraph.map(n=>Number(n.id.split('-').at(-1)))),componentIndex=1+Math.max(0,...spec.components.map(n=>Number(n.id.split('-').at(-1))))
  const id=count?`sparse-card-${count}`:'sparse-text-0',cardWidth=count?(span-gap*(count-1))/count:span
  const slots=[{id:'title',role:'title',rect:{x:left,y:.06,w:span,h:.20},style:{fontSize:72,fontWeight:700,lineHeight:1.2}},{id:'intro',role:'claim',rect:{x:left,y:count?.28:.34,w:span,h:count?.12:.42},style:{fontSize:count?32:40,lineHeight:1.35}},
   ...Array.from({length:count},(_,i)=>({id:`point-${i+1}`,role:'body',index:i,rect:{x:left+i*(cardWidth+gap)+.012,y:.47,w:cardWidth-.024,h:.30},style:{padding:16,verticalAlign:'top',fontSize:36}})),
   {id:'source',role:'source',rect:{x:left,y:.91,w:span,h:.05}}]
  p.archetypes.push({id,pageType:'comparison',structure:count<=1?'single-column':'equal-columns',density:'low',roles:count?['title','claim','body','source']:['title','claim','source'],capacity:{images:0,bodyPoints:count,tableRows:0,textBlocks:0},regions:slots.map(s=>({role:s.role,rect:{...s.rect}})),evidenceIds:[...evidenceIds]})
  spec.masterLayoutGraph.push({id:`master-${nodeIndex}`,kind:'master',parentId:null,evidenceIds:[...evidenceIds]},{id:`layout-${nodeIndex}`,kind:'layout',parentId:`master-${nodeIndex}`,archetypeId:id,evidenceIds:[...evidenceIds]})
  for(const [i,role] of (count?['title','claim','body','source']:['title','claim','source']).entries())spec.components.push({id:`component-${componentIndex+i}`,kind:'content-slot',role,evidenceIds:[...evidenceIds]})
  const decorations=Array.from({length:count},(_,i)=>xmlRect({x:left+i*(cardWidth+gap),y:.44,w:cardWidth,h:.008},accent)).join('')
  result.prototypes.push({id,archetypeId:id,label:count?`无图简要 · ${count}项要点（平台派生）`:'无图 · 纯段落（平台派生）',slots,prototypeSvg:`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${decorations}</svg>`,contentFitRules:{overflow:'reject',maxTextBlocks:0,maxTextCharacters:0,maxTitleCharacters:40,maxClaimCharacters:count?90:180,maxBodyPoints:count,maxBodyCharacters:count*60,maxImages:0,maxTableRows:0,maxTableColumns:0}})
 }
 p.limitations.push({code:'readability-adjusted',evidenceIds:[...evidenceIds]})
 result.sparseCardDerivation={strategy:family.derivation,source:structuredClone(family.source),observationSha256:createHash('sha256').update(JSON.stringify(validateComponentObservation(raw,allowedSources))).digest('hex'),groups:structuredClone(family.groups),outputSha256:createHash('sha256').update(JSON.stringify({designSpec:spec,prototypes:result.prototypes})).digest('hex'),visualAcceptance:'pending'}
 return result
}
