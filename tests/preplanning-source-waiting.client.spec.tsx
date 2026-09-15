// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PreplanningProjectForm } from '../src/client/PreplanningProjectForm.tsx'

afterEach(cleanup)

describe('Pre source readiness UI', () => {
  it('无原始资料时显示等待状态并允许资料放入后重新检测', async () => {
    const start = vi.fn(async () => ({
      state: 'waiting_for_source' as const,
      sourceMaterialCount: 0 as const,
      sourceInboxFileCount: 0,
    }))
    const view = render(
      <PreplanningProjectForm
        embedded
        start={start}
        workspacePath="/workspace/空项目"
        workspaceTitle="空项目"
      />,
    )

    fireEvent.click(view.getByRole('button', { name: '开始前期策划' }))

    expect(await view.findByText('等待原始资料')).toBeTruthy()
    expect(view.getByText(/当前项目尚未检测到可分析资料/u)).toBeTruthy()
    expect(view.getByText(/“原始资料”文件夹/u)).toBeTruthy()
    expect(view.getByRole('button', { name: '重新检测原始资料' })).toBeTruthy()
    expect(view.queryByText(/人工确认|人工审批/u)).toBeNull()
  })

  it('存在标准原件时显示自动推进成功状态', async () => {
    const start = vi.fn(async () => ({
      state: 'running' as const,
      sourceMaterialCount: 5,
      sourceInboxFileCount: 3,
    }))
    const view = render(
      <PreplanningProjectForm
        embedded
        start={start}
        workspacePath="/workspace/正常项目"
        workspaceTitle="正常项目"
      />,
    )

    fireEvent.click(view.getByRole('button', { name: '开始前期策划' }))

    expect(await view.findByText('项目已创建或恢复，系统将自动推进前期策划。')).toBeTruthy()
    expect(view.getByText(/已登记 5 个标准原件/u)).toBeTruthy()
  })
})
