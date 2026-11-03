import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import { sha256CanonicalJson as hash } from '../presentation/canonical-json.ts'
import type { ChapterDraftRecord } from './chapter-plan.ts'

export interface ChapterCopyCorrectionRequest {
  kind: 'single-body-correction'
  baseManuscriptHash: string
  planHash: string
  pageId: string
  bodyIndex: number
  reason: string
}
export const chapterCopyCorrectionSchema:ObjectJsonSchema={
  type:'object',additionalProperties:false,required:['text','reason'],
  properties:{text:{type:'string'},reason:{type:'string'}}
}
export function applyChapterCopyCorrection(draft:ChapterDraftRecord,request:ChapterCopyCorrectionRequest,output:{text:string;reason:string}){
  const page=draft.chapter.pages.find(p=>p.id===request.pageId)
  if(request.kind!=='single-body-correction'||request.planHash!==draft.planHash||request.baseManuscriptHash!==hash(draft.chapter)
    ||!page||!Number.isInteger(request.bodyIndex)||request.bodyIndex<0||request.bodyIndex>=page.body.length||!request.reason?.trim())
    throw new Error('CHAPTER_COPY_CORRECTION_BASE')
  if(!output||Object.keys(output).sort().join(',')!=='reason,text'||typeof output.text!=='string'||!output.text.trim()
    ||output.text.length>180||typeof output.reason!=='string'||!output.reason.trim())
    throw new Error('CHAPTER_COPY_CORRECTION_OUTPUT')
  const chapter=structuredClone(draft.chapter)
  ;(chapter.pages.find(p=>p.id===request.pageId)!.body as string[])[request.bodyIndex]=output.text
  return chapter
}

export interface ChapterTableColumnCorrectionRequest {
  kind:'table-column-correction'
  baseManuscriptHash:string
  planHash:string
  pageId:string
  columnIndex:number
  reason:string
}
export interface ChapterTableColumnCorrectionOutput {heading:string;values:string[];reason:string}
export const chapterTableColumnCorrectionSchema:ObjectJsonSchema={
  type:'object',additionalProperties:false,required:['heading','values','reason'],
  properties:{heading:{type:'string'},values:{type:'array',items:{type:'string'}},reason:{type:'string'}}
}
export function applyChapterTableColumnCorrection(draft:ChapterDraftRecord,request:ChapterTableColumnCorrectionRequest,output:ChapterTableColumnCorrectionOutput){
  const page=draft.chapter.pages.find(p=>p.id===request.pageId),table=page?.table
  if(request.kind!=='table-column-correction'||request.planHash!==draft.planHash||request.baseManuscriptHash!==hash(draft.chapter)
    ||!table||!Number.isInteger(request.columnIndex)||request.columnIndex<0||request.columnIndex>=table.columns.length
    ||!table.rows.length||table.rows.some(row=>row.length!==table.columns.length)||!request.reason?.trim())
    throw new Error('CHAPTER_TABLE_CORRECTION_BASE')
  const validText=(v:unknown,max:number)=>typeof v==='string'&&v.trim().length>0&&v.length<=max
  if(!output||Object.keys(output).sort().join(',')!=='heading,reason,values'||!validText(output.heading,64)||!validText(output.reason,2000)
    ||!Array.isArray(output.values)||output.values.length!==table.rows.length||output.values.some(v=>!validText(v,180)))
    throw new Error('CHAPTER_TABLE_CORRECTION_OUTPUT')
  const chapter=structuredClone(draft.chapter),target=chapter.pages.find(p=>p.id===request.pageId)!.table!
  ;(target.columns as string[])[request.columnIndex]=output.heading
  for(let i=0;i<target.rows.length;i++)(target.rows[i] as string[])[request.columnIndex]=output.values[i]!
  return chapter
}

export interface ChapterPageCopyCorrectionRequest {
  kind:'page-copy-correction';baseManuscriptHash:string;planHash:string;pageId:string;reason:string
}
export interface ChapterPageCopyCorrectionOutput {
  title:string;claim:string;body:string[]
  visual:{kind:'source'|'concept'|'diagram'|'none';subject:string;purpose:string;caption:string}
  reason:string
}
export const chapterPageCopyCorrectionSchema:ObjectJsonSchema={type:'object',additionalProperties:false,required:['title','claim','body','visual','reason'],properties:{
  title:{type:'string'},claim:{type:'string'},body:{type:'array',items:{type:'string'}},reason:{type:'string'},
  visual:{type:'object',additionalProperties:false,required:['kind','subject','purpose','caption'],properties:{kind:{type:'string',enum:['source','concept','diagram','none']},subject:{type:'string'},purpose:{type:'string'},caption:{type:'string'}}}
}}
export function applyChapterPageCopyCorrection(draft:ChapterDraftRecord,request:ChapterPageCopyCorrectionRequest,output:ChapterPageCopyCorrectionOutput){
  const page=draft.chapter.pages.find(p=>p.id===request.pageId)
  if(request.kind!=='page-copy-correction'||request.planHash!==draft.planHash||request.baseManuscriptHash!==hash(draft.chapter)||!page||!request.reason?.trim())throw new Error('CHAPTER_PAGE_CORRECTION_BASE')
  const valid=(v:unknown,max:number)=>typeof v==='string'&&v.trim().length>0&&v.length<=max
  if(!output||Object.keys(output).sort().join(',')!=='body,claim,reason,title,visual'||!valid(output.title,90)||!valid(output.claim,150)||!valid(output.reason,2000)
    ||!Array.isArray(output.body)||output.body.length!==page.body.length||output.body.some(v=>!valid(v,180))
    ||!output.visual||Object.keys(output.visual).sort().join(',')!=='caption,kind,purpose,subject'||output.visual.kind!==page.visual.kind
    ||!valid(output.visual.subject,400)||!valid(output.visual.purpose,400)||!valid(output.visual.caption,180))throw new Error('CHAPTER_PAGE_CORRECTION_OUTPUT')
  const chapter=structuredClone(draft.chapter),target=chapter.pages.find(p=>p.id===request.pageId)!
  Object.assign(target,{title:output.title,claim:output.claim,body:output.body,visual:{...target.visual,...output.visual}})
  return chapter
}
