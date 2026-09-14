// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PreplanningProjectForm } from '../src/client/PreplanningProjectForm.tsx'

beforeEach(() => localStorage.clear())
afterEach(cleanup)

describe('Workspace-scoped Pre project form draft', () => {
  it('restores only project description and editable project name in the same Workspace', () => {
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
    expect(first.queryByText('确认方式')).toBeNull()
    expect(first.queryByText('报告深度')).toBeNull()
    expect(first.queryByLabelText('概念图预算上限')).toBeNull()
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
  })

  it('submits only project identity inputs and clears the active draft after successful creation', async () => {
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
    fireEvent.click(first.getByRole('button', { name: '创建项目' }))
    await first.findByText('项目已创建或恢复，系统将自动推进前期策划。')
    expect(start).toHaveBeenCalledWith({ projectName: 'A 项目', statement: '创建 A 项目' })
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
    expect((view.getByRole('button', { name: '创建项目' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
