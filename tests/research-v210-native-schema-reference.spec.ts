import { expect, it } from 'vitest'
import { assertObjectJsonSchema, validateJsonSchemaValue, type ObjectJsonSchema, type JsonSchemaNode } from '@deepseek-ai/dsh-tools'
import { prepareNativeModuleJsonWire, readNativeModuleJsonWireSchema, decodeNativeModuleJsonWire } from '../src/research-v2/native-submission-wire.ts'
import { expandModuleReferencePromptView } from '../src/research-v2/module-reference-context.ts'
import { sha256CanonicalJson as hash } from '../src/presentation/canonical-json.ts'

function fixture() {
  const identity: JsonSchemaNode = { oneOf: [
    { type: 'object', properties: { moduleId: { type: 'string', const: '1.01' }, claimId: { type: 'string', enum: Array.from({length:80},(_,i)=>'claim-allowed-source-'+i) } }, required: ['moduleId','claimId'], additionalProperties: false },
    { type: 'object', properties: { moduleId: { type: 'string', const: '2.01' }, claimId: { type: 'string', const: 'claim-other-module' } }, required: ['moduleId','claimId'], additionalProperties: false },
  ] }
  const schema: ObjectJsonSchema = { type: 'object', properties: Object.fromEntries(Array.from({length:40},(_,i)=>['field'+i,structuredClone(identity)])), required: Array.from({length:40},(_,i)=>'field'+i), additionalProperties: false }
  const value = Object.fromEntries(Array.from({length:40},(_,i)=>['field'+i,{moduleId:'1.01',claimId:'claim-allowed-source-0'}]))
  const wire = prepareNativeModuleJsonWire('研究要求保持；正文中的数值不能升级为已核事实。',schema)
  const expanded = wire.prompt.split('\n').flatMap(line=>{try{return [expandModuleReferencePromptView(JSON.parse(line))]}catch{return []}})
  const packet: any = expanded.flatMap((value:any)=>value.orderedNativeInput??[{json:value}]).map((part:any)=>part.json).find((value:any)=>value?.nativeSubmissionWire)
  const events = (body: any = packet) => [
    {seq:1,type:'user/message',data:{content:[{type:'text',text:JSON.stringify(body)}]}},
    {seq:2,type:'request/header',data:{header:{tools:[{name:'structured_output',parameters:wire.schema}]}}},
  ]
  return { schema, value, wire, packet, events }
}

it('shares duplicate schema structures in the readable input and recovers the complete original schema', () => {
  const {schema,wire,packet,events}=fixture(),view=packet.nativeSubmissionWire.fullNativeSchema
  expect(view.encoding).toBe('native-schema-reference.v1')
  expect(view.definitions.length).toBeGreaterThan(0)
  expect(readNativeModuleJsonWireSchema(events())).toEqual(schema)
  assertObjectJsonSchema(wire.schema)
  expect(JSON.stringify(wire.schema)).not.toContain('$ref')
  expect(hash(packet.nativeSubmissionWire.fullNativeSchema)).not.toBe(hash(schema))
  expect(packet.nativeSubmissionWire.fullNativeSchemaHash).toBe(hash(schema))
})

it('keeps successful business values and rejects wrong correlated identities after descriptor recovery', () => {
  const {schema,value,wire,events}=fixture(),recovered=readNativeModuleJsonWireSchema(events())!
  expect(validateJsonSchemaValue(recovered,value)).toEqual([])
  expect(decodeNativeModuleJsonWire({wireVersion:wire.version,submissionJson:JSON.stringify(value)},recovered)).toEqual(value)
  value.field0={moduleId:'1.01',claimId:'claim-other-module'}
  expect(validateJsonSchemaValue(recovered,value).length).toBeGreaterThan(0)
  expect(()=>decodeNativeModuleJsonWire({wireVersion:wire.version,submissionJson:JSON.stringify(value)},recovered)).toThrow('MODULE_NATIVE_JSON_WIRE')
  expect(recovered).toEqual(schema)
})

it.each(['hash','definition','cycle','index','extra'] as const)('refuses a damaged %s schema descriptor before accepting the commitment', damage=>{
  const {packet,events}=fixture(),view=packet.nativeSubmissionWire.fullNativeSchema
  expect(view.encoding).toBe('native-schema-reference.v1')
  if(damage==='hash')view.originalHash='f'.repeat(64)
  if(damage==='definition')view.definitions[0]={type:'string'}
  if(damage==='cycle')view.definitions[0]={[view.refKey]:0}
  if(damage==='index')view.schema={[view.refKey]:view.definitions.length+1}
  if(damage==='extra')view.extra='unverified'
  expect(()=>readNativeModuleJsonWireSchema(events())).toThrow('MODULE_NATIVE_SCHEMA_REFERENCE_INVALID')
})

it('preserves all older uncompressed schema commitments and does not encode a small unique schema',()=>{
  const schema: ObjectJsonSchema={type:'object',properties:{value:{type:'number'}},required:['value'],additionalProperties:false}
  const wire=prepareNativeModuleJsonWire('原指令',schema)
  const body={nativeSubmissionWire:{version:wire.version,fullNativeSchema:schema,fullNativeSchemaHash:hash(schema)}}
  expect(readNativeModuleJsonWireSchema([
    {seq:1,type:'user/message',data:{content:[{type:'text',text:JSON.stringify(body)}]}},
    {seq:2,type:'request/header',data:{header:{tools:[{name:'structured_output',parameters:wire.schema}]}}},
  ])).toEqual(schema)
})
