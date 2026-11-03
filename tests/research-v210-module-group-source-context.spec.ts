import {expect,it} from 'vitest'
import * as api from '../src/research-v2/module-group-source-context.ts'
import {sha256CanonicalJson} from '../src/presentation/canonical-json.ts'
import {moduleReferencePromptView,expandModuleReferencePromptView} from '../src/research-v2/module-reference-context.ts'

it.each(['denominator','formula'])('scopes the standalone market %s task to original sources while withholding unassigned regional claims explicitly', field => {
  const sources={corpus:{documents:[{path:'统计原件.pdf',contentHash:'original-hash',pages:[{page:12,text:'统计口径与原始数值。'}]}]},
    sourceValues:[{sourceId:'original-statistic',path:'统计原件.pdf',page:12,quote:'统计口径与原始数值。',rawValue:'原始数值'}],
    inputRefs:[{moduleId:'preplan.research.02.01',resultHash:'frozen-regional-result'}],
    upstream:[{itemId:'2.01',moduleId:'preplan.research.02.01',outputs:{regional:{type:'regional',scope:'冻结区域范围',asOf:'2026-09-28',quality:'limited',limitations:['缺实测边界，条件不证明现状。'],records:[{recordId:'regional-1',resultClass:'inference',geometry:{value:null,claimClass:'missing'}}]}},
      claims:[{claimId:'regional-role',value:'条件研究未完成。'.repeat(1500),limitations:['不能证明当前需求。']}],limitations:['完整上游限制。'.repeat(1000)]}]};
  const original=structuredClone(sources),identity=sha256CanonicalJson(sources),scoped:any=api.moduleAuthorGroupSourceContext('3.01',[field],sources);
  for(const key of ['corpus','sourceValues','inputRefs'])expect(scoped[key]).toEqual(original[key as keyof typeof original]);
  expect(scoped.upstream[0]).toMatchObject({itemId:'2.01',moduleId:'preplan.research.02.01',outputInventory:{regional:{scope:'冻结区域范围',quality:'limited',limitations:['缺实测边界，条件不证明现状。'],records:[{recordId:'regional-1',resultClass:'inference',fieldClasses:{geometry:'missing'}}]}}});
  for(const key of ['outputs','claims','limitations'])expect(Object.hasOwn(scoped.upstream[0],key)).toBe(false);
  expect(scoped.groupSourceScope).toMatchObject({fullSourceContextHash:identity,upstreamClaimsAvailable:false,upstreamOutputsInventoryOnly:true,marketOriginalFieldOnly:true,omitted:['upstream.outputs','upstream.claims','upstream.limitations']});
  expect(scoped.groupSourceScope.reason).toContain('不得引用未提供的上游claim');
  expect(expandModuleReferencePromptView(moduleReferencePromptView(scoped))).toEqual(scoped);
  expect(JSON.stringify(scoped).length).toBeLessThan(JSON.stringify(sources).length/4);
  expect(sources).toEqual(original);expect(sha256CanonicalJson(sources)).toBe(identity);
  for(const fields of [[field,'region'],['projectImpactHypothesis'],['denominator','formula']]){
    const full:any=api.moduleAuthorGroupSourceContext('3.01',fields,sources);
    expect(full.upstream[0].claims).toEqual(original.upstream[0].claims);
    expect(full.upstream[0].limitations).toEqual(original.upstream[0].limitations);
  }
  expect(api.moduleAuthorGroupSourceContext('3.04',[field],sources)).toBe(sources);
});

it('bounds market analysis field groups while keeping exact upstream claims and conditional restrictions', () => {
  const note='历史规划角色及消费背景不是当前客流、经营状态或测算结论。'
  const sources={corpus:{documents:[{path:'原件.pdf',contentHash:'frozen-original',pages:[{page:14,text:'2020 年原始统计段落。'}]}]},
    sourceValues:[{sourceId:'original-period',path:'原件.pdf',page:14,quote:'2020 年原始统计段落。',rawValue:'2020'}],inputRefs:[{moduleId:'preplan.research.01.01',resultHash:'project-result'},{moduleId:'preplan.research.02.01',resultHash:'regional-result'}],
    upstream:['1.01','2.01'].map(itemId=>({itemId,moduleId:'preplan.research.'+itemId,
      outputs:{published:{type:'professional-upstream',quality:itemId==='2.01'?'limited':'accepted',scope:'原始研究范围',asOf:'2026-09-26',limitations:[note],records:[{recordId:'original-'+itemId,resultClass:'inference',
        role:{value:'规划适用条件',claimClass:'inference',claimRefs:['role-'+itemId],limitations:[note.repeat(500)]},actualDemand:{value:null,claimClass:'missing',claimRefs:[],limitations:['缺当期调查。']}}]}},
      claims:[{claimId:'role-'+itemId,selector:'/outputs/published/records/0/role/value',value:'规划适用条件',claimClass:'inference',provenance:{quote:'原件完整连续段落。',inputRefs:[]},limitations:[note]}],
      limitations:[note,'/outputs/published/records/0/actualDemand: 缺当期调查。']}))}
  const original=structuredClone(sources),identity=sha256CanonicalJson(sources)
  for(const fields of [['originalValue','normalizedValue','classification','statisticalBasis'],['priceBasis','revisionStatus','denominator','formula'],['projectImpactHypothesis','policyVision']]){
    const scoped:any=api.moduleAuthorGroupSourceContext('3.01',fields,sources)
    expect(scoped.upstream.every((row:any)=>!Object.hasOwn(row,'outputs'))).toBe(true)
    for(let i=0;i<sources.upstream.length;i++){
      expect(scoped.upstream[i].claims).toEqual(original.upstream[i].claims)
      expect(scoped.upstream[i].limitations).toEqual(original.upstream[i].limitations)
      expect(scoped.upstream[i].outputInventory.published).toMatchObject({quality:original.upstream[i].outputs.published.quality,scope:'原始研究范围',asOf:'2026-09-26',limitations:[note],records:[{recordId:'original-'+sources.upstream[i].itemId,resultClass:'inference',fieldClasses:{role:'inference',actualDemand:'missing'}}]})
    }
    for(const key of ['corpus','sourceValues','inputRefs'])expect(scoped[key]).toEqual(original[key as keyof typeof original])
    expect(scoped.groupSourceScope).toMatchObject({fullSourceContextHash:identity,upstreamClaimsAvailable:true,upstreamOutputsInventoryOnly:true,omitted:['upstream.outputs']})
    expect(expandModuleReferencePromptView(moduleReferencePromptView(scoped))).toEqual(scoped)
    expect(JSON.stringify(scoped).length).toBeLessThan(JSON.stringify(sources).length/2)
  }
  expect(sources).toEqual(original);expect(sha256CanonicalJson(sources)).toBe(identity)
  expect(api.moduleAuthorGroupSourceContext('3.04',['peerId'],sources)).toBe(sources)
})

it('keeps the full market draft when exact claims or conditional restrictions cannot be retained', () => {
  for(const unavailable of [{itemId:'2.01',moduleId:'preplan.research.02.01',outputs:{raw:'No exact claim registry'},limitations:['未核。']},
    {itemId:'2.01',moduleId:'preplan.research.02.01',outputs:{raw:'No restriction registry'},claims:[]}]){
    const sources={upstream:[unavailable]}
    expect(api.moduleAuthorGroupSourceContext('3.01',['indicatorId','region','period','indicator'],sources)).toBe(sources)
  }
})

it.each(['2.02', '2.03'])('bounds regional author %s context with two conditional upstreams while preserving their complete claims, source bodies and restrictions', itemId => {
  const note='2022年规划目标及工作ID不证明现状存在、可达、合法授权或当前经营状态。'
  const sources={corpus:{documents:[{path:'原件.pdf',contentHash:'frozen-original',pages:[{page:46,text:'原件完整连续段落。'}]}]},
    sourceValues:[{sourceId:'source-original',path:'原件.pdf',page:46,quote:'原件完整连续段落。',rawValue:'原件完整连续段落。'}],inputRefs:[{moduleId:'preplan.research.02.01',resultHash:'regional-hash'},{moduleId:'preplan.research.01.06',resultHash:'resource-hash'}],
    upstream:['2.01','1.06'].map(itemId=>({itemId,moduleId:'preplan.research.'+itemId,
      outputs:{published:{type:'professional-upstream',quality:'limited',scope:'真实上游范围',asOf:'2026-09-28',limitations:[note],records:[{recordId:'upstream-'+itemId,resultClass:'inference',
        role:{value:'研究角色',claimClass:'inference',claimRefs:['role-'+itemId],limitations:[note.repeat(500)]},geometry:{value:null,claimClass:'missing',claimRefs:[],limitations:['无实测几何；不得由相机坐标补值。']}}]}},
      claims:[{claimId:'role-'+itemId,selector:'/outputs/published/records/0/role/value',value:'研究角色',claimClass:'inference',provenance:{quote:'原件完整连续段落。',inputRefs:[]},limitations:[note]}],
      limitations:[note,'/outputs/published/records/0/geometry: 无实测几何；不得由相机坐标补值。']}))}
  const before=structuredClone(sources),identity=sha256CanonicalJson(sources)
  for(const fields of [['nodeId','regionId','nodeType','geometry'],['importance','existingConnection','potentialConnection','state']]){
    const scoped:any=api.moduleAuthorGroupSourceContext(itemId,fields,sources)
    expect(scoped.upstream.every((row:any)=>!Object.hasOwn(row,'outputs'))).toBe(true)
    for(let i=0;i<sources.upstream.length;i++){
      expect(scoped.upstream[i].claims).toEqual(before.upstream[i].claims)
      expect(scoped.upstream[i].limitations).toEqual(before.upstream[i].limitations)
      expect(scoped.upstream[i].outputInventory.published).toMatchObject({quality:'limited',scope:'真实上游范围',asOf:'2026-09-28',limitations:[note],records:[{recordId:'upstream-'+sources.upstream[i].itemId,resultClass:'inference',fieldClasses:{role:'inference',geometry:'missing'}}]})
    }
    expect(scoped.groupSourceScope).toMatchObject({fullSourceContextHash:identity,upstreamClaimsAvailable:true,upstreamOutputsInventoryOnly:true,omitted:['upstream.outputs']})
    for(const key of ['corpus','sourceValues','inputRefs'])expect(scoped[key]).toEqual(before[key as keyof typeof before])
    expect(expandModuleReferencePromptView(moduleReferencePromptView(scoped))).toEqual(scoped)
    expect(JSON.stringify(scoped).length).toBeLessThan(JSON.stringify(sources).length/2)
  }
  expect(sources).toEqual(before);expect(sha256CanonicalJson(sources)).toBe(identity)
})

it.each(['2.02', '2.03'])('does not hide a regional %s upstream when one of its claim registries is unavailable', itemId => {
  const valid={itemId:'2.01',moduleId:'preplan.research.02.01',outputs:{regional:{type:'regional',quality:'limited',scope:'原范围',asOf:'2026-09-28',limitations:['未核。'],records:[]}},claims:[],limitations:['未核。']}
  const unavailable={itemId:'1.06',moduleId:'preplan.research.01.06',outputs:{raw:'No complete claim view'},limitations:['无完整claim注册表。']}
  const sources={upstream:[valid,unavailable]}
  expect(api.moduleAuthorGroupSourceContext(itemId,['nodeId','regionId'],sources)).toBe(sources)
})

it('scopes photo-metadata sources without changing frozen originals or the complete-source identity used to recover spatial receipts', () => {
  const sources={corpus:{documents:[{path:'original.jpg',text:'GPSLongitude=114.96884911111111'}]},sourceValues:[{sourceId:'original'}],inputRefs:[{moduleId:'preplan.research.01.04'}],
    upstream:[{itemId:'1.04',moduleId:'preplan.research.01.04',outputs:{private:'irrelevant '.repeat(10000)},claims:[{claimId:'private-upstream-claim'}],limitations:['private-business-limitation']}],images:{sources:[{path:'original.jpg'}]}}
  const before=structuredClone(sources),identity=sha256CanonicalJson(sources)
  const result=api.moduleAuthorGroupSourceContext('1.07',['photoLocation','photoDirection'],sources)
  expect(JSON.stringify(result).length).toBeLessThan(JSON.stringify(sources).length/10)
  expect(result.corpus).toEqual(sources.corpus);expect(result.sourceValues).toEqual(sources.sourceValues)
  expect(result.upstream).toEqual([{itemId:'1.04',moduleId:'preplan.research.01.04'}])
  expect(result.groupSourceScope).toMatchObject({fullSourceContextHash:identity,upstreamClaimsAvailable:false})
  expect(JSON.stringify(result)).not.toMatch(/private-upstream-claim|private-business-limitation/)
  expect(sources).toEqual(before);expect(sha256CanonicalJson(sources)).toBe(identity)
  expect(api.moduleAuthorGroupSourceContext('1.07',['photoDate'],sources).groupSourceScope).toBeDefined()
  expect(api.moduleAuthorGroupSourceContext('1.07',['conflicts'],sources)).toBe(sources)
  expect(api.moduleAuthorGroupSourceContext('1.07',['geometry'],sources)).toBe(sources)
  expect(api.moduleAuthorGroupSourceContext('1.06',['sensitiveObjects'],sources)).toBe(sources)
})

it('keeps every upstream claim, exact source and restriction for regional authors without repeating the full upstream business drafts', () => {
  const note='历史条件不证明当前适用状态、项目几何包含或道路连通。'
  const geometry={type:'Polygon',coordinates:[[[114.9,30.8],[115,30.8],[115,30.9],[114.9,30.8]]],crs:'EPSG:4326',axisOrder:'xy'}
  const sources={corpus:{documents:[{path:'原件.pdf',text:'完整冻结原文\n原件日期2022年6月'}]},sourceValues:[{sourceId:'original',quote:'完整冻结原文'}],inputRefs:[{moduleId:'preplan.research.01.02'}],
    upstream:[{itemId:'1.02',moduleId:'preplan.research.01.02',outputs:{site_boundary:{type:'site-boundary',quality:'limited',scope:'概念研究范围',asOf:'2026-09-26',limitations:[note],
      records:[{recordId:'research-boundary',resultClass:'inference',geometry:{value:geometry,claimClass:'assumption',claimRefs:['claim-geometry'],limitations:[note]},
        area:{value:null,claimClass:'missing',claimRefs:[],limitations:['未测绘面积。']}}]}},
      claims:[{claimId:'claim-geometry',selector:'/outputs/site_boundary/records/0/geometry/value',value:geometry,claimClass:'assumption',
        provenance:{quote:'完整冻结原文',inputRefs:[{moduleId:'preplan.research.01.01',claimId:'claim-original'}]},limitations:[note]}],limitations:[note,'/outputs/site_boundary/records/0/area: 未测绘面积。']} ]}
  const before=structuredClone(sources),identity=sha256CanonicalJson(sources)
  for(const fields of [['scale','projectPosition','entranceIds','boundaryGeometry'],['functionalClusters','transportAndWaterways','formationState','planningStatus'],
    ['mapScale','crs','regionalRole','projectRelationship'],['followupTasks']]) {
    const scoped:any=api.moduleAuthorGroupSourceContext('2.01',fields,sources)
    expect(scoped.upstream[0]).not.toHaveProperty('outputs')
    expect(scoped.upstream[0].claims).toEqual(before.upstream[0].claims)
    expect(scoped.upstream[0].limitations).toEqual(before.upstream[0].limitations)
    expect(scoped.upstream[0].outputInventory).toEqual({site_boundary:{type:'site-boundary',quality:'limited',scope:'概念研究范围',asOf:'2026-09-26',limitations:[note],
      records:[{recordId:'research-boundary',resultClass:'inference',fieldClasses:{geometry:'assumption',area:'missing'}}]}})
    expect(scoped.groupSourceScope).toMatchObject({fullSourceContextHash:identity,upstreamClaimsAvailable:true,upstreamOutputsInventoryOnly:true,omitted:['upstream.outputs']})
    expect(scoped.corpus).toEqual(before.corpus);expect(scoped.sourceValues).toEqual(before.sourceValues);expect(scoped.inputRefs).toEqual(before.inputRefs)
    expect(expandModuleReferencePromptView(moduleReferencePromptView(scoped))).toEqual(scoped)
  }
  expect(sources).toEqual(before);expect(sha256CanonicalJson(sources)).toBe(identity)
  expect(api.moduleAuthorGroupSourceContext('1.06',['sensitiveObjects'],sources)).toBe(sources)
})

it('retains the full regional upstream when published claims or the business inventory are unavailable', () => {
  const sources={upstream:[{itemId:'1.02',moduleId:'preplan.research.01.02',outputs:{raw:'Cannot hide a draft whose claim view is unavailable.'},limitations:['未核验。']}]}
  expect(api.moduleAuthorGroupSourceContext('2.01',['regionalRole'],sources)).toBe(sources)
})

it('bounds spatial site-use input while preserving every claim, original source, missing field and business restriction', () => {
  const limitation='历史背景和相机位置均不证明当前地物geometry、使用状态或面积。'
  const sources={corpus:{documents:[{path:'original.jpg',text:'exact original EXIF tags'}]},sourceValues:[{sourceId:'original'}],inputRefs:[{moduleId:'preplan.research.01.02'}],
    upstream:[{itemId:'1.02',moduleId:'preplan.research.01.02',outputs:{site_boundary:{type:'site-boundary',quality:'limited',scope:'概念范围',asOf:'2026-09-26',limitations:[limitation],
      records:[{recordId:'boundary',resultClass:'inference',geometry:{value:{type:'Polygon',coordinates:[]},claimClass:'assumption',claimRefs:['original-geometry'],limitations:[limitation.repeat(1000)]},
        area:{value:null,claimClass:'missing',claimRefs:[],limitations:['无实测面积。']}}]}},
      claims:[{claimId:'original-geometry',selector:'/outputs/site_boundary/records/0/geometry/value',value:{type:'Polygon',coordinates:[]},claimClass:'assumption',provenance:{quote:'exact source',inputRefs:[]},limitations:[limitation]}],
      limitations:[limitation,'/outputs/site_boundary/records/0/area: 无实测面积。']}],images:{sources:[{path:'original.jpg',contentHash:'original-hash'}]}}
  const before=structuredClone(sources),identity=sha256CanonicalJson(sources)
  for(const fields of [['spaceId','geometry','area'],['currentFunction','vacancyStatus'],['conflicts']]){
    const scoped:any=api.moduleAuthorGroupSourceContext('1.07',fields,sources)
    expect(scoped.upstream[0]).not.toHaveProperty('outputs')
    expect(scoped.upstream[0].claims).toEqual(before.upstream[0].claims)
    expect(scoped.upstream[0].limitations).toEqual(before.upstream[0].limitations)
    expect(scoped.upstream[0].outputInventory.site_boundary.records[0].fieldClasses).toEqual({geometry:'assumption',area:'missing'})
    expect(scoped.groupSourceScope).toMatchObject({fullSourceContextHash:identity,upstreamClaimsAvailable:true,upstreamOutputsInventoryOnly:true,omitted:['upstream.outputs']})
    for(const key of ['corpus','sourceValues','inputRefs','images'])expect(scoped[key]).toEqual(before[key as keyof typeof before])
    expect(expandModuleReferencePromptView(moduleReferencePromptView(scoped))).toEqual(scoped)
    expect(JSON.stringify(scoped).length).toBeLessThan(JSON.stringify(sources).length/2)
  }
  expect(sources).toEqual(before);expect(sha256CanonicalJson(sources)).toBe(identity)
  expect(api.moduleAuthorGroupSourceContext('1.07',['photoLocation','photoDirection'],sources).groupSourceScope).toMatchObject({upstreamClaimsAvailable:false})
})
