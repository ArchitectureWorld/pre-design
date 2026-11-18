// Per-run caps, never persisted into the user's provider settings.
const invalid=()=>Object.assign(Error('REFERENCE_STAGE_LIMIT_INVALID'),{code:'REFERENCE_STAGE_LIMIT_INVALID'})
export function validateStageOutputLimits(limits){
 if(limits===undefined)return
 if(!limits||typeof limits!=='object'||Array.isArray(limits))throw invalid()
 for(const [stage,cap]of Object.entries(limits))if(!/^(profile|design-spec|(?:prototype|observe|components|semantics|adapt)-[1-9]\d*)$/.test(stage)||!Number.isSafeInteger(cap)||cap<256||cap>32768)throw invalid()
}
export function stagePolicyWithOutputLimit(policy,kind,limits,role='parent'){
 validateStageOutputLimits(limits)
 const cap=limits?.[kind];if(cap===undefined)return policy
 if(!['parent','vision'].includes(role)||!Array.isArray(policy?.models)||!policy.models.length)throw invalid()
 const route=policy.routes?.[role]
 if(!route?.primary||!Array.isArray(route.fallbacks))throw invalid()
 const key=model=>typeof model?.provider==='string'&&typeof model?.model==='string'?JSON.stringify([model.provider,model.model]):null
 const selected=[route.primary,...route.fallbacks].map(key)
 if(selected.some(k=>k===null)||new Set(selected).size!==selected.length)throw invalid()
 const result=structuredClone(policy)
 for(const identity of selected){
  const matches=result.models.filter(model=>key(model)===identity)
  if(matches.length!==1)throw invalid()
  const model=matches[0]
  if(model.maxOutputTokens!==undefined&&(!Number.isSafeInteger(model.maxOutputTokens)||model.maxOutputTokens<=0))throw invalid()
  model.maxOutputTokens=model.maxOutputTokens===undefined?cap:Math.min(model.maxOutputTokens,cap)
 }
 return result
}
