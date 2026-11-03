import { sha256CanonicalJson } from '../presentation/canonical-json.ts'
import { sha256Bytes } from './regional-od.ts'
import { safeBundlePath } from './regional-bundle.ts'
import { analyzePeers, preparePeerOd, PEER_METHOD, type PeerResult } from './peer-analysis.ts'
import { renderPeerMatrix, renderPeerPrices, renderPeerReport, peerTables } from './peer-render.ts'
import { readResearchAuditBundle, saveResearchAuditBundle, type ResearchSaveOptions } from './run-store.ts'
import { freeze } from './graph.ts'
const json=(x:unknown)=>JSON.stringify(x,null,2)+'\n'
export interface PeerAuditManifest {
  readonly schemaVersion:'peer-audit-bundle.v1';readonly projectId:string;readonly snapshotId:string;readonly methodVersion:string;
  readonly inputHash:string;readonly resultHash:string;readonly publicationGranted:false;readonly manifestHash:string;
  readonly artifacts:readonly {readonly artifactId:string;readonly state:'produced_limited'|'omitted';readonly paths:readonly string[];readonly reason:string}[];
  readonly files:readonly {readonly path:string;readonly sha256:string;readonly sizeBytes:number}[];
}
export interface PeerAuditBundle {readonly manifest:PeerAuditManifest;readonly files:Readonly<Record<string,string>>}
export function buildPeerAuditBundle(result:PeerResult):PeerAuditBundle {
  if(sha256CanonicalJson(analyzePeers(result.input))!==sha256CanonicalJson(result))throw new Error('PEER_RESULT_MISMATCH')
  const matrix=renderPeerMatrix(result),prices=renderPeerPrices(result),od=preparePeerOd(result),sourcePaths:Record<string,string>={}
  const files:Record<string,string>={'request.json':json(result.input),'result.json':json(result),...peerTables(result),
    'datasets/peers.json':json(result.rows),'FIG-3.04-01.svg':matrix}
  for(const s of result.input.captures){const path=`sources/source-${s.sha256}.txt`;files[path]=s.content;sourcePaths[s.sourceId]=path}
  const bindings=result.rows.flatMap(p=>Object.entries(p.cells).flatMap(([field,c])=>c.values.map(v=>({peerId:p.peerId,field,claimId:v.claimId,
    sourcePath:sourcePaths[v.evidence.sourceId],...v.evidence}))))
  files['analysis-trace.json']=json({methodVersion:PEER_METHOD,inputHash:result.inputHash,bindings,
    decisions:result.rows.map(p=>({peerId:p.peerId,role:p.role,selection:p.selection,selectionReason:p.selectionReason,claimClass:'decision'})),
    preservation:'exact captured bytes; no silent conversions; names never merge identities',
    limitations:result.limitations,regionalPreparationGaps:od.gaps})
  files['sources/index.json']=json(result.input.captures.map(s=>({...s,content:undefined,path:sourcePaths[s.sourceId]})))
  files['report.html']=renderPeerReport(result,matrix,prices,sourcePaths,od.gaps)
  if(prices)files['FIG-3.05-02.svg']=prices
  if(od.request)files['regional-od.request.json']=json(od.request)
  const artifacts=[
    {artifactId:'TAB-3.04',state:'produced_limited' as const,paths:['datasets/peer-registry.csv'],reason:'输入对象的纳入与证据台账；不是穷尽调查'},
    {artifactId:'TAB-3.05',state:'produced_limited' as const,paths:['datasets/peer-products.csv'],reason:'缺失与冲突保留'},
    {artifactId:'TAB-3.06',state:'produced_limited' as const,paths:['datasets/peer-operations.csv'],reason:'区分目标、观察及来源指标'},
    {artifactId:'FIG-3.04-01',state:'produced_limited' as const,paths:['FIG-3.04-01.svg'],reason:'资料覆盖矩阵，不是评级'},
    {artifactId:'FIG-3.05-02',state:prices?'produced_limited' as const:'omitted' as const,paths:prices?['FIG-3.05-02.svg']:[],reason:'仅匹配口径的来源营业价格'},
    {artifactId:'FIG-2.04-01',state:'omitted' as const,paths:[],reason:'本批仅整理有来源的空间输入；未取得许可底图，不伪造竞品分布图'},
  ]
  const core={schemaVersion:'peer-audit-bundle.v1' as const,projectId:result.projectId,snapshotId:result.snapshotId,methodVersion:PEER_METHOD,
    inputHash:result.inputHash,resultHash:sha256CanonicalJson(result),publicationGranted:false as const,artifacts,
    files:Object.entries(files).sort(([a],[b])=>a.localeCompare(b)).map(([path,content])=>({path,sha256:sha256Bytes(content),sizeBytes:Buffer.byteLength(content)}))}
  return freeze({manifest:{...core,manifestHash:sha256CanonicalJson(core)},files})
}
/** Both file bytes and deterministic re-analysis/re-rendering must agree; hashes alone are insufficient. */
export function replayPeerAuditBundle(bundle:PeerAuditBundle) {
  const {manifestHash,...core}=bundle.manifest
  if(core.schemaVersion!=='peer-audit-bundle.v1'||core.methodVersion!==PEER_METHOD||core.publicationGranted!==false||sha256CanonicalJson(core)!==manifestHash)throw new Error('PEER_MANIFEST_INVALID')
  if(core.files.length>200||new Set(core.files.map(f=>f.path)).size!==core.files.length||JSON.stringify(core.files.map(f=>f.path).sort())!==JSON.stringify(Object.keys(bundle.files).sort()))throw new Error('BUNDLE_FILE_SET_MISMATCH')
  for(const e of core.files){const content=bundle.files[e.path];if(!safeBundlePath(e.path)||typeof content!=='string'||sha256Bytes(content)!==e.sha256||Buffer.byteLength(content)!==e.sizeBytes)throw new Error('BUNDLE_FILE_HASH_MISMATCH')}
  const result=analyzePeers(JSON.parse(bundle.files['request.json'])),rebuilt=buildPeerAuditBundle(result)
  if(sha256CanonicalJson(rebuilt)!==sha256CanonicalJson(bundle))throw new Error('PEER_REPLAY_MISMATCH')
  return {valid:true,replayed:true,networkRequests:0,checkedPeers:result.rows.length,checkedFiles:core.files.length,publicationGranted:false}
}
export function savePeerAuditBundle(root:string,bundle:PeerAuditBundle,options:ResearchSaveOptions={}) {
  return saveResearchAuditBundle(root,bundle,replayPeerAuditBundle,options)
}
export function readPeerAuditBundle(root:string,runId:string):Promise<PeerAuditBundle> {
  return readResearchAuditBundle(root,runId,replayPeerAuditBundle)
}
