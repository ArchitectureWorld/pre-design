import {packageDigest,fail} from './contract.mjs'
const invalid=()=>{throw fail('风格重新设计的私有来源收执与资源版本不一致；不能替代原页审核。',409)}
/** Only server-owned mutation results may reach this function. Public labels,
 * evidence IDs and imported JSON never grant an alternate review path. */
export function validateResourceStyleOrigin({actorId,resource:r,sourceResource:s,result:m,layoutId}){
 const p=m?.receipt
 if(!r||r.ownerId!==actorId||m?.id!==r.id||m.version!==r.version||m.hash!==r.hash||p?.outputPackageHash!==r.hash||packageDigest(r.package)!==r.hash||p.sourceKind!=='resource-style'||p.strategyVersion!==1||p.styleAcknowledged!==true||!Array.isArray(p.derivedLayoutIds)||!p.derivedLayoutIds.length||new Set(p.derivedLayoutIds).size!==p.derivedLayoutIds.length)invalid()
 // Existing layouts retain their original reference review, not this path.
 if(!p.derivedLayoutIds.includes(layoutId))return null
 if(!s||s.ownerId!==actorId||s.id!==r.id||p.sourceResourceId!==s.id||!Number.isSafeInteger(s.version)||s.version<1||s.version>=r.version||p.sourceVersion!==s.version||p.sourceHash!==s.hash||packageDigest(s.package)!==s.hash)invalid()
 const original=new Set(s.package.layouts.map(l=>l.id)),current=new Map(r.package.layouts.map(l=>[l.id,l]))
 if(p.derivedLayoutIds.some(id=>original.has(id)||!current.has(id))||r.package.layouts.length!==s.package.layouts.length+p.derivedLayoutIds.length||s.package.layouts.some(l=>packageDigest(l)!==packageDigest(current.get(l.id))))invalid()
 return {sourceKind:'resource-style',strategyVersion:1,resourceId:s.id,version:s.version,hash:s.hash}
}
