import {sha256CanonicalJson as hash} from '../presentation/canonical-json.ts'
import {loadPlanningCatalog,requireModule} from './catalog.ts'
import type {ModuleAnalysis,ModuleNativeExecutionReceipt} from './module-execution.ts'

export const MODULE_SYNTHESIS_VERSION='module-research-synthesis.v3' as const
export const MODULE_SYNTHESIS_FIXED_STEPS_VERSION='module-research-synthesis.v4' as const
type Candidate=ModuleAnalysis & {readonly steps:NonNullable<NonNullable<ModuleAnalysis['execution']>['steps']>}
interface SynthesisCore {
  readonly limitationBasisHash?:string
  readonly candidateHash:string
  readonly analysis:string
  readonly conclusion:string
  readonly claimRefs:readonly string[]
  readonly handoff:readonly {readonly moduleId:string;readonly use:string;readonly claimRefs:readonly string[];readonly conditions:readonly string[]}[]
  readonly limitations:readonly string[]
}
type StepFields=Omit<Candidate['steps'][number],'step'>
type FixedSteps=Readonly<Record<'step1'|'step2'|'step3'|'step4',StepFields>>
export type ModuleSynthesisJudgment=SynthesisCore & (
  {readonly version:typeof MODULE_SYNTHESIS_VERSION|'module-research-synthesis.v1'|'module-research-synthesis.v2';readonly steps:Candidate['steps'];readonly stepResults?:never}
  |{readonly version:typeof MODULE_SYNTHESIS_FIXED_STEPS_VERSION;readonly stepResults:FixedSteps;readonly steps?:never})
export interface ModuleSynthesisAudit {
  readonly judgment:ModuleSynthesisJudgment
  readonly execution:ModuleNativeExecutionReceipt
  readonly hash:string
}
const fail=(code:string):never=>{throw new Error(code)}
const text=(value:unknown):value is string=>typeof value==='string'&&Boolean(value.trim())

/** Read-only step view for existing progress/report consumers. The native v4
 * judgment, its fixed labels and hash remain unchanged in every stored audit. */
export function moduleSynthesisSteps(judgment:ModuleSynthesisJudgment):Candidate['steps']{
  if(judgment.version!==MODULE_SYNTHESIS_FIXED_STEPS_VERSION){
    if(!Array.isArray(judgment.steps))return fail('MODULE_SYNTHESIS_STEPS')
    return judgment.steps
  }
  const keys=['step1','step2','step3','step4'] as const,results=judgment.stepResults
  if(Object.hasOwn(judgment,'steps')||!results||typeof results!=='object'||Array.isArray(results)
    ||Object.keys(results).length!==4||keys.some(key=>!Object.hasOwn(results,key)||!results[key]||typeof results[key]!=='object'
      ||Array.isArray(results[key])||Object.hasOwn(results[key],'step')))return fail('MODULE_SYNTHESIS_STEPS')
  return keys.map((key,index)=>({...results[key],step:index+1}))
}

/** The synthesis adds the native researcher's integrated judgment; it never rewrites field submissions. */
export function acceptModuleSynthesis(candidate:Candidate,judgment:ModuleSynthesisJudgment,execution:ModuleNativeExecutionReceipt):ModuleSynthesisAudit {
  if(![MODULE_SYNTHESIS_VERSION,MODULE_SYNTHESIS_FIXED_STEPS_VERSION,'module-research-synthesis.v1','module-research-synthesis.v2'].includes(judgment.version)||judgment.candidateHash!==hash(candidate))fail('MODULE_SYNTHESIS_BINDING')
  const ids=new Set(candidate.claims.map(claim=>claim.claimId))
  const references=(refs:readonly string[],allowEmpty=false)=>{
    if(!Array.isArray(refs)||!allowEmpty&&!refs.length||new Set(refs).size!==refs.length||refs.some(id=>!ids.has(id)))fail('MODULE_SYNTHESIS_CLAIMS')
  }
  if(!text(judgment.analysis)||!text(judgment.conclusion))fail('MODULE_SYNTHESIS_CONCLUSION')
  references(judgment.claimRefs)
  if(!Array.isArray(judgment.limitations)||judgment.limitations.some(value=>!text(value)))fail('MODULE_SYNTHESIS_LIMITATIONS')
  if(judgment.version==='module-research-synthesis.v1'){
    // Historical acceptance remains byte-for-byte replayable; failed old drafts stay rejected.
    if(candidate.limitations.some(value=>!judgment.limitations.includes(value)))fail('MODULE_SYNTHESIS_LIMITATIONS')
  }else if(judgment.limitationBasisHash!==hash(candidate.limitations)||candidate.limitations.length&&!judgment.limitations.length)fail('MODULE_SYNTHESIS_LIMITATIONS')
  const steps=moduleSynthesisSteps(judgment)
  if(!Array.isArray(steps)||steps.length!==4||new Set(steps.map(step=>step.step)).size!==4)fail('MODULE_SYNTHESIS_STEPS')
  for(const step of steps){
    if(![1,2,3,4].includes(step.step)||!['completed','limited'].includes(step.status)||!text(step.summary)
      ||!Array.isArray(step.limitations)||step.limitations.some((value:unknown)=>!text(value))||step.status==='limited'&&!step.limitations.length)fail('MODULE_SYNTHESIS_STEPS')
    // An unperformed, explicitly limited step cannot fabricate supporting claims.
    // v1/v2 keep their original strict rule for immutable historical replay.
    references(step.claimRefs,(judgment.version===MODULE_SYNTHESIS_VERSION||judgment.version===MODULE_SYNTHESIS_FIXED_STEPS_VERSION)&&step.status==='limited')
  }
  if(!Array.isArray(judgment.handoff))fail('MODULE_SYNTHESIS_HANDOFF')
  for(const row of judgment.handoff){
    const catalog=loadPlanningCatalog(),target=catalog.modules.find(module=>module.moduleId===row.moduleId)
    requireModule(catalog,target?.id??row.moduleId)
    if(!text(row.use)||!Array.isArray(row.conditions)||row.conditions.some(value=>!text(value)))fail('MODULE_SYNTHESIS_HANDOFF')
    references(row.claimRefs)
  }
  if(!text(execution.executionId)||!text(execution.childId)||!text(execution.actualModel?.provider)||!text(execution.actualModel?.model)
    ||execution.stopReason!=='completed')fail('MODULE_SYNTHESIS_NATIVE')
  const core={judgment:structuredClone(judgment),execution:structuredClone(execution)}
  return {...core,hash:hash(core)}
}
export function verifyModuleSynthesis(candidate:Candidate,audit:ModuleSynthesisAudit):void {
  if(hash(acceptModuleSynthesis(candidate,audit.judgment,audit.execution))!==hash(audit))fail('MODULE_SYNTHESIS_BINDING')
}
