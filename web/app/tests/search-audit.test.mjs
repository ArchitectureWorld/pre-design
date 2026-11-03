import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp,mkdir,writeFile,symlink,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { readSearchAudit } from '../../worker/search-audit.mjs'

for(const provider of ['deepseek-search-api','ddg','bing','exa']) test(`${provider} 搜索审计按任务时间过滤，只提供允许字段并拒绝私有目录软链`,async t=>{
  const root=await mkdtemp(join(tmpdir(),'search-audit-'));t.after(()=>rm(root,{recursive:true,force:true}))
  await mkdir(join(root,'project'))
  const base={id:randomUUID(),provider,endpoint:'http://private/search',query:'private material',authorization:'secret'}
  await writeFile(join(root,'project','search-audit.jsonl'),[
    {...base,at:'2026-11-03T00:00:00.000Z',phase:'started'},
    {...base,at:'2026-11-03T00:01:00.000Z',phase:'succeeded',sourceCount:3,durationMs:200},
  ].map(row=>JSON.stringify(row)).join('\n')+'\npartial')
  const result=await readSearchAudit(root,'project',{since:'2026-11-03T00:00:30.000Z'})
  assert.deepEqual(result,[{id:base.id,provider:base.provider,at:'2026-11-03T00:01:00.000Z',phase:'succeeded',sourceCount:3,durationMs:200}])
  await symlink(join(root,'project'),join(root,'foreign'))
  await assert.rejects(readSearchAudit(root,'foreign'),/WEB_SYMLINK_FORBIDDEN/)
})
