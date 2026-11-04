import test from 'node:test'
import assert from 'node:assert/strict'
const agent=await import('../src/outline-agent.js').catch(()=>({}))

test('默认始终讨论，只有显式补充核对且流程有效时才更新草案',()=>{
 assert.equal(typeof agent.consultMessageMode,'function')
 const outline={flowReviewed:true,status:'draft',busy:false}
 assert.equal(agent.consultMessageMode(outline,{dirty:false,pane:'review'}),'chat')
 assert.equal(agent.consultMessageMode(outline,{dirty:false,pane:'flow'}),'chat')
 assert.equal(agent.consultMessageMode(outline,{dirty:false,requestedMode:'outline'}),'outline')
 assert.equal(agent.consultMessageMode(outline,{dirty:true,requestedMode:'outline'}),'chat')
 assert.equal(agent.consultMessageMode({...outline,flowReviewed:false},{requestedMode:'outline'}),'chat')
 assert.equal(agent.consultMessageMode({...outline,status:'stale'},{requestedMode:'outline'}),'chat')
 assert.equal(agent.consultMessageMode({...outline,status:'stale',busy:true,lastJob:{status:'running'}},{requestedMode:'outline'}),'outline','正在更新的资料核对不能把补充草稿隐式切成讨论')
})

test('草稿按项目刷新恢复，收到发送回执时不清除正在追加的文字',()=>{
 assert.equal(typeof agent.createConsultDrafts,'function')
 const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}
 const drafts=agent.createConsultDrafts(storage)
 drafts.save('p1','先讨论用途')
 assert.equal(agent.createConsultDrafts(storage).read('p1'),'先讨论用途')
 drafts.save('p2','另一个项目')
 drafts.save('p1','先讨论用途，补充交通')
 assert.equal(drafts.acknowledge('p1','先讨论用途'),false)
 assert.equal(drafts.read('p1'),'先讨论用途，补充交通')
 assert.equal(drafts.acknowledge('p1','先讨论用途，补充交通'),true)
 assert.equal(drafts.read('p1'),'')
 assert.equal(drafts.read('p2'),'另一个项目')
})

test('正在运行优先于排队消息，真实完成时间固定耗时，缺失时间不补造',()=>{
 assert.equal(typeof agent.agentJobView,'function')
 const running={id:'run',kind:'outline',status:'running',created_at:'2026-11-04T05:10:00Z',started_at:'2026-11-04T05:10:31Z',progress:{stage:'reading_material',label:'正在读取资料',updatedAt:'2026-11-04T05:11:00Z'}}
 const queued={id:'next',kind:'chat',status:'queued',created_at:'2026-11-04T05:11:01Z'}
 const live=agent.agentJobView([running,queued],Date.parse('2026-11-04T05:12:57Z'))
 assert.equal(live.id,'run');assert.equal(live.elapsedSeconds,146);assert.equal(live.queuedCount,1)
 assert.equal(live.activity,'正在读取资料');assert.equal(live.canCancel,true)
 const finished=agent.agentJobView([{...running,status:'completed',finished_at:'2026-11-04T05:12:57Z'}],Date.parse('2026-11-05T06:00:00Z'))
 assert.equal(finished.elapsedSeconds,146);assert.equal(finished.canCancel,false)
 assert.equal(agent.agentJobView([{...running,status:'interrupted',finished_at:null}]).elapsedSeconds,null)
 assert.equal(agent.agentJobView([{id:'old',status:'completed'}]).elapsedSeconds,null)
 assert.equal(agent.agentJobView([{...running,status:'cancelling'}]).canCancel,false)
 assert.equal(agent.agentJobView([{...running,status:'failed',error:'请求未完成'}]).error,'请求未完成')
})

test('活动更新不改变流程内容签名，但新资料或决定需要更新',()=>{
 assert.equal(typeof agent.consultContentKey,'function')
 const value={id:'p',outline:{version:2,draft:{summary:'草案'},flow:['03','01'],flowReviewed:true,busy:false,lastJob:{status:'completed'}},materials:[{id:'m',sha256:'hash'}],jobs:[]}
 const baseline=agent.consultContentKey(value)
 assert.equal(agent.consultContentKey({...value,jobs:[{id:'j',status:'running',progress:{label:'读取资料'}}],outline:{...value.outline,busy:true,lastJob:{status:'running'}}}),baseline)
 assert.notEqual(agent.consultContentKey({...value,materials:[...value.materials,{id:'m2'}]}),baseline)
 assert.notEqual(agent.consultContentKey({...value,outline:{...value.outline,waivers:[{questionId:'q'}]}}),baseline)
 assert.notEqual(agent.consultContentKey({...value,outline:{version:0,busy:false}}),agent.consultContentKey({...value,outline:{version:0,busy:true}}),'首版草案占位应反映真实忙碌状态')
})

test('公开记录忽略模型内部思考字段和标签内容',()=>{
 assert.equal(typeof agent.publicAgentText,'function')
 assert.equal(agent.publicAgentText('<think>内部推理不显示</think>可以先核对材料。'),'可以先核对材料。')
 assert.equal(agent.publicAgentText('已经读取资料。<analysis>尚未闭合的内部推理'),'已经读取资料。')
 assert.equal(agent.publicAgentText({reasoning:'内部推理'}),'')
})

test('自动提交指令显示为操作标题，真正用户补充保留原文',()=>{
 assert.equal(typeof agent.agentUserMessage,'function')
 assert.deepEqual(agent.agentUserMessage({kind:'outline',user_text:'用户通过流程编辑器提交流程，请严格保留选择与顺序，逐章比对已有资料并询问必要缺项。'}),{label:'操作',text:'已提交流程'})
 assert.deepEqual(agent.agentUserMessage({kind:'outline',user_text:''}),{label:'操作',text:'根据资料推荐章节'})
 assert.deepEqual(agent.agentUserMessage({kind:'outline',user_text:'本轮先研究公共服务需求'}),{label:'你',text:'本轮先研究公共服务需求'})
})

const waitUntil=async predicate=>{const deadline=Date.now()+2000;while(!predicate()){if(Date.now()>deadline)throw new Error('等待事件超时');await new Promise(r=>setTimeout(r,5))}}
test('SSE 分块进度独立更新，结构事件合并刷新，关闭后停止监听',async()=>{
 assert.equal(typeof agent.watchProjectEvents,'function')
 let stream,refreshes=0,fetches=0;const progress=[],connections=[]
 const watcher=agent.watchProjectEvents({url:'/events',headers:{},reconnectMs:10,pollMs:50,idleMs:500,refresh:async()=>{refreshes++},onProgress:event=>{progress.push(event);return true},onConnection:value=>connections.push(value),fetcher:async(_url,options)=>{fetches++;return new Response(new ReadableStream({start(controller){stream=controller;options.signal.addEventListener('abort',()=>controller.error(new Error('aborted')),{once:true})}}))}})
 try{
  await waitUntil(()=>stream)
  stream.enqueue(new TextEncoder().encode('id: 1\r\ndata: {"type":"task-progress","id":"j","progress":{"label":"正在'))
  stream.enqueue(new TextEncoder().encode('读取资料"}}\r\n\r\n'))
  await waitUntil(()=>progress.length===1)
  assert.equal(progress[0].progress.label,'正在读取资料');assert.equal(refreshes,0)
  stream.enqueue(new TextEncoder().encode('id: 2\ndata: {"type":"task-completed","id":"j"}\n\nid: 3\ndata: {"type":"material-uploaded","id":"m"}\n\n'))
  await waitUntil(()=>refreshes===1)
  assert.ok(connections.includes('live'));watcher.abort()
  await new Promise(r=>setTimeout(r,80));assert.equal(fetches,1)
 }finally{watcher.abort()}
})

test('SSE 断线显示轮询回退，API 不可达显示离线，恢复后重连',async()=>{
 assert.equal(typeof agent.watchProjectEvents,'function')
 const connections=[];let requests=0,refreshes=0,available=false
 const watcher=agent.watchProjectEvents({url:'/events',headers:{},reconnectMs:15,pollMs:20,idleMs:100,refresh:async()=>{refreshes++;if(!available)throw new Error('offline')},onProgress:()=>true,onConnection:value=>connections.push(value),fetcher:async(_url,options)=>{requests++;if(!available)throw new Error('SSE unavailable');return new Response(new ReadableStream({start(controller){options.signal.addEventListener('abort',()=>controller.error(new Error('aborted')),{once:true});controller.enqueue(new TextEncoder().encode(': keepalive\n\n'))}}))}})
 try{
  await waitUntil(()=>connections.includes('offline'));assert.ok(refreshes>0)
  available=true
  await waitUntil(()=>connections.includes('live'));assert.ok(requests>1);assert.ok(connections.includes('polling'))
 }finally{watcher.abort()}
})

test('状态请求短暂失败后恢复，仍健康的 SSE 重新显示已连接',async()=>{
 assert.equal(typeof agent.watchProjectEvents,'function')
 const connections=[];let stream,refreshes=0
 const watcher=agent.watchProjectEvents({url:'/events',headers:{},pollMs:20,idleMs:500,refresh:async()=>{if(++refreshes===1)throw new Error('temporary')},onProgress:()=>true,onConnection:value=>connections.push(value),fetcher:async(_url,options)=>new Response(new ReadableStream({start(controller){stream=controller;options.signal.addEventListener('abort',()=>controller.error(new Error('aborted')),{once:true})}}))})
 try{
  await waitUntil(()=>stream)
  stream.enqueue(new TextEncoder().encode('id: 1\ndata: {"type":"task-completed"}\n\n'))
  await waitUntil(()=>connections.includes('offline'))
  await waitUntil(()=>connections.filter(value=>value==='live').length===2)
  assert.equal(refreshes,2)
 }finally{watcher.abort()}
})
