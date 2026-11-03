import {expect,it} from 'vitest'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'
import {applyChapterNotesCorrection} from '../src/report/chapter-notes-correction.ts'
import {validateChapterNoteDeferral} from '../src/report/chapter-note-deferral.ts'
const draft:any={chapterId:'operation',planHash:'plan',chapter:{pages:[{id:'cost',title:'情景成本',body:['原生金额199,440元'],sourceRefs:['R-1'],quantities:[{id:'cost',value:199440}],notes:['原备注']} ]}}
it('changes only native-authored notes for exact requested pages and preserves public numbers and sources',()=>{
 const request:any={kind:'notes-only-correction',baseManuscriptHash:hash(draft.chapter),planHash:'plan',pageIds:['cost'],reason:'明确保险排除口径'}
 const chapter=applyChapterNotesCorrection(draft,request,{pages:[{pageId:'cost',notes:['测算假设；保险未计入，实施前单独预算。']}],reason:'范围说明'})
 expect(chapter.pages[0]).toEqual({...draft.chapter.pages[0],notes:['测算假设；保险未计入，实施前单独预算。']})
 expect(draft.chapter.pages[0].notes).toEqual(['原备注'])
 expect(()=>applyChapterNotesCorrection(draft,request,{pages:[],reason:'范围说明'})).toThrow('CHAPTER_NOTES_CORRECTION_OUTPUT')
})
it('records a cost-scope deferral as conditional, bound to exact review findings and actual notes, never as a pass',()=>{
 const manuscriptHash=hash(draft.chapter)
 const review:any={status:'needs_revision',manuscriptHash,receipt:{outputHash:'review',output:{findings:[{pageId:'cost',code:'blocking_cost_scope',reason:'保险范围'}]}}}
 const request:any={kind:'scenario-cost-scope-in-notes',chapterId:'operation',manuscriptHash,reviewOutputHash:'review',rationale:'仅情景审阅',userDirection:'人工确认写备注，按步骤回溯',recheckAfterSteps:3,
 dispositions:[{pageId:'cost',code:'blocking_cost_scope',noteQuotes:['原备注']}]}
 expect(validateChapterNoteDeferral(request,draft,review)).toMatchObject({status:'conditional',nativeStatus:'needs_revision'})
 expect(()=>validateChapterNoteDeferral({...request,reviewOutputHash:'other'},draft,review)).toThrow('CHAPTER_NOTE_DEFERRAL_INVALID')
 expect(()=>validateChapterNoteDeferral({...request,dispositions:[{pageId:'cost',code:'blocking_cost_scope',noteQuotes:['not present']}]},draft,review)).toThrow('CHAPTER_NOTE_DEFERRAL_INVALID')
 const arithmetic={...review,receipt:{...review.receipt,output:{findings:[{pageId:'cost',code:'ARITHMETIC',reason:'sum mismatch'}]}}}
 expect(()=>validateChapterNoteDeferral({...request,dispositions:[{pageId:'cost',code:'ARITHMETIC',noteQuotes:['原备注']}]},draft,arithmetic)).toThrow('CHAPTER_NOTE_DEFERRAL_INVALID')
 const absent={...review,receipt:{...review.receipt,output:{findings:[{pageId:'cost',code:'stale-summary',reason:'旧文宣称1028小时'}]}}}
 const absentRequest={...request,dispositions:[{pageId:'cost',code:'stale-summary',kind:'claim-absent-from-public-copy',claimedQuote:'1028小时',noteQuotes:['原备注']}]}
 expect(validateChapterNoteDeferral(absentRequest,draft,absent)).toMatchObject({status:'conditional'})
 expect(()=>validateChapterNoteDeferral({...absentRequest,dispositions:[{...absentRequest.dispositions[0],claimedQuote:'199,440元'}]},draft,absent)).toThrow('CHAPTER_NOTE_DEFERRAL_INVALID')
})
