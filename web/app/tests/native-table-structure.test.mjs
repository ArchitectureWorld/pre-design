import test from 'node:test'
import assert from 'node:assert/strict'
import {nativeTableSchema} from '../src/layout-library/contract.mjs'
import {renderStructuredTable} from '../src/layout-library/table-structure.mjs'
const table=()=>({columns:['类别','值'],rows:[['甲','1'],['','2']],merges:[{row:0,column:0,rowSpan:2,colSpan:1}]})
test('editable body merge keeps all nonempty content and emits actual table semantics',()=>{
 const t=nativeTableSchema.parse(table()),html=renderStructuredTable(t)
 assert.match(html,/rowspan="2"/);assert.equal((html.match(/>甲</g)??[]).length,1);assert.match(html,/>1</);assert.match(html,/>2</)
})
test('merge cannot discard nonempty covered values or overlap, overflow or use noninteger bounds',()=>{
 for(const mutate of [t=>t.rows[1][0]='不可丢失',t=>t.merges.push({...t.merges[0]}),t=>t.merges[0].rowSpan=3,t=>t.merges[0].column=.5,t=>t.merges[0].rowSpan=0]){const t=table();mutate(t);assert.equal(nativeTableSchema.safeParse(t).success,false);assert.throws(()=>renderStructuredTable(t))}
})
test('unmerged table and script-like values stay escaped without changing visible data',()=>{
 const t={columns:['甲','乙'],rows:[['<script>','正文']]};assert.ok(nativeTableSchema.safeParse(t).success)
 const html=renderStructuredTable(t);assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);assert.match(html,/>正文</)
})
test('real composition and draft-preview paths share merged table rendering',async()=>{
 const {compositionPackage,compositionPage}=await import('./fixtures/composition.mjs')
 const {resolvePage}=await import('../src/layout-library/contract.mjs')
 const {renderNativePage}=await import('../src/layout-library/render.mjs')
 const {renderWorkflowItem}=await import('../src/workflow-content.mjs')
 const page=compositionPage();page.item.table=table()
 const html=renderNativePage(page,resolvePage({page,globalPackage:compositionPackage()}))
 for(const value of [html,renderWorkflowItem(page.item)]){assert.match(value,/rowspan="2"/);assert.equal((value.match(/>甲</g)??[]).length,1);assert.match(value,/>2</)}
 page.item.table.rows[1][0]='保护内容';assert.throws(()=>renderNativePage(page,resolvePage({page,globalPackage:compositionPackage()})))
})
test('Markdown and plain text retain merged-group meaning and disclose flattening',async()=>{
 const {workflowBodyMarkdown,workflowItemText}=await import('../src/workflow-content.mjs')
 const item={title:'测试',paragraphs:[],points:[],table:table()}
 for(const value of [workflowBodyMarkdown([item]),workflowItemText(item)]){assert.match(value,/合并单元格已展开/);assert.match(value,/甲 \| 1/);assert.match(value,/甲 \| 2/)}
 assert.equal(item.table.rows[1][0],'')
})
test('grouped single header preserves blank covered headers and exports their grouping',async()=>{
 const t={columns:['分类','','','面积','占比'],headerMerges:[{column:0,colSpan:3}],rows:[['公共','服务','中心','20','20%']]};
 assert.equal(nativeTableSchema.safeParse(t).success,true)
 assert.match(renderStructuredTable(t),/<th scope="colgroup" colspan="3">分类<\/th>/)
 const {workflowBodyMarkdown}=await import('../src/workflow-content.mjs');const md=workflowBodyMarkdown([{title:'分组',paragraphs:[],points:[],table:t}]);assert.match(md,/分类 \| 分类 \| 分类 \| 面积/);assert.match(md,/合并单元格已展开/)
 for(const bad of [{...t,columns:['分类','不可覆盖','','面积','占比']},{...t,headerMerges:[{column:0,colSpan:6}]},{...t,headerMerges:[{column:0,colSpan:3},{column:1,colSpan:2}]},{...t,headerMerges:[]}]){assert.equal(nativeTableSchema.safeParse(bad).success,false);assert.throws(()=>renderStructuredTable(bad))}
 assert.equal(t.columns[1],'')
})
test('table visual geometry preserves explicit column ratios and compact grid without content edits',async()=>{
 const {compositionPackage,compositionPage}=await import('./fixtures/composition.mjs');const {resolvePage}=await import('../src/layout-library/contract.mjs');const {renderNativePage}=await import('../src/layout-library/render.mjs');const pkg=compositionPackage(),page=compositionPage();page.item.table=table();const slot=pkg.layouts[0].slots.find(s=>s.role==='table');slot.style={...slot.style,tableDensity:'compact',tableGrid:true,tableColumnWidths:[1,3]};
 const html=renderNativePage(page,resolvePage({page,globalPackage:pkg}));assert.match(html,/ln-table-compact ln-table-grid/);assert.match(html,/<col style="width:25%">/);assert.match(html,/<col style="width:75%">/);assert.match(html,/>甲</)
 slot.style.tableColumnWidths=[1,2,3];assert.throws(()=>renderNativePage(page,resolvePage({page,globalPackage:pkg})))
})
test('synthetic previews honor declared table column geometry instead of inventing a three-column table',async()=>{const {compositionPackage}=await import('./fixtures/composition.mjs');const{samplePages}=await import('../src/layout-library/validation.mjs');const{renderNativePage}=await import('../src/layout-library/render.mjs');const p=compositionPackage();p.layouts[0].slots.find(s=>s.role==='table').style.tableColumnWidths=[1,2,3,4];const pages=samplePages(p);assert(pages.length);for(const page of pages){assert.equal(page.item.table.columns.length,4);assert.doesNotThrow(()=>renderNativePage(page))}})
test('compact narrow group columns use newly authored short synthetic labels, never truncate real table data',async()=>{const {compositionPackage}=await import('./fixtures/composition.mjs');const{samplePages}=await import('../src/layout-library/validation.mjs');const p=compositionPackage();p.layouts[0].slots.find(s=>s.role==='table').style={fontSize:22,tableDensity:'compact',tableColumnWidths:[1,2,3,4,4]};const rows=samplePages(p)[0].item.table.rows;assert.deepEqual(rows[0],['1','组','项','3','10%']);assert.equal(rows.length,3)})
