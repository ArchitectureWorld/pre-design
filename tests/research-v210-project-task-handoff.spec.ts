import {expect,it} from 'vitest'
import * as task from '../src/research-v2/project-task-audit.ts'
import {loadPlanningCatalog} from '../src/research-v2/catalog.ts'
import {projectResearchPlan} from '../src/research-v2/planning.ts'
import {getResearchModuleSpec} from '../src/research-v2/specification.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'

const statement={sessionId:'synthetic-session',seq:1,time:'2026-10-08T00:00:00.000Z',text:'Study alternatives and deliver a report.'}
const brief=JSON.stringify(statement)
const candidate={outputs:{project_brief:{records:[{recordId:'temporary',
  originalStatement:{value:statement.text,claimClass:'decision',limitations:['Research request only']},
  timeRequirements:{value:null,claimClass:'missing',limitations:['No agreed delivery date']},
  principal:{value:null,claimClass:'missing',limitations:['No formal commission']}}]}},
  claims:[{claimId:'task-request',selector:'/outputs/project_brief/records/0/originalStatement/value',kind:'proposal' as const,
    value:statement.text,rationale:'Research request only.\ntask_statement_refs='+JSON.stringify([{sessionId:statement.sessionId,seq:1,quote:statement.text}])}],
  sourceValues:[],limitations:['No agreed delivery date','No formal commission']}
const flags={industryPlanning:true,existingBuildings:true,externalPartners:true,marketing:true}
const plan=projectResearchPlan(loadPlanningCatalog(),flags)
const configuration={projectId:'synthetic-project',snapshotId:'synthetic-snapshot',planHash:plan.hash,flags}
const build=(input=configuration)=>(task.buildProjectTaskAudit as any)(candidate,brief,input)
const checks=getResearchModuleSpec('1.01').qa.map((criterion,index)=>({criterion,status:index===1?'limited':'pass',
  rationale:index===1?'Task quotes are bound; M01 handoff has not run.':'Synthetic verified check'}))
const review={executionId:'synthetic-review',childId:'synthetic-child',verdict:'limited',stopReason:'completed',checks,limitations:['M01 handoff missing']}

it('receives the merged task in M01 with the actual configured 62-module plan, without granting acceptance',()=>{
  const before=hash(candidate),audit=build()
  expect(audit.taskConfiguration).toMatchObject({receiver:'M01',implementation:'projectResearchPlan',
    projectId:configuration.projectId,snapshotId:configuration.snapshotId,planHash:plan.hash,
    flags,activeModuleIds:plan.activeModuleIds,qualificationGranted:false})
  expect(audit.taskConfiguration.activeModuleIds).toHaveLength(62)
  expect(audit.taskConfiguration.taskFieldsHash).toBeTruthy()
  expect(hash(candidate)).toBe(before)
  expect(candidate.outputs.project_brief.records[0].timeRequirements.value).toBeNull()
})

it('refuses a grafted applicability plan and replays configuration against its frozen inputs',()=>{
  expect(()=>build({...configuration,planHash:'different-plan'})).toThrow(/MODULE_PROJECT_TASK_CONFIGURATION/)
  const audit=build()
  expect(()=>(task.verifyProjectTaskAudit as any)(candidate,brief,audit,configuration)).not.toThrow()
  expect(()=>(task.verifyProjectTaskAudit as any)(candidate,brief,audit,{...configuration,snapshotId:'foreign'})).toThrow(/MODULE_PROJECT_TASK_AUDIT/)
  expect(()=>(task.verifyProjectTaskAudit as any)(candidate,brief,audit)).toThrow(/MODULE_PROJECT_TASK_AUDIT/)
})

it('retains historical audit bytes but only allows one bounded handoff repair after the matching limited review',()=>{
  const old=task.buildProjectTaskAudit(candidate as any,brief),before=hash(old)
  const allowed=(task as any).projectTaskHandoffReplayAllowed
  expect(allowed).toBeTypeOf('function')
  expect(allowed(old,[review])).toBe(true)
  expect(allowed(build(),[review])).toBe(false)
  expect(allowed(old,[{...review,checks:checks.map((c,i)=>i===0?{...c,status:'fail'}:c)}])).toBe(false)
  expect(allowed(old,[{...review,checks:checks.map((c,i)=>i===1?{...c,rationale:'Invented task quote; revise the author'}:c)}])).toBe(false)
  expect(allowed({...old,taskRequestLocated:false},[review])).toBe(false)
  expect(hash(old)).toBe(before)
})
