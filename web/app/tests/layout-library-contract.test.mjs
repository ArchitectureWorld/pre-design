import test from 'node:test'
import assert from 'node:assert/strict'
import {validatePackage, packageDigest, createPackage, resolvePage, exportReusable} from '../src/layout-library/contract.mjs'
import {renderNativePage, renderNativeDocument} from '../src/layout-library/render.mjs'
const item={title:'本项目的服务对象',paragraphs:['优先服务周边居民。'],points:['儿童活动','老年健身'],evidenceIndexes:[0]}
const page={id:'visual-page-1',number:1,chapterTitle:'人群与需求',sectionTitle:'服务对象',item}
test('原生资源是可执行输入，不接受孤立截图、任意CSS或外部脚本',()=>{
 const p=createPackage();assert.equal(validatePackage(p).schemaVersion,'pre-design.layout-package.v1')
 assert.throws(()=>validatePackage({...p,css:'body{display:none}'}))
 assert.throws(()=>validatePackage({...p,theme:{...p.theme,fontFamily:'url(https://evil.invalid)'}}))
 assert.throws(()=>validatePackage({...p,formats:['pptx']}))
 assert.equal(packageDigest(p),packageDigest(JSON.parse(JSON.stringify(p))))
})
test('非重叠内容位置、可读对比度与最小字号是强制约束',()=>{
 const p=createPackage();p.layouts[0].slots[1].rect={...p.layouts[0].slots[0].rect};assert.throws(()=>validatePackage(p),/重叠/)
 const q=createPackage();q.theme.ink=q.theme.background;assert.throws(()=>validatePackage(q),/对比/)
 const r=createPackage();r.theme.bodySize=3;assert.throws(()=>validatePackage(r))
})
test('按属性继承：人工 > 局部 > 全局；移除局部只恢复其属性',()=>{
 const g=createPackage();g.theme.accent='#224477'
 const local={overrides:{layoutId:'columns'}}
 const manual={theme:{accent:'#111111'}}
 const a=resolvePage({page,globalPackage:g,local,manual})
 assert.equal(a.theme.accent,'#111111');assert.equal(a.layout.id,'columns')
 const b=resolvePage({page,globalPackage:g,manual})
 assert.equal(b.theme.accent,'#111111');assert.equal(b.layout.id,'points')
 assert.deepEqual(page.item,item)
})
test('主题改变实际HTML；严格转义，不改项目文字和引用',()=>{
 const p=createPackage();const a=resolvePage({page,globalPackage:p});p.theme.accent='#123456'
 const b=resolvePage({page,globalPackage:p});assert.notEqual(renderNativePage(page,a),renderNativePage(page,b))
 const evil={...page,item:{...item,title:'<img src=x onerror=alert(1)>'}}
 assert(!renderNativePage(evil,b).includes('<img src=x'));assert(renderNativePage(evil,b).includes('&lt;img'))
 assert(renderNativeDocument([{...page,nativeLayout:b}],{title:'汇报'}).includes('儿童活动'))
})
test('项目变体导出只保留规则，不把正文/图片/项目身份变成共享资源',()=>{
 const p=createPackage();const spec=resolvePage({page,globalPackage:p})
 const exported=exportReusable({...page,nativeLayout:spec},'可复用版式')
 validatePackage(exported);assert(!JSON.stringify(exported).includes('儿童活动'))
 assert(!JSON.stringify(exported).includes('visual-page-1'))
 assert.equal(exported.rights.shareAllowed,false)
})
test('图片/表格版式必须有相应内容，不允许假图或默默丢表',()=>{
 const p=createPackage();assert.throws(()=>resolvePage({page,globalPackage:p,local:{overrides:{layoutId:'image-left'}}}),/图片/)
 assert.throws(()=>resolvePage({page,globalPackage:p,local:{overrides:{layoutId:'table'}}}),/表格/)
 const tab={...page,item:{...item,table:{columns:['项目','数量'],rows:[['设施','3']]}}}
 const spec=resolvePage({page:tab,globalPackage:p});assert.equal(spec.layout.kind,'table')
 assert(renderNativePage(tab,spec).includes('<table'))
})
