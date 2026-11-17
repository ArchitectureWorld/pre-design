import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createReferenceUploads} from '../src/layout-library/reference-uploads.mjs'
test('private reference storage provides bounded continuation and batch-loading boundaries',async t=>{
 const root=await mkdtemp(join(tmpdir(),'reference-pages-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const uploads=await createReferenceUploads({query:async()=>({rows:[]})},{root})
 for(const method of ['ensurePdfPages','imageManifest','loadImageBatch'])assert.equal(typeof uploads[method],'function',method)
 await assert.rejects(()=>uploads.loadImageBatch({id:'owner'},Array.from({length:7},()=>({}))),/6/)
})
