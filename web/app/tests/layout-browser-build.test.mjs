import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {tmpdir} from 'node:os'
import {resolve,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
test('built layout browser entry includes every relative static module dependency',async()=>{
 const app=resolve(dirname(fileURLToPath(import.meta.url)),'..'),out=await mkdtemp(resolve(tmpdir(),'layout-browser-build-'))
 try{
  execFileSync(process.execPath,[resolve(app,'build-prototype.mjs')],{cwd:app,env:{...process.env,PRE_WEB_BUILD_DIR:out},stdio:'pipe'})
  const seen=new Set(),visit=async path=>{if(seen.has(path))return;seen.add(path);let code;try{code=await readFile(path,'utf8')}catch{assert.fail('built browser module missing: '+path.slice(out.length))}
   for(const m of code.matchAll(/(?:\bfrom\s*|\bimport\s*)['"](\.[^'"]+)['"]/g))await visit(resolve(dirname(path),m[1]))
  }
  await visit(resolve(out,'layout-library/ui.js'));assert(seen.has(resolve(out,'layout-library/project-preview-ui.js')))
 }finally{await rm(out,{recursive:true,force:true})}
})
