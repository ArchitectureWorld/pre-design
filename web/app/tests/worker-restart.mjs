import {readFile,readdir,writeFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
const config=JSON.parse(await readFile('.local/web/config.json','utf8')), project=JSON.parse(await readFile('.cache/web-e2e/project.json','utf8'))
const url=`http://127.0.0.1:4318/api/projects/${project.id}/state`,headers={authorization:`Bearer ${config.users[0].token}`}
const before=await(await fetch(url,{headers})).json()
let pid
for(const entry of await readdir('/proc')){if(!/^\d+$/.test(entry))continue;const args=await readFile(`/proc/${entry}/cmdline`,'utf8').catch(()=> '');if(args.includes('/@deepseek-ai/dsh/lib/bin.js\0')&&args.includes(`/workers/${project.id}/web.cordis.yml`)){pid=Number(entry);break}}
assert.ok(pid,'owned project Worker must exist')
process.kill(pid,'SIGKILL')
await new Promise(r=>setTimeout(r,300))
const lost=await fetch(url,{headers});assert.equal(lost.status,500)
const after=await(await fetch(url,{headers})).json()
assert.equal(after.revision,before.revision);assert.deepEqual(after.annotations,before.annotations)
assert.equal(after.jobs.length,before.jobs.length)
await writeFile('.cache/web-e2e/worker-crash-recovery.json',JSON.stringify({projectId:project.id,firstRead:lost.status,recoveredRevision:after.revision,annotationStates:after.annotations.map(a=>a.status),noTaskReplay:after.jobs.length===before.jobs.length},null,2))
console.log('PASS: owned Worker killed; failed read reported, next read resumed original state without replaying Agent')
