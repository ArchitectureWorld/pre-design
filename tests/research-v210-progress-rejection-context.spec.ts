import {expect,it} from 'vitest'
import * as native from '../src/research-v2/native-progress-review.ts'
import {compactNativeModuleRejectionPrompt} from '../src/research-v2/native-module-rejection-budget.ts'
import {assertNativeModuleContext} from '../src/research-v2/native-module-context-budget.ts'
import {decodeNativeModuleJsonWire,NATIVE_MODULE_JSON_WIRE_VERSION} from '../src/research-v2/native-submission-wire.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'

const required=[{itemId:'7.02',criterion:'保持外部协作者成本'},
 {itemId:'7.03',criterion:'保留公益服务边界'},
 {itemId:'7.03',criterion:'遵守整体回看的允许用途；未核依据保留缺口。'}]
const schema=()=>native.progressReviewSchema({requestHash:'request-current',driftScope:'produced-results',
 selectedModuleIds:['7.02','7.03'],resultRefs:[{itemId:'7.02'},{itemId:'7.03'}],requiredConditions:required} as any)
const condition=(pair:typeof required[number])=>({...pair,permission:'proceed',reason:'原生判断',verification:'三步内复核',
 scope:{kind:'none',allowedUses:[],heldUses:[],reviewAfterModules:3}})
const draft=()=>({requestHash:'request-current',verdict:'continue',rationale:'原生回看',conditions:required.map(condition),driftFindings:[]})
const diagnose=(value:unknown,current=schema())=>{
 const api=native as unknown as {progressReviewRejectionDiagnostic:(schema:unknown,value:unknown)=>any}
 expect(typeof api.progressReviewRejectionDiagnostic).toBe('function')
 return api.progressReviewRejectionDiagnostic(current,value)
}

it('locates missing, unknown and duplicate condition pairs without repairing the native decision',()=>{
 const raw=draft();raw.conditions=[condition(required[0]),condition({...required[1],criterion:'保留公益边界'}),condition(required[0])]
 const before=structuredClone(raw),diagnostic=diagnose(raw)
 expect(diagnostic).toMatchObject({scope:'progress-review-condition-addresses-only',completeSubmission:false,
  originalSubmissionHash:hash(raw),requestHash:'request-current',requiredConditionCount:3,submittedConditionCount:3,
  missingConditions:required.slice(1),unexpectedConditions:[{index:1,itemId:'7.03',criterion:'保留公益边界'}],
  duplicateConditions:[{index:2,...required[0]}]})
 expect(raw).toEqual(before)
})

it('fits a correction by omitting only the hash-bound rejected review, retaining the full task and exact missing condition',()=>{
 const raw=draft();raw.conditions.pop();raw.rationale='未经接纳的原生审查原稿。'.repeat(2500)
 const diagnostic=diagnose(raw),source={task:'理想条件策划汇报',requiredConditions:required,
  modules:[{itemId:'7.02',judgment:'协作成本保留为外部支出',limits:['权属与协议待人工确认'],heldUses:['已签约、已落实']} ]}
 const context={accepted:false,untrusted:true,error:'PROGRESS_REVIEW_CONDITIONS',submissionState:'included',structuredOutput:raw,diagnosticExcerpt:diagnostic}
 const prompt=JSON.stringify({progressReview:source})+'\n'+JSON.stringify({correctionContext:context})
 const limits={contextWindow:18000,outputTokenLimit:4000},before=hash({source,raw,context})
 expect(()=>assertNativeModuleContext(limits,prompt,'{}',[])).toThrow('MODULE_MODEL_CONTEXT_BUDGET_EXCEEDED')
 const compact=compactNativeModuleRejectionPrompt(prompt)
 expect(()=>assertNativeModuleContext(limits,compact,'{}',[])).not.toThrow()
 expect(JSON.parse(compact.split('\n')[0]).progressReview).toEqual(source)
 const feedback=JSON.parse(compact.split('\n')[1]).correctionContext
 expect(feedback).toMatchObject({accepted:false,untrusted:true,submissionState:'omitted',originalSubmissionHash:hash(raw),diagnosticExcerpt:diagnostic})
 expect(feedback).not.toHaveProperty('structuredOutput')
 expect(diagnostic.missingConditions).toEqual([required[2]])
 expect(hash({source,raw,context})).toBe(before)
})

it('refuses an undecoded wire envelope and a non-progress schema',()=>{
 const raw=draft();raw.conditions.pop()
 expect(diagnose({submissionJson:JSON.stringify(raw)})).toBeUndefined()
 expect(diagnose(raw,{type:'object',properties:{groupId:{type:'string'}},required:['groupId']} as any)).toBeUndefined()
})

it('diagnoses the rejected request identity and condition omissions without accepting or rewriting either',()=>{
 const raw=draft();raw.requestHash='another-request';raw.conditions.pop()
 const before=structuredClone(raw),current=schema(),diagnostic=diagnose(raw,current)
 expect(diagnostic).toMatchObject({scope:'progress-review-request-and-condition-addresses-only',completeSubmission:false,
  originalSubmissionHash:hash(raw),requestHash:'request-current',submittedRequestHash:'another-request',requestIdentityMismatch:true,
  requiredConditionCount:3,submittedConditionCount:2,missingConditions:[required[2]],unexpectedConditions:[],duplicateConditions:[]})
 expect(()=>decodeNativeModuleJsonWire({wireVersion:NATIVE_MODULE_JSON_WIRE_VERSION,submissionJson:JSON.stringify(raw)},current)).toThrow('value.requestHash')
 expect(raw).toEqual(before)
})

it('fits an identity-only rejection while retaining all research inputs and strict request binding',()=>{
 const raw=draft();raw.requestHash='another-request';raw.rationale='未经接纳的原生审查原稿。'.repeat(2500)
 const current=schema(),diagnostic=diagnose(raw,current),source={task:'完整研究输入',requiredConditions:required},before=hash({raw,source,current})
 expect(diagnostic).toMatchObject({requestIdentityMismatch:true,missingConditions:[],unexpectedConditions:[],duplicateConditions:[]})
 const prompt=JSON.stringify({progressReview:source})+'\n'+JSON.stringify({correctionContext:{accepted:false,untrusted:true,
  error:'MODULE_NATIVE_JSON_WIRE_INVALID',submissionState:'included',structuredOutput:raw,diagnosticExcerpt:diagnostic}})
 const limits={contextWindow:18000,outputTokenLimit:4000}
 expect(()=>assertNativeModuleContext(limits,prompt,'{}',[])).toThrow('MODULE_MODEL_CONTEXT_BUDGET_EXCEEDED')
 const compact=compactNativeModuleRejectionPrompt(prompt)
 expect(()=>assertNativeModuleContext(limits,compact,'{}',[])).not.toThrow()
 expect(JSON.parse(compact.split('\n')[0]).progressReview).toEqual(source)
 expect(JSON.parse(compact.split('\n')[1]).correctionContext).toMatchObject({submissionState:'omitted',originalSubmissionHash:hash(raw),diagnosticExcerpt:diagnostic})
 expect(()=>decodeNativeModuleJsonWire({wireVersion:NATIVE_MODULE_JSON_WIRE_VERSION,submissionJson:JSON.stringify(raw)},current)).toThrow('value.requestHash')
 expect(hash({raw,source,current})).toBe(before)
})

it('does not authorize rejection compaction when condition addresses already match',()=>{
 const raw=draft(),diagnostic=diagnose(raw)
 expect(diagnostic).toBeUndefined()
 const prompt=JSON.stringify({correctionContext:{accepted:false,untrusted:true,error:'PROGRESS_REVIEW_SCOPE',submissionState:'included',structuredOutput:raw,diagnosticExcerpt:diagnostic}})
 expect(compactNativeModuleRejectionPrompt(prompt)).toBe(prompt)
})
