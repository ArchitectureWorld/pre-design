// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PreplanningDashboard } from '../src/client/PreplanningDashboard.tsx'
import type { PreplanningStatusEventData } from '../src/session/events.ts'

afterEach(cleanup)

function status(presentation: NonNullable<PreplanningStatusEventData['presentation']>): PreplanningStatusEventData {
  return {
    projectId: 'preplan-1', projectName: '沙潭河', revision: 11, stage: '02-03',
    status: 'active', pendingProposalCount: 0, openQuestionCount: 0,
    mode: 'automatic', reportDepth: 'standard', blocked: 0,
    chapters: Array.from({ length: 8 }, (_, index) => ({
      id: String(index + 1).padStart(2, '0'), completed: index === 0 ? 7 : index === 1 ? 2 : 0,
      total: [7, 8, 6, 6, 7, 7, 8, 8][index]!, gateStatus: 'pending',
    })),
    visual: { candidates: 0, adopted: 0, blocked: 0 },
    boundary: { kind: 'not_provided', label: '尚未提供场地边界', nextAction: '请提供总平图、红线图或闭合红线坐标。' },
    modelRoute: { primary: '当前 DSH Session 所选模型', visual: 'antigravity / gemini-3.1-flash-image' },
    presentation,
  }
}

describe('Presentation continuous-sync status', () => {
  it('shows the synchronized Revision', () => {
    const view = render(<PreplanningDashboard status={status({
      state: 'synced', currentRevision: 11, syncedRevision: 11,
    })} />)
    expect(view.getByText('Presentation：已同步 Revision 11')).toBeTruthy()
  })

  it('shows a pending Revision gap', () => {
    const view = render(<PreplanningDashboard status={status({
      state: 'pending', currentRevision: 11, syncedRevision: 9,
    })} />)
    expect(view.getByText('Presentation：等待同步（Pre 11 / 已同步 9）')).toBeTruthy()
  })

  it('shows the exact one-time migration command', () => {
    const view = render(<PreplanningDashboard status={status({
      state: 'migration_required', currentRevision: 11, syncedRevision: 0,
      message: '旧版标准项目需要迁移。',
    })} />)
    expect(view.getByText('Presentation：需要迁移；执行 /preplan-presentation-sync --force')).toBeTruthy()
  })

  it('shows external-change protection without claiming success', () => {
    const view = render(<PreplanningDashboard status={status({
      state: 'external_changes', currentRevision: 11, syncedRevision: 9,
      message: '检测到外部修改。',
    })} />)
    expect(view.getByText('Presentation：检测到外部修改，未覆盖')).toBeTruthy()
  })
})
