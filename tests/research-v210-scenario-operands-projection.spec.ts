import {expect,it} from 'vitest'
import {assertObjectJsonSchema,validateJsonSchemaValue} from '@deepseek-ai/dsh-tools'
import {materialCorpusFingerprint} from '../src/materials/research-evidence.ts'
import {MODULE_AUTHOR_PROJECTION_VERSION,compileModuleAuthorProjection,getModuleAuthorProjectionSchema,bindNativeModuleEvidenceSchema,validateModuleProjectionFields} from '../src/research-v2/module-author-projection.ts'
import {getModuleFieldContracts} from '../src/research-v2/module-contracts.ts'
import {validateModuleClaims} from '../src/research-v2/module-claims.ts'

function fixture(){
 const missing=()=>({value:null,claimClass:'missing',limitations:['本测试不研究该字段。']})
 const record:any={recordId:'test-option',resultClass:'proposal'}
 for(const key of ['optionId','comparisonBoundary','basePeriod','goals','earlyCapacity','spatialSketch','availableAssets','permissions','capex','opex',
  'incomeOrServiceHypotheses','operatingMode','infeasibleItems','appraisalReasons','sensitiveParameters','recommendationConditions'])record[key]=missing()
 record.capex={value:{minimum:2000,maximum:4000,currency:'CNY',basis:'测试拟议工作量与单价；非项目事实。'},claimClass:'assumption',limitations:['只支持条件情景。']}
 const target=(at:string)=>({port:'option_appraisal',recordId:'test-option',field:'capex',at})
 const evidence:any[]=[20,40].map((price,index)=>({target:target(index?'/maximum':'/minimum'),kind:'calculation',unit:'CNY',rationale:'测试用100平方米乘单价区间。',calculation:{basis:'scenario',operation:'product',operands:[
  {scenarioAssumption:{value:100,unit:'平方米',rationale:'测试拟议工作量；非实测。'}},
  {scenarioAssumption:{value:price,unit:'CNY/平方米',rationale:'测试单价；非供应商报价。'}},
 ]}}))
 evidence.push(...['currency','basis'].map(key=>({target:target('/'+key),kind:'assumption',rationale:'测试区间的明确口径。'})))
 const raw:any={projectionVersion:MODULE_AUTHOR_PROJECTION_VERSION,outputs:{option_appraisal:{type:'planning.option_appraisal.v1.2',scope:'测试条件方案',asOf:'2026-10-12',quality:'limited',limitations:['只测试条件成本。'],records:[record]}},
  evidence,limitations:['测试没有来源材料；不能作为实施结论。'],steps:[1,2,3,4].map(step=>({step,status:'limited',summary:'只执行该条件成本接口测试。',fieldRefs:[],limitations:['其余研究没有执行。']}))}
 const body={documents:[],limitations:['纯条件测试，没有现场原始资料。']}
 return {raw,corpus:{...body,fingerprint:materialCorpusFingerprint(body)}}
}
it('passes the native schema and compiles the exact authored cost range and operands without a source',()=>{
 const {raw,corpus}=fixture(),before=JSON.stringify(raw),schema=bindNativeModuleEvidenceSchema(getModuleAuthorProjectionSchema('4.04'))
 assertObjectJsonSchema(schema);expect(validateJsonSchemaValue(schema,raw)).toEqual([])
 const candidate=compileModuleAuthorProjection('4.04',raw,corpus)
 const validated=validateModuleClaims({...candidate,moduleId:getModuleFieldContracts('4.04').moduleId,upstream:[]})
 const port:any=candidate.outputs.option_appraisal
 expect(port.records[0].capex.value).toEqual({minimum:2000,maximum:4000,currency:'CNY',basis:'测试拟议工作量与单价；非项目事实。'})
 expect(validated.claims.filter(c=>c.calculation).map(c=>c.value)).toEqual([2000,4000])
 expect(candidate.sourceValues).toEqual([])
 expect(JSON.stringify(raw)).toBe(before)
})
it('rejects using the same authored operands as source-based calculations after compilation',()=>{
 const {raw,corpus}=fixture();raw.evidence[0].calculation.basis='source'
 // Keep field classification aligned with the factual calculation protocol;
 // rejection must come from its assumption operand rather than a class error.
 raw.outputs.option_appraisal.records[0].capex.claimClass='agent_inference'
 raw.evidence[1].calculation.basis='source';raw.evidence[2].kind=raw.evidence[3].kind='proposal'
 const candidate=compileModuleAuthorProjection('4.04',raw,corpus)
 expect(()=>validateModuleClaims({...candidate,moduleId:getModuleFieldContracts('4.04').moduleId,upstream:[]})).toThrow('MODULE_CALCULATION_UNVERIFIED_OPERAND')
})
it('requires scenario calculation explanations at the author field boundary without inventing them from operand reasons',()=>{
 const {raw,corpus}=fixture(),record=raw.outputs.option_appraisal.records[0]
 const projection={...raw,outputs:{option_appraisal:{...raw.outputs.option_appraisal,records:[{
  recordId:record.recordId,resultClass:record.resultClass,capex:record.capex,
 }]}}}
 const selection={option_appraisal:['capex']}
 expect(()=>validateModuleProjectionFields('4.04',projection,selection,corpus)).not.toThrow()
 delete projection.evidence[0].rationale
 const before=JSON.stringify(projection)
 expect(()=>validateModuleProjectionFields('4.04',projection,selection,corpus))
  .toThrow(/MODULE_CALCULATION_SCENARIO_RATIONALE_REQUIRED:.*capex.*minimum/)
 expect(JSON.stringify(projection)).toBe(before)
 const candidate=compileModuleAuthorProjection('4.04',{...raw,evidence:projection.evidence},corpus)
 expect(()=>validateModuleClaims({...candidate,moduleId:getModuleFieldContracts('4.04').moduleId,upstream:[]}))
  .toThrow('MODULE_CALCULATION_SCENARIO_RATIONALE_REQUIRED')
})
