import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createTestDb} from './support/dossier-db.mjs'
import {createLayoutLibrary} from '../src/layout-library/store.mjs'
import {createLayoutAnnotations} from '../src/layout-library/layout-annotations.mjs'
import {createPackage} from '../src/layout-library/contract.mjs'
const actor={id:'owner',role:'user'}
test('actual PostgreSQL: resource lock, lost-edit prevention and competing batch rollback',{skip:!process.env.PRE_DOSSIER_TEST_DATABASE,timeout:30000},async t=>{
 const env=await createTestDb();t.after(env.close);assert.equal(env.engine,'postgresql');const db=env.db;await db.query('CREATE TABLE jobs(id uuid PRIMARY KEY,status text,result jsonb)');const library=await createLayoutLibrary(db),store=await createLayoutAnnotations(db,library),p=createPackage('Lock regression'),r=await library.create(actor,{requestId:'r',package:p}),resource=await library.get(actor,r.id,1),anchor={resourceId:r.id,version:1,packageHash:resource.hash,layoutId:p.layouts[0].id}
 // Hold a real resource writer lock, then change its latest version while note creation waits.
 const writer=await db.connect();let creating
 try{await writer.query('BEGIN');await writer.query('SELECT id FROM layout_library_resources WHERE id=$1 FOR UPDATE',[r.id]);let settled=false;creating=store.create(actor,{requestId:'create-stale',anchor,text:'stale'}).then(v=>{settled=true;return{value:v}},e=>{settled=true;return{error:e}});await new Promise(resolve=>setTimeout(resolve,100));assert.equal(settled,false,'note creation must wait for the resource writer');await writer.query('UPDATE layout_library_resources SET version=2 WHERE id=$1',[r.id]);await writer.query('COMMIT')}finally{writer.release()}
 assert.match((await creating).error?.message??'',/版本已变化/);assert.equal((await store.list(actor,r.id,1)).length,0)
 await db.query('UPDATE layout_library_resources SET version=1 WHERE id=$1',[r.id]);const n=await store.create(actor,{requestId:'note',anchor,text:'original'})
 const edits=await Promise.allSettled(['A','B'].map(text=>store.change(actor,{requestId:'edit-'+text,resourceId:r.id,noteId:n.id,text,expectedRevision:0},'edit')));assert.equal(edits.filter(x=>x.status==='fulfilled').length,1);assert.match(edits.find(x=>x.status==='rejected').reason.message,/批注已变化/)
 const b={resourceId:r.id,resourceVersion:1,packageHash:anchor.packageHash,annotationIds:[n.id],annotationRevisions:{[n.id]:1}}
 async function submit(){const c=await db.connect();try{await c.query('BEGIN');await store.prepareBatch(actor,b,c);const jobId=randomUUID();await c.query("INSERT INTO jobs(id,status) VALUES($1,'queued')",[jobId]);await store.submit(actor,b.annotationIds,jobId,c);await c.query('COMMIT');return jobId}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}}
 const batches=await Promise.allSettled([submit(),submit()]);assert.equal(batches.filter(x=>x.status==='fulfilled').length,1);assert.match(batches.find(x=>x.status==='rejected').reason.message,/已提交/);assert.equal((await db.query('SELECT count(*)::int AS n FROM jobs')).rows[0].n,1);assert.equal((await db.query('SELECT count(*)::int AS n FROM layout_annotation_batches')).rows[0].n,1)
})
