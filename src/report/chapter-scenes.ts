import { basename, join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import type { VisualAssetRecord } from '../governance/types.ts'
import type { ChapterAssetInput } from './chapter-production-export.ts'

export interface ChapterSceneBriefs {scenes:{key:string;title:string;pageIds:string[];prompt:string;reason:string}[]}
export interface ChapterSceneRequest {origin:string;message:string;baseManuscriptHash:string;pageIds:string[];feedback:string}
export function validateChapterSceneRequest(request:ChapterSceneRequest,manuscriptHash:string,pageIds:readonly string[]):void{
  if(request?.origin!=='user-message'||!request.message?.trim()||!request.feedback?.trim()||request.baseManuscriptHash!==manuscriptHash||!Array.isArray(request.pageIds)||!request.pageIds.length||request.pageIds.length>12||new Set(request.pageIds).size!==request.pageIds.length||request.pageIds.some(p=>!pageIds.includes(p)))throw new Error('CHAPTER_SCENE_REQUEST_INVALID')
}
export function mergeChapterSceneAssets(previous:ChapterAssetInput[],added:ChapterAssetInput[]):ChapterAssetInput[]{
  const merged=new Map(previous.map(a=>[a.id,a]))
  for(const a of added){if(merged.has(a.id)&&merged.get(a.id)!.sha256!==a.sha256)throw new Error('CHAPTER_SCENE_ASSET_CHANGED');merged.set(a.id,a)}
  return [...merged.values()]
}
export const chapterSceneSchema:ObjectJsonSchema={type:'object',additionalProperties:false,required:['scenes'],properties:{scenes:{type:'array',description:'提交1至6个不同的场景任务。',items:{type:'object',additionalProperties:false,required:['key','title','pageIds','prompt','reason'],properties:{key:{type:'string'},title:{type:'string'},pageIds:{type:'array',items:{type:'string'},description:'必须只含1至2个明确页面ID；同一原图最多使用两次，三个或更多页面会被程序拒绝。'},prompt:{type:'string'},reason:{type:'string'}}}}}}
export function validateChapterSceneBriefs(value:ChapterSceneBriefs,pageIds:readonly string[]):void{
  if(!value||!Array.isArray(value.scenes)||value.scenes.length<1||value.scenes.length>6||new Set(value.scenes.map(s=>s.key)).size!==value.scenes.length)throw new Error('CHAPTER_SCENE_BRIEFS: submit 1-6 distinct relevant scenes')
  for(const s of value.scenes){
    if(Array.isArray(s?.pageIds)&&s.pageIds.length>2)throw new Error(`CHAPTER_SCENE_PAGE_LIMIT: ${s.key}.pageIds has ${s.pageIds.length} entries; maximum 2. Split the scene assignments or keep only two pages.`)
    if(!s||typeof s.key!=='string'||!/^[a-z0-9-]{3,40}$/.test(s.key)||typeof s.title!=='string'||!s.title.trim()||typeof s.reason!=='string'||!s.reason.trim()||typeof s.prompt!=='string'||s.prompt.length<40||!Array.isArray(s.pageIds)||!s.pageIds.length||new Set(s.pageIds).size!==s.pageIds.length||s.pageIds.some(id=>!pageIds.includes(id)))throw new Error('CHAPTER_SCENE_BRIEF_INVALID: '+s?.key)
  }
}
export async function chapterGeneratedScene(workspace:string,scene:ChapterSceneBriefs['scenes'][number],asset:VisualAssetRecord):Promise<ChapterAssetInput>{
  if(asset.kind!=='concept'||!['candidate','adopted'].includes(asset.status)||asset.quality?.accepted!==true||!asset.provider||!asset.model)throw new Error('CHAPTER_SCENE_NATIVE_ASSET_UNVERIFIED')
  const path=join(workspace,'assets/images',basename(asset.fileName)),bytes=await readFile(path),sha256=createHash('sha256').update(bytes).digest('hex')
  if(sha256!==asset.sha256)throw new Error('CHAPTER_SCENE_ASSET_CHANGED')
  return {id:'product-'+asset.assetId,path,sha256,width:asset.width,height:asset.height,label:scene.title+'｜AI概念场景',visualKind:'product',sourceNote:`DSH原生概念场景，非现状实拍。适用页：${scene.pageIds.join('、')}。${scene.reason}；原生任务 ${asset.taskId}；实际模型 ${asset.provider}/${asset.model}；生成图须在公开图注保留概念身份。`}
}
