import {describe,expect,it} from 'vitest'
import {createReportTaskStatementReader} from '../src/report/task-statements.ts'
import {assertReportTaskUnchanged} from '../src/report/module-source.ts'
import {sha256CanonicalJson} from '../src/presentation/canonical-json.ts'

const user=(seq:number,text:string)=>({seq,type:'user/message',time:'2026-10-14T00:00:00Z',data:{source:{kind:'user'},content:[{type:'text',text}]}})
describe('report task verification without resuming the research parent',()=>{
 it('retains only genuine user statements, joins concurrent reads and invalidates on a native revision change',async()=>{
  let revision='one',reads=0
  let events=[user(0,'原策划任务'),{seq:1,type:'command/done',time:'2026-10-14T00:00:01Z',data:{result:{text:'large old status output'}}}]
  const load=createReportTaskStatementReader({live:()=>undefined,stat:async id=>({id,revision}),readEvents:async()=>{reads++;return events}})
  const [first,second]=await Promise.all([load('research-parent'),load('research-parent')])
  expect(first).toEqual([{sessionId:'research-parent',seq:0,time:'2026-10-14T00:00:00.000Z',text:'原策划任务'}])
  expect(second).toEqual(first);expect(reads).toBe(1)
  await load('research-parent');expect(reads).toBe(1)
  const selection={status:'not_ready',selection:{version:'report-module-selection.v1',selectionId:'selection',
   binding:{projectId:'project',workspaceRoot:'workspace',standardProjectId:'standard'},parentId:'research-parent',
   snapshotId:'snapshot',snapshotRoot:'workspace',flags:{industryPlanning:true,existingBuildings:true,externalPartners:true,marketing:true},
   expectedModuleIds:[],corpusFingerprint:'corpus',taskBriefHash:'brief',catalogHash:'catalog',planHash:'plan',
   statementKeys:first.map(sha256CanonicalJson)}} satisfies Parameters<typeof assertReportTaskUnchanged>[0]
  expect(()=>assertReportTaskUnchanged(selection,first)).not.toThrow()
  revision='two';events=[...events,user(2,'改为开发住宿度假')]
  const changed=await load('research-parent');expect(reads).toBe(2)
  expect(()=>assertReportTaskUnchanged(selection,changed)).toThrow('REPORT_MODULE_TASK_CHANGED')
 })
 it('does not reuse a deleted, mismatched, or concurrently modified archive',async()=>{
  let revision='one',exists=true,wrong=false,mutate=false
  const load=createReportTaskStatementReader({live:()=>undefined,stat:async id=>exists?{id:wrong?'another':id,revision}:undefined,
   readEvents:async()=>{if(mutate)revision='three';return [user(0,'任务')]}})
  await load('parent');exists=false
  await expect(load('parent')).rejects.toThrow('REPORT_MODULE_TASK_CONTEXT_UNAVAILABLE')
  exists=true;wrong=true
  await expect(load('parent')).rejects.toThrow('REPORT_MODULE_TASK_CONTEXT_UNAVAILABLE')
  wrong=false;revision='two';mutate=true
  await expect(load('parent')).rejects.toThrow('REPORT_MODULE_TASK_CONTEXT_CHANGED')
 })
 it('uses live user input immediately, including attachment during an archive read',async()=>{
  let live:undefined|{id:string;snapshotEvents:()=>ReturnType<typeof user>[]}
  const load=createReportTaskStatementReader({live:()=>live,stat:async id=>({id,revision:'same'}),readEvents:async()=>{
   live={id:'parent',snapshotEvents:()=>[user(1,'最新任务')]};return [user(0,'旧任务')]
  }})
  expect((await load('parent'))[0]?.text).toBe('最新任务')
  live={id:'parent',snapshotEvents:()=>[user(2,'再次调整')]}
  expect((await load('parent'))[0]?.text).toBe('再次调整')
 })
})
