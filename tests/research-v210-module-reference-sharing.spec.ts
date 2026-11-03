import {describe,expect,it} from 'vitest'
import {moduleReferencePromptView,expandModuleReferencePromptView,completeModuleReferencePromptView,shareNativeModulePrompt} from '../src/research-v2/module-reference-context.ts'
import {allocateModuleMaterialChars,assertNativeModuleContext} from '../src/research-v2/native-module-context-budget.ts'

function layeredNotes(){
  const common='本条仅支持理想条件下的方案比较，具体节点、审批、权属、合作和现场验证仍需人工确认，不能升级为现状事实或已批准的建设依据'
  const notes=Array.from({length:2200},(_,i)=>`/outputs/port_${i%37}/records/${i}/condition: 第${i}条材料${common}，本条对象标识${i}，具体适用范围应回到同一来源核对`)
  return {spec:{id:'4.04'},sources:{sourceValues:[{path:'原始资料/资料.pdf',quote:'连续原文\n0.03 m³/s，轴序xy，时间及单位保持。'}],
    upstream:[{moduleId:'options',limitations:notes.slice(0,2000)},{moduleId:'operations',limitations:notes}],
    nested:{'@S':0,'@R':[0,[]],'@T':['x','y'],'@L':3},identity:[false,0,null,'',-0.03,'😀完整原字符']}}
}
const bytes=(value:unknown)=>Buffer.byteLength(JSON.stringify(value),'utf8')
describe('shared native reference dictionary and inherited note sequences',()=>{
  it('shares embedded repeated prose and inherited sequence membership while preserving every complete original field',()=>{
    const value=layeredNotes(),before=structuredClone(value),view:any=moduleReferencePromptView(value)
    expect(view.encoding).toBe('research-reference.v2')
    expect(bytes(view)).toBeLessThan(bytes(value)*0.4)
    expect(expandModuleReferencePromptView(view)).toEqual(before)
    expect(value).toEqual(before)
    expect(moduleReferencePromptView(value)).toEqual(view)
  })
  it('keeps complete frozen input within the same route reservation before selecting sources',()=>{
    const value=layeredNotes(),fixed=JSON.stringify(moduleReferencePromptView(value)),schema='s'.repeat(108333)
    const limit={contextWindow:872000,outputTokenLimit:128000},images=[{type:'image'}]
    expect(()=>allocateModuleMaterialChars([limit],JSON.stringify(value),images,schema)).toThrow('MODULE_MODEL_CONTEXT_BUDGET_EXCEEDED')
    const capacity=allocateModuleMaterialChars([limit],fixed,images,schema)!
    expect(capacity).toBeGreaterThan(12000)
    expect(assertNativeModuleContext(limit,fixed+'材'.repeat(capacity),schema,images)?.outputReservedTokens).toBe(128000)
  })
  it.each(['fragment-reference','fragment-type','list-reference','list-range','hash'])('rejects corrupt %s without accepting a partial note list',kind=>{
    const view:any=structuredClone(moduleReferencePromptView(layeredNotes()))
    expect(view.encoding).toBe('research-reference.v2')
    if(kind==='fragment-reference')view.strings[0]=[view.fragments.length]
    if(kind==='fragment-type')view.fragments[0]={untrusted:'text'}
    if(kind==='list-reference')view.data={[view.listKey]:view.lists.length}
    if(kind==='list-range')view.lists[0]=[{from:0,at:0,count:1}]
    if(kind==='hash')view.originalHash='0'.repeat(64)
    expect(()=>expandModuleReferencePromptView(view)).toThrow('MODULE_REFERENCE_CONTEXT_INVALID')
  })
  it('shares complete stages and ordered corrective inputs through the same verified codec',()=>{
    const value=layeredNotes(),view=completeModuleReferencePromptView(value,{candidate:{limitations:value.sources.upstream[0].limitations}})
    expect(expandModuleReferencePromptView(view)).toEqual({...value,candidate:{limitations:value.sources.upstream[0].limitations}})
    const prompt='原生指令保持\n'+JSON.stringify(moduleReferencePromptView(value))+'\n'+JSON.stringify({candidate:value})
    const shared=shareNativeModulePrompt(prompt),encoded=JSON.parse(shared.split('\n')[1]),expanded:any=expandModuleReferencePromptView(encoded)
    expect(expanded.orderedNativeInput).toEqual([{text:'原生指令保持'},{json:value},{json:{candidate:value}}])
  })
  it('keeps compiler row and composite payload arrays distinct from original string lists',()=>{
    const value={...layeredNotes(),records:Array.from({length:100},(_,i)=>Object.fromEntries(Array.from({length:12},(_,j)=>['field'+j,'原始重复字段正文'+j]))),
      limitations:Array.from({length:50},(_,i)=>'/outputs/sample/records/'+i+'/field: '+Array.from({length:12},(_,j)=>'同一连续限制段落和完整专业限定必须保留第'+j+'段；').join(''))}
    expect(expandModuleReferencePromptView(moduleReferencePromptView(value))).toEqual(value)
  })
  it('fits a tight corrective request by sharing shorter embedded phrases without changing the frozen source selection view',()=>{
    const common='同一对象的条件和依据须逐项保留核对'
    const notes=Array.from({length:3000},(_,i)=>`第${i}条${common}${i}`)
    const raw={upstream:[{limitations:notes},{limitations:notes},{limitations:notes}],originalQuote:'😀连续原文，值0.03和坐标轴xy不得变更'}
    const frozen=moduleReferencePromptView(raw),before=structuredClone(frozen),schema='s'.repeat(120000)
    const limits={contextWindow:bytes(frozen)+120000+128000+8192-20000,outputTokenLimit:128000}
    const prompt='完整纠错指令\n'+JSON.stringify({sources:frozen})
    expect(()=>assertNativeModuleContext(limits,prompt,schema,[])).toThrow('MODULE_MODEL_CONTEXT_BUDGET_EXCEEDED')
    const shared=shareNativeModulePrompt(prompt)
    expect(()=>assertNativeModuleContext(limits,shared,schema,[])).not.toThrow()
    const restored:any=expandModuleReferencePromptView(JSON.parse(shared.split('\n')[1]))
    expect(restored.orderedNativeInput).toEqual([{text:'完整纠错指令'},{json:{sources:raw}}])
    expect(moduleReferencePromptView(raw)).toEqual(before)
  })
})
