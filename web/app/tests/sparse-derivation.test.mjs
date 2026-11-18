import test from 'node:test'
import assert from 'node:assert/strict'
import * as helper from '../src/layout-library/sparse-derivation.mjs'
import {packageDigest} from '../src/layout-library/contract.mjs'
import {fixture} from './fixtures/sparse-derivation.mjs'

test('preserves original metadata/layouts and records private derivation',()=>{
 assert.equal(typeof helper.deriveSparsePackage,'function')
 const f=fixture(),before=structuredClone(f.resource.document),out=helper.deriveSparsePackage(f)
 assert.deepEqual(f.resource.document,before)
 for(const k of ['name','description','tags','rights','theme','canvas','compilerVersion','upstreamRevision','rendererCompatibility'])assert.deepEqual(out.package[k],before[k])
 assert.deepEqual(out.package.layouts.slice(0,before.layouts.length),before.layouts)
 assert.equal(out.package.layouts.length,before.layouts.length+3)
 assert.equal(out.receipt.jobId,f.job.id);assert.equal(out.receipt.visualAcceptance,'pending')
})
for(const [name,mutate] of [
 ['owner',f=>f.job.owner_id='other'],['admin owner',f=>{f.actor={id:'admin',role:'admin'}}],
 ['job type',f=>f.job.kind='other'],['status',f=>f.job.status='failed'],['resource',f=>f.job.result.id='other'],
 ['version',f=>f.job.result.version=2],['hash',f=>f.job.result.hash='a'.repeat(64)],
 ['no observations',f=>delete f.job.result.analysis.componentObservations],['no inventory',f=>delete f.job.result.analysis.inventory],
 ['profile mismatch',f=>f.job.result.analysis.profile.designSystem.colors.accent='#000000'],
 ['strategy',f=>f.request.strategyVersion=2],['unknown source',f=>f.request.source={fileSha256:'b'.repeat(64),pageNumber:9}]
])test('rejects '+name,()=>{const f=fixture();mutate(f);assert.throws(()=>helper.deriveSparsePackage(f))})
test('multiple observed sources require explicit choice, not automatic first page',()=>{const f=fixture();const raw=structuredClone(f.job.result.analysis.componentObservations[0]);raw.source.pageNumber++;f.job.result.analysis.componentObservations.push(raw);assert.throws(()=>helper.deriveSparsePackage(f),/选择.*页面/);f.request.source=f.job.result.analysis.componentObservations[0].source;assert.ok(helper.deriveSparsePackage(f).package)})
test('rejects stored document inconsistent with claimed hash',()=>{const f=fixture();f.resource.document.description='tampered';assert.throws(()=>helper.deriveSparsePackage(f),/内容/)})
test('preserves custom metadata and source limitations without mutating source package',()=>{
 const f=fixture(),p=f.resource.document;p.name='Custom resource';p.description='Custom metadata';p.tags=['custom'];p.source.limitations.push('Original limitation')
 f.resource.hash=packageDigest(p);f.job.result.hash=f.resource.hash;f.request.expectedHash=f.resource.hash
 const out=helper.deriveSparsePackage(f).package
 for(const k of ['name','description','tags','rights','theme','themeDerivations','decorativeAssets','fidelityFeatures'])assert.deepEqual(out[k],p[k])
 assert.deepEqual(out.source.limitations.slice(0,p.source.limitations.length),p.source.limitations)
})
test('asset-bearing original is rejected explicitly rather than losing its bytes or layers',async()=>{
 const {default:sharp}=await import('sharp'),{createHash}=await import('node:crypto'),f=fixture(),p=f.resource.document,e=p.designProfile.evidence[0]
 const bytes=await sharp({create:{width:1,height:1,channels:4,background:'#ffffff'}}).png().toBuffer()
 p.decorativeAssets=[{id:'paper',dataUrl:'data:image/png;base64,'+bytes.toString('base64'),sha256:createHash('sha256').update(bytes).digest('hex'),source:{sha256:e.fileSha256,page:e.pageNumber,objectNumber:8},rights:{basis:'permission',shareAllowed:false}}]
 p.layouts[0].decorations=[{assetId:'paper',rect:{x:0,y:0,w:1,h:1},placement:'background'}]
 f.resource.hash=packageDigest(p);f.job.result.hash=f.resource.hash;f.request.expectedHash=f.resource.hash
 const before=structuredClone(p);assert.throws(()=>helper.deriveSparsePackage(f),/资产无法安全派生/);assert.deepEqual(p,before)
})
