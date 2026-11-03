import {sessionStatements,type SessionStatement} from '../runtime/material-research-intake.ts'

interface TaskEvent {readonly type:string;readonly seq:number;readonly time?:unknown;readonly data:unknown}
interface TaskSession {readonly id:string; snapshotEvents():readonly TaskEvent[]}
interface Dependencies {
 readonly live:(id:string)=>TaskSession|undefined
 readonly stat:(id:string)=>Promise<{readonly id:string;readonly revision:string}|undefined>
 readonly readEvents:(id:string)=>Promise<readonly TaskEvent[]|undefined>
}

/** Keep the small task projection, never a loaded Agent or its command history.
 * The native persistence revision is checked on every call and around a cold
 * read; live, possibly unflushed user messages always take precedence. */
export function createReportTaskStatementReader(dependencies:Dependencies):(id:string)=>Promise<readonly SessionStatement[]>{
 const cached=new Map<string,{revision:string;statements:readonly SessionStatement[]}>()
 const running=new Map<string,Promise<readonly SessionStatement[]>>()
 const project=(session:TaskSession)=>Object.freeze(sessionStatements({session}).map(s=>Object.freeze(s)))
 async function read(id:string):Promise<readonly SessionStatement[]>{
  const live=dependencies.live(id)
  if(live){if(String(live.id)!==id)throw new Error('REPORT_MODULE_TASK_CONTEXT_UNAVAILABLE');cached.delete(id);return project(live)}
  const before=await dependencies.stat(id)
  if(!before||before.id!==id||!before.revision){cached.delete(id);throw new Error('REPORT_MODULE_TASK_CONTEXT_UNAVAILABLE')}
  const prior=cached.get(id)
  if(prior?.revision===before.revision){const now=dependencies.live(id);return now?project(now):prior.statements}
  cached.delete(id)
  const events=await dependencies.readEvents(id)
  if(!events)throw new Error('REPORT_MODULE_TASK_CONTEXT_UNAVAILABLE')
  const statements=project({id,snapshotEvents:()=>events})
  const after=await dependencies.stat(id)
  const attached=dependencies.live(id)
  if(attached)return project(attached)
  if(!after||after.id!==id||after.revision!==before.revision)throw new Error('REPORT_MODULE_TASK_CONTEXT_CHANGED')
  cached.set(id,{revision:after.revision,statements})
  if(cached.size>16)cached.delete(cached.keys().next().value!)
  return statements
 }
 return id=>{
  const active=running.get(id)
  if(active)return active
  const pending=read(id).finally(()=>{if(running.get(id)===pending)running.delete(id)})
  running.set(id,pending);return pending
 }
}
