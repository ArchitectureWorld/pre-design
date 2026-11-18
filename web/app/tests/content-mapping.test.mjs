import test from 'node:test'
import assert from 'node:assert/strict'
const api=await import('../src/layout-library/content-mapping.mjs').catch(()=>({}))
const item=()=>({id:'item-1',title:'标题',paragraphs:['完整原文😀','未映射段落'],points:['要点'],evidenceIndexes:[0]})
test('explicit projection keeps untouched content and source immutable',()=>{
 assert.equal(typeof api.contentSourceOptions,'function','source mapping implementation required')
 const source=item(),before=structuredClone(source),options=api.contentSourceOptions(source)
 assert.deepEqual(options.sources[0],{source:{field:'paragraphs',index:0},quote:'完整原文😀'})
 const mapping={sourceFingerprint:options.sourceFingerprint,entries:[{source:{field:'paragraphs',index:0},quote:'完整原文😀',targetKey:'subheading',spans:[{start:4,end:5,quote:'😀',style:'accent'}]}]}
 const projected=api.projectContentMapping(source,mapping)
 assert.deepEqual(projected.paragraphs,['未映射段落']);assert.deepEqual(projected.points,['要点'])
 assert.deepEqual(projected.textBlocks,[{key:'subheading',text:'完整原文😀',spans:mapping.entries[0].spans}]);assert.deepEqual(source,before)
 assert.deepEqual(api.projectContentMapping(source,mapping),projected)
})
test('stale source, forged quote, duplicate sources/keys and existing target collision reject',()=>{
 assert.equal(typeof api.projectContentMapping,'function')
 const source=item(),entry={source:{field:'points',index:0},quote:'要点',targetKey:'label'},mapping={sourceFingerprint:api.contentSourceOptions(source).sourceFingerprint,entries:[entry]}
 for(const changed of [{...source,title:'变动标题'},{...source,points:['变更要点']}])assert.throws(()=>api.projectContentMapping(changed,mapping))
 for(const entries of [[{...entry,quote:'伪造'}],[entry,entry],[entry,{source:{field:'paragraphs',index:0},quote:'完整原文😀',targetKey:'label'}],[{...entry,source:{field:'title',index:0}}]])assert.throws(()=>api.projectContentMapping(source,{...mapping,entries}))
 const withBlock={...source,textBlocks:[{key:'label',text:'原有文字'}]};assert.throws(()=>api.projectContentMapping(withBlock,{...mapping,sourceFingerprint:api.contentSourceOptions(withBlock).sourceFingerprint}))
})
