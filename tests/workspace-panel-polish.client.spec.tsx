// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PreplanningProjectForm } from '../src/client/PreplanningProjectForm.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const WORKSPACE = 'D:\\沙潭河'
const runningStart = async () => ({
  state: 'running' as const,
  sourceMaterialCount: 1,
  sourceInboxFileCount: 1,
})

function renderProjectForm(openProjectFolder = vi.fn(async () => undefined)) {
  return {
    openProjectFolder,
    view: render(
      <PreplanningProjectForm
        onClose={() => undefined}
        openProjectFolder={openProjectFolder}
        start={runningStart}
        workspacePath={WORKSPACE}
        workspaceTitle="沙潭河"
      />,
    ),
  }
}

describe('Preplanning Workspace panel polish', () => {
  it('uses a concise zero-input Workspace heading without obsolete creation narration', () => {
    const { view } = renderProjectForm()

    expect(view.getByText('前期策划')).toBeTruthy()
    expect(view.getByText('沙潭河')).toBeTruthy()
    expect(view.getByText(/零输入启动/u)).toBeTruthy()
    expect(view.queryByText('新建或继续前期策划')).toBeNull()
    expect(view.queryByText('一个 DSH 工作区对应一个 Pre 项目')).toBeNull()
    expect(view.queryByLabelText('一句话描述项目和目标')).toBeNull()
    expect(view.queryByLabelText('识别的项目名称')).toBeNull()

    const closeButton = view.getByRole('button', { name: '关闭前期策划面板' }) as HTMLButtonElement
    expect(closeButton.style.width).toBe('28px')
    expect(closeButton.style.height).toBe('28px')
  })

  it('shows explicit completion feedback after the Workspace folder opens', async () => {
    const { openProjectFolder, view } = renderProjectForm()

    fireEvent.click(view.getByRole('button', { name: '打开项目文件夹' }))

    expect(await view.findByText('项目文件夹已打开。')).toBeTruthy()
    expect(openProjectFolder).toHaveBeenCalledOnce()
  })
})
