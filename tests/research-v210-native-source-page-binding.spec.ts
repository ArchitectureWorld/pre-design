import {createHash} from 'node:crypto'
import Ajv from 'ajv'
import {describe,expect,it} from 'vitest'
import {assertObjectJsonSchema,type ObjectJsonSchema} from '@deepseek-ai/dsh-tools'
import {bindNativeModuleEvidenceSchema,getModuleAuthorProjectionSchema} from '../src/research-v2/module-author-projection.ts'
import {bindNativeFrozenSourcePaths} from '../src/research-v2/native-source-path-schema.ts'
import {verifyModuleSourceValues} from '../src/research-v2/module-claims.ts'
import {materialCorpusFingerprint} from '../src/materials/research-evidence.ts'

const text='本规定适用于在本市行政区域内湖泊、水库从事航行、游乐等活动。'
const contentHash=createHash('sha256').update(text).digest('hex')
const webPath='research/runs/RUN-11111111-1111-4111-8111-111111111111/sources/frozen-web.json'
const pdfPath='original/policy.pdf',otherPdfPath='original/other.pdf'
const base={documents:[{path:webPath,contentHash,text,byteLength:Buffer.byteLength(text)},
  {path:pdfPath,contentHash,pages:[{page:1,text},{page:3,text}],byteLength:100},
  {path:otherPdfPath,contentHash,pages:[{page:2,text}],byteLength:100}],limitations:[]}
const corpus={...base,fingerprint:materialCorpusFingerprint(base)}
const target={port:'planning_conditions',recordId:'water-traffic',field:'constraintObject',at:''}
const source=(path:string,page?:number)=>({target,kind:'source',source:{path,quote:text,...(page===undefined?{}:{page})}})
const bound=()=>bindNativeFrozenSourcePaths(bindNativeModuleEvidenceSchema(getModuleAuthorProjectionSchema('1.03')),corpus)
const check=()=>new Ajv({strict:false,allErrors:true}).compile(bound().properties!.evidence.items!)

describe('native frozen source physical page binding',()=>{
  it('rejects the unpaginated web source with an invented page before native acceptance',()=>{
    const validate=check(),evidence=source(webPath,2),before=JSON.stringify(evidence)
    expect(()=>verifyModuleSourceValues(corpus,[{sourceId:'actual-rejection',path:webPath,contentHash,quote:text,rawValue:text,page:2}])).toThrow('MODULE_SOURCE_VALUE_LOCATION')
    expect(validate(evidence)).toBe(false)
    expect(JSON.stringify(evidence)).toBe(before)
  })
  it('keeps the original unpaginated quote and binding valid with the page member omitted',()=>{
    const evidence=source(webPath),before=JSON.stringify(evidence)
    expect(check()(evidence)).toBe(true)
    expect(()=>verifyModuleSourceValues(corpus,[{sourceId:'original-web',path:webPath,contentHash,quote:text,rawValue:text}])).not.toThrow()
    expect(JSON.stringify(evidence)).toBe(before)
  })
  it('requires an actual physical page from the selected PDF rather than another document',()=>{
    const validate=check()
    for(const page of [1,3])expect(validate(source(pdfPath,page))).toBe(true)
    expect(validate(source(pdfPath))).toBe(false)
    expect(validate(source(pdfPath,2))).toBe(false)
    expect(validate(source(otherPdfPath,2))).toBe(true)
    expect(validate(source(otherPdfPath,1))).toBe(false)
  })
  it('rejects invented page members on source calculation operands and weights',()=>{
    const validate=check(),operand={source:{path:webPath,quote:text},value:5}
    const evidence={target,kind:'calculation',calculation:{operation:'weighted_mean',operands:[operand],weights:[operand]}}
    expect(validate(evidence)).toBe(true)
    for(const member of ['operands','weights'] as const){
      const rejected=structuredClone(evidence)
      Object.assign(rejected.calculation[member][0].source,{page:2})
      expect(validate(rejected)).toBe(false)
    }
  })
  it('retains frozen path constants without adding the complete corpus to every query branch',()=>{
    const schema={type:'object',additionalProperties:false,required:['evidence'],properties:{evidence:{type:'array',items:{type:'object',additionalProperties:false,required:['source'],properties:{source:{type:'object',additionalProperties:false,required:['path','quote'],properties:{path:{type:'string',const:webPath},quote:{type:'string'},page:{type:'integer'}}}}}}}} as ObjectJsonSchema
    const boundSchema=bindNativeFrozenSourcePaths(schema,corpus),validate=new Ajv({strict:false}).compile(boundSchema)
    expect(validate({evidence:[{source:{path:webPath,quote:text}}]})).toBe(true)
    expect(validate({evidence:[{source:{path:webPath,quote:text,page:2}}]})).toBe(false)
    expect(validate({evidence:[{source:{path:pdfPath,quote:text,page:1}}]})).toBe(false)
    expect(JSON.stringify(boundSchema)).not.toContain(otherPdfPath)
  })
  it('preserves source bytes and replay schemas and does not approve business support',()=>{
    const schema=bindNativeModuleEvidenceSchema(getModuleAuthorProjectionSchema('1.03')),before=JSON.stringify({schema,corpus})
    const native=bindNativeFrozenSourcePaths(schema,corpus)
    expect(()=>assertObjectJsonSchema(native)).not.toThrow()
    expect(JSON.stringify({schema,corpus})).toBe(before)
    expect(check()({target,kind:'source',source:{path:webPath,quote:'invented statement'}})).toBe(true)
    expect(()=>verifyModuleSourceValues(corpus,[{sourceId:'unsupported-business',path:webPath,contentHash,quote:'invented statement',rawValue:'open'}])).toThrow('MODULE_SOURCE_VALUE_QUOTE')
  })
})
