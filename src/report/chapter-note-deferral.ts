import { sha256CanonicalJson as hash } from '../presentation/canonical-json.ts'
import type { ChapterDraftRecord } from './chapter-plan.ts'
import type { ChapterContentReviewRecord } from './content-review.ts'

/** Keep a dated-source confirmation in notes under an explicit editorial decision.
 * This is a conditional disposition, never an independent review pass. */
export function validateChapterNoteDeferral(request: any, draft: ChapterDraftRecord, review: ChapterContentReviewRecord) {
  const findings = review.receipt?.output.findings ?? []
  if(request?.kind==='scenario-cost-scope-in-notes'){
    const allowed=new Set(['blocking_cost_scope','blocking_downstream_cost_basis','blocking_downstream_funding_total','blocking_downstream_decision_basis',
      'blocking_cost_scope_external_collaborators','blocking_recalculate_revenue_balance','blocking_recalculate_stress_case','blocking_recalculate_first_year_funding','blocking_update_decision_metrics',
      'required-insurance-omitted','revenue-balance-uses-incomplete-cost','stress-balance-uses-incomplete-cost','first-year-need-omits-insurance','decision-summary-uses-incomplete-cost'])
    if(request.chapterId!==draft.chapterId||request.manuscriptHash!==hash(draft.chapter)||request.manuscriptHash!==review.manuscriptHash||
      request.reviewOutputHash!==review.receipt?.outputHash||review.status!=='needs_revision'||!findings.length||
      !request.rationale?.trim()||!request.userDirection?.trim()||!Number.isInteger(request.recheckAfterSteps)||request.recheckAfterSteps<1||request.recheckAfterSteps>3||
      !Array.isArray(request.dispositions)||request.dispositions.length!==findings.length||findings.some((f,i)=>{
        const d=request.dispositions[i],p=draft.chapter.pages.find(p=>p.id===f.pageId)
        const publicCopy=p?[p.title,p.claim,...p.body,...p.table?.columns??[],...p.table?.rows.flat()??[]].join('\n'):''
        const absent=d?.kind==='claim-absent-from-public-copy'&&typeof d.claimedQuote==='string'&&d.claimedQuote.trim().length>=4&&f.reason.includes(d.claimedQuote)&&!publicCopy.replace(/\s/g,'').includes(d.claimedQuote.replace(/\s/g,''))
        return d?.pageId!==f.pageId||d.code!==f.code||!p||(!allowed.has(f.code)&&!absent)||!Array.isArray(d.noteQuotes)||!d.noteQuotes.length||d.noteQuotes.some((q:string)=>!p.notes?.includes(q))
      }))throw new Error('CHAPTER_NOTE_DEFERRAL_INVALID')
    return {...request,requestHash:hash(request),status:'conditional',nativeStatus:'needs_revision',findings}
  }
  const page = draft.chapter.pages.find(p => p.id === request?.pageId)
  if (request?.kind !== 'dated-source-in-notes' || request.chapterId !== draft.chapterId
    || request.manuscriptHash !== hash(draft.chapter) || request.manuscriptHash !== review.manuscriptHash
    || request.reviewOutputHash !== review.receipt?.outputHash || review.status !== 'needs_revision'
    || findings.length !== 1 || findings[0]?.pageId !== request.pageId || findings[0]?.code !== 'FACT-TEMPORAL-QUALIFIER'
    || !page || !Array.isArray(request.sourceRefs) || !request.sourceRefs.length
    || request.sourceRefs.some((ref: string) => !page.sourceRefs.includes(ref))
    || typeof request.noteQuote !== 'string' || !page.notes?.includes(request.noteQuote)
    || !/20\d{2}/u.test(request.noteQuote) || !request.sourceRefs.some((ref: string) => request.noteQuote.includes(ref))
    || typeof request.rationale !== 'string' || !request.rationale.trim()
    || typeof request.userDirection !== 'string' || !request.userDirection.trim()
    || !Number.isInteger(request.recheckAfterSteps) || request.recheckAfterSteps < 1 || request.recheckAfterSteps > 3) {
    throw new Error('CHAPTER_NOTE_DEFERRAL_INVALID')
  }
  return { ...request, requestHash: hash(request), status: 'conditional', nativeStatus: 'needs_revision', findings }
}
