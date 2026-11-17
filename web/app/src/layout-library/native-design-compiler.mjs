import {z} from 'zod'
import {createPackage,validatePackage} from './contract.mjs'
import {validateDesignSpec} from './design-spec.mjs'
import {SCHEMA_V3,RENDERER_V3,COMPILER_V3,UPSTREAM_REVISION,nativeLayoutSchema} from './native-design-v3.mjs'
export function compileNativeDesignPackageV3({name,designSpec,prototypes,rights,inventory,observations}){
 const spec=validateDesignSpec(designSpec,{inventory,observations})
 // The designer supplies prototypes, never a preapproved package or receipts.
 const layouts=z.array(nativeLayoutSchema.omit({kind:true})).min(1).max(24).parse(prototypes).map(p=>({...p,kind:'composition'}))
 const profile=spec.profile,system=profile.designSystem
 return validatePackage({...createPackage(name),schemaVersion:SCHEMA_V3,description:'原生 SVG 设计资源；仅支持已声明的安全 SVG 子集及 HTML 内容槽。',tags:[],canvas:system.canvas,theme:{...system.colors,...system.typography},layouts,designProfile:profile,designSpec:spec,rights,source:{kind:'reference-document',limitations:['SVG 安全子集；不支持原件图像、文字、外部资源或可编辑 PPTX 保真。']},compilerVersion:COMPILER_V3,upstreamRevision:UPSTREAM_REVISION,rendererCompatibility:[RENDERER_V3],validationReceipts:['native-schema','svg-safety'].map(kind=>({kind,version:COMPILER_V3,status:'passed'}))})
}
