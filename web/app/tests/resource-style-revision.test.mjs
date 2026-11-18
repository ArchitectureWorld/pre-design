import test from 'node:test'
import assert from 'node:assert/strict'
import {createTestDb} from './support/dossier-db.mjs'
import {createLayoutLibrary} from '../src/layout-library/store.mjs'
import {validatePackage} from '../src/layout-library/contract.mjs'
import {fixture} from './fixtures/sparse-derivation.mjs'
async function setup(t,{derive=true}={}){
 const env=await createTestDb();t.after(env.close)
 const wrap=c=>({query:async(...a)=>{const r=await c.query(...a);for(const row of r.rows??[])for(const k of ['document','validation'])if(typeof row[k]==='string')row[k]=JSON.parse(row[k]);return r},release:()=>c.release?.()})
 const db={...wrap(env.db),connect:async()=>wrap(await env.db.connect())},library=await createLayoutLibrary(db),f=fixture()
 const base=await library.create(f.actor,{requestId:'base',package:f.resource.document}),version=derive?await library.deriveStyle(f.actor,{...f.request,id:base.id,styleAcknowledged:true}):base
 return{db,library,actor:f.actor,current:await library.get(f.actor,version.id,version.version)}
}
test('theme edits remain explicitly rejected without writing a new latest in metadata-only scope',async t=>{
 const f=await setup(t),p=structuredClone(f.current.package);p.theme.accent='#334455'
 await assert.rejects(()=>f.library.revise(f.actor,{id:f.current.id,expectedVersion:2,requestId:'theme',package:p}))
 assert.equal((await f.library.get(f.actor,f.current.id)).version,2)
})
test('explicit rename mints exact new private provenance instead of creating unreviewable latest',async t=>{
 const f=await setup(t),p={...f.current.package,name:'Renamed platform adaptation'}
 const revised=await f.library.revise(f.actor,{id:f.current.id,expectedVersion:2,requestId:'rename-chain',package:p})
 const source=await f.library.resolveStyleSource(f.actor,{id:revised.id,version:revised.version,layoutId:'style-adaptation-2'})
 assert.deepEqual(Object.keys(revised).sort(),['hash','id','version']);assert.deepEqual(await f.library.revise(f.actor,{id:f.current.id,expectedVersion:2,requestId:'rename-chain',package:p}),revised)
 assert.equal(source.sourceKind,'resource-style');assert.equal(source.version,1)
 const [mutation]=(await f.db.query('SELECT result FROM layout_library_mutations WHERE actor_id=$1 AND request_id=$2',[f.actor.id,'rename-chain'])).rows
 assert.equal(mutation.result.receipt.outputPackageHash,revised.hash);assert.equal(mutation.result.receipt.sourceHash,(await f.library.get(f.actor,revised.id,1)).hash)
})
test('changing a source layout is rejected before any new latest/version/mutation write',async t=>{
 const f=await setup(t),p=structuredClone(f.current.package);p.layouts[0].label='Changed original layout'
 const before=(await f.db.query('SELECT count(*) AS n FROM layout_library_versions')).rows[0].n
 await assert.rejects(()=>f.library.revise(f.actor,{id:f.current.id,expectedVersion:2,requestId:'old-layout-change',package:p}))
 assert.equal((await f.library.get(f.actor,f.current.id)).version,2);assert.equal((await f.db.query('SELECT count(*) AS n FROM layout_library_versions')).rows[0].n,before)
 assert.equal((await f.db.query('SELECT * FROM layout_library_mutations WHERE request_id=$1',['old-layout-change'])).rows.length,0)
})

test('consistent shared-theme edits and marker removal cannot bypass previous private provenance',async t=>{
 const f=await setup(t),p=structuredClone(f.current.package)
 p.theme.accent='#334455';p.designProfile.designSystem.colors.accent='#334455';p.designSpec.profile=structuredClone(p.designProfile)
 await assert.rejects(()=>f.library.revise(f.actor,{id:f.current.id,expectedVersion:2,requestId:'shared-theme',package:p}))
 const q=structuredClone(f.current.package);q.layouts=q.layouts.filter(l=>!l.id.startsWith('style-adaptation-'));q.designProfile=structuredClone((await f.library.get(f.actor,f.current.id,1)).package.designProfile);q.designSpec=structuredClone((await f.library.get(f.actor,f.current.id,1)).package.designSpec)
 await assert.rejects(()=>f.library.revise(f.actor,{id:f.current.id,expectedVersion:2,requestId:'remove-markers',package:q}))
 assert.equal((await f.library.get(f.actor,f.current.id)).version,2)
})
test('corrupt source receipt rejects rename before version/mutation writes',async t=>{
 const f=await setup(t),rows=(await f.db.query('SELECT request_id,result FROM layout_library_mutations WHERE actor_id=$1',[f.actor.id])).rows,row=rows.find(r=>r.result.receipt)
 row.result.receipt.sourceHash='f'.repeat(64);await f.db.query('UPDATE layout_library_mutations SET result=$1 WHERE actor_id=$2 AND request_id=$3',[row.result,f.actor.id,row.request_id])
 await assert.rejects(()=>f.library.revise(f.actor,{id:f.current.id,expectedVersion:2,requestId:'invalid-source',package:{...f.current.package,name:'Changed'}}))
 assert.equal((await f.library.get(f.actor,f.current.id)).version,2)
})

test('consecutive metadata saves keep the original source and produce fresh private hashes',async t=>{
 const f=await setup(t);let current=f.current
 for(let i=0;i<2;i++){
  const request={id:current.id,expectedVersion:current.version,requestId:'metadata-'+i,package:{...current.package,name:'Name '+i,description:'Description '+i,tags:['tag-'+i]}}
  const [next,replay]=await Promise.all([f.library.revise(f.actor,request),f.library.revise(f.actor,request)]);assert.deepEqual(next,replay);assert(!('receipt'in next));assert.notEqual(next.hash,current.hash)
  const mutation=(await f.db.query('SELECT result FROM layout_library_mutations WHERE actor_id=$1 AND request_id=$2',[f.actor.id,request.requestId])).rows[0].result
  assert.deepEqual(mutation.receipt.revisionOf,{version:current.version,hash:current.hash});assert.equal(mutation.receipt.requestId,request.requestId);assert.equal(mutation.receipt.outputPackageHash,next.hash)
  current=await f.library.get(f.actor,next.id,next.version);assert.equal(current.validation,null);assert.equal(current.referenceReview,null);assert.equal(current.published,false)
  const source=await f.library.resolveStyleSource(f.actor,{id:next.id,version:next.version,layoutId:'style-adaptation-2'});assert.equal(source.version,1)
 }
 assert.equal(current.version,4)
})
for(const field of ['rights','source','assets'])test('non-metadata '+field+' change leaves latest unchanged',async t=>{
 const f=await setup(t),p=structuredClone(f.current.package)
 if(field==='rights')p.rights.note+=' changed';else if(field==='source')p.source.limitations.push('changed');else {const {default:sharp}=await import('sharp'),{createHash}=await import('node:crypto'),e=p.designProfile.evidence[0],bytes=await sharp({create:{width:1,height:1,channels:4,background:'#ffffff'}}).png().toBuffer();p.decorativeAssets=[{id:'paper',dataUrl:'data:image/png;base64,'+bytes.toString('base64'),sha256:createHash('sha256').update(bytes).digest('hex'),source:{sha256:e.fileSha256,page:e.pageNumber,objectNumber:8},rights:{basis:'permission',shareAllowed:false}}];p.layouts[0].decorations=[{assetId:'paper',rect:{x:0,y:0,w:1,h:1},placement:'background'}]}
 assert.doesNotThrow(()=>validatePackage(p))
 await assert.rejects(()=>f.library.revise(f.actor,{id:f.current.id,expectedVersion:2,requestId:'blocked-'+field,package:p}),/仅支持修改/)
 assert.equal((await f.library.get(f.actor,f.current.id)).version,2)
})
test('missing current private receipt and foreign administrator cannot mint revision provenance',async t=>{
 const f=await setup(t),p={...f.current.package,name:'No bypass'}
 await assert.rejects(()=>f.library.revise({id:'other-admin',role:'admin'},{id:f.current.id,expectedVersion:2,requestId:'foreign',package:p}))
 await f.db.query('DELETE FROM layout_library_mutations WHERE actor_id=$1 AND request_id=$2',[f.actor.id,'derive'])
 await assert.rejects(()=>f.library.revise(f.actor,{id:f.current.id,expectedVersion:2,requestId:'missing-proof',package:p}))
 assert.equal((await f.library.get(f.actor,f.current.id)).version,2)
})
