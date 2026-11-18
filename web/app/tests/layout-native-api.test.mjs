import test from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import {registerLayoutRoutes} from '../src/layout-library/routes.mjs'
import {createLayoutConversations} from '../src/layout-library/conversations.mjs'
import {workflowFixture} from './fixtures/reference-workflow.mjs'
test('existing V14 conversation API accepts native scope/fidelity without a separate entry',async t=>{
 const app=Fastify(),seen=[];t.after(()=>app.close())
 registerLayoutRoutes({app,library:{},enqueueReference:async(_req,body)=>{seen.push(body);return {status:'queued'}},listConversations:async()=>[],getConversation:async()=>({}),listReferenceJobs:async()=>[],referenceConfiguration:async()=>({}),cancelReference:async()=>({}),retryReference:async()=>({})})
 const response=await app.inject({method:'POST',url:'/api/layout-library/conversations',payload:{requestId:'native-api',text:'参考设计',files:[],referencePipeline:'native-v3',referenceScope:'layout',referenceFidelity:'fidelity',allowModel:true}})
 assert.equal(response.statusCode,200);assert.equal(seen[0].referencePipeline,'native-v3');assert.equal(seen[0].referenceScope,'layout')
 const rejected=await app.inject({method:'POST',url:'/api/layout-library/conversations',payload:{requestId:'invalid',text:'mirror',referencePipeline:'native-v3',referenceFidelity:'mirror',allowModel:true}})
 assert.notEqual(rejected.statusCode,200);assert.equal(seen.length,1)
})
test('prepared native conversation carries native options into original job payload',async()=>{
 const files=workflowFixture().payload.referenceFiles,db={query:async()=>({rows:[]})},uploads={resolveFiles:async()=>files,validateImageBudget:async()=>{}}
 const conversations=createLayoutConversations(db,{},uploads)
 const p=await conversations.prepare({id:'owner'},{text:'设计参考',referencePipeline:'native-v3',referenceScope:'brand',referenceFidelity:'fidelity',files},'new-job',db)
 assert.equal(p.referenceAnalysisRequired,true);assert.equal(p.referencePipeline,'native-v3');assert.equal(p.referenceScope,'brand');assert.equal(p.referenceFidelity,'fidelity')
})
test('only new document conversations opt into component workflow; continuing old jobs retains legacy contract',async()=>{
 const files=workflowFixture().payload.referenceFiles,uploads={resolveFiles:async(_actor,f)=>f??[],validateImageBudget:async()=>{}}
 const input={text:'参考',referencePipeline:'native-v3',files}
 const emptyDb={query:async()=>({rows:[]})}
 const fresh=await createLayoutConversations(emptyDb,{},uploads).prepare({id:'owner'},input,'new',emptyDb)
 assert.equal(fresh.referenceComponentVersion,2)
 const previous={id:'old',status:'failed',payload:{text:'旧参考',referencePipeline:'native-v3',referenceFiles:files,referenceWorkflowVersion:1,prototypeContractVersions:{'archetype-1':'legacy-image-v1'}}}
 const db={query:async sql=>({rows:sql.startsWith('SELECT id FROM jobs')?[{id:'old'}]:[previous]})}
 const conversations=createLayoutConversations(db,{isRemoved:async()=>false},uploads)
 const old=await conversations.prepare({id:'owner'},{...input,conversationId:'old'},'retry',db)
 assert.equal(old.referenceDerivedSpecVersion,undefined);assert.equal(old.referenceComponentVersion,undefined)
 assert.equal(old.referenceWorkflowVersion,1)
 assert.deepEqual(old.prototypeContractVersions,previous.payload.prototypeContractVersions)
 previous.payload.referenceComponentVersion=1
 const newer=await conversations.prepare({id:'owner'},{...input,files:[],conversationId:'old'},'follow-up',db)
 assert.equal(newer.referenceComponentVersion,1)
 const plain=await createLayoutConversations(emptyDb,{},uploads).prepare({id:'owner'},{...input,files:[]},'plain',emptyDb)
 assert.equal(plain.referenceComponentVersion,undefined)
})
test('retry selects the original job contract, not the latest conversation turn',async()=>{
 const files=workflowFixture().payload.referenceFiles,old={id:'old',status:'failed',payload:{text:'original',referencePipeline:'native-v3',referenceFiles:files,referenceWorkflowVersion:1,prototypeContractVersions:{a:'legacy-image-v1'}}},newer={id:'newer',status:'failed',payload:{text:'new',referencePipeline:'native-v3',referenceFiles:files,referenceComponentVersion:1}}
 const db={query:async sql=>({rows:sql.startsWith('SELECT id FROM jobs')?[{id:'old'}]:[old,newer]})},uploads={resolveFiles:async(_actor,f)=>f??[],validateImageBudget:async()=>{}}
 const conversations=createLayoutConversations(db,{isRemoved:async()=>false},uploads),input={conversationId:'old',retrySourceJobId:'old',text:'retry',referencePipeline:'native-v3',files}
 const result=await conversations.prepare({id:'owner'},input,'retry',db)
 assert.equal(result.referenceWorkflowVersion,1);assert.equal(result.referenceComponentVersion,undefined)
 assert.deepEqual(result.prototypeContractVersions,{a:'legacy-image-v1'})
 assert.equal(result.referencePrototypeMappingPolicy,undefined)
 await assert.rejects(conversations.prepare({id:'owner'},{...input,retrySourceJobId:'foreign'},'retry2',db))
 const next=await conversations.prepare({id:'owner'},{...input,retrySourceJobId:undefined},'next',db)
 assert.equal(next.referencePrototypeMappingPolicy,'matching-archetypes')
})
test('explicit new component request selects owned real pages without changing ordinary upload default',async()=>{
 const files=workflowFixture(10).payload.referenceFiles,db={query:async()=>({rows:[]})},uploads={resolveFiles:async(_a,f)=>f??[],validateImageBudget:async()=>{}},conversations=createLayoutConversations(db,{},uploads)
 const input={text:'test',files,referencePipeline:'native-v3',referenceExtraction:'components',componentPages:[5,2]}
 const result=await conversations.prepare({id:'owner'},input,'new',db)
 assert.equal(result.referenceDecorationVersion,1);assert.equal(result.referenceDerivedSpecVersion,1);assert.equal(result.referenceImagePlacementVersion,1);assert.equal(result.referenceContentFitPolicyVersion,1);assert.equal(result.referenceTitleReuseVersion,1);assert.equal(result.referenceComponentVersion,3);assert.deepEqual(result.referenceComponentSelection,{fileId:files[0].id,pages:[2,5]})
 await assert.rejects(conversations.prepare({id:'owner'},{...input,componentPages:undefined},'large',db),e=>e.code==='REFERENCE_COMPONENT_SELECTION_INVALID')
 const ordinary=await conversations.prepare({id:'owner'},{text:'ordinary',files,referencePipeline:'native-v3'},'default',db)
 assert.equal(ordinary.referenceDecorationVersion,undefined);assert.equal(ordinary.referenceDerivedSpecVersion,undefined);assert.equal(ordinary.referenceImagePlacementVersion,undefined);assert.equal(ordinary.referenceComponentVersion,2);assert.equal(ordinary.referenceComponentSelection,undefined)
})
test('visual semantics requires explicit new component opt-in and never upgrades ordinary uploads',async()=>{
 const files=workflowFixture(1).payload.referenceFiles,db={query:async()=>({rows:[]})},uploads={resolveFiles:async(_a,f)=>f??[],validateImageBudget:async()=>{}},conversations=createLayoutConversations(db,{},uploads),input={text:'synthetic',files,referencePipeline:'native-v3',referenceExtraction:'components',componentPages:[1]}
 assert.equal((await conversations.prepare({id:'owner'},input,'old',db)).referenceVisualSemanticsVersion,undefined)
 assert.equal((await conversations.prepare({id:'owner'},{...input,referenceVisualSemantics:true},'new',db)).referenceVisualSemanticsVersion,1)
 await assert.rejects(conversations.prepare({id:'owner'},{...input,referenceExtraction:undefined,referenceVisualSemantics:true},'invalid',db),e=>e.code==='REFERENCE_VISUAL_SEMANTICS_SELECTION_INVALID')
})

test('retry retains derived spec version only from selected original job',async()=>{const files=workflowFixture().payload.referenceFiles,old={id:'old',status:'failed',payload:{text:'original',referencePipeline:'native-v3',referenceFiles:files,referenceComponentVersion:3,referenceDerivedSpecVersion:1}},newer={id:'newer',status:'failed',payload:{text:'new',referencePipeline:'native-v3',referenceFiles:files,referenceComponentVersion:3}};const db={query:async sql=>({rows:sql.startsWith('SELECT id FROM jobs')?[{id:'old'}]:[old,newer]})},uploads={resolveFiles:async(_a,f)=>f??[],validateImageBudget:async()=>{}};const conversations=createLayoutConversations(db,{isRemoved:async()=>false},uploads),input={conversationId:'old',retrySourceJobId:'old',text:'retry',referencePipeline:'native-v3',files};assert.equal((await conversations.prepare({id:'owner'},input,'retry',db)).referenceDerivedSpecVersion,1);assert.equal((await conversations.prepare({id:'owner'},{...input,retrySourceJobId:'newer'},'retry-latest',db)).referenceDerivedSpecVersion,undefined)})

test('decoration marker is frozen only for new component tasks and selected retries',async()=>{
 const files=workflowFixture().payload.referenceFiles,old={id:'old',status:'failed',payload:{text:'old',referencePipeline:'native-v3',referenceFiles:files,referenceComponentVersion:3}},modern={id:'modern',status:'failed',payload:{...old.payload,referenceDecorationVersion:1}}
 const db={query:async sql=>({rows:sql.startsWith('SELECT id FROM jobs')?[{id:'old'}]:[old,modern]})},uploads={resolveFiles:async(_a,f)=>f??[],validateImageBudget:async()=>{}},c=createLayoutConversations(db,{isRemoved:async()=>false},uploads),input={conversationId:'old',text:'continue',referencePipeline:'native-v3',files}
 assert.equal((await c.prepare({id:'owner'},{...input,retrySourceJobId:'old'},'retry-old',db)).referenceDecorationVersion,undefined)
 assert.equal((await c.prepare({id:'owner'},{...input,retrySourceJobId:'modern'},'retry-new',db)).referenceDecorationVersion,1)
 db.query=async sql=>({rows:sql.startsWith('SELECT id FROM jobs')?[{id:'old'}]:[old]})
 assert.equal((await c.prepare({id:'owner'},input,'continue-old',db)).referenceDecorationVersion,undefined)
})
