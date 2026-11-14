import test from 'node:test'
import assert from 'node:assert/strict'
import {createPackage} from '../src/layout-library/contract.mjs'
import {validatePublication, samplePages, verifyPages} from '../src/layout-library/validation.mjs'
test('真实Chromium：全部模板试排、反例溢出检测和不合格页面阻断',{timeout:120000},async()=>{
 const p=createPackage();const result=await validatePublication(p);assert.equal(result.status,'passed',JSON.stringify(result));assert.equal(result.pageCount,10);assert(result.overflowGuard)
 const pages=samplePages(p).slice(0,1);pages[0].item.points=['不可丢弃的正文'.repeat(1800)]
 await assert.rejects(()=>verifyPages(pages),/溢出/)
})
