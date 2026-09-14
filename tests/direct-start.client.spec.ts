import { describe, expect, it, vi } from 'vitest'
import {
  deriveProjectName,
  startDirectPreplanning,
  type DirectStartPort,
} from '../src/client/direct-start.ts'

const workspaceEmpty = 'PRE_DESIGN_WORKSPACE_EMPTY'
const workspaceAttached = 'PRE_DESIGN_WORKSPACE_PROJECT_ATTACHED'

describe('direct preplanning start', () => {
  it('从常见中文启动句中推导可编辑项目名', () => {
    expect(deriveProjectName('新建鄂州体育中心项目并完成 01-01 身份校准')).toBe('鄂州体育中心项目')
    expect(deriveProjectName('请创建 武汉站综合枢纽，然后进行项目身份校准')).toBe('武汉站综合枢纽')
    expect(deriveProjectName('对沙潭河这个项目进行一个前期策划')).toBe('沙潭河这个项目')
    expect(deriveProjectName('   ')).toBe('')
    expect(deriveProjectName('新建' + '鄂'.repeat(60) + '，完成身份校准')).toBe('鄂'.repeat(48))
  })

  it('命令业务失败时立即停止', async () => {
    const port: DirectStartPort = {
      executeCommand: vi.fn(async () => ({ kind: 'error' as const, text: '项目创建失败' })),
    }

    await expect(startDirectPreplanning(port, {
      projectName: '鄂州体育中心项目',
      statement: '新建鄂州体育中心项目并完成 01-01 身份校准',
    })).rejects.toThrow('项目创建失败')
  })

  it('新 Workspace 只创建 Pre 项目并应用内部 automatic-first 默认策略，不同步 Presentation', async () => {
    const lines: string[] = []
    const port: DirectStartPort = {
      executeCommand: async line => {
        lines.push(line)
        return line === '/preplan-presentation-sync --probe'
          ? { kind: 'success', text: workspaceEmpty }
          : { kind: 'success' }
      },
    }

    await startDirectPreplanning(port, {
      projectName: '鄂州体育中心项目',
      statement: '新建鄂州体育中心项目并完成前期策划',
    })

    expect(lines).toEqual([
      '/preplan-presentation-sync --probe',
      '/preplan-new 鄂州体育中心项目',
      '/preplan-mode automatic 20 standard',
      '/preplan-run',
    ])
    expect(lines).not.toContain('/preplan-presentation-sync')
  })

  it('已有 Workspace 项目直接恢复 automatic-first 运行，不重复创建或强制 Presentation 初始化', async () => {
    const lines: string[] = []
    const port: DirectStartPort = {
      executeCommand: async line => {
        lines.push(line)
        return line === '/preplan-presentation-sync --probe'
          ? { kind: 'success', text: workspaceAttached }
          : { kind: 'success' }
      },
    }

    await startDirectPreplanning(port, {
      projectName: '已有项目',
      statement: '继续项目',
    })

    expect(lines).toEqual([
      '/preplan-presentation-sync --probe',
      '/preplan-mode automatic 20 standard',
      '/preplan-run',
    ])
  })

  it('拒绝空项目名称或空描述', async () => {
    const port: DirectStartPort = {
      executeCommand: vi.fn(async () => ({ kind: 'success' as const, text: workspaceEmpty })),
    }
    await expect(startDirectPreplanning(port, { projectName: '', statement: '启动项目' }))
      .rejects.toThrow('请输入项目名称')
    await expect(startDirectPreplanning(port, { projectName: '项目', statement: '  ' }))
      .rejects.toThrow('请输入项目描述')
    expect(port.executeCommand).not.toHaveBeenCalled()
  })
})
