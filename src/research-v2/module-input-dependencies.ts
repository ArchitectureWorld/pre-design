import {sha256CanonicalJson as hash} from '../presentation/canonical-json.ts'
import {loadPlanningCatalog} from './catalog.ts'
import type {MaterialCorpus} from '../materials/research-evidence.ts'
import type {ResearchFlags} from './types.ts'
import type {ModuleExecutionResult,ModuleInputReference} from './module-execution.ts'
interface Snapshot { readonly corpus:MaterialCorpus;readonly sourceValues:readonly unknown[];readonly flags:ResearchFlags;readonly taskBrief?:string }
interface Identity {readonly projectId:string;readonly snapshotId:string;readonly snapshotHash:string;readonly catalogHash:string;readonly specSha256:string;readonly planHash:string}
export interface ModuleReuseProof {readonly version:'module-input-reuse.v1';readonly projectId:string;readonly itemId:string;readonly bundleRunId:string;readonly resultHash:string;readonly fromSnapshotId:string;readonly fromSnapshotHash:string;readonly toSnapshotId:string;readonly toSnapshotHash:string;readonly inputFingerprint:string}
export function moduleInputFingerprint(itemId:string,snapshot:Snapshot,refs:readonly ModuleInputReference[],usedPaths:readonly string[]=[]):string {
  for(const doc of snapshot.corpus.documents)if(doc.provenance && (!doc.provenance.queryKeys.length || doc.provenance.queryKeys.some(key=>! /^[1-8]\.0[1-9]:[0-9]+$/u.test(key))))throw Error('MODULE_INPUT_COVERAGE_UNKNOWN')
  const documents=snapshot.corpus.documents.filter(doc=>!doc.provenance||usedPaths.includes(doc.path)||doc.provenance.queryKeys.some(key=>key.startsWith(itemId+':'))).toSorted((a,b)=>a.path.localeCompare(b.path))
  const queries=snapshot.corpus.acquisition?.queries.filter(query=>query.moduleId===itemId)??[]
  const limitations=snapshot.corpus.limitations.filter(value=>! /^[1-8]\.0[1-9]:[0-9]+:/u.test(value)||value.startsWith(itemId+':'))
  return hash({catalog:loadPlanningCatalog().hash,itemId,documents,queries,limitations,sourceValues:snapshot.sourceValues,taskBrief:snapshot.taskBrief??'',flags:snapshot.flags,
    refs:refs.map(({reuseProof:_proof,...ref})=>ref)})
}
export function createModuleReuseProof(result:ModuleExecutionResult,previous:Snapshot,target:Identity,current:Snapshot,bundleRunId:string,currentRefs:readonly ModuleInputReference[]=result.inputRefs):ModuleReuseProof {
  if(result.projectId!==target.projectId||result.catalogHash!==target.catalogHash||result.specSha256!==target.specSha256||result.planHash!==target.planHash)throw Error('MODULE_INPUT_IDENTITY_CHANGED')
  const paths=result.sourceValues.map(row=>row.path),fingerprint=moduleInputFingerprint(result.itemId,previous,result.inputRefs,paths)
  if(fingerprint!==moduleInputFingerprint(result.itemId,current,currentRefs,paths))throw Error('MODULE_INPUT_CHANGED')
  return {version:'module-input-reuse.v1',projectId:result.projectId,itemId:result.itemId,bundleRunId,resultHash:hash(result),fromSnapshotId:result.snapshotId,fromSnapshotHash:result.snapshotHash,toSnapshotId:target.snapshotId,toSnapshotHash:target.snapshotHash,inputFingerprint:fingerprint}
}
export function verifyModuleReuseProof(proof:ModuleReuseProof|undefined,result:ModuleExecutionResult,previous:Snapshot,target:Identity,current:Snapshot,bundleRunId:string,currentRefs:readonly ModuleInputReference[]=result.inputRefs){
  if(!proof||hash(proof)!==hash(createModuleReuseProof(result,previous,target,current,bundleRunId,currentRefs)))throw Error('MODULE_INPUT_REUSE_PROOF_INVALID')
}
