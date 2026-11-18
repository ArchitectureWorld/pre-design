import test from 'node:test'
import assert from 'node:assert/strict'
import {packageDigest} from '../src/layout-library/contract.mjs'
import {contentStyleMeasurementDocument} from '../src/layout-library/content-driven-style-browser.mjs'
const request=role=>{const r={schemaVersion:'content-style-measurement-v1',textId:'text-1',role,text:'真实 <img src="https://invalid.test/x"> 原文',width:640,canvas:{width:1600,height:900},style:{fontFamily:'sans',fontSize:36,fontWeight:500,lineHeight:1.35,letterSpacing:0,align:'left',padding:0}};return {...r,requestHash:packageDigest(r)}}
test('measurement uses native composition role structure and escaped complete text',()=>{for(const role of ['title','claim','body']){const html=contentStyleMeasurementDocument(request(role));assert.match(html,/data-layout-slot-id="measure"/);assert.match(html,role==='title'?/<h2>真实 &lt;img/:role==='claim'?/<p>真实 &lt;img/:/<ul><li>真实 &lt;img/);assert(!html.includes('<img src='));assert.match(html,/\.ln-body ul\{padding-left:1.3em\}/)}})
test('changed request hash and unsupported typography are rejected before browser launch',()=>{const r=request('body');assert.throws(()=>contentStyleMeasurementDocument({...r,text:'changed'}));const {requestHash,...bad}=r;bad.style={...bad.style,fontFamily:'url(https://invalid.test/font)'};assert.throws(()=>contentStyleMeasurementDocument({...bad,requestHash:packageDigest(bad)}));assert.throws(()=>contentStyleMeasurementDocument({...r,extra:'untrusted'}))})
test('DOM integer scroll dimensions do not invent fractional-width overflow, real line bounds remain authoritative',async()=>{
 const {contentStyleRequiredWidth}=await import('../src/layout-library/content-driven-style-browser.mjs');assert.equal(typeof contentStyleRequiredWidth,'function')
 assert.equal(contentStyleRequiredWidth({outerWidth:1401.59375,scrollWidth:1402,clientWidth:1402,lineRight:1018.8125}),1401.59375)
 assert.equal(contentStyleRequiredWidth({outerWidth:1401.59375,scrollWidth:1404,clientWidth:1402,lineRight:1403.2}),1404)
 assert.equal(contentStyleRequiredWidth({outerWidth:1401.59375,scrollWidth:1402,clientWidth:1402,lineRight:1402.1}),1402.1)
})
