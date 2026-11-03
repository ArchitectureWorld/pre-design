import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { sha256CanonicalJson } from '../src/presentation/canonical-json.ts'

const url = new URL('../src/research-v2/boundary-audit.ts', import.meta.url)
async function api() {
  expect(existsSync(url), 'native boundary calculations and mutation receipts are implemented').toBe(true)
  return import(url.href)
}
const field = (value: unknown) => ({ value, claimClass: 'assumption', claimRefs: [], limitations: ['Synthetic research scenario, not survey or approval'] })
function fixture() {
  return { boundaries: { records: [{ recordId: 'research', boundaryId: field('BND-1'), scopeKind: field('research'), version: field('v1'),
    crs: field('EPSG:4326'), axisOrder: field('xy'), legalStatus: field('research-only'),
    geometry: field({ type: 'Polygon', coordinates: [[[114, 30], [114.01, 30], [114.01, 30.01], [114, 30.01], [114, 30]]] }),
    area: field({ value: 10, unit: 'km²', basis: 'Different historical estimate, retained for independent review' }),
  }] } }
}
describe('deterministic research boundary audit', () => {
  it('computes WGS-84 source spelling without mutating it and retains legacy unsupported receipts', async () => {
    const { buildBoundaryResearchAudit, verifyBoundaryResearchAudit } = await api()
    const outputs=fixture();outputs.boundaries.records[0].crs=field('WGS-84')
    const before=sha256CanonicalJson(outputs), current=buildBoundaryResearchAudit(outputs)
    expect(current.boundaries[0].status).toBe('computed')
    expect(current.boundaries[0].axisSwapProbe.detected).toBe(true)
    expect(current.boundaries[0].vertexProbe.staleDependencyRejected).toBe(true)
    expect(sha256CanonicalJson(outputs)).toBe(before)
    const legacy=buildBoundaryResearchAudit(outputs,'research-boundary-audit.v1')
    expect(legacy.boundaries[0].status).toBe('unavailable')
    expect(legacy.boundaries[0].limitations).toContain('BOUNDARY_CRS_UNSUPPORTED')
    expect(()=>verifyBoundaryResearchAudit(outputs,legacy)).not.toThrow()
    expect(()=>verifyBoundaryResearchAudit(outputs,current)).not.toThrow()
    const tampered={...legacy,version:'research-boundary-audit.v999'}
    expect(()=>verifyBoundaryResearchAudit(outputs,tampered)).toThrow()
  })
  it('calculates area, exercises stale dependency rejection on a changed vertex, and never edits the candidate', async () => {
    const { buildBoundaryResearchAudit, verifyBoundaryResearchAudit } = await api()
    const outputs = fixture(), before = sha256CanonicalJson(outputs), audit = buildBoundaryResearchAudit(outputs)
    const row = audit.boundaries[0]
    expect(row.status).toBe('computed')
    // Analytic spherical rectangle: R² delta-longitude (sin north - sin south).
    const expected = 6371008.8 ** 2 * Math.PI / 180 * 0.01 * (Math.sin(30.01 * Math.PI / 180) - Math.sin(30 * Math.PI / 180))
    expect(row.area.squareMeters).toBeCloseTo(expected, 3)
    expect(row.declaredArea.value).toBe(10)
    expect(row.comparison.declaredSquareMeters).toBe(10_000_000)
    expect(row.comparison.deltaSquareMeters).toBeGreaterThan(8_000_000)
    expect(row.axisSwapProbe.detected).toBe(true)
    expect(row.vertexProbe.synthetic).toBe(true)
    expect(row.vertexProbe.staleDependencyRejected).toBe(true)
    expect(row.vertexProbe.previousGeometryPreserved).toBe(true)
    expect(row.vertexProbe.areaDeltaSquareMeters).not.toBe(0)
    expect(row.vertexProbe.wouldInvalidateModuleIds).toContain('6.01')
    expect(sha256CanonicalJson(outputs)).toBe(before)
    expect(() => verifyBoundaryResearchAudit(outputs, audit)).not.toThrow()
    const tampered = structuredClone(audit); tampered.boundaries[0].area.squareMeters++
    expect(() => verifyBoundaryResearchAudit(outputs, tampered)).toThrow('BOUNDARY_AUDIT_REPLAY_MISMATCH')
    outputs.boundaries.records[0].version = field('v2')
    expect(() => verifyBoundaryResearchAudit(outputs, audit)).toThrow('BOUNDARY_AUDIT_REPLAY_MISMATCH')
  })
  it('preserves missing implementation geometry and does not invent an area or approval', async () => {
    const { buildBoundaryResearchAudit } = await api(), outputs = fixture()
    outputs.boundaries.records.push({ ...outputs.boundaries.records[0], recordId: 'implementation', scopeKind: field('implementation'), geometry: field(null) })
    const row = buildBoundaryResearchAudit(outputs).boundaries[1]
    expect(row.status).toBe('unavailable')
    expect(row.area).toBeUndefined()
    expect(row.legalStatus).toBe('research-only')
  })
  it('supports explicit yx and holes without changing the original coordinate order', async () => {
    const { buildBoundaryResearchAudit } = await api(), outputs = fixture(), base = buildBoundaryResearchAudit(outputs).boundaries[0].area.squareMeters
    const geometry = outputs.boundaries.records[0].geometry.value as any
    geometry.coordinates.push([[114.002,30.002],[114.004,30.002],[114.004,30.004],[114.002,30.004],[114.002,30.002]])
    const withHole = buildBoundaryResearchAudit(outputs).boundaries[0].area.squareMeters
    expect(withHole).toBeLessThan(base)
    outputs.boundaries.records[0].axisOrder = field('yx')
    geometry.coordinates = geometry.coordinates.map((r: number[][]) => r.map(([x,y]) => [y,x]))
    expect(buildBoundaryResearchAudit(outputs).boundaries[0].area.squareMeters).toBeCloseTo(withHole, 4)
  })
  it.each(['axes', 'crs', 'open', 'crossed', 'outside-hole', 'duplicate-part'])('fails closed for %s geometry', async mode => {
    const { buildBoundaryResearchAudit } = await api(), outputs = fixture(), row = outputs.boundaries.records[0], geometry = row.geometry.value as any
    if (mode === 'axes') geometry.coordinates = geometry.coordinates.map((r: number[][]) => r.map(([x,y]) => [y,x]))
    if (mode === 'crs') row.crs = field('EPSG:3857')
    if (mode === 'open') geometry.coordinates[0].pop()
    if (mode === 'crossed') [geometry.coordinates[0][1], geometry.coordinates[0][2]] = [geometry.coordinates[0][2], geometry.coordinates[0][1]]
    if (mode === 'outside-hole') geometry.coordinates.push([[115,30],[115.01,30],[115.01,30.01],[115,30.01],[115,30]])
    if (mode === 'duplicate-part') row.geometry = field({ type: 'MultiPolygon', coordinates: [geometry.coordinates, geometry.coordinates] })
    const checked = buildBoundaryResearchAudit(outputs).boundaries[0]
    expect(checked.status).not.toBe('computed')
    expect(checked.area).toBeUndefined()
    expect(checked.limitations.length).toBeGreaterThan(0)
  })
  it('does not claim an axis-swap detection when both orders are numerically plausible', async () => {
    const { buildBoundaryResearchAudit } = await api(), outputs = fixture(), geometry = outputs.boundaries.records[0].geometry.value as any
    geometry.coordinates = geometry.coordinates.map((r: number[][]) => r.map(([x,y]) => [x-100,y]))
    const checked = buildBoundaryResearchAudit(outputs).boundaries[0]
    expect(checked.axisSwapProbe.detected).toBe(false)
    expect(checked.axisSwapProbe.limitations.length).toBeGreaterThan(0)
  })
  it('requires the independent review to bind the exact replayed computation receipt', async () => {
    const { buildBoundaryResearchAudit, verifyModuleBoundaryAudit } = await api(), outputs = fixture(), audit = buildBoundaryResearchAudit(outputs)
    expect(typeof verifyModuleBoundaryAudit).toBe('function')
    const structuredOutput={boundaryAuditHash:sha256CanonicalJson(audit)}
    const execution = { boundaryAudit: audit, reviewReceipts: [{ executionId:'review',childId:'review-child',boundaryAuditHash: sha256CanonicalJson(audit) }],
      attempts:[{classId:'review',status:'completed',executionId:'review',childId:'review-child',structuredOutput,structuredHash:sha256CanonicalJson(structuredOutput)}] }
    expect(() => verifyModuleBoundaryAudit('1.02', outputs, execution)).not.toThrow()
    expect(() => verifyModuleBoundaryAudit('1.02', outputs, { ...execution, reviewReceipts: [{}] })).toThrow('BOUNDARY_REVIEW_AUDIT_BINDING')
    const changed = structuredClone(execution); changed.boundaryAudit.boundaries[0].vertexProbe.staleDependencyRejected = false
    expect(() => verifyModuleBoundaryAudit('1.02', outputs, changed)).toThrow('BOUNDARY_AUDIT_REPLAY_MISMATCH')
    expect(() => verifyModuleBoundaryAudit('1.01', outputs, execution)).toThrow('BOUNDARY_AUDIT_MODULE_MISMATCH')
    const legacy=structuredClone(execution); legacy.attempts[0].structuredOutput={} as any; legacy.attempts[0].structuredHash=sha256CanonicalJson({})
    expect(() => verifyModuleBoundaryAudit('1.02', outputs, legacy)).toThrow('BOUNDARY_REVIEW_NATIVE_BINDING')
  })
})
