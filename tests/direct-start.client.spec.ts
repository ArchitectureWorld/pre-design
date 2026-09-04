import { describe, expect, it, vi } from 'vitest'
import {
  buildDirectUsePrompt,
  deriveProjectName,
  startDirectPreplanning,
  type DirectStartPort,
} from '../src/client/direct-start.ts'

const workspaceEmpty = 'PRE_DESIGN_WORKSPACE_EMPTY'

describe('direct preplanning start', () => {
  it('从常见中文启动句中推导可编辑项目名', () => {
    expect(deriveProjectName('新建鄂州体育中心项目并完成 01-01 身份校准')).toBe('鄂州体育中心项目')
    expect(deriveProjectName('请创建 武汉站综合枢纽，然后进行项目身份校准')).toBe('武汉站综合枢纽')
    expect(deriveProjectName('   ')).toBe('')
    expect(deriveProjectName('新建' + '鄂'.repeat(60) + '，完成身份校准')).toBe('鄂'.repeat(48))
  })

  it('命令业务失败时停止且不发送模型 prompt', async () => {
    const prompt = vi.fn<DirectStartPort['prompt']>()
    const port: DirectStartPort = {
      executeCommand: vi.fn(async () => ({ kind: 'error' as const, text: '项目创建失败' })),
      prompt,
    }

    await expect(startDirectPreplanning(port, {
      projectName: '鄂州体育中心项目',
      statement: '新建鄂州体育中心项目并完成 01-01 身份校准',
    })).rejects.toThrow('项目创建失败')
    expect(prompt).not.toHaveBeenCalled()
  })

  it('先探测工作区，再创建 Presentation 标准项目并发送一次受控自然语言任务', async () => {
    const lines: string[] = []
    const prompts: string[] = []
    const port: DirectStartPort = {
      executeCommand: async line => {
        lines.push(line)
        return line === '/preplan-presentation-sync --probe'
          ? { kind: 'success', text: workspaceEmpty }
          : { kind: 'success' }
      },
      prompt: async text => {
        prompts.push(text)
        return { ok: true }
      },
    }

    await startDirectPreplanning(port, {
      projectName: '鄂州体育中心项目',
      statement: '新建鄂州体育中心项目并完成 01-01 身份校准',
    })

    expect(lines).toEqual([
      '/preplan-presentation-sync --probe',
      '/preplan-new 鄂州体育中心项目',
      '/preplan-presentation-sync',
    ])
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toContain('新建鄂州体育中心项目并完成 01-01 身份校准')
    expect(prompts[0]).toContain('preplanning_get_context')
    expect(prompts[0]).toContain('不要搜索工作区、文件系统或网页中的合同')
  })

  it('全流程启动先探测工作区和创建标准项目，再按用户选择配置模式并调用 preplan-run', async () => {
    const lines: string[] = []
    const port: DirectStartPort = {
      executeCommand: async line => {
        lines.push(line)
        return line === '/preplan-presentation-sync --probe'
          ? { kind: 'success', text: workspaceEmpty }
          : { kind: 'success' }
      },
      prompt: async () => ({ ok: true }),
    }

    await startDirectPreplanning(port, {
      projectName: '滨江文化活力区', statement: '完成全流程前期策划',
      mode: 'automatic', reportDepth: 'extended', visualBudget: 12,
    })

    expect(lines).toEqual([
      '/preplan-presentation-sync --probe',
      '/preplan-new 滨江文化活力区',
      '/preplan-presentation-sync',
      '/preplan-mode automatic 12 extended',
      '/preplan-run',
    ])
  })

  it('构造任务提示时拒绝空输入，模型拒收时报告真实错误', async () => {
    expect(() => buildDirectUsePrompt({ projectName: '', statement: '启动项目' })).toThrow('请输入项目名称')
    expect(() => buildDirectUsePrompt({ projectName: '项目', statement: '  ' })).toThrow('请输入项目描述')

    const port: DirectStartPort = {
      executeCommand: async line => line === '/preplan-presentation-sync --probe'
        ? { kind: 'success', text: workspaceEmpty }
        : { kind: 'success' },
      prompt: async () => ({ ok: false, message: '当前会话没有可用模型' }),
    }
    await expect(startDirectPreplanning(port, {
      projectName: '鄂州体育中心项目',
      statement: '完成身份校准',
    })).rejects.toThrow('当前会话没有可用模型')
  })
})
