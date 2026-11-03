import {expect,it} from 'vitest'
import {buildApprovedChapterPrompt} from '../src/report/chapter-plan.ts'
import {expandPlanningSourcePrompt} from '../src/report/manuscript/source-prompt.ts'

it('shares repeated approved evidence losslessly without changing the approved plan or numeric assumptions',()=>{
 const repeated='完整来源依据：单价是假设，实际采购待确认；'.repeat(120)
 const sources=Array.from({length:15},(_,i)=>({id:'R-'+i,objectId:'research',fieldPath:'row'+i,text:'记录'+i,basis:'第'+i+'条；'+repeated,evidenceIds:[]}))
 const brief:any={plan:{chapterId:'operation',title:'运营测算',summary:'运营年场次与价格均为情景假设。',pages:[{id:'operation-model',title:'运营模型',content:{amount:123.45,notes:['保留期间、单位与责任边界。']}}],sources},approval:{origin:'user-message',scope:'chapter',message:'完成后续章节'}}
 const before=structuredClone(brief),prompt=buildApprovedChapterPrompt(brief),expanded=expandPlanningSourcePrompt(prompt)
 expect(prompt.length).toBeLessThan(JSON.stringify(brief.plan).length*.6)
 expect(expanded).toContain(JSON.stringify(brief.plan))
 expect(brief).toEqual(before)
 expect(expanded).toContain('123.45')
})
