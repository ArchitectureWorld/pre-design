import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import childProcess from 'node:child_process'
import {syncBuiltinESMExports} from 'node:module'
import * as api from '../src/layout-library/ppt-master-quality.mjs'
import {EventEmitter} from 'node:events'
import {PassThrough} from 'node:stream'
const input=()=>({canvas:{width:1600,height:900},prototypes:[{id:'test',prototypeSvg:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900"><rect width="16" height="900" fill="#3454a0"/></svg>'}]})
// Observe only directories created by this test worker's actual adapter calls.
// Other test files run concurrently and may legitimately retain their own workspaces.
async function withTrackedWorkspaces(run,expectedCount){
 const original=fs.mkdtemp,paths=[]
 fs.mkdtemp=async(...args)=>{const path=await original(...args);paths.push(path);return path};syncBuiltinESMExports()
 try{await run()}finally{
  fs.mkdtemp=original;syncBuiltinESMExports()
  assert.equal(paths.length,expectedCount)
  for(const path of paths)await assert.rejects(fs.stat(path),error=>error.code==='ENOENT',`adapter did not clean its workspace: ${path}`)
 }
}
test('real pinned SVG checker validates private canonical SVG and returns deterministic receipt',async()=>withTrackedWorkspaces(async()=>{
 assert.ok(api,'upstream quality adapter must exist')
 const a=await api.runPptMasterQualityCheck(input()),b=await api.runPptMasterQualityCheck(input())
 assert.equal(a.status,'passed');assert.deepEqual(a.errors,[]);assert.deepEqual(a.receipt,b.receipt);assert.equal(a.receipt.checker,'ppt-master-svg-quality');assert.match(a.receipt.inputHash,/^[a-f0-9]{64}$/);assert(a.warnings.some(w=>w.includes('3454')))
},2))
test('unsafe SVG is rejected before any child process spawn',async()=>{
 assert.ok(api);let calls=0;const original=childProcess.spawn;childProcess.spawn=()=>{calls++;throw new Error('must not launch')};syncBuiltinESMExports()
 try{const v=input();v.prototypes[0].prototypeSvg='<svg><script>bad</script></svg>';await assert.rejects(api.runPptMasterQualityCheck(v));assert.equal(calls,0)}finally{childProcess.spawn=original;syncBuiltinESMExports()}
})
test('cancelled upstream checker terminates and removes private workspace',async()=>withTrackedWorkspaces(async()=>{
 assert.ok(api);const controller=new AbortController();const pending=api.runPptMasterQualityCheck({...input(),signal:controller.signal});const timer=setTimeout(()=>controller.abort(),20)
 try{await assert.rejects(pending,e=>e.name==='AbortError')}finally{clearTimeout(timer)}
},1))

test('unavailable checker, nonzero exit and output limit fail closed with cleanup',async()=>withTrackedWorkspaces(async()=>{
 for(const mode of ['unavailable','failed','output']){
  const original=childProcess.spawn
  childProcess.spawn=()=>{const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};setImmediate(()=>{if(mode==='unavailable')child.emit('error',new Error('ENOENT'));if(mode==='output')child.stdout.write(Buffer.alloc(4*1024*1024+1));child.emit('close',mode==='failed'?1:0)});return child};syncBuiltinESMExports()
  try{await assert.rejects(api.runPptMasterQualityCheck(input()),e=>e.code===({unavailable:'PPT_MASTER_QUALITY_UNAVAILABLE',failed:'PPT_MASTER_QUALITY_FAILED',output:'PPT_MASTER_QUALITY_OUTPUT_LIMIT'}[mode]))}finally{childProcess.spawn=original;syncBuiltinESMExports()}
 }
},3))
