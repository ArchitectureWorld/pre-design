import {assertObjectJsonSchema,validateJsonSchemaValue,type ObjectJsonSchema} from '@deepseek-ai/dsh-tools'
import {sha256CanonicalJson as hash} from '../presentation/canonical-json.ts'
import {shareNativeModulePrompt,expandModuleReferencePromptView} from './module-reference-context.ts'
import {compactNativeModuleRejectionPrompt} from './native-module-rejection-budget.ts'
import {shareNativeSchemaDescription,expandNativeSchemaDescription,nativeSchemaReferenceInstruction} from './native-schema-reference.ts'
import type {SessionEventLike} from '../visual/session-image-collector.ts'

export const NATIVE_MODULE_JSON_WIRE_VERSION='native-json-submission.v1'
export const NATIVE_MODULE_FROZEN_JSON_WIRE_VERSION='native-frozen-submission.v2'
export const NATIVE_MODULE_JSON_WIRE_SCHEMA:ObjectJsonSchema={type:'object',additionalProperties:false,
 properties:{wireVersion:{type:'string',const:NATIVE_MODULE_JSON_WIRE_VERSION},submissionJson:{type:'string'}},required:['wireVersion','submissionJson']}
export interface NativeModuleSubmissionWireAudit {
 readonly version:typeof NATIVE_MODULE_JSON_WIRE_VERSION|typeof NATIVE_MODULE_FROZEN_JSON_WIRE_VERSION
 readonly nativeArgumentsHash:string;readonly decodedSubmissionHash:string;readonly fullNativeSchemaHash:string
}

const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value)
const invalid=(detail:string):never=>{throw new Error('MODULE_NATIVE_JSON_WIRE_INVALID: '+detail)}
/** An undecoded transport is not a newer business draft. This classification
 * never parses, repairs or accepts its contents. */
export function isUndecodedNativeModuleJsonWire(value:unknown):boolean{
 return object(value)&&[NATIVE_MODULE_JSON_WIRE_VERSION,NATIVE_MODULE_FROZEN_JSON_WIRE_VERSION].includes(value.wireVersion as any)
  &&typeof value.submissionJson==='string'&&!Object.hasOwn(value,'groupId')&&!Object.hasOwn(value,'outputs')
}
function syntaxLocation(error:unknown):string{
 // Parser messages can contain submitted text. Only numeric source positions
 // are forwarded; never echo an excerpt or repair the rejected JSON.
 const location=error instanceof SyntaxError?error.message.match(/position (\d+)(?: \(line (\d+) column (\d+)\))?/u):undefined
 return location?'; syntax at position '+location[1]+(location[2]?' (line '+location[2]+' column '+location[3]+')':''):''
}
const metadataKeys=['type','scope','asOf'] as const
/** Only an unambiguous, already frozen group envelope qualifies. Business
 * fields, resultClass and evidence never become host-filled constants. */
function frozenIdentity(schema:ObjectJsonSchema){
 const outputs=schema.properties?.outputs,ports=Object.entries(outputs?.properties??{})
 if(outputs?.type!=='object'||ports.length!==1)return undefined
 const [port,node]=ports[0],record=node.properties?.records?.items,ids=record?.properties?.recordId?.enum
 if(node.type!=='object'||!outputs.required?.includes(port)||!metadataKeys.every(key=>node.required?.includes(key)
  &&node.properties?.[key]?.type==='string'&&typeof node.properties[key].const==='string')
  ||record?.type!=='object'||!record.required?.includes('recordId')||!Array.isArray(ids)||!ids.length
  ||ids.some(id=>typeof id!=='string')||new Set(ids).size!==ids.length)return undefined
 return {port,metadata:Object.fromEntries(metadataKeys.map(key=>[key,node.properties![key].const as string])),ids:ids as string[]}
}
function frozenWireSchema(schema:ObjectJsonSchema):ObjectJsonSchema|undefined{
 const identity=frozenIdentity(schema)
 if(!identity)return undefined
 return {type:'object',additionalProperties:false,required:['wireVersion','fullNativeSchemaHash','submissionJson','records'],properties:{
  wireVersion:{type:'string',const:NATIVE_MODULE_FROZEN_JSON_WIRE_VERSION},fullNativeSchemaHash:{type:'string',const:hash(schema)},
  submissionJson:{type:'string',description:'完整主结果JSON；outputs端口保留quality/limitations，省略records及已冻结type/scope/asOf。其他字段全部由你填写。'},
  records:{type:'array',description:'每个冻结recordId恰好出现一次。逐条选择身份并在同一对象recordJson填写该对象全部专业字段；不按位置映射。',
   items:{type:'object',additionalProperties:false,required:['port','recordId','recordJson'],properties:{
    port:{type:'string',const:identity.port},recordId:{type:'string',enum:[...identity.ids]},
    recordJson:{type:'string',description:'该明确recordId的完整记录JSON，省略recordId；resultClass及本组全部专业字段仍由你完整填写。'}}}}}}
}
function parseObject(text:unknown,field:string,recordId?:string):Record<string,unknown>{
 if(typeof text!=='string')return invalid(field+' must be complete JSON')
 let value:unknown;try{value=JSON.parse(text)}catch(error){return invalid(field+' must be complete JSON'+(recordId?'; recordId='+recordId:'')+syntaxLocation(error))}
 return object(value)?value:invalid(field+' must be an object')
}
/** A rejected parsed original is evidence for correction, never a candidate.
 * Preserve it separately from the native wire arguments without changing it. */
export class NativeModuleJsonWireSchemaError extends Error {
 constructor(readonly decodedSubmission:Record<string,unknown>,errors:readonly string[],schema?:ObjectJsonSchema){
  const details=schema?nestedUnionRejectionDetails(schema,decodedSubmission):[]
  super('MODULE_NATIVE_JSON_WIRE_INVALID: original field schema rejected submission: '+errors.slice(0,8).join('; ')
   +(details.length?'; nested rejected-branch details (diagnostic only, no branch accepted): '+details.join('; '):''))
  this.name='NativeModuleJsonWireSchemaError'
 }
}
/** The SDK reports a failed union only at its parent path. Reveal bounded
 * leaf errors from structurally aligned failing branches for author correction.
 * This neither selects a reference nor changes validation or submitted data. */
function nestedUnionRejectionDetails(schema:ObjectJsonSchema,value:unknown):string[]{
 const details:string[]=[],seen=new Set<string>();let visited=0
 const add=(error:string)=>{
  if(details.length>=8||error.includes('must match exactly one oneOf branch'))return
  const bounded=error.length>400?error.slice(0,397)+'...':error
  if(!seen.has(bounded)){seen.add(bounded);details.push(bounded)}
 }
 function visit(node:NonNullable<ObjectJsonSchema['properties']>[string],child:unknown,path:string,depth:number):void{
  if(depth>12||++visited>3000||details.length>=8)return
  if(node.oneOf){
   const branches=node.oneOf.map(branch=>({schema:branch,errors:validateJsonSchemaValue(branch,child,path),
    aligned:object(child)?Object.keys(child).filter(key=>Object.hasOwn(branch.properties??{},key)).length:0}))
   // Matching branches are not candidates for a zero-match diagnostic. An
   // ambiguous union retains the SDK's original rejection without new hints.
   if(branches.some(branch=>branch.errors.length===0))return
   branches.sort((a,b)=>b.aligned-a.aligned||a.errors.length-b.errors.length)
   const best=branches[0]
   for(const branch of branches.filter(branch=>branch.aligned===best?.aligned&&branch.errors.length===best?.errors.length).slice(0,2)){
    branch.errors.forEach(add);visit(branch.schema,child,path,depth+1)
   }
   return
  }
  if(object(child))for(const [key,property] of Object.entries(node.properties??{})){
   if(Object.hasOwn(child,key))visit(property,child[key],path+'.'+key,depth+1)
  }
  if(Array.isArray(child)&&node.items)for(let index=0;index<child.length&&details.length<8;index++)visit(node.items,child[index],path+'['+index+']',depth+1)
 }
 visit(schema,value,'value',0)
 return details
}
const instruction='本次structured_output以wireVersion="native-json-submission.v1"和submissionJson字符串传输。先按完整fullNativeSchema填写所有原生字段，再将整个结果一次JSON序列化；不得省略字段、改写原文或提交输入字典标记。宿主仅解析，继续按原Schema、来源、计算与独审核验；解析不等于通过。'
const frozenInstruction='本次采用显式native-frozen-submission.v2传输，不重复抄写已经冻结的技术身份。完整fullNativeSchema及其哈希保持：fullNativeSchemaHash必须选择工具给定值；submissionJson填写主结果和outputs端口quality/limitations等全部非记录字段，省略该端口records及已冻结type/scope/asOf。records数组逐条在原生工具中选择port/recordId，在同一条recordJson填写该明确对象的resultClass及全部本组专业字段，省略recordId。每个冻结recordId恰好一次，顺序不限；evidence和stepResults中的引用仍须使用真实冻结编号。宿主只恢复省略的固定type/scope/asOf及你明确选择的recordId，不按位置猜配，不填专业值或resultClass。若提交任何冲突身份/范围、漏记、重复或额外主结果records仍拒绝。来源、步骤、计算、综合及独审核验全部保持；固定技术身份不是已核事实，人工确认进入备注。'

/** Capacity fallback only. The model still authors every original field. The
 * complete original schema travels as a hash-bound readable input; tool-string
 * acceptance never establishes original-schema or professional acceptance. */
export function prepareNativeModuleJsonWire(prompt:string,schema:ObjectJsonSchema):{prompt:string;schema:ObjectJsonSchema;version:NativeModuleSubmissionWireAudit['version']}{
 assertObjectJsonSchema(schema)
 const frozenSchema=frozenWireSchema(schema),version=frozenSchema?NATIVE_MODULE_FROZEN_JSON_WIRE_VERSION:NATIVE_MODULE_JSON_WIRE_VERSION
 const description=shareNativeSchemaDescription(schema)
 const binding={nativeSubmissionWire:{version,fullNativeSchema:description,fullNativeSchemaHash:hash(schema)}}
 const identity=frozenSchema?frozenIdentity(schema):undefined
 const port=identity?schema.properties!.outputs.properties![identity.port]:undefined
 const shape=identity?{nativeSubmissionShape:{submissionJson:{required:[...schema.required??[]],outputPort:identity.port,
  requiredPortFields:port!.required!.filter(key=>key!=='records'&&!metadataKeys.some(frozen=>frozen===key))},
  recordJson:{required:port!.properties!.records.items!.required!.filter(key=>key!=='recordId')}}}:undefined
 // Prompt guidance only: preserve the original v2 tool schema byte-for-byte,
 // so every already saved native selection still replays against its schema.
 const complete=compactNativeModuleRejectionPrompt(prompt)+'\n'+JSON.stringify(binding)
  +(object(description)&&description.encoding==='native-schema-reference.v1'?'\n'+nativeSchemaReferenceInstruction:'')+'\n'+(frozenSchema?frozenInstruction:instruction)
  +(shape?'\n'+JSON.stringify(shape)+'\nsubmissionJson必须保留全部required根字段和明确outputs[outputPort]对象；quality/limitations不能直接替代outputs，evidence、limitations、stepResults等原必填字段不能漏交。recordJson仅填写该明确对象，全部业务值、证据和步骤仍由你原生生成。':'')
 return {prompt:shareNativeModulePrompt(complete),schema:frozenSchema??structuredClone(NATIVE_MODULE_JSON_WIRE_SCHEMA),version}
}
export function decodeNativeModuleJsonWire(value:unknown,schema:ObjectJsonSchema):unknown{
 if(object(value)&&value.wireVersion===NATIVE_MODULE_FROZEN_JSON_WIRE_VERSION){
  const wireSchema=frozenWireSchema(schema),identity=frozenIdentity(schema)
  if(!wireSchema||!identity)return invalid('original schema has no unique frozen group identity')
  const wireErrors=validateJsonSchemaValue(wireSchema,value)
  if(wireErrors.length)return invalid('frozen native envelope rejected: '+wireErrors.slice(0,8).join('; '))
  const decoded=parseObject(value.submissionJson,'submissionJson')
  if(!object(decoded.outputs)||!Object.hasOwn(decoded.outputs,identity.port))return invalid('explicit original output port required')
  const port=decoded.outputs[identity.port]
  if(!object(port))return invalid('explicit original output port required')
  if(Object.hasOwn(port,'records'))return invalid('records must be explicitly selected in native envelope only; forbidden submissionJson.outputs.'+identity.port+'.records')
  for(const key of metadataKeys){
   if(Object.hasOwn(port,key)&&port[key]!==identity.metadata[key])return invalid('conflicting frozen '+key)
   if(!Object.hasOwn(port,key))port[key]=identity.metadata[key]
  }
  const records:Record<string,unknown>[]=[],seen=new Set<string>()
  for(const entry of value.records as {port:string;recordId:string;recordJson:string}[]){
   if(seen.has(entry.recordId))return invalid('duplicate explicitly selected recordId')
   seen.add(entry.recordId)
   const record=parseObject(entry.recordJson,'recordJson',entry.recordId)
   if(Object.hasOwn(record,'recordId')&&record.recordId!==entry.recordId)return invalid('conflicting explicitly selected recordId')
   if(!Object.hasOwn(record,'recordId'))record.recordId=entry.recordId
   records.push(record)
  }
  if(seen.size!==identity.ids.length||identity.ids.some(id=>!seen.has(id)))return invalid('every frozen recordId must be explicitly selected once')
  port.records=records
  const errors=validateJsonSchemaValue(schema,decoded)
  if(errors.length)throw new NativeModuleJsonWireSchemaError(decoded,errors,schema)
  return decoded
 }
 if(!object(value)||Object.keys(value).length!==2||value.wireVersion!==NATIVE_MODULE_JSON_WIRE_VERSION||typeof value.submissionJson!=='string')return invalid('tag and complete JSON string required')
 let decoded:unknown
 try{decoded=JSON.parse(value.submissionJson)}catch(error){return invalid('submissionJson must be one complete JSON object'+syntaxLocation(error))}
 if(!object(decoded))return invalid('original result must be an object')
 const errors=validateJsonSchemaValue(schema,decoded)
 if(errors.length)throw new NativeModuleJsonWireSchemaError(decoded,errors,schema)
 return decoded
}

/** Wire decoding during replay requires the actual native tool schema and its
 * unique full-schema commitment in the same turn, never a payload lookalike. */
export function readNativeModuleJsonWireSchema(events:readonly SessionEventLike[]):ObjectJsonSchema|undefined{
 const headers=events.filter(event=>event.type==='request/header'),last=headers.at(-1)
 const tools=object(last?.data)&&object(last.data.header)?last.data.header.tools:undefined
 const tool=Array.isArray(tools)?tools.find(value=>object(value)&&value.name==='structured_output'):undefined
 if(!object(tool)||!object(tool.parameters)||!object(tool.parameters.properties)||!object(tool.parameters.properties.wireVersion))return undefined
 const version=tool.parameters.properties.wireVersion.const
 if(version!==NATIVE_MODULE_JSON_WIRE_VERSION&&version!==NATIVE_MODULE_FROZEN_JSON_WIRE_VERSION)return undefined
 if(version===NATIVE_MODULE_JSON_WIRE_VERSION&&hash(tool.parameters)!==hash(NATIVE_MODULE_JSON_WIRE_SCHEMA))return undefined
 const bindings=new Map<string,ObjectJsonSchema>()
 for(const event of events.filter(value=>value.type==='user/message')){
  const blocks=object(event.data)?event.data.content:undefined
  if(!Array.isArray(blocks))continue
  for(const block of blocks){
   if(!object(block)||block.type!=='text'||typeof block.text!=='string')continue
   for(const line of block.text.split('\n')){
    let value:unknown;try{value=expandModuleReferencePromptView(JSON.parse(line))}catch{continue}
    const parts=object(value)&&Array.isArray(value.orderedNativeInput)?value.orderedNativeInput:[{json:value}]
    for(const part of parts){
     const body=object(part)&&object(part.json)?part.json.nativeSubmissionWire:undefined
     if(!object(body))continue
     if(Object.keys(body).length!==3||body.version!==version||typeof body.fullNativeSchemaHash!=='string'||!object(body.fullNativeSchema))return invalid('native full-schema commitment malformed')
     const originalSchema=expandNativeSchemaDescription(body.fullNativeSchema)
     if(hash(originalSchema)!==body.fullNativeSchemaHash)return invalid('native full-schema commitment changed')
     bindings.set(body.fullNativeSchemaHash,originalSchema)
    }
   }
  }
 }
 if(bindings.size!==1)return invalid('exactly one native full-schema commitment required')
 const schema=[...bindings.values()][0]
 if(version===NATIVE_MODULE_FROZEN_JSON_WIRE_VERSION){
  const expected=frozenWireSchema(schema)
  if(!expected||hash(tool.parameters)!==hash(expected))return invalid('native frozen selection constraints changed')
 }
 return schema
}
