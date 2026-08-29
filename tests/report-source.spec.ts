import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createFrozenProjectInput, loadClientProjectProfile } from '../src/report/source.ts'
import { CLIENT_PROFILE } from './client-report-fixture.ts'

describe('createFrozenProjectInput', () => {
  it('loads a replaceable client profile by safe project id', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-profile-'))
    try {
      await writeFile(join(root, 'golden-project.json'), JSON.stringify(CLIENT_PROFILE), 'utf8')
      await expect(loadClientProjectProfile(root, 'golden-project')).resolves.toMatchObject({
        identity: { projectId: 'golden-project' },
        proposition: { coreValue: CLIENT_PROFILE.proposition.coreValue },
      })
      await expect(loadClientProjectProfile(root, '../escape')).rejects.toThrow(/unsafe project id/u)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('把冻结状态、Gate 和采用视觉资产转换为同一 Revision 的甲方报告输入', () => {
    const source = createFrozenProjectInput('project-1', 3, {
      repository: {
        readProjectRevision: vi.fn(() => ({
          project: { projectId: 'project-1', name: '滨江文化活力区' },
          revision: { revision: 3, committedAt: '2026-08-28T10:00:00.000Z' },
          stateSnapshot: { PS01: { title: '项目身份', conclusion: '以公共文化主轴串联滨水开放空间', location: '鄂州' } },
        })),
      } as never,
      governance: {
        readProject: vi.fn(() => ({
          gateDecisions: [{ gateId: 'G1', revision: 3, decision: 'approved' }],
          visualAssets: [{
            assetId: 'asset-1', projectId: 'project-1', kind: 'concept', status: 'adopted',
            adoptedRevision: 3, fileName: 'project-1/candidates/asset-1.png', mimeType: 'image/png',
            promptSummary: '滨水公共空间概念表现图',
          }],
        })),
      } as never,
      registry: {
        workflows: vi.fn(() => [{ targetObjectId: 'PS01', chapterId: '01', title: '项目身份校准' }]),
      } as never,
      visualStore: { resolveAsset: vi.fn(() => 'C:/visual/asset-1.png') } as never,
    })

    expect(source).toMatchObject({
      projectId: 'project-1', projectName: '滨江文化活力区', revision: 3,
      recommendation: '以公共文化主轴串联滨水开放空间',
      stateObjects: [{ objectId: 'PS01', chapterId: '01', title: '项目身份' }],
      gates: [{ gateId: 'G1', revision: 3, decision: 'approved' }],
      visualAssets: [{ assetId: 'asset-1', sourcePath: 'C:/visual/asset-1.png' }],
    })
  })
})
