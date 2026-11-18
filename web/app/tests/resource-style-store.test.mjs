import test from 'node:test'
import assert from 'node:assert/strict'
import {createTestDb} from './support/dossier-db.mjs'
import {createLayoutLibrary} from '../src/layout-library/store.mjs'
import {fixture} from './fixtures/sparse-derivation.mjs'
test('atomic same-resource derive: idempotent replay, stale conflict, no review inheritance',async t=>{
 const env=await createTestDb();t.after(env.close)
 const wrap=c=>({query:async(...a)=>{const r=await c.query(...a);for(const row of r.rows??[])for(const k of ['document','validation'])if(typeof row[k]==='string')row[k]=JSON.parse(row[k]);return r},release:()=>c.release?.()})
 const db={...wrap(env.db),connect:async()=>wrap(await env.db.connect())},lib=await createLayoutLibrary(db),f=fixture()
 assert.equal(typeof lib.deriveStyle,'function')
 await db.query('CREATE TABLE jobs(id uuid PRIMARY KEY,owner_id text,kind text,status text,result jsonb)')
 const original=await lib.create(f.actor,{requestId:'original',package:f.resource.document});f.job.result.id=original.id

 const b={...f.request,id:original.id,styleAcknowledged:true}
 const [a,replay]=await Promise.all([lib.deriveStyle(f.actor,b),lib.deriveStyle(f.actor,b)])
 assert.deepEqual(a,replay);assert.deepEqual(Object.keys(a).sort(),['derived','hash','id','version']);assert.equal(a.id,original.id);assert.equal(a.version,2)
 const origin=await lib.resolveStyleSource(f.actor,{id:a.id,version:2,layoutId:'style-adaptation-2'});assert.equal(origin.sourceKind,'resource-style');assert.equal(origin.version,1);assert.match(origin.html,/data-native-page/);assert.equal(await lib.resolveStyleSource(f.actor,{id:a.id,version:2,layoutId:f.resource.document.layouts[0].id}),null)
 const saved=await lib.get(f.actor,a.id,2);assert.equal(saved.validation,null);assert.equal(saved.referenceReview,null);assert.equal(saved.published,false)
 assert.deepEqual((await lib.get(f.actor,a.id,1)).package,f.resource.document)
 await assert.rejects(()=>lib.deriveStyle(f.actor,{...b,requestId:'stale'}),/版本/)
 const rows=(await db.query('SELECT result FROM layout_library_mutations WHERE actor_id=$1 AND request_id=$2',[f.actor.id,b.requestId])).rows
 assert.equal(rows[0].result.receipt.sourceKind,'resource-style');assert(!('jobId' in rows[0].result.receipt))
 const result=rows[0].result;result.receipt.sourceHash='f'.repeat(64);await db.query('UPDATE layout_library_mutations SET result=$1 WHERE actor_id=$2 AND request_id=$3',[result,f.actor.id,b.requestId]);await assert.rejects(()=>lib.resolveStyleSource(f.actor,{id:a.id,version:2,layoutId:'style-adaptation-2'}))
 assert.equal(Number((await db.query('SELECT count(*) AS n FROM layout_library_versions WHERE resource_id=$1',[a.id])).rows[0].n),2)
 await assert.rejects(()=>lib.deriveStyle({id:'admin',role:'admin'},{...b,requestId:'other'}),/不存在/)
})

test('metadata revision of style-derived draft retains exact private source without PDF fallback',async t=>{
 const env=await createTestDb();t.after(env.close)
 const wrap=c=>({query:async(...a)=>{const r=await c.query(...a);for(const row of r.rows??[])for(const k of ['document','validation'])if(typeof row[k]==='string')row[k]=JSON.parse(row[k]);return r},release:()=>c.release?.()})
 const db={...wrap(env.db),connect:async()=>wrap(await env.db.connect())},lib=await createLayoutLibrary(db),f=fixture()
 const base=await lib.create(f.actor,{requestId:'base',package:f.resource.document}),next=await lib.deriveStyle(f.actor,{...f.request,id:base.id,styleAcknowledged:true}),saved=await lib.get(f.actor,next.id,next.version)
 const revised=await lib.revise(f.actor,{id:next.id,expectedVersion:2,requestId:'rename',package:{...saved.package,name:'改名后的适配版'}})
 assert.equal((await lib.resolveStyleSource(f.actor,{id:next.id,version:revised.version,layoutId:'style-adaptation-2'})).version,1)
 assert.equal(await lib.resolveStyleSource(f.actor,{id:next.id,version:revised.version,layoutId:f.resource.document.layouts[0].id}),null)
 assert.equal((await lib.resolveStyleSource(f.actor,{id:next.id,version:2,layoutId:'style-adaptation-2'})).version,1)
})
