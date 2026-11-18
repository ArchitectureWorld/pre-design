import test from 'node:test'
import assert from 'node:assert/strict'
import {createTestDb} from './support/dossier-db.mjs'
import {createLayoutLibrary} from '../src/layout-library/store.mjs'
import {fixture} from './fixtures/sparse-derivation.mjs'
test('atomic same-resource derive: idempotent replay, stale conflict, no review inheritance',async t=>{
 const env=await createTestDb();t.after(env.close)
 const wrap=c=>({query:async(...a)=>{const r=await c.query(...a);for(const row of r.rows??[])for(const k of ['document','validation'])if(typeof row[k]==='string')row[k]=JSON.parse(row[k]);return r},release:()=>c.release?.()})
 const db={...wrap(env.db),connect:async()=>wrap(await env.db.connect())},lib=await createLayoutLibrary(db),f=fixture()
 assert.equal(typeof lib.deriveSparse,'function')
 await db.query('CREATE TABLE jobs(id uuid PRIMARY KEY,owner_id text,kind text,status text,result jsonb)')
 const original=await lib.create(f.actor,{requestId:'original',package:f.resource.document});f.job.result.id=original.id
 await db.query('INSERT INTO jobs(id,owner_id,kind,status,result) VALUES($1,$2,$3,$4,$5)',[f.job.id,f.actor.id,'layout-reference','completed',f.job.result])
 const b={...f.request,id:original.id}
 const [a,replay]=await Promise.all([lib.deriveSparse(f.actor,b),lib.deriveSparse(f.actor,b)])
 assert.deepEqual(a,replay);assert.deepEqual(Object.keys(a).sort(),['derived','hash','id','version']);assert.equal(a.id,original.id);assert.equal(a.version,2)
 const saved=await lib.get(f.actor,a.id,2);assert.equal(saved.validation,null);assert.equal(saved.referenceReview,null);assert.equal(saved.published,false)
 assert.deepEqual((await lib.get(f.actor,a.id,1)).package,f.resource.document)
 await assert.rejects(()=>lib.deriveSparse(f.actor,{...b,requestId:'stale'}),/版本/)
 const rows=(await db.query('SELECT result FROM layout_library_mutations WHERE actor_id=$1 AND request_id=$2',[f.actor.id,b.requestId])).rows
 assert.equal(rows[0].result.receipt.jobId,f.job.id)
 await assert.rejects(()=>lib.deriveSparse({id:'admin',role:'admin'},{...b,requestId:'other'}),/不存在/)
})
