import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PresentationStandardProjectService } from '../src/presentation/standard-project-service.ts'
import type { PresentationProjectBindingRecord } from '../src/presentation/types.ts'

describe('Workspace binding survives failed standard-project initialization', () => {
  it('persists the Workspace-to-Pre identity before Contract-backed document construction', async () => {
    const rows = new Map<string, PresentationProjectBindingRecord>()
    const bindings = {
      read: (preDesignProjectId: string) => rows.get(preDesignProjectId),
      findByWorkspaceRoot: (workspaceRoot: string) => [...rows.values()]
        .find(record => record.workspaceRoot === workspaceRoot),
      put: async (record: PresentationProjectBindingRecord) => {
        rows.set(record.preDesignProjectId, record)
        return record
      },
    }
    const fallbackRoot = join(tmpdir(), 'pre-design-legacy-output')
    const workspaceRoot = resolve(join(tmpdir(), 'pre-design-workspace-recovery'))
    const service = new PresentationStandardProjectService({
      bindings: bindings as never,
      workspaceRoot: fallbackRoot,
      now: () => '2026-09-04T04:00:00.000Z',
    })

    await expect(service.createProject({
      preDesignProjectId: 'preplan-workspace-recovery',
      projectName: '恢复测试项目',
      projectSlug: 'INVALID SLUG',
      workspaceRoot,
      createdAt: '2026-09-04T04:00:00.000Z',
    })).rejects.toThrow('PRESENTATION_PROJECT_SLUG_INVALID')

    expect(rows.get('preplan-workspace-recovery')).toMatchObject({
      preDesignProjectId: 'preplan-workspace-recovery',
      workspaceRoot,
      state: 'awaiting_contract',
    })
    expect(service.findByWorkspaceRoot(workspaceRoot)?.preDesignProjectId)
      .toBe('preplan-workspace-recovery')
  })
})
