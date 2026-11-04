import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
const script=fileURLToPath(new URL('../check-fixed-entry.mjs',import.meta.url))
test('fixed LAN startup rejects port drift and loopback-only config without exposing secrets',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'pre-fixed-entry-')),config=join(dir,'config.json')
 try{
  for(const [host,port,expected] of [['0.0.0.0',4320,0],['192.168.6.45',4320,0],['0.0.0.0',4318,78],['0.0.0.0',0,78],['127.0.0.1',4320,78]]){
   await writeFile(config,JSON.stringify({host,port,users:[{token:'DO_NOT_PRINT'}]}))
   const r=spawnSync(process.execPath,[script],{env:{...process.env,PRE_WEB_CONFIG:config},encoding:'utf8'})
   assert.equal(r.status,expected,`${host}:${port}: ${r.stderr}`)
   assert.ok(!`${r.stdout}${r.stderr}`.includes('DO_NOT_PRINT'))
  }
 }finally{await rm(dir,{recursive:true,force:true})}
})
