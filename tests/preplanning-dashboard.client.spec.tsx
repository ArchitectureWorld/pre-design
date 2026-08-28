// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PreplanningDashboard } from '../src/client/PreplanningDashboard.tsx'
import { PreplanningLauncher } from '../src/client/PreplanningLauncher.tsx'

afterEach(cleanup)

describe('Preplanning full-flow UI', () => {
  it('在创建前让用户选择人工或全自动、报告深度和生图预算', async () => {
    const start = vi.fn(async () => undefined)
    const view = render(<PreplanningLauncher start={start} />)
    fireEvent.click(view.getByRole('button', { name: '前期策划' }))
    fireEvent.change(view.getByLabelText('一句话描述项目和目标'), {
      target: { value: '新建滨江文化活力区并完成全流程前期策划' },
    })
    fireEvent.click(view.getByLabelText('全自动完成'))
    fireEvent.click(view.getByLabelText('扩展汇报'))
    fireEvent.change(view.getByLabelText('概念图预算上限'), { target: { value: '12' } })
    fireEvent.click(view.getByRole('button', { name: '创建并开始全流程' }))

    await vi.waitFor(() => expect(start).toHaveBeenCalledWith({
      projectName: '滨江文化活力区',
      statement: '新建滨江文化活力区并完成全流程前期策划',
      mode: 'automatic',
      reportDepth: 'extended',
      visualBudget: 12,
    }))
  })

  it('先证明插件运行，再展示 8 章 57 项、模型路由和三格式成果', () => {
    const view = render(<PreplanningDashboard status={{
      projectId: 'project-1', projectName: '滨江文化活力区', revision: 57, stage: '08-08',
      status: 'active', pendingProposalCount: 0, openQuestionCount: 0,
      mode: 'manual', reportDepth: 'extended', blocked: 0,
      chapters: Array.from({ length: 8 }, (_, index) => ({
        id: String(index + 1).padStart(2, '0'), completed: index === 7 ? 8 : 7,
        total: index === 7 ? 8 : 7, gateStatus: 'approved',
      })),
      visual: { candidates: 1, adopted: 2, blocked: 0 },
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
    expect(view.getByText(/人工确认/u)).toBeTruthy()
    expect(view.getByText(/antigravity \/ gemini-3\.1-flash-image/u)).toBeTruthy()
    expect(view.getByRole('link', { name: '下载 PPTX' }).getAttribute('href')).toContain('/preplan-export/')
    expect(view.getByRole('link', { name: '下载 PDF' })).toBeTruthy()
    expect(view.getByRole('link', { name: '浏览 HTML' })).toBeTruthy()
  })
})
