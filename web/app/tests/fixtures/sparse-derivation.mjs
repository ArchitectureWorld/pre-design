import {nativeDesignInput} from './native-design-v3-fixture.mjs'
import {compileNativeDesignPackageV3} from '../../src/layout-library/native-design-compiler.mjs'
import {packageDigest} from '../../src/layout-library/contract.mjs'
export function fixture(){
 const pkg=compileNativeDesignPackageV3(nativeDesignInput()),e=pkg.designProfile.evidence[0],source={fileSha256:e.fileSha256,pageNumber:e.pageNumber}
 const raw={source,components:[0,1].flatMap(i=>{const x=.05+i*.47;return [{id:'g'+i,kind:'group',rect:{x,y:.25,w:.43,h:.65}},{id:'b'+i,kind:'text',purpose:'body',parentId:'g'+i,rect:{x:x+.01,y:.5,w:.4,h:.2}},{id:'h'+i,kind:'text',purpose:'heading',parentId:'g'+i,rect:{x:x+.01,y:.3,w:.4,h:.1}}]})}
 const resource={id:'11111111-1111-4111-8111-111111111111',owner_id:'owner',version:1,hash:packageDigest(pkg),document:pkg}
 const analysis={profile:structuredClone(pkg.designProfile),inventory:{files:[{sha256:e.fileSha256,pages:[{pageNumber:e.pageNumber,hasImage:true}]}]},observations:[{pages:[{...source,pageType:'mixed',structure:'asymmetric-columns',density:'medium',facts:[{id:e.factId,property:'background',value:'#ffffff'}]}]}],componentObservations:[raw]}
 return {resource,job:{id:'22222222-2222-4222-8222-222222222222',owner_id:'owner',kind:'layout-reference',status:'completed',result:{id:resource.id,version:1,hash:resource.hash,analysis}},actor:{id:'owner',role:'user'},request:{id:resource.id,version:1,expectedHash:resource.hash,strategyVersion:1,requestId:'derive'}}
}
