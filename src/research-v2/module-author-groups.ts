import { validateJsonSchemaValue, type JsonSchemaNode, type ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import type { MaterialCorpus } from '../materials/research-evidence.ts'
import {bindResourceLiteralSourceChoice} from './resource-literal-source-choice.ts'
import {bindNativeHandoffReferences} from './native-handoff-contract.ts'
import { sha256CanonicalJson } from '../presentation/canonical-json.ts'
import { getModuleFieldContracts } from './module-contracts.ts'
import { readJsonPointer } from './regional-schema.ts'
import { moduleGroupStepDiagnostics } from './module-group-step-diagnostics.ts'
import { moduleGroupPointerDiagnostics } from './module-group-pointer-diagnostics.ts'
import { moduleReferencePromptView } from './module-reference-context.ts'
import {moduleDecisionTextEvidenceProtocol} from './module-decision-text-evidence-protocol.ts'
import type { ClaimUpstream } from './module-claims.ts'
import { moduleUpstreamReferenceDiagnostics } from './module-upstream-reference-diagnostics.ts'
import { moduleClaimCycleConflicts } from './module-claim-cycle-diagnostics.ts'
import {nativeQuerySourceChoices} from './native-query-string-mapping.ts'
import { PHOTO_DECIMAL_GROUP_VERSION, NARROW_SPATIAL_GROUP_VERSION, decodePhotoDecimal, isPhotoDecimalTarget } from './photo-decimal-wire.ts'
import { compileModuleAuthorProjection, validateModuleProjectionFields, getModuleAuthorProjectionSchema, getModuleAuthorProjectionJsonSchema, parseModuleProjectionOutputsJson,
  hashModuleProjectionJsonText, MODULE_AUTHOR_PROJECTION_VERSION, moduleProjectionEvidenceKindDiagnostic, type ProjectionEvidence, type ModuleAuthorProjectionJson, type ModuleAuthorReceipt, type CompiledModuleCandidate } from './module-author-projection.ts'

export const MODULE_AUTHOR_GROUP_VERSION = NARROW_SPATIAL_GROUP_VERSION
export const MARKET_NARROW_GROUP_VERSION = 'module-author-field-group.v9' as const
export const MARKET_FORMULA_GROUP_VERSION = 'module-author-field-group.v10' as const
export const MARKET_FORMULA_RECORD_GROUP_VERSION = 'module-author-field-group.v11' as const
export const MARKET_POLICY_RECORD_GROUP_VERSION = 'module-author-field-group.v12' as const
export const MARKET_VALUES_RECORD_GROUP_VERSION = 'module-author-field-group.v13' as const
export const PEER_RECORD_GROUP_VERSION = 'module-author-field-group.v14' as const
export const PEER_LOCATION_RECORD_GROUP_VERSION = 'module-author-field-group.v15' as const
export const PEER_PRODUCT_RECORD_GROUP_VERSION = 'module-author-field-group.v16' as const
export const RESOURCE_NARROW_GROUP_VERSION = 'module-author-field-group.v17' as const
export const POLICY_NARROW_GROUP_VERSION = 'module-author-field-group.v18' as const
export const BOUNDARY_METADATA_GROUP_VERSION = 'module-author-field-group.v19' as const
export const ENVIRONMENT_VERIFICATION_GROUP_VERSION = 'module-author-field-group.v20' as const
export const RESOURCE_SOURCE_CATEGORY_GROUP_VERSION = 'module-author-field-group.v21' as const
const SPLIT_NATIVE_GROUP_VERSION = 'module-author-field-group.v6' as const
const LEGACY_NATIVE_GROUP_VERSION = 'module-author-field-group.v5' as const
const FIXED_JSON_GROUP_VERSION = 'module-author-field-group-json.v4' as const
const LEGACY_GROUP_VERSION = 'module-author-field-group-json.v3' as const
type GroupVersion = typeof RESOURCE_SOURCE_CATEGORY_GROUP_VERSION | typeof ENVIRONMENT_VERIFICATION_GROUP_VERSION | typeof BOUNDARY_METADATA_GROUP_VERSION | typeof POLICY_NARROW_GROUP_VERSION | typeof RESOURCE_NARROW_GROUP_VERSION | typeof PEER_PRODUCT_RECORD_GROUP_VERSION | typeof PEER_LOCATION_RECORD_GROUP_VERSION | typeof PEER_RECORD_GROUP_VERSION | typeof MARKET_VALUES_RECORD_GROUP_VERSION | typeof MARKET_POLICY_RECORD_GROUP_VERSION | typeof MARKET_FORMULA_RECORD_GROUP_VERSION | typeof MARKET_FORMULA_GROUP_VERSION | typeof MARKET_NARROW_GROUP_VERSION | typeof MODULE_AUTHOR_GROUP_VERSION | typeof PHOTO_DECIMAL_GROUP_VERSION | typeof SPLIT_NATIVE_GROUP_VERSION | typeof LEGACY_NATIVE_GROUP_VERSION | typeof FIXED_JSON_GROUP_VERSION | typeof LEGACY_GROUP_VERSION
const STEP_KEYS = ['step1', 'step2', 'step3', 'step4'] as const
type AuthorStep = ModuleAuthorProjectionJson['steps'][number]
const MAX_GROUP_FIELDS = 4
export interface ModuleAuthorFieldGroup { readonly groupId: string; readonly port: string; readonly fields: readonly string[]; readonly recordIds?: readonly string[] }
interface LegacyGroupSubmission extends Omit<ModuleAuthorProjectionJson, 'projectionVersion'> {
  readonly projectionVersion: typeof LEGACY_GROUP_VERSION; readonly groupId: string
  readonly outputs?: never
}
interface FixedStepGroupSubmission extends Omit<ModuleAuthorProjectionJson, 'projectionVersion' | 'steps'> {
  readonly projectionVersion: typeof FIXED_JSON_GROUP_VERSION; readonly groupId: string
  readonly outputs?: never
  readonly stepResults: Readonly<Record<typeof STEP_KEYS[number], Omit<AuthorStep, 'step'>>>
}
interface NativeGroupPayload extends Omit<FixedStepGroupSubmission, 'projectionVersion' | 'outputsJson' | 'outputs'> {
  readonly outputs: GroupOutputs
  readonly outputsJson?: never
}
type NativeGroupSubmission = NativeGroupPayload & ({ readonly projectionVersion: typeof MODULE_AUTHOR_GROUP_VERSION }
  | { readonly projectionVersion: typeof RESOURCE_SOURCE_CATEGORY_GROUP_VERSION }
  | { readonly projectionVersion: typeof ENVIRONMENT_VERIFICATION_GROUP_VERSION }
  | { readonly projectionVersion: typeof BOUNDARY_METADATA_GROUP_VERSION }
  | { readonly projectionVersion: typeof POLICY_NARROW_GROUP_VERSION }
  | { readonly projectionVersion: typeof RESOURCE_NARROW_GROUP_VERSION }
  | { readonly projectionVersion: typeof PEER_PRODUCT_RECORD_GROUP_VERSION }
  | { readonly projectionVersion: typeof PEER_LOCATION_RECORD_GROUP_VERSION }
  | { readonly projectionVersion: typeof PEER_RECORD_GROUP_VERSION }
  | { readonly projectionVersion: typeof MARKET_VALUES_RECORD_GROUP_VERSION }
  | { readonly projectionVersion: typeof MARKET_POLICY_RECORD_GROUP_VERSION }
  | { readonly projectionVersion: typeof MARKET_FORMULA_RECORD_GROUP_VERSION }
  | { readonly projectionVersion: typeof MARKET_FORMULA_GROUP_VERSION }
  | { readonly projectionVersion: typeof MARKET_NARROW_GROUP_VERSION }
  | { readonly projectionVersion: typeof PHOTO_DECIMAL_GROUP_VERSION }
  | { readonly projectionVersion: typeof SPLIT_NATIVE_GROUP_VERSION }
  | { readonly projectionVersion: typeof LEGACY_NATIVE_GROUP_VERSION })
export type ModuleAuthorGroupSubmission = LegacyGroupSubmission | FixedStepGroupSubmission | NativeGroupSubmission
export interface ModuleAuthorGroupReceipt {
  readonly raw: ModuleAuthorGroupSubmission; readonly receipt: ModuleAuthorReceipt
  readonly projectionHash: string; readonly outputsJsonHash: string; readonly receiptBindingHash: string
}
export interface ModuleAuthorGroupsAudit {
  /** The existing execution.kind names the grouped container; this version selects the actual author wire contract. */
  readonly version: GroupVersion; readonly planHash: string; readonly groups: readonly ModuleAuthorGroupReceipt[]
  readonly compiledCandidateHash: string; readonly bindingHash: string
}
interface GroupRecord { recordId: string; resultClass: string; [field: string]: unknown }
interface GroupPort { type: string; quality: 'accepted' | 'limited'; scope: string; asOf: string; limitations: string[]; records: GroupRecord[] }
type GroupOutputs = Record<string, GroupPort>
const fail = (code: string, detail = ''): never => { throw new Error(`${code}${detail ? ': ' + detail : ''}`) }
const same = (a: unknown, b: unknown) => sha256CanonicalJson(a) === sha256CanonicalJson(b)
const unique = (values: readonly string[]) => [...new Set(values)]
const addressKey = (a: { port: string; recordId: string; field: string; at: string }) => JSON.stringify([a.port, a.recordId, a.field, a.at])
const marketRecordVersion=(version:unknown)=>version===MARKET_FORMULA_RECORD_GROUP_VERSION||version===MARKET_POLICY_RECORD_GROUP_VERSION||version===MARKET_VALUES_RECORD_GROUP_VERSION
function policyLegacyPrefixLength(previous:readonly ModuleAuthorGroupSubmission[],plan:readonly ModuleAuthorFieldGroup[]):number {
  let length=0
  while(length<previous.length&&previous[length]?.projectionVersion===MODULE_AUTHOR_GROUP_VERSION&&previous[length]?.groupId===plan[length]?.groupId)length++
  return length
}
function moduleRecordParts(group:ModuleAuthorFieldGroup,previous:readonly ModuleAuthorGroupSubmission[]):ModuleAuthorFieldGroup[] {
  const records=previous[0]?.outputs?.[group.port]?.records
  if(!Array.isArray(records)||!records.length||records.some(record=>!record||typeof record.recordId!=='string'))return [group]
  return Array.from({length:Math.ceil(records.length/2)},(_,index)=>({...group,groupId:`${group.groupId}.${index+1}`,
    recordIds:records.slice(index*2,index*2+2).map(record=>record.recordId)}))
}

/** The version fixes this plan algorithm; complete field values are never split or synthesized. */
export function getModuleAuthorGroupVersion(itemId: string): GroupVersion { return itemId === '1.05' ? ENVIRONMENT_VERIFICATION_GROUP_VERSION : itemId === '1.02' ? BOUNDARY_METADATA_GROUP_VERSION : itemId === '1.03' ? POLICY_NARROW_GROUP_VERSION : itemId === '1.06' ? RESOURCE_SOURCE_CATEGORY_GROUP_VERSION : itemId === '3.05' ? PEER_PRODUCT_RECORD_GROUP_VERSION : itemId === '2.04' ? PEER_LOCATION_RECORD_GROUP_VERSION : itemId === '3.01' ? MARKET_FORMULA_GROUP_VERSION : MODULE_AUTHOR_GROUP_VERSION }
export function getModuleAuthorExecutionGroupVersion(itemId: string, previous: readonly ModuleAuthorGroupSubmission[] = []): GroupVersion {
  if(itemId==='1.05'){
    const oldPlan=getModuleAuthorFieldGroups(itemId,MODULE_AUTHOR_GROUP_VERSION)
    return previous.length===oldPlan.length&&isMarketCompatiblePrefix(itemId,previous,MODULE_AUTHOR_GROUP_VERSION)
      ?MODULE_AUTHOR_GROUP_VERSION:ENVIRONMENT_VERIFICATION_GROUP_VERSION
  }
  if(itemId==='1.02'){
    const oldPlan=getModuleAuthorFieldGroups(itemId,MODULE_AUTHOR_GROUP_VERSION)
    return previous.length===oldPlan.length&&isMarketCompatiblePrefix(itemId,previous,MODULE_AUTHOR_GROUP_VERSION)
      ?MODULE_AUTHOR_GROUP_VERSION:BOUNDARY_METADATA_GROUP_VERSION
  }
  if(itemId==='1.03'){
    const historical=getModuleAuthorFieldGroups(itemId,MODULE_AUTHOR_GROUP_VERSION)
    // Completed native authors proceed to their original independent review.
    // Partial receipts remain unchanged while only their remaining fields narrow.
    return previous.length===historical.length&&policyLegacyPrefixLength(previous,historical)===historical.length?MODULE_AUTHOR_GROUP_VERSION:POLICY_NARROW_GROUP_VERSION
  }
  if(itemId==='1.06')return previous.some(raw=>raw.projectionVersion===MODULE_AUTHOR_GROUP_VERSION)?MODULE_AUTHOR_GROUP_VERSION
    :previous.some(raw=>raw.projectionVersion===RESOURCE_NARROW_GROUP_VERSION)?RESOURCE_NARROW_GROUP_VERSION:RESOURCE_SOURCE_CATEGORY_GROUP_VERSION
  if(itemId==='2.04')return previous.some(raw=>raw.projectionVersion===MODULE_AUTHOR_GROUP_VERSION)?MODULE_AUTHOR_GROUP_VERSION:PEER_LOCATION_RECORD_GROUP_VERSION
  // Existing unsplit peers beyond the identity group retain their exact plan.
  if(itemId==='3.04')return previous.some(raw=>raw.projectionVersion===MODULE_AUTHOR_GROUP_VERSION&&raw.groupId!=='peer_supply:1')?MODULE_AUTHOR_GROUP_VERSION:PEER_RECORD_GROUP_VERSION
  if(itemId==='3.05')return previous.some(raw=>raw.projectionVersion===MODULE_AUTHOR_GROUP_VERSION&&raw.groupId!=='peer_products:1')?MODULE_AUTHOR_GROUP_VERSION:PEER_PRODUCT_RECORD_GROUP_VERSION
  if(itemId!=='3.01')return getModuleAuthorGroupVersion(itemId)
  // Already accepted unsplit numeric records retain their original field plan.
  return previous.some(raw=>raw.groupId==='market_context:2.1')?MARKET_POLICY_RECORD_GROUP_VERSION:MARKET_VALUES_RECORD_GROUP_VERSION
}
export function getModuleAuthorExecutionFieldGroups(itemId: string, previous: readonly ModuleAuthorGroupSubmission[] = []): ModuleAuthorFieldGroup[] {
  // A complete historical v10 author plan can resume its independent review;
  // never replay already completed records as new record-part authors.
  if(itemId==='3.01'){
    for(const version of [MARKET_POLICY_RECORD_GROUP_VERSION,MARKET_FORMULA_RECORD_GROUP_VERSION,MARKET_FORMULA_GROUP_VERSION]){
      const historical=getModuleAuthorFieldGroups(itemId,version,previous)
      if(previous.length===historical.length&&isMarketCompatiblePrefix(itemId,previous,version))return historical
    }
  }
  return getModuleAuthorFieldGroups(itemId, getModuleAuthorExecutionGroupVersion(itemId,previous), previous)
}
export function getModuleAuthorFieldGroups(itemId: string, version: GroupVersion = getModuleAuthorGroupVersion(itemId), previous: readonly ModuleAuthorGroupSubmission[] = []): ModuleAuthorFieldGroup[] {
  requireVersion(version)
  if(version===RESOURCE_SOURCE_CATEGORY_GROUP_VERSION&&itemId!=='1.06')fail('MODULE_GROUP_VERSION','resource source/category version applies only to1.06')
  if(version===ENVIRONMENT_VERIFICATION_GROUP_VERSION&&itemId!=='1.05')fail('MODULE_GROUP_VERSION','environment verification version applies only to1.05')
  if(version===BOUNDARY_METADATA_GROUP_VERSION&&itemId!=='1.02')fail('MODULE_GROUP_VERSION','boundary metadata version applies only to1.02')
  if(version===POLICY_NARROW_GROUP_VERSION&&itemId!=='1.03')fail('MODULE_GROUP_VERSION','policy narrow version applies only to1.03')
  if(version===RESOURCE_NARROW_GROUP_VERSION&&itemId!=='1.06')fail('MODULE_GROUP_VERSION','resource narrow version applies only to1.06')
  if(version===PEER_PRODUCT_RECORD_GROUP_VERSION&&itemId!=='3.05')fail('MODULE_GROUP_VERSION','peer product record version applies only to3.05')
  if(version===PEER_LOCATION_RECORD_GROUP_VERSION&&itemId!=='2.04')fail('MODULE_GROUP_VERSION','peer location record version applies only to2.04')
  if(version===PEER_RECORD_GROUP_VERSION&&itemId!=='3.04')fail('MODULE_GROUP_VERSION','peer record version applies only to3.04')
  if ((version === MARKET_NARROW_GROUP_VERSION || version === MARKET_FORMULA_GROUP_VERSION || marketRecordVersion(version)) && itemId !== '3.01') fail('MODULE_GROUP_VERSION', 'narrow market versions apply only to3.01')
  const plan = Object.entries(getModuleFieldContracts(itemId).ports).flatMap(([port, definition]) => {
    const fields = definition.fields.map(field => field.name), groups: ModuleAuthorFieldGroup[] = []
    for (let index = 0; index < fields.length; index += MAX_GROUP_FIELDS) groups.push({ groupId: `${port}:${index / MAX_GROUP_FIELDS + 1}`, port, fields: fields.slice(index, index + MAX_GROUP_FIELDS) })
    return groups
  })
  // Historical receipts retain their exact plan. Both v6 and v7 authors split
  // the observed oversized photo/conflicts group into complete fields.
  const policyPrefix=version===POLICY_NARROW_GROUP_VERSION?policyLegacyPrefixLength(previous,plan):0
  return plan.flatMap((group,groupIndex) => {
    if(version===ENVIRONMENT_VERIFICATION_GROUP_VERSION&&group.groupId==='environment:4')return [
      {...group,groupId:'environment:4.1',fields:group.fields.filter(field=>field!=='verificationTasks')},
      {...group,groupId:'environment:4.2',fields:['verificationTasks']},
    ]
    if(version===BOUNDARY_METADATA_GROUP_VERSION&&group.groupId==='boundaries:3')return [
      {...group,groupId:'boundaries:3.1',fields:group.fields.filter(field=>field!=='version')},
      {...group,groupId:'boundaries:3.2',fields:['version']},
    ]
    if(version===POLICY_NARROW_GROUP_VERSION&&group.groupId!=='planning_conditions:1'&&groupIndex>=policyPrefix)return [group.fields.slice(0,2),group.fields.slice(2)].filter(fields=>fields.length).map((fields,index)=>({...group,groupId:`${group.groupId}.${index+1}`,fields}))
    if(version===RESOURCE_SOURCE_CATEGORY_GROUP_VERSION&&group.groupId==='local_resources:1')return [
      {...group,groupId:'local_resources:1.1',fields:['resourceId','historicalSource','category']},
      {...group,groupId:'local_resources:1.2',fields:['location']},
    ]
    if(version===RESOURCE_NARROW_GROUP_VERSION||version===RESOURCE_SOURCE_CATEGORY_GROUP_VERSION)return [group.fields.slice(0,2),group.fields.slice(2)].filter(fields=>fields.length).map((fields,index)=>({...group,groupId:`${group.groupId}.${index+1}`,fields}))
    if(version===PEER_PRODUCT_RECORD_GROUP_VERSION){
      // Preserve an accepted historical four-field anchor exactly. Fresh authors
      // freeze only peer/product identity before record-specific observation.
      if(group.groupId==='peer_products:1'&&previous[0]?.projectionVersion===MODULE_AUTHOR_GROUP_VERSION&&previous[0]?.groupId===group.groupId)return [group]
      const fields=group.groupId==='peer_products:1'?[['peerId','productId'],['positioningQuote','formatId']]:[group.fields.slice(0,2),group.fields.slice(2)]
      return fields.filter(part=>part.length).flatMap((fields,index)=>{
        const part={...group,groupId:`${group.groupId}.${index+1}`,fields}
        return part.groupId==='peer_products:1.1'?[part]:moduleRecordParts(part,previous)
      })
    }
    if(version===PEER_LOCATION_RECORD_GROUP_VERSION)return [group.fields.slice(0,2),group.fields.slice(2)].filter(fields=>fields.length)
      .flatMap((fields,index)=>{const part={...group,groupId:`${group.groupId}.${index+1}`,fields};return part.groupId==='peer_locations:1.1'?[part]:moduleRecordParts(part,previous)})
    if(version===PEER_RECORD_GROUP_VERSION&&group.groupId!=='peer_supply:1')return [group.fields.slice(0,2),group.fields.slice(2)].filter(fields=>fields.length)
      .flatMap((fields,index)=>moduleRecordParts({...group,groupId:`${group.groupId}.${index+1}`,fields},previous))
    // Keep the already accepted four-field record anchor intact. Subsequent
    // oversized market groups split whole fields; historical v8 remains exact.
    if((version===MARKET_NARROW_GROUP_VERSION||version===MARKET_FORMULA_GROUP_VERSION||marketRecordVersion(version))&&group.groupId!=='market_context:1'){
      const width=Math.ceil(group.fields.length/2)
      return [group.fields.slice(0,width),group.fields.slice(width)].filter(fields=>fields.length).flatMap((fields,index)=>{
        const groupId=`${group.groupId}.${index+1}`
        return (version===MARKET_FORMULA_GROUP_VERSION||marketRecordVersion(version))&&groupId==='market_context:3.2'
          ?fields.flatMap((field,part)=>{
            const fieldGroup={...group,groupId:`${groupId}.${part+1}`,fields:[field]}
            return marketRecordVersion(version)&&field==='formula'?moduleRecordParts(fieldGroup,previous):[fieldGroup]
          })
          :((version===MARKET_POLICY_RECORD_GROUP_VERSION||version===MARKET_VALUES_RECORD_GROUP_VERSION)&&groupId==='market_context:4.2'
            ||version===MARKET_VALUES_RECORD_GROUP_VERSION&&groupId==='market_context:2.1')
            ?moduleRecordParts({...group,groupId,fields},previous):[{...group,groupId,fields}]
      })
    }
    if(version===MODULE_AUTHOR_GROUP_VERSION&&itemId==='1.07'&&group.groupId==='site_use:1')return [group.fields.slice(0,2),group.fields.slice(2)].map((fields,index)=>({...group,groupId:`${group.groupId}.${index+1}`,fields}))
    return (version === MODULE_AUTHOR_GROUP_VERSION || version===PHOTO_DECIMAL_GROUP_VERSION || version === SPLIT_NATIVE_GROUP_VERSION) && itemId === '1.07' && group.groupId === 'site_use:4'
      ? [group.fields.slice(0, 2), group.fields.slice(2, 3), group.fields.slice(3)].map((fields, index) => ({ ...group, groupId: `${group.groupId}.${index + 1}`, fields })) : [group]
  })
}
function requireGroup(itemId: string, groupId: string, version: GroupVersion = getModuleAuthorGroupVersion(itemId), previous: readonly ModuleAuthorGroupSubmission[] = []): ModuleAuthorFieldGroup {
  const group = getModuleAuthorFieldGroups(itemId, version, previous).find(group => group.groupId === groupId)
  return group ?? fail('MODULE_GROUP_ID', groupId)
}
function requireVersion(version: unknown): GroupVersion {
  if(version===RESOURCE_SOURCE_CATEGORY_GROUP_VERSION)return version
  if(version===ENVIRONMENT_VERIFICATION_GROUP_VERSION)return version
  if(version===BOUNDARY_METADATA_GROUP_VERSION)return version
  return version === POLICY_NARROW_GROUP_VERSION || version === RESOURCE_NARROW_GROUP_VERSION || version === PEER_PRODUCT_RECORD_GROUP_VERSION || version === PEER_LOCATION_RECORD_GROUP_VERSION || version === PEER_RECORD_GROUP_VERSION || version === MARKET_VALUES_RECORD_GROUP_VERSION || version === MARKET_POLICY_RECORD_GROUP_VERSION || version === MARKET_FORMULA_RECORD_GROUP_VERSION || version === MARKET_FORMULA_GROUP_VERSION || version === MARKET_NARROW_GROUP_VERSION || version === MODULE_AUTHOR_GROUP_VERSION || version===PHOTO_DECIMAL_GROUP_VERSION || version === SPLIT_NATIVE_GROUP_VERSION || version === LEGACY_NATIVE_GROUP_VERSION || version === FIXED_JSON_GROUP_VERSION || version === LEGACY_GROUP_VERSION ? version : fail('MODULE_GROUP_VERSION')
}
function nativeVersion(version: GroupVersion) { return version===RESOURCE_SOURCE_CATEGORY_GROUP_VERSION || version===ENVIRONMENT_VERIFICATION_GROUP_VERSION || version===BOUNDARY_METADATA_GROUP_VERSION || version===POLICY_NARROW_GROUP_VERSION || version===RESOURCE_NARROW_GROUP_VERSION || version===PEER_PRODUCT_RECORD_GROUP_VERSION || version===PEER_LOCATION_RECORD_GROUP_VERSION || version===PEER_RECORD_GROUP_VERSION || marketRecordVersion(version) || version === MARKET_FORMULA_GROUP_VERSION || version === MARKET_NARROW_GROUP_VERSION || version === MODULE_AUTHOR_GROUP_VERSION || version===PHOTO_DECIMAL_GROUP_VERSION || version === SPLIT_NATIVE_GROUP_VERSION || version === LEGACY_NATIVE_GROUP_VERSION }
/** New v8 authors require the exact current field plan. Historical v6/v7
 * mixed receipts remain replayable separately and are never relabelled. */
export function isCurrentModuleAuthorPrefix(itemId: string, raws: readonly ModuleAuthorGroupSubmission[]): boolean {
  if(itemId==='1.05')return isMarketCompatiblePrefix(itemId,raws,ENVIRONMENT_VERIFICATION_GROUP_VERSION)||isMarketCompatiblePrefix(itemId,raws,MODULE_AUTHOR_GROUP_VERSION)
  if(itemId==='1.02')return isMarketCompatiblePrefix(itemId,raws,BOUNDARY_METADATA_GROUP_VERSION)||isMarketCompatiblePrefix(itemId,raws,MODULE_AUTHOR_GROUP_VERSION)
  return itemId==='1.03'&&(isMarketCompatiblePrefix(itemId,raws,POLICY_NARROW_GROUP_VERSION)||isMarketCompatiblePrefix(itemId,raws,MODULE_AUTHOR_GROUP_VERSION))
    ||itemId==='1.06'&&(isMarketCompatiblePrefix(itemId,raws,RESOURCE_NARROW_GROUP_VERSION)||isMarketCompatiblePrefix(itemId,raws,MODULE_AUTHOR_GROUP_VERSION))
    ||itemId==='2.04'&&(isMarketCompatiblePrefix(itemId,raws,PEER_LOCATION_RECORD_GROUP_VERSION)||isMarketCompatiblePrefix(itemId,raws,MODULE_AUTHOR_GROUP_VERSION))
    ||itemId==='3.04'&&(isMarketCompatiblePrefix(itemId,raws,PEER_RECORD_GROUP_VERSION)||isMarketCompatiblePrefix(itemId,raws,MODULE_AUTHOR_GROUP_VERSION))
    ||itemId==='3.05'&&(isMarketCompatiblePrefix(itemId,raws,PEER_PRODUCT_RECORD_GROUP_VERSION)||isMarketCompatiblePrefix(itemId,raws,MODULE_AUTHOR_GROUP_VERSION))
    ||itemId==='3.01'&&(isMarketCompatiblePrefix(itemId,raws,MARKET_VALUES_RECORD_GROUP_VERSION)||isMarketCompatiblePrefix(itemId,raws,MARKET_POLICY_RECORD_GROUP_VERSION)||isMarketCompatiblePrefix(itemId,raws,MARKET_FORMULA_RECORD_GROUP_VERSION))
    || isMarketCompatiblePrefix(itemId,raws,getModuleAuthorGroupVersion(itemId))
}
function isMarketCompatiblePrefix(itemId:string,raws:readonly ModuleAuthorGroupSubmission[],version:GroupVersion):boolean {
  const policyPrefix=itemId==='1.03'&&version===POLICY_NARROW_GROUP_VERSION?policyLegacyPrefixLength(raws,getModuleAuthorFieldGroups(itemId,MODULE_AUTHOR_GROUP_VERSION)):0
  if(raws.some((raw,index)=>raw?.projectionVersion!==version
    &&!(itemId==='1.05'&&version===ENVIRONMENT_VERIFICATION_GROUP_VERSION&&index<3&&raw?.projectionVersion===MODULE_AUTHOR_GROUP_VERSION)
    &&!(itemId==='1.02'&&version===BOUNDARY_METADATA_GROUP_VERSION&&index<2&&raw?.projectionVersion===MODULE_AUTHOR_GROUP_VERSION)
    &&!(itemId==='1.03'&&version===POLICY_NARROW_GROUP_VERSION&&index<policyPrefix&&raw?.projectionVersion===MODULE_AUTHOR_GROUP_VERSION)
    &&!(itemId==='3.04'&&version===PEER_RECORD_GROUP_VERSION&&index===0&&raw?.projectionVersion===MODULE_AUTHOR_GROUP_VERSION)
    &&!(itemId==='3.05'&&version===PEER_PRODUCT_RECORD_GROUP_VERSION&&index===0&&raw?.projectionVersion===MODULE_AUTHOR_GROUP_VERSION&&raw?.groupId==='peer_products:1')
    &&!(itemId==='3.01'&&index===0&&raw?.projectionVersion===MODULE_AUTHOR_GROUP_VERSION)
    &&!(itemId==='3.01'&&(version===MARKET_FORMULA_GROUP_VERSION||marketRecordVersion(version))&&index<4&&raw?.projectionVersion===MARKET_NARROW_GROUP_VERSION)
    &&!(itemId==='3.01'&&marketRecordVersion(version)&&raw?.projectionVersion===MARKET_FORMULA_GROUP_VERSION)
    &&!(itemId==='3.01'&&version===MARKET_VALUES_RECORD_GROUP_VERSION&&index===0&&(raw?.projectionVersion===MARKET_POLICY_RECORD_GROUP_VERSION||raw?.projectionVersion===MARKET_FORMULA_RECORD_GROUP_VERSION))
    &&!(itemId==='3.01'&&version===MARKET_POLICY_RECORD_GROUP_VERSION&&raw?.projectionVersion===MARKET_FORMULA_RECORD_GROUP_VERSION&&!raw.groupId.startsWith('market_context:4.2'))))return false
  const plan=getModuleAuthorFieldGroups(itemId,version,raws)
  return raws.every((raw,index)=>raw.groupId===plan[index]?.groupId)
}
/** Historical mixed v6/v7 receipts retain their original unsplit spatial plan.
 * This is audit replay compatibility only, never a prefix for new v8 authors. */
function isLegacyPhotoPrefix(itemId:string,raws:readonly ModuleAuthorGroupSubmission[]):boolean {
  if (!raws.length) return true
  if (raws.some(raw => raw?.projectionVersion !== PHOTO_DECIMAL_GROUP_VERSION
    && (itemId !== '1.07' || raw?.projectionVersion !== SPLIT_NATIVE_GROUP_VERSION))) return false
  const plan = getModuleAuthorFieldGroups(itemId,PHOTO_DECIMAL_GROUP_VERSION)
  let currentSeen = false
  return raws.every((raw, index) => {
    if (raw?.groupId !== plan[index]?.groupId) return false
    if (raw.projectionVersion === PHOTO_DECIMAL_GROUP_VERSION) { currentSeen = true; return true }
    return !currentSeen && itemId === '1.07' && index < 3 && raw.projectionVersion === SPLIT_NATIVE_GROUP_VERSION
  })
}
function sequenceVersion(itemId: string, raws: readonly ModuleAuthorGroupSubmission[]): GroupVersion {
  if (!raws.length) return getModuleAuthorGroupVersion(itemId)
  if(itemId==='1.05'&&raws.some(raw=>raw.projectionVersion===ENVIRONMENT_VERIFICATION_GROUP_VERSION)&&isMarketCompatiblePrefix(itemId,raws,ENVIRONMENT_VERIFICATION_GROUP_VERSION))return ENVIRONMENT_VERIFICATION_GROUP_VERSION
  if(itemId==='1.02'&&raws.some(raw=>raw.projectionVersion===BOUNDARY_METADATA_GROUP_VERSION)&&isMarketCompatiblePrefix(itemId,raws,BOUNDARY_METADATA_GROUP_VERSION))return BOUNDARY_METADATA_GROUP_VERSION
  if(itemId==='1.03'&&raws.some(raw=>raw.projectionVersion===POLICY_NARROW_GROUP_VERSION)&&isMarketCompatiblePrefix(itemId,raws,POLICY_NARROW_GROUP_VERSION))return POLICY_NARROW_GROUP_VERSION
  if(itemId==='3.05'&&raws.some(raw=>raw.projectionVersion===PEER_PRODUCT_RECORD_GROUP_VERSION)&&isMarketCompatiblePrefix(itemId,raws,PEER_PRODUCT_RECORD_GROUP_VERSION))return PEER_PRODUCT_RECORD_GROUP_VERSION
  if(itemId==='3.04'&&raws.some(raw=>raw.projectionVersion===PEER_RECORD_GROUP_VERSION)&&isMarketCompatiblePrefix(itemId,raws,PEER_RECORD_GROUP_VERSION))return PEER_RECORD_GROUP_VERSION
  if(itemId==='3.01'&&raws.some(raw=>raw.projectionVersion===MARKET_VALUES_RECORD_GROUP_VERSION)&&isMarketCompatiblePrefix(itemId,raws,MARKET_VALUES_RECORD_GROUP_VERSION))return MARKET_VALUES_RECORD_GROUP_VERSION
  if(itemId==='3.01'&&raws.some(raw=>raw.projectionVersion===MARKET_POLICY_RECORD_GROUP_VERSION)&&isMarketCompatiblePrefix(itemId,raws,MARKET_POLICY_RECORD_GROUP_VERSION))return MARKET_POLICY_RECORD_GROUP_VERSION
  if(itemId==='3.01'&&raws.some(raw=>raw.projectionVersion===MARKET_FORMULA_RECORD_GROUP_VERSION)&&isMarketCompatiblePrefix(itemId,raws,MARKET_FORMULA_RECORD_GROUP_VERSION))return MARKET_FORMULA_RECORD_GROUP_VERSION
  const version = requireVersion(raws[0].projectionVersion)
  if (raws.every(raw => requireVersion(raw?.projectionVersion) === version)) return version
  if (itemId==='3.01'&&isMarketCompatiblePrefix(itemId,raws,MARKET_FORMULA_GROUP_VERSION)) return MARKET_FORMULA_GROUP_VERSION
  if (itemId==='3.01'&&isMarketCompatiblePrefix(itemId,raws,MARKET_NARROW_GROUP_VERSION)) return MARKET_NARROW_GROUP_VERSION
  if (isLegacyPhotoPrefix(itemId, raws)) return PHOTO_DECIMAL_GROUP_VERSION
  return fail('MODULE_GROUP_VERSION_MIXED')
}
export function getModuleAuthorGroupSchema(itemId: string, groupId: string, previous: readonly ModuleAuthorGroupSubmission[] = [], version: GroupVersion = getModuleAuthorGroupVersion(itemId), corpus?: MaterialCorpus,rejected?:ModuleAuthorGroupSubmission,upstream:readonly ClaimUpstream[]=[]): ObjectJsonSchema {
  // Newly started authors receive native bounded objects. Historical text wires remain replay-only.
  const schema = structuredClone(groupSchema(itemId, groupId, version, previous))
  schema.properties!.outputs = getModuleAuthorGroupOutputsSchema(itemId, groupId, previous, version)
  if((itemId==='3.04'||itemId==='3.05'||itemId==='3.01'&&groupId==='market_context:1')&&nativeVersion(version)){
    const group=requireGroup(itemId,groupId,version,previous)
    const recordIds=schema.properties!.outputs.properties![group.port].properties!.records.items!.properties!.recordId.enum
    const address=(node:JsonSchemaNode):JsonSchemaNode=>({...node,properties:{...node.properties,
      port:{...node.properties!.port,const:group.port,description:'本组分配的输出端口；不能填记录ID或来源路径。'},
      recordId:{...node.properties!.recordId,...(recordIds?{enum:[...recordIds]}:{}),description:'本组实际记录的冻结recordId；逐字保留原身份，不能填端口名或近似名称。'},
      field:{...node.properties!.field,enum:[...group.fields],description:'本组分配的专业字段名；不能引用其他组的字段。'},
      at:{...node.properties!.at,description:'从字段value内部起算的精确叶地址；标量为空字符串、数组逐叶如/0。步骤fieldRefs须与本组实际提交的evidence.target完全一致；missing字段不能引用。'}},
      description:[node.description,'本组证据与步骤仅引用本组实际登记的字段地址；recordId由作者据实建立，不能使用占位引用。'].filter(Boolean).join('\n')})
    // Replace address nodes rather than shared properties: inputRefs.local may
    // legitimately depend on fields outside this group. Central replay stays exact.
    const evidence=schema.properties!.evidence.items!
    evidence.properties!.target=address(evidence.properties!.target)
    for(const step of new Set(Object.values(schema.properties!.stepResults.properties!))){
      const refs=step.properties!.fieldRefs
      step.properties!.fieldRefs={...refs,items:address(refs.items!)}
    }
  }
  if(itemId==='3.01'&&groupId==='market_context:3.1'&&nativeVersion(version)&&corpus?.documents.length){
    const paths=corpus.documents.map(document=>document.path)
    // Bound only new native submissions to their frozen corpus. This includes
    // source operands and weights; historical replay still uses groupSchema.
    const bindPaths=(node:JsonSchemaNode)=>{
      if(node.properties?.path&&node.properties.quote)
        node.properties.path={...node.properties.path,enum:[...paths]}
      for(const child of Object.values(node.properties??{}))bindPaths(child)
      if(node.items)bindPaths(node.items)
      for(const branch of node.oneOf??[])bindPaths(branch)
    }
    bindPaths(schema.properties!.evidence)
  }
  if(itemId==='3.04'&&nativeVersion(version)&&corpus){
    const source=schema.properties!.evidence.items!.properties!.source
    const {queryMapping:_mapping,...ordinary}=source.properties!
    // Constrain only new explicit query declarations. Ordinary source excerpts
    // remain available and historical groupSchema replay keeps its original rules.
    const choices:JsonSchemaNode[]=[{type:'object',additionalProperties:false,properties:ordinary,required:[...source.required!]},
      ...nativeQuerySourceChoices(corpus.documents).map(choice=>({type:'object' as const,additionalProperties:false,
        required:['path','quote','valueQuote','queryMapping'],properties:{
          path:{type:'string' as const,const:choice.path},quote:{type:'string' as const,const:choice.quote},
          valueQuote:{type:'string' as const,const:choice.valueQuote},queryMapping:{type:'object' as const,additionalProperties:false,
            required:['kind','callId','queryIndex'],properties:{kind:{type:'string' as const,const:choice.queryMapping.kind},
              callId:{type:'string' as const,const:choice.queryMapping.callId},queryIndex:{type:'integer' as const,const:choice.queryMapping.queryIndex}}},
        }}))]
    schema.properties!.evidence.items!.properties!.source={...(choices.length===1?choices[0]:{oneOf:choices}),
      description:[source.description,'显式queryMapping须由你选择同一冻结call/query的完整原文source分支，逐字提交path、quote、valueQuote及声明；不能缩写哈希、截断call或混用索引。分支只证明原生查询记录，不填专业字段value，也不证明业务事实或覆盖充分性；普通来源不声明queryMapping，中央仍核对实际字段值及完整来源。'].filter(Boolean).join('\n')}
  }
  const withSourceChoices=itemId==='1.06'&&corpus&&rejected?bindResourceLiteralSourceChoice(schema,corpus,rejected):schema
  return nativeVersion(version)?bindNativeHandoffReferences(withSourceChoices,previous,upstream):withSourceChoices
}
function groupSchema(itemId: string, groupId: string, version: GroupVersion, previous: readonly ModuleAuthorGroupSubmission[] = [],freezeAnchors=true): ObjectJsonSchema {
  requireGroup(itemId, groupId, version, previous)
  const schema = getModuleAuthorProjectionJsonSchema(itemId)
  const { steps, ...properties } = schema.properties!
  const { step: _step, ...stepProperties } = steps.items!.properties!
  const entry = { ...steps.items!, properties: stepProperties, required: steps.items!.required!.filter(name => name !== 'step') }
  const transport: Record<string, JsonSchemaNode> = version === LEGACY_GROUP_VERSION ? { steps } : { stepResults: {
    type: 'object' as const, additionalProperties: false, required: [...STEP_KEYS],
    properties: Object.fromEntries(STEP_KEYS.map(key => [key, entry])),
    description: '四个固定键分别对应专业步骤1至4；每步status/summary/fieldRefs/limitations均由作者提供。必须是原生对象，不是JSON字符串或数组；不得省略未完成步骤，未完成用limited并解释。',
  } }
  const outputTransport = nativeVersion(version)
    ? Object.fromEntries(Object.entries({ ...properties, outputs: getModuleAuthorGroupOutputsSchema(itemId, groupId, previous, version,freezeAnchors) }).filter(([key]) => key !== 'outputsJson'))
    : properties
  return { ...schema, properties: { ...outputTransport, ...transport, projectionVersion: { type: 'string', const: version }, groupId: { type: 'string', const: groupId } },
    required: [...schema.required!.filter(name => name !== 'steps').map(name => nativeVersion(version) && name === 'outputsJson' ? 'outputs' : name), version === LEGACY_GROUP_VERSION ? 'steps' : 'stepResults', 'groupId'] }
}
/** Called only after version-specific schema validation; no author content is filled, parsed, or repaired. */
function authorSteps(raw: ModuleAuthorGroupSubmission): readonly AuthorStep[] {
  return raw.projectionVersion === LEGACY_GROUP_VERSION ? raw.steps
    : STEP_KEYS.map((key, index) => ({ step: index + 1, ...raw.stepResults[key] }))
}
export function getModuleAuthorGroupOutputsSchema(itemId: string, groupId: string, previous: readonly ModuleAuthorGroupSubmission[] = [], version: GroupVersion = getModuleAuthorGroupVersion(itemId),freezeAnchors=true): ObjectJsonSchema {
  const group = requireGroup(itemId, groupId, version, previous), original = getModuleAuthorProjectionSchema(itemId).properties!.outputs
  const port = structuredClone(original.properties![group.port]), row = port.properties!.records.items!
  row.properties = Object.fromEntries(['recordId', 'resultClass', ...group.fields].map(name => [name, row.properties![name]]))
  row.required = Object.keys(row.properties)
  // The native schema subset cannot enforce minItems. Expose the unchanged
  // central requirement without filling identities or unknown factual fields.
  port.properties!.records.description = 'records数组必须非空（至少1条记录），recordId唯一。记录身份只用于研究对象映射，不能冒充已核入口、有效OD或事实证据；由原生作者据实际输入建立并解释，宿主不代建记录。真实缺失的入口、坐标、路网、数值仍保留missing/null及具体限制，不得为满足记录数编造值；limited不代表研究合格。'
  if ((version === MODULE_AUTHOR_GROUP_VERSION||version===PHOTO_DECIMAL_GROUP_VERSION) && itemId === '1.07' && groupId === 'site_use:4.1') {
    const coordinate = row.properties.photoLocation.properties!.value.oneOf!.find(branch => branch.type === 'object')!
    for (const axis of ['x', 'y']) coordinate.properties![axis] = { type: 'string',
      description: '完整有限十进制文本，逐字保留原始坐标数字；不能使用JSON number、四舍五入或空白。来源证据valueQuote必须与此文本逐字相同。中央按显式v7协议转换并严格核对原文。' }
    const direction = row.properties.photoDirection
    const populatedValue = direction.properties!.value.oneOf!.find(branch => branch.type !== 'null')!
    row.properties.photoDirection = { oneOf: [
      { ...direction, properties: { ...direction.properties, value: { type: 'null' }, claimClass: { type: 'string', const: 'missing' } } },
      { ...direction, properties: { ...direction.properties, value: populatedValue,
        claimClass: { type: 'string', enum: direction.properties!.claimClass.enum!.filter(value => value !== 'missing') } } },
    ], description: '缺失方向必须value为JSON null且claimClass=missing；字符串"null"不是null。有支持的方向文本须对应非missing类别及独立证据。禁止改标类别来绕过缺失。' }
  }
  const first = freezeAnchors?previous.find(raw => requireGroup(itemId, raw.groupId, requireVersion(raw.projectionVersion), previous).port === group.port):undefined
  if (first) {
    // Expose already frozen anchors in the native tool contract. They remain
    // authored values; the host neither fills fields nor changes raw receipts.
    const frozen = structuredClone(first.outputs?.[group.port] ?? parseModuleProjectionOutputsJson(first.outputsJson!)[group.port]) as GroupPort
    for (const key of ['type', 'scope', 'asOf'] as const) port.properties![key] = { ...port.properties![key], const: frozen[key] }
    const records = port.properties!.records
    // The DSH native schema subset has no minItems/maxItems. Describe the
    // exact count here; the existing merge validation enforces it unchanged.
    const assigned=frozen.records.filter(record=>!group.recordIds||group.recordIds.includes(record.recordId))
    records.description = group.recordIds?`必须恰有${assigned.length}条记录，每个本分片冻结recordId恰好出现一次；不得增加、删除或合并记录。`
      :`必须恰有${frozen.records.length}条记录，每个冻结recordId恰好出现一次；不得增加、删除或合并记录。`
    row.properties.recordId = { ...row.properties.recordId, enum: assigned.map(record => record.recordId) }
    row.properties.resultClass = { ...row.properties.resultClass, enum: unique(assigned.map(record => record.resultClass)) }
    // Per-record class matching and unique identities still use mergeOutputs;
    // repeating every field schema per record would inflate the model context.
  }
  return { type: 'object', additionalProperties: false, required: [group.port], properties: { [group.port]: port } }
}
/** Readonly diagnostics from a rejected payload; never a replacement submission. */
export function moduleEvidenceKindConflicts(raw: unknown) {
  const evidence = (raw as { evidence?: unknown } | undefined)?.evidence
  if (!Array.isArray(evidence)) return []
  return evidence.flatMap((entry, evidenceIndex) => {
    if (!entry || typeof entry !== 'object' || !entry.target || typeof entry.kind !== 'string'
      || !['port','recordId','field','at'].every(key => typeof entry.target[key] === 'string')) return []
    const diagnostic = moduleProjectionEvidenceKindDiagnostic(entry as ProjectionEvidence)
    return diagnostic ? [{ evidenceIndex, target: structuredClone(entry.target) as ProjectionEvidence['target'], kind: entry.kind as string,
      memberPresence: { source: entry.source !== undefined, calculation: entry.calculation !== undefined }, diagnostic }] : []
  })
}
/** Readonly diagnostics from a rejected payload; never a replacement submission. */
export function moduleMissingFieldEvidenceTargets(raw: unknown) {
  try {
    const value = raw as ModuleAuthorGroupSubmission
    const outputs = value.outputs ?? JSON.parse(value.outputsJson!) as GroupOutputs
    return value.evidence.flatMap((entry, evidenceIndex) => {
      const address = entry.target, record = outputs[address.port]?.records.find(row => row.recordId === address.recordId)
      const field = record?.[address.field] as { readonly claimClass?: string } | undefined
      return field?.claimClass === 'missing' ? [{ evidenceIndex, target: structuredClone(address), field: structuredClone(field) }] : []
    })
  } catch { return [] }
}
function decode(itemId: string, raw: ModuleAuthorGroupSubmission, previous: readonly ModuleAuthorGroupSubmission[] = []): { group: ModuleAuthorFieldGroup; outputs: GroupOutputs } {
  const version = requireVersion(raw?.projectionVersion), group = requireGroup(itemId, raw?.groupId, version, previous)
  const errors = validateJsonSchemaValue(groupSchema(itemId, group.groupId, version, previous,false), raw)
  if (errors.length) fail('MODULE_GROUP_SCHEMA', errors.join('; '))
  let outputs: GroupOutputs
  try { outputs = nativeVersion(raw.projectionVersion) ? structuredClone(raw.outputs!)
    : parseModuleProjectionOutputsJson(raw.outputsJson!) as unknown as GroupOutputs }
  catch (error) { return fail('MODULE_GROUP_JSON', error instanceof Error ? error.message : String(error)) }
  const outputErrors = validateJsonSchemaValue(getModuleAuthorGroupOutputsSchema(itemId, group.groupId, previous, version,false), outputs)
  if (outputErrors.length) fail('MODULE_GROUP_OUTPUT_SCHEMA', outputErrors.join('; '))
  if ((version === MODULE_AUTHOR_GROUP_VERSION||version===PHOTO_DECIMAL_GROUP_VERSION) && itemId === '1.07' && group.groupId === 'site_use:4.1') {
    for (const row of outputs[group.port].records) {
      const field = row.photoLocation as { value: Record<string, unknown> | null }
      if (field.value === null) continue
      for (const axis of ['x', 'y']) field.value[axis] = decodePhotoDecimal(field.value[axis])
    }
    for (const entry of raw.evidence) {
      if (entry.kind !== 'source' || !isPhotoDecimalTarget(raw, entry.target)) continue
      const row = raw.outputs!.site_use.records.find(row => row.recordId === entry.target.recordId)
      const value = (row?.photoLocation as { value?: Record<string, unknown> } | undefined)?.value
      if (value && entry.source!.valueQuote !== value[entry.target.at.slice(1)]) fail('MODULE_SOURCE_VALUE_NUMBER', 'v7 coordinate wire text must exactly equal its source valueQuote')
    }
  }
  if (!['accepted', 'limited'].includes(outputs[group.port].quality)) fail('MODULE_GROUP_QUALITY', group.groupId)
  const records = outputs[group.port].records
  const recordIds = records.map(r => r.recordId), distinctIds = new Set(recordIds)
  if (!records.length || distinctIds.size !== records.length) {
    const duplicates = [...new Set(recordIds.filter((id, index) => recordIds.indexOf(id) !== index))]
    fail('MODULE_GROUP_RECORDS', `${group.groupId}; recordDiagnostic=${JSON.stringify({port: group.port,
      recordCount: records.length, distinctRecordCount: distinctIds.size, duplicateRecordIds: duplicates.slice(0, 8),
      ...(duplicates.length > 8 ? {omittedDuplicateIdentities: duplicates.length - 8} : {}), originalSubmissionHash: sha256CanonicalJson(raw)})}; records must contain at least one authored record with unique recordId; study identities are not verified endpoints or valid OD; preserve genuinely missing fields as missing/null and limited, never invent values or host-fill records`)
  }
  const evidenceAddresses = new Set<string>()
  for (const evidence of raw.evidence) {
    const address = evidence.target, record = records.find(r => r.recordId === address.recordId)
    if (address.port !== group.port || !group.fields.includes(address.field) || !record) fail('MODULE_GROUP_EVIDENCE_OWNER', group.groupId)
    if (evidenceAddresses.has(addressKey(address))) fail('MODULE_GROUP_EVIDENCE_DUPLICATE', `target=${JSON.stringify(address)}`)
    evidenceAddresses.add(addressKey(address))
    const field = record![address.field] as { value: unknown; claimClass: string }
    if (field.claimClass === 'missing') fail('MODULE_GROUP_MISSING_EVIDENCE',
      `targets=${JSON.stringify(moduleMissingFieldEvidenceTargets(raw).map(row => row.target))}; fields marked missing/null must not carry evidence; remove only the attached evidence, preserve missing/null and limitations; never invent values or reclassify to pass`)
    if (address.at !== '' && (!address.at.startsWith('/') || /~(?![01])/u.test(address.at))) fail('MODULE_GROUP_POINTER', moduleGroupPointerDiagnostics(raw).join('; '))
    try { readJsonPointer({ value: field.value }, `/value${address.at}`) } catch { fail('MODULE_GROUP_POINTER', moduleGroupPointerDiagnostics(raw).join('; ')) }
  }
  const steps = authorSteps(raw)
  if (steps.length !== 4 || new Set(steps.map(step => step.step)).size !== 4
    || steps.some(step => !step.summary.trim() || step.status === 'limited' && !step.limitations.length
      || step.fieldRefs.some(address => !evidenceAddresses.has(addressKey(address))))) fail('MODULE_GROUP_STEPS', moduleGroupStepDiagnostics(raw).join('; '))
  return { group, outputs }
}

/** Partial author context contains only submitted values and evidence, never verified claims or fabricated missing fields. */
export function getModuleAuthorGroupContext(itemId: string, raws: readonly ModuleAuthorGroupSubmission[]) {
  return raws.map(raw => ({ groupId: raw.groupId, outputs: decode(itemId, raw, raws).outputs, evidence: structuredClone(raw.evidence),
    limitations: [...raw.limitations] }))
}
/** Prompt-only projection: merge metadata once and retain every complete field.
 * Prior quotes/step reports stay in raw receipts and full validation/review. They
 * are not evidence for the next group's claims, which require original sources. */
export function getModuleAuthorGroupPromptContext(itemId: string, raws: readonly ModuleAuthorGroupSubmission[]) {
  return { outputs: mergeOutputs(itemId, raws, false),
    groupReceipts: raws.map(raw => ({ groupId: raw.groupId, projectionHash: sha256CanonicalJson(raw), evidenceCount: raw.evidence.length })),
    limitations: unique(raws.flatMap(raw => raw.limitations)),
    ...(itemId === '1.07' ? { recordIdentityDiagnostics: raws.flatMap(raw => raw.evidence
      .filter(entry => entry.target.port === 'site_use' && entry.target.field === 'spaceId')
      .map(entry => ({ groupId: raw.groupId, originalSubmissionHash: sha256CanonicalJson(raw), target: structuredClone(entry.target), kind: entry.kind,
        ...(entry.rationale === undefined ? {} : { rationale: entry.rationale }),
        ...(entry.source === undefined ? {} : { sourcePath: entry.source.path }) }))),
      recordIdentityBoundary: 'recordIdentityDiagnostics逐字保留先前原生作者对spaceId的关联说明、原地址及提交哈希，仅供回查对象与原图身份；不是新事实、来源证据或已认可的关联。不得按记录序号或来源排序猜配对象，不得把proposal/decision说明升级为实测现状。后组须回到冻结原件核对同一recordId，冲突明确保留并交独立审查；不能覆盖前组或机械选取另一照片。' } : {}),
    evidenceOmission: '先前证据原文和步骤记录仅保留在原始回执，完整合并校验与独立审查仍使用原件；本投影不能作为新字段的来源证据。' }
}
/** Exact envelope identities only; these are constraints, never evidence or a new candidate. */
export function getModuleAuthorFrozenAnchors(itemId: string, port: string, raws: readonly ModuleAuthorGroupSubmission[], recordIds?: readonly string[]) {
  const frozen = mergeOutputs(itemId, raws, false)[port]
  if (!frozen) return undefined
  return { port, type: frozen.type, scope: frozen.scope, asOf: frozen.asOf,
    records: frozen.records.filter(record=>!recordIds||recordIds.includes(record.recordId)).map(({ recordId, resultClass }) => ({ recordId, resultClass })) }
}
/** Lossless input organization only; original group receipts remain the audit authority. */
export function getModuleAuthorGroupPromptView(itemId: string, raws: readonly ModuleAuthorGroupSubmission[]) {
  return moduleReferencePromptView(getModuleAuthorGroupPromptContext(itemId, raws))
}
/** Real prior addresses only. The registry is prompt metadata, never a new
 * evidence claim, a repaired reference or a source for the next field. */
export function getModuleAuthorFormulaGroupPromptView(itemId: string, groupId: string, raws: readonly ModuleAuthorGroupSubmission[]) {
  if(itemId==='3.04'||itemId==='2.04'||itemId==='3.05'){
    const assigned=getModuleAuthorExecutionFieldGroups(itemId,raws).find(group=>group.groupId===groupId)?.recordIds
    if(assigned){
      const full=getModuleAuthorGroupPromptContext(itemId,raws)
      return moduleReferencePromptView({...full,outputs:Object.fromEntries(Object.entries(full.outputs).map(([port,value])=>[port,{...value,records:value.records.filter(record=>assigned.includes(record.recordId))}])),
        previousGroupScope:{assignedRecordIds:[...assigned],fullContextHash:sha256CanonicalJson(full),omitted:['outputs.records outside assignedRecordIds'],
          boundary:'Only exact assigned prior records are provided. Omitted records are not new evidence or absent facts. Every original group remains in full validation and independent review.'}})
    }
  }
  const policy=groupId.startsWith('market_context:4.2.'),numeric=groupId.startsWith('market_context:2.1.')
  if (itemId !== '3.01' || !(numeric||policy||groupId==='market_context:3.2.2'||groupId.startsWith('market_context:3.2.2.'))) return getModuleAuthorGroupPromptView(itemId, raws)
  const full = getModuleAuthorGroupPromptContext(itemId, raws)
  const assigned=getModuleAuthorExecutionFieldGroups(itemId,raws).find(group=>group.groupId===groupId)?.recordIds
  const outputs=assigned?Object.fromEntries(Object.entries(full.outputs).map(([port,value])=>[port,{...value,records:value.records.filter(record=>assigned.includes(record.recordId))}])):full.outputs
  const priorGroupEvidenceTargets = raws.flatMap(raw => {
    const targets = raw.evidence.filter(entry => entry.target.port === 'market_context'
      && (numeric||policy||['originalValue', 'denominator'].includes(entry.target.field))&&(!assigned||assigned.includes(entry.target.recordId))).map(entry => structuredClone(entry.target))
    const ports: Record<string, Record<string, string[][]>> = {}
    for (const target of targets) {
      const port = ports[target.port] ??= {}, field = port[target.field] ??= []
      field.push([target.recordId, target.at])
    }
    return targets.length ? [{groupId: raw.groupId, originalSubmissionHash: sha256CanonicalJson(raw), ports}] : []
  })
  return moduleReferencePromptView({...full,outputs, ...(assigned?{previousGroupScope:{assignedRecordIds:[...assigned],
    boundary:'仅提供本记录分片的先前专业字段，原始分组hash和整项限制保留。其他记录不是不存在，其完整原件、字段、证据与步骤仍进入中央完整合并和独审；未提供的跨记录字段或地址不得推测为本组依据。'}}:{}), priorGroupEvidenceTargets,
    priorGroupEvidenceBoundary: 'ports下port/field与[recordId,at]组合精确还原原回执target，仅供地址核对，不是新来源或认可的依据。at相对字段value内容起算，不能再加外层value。须回查适用性，不得编造引用、改值或重标来源；原回执、严格合并与独审保持。'})
}
/** The native structured_output schema remains complete and closed. Avoid
 * embedding its duplicate in author prompts that repeatedly exhausted output limits. */
export function getModuleAuthorGroupOutputSchemaPrompt(itemId: string, groupId: string, raws: readonly ModuleAuthorGroupSubmission[]) {
  if(itemId==='2.01'&&groupId==='regional_context:1')return '本组完整输出Schema由structured_output原生工具提供，只填写当前组的完整专业字段、实际记录和四步结果。尺度组织、项目坐标、实际入口和边界几何分别承担证据责任；历史对象的文字位置不能证明本轮几何或已完成GIS核验。完整原件和上游仍进入中央校验及独立审查。\n'+JSON.stringify({regionalScaleEvidenceScope:{
    fields:['scale','projectPosition','entranceIds','boundaryGeometry'],
    nonNullEvidenceRequired:true,selfReferenceCannotProvideBasis:true,missingMustUpdateValueAndClaimClass:true,
    allMissingWithinGroupAllowed:true,completeModuleUsefulConclusionRequired:true,independentReviewRequired:true,
    instructions:'逐项核对实际value、claimClass、evidence及四步fieldRefs是否一致。所有保留的非空值须有本组真实对应证据；推断须引用实际具备证据且业务相关的local或upstream，当前目标字段自身、缺失字段或循环不能作为依据。先回查原件和已有claim，不补造inputRefs，不为过检机械换成proposal/assumption。确无支持时，由原生作者实际将该字段value改为JSON null、claimClass改为missing并说明具体缺口；仅改limitations或删除evidence而保留非空value仍无效。缺失字段不附evidence，也不让fieldRefs指向缺失地址。当前组确无支持时可逐项missing/null；全null不能替代可完成研究的门槛针对完整模块候选，不能迫使本组造值或把缺失当作研究通过。完整汇合、严格来源/引用校验及新的独立审查继续执行。',
  }})
  if(itemId==='3.01'&&groupId==='market_context:4.1')return 'structured_output提供完整Schema，只填冻结记录的projectImpactHypothesis及四步结果，保留frozenGroupAnchors和前组原哈希。\n'+JSON.stringify({projectImpactEvidenceScope:{
    field:'projectImpactHypothesis',nonMissingEvidenceBasisRequired:true,
    missingInputsAreLimitationsNotEvidence:true,missingCannotBeInputRef:true,nonNullCannotDropEvidence:true,
    missingMustUpdateValueAndClaimClass:true,preserveFrozenPriorGroups:true,sourceScaleDoesNotProveProjectDemand:true,
    completeModuleStillRequiresEvidenceAndIndependentReview:true,noReplacementBusinessValues:true,
    instructions:'回查原件与claim。缺失分母、口径、期间、分类及数值只列限制，不能作inputRefs。非空假说须有对应evidence、真实rationale和精确非missing local/upstream，核对对象、地域、期间与口径。全市/区级统计不能证明项目需求、客流或收益。不能删证据后保留非空value或为过检改标proposal/assumption。确无依据，原生作者将value改JSON null、claimClass改missing，说明缺口；不附evidence，fieldRefs不指无证据地址。不补造值、测算或引用，不改前组。本组可如实missing，完整研究仍须严格来源/引用校验、汇合和新独审。',
  }})
  if(itemId==='3.01'&&groupId==='market_context:1')return '本组完整输出Schema由structured_output原生工具提供，只填写currentGroup.fields的工作指标编号、地域、统计时期与指标和四步结果。记录身份由你回查真实原件后建立，未知事实保留missing/null及具体限制；完整原稿仍须中央严格校验、汇合和新独审。\n'+moduleDecisionTextEvidenceProtocol(itemId,groupId)
  if(itemId==='2.01'&&groupId==='regional_context:4')return '本组完整输出Schema由structured_output原生工具提供，只填写冻结记录的followupTasks及四步结果，逐字保留frozenGroupAnchors中的端口元数据、recordId/resultClass与前三组原哈希。所有保留任务须有完整证据覆盖，由原生作者自行核对并提交；本组不代改已接受字段，完整模块继续汇合和独立审查。\n'+moduleDecisionTextEvidenceProtocol(itemId,groupId)
  if(itemId==='1.01'&&groupId==='project_brief:4')return '本组完整输出Schema由structured_output原生工具提供，只填写冻结记录的sourceLocation、conflicts及四步结果，保留frozenGroupAnchors的type/scope/asOf、recordId/resultClass和已接受分片的原始哈希。逐原件核对身份冲突与适用边界，不能改写前组字段或将历史项目与当前策划任务自动合并。完整原件、完整模块与独立审查继续执行。\n'+moduleDecisionTextEvidenceProtocol(itemId,groupId)
  if(itemId==='2.02')return '本组完整输出Schema由structured_output原生工具提供，不在提示中重复其JSON文本。只填写currentGroup.fields分配的完整专业字段、全部指定记录和四步结果。后组逐字保留frozenGroupAnchors的type/scope/asOf、recordId/resultClass；字段类型、必填项和记录数继续受原Schema约束。每个非空专业字段须有本组精确证据，工作编号与研究选择同样承担证据责任。完整原稿、原件及上游仍进入中央严格校验与独立审查。\n'+moduleDecisionTextEvidenceProtocol(itemId,groupId)
  if(itemId==='3.01'&&groupId==='market_context:2.2')return '本组完整输出Schema由structured_output原生工具提供，只填写冻结记录的classification、statisticalBasis及四步结果，保留frozenGroupAnchors的type/scope/asOf、recordId/resultClass和已接受分片的原始哈希。其他字段不在本组代改，完整模块仍须汇合校验及新独审。\n'+moduleDecisionTextEvidenceProtocol(itemId,groupId)
  if(itemId==='3.01'&&groupId==='market_context:3.1')return '本组完整输出Schema由structured_output原生工具提供，只填写冻结记录的priceBasis、revisionStatus及四步结果，分别核对每条统计记录的原始发布说明与表注，保留frozenGroupAnchors和全部已接受分片的原始哈希。完整模块仍须汇合校验及新独审。\n'+moduleDecisionTextEvidenceProtocol(itemId,groupId)
  if(itemId==='1.03'){
    const policy='本组完整输出Schema由structured_output原生工具提供，不在提示中重复其JSON文本。只提交currentGroup.fields指定的完整专业字段、全部原始记录及四步结果；新分组仅拆完整字段，旧v8已接受回执不改版本或事实。后组逐字保留frozenGroupAnchors的type/scope/asOf和recordId/resultClass。effectiveDate、revokedDate等日期采用真实原值，YYYY-MM-DD仅是表示格式，不能填作单位；没有真实单位不要添加evidence.unit。每个非空字段须有本组对应证据。approvalStatus、reviewStatus等文本的source原值须被所引用的最短完整连续原文逐字支持；proposed等英文概括词不能作为中文审批原文的逐字事实，计划或拟建文字不能证明立项、审批或实施完成。不要机械换成inference或proposal过检；确属解释时须有合法精确inputRefs、真实推断理由与适用限定，未知审批保持missing/null及具体缺口。完整原稿、原件及上游仍用于中央全量校验和独立审查。'
    if(groupId==='planning_conditions:1')return policy+'\n'+moduleDecisionTextEvidenceProtocol(itemId,groupId)
    return groupId==='planning_conditions:5.2'?policy+'\n'+JSON.stringify({verificationGroupScope:{
      fields:[{name:'reviewer',meaning:'核验人'},{name:'reviewStatus',meaning:'核验状态'}],
      allMissingWithinGroupAllowed:true,approvalStatusIsVerificationEvidence:false,completeModuleUsefulConclusionRequired:true,independentReviewRequired:true,
      instructions:'核验字段须回查实际核验人的身份、核验回执及其时点；审批状态与核验状态不是同一字段，不能用未知审批推断核验完成或核验人的身份。本组所有字段确无可核验支持时，可以由原生作者逐项提交missing、JSON null及具体限制，保留前组原稿和身份；缺失字段不附虚构evidence，也不让四步fieldRefs指向无证据地址。不能用非空“待核”或assumption掩饰缺失。全null不能替代可完成研究的门槛针对完整模块候选，不要求当前小组造值；完整汇合、严格来源/引用校验及新独审继续执行，缺失不代表研究合格。',
    }}):policy
  }
  if(itemId==='1.06')return '本组完整输出Schema由structured_output原生工具提供，不在提示中重复其JSON文本。只填写currentGroup.fields分配的完整专业字段、全部指定记录和四步结果；历史已接受原稿保持原版本及分组，新作者按本次分组原生提交。后组逐字保留frozenGroupAnchors的type/scope/asOf和recordId/resultClass。每个非空字段必须有本组对应evidence，包括resourceId工作编号、category研究分类和location范围选择；decision使用proposal和真实rationale，不能把研究选择当现场事实。historicalSource等事实缺失必须是JSON null与missing及具体原因，不能填字符串null、空串或占位文字；缺失不改标为事实。史料、景观展示和拟引入内容不能证明现存资源、传承者、保护级别、权利许可或承载能力。引用须绑定精确对象、原值及最短完整连续原文，数组逐叶对应，不能重复整页或补造依据。完整原稿、原件与上游仍进入中央合并和独立审查。'
  if(itemId==='1.05')return '本组完整输出Schema由structured_output原生工具提供，不在提示中重复其JSON文本。只填写currentGroup.fields分配的专业字段、全部指定记录及四步结果，字段类型、必填项、类别和冻结记录身份仍受原生Schema及中央严格校验约束。后组逐字保留frozenGroupAnchors的type/scope/asOf和recordId/resultClass。所有非空专业字段、工作编号和分析判断同样须有本组对应evidence；研究选择不能作为现场事实，来源不足仍为missing/null并保留具体限制。evidence.target.at与local.at从字段value内部起算，不重复外层value，按实际标量或数组叶逐一绑定；本组数值、单位、资料分辨率、监测位置和期间须对应真实原件，照片/地图显示不能补造实测环境本底或法定保护状态。完整原稿、原件和上游仍进入中央合并及独立审查。'
  if(itemId==='1.04')return '本组完整输出Schema由structured_output原生工具提供，不在提示中重复其JSON文本。只填写currentGroup.fields分配的专业字段、全部指定记录及四步结果，字段类型、必填项、类别和记录身份仍受原生Schema及中央严格校验约束。后组逐字保留同一端口frozenGroupAnchors的type/scope/asOf和recordId/resultClass；新端口首组自行据实建立其记录集合。非空工作编号和研究选择同样须有本组对应evidence及真实理由，前端口同名字段不能替代本端口证据。相机坐标、图像现状、历史资料及研究选择不能证明权属、登记面积、处分许可或批准。未知事实保留missing/null和具体限制，不补造依据或为过检重标来源。完整原稿、原件和上游仍进入中央合并及独立审查。'
  if(itemId==='3.01'&&groupId.startsWith('market_context:2.1.'))return '本组完整输出Schema由structured_output原生工具提供，只填写本分片冻结recordId的originalValue、normalizedValue与四步结果，保持原端口type/scope/asOf和recordId/resultClass。数值与单位须回查同一原件页中的连续原文；quote与valueQuote逐字保留原文换行，不能把换行写成字面反斜线n、拼接句子或改写。其他分片及完整原稿仍用于中央合并、完整专业校验及独立审查。\n'+numericNormalizationProtocol
  if(itemId==='3.01'&&groupId.startsWith('market_context:4.2.'))return '本组完整输出Schema由structured_output原生工具提供，只填写本分片冻结recordId的policyVision与四步结果，保持原端口type/scope/asOf和recordId/resultClass。规划愿景不能证明当前消费、项目客流、经营或批准现状；原文结论逐字回查绑定原件，推断按实际依据与限制声明，无依据保持missing/null，不能补造政策或为过检改标来源。先前字段与地址清单不是新证据，完整原稿仍由中央合并严格校验并交独立审查。'
  if (itemId === '3.01' && (groupId === 'market_context:3.2.2'||groupId.startsWith('market_context:3.2.2.'))) return '本组完整输出Schema由structured_output原生工具提供，字段类型、必填项、类别和冻结记录身份仍受该Schema及中央严格校验约束。原端口type/scope/asOf、recordId/resultClass、完整记录数须逐字保留frozenGroupAnchors；填写完整formula字段和四步结果，不得省略未知记录。公式文字描述方法，不是已完成复算的数值结果；calculation证据只能对应实际有限数值。原文结论必须由所绑定原件连续原文直接支持；作者归纳的方法须按真实含义、实际依据与限制明确说明，不能把方法说明冒充原文、计算结果或为过检重标来源。priorGroupEvidenceTargets仅供核对原声明地址；没有依据的字段保留missing/null与具体限制。'
  if(itemId==='3.01')return '本组完整输出Schema由structured_output原生工具提供，不在提示中重复其JSON文本。只填写currentGroup.fields分配的专业字段和完整四步结果，字段类型、必填项、类别及冻结记录数仍受同一原生Schema和中央严格校验约束。逐字保留frozenGroupAnchors的type/scope/asOf、recordId/resultClass，每个冻结记录恰有一次，未知字段保持missing和JSON null及具体限制。证据target从字段value内部起算，标量at为空字符串；证据成员须与其kind一致。原文、统计口径、期间与方法须由实际材料支持，公式文字不能作为calculation数值；不补造来源、当前需求、数值或引用，不重标业务值以过检。完整原稿仍用于中央合并、复算及独立审查。'
  return `本组完整输出Schema（后组已绑定原作者的端口范围、基准时点、记录数和记录身份；专业值仍须自行填写）：${JSON.stringify(getModuleAuthorGroupOutputsSchema(itemId, groupId, raws, getModuleAuthorExecutionGroupVersion(itemId,raws)))}`
}
/** Metadata-only prompt scope. Full original fields stay in the host's merge,
 * validation and independent review, and cannot be cited from omitted text. */
export function getModuleAuthorMetadataGroupPromptView(itemId: string, raws: readonly ModuleAuthorGroupSubmission[]) {
  if(itemId==='1.02'){
    const full=getModuleAuthorGroupPromptContext(itemId,raws),identity=new Set(['recordId','resultClass','boundaryId','scopeKind'])
    const outputs=Object.fromEntries(Object.entries(full.outputs).map(([port,data])=>[port,{...data,
      records:data.records.map(row=>Object.fromEntries(Object.entries(row).filter(([field])=>identity.has(field))))}]))
    const omittedFieldDiagnostics=raws.flatMap(raw=>Object.values(decode(itemId,raw).outputs).flatMap(port=>port.records.flatMap(row=>
      Object.entries(row).filter(([field])=>!identity.has(field)).map(([field,value])=>{
        const original=value as {claimClass:string;limitations:readonly string[]}
        return {groupId:raw.groupId,recordId:row.recordId,field,originalSubmissionHash:sha256CanonicalJson(raw),
          claimClass:original.claimClass,limitations:[...original.limitations]}
      }))))
    return moduleReferencePromptView({outputs,groupReceipts:full.groupReceipts,omittedFieldDiagnostics,
      previousGroupScope:{fullContextHash:sha256CanonicalJson(full),omittedClaimsAvailable:false,
        boundary:'只保留同一原生研究记录身份、范围、时点、限制及原始回执。其他专业字段原值、证据与步骤未提供，不能推定几何、精度、正式版本或生效日期；分类和限制清单不是事实依据。仅为本次工作版本任务保持身份，完整原稿仍用于中央严格合并及独立审查，不接受或改写历史拒稿。'}})
  }
  if (itemId !== '1.07') return getModuleAuthorGroupPromptView(itemId, raws)
  const full = getModuleAuthorGroupPromptContext(itemId, raws), omitted = new Set<string>()
  const outputs = Object.fromEntries(Object.entries(full.outputs).map(([port, data]) => [port, { ...data,
    records: data.records.map(row => {
      for (const key of Object.keys(row)) if (!['recordId','resultClass','spaceId','assetId'].includes(key)) omitted.add(key)
      return Object.fromEntries(Object.entries(row).filter(([key]) => ['recordId','resultClass','spaceId','assetId'].includes(key)))
    }),
  }]))
  const photoSourceBindings=raws.flatMap(raw=>{
    const bindings=new Map<string,{groupId:string;recordId:string;sourcePath:string;originalSubmissionHash:string;targets:{field:string;at:string}[]}>()
    for(const entry of raw.evidence){
      if(entry.kind!=='source'||!entry.source||entry.target.port!=='site_use'
        ||!['geometry','photoLocation','photoDirection','photoDate'].includes(entry.target.field)
        ||! /\.(?:jpe?g|png|webp|heic|tiff?)$/iu.test(entry.source.path))continue
      const key=JSON.stringify([entry.target.recordId,entry.source.path])
      let binding=bindings.get(key)
      if(!binding){binding={groupId:raw.groupId,recordId:entry.target.recordId,sourcePath:entry.source.path,
        originalSubmissionHash:sha256CanonicalJson(raw),targets:[]};bindings.set(key,binding)}
      const target={field:entry.target.field,at:entry.target.at}
      if(!binding.targets.some(prior=>prior.field===target.field&&prior.at===target.at))binding.targets.push(target)
    }
    return [...bindings.values()]
  })
  const omittedPhotoFieldDiagnostics = raws.flatMap(raw => decode(itemId, raw).outputs.site_use.records.flatMap(row =>
    Object.entries(row).filter(([field]) => ['geometry','geometryVersion','photoLocation','photoDirection','photoDate'].includes(field))
      .map(([field, value]) => { const original = value as { claimClass: string; limitations: readonly string[] }
        return { groupId: raw.groupId, recordId: row.recordId, field, originalSubmissionHash: sha256CanonicalJson(raw),
          claimClass: original.claimClass, limitations: [...original.limitations] } })))
  return moduleReferencePromptView({ ...full, outputs, photoSourceBindings, omittedPhotoFieldDiagnostics, previousGroupScope: { fullContextHash: sha256CanonicalJson(full),
    omittedFields: [...omitted], omittedClaimsAvailable: false,
    boundary: '仅保留原生端口锚点、记录身份、完整spaceId/assetId及回执；photoSourceBindings逐字列出先前原生记录引用的图像路径、字段地址和原提交哈希，仅供回查同一对象的照片身份，不是证据、认可的关联或宿主选择的新值。omittedPhotoFieldDiagnostics逐字保留省略几何/照片字段的分类与限制说明，包含missing/null字段中可能存在的对象、机位、时刻断言，须与身份说明及原图交叉核对；它们不是字段值或新证据。不得按记录序号或来源列表排序猜配照片；若同一记录指向不同原图，须回查对象和原图关联并明确冲突，不能机械拼接其坐标和时刻。其余原字段不作为本组照片元数据证据。完整原件仍用于中央合并、校验和独立审查。不得从省略字段推定新值。' } })
}
function mergeOutputs(itemId: string, raws: readonly ModuleAuthorGroupSubmission[], complete: boolean): GroupOutputs {
  const plan = getModuleAuthorFieldGroups(itemId, sequenceVersion(itemId, raws),raws)
  if (raws.length > plan.length || complete && raws.length !== plan.length) fail('MODULE_GROUP_SET')
  const outputs: GroupOutputs = {}
  raws.forEach((raw, index) => {
    if (raw?.groupId !== plan[index].groupId) fail('MODULE_GROUP_ORDER')
    const { group, outputs: decoded } = decode(itemId, raw,raws), incoming = decoded[group.port], existing = outputs[group.port]
    if (!existing) { outputs[group.port] = structuredClone(incoming); return }
    const path = `/outputs/${group.port.replace(/~/gu, '~0').replace(/\//gu, '~1')}`
    for (const key of ['type', 'scope', 'asOf'] as const) {
      if (same(existing[key], incoming[key])) continue
      const expected = JSON.stringify(existing[key])
      fail('MODULE_GROUP_ANCHOR', `${group.groupId}; ${path}/${key}: differs from the frozen prior group; ${expected.length <= 900 ? `expected=${expected}` : 'expected value is in previousAuthorGroups.outputs (omitted here due to length)'}; preserve the anchor exactly; do not overwrite prior submissions`)
    }
    const assigned=existing.records.filter(row=>!group.recordIds||group.recordIds.includes(row.recordId))
    if (assigned.length !== incoming.records.length) fail('MODULE_GROUP_ANCHOR', `${group.groupId}; ${path}/records: expected ${assigned.length} records from the frozen prior group, received ${incoming.records.length}`)
    for (const row of assigned) {
      const next = incoming.records.find(candidate => candidate.recordId === row.recordId)
      if (!next) fail('MODULE_GROUP_ANCHOR', `${group.groupId}; ${path}/records: missing frozen recordId=${JSON.stringify(row.recordId)}; preserve prior record identities`)
      if (next!.resultClass !== row.resultClass) fail('MODULE_GROUP_ANCHOR', `${group.groupId}; ${path}/records recordId=${JSON.stringify(row.recordId)}/resultClass: expected=${JSON.stringify(row.resultClass)}; preserve the frozen prior classification`)
      for (const field of group.fields) {
        if (Object.hasOwn(row, field)) fail('MODULE_GROUP_FIELD_OVERLAP', field)
        row[field] = structuredClone(next![field])
      }
    }
    // These are conservative metadata reductions. Professional field values and conclusions are copied unchanged.
    existing.quality = existing.quality === 'limited' || incoming.quality === 'limited' ? 'limited' : 'accepted'
    existing.limitations = unique([...existing.limitations, ...incoming.limitations])
  })
  return outputs
}
export function validateModuleAuthorGroup(itemId: string, raw: unknown, previous: readonly ModuleAuthorGroupSubmission[], corpus: MaterialCorpus, upstream?: readonly ClaimUpstream[]): ModuleAuthorGroupSubmission {
  const raws = [...previous, raw as ModuleAuthorGroupSubmission], outputs = mergeOutputs(itemId, raws, false)
  const selection: Record<string, string[]> = {}
  for (const raw of raws) {
    const group = requireGroup(itemId, raw.groupId, requireVersion(raw.projectionVersion),raws)
    ;(selection[group.port] ??= []).push(...group.fields)
  }
  const evidence=raws.flatMap(raw=>raw.evidence)
  if(raws.some(raw=>raw.projectionVersion===PEER_PRODUCT_RECORD_GROUP_VERSION&&raw.groupId!=='peer_products:1.1'||raw.projectionVersion===PEER_LOCATION_RECORD_GROUP_VERSION&&raw.groupId!=='peer_locations:1.1'||raw.projectionVersion===PEER_RECORD_GROUP_VERSION&&raw.groupId!=='peer_supply:1'||marketRecordVersion(raw.projectionVersion)&&(raw.groupId.startsWith('market_context:3.2.2.')||raw.groupId.startsWith('market_context:2.1.')))){
    // Validate every actually authored field, record by record. Complete merge
    // still requires all frozen records and all fields; no missing field is filled.
    for(const [portName,port] of Object.entries(outputs))for(const record of port.records){
      const fields=unique(selection[portName]).filter(field=>Object.hasOwn(record,field))
      validateModuleProjectionFields(itemId,{outputs:{[portName]:{...port,records:[record]}},
        evidence:evidence.filter(entry=>entry.target.port===portName&&entry.target.recordId===record.recordId)},
        {[portName]:fields},corpus,{outputs,evidence})
    }
  }else validateModuleProjectionFields(itemId, { outputs, evidence }, selection, corpus)
  const upstreamErrors = upstream === undefined ? [] : moduleUpstreamReferenceDiagnostics(raws, upstream)
  if (upstreamErrors.length) throw new Error(upstreamErrors.join('; '))
  // Reject closed local cycles as soon as their authored edges are available.
  // Future addresses remain for complete merge; no dependency is chosen here.
  const fieldClaimCycles = moduleClaimCycleConflicts(raws)
  if (fieldClaimCycles.length) fail('MODULE_CLAIM_CYCLE', JSON.stringify({fieldClaimCycles}))
  return structuredClone(raw as ModuleAuthorGroupSubmission)
}
export function compileModuleAuthorGroups(itemId: string, raws: readonly ModuleAuthorGroupSubmission[], corpus: MaterialCorpus): CompiledModuleCandidate {
  const outputs = mergeOutputs(itemId, raws, true)
  const steps = [1, 2, 3, 4].map(step => {
    const contributors = raws.map(raw => ({ groupId: raw.groupId, entry: authorSteps(raw).find(entry => entry.step === step)! }))
    return { step, status: contributors.some(row => row.entry.status === 'limited') ? 'limited' : 'completed',
      summary: contributors.map(row => `[${row.groupId}] ${row.entry.summary}`).join('\n'),
      fieldRefs: contributors.flatMap(row => row.entry.fieldRefs), limitations: unique(contributors.flatMap(row => row.entry.limitations)) }
  })
  return compileModuleAuthorProjection(itemId, { projectionVersion: MODULE_AUTHOR_PROJECTION_VERSION, outputs,
    evidence: raws.flatMap(raw => raw.evidence), limitations: unique(raws.flatMap(raw => raw.limitations)), steps }, corpus)
}
function planHash(itemId: string, version: GroupVersion,raws:readonly ModuleAuthorGroupSubmission[]=[]) { return sha256CanonicalJson({ version, itemId, groups: getModuleAuthorFieldGroups(itemId, version,raws) }) }
function validateReceipts(groups: readonly { receipt: ModuleAuthorReceipt }[]) {
  if (groups.some(({ receipt: r }) => !r?.executionId?.trim() || !r.childId?.trim() || !r.actualModel?.provider?.trim() || !r.actualModel?.model?.trim() || r.stopReason !== 'completed')
    || new Set(groups.map(g => g.receipt.executionId)).size !== groups.length || new Set(groups.map(g => g.receipt.childId)).size !== groups.length) fail('MODULE_GROUP_RECEIPT')
}
function groupBinding(planHash: string, compiledCandidateHash: string, group: Omit<ModuleAuthorGroupReceipt, 'receiptBindingHash'>) {
  return sha256CanonicalJson({ planHash, compiledCandidateHash, groupId: group.raw.groupId, projectionHash: group.projectionHash, outputsJsonHash: group.outputsJsonHash, receipt: group.receipt })
}
/** Legacy property name retained in the version-bound audit: v3/v4 hash exact
 * submitted text; v5 hashes canonical JSON of the submitted native object. */
export function hashModuleAuthorGroupOutputs(raw: ModuleAuthorGroupSubmission): string {
  return nativeVersion(raw.projectionVersion) ? sha256CanonicalJson(raw.outputs) : hashModuleProjectionJsonText(raw.outputsJson!)
}
export function createModuleAuthorGroupsAudit(itemId: string, submissions: readonly { raw: ModuleAuthorGroupSubmission; receipt: ModuleAuthorReceipt }[], candidate: CompiledModuleCandidate): ModuleAuthorGroupsAudit {
  mergeOutputs(itemId, submissions.map(s => s.raw), true); validateReceipts(submissions)
  const version = sequenceVersion(itemId, submissions.map(s => s.raw)), hash = planHash(itemId, version,submissions.map(s=>s.raw)), compiledCandidateHash = sha256CanonicalJson(candidate)
  const groups = submissions.map(({ raw, receipt }) => {
    const group = { raw: structuredClone(raw), receipt: structuredClone(receipt), projectionHash: sha256CanonicalJson(raw), outputsJsonHash: hashModuleAuthorGroupOutputs(raw) }
    return { ...group, receiptBindingHash: groupBinding(hash, compiledCandidateHash, group) }
  })
  return { version, planHash: hash, compiledCandidateHash, groups,
    bindingHash: sha256CanonicalJson({ planHash: hash, compiledCandidateHash, bindings: groups.map(g => g.receiptBindingHash) }) }
}
export function replayModuleAuthorGroups(itemId: string, corpus: MaterialCorpus, audit: ModuleAuthorGroupsAudit): CompiledModuleCandidate {
  // execution.kind remains the grouped container identifier. Never infer the wire version from it,
  // upgrade history, or mix native/text raw receipts within one version-bound plan.
  if (!audit || ![RESOURCE_SOURCE_CATEGORY_GROUP_VERSION, ENVIRONMENT_VERIFICATION_GROUP_VERSION, BOUNDARY_METADATA_GROUP_VERSION, POLICY_NARROW_GROUP_VERSION, RESOURCE_NARROW_GROUP_VERSION, PEER_PRODUCT_RECORD_GROUP_VERSION, PEER_LOCATION_RECORD_GROUP_VERSION, PEER_RECORD_GROUP_VERSION, MARKET_VALUES_RECORD_GROUP_VERSION, MARKET_POLICY_RECORD_GROUP_VERSION, MARKET_FORMULA_RECORD_GROUP_VERSION, MARKET_FORMULA_GROUP_VERSION, MARKET_NARROW_GROUP_VERSION, MODULE_AUTHOR_GROUP_VERSION, PHOTO_DECIMAL_GROUP_VERSION, SPLIT_NATIVE_GROUP_VERSION, LEGACY_NATIVE_GROUP_VERSION, FIXED_JSON_GROUP_VERSION, LEGACY_GROUP_VERSION].includes(audit.version)
    || !Array.isArray(audit.groups) || audit.planHash !== planHash(itemId, audit.version,audit.groups.map(g=>g.raw))
    || audit.groups.length !== getModuleAuthorFieldGroups(itemId, audit.version,audit.groups.map(g=>g.raw)).length) fail('MODULE_GROUP_AUDIT')
  validateReceipts(audit.groups)
  if (sequenceVersion(itemId, audit.groups.map(g => g.raw)) !== audit.version) fail('MODULE_GROUP_RAW_HASH')
  for (const group of audit.groups) {
    if (group.projectionHash !== sha256CanonicalJson(group.raw) || group.outputsJsonHash !== hashModuleAuthorGroupOutputs(group.raw)) fail('MODULE_GROUP_RAW_HASH')
    if (group.receiptBindingHash !== groupBinding(audit.planHash, audit.compiledCandidateHash, group)) fail('MODULE_GROUP_RECEIPT_BINDING')
  }
  if (audit.bindingHash !== sha256CanonicalJson({ planHash: audit.planHash, compiledCandidateHash: audit.compiledCandidateHash, bindings: audit.groups.map(g => g.receiptBindingHash) })) fail('MODULE_GROUP_BINDING')
  const compiled = compileModuleAuthorGroups(itemId, audit.groups.map(g => g.raw), corpus)
  if (sha256CanonicalJson(compiled) !== audit.compiledCandidateHash) fail('MODULE_GROUP_COMPILED_HASH')
  return compiled
}
import { numericNormalizationProtocol } from './module-number-evidence-protocol.ts'
