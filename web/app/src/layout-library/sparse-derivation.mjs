import {z} from 'zod'
import {validatePackage,packageDigest,fail} from './contract.mjs'
import {validateReferenceProfile} from './reference-profile.mjs'
import {appendSparseCardVariants} from './sparse-card-family.mjs'
import {compileNativeDesignPackageV3} from './native-design-compiler.mjs'
export const sparseDerivationRequestSchema=z.object({id:z.string().uuid(),version:z.number().int().positive(),expectedHash:z.string().regex(/^[a-f0-9]{64}$/),strategyVersion:z.literal(1),requestId:z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),source:z.object({fileSha256:z.string().regex(/^[a-f0-9]{64}$/),pageNumber:z.number().int().positive()}).strict().optional()}).strict()
export function deriveSparsePackage({actor,resource,job,request}){
 const b=sparseDerivationRequestSchema.parse(request),r=resource,j=job,result=j?.result
 if(!r||r.owner_id!==actor.id||j?.owner_id!==actor.id||j?.kind!=='layout-reference'||j.status!=='completed'||result?.id!==r.id||result.version!==r.version||result.hash!==r.hash||b.id!==r.id||b.version!==r.version||b.expectedHash!==r.hash)throw fail('缺少与当前资源、版本及内容完全匹配的已完成参考任务。',409)
 if(packageDigest(r.document)!==r.hash)throw fail('资源内容与存储哈希不一致。',409)
 const p=validatePackage(r.document),a=result.analysis
 if(!p.designSpec||!a?.inventory?.files?.length||!Array.isArray(a.observations)||!a.observations.length||!Array.isArray(a.componentObservations)||!a.componentObservations.length||packageDigest(a.profile)!==packageDigest(p.designProfile))throw fail('缺少可核对的组件观察、设计规范或来源证据。',409)
 validateReferenceProfile(p.designProfile,{inventory:a.inventory,observations:a.observations})
 const sources=a.componentObservations.map(o=>o.source)
 const choices=[...new Map(sources.map(s=>[JSON.stringify(s),s])).values()]
 if(!b.source&&choices.length!==1)throw fail('请明确选择来源页面后再添加变体。可选页号：'+[...new Set(choices.map(s=>s.pageNumber))].join('、'),409)
 const source=b.source??choices[0],matches=a.componentObservations.filter(o=>o.source.fileSha256===source.fileSha256&&o.source.pageNumber===source.pageNumber)
 if(matches.length!==1)throw fail('所选来源页面不唯一或没有组件观察。',409)
 const page=a.inventory.files.find(f=>f.sha256===source.fileSha256)?.pages?.find(p=>p.pageNumber===source.pageNumber)
 if(!page?.hasImage)throw fail('所选页面没有实际图像证据。',409)
 const input={name:p.name,rights:p.rights,designSpec:p.designSpec,prototypes:p.layouts.map(({kind,...l})=>l),inventory:a.inventory,observations:a.observations}
 let derived,compiled
 try{derived=appendSparseCardVariants(input,matches[0],[source]);compiled=compileNativeDesignPackageV3(derived)}catch{throw fail('现有设计结构或资产无法安全派生；未修改原资源。',409)}
 const layouts=[...structuredClone(p.layouts),...compiled.layouts.slice(p.layouts.length)]
 const output=validatePackage({...structuredClone(p),designSpec:compiled.designSpec,designProfile:compiled.designProfile,layouts,source:{...p.source,limitations:[...(p.source?.limitations??[]),'少内容无图变体为平台派生设计策略，不代表原页可选性；未完成视觉验收。']},validationReceipts:compiled.validationReceipts})
 if(packageDigest(output.layouts.slice(0,p.layouts.length))!==packageDigest(p.layouts))throw fail('派生不能修改原版式。',409)
 return {package:output,receipt:{...derived.sparseCardDerivation,jobId:j.id,analysisHash:packageDigest(a),resourceId:r.id,sourceVersion:r.version,sourceHash:r.hash,outputPackageHash:packageDigest(output),visualAcceptance:'pending'}}
}
