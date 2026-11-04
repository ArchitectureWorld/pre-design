export const OUTLINE_CONDITIONS=Object.freeze([
 {id:'study_area',title:'本次研究范围'},
 {id:'project_boundary',title:'项目红线 / 实施边界'},
 {id:'land_use',title:'用地性质（现状与规划）'},
 {id:'planning_controls',title:'规划管控线及适用条件'},
])
export const REQUIRED_CONDITIONS=Object.freeze(Object.fromEntries(['06','07','08','09','10'].map(id=>[id,OUTLINE_CONDITIONS.map(c=>c.id)])))
// 专业研究仍使用原62模块；按任务含义关联新11章，不把旧章号当新章号。
const groups={
 '01':['1.01'],
 '06':['1.02','1.03','1.04','1.05','1.06','1.07','1.08'],
 '02':['2.01','2.02','2.03','2.05','2.06'],
 '04':['3.01','3.02','3.03','3.08'],
 '05':['2.04','3.04','3.05','3.06','3.07','4.01'],
 '03':['4.02','4.03','4.04','4.05','4.06','4.07'],
 '07':['5.01','5.02','5.03','5.04','5.05','5.06','5.07','5.08','5.09'],
 '08':['6.01','6.02','6.03','6.04','6.05','6.06','6.07','6.08','6.09'],
 '09':['7.01','7.02','7.03','7.04','7.05','7.06','7.07'],
 '10':['8.01','8.02','8.03','8.04','8.05','8.06','8.07','8.08'],
}
export const RESEARCH_OUTLINE_CHAPTERS=Object.freeze(Object.fromEntries(Object.entries(groups).flatMap(([chapter,modules])=>modules.map(id=>[id,chapter]))))
export function chapterBlockers(draft,id,visited=new Set()){
 if(visited.has(id))return [];visited.add(id)
 const chapter=draft?.chapters?.find(c=>c.id===id)
 if(!chapter)return ['章节资料就绪状态尚未核实']
 const blockers=[]
 if(chapter.disposition!=='include'||chapter.readiness!=='ready')blockers.push(`${chapter.title}：${chapter.disposition==='exclude'?'本轮不适用':chapter.readiness==='limited'?'仅可先梳理资料或提出假设，尚不具备专业成果条件':'缺条件暂缓'}`)
 for(const key of new Set([...(REQUIRED_CONDITIONS[id]??[]),...(chapter.requires??[])])){
  if(draft.conditions?.find(c=>c.id===key)?.status!=='supported')blockers.push(`${chapter.title}缺少已核实依据：${OUTLINE_CONDITIONS.find(c=>c.id===key)?.title??key}`)
 }
 for(const next of chapter.dependsOn??[])blockers.push(...chapterBlockers(draft,next,visited))
 return [...new Set(blockers)]
}
export function outlineAllowsWrites(state){return state?.status==='confirmed'&&(!state.flow||state.flow.length===11)&&state.draft?.chapters?.length===11&&state.draft.chapters.every(c=>!chapterBlockers(state.draft,c.id).length)}
export function assertOutlineExecutable(state,kind,selection={}){
 const fail=message=>{throw Object.assign(new Error(message),{statusCode:409,code:'OUTLINE_PREREQUISITES_REQUIRED'})}
 if(state.status!=='confirmed')fail('请先确认最新章节流程，再开展专业任务。')
 let chapters
 if(kind==='research'||kind==='report'&&selection.mode==='research-summary'){
  if(!selection.moduleIds?.length||selection.moduleIds.some(id=>!RESEARCH_OUTLINE_CHAPTERS[id]))fail('研究模块没有明确的章节和资料前置条件，不能启动。')
  chapters=[...new Set(selection.moduleIds.map(id=>RESEARCH_OUTLINE_CHAPTERS[id]))]
 }else{
  // 报告/提案确认/批注可能跨章；尚无可靠对象到新11章的绑定时保守检查全部章节，避免以已排除章节绕过限制。
  chapters=state.draft?.chapters?.map(c=>c.id)??[]
  if(!chapters.length)fail('章节资料就绪状态尚未核实')
 }
 if(state.flow&&chapters.some(id=>!state.flow.includes(id)))fail('所选任务不在用户已确认的本轮章节流程中，请先调整流程并重新核对。')
 const blockers=[...new Set(chapters.flatMap(id=>chapterBlockers(state.draft,id)))]
 if(blockers.length)fail(`资料前置条件未满足：${blockers.join('；')}。可以继续在章节梳理中核对资料、补充范围与调整任务；确认目录不会解除这些限制。`)
}
