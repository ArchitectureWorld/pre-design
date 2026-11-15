import test from 'node:test'
import assert from 'node:assert/strict'
import {decodeLayoutResponse} from '../src/layout-library/response.mjs'
import {createPackage,validatePackage} from '../src/layout-library/contract.mjs'

test('接收完整JSON以及附有说明文字的唯一JSON代码块，保持模型字段不变',()=>{
 const value={reply:'已根据实际参考调整配色。',package:createPackage('参考文件验收')},json=JSON.stringify(value,null,2)
 assert.deepEqual(decodeLayoutResponse(json),value)
 assert.deepEqual(decodeLayoutResponse('根据参考页面调整颜色，其余字段保持。\n\n```json\n'+json+'\n```'),value)
 assert.deepEqual(decodeLayoutResponse('```JSON\n'+json+'\n```\n这是待审阅候选。'),value)
 assert.equal(validatePackage(decodeLayoutResponse('说明\n```\n'+json+'\n```').package).name,value.package.name)
})
test('拒绝多个候选、块外JSON、不完整代码块及损坏JSON，不自动拼补内容',()=>{
 for(const text of ['```json\n{"reply":"a"}\n```\n```json\n{"reply":"b"}\n```','{"reply":"a"}\n```json\n{"reply":"b"}\n```','```json\n{"reply":"incomplete"}','```json\n{"reply":"bad",}\n```','```js\n{"reply":"wrong language"}\n```','仅说明没有结构化结果'])assert.throws(()=>decodeLayoutResponse(text),error=>error.statusCode===409)
})


test('单份原生版式加单独reply可无损归并，但不能混入第二候选或不明字段',()=>{
 const pkg=createPackage('视觉参考'),candidate=JSON.stringify(pkg),prefix='已读取参考。\n```json\n'+candidate+'\n```\n'
 assert.deepEqual(decodeLayoutResponse(prefix+'{"reply":"已提炼颜色"}'),{package:pkg,reply:'已提炼颜色'})
 for(const tail of [candidate,'{"reply":"a","unexpected":true}','{"reply":false}','{"reply":"a"}\n{"reply":"b"}'])assert.throws(()=>decodeLayoutResponse(prefix+tail),error=>error.statusCode===409)
})
