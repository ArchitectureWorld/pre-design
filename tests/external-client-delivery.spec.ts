import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import type { FrozenProjectInput } from '../src/report/types.ts'
import { compileClientReportOutline, summaryStatement } from '../src/presentation/projector/client-outline.ts'
import { createConditionalReportBundle, planConditionalPages } from '../src/report/conditional-report.ts'
import { createAutomaticVisualCompletion } from '../src/presentation/automatic-visuals.ts'

const source: FrozenProjectInput = { projectId: 'p', projectName: '山地项目', revision: 1, generatedAt: '2026-09-17', recommendation: '',
  decisionItems: [], gates: [], visualAssets: [], stateObjects: [{ objectId: 'OP07', chapterId: '05', workItemId: '05-07', title: '路径比选',
    summary: '附条件推荐轻量研学', facts: [], reportSections: [
      { key: 'backup_option', title: '备选方案', entries: [{ key: 'backup', text: '备选方案：重资产场馆', basis: '比选', fieldPath: '/backup' }] },
      { key: 'recommended_option', title: '推荐方案', entries: [{ key: 'recommend', text: '推荐方案：轻量研学路径（有条件推荐）', basis: '比选', fieldPath: '/recommend' }] },
      { key: 'conditions', title: '成立条件', entries: [{ key: 'condition', text: '成立条件：须完成土地合规核验', basis: '项目要求', fieldPath: '/conditions' }] },
    ] }] }
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

it('keeps long source narration out of the main message while retaining the concrete decision', () => {
  expect(summaryStatement('在多项研究边界约束之下，决策主体（身份待确认）需要决定：项目是否推进文旅开发及在什么条件下推进？'))
    .toBe('项目是否推进文旅开发及在什么条件下推进？')
  const long = '环保移动式干式生态公厕与密闭负压清运功能，排污处理规模仍待核实，严禁在现场下渗排放，必须与合规清运单位签订外运协议，并满足日常保洁与生态保护要求'
  expect(summaryStatement(long, 45)).toBe('环保移动式干式生态公厕与密闭负压清运功能，排污处理规模仍待核实，严禁在现场下渗排放')
  expect(summaryStatement('长'.repeat(200), 75)).toHaveLength(75)
})

it('removes internal runtime wording from external copy without losing conditional qualifications', () => {
  expect(summaryStatement('启动原因（2026-09-16，本轮触发）：用户要求重新开展某项目前期策划，明确方向为“文化休闲”')).toBe('策划方向：文化休闲')
  expect(summaryStatement('业态组合与项目定位；该选择属 agent 推断与假设，已显式分类，用户可随时 override/edit')).toBe('业态组合与项目定位；（策划假设）')
  expect(summaryStatement('现状保留 (retain_statutory_custody)（策划建议）')).toBe('现状保留 （策划建议）')
  expect(summaryStatement('建设投资总额；调查与计算方法：bottom_up_capex_aggregation_model（含义待核对）')).toBe('建设投资总额')
  expect(summaryStatement('法定决策主体保持 unknown-decision-owner')).toBe('法定决策主体保持 待明确')
})

it('grounds image subjects in proposed products and keeps project prohibitions as exclusions', () => {
  const object = (objectId: string, key: string, texts: string[]) => ({ objectId, chapterId: '06', workItemId: '06-01',
    title: objectId, summary: '', facts: [], reportSections: [{ key, title: key,
      entries: texts.map((text, i) => ({ key: String(i), text, basis: '项目资料', fieldPath: `/${key}/${i}` })) }] })
  const input = { ...source, stateObjects: [...source.stateObjects,
    object('PG04', 'products', ['茶园自然研学；轻量设施', '暂缓：大型场馆', '停车接驳服务']),
    object('OB04', 'constraints', ['禁止在水库大坝设置游憩设施；不得开展水上游船']),
    object('SP03', 'conditions', ['未取得存量建筑鉴定报告，暂缓重资产改造'])] }
  const brief = compileClientReportOutline(input).find(f => f.sectionKey === 'recommended-path')!.visualBrief
  expect(brief).toContain('正向产品体验中选择：茶园自然研学。')
  expect(brief.split('。')[1]).not.toContain('大型场馆')
  expect(brief).not.toContain('停车接驳')
  expect(brief).toContain('只展示陆域场景')
  expect(brief).toContain('项目禁止项仅用于排除内容')
  expect(brief).toContain('不得开展水上游船')
  expect(brief).toContain('不新增或虚构村落、商业街')
  expect(brief).toContain('短段可逆步道')
  expect(compileClientReportOutline(source)[0]!.visualBrief).not.toContain('本项目限制水利空间')
  expect(compileClientReportOutline(source)[0]!.visualBrief).not.toContain('存量建筑改造条件尚未落实')
})

it('uses the recommended path, keeps conditions and puts provenance in notes rather than visible tables', () => {
  const finding = compileClientReportOutline(source).find(f => f.sectionKey === 'recommended-path')!
  expect(finding.keyMessage).toContain('轻量研学路径')
  expect(finding.keyMessage).not.toContain('重资产')
  expect(finding.supportingBlocks.every(b => b.type === 'list')).toBe(true)
  expect(JSON.stringify(finding.supportingBlocks)).toContain('土地合规')
  expect(finding.speakerNotes?.join('')).toContain('/recommend')
  expect(finding.visualRequirement).toBe('concept')
})

it('carries a bound real image into the HTML/PPTX/PDF plans with provenance disclosure', () => {
  const finding = compileClientReportOutline(source).find(f => f.sectionKey === 'recommended-path')!
  const bundle = createConditionalReportBundle(source, [{ sourceKey: 'image', sourcePath: '/real.png', originalFileName: 'real.png',
    displayName: 'AI概念示意（非现场实拍）', mimeType: 'image/png', semanticRole: 'concept_visual', widthPx: 1600, heightPx: 900,
    createdAt: source.generatedAt, adoptedAt: source.generatedAt, sha256: 'a'.repeat(64), objectIds: [], evidenceIds: [],
    pageBindingOnly: true, pageBindings: [{ findingId: finding.findingId, role: 'primary' }],
    origin: { type: 'generated_by_tool', sourceMaterialKeys: [], parentAssetKeys: [], method: 'test', sourceTool: null } }])
  expect(bundle.report.assets).toHaveLength(1)
  for (const medium of ['html', 'pptx', 'pdf'] as const) expect(planConditionalPages(bundle, medium).pages
    .some(p => p.assetIds.includes(bundle.report.assets[0]!.assetId))).toBe(true)
  expect(bundle.report.assets[0]!.disclosure).toBe('概念示意')
})

it.each([false, true])('completes automatic generation and adoption, but fences cancellation=%s', async cancelled => {
  const root = await mkdtemp(join(tmpdir(), 'client-auto-')); roots.push(root)
  const controller = new AbortController()
  const adopt = vi.fn(async () => ({ status: 'adopted', assetId: 'image' }))
  const generate = vi.fn(async () => { if (cancelled) controller.abort(new Error('paused')); return { assetId: 'image' } })
  const sync = vi.fn(async () => {})
  const complete = createAutomaticVisualCompletion({ input: async () => ({ frozenProject: source, workspaceRoot: root }), target: () => 1,
    assertCurrent: () => {}, sync, pageVisualFill: { plan: async () => ({ pages: [], warnings: [] }), generate, adopt } as never })
  const operation = complete('p',1,{} as never,controller.signal)
  if (cancelled) { await expect(operation).rejects.toThrow('paused'); expect(adopt).not.toHaveBeenCalled(); expect(sync).not.toHaveBeenCalled() }
  else { await operation; expect(generate).toHaveBeenCalledTimes(1); expect(adopt).toHaveBeenCalledTimes(1); expect(sync).toHaveBeenCalled() }
})
