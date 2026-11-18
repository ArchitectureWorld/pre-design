import {z} from 'zod'
import {validatePackage,packageDigest,fail} from './contract.mjs'
import {compileNativeDesignPackageV3} from './native-design-compiler.mjs'
import {appendPlatformContentLayouts} from './sparse-card-family.mjs'
export const styleAdaptationRequestSchema=z.object({id:z.string().uuid(),version:z.number().int().positive(),expectedHash:z.string().regex(/^[a-f0-9]{64}$/),requestId:z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),strategyVersion:z.literal(1),styleAcknowledged:z.literal(true)}).strict()
export function deriveStylePackage({actor,resource:r,request}){
 const b=styleAdaptationRequestSchema.parse(request)
 if(!r||r.owner_id!==actor.id||b.id!==r.id||b.version!==r.version||b.expectedHash!==r.hash||packageDigest(r.document)!==r.hash)throw fail('资源身份、版本或内容已变化。',409)
 const p=validatePackage(r.document)
 if(!p.designSpec||p.canvas.width<1400||p.canvas.height<900)throw fail('当前资源不支持安全风格适配。',409)
 const input={name:p.name,rights:p.rights,designSpec:structuredClone(p.designSpec),prototypes:p.layouts.map(({kind,...l})=>structuredClone(l))},profile=input.designSpec.profile
 const user='resource-style-request-v1',inferred='resource-style-derived-v1'
 if(profile.evidence.some(e=>e.id===user||e.id===inferred)||p.layouts.some(l=>l.id.startsWith('style-adaptation-')))throw fail('已包含此风格适配策略，不能重复追加。',409)
 profile.evidence.push({id:user,provenance:'user'},{id:inferred,provenance:'inferred',dependsOn:[user]})
 const margin=Math.max(.05,Math.min(.10,profile.designSystem.spacing.margin))
 appendPlatformContentLayouts(input,{evidenceIds:[inferred],left:margin,right:1-margin,maxCount:3,prefix:'style-adaptation'})
 let compiled
 try{compiled=compileNativeDesignPackageV3(input)}catch{throw fail('旧设计或资产无法安全重编译；未修改资源。',409)}
 const output=validatePackage({...structuredClone(p),designSpec:compiled.designSpec,designProfile:compiled.designProfile,layouts:[...structuredClone(p.layouts),...compiled.layouts.slice(p.layouts.length)],validationReceipts:compiled.validationReceipts,source:{...p.source,limitations:[...(p.source?.limitations??[]),'平台风格重设计：用户请求基于当前资源安全风格创建0至3要点的内容适配版；不是原页识别或复刻，视觉验收待完成。']}})
 if(packageDigest(output.layouts.slice(0,p.layouts.length))!==packageDigest(p.layouts))throw fail('不能改变原版式。',409)
 return{package:output,receipt:{sourceKind:'resource-style',derivedLayoutIds:output.layouts.slice(p.layouts.length).map(l=>l.id),strategyVersion:1,styleAcknowledged:true,requestId:b.requestId,sourceResourceId:r.id,sourceVersion:r.version,sourceHash:r.hash,outputPackageHash:packageDigest(output),visualAcceptance:'pending'}}
}
