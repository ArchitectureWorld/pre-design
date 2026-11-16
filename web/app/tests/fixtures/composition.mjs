import {createPackage} from '../../src/layout-library/contract.mjs'

export const firstFigure={materialId:'00000000-0000-4000-8000-000000000001',caption:'合成测试：服务范围示意'}
export const secondFigure={materialId:'00000000-0000-4000-8000-000000000002',caption:'合成测试：公共空间示意'}
export const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
export function compositionProfile(){return {
 schemaVersion:'pre-design.reference-profile.v2',intent:'structure',
 designSystem:{canvas:{width:1200,height:1000},colors:{background:'#f7f9fc',ink:'#24364c',accent:'#3454a0',muted:'#53647c'},typography:{fontFamily:'sans',titleSize:48,bodySize:28,captionSize:18,lineHeight:1.45},spacing:{margin:.04,gutter:.03},evidenceIds:['evidence-1']},
 archetypes:[{id:'mixed-analysis',pageType:'mixed',structure:'asymmetric-columns',density:'medium',roles:['title','claim','body','image','table','source'],capacity:{images:2,bodyPoints:4,tableRows:3},evidenceIds:['evidence-1']}],
 rules:[],evidence:[{id:'evidence-1',provenance:'user'}],limitations:[],
}}
export function compositionPackage(){
 const p=createPackage('合成组合版式')
 const s=(id,role,x,y,w,h,selection={})=>({id,role,rect:{x,y,w,h},...selection})
 return {...p,schemaVersion:'pre-design.layout-package.v2',canvas:{width:1200,height:1000},theme:{...p.theme,bodySize:28,lineHeight:1.45},designProfile:compositionProfile(),layouts:[{
  id:'mixed',label:'图文数据组合',kind:'composition',archetypeId:'mixed-analysis',slots:[
   s('heading','title',.04,.04,.92,.13),s('thesis','claim',.04,.20,.92,.09),
   s('body-left','body',.04,.32,.42,.22,{range:{start:0,end:2}}),s('body-right','body',.52,.32,.44,.22,{range:{start:2,end:4}}),
   s('map','image',.04,.59,.27,.25,{index:0}),s('photo','image',.34,.59,.27,.25,{index:1}),s('metrics','table',.65,.59,.31,.25,{style:{fontSize:22}}),
   s('citation','source',.04,.91,.92,.05),
  ],
 }]}
}
export function compositionPage(){return {
 id:'composition-page-1',number:1,chapterTitle:'合成试排 · 公共服务',sectionTitle:'服务配置',
 item:{title:'围绕居民日常服务需求组织公共空间改善与分期实施安排',paragraphs:['本页为合成测试内容，用于核对长标题、多段正文、两张图片与结构化表格能否同时完整呈现。'],points:['优先改善步行可达的公共活动空间与服务设施。','结合不同年龄人群的活动时间安排开放管理。','建设内容需要衔接后续运营与日常维护安排。','按照场地条件组织实施顺序并保留调整空间。'],evidenceIndexes:[0],figures:[{...firstFigure},{...secondFigure}],table:{columns:['项目','一期','二期'],rows:[['服务设施','3','2'],['开放空间','2','4'],['活动时段','日间','全天']]}},
 nativeAssets:{images:[{dataUrl:PNG,materialId:firstFigure.materialId},{dataUrl:PNG,materialId:secondFigure.materialId}]},
}}
