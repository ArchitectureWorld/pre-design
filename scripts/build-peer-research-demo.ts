import { mkdir, readFile, copyFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { loadPeerWorkspaceInput } from '../src/research-v2/peer-command.ts'
import { analyzePeers } from '../src/research-v2/peer-analysis.ts'
import { buildPeerAuditBundle, savePeerAuditBundle, replayPeerAuditBundle } from '../src/research-v2/peer-bundle.ts'
import { buildRegionalAuditBundle, replayRegionalAuditBundle } from '../src/research-v2/regional-bundle.ts'
import { runRegionalOd } from '../src/research-v2/regional-od.ts'
import { saveRegionalAuditBundle } from '../src/research-v2/run-store.ts'
const root=resolve(process.argv[2]??'work/research-peer-demo')
await mkdir(join(root,'research'),{recursive:true})
for(const name of ['peers.request.json','peers.synthetic-source.json'])await copyFile(resolve('examples/research',name),join(root,'research',name))
const request=await loadPeerWorkspaceInput(root,'research/peers.request.json',{projectId:'synthetic-peer-project',revision:1})
const result=analyzePeers(request),bundle=buildPeerAuditBundle(result),saved=await savePeerAuditBundle(root,bundle)
let od:unknown=null
if(bundle.files['regional-od.request.json']){
  const output=await runRegionalOd(JSON.parse(bundle.files['regional-od.request.json']),{allowNetwork:false})
  const audit=buildRegionalAuditBundle(output),stored=await saveRegionalAuditBundle(root,audit)
  od={...stored,replay:await replayRegionalAuditBundle(audit)}
}
const metadata={synthetic:true,networkRequests:0,peerRun:saved,peerReplay:replayPeerAuditBundle(bundle),regionalRun:od}
await writeFile(join(root,'DEMO.json'),JSON.stringify(metadata,null,2)+'\n')
console.log(JSON.stringify(metadata,null,2))
