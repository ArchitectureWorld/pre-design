// Per-run caps, never persisted into the user's provider settings.
const invalid=()=>Object.assign(Error('REFERENCE_STAGE_LIMIT_INVALID'),{code:'REFERENCE_STAGE_LIMIT_INVALID'})
export function validateStageOutputLimits(limits){
 if(limits===undefined)return
 if(!limits||typeof limits!=='object'||Array.isArray(limits))throw invalid()
 for(const [stage,cap]of Object.entries(limits))if(!/^prototype-[1-9]\d*$/.test(stage)||!Number.isSafeInteger(cap)||cap<256||cap>32768)throw invalid()
}
export function stagePolicyWithOutputLimit(policy,kind,limits){
 validateStageOutputLimits(limits)
 const cap=limits?.[kind];if(cap===undefined)return policy
 if(!Array.isArray(policy?.models)||!policy.models.length||policy.models.some(model=>!Number.isSafeInteger(model.maxOutputTokens)||model.maxOutputTokens<=0))throw invalid()
 const result=structuredClone(policy)
 for(const model of result.models)model.maxOutputTokens=Math.min(model.maxOutputTokens,cap)
 return result
}
