import { test } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { webcrypto } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { ProjectWorkers } from '../../worker/runtime.mjs'
test('discards a dead worker after a failed bridge call without replaying that operation', async () => {
 const workers = new ProjectWorkers({}), p={id:'project'};let starts=0,closes=0
 workers.start=async()=>{starts++;return{rpc:async()=>{if(starts===1)throw new Error('ECONNREFUSED');return {revision:1}},harness:{close:async()=>{closes++}},temp:'/tmp/pre-web-test-nonexistent'}}
 await assert.rejects(workers.call(p,{operation:'confirm'}),/ECONNREFUSED/)
 assert.equal(starts,1)
 assert.deepEqual(await workers.call(p,{operation:'state'}),{revision:1})
 assert.equal(starts,2);assert.equal(closes,1)
})
function ui(){
 const actions=[],elements=new Map();const el=()=>({classList:{add(){},remove(){},toggle(){}},value:'',textContent:'',style:{}})
 const context=vm.createContext({console,crypto:{randomUUID:()=>String(Math.random())},sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},document:{addEventListener(){}},setTimeout,AbortController,
 state:{currentProjectId:'A',stage:'overview',scripts:{},annotations:[]},projectRecords:[{id:'A',name:'A'}],$:(id)=>{if(!elements.has(id))elements.set(id,el());return elements.get(id)},closeProjectMenu(){},closeLibrary(){},setStage(stage){context.state.stage=stage;actions.push(stage)},enterWorkspace(){actions.push('workspace')},toast(){}})
 return {context,actions,elements}
}
const source=await readFile(new URL('../src/prototype-api.js',import.meta.url),'utf8')
test('proposal review exposes actual quality issues in the existing evidence sidebar',()=>{
 const {context}=ui();context.updateProjectSwitcher=()=>{};
 vm.runInContext(source+'\nglobalThis.test={applySnapshot};',context)
 const payload={data:{canonical_name:'测试'},quality:{issues:['约860平方米未经测绘核验','产权资料待补充']}}
 const value={id:'A',name:'测试',revision:0,materials:[],annotations:[],core:{stateObjects:[],proposals:[{proposalId:'p',status:'pending_review',envelope:{target_object_id:'PS01',change_set:{payload}}}]}}
 context.test.applySnapshot(value)
 assert.match(context.state.scripts['script-1-1'].evidence,/860平方米未经测绘核验/)
 assert.match(context.state.scripts['script-1-1'].evidence,/产权资料待补充/)
 value.core={stateObjects:[{objectId:'PS01',value:payload}],proposals:[]};context.test.applySnapshot(value)
 assert.match(context.state.scripts['script-1-1'].evidence,/860平方米未经测绘核验/)
})
test('LAN HTTP mutations work without secure-context crypto.randomUUID',async()=>{
 const {context}=ui();context.crypto={getRandomValues:array=>webcrypto.getRandomValues(array)};
 vm.runInContext(source+'\nglobalThis.test={server,mutate};',context);context.test.server.current={id:'A',revision:0}
 const ids=[];context.request=async(path,body)=>{ids.push(body.requestId);return{id:'job'}}
 vm.runInContext('api=request;refreshCurrent=async()=>{};',context)
 await context.test.mutate('chat',{text:'first'});await context.test.mutate('chat',{text:'second'})
 for(const id of ids)assert.match(id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
 assert.notEqual(ids[0],ids[1])
})
test('a delayed project load cannot override navigation to the overview', async()=>{
 const {context,actions}=ui();vm.runInContext(source+'\nglobalThis.test={server,openExistingProject};',context)
 let resolve;context.pending=new Promise(r=>resolve=r)
 vm.runInContext('refreshCurrent=()=>pending;updatePipelineUI=()=>{};watchProject=()=>{};',context)
 const loading=context.test.openExistingProject('A');await Promise.resolve()
 context.state.currentProjectId=null;context.state.stage='overview';context.test.server.navigation=(context.test.server.navigation||0)+1
 resolve();await loading;assert.ok(!actions.includes('workspace'))
})
test('an unacknowledged browser mutation keeps the same request identity on retry',async()=>{
 const {context}=ui();vm.runInContext(source+'\nglobalThis.test={server,mutate};',context);context.test.server.current={id:'A',revision:0}
 const ids=[];context.request=async(path,body)=>{ids.push(body.requestId);if(ids.length===1)throw new Error('response lost');return{id:'job'}}
 vm.runInContext('api=request;refreshCurrent=async()=>{};',context)
 await assert.rejects(context.test.mutate('chat',{text:'same message'}));await context.test.mutate('chat',{text:'same message'})
 assert.equal(ids[0],ids[1])
})
test('a cancelled creation does not upload files from the next project',async()=>{
 const {context,actions}=ui();context.state.files=[{name:'A.txt',file:{}}];context.state.projectName='A';context.state.projectType='公共建筑'
 vm.runInContext(source+'\nglobalThis.test={server,startProcessing};',context)
 let resolve;context.pending=new Promise(r=>resolve=r);const calls=[]
 context.request=(path)=>{calls.push(path);return context.pending}
 vm.runInContext('api=request;',context)
 const creation=context.test.startProcessing();await Promise.resolve()
 context.state.files=[{name:'B.txt',file:{}}];context.state.projectName='B';context.state.currentProjectId=null;context.test.server.navigation++
 resolve({id:'A'});await creation
 assert.deepEqual(calls,['/projects']);assert.equal(context.state.currentProjectId,null)
})
