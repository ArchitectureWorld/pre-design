import { readFile, writeFile } from 'node:fs/promises'
const config = JSON.parse(await readFile('.local/web/config.json','utf8'))
const p = JSON.parse(await readFile('.cache/web-e2e/project.json','utf8'))
const state = await (await fetch(`http://127.0.0.1:4318/api/projects/${p.id}/state`,{ headers: { authorization:`Bearer ${config.users[0].token}` } })).json()
await writeFile('.cache/web-e2e/state.json',JSON.stringify(state,null,2))
console.log(JSON.stringify({id:p.id,revision:state.revision,jobs:state.jobs?.map(j=>({id:j.id,status:j.status,error:j.error})),proposals:state.core?.proposals?.map(p=>({id:p.proposalId,status:p.status})),materials:state.materials?.length}))
