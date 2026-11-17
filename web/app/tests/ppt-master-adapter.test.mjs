import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {runPptMasterImport} from '../src/layout-library/ppt-master-adapter.mjs'

test('PPT Master adapter rejects non-PPTX sources and workspaces outside private root',async()=>{
 await assert.rejects(()=>runPptMasterImport({sourcePath:'/tmp/example.pdf',workspace:'/tmp/pre-layout-test/work'}),/PPTX/)
 await assert.rejects(()=>runPptMasterImport({sourcePath:'/tmp/example.pptx',workspace:'/var/tmp/not-private'}),/私有临时根目录/)
})
test('PPT Master adapter refuses a non-empty workspace before launching tools',async()=>{
 const root=await mkdtemp(join(tmpdir(),'pre-layout-adapter-test-'))
 const work=join(root,'work');await mkdir(work);await writeFile(join(work,'existing'),'x')
 try{await assert.rejects(()=>runPptMasterImport({sourcePath:'/tmp/example.pptx',workspace:work}),/必须为空/)}finally{await rm(root,{recursive:true,force:true})}
})
