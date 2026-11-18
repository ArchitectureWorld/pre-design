import {referenceDesignFactSchema} from './reference-profile.mjs'
const categories={background:'color',ink:'color',accent:'color',muted:'color','font-family':'typography','title-size':'typography','body-size':'typography','caption-size':'typography','line-height':'spacing',margin:'spacing',gutter:'spacing',alignment:'hierarchy','text-columns':'hierarchy','image-fit':'image-group','image-count':'image-group','table-rows':'table-structure','table-columns':'table-structure',region:'hierarchy'}
/** Deterministic inventory of already validated observations, NOT fidelity scoring.
 * Only controlled design values can enter a reusable package; no private source text. */
export function referenceFidelityInventory({profile,layouts,observations=[]}){
 const evidence=new Map(profile.evidence.map(e=>[e.id,e])),result=[]
 for(const layout of layouts){
  const archetype=profile.archetypes.find(a=>a.id===layout.archetypeId),seen=new Set(),leaves=[],sourcePages=new Set()
  function visit(id){if(seen.has(id))return;seen.add(id);const e=evidence.get(id);if(!e)return;if(e.fileSha256&&e.pageNumber)sourcePages.add(e.fileSha256+':'+e.pageNumber);if(e.provenance==='observed')leaves.push(e);for(const dependency of e.dependsOn??[])visit(dependency)}
  for(const id of archetype?.evidenceIds??[])visit(id)
  if(!sourcePages.size)for(const id of profile.designSystem.evidenceIds)visit(id)
  let count=0
  for(const e of leaves){
   const fact=observations.flatMap(b=>b.pages).find(p=>p.fileSha256===e.fileSha256&&p.pageNumber===e.pageNumber)?.facts.find(f=>f.id===e.factId)
   if(!fact||!categories[fact.property]||!referenceDesignFactSchema.safeParse({property:fact.property,value:fact.value}).success||count>=10)continue
   result.push({layoutId:layout.id,source:{sha256:e.fileSha256,page:e.pageNumber},feature:categories[fact.property],observed:`图像观察事实 ${e.factId}：${fact.property}=${JSON.stringify(fact.value)}`,evidenceKind:'image',representation:'unverified',reason:'自动保留已验证来源的观察值；尚未证明候选表现与原页一致，也不证明源对象可编辑。未记录特征仍未知。',slotIds:[],editability:'unknown'});count++
  }
 }
 return result
}
