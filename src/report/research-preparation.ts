import type { ResearchFlags } from '../research-v2/types.ts'
import { assertReportResearchReady, type ReportModuleResearchLoad } from './module-source.ts'
import { waitForReportTask } from './content-review.ts'

export async function ensureReportResearch(dependencies:{load:()=>Promise<ReportModuleResearchLoad>;start:(flags?:ResearchFlags)=>Promise<void>;wait:()=>Promise<void>},signal:AbortSignal,options:{readonly allowStart?:boolean}={}):Promise<ReportModuleResearchLoad>{
  signal.throwIfAborted()
  let load=await dependencies.load()
  if(load.status!=='ready'){
    if(options.allowStart===false)assertReportResearchReady(load)
    await dependencies.start(load.status==='not_requested'?undefined:load.selection.flags)
    await waitForReportTask(dependencies.wait(),signal)
    load=await dependencies.load()
  }
  signal.throwIfAborted();assertReportResearchReady(load);return load
}
