import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
const artifacts = await import('../../worker/research-artifacts.mjs').catch(() => ({}))
const runId = 'RUN-11111111-1111-4111-8111-111111111111'

test('成果下载只能读取枚举成果且复核替换软链接；汇编不覆盖原模块', async t => {
  assert.equal(typeof artifacts.listProjectArtifacts, 'function')
  const workspace = await mkdtemp(join(tmpdir(), 'research-artifacts-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  const root = join(workspace, 'research', 'runs', runId)
  await mkdir(root, { recursive: true })
  const result = { projectId: 'core1', itemId: '1.01', runId: 'internal', outputs: { description: '真实资料研究' }, sourceValues: [{ sourceId: 'S1', value: '原文' }], limitations: ['缺少审批文件'], execution: { actualModel: { provider: 'secret-provider', model: 'secret-model' } } }
  await writeFile(join(root, 'result.json'), JSON.stringify(result))
  await writeFile(join(root, 'snapshot.json'), JSON.stringify({ confidential: 'source snapshot' }))
  const list = await artifacts.listProjectArtifacts(workspace)
  assert.equal(list.length, 1)
  assert.equal(list[0].kind, 'research-result')
  assert.doesNotMatch(JSON.stringify(list), /\/tmp\//)
  const download = await artifacts.readProjectArtifact(workspace, list[0].id)
  assert.doesNotMatch(download.data.toString(), /secret-provider|secret-model/)
  await assert.rejects(artifacts.readProjectArtifact(workspace, '../../etc/passwd'))
  const report = await artifacts.createResearchSummary(workspace, { mode: 'research-summary', moduleIds: ['1.01'] }, 'core1')
  assert.equal(report.status, 'unreviewed')
  assert.equal(await readFile(join(root, 'result.json'), 'utf8'), JSON.stringify(result))
  const doc = await artifacts.readProjectArtifact(workspace, report.artifacts[0].id)
  assert.match(doc.data.toString(), /真实资料研究/)
  assert.match(doc.data.toString(), /缺少审批文件/)
  assert.match(doc.data.toString(), /未经报告审查/)
  await assert.rejects(artifacts.createResearchSummary(workspace, { mode: 'research-summary', moduleIds: ['1.02'] }, 'core1'), /REPORT_MODULE_RESULTS_MISSING/)
  await rm(join(root, 'result.json')); await symlink('/etc/passwd', join(root, 'result.json'))
  await assert.rejects(artifacts.readProjectArtifact(workspace, list[0].id))
})
test('真实原生章节 export 目录列出 HTML/PDF，符号链接及内部审计包不可下载', async t => {
  const workspace = await mkdtemp(join(tmpdir(), 'research-native-export-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  const folder = join(workspace, '.pre-design/chapter-productions/site/1234567890abcdef1234/export-1234567890ab')
  await mkdir(folder, { recursive: true })
  await writeFile(join(folder, '章节.html'), '<html>真实原生导出</html>')
  await writeFile(join(folder, '章节.pdf'), '%PDF-1.7 real-export')
  await writeFile(join(folder, '导出记录.json'), '{"internal":true}')
  await symlink('/etc/passwd', join(folder, 'foreign.html'))
  const list = await artifacts.listProjectArtifacts(workspace)
  assert.deepEqual(list.map(row => row.filename).sort(), ['章节.html', '章节.pdf'])
  assert(list.every(row => row.kind === 'chapter-report'))
  assert.match((await artifacts.readProjectArtifact(workspace, list.find(row => row.filename.endsWith('.html')).id)).data.toString(), /真实原生导出/)
})

test('任务成果只下载有完成收执且像素校验通过的概念图，图片改变后撤回下载',async t=>{
  const workspace=await mkdtemp(join(tmpdir(),'generated-artifacts-'));t.after(()=>rm(workspace,{recursive:true,force:true}))
  const requestId='a'.repeat(64),relative=`.pre-design/image-requests/receipts/${requestId}/output.png`,folder=join(workspace,'.pre-design/image-requests/receipts',requestId)
  await mkdir(folder,{recursive:true})
  const data=await sharp({create:{width:32,height:16,channels:3,background:'#334455'}}).png().toBuffer()
  await writeFile(join(workspace,relative),data)
  await writeFile(join(folder,'receipt.json'),JSON.stringify({version:1,requestId,promptId:'prompt-1',mode:'generate',state:'completed',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),
    output:{path:relative,sha256:createHash('sha256').update(data).digest('hex'),mediaType:'image/png',width:32,height:16,bytes:data.length}}))
  const list=await artifacts.listProjectArtifacts(workspace)
  assert.equal(list.length,1);assert.equal(list[0].kind,'generated-concept');assert.equal(list[0].status,'unreviewed')
  assert.match(list[0].limitations[0],/概念图/);assert.ok(!JSON.stringify(list).includes('receipt.json'))
  const downloaded=await artifacts.readProjectArtifact(workspace,list[0].id)
  assert.equal(downloaded.contentType,'image/png');assert.deepEqual(downloaded.data,data)
  await writeFile(join(workspace,relative),Buffer.from('changed'))
  assert.deepEqual(await artifacts.listProjectArtifacts(workspace),[])
  await assert.rejects(artifacts.readProjectArtifact(workspace,list[0].id),e=>e.code==='ARTIFACT_NOT_FOUND')
})
