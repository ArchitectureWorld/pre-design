import {describe,it,expect} from 'vitest'
import {registerPreplanningCommands} from '../src/commands/register.ts'
import type {CommandDefinition} from '@deepseek-ai/dsh-commands'
function commands(research:unknown){ const rows:CommandDefinition[]=[];registerPreplanningCommands({commands:{register:(d:CommandDefinition)=>rows.push(d)}} as never,{repository:{readContext:()=>({project:{projectId:'p',name:'少潭河'}})},runtime:{initializeProject:()=>{throw Error('LEGACY_DISPATCH')}},coordinator:{start:()=>{throw Error('LEGACY_DISPATCH')},pause:()=>{throw Error('LEGACY_PAUSE')}},unifiedResearch:research,now:()=>'',createId:()=>''} as never);return rows }
describe('62项统一入口',()=>{
 it('主入口执行新版研究而不触发旧57项',async()=>{let called=false;const run=commands({run:async()=>{called=true;return{kind:'success',text:'62项'}}}).find(d=>d.name==='preplan-run')!;expect(await run.handler({agent:{id:'s'}} as never)).toEqual({kind:'success',text:'62项'});expect(called).toBe(true)})
 it('暂停命令直接取消新版研究',async()=>{const pause=commands({pause:async()=>({kind:'success',text:'已提交取消'})}).find(d=>d.name==='preplan-pause')!;expect(await pause.handler({agent:{id:'s'}} as never)).toEqual({kind:'success',text:'已提交取消'})})
})

import {ConditionalReportPackageService} from '../src/report/conditional-package-service.ts'
it('异步新版独审未完成时阻止报告，即便旧Gate均通过',async()=>{let sourceCalled=false;const s=new ConditionalReportPackageService({isComplete:async()=>false,currentRevision:()=>1,source:async()=>{sourceCalled=true;throw Error('SOURCE_STARTED')},onState:async()=>{},governance:{readProject:()=>({workflowRuns:[],gateDecisions:Array.from({length:8},(_,i)=>({gateId:'G'+(i+1),decision:'approved'}))})}} as never);await expect(s.generate('p',1)).rejects.toThrow('REPORT_WORKFLOWS_INCOMPLETE');expect(sourceCalled).toBe(false)})

it('新版模式拒绝修改旧Gate，避免旧批准进入新版审查',async()=>{const gate=commands({run:async()=>({kind:'success'})}).find(d=>d.name==='preplan-gate')!;expect(await gate.handler({agent:{id:'s'},rawInput:'G1 approved'} as never)).toEqual({kind:'error',text:expect.stringContaining('只读')})})
