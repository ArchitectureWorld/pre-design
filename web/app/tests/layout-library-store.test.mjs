import test from 'node:test'
import assert from 'node:assert/strict'
import {createTestDb} from './support/dossier-db.mjs'
import {createLayoutLibrary} from '../src/layout-library/store.mjs'
import {createPackage,packageDigest,RENDERER} from '../src/layout-library/contract.mjs'
import {FIXTURES_VERSION} from '../src/layout-library/validation.mjs'
const admin={id:'admin',role:'admin'},user={id:'owner',role:'user'},other={id:'other',role:'user'}
async function fixture(t){
 const env=await createTestDb();t.after(env.close)
 // Adapt ONLY JSON columns, never fake SQL or permission results.
 const wrap=c=>({query:async(...a)=>{const r=await c.query(...a);r.rows=r.rows.map(x=>{for(const k of ['document','validation'])if(typeof x[k]==='string')x[k]=JSON.parse(x[k]);return x});return r},release:()=>c.release?.()})
 const db={...wrap(env.db),connect:async()=>wrap(await env.db.connect())}
 const store=await createLayoutLibrary(db);return {store,db}
}
const receipt=p=>({status:'passed',packageHash:packageDigest(p),renderer:RENDERER,fixturesVersion:FIXTURES_VERSION,pageCount:10,issues:[],overflowGuard:true,formats:['html'],testedAt:new Date().toISOString()})
test('私有默认、越权拒绝、验证前不可发布、发布必须显式审阅',async t=>{
 const {store}=await fixture(t),pkg=createPackage()
 const r=await store.create(user,{requestId:'a',package:pkg})
 assert.equal((await store.list(other)).length,0)
 await assert.rejects(()=>store.get(other,r.id,1),/不存在/)
 await assert.rejects(()=>store.publish(user,{requestId:'p',id:r.id,version:1,visibility:'private',reviewed:true}),/检查/)
 await store.saveValidation(user,r.id,1,receipt(pkg))
 await assert.rejects(()=>store.publish(user,{requestId:'p',id:r.id,version:1,visibility:'shared',reviewed:true}),/管理员/)
 await store.publish(user,{requestId:'p',id:r.id,version:1,visibility:'private',reviewed:true})
 assert.equal((await store.get(user,r.id,1)).published,true)
})
test('同请求幂等、旧版本不覆盖、共享发布需授权、退役不删历史',async t=>{
 const {store}=await fixture(t),pkg=createPackage();pkg.rights.shareAllowed=true
 const r=await store.create(user,{requestId:'a',package:pkg});assert.equal((await store.create(user,{requestId:'a',package:pkg})).id,r.id)
 await assert.rejects(()=>store.create(user,{requestId:'a',package:createPackage('不同名称')}),/请求/)
 await store.saveValidation(admin,r.id,1,receipt(pkg))
 await store.requestShare(user,{requestId:'share',id:r.id,version:1})
 await store.publish(admin,{requestId:'pub',id:r.id,version:1,visibility:'shared',reviewed:true})
 assert.equal((await store.list(other)).length,1)
 const p2=createPackage('新版');await store.revise(user,{requestId:'rev',id:r.id,expectedVersion:1,package:p2})
 await assert.rejects(()=>store.revise(user,{requestId:'old',id:r.id,expectedVersion:1,package:p2}),/版本/)
 assert.equal((await store.get(other,r.id,1)).package.name,pkg.name)
 await assert.rejects(()=>store.get(other,r.id,2),/不存在/)
 await store.retire(user,{requestId:'off',id:r.id,expectedVersion:2})
 assert.equal((await store.list(other)).length,0)
 assert.equal((await store.get(user,r.id,1)).package.name,pkg.name)
})
