import { PRE_DESIGN_VERSION } from '../src/version.ts'
// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PreplanningDashboard } from '../src/client/PreplanningDashboard.tsx'
import { PreplanningLauncher } from '../src/client/PreplanningLauncher.tsx'
import { PreplanningProjectForm } from '../src/client/PreplanningProjectForm.tsx'
import { buildPreplanningStatus } from '../src/session/events.ts'

afterEach(cleanup)

const runningStart = async () => ({
  state: 'running' as const,
  sourceMaterialCount: 1,
  sourceInboxFileCount: 1,
})

describe('Preplanning full-flow UI', () => {
  it('HTML-only 成果仅显示真实 HTML 入口，不显示不存在的 PPTX 或 PDF 下载', () => {
    const status = buildPreplanningStatus({ project: { projectId: 'project-1', name: '验收项目',
      currentRevision: 57, currentStage: '08-08' }, proposals: [], questions: [] } as never)
    const view = render(<PreplanningDashboard status={{ ...status, reportPackage: {
      id: 'html-57', deliveryMode: 'conditional', sourceRevision: 57,
      html: '/preplan-export/html-57/html/index.html',
    } }} />)
    expect(view.getByRole('link', { name: '浏览 HTML' }).getAttribute('href')).toBe('/preplan-export/html-57/html/index.html')
    expect(view.queryByRole('link', { name: '下载 PPTX' })).toBeNull()
    expect(view.queryByRole('link', { name: '下载 PDF' })).toBeNull()
    expect(view.queryByText('下载 PPTX')).toBeNull()
    expect(view.queryByText('下载 PDF')).toBeNull()
  })

  it('无法确认成果文件时保留成果状态和诊断信息，不显示猜测下载地址', () => {
    const status = buildPreplanningStatus({ project: { projectId: 'project-1', name: '验收项目',
      currentRevision: 57, currentStage: '08-08' }, proposals: [], questions: [] } as never)
    const view = render(<PreplanningDashboard status={{ ...status, reportPackage: {
      id: 'missing-57', deliveryMode: 'conditional', sourceRevision: 57,
    }, reportError: '成果清单不可用，暂不提供下载链接。' }} />)
    expect(view.getByText('条件式策划成果 · 版本 57')).toBeTruthy()
    expect(view.getByRole('alert').textContent).toContain('成果清单不可用')
    expect(view.queryAllByRole('link')).toHaveLength(0)
    expect(view.container.querySelectorAll('a')).toHaveLength(0)
  })

  it('Session 顶部入口只负责打开 Workspace 级前期策划面板', () => {
    const openPanel = vi.fn()
    const view = render(<PreplanningLauncher openPanel={openPanel} />)
    fireEvent.click(view.getByRole('button', { name: '前期策划' }))
    expect(openPanel).toHaveBeenCalledTimes(1)
    expect(view.queryByRole('form')).toBeNull()
  })

  it('Workspace 面板零输入显示项目根目录，不再出现项目描述或项目名输入框', () => {
    const view = render(
      <PreplanningProjectForm
        embedded
        start={runningStart}
        workspacePath="/workspace/project"
        workspaceTitle="project"
      />,
    )

    const form = view.getByRole('form', { name: '前期策划项目' })
    // Embedded panels now consume scoped paired light/dark tokens, not host inline colors.
    expect(form.classList.contains('project-card')).toBe(true)
    expect(form.style.background).toBe('')
    expect(view.getByText('project')).toBeTruthy()
    expect(view.getByTitle('项目总文件夹：/workspace/project')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: '项目说明' }))
    expect(view.getByText(/零输入启动/u)).toBeTruthy()
    expect(view.queryByRole('textbox')).toBeNull()
    expect(view.queryByLabelText('一句话描述项目和目标')).toBeNull()
    expect(view.queryByLabelText('识别的项目名称')).toBeNull()
    // The version is rendered once by LiquidGlassShell, not repeated inside this card.
    expect(view.queryByText(`Pre ${PRE_DESIGN_VERSION} · Project Format 0.1.0`)).toBeNull()
  })

  it('开始前期策划不再收集任何执行策略或项目信息', async () => {
    const start = vi.fn(runningStart)
    const view = render(
      <PreplanningProjectForm
        embedded
        start={start}
        workspacePath="/workspace/滨江文化活力区"
        workspaceTitle="滨江文化活力区"
      />,
    )

    expect(view.queryByText('确认方式')).toBeNull()
    expect(view.queryByText('报告深度')).toBeNull()
    expect(view.queryByLabelText('概念图预算上限')).toBeNull()
    expect(view.queryByLabelText('人工确认')).toBeNull()
    expect(view.queryByLabelText('全自动完成')).toBeNull()
    expect(view.queryByLabelText('标准汇报')).toBeNull()
    expect(view.queryByLabelText('扩展汇报')).toBeNull()
    expect(view.queryByRole('textbox')).toBeNull()

    fireEvent.click(view.getByRole('button', { name: '开始前期策划' }))

    await vi.waitFor(() => expect(start).toHaveBeenCalledWith())
    expect(await view.findByText('项目已创建或恢复，系统将自动推进前期策划。')).toBeTruthy()
  })

  it('先证明插件运行，再展示 automatic-first 状态、8 章 57 项、模型路由和三格式成果', () => {
    const view = render(<PreplanningDashboard status={{
      projectId: 'project-1', projectName: '滨江文化活力区', revision: 57, stage: '08-08',
      status: 'active', pendingProposalCount: 0, openQuestionCount: 0,
      mode: 'automatic', reportDepth: 'extended', blocked: 0,
      chapters: Array.from({ length: 8 }, (_, index) => ({
        id: String(index + 1).padStart(2, '0'), completed: index === 7 ? 8 : 7,
        total: index === 7 ? 8 : 7, gateStatus: 'approved',
      })),
      visual: { candidates: 1, adopted: 2, blocked: 0 },
      boundary: {
        kind: 'synthetic_research',
        label: '模拟研究范围（不可正式确认）',
        source: 'geojson',
        nextAction: '请提供真实总平图、红线图或带 CRS 的闭合几何',
      },
      modelRoute: {
        primary: '当前 DSH Session 所选模型',
        visual: 'antigravity / gemini-3.1-flash-image',
      },
      reportPackage: {
        id: 'package-57',
        pptx: '/preplan-export/package-57/report.pptx',
        pdf: '/preplan-export/package-57/report.pdf',
        html: '/preplan-export/package-57/html/index.html',
      },
    }} />)

    expect(view.getByText(/插件正常运行/u)).toBeTruthy()
    expect(view.getByText('8 章 · 57 项')).toBeTruthy()
    expect(view.getByText(/自动推进/u)).toBeTruthy()
    expect(view.queryByText(/人工确认/u)).toBeNull()
    expect(view.getByText(/antigravity \/ gemini-3\.1-flash-image/u)).toBeTruthy()
    expect(view.getByText('模拟研究范围（不可正式确认）')).toBeTruthy()
    expect(view.getByText('请提供真实总平图、红线图或带 CRS 的闭合几何')).toBeTruthy()
    expect(view.queryByText('boundary-1')).toBeNull()
    expect(view.getByRole('link', { name: '下载 PPTX' }).getAttribute('href')).toContain('/preplan-export/')
    expect(view.getByRole('link', { name: '下载 PDF' })).toBeTruthy()
    expect(view.getByRole('link', { name: '浏览 HTML' })).toBeTruthy()
  })

  it('automatic 流程受阻时直接列出工作项与原因，不退回人工审批', () => {
    const view = render(<PreplanningDashboard status={{
      projectId: 'project-blocked', projectName: '受阻项目', revision: 6, stage: '02-01',
      status: 'active', pendingProposalCount: 0, openQuestionCount: 0,
      mode: 'automatic', reportDepth: 'standard', blocked: 2,
      blockers: [
        { workflowId: 'preplan.wf.02.01', workItemId: '02-01', reason: '缺少正式总平图，无法核验规划控制条件' },
        { workflowId: 'preplan.wf.02.03', workItemId: '02-03', reason: '两个A级来源的容积率控制值存在冲突' },
      ],
      chapters: Array.from({ length: 8 }, (_, index) => ({
        id: String(index + 1).padStart(2, '0'), completed: 0,
        total: [7, 8, 6, 6, 7, 7, 8, 8][index]!, gateStatus: 'pending',
      })),
      visual: { candidates: 0, adopted: 0, blocked: 0 },
      boundary: {
        kind: 'not_provided',
        label: '尚未提供场地边界',
        nextAction: '请提供总平图、红线图或闭合红线坐标。',
      },
      modelRoute: {
        primary: '当前 DSH Session 所选模型',
        visual: 'antigravity / gemini-3.1-flash-image',
      },
    }} />)

    expect(view.getByRole('region', { name: '自动流程阻断详情' })).toBeTruthy()
    expect(view.getByText(/02-01/)).toBeTruthy()
    expect(view.getByText(/缺少正式总平图/)).toBeTruthy()
    expect(view.getByText(/02-03/)).toBeTruthy()
    expect(view.getByText(/容积率控制值存在冲突/)).toBeTruthy()
    expect(view.queryByText(/人工审批|人工确认/u)).toBeNull()
  })
})
