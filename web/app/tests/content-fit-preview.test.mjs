import test from 'node:test';import assert from 'node:assert/strict'
import {createContentFitPreviews} from '../src/layout-library/content-fit-preview.mjs'
import {nativeDesignInput} from './fixtures/native-design-v3-fixture.mjs'
import {compileNativeDesignPackageV3} from '../src/layout-library/native-design-compiler.mjs'
import {deriveContentFitPolicy} from '../src/layout-library/content-fit-policy.mjs'
import {packageDigest} from '../src/layout-library/contract.mjs'
function setup(){
 const x=nativeDesignInput(),l=x.prototypes[0],s=l.slots.find(s=>s.role==='body');s.role='text';s.binding='body';delete s.range;delete s.index;x.designSpec.profile.archetypes[0].roles=x.designSpec.profile.archetypes[0].roles.map(r=>r==='body'?'text':r);Object.assign(x.designSpec.profile.archetypes[0].capacity,{bodyPoints:0,textBlocks:1});Object.assign(l.contentFitRules,{maxBodyPoints:0,maxBodyCharacters:0,maxTextBlocks:1,maxTextCharacters:1000});const e=x.designSpec.profile.evidence[0],source={fileSha256:e.fileSha256,pageNumber:e.pageNumber};l.contentAdaptationPolicy=deriveContentFitPolicy({observation:{source,components:[{id:'card',kind:'group',rect:{x:0,y:0,w:1,h:1}},{id:s.id,kind:'text',purpose:'body',parentId:'card',rect:s.rect}]},allowedSources:[source],layout:l});
 const pkg=compileNativeDesignPackageV3(x),resource={id:'resource',version:1,latestVersion:1,hash:packageDigest(pkg),ownerId:'owner',package:pkg},actor={id:'owner'},stats={measure:0,check:0,save:0};let now=1000;
 const library={get:async()=>resource,revise:async(a,b)=>{stats.save++;assert.equal(b.expectedHash,resource.hash);assert.equal(b.requireActive,true);return{id:resource.id,version:2}}};
 const service=createContentFitPreviews({library,clock:()=>now,measure:async()=>{stats.measure++;return{slots:[{slotId:s.id,requiredWidth:s.rect.w*1600,requiredHeight:s.rect.h*900}]}},check:async()=>{stats.check++;return{pages:1,issues:[]}}});
 const body={layoutId:l.id,title:'试排标题',textBlocks:[{key:'body',text:'仅私有试排正文'}],policies:[{slotId:s.id,direction:'down'}]};return{library,service,actor,body,resource,stats,advance:()=>now+=20*60*1000};
}
test('server preview remeasures, preserves source and stores no trial text in reusable package',async()=>{const x=setup(),before=JSON.stringify(x.resource.package),r=await x.service.preview(x.actor,'resource',1,x.body);assert.equal(x.stats.measure,1);assert.equal(x.stats.check,1);assert.equal(x.stats.save,0);assert.equal(JSON.stringify(x.resource.package),before);assert(r.afterHtml.includes('仅私有试排正文'));assert.equal(r.visualAcceptance,'pending');const saved=await x.service.confirm(x.actor,'resource',{previewId:r.previewId,requestId:'confirm',reviewed:true});assert.equal(saved.version,2);assert.equal(x.stats.save,1)})
test('foreign owner, stale version and expired receipt cannot save or trigger hidden measurements',async()=>{const x=setup();await assert.rejects(x.service.preview({id:'other'},'resource',1,x.body));assert.equal(x.stats.measure,0);await assert.rejects(x.service.preview(x.actor,'resource',2,x.body));const p=await x.service.preview(x.actor,'resource',1,x.body);await assert.rejects(x.service.confirm({id:'other'},'resource',{previewId:p.previewId,requestId:'x',reviewed:true}));x.advance();await assert.rejects(x.service.confirm(x.actor,'resource',{previewId:p.previewId,requestId:'x',reviewed:true}));assert.equal(x.stats.save,0)})
test('client rectangles or measurements and unreviewed commits are rejected',async()=>{const x=setup();await assert.rejects(x.service.preview(x.actor,'resource',1,{...x.body,measurement:{slots:[]}}));await assert.rejects(x.service.preview(x.actor,'resource',1,{...x.body,policies:[{...x.body.policies[0],rect:{x:0,y:0,w:1,h:1}}]}));const p=await x.service.preview(x.actor,'resource',1,x.body);await assert.rejects(x.service.confirm(x.actor,'resource',{previewId:p.previewId,requestId:'x',reviewed:false}));assert.equal(x.stats.save,0)})

test('busy actor does not accumulate queued preview work and failure releases admission',async()=>{
 const x=setup();let release,calls=0;const gate=new Promise(r=>release=r),service=createContentFitPreviews({library:x.library,measure:async()=>{calls++;await gate;throw Error('MEASUREMENT_FAILED')},check:async()=>({pages:1,issues:[]})});
 const first=service.preview(x.actor,'resource',1,x.body).catch(e=>e);await new Promise(r=>setImmediate(r));const rest=Array.from({length:100},()=>service.preview(x.actor,'resource',1,x.body).catch(e=>e));await new Promise(r=>setImmediate(r));
 try{assert.equal(calls,1)}finally{release();await first;await Promise.all(rest)}
 const errors=await Promise.all(rest);assert(errors.every(e=>e.statusCode===429));await assert.rejects(service.preview(x.actor,'resource',1,x.body),/MEASUREMENT_FAILED/);assert.equal(calls,2)
})
test('cancelled preview releases active admission and cannot mint a receipt',async()=>{
 const x=setup(),controller=new AbortController();let started,call=0;const ready=new Promise(r=>started=r),service=createContentFitPreviews({library:x.library,measure:async(html,{signal})=>{call++;started();await new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true})});},check:async()=>({pages:1,issues:[]})});
 controller.abort();await assert.rejects(service.preview(x.actor,'resource',1,x.body,{signal:controller.signal}));assert.equal(call,0);
 const during=new AbortController(),pending=service.preview(x.actor,'resource',1,x.body,{signal:during.signal});await ready;during.abort();await assert.rejects(pending);assert.equal(call,1)
 const third=new AbortController();third.abort();await assert.rejects(service.preview(x.actor,'resource',1,x.body,{signal:third.signal}));assert.equal(call,1)
})
test('HTTP preview has small body limit and rejects invalid input before database or queue',async()=>{
 const {default:Fastify}=await import('fastify'),{registerLayoutRoutes}=await import('../src/layout-library/routes.mjs');const app=Fastify({bodyLimit:16*1024*1024});let gets=0;app.addHook('preHandler',async req=>{req.user={id:'owner'}});registerLayoutRoutes({app,library:{get:async()=>{gets++;throw Error('UNEXPECTED')}},serial:()=>{throw Error('QUEUE_FORBIDDEN')}});
 try{const url='/api/layout-library/00000000-0000-4000-8000-000000000001/1/content-fit-preview';const large=await app.inject({method:'POST',url,payload:{padding:'x'.repeat(300000)}});assert.equal(large.statusCode,413);const invalid=await app.inject({method:'POST',url,payload:{padding:'x'.repeat(100000)}});assert(invalid.statusCode>=400);assert.equal(gets,0)}finally{await app.close()}
})
