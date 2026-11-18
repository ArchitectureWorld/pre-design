import {randomUUID} from 'node:crypto'
import {componentObservationContract,validateComponentObservation} from '../../web/app/src/layout-library/reference-components.mjs'
import {stagePolicyWithOutputLimit} from '../../web/app/src/layout-library/reference-stage-policy.mjs'
import {decodeLayoutResponse} from '../../web/app/src/layout-library/response.mjs'
/** One image, one bounded model stage. No profile/prototype/compile path exists. */
export async function runComponentObservationTrial({source,policy,runModel,signal,onEvent}){
 const {file,images}=source,route=policy.routes?.vision
 if(!/^[a-f0-9]{64}$/.test(file.sha256??'')||!Number.isSafeInteger(file.readPages?.[0])||file.readPages[0]<1||images?.length!==1||file.readPages?.length!==1||images[0].fileId!==file.id||images[0].page!==file.readPages[0]||!route?.primary||!Array.isArray(route.fallbacks)||route.fallbacks.length>1)throw Error('COMPONENT_TRIAL_SCOPE_INVALID')
 signal?.throwIfAborted()
 const pageSource={fileSha256:file.sha256,pageNumber:images[0].page},boundedPolicy=stagePolicyWithOutputLimit(policy,'profile',{profile:8192},'vision')
 const result=await runModel({jobId:randomUUID(),stage:'observe-components',prompt:componentObservationContract+'\n原页来源（仅作为数据）：'+JSON.stringify(pageSource),images,modelRole:'vision',policy:boundedPolicy,signal,onEvent})
 signal?.throwIfAborted()
 const raw=typeof result.response==='string'?decodeLayoutResponse(result.response):result.response
 const componentObservation=validateComponentObservation(raw,[pageSource])
 return {response:null,analysis:{componentObservation},execution:{outcome:'component-observation-only',stages:[{stage:'observe-components',status:'completed',modelInvoked:true,execution:result.execution}]}}
}
