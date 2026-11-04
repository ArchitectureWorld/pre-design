export const titles = ['项目基本情况','城市与周边','项目发展方向','人群与需求','竞品与案例分析','场地现状','功能与项目内容','空间布局与建设方案','开发与运营','投资与实施','结论与建议']
export function draft(materialId) {
  return {conditions:['study_area','project_boundary','land_use','planning_controls'].map(id=>({id,status:'unverified',detail:'尚未核实本次项目条件',evidenceIndexes:[]})),summary:'任务书已提供项目所在地；本次策划边界还需澄清。',
    evidence:materialId?[{materialId,kind:'content',locator:'第1行',summary:'任务书提供项目所在地。',quote:'任务书提供项目所在地。',startLine:1,endLine:1}]:[],
    chapters:titles.map((title,i)=>({id:String(i+1).padStart(2,'0'),title,disposition:'include',reason:'本阶段需要',readiness:'limited',canDo:['先整理资料'],cannotDo:['作出专业结论'],unlockWhen:['补齐本项目资料'],requires:[],tasks:[`${title}的本项目研究任务`],basis:materialId?[materialId]:[],gaps:['成果深度待明确'],dependsOn:i===4?['01','02','03','04']:[]})),
    scales:{direct:'项目周边联系，具体范围待核实',service:'服务人群待确认',comparison:'根据服务竞争关系确定，不设固定半径'},
    questions:[{id:'goal',prompt:'本次策划需要支持什么决策？',reason:'决定章节深度与成果要求',chapterIds:['03','11'],blocking:true}],
    feedback:'第5章综合前4章，检验并反馈修正第3章。'}
}
export const readFixture=file=>({sourceRelativePath:file.sourceRelativePath,contentHash:file.sha256,status:'ok',kind:'text',startLine:1,endLine:1,text:'任务书提供项目所在地。'})
// Unrelated downstream tests explicitly start after the user's outline gate.
// The outline API tests exercise the actual discussion/confirmation endpoints.
export async function confirmedOutlineFixture(db,id){
 const {outlineInputHash}=await import('../../src/outline-contract.mjs')
 const project=(await db.query('SELECT * FROM projects WHERE id=$1',[id])).rows[0]
 const materials=(await db.query('SELECT * FROM materials WHERE project_id=$1',[id])).rows
 const value=draft();value.questions=[];for(const c of value.chapters){c.readiness='ready';c.cannotDo=[]}for(const c of value.conditions)c.status='supported'
 await db.query('INSERT INTO outline_versions(project_id,version,input_hash,draft,confirmed_at,confirmed_by,flow,flow_reviewed) VALUES($1,1,$2,$3,now(),$4,$5,true) ON CONFLICT(project_id,version) DO UPDATE SET input_hash=EXCLUDED.input_hash,confirmed_at=now()',[id,outlineInputHash(project,materials),value,project.owner_id,JSON.stringify(value.chapters.map(c=>c.id))])
}
