import test from 'node:test'
import assert from 'node:assert/strict'
import {registerLayoutRoutes} from '../src/layout-library/routes.mjs'
const path='/api/layout-library/:resourceId/:version/derive-sparse-cards',id='11111111-1111-4111-8111-111111111111'
function fixture(){const routes=new Map(),calls=[];registerLayoutRoutes({app:{get(){},post:(p,...args)=>routes.set(p,args.at(-1))},library:{deriveSparse:async(...args)=>{calls.push(args);return{id,version:2,hash:'b'.repeat(64),derived:true}}}});return{handler:routes.get(path),calls}}
const req=()=>({user:{id:'owner'},params:{resourceId:id,version:'1'},body:{requestId:'derive-1',expectedHash:'a'.repeat(64),strategyVersion:1,source:{fileSha256:'c'.repeat(64),pageNumber:7}}})
test('sparse route accepts only versioned explicit server-side derivation inputs',async()=>{const f=fixture();assert.equal(typeof f.handler,'function');const r=req(),result=await f.handler(r);assert.equal(result.version,2);assert.deepEqual(f.calls[0],[r.user,{...r.body,id,version:1}])})
test('sparse route rejects client analysis, packages, unrecognized strategy and invalid identities',async()=>{
 const f=fixture();assert.equal(typeof f.handler,'function');for(const change of [r=>r.body.package={},r=>r.body.analysis={},r=>r.body.source.extra='fake',r=>r.body.strategyVersion=2,r=>r.body.expectedHash='bad',r=>r.params.version='0',r=>r.params.resourceId='other']){const r=req();change(r);await assert.rejects(()=>f.handler(r))}assert.equal(f.calls.length,0)
})
