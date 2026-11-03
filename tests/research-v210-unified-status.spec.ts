import {it,expect} from 'vitest'
import {buildPreplanningStatus,formatPreplanningStatus,parsePreplanningStatus,normalizePreplanningStatus} from '../src/session/events.ts'
it('新版研究进度和回放排除旧流程阶段、阻断和Gate',()=>{
 const progress={scheme:'research-v210' as const,status:'running',total:62,qualified:0,stage:'1.01',blockers:[],chapters:Array.from({length:8},(_,i)=>({id:String(i+1).padStart(2,'0'),total:[6,8,9,9,9,8,6,7][i],completed:0,gateStatus:'pending'}))}
 const status=buildPreplanningStatus({project:{projectId:'p',name:'少潭河',currentRevision:1,currentStage:'旧57项'},proposals:[],questions:[]} as never,{
 governance:{readProject:()=>({policy:{mode:'automatic',reportDepth:'standard'},gateDecisions:[],visualAssets:[],visualTasks:[],siteBoundaries:[],reportPackages:[]})},
 runtime:{snapshot:()=>({runs:[{workItemId:'旧57项',status:'blocked'}],blocked:[{workflowId:'old',workItemId:'old',blockedReason:'旧阻断'}],chapters:[]})},
 researchProgress:()=>progress} as never)
 expect(status.stage).toBe('1.01');expect(status.blocked).toBe(0);expect(status.blockers).toEqual([])
 expect(parsePreplanningStatus(formatPreplanningStatus(status))).toEqual(status)
 expect(normalizePreplanningStatus({...status,researchProgress:{...progress,qualified:99}})).toBeUndefined()
})
