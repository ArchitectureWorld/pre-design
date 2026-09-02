import { describe, expect, it } from 'vitest'
import { buildPreplanningStatus, formatPreplanningStatus, normalizePreplanningStatus, parsePreplanningStatus } from '../src/session/events.ts'

describe('preplanning status snapshot', () => {
  it('生成可通过标准事件文本回放的项目摘要', () => {
    const status = buildPreplanningStatus({
      project: {
        projectId: 'project-1', name: '验收项目', currentRevision: 1, currentStage: '01-01',
        createdAt: '2026-08-27T17:00:00.000Z', updatedAt: '2026-08-27T17:10:00.000Z',
      },
      binding: { sessionId: 'session-1', projectId: 'project-1', boundAt: '2026-08-27T17:00:00.000Z' },
      stateObjects: [], revisions: [], events: [],
      proposals: [{
        proposalId: 'proposal-1', projectId: 'project-1', expectedRevision: 1,
        idempotencyKey: 'idempotency-1', envelope: {}, status: 'pending_review', createdAt: '2026-08-27T17:05:00.000Z',
      }],
      questions: [{
        questionId: 'question-1', projectId: 'project-1', prompt: '请确认项目名称',
        priority: 100, status: 'open', createdAt: '2026-08-27T17:00:00.000Z',
      }],
    })

    expect(status).toMatchObject({
      projectId: 'project-1', projectName: '验收项目', revision: 1, stage: '01-01',
      status: 'pending_review', pendingProposalCount: 1, pendingProposalId: 'proposal-1', openQuestionCount: 1,
      mode: 'manual', reportDepth: 'standard', blocked: 0,
      boundary: {
        kind: 'not_provided', label: '尚未提供场地边界',
        nextAction: '请提供总平图、红线图或闭合红线坐标。',
      },
    })
    expect(parsePreplanningStatus(formatPreplanningStatus(status))).toEqual(status)
  })

  it('继续解析不含 proposal id 的旧 Session 状态文本', () => {
    expect(parsePreplanningStatus(
      '前期策划状态：项目 "旧项目"（project-old），revision 0，阶段 01-01，待确认 1 项，开放问题 1 项。',
    )).toMatchObject({
      projectId: 'project-old', projectName: '旧项目', revision: 0, stage: '01-01',
      status: 'pending_review', pendingProposalCount: 1, openQuestionCount: 1,
      mode: 'manual', reportDepth: 'standard', blocked: 0,
    })
  })

  it('投影模式、57 项章节、视觉与最新三格式报告并保持文本可回放', () => {
    const context = {
      project: { projectId: 'project-1', name: '全流程项目', currentRevision: 57, currentStage: '08-08' },
      proposals: [], questions: [],
    } as never
    const status = buildPreplanningStatus(context, {
      governance: { readProject: () => ({
        policy: { mode: 'automatic', reportDepth: 'extended' },
        gateDecisions: Array.from({ length: 8 }, (_, index) => ({ gateId: `G${index + 1}`, decision: 'approved', revision: 57 })),
        visualAssets: [{ status: 'candidate' }, { status: 'adopted' }],
        visualTasks: [{ status: 'blocked' }],
        siteBoundaries: [{
          boundaryId: 'boundary-1', submittedRevision: 57, submittedAt: '2026-08-30T10:00:00.000Z',
          origin: 'synthetic', source: 'geojson',
        }],
        reportPackages: [{ packageId: 'package-57', status: 'published', sourceRevision: 57 }],
      }) } as never,
      runtime: { snapshot: () => ({
        blocked: [],
        chapters: Array.from({ length: 8 }, (_, index) => ({
          chapterId: String(index + 1).padStart(2, '0'), completed: index === 7 ? 8 : 7,
          total: index === 7 ? 8 : 7,
        })),
      }) } as never,
    })

    expect(status).toMatchObject({
      mode: 'automatic', reportDepth: 'extended', blocked: 0,
      chapters: expect.arrayContaining([{ id: '01', completed: 7, total: 7, gateStatus: 'approved' }]),
      visual: { candidates: 1, adopted: 1, blocked: 1 },
      reportPackage: { id: 'package-57', pdf: '/preplan-export/package-57/report.pdf' },
      boundary: {
        kind: 'synthetic_research', label: '模拟研究范围（不可正式确认）', source: 'geojson',
        nextAction: '请提供真实总平图、红线图或带 CRS 的闭合几何',
      },
    })
    expect(parsePreplanningStatus(formatPreplanningStatus(status))).toEqual(status)
  })

  it('丢弃结构化状态事件中伪造的场地边界内部标识', () => {
    const status = buildPreplanningStatus({
      project: {
        projectId: 'project-1', name: '验收项目', currentRevision: 1, currentStage: '01-01',
        createdAt: '2026-08-27T17:00:00.000Z', updatedAt: '2026-08-27T17:10:00.000Z',
      },
      binding: { sessionId: 'session-1', projectId: 'project-1', boundAt: '2026-08-27T17:00:00.000Z' },
      stateObjects: [], revisions: [], events: [], proposals: [], questions: [],
    })
    const normalized = normalizePreplanningStatus({
      ...status,
      boundary: {
        kind: 'synthetic_research', label: '模拟研究范围（不可正式确认）', source: 'geojson',
        nextAction: '请提供真实总平图、红线图或带 CRS 的闭合几何',
        boundaryId: 'boundary-secret', sourceAsset: { assetId: 'asset-secret', sha256: 'a'.repeat(64) },
        attachmentId: 'attachment-secret', sha256: 'b'.repeat(64),
        geometry: { derivedAssetId: 'derived-secret' }, confirmedRevision: 8,
        confirmedBy: { actorId: 'owner-secret' }, confirmationStatement: '不应暴露',
      },
    })

    expect(normalized?.boundary).toEqual({
      kind: 'synthetic_research', label: '模拟研究范围（不可正式确认）', source: 'geojson',
      nextAction: '请提供真实总平图、红线图或带 CRS 的闭合几何',
    })
  })
})
