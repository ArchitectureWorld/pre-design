import {expect,it} from 'vitest'
import {createHash} from 'node:crypto'
import * as groups from '../src/research-v2/module-author-groups.ts'
import {getModuleFieldContracts} from '../src/research-v2/module-contracts.ts'
import {sha256CanonicalJson} from '../src/presentation/canonical-json.ts'
import {moduleRecoveryFeedback} from '../src/research-v2/module-recovery-feedback.ts'
import {materialCorpusFingerprint} from '../src/materials/research-evidence.ts'
const old='module-author-field-group.v8' as const,newest='module-author-field-group.v9' as any
const base={documents:[],limitations:['Synthetic version replay only']},corpus={...base,fingerprint:createHash('sha256').update(JSON.stringify(base)).digest('hex')}
function submissions(version:any){return groups.getModuleAuthorFieldGroups('3.01',version).map(group=>({projectionVersion:version,groupId:group.groupId,
  outputs:{market_context:{type:getModuleFieldContracts('3.01').ports.market_context.type,scope:'Synthetic market replay',asOf:'2026-10-02',quality:'limited' as const,limitations:['No original statistical evidence'],
    records:[{recordId:'test-row',resultClass:'observation_summary',...Object.fromEntries(group.fields.map(field=>[field,{value:null,claimClass:'missing',limitations:['No original evidence']}]))}]}},
  evidence:[],limitations:['Synthetic only'],stepResults:Object.fromEntries([1,2,3,4].map(step=>['step'+step,{status:'limited',summary:'Incomplete synthetic research',fieldRefs:[],limitations:['No native model execution']}])) as any}))}
const receipt=(index:number)=>({executionId:'synthetic-e'+index,childId:'synthetic-c'+index,actualModel:{provider:'test',model:'test'},stopReason:'completed'})
it('delivers the original rejected source-field diagnostic to the split market correction without relabeling its draft',()=>{
  const raw=submissions(old)[1],record:any=raw.outputs.market_context.records[0]
  record.classification={value:'人为分类说明',claimClass:'source_conclusion',limitations:['Synthetic rejected field']}
  raw.evidence=[{kind:'source',target:{port:'market_context',recordId:'test-row',field:'classification',at:''},source:{path:'original.txt',quote:'GDP',valueQuote:'人为分类说明'}}] as any
  const original=structuredClone(raw),audit={attempts:[{classId:'text',groupId:'market_context:2',status:'failed',error:'MODULE_SOURCE_VALUE_TEXT: rejected original field',structuredOutput:raw},{classId:'text',groupId:'market_context:2',status:'failed',error:'MODULE_NATIVE_max-tokens'}],reviewReceipts:[]}
  const originalSource={documents:[{path:'original.txt',text:'GDP',byteLength:3,contentHash:createHash('sha256').update('GDP').digest('hex')}],limitations:[]}
  const feedback=moduleRecoveryFeedback({resumeExecutionAudit:audit,corpus:{...originalSource,fingerprint:materialCorpusFingerprint(originalSource)} as any,resumeExecutionError:'MODULE_NATIVE_max-tokens'},'market_context:2.2')
  expect(feedback).toContain('fieldTextConflicts')
  expect(feedback).toContain(sha256CanonicalJson(raw))
  expect(feedback).toContain('requestedGroupId')
  expect(feedback).toContain('market_context:2.2')
  expect(raw).toEqual(original)
})
it('bounds the truncated market value and classification groups without regenerating the original first-group record anchors',()=>{
  const historical=groups.getModuleAuthorFieldGroups('3.01',old),current=groups.getModuleAuthorFieldGroups('3.01',newest)
  expect(current).toEqual([historical[0],{groupId:'market_context:2.1',port:'market_context',fields:['originalValue','normalizedValue']},{groupId:'market_context:2.2',port:'market_context',fields:['classification','statisticalBasis']},
    {groupId:'market_context:3.1',port:'market_context',fields:['priceBasis','revisionStatus']},{groupId:'market_context:3.2',port:'market_context',fields:['denominator','formula']},
    {groupId:'market_context:4.1',port:'market_context',fields:['projectImpactHypothesis']},{groupId:'market_context:4.2',port:'market_context',fields:['policyVision']}])
  expect(current.flatMap(g=>g.fields)).toEqual(historical.flatMap(g=>g.fields))
  expect(new Set(current.flatMap(g=>g.fields)).size).toBe(historical.flatMap(g=>g.fields).length)
  const schema:any=groups.getModuleAuthorGroupSchema('3.01','market_context:2.1')
  expect(schema.properties.projectionVersion.const).toBe(groups.getModuleAuthorGroupVersion('3.01'))
  expect(schema.properties.outputs.properties.market_context.properties.records.items.required).toEqual(['recordId','resultClass','originalValue','normalizedValue'])
  for(const item of ['1.01','1.07','2.03','3.04'])expect(groups.getModuleAuthorFieldGroups(item)).toEqual(groups.getModuleAuthorFieldGroups(item,old))
})
it('replays historical market audits and the exact v8 first-group receipt in a separately bound v9 audit without rewriting raw values',()=>{
  const historical=submissions(old),previous=structuredClone(historical),candidate=groups.compileModuleAuthorGroups('3.01',historical,corpus)
  const audit=groups.createModuleAuthorGroupsAudit('3.01',historical.map((raw,index)=>({raw,receipt:receipt(index)})),candidate)
  expect(audit.version).toBe(old);expect(groups.replayModuleAuthorGroups('3.01',corpus,audit)).toEqual(candidate)
  const mixed=submissions(newest);mixed[0]=historical[0]
  expect(groups.isCurrentModuleAuthorPrefix('3.01',mixed.slice(0,1))).toBe(true)
  expect(groups.isCurrentModuleAuthorPrefix('3.01',historical.slice(0,2))).toBe(false)
  const firstHash=sha256CanonicalJson(historical[0]),compiled=groups.compileModuleAuthorGroups('3.01',mixed,corpus)
  const current=groups.createModuleAuthorGroupsAudit('3.01',mixed.map((raw,index)=>({raw,receipt:receipt(index)})),compiled)
  expect(current.version).toBe(newest);expect(current.groups[0].raw.projectionVersion).toBe(old);expect(current.groups[0].projectionHash).toBe(firstHash)
  expect(groups.replayModuleAuthorGroups('3.01',corpus,current)).toEqual(compiled)
  expect(historical).toEqual(previous)
  const damaged=structuredClone(current);(damaged.groups[1].raw as any).projectionVersion=old
  expect(()=>groups.replayModuleAuthorGroups('3.01',corpus,damaged)).toThrow()
})
