import test from 'node:test'
import assert from 'node:assert/strict'
import {createPackage,validatePackage,resolvePage,exportReusable,assertInstanceContent} from '../src/layout-library/contract.mjs'
import {renderNativePage,renderNativeDocument} from '../src/layout-library/render.mjs'
import {JSDOM} from 'jsdom'
import {compositionPackage,compositionPage,firstFigure,secondFigure} from './fixtures/composition.mjs'

test('V2 保留参考画布，分区正文、多图和表格在同一原生页完整呈现',()=>{
 const pkg=validatePackage(compositionPackage()),page=compositionPage()
 const spec=resolvePage({page,globalPackage:pkg})
 assert.equal(spec.renderer,'pre-design-native-html-v2.0')
 assert.deepEqual(spec.canvas,{width:1200,height:1000})
 const html=renderNativePage(page,spec)
 assert.match(html,/aspect-ratio:1200\/1000/)
 assert.equal((html.match(/<img /g)??[]).length,2)
 assert.equal((html.match(/<table/g)??[]).length,1)
 for(const value of [...page.item.paragraphs,...page.item.points,...page.item.figures.map(f=>f.caption),'服务设施'])assert(html.includes(value),value)
 for(const value of page.item.points)assert.equal(html.split(value).length-1,1)
 assert.match(html,/data-layout-slot-id="body-right"/)
 const document=renderNativeDocument([{...page,nativeLayout:spec}])
 assert.match(document,/@page[^}]*120mm 100mm/)
})

test('组合选择拒绝遗漏、重复、越界以及手动指定的不兼容版式',()=>{
 const page=compositionPage(),p=compositionPackage()
 for(const transform of [
  l=>{l.slots=l.slots.filter(s=>s.id!=='photo')},
  l=>{l.slots.find(s=>s.id==='body-right').range={start:1,end:4}},
  l=>{l.slots.find(s=>s.id==='map').index=2},
  l=>{l.slots=l.slots.filter(s=>s.role!=='table')},
  l=>{l.slots=l.slots.filter(s=>s.role!=='source')},
 ]){
  const invalid=structuredClone(p);transform(invalid.layouts[0])
  assert.throws(()=>resolvePage({page,globalPackage:invalid}),/覆盖|遗漏|重复|越界|适合|来源|表格|图片/)
 }
 const textOnly=structuredClone(p.layouts[0]);textOnly.id='text-only';textOnly.slots=textOnly.slots.filter(s=>!['image','table'].includes(s.role))
 p.layouts.unshift(textOnly)
 assert.equal(resolvePage({page,globalPackage:p}).layout.id,'mixed')
 assert.throws(()=>resolvePage({page,globalPackage:p,manual:{layoutId:'text-only'}}),/覆盖|遗漏|表格|图片/)
 assert.throws(()=>resolvePage({page,globalPackage:p,manual:{layoutId:'absent'}}),/版式/)
})

test('组合槽位只接受受限样式；重叠必须双方声明并给出不同层级',()=>{
 const p=compositionPackage()
 for(const mutate of [
  p=>{p.layouts[0].slots[0].style={css:'position:fixed'}},
  p=>{p.layouts[0].slots[0].style={color:'url(https://invalid.test)'}},
  p=>{p.layouts[0].slots[0].style={color:'#ffffff',background:'#ffffff'}},
  p=>{p.layouts[0].slots[0].style={fontSize:2}},
  p=>{p.layouts[0].slots[1].rect={...p.layouts[0].slots[0].rect}},
  p=>{p.layouts[0].slots[0].range={start:0,end:1}},
  p=>{p.layouts[0].slots[4].range={start:0,end:1}},
  p=>{p.layouts[0].archetypeId='unknown'},
 ]){const q=structuredClone(p);mutate(q);assert.throws(()=>validatePackage(q))}
 const [a,b]=p.layouts[0].slots
 b.rect={...a.rect};a.overlap=b.overlap='allow';a.layer=0;b.layer=1
 assert.doesNotThrow(()=>validatePackage(p))
 b.layer=0;assert.throws(()=>validatePackage(p),/层|重叠/)
})

test('V2 原型引用与画布比例经过校验，空正文封面不要求伪造要点',()=>{
 const p=compositionPackage(),page=compositionPage()
 p.layouts[0].slots=p.layouts[0].slots.filter(s=>['title','source'].includes(s.role))
 page.item={title:'公共服务空间更新策划',paragraphs:[],points:[],evidenceIndexes:[]}
 assert.doesNotThrow(()=>resolvePage({page,globalPackage:p}))
 const q=compositionPackage();q.canvas={width:1600,height:900};assert.throws(()=>validatePackage(q),/画布|比例/)
})

test('图表、时间轴和关系图输出真实数据和连接，拒绝无效或可执行内容',()=>{
 const page=compositionPage(),p=compositionPackage()
 delete page.item.figures;delete page.item.table
 page.item.chart={type:'bar',title:'合成设施数量',categories:['一期','二期'],series:[{name:'社区设施',values:[3,-2]}],unit:'处'}
 page.item.timeline={title:'合成实施顺序',events:[{label:'准备阶段',description:'核对既有资料'},{label:'实施阶段',description:'落实建设安排'}]}
 page.item.diagram={title:'合成协作关系',direction:'horizontal',nodes:[{id:'a',label:'公共服务'},{id:'b',label:'运营维护'}],edges:[{from:'a',to:'b',label:'移交'}]}
 const media=p.layouts[0].slots.filter(s=>['image','table'].includes(s.role))
 media.forEach((s,i)=>{s.role=['chart','timeline','diagram'][i];delete s.index})
 const html=renderNativePage(page,resolvePage({page,globalPackage:p}))
 for(const value of ['社区设施','一期','二期','-2','准备阶段','落实建设安排','公共服务','运营维护','移交'])assert(html.includes(value),value)
 assert.match(html,/data-chart-series="0"/);assert.match(html,/data-diagram-edge="a:b"/)
 assertInstanceContent(page)
 const invalid=structuredClone(page);invalid.item.chart.series[0].values=[3];assert.throws(()=>assertInstanceContent(invalid))
 invalid.item.chart=structuredClone(page.item.chart);invalid.item.diagram.edges[0].to='missing';assert.throws(()=>assertInstanceContent(invalid))
 invalid.item.diagram=structuredClone(page.item.diagram);invalid.item.chart.html='<script>evil()</script>';assert.throws(()=>assertInstanceContent(invalid))
})

test('V1 保持单图别名兼容，但拒绝无法承载的多图和新型内容',()=>{
 const page=compositionPage(),p=createPackage()
 delete page.item.table;page.item.figures=[firstFigure]
 const spec=resolvePage({page,globalPackage:p})
 assert.equal(spec.renderer,'pre-design-native-html-v1.0');assert.equal(spec.layout.kind,'image-left')
 assert.match(renderNativePage(page,spec),/服务范围示意/)
 page.item.figures=[firstFigure,secondFigure];assert.throws(()=>resolvePage({page,globalPackage:p}),/图片|多图|覆盖/)
 delete page.item.figures;page.item.chart={type:'bar',categories:['甲','乙'],series:[{name:'数量',values:[1,2]}]}
 assert.throws(()=>resolvePage({page,globalPackage:p}),/图表|组合|承载/)
})

test('可复用 V2 导出保留覆盖和设计规则，人工样式仍优先且不携带项目材料',()=>{
 const p=compositionPackage(),page=compositionPage()
 const spec=resolvePage({page,globalPackage:p,globalOverrides:{theme:{accent:'#224477'}},local:{overrides:{theme:{accent:'#334466'}}},manual:{theme:{accent:'#111111'}}})
 assert.equal(spec.theme.accent,'#111111')
 const exported=exportReusable({...page,nativeLayout:spec},'组合资源副本')
 assert.equal(exported.schemaVersion,'pre-design.layout-package.v2')
 assert.deepEqual(exported.canvas,{width:1200,height:1000})
 assert.deepEqual(exported.designProfile,p.designProfile)
 for(const value of [page.item.title,firstFigure.materialId,firstFigure.caption,'composition-page-1','data:image'])assert(!JSON.stringify(exported).includes(value),value)
 assert.doesNotThrow(()=>validatePackage(exported))
})

test('原生页样式属性在 HTML 解析后仍保留字体与 V2 画布比例',()=>{
 const page=compositionPage(),v2=resolvePage({page,globalPackage:compositionPackage()})
 const parsed=new JSDOM(renderNativePage(page,v2)).window.document.querySelector('article')
 assert.equal(parsed.style.aspectRatio,'1200/1000')
 assert.equal(parsed.style.getPropertyValue('--ln-font'),'"Noto Sans CJK SC","Microsoft YaHei",sans-serif')
 const textPage={...page,item:{title:'V1 兼容检查',paragraphs:[],points:[],evidenceIndexes:[]}}
 const v1=resolvePage({page:textPage,globalPackage:createPackage()})
 const legacy=new JSDOM(renderNativePage(textPage,v1)).window.document.querySelector('article')
 assert.equal(legacy.style.getPropertyValue('--ln-font'),'"Noto Sans CJK SC","Microsoft YaHei",sans-serif')
})

test('页面内容在选版后增加时，渲染器仍拒绝旧版式遗漏新内容',()=>{
 const page=compositionPage(),spec=resolvePage({page,globalPackage:compositionPackage()})
 page.item.points.push('后来增加的第五条关键内容')
 assert.throws(()=>renderNativePage(page,spec),/覆盖|遗漏/)
 const legacyPage={...page,item:{title:'旧版检查',paragraphs:[],points:['原有内容'],evidenceIndexes:[]}}
 const legacy=resolvePage({page:legacyPage,globalPackage:createPackage()})
 legacyPage.item.figures=[firstFigure,secondFigure]
 assert.throws(()=>renderNativePage(legacyPage,legacy),/覆盖|图片|组合/)
})
