// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PreplanningProjectForm } from '../src/client/PreplanningProjectForm.tsx'

afterEach(cleanup)

describe('Workspace project folder UI action', () => {
  it('opens the DSH Workspace before Pre initialization has completed', async () => {
    const openProjectFolder = vi.fn(async () => undefined)
    const view = render(
      <PreplanningProjectForm
        onClose={() => undefined}
        openProjectFolder={openProjectFolder}
        start={async () => undefined}
        workspacePath="C:\\Projects\\武汉站"
      />,
    )

    fireEvent.click(view.getByRole('button', { name: '打开项目文件夹' }))
    await view.findByRole('button', { name: '打开项目文件夹' })
    expect(openProjectFolder).toHaveBeenCalledOnce()
  })
})
