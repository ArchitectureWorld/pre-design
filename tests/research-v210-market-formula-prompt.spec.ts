import {expect,it} from 'vitest'
import * as groups from '../src/research-v2/module-author-groups.ts'
import {getModuleFieldContracts} from '../src/research-v2/module-contracts.ts'
import {expandModuleReferencePromptView} from '../src/research-v2/module-reference-context.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'

function prefix(): any[] {
  return groups.getModuleAuthorFieldGroups('3.01').slice(0,5).map(group=>({projectionVersion:groups.getModuleAuthorGroupVersion('3.01'),groupId:group.groupId,
    outputs:{market_context:{type:getModuleFieldContracts('3.01').ports.market_context.type,quality:'limited',scope:'Synthetic frozen statistics',asOf:'2026-10-02',limitations:['Synthetic only'],
      records:Array.from({length:10},(_,index)=>({recordId:'r'+index,resultClass:'observation_summary',
        ...Object.fromEntries(group.fields.map(field=>[field,{value:null,claimClass:'missing',limitations:['No real material']}]))}))}},
    evidence:[],limitations:['Synthetic only'],stepResults:Object.fromEntries([1,2,3,4].map(step=>['step'+step,{status:'limited',summary:'Synthetic boundary',fieldRefs:[],limitations:['Not acceptance']}]))}))
}
const api=groups as any
it('moves the repeated formula schema out of prose while retaining the closed native schema and all frozen identities',()=>{
  const raws=prefix(),before=hash(raws),schema=groups.getModuleAuthorGroupSchema('3.01','market_context:3.2.2',raws)
  const original=groups.getModuleAuthorGroupOutputsSchema('3.01','market_context:3.2.2',raws)
  const guidance=api.getModuleAuthorGroupOutputSchemaPrompt('3.01','market_context:3.2.2',raws)
  expect(guidance).toContain('structured_output')
  expect(guidance).toContain('公式文字')
  expect(guidance.length).toBeLessThan(JSON.stringify(original).length/2)
  expect(guidance).not.toContain(JSON.stringify(original))
  expect(groups.getModuleAuthorGroupSchema('3.01','market_context:3.2.2',raws)).toEqual(schema)
  expect(schema.properties?.outputs?.additionalProperties).toBe(false)
  expect(hash(raws)).toBe(before)
})
it('gives only exact original local addresses and owner hashes without modifying fields or carrying source quotes as new evidence',()=>{
  const raws=prefix(),target={port:'market_context',recordId:'r0',field:'originalValue',at:'/value'}
  raws[1].outputs.market_context.records[0].originalValue={value:{value:10,unit:'亿元',basis:'Synthetic fixture'},claimClass:'source_conclusion',limitations:['Synthetic only']}
  raws[1].evidence=[{target,kind:'source',source:{path:'synthetic.json',quote:'Never use this fixture quote as a new field source'}}]
  const before=hash(raws),full=groups.getModuleAuthorGroupPromptContext('3.01',raws)
  const scoped:any=expandModuleReferencePromptView(api.getModuleAuthorFormulaGroupPromptView('3.01','market_context:3.2.2',raws))
  expect(scoped.outputs).toEqual(full.outputs)
  expect(scoped.groupReceipts).toEqual(full.groupReceipts)
  expect(scoped.limitations).toEqual(full.limitations)
  expect(scoped.priorGroupEvidenceTargets).toEqual([{groupId:raws[1].groupId,originalSubmissionHash:hash(raws[1]),ports:{market_context:{originalValue:[['r0','/value']]}}}])
  expect(JSON.stringify(scoped.priorGroupEvidenceTargets)).not.toContain('/value/value')
  expect(JSON.stringify(scoped.priorGroupEvidenceTargets)).not.toContain('fixture quote')
  expect(scoped.priorGroupEvidenceBoundary).toContain('不是新来源')
  expect(hash(raws)).toBe(before)
})
it('never invents a reference target when the prior group has no original evidence',()=>{
  const scoped:any=expandModuleReferencePromptView(api.getModuleAuthorFormulaGroupPromptView('3.01','market_context:3.2.2',prefix()))
  expect(scoped.priorGroupEvidenceTargets).toEqual([])
})
it('preserves ordinary views and non-market schema prose while bounding market group prose',()=>{
  const raws=prefix()
  expect(api.getModuleAuthorFormulaGroupPromptView('3.01','market_context:4.1',raws)).toEqual(groups.getModuleAuthorGroupPromptView('3.01',raws))
  expect(api.getModuleAuthorGroupOutputSchemaPrompt('3.01','market_context:4.1',raws)).toContain('structured_output')
  expect(api.getModuleAuthorGroupOutputSchemaPrompt('1.01',groups.getModuleAuthorFieldGroups('1.01')[0].groupId,[])).toContain('"properties"')
})
