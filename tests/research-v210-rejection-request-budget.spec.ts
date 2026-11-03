import {describe,it,expect} from 'vitest'
import * as api from '../src/research-v2/native-module-rejection-budget.ts'
import {assertNativeModuleContext} from '../src/research-v2/native-module-context-budget.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'
import {moduleReferencePromptView} from '../src/research-v2/module-reference-context.ts'

const fixture=()=>{
 const raw={groupId:'diagnosis:3',outputs:{diagnosis:{records:[{resourceOpportunity:'未接纳原稿。'.repeat(2500)}]}}}
 const error='MODULE_SOURCE_VALUE_TEXT: '+'原拒稿与原文不符。'.repeat(1500)
 const diagnostic={scope:'source-text-bindings-only',completeSubmission:false,originalSubmissionHash:hash(raw),fieldTextConflicts:[{target:{port:'diagnosis',field:'resourceOpportunity',at:'/0'},diagnosticCode:'TEXT',quoteLocationMatches:[{page:11}]}]}
 const sources={upstream:[{itemId:'4.01',value:0,limitations:['审批、权属及现场确认进入备注。']}],originalText:'完整原件材料，不省略。'}
 return {raw,error,diagnostic,sources}
}
const parse=(prompt:string,key:string)=>JSON.parse(prompt.split('\n').find(line=>line.startsWith('{"'+key+'":'))!)[key]
describe('capacity fallback for hash-bound native rejection feedback',()=>{
 it('fits a correction while retaining every source, prior field, restriction and error target',()=>{
  const {raw,error,diagnostic,sources}=fixture(),context={accepted:false,untrusted:true,error,submissionState:'included',structuredOutput:raw,diagnosticExcerpt:diagnostic,sourceBindingProgress:{unchanged:'已核验字面绑定'}}
  const prompt='原始指令保持\n'+JSON.stringify({task:{id:'4.02'},sources})+'\n'+JSON.stringify({correctionContext:context})
  const before=structuredClone(context),limits={contextWindow:18000,outputTokenLimit:4000}
  expect(()=>assertNativeModuleContext(limits,prompt,'{}',[])).toThrow('MODULE_MODEL_CONTEXT_BUDGET_EXCEEDED')
  const compact=api.compactNativeModuleRejectionPrompt(prompt),restored=parse(compact,'correctionContext')
  expect(()=>assertNativeModuleContext(limits,compact,'{}',[])).not.toThrow()
  expect(restored).toMatchObject({accepted:false,untrusted:true,submissionState:'omitted',originalSubmissionHash:hash(raw),diagnosticExcerpt:diagnostic,sourceBindingProgress:context.sourceBindingProgress})
  expect(restored).not.toHaveProperty('structuredOutput')
  expect(restored.omittedErrorDetails.error).toMatchObject({originalHash:hash(error),errorCodes:['MODULE_SOURCE_VALUE_TEXT']})
  expect(parse(compact,'task')).toEqual({id:'4.02'})
  expect(JSON.parse(compact.split('\n')[1]).sources).toEqual(sources)
  expect(context).toEqual(before)
 })
 it('handles recovered readonly drafts and keeps author ownership and exact diagnostic identities',()=>{
  const {raw,error,diagnostic}=fixture(),view=moduleReferencePromptView(raw),binding={accepted:false,untrusted:true,submissionState:'included-readonly-view',structuredOutputView:view,originalSubmissionHash:hash(raw),authorExecutionId:'owner',authorChildId:'child'}
  const prompt=JSON.stringify({previousRejection:{authorErrors:[error],moduleError:'MODULE_MODEL_CONTEXT_BUDGET_EXCEEDED',rejectedSubmission:binding,diagnosticExcerpt:diagnostic}})
  const restored=parse(api.compactNativeModuleRejectionPrompt(prompt),'previousRejection')
  expect(restored.rejectedSubmission).toMatchObject({accepted:false,untrusted:true,submissionState:'omitted',originalSubmissionHash:hash(raw),authorExecutionId:'owner',authorChildId:'child'})
  expect(restored.diagnosticExcerpt).toEqual(diagnostic)
  expect(restored.moduleError).toBe('MODULE_MODEL_CONTEXT_BUDGET_EXCEEDED')
 })
 it('preserves complete feedback when the diagnostic is absent or bound to another draft',()=>{
  const {raw,error,diagnostic}=fixture()
  for(const diagnosticExcerpt of [undefined,{...diagnostic,originalSubmissionHash:'0'.repeat(64)}]){
   const prompt=JSON.stringify({correctionContext:{accepted:false,untrusted:true,error,submissionState:'included',structuredOutput:raw,diagnosticExcerpt}})
   expect(api.compactNativeModuleRejectionPrompt(prompt)).toBe(prompt)
  }
 })
 it('does not rewrite material objects, malformed lines or an accepted candidate',()=>{
  const {raw,error,diagnostic}=fixture()
  for(const prompt of ['{invalid json',JSON.stringify({sources:{error,structuredOutput:raw}}),JSON.stringify({correctionContext:{accepted:true,untrusted:false,error,submissionState:'included',structuredOutput:raw,diagnosticExcerpt:diagnostic}})])
   expect(api.compactNativeModuleRejectionPrompt(prompt)).toBe(prompt)
 })
})
