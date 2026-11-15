// Persisted SenseNova entries retired from the active catalog on 2026-11-15.
export function withRetiredSenseNova(policy){
 const copy=structuredClone(policy)
 for(const [model,vision,contextWindow] of [['sensenova-6.7-flash-lite',true,262144],['deepseek-v4-pro',false,1048576]]){
  if(copy.models.some(row=>row.provider==='SenseNova'&&row.model===model))continue
  const capabilities={text:true,tools:false,vision,image:false}
  const row={source:'SenseNova',provider:'SenseNova',model,runtimeProvider:'SenseNova',status:'unverified',declaredCapabilities:{...capabilities},capabilities,contextWindow,maxOutputTokens:65536}
  const index=model==='sensenova-6.7-flash-lite'?0:copy.models.findIndex(row=>row.provider==='SenseNova'&&row.model==='glm-5.3')
  copy.models.splice(index,0,row)
 }
 return copy
}
