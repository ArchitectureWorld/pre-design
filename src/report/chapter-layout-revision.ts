import { sha256CanonicalJson as hash } from '../presentation/canonical-json.ts'
import type { ChapterLayoutDecision } from './chapter-production-contract.ts'
import type { ChapterPageLayout } from './chapter-render.ts'
import {CHAPTER_PRIMARY_FLOWS,primaryChapterPageFlow,type ChapterPrimaryFlow} from './chapter-client-visuals.ts'

export interface ChapterLayoutConstraint {pageId:string;allowedAssetIds?:string[];allowedFlows?:ChapterPrimaryFlow[]}
export function mergeChapterLayoutConstraints(previous:readonly ChapterLayoutConstraint[],added:readonly ChapterLayoutConstraint[],known:readonly string[],scope:readonly string[]):ChapterLayoutConstraint[]{
  if(!Array.isArray(previous)||!Array.isArray(added)||added.some(r=>!scope.includes(r.pageId)))throw new Error('CHAPTER_LAYOUT_CONSTRAINT_SCOPE')
  for(const r of [...previous,...added])if(!r||!known.includes(r.pageId)||(!r.allowedAssetIds&&!r.allowedFlows)||
    r.allowedAssetIds&&(!r.allowedAssetIds.length||r.allowedAssetIds.some((id:string)=>typeof id!=='string'||!id.trim()))||
    r.allowedFlows&&(!r.allowedFlows.length||r.allowedFlows.some((f:ChapterPrimaryFlow)=>!CHAPTER_PRIMARY_FLOWS.includes(f))))throw new Error('CHAPTER_LAYOUT_CONSTRAINT_SCOPE')
  const merged=new Map(previous.map(r=>[r.pageId,{...r}]))
  for(const r of added)merged.set(r.pageId,{...merged.get(r.pageId),...r})
  return [...merged.values()]
}
/** Review constraints bind the actual native selection and geometry, including later automatic repairs. */
export function assertChapterLayoutConstraints(layouts:readonly ChapterPageLayout[],constraints:readonly ChapterLayoutConstraint[]):void{
  for(const constraint of constraints){
    const page=layouts.find(p=>p.pageId===constraint.pageId),assets=page?.elements.filter(e=>e.type==='figure').map(e=>e.assetId)??[],flow=page&&primaryChapterPageFlow(page)
    if(!page||constraint.allowedAssetIds&&(!assets.length||assets.some(id=>!constraint.allowedAssetIds!.includes(id)))||constraint.allowedFlows&&(!flow||!constraint.allowedFlows.includes(flow)))
      throw new Error('CHAPTER_LAYOUT_CONSTRAINT: '+JSON.stringify({required:constraint,actual:{assetIds:assets,flow},action:'按限定的相关原图与阅读方向重新提交实际布局；保留完整正文，由原生任务确定具体坐标。reason声明不能替代实际修改。'}))
  }
}

export interface ChapterVisualRequirement {pageId:string;kind:'graphic'|'sequence'|'annotated-map'}
export function mergeChapterVisualRequirements(previous:readonly ChapterVisualRequirement[],added:readonly ChapterVisualRequirement[],pageIds:readonly string[]):ChapterVisualRequirement[]{
  if(!Array.isArray(previous)||!Array.isArray(added))throw new Error('CHAPTER_REQUIRED_VISUAL_SCOPE')
  const all=[...previous,...added]
  if(all.some(r=>!r||!pageIds.includes(r.pageId)||!['graphic','sequence','annotated-map'].includes(r.kind)))throw new Error('CHAPTER_REQUIRED_VISUAL_SCOPE')
  return [...new Map(all.map(r=>[r.pageId+':'+r.kind,{...r}])).values()]
}
/** Verify rendered elements, never a model's narrative claim that a visual exists. */
export function assertChapterRequiredVisuals(layouts:readonly ChapterPageLayout[],requirements:readonly ChapterVisualRequirement[]):void{
  for(const requirement of requirements){
    const page=layouts.find(p=>p.pageId===requirement.pageId)
    const present=page?.elements.some(e=>requirement.kind==='annotated-map'
      ?e.type==='figure'&&!!e.annotations?.markers.length:e.type===requirement.kind)
    if(!present)throw new Error('CHAPTER_REQUIRED_VISUAL_MISSING: '+JSON.stringify({...requirement,actual:page?.elements.map(e=>e.type)??[],required:'实际提交可渲染图件字段；reason、caption或正文声称存在不算。保留已形成的图件，修正字段、尺寸或短标签，不能通过删掉图件绕过校验。'}))
  }
}

export interface ChapterLayoutFeedback {
  baseLayoutHash:string; baseReceipt:string; feedback:string
  origin?:'user-message'|'dsh-visual-review'|'program-layout-check'; message?:string; requestedAt?:string; pageIds?:string[]; baseHtmlSha256?:string; reviewPath?:string
  renderedPages?:{pageId:string;path:string;sha256:string}[]
  compositionMode?:'semantic'
  reviewContinuity?:{path:string;sha256:string;pageIds:string[]}
  nativeCandidate?:{receipt:string;childId:string;outputHash:string}
  requiredVisuals?:ChapterVisualRequirement[]
  layoutConstraints?:ChapterLayoutConstraint[]
}

/** A rejected whole-chapter submission is continuation data, never an approved result. */
export function validateNativeLayoutCandidate(reference:NonNullable<ChapterLayoutFeedback['nativeCandidate']>, candidate:ChapterLayoutDecision, previous:ChapterLayoutDecision):ChapterLayoutDecision{
  if(!/^[a-f0-9]{64}$/.test(reference.outputHash)||hash(candidate)!==reference.outputHash||
    !Array.isArray(candidate?.pages)||candidate.pages.length!==previous.pages.length||candidate.pages.some((p,i)=>p.pageId!==previous.pages[i]?.pageId))throw new Error('CHAPTER_LAYOUT_CANDIDATE_CHANGED')
  return candidate
}

/** A new user review is distinct from automatic retries; old rounds remain intact. */
export function validateScopedLayoutFeedback(feedback:ChapterLayoutFeedback, state:{layoutHash:string;layoutReceipt:string;htmlSha256?:string;layoutUserReviews?:string[];layoutVisualReviews?:string[]}, previous:ChapterLayoutDecision):string[]|undefined {
  if(!feedback.origin)return
  if(!feedback.message?.trim()||!feedback.feedback.trim()||!Number.isFinite(Date.parse(feedback.requestedAt??''))||!feedback.pageIds?.length||
    new Set(feedback.pageIds).size!==feedback.pageIds.length||feedback.pageIds.some(id=>!previous.pages.some(p=>p.pageId===id)))throw new Error('CHAPTER_LAYOUT_USER_REVIEW_SCOPE')
  const prior=feedback.origin==='user-message'?state.layoutUserReviews:state.layoutVisualReviews
  if(!prior?.includes(hash(feedback))&&(feedback.baseLayoutHash!==state.layoutHash||feedback.baseReceipt!==state.layoutReceipt||!state.htmlSha256||feedback.baseHtmlSha256!==state.htmlSha256))throw new Error('CHAPTER_LAYOUT_USER_REVIEW_STALE')
  return previous.pages.filter(p=>feedback.pageIds!.includes(p.pageId)).map(p=>p.pageId)
}

export function mergeScopedLayoutDecision(previous:ChapterLayoutDecision, replacement:ChapterLayoutDecision,pageIds:readonly string[]):ChapterLayoutDecision {
  if(replacement.pages.length!==pageIds.length||replacement.pages.some((p,i)=>p.pageId!==pageIds[i]))throw new Error('CHAPTER_LAYOUT_USER_REVIEW_PAGES')
  return {pages:previous.pages.map(p=>replacement.pages.find(r=>r.pageId===p.pageId)??p)}
}
