import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,mkdir,rm,symlink} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {captureReferenceArtifacts} from '../src/layout-library/reference-artifacts.mjs'
const hash=b=>createHash('sha256').update(b).digest('hex')
test('capture keeps SVG bytes beyond temporary workspace, never copies the original',async t=>{
 const root=await mkdtemp(join(tmpdir(),'reference-artifacts-'));t.after(()=>rm(root,{recursive:true,force:true}))
 await mkdir(join(root,'svg'));const data=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');await writeFile(join(root,'svg','slide.svg'),data)
 const files=[{path:'svg/slide.svg',bytes:data.length,sha256:hash(data)},{path:'sources/source.pptx',bytes:5,sha256:hash('input')}]
 const result=await captureReferenceArtifacts({workspace:root,inventory:{files}})
 await rm(root,{recursive:true,force:true})
 assert.equal(result.length,1);assert.deepEqual(result[0].data,data);assert.equal(result[0].path,'svg/slide.svg')
})
test('capture refuses unsafe paths, hash changes, symlinks, oversized files and cancellation',async t=>{
 const root=await mkdtemp(join(tmpdir(),'reference-artifacts-'));t.after(()=>rm(root,{recursive:true,force:true}))
 await writeFile(join(root,'test.svg'),'x');await symlink(join(root,'test.svg'),join(root,'link.svg'))
 for(const file of [{path:'../secret',bytes:1,sha256:hash('x')},{path:'test.svg',bytes:1,sha256:hash('y')},{path:'link.svg',bytes:1,sha256:hash('x')},{path:'test.svg',bytes:80*1024*1024,sha256:hash('x')}])await assert.rejects(captureReferenceArtifacts({workspace:root,inventory:{files:[file]}}))
 const c=new AbortController();c.abort();await assert.rejects(captureReferenceArtifacts({workspace:root,inventory:{files:[]},signal:c.signal}),{name:'AbortError'})
})
