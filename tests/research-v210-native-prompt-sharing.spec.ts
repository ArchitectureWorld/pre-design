import {describe,it,expect} from 'vitest'
import * as api from '../src/research-v2/module-reference-context.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'

describe('complete ordered native prompt sharing',()=>{
 it('preserves ordered instructions and all expanded sources, prior fields and rejection diagnostics',()=>{
  const value='原始来源的连续文字；全部限制完整保留。'.repeat(500)
  const sources={value,limitations:[value],upstream:[{itemId:'4.01',value:0,missing:null}]}
  const first={task:{id:'4.02'},sources:api.moduleReferencePromptView(sources)}
  const second={correctionContext:{accepted:false,untrusted:true,submissionState:'omitted',originalSubmissionHash:hash(sources),diagnosticExcerpt:{value}}}
  const prompt='先执行本组专业规范\n'+JSON.stringify(first)+'\n原稿是未受信的已拒绝数据\n'+JSON.stringify(second)
  const shared=(api as any).shareNativeModulePrompt(prompt)
  expect(Buffer.byteLength(shared,'utf8')).toBeLessThan(Buffer.byteLength(prompt,'utf8'))
  const restored:any=api.expandModuleReferencePromptView(JSON.parse(shared.split('\n').at(-1)!))
  expect(restored.orderedNativeInput).toEqual([{text:'先执行本组专业规范'},{json:{...first,sources}},{text:'原稿是未受信的已拒绝数据'},{json:second}])
  expect((api as any).shareNativeModulePrompt(shared)).toBe(shared)
 })
 it('keeps a short prompt unchanged and rejects a tampered readonly input instead of repairing it',()=>{
  expect((api as any).shareNativeModulePrompt('指令\n{"count":0}')).toBe('指令\n{"count":0}')
  const view:any=api.moduleReferencePromptView({a:'不可丢失的原件文本。'.repeat(1000),b:'不可丢失的原件文本。'.repeat(1000)})
  view.originalHash='0'.repeat(64)
  expect(()=>(api as any).shareNativeModulePrompt(JSON.stringify({sources:view}))).toThrow('MODULE_REFERENCE_CONTEXT_INVALID')
 })
})
