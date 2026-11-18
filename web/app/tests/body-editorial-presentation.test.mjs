import test from 'node:test'
import assert from 'node:assert/strict'
import {JSDOM} from 'jsdom'
import {compositionLayoutSchema} from '../src/layout-library/composition-contract.mjs'
import {renderCompositionPage,RENDERER_V2} from '../src/layout-library/composition-render.mjs'
import {defaultTheme,packageDigest} from '../src/layout-library/contract.mjs'
import {contentStyleMeasurementDocument} from '../src/layout-library/content-driven-style-browser.mjs'
const style={bodyPresentationVersion:1,bodyPresentation:'labeled-paragraph'}
const layout=(s=style)=>({id:'editorial',label:'Editorial',kind:'composition',archetypeId:'editorial',slots:[{id:'title',role:'title',rect:{x:.05,y:.05,w:.9,h:.1}},{id:'body',role:'body',rect:{x:.05,y:.2,w:.9,h:.6},style:structuredClone(s)}]})
const render=(points,s=style)=>renderCompositionPage({id:'page',item:{title:'标题',paragraphs:[],points,evidenceIndexes:[]}},{renderer:RENDERER_V2,canvas:{width:1600,height:900},theme:defaultTheme,layout:layout(s)})
test('explicit editorial body presentation preserves complete text and emphasizes only a short original label',()=>{
 assert.doesNotThrow(()=>compositionLayoutSchema.parse(layout()));
 const words=['治理方向：完整原文 <img src=x> 不改动。','没有标签的完整段落。'];const dom=new JSDOM(render(words)),body=dom.window.document.querySelector('[data-layout-slot-id=body]');
 assert.equal(body.querySelectorAll('ul').length,0);assert.equal(body.querySelector('strong').textContent,'治理方向：');assert.deepEqual([...body.querySelectorAll('p')].map(p=>p.textContent),words);assert.equal(body.querySelectorAll('img').length,0);
})
test('ambiguous labels, URLs and long prose are not promoted to invented headings',()=>{
 for(const text of ['https://example.test：这不是标签','这是一个超过十六个字符而且还在继续的长句子：后文','第一句。下一句：后文','：空标签','普通句子没有冒号'])assert.equal(new JSDOM(render([text])).window.document.querySelectorAll('strong').length,0);
})
test('legacy body markup remains unchanged and new presentation is explicit body-only',()=>{
 const html=render(['治理方向：原文'],{});assert.match(html,/<ul><li>治理方向：原文<\/li><\/ul>/);assert(!html.includes('derived-editorial'));
 for(const alter of [l=>delete l.slots[1].style.bodyPresentationVersion,l=>l.slots[1].style.bodyPresentationVersion=2,l=>l.slots[1].role='claim',l=>l.slots[1].style.bodyPresentation='html',l=>l.slots[1].style.columns=2]){const l=layout();alter(l);assert.equal(compositionLayoutSchema.safeParse(l).success,false)}
})
test('trusted measurement uses the same new body structure rather than measuring the legacy list',()=>{
 const body={schemaVersion:'content-style-measurement-v1',textId:'body-0',role:'body',text:'治理方向：完整原文',width:1000,canvas:{width:1600,height:900},style:{fontFamily:'sans',fontSize:30,fontWeight:400,lineHeight:1.5,letterSpacing:0,align:'left',padding:0,...style}};const html=contentStyleMeasurementDocument({...body,requestHash:packageDigest(body)});const root=new JSDOM(html).window.document.querySelector('[data-layout-slot-id=measure]');assert.equal(root.querySelector('strong').textContent,'治理方向：');assert.equal(root.querySelectorAll('ul').length,0);
})
test('existing design-spec model contract never exposes the new internal presentation fields',async()=>{
 const {z}=await import('zod'),{designSpecSchema}=await import('../src/layout-library/design-spec.mjs');assert(!JSON.stringify(z.toJSONSchema(designSpecSchema)).includes('bodyPresentation'));
})
test('pre-editorial model schemas are byte-hash frozen from commit 0137a61',async()=>{
 const {z}=await import('zod'),{designSpecSchema}=await import('../src/layout-library/design-spec.mjs'),{prototypeSlotContract}=await import('../src/layout-library/native-reference-workflow.mjs');
 assert.equal(packageDigest(z.toJSONSchema(designSpecSchema)),'db91df651e93c7f701129dc590d6451a5da7cf87fd39e14f6d76ece2ff111ad7');
 for(const [v,hash]of Object.entries({'legacy-image-v1':'941350d3c27e2df2f6fd37cb6e57637fd8d2a52ab3e34133470730aa2fa4dea8','role-bound-v2':'7e2fd0b0e5f39337e396c650c328db79eb646d4c604ee4e6af017cf7044c7290','component-bound-v3':'e7cf7e8f322099cc1a21122e468d0e69cc3924999158c303d390364e123d8b81'}))assert.equal(packageDigest(prototypeSlotContract({roles:['title','claim','body','image','source','text']},v)),hash,v)
})
test('legacy model prototype cannot opt into internal editorial rendering even with syntactically valid fields',async()=>{
 const {runReferenceWorkflow}=await import('../src/layout-library/reference-workflow.mjs'),{workflowFixture,referenceStageFixture}=await import('./fixtures/reference-workflow.mjs');const fixture=workflowFixture();fixture.payload.referencePipeline='native-v3';
 await assert.rejects(()=>runReferenceWorkflow({jobId:'reject-editorial-model',...fixture,runModel:async input=>{const r=referenceStageFixture(input);if(input.stage.startsWith('prototype-')){const raw=JSON.parse(r.response),slot=raw.prototypes[0].slots.find(s=>s.role==='body');slot.style={...slot.style,...style};r.response=JSON.stringify(raw)}return r}}),/编辑式正文/)
})
