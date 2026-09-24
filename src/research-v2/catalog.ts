import { sha256CanonicalJson } from '../presentation/canonical-json.ts'
import { PLANNING_INDEX_SEED } from './catalog-data.ts'
import { evaluate, freeze, normalizeFlags, topologicalWaves } from './graph.ts'
import { CONDITION_FIELDS, type CandidateArtifact, type Condition, type ConditionField, type PlanningCatalog, type PlanningEdge, type PlanningModule } from './types.ts'

function fail(message: string): never { throw new Error(`CATALOG_INVALID: ${message}`) }
function object(value: unknown): Record<string,unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return fail('object required')
  return value as Record<string,unknown>
}
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : fail('array required') }
function text(value: unknown): string { return typeof value === 'string' && value.trim() !== '' ? value : fail('nonempty text required') }
function list(value: unknown): string[] { return value === '' ? [] : text(value).split(' ') }
function condition(field: unknown, value: boolean = true): Condition {
  if (field === null) return {op:'always'}
  if (!(CONDITION_FIELDS as readonly unknown[]).includes(field)) return fail('unknown condition field')
  return {op:'eq',field:field as ConditionField,value}
}
function unique(values: readonly string[], label: string): void { if (new Set(values).size !== values.length) fail(`duplicate ${label}`) }
export function planningIndexSeed(): typeof PLANNING_INDEX_SEED { return structuredClone(PLANNING_INDEX_SEED) }

/** Compile only routing and artifact identities. This is NOT a professional result schema validator. */
export function compilePlanningIndex(input: unknown): PlanningCatalog {
  // The canonicalizer rejects non-JSON inputs and prevents getters from being run by the decoder.
  sha256CanonicalJson(input)
  const seed = object(input)
  if (seed.schemaVersion !== 'planning-index.v1' || seed.specVersion !== 'planning-research.v1.2') fail('unsupported version')
  const sourceSha256 = text(seed.sourceSha256)
  if (!/^[a-f0-9]{64}$/.test(sourceSha256)) fail('source digest')
  const portTypes = object(seed.portTypes), extras = object(seed.extraPorts), edgePorts = object(seed.edgePorts)
  const chapters = array(seed.chapters).map(row => { const r = array(row); return [text(r[0]),text(r[1])] as const })
  unique(chapters.map(c => c[0]),'chapter')
  const parents = new Map<string,string[]>()
  const modules: PlanningModule[] = array(seed.modules).map(value => {
    const row = array(value)
    if (row.length !== 9) fail('module tuple must contain 9 fields')
    const id = text(row[0]), title = text(row[1]), primary = text(row[2]), dataset = text(row[5])
    if (!/^[1-8]\.0[1-9]$/.test(id) || !chapters.some(c => c[0] === id[0])) fail(`module ${id}`)
    if (dataset.includes('/') || dataset.includes('\\') || dataset === '..') fail('dataset must be a basename')
    parents.set(id,list(row[4]))
    const ports = [primary,...array(extras[id] ?? [])].map(value => {
      const name = text(value)
      if (!/^[a-z][a-z0-9_]*$/.test(name)) fail('unsafe output port')
      const type = text(portTypes[name])
      if (!/^planning\.[a-z][a-z0-9_-]*\.v1\.2$/.test(type)) fail('port type')
      return {name,type,selector:`/outputs/${name}`}
    })
    unique(ports.map(p => p.name),'output port')
    const figures: CandidateArtifact[] = array(row[8]).map((value,index) => {
      const f = array(value)
      if (f.length !== 4 || index >= 99) fail('figure tuple')
      return {artifactId:`FIG-${id}-${String(index+1).padStart(2,'0')}`,kind:'figure',title:text(f[0]),state:'planned',dataset,
        display:{type:text(f[1]),template:text(f[2]),sizePreset:text(f[3])},reportRequirement:'candidate',auditRequired:false,renditions:[]}
    })
    return {id,moduleId:`preplan.research.0${id}`,title,when:condition(row[3]),ports,figures,
      table:{artifactId:`TAB-${id}`,kind:'table',title:text(row[6]),state:'planned',dataset,
        display:{type:'table',sizePreset:'wideTable',columns:text(row[7]).split('｜')},reportRequirement:'candidate',auditRequired:true,renditions:[]}}
  })
  unique(modules.map(m => m.id),'module')
  if (chapters.length !== 8 || modules.length !== 62) fail('approved chapter/module coverage')
  const byId = new Map(modules.map(m => [m.id,m]))
  const alternatives = new Map<string,unknown[]>()
  for (const row of array(seed.alternatives)) {
    const a = array(row), key = `${text(a[0])}:${text(a[1])}`
    if (a.length !== 7 || alternatives.has(key)) fail('alternative tuple')
    if (!(parents.get(text(a[0])) ?? []).includes(text(a[1]))) fail('alternative references unknown dependency')
    alternatives.set(key,a)
  }
  const edges: PlanningEdge[] = []
  function add(target: string, groupSource: string, source: string, portName: string, when: Condition, n: number) {
    const mod = byId.get(source), port = mod?.ports.find(p => p.name === portName)
    if (!mod || !port || !byId.has(target)) fail(`missing source/port ${source}/${portName}`)
    const groupId = `REQ-${target}-${groupSource}`
    edges.push({edgeId:`${groupId}-${n}`,groupId,source,target,moduleId:mod.moduleId,selector:port.selector,type:port.type,
      requiredWhen:when,minimumState:{draft:['accepted','limited'],formal:['accepted']},alternativeOf:n === 1 ? null : `${groupId}-1`})
  }
  for (const [target,dependencies] of parents) {
    unique(dependencies,`dependencies of ${target}`)
    for (const source of dependencies) {
      const alt = alternatives.get(`${target}:${source}`)
      if (alt) {
        add(target,source,text(alt[3]),text(alt[4]),condition(alt[2],true),1)
        add(target,source,text(alt[5]),text(alt[6]),condition(alt[2],false),2)
      } else {
        const mod = byId.get(source)
        if (!mod) fail(`unknown upstream ${source}`)
        add(target,source,source,text(edgePorts[`${target}:${source}`] ?? mod.ports[0].name),{op:'always'},1)
      }
    }
  }
  unique(edges.map(e => e.edgeId),'edge')
  for (const alt of alternatives.values()) {
    const pair = edges.filter(e => e.groupId === `REQ-${alt[0]}-${alt[1]}`)
    if (pair.length !== 2 || pair[0].type !== pair[1].type) fail('alternative output types differ')
  }
  const legacy = array(seed.legacy).map(value => {
    const row = array(value), workItemId = text(row[0]), objectId = text(row[1]), targets = [...list(row[2]),...list(row[3])]
    if (!/^0[1-8]-0[1-9]$/.test(workItemId) || !/^[A-Z]{2}\d{2}$/.test(objectId)) fail('legacy identity')
    if (!targets.length || targets.some(t => !byId.has(t) && !/^M0[1-4]$/.test(t))) fail('legacy target missing')
    unique(targets,'legacy targets'); return {workItemId,objectId,targets}
  })
  unique(legacy.map(m => m.workItemId),'legacy item'); unique(legacy.map(m => m.objectId),'legacy object')
  if (legacy.length !== 57) fail('legacy coverage')
  // Exhaustive boolean projections are cheap (four flags) and catch invalid conditional cycles/dead sources.
  for (let mask=0;mask<16;mask++) {
    const flags = normalizeFlags(Object.fromEntries(CONDITION_FIELDS.map((f,i) => [f,!!(mask & (1 << i))])))
    const ids = modules.filter(m => evaluate(m.when,flags) === true).map(m => m.id)
    const activeEdges = edges.filter(e => ids.includes(e.target) && evaluate(e.requiredWhen,flags) === true)
    for (const target of ids) for (const source of parents.get(target)!) {
      if (activeEdges.filter(e => e.groupId === `REQ-${target}-${source}`).length !== 1) fail('conditional group has no unique route')
    }
    topologicalWaves(ids,activeEdges)
  }
  const core = {schemaVersion:'planning-index.v1' as const,specVersion:'planning-research.v1.2' as const,sourceSha256,chapters,modules,edges,legacy}
  return freeze({...core,hash:sha256CanonicalJson(core)})
}
let cached: PlanningCatalog | undefined
export function loadPlanningCatalog(): PlanningCatalog { return cached ??= compilePlanningIndex(PLANNING_INDEX_SEED) }
export function requireModule(catalog: PlanningCatalog, id: string): PlanningModule {
  const module = catalog.modules.find(m => m.id === id)
  if (!module) throw new Error(`MODULE_UNKNOWN: ${id}`)
  return module
}
