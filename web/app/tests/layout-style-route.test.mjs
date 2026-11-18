import test from 'node:test'
import assert from 'node:assert/strict'
import {registerLayoutRoutes} from '../src/layout-library/routes.mjs'
const path='/api/layout-library/:resourceId/:version/derive-style-adaptation',id='11111111-1111-4111-8111-111111111111'
function fixture(){const routes=new Map(),calls=[];registerLayoutRoutes({app:{get(){},post:(p,...args)=>routes.set(p,args.at(-1))},library:{deriveStyle:async(...args)=>{calls.push(args);return{id,version:2,hash:'b'.repeat(64),derived:true}}}});return{handler:routes.get(path),calls}}
const req=()=>({user:{id:'owner'},params:{resourceId:id,version:'1'},body:{requestId:'derive-1',expectedHash:'a'.repeat(64),strategyVersion:1,styleAcknowledged:true}})
test('style route accepts only versioned explicit server-side derivation inputs',async()=>{const f=fixture();assert.equal(typeof f.handler,'function');const r=req(),result=await f.handler(r);assert.equal(result.version,2);assert.deepEqual(f.calls[0],[r.user,{...r.body,id,version:1}])})
test('style route rejects client analysis, packages, unrecognized strategy and invalid identities',async()=>{
 const f=fixture();assert.equal(typeof f.handler,'function');for(const change of [r=>r.body.package={},r=>r.body.analysis={},r=>r.body.styleAcknowledged=false,r=>r.body.strategyVersion=2,r=>r.body.expectedHash='bad',r=>r.params.version='0',r=>r.params.resourceId='other']){const r=req();change(r);await assert.rejects(()=>f.handler(r))}assert.equal(f.calls.length,0)
})
test('style comparison uses verified private source and refuses PDF replacement',async()=>{
 const {fixture:design}=await import('./fixtures/sparse-derivation.mjs'),f=design(),routes=new Map();let oldReads=0,compares=0
 const origin={sourceKind:'resource-style',strategyVersion:1,resourceId:id,version:1,hash:'a'.repeat(64),name:'Source',layoutId:'source',html:'<p>source sample</p>'}
 registerLayoutRoutes({app:{get(){},post:(p,...a)=>routes.set(p,a.at(-1))},library:{get:async()=>({ownerId:'owner',package:f.resource.document}),resolveStyleSource:async()=>origin,referenceComparison:async()=>{compares++;return{id:'receipt'}}},uploads:{previewBySource(){oldReads++;throw Error('should not read PDF')}}})
 const request={user:{id:'owner'},params:{resourceId:id,version:'2'},body:{layoutId:f.resource.document.layouts[0].id}},reply={header(){}}
 const result=await routes.get('/api/layout-library/:resourceId/:version/compare')(request,reply)
 assert.equal(result.sourcePreviewHtml,origin.html);assert.equal(result.sourceIdentity.sourceKind,'resource-style');assert.equal(result.source,null);assert.equal(oldReads,0);assert.equal(compares,1)
 request.body.source={fileSha256:'a'.repeat(64),pageNumber:1};await assert.rejects(()=>routes.get('/api/layout-library/:resourceId/:version/compare')(request,reply),/不接受原页/)
})
