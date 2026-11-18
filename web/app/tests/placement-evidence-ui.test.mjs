import test from 'node:test';import assert from 'node:assert/strict';import * as api from '../src/layout-library/review-ui.js'
const valid={status:'available',sourceSha256:'a'.repeat(64),page:13,occurrenceCount:3,clippedOrUncertainCount:1}
test('private image drawing counts are described as observations, never extracted editable tables',()=>{
 assert.equal(typeof api.placementEvidenceText,'function')
 const text=api.placementEvidenceText(valid,13);assert.match(text,/3 次图像绘制/);assert.match(text,/不代表/);assert.match(text,/可编辑/);assert.match(text,/13/)
 assert(!text.includes('原生表格已提取'))
})
test('missing and unavailable evidence do not become zero objects; source mismatch fails closed',()=>{
 assert.equal(typeof api.placementEvidenceText,'function')
 for(const data of [undefined,{status:'not-collected'},{status:'unavailable'}, {...valid,page:15},{...valid,occurrenceCount:NaN},{...valid,clippedOrUncertainCount:4}]){
 const text=api.placementEvidenceText(data,13);assert(!text.includes('0 次'));assert(!text.includes('3 次'));assert.match(text,/未采集|未知|不可用/)
 }
 assert.match(api.placementEvidenceText({...valid,page:undefined},undefined),/未知/)
 assert.match(api.placementEvidenceText({...valid,occurrenceCount:0,clippedOrUncertainCount:0},13),/0 次图像绘制/)
})
