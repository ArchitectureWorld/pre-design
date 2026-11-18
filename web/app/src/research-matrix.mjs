import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {z} from 'zod'
const registry=JSON.parse(readFileSync(new URL('./dossier/capability-registry.json',import.meta.url),'utf8'))
const skill=readFileSync(new URL('./skills/professional-research/SKILL.md',import.meta.url),'utf8')
export const researchSkillHash=createHash('sha256').update(skill).update(JSON.stringify(registry.skills.filter(s=>s.family==='C'))).digest('hex')
const fail=message=>{throw Object.assign(new Error(message),{code:'WORKFLOW_RESEARCH_INVALID',statusCode:409})}
const text=z.string().trim().min(1).max(1600)
const conclusion=z.object({kind:z.enum(['fact','inference','proposal']),text,evidenceIndexes:z.array(z.number().int().nonnegative()).max(80),assumptions:z.array(text).max(8)}).strict()
export const researchFindingsSchema=z.array(z.object({taskId:z.string().regex(/^outline-(0[1-9]|1[01])-([1-9]|1[0-2])$/),skillIds:z.array(z.string()).min(1).max(5),status:z.enum(['supported','conditional','insufficient']),answer:text,conclusions:z.array(conclusion).max(8),gaps:z.array(text).max(12)}).strict()).max(132)
export function compileResearchPlan(outline){
 const flow=outline?.flow
 if(!Array.isArray(flow)||!flow.length||new Set(flow).size!==flow.length)fail('研究编排章节缺失或重复')
 const chapters=new Map((outline.draft?.chapters??[]).map(c=>[c.id,c]))
 const tasks=flow.flatMap(id=>{
  const chapter=chapters.get(id),skillIds=registry.skills.filter(s=>s.family==='C'&&s.id.startsWith('C'+id+'.')).map(s=>s.id)
  if(!skillIds.length||!chapter?.tasks?.length||chapter.tasks.length>12)fail('研究章节或任务不合法')
  const depth=chapter.assessment?.level??'inventory'
  if(!['inventory','conditional','quantitative','implementation','blocked'].includes(depth))fail('研究深度不合法')
  return chapter.tasks.map((title,i)=>({id:`outline-${id}-${i+1}`,chapterId:id,title,skillIds,depth,limitations:[...new Set([...(chapter.gaps??[]),...(chapter.cannotDo??[])])]}))
 })
 const executionOrder=[],visiting=new Set(),visited=new Set(),selected=new Set(flow),externalDependencies=[]
 function visit(id){
  if(visiting.has(id))fail('研究章节依赖存在循环')
  if(visited.has(id))return
  visiting.add(id)
  const dependencies=chapters.get(id).dependsOn??[]
  if(dependencies.some(next=>!registry.chapters.some(c=>c.id===next)))fail('研究依赖章节不合法')
  const external=[...new Set(dependencies.filter(next=>!selected.has(next)))]
  if(external.length)externalDependencies.push({chapterId:id,dependsOn:external,state:'not_selected_requires_existing_evidence'})
  for(const next of dependencies.filter(next=>selected.has(next)))visit(next)
  visiting.delete(id);visited.add(id);executionOrder.push(id)
 }
 for(const id of ['01','02','06','03','04','05','07','08','09','10','11'].filter(id=>selected.has(id)))visit(id)
 return {schemaVersion:'pre-design.research-plan.v1',skillHash:researchSkillHash,outlineVersion:outline.version,reportOrder:[...flow],executionOrder,externalDependencies,tasks,skillCatalog:registry.skills.filter(s=>s.family==='C'&&tasks.some(t=>t.skillIds.includes(s.id))).map(({id,name})=>({id,name})),
  feedback:flow.includes('03')&&flow.some(id=>['04','05'].includes(id))?[{from:['04','05'].filter(id=>flow.includes(id)),to:'03',action:'review_direction',requiresNewVersion:true}]:[],
  acceptance:'unreviewed',mode:'combined-research-and-writing'}
}
export function validateResearchFindings(input,plan,evidence){
 let findings
 try{findings=researchFindingsSchema.parse(input)}catch{fail('研究卡结构不完整；原稿保留')}
 const byId=new Map(findings.map(f=>[f.taskId,f]))
 if(findings.length!==plan.tasks.length||byId.size!==findings.length||plan.tasks.some(t=>!byId.has(t.id)))fail('研究卡须逐项覆盖本轮确认任务，不能遗漏或添加任务')
 for(const task of plan.tasks){
  const finding=byId.get(task.id)
  if(new Set(finding.skillIds).size!==finding.skillIds.length||finding.skillIds.some(id=>!task.skillIds.includes(id)))fail('研究卡 Skill 不属于本章或重复')
  if(finding.status==='insufficient'&&!finding.gaps.length)fail('资料不足必须说明具体研究缺口')
  if(finding.status!=='insufficient'&&!finding.conclusions.length)fail('研究判断必须保留结论')
  if(task.depth==='blocked'&&finding.status!=='insufficient')fail('暂缓研究任务不得返回已支持结论')
  for(const c of finding.conclusions){
   if(new Set(c.evidenceIndexes).size!==c.evidenceIndexes.length||c.evidenceIndexes.some(i=>!['content','official_policy'].includes(evidence[i]?.kind)))fail('研究结论只能引用已读取的内容依据')
   if(c.kind==='fact'&&!c.evidenceIndexes.length)fail('事实结论缺少内容依据')
   if(c.kind==='fact'&&c.assumptions.length)fail('带假设的结论不能标为事实')
   if(!c.evidenceIndexes.length&&!c.assumptions.length)fail('研究推断或建议缺少依据及明确假设')
  }
  if(finding.status==='supported'&&finding.conclusions.some(c=>c.assumptions.length||!c.evidenceIndexes.length))fail('含未核假设的研究须标为条件性结论')
 }
 return plan.tasks.map(t=>byId.get(t.id))
}
export function researchPrompt(plan){return `${skill}\n本轮研究编排（程序冻结，非业务验收结果）：${JSON.stringify(plan)}\n请先形成每个任务的 researchFindings，再据此写正文；只返回一次总JSON，不另行执行提交。`}
