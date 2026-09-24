/** Synthetic coordinates and fabricated provider responses, never a real project. */
export function regionalRequest() {
  const a = { longitude: 114.30, latitude: 30.60, crs: 'EPSG:4326' }
  const b = { longitude: 114.31, latitude: 30.61, crs: 'EPSG:4326' }
  return {
    schemaVersion: 'regional-od-request.v1',
    projectId: 'prj_01J9K2M6T8Q4V7X9N3P5R6S8W0', snapshotId: 'snapshot-regional-001',
    scope: '合成测试范围，非真实项目', asOf: '2026-09-24',
    nodes: [
      { id: 'entry-a', regionId: 'region-project', label: '合成项目入口', kind: 'project-entry',
        selectionReason: '合成测试起点', relation: 'existing', entranceStatus: 'source-recorded', coordinate: a,
        evidenceIds: ['source-nodes'], coordinateBinding: { sourceId: 'source-nodes', selector: '/entries/0/coordinate' } },
      { id: 'entry-b', regionId: 'region-hub', label: '合成交通节点入口', kind: 'transport',
        selectionReason: '检验与交通节点的联系', relation: 'potential', entranceStatus: 'provisional', coordinate: b,
        evidenceIds: ['source-nodes'], coordinateBinding: { sourceId: 'source-nodes', selector: '/entries/1/coordinate' } },
    ],
    queries: [{ id: 'OD-a-b', fromId: 'entry-a', toId: 'entry-b', mode: 'driving' }],
    captures: [{ sourceId: 'source-nodes', label: '合成节点原始记录', locator: 'workspace:synthetic-nodes.json',
      observedAt: '2026-09-24T00:00:00Z', claimClass: 'assumption', mediaType: 'application/json',
      content: JSON.stringify({ entries: [{coordinate: a}, {coordinate: b}] }) }],
    policy: { maxRequests: 4, timeoutMs: 30000, snapTolerance: { meters: 30,
      reviewedBy: 'synthetic-reviewer', reviewedAt: '2026-09-24T00:00:00Z', rationale: '合成测试允许30米吸附，不作为生产项目默认值' } },
  }
}
export function osrmResponse() {
  return { code: 'Ok', routes: [{ distance: 1700, duration: 240, geometry: { type: 'LineString',
    coordinates: [[114.30,30.60],[114.30,30.607],[114.307,30.61],[114.31,30.61]] } }],
    waypoints: [ { location: [114.30,30.60], distance: 0, name: '合成起点' },
      { location: [114.31,30.61], distance: 0, name: '合成终点' } ] }
}
export const jsonResponse = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'content-type': 'application/json' },
})
