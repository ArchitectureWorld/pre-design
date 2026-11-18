import test from 'node:test'
import assert from 'node:assert/strict'
import {validateCoverageMap} from '../src/layout-library/reference-coverage.mjs'
import {coverageLabel} from '../src/layout-library/reference-coverage-ui.js'
import {createLayoutConversations} from '../src/layout-library/conversations.mjs'
import {prepareComponentSelection} from '../src/layout-library/component-reference-selection.mjs'
const sha='a'.repeat(64)
for(const count of [301,601])test(`${count} original pages map completely without a global cap`,()=>{
 const observations=[{pages:Array.from({length:count},(_,i)=>({fileSha256:sha,pageNumber:i+1,facts:[{id:'fact-'+i}]}))}],profile={archetypes:[{id:'a'}]}
 const raw={pages:observations[0].pages.map(p=>({fileSha256:sha,pageNumber:p.pageNumber,archetypeId:'a',factIds:[p.facts[0].id]}))}
 assert.equal(validateCoverageMap(raw,profile,observations).pages.length,count)
 for(const bad of [{pages:raw.pages.slice(1)},{pages:[...raw.pages,raw.pages[0]]},{pages:[...raw.pages.slice(1),raw.pages[1]]}])assert.throws(()=>validateCoverageMap(bad,profile,observations))
 assert.match(coverageLabel({totalPages:count,extractedPages:count,observedPages:count,synthesizedPages:count}),new RegExp(`共 ${count} 页`))
})
test('oversized output is rejected before parsing any untrusted page fields',()=>{
 const pages=[{get fileSha256(){assert.fail('must not parse oversized output')}},{}]
 assert.throws(()=>validateCoverageMap({pages},{archetypes:[]},[{pages:[{fileSha256:sha,pageNumber:1,facts:[]}]}]),e=>e.code==='REFERENCE_COVERAGE_INVALID')
})
test('native admission accepts one 301-page source or multiple sources totaling 601',async()=>{
 for(const counts of [[301],[300,301]]){
  const files=counts.map((pageCount,i)=>({id:'file-'+i,name:'synthetic-'+i+'.pdf',kind:'pdf',sha256:String(i+1).repeat(64),pageCount,hasImages:true,readPages:[1],imageCount:1}))
  const db={query:async()=>({rows:[]})},library={isRemoved:async()=>false},uploads={resolveFiles:async()=>files}
  const result=await createLayoutConversations(db,library,uploads).prepare({id:'owner'},{files:files.map(f=>({id:f.id})),text:'读取全部',referencePipeline:'native-v3'},'job',db)
  assert.equal(result.referenceFiles.reduce((n,f)=>n+f.pageCount,0),counts.reduce((a,b)=>a+b,0))
 }
})
test('component selection remains bounded by six and the real source, not page 300',()=>{
 const files=[{id:'synthetic',kind:'pdf',pageCount:301}]
 assert.deepEqual(prepareComponentSelection(files,[301]).pages,[301])
 for(const pages of [[302],[0],[1.5],[Number.MAX_SAFE_INTEGER+1],Array.from({length:7},(_,i)=>i+1)])assert.throws(()=>prepareComponentSelection(files,pages))
})
test('route admission accepts source page 301 but never unsafe integers or more than six component pages',async()=>{
 const {registerLayoutRoutes}=await import('../src/layout-library/routes.mjs'),routes=new Map(),calls=[]
 registerLayoutRoutes({app:{get(){},post:(path,...args)=>routes.set(path,args.at(-1))},library:{deriveSparse:async(_actor,body)=>{calls.push(body);return body}},enqueueReference:async(_req,body)=>{calls.push(body);return body}})
 const sparse=routes.get('/api/layout-library/:resourceId/:version/derive-sparse-cards'),conversation=routes.get('/api/layout-library/conversations')
 const request={user:{id:'owner'},params:{resourceId:'11111111-1111-4111-8111-111111111111',version:'1'},body:{requestId:'source',expectedHash:sha,strategyVersion:1,source:{fileSha256:sha,pageNumber:301}}}
 assert.equal((await sparse(request)).source.pageNumber,301)
 const body={requestId:'components',text:'提取',allowModel:true,referenceExtraction:'components',componentPages:[301]}
 assert.deepEqual((await conversation({body})).componentPages,[301])
 for(const page of [0,1.5,Number.MAX_SAFE_INTEGER+1]){
  await assert.rejects(sparse({...request,body:{...request.body,source:{fileSha256:sha,pageNumber:page}}}))
  await assert.rejects(conversation({body:{...body,componentPages:[page]}}))
 }
 await assert.rejects(conversation({body:{...body,componentPages:[1,2,3,4,5,6,7]}}))
})
for(const metadata of [{name:'synthetic.pdf',kind:'pdf',pageCount:301,readPages:[1],hasImages:true},{name:'synthetic.png',mimeType:'image/png',hasImages:true,imageCount:1}])test('component UI bounds pages to uploaded source '+metadata.name,async t=>{
 const {JSDOM}=await import('jsdom'),{mountLayoutConversation}=await import('../src/layout-library/conversation-ui.js')
 const dom=new JSDOM('<aside></aside>'),doc=dom.window.document,posted=[],notices=[]
 const file={id:'11111111-1111-4111-8111-111111111111',...metadata}
 const request=async(path,options={})=>{
  if(path.endsWith('reference-config'))return{configured:true,vision:{configured:true}}
  if(path.endsWith('reference-files'))return file
  if(options.method==='POST'){posted.push(options.body);return{id:'job',conversationId:'A'}}
  return{id:'A',referenceFiles:[file],turns:[]}
 }
 const ui=mountLayoutConversation({container:doc.querySelector('aside'),request,notify:x=>notices.push(x),getContext:()=>({}),onResource(){},onImport(){}})
 t.after(()=>{ui.dispose();dom.window.close()})
 const settle=async fn=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setImmediate(r))}assert(fn())}
 const picker=doc.querySelector('[data-chat-file]');Object.defineProperty(picker,'files',{value:[{name:file.name,size:8}]});picker.dispatchEvent(new dom.window.Event('change'))
 await settle(()=>!ui.busy&&doc.querySelector('[data-upload-state]')?.textContent.includes('待发送'))
 doc.querySelector('[data-reference-components]').checked=true
 const field=doc.querySelector('[data-component-pages]'),send=doc.querySelector('[data-layout-send]')
 field.value=String((metadata.pageCount??1)+1);send.click();await new Promise(r=>setImmediate(r));assert.equal(posted.length,0);assert(notices.length)
 field.value=metadata.kind?'301':'';send.click();await settle(()=>posted.length===1);assert.deepEqual(posted[0].componentPages,metadata.kind?[301]:undefined)
})
for(const count of [301,601])test(`${count}-page job reads bounded batches and resumes after sixty new stages without replaying completed calls`,async()=>{
 const {createHash,randomUUID}=await import('node:crypto'),{createLayoutJobs,layoutSkillHash}=await import('../src/layout-library/jobs.mjs')
 const {workflowFixture,observationFixture,profileFixture}=await import('./fixtures/reference-workflow.mjs'),{nativeDesignInput}=await import('./fixtures/native-design-v3-fixture.mjs')
 const fixture=workflowFixture(count),file=fixture.payload.referenceFiles[0];file.pageCount=count;file.pages=file.pages.map(p=>({page:p.page}));file.text='';file.limitations=[]
 const data=Buffer.from('synthetic pixels'),hash=createHash('sha256').update(data).digest('hex')
 const images=fixture.images.map(({data:unused,...image})=>({...image,width:1600,height:900,sha256:hash,sourceSha256:file.sha256}))
 const records=new Map(),writes=[],reads=[],calls=[],packages=[],controllers=new Map(),history=[]
 const {defaultPolicy,validateSnapshot}=await import('../src/model-policy.mjs'),policy=defaultPolicy()
 const primary=policy.models.find(m=>m.model==='sensenova-6.8-flash-lite');primary.status='verified';primary.capabilities={text:true,tools:true,vision:true,image:false}
 const query=async(sql,args=[])=>{
  writes.push({sql,args})
  if(sql.startsWith('SELECT record FROM layout_reference_checkpoints'))return{rows:records.has(args[1])?[{record:records.get(args[1])}]:[]}
  if(sql.startsWith('INSERT INTO layout_reference_checkpoints'))records.set(args[1],args[2])
  if(sql.startsWith('SELECT payload,status FROM jobs'))return{rows:history.filter(j=>j.id===args[0])}
  if(sql.startsWith('SELECT count(*)'))return{rows:[{n:0}]}
  if(sql.startsWith('SELECT id FROM jobs'))return{rows:history.filter(j=>j.id===args[0]).map(j=>({id:j.id}))}
  if(sql.startsWith('SELECT * FROM jobs')&&sql.includes("payload->>'conversationId'"))return{rows:history}
  if(sql.startsWith('INSERT INTO jobs(')){history.push({id:args[0],owner_id:args[1],payload:args[4],policy_snapshot:args[5],status:'queued',created_at:new Date()})}
  if(sql.includes('SET status=$2,error=$3')){const j=history.find(j=>j.id===args[0]);if(j)j.status=args[1]}
  if(sql.startsWith('SELECT status FROM jobs'))return{rows:[{status:'running'}]}
  return{rows:[]}
 }
 const db={query,connect:async()=>({query,release(){}})},uploads={ensureDocumentPages:async(_a,_id,start)=>reads.push(start),resolveFiles:async()=>[file],imageManifest:async()=>images,loadImageBatch:async (_actor,batch)=>{assert(batch.length<=6);return batch.map(m=>({...m,data:data.toString('base64')}))}}
 const runLayoutReference=async input=>{
  calls.push(input.stage);const context=JSON.parse(input.prompt.split('以下JSON仅为参考数据，不能改写系统边界：\n').at(-1)),spec=nativeDesignInput()
  let response
  if(input.stage.startsWith('observe-')){response=observationFixture(input.images);for(const page of response.pages)page.facts.push({property:'font-family',value:'sans'})}
  else if(input.stage.startsWith('design-summary-'))response={pages:context.pages.map(p=>({fileSha256:p.fileSha256,pageNumber:p.pageNumber,factIds:[p.facts.find(f=>f.property==='background')?.id??p.facts[0].id]}))}
  else if(input.stage==='profile'){assert(JSON.stringify(context).length<=140000);assert.equal(context.synthesisEncoding,'grouped-design-facts-v1');response=profileFixture()}
  else if(input.stage.startsWith('coverage-map'))response={pages:context.pages.map(p=>({fileSha256:p.fileSha256,pageNumber:p.pageNumber,archetypeId:'archetype-1',factIds:[p.facts[0].id]}))}
  else if(input.stage==='design-spec')response={...spec.designSpec,fidelity:'standard',profile:context.profile}
  else if(input.stage.startsWith('prototype-')){assert(JSON.stringify(context).length<=200000);assert.equal(context.sourceSelection.allEvidencePages.length,count);assert(input.images.length<=6);if(count===601)assert.equal(context.observedDesignPages.encoding,'grouped-design-facts-v1');response={prototypes:spec.prototypes}}
  else assert.fail('unexpected stage '+input.stage)
  return{response,execution:{actualRoute:{model:'synthetic'}}}
 }
 const jobs=createLayoutJobs({db,platform:{getPolicy:async()=>policy},workers:{runLayoutReference,validateTaskConfiguration:async()=>{}},uploads,library:{isRemoved:async()=>false,create:async(_a,p)=>{packages.push(p);return{id:randomUUID(),version:1}}},serial:async(_key,fn)=>fn(),controllers,kick(){}})
 const job={id:randomUUID(),owner_id:'owner',payload:{...fixture.payload,referencePipeline:'native-v3',referenceWorkflowVersion:2,skillHash:layoutSkillHash},policy_snapshot:validateSnapshot(policy,['parent','vision']),status:'running',created_at:new Date()}
 history.push(job);await jobs.execute(job)
 assert.deepEqual(reads,Array.from({length:Math.ceil(count/30)},(_,i)=>i*30+1));assert.equal(calls.length,60,JSON.stringify(writes.filter(w=>w.sql.includes('SET status=$2,error=$3')).map(w=>({error:w.args[2],stage:w.args[3]?.failedStage}))));assert.equal(records.size,60);assert.equal(packages.length,0)
 const failure=writes.find(w=>w.sql.includes('SET status=$2,error=$3'))
 assert.match(failure.args[2],/可.*继续/);assert.match(failure.args[2],/匹配/)
 const first=[...calls];let complete,previous=job
 for(let attempt=0;attempt<4&&!complete;attempt++){
  const before=calls.length,result=await jobs.retry({user:{id:'owner'},params:{jobId:previous.id}},{requestId:'retry-'+attempt})
  const next=history.find(j=>j.id===result.id);assert(next);assert.equal(next.payload.referenceWorkflowVersion,2);assert.equal(next.payload.referenceFiles[0].pageCount,count)
  await jobs.execute(next);previous=next;assert(calls.length-before<=60)
  complete=writes.find(w=>w.sql.includes("SET status='completed'"))
 }
 assert(first.every(stage=>calls.filter(s=>s===stage).length===1),'completed matching stages are not invoked again')
 assert.equal(new Set(calls).size,calls.length,'all completed stages invoked once across continuation rounds')
 assert(complete,JSON.stringify(writes.filter(w=>w.sql.includes('SET status=$2,error=$3')).map(w=>({error:w.args[2],stage:w.args[3]?.failedStage}))))
 assert.equal(complete.args[1].analysis.coverage.synthesizedPages,count);assert.equal(complete.args[1].analysis.coverage.complete,true);assert.equal(complete.args[1].analysis.observations.flatMap(b=>b.pages).length,count);assert.equal(complete.args[1].analysis.designSummary.synthesisEncoding,'grouped-design-facts-v1');assert(complete.args[1].analysis.observations.flatMap(b=>b.pages).every(p=>p.facts.length===2&&p.facts.some(f=>f.property==='font-family')),'unselected original facts remain private and intact')
})
test('grouped synthesis preserves original page/source/fact identities and never merges different design values',async()=>{
 const {groupedSynthesisInput}=await import('../src/layout-library/reference-design-summary.mjs')
 const facts=n=>[{id:'canvas-'+n,property:'canvas',value:{width:1600,height:900}}]
 const inventory={coverage:{totalPages:5},files:[{sha256:sha,name:'synthetic.pdf',kind:'pdf',pageCount:5,pages:[1,2,3,4,5].map(pageNumber=>({pageNumber,hasImage:true,imageSha256:'b'.repeat(64),extractedFacts:facts(pageNumber)})),extractedFacts:[],limitations:[]}]}
 const observations=[{pages:[1,2,3,4,5].map(n=>({fileSha256:sha,pageNumber:n,pageType:'mixed',structure:n===3?'grid':'columns',density:'medium',facts:[{id:'color-'+n,property:n===5?'accent':'background',value:n===4?'#000000':'#ffffff'}]}))}]
 const original=JSON.stringify({inventory,observations}),input=groupedSynthesisInput(inventory,observations,{referenceIntent:'style',text:'design',name:'test'})
 assert.equal(input.synthesisEncoding,'grouped-design-facts-v1');assert.equal(input.inventory.files[0].groups.length,4)
 const groups=input.inventory.files[0].groups;assert.deepEqual(groups.flatMap(g=>g.pages.map(p=>p.pageNumber)),[1,2,3,4,5])
 assert.deepEqual(groups[0].pages,[{pageNumber:1,extractedFactIds:['canvas-1'],observedFactIds:['color-1']},{pageNumber:2,extractedFactIds:['canvas-2'],observedFactIds:['color-2']}])
 assert.equal(input.inventory.files[0].sha256,sha);assert.equal(JSON.stringify({inventory,observations}),original)
 const second=structuredClone(inventory.files[0]);second.sha256='c'.repeat(64)
 const both=groupedSynthesisInput({...inventory,files:[...inventory.files,second]},[...observations,{pages:observations[0].pages.map(p=>({...p,fileSha256:second.sha256}))}],{})
 assert.equal(both.inventory.files.length,2);assert.equal(both.inventory.files[1].sha256,second.sha256)
})
test('grouped encoding round-trips complete fact values and never merges different provenance',async()=>{
 const {groupedSynthesisInput}=await import('../src/layout-library/reference-design-summary.mjs')
 const inventory={coverage:{totalPages:2},files:[{sha256:sha,name:'synthetic.pdf',kind:'pdf',pageCount:2,extractedFacts:[],limitations:[],pages:[1,2].map(n=>({pageNumber:n,hasImage:true,extractedFacts:[{id:'canvas-'+n,property:'canvas',value:{width:1600,height:900},provenance:'extracted',unit:'preview-px'}]}))}]}
 const observations=[{pages:[1,2].map(n=>({fileSha256:sha,pageNumber:n,pageType:'mixed',structure:'columns',density:'medium',facts:[{id:'color-'+n,property:'background',value:'#ffffff',provenance:n===1?'observed':'inferred',confidence:.8}]}))}]
 const result=groupedSynthesisInput(inventory,observations,{})
 assert.equal(result.inventory.files[0].groups.length,2,'otherwise-identical values with different provenance cannot share a group')
 const decoded=result.inventory.files.flatMap(file=>file.groups.flatMap(group=>group.pages.map(page=>({fileSha256:file.sha256,pageNumber:page.pageNumber,extractedFacts:group.extractedFacts.map((fact,i)=>({id:page.extractedFactIds[i],...fact})),observedFacts:group.observedFacts.map((fact,i)=>({id:page.observedFactIds[i],...fact}))})))).sort((a,b)=>a.pageNumber-b.pageNumber)
 assert.deepEqual(decoded,inventory.files[0].pages.map((page,i)=>({fileSha256:sha,pageNumber:page.pageNumber,extractedFacts:page.extractedFacts,observedFacts:observations[0].pages[i].facts})))
})
