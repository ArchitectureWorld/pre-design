import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createHash} from 'node:crypto'
import {dirname,resolve,relative,isAbsolute,join,sep} from 'node:path'
const read=path=>JSON.parse(fs.readFileSync(path,'utf8').replace(/^\uFEFF/,''))
const digest=path=>createHash('sha256').update(fs.readFileSync(path)).digest('hex')
const within=(root,path)=>{const suffix=relative(root,resolve(path));return suffix!=='..'&&!suffix.startsWith('..'+sep)&&!isAbsolute(suffix)}

/** A historical receipt cannot be rebound to an unverified installed package. */
export function assertInstalledCodeLineage(installed,requestedSha256){
 assert.match(requestedSha256,/^[a-f0-9]{64}$/u)
 const root=dirname(resolve(installed.installedManifest)),visited=new Set()
 let current=installed
 for(let depth=0;depth<16;depth++){
  assert.equal(current.status,'installed');assert.equal(current.installed,true)
  assert(within(root,current.installedManifest));assert(!visited.has(resolve(current.installedManifest)),'Cyclic installation history')
  visited.add(resolve(current.installedManifest))
  if(current.targetIndexSha256===requestedSha256)return {depth,installedManifest:current.installedManifest}
  assert(current.previousInstalledManifest&&current.installEvidence,'Unknown historical package')
  assert(within(root,current.previousInstalledManifest));assert(within(root,current.installEvidence))
  const parent=read(current.previousInstalledManifest),install=read(current.installEvidence)
  assert.equal(resolve(parent.installedManifest),resolve(current.previousInstalledManifest))
  assert.equal(current.expectedInstalledIndexSha256,parent.targetIndexSha256)
  assert.equal(install.status,'files-installed');assert.equal(install.scope,'3081 only')
  assert.equal(install.production3080Unchanged,true);assert.equal(install.activeNativeChildren,0)
  assert.equal(install.previousIndexSha256,parent.targetIndexSha256);assert.equal(install.targetIndexSha256,current.targetIndexSha256)
  assert(within(root,install.backup));assert.equal(digest(join(install.backup,'lib/index.js')),parent.targetIndexSha256)
  assert.deepEqual(current.validators,parent.validators,'Changed validators require fresh independent acceptance')
  current=parent
 }
 throw Error('Installation history too deep')
}
