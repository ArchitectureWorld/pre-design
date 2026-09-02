import { describe, expect, it } from 'vitest'
import { buildPreplanningStatus } from '../src/session/events.ts'
import { siteBoundaryFixture, siteBoundaryOwner } from './site-boundary-fixture.ts'

const context = {
  project: { projectId: 'project-1', name: '场地边界状态项目', currentRevision: 4, currentStage: '01-01' },
  proposals: [], questions: [],
} as never

function statusFor(siteBoundaries: readonly unknown[]) {
  return buildPreplanningStatus(context, {
    governance: { readProject: () => ({
      policy: undefined,
      gateDecisions: [], visualAssets: [], visualTasks: [], reportPackages: [], siteBoundaries,
    }) } as never,
    runtime: { snapshot: () => ({
      blocked: [],
      chapters: Array.from({ length: 8 }, (_, index) => ({
        chapterId: String(index + 1).padStart(2, '0'), completed: 0, total: index === 7 ? 8 : 7,
      })),
    }) } as never,
  })
}

describe('场地边界状态卡数据', () => {
  it.each([
    ['未提供', [], {
      kind: 'not_provided',
      label: '尚未提供场地边界',
      nextAction: '请提供总平图、红线图或闭合红线坐标。',
    }],
    ['待确认', [siteBoundaryFixture()], {
      kind: 'pending_confirmation',
      label: '场地边界待项目负责人确认',
      source: 'approved_redline',
      nextAction: '请项目负责人确认采用当前边界表达。',
    }],
    ['正式确认', [siteBoundaryFixture({
      status: 'confirmed_formal_boundary',
      confirmedBy: siteBoundaryOwner,
      confirmedAt: '2026-08-30T10:05:00.000Z',
      confirmedRevision: 4,
      confirmationChannel: 'dsh_human_command',
      confirmationStatement: '该图是本项目采用的总平图或红线图，且图中明确表达项目边界',
      confirmationSourceSha256: 'a'.repeat(64),
    })], {
      kind: 'confirmed_formal_boundary',
      label: '场地边界已正式确认',
      source: 'approved_redline',
      nextAction: '可作为正式边界用于后续工作。',
    }],
    ['模拟研究范围', [siteBoundaryFixture({
      origin: 'synthetic',
      submissionChannel: 'synthetic_fixture',
      source: 'geojson',
      sourceAsset: undefined,
      geometry: {
        crs: 'EPSG:4490',
        coordinates: [[114, 30], [114.01, 30], [114, 30.01], [114, 30]],
        sha256: 'a'.repeat(64),
        derivedAssetId: 'derived-boundary-map-1',
        derivedFileName: 'project-1/deterministic/derived-boundary-map-1.svg',
        derivedSha256: 'b'.repeat(64),
      },
    })], {
      kind: 'synthetic_research',
      label: '模拟研究范围（不可正式确认）',
      source: 'geojson',
      nextAction: '请提供真实总平图、红线图或带 CRS 的闭合几何',
    }],
  ])('将%s投影为不含内部标识的状态卡信息', (_name, siteBoundaries, boundary) => {
    expect(statusFor(siteBoundaries).boundary).toEqual(boundary)
  })
})
