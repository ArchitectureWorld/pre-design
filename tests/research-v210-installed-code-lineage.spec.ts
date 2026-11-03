import {afterEach,describe,it,expect} from 'vitest'
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {assertInstalledCodeLineage} from '../scripts/verification/installed-code-lineage.mjs'
const cleanups:string[]=[]
afterEach(()=>{for(const path of cleanups.splice(0))rmSync(path,{recursive:true,force:true})})
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'installed-lineage-'));cleanups.push(root)
 const hashes=['original','first repair','second repair'].map(text=>createHash('sha256').update(text).digest('hex'))
 const paths=['original','first','second'].map(name=>join(root,name+'.json'))
 const manifests=paths.map((installedManifest,index)=>({installedManifest,status:'installed',installed:true,targetIndexSha256:hashes[index],
  validators:[{path:'unchanged-validator.ts',sha256:'a'.repeat(64)}],
  ...(index?{previousInstalledManifest:paths[index-1],expectedInstalledIndexSha256:hashes[index-1],installEvidence:join(root,'install-'+index+'.json')}:{})}))
 const installs=manifests.slice(1).map((_,index)=>{
  const backup=join(root,'backup-'+(index+1));mkdirSync(join(backup,'lib'),{recursive:true})
  writeFileSync(join(backup,'lib','index.js'),index?'first repair':'original')
  return {status:'files-installed',scope:'3081 only',activeNativeChildren:0,production3080Unchanged:true,backup,
   previousIndexSha256:hashes[index],targetIndexSha256:hashes[index+1]}
 })
 const save=()=>{manifests.forEach((row,index)=>writeFileSync(paths[index]!,JSON.stringify(row)));installs.forEach((row,index)=>writeFileSync(join(root,'install-'+(index+1)+'.json'),JSON.stringify(row)))}
 save();return {root,hashes,paths,manifests,installs,save}
}
describe('historical native results require verified installation lineage',()=>{
 it('accepts the currently verified package identity',()=>{
  const f=fixture();expect(assertInstalledCodeLineage(f.manifests[2],f.hashes[2])).toMatchObject({depth:0})
 })
 it('accepts a historical package through two preserved idle installations',()=>{
  const f=fixture();expect(assertInstalledCodeLineage(f.manifests[2],f.hashes[0])).toMatchObject({depth:2,installedManifest:f.paths[0]})
 })
 it.each(['parent-hash','backup','validators','production','active-native'] as const)('rejects an unverified historical lineage: %s',damage=>{
  const f=fixture()
  if(damage==='parent-hash')f.manifests[2]!.expectedInstalledIndexSha256='b'.repeat(64)
  if(damage==='backup')writeFileSync(join(f.installs[1]!.backup,'lib','index.js'),'altered backup')
  if(damage==='validators')f.manifests[1]!.validators[0]!.sha256='c'.repeat(64)
  if(damage==='production')f.installs[1]!.production3080Unchanged=false
  if(damage==='active-native')f.installs[1]!.activeNativeChildren=1
  f.save();expect(()=>assertInstalledCodeLineage(f.manifests[2],f.hashes[0])).toThrow()
 })
 it('rejects a code hash absent from the verified installation chain',()=>{
  const f=fixture();expect(()=>assertInstalledCodeLineage(f.manifests[2],'f'.repeat(64))).toThrow()
 })
})
