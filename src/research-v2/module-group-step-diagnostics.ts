import {sha256CanonicalJson} from '../presentation/canonical-json.ts'
import {readJsonPointer} from './regional-schema.ts'
import {parseModuleProjectionOutputsJson} from './module-author-projection.ts'

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const addressKey = (value: unknown) => object(value) ? JSON.stringify([value.port, value.recordId, value.field, value.at]) : undefined

// Describe the rejected field, never supply a business value or a substitute
// reference. A removed binding does not make a retained positive claim valid.
function fieldState(raw:Record<string,unknown>,target:unknown,outputs:unknown){
  if(!object(target)||typeof target.port!=='string'||typeof target.recordId!=='string'||typeof target.field!=='string'||!object(outputs))return undefined
  const port=outputs[target.port]
  if(!object(port)||!Array.isArray(port.records))return undefined
  const record=port.records.find(row=>object(row)&&row.recordId===target.recordId)
  if(!object(record))return undefined
  const field=record[target.field]
  if(!object(field))return undefined
  const value=field.value
  let referencedValueExists=false
  if(typeof target.at==='string')try{referencedValueExists=readJsonPointer(field,'/value'+target.at)!==undefined}catch{}
  const registeredFieldEvidenceCount=Array.isArray(raw.evidence)?raw.evidence.filter(entry=>object(entry)&&object(entry.target)
    &&entry.target.port===target.port&&entry.target.recordId===target.recordId&&entry.target.field===target.field).length:0
  return {...(typeof field.claimClass==='string'?{claimClass:field.claimClass}:{}),
    valueType:value===null?'null':Array.isArray(value)?'array':typeof value,
    ...(value===undefined?{}:{valueHash:sha256CanonicalJson(value)}),referencedValueExists,registeredFieldEvidenceCount}
}

export const moduleGroupStepEvidenceProtocol='fieldRefs只引用本组已登记且支持该字段含义的evidence.target，不是全部分配字段的清单。stepEvidenceConflicts.fieldState仅描述原拒稿的类别、原值哈希、叶地址是否存在及该字段登记证据数，不是事实或替代依据。有值字段保留source_conclusion、agent_inference等专业判断时，必须由你回查原始材料并提供真实且语义一致的绑定；不得只删evidence或fieldRefs却保留无依据肯定字段及步骤摘要。若确无支持，须由原生作者将对应字段如实修订为missing/null并保留具体限制，同步修订步骤摘要和引用。missing/null字段不得添加evidence或放入fieldRefs；在该步limitations说明对象、未核内容及影响，步骤仍须保留并记limited。证据地址存在不证明专业判断成立，不能编造来源、改标假设或用limitations抵消正文断言；最终仍须完整汇合及独立审查。'

/** Every unsupported address and its exact original step paths; no step prose,
 * field values or inferred evidence is copied into this bounded diagnostic. */
export function moduleGroupStepEvidenceConflicts(raw:unknown) {
  if(!object(raw)||!Array.isArray(raw.evidence))return []
  let outputs:unknown=raw.outputs
  if(outputs==null&&typeof raw.outputsJson==='string')try{outputs=parseModuleProjectionOutputsJson(raw.outputsJson)}catch{}
  const addresses=new Set(raw.evidence.flatMap(entry=>object(entry)&&object(entry.target)?[addressKey(entry.target)]:[]))
  const steps:[string,unknown][]=Array.isArray(raw.steps)?raw.steps.map((entry,index)=>[`/steps/${index}`,entry])
    :object(raw.stepResults)?Object.entries(raw.stepResults).map(([key,entry])=>[`/stepResults/${key}`,entry]):[]
  const conflicts=new Map<string|undefined,{target:unknown;fieldRefPaths:string[];fieldState?:ReturnType<typeof fieldState>}>()
  for(const[path,value]of steps){
    if(!object(value)||!Array.isArray(value.fieldRefs))continue
    for(const[index,target]of value.fieldRefs.entries()){
      const address=addressKey(target);if(address!==undefined&&addresses.has(address))continue
      const key=JSON.stringify(target),prior=conflicts.get(key)
      if(prior)prior.fieldRefPaths.push(`${path}/fieldRefs/${index}`)
      else {
        const state=fieldState(raw,target,outputs)
        conflicts.set(key,{target:structuredClone(target),fieldRefPaths:[`${path}/fieldRefs/${index}`],...(state?{fieldState:state}:{})})
      }
    }
  }
  return [...conflicts.values()]
}

/** Diagnostic projection only. Keep mistyped references unchanged; never infer
 * an intended field, fill a step, or turn a rejected submission into a result. */
export function moduleGroupStepDiagnostics(raw: unknown): string[] {
  if (!object(raw) || !Array.isArray(raw.evidence)) return []
  const addresses = new Set(raw.evidence.flatMap(entry => object(entry) && object(entry.target) ? [addressKey(entry.target)] : []))
  const steps: [string, unknown][] = Array.isArray(raw.steps) ? raw.steps.map((entry, index) => [`/steps/${index}`, entry])
    : object(raw.stepResults) ? Object.entries(raw.stepResults).map(([key, entry]) => [`/stepResults/${key}`, entry]) : []
  const errors: string[] = []
  for (const [path, value] of steps) {
    if (!object(value)) continue
    if (typeof value.summary === 'string' && !value.summary.trim()) errors.push(`${path}/summary: must contain a non-blank explanation`)
    if (value.status === 'limited' && Array.isArray(value.limitations) && !value.limitations.length) errors.push(`${path}/limitations: a limited step must state its limitation`)
    if (Array.isArray(value.fieldRefs)) for (const [index, address] of value.fieldRefs.entries()) {
      const key = addressKey(address)
      if (key === undefined || !addresses.has(key)) errors.push(`${path}/fieldRefs/${index}: target=${JSON.stringify(address)} has no matching evidence.target in this group`)
      if (errors.length >= 12) return [...errors.slice(0, 12), 'Additional step references may still be invalid; no omitted reference is accepted.']
    }
  }
  return errors
}
