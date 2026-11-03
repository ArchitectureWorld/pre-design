import { PLANNING_CHAPTER_IDS, type PlanningChapterId } from './manuscript/types.ts'
import { planningChapterTitle } from './manuscript/prompts.ts'

const ordinals=['第一章','第二章','第三章','第四章','第五章','第六章','第七章'] as const
const english=['DEVELOPMENT OPPORTUNITY','SITE CONDITIONS','POSITIONING AND STRATEGY','PRODUCT SYSTEM','SPATIAL ORGANIZATION','PHASING AND DELIVERY','OPERATION AND INVESTMENT'] as const
export function chapterProfile(id:PlanningChapterId='opportunity'){
  const index=PLANNING_CHAPTER_IDS.indexOf(id)
  if(index<0)throw new Error('CHAPTER_ID_INVALID')
  return {id,number:index+1,code:String(index+1).padStart(2,'0'),ordinal:ordinals[index]!,title:planningChapterTitle(id),english:english[index]!}
}
