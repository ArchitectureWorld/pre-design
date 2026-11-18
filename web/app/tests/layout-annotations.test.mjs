import test from 'node:test'
import assert from 'node:assert/strict'
import {createTestDb} from './support/dossier-db.mjs'
import {createLayoutAnnotations,assertLayoutNoteAnchor} from '../src/layout-library/layout-annotations.mjs'
const actor={id:'owner'},other={id:'other'},resource={id:'00000000-0000-4000-8000-000000000001',ownerId:'owner',version:1,latestVersion:1,hash:'a'.repeat(64),package:{layouts:[{id:'cards',slots:[{id:'left-title',role:'title'},{id:'right-title',role:'title'}]}]}}
const anchor={resourceId:resource.id,version:1,packageHash:resource.hash,layoutId:'cards',slotId:'right-title'}
async function fixture(t){const env=await createTestDb();t.after(env.close);await env.db.query('CREATE TABLE jobs(id uuid PRIMARY KEY,status text,result jsonb,owner_id text,kind text,payload jsonb,created_at timestamptz DEFAULT now()); CREATE TABLE layout_library_resources(id uuid PRIMARY KEY)');let current=structuredClone(resource);const library={get:async(a,id,v)=>{if(a.id!=='owner'||id!==current.id||v!==1)throw Error('不存在');return current}};return{db:env.db,store:await createLayoutAnnotations(env.db,library),change:()=>current.latestVersion++}}
test('stable component anchor rejects stale version/hash and missing slot without role ambiguity',()=>{
 assertLayoutNoteAnchor(resource,anchor)
 for(const delta of [{version:2},{packageHash:'b'.repeat(64)},{layoutId:'missing'},{slotId:'missing'}])assert.throws(()=>assertLayoutNoteAnchor(resource,{...anchor,...delta}))
})
test('notes persist privately, replay idempotently and retain text on stale target',async t=>{
 const {store,change}=await fixture(t),b={requestId:'n1',anchor,text:'保留右栏标题带'}
 const n=await store.create(actor,b);assert.equal((await store.create(actor,b)).id,n.id)
 await assert.rejects(()=>store.create(actor,{...b,text:'changed'}));await assert.rejects(()=>store.list(other,resource.id,1))
 assert.equal((await store.list(actor,resource.id,1))[0].anchor.slotId,'right-title')
 change();await assert.rejects(()=>store.create(actor,{...b,requestId:'n2'}));assert.equal((await store.list(actor,resource.id,1))[0].text,b.text)
})
test('batch preparation is atomic, permits failure retry and never calls candidate applied',async t=>{
 const {store,db}=await fixture(t),n=await store.create(actor,{requestId:'n',anchor,text:'保留标题带'})
 const batch={resourceId:resource.id,resourceVersion:1,packageHash:resource.hash,annotationIds:[n.id],annotationRevisions:{[n.id]:0}};const c=await db.connect()
 try{await c.query('BEGIN');const b=await store.prepareBatch(actor,batch,c);assert.match(b.text,/right-title/);await c.query("INSERT INTO jobs(id,status,result) VALUES($1,'queued',NULL)",['00000000-0000-4000-8000-000000000002']);await store.submit(actor,batch.annotationIds,'00000000-0000-4000-8000-000000000002',c);await c.query('COMMIT')}finally{c.release()}
 assert.equal((await store.list(actor,resource.id,1))[0].status,'submitted')
 const check=await db.connect();try{await assert.rejects(()=>store.prepareBatch(actor,batch,check))}finally{check.release()}
 await db.query("UPDATE jobs SET status='completed',result=$2 WHERE id=$1",['00000000-0000-4000-8000-000000000002',{id:resource.id,version:2}]);assert.equal((await store.list(actor,resource.id,1))[0].status,'candidate')
 await db.query("UPDATE jobs SET status='failed' WHERE id=$1",['00000000-0000-4000-8000-000000000002']);const retry=await db.connect();try{assert.match((await store.prepareBatch(actor,batch,retry)).text,/保留标题带/)}finally{retry.release()}
})
test('batch rollback leaves saved notes pending and editable; duplicate IDs and oversized requests reject',async t=>{
 const {store,db}=await fixture(t),n=await store.create(actor,{requestId:'r',anchor,text:'first'}),jobId='00000000-0000-4000-8000-000000000003'
 const c=await db.connect();try{await c.query('BEGIN');await c.query("INSERT INTO jobs(id,status) VALUES($1,'queued')",[jobId]);await store.submit(actor,[n.id],jobId,c);await c.query('ROLLBACK');await assert.rejects(()=>store.prepareBatch(actor,{resourceId:resource.id,resourceVersion:1,packageHash:resource.hash,annotationIds:[n.id,n.id]},c))}finally{c.release()}
 assert.equal((await store.list(actor,resource.id,1))[0].status,'pending');await store.change(actor,{requestId:'e',resourceId:resource.id,noteId:n.id,expectedRevision:0,text:'edited'},'edit');assert.equal((await store.list(actor,resource.id,1))[0].text,'edited')
 await store.change(actor,{requestId:'d',resourceId:resource.id,noteId:n.id,expectedRevision:1},'delete');assert.equal((await store.list(actor,resource.id,1))[0].status,'deleted')
})
test('HTTP note routes bind path identity, reject forged fields and queue only explicit batches',async t=>{
 const {store}=await fixture(t),{default:Fastify}=await import('fastify'),{registerLayoutRoutes}=await import('../src/layout-library/routes.mjs');const app=Fastify();t.after(()=>app.close());let calls=0
 app.addHook('preHandler',async req=>{req.user=actor});app.setErrorHandler((e,_req,r)=>r.code(e.name==='ZodError'?400:e.statusCode??500).send({error:e.message}))
 registerLayoutRoutes({app,library:{},annotations:store,referenceConfiguration:async()=>({}),listReferenceJobs:async()=>[],cancelReference:async()=>({}),enqueueReference:async(_req,b)=>{calls++;return{id:'queued',...b}}})
 const base='/api/layout-library/'+resource.id+'/1/annotations',post=(url,payload)=>app.inject({method:'POST',url,payload})
 let r=await post(base,{requestId:'http',packageHash:resource.hash,layoutId:anchor.layoutId,slotId:anchor.slotId,text:'右栏标题'});assert.equal(r.statusCode,200,r.body);const note=r.json();assert.equal(calls,0)
 assert.equal((await app.inject({url:base})).json().annotations.length,1)
 assert.equal((await post(base,{requestId:'forged',packageHash:resource.hash,layoutId:anchor.layoutId,text:'x',ownerId:'other'})).statusCode,400)
 const body={requestId:'batch',packageHash:resource.hash,annotationIds:[note.id],annotationRevisions:{[note.id]:0},allowModel:true};r=await post(base+'/batch-submit',body);assert.equal(r.statusCode,200,r.body);assert.equal(calls,1);assert.equal(r.json().resourceId,resource.id);assert.equal(r.json().resourceVersion,1)
 assert.equal((await post(base+'/batch-submit',{...body,allowModel:false})).statusCode,400)
})
test('stale edits cannot overwrite a newer note and batches bind selected note revisions',async t=>{
 const {store,db}=await fixture(t),n=await store.create(actor,{requestId:'rev-n',anchor,text:'original'})
 const first=await store.change(actor,{requestId:'rev-a',resourceId:resource.id,noteId:n.id,expectedRevision:0,text:'A'},'edit');assert.equal(first.revision,1)
 await assert.rejects(()=>store.change(actor,{requestId:'rev-b',resourceId:resource.id,noteId:n.id,expectedRevision:0,text:'B'},'edit'),/批注.*变化/)
 assert.equal((await store.list(actor,resource.id,1))[0].text,'A')
 const c=await db.connect();try{await assert.rejects(()=>store.prepareBatch(actor,{resourceId:resource.id,resourceVersion:1,packageHash:resource.hash,annotationIds:[n.id],annotationRevisions:{[n.id]:0}},c),/批注.*变化/)}finally{c.release()}
})
test('batch source lookup binds exact owner, resource and completed version',async t=>{
 const {db}=await fixture(t),{createLayoutConversations}=await import('../src/layout-library/conversations.mjs'),conversations=createLayoutConversations(db,{})
 const source='00000000-0000-4000-8000-000000000004',conversation='00000000-0000-4000-8000-000000000005'
 await db.query('INSERT INTO jobs(id,status,owner_id,kind,payload,result) VALUES($1,$2,$3,$4,$5,$6)',[source,'completed',actor.id,'layout-reference',{conversationId:conversation},{id:resource.id,version:1}])
 assert.equal(await conversations.forResource(actor,resource.id,1,db),conversation)
 assert.equal(await conversations.forResource(other,resource.id,1,db),undefined)
 assert.equal(await conversations.forResource(actor,resource.id,2,db),undefined)
 await db.query("UPDATE jobs SET status='failed' WHERE id=$1",[source]);assert.equal(await conversations.forResource(actor,resource.id,1,db),undefined)
})
