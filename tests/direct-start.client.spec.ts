import { describe, expect, it, vi } from 'vitest'
import {
  deriveWorkspaceProjectName,
  startDirectPreplanning,
  type DirectStartPort,
} from '../src/client/direct-start.ts'

const workspaceEmpty = 'PRE_DESIGN_WORKSPACE_EMPTY'
const workspaceAttached = 'PRE_DESIGN_WORKSPACE_PROJECT_ATTACHED'

describe('direct preplanning start', () => {
  it('只从 DSH Workspace 文件夹名推导项目名', () => {
    expect(deriveWorkspaceProjectName('C:\\Projects\\鄂州体育中心项目')).toBe('鄂州体育中心项目')
    expect(deriveWorkspaceProjectName('/Users/me/projects/武汉站综合枢纽/')).toBe('武汉站综合枢纽')
    expect(deriveWorkspaceProjectName('   ')).toBe('')
    expect(deriveWorkspaceProjectName('/tmp/' + '鄂'.repeat(60))).toBe('鄂'.repeat(48))
  })

  it('命令业务失败时立即停止', async () => {
    const port: DirectStartPort = {
      executeCommand: vi.fn(async () => ({ kind: 'error' as const, text: '项目创建失败' })),
    }

    await expect(startDirectPreplanning(port, {
      workspacePath: 'C:\\Projects\\鄂州体育中心项目',
    })).rejects.toThrow('项目创建失败')
  })

  it('新 Workspace 自动创建同名 Pre 项目并按 automatic-first 启动', async () => {
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
      workspacePath: 'C:\\Projects\\鄂州体育中心项目',
    })

    expect(lines).toEqual([
      '/preplan-presentation-sync --probe',
      '/preplan-new 鄂州体育中心项目',
      '/preplan-mode automatic 20 standard',
      '/preplan-run',
    ])
    expect(lines).not.toContain('/preplan-presentation-sync')
  })

  it('已有 Workspace 项目直接恢复 automatic-first 运行，不重复创建', async () => {
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
      workspacePath: '/projects/已有项目',
    })

    expect(lines).toEqual([
      '/preplan-presentation-sync --probe',
      '/preplan-mode automatic 20 standard',
      '/preplan-run',
    ])
  })

  it('拒绝缺失 Workspace，而不是要求用户补项目描述', async () => {
    const port: DirectStartPort = {
      executeCommand: vi.fn(async () => ({ kind: 'success' as const, text: workspaceEmpty })),
    }
    await expect(startDirectPreplanning(port, { workspacePath: '  ' }))
      .rejects.toThrow('未检测到当前 DSH 工作区')
    expect(port.executeCommand).not.toHaveBeenCalled()
  })
})
