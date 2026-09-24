import { sha256CanonicalJson } from '../presentation/canonical-json.ts'
import { toWgs84 } from '../report/cartography/geometry.ts'
import { freeze } from './graph.ts'
import { REGIONAL_OD_METHOD, runRegionalOd, sha256Bytes, type RegionalOdResult } from './regional-od.ts'
import { regionalCsv, renderRegionalChartSvg, renderRegionalReport, renderRegionalRouteSvg } from './regional-render.ts'

export interface AuditArtifact {
  readonly artifactId: string
  readonly state: 'produced'|'produced_limited'|'omitted'
  readonly reason: string|null
  readonly dataset: string
  readonly claimRefs: readonly string[]
  readonly renditions: readonly {readonly path:string;readonly sha256:string}[]
}
export interface RegionalAuditManifest {
  readonly schemaVersion:'regional-audit-bundle.v1'; readonly projectId:string; readonly snapshotId:string
  readonly catalogHash:string; readonly inputSha256:string; readonly methodVersion:string
  readonly manifestHash:string; readonly publicationGranted:false
  readonly artifacts:readonly AuditArtifact[]
  readonly files:readonly {readonly path:string;readonly sha256:string;readonly sizeBytes:number}[]
}
export interface RegionalAuditBundle {
  readonly manifest:RegionalAuditManifest
  readonly files:Readonly<Record<string,string>>
}
const json=(value:unknown)=>JSON.stringify(value,null,2)+'\n'
export function safeBundlePath(path:string):boolean {
  return path.length<250 && /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*$/u.test(path)
    && !path.split('/').some(part=>part==='.'||part==='..')
}

export function buildRegionalAuditBundle(result:RegionalOdResult):RegionalAuditBundle {
  if (result.schemaVersion!=='regional-od-run.v1' || result.inputSha256!==sha256CanonicalJson(result.input)) throw new Error('RESULT_INPUT_MISMATCH')
  let route:string|null=null,routeIssue:string|null=null
  try {route=renderRegionalRouteSvg(result)} catch {routeIssue='MAP_EXTENT_UNSUPPORTED'}
  const chart=renderRegionalChartSvg(result)
  const files:Record<string,string>={
    'request.json':json(result.input), 'result.json':json(result),
    'datasets/regional-od.json':json(result.rows), 'datasets/regional-od.csv':regionalCsv(result),
    'datasets/regional-nodes.geojson':json({type:'FeatureCollection',features:result.input.nodes.map(node=>{
      const point=toWgs84(node.coordinate)
      return {type:'Feature',id:node.id,geometry:{type:'Point',coordinates:[point.longitude,point.latitude]},properties:node}
    })}),
    'claims.json':json(result.claims),
    'analysis-trace.json':json({schemaVersion:'regional-analysis-trace.v1',snapshotId:result.snapshotId,inputSha256:result.inputSha256,
      methodVersion:REGIONAL_OD_METHOD,sourceCapturePolicy:'exact UTF-8 captured JSON; recorded source class is never promoted',
      formulas:{straightMeters:'Haversine: R=6371008.8 m',roadMeters:'OSRM returned route distance (metres), not visual line length',durationSeconds:'OSRM returned static-network duration (seconds)'},
      controls:{snapTolerance:result.input.policy.snapTolerance??null,coordinateRoundingCheckMeters:1,directDistanceAnomalyRelativeAllowance:0.01},
      claimLinks:result.claims.map(c=>({claimId:c.claimId,dataset:'datasets/regional-od.json',rowId:c.rowId,field:c.metric,
        evidenceIds:c.evidenceIds,receiptIds:c.receiptIds})),
      csvSanitization:'Only exported string cells starting with formula triggers receive a leading apostrophe; originals remain in JSON.',
      nodeImportScope:'Typed import of supplied, source-bound region/entrance candidates. Not automated discovery or independent completion of all2.02 research.'}),
    'quality-report.json':json({schemaVersion:'regional-quality.v1',status:'limited',publicationGranted:false,
      automatedChecks:['request-schema','unique-identities','coordinate-source-selector','supported-crs','units','bounded-requests','route-snap','same-snapshot'],
      remainingChecks:['source-authenticity','entrance-and-access-field-review','independent-professional-review','licensed-basemap-and-cartographic-review'],
      rows:result.rows.map(r=>({id:r.id,issues:r.issues,limitations:r.limitations})),mapIssue:routeIssue}),
    'FIG-2.03-02.svg':chart,'report.html':renderRegionalReport(result,route,chart),
  }
  for(const source of result.input.captures)files[`sources/source-${sha256Bytes(source.content)}.json`]=source.content
  for(const receipt of result.receipts)files[`sources/response-${receipt.sha256}.json`]=receipt.body
  files['sources/index.json']=json({captures:result.input.captures.map(s=>({...s,content:undefined,path:`sources/source-${sha256Bytes(s.content)}.json`,sha256:sha256Bytes(s.content)})),
    responses:result.receipts.map(r=>({...r,body:undefined,path:`sources/response-${r.sha256}.json`})),attempts:result.attempts})
  if(route)files['FIG-2.03-01.svg']=route
  const refs=result.claims.map(c=>c.claimId)
  const artifact=(id:string,state:AuditArtifact['state'],paths:string[],reason:string|null):AuditArtifact=>({artifactId:id,state,reason,
    dataset:'datasets/regional-od.json',claimRefs:refs,renditions:paths.map(path=>({path,sha256:sha256Bytes(files[path])}))})
  const artifacts=[
    artifact('FIG-2.03-01',route?'produced_limited':'omitted',route?['FIG-2.03-01.svg']:[],route?'georeferenced route geometry only; no basemap':routeIssue??'no valid road route; no invented map'),
    artifact('FIG-2.03-02','produced',['FIG-2.03-02.svg'],null),
    artifact('TAB-2.03','produced',['datasets/regional-od.csv','datasets/regional-od.json'],null),
  ]
  const core={schemaVersion:'regional-audit-bundle.v1' as const,projectId:result.projectId,snapshotId:result.snapshotId,
    catalogHash:result.catalogHash,inputSha256:result.inputSha256,methodVersion:REGIONAL_OD_METHOD,publicationGranted:false as const,artifacts,
    files:Object.entries(files).sort(([a],[b])=>a.localeCompare(b)).map(([path,content])=>({path,sha256:sha256Bytes(content),sizeBytes:Buffer.byteLength(content,'utf8')}))}
  return freeze({manifest:{...core,manifestHash:sha256CanonicalJson(core)},files})
}

/** Byte checks establish integrity only; replay below additionally verifies computations. */
export function verifyRegionalAuditBundle(bundle:RegionalAuditBundle) {
  const {manifestHash,...core}=bundle.manifest
  if (core.schemaVersion!=='regional-audit-bundle.v1'||core.publicationGranted!==false||sha256CanonicalJson(core)!==manifestHash) throw new Error('BUNDLE_MANIFEST_INVALID')
  if (new Set(core.files.map(f=>f.path)).size!==core.files.length
    ||JSON.stringify(core.files.map(f=>f.path).sort())!==JSON.stringify(Object.keys(bundle.files).sort())) throw new Error('BUNDLE_FILE_SET_MISMATCH')
  for(const entry of core.files) {
    if(!safeBundlePath(entry.path))throw new Error('BUNDLE_PATH_INVALID')
    const text=bundle.files[entry.path]
    if(typeof text!=='string'||sha256Bytes(text)!==entry.sha256||Buffer.byteLength(text,'utf8')!==entry.sizeBytes) throw new Error('BUNDLE_FILE_HASH_MISMATCH')
  }
  const result=JSON.parse(bundle.files['result.json']) as RegionalOdResult
  if (result.publicationGranted!==false||result.status!=='limited'||result.catalogHash!==core.catalogHash||result.snapshotId!==core.snapshotId||result.projectId!==core.projectId||sha256CanonicalJson(result.input)!==core.inputSha256
    ||sha256CanonicalJson(JSON.parse(bundle.files['request.json']))!==core.inputSha256) throw new Error('BUNDLE_IDENTITY_MISMATCH')
  for(const artifact of core.artifacts)for(const file of artifact.renditions) {
    if(sha256Bytes(bundle.files[file.path])!==file.sha256)throw new Error('ARTIFACT_HASH_MISMATCH')
  }
  return {valid:true,checkedFiles:core.files.length,publicationGranted:false}
}

export async function replayRegionalAuditBundle(bundle:RegionalAuditBundle) {
  verifyRegionalAuditBundle(bundle)
  const original=JSON.parse(bundle.files['result.json']) as RegionalOdResult
  if (bundle.manifest.methodVersion!==REGIONAL_OD_METHOD)throw new Error('REPLAY_METHOD_UNSUPPORTED')
  let cursor=0
  const replay=await runRegionalOd(original.input,{now:()=>new Date(original.createdAt),allowNetwork:original.usage.networkAuthorized,
    fetch:async(url)=>{
      const attempt=original.attempts[cursor++]
      if(!attempt||attempt.url!==url)throw new Error('REPLAY_REQUEST_MISMATCH')
      if(attempt.errorCode)throw Object.assign(new Error(attempt.errorCode),{code:attempt.errorCode})
      const receipt=original.receipts.find(r=>r.id===attempt.receiptId)
      if(!receipt)throw new Error('REPLAY_RESPONSE_MISSING')
      const bytes=bundle.files[`sources/response-${receipt.sha256}.json`]
      if(bytes!==receipt.body)throw new Error('REPLAY_RESPONSE_MISMATCH')
      return new Response([204,205,304].includes(receipt.status)?null:bytes,{status:receipt.status,headers:{'content-type':receipt.mediaType}})
    }})
  if(cursor!==original.attempts.length||sha256CanonicalJson(replay.rows)!==sha256CanonicalJson(original.rows)
    ||sha256CanonicalJson(replay.claims)!==sha256CanonicalJson(original.claims)
    ||sha256CanonicalJson(original.rows)!==sha256CanonicalJson(JSON.parse(bundle.files['datasets/regional-od.json']))
    ||sha256CanonicalJson(original.claims)!==sha256CanonicalJson(JSON.parse(bundle.files['claims.json']))
    ||regionalCsv(replay)!==bundle.files['datasets/regional-od.csv'])throw new Error('REPLAY_RESULT_MISMATCH')
  const normalizedReplay: RegionalOdResult = {...replay,transportMode:original.transportMode,receipts:replay.receipts.map((receipt,index)=>({...receipt,retrievedAt:original.receipts[index].retrievedAt}))}
  if(sha256CanonicalJson(normalizedReplay)!==sha256CanonicalJson(original))throw new Error('REPLAY_RESULT_MISMATCH')
  // Re-render the same data to catch edited charts even when an attacker recomputes file hashes.
  const rebuilt=buildRegionalAuditBundle(normalizedReplay)
  for(const name of Object.keys(rebuilt.files)) {
    if(rebuilt.files[name]!==bundle.files[name])throw new Error('REPLAY_PRESENTATION_MISMATCH')
  }
  if(rebuilt.manifest.manifestHash!==bundle.manifest.manifestHash)throw new Error('REPLAY_MANIFEST_MISMATCH')
  return {valid:true,replayed:true,networkRequests:0,checkedRows:replay.rows.length,checkedClaims:replay.claims.length,publicationGranted:false}
}
