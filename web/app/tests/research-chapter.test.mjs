import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { createBridgeHandler } from '../../worker/web-bridge.mjs'
const chapters = await import('../../worker/chapter-setup.mjs').catch(() => ({}))

test('章节准备保存真实请求与核验图片，不伪造页表或审批；准备相同输入幂等', async t => {
  assert.equal(typeof chapters.prepareChapter, 'function')
  const workspace = await mkdtemp(join(tmpdir(), 'research-chapter-'))
  t.after(() => rm(workspace, { recursive:true, force:true }))
  await mkdir(join(workspace, '原始资料'))
  const bytes = await sharp({ create:{ width:12,height:8,channels:3,background:'#334455' } }).png().toBuffer()
  const path = join(workspace, '原始资料/photo.png')
  await writeFile(path, bytes)
  const input = { chapterId:'site',message:'请依据所选真实资料编制场地章。',feedback:'保留未核实条件。',assets:[{id:'photo',path,sha256:createHash('sha256').update(bytes).digest('hex'),width:12,height:8,label:'上传照片',sourceNote:'用户上传原图'}] }
  const before = await chapters.chapterPreflight(workspace,{chapterId:'site',stage:'production-plan'},{status:'ready'})
  assert.equal(before.ready,false);assert(before.blockers.some(row=>row.code==='CHAPTER_PRODUCTION_REQUEST_REQUIRED'))
  const prepared = await chapters.prepareChapter(workspace,input,{callerUserId:'owner-1'})
  assert.equal(prepared.status,'configured');assert.doesNotMatch(JSON.stringify(prepared), /\/tmp\//)
  const saved = await readFile(join(workspace,'.pre-design/chapter-production-requests/site.json'),'utf8')
  const request=JSON.parse(saved)
  assert.equal(request.origin,'user-message');assert.equal(request.message,input.message);assert.equal(request.callerUserId,'owner-1')
  assert.equal(request.basePlanHash,undefined);assert.equal(request.approval,undefined)
  await chapters.prepareChapter(workspace,input,{callerUserId:'owner-1'})
  assert.equal(await readFile(join(workspace,'.pre-design/chapter-production-requests/site.json'),'utf8'),saved)
  const optional={...input,chapterId:'opportunity',feedback:''}
  await chapters.prepareChapter(workspace,optional)
  assert.equal((await chapters.chapterPreflight(workspace,{chapterId:'opportunity',stage:'production-plan'},{status:'ready'})).ready,true)
  assert.equal((await chapters.chapterPreflight(workspace,{chapterId:'site',stage:'production-plan'},{status:'ready'})).ready,true)
  assert.equal((await chapters.chapterPreflight(workspace,{chapterId:'site',stage:'write'},{status:'ready'})).ready,false)
  assert.equal((await chapters.chapterPreflight(workspace,{chapterId:'site',stage:'production-plan'},{status:'not_ready'})).ready,false)
  await assert.rejects(chapters.prepareChapter(workspace,{...input,assets:[{...input.assets[0],sha256:'0'.repeat(64)}]}),/CHAPTER_ASSET_CHANGED/)
  await symlink('/etc/passwd',join(workspace,'原始资料/escape.png'))
  await assert.rejects(chapters.prepareChapter(workspace,{...input,assets:[{...input.assets[0],path:join(workspace,'原始资料/escape.png')}]}))
  await mkdir(join(workspace,'.pre-design/report-chapter-plans'))
  await writeFile(join(workspace,'.pre-design/report-chapter-plans/site.json'),JSON.stringify({plan:{chapterId:'site'},approval:{origin:'user-message'}}))
  await assert.rejects(chapters.prepareChapter(workspace,{...input,message:'改变已编排的委托'}),/CHAPTER_SETUP_CONFLICT/)
  assert.equal(await readFile(join(workspace,'.pre-design/chapter-production-requests/site.json'),'utf8'),saved)
})
test('章节预检使用Core真实项目目录resolver，继续读取通用化后的正文、版式与导出', async t => {
  const { chapterProductionDirectory } = await import('../../../lib/index.js')
  assert.equal(typeof chapterProductionDirectory,'function')
  const workspace=await mkdtemp(join(tmpdir(),'research-core-chapter-directory-'))
  t.after(()=>rm(workspace,{recursive:true,force:true}))
  const chapterId='site', project={projectId:'project-core-id',projectName:'当前真实项目'}, request={origin:'user-message',scope:'chapter',chapterId,message:'按当前项目资料编制场地章',feedback:'',requestedAt:'2026-11-03T00:00:00.000Z'}
  for (const folder of ['chapter-production-requests','chapter-production-assets','report-chapter-plans']) await mkdir(join(workspace,'.pre-design',folder),{recursive:true})
  await mkdir(join(workspace,'原始资料'))
  const image=await sharp({create:{width:12,height:8,channels:3,background:'#334455'}}).png().toBuffer()
  const imagePath=join(workspace,'原始资料/photo.png')
  await writeFile(imagePath,image)
  await writeFile(join(workspace,'.pre-design/chapter-production-requests/site.json'),JSON.stringify(request))
  await writeFile(join(workspace,'.pre-design/chapter-production-assets/site.json'),JSON.stringify([{id:'already-checked-source',path:imagePath,sha256:createHash('sha256').update(image).digest('hex'),width:12,height:8,label:'当前项目图片',sourceNote:'测试上传原图'}]))
  await writeFile(join(workspace,'.pre-design/report-chapter-plans/site.json'),JSON.stringify({plan:{chapterId}}))
  const root=chapterProductionDirectory(workspace,project,chapterId,request)
  await mkdir(root,{recursive:true})
  await writeFile(join(root,'brief.json'),JSON.stringify({plan:{chapterId}}))
  await writeFile(join(root,'draft.json'),JSON.stringify({chapter:{id:chapterId}}))
  await writeFile(join(root,'layouts.json'),'[]')
  await writeFile(join(root,'state.json'),JSON.stringify({reviewPath:join(root,'review.json'),manuscriptHash:'fixture-content-hash',layoutHash:'fixture-layout-hash',htmlPath:join(root,'export-version/chapter.html')}))
  const selections=['production-write','production-layout','production-export','production-review']
  for (const stage of selections) {
    const result=await chapters.chapterPreflight(workspace,{chapterId,stage},{status:'ready'},{verifyAssets:false,productionDirectory:(id,input)=>chapterProductionDirectory(workspace,project,id,input)})
    assert.equal(result.ready,true,`${stage}: ${JSON.stringify(result.blockers)}`)
  }
  let resolverCalls=0
  const handle=createBridgeHandler({agents:new Map([['session',{id:'session'}]]),preplanning:{
    repository:{readContext:()=>({project:{projectId:project.projectId,name:project.projectName}})},
    reportAccess:{status:async()=>({status:'ready'}),chapterProductionDirectory:(actualWorkspace,actualProject,id,input)=>{
      assert.equal(actualWorkspace,workspace);assert.deepEqual(actualProject,project);resolverCalls++
      return chapterProductionDirectory(actualWorkspace,actualProject,id,input)
    }},
  }},{workspace,sessionId:'session'})
  assert.equal((await handle({operation:'report-preflight',selection:{chapterId,stage:'production-write'}})).ready,true)
  assert.equal(resolverCalls,1)
  const changed={...project,projectName:'已经更新的项目名称'}
  const result=await chapters.chapterPreflight(workspace,{chapterId,stage:'production-write'},{status:'ready'},{verifyAssets:false,productionDirectory:(id,input)=>chapterProductionDirectory(workspace,changed,id,input)})
  assert.equal(result.ready,false)
  assert(result.blockers.some(row=>row.code==='CHAPTER_PRODUCTION_RESEARCH_FIRST'))
  await assert.rejects(chapters.chapterPreflight(workspace,{chapterId,stage:'production-write'},{status:'ready'},{verifyAssets:false,productionDirectory:()=>'/etc'}))
})
