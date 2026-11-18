import test from 'node:test'
import assert from 'node:assert/strict'
import {createPackage,packageDigest} from '../src/layout-library/contract.mjs'
import {validateResourceStyleOrigin} from '../src/layout-library/resource-style-origin.mjs'
function fixture(){
 const p=createPackage('source'),id='11111111-1111-4111-8111-111111111111',sourceResource={id,version:2,ownerId:'owner',package:p,hash:packageDigest(p)},next=structuredClone(p)
 next.layouts.push({...structuredClone(p.layouts[0]),id:'style-adaptation-0'})
 const resource={id,version:3,ownerId:'owner',package:next,hash:packageDigest(next)}
 const result={id,version:3,hash:resource.hash,receipt:{sourceKind:'resource-style',strategyVersion:1,styleAcknowledged:true,sourceResourceId:id,sourceVersion:2,sourceHash:sourceResource.hash,outputPackageHash:resource.hash,derivedLayoutIds:['style-adaptation-0']}}
 return{actorId:'owner',resource,sourceResource,result,layoutId:'style-adaptation-0'}
}
test('private exact style receipt resolves frozen source identity without claiming PDF observation',()=>{const f=fixture(),x=validateResourceStyleOrigin(f);assert.deepEqual(x,{sourceKind:'resource-style',strategyVersion:1,resourceId:f.sourceResource.id,version:2,hash:f.sourceResource.hash})})
test('old layout never gets resource-style review instead of original reference review',()=>{const f=fixture();f.layoutId=f.sourceResource.package.layouts[0].id;assert.equal(validateResourceStyleOrigin(f),null)})
for(const [name,mutate] of Object.entries({foreignOwner:f=>f.sourceResource.ownerId='other',outputVersion:f=>f.result.version=4,outputHash:f=>f.result.hash='f'.repeat(64),sourceHash:f=>f.sourceResource.hash='f'.repeat(64),missingConsent:f=>f.result.receipt.styleAcknowledged=false,sourceIdentity:f=>f.result.receipt.sourceResourceId='other',sourceVersion:f=>f.result.receipt.sourceVersion=3,unknownStrategy:f=>f.result.receipt.strategyVersion=2,oldLayoutRelabel:f=>f.result.receipt.derivedLayoutIds.push(f.sourceResource.package.layouts[0].id),unknownLayout:f=>f.result.receipt.derivedLayoutIds.push('missing')}))test('rejects '+name+' without source fallback',()=>{const f=fixture();mutate(f);assert.throws(()=>validateResourceStyleOrigin(f))})
test('old layouts must remain byte-identical even with internally consistent output digest',()=>{const f=fixture();f.resource.package.layouts[0].label='changed';f.resource.hash=packageDigest(f.resource.package);f.result.hash=f.resource.hash;f.result.receipt.outputPackageHash=f.resource.hash;assert.throws(()=>validateResourceStyleOrigin(f))})
