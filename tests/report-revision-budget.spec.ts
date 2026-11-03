import {mkdtemp,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {it,expect} from 'vitest'
import {reserveReportRevision} from '../src/report/manuscript/revision-budget.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'
import {mkdir,writeFile,readFile} from 'node:fs/promises'
it('permits exactly one recorded recovery after two revisions, without resetting previous attempts',async()=>{
 const root=await mkdtemp(join(tmpdir(),'revision-recovery-')),folder=join(root,'revision')
 const save=async(path:string,value:unknown)=>{await mkdir(folder,{recursive:true});await writeFile(path,JSON.stringify(value))}
 const draft={sourceFingerprint:'fingerprint',projectId:'project',sourceRevision:1} as never
 const keys=[hash({round:1}),hash({round:2})]
 const recovery={id:'verified-native-review-repair',reason:'修复已证明的审查输入缺失后定向修订',sourceFingerprint:'fingerprint',draftHash:hash(draft),baselineKeys:keys}
 try{
  for(const key of keys)await reserveReportRevision(root,folder,draft,key,'content',save)
  await reserveReportRevision(root,folder,draft,hash({round:3}),'content',save,recovery)
  await reserveReportRevision(root,folder,draft,hash({round:3}),'content',save,recovery)
  await expect(reserveReportRevision(root,folder,draft,hash({round:4}),'content',save,recovery)).rejects.toThrow('MANUSCRIPT_REVISION_LIMIT')
  const b=JSON.parse(await readFile(join(folder,'budget-v2.json'),'utf8'))
  expect(b.entries.map((r:any)=>r.key)).toEqual([...keys,hash({round:3})]);expect(b.entries[2].recovery.id).toBe(recovery.id)
 }finally{await rm(root,{recursive:true,force:true})}
})
it('persists two separate bounded stages and replays a reserved key without spending twice',async()=>{
 const root=await mkdtemp(join(tmpdir(),'revision-budget-')),folder=join(root,'revision')
 const save=async(path:string,value:unknown)=>{await mkdir(folder,{recursive:true});await writeFile(path,JSON.stringify(value))}
 const draft={sourceFingerprint:'fingerprint',projectId:'project',sourceRevision:1} as never
 try{
  for(const stage of ['program','content'] as const){
   for(let i=0;i<2;i++){
    await reserveReportRevision(root,folder,draft,hash({stage,i}),stage,save)
    await reserveReportRevision(root,folder,draft,hash({stage,i}),stage,save)
   }
   await expect(reserveReportRevision(root,folder,draft,hash({stage,i:3}),stage,save)).rejects.toThrow('MANUSCRIPT_REVISION_LIMIT')
  }
  expect(JSON.parse(await readFile(join(folder,'index.json'),'utf8'))).toHaveLength(4)
  await expect(reserveReportRevision(root,folder,draft,hash({stage:'program',i:0}),'content',save)).rejects.toThrow('MANUSCRIPT_REVISION_STAGE_CHANGED')
 }finally{await rm(root,{recursive:true,force:true})}
})
