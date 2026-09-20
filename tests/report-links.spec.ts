import { describe, expect, it } from 'vitest'
import { reportLinks } from '../src/client/report-links.ts'
import { buildPreplanningStatus, formatPreplanningStatus, normalizePreplanningStatus, parsePreplanningStatus } from '../src/session/events.ts'
import type { ArtifactRecord } from '../src/governance/types.ts'

const context = { project: { projectId: 'project-1', name: '验收项目', currentRevision: 57, currentStage: '08-08' }, proposals: [], questions: [] }

function statusWithFormats(formats?: readonly ArtifactRecord['format'][]) {
  return buildPreplanningStatus(context as never, {
    governance: { readProject: () => ({ gateDecisions: [], visualAssets: [], visualTasks: [], siteBoundaries: [], reportPackages: [
      { packageId: 'package-57', projectId: 'project-1', status: 'generated_conditional', sourceRevision: 57, createdAt: '2026-09-18T10:00:00Z' },
    ] }) } as never,
    runtime: { snapshot: () => ({ runs: [], blocked: [], chapters: [{ chapterId: '08', completed: 8, total: 8 }] }) } as never,
    reportFormats: () => formats,
  })
}

describe('report links from available formats', () => {
  it('does not infer any files from a package id alone', () => {
    expect(reportLinks('package-57')).toEqual({ id: 'package-57' })
  })

  it('creates only canonical URLs for the supplied format set', () => {
    expect(reportLinks('package-57', { deliveryMode: 'conditional', sourceRevision: 57 }, ['html'])).toEqual({
      id: 'package-57', deliveryMode: 'conditional', sourceRevision: 57, html: '/preplan-export/package-57/html/index.html',
    })
    expect(reportLinks('package-57', {}, ['pdf', 'html', 'pptx'])).toEqual({
      id: 'package-57', html: '/preplan-export/package-57/html/index.html',
      pdf: '/preplan-export/package-57/report.pdf', pptx: '/preplan-export/package-57/report.pptx',
    })
  })

  it('rejects unsafe ids and malformed or unsupported format selections', () => {
    expect(() => reportLinks('../package-57', {}, ['html'])).toThrow()
    for (const formats of [null, 'html', {}, ['html', 'docx']]) {
      expect(() => reportLinks('package-57', {}, formats as never)).toThrow()
    }
  })

  it.each([
    { formats: ['html'], names: ['html'] },
    { formats: ['html', 'pptx', 'pdf'], names: ['html', 'pdf', 'pptx'] },
  ] as const)('preserves manifest formats through live status, text history and event normalization: $formats', ({ formats, names }) => {
    const status = statusWithFormats(formats)
    expect(Object.keys(status.reportPackage!).filter(key => ['html', 'pdf', 'pptx'].includes(key)).sort()).toEqual(names)
    expect(status.reportError).toBeUndefined()
    expect(parsePreplanningStatus(formatPreplanningStatus(status))).toEqual(status)
    expect(normalizePreplanningStatus(status)).toEqual(status)
  })

  it('keeps package identity and a diagnostic when its manifest cannot be read', () => {
    const status = statusWithFormats()
    expect(status.reportPackage).toEqual({ id: 'package-57', deliveryMode: 'conditional', sourceRevision: 57 })
    expect(status.reportError).toContain('成果清单')
    expect(parsePreplanningStatus(formatPreplanningStatus(status))).toEqual(status)
  })

  it('normalizes provided HTML links without adding formats or trusting an external URL', () => {
    const status = { ...buildPreplanningStatus(context as never), reportPackage: {
      id: 'package-57', deliveryMode: 'conditional' as const, sourceRevision: 57, html: 'javascript:alert(1)',
    } }
    expect(normalizePreplanningStatus(status)?.reportPackage).toEqual({
      id: 'package-57', deliveryMode: 'conditional', sourceRevision: 57, html: '/preplan-export/package-57/html/index.html',
    })
  })

  it('rejects malformed formats in serialized status instead of fabricating download links', () => {
    const text = formatPreplanningStatus(statusWithFormats(['html']))
    const tampered = text.replace(/"formats":\[[^\]]*\]/u, '"formats":["html","docx"]')
    expect(parsePreplanningStatus(tampered)).toBeUndefined()
  })
})
