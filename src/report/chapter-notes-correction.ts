import type {ObjectJsonSchema} from '@deepseek-ai/dsh-tools'
import type {ChapterDraftRecord} from './chapter-plan.ts'
import {sha256CanonicalJson as hash} from '../presentation/canonical-json.ts'
export interface ChapterNotesCorrectionRequest {
 kind:'notes-only-correction';baseManuscriptHash:string;planHash:string;pageIds:string[];reason:string
 baseDraftPath:string;baseDraftSha256:string
}
export interface ChapterNotesCorrectionOutput {pages:{pageId:string;notes:string[]}[];reason:string}
export const chapterNotesCorrectionSchema:ObjectJsonSchema={type:'object',additionalProperties:false,required:['pages','reason'],properties:{
 reason:{type:'string'},pages:{type:'array',items:{type:'object',additionalProperties:false,required:['pageId','notes'],properties:{pageId:{type:'string'},notes:{type:'array',items:{type:'string'}}}}}
}}
export function applyChapterNotesCorrection(draft:ChapterDraftRecord,request:ChapterNotesCorrectionRequest,output:ChapterNotesCorrectionOutput){
 if(request.kind!=='notes-only-correction'||request.baseManuscriptHash!==hash(draft.chapter)||request.planHash!==draft.planHash||!request.reason?.trim()||
   !request.pageIds.length||new Set(request.pageIds).size!==request.pageIds.length||request.pageIds.some(id=>!draft.chapter.pages.some(p=>p.id===id)))throw new Error('CHAPTER_NOTES_CORRECTION_BASE')
 if(!output||Object.keys(output).sort().join(',')!=='pages,reason'||!output.reason?.trim()||!Array.isArray(output.pages)||output.pages.length!==request.pageIds.length||
   output.pages.some((p,i)=>Object.keys(p).sort().join(',')!=='notes,pageId'||p.pageId!==request.pageIds[i]||!Array.isArray(p.notes)||!p.notes.length||p.notes.length>8||p.notes.some((n:string)=>typeof n!=='string'||!n.trim()||n.length>800)))throw new Error('CHAPTER_NOTES_CORRECTION_OUTPUT')
 const chapter=structuredClone(draft.chapter)
 for(const p of output.pages)Object.assign(chapter.pages.find(page=>page.id===p.pageId)!,{notes:p.notes})
 return chapter
}
