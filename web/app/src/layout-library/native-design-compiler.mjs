import {referenceFidelityInventory} from './reference-fidelity-inventory.mjs'
import {deriveReadableTheme} from './accessible-theme.mjs'
import {z} from 'zod'
import {createPackage,validatePackage} from './contract.mjs'
import {validateDesignSpec} from './design-spec.mjs'
import {SCHEMA_V3,RENDERER_V3,COMPILER_V3,UPSTREAM_REVISION,nativeLayoutSchema} from './native-design-v3.mjs'
export function compileNativeDesignPackageV3({name,designSpec,prototypes,rights,inventory,observations,referenceComponentVersion}){
 const spec=validateDesignSpec(designSpec,{inventory,observations})
 // The designer supplies prototypes, never a preapproved package or receipts.
 const layouts=z.array(nativeLayoutSchema.omit({kind:true})).min(1).max(24).parse(prototypes).map(p=>({...p,kind:'composition'}))
 const profile=spec.profile,system=profile.designSystem
 const features=[1,2].includes(referenceComponentVersion)?referenceFidelityInventory({profile,layouts,observations}):[]
 const derived=deriveReadableTheme({...system.colors,...system.typography})
 return validatePackage({...createPackage(name),schemaVersion:SCHEMA_V3,description:'原生 SVG 设计资源；仅支持已声明的安全 SVG 子集及 HTML 内容槽。',tags:[],canvas:system.canvas,theme:derived.theme,...(features.length?{fidelityFeatures:features}:{}),...(derived.changes.length?{themeDerivations:derived.changes}:{}),layouts,designProfile:profile,designSpec:spec,rights,source:{kind:'reference-document',limitations:['SVG 安全子集；不支持原件图像、文字、外部资源或可编辑 PPTX 保真。',...derived.changes.map(c=>`可读性派生：${c.key} 原色 ${c.source} → ${c.derived}，对背景 ${c.background} 满足对比度 ${c.minimum}:1；来源设计规范保留原值。`)]},compilerVersion:COMPILER_V3,upstreamRevision:UPSTREAM_REVISION,rendererCompatibility:[RENDERER_V3],validationReceipts:['native-schema','svg-safety'].map(kind=>({kind,version:COMPILER_V3,status:'passed'}))})
}
