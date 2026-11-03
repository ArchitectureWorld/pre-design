import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Load conditionally so the RED phase fails explicit feature assertions instead of module resolution.
async function api() {
  expect(existsSync(new URL('../src/research-v2/index.ts', import.meta.url))).toBe(true)
  return import('../src/research-v2/index.ts')
}
const flags = { industryPlanning: true, existingBuildings: true, externalPartners: true, marketing: true } as const

describe('approved v1.2 identity/routing projection', () => {
  it('preserves all catalogue, typed port, artifact and migration identities', async () => {
    const a = await api(), c = a.loadPlanningCatalog()
    expect(c.modules).toHaveLength(62); expect(c.edges).toHaveLength(176); expect(c.legacy).toHaveLength(57)
    expect(c.modules.map(m => m.id)).toContain('8.08')
    expect(c.modules.flatMap(m => m.figures)).toHaveLength(76)
    expect(c.modules.filter(m => m.when.op !== 'always').map(m => m.id)).toEqual(['5.02','5.03','5.04','5.05','6.04','7.04','7.05'])
    expect(c.sourceSha256).toBe('1ad0d7b0a2b52a84515cd97ab313c5596c0da02bea6175eaf4390d39d99d2a08')
    expect(c.hash).toMatch(/^[a-f0-9]{64}$/)
    expect(Object.isFrozen(c)).toBe(true); expect(Object.isFrozen(c.modules[0])).toBe(true)
    expect(c.edges.find(e => e.source === '4.01' && e.target === '8.07')?.selector).toBe('/outputs/failure_modes')
  })
  for (let mask = 0; mask < 16; mask++) {
    it(`projects known condition combination ${mask} without dead ends or cycles`, async () => {
      const a = await api(), c = a.loadPlanningCatalog()
      const f = { industryPlanning: !!(mask & 1), existingBuildings: !!(mask & 2), externalPartners: !!(mask & 4), marketing: !!(mask & 8) }
      const p = a.projectResearchPlan(c, f)
      expect(p.unresolved).toEqual([]); expect(p.blockedModuleIds).toEqual([])
      expect(p.waves.flat().sort()).toEqual([...p.activeModuleIds].sort())
      const at = new Map(p.waves.flatMap((wave, i) => wave.map(id => [id, i] as const)))
      for (const e of p.edges) expect(at.get(e.source)!).toBeLessThan(at.get(e.target)!)
      for (const id of ['5.01','6.07','7.03','8.03','8.04','8.05']) expect(p.activeModuleIds).toContain(id)
      expect(p.activeModuleIds).toHaveLength(62 - (f.industryPlanning ? 0 : 4) - (f.existingBuildings ? 0 : 1) - (f.externalPartners ? 0 : 1) - (f.marketing ? 0 : 1))
      const product = p.edges.find(e => e.groupId === 'REQ-5.06-5.03')!
      expect(product.source).toBe(f.industryPlanning ? '5.03' : '5.01')
      expect(product.type).toBe('planning.content-system.v1.2')
      expect(p.edges.find(e => e.groupId === 'REQ-8.06-7.04')!.source).toBe(f.externalPartners ? '7.04' : '7.01')
    })
  }
  it('does not silently use false alternatives for unknown conditions', async () => {
    const a = await api(), p = a.projectResearchPlan(a.loadPlanningCatalog(), {})
    expect(p.pendingModuleIds).toContain('5.03'); expect(p.inactiveModuleIds).toEqual([])
    expect(p.unresolved.some(x => x.groupId === 'REQ-5.06-5.03')).toBe(true)
    expect(p.blockedModuleIds).toContain('5.06'); expect(p.blockedModuleIds).toContain('8.08')
    expect(p.waves.flat()).toContain('1.01'); expect(p.waves.flat()).not.toContain('5.06')
    expect(p.edges.some(e => e.groupId === 'REQ-5.06-5.03')).toBe(false)
  })
  it('has deterministic hashes and a new plan identity when a condition changes', async () => {
    const a = await api(), c = a.loadPlanningCatalog(), first = a.projectResearchPlan(c, flags)
    expect(a.projectResearchPlan(c, { ...flags }).hash).toBe(first.hash)
    expect(a.projectResearchPlan(c, { ...flags, marketing: false }).hash).not.toBe(first.hash)
    expect(a.projectResearchPlan(c, { marketing: true, externalPartners: true, existingBuildings: true, industryPlanning: true }).hash).toBe(first.hash)
  })
  it('rejects unknown fields and truthy strings rather than coercing conditions', async () => {
    const a = await api(), c = a.loadPlanningCatalog()
    expect(() => a.projectResearchPlan(c, { ...flags, industryPlanning: 'false' } as never)).toThrow('CONDITION_INVALID')
    expect(() => a.projectResearchPlan(c, { wrong: true } as never)).toThrow('CONDITION_INVALID')
  })
  it('rejects forged catalogues instead of trusting a matching schema label', async () => {
    const a = await api(), seed = a.planningIndexSeed()
    const duplicate = structuredClone(seed); duplicate.modules.push(duplicate.modules[0])
    expect(() => a.compilePlanningIndex(duplicate)).toThrow('CATALOG_INVALID')
    const wrongPort = structuredClone(seed); wrongPort.alternatives[0][4] = 'unavailable_port'
    expect(() => a.compilePlanningIndex(wrongPort)).toThrow('CATALOG_INVALID')
    const cycle = structuredClone(seed); cycle.modules[0][4] = '8.08'
    expect(() => a.compilePlanningIndex(cycle)).toThrow('CATALOG_INVALID')
  })
})

describe('typed input gating and candidate deliverables', () => {
  async function setup() {
    const a = await api(), c = a.loadPlanningCatalog(), p = a.projectResearchPlan(c, { ...flags, industryPlanning: false })
    const dependencies = p.edges.filter(e => e.target === '5.06')
    const outputs = dependencies.map(e => ({ moduleId: e.moduleId, snapshotId: 's1', lifecycle: 'current', outputs: {
      [e.selector.split('/').at(-1)!]: { type: e.type, quality: 'accepted', records: [{ id: 'sample' }], claimRefs: ['c1'], scope: 'synthetic test', asOf: '2026-09-24', limitations: [] },
    } }))
    return { a, c, p, dependencies, outputs }
  }
  it('requires actual alternative output fields, not only a completed upstream module', async () => {
    const { a,c,p,outputs } = await setup()
    expect(a.assessResearchInputs(c,p,'5.06',outputs,'s1','draft').ready).toBe(true)
    delete outputs[0].outputs[Object.keys(outputs[0].outputs)[0]]
    expect(a.assessResearchInputs(c,p,'5.06',outputs,'s1','draft').ready).toBe(false)
  })
  for (const kind of ['wrong_type', 'stale', 'wrong_snapshot', 'limited_formal', 'missing_claim', 'duplicate_output']) {
    it(`blocks ${kind} inputs`, async () => {
      const { a,c,p,outputs } = await setup(), row = outputs[0], value = row.outputs[Object.keys(row.outputs)[0]]
      if (kind === 'wrong_type') value.type = 'unrelated'
      if (kind === 'stale') row.lifecycle = 'stale'
      if (kind === 'wrong_snapshot') row.snapshotId = 's0'
      if (kind === 'limited_formal') { value.quality = 'limited'; value.limitations = ['conditional only'] as never }
      if (kind === 'missing_claim') value.claimRefs = []
      if (kind === 'duplicate_output') outputs.push(structuredClone(row))
      expect(a.assessResearchInputs(c,p,'5.06',outputs,'s1',kind === 'limited_formal' ? 'formal' : 'draft').ready).toBe(false)
    })
  }
  it('allows limited input only for draft with retained limitations, never auto-promotes it', async () => {
    const { a,c,p,outputs } = await setup(), value = outputs[0].outputs[Object.keys(outputs[0].outputs)[0]]
    value.quality = 'limited'; value.limitations = ['estimated only'] as never
    const before = JSON.stringify(outputs), result = a.assessResearchInputs(c,p,'5.06',outputs,'s1','draft')
    expect(result.ready).toBe(true); expect(result.limitations).toContain('estimated only')
    expect(JSON.stringify(outputs)).toBe(before)
  })
  it('does not label unknown, inactive or forged module IDs ready', async () => {
    const { a,c,p,outputs } = await setup()
    expect(a.assessResearchInputs(c,p,'5.03',outputs,'s1','draft').ready).toBe(false)
    expect(() => a.assessResearchInputs(c,p,'9.99',outputs,'s1','draft')).toThrow('MODULE_UNKNOWN')
    expect(a.assessResearchInputs(c,a.projectResearchPlan(c,{}),'5.06',outputs,'s1','draft').ready).toBe(false)
  })
  it('makes all configured figures candidates, no invented output hashes or extra rendition identities', async () => {
    const a = await api(), c = a.loadPlanningCatalog(), list = a.candidateDeliverables(c,'2.03')
    expect(list.map(v => v.artifactId)).toEqual(['FIG-2.03-01','FIG-2.03-02','TAB-2.03'])
    expect(list.every(v => v.state === 'planned')).toBe(true)
    expect(list.every(v => !('outputHash' in v))).toBe(true)
    expect(() => a.candidateDeliverables(c,'2.09')).toThrow('MODULE_UNKNOWN')
  })
})

describe('legacy reference-only migration', () => {
  it('preserves historical bytes and status; produces only unreviewed candidate references', async () => {
    const a = await api(), c = a.loadPlanningCatalog()
    const old = [{ object_id: 'BL07', schema_version: '0.6.0', revision: 7, status: 'confirmed', data: { competitors: ['source'] }, approval: { status: 'approved' } }]
    const before = JSON.stringify(old), migration = a.planLegacyEvidence(c,old)
    expect(JSON.stringify(old)).toBe(before)
    expect(migration.references.length).toBeGreaterThan(1)
    expect(migration.references.every(r => r.status === 'unreviewed' && r.sourceRevision === 7)).toBe(true)
    expect(migration.references.every(r => /^[a-f0-9]{64}$/.test(r.sourceSha256))).toBe(true)
    expect(JSON.stringify(migration)).not.toContain('"confirmed"')
  })
  it('does not merge ambiguous snapshots or manufacture references for unknown old objects', async () => {
    const a = await api(), c = a.loadPlanningCatalog(), item = { object_id: 'BL07', schema_version: '0.6.0', revision: 7, data: {} }
    expect(() => a.planLegacyEvidence(c,[item,item])).toThrow('LEGACY_DUPLICATE')
    expect(() => a.planLegacyEvidence(c,[{...item,object_id:'UNKNOWN'}])).toThrow('LEGACY_UNKNOWN')
  })
})

describe('read-only DSH command', () => {
  it('accepts explicit flags; empty input retains unknown; invalid input fails closed', async () => {
    const a = await api(), command = a.createResearchPlanCommand()
    const empty = await command.handler({rawInput:'',agent:{id:'s'}} as never)
    expect(empty.kind).toBe('success'); expect(empty.text).toContain('只读'); expect(empty.text).toContain('待判定')
    const full = await command.handler({rawInput:'--industryPlanning=false --existingBuildings=false --externalPartners=false --marketing=false --json',agent:{id:'s'}} as never)
    expect(full.kind).toBe('success'); const parsed = JSON.parse(full.text!)
    expect(parsed.activeModuleIds).toHaveLength(55); expect(parsed.execution).toBe('planning_only')
    expect((await command.handler({rawInput:'--industryPlanning=no',agent:{id:'s'}} as never)).kind).toBe('error')
    expect((await command.handler({rawInput:'--invented=true',agent:{id:'s'}} as never)).kind).toBe('error')
  })
  it('exposes the actual module inputs and candidate outputs without initializing a project', async () => {
    const a = await api(), command = a.createResearchPlanCommand()
    const value = await command.handler({rawInput:'--item=2.03 --json',agent:{id:'unbound'}} as never)
    expect(value.kind).toBe('success'); const detail = JSON.parse(value.text!)
    expect(detail.module.id).toBe('2.03'); expect(detail.deliverables).toHaveLength(3)
  })
})

describe('revision and identity boundary regressions', () => {
  it('rejects a plan whose edge contents were changed without changing its fingerprint', async () => {
    const a = await api(), c = a.loadPlanningCatalog(), plan = structuredClone(a.projectResearchPlan(c,flags))
    ;(plan as unknown as {edges:unknown[]}).edges = []
    expect(() => a.assessResearchInputs(c,plan,'5.06',[],'s1','draft')).toThrow('PLAN_IDENTITY_MISMATCH')
  })
  it('rejects unknown legacy schemas and invalid revision/data envelopes', async () => {
    const a = await api(), c = a.loadPlanningCatalog()
    const base = {object_id:'BL07',schema_version:'0.6.0',revision:1,data:{}}
    expect(() => a.planLegacyEvidence(c,[{...base,schema_version:'future'}])).toThrow('LEGACY_SCHEMA_UNSUPPORTED')
    expect(() => a.planLegacyEvidence(c,[{...base,revision:0}])).toThrow('LEGACY_INVALID')
    expect(() => a.planLegacyEvidence(c,[{...base,data:null}])).toThrow('LEGACY_INVALID')
  })
})
