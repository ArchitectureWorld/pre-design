import {expect,it} from 'vitest'
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'
import {ChapterProductionService} from '../src/report/chapter-production.ts'
import {validateNativeLayoutCandidate,mergeScopedLayoutDecision} from '../src/report/chapter-layout-revision.ts'

const output:any={pages:[{pageId:'p1',reason:'native one'},{pageId:'p2',reason:'native two'}]}
const reference={receipt:'layout-revision-aaaaaaaaaaaa-native.json',childId:'native-child',outputHash:hash(output)}
const route={provider:'native',model:'chosen'}
const events=()=>[
 {seq:1,type:'turn/start',data:{turn:1}},
 {seq:2,type:'request/header',data:{header:{config:route}}},
 {seq:3,type:'tool/call',data:{turn:1,step:0,name:'structured_output',callId:'c',arguments:JSON.stringify(output)}},
 {seq:4,type:'tool/result',data:{turn:1,step:0,message:{content:[{type:'tool-result',toolCallId:'c',isError:false,content:[]}]}}},
 {seq:5,type:'turn/end',data:{turn:1,reason:{kind:'completed'}}},
]
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'chapter-native-candidate-'))
 const attempt={executionId:'e1',childId:reference.childId,status:'failed',stopReason:'completed',output,error:'Error: CHAPTER_LAYOUT_PAGE_ERRORS: p2'}
 const ledger={attempts:[attempt,{...attempt,childId:'later-child',output:{pages:[]}}]}
 const path=join(root,reference.receipt)
 await writeFile(path,JSON.stringify(ledger))
 const execution={projectId:'project',childId:reference.childId,status:'failed',childStopReason:'completed',selected:route,actual:route}
 const service:any=new ChapterProductionService({classes:{execution:()=>execution},readEvents:async()=>events()} as any)
 return {root,path,service,execution,ledger}
}
it('resumes completed scene briefs from native proof after partial image generation changes the asset catalog',async()=>{
 const f=await fixture(),phase='scene-briefs-aaaaaaaaaaaa'
 try{
  f.execution.status='completed'
  const ledger={inputHash:'original-asset-catalog-hash',attempts:[{...f.ledger.attempts[0],status:'completed',outputHash:hash(output)}]}
  await writeFile(join(f.root,phase+'-native.json'),JSON.stringify(ledger))
  expect(await f.service.readCompletedSceneBriefs(f.root,phase,'project',()=>{})).toEqual(output)
  await expect(f.service.readCompletedSceneBriefs(f.root,phase,'foreign-project',()=>{})).rejects.toThrow('NATIVE_UNVERIFIED')
  ledger.attempts[0]!.outputHash='0'.repeat(64)
  await writeFile(join(f.root,phase+'-native.json'),JSON.stringify(ledger))
  await expect(f.service.readCompletedSceneBriefs(f.root,phase,'project',()=>{})).rejects.toThrow('NATIVE_UNVERIFIED')
 }finally{await rm(f.root,{recursive:true,force:true})}
})
it('keeps unchanged native pages exact while rejecting altered candidate hashes or page order',()=>{
 expect(validateNativeLayoutCandidate(reference,output,output)).toBe(output)
 const merged=mergeScopedLayoutDecision(output,{pages:[{pageId:'p2',reason:'new native repair'}]} as any,['p2'])
 expect(merged.pages[0]).toBe(output.pages[0])
 expect(()=>validateNativeLayoutCandidate({...reference,outputHash:'0'.repeat(64)},output,output)).toThrow('CANDIDATE_CHANGED')
 const reordered={pages:[...output.pages].reverse()}
 expect(()=>validateNativeLayoutCandidate({...reference,outputHash:hash(reordered)},reordered,output)).toThrow('CANDIDATE_CHANGED')
})
it('replays the selected completed native submission without promoting its failed receipt',async()=>{
 const f=await fixture()
 try{
  const before=await readFile(f.path,'utf8')
  expect(await f.service.readNativeLayoutCandidate(f.root,reference,'project')).toEqual(output)
  expect(await readFile(f.path,'utf8')).toBe(before)
  f.ledger.attempts[0]!.output={pages:[{pageId:'p1',reason:'locally edited'},{pageId:'p2',reason:'native two'}]}
  await writeFile(f.path,JSON.stringify(f.ledger))
  await expect(f.service.readNativeLayoutCandidate(f.root,{...reference,outputHash:hash(f.ledger.attempts[0]!.output)},'project')).rejects.toThrow('REPORT_REVIEW_NATIVE')
 }finally{await rm(f.root,{recursive:true,force:true})}
})
it('rejects foreign paths, projects and incomplete native sources',async()=>{
 const f=await fixture()
 try{
  await expect(f.service.readNativeLayoutCandidate(f.root,{...reference,receipt:'../receipt.json'},'project')).rejects.toThrow('CANDIDATE_PATH')
  await expect(f.service.readNativeLayoutCandidate(f.root,reference,'another-project')).rejects.toThrow('CANDIDATE_UNVERIFIED')
  f.execution.childStopReason='aborted'
  await expect(f.service.readNativeLayoutCandidate(f.root,reference,'project')).rejects.toThrow('CANDIDATE_UNVERIFIED')
 }finally{await rm(f.root,{recursive:true,force:true})}
})
it('reconstructs a scoped repair from its native candidate rather than the older published baseline',async()=>{
 const f=await fixture()
 try{
  const older={pages:[{pageId:'p1',reason:'older page'},{pageId:'p2',reason:'older page'}]}
  const repair={pages:[{pageId:'p2',reason:'native correction'}]}
  const baseReceipt='layout-catalog-v6-native.json',repairReceipt='layout-revision-bbbbbbbbbbbb-native.json'
  for(const [receipt,id,data] of [[baseReceipt,'base',older],[repairReceipt,'repair',repair]] as const){
   await writeFile(join(f.root,receipt),JSON.stringify({attempts:[{executionId:id,childId:id,stopReason:'completed',status:'completed',output:data}]}))
  }
  await writeFile(join(f.root,repairReceipt.replace('-native.json','-scope.json')),JSON.stringify({baseReceipt,baseLayoutHash:hash(older),pageIds:['p2'],nativeCandidate:reference}))
  const dataByChild:any={'native-child':output,base:older,repair}
  const service:any=new ChapterProductionService({classes:{execution:(id:string)=>id==='e1'?f.execution:{...f.execution,childId:id,status:'completed'}},
   readEvents:async(id:string)=>events().map(e=>e.type==='tool/call'?{...e,data:{...e.data,arguments:JSON.stringify(dataByChild[id])}}:e)} as any)
  const result=await service.readLayoutDecision(f.root,repairReceipt)
  expect(result.decision.pages).toEqual([output.pages[0],repair.pages[0]])
  const nextReceipt='layout-revision-cccccccccccc-native.json',next={pages:[{pageId:'p1',reason:'next native correction'}]}
  await writeFile(join(f.root,nextReceipt),JSON.stringify({attempts:[{executionId:'next',childId:'next',stopReason:'completed',status:'completed',output:next}]}))
  await writeFile(join(f.root,nextReceipt.replace('-native.json','-scope.json')),JSON.stringify({baseReceipt:repairReceipt,baseLayoutHash:hash(result.decision),pageIds:['p1']}))
  dataByChild.next=next
  expect((await service.readLayoutDecision(f.root,nextReceipt)).decision.pages).toEqual([next.pages[0],repair.pages[0]])
  await writeFile(join(f.root,nextReceipt.replace('-native.json','-scope.json')),JSON.stringify({baseReceipt:repairReceipt,baseLayoutHash:'0'.repeat(64),pageIds:['p1']}))
  await expect(service.readLayoutDecision(f.root,nextReceipt)).rejects.toThrow('CHAPTER_LAYOUT_REVIEW_CHANGED')
 }finally{await rm(f.root,{recursive:true,force:true})}
})
