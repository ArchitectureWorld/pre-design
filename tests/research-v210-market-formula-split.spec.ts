import {expect,it} from 'vitest'
import {createHash} from 'node:crypto'
import * as groups from '../src/research-v2/module-author-groups.ts'
import {getModuleFieldContracts} from '../src/research-v2/module-contracts.ts'
import {sha256CanonicalJson} from '../src/presentation/canonical-json.ts'
const v8='module-author-field-group.v8' as any,v9='module-author-field-group.v9' as any,v10='module-author-field-group.v10' as any
const base={documents:[],limitations:['Synthetic version replay only']},corpus={...base,fingerprint:createHash('sha256').update(JSON.stringify(base)).digest('hex')}
function raws(version:any):any[]{return groups.getModuleAuthorFieldGroups('3.01',version).map(group=>({projectionVersion:version,groupId:group.groupId,
 outputs:{market_context:{type:getModuleFieldContracts('3.01').ports.market_context.type,scope:'Synthetic market replay',asOf:'2026-10-02',quality:'limited',limitations:['No original statistical evidence'],records:[{recordId:'test-row',resultClass:'observation_summary',...Object.fromEntries(group.fields.map(field=>[field,{value:null,claimClass:'missing',limitations:['No original evidence']}]))}]}},
 evidence:[],limitations:['Synthetic only'],stepResults:Object.fromEntries([1,2,3,4].map(step=>['step'+step,{status:'limited',summary:'Incomplete synthetic research',fieldRefs:[],limitations:['No native model execution']}]))}))}
const receipt=(index:number)=>({executionId:'synthetic-e'+index,childId:'synthetic-c'+index,actualModel:{provider:'test',model:'test'},stopReason:'completed'})
it('splits only the truncated denominator/formula pair and preserves the original first four market groups',()=>{
 const old=groups.getModuleAuthorFieldGroups('3.01',v9),plan=groups.getModuleAuthorFieldGroups('3.01')
 expect(groups.getModuleAuthorGroupVersion('3.01')).toBe(v10)
 expect(plan).toEqual([...old.slice(0,4),{groupId:'market_context:3.2.1',port:'market_context',fields:['denominator']},{groupId:'market_context:3.2.2',port:'market_context',fields:['formula']},...old.slice(5)])
 expect(plan.flatMap(g=>g.fields)).toEqual(old.flatMap(g=>g.fields))
 for(const [id,field] of [['market_context:3.2.1','denominator'],['market_context:3.2.2','formula']]){const schema:any=groups.getModuleAuthorGroupSchema('3.01',id);expect(schema.properties.projectionVersion.const).toBe(v10);expect(schema.properties.outputs.properties.market_context.properties.records.items.required).toEqual(['recordId','resultClass',field])}
 for(const item of ['1.01','1.07','2.03','3.04'])expect(groups.getModuleAuthorFieldGroups(item)).toEqual(groups.getModuleAuthorFieldGroups(item,v8))
})
it('reuses an exact mixed v8/v9 four-group prefix without accepting the failed old two-field group as a new author',()=>{
 const prior=raws(v9).slice(0,4);prior[0]=raws(v8)[0];const original=structuredClone(prior)
 expect(groups.isCurrentModuleAuthorPrefix('3.01',prior)).toBe(true)
 expect(groups.isCurrentModuleAuthorPrefix('3.01',[...prior,raws(v9)[4]])).toBe(false)
 const relabeled=structuredClone(raws(v9)[4]);relabeled.groupId='market_context:3.2.1'
 expect(groups.isCurrentModuleAuthorPrefix('3.01',[...prior,relabeled])).toBe(false)
 expect(()=>groups.validateModuleAuthorGroup('3.01',relabeled,prior,corpus)).toThrow()
 expect(prior).toEqual(original)
})
it('binds mixed original receipts into a v10 audit and leaves all professional values and prior hashes unchanged',()=>{
 const historical=raws(v9);historical[0]=raws(v8)[0];const original=structuredClone(historical)
 const current=[...historical.slice(0,4),...raws(v10).slice(4)],compiled=groups.compileModuleAuthorGroups('3.01',current,corpus)
 const originalCandidate=groups.compileModuleAuthorGroups('3.01',historical,corpus)
 for(const key of ['outputs','claims','sourceValues','limitations'] as const)expect(compiled[key]).toEqual(originalCandidate[key])
 const audit=groups.createModuleAuthorGroupsAudit('3.01',current.map((raw,index)=>({raw,receipt:receipt(index)})),compiled)
 expect(audit.version).toBe(v10);expect(audit.groups.slice(0,4).map(g=>g.projectionHash)).toEqual(historical.slice(0,4).map(sha256CanonicalJson))
 expect(groups.replayModuleAuthorGroups('3.01',corpus,audit)).toEqual(compiled)
 expect(historical).toEqual(original)
})
it('replays complete historical mixed v8/v9 seven-group audits under their original plan',()=>{
 const historical=raws(v9);historical[0]=raws(v8)[0];const compiled=groups.compileModuleAuthorGroups('3.01',historical,corpus)
 const audit=groups.createModuleAuthorGroupsAudit('3.01',historical.map((raw,index)=>({raw,receipt:receipt(index)})),compiled)
 expect(audit.version).toBe(v9);expect(audit.groups).toHaveLength(7)
 expect(groups.replayModuleAuthorGroups('3.01',corpus,audit)).toEqual(compiled)
 const damaged=structuredClone(audit);(damaged.groups[4].raw as any).projectionVersion=v10
 expect(()=>groups.replayModuleAuthorGroups('3.01',corpus,damaged)).toThrow()
 expect(()=>groups.getModuleAuthorFieldGroups('3.04',v10)).toThrow('MODULE_GROUP_VERSION')
})
