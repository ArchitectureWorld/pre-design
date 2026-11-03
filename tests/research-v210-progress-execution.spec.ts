import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach,expect,it} from 'vitest'
import {runModuleExecution,readModuleExecutionSummary,type ModuleAnalysisContext} from '../src/research-v2/module-execution.ts'
import {acceptProgressReview,controlledResearchReady,researchRestrictionCriteria,type ProgressReviewRequest} from '../src/research-v2/module-progress-review.ts'
import {getResearchModuleSpec} from '../src/research-v2/specification.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'
import {buildProjectTaskAudit} from '../src/research-v2/project-task-audit.ts'

const roots:string[]=[]
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true})})
async function request(){const root=await mkdtemp(join(tmpdir(),'research-progress-'));roots.push(root);return {workspaceRoot:root,projectId:'progress-fixture',snapshotId:'snapshot-progress',
  corpus:{documents:[],limitations:[],fingerprint:hash({documents:[],limitations:[]})},flags:{industryPlanning:false,existingBuildings:false,externalPartners:false,marketing:false},
  moduleIds:['1.01','1.02','1.03','1.04'],taskBrief:'Explore options under explicit conditions.'}}
function analysis(context:ModuleAnalysisContext,native=true){
  const outputs=Object.fromEntries(context.module.ports.map(port=>[port.name,{type:port.type,quality:'limited',scope:'fixture',asOf:'2026-09-26',
    records:[{choice:'Bounded comparison'}],claimRefs:[port.name],limitations:['Current rights unknown']}]))
  const candidate={outputs,claims:context.module.ports.map(port=>({claimId:port.name,selector:`/outputs/${port.name}/records/0/choice`,kind:'proposal' as const,
    value:'Bounded comparison',rationale:'Options study only; current rights remain unverified.'})),sourceValues:[],limitations:['Current rights unknown']}
  const steps=[1,2,3,4].map(step=>({step,status:'limited' as const,summary:'Actual bounded study',claimRefs:[context.module.ports[0].name],limitations:candidate.limitations}))
  return {...candidate,...(native?{execution:{executionId:'author-'+context.module.id,childId:'author-child-'+context.module.id,actualModel:{provider:'fixture',model:'text'},stopReason:'completed',steps,
    ...(context.researchRestrictions?{researchRestrictions:context.researchRestrictions}:{}),
    reviewReceipts:[{executionId:'review-'+context.module.id,childId:'review-child-'+context.module.id,actualModel:{provider:'fixture',model:'review'},stopReason:'completed',
      ...(context.researchRestrictions?{progressRestrictionsHash:context.researchRestrictions.hash}:{}),
      candidateHash:hash({...candidate,steps}),checks:[...getResearchModuleSpec(context.module.id).qa.map(criterion=>({criterion,status:'limited' as const,rationale:'Current rights unknown'})),
        ...researchRestrictionCriteria(context.researchRestrictions).map(criterion=>({criterion,status:'pass' as const,rationale:'Only the allowed conditional comparison is present.'}))],limitations:candidate.limitations}]}}:{})}
}
function checkpoint(request:ProgressReviewRequest,hold=false){return acceptProgressReview(request,{requestHash:request.requestHash,verdict:hold?'pause':'continue',rationale:'Bounded research task remains aligned.',
  conditions:request.requiredConditions.map((c,i)=>({...c,permission:hold&&i===0?'hold':'proceed',reason:'Present rights remain unconfirmed.',verification:'Review again after the next three modules or premise change.'})),driftFindings:[]},
  {executionId:`overall-${request.reason}-${request.afterStep}`,childId:`overall-child-${request.reason}-${request.afterStep}`,actualModel:{provider:'fixture',model:'review'},stopReason:'completed'})}
const validateOutputs=()=>undefined
it('revises a selected limited module during full continuation without rewriting its immutable history',async()=>{
  const input={...await request(),moduleIds:['1.01']},original=await runModuleExecution(input,{validateOutputs,analyze:async context=>{
    const value=analysis(context),execution=value.execution!
    const audit=buildProjectTaskAudit({outputs:value.outputs,claims:value.claims,sourceValues:value.sourceValues,limitations:value.limitations,steps:execution.steps},context.taskBrief)
    return {...value,execution:{...execution,projectTaskAudit:audit,reviewReceipts:execution.reviewReceipts.map(receipt=>({...receipt,projectTaskAuditHash:hash(audit)}))}}
  },reviewProgress:async request=>checkpoint(request)})
  expect(original.moduleRuns[0].status).toBe('limited')
  const controller=new AbortController(),calls:string[]=[]
  const next=await runModuleExecution({...input,moduleIds:undefined,resumeRunIds:[original.manifestRunId],reviseModuleIds:['1.01'],signal:controller.signal} as never,{
    validateOutputs,reviewProgress:async request=>checkpoint(request),analyze:async context=>{
      expect(context.resumeExecutionAudit).toBeUndefined()
      expect(context.priorModuleReview?.reviewReceipts).toEqual(original.results[0].execution!.reviewReceipts)
      calls.push(context.module.id);controller.abort(new Error('Stop after proving the requested native boundary'))
      return analysis(context)
    },
  })
  expect(calls).toEqual(['1.01'])
  expect(next.moduleRuns.find(row=>row.itemId==='1.01')?.status).toBe('cancelled')
  expect(await readModuleExecutionSummary(input.workspaceRoot,original.manifestRunId,{validateOutputs})).toMatchObject(original)
})
it('does not propagate a conclusion-only hold to the entire module dependency chain and rejects omitted restriction context',async()=>{
  for(const omit of [false,true]){
    const input=await request(),analyzed:string[]=[]
    const summary=await runModuleExecution(input,{validateOutputs,analyze:async context=>{
      analyzed.push(context.module.id)
      const candidate=analysis(context)
      if(omit&&context.researchRestrictions)return {...candidate,execution:{...candidate.execution!,researchRestrictions:undefined}}
      return candidate
    },reviewProgress:async request=>acceptProgressReview(request,{requestHash:request.requestHash,verdict:'pause',rationale:'Pause exact implementation conclusions; background comparisons may continue.',
      conditions:request.requiredConditions.map((c,i)=>({...c,permission:i?'proceed':'hold',reason:'Rights unknown.',verification:'Review after three further substantive modules.',
        scope:i?{kind:'none',allowedUses:[],heldUses:[],reviewAfterModules:3}:{kind:'conclusions',allowedUses:['Conditional comparison'],heldUses:['Implementation authorization'],reviewAfterModules:3}})),driftFindings:[]},
      {executionId:`scoped-${request.reason}-${request.afterStep}`,childId:`scoped-child-${request.reason}-${request.afterStep}`,actualModel:{provider:'fixture',model:'review'},stopReason:'completed'})})
    expect(analyzed).toEqual(['1.01','1.02','1.03','1.04'])
    if(omit){expect(summary.moduleRuns.at(-1)!.error).toBe('MODULE_RESTRICTION_CONTEXT_MISSING');expect(controlledResearchReady(summary)).toBe(false)}
    else {expect(summary.results.at(-1)!.execution!.researchRestrictions).toBeTruthy();expect(controlledResearchReady(summary)).toBe(true)}
    await expect(readModuleExecutionSummary(input.workspaceRoot,summary.manifestRunId,{validateOutputs})).resolves.toMatchObject(summary)
  }
})

it('reviews after three modules before the fourth, persists the final permission and preserves limited status',async()=>{
  const input=await request(),events:string[]=[]
  const summary=await runModuleExecution(input,{validateOutputs,analyze:async context=>{events.push(context.module.id);return analysis(context)},
    reviewProgress:async request=>{events.push(request.reason);return checkpoint(request)},onProgressReview:()=>{throw Error('Optional notification unavailable')}})
  expect(events).toEqual(['1.01','1.02','1.03','three-modules','1.04','phase-end'])
  expect(summary.moduleRuns.every(row=>row.status==='limited')).toBe(true)
  expect(summary.status).toBe('partial')
  expect(controlledResearchReady(summary)).toBe(true)
  expect(await readModuleExecutionSummary(input.workspaceRoot,summary.manifestRunId,{validateOutputs})).toMatchObject(summary)
})
it('continues only the expressly allowed uses of a scoped drift and persists its restriction through downstream QA',async()=>{
  for(const mode of ['scoped','legacy','hard','omitted']){
    const input=await request(),calls:string[]=[]
    const summary=await runModuleExecution(input,{validateOutputs,analyze:async context=>{
      calls.push(context.module.id)
      const value=analysis(context)
      if(context.module.id==='1.04'){
        expect(context.researchRestrictions?.conditions.some(c=>c.criterion.includes('Study completed'))).toBe(true)
        if(mode==='omitted')return {...value,execution:{...value.execution!,researchRestrictions:undefined}}
      }
      return value
    },reviewProgress:async request=>acceptProgressReview(request,{requestHash:request.requestHash,verdict:'pause',rationale:'Only the unsupported completion statement is held.',
      conditions:request.requiredConditions.map(c=>({...c,permission:'proceed',reason:'Conditional study may continue.',verification:'Revisit in three modules.'})),
      driftFindings:[{severity:'major',itemIds:['1.01'],finding:'Study completed overstates the still-limited costs.',correction:'Withdraw that completion claim.',
        ...(mode==='legacy'?{}:{scope:{kind:mode==='hard'?'module-and-downstream':'conclusions',allowedUses:mode==='hard'?[]:['Conditional options'],heldUses:['Study completed'],reviewAfterModules:3}})}]},
      {executionId:`drift-${request.reason}-${request.afterStep}`,childId:`drift-child-${request.reason}-${request.afterStep}`,actualModel:{provider:'fixture',model:'review'},stopReason:'completed'})})
    expect(calls).toEqual(mode==='legacy'||mode==='hard'?['1.01','1.02','1.03']:['1.01','1.02','1.03','1.04'])
    expect(controlledResearchReady(summary)).toBe(mode==='scoped')
    if(mode==='omitted')expect(summary.moduleRuns.at(-1)?.error).toBe('MODULE_RESTRICTION_CONTEXT_MISSING')
    if(mode==='legacy'||mode==='hard')expect(summary.moduleRuns.at(-1)?.error).toBe('MODULE_PROGRESS_REVIEW_HOLD')
    await expect(readModuleExecutionSummary(input.workspaceRoot,summary.manifestRunId,{validateOutputs})).resolves.toMatchObject(summary)
  }
})
it('pauses the affected downstream chain and closes request-construction and native-review failures',async()=>{
  for(const mode of ['hold','missing-native','review-error']){
    const input=await request(),calls:string[]=[]
    const summary=await runModuleExecution(input,{validateOutputs,analyze:async context=>{calls.push(context.module.id);return analysis(context,mode!=='missing-native')},
      reviewProgress:async request=>{if(mode==='review-error')throw Error('Reviewer unavailable');return checkpoint(request,mode==='hold')}})
    expect(calls).toEqual(['1.01','1.02','1.03'])
    expect(controlledResearchReady(summary)).toBe(false)
    if(mode==='hold')expect(summary.moduleRuns.at(-1)?.error).toBe('MODULE_PROGRESS_REVIEW_HOLD')
    else expect(summary.researchProgress?.failure).toBeTruthy()
    expect(await readModuleExecutionSummary(input.workspaceRoot,summary.manifestRunId,{validateOutputs})).toMatchObject(summary)
  }
})
it('persists cancellation during the final review without making a ready draft',async()=>{
  const input=await request(),controller=new AbortController()
  const summary=await runModuleExecution({...input,moduleIds:['1.01'],signal:controller.signal},{validateOutputs,analyze:async context=>analysis(context),
    reviewProgress:async request=>{controller.abort();throw Error('Cancelled overall review')}})
  expect(summary.status).toBe('cancelled')
  expect(summary.researchProgress?.cancelled).toBe(true)
  expect(controlledResearchReady(summary)).toBe(false)
  expect(await readModuleExecutionSummary(input.workspaceRoot,summary.manifestRunId,{validateOutputs})).toMatchObject(summary)
})
