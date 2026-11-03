import type {ApprovedChapterBrief,ChapterDraftRecord} from './chapter-plan.ts'
/** Planning examples cannot override the manuscript's current paragraphs, tables or figure obligations. */
export function chapterLayoutTasks(draft:ChapterDraftRecord,brief:ApprovedChapterBrief){
 return draft.chapter.pages.map(p=>({
   authority:'current-native-manuscript' as const,pageId:p.id,title:p.title,
   planningQuestion:(brief.plan.pages.find(b=>b.id===p.id)?.content as {question?:string}|undefined)?.question,
   bodyIndices:p.body.map((_,index)=>index),table:p.table??null,visualIntent:p.visual,
 }))
}
