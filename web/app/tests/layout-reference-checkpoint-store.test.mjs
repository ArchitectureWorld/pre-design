import test from 'node:test'
import assert from 'node:assert/strict'
import {createTestDb} from './support/dossier-db.mjs'
import {createReferenceCheckpointStore} from '../src/layout-library/reference-checkpoint-store.mjs'
test('private checkpoints are durable, owner-scoped and never overwrite conflicting results',async t=>{
 const env=await createTestDb();t.after(()=>env.close())
 const stores=await createReferenceCheckpointStore(env.db),a=stores({id:'one'}),b=stores({id:'two'}),key='a'.repeat(64),record={key,recordHash:'accepted',raw:{safe:true}}
 await a.put(key,record);assert.deepEqual(await a.get(key),record);assert.equal(await b.get(key),undefined)
 await a.put(key,record);await assert.rejects(a.put(key,{...record,recordHash:'other'}),e=>e.code==='REFERENCE_CHECKPOINT_CONFLICT');assert.deepEqual(await a.get(key),record)
 await assert.rejects(a.get('../source'));assert.throws(()=>stores({}))
})
