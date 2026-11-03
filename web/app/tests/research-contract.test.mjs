import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultPolicy } from '../src/model-policy.mjs'
const contract = await import('../src/research-contract.mjs').catch(() => ({}))
const flags = { industryPlanning: false, existingBuildings: false, externalPartners: false, marketing: false }

test('显式研究选择拒绝空选、未知条件、重复模块和模型或命令覆盖', () => {
  assert.equal(typeof contract.validateResearchSelection, 'function')
  assert.deepEqual(contract.validateResearchSelection({ moduleIds: ['1.01'], flags }), { moduleIds: ['1.01'], flags, redo: false })
  for (const input of [{ moduleIds: [], flags }, { moduleIds: ['1.01','1.01'], flags }, { moduleIds: ['1.01'], flags: {} },
    { moduleIds: ['1.01'], flags, provider: 'gpt' }, { moduleIds: ['1.01'], flags, command: '--all-modules' },
    { moduleIds: ['1.01'], flags: { ...flags, marketing: 'unknown' } }]) assert.throws(() => contract.validateResearchSelection(input))
  assert.deepEqual(contract.validateResearchSelection({ moduleIds: [], flags: {} }, { planning: true }).moduleIds, [])
})

test('报告仅允许固定章节步骤或明确模块的成果汇编', () => {
  assert.equal(typeof contract.validateReportSelection, 'function')
  assert.deepEqual(contract.validateReportSelection({ mode: 'research-summary', moduleIds: ['1.01'] }), { mode: 'research-summary', moduleIds: ['1.01'] })
  assert.deepEqual(contract.validateReportSelection({ chapterId: 'site', stage: 'review' }), { chapterId: 'site', stage: 'review' })
  for (const input of [{ chapterId: '../other', stage: 'write' }, { command: '/preplan-export' }, { chapterId: 'site', stage: 'write', model: 'x' }]) assert.throws(() => contract.validateReportSelection(input))
})

test('业务响应剔除路由凭据与绝对路径但保留真实资料缺口', () => {
  assert.equal(typeof contract.publicBusinessData, 'function')
  const value = contract.publicBusinessData({ status: 'partial', provider: 'SenseNova', credentialRef: 'ENV_SECRET', workspaceRoot: '/tmp/private',
    error: 'MODULE_SOURCE_MISSING: /tmp/private/materials/a.pdf', modules: [{ itemId: '1.01', status: 'limited', limitations: ['缺少原始资料'] }] }, ['/tmp/private'])
  assert.equal(value.status, 'partial')
  assert.equal(value.modules[0].limitations[0], '缺少原始资料')
  assert.equal(value.provider, undefined)
  assert.doesNotMatch(JSON.stringify(value), /ENV_SECRET|\/tmp\/private|SenseNova/)
})
test('章节快照核验实际text图片能力及research的web角色，图像角色未验证时拒绝生图',()=>{
  assert.equal(typeof contract.validateReportSnapshot,'function')
  const policy=defaultPolicy(),text=policy.models.find(row=>row.provider==='SenseNova'&&row.model==='sensenova-6.8-flash-lite')
  policy.routes.vision.primary=null
  text.status='verified';text.capabilities.tools=true;text.capabilities.vision=false
  assert.equal(contract.validateReportSnapshot(policy,{chapterId:'site',stage:'write'}).revision,policy.revision)
  assert.throws(()=>contract.validateReportSnapshot(policy,{chapterId:'site',stage:'production-plan'}),/REPORT_TEXT_VISION_REQUIRED/)
  text.capabilities.vision=true
  assert.equal(contract.validateReportSnapshot(policy,{chapterId:'site',stage:'production-plan'}).revision,policy.revision)
  policy.routes.web.primary=null
  assert.throws(()=>contract.validateReportSnapshot(policy,{chapterId:'site',stage:'production-research'}),error=>error.code==='MODEL_POLICY_NOT_READY')
  assert.throws(()=>contract.validateReportSnapshot(policy,{chapterId:'site',stage:'production-visuals'}),error=>error.code==='MODEL_POLICY_NOT_READY')
  assert.equal(contract.validateReportSnapshot(undefined,{mode:'research-summary',moduleIds:['1.01']}),undefined)
})
