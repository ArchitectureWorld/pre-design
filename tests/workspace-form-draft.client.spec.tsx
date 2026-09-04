// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PreplanningProjectForm } from '../src/client/PreplanningProjectForm.tsx'

beforeEach(() => localStorage.clear())
afterEach(cleanup)

describe('Workspace-scoped Pre project form draft', () => {
  it('restores all input values after a page-style unmount in the same Workspace', () => {
    const first = render(
      <PreplanningProjectForm
        onClose={() => undefined}
        start={async () => undefined}
        workspacePath="C:\\Projects\\武汉站"
      />,
    )
    fireEvent.change(first.getByLabelText('一句话描述项目和目标'), {
      target: { value: '更新武汉站综合枢纽前期策划' },
    })
    fireEvent.change(first.getByLabelText('识别的项目名称'), {
      target: { value: '武汉站综合枢纽' },
    })
    fireEvent.click(first.getByLabelText('全自动完成'))
    fireEvent.click(first.getByLabelText('扩展汇报'))
    fireEvent.change(first.getByLabelText('概念图预算上限'), { target: { value: '12' } })
    first.unmount()

    const restored = render(
      <PreplanningProjectForm
        onClose={() => undefined}
        start={async () => undefined}
        workspacePath="C:\\Projects\\武汉站"
      />,
    )
    expect((restored.getByLabelText('一句话描述项目和目标') as HTMLTextAreaElement).value)
      .toBe('更新武汉站综合枢纽前期策划')
    expect((restored.getByLabelText('识别的项目名称') as HTMLInputElement).value)
      .toBe('武汉站综合枢纽')
    expect((restored.getByLabelText('全自动完成') as HTMLInputElement).checked).toBe(true)
    expect((restored.getByLabelText('扩展汇报') as HTMLInputElement).checked).toBe(true)
    expect((restored.getByLabelText('概念图预算上限') as HTMLInputElement).value).toBe('12')
  })

  it('isolates drafts by Workspace and clears the active draft after successful creation', async () => {
    const start = vi.fn(async () => undefined)
    const first = render(
      <PreplanningProjectForm
        onClose={() => undefined}
        start={start}
        workspacePath="D:\\Projects\\A"
      />,
    )
    fireEvent.change(first.getByLabelText('一句话描述项目和目标'), {
      target: { value: '创建 A 项目' },
    })
    fireEvent.change(first.getByLabelText('识别的项目名称'), {
      target: { value: 'A 项目' },
    })
    fireEvent.click(first.getByRole('button', { name: '创建或继续全流程' }))
    await first.findByText('项目与 Presentation 标准目录已创建，前期策划全流程已经启动。')
    first.unmount()

    const sameWorkspace = render(
      <PreplanningProjectForm
        onClose={() => undefined}
        start={async () => undefined}
        workspacePath="D:\\Projects\\A"
      />,
    )
    expect((sameWorkspace.getByLabelText('一句话描述项目和目标') as HTMLTextAreaElement).value).toBe('')
    sameWorkspace.unmount()

    const otherWorkspace = render(
      <PreplanningProjectForm
        onClose={() => undefined}
        start={async () => undefined}
        workspacePath="D:\\Projects\\B"
      />,
    )
    expect((otherWorkspace.getByLabelText('一句话描述项目和目标') as HTMLTextAreaElement).value).toBe('')
  })

  it('blocks project creation when the current Session has no DSH Workspace', () => {
    const view = render(
      <PreplanningProjectForm onClose={() => undefined} start={async () => undefined} />,
    )
    expect(view.getByRole('alert').textContent).toContain('请先为当前会话选择或创建 DSH 工作区')
    expect((view.getByRole('button', { name: '创建或继续全流程' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
