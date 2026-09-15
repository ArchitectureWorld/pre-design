import { describe, expect, it, vi } from 'vitest'
import {
  deriveWorkspaceProjectName,
  startDirectPreplanning,
  type DirectStartPort,
} from '../src/client/direct-start.ts'

const workspaceEmpty = 'PRE_DESIGN_WORKSPACE_EMPTY'
const workspaceAttached = 'PRE_DESIGN_WORKSPACE_PROJECT_ATTACHED'
const sourcesReady = [
  'PRE_DESIGN_SOURCE_MATERIAL_COUNT:3',
  'PRE_DESIGN_SOURCE_INBOX_COUNT:2',
].join('\n')
const sourcesEmpty = [
  'PRE_DESIGN_SOURCE_MATERIAL_COUNT:0',
  'PRE_DESIGN_SOURCE_INBOX_COUNT:0',
].join('\n')

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

  it('新 Workspace 先标准化原始资料，再按 automatic-first 启动', async () => {
    const lines: string[] = []
    const port: DirectStartPort = {
      executeCommand: async line => {
        lines.push(line)
        if (line === '/preplan-presentation-sync --probe') {
          return { kind: 'success', text: workspaceEmpty }
        }
        if (line === '/preplan-presentation-sync') {
          return { kind: 'success', text: sourcesReady }
        }
        return { kind: 'success' }
      },
    }

    const result = await startDirectPreplanning(port, {
      workspacePath: 'C:\\Projects\\鄂州体育中心项目',
    })

    expect(result).toEqual({
      state: 'running',
      sourceMaterialCount: 3,
      sourceInboxFileCount: 2,
    })
    expect(lines).toEqual([
      '/preplan-presentation-sync --probe',
      '/preplan-new 鄂州体育中心项目',
      '/preplan-presentation-sync',
      '/preplan-mode automatic 20 standard',
      '/preplan-run',
    ])
  })

  it('已有 Workspace 项目先同步新增原始资料再恢复运行，不重复创建', async () => {
    const lines: string[] = []
    const port: DirectStartPort = {
      executeCommand: async line => {
        lines.push(line)
        if (line === '/preplan-presentation-sync --probe') {
          return { kind: 'success', text: workspaceAttached }
        }
        if (line === '/preplan-presentation-sync') {
          return { kind: 'success', text: sourcesReady }
        }
        return { kind: 'success' }
      },
    }

    const result = await startDirectPreplanning(port, {
      workspacePath: '/projects/已有项目',
    })

    expect(result.state).toBe('running')
    expect(lines).toEqual([
      '/preplan-presentation-sync --probe',
      '/preplan-presentation-sync',
      '/preplan-mode automatic 20 standard',
      '/preplan-run',
    ])
  })

  it('没有任何标准原件时创建标准目录但停在等待原始资料，不空跑 57 项', async () => {
    const lines: string[] = []
    const port: DirectStartPort = {
      executeCommand: async line => {
        lines.push(line)
        if (line === '/preplan-presentation-sync --probe') {
          return { kind: 'success', text: workspaceEmpty }
        }
        if (line === '/preplan-presentation-sync') {
          return { kind: 'success', text: sourcesEmpty }
        }
        return { kind: 'success' }
      },
    }

    const result = await startDirectPreplanning(port, {
      workspacePath: '/projects/空项目',
    })

    expect(result).toEqual({
      state: 'waiting_for_source',
      sourceMaterialCount: 0,
      sourceInboxFileCount: 0,
    })
    expect(lines).toEqual([
      '/preplan-presentation-sync --probe',
      '/preplan-new 空项目',
      '/preplan-presentation-sync',
      '/preplan-mode automatic 20 standard',
    ])
    expect(lines).not.toContain('/preplan-run')
  })

  it('标准同步缺少机器可读资料计数时拒绝猜测启动', async () => {
    const port: DirectStartPort = {
      executeCommand: async line => line === '/preplan-presentation-sync --probe'
        ? { kind: 'success', text: workspaceAttached }
        : { kind: 'success', text: '同步完成' },
    }

    await expect(startDirectPreplanning(port, { workspacePath: '/projects/项目A' }))
      .rejects.toThrow('无法识别原始资料同步结果')
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
