import {z} from 'zod'
import {referenceProfileSchema} from './reference-profile.mjs'
import {packageDigest} from './contract.mjs'
export const CONTENT_STYLE_COMPOSITION_VERSION='content-style-composition-v1'
export const CONTENT_STYLE_COMPOSITION_VERSION_V2='content-style-composition-v2'
export const CONTENT_STYLE_COMPOSITION_VERSION_V3='content-style-composition-v3'
export const CONTENT_STYLE_COMPOSITION_VERSION_V4='content-style-composition-v4'
const fail=message=>{throw Object.assign(Error(message),{code:'CONTENT_STYLE_COMPOSITION_INVALID',statusCode:409})}
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value)}return value}
const text=z.string().min(1).max(10000)
const contentSchema=z.object({title:text,paragraphs:z.array(text).max(14),points:z.array(text).max(14)}).strict()
const clamp=(n,lo,hi)=>Math.min(hi,Math.max(lo,n))
/** Pure proposals, NOT fit tests or finished layouts. Source text stays in the
 * caller's project; selectors and hashes bind each unchanged block exactly once.
 * Real renderer measurement must choose a candidate and column partition. */
export function proposeContentStyleCompositions({item,sourceStyle,styleAcknowledged,version=CONTENT_STYLE_COMPOSITION_VERSION}){
 if(![CONTENT_STYLE_COMPOSITION_VERSION,CONTENT_STYLE_COMPOSITION_VERSION_V2,CONTENT_STYLE_COMPOSITION_VERSION_V3,CONTENT_STYLE_COMPOSITION_VERSION_V4].includes(version))fail('未知构图策略版本。')
 const v4=version===CONTENT_STYLE_COMPOSITION_VERSION_V4
 const v3=version===CONTENT_STYLE_COMPOSITION_VERSION_V3||v4
 const v2=version===CONTENT_STYLE_COMPOSITION_VERSION_V2||v3
 if(styleAcknowledged!==true)fail('编辑式重设计需要显式授权。')
 for(const key of ['figure','figures','table','chart','diagram','timeline','textBlocks'])if(item?.[key]!=null&&(!Array.isArray(item[key])||item[key].length))fail('当前构图策略仅支持完整纯文字块。')
 const content=contentSchema.parse({title:item?.title,paragraphs:item?.paragraphs,points:item?.points})
 if(content.paragraphs.length+content.points.length>28)fail('正文块超过有界候选容量。')
 const source=referenceProfileSchema.shape.designSystem.parse(sourceStyle),{canvas,typography:t,colors,spacing}=source
 const contentHash=packageDigest(content),sourceStyleHash=packageDigest(source)
 const blocks=[{id:'title',selector:{role:'title'},presentation:'heading',keepWhole:true},...content.paragraphs.map((_,index)=>({id:`claim-${index}`,selector:{role:'claim',index},presentation:'lead-paragraph',keepWhole:true})),...content.points.map((_,index)=>({id:`body-${index}`,selector:{role:'body',index},presentation:'text-module',keepWhole:true}))]
 const count=blocks.length-1,margin=clamp(spacing.margin,.04,.12),gutter=clamp(spacing.gutter,.02,.06),span=1-2*margin
 // A legible editorial scale is an explicit inference, not a fit calculation.
 // Changing these bounds changes the policy version, never an old frozen plan.
 const body=clamp(v2?Math.max(t.bodySize,canvas.height/30):t.bodySize,22,32),ratio=clamp(t.titleSize/t.bodySize,1.4,1.75)
 const candidates=[]
 function candidate(mode,bodySize,columns){
  const titleSize=clamp(bodySize*ratio,32,56),claimSize=clamp(bodySize*1.1,22,36)
  const typography={fontFamily:t.fontFamily,title:{fontSize:titleSize,fontWeight:700,lineHeight:Math.max(1.5,t.lineHeight)},claim:{fontSize:claimSize,fontWeight:400,lineHeight:Math.max(1.5,t.lineHeight)},body:{fontSize:bodySize,fontWeight:400,lineHeight:Math.max(1.5,t.lineHeight)}}
  const changes=[['titleSize',t.titleSize,titleSize],['bodySize',t.bodySize,bodySize],['claimSize',t.bodySize,claimSize],['lineHeight',t.lineHeight,typography.body.lineHeight],['margin',spacing.margin,margin],['gutter',spacing.gutter,gutter]]
  const c={id:mode,provenance:'inferred',evidenceIds:[...source.evidenceIds],status:'measurement-required',visualAcceptance:'pending',fit:null,canvas:structuredClone(canvas),colors:{...colors},typography,blocks:structuredClone(blocks),
   frame:{x:margin,y:margin,w:span,bottom:1-margin,footer:'reserve-existing-source-region'},
   flow:{columns,gutter,partition:columns===2?'measured-contiguous-blocks':'source-order',readingOrder:columns===2?'column-major':'top-to-bottom',splitInsideBlock:false,...(columns===2?{possibleBreakAfter:Array.from({length:count-1},(_,i)=>i+1)}:{}),titleSpansColumns:true,verticalPlacement:'measured-after-preceding-block',groupGap:gutter*canvas.height,stretchBlocks:false},
   hierarchy:{title:'primary',claim:'lead',body:'peer-modules',inventGroupHeadings:false},
   decoration:{mode:'source-accent-rule',color:colors.accent,placement:'group-boundary',repeat:'not-every-line',requiresMeasuredPlacement:true},
   derivations:changes.filter(([,a,b])=>a!==b).map(([property,source,derived])=>({property,source,derived,provenance:'inferred',reason:'editorial-hierarchy-candidate'})),
   rejectionRules:['fonts-not-ready','incomplete-block-coverage','source-or-content-hash-changed','horizontal-overflow','vertical-overflow','glyph-clipping','overlap','footer-collision'],
   selectionRequirements:['measure-all-complete-blocks-at-proposed-width-and-style','verify-full-page-with-same-renderer','compare-whitespace-and-hierarchy-visually','do-not-select-by-character-count']}
  if(v2){
   c.policyVersion=version;c.selectionRole=mode==='compact-readable-flow'?'fallback-only':'primary';c.flow.placement='upper-balanced-group'
   c.derivations.push({property:'bodySizeCandidateBasis',source:t.bodySize,canvasHeight:canvas.height,canvasBaseline:canvas.height/30,derived:bodySize,provenance:'inferred',reason:mode==='compact-readable-flow'?'explicit-readable-fallback':'canvas-relative-readability'})
  }
  if(v3){
   c.sourcePolicy='existing-or-derived-project-source'
   c.typography.body.bodyPresentationVersion=1;c.typography.body.bodyPresentation='labeled-paragraph'
   c.derivations.push({property:'bodyPresentation',source:'body-role',derived:'labeled-paragraph',provenance:'inferred',reason:'platform-short-fullwidth-colon-label-rule-not-source-semantics'})
  }
  if(v4){
   const readingWidth=Math.min(span*canvas.width,32*bodySize),columnWidth=(span*canvas.width-gutter*canvas.width)/2
   c.sourceFrame={...c.frame};c.titleFrame={x:columns===1?margin+(span-readingWidth/canvas.width)/2:margin,w:readingWidth/canvas.width}
   if(columns===1){c.frame.x=c.titleFrame.x;c.frame.w=c.titleFrame.w}
   c.flow.placement='measured-upper-third';c.flow.columnWidth=columns===2?columnWidth:null
   c.selectionRole=columns===1?'primary':'capacity-alternative'
   c.derivations.push({property:'readingWidth',source:span*canvas.width,derived:columns===1?readingWidth:columnWidth,provenance:'inferred',reason:columns===1?'32em-readable-region':'measured-contiguous-column-partition',minColumnEm:18})
  }
  c.candidateHash=packageDigest({version,contentHash,sourceStyleHash,candidate:c});candidates.push(c)
 }
 candidate('editorial-flow',body,1)
 // Landscape enables exploration, never proves two columns will fit. Keep all
 // contiguous partitions for measured balancing; no guessed line/word counts.
 if((!v2&&count>=2&&canvas.width>=canvas.height&&span>gutter)||(v4&&count>=2&&(span*canvas.width-gutter*canvas.width)/2>=18*body))candidate('editorial-columns',body,2)
 if(!v4&&(v2||count>=3)&&body>22)candidate('compact-readable-flow',22,1)
 return freeze({version,contentHash,sourceStyleHash,candidates,overflowPolicy:{action:'explicit-pagination-required',when:'all-measured-candidates-rejected',splitInsideBlock:false,allowedBreaks:blocks.slice(1,-1).map(b=>b.id),requiresProjectConfirmation:true,automaticPagination:false,oversizedSingleBlock:'reject-no-truncation'},limitations:['构图候选不是排版或审美验收结果；必须真实浏览器测量与同内容视觉比较。','不重写标题或正文，不生成小标题、图片或事实，不自动跨页。']})
}
