// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PreplanningDashboard } from '../src/client/PreplanningDashboard.tsx'
import { PreplanningLauncher } from '../src/client/PreplanningLauncher.tsx'

afterEach(cleanup)

describe('Preplanning full-flow UI', () => {
  it('将创建面板挂到视口层并约束在可滚动的可视区域内', () => {
    const view = render(<PreplanningLauncher start={async () => undefined} />)
    const trigger = view.getByRole('button', { name: '前期策划' })
    const launcher = trigger.parentElement

    fireEvent.click(trigger)

    const form = view.getByRole('form', { name: '新建前期策划项目' })
    expect(launcher?.contains(form)).toBe(false)
    expect(form.parentElement).toBe(document.body)
    expect(form.style.position).toBe('fixed')
    expect(form.style.boxSizing).toBe('border-box')
    expect(form.style.right).toBe('16px')
    expect(form.style.top).toBe('16px')
    expect(form.style.width).toContain('420px')
    expect(form.style.width).toContain('100vw - 32px')
    expect(form.style.maxHeight).toBe('calc(100dvh - 32px)')
    expect(form.style.overflowY).toBe('auto')
    expect(view.getByText('Pre 2.0.0 · Project Format 0.1.0')).toBeTruthy()

    fireEvent.click(view.getByRole('button', { name: '关闭前期策划面板' }))
    expect(view.queryByRole('form', { name: '新建前期策划项目' })).toBeNull()
  })

  it('沿用 DSH 主题色保证表单背景、文字和输入控件可读', () => {
    const view = render(<PreplanningLauncher start={async () => undefined} />)
    fireEvent.click(view.getByRole('button', { name: '前期策划' }))

    const form = view.getByRole('form', { name: '新建前期策划项目' })
    const statement = view.getByLabelText('一句话描述项目和目标')

    expect(form.style.background).toBe('var(--dsw-alias-bg-layer-1, #fff)')
    expect(form.style.color).toBe('var(--dsw-alias-label-primary, #1f2328)')
    expect(statement.style.background).toBe('var(--dsw-specific-input-major, #fff)')
    expect(statement.style.color).toBe('var(--dsw-alias-label-primary, #1f2328)')
  })

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
    expect(view.getByText(/人工确认/u)).toBeTruthy()
    expect(view.getByText(/antigravity \/ gemini-3\.1-flash-image/u)).toBeTruthy()
    expect(view.getByText('模拟研究范围（不可正式确认）')).toBeTruthy()
    expect(view.getByText('请提供真实总平图、红线图或带 CRS 的闭合几何')).toBeTruthy()
    expect(view.queryByText('boundary-1')).toBeNull()
    expect(view.getByRole('link', { name: '下载 PPTX' }).getAttribute('href')).toContain('/preplan-export/')
    expect(view.getByRole('link', { name: '下载 PDF' })).toBeTruthy()
    expect(view.getByRole('link', { name: '浏览 HTML' })).toBeTruthy()
  })
})