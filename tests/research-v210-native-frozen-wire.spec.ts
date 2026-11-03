import {describe,it,expect} from 'vitest'
import type {ObjectJsonSchema,JsonSchemaNode} from '@deepseek-ai/dsh-tools'
import {prepareNativeModuleJsonWire,decodeNativeModuleJsonWire,NATIVE_MODULE_JSON_WIRE_VERSION} from '../src/research-v2/native-submission-wire.ts'
import {verifyModuleNativeSubmission} from '../src/research-v2/module-group-recovery.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'
import {expandModuleReferencePromptView} from '../src/research-v2/module-reference-context.ts'
import {findRejectedNativeSchemaSubmission,nativeSchemaCorrectionFeedback} from '../src/research-v2/native-schema-recovery.ts'

const version='native-frozen-submission.v2',route={provider:'synthetic',model:'fixture'}
function fixture(){
 const field:JsonSchemaNode={type:'object',additionalProperties:false,required:['value','claimClass','limitations'],properties:{
  value:{type:'string'},claimClass:{type:'string',enum:['decision']},limitations:{type:'array',items:{type:'string'}}}}
 const record:JsonSchemaNode={type:'object',additionalProperties:false,required:['recordId','resultClass','service'],properties:{
  recordId:{type:'string',enum:['protection-candidate','village-candidate']},resultClass:{type:'string',enum:['proposal']},service:field}}
 const port:JsonSchemaNode={type:'object',additionalProperties:false,required:['type','scope','asOf','quality','limitations','records'],properties:{
  type:{type:'string',const:'service_system'},scope:{type:'string',const:'候选服务范围，尚待人工确认。'},asOf:{type:'string',const:'2026-10-11'},
  quality:{type:'string',enum:['accepted','limited']},limitations:{type:'array',items:{type:'string'}},records:{type:'array',items:record}}}
 const schema:ObjectJsonSchema={type:'object',additionalProperties:false,required:['groupId','outputs'],properties:{groupId:{type:'string',const:'service_system:2'},
  outputs:{type:'object',additionalProperties:false,required:['service_system'],properties:{service_system:port}}}}
 const body={groupId:'service_system:2',outputs:{service_system:{quality:'limited',limitations:['人工确认放备注。']}}}
 const native={wireVersion:version,fullNativeSchemaHash:hash(schema),submissionJson:JSON.stringify(body),records:[
  {port:'service_system',recordId:'village-candidate',recordJson:JSON.stringify({resultClass:'proposal',service:{value:'社区参与体验',claimClass:'decision',limitations:[]}})},
  {port:'service_system',recordId:'protection-candidate',recordJson:JSON.stringify({resultClass:'proposal',service:{value:'水环境知识服务',claimClass:'decision',limitations:[]}})}]}
 const expected={groupId:'service_system:2',outputs:{service_system:{type:'service_system',scope:'候选服务范围，尚待人工确认。',asOf:'2026-10-11',
  quality:'limited',limitations:['人工确认放备注。'],records:[
   {recordId:'village-candidate',resultClass:'proposal',service:{value:'社区参与体验',claimClass:'decision',limitations:[]}},
   {recordId:'protection-candidate',resultClass:'proposal',service:{value:'水环境知识服务',claimClass:'decision',limitations:[]}}]}}}
 return {schema,native,expected,body}
}
function events(schema:ObjectJsonSchema,native:unknown,toolSchema:ObjectJsonSchema){return [
 {seq:1,type:'turn/start',data:{turn:1}},
 {seq:2,type:'user/message',data:{content:[{type:'text',text:JSON.stringify({nativeSubmissionWire:{version,fullNativeSchema:schema,fullNativeSchemaHash:hash(schema)}})}]}},
 {seq:3,type:'request/header',data:{header:{config:route,tools:[{name:'structured_output',parameters:toolSchema}]}}},
 {seq:4,type:'tool/call',data:{turn:1,step:0,name:'structured_output',callId:'frozen-call',arguments:JSON.stringify(native)}},
 {seq:5,type:'tool/result',data:{turn:1,step:0,message:{content:[{type:'tool-result',toolCallId:'frozen-call',isError:false}]}}},
 {seq:6,type:'turn/end',data:{turn:1,reason:{kind:'completed'}}}]
}
describe('explicit frozen identity JSON submission',()=>{
 it('explicitly lists the original mandatory main and record fields without supplying business values or changing the native selection schema',()=>{
  const {schema}=fixture()
  schema.required!.push('evidence','limitations','stepResults')
  schema.properties!.evidence={type:'array',items:{type:'object'}}
  schema.properties!.limitations={type:'array',items:{type:'string'}}
  schema.properties!.stepResults={type:'object'}
  const prepared=prepareNativeModuleJsonWire('原始业务与来源',schema)
  const parsed:any[]=prepared.prompt.split('\n').flatMap(line=>{try{return [expandModuleReferencePromptView(JSON.parse(line))]}catch{return []}})
  const shape=parsed.flatMap(v=>v.orderedNativeInput??[{json:v}]).find(p=>p.json?.nativeSubmissionShape)?.json.nativeSubmissionShape
  expect(shape).toEqual({submissionJson:{required:['groupId','outputs','evidence','limitations','stepResults'],
   outputPort:'service_system',requiredPortFields:['quality','limitations']},recordJson:{required:['resultClass','service']}})
  expect(prepared.schema.properties!.submissionJson.description).toBe('完整主结果JSON；outputs端口保留quality/limitations，省略records及已冻结type/scope/asOf。其他字段全部由你填写。')
 })
 it('constrains model-selected record identities and binds the complete original schema',()=>{
  const {schema}=fixture(),before=structuredClone(schema),prepared=prepareNativeModuleJsonWire('原始业务与来源',schema)
  expect(prepared.schema.properties!.wireVersion.const).toBe(version)
  expect(prepared.schema.properties!.fullNativeSchemaHash.const).toBe(hash(schema))
  expect(prepared.schema.properties!.records.items!.properties!.recordId.enum).toEqual(['protection-candidate','village-candidate'])
  const parsed:any[]=prepared.prompt.split('\n').flatMap(line=>{try{return [expandModuleReferencePromptView(JSON.parse(line))]}catch{return []}})
  const binding=parsed.flatMap(view=>view.orderedNativeInput??[{json:view}]).find((part:any)=>part.json?.nativeSubmissionWire).json.nativeSubmissionWire
  expect(binding.fullNativeSchema).toEqual(schema);expect(binding.fullNativeSchemaHash).toBe(hash(schema));expect(schema).toEqual(before)
 })
 it('restores omitted fixed metadata and explicitly selected IDs while preserving every business value and record order',()=>{
  const {schema,native,expected}=fixture(),before=structuredClone(native)
  expect(decodeNativeModuleJsonWire(native,schema)).toEqual(expected);expect(native).toEqual(before)
 })
 it('rejects changed hash, unknown IDs, duplicates, omissions and conflicting supplied metadata',()=>{
  const {schema,native,body}=fixture()
  const changedHash={...native,fullNativeSchemaHash:'0'.repeat(64)}
  const unknown=structuredClone(native);unknown.records[0]!.recordId='invented'
  const duplicate=structuredClone(native);duplicate.records[1]!.recordId=duplicate.records[0]!.recordId
  const wrongInner=structuredClone(native);wrongInner.records[0]!.recordJson=JSON.stringify({recordId:'protection-candidate',...JSON.parse(wrongInner.records[0]!.recordJson)})
  const wrongScope={...native,submissionJson:JSON.stringify({...body,outputs:{service_system:{...body.outputs.service_system,scope:'变更范围'}}})}
  const secondRecords={...native,submissionJson:JSON.stringify({...body,outputs:{service_system:{...body.outputs.service_system,records:[]}}})}
  for(const value of [changedHash,unknown,duplicate,wrongInner,wrongScope,secondRecords,{...native,records:native.records.slice(0,1)}])
   expect(()=>decodeNativeModuleJsonWire(value,schema)).toThrow('MODULE_NATIVE_JSON_WIRE_INVALID')
 })
 it('does not fill resultClass or business fields and retains an invalid decoded original for correction',()=>{
  const {schema,native}=fixture(),missing=structuredClone(native)
  missing.records[0]!.recordJson=JSON.stringify({service:{value:'社区参与体验',claimClass:'decision',limitations:[]}})
  let error:any;try{decodeNativeModuleJsonWire(missing,schema)}catch(value){error=value}
  expect(error?.message).toContain('MODULE_NATIVE_JSON_WIRE_INVALID')
  expect(error?.decodedSubmission?.outputs.service_system.records[0].resultClass).toBeUndefined()
  expect(error?.decodedSubmission?.outputs.service_system.records[0].service.value).toBe('社区参与体验')
  const missingField=structuredClone(native);missingField.records[0]!.recordJson=JSON.stringify({resultClass:'proposal'})
  expect(()=>decodeNativeModuleJsonWire(missingField,schema)).toThrow('original field schema rejected')
 })
 it('replays the exact native selection against its original commitment and rejects swapped native constraints',()=>{
  const {schema,native,expected}=fixture(),prepared=prepareNativeModuleJsonWire('原始来源',schema)
  expect(()=>verifyModuleNativeSubmission(events(schema,native,prepared.schema),route,expected)).not.toThrow()
  const changed=structuredClone(prepared.schema);changed.properties!.records.items!.properties!.recordId.enum=['invented']
  expect(()=>verifyModuleNativeSubmission(events(schema,native,changed),route,expected)).toThrow()
  const changedNative=structuredClone(native);changedNative.records[0]!.recordId='protection-candidate'
  expect(()=>verifyModuleNativeSubmission(events(schema,changedNative,prepared.schema),route,expected)).toThrow()
 })
 it('keeps v1 available when metadata or identity is not uniquely frozen',()=>{
  const {schema,expected}=fixture(),unfrozen=structuredClone(schema)
  delete unfrozen.properties!.outputs.properties!.service_system.properties!.scope.const
  expect(prepareNativeModuleJsonWire('原始来源',unfrozen).schema.properties!.wireVersion.const).toBe(NATIVE_MODULE_JSON_WIRE_VERSION)
  expect(decodeNativeModuleJsonWire({wireVersion:NATIVE_MODULE_JSON_WIRE_VERSION,submissionJson:JSON.stringify(expected)},schema)).toEqual(expected)
 })
 it('diagnoses the exact original evidence member error after native wire acceptance without accepting the decoded draft',()=>{
  const {schema,native,expected}=fixture(),target={port:'service_system',recordId:'village-candidate',field:'service',at:''}
  const address:JsonSchemaNode={type:'object',additionalProperties:false,required:['port','recordId','field','at'],properties:Object.fromEntries(['port','recordId','field','at'].map(key=>[key,{type:'string'}]))}
  schema.required!.push('evidence');schema.properties!.evidence={type:'array',items:{oneOf:[{type:'object',additionalProperties:false,
   required:['target','kind','rationale'],properties:{target:address,kind:{type:'string',const:'proposal'},rationale:{type:'string'}}},
   {type:'object',additionalProperties:false,required:['target','kind','rationale'],properties:{target:address,kind:{type:'string',const:'assumption'},rationale:{type:'string'}}}]}}
  const evidence=[{target,kind:'proposal',rationale:'Synthetic decision basis.',inputRefs:[]}]
  native.fullNativeSchemaHash=hash(schema);native.submissionJson=JSON.stringify({...JSON.parse(native.submissionJson),evidence})
  const original={...expected,evidence},logs=events(schema,native,prepareNativeModuleJsonWire('原始来源',schema).schema),before=hash(logs)
  const rejected=findRejectedNativeSchemaSubmission(logs,schema)!
  expect(rejected?.originalSubmission).toEqual(original);expect(rejected?.originalArgumentHash).toBe(hash(native))
  expect(rejected?.fieldDiagnostics[0]).toMatchObject({evidenceIndex:0,target,kind:'proposal',unexpectedMembers:['inputRefs']})
  const feedback=nativeSchemaCorrectionFeedback(logs,schema,'synthetic-execution','synthetic-child')
  expect(feedback).toContain('inputRefs');expect(feedback).toContain('additionalProperties: false')
  expect(()=>verifyModuleNativeSubmission(logs,route,original)).toThrow('original field schema rejected')
  expect(hash(logs)).toBe(before)
 })
 it('does not turn valid decoded wire submissions or unbound wire claims into schema rejections',()=>{
  const {schema,native}=fixture(),prepared=prepareNativeModuleJsonWire('原始来源',schema)
  expect(findRejectedNativeSchemaSubmission(events(schema,native,prepared.schema),schema)).toBeUndefined()
  const changed=structuredClone(native);changed.fullNativeSchemaHash='0'.repeat(64)
  expect(findRejectedNativeSchemaSubmission(events(schema,changed,prepared.schema),schema)).toBeUndefined()
  const different=structuredClone(schema);different.description='A different commitment'
  expect(findRejectedNativeSchemaSubmission(events(schema,native,prepared.schema),different)).toBeUndefined()
 })
})
