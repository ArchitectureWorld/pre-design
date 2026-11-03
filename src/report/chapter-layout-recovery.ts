import type {ChapterLayoutDecision} from './chapter-production-contract.ts'
import {mergeScopedLayoutDecision,type ChapterLayoutFeedback} from './chapter-layout-revision.ts'
import {MAX_ORIGINAL_IMAGE_USES} from '../visual/image-policy.ts'

export interface ChapterLayoutRecoveryRequest {
 origin:'user-message';message:string;requestedAt:string;baseManuscriptHash:string
 baseReceipt:string;baseLayoutHash:string;nativeCandidate?:NonNullable<ChapterLayoutFeedback['nativeCandidate']>;feedback:string
}
export interface ChapterLayoutRecoveryIssue {pageIds:string[];feedback:string}

/** A global image-use check must not cause valid pages to be regenerated. */
export function scopeChapterLayoutError(error:unknown,candidate:ChapterLayoutDecision):ChapterLayoutRecoveryIssue{
 const feedback=String(error),known=candidate.pages.map(p=>p.pageId),prefix='CHAPTER_IMAGE_ORIGINAL_REUSE: '
 const at=feedback.indexOf(prefix)
 if(at>=0){
  try{
   const groups=JSON.parse(feedback.slice(at+prefix.length)) as {count:number;pages:string[]}[]
   const ids=groups.flatMap(g=>{
    if(!Number.isInteger(g.count)||g.count<=MAX_ORIGINAL_IMAGE_USES||!Array.isArray(g.pages)||g.pages.length!==g.count)throw new Error('invalid reuse evidence')
    return g.pages.filter(id=>known.includes(id)).slice(-(g.count-MAX_ORIGINAL_IMAGE_USES))
   })
   if(ids.length)return{pageIds:known.filter(id=>ids.includes(id)),feedback}
  }catch{/* Unknown diagnostics retain the conservative whole-chapter check. */}
 }
 return{pageIds:known,feedback}
}

/** Native partial submissions replace only their named pages; acceptance still covers the full chapter. */
export async function recoverNativeChapterLayouts(
 base:ChapterLayoutDecision,
 diagnose:(candidate:ChapterLayoutDecision)=>ChapterLayoutRecoveryIssue[],
 submit:(candidate:ChapterLayoutDecision,pageIds:string[],feedback:string,round:number,batch:number)=>Promise<ChapterLayoutDecision>,
):Promise<ChapterLayoutDecision>{
 let candidate=base
 for(let round=0;round<3;round++){
  const issues=diagnose(candidate)
  if(!issues.length)return candidate
  const known=new Set(candidate.pages.map(p=>p.pageId))
  if(issues.some(i=>!i.pageIds.length||i.pageIds.some(id=>!known.has(id))))throw new Error('CHAPTER_LAYOUT_RECOVERY_SCOPE')
  const bad=new Set(issues.flatMap(i=>i.pageIds)),ids=candidate.pages.map(p=>p.pageId).filter(id=>bad.has(id))
  for(let offset=0;offset<ids.length;offset+=2){
   const pageIds=ids.slice(offset,offset+2),feedback=issues.filter(i=>i.pageIds.some(id=>pageIds.includes(id))).map(i=>i.feedback).join('\n')
   const replacement=await submit(candidate,pageIds,feedback,round,offset/2)
   candidate=mergeScopedLayoutDecision(candidate,replacement,pageIds)
  }
 }
 const remaining=diagnose(candidate)
 if(remaining.length)throw new Error('CHAPTER_LAYOUT_RECOVERY_LIMIT: '+JSON.stringify(remaining))
 return candidate
}
