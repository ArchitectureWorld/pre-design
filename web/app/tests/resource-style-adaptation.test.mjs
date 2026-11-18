import test from 'node:test'
import assert from 'node:assert/strict'
import * as module from '../src/layout-library/resource-style-adaptation.mjs'
import {fixture} from './fixtures/sparse-derivation.mjs'
import {packageDigest} from '../src/layout-library/contract.mjs'
const input=()=>{const f=fixture();delete f.job;f.request.styleAcknowledged=true;return f}
test('explicit style request without job preserves source and appends four platform layouts',()=>{
 const f=input(),before=structuredClone(f.resource.document),r=module.deriveStylePackage(f)
 assert.deepEqual(f.resource.document,before);assert.deepEqual(r.package.layouts.slice(0,before.layouts.length),before.layouts)
 assert.deepEqual(r.package.designProfile.evidence.slice(0,before.designProfile.evidence.length),before.designProfile.evidence)
 const added=r.package.layouts.slice(before.layouts.length);assert.equal(added.length,4);assert.deepEqual(added.map(l=>l.contentFitRules.maxBodyPoints),[0,1,2,3]);assert(added.every(l=>l.contentFitRules.maxImages===0&&l.label.includes('平台风格重设计')))
 assert.equal(r.receipt.sourceKind,'resource-style');assert.equal(r.receipt.sourceHash,f.resource.hash);assert.equal(r.receipt.outputPackageHash,packageDigest(r.package));assert(!('jobId'in r.receipt))
 assert.deepEqual(r.package.designProfile.evidence.slice(-2).map(e=>e.provenance),['user','inferred'])
 for(const key of ['name','description','tags','rights','theme','canvas'])assert.deepEqual(r.package[key],before[key])
})
test('style requires owner, hash, explicit acknowledgement and strict request; rejects repeated append',()=>{
 for(const change of [f=>f.actor.id='other',f=>f.request.expectedHash='a'.repeat(64),f=>f.request.styleAcknowledged=false,f=>f.request.strategyVersion=2,f=>f.request.observations=[],f=>f.resource.document.name='tampered']){const f=input();change(f);assert.throws(()=>module.deriveStylePackage(f))}
 const f=input(),r=module.deriveStylePackage(f);f.resource.document=r.package;f.resource.hash=packageDigest(r.package);f.request.expectedHash=f.resource.hash;assert.throws(()=>module.deriveStylePackage(f))
})

test('small canvas is rejected without mutation',()=>{const f=input();f.resource.document.canvas.height=800;f.resource.hash=packageDigest(f.resource.document);f.request.expectedHash=f.resource.hash;const before=structuredClone(f.resource.document);assert.throws(()=>module.deriveStylePackage(f));assert.deepEqual(f.resource.document,before)})
test('asset-bearing source is rejected rather than losing original assets',async()=>{
 const {default:sharp}=await import('sharp'),{createHash}=await import('node:crypto'),f=input(),p=f.resource.document,e=p.designProfile.evidence[0]
 const bytes=await sharp({create:{width:1,height:1,channels:4,background:'#ffffff'}}).png().toBuffer()
 p.decorativeAssets=[{id:'paper',dataUrl:'data:image/png;base64,'+bytes.toString('base64'),sha256:createHash('sha256').update(bytes).digest('hex'),source:{sha256:e.fileSha256,page:e.pageNumber,objectNumber:8},rights:{basis:'permission',shareAllowed:false}}]
 p.layouts[0].decorations=[{assetId:'paper',rect:{x:0,y:0,w:1,h:1},placement:'background'}]
 f.resource.hash=packageDigest(p);f.request.expectedHash=f.resource.hash;const before=structuredClone(p);assert.throws(()=>module.deriveStylePackage(f),/资产无法安全重编译/);assert.deepEqual(p,before)
})
