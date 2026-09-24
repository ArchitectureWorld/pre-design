import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { brotliDecompressSync } from 'node:zlib'
import { decodeResearchSpecification } from '../src/research-v2/specification.ts'
import { loadPlanningCatalog } from '../src/research-v2/catalog.ts'
import { projectResearchPlan } from '../src/research-v2/planning.ts'
import { sha256CanonicalJson } from '../src/presentation/canonical-json.ts'
const root=resolve(import.meta.dirname,'..'), lock=JSON.parse(readFileSync(resolve(root,'research/planning-v1.2/catalog-lock.json'),'utf8'))
const digest=createHash('sha256').update(readFileSync(resolve(root,lock.projection.path))).digest('hex'),c=loadPlanningCatalog()
if(digest!==lock.projection.sha256 || c.hash!==lock.projection.catalogSha256 || sha256CanonicalJson([...c.edges].sort((a,b)=>a.edgeId.localeCompare(b.edgeId)))!==lock.projection.edgeSha256
  || c.sourceSha256!==lock.source.sha256 || c.modules.length!==lock.projection.moduleCount || c.edges.length!==lock.projection.edgeCount
  || c.legacy.length!==lock.projection.legacyCount || c.modules.flatMap(m=>m.figures).length!==lock.projection.figureCount) throw new Error('RESEARCH_V210_LOCK_MISMATCH')
const scenarios=[]
for(let mask=0;mask<16;mask++){
  const p=projectResearchPlan(c,{industryPlanning:!!(mask&1),existingBuildings:!!(mask&2),externalPartners:!!(mask&4),marketing:!!(mask&8)})
  if(p.unresolved.length||p.blockedModuleIds.length||p.waves.flat().length!==p.activeModuleIds.length)throw new Error('RESEARCH_V210_PROJECTION_INVALID')
  scenarios.push({mask,active:p.activeModuleIds.length,edges:p.edges.length,waves:p.waves.length})
}
const packed=readFileSync(resolve(root,lock.source.packagedPath))
if(createHash('sha256').update(packed).digest('hex')!==lock.source.compressedSha256)throw new Error('SPEC_COMPRESSED_HASH_MISMATCH')
const spec=decodeResearchSpecification(brotliDecompressSync(packed,{maxOutputLength:2*1024*1024}))
console.log(JSON.stringify({fullSpecItems:spec.items.length,queryCount:spec.items.flatMap(i=>i.queries).length,stepCount:spec.items.flatMap(i=>i.steps).length}))
console.log('RESEARCH_V210_FOUNDATION_PASS')
console.log(JSON.stringify({catalogHash:c.hash,modules:c.modules.length,edges:c.edges.length,legacy:c.legacy.length,candidates:c.modules.flatMap(m=>m.figures).length,scenarios},null,2))
