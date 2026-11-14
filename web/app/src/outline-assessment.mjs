import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {z} from 'zod'

export const assessmentSkill=readFileSync(new URL('./skills/outline-readiness/SKILL.md',import.meta.url),'utf8')
export const assessmentSkillHash=createHash('sha256').update(assessmentSkill).digest('hex')
export const assessmentSchema=z.object({
  level:z.enum(['blocked','inventory','conditional','quantitative','implementation']),
  evidenceIndexes:z.array(z.number().int().min(0).max(79)).max(12),
}).strict()

export function assessmentIssue(chapter,draft) {
  const {level,evidenceIndexes}=chapter.assessment
  const evidence=evidenceIndexes.map(i=>draft.evidence[i])
  if(evidence.some(e=>!e||!chapter.basis.includes(e.materialId)))return '深度判断引用了不存在或不属于本章的依据'
  if(level==='blocked')return chapter.readiness==='ready'?'暂缓任务不能标为专业就绪':null
  if(!chapter.canDo.length)return '所选深度缺少本轮可交付内容'
  if(level==='inventory')return null
  if(chapter.readiness==='blocked'||!evidence.some(e=>e.kind==='content'))return '条件策划、量化或实施核查需要已读取的本章内容依据'
  if(['quantitative','implementation'].includes(level)&&chapter.requires.some(id=>!draft.conditions.some(c=>c.id===id&&c.status==='supported')))return '量化或实施核查的资料前置条件未满足'
  return null
}
