import { describe, expect, it } from 'vitest'
import { startDirectPreplanning, type DirectStartPort } from '../src/client/direct-start.ts'

const syncedSources = [
  'PRE_DESIGN_SOURCE_MATERIAL_COUNT:2',
  'PRE_DESIGN_SOURCE_INBOX_COUNT:2',
].join('\n')

describe('workspace-aware direct start', () => {
  it('probes the Workspace before creating, syncing and running a same-name automatic-first Pre project', async () => {
    const lines: string[] = []
    const port: DirectStartPort = {
      executeCommand: async line => {
        lines.push(line)
        if (line === '/preplan-presentation-sync --probe') {
          return { kind: 'success', text: 'PRE_DESIGN_WORKSPACE_EMPTY' }
        }
        if (line === '/preplan-presentation-sync') {
          return { kind: 'success', text: syncedSources }
        }
        return { kind: 'success', text: 'ok' }
      },
    }

    await startDirectPreplanning(port, {
      workspacePath: 'C:\\Projects\\武汉站综合枢纽',
    })

    expect(lines).toEqual([
      '/preplan-presentation-sync --probe',
      '/preplan-new 武汉站综合枢纽',
      '/preplan-presentation-sync',
      '/preplan-mode automatic 20 standard',
      '/preplan-run',
    ])
  })

  it('continues the existing Workspace project after syncing newly added 原始资料', async () => {
    const lines: string[] = []
    const port: DirectStartPort = {
      executeCommand: async line => {
        lines.push(line)
        if (line === '/preplan-presentation-sync --probe') {
          return { kind: 'success', text: 'PRE_DESIGN_WORKSPACE_PROJECT_ATTACHED' }
        }
        if (line === '/preplan-presentation-sync') {
          return { kind: 'success', text: syncedSources }
        }
        return { kind: 'success', text: 'ok' }
      },
    }

    await startDirectPreplanning(port, {
      workspacePath: '/projects/已有工作区项目',
    })

    expect(lines).toEqual([
      '/preplan-presentation-sync --probe',
      '/preplan-presentation-sync',
      '/preplan-mode automatic 20 standard',
      '/preplan-run',
    ])
  })
})
