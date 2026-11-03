import {assertObjectJsonSchema,type JsonSchemaNode,type ObjectJsonSchema} from '@deepseek-ai/dsh-tools'
import type {ModuleAuthorGroupSubmission} from './module-author-groups.ts'
import type {ClaimUpstream} from './module-claims.ts'
import {readJsonPointer} from './regional-schema.ts'

const literal=(value:string):JsonSchemaNode=>({type:'string',const:value})
const object=(properties:Record<string,JsonSchemaNode>):JsonSchemaNode=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)})
const union=(choices:JsonSchemaNode[]):JsonSchemaNode=>choices.length===1?choices[0]:{oneOf:choices}
const escape=(key:string)=>key.replaceAll('~','~0').replaceAll('/','~1')
interface LeafPaths {paths:string[];dynamic:boolean}
/** This walks the existing, authority-derived native value schema. Wire types
 * (including v7/v8 photo decimal strings) and all professional values stay intact. */
function scalarLeaves(node:JsonSchemaNode,at=''):LeafPaths {
  if(node.oneOf){
    const parts=node.oneOf.map(branch=>scalarLeaves(branch,at))
    return {paths:[...new Set(parts.flatMap(part=>part.paths))],dynamic:parts.some(part=>part.dynamic)}
  }
  if(node.type==='array')return {paths:[],dynamic:true}
  if(node.type==='object'){
    const parts=Object.entries(node.properties??{}).map(([key,child])=>scalarLeaves(child,at+'/'+escape(key)))
    return {paths:[...new Set(parts.flatMap(part=>part.paths))],dynamic:parts.some(part=>part.dynamic)}
  }
  return {paths:node.type==='null'?[]:[at],dynamic:false}
}
function fieldValues(field:JsonSchemaNode):JsonSchemaNode[] {
  return field.properties?.value?[field.properties.value]:(field.oneOf??[]).flatMap(fieldValues)
}
/** Fixed source leaves are correlated with their own field, never a global leaf
 * enum. Unknown-length arrays remain centrally checked; native constraints do
 * not claim to prove leaf existence, source support or semantic sufficiency. */
export function nativeHandoffAddressChoices(schema:ObjectJsonSchema,scalarSource=false):JsonSchemaNode[] {
  const choices:JsonSchemaNode[]=[]
  for(const [port,portSchema] of Object.entries(schema.properties?.outputs?.properties??{})){
    const row=portSchema.properties?.records?.items
    if(!row?.properties)continue
    for(const [field,envelope] of Object.entries(row.properties)){
      const values=fieldValues(envelope)
      if(!values.length)continue
      const leaves=values.map(value=>scalarLeaves(value)),paths=[...new Set(leaves.flatMap(part=>part.paths))]
      const dynamic=leaves.some(part=>part.dynamic)
      const at:JsonSchemaNode={type:'string',
        ...(scalarSource&&!dynamic&&paths.length?{enum:paths}:{}),
        description:scalarSource?(dynamic
          ?'source只能指向实际非空标量叶；数组从value内部逐叶如/0或/0/value，真实索引与覆盖仍由中央检查，不得引用整个数组/对象。'
          :'source从字段value内部起算，必须使用本字段列出的实际标量叶；不能引用整个对象。')
          :'从字段value内部起算的实际地址；整字段推断/选择可用空字符串，实际依据与证据存在性仍由中央检查。'}
      choices.push(object({port:literal(port),recordId:structuredClone(row.properties.recordId),field:literal(field),at}))
    }
  }
  return choices
}
/** New-request constraints only. Replay deliberately continues to use the
 * original groupSchema and original receipts in module-author-groups. */
export function bindNativeHandoffReferences(schema:ObjectJsonSchema,previous:readonly ModuleAuthorGroupSubmission[],upstream:readonly ClaimUpstream[]):ObjectJsonSchema {
  const current=nativeHandoffAddressChoices(schema),evidence=schema.properties?.evidence?.items
  if(!current.length||!evidence?.properties)return schema
  const bound=structuredClone(schema),entry=bound.properties!.evidence.items!
  entry.properties!.target={...union(current),description:evidence.properties.target.description}
  const localGroups=new Map<string,{port:string;field:string;at:string;recordIds:Set<string>}>()
  for(const raw of previous)for(const prior of raw.evidence??[]){
    const address=prior.target,row=raw.outputs?.[address.port]?.records.find(record=>record.recordId===address.recordId)
    const field=row?.[address.field] as {value?:unknown;claimClass?:string}|undefined
    if(!field||field.value===null||field.value===undefined||field.claimClass==='missing')continue
    try{if(readJsonPointer({value:field.value},'/value'+address.at)===null)continue}catch{continue}
    const key=JSON.stringify([address.port,address.field,address.at])
    const group=localGroups.get(key)??{port:address.port,field:address.field,at:address.at,recordIds:new Set<string>()}
    group.recordIds.add(address.recordId);localGroups.set(key,group)
  }
  const externalGroups=new Map<string,Set<string>>()
  for(const module of upstream)for(const claim of module.claims){
    if(claim.kind==='missing'||claim.value===null||claim.value===undefined)continue
    const claims=externalGroups.get(module.moduleId)??new Set<string>()
    claims.add(claim.claimId);externalGroups.set(module.moduleId,claims)
  }
  // Group exact combinations without a module-wide Cartesian product. Repeating
  // the entire object for every claim exhausted real native context budgets.
  const localChoices=[...localGroups.values()].map(group=>object({local:object({port:literal(group.port),
    recordId:{type:'string',enum:[...group.recordIds]},field:literal(group.field),at:literal(group.at)})}))
  const externalChoices=[...externalGroups].map(([moduleId,claims])=>object({upstream:object({moduleId:literal(moduleId),claimId:{type:'string',enum:[...claims]}})}))
  const refs=[...current.map(address=>object({local:address})),...localChoices,...externalChoices]
  const original=entry.properties!.inputRefs
  entry.properties!.inputRefs={...original,items:union(refs),description:
    'local使用本组合法字段或前组实际非missing证据的完整地址；upstream只能选择冻结输入中的真实moduleId/claimId组合，端口名不是模块身份。地址存在不证明支持结论；无实际依据保持missing/null及具体限制，不得猜造地址、改写前组或为过检改类。'}
  const calculation=entry.properties!.calculation
  for(const member of ['operands','weights']){
    const originalArray=calculation?.properties?.[member]
    if(!originalArray?.items?.oneOf)continue
    const inline=originalArray.items.oneOf.filter(branch=>!branch.properties?.local&&!branch.properties?.upstream)
    calculation.properties![member]={...originalArray,items:union([...refs,...inline])}
  }
  for(const step of Object.values(bound.properties!.stepResults?.properties??{})){
    const addresses=step.properties?.fieldRefs
    if(addresses)step.properties!.fieldRefs={...addresses,items:union(current),description:'仅引用本组实际提交的evidence.target；missing字段不能引用，存在性和覆盖由中央严格核验。'}
  }
  assertObjectJsonSchema(bound)
  return bound
}
/** Compact prompt metadata derived from the same tool schema, without copying
 * previous quotations or a second professional field dictionary. */
export function nativeHandoffPromptView(schema:ObjectJsonSchema) {
  const targets=nativeHandoffAddressChoices(schema,true).map(address=>({port:address.properties!.port.const,
    field:address.properties!.field.const,sourceLeaves:address.properties!.at.enum??'dynamic leaves checked centrally'}))
  return {version:'native-handoff-contract.v1',targets,
    referenceBoundary:'structured_output的local/upstream分支列出本次可用身份：本组合法字段、前组实际非missing证据、冻结外部moduleId/claimId组合。不要猜地址。可引用不等于业务支持；原件、整体汇合和独审仍决定有效性。',
    sourceBoundary:'source保留连续原文和标量叶；整字段proposal/inference与source不同。动态数组真实叶、缺失、循环和专业证据充分性仍由中央及独审检查。'}
}
