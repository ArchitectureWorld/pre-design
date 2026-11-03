import {expect,it} from 'vitest'
import {createHash} from 'node:crypto'
import {verifyModuleSourceValues} from '../src/research-v2/module-claims.ts'
import {validateModuleProjectionFields} from '../src/research-v2/module-author-projection.ts'
import {materialCorpusFingerprint} from '../src/materials/research-evidence.ts'
import * as groups from '../src/research-v2/module-author-groups.ts'
const latitude=30.844134999999998,longitude=114.96884911111111
const text=JSON.stringify({kind:'source-image-metadata.v1',capture:{latitude,longitude,coordinateDatum:'WGS-84'}})
const document={path:'original/photo.jpg',text,contentHash:createHash('sha256').update(text).digest('hex'),byteLength:100,image:{mimeType:'image/jpeg' as const,width:10,height:10}}
const base={documents:[document],limitations:[]},corpus={...base,fingerprint:materialCorpusFingerprint(base)}
const quote=`"latitude":${latitude},"longitude":${longitude}`
function mapping(axisOrder:'xy'|'yx'='xy'){return {kind:'photo-gps-axis-order.v1' as const,axisOrder,xValueQuote:String(axisOrder==='xy'?longitude:latitude),yValueQuote:String(axisOrder==='xy'?latitude:longitude)}}
function source(){return {sourceId:'s1',path:document.path,contentHash:document.contentHash,quote,rawValue:'xy',coordinateMapping:mapping()}}
it('requires an explicit original-image axis mapping and verifies original labels, order, component precision and immutable source identity',()=>{
  const s=source(),before=structuredClone(s)
  expect(verifyModuleSourceValues(corpus,[s])).toEqual([s])
  const yx={...s,rawValue:'yx',coordinateMapping:mapping('yx')}
  expect(verifyModuleSourceValues(corpus,[yx])).toEqual([yx])
  for(const altered of [
    {...s,rawValue:'yx'}, {...s,coordinateMapping:{...mapping(),xValueQuote:'114.96884911'}},
    {...s,coordinateMapping:{...mapping(),xValueQuote:' 114.96884911111111'}},
    {...s,quote:`"longitude":${longitude}`}, {...s,contentHash:'0'.repeat(64)},
  ]) expect(()=>verifyModuleSourceValues(corpus,[altered])).toThrow()
  const {coordinateMapping:_,...literal}=s
  expect(()=>verifyModuleSourceValues(corpus,[literal])).toThrow(/MODULE_SOURCE_VALUE_TEXT/)
  expect(s).toEqual(before)
  const {image:_image,...notImage}=document
  const fakeBase={documents:[notImage],limitations:[]}
  expect(()=>verifyModuleSourceValues({...fakeBase,fingerprint:materialCorpusFingerprint(fakeBase)},[s])).toThrow(/MODULE_SOURCE_COORDINATE_MAPPING/)
})
it('rejects normalization on other evidence targets and wrong candidate axes, while strict source coverage and classes remain mandatory',()=>{
  const loc={value:{x:longitude,y:latitude,crs:'WGS-84',axisOrder:'xy'},claimClass:'source_conclusion',limitations:['Camera position only']}
  const outputs={site_use:{type:'planning.site_use.v1.2',quality:'limited',scope:'synthetic mapping test',asOf:'2026-09-30',limitations:['Only photo GPS'],records:[{recordId:'r0',resultClass:'observation_summary',photoLocation:loc}]}}
  const evidence=['x','y','crs','axisOrder'].map(key=>({kind:'source' as const,target:{port:'site_use',recordId:'r0',field:'photoLocation',at:'/'+key},
    source:{path:document.path,quote:key==='crs'?'"coordinateDatum":"WGS-84"':quote,
      ...(['x','y'].includes(key)?{valueQuote:String(key==='x'?longitude:latitude)}:{}),...(key==='axisOrder'?{coordinateMapping:mapping()}: {})}}))
  const p={outputs,evidence},before=structuredClone(p)
  expect(()=>validateModuleProjectionFields('1.07',p,{site_use:['photoLocation']},corpus)).not.toThrow()
  const moved=structuredClone(p);moved.evidence[0].source={...moved.evidence[0].source,coordinateMapping:mapping()} as any
  expect(()=>validateModuleProjectionFields('1.07',moved,{site_use:['photoLocation']},corpus)).toThrow(/MODULE_SOURCE_COORDINATE_MAPPING/)
  const swapped=structuredClone(p);swapped.outputs.site_use.records[0].photoLocation.value={x:latitude,y:longitude,crs:'WGS-84',axisOrder:'xy'}
  expect(()=>validateModuleProjectionFields('1.07',swapped,{site_use:['photoLocation']},corpus)).toThrow()
  const wrongDatum=structuredClone(p);wrongDatum.outputs.site_use.records[0].photoLocation.value.crs='EPSG:3857'
  expect(()=>validateModuleProjectionFields('1.07',wrongDatum,{site_use:['photoLocation']},corpus)).toThrow(/MODULE_SOURCE_COORDINATE_MAPPING/)
  expect(p).toEqual(before)
})
it('binds explicit mapped source values into complete native audit replay without rewriting author payloads or accepting wrong order',()=>{
  const raws=groups.getModuleAuthorFieldGroups('1.07').map(g=>({projectionVersion:groups.MODULE_AUTHOR_GROUP_VERSION,groupId:g.groupId,
    outputs:{site_use:{type:'planning.site_use.v1.2',quality:'limited',scope:'synthetic full mapping replay',asOf:'2026-09-30',limitations:['Only GPS tags'],
      records:[{recordId:'r0',resultClass:'observation_summary',...Object.fromEntries(g.fields.map(f=>[f,{value:null,claimClass:'missing',limitations:['No original support']}]))}]}},
    evidence:[] as any[],limitations:['No other observations'],stepResults:Object.fromEntries([1,2,3,4].map(n=>['step'+n,{status:'limited',summary:'Original GPS mapping only',fieldRefs:[],limitations:['No other source']}]))})) as any[]
  const photo=raws.find(raw=>raw.groupId==='site_use:4.1')
  photo.outputs.site_use.records[0].photoLocation={value:{x:String(longitude),y:String(latitude),crs:'WGS-84',axisOrder:'xy'},claimClass:'source_conclusion',limitations:['Mapped original camera GPS; not surveyed land position']}
  photo.evidence=['x','y','crs','axisOrder'].map(key=>({kind:'source',target:{port:'site_use',recordId:'r0',field:'photoLocation',at:'/'+key},
    source:{path:document.path,quote:key==='crs'?'"coordinateDatum":"WGS-84"':quote,
      ...(['x','y'].includes(key)?{valueQuote:String(key==='x'?longitude:latitude)}:{}),...(key==='axisOrder'?{coordinateMapping:mapping()}: {})}}))
  const before=structuredClone(raws),candidate=groups.compileModuleAuthorGroups('1.07',raws,corpus)
  const audit=groups.createModuleAuthorGroupsAudit('1.07',raws.map((raw,i)=>({raw,receipt:{executionId:'e'+i,childId:'c'+i,actualModel:{provider:'test',model:'test'},stopReason:'completed'}})),candidate)
  expect(groups.replayModuleAuthorGroups('1.07',corpus,audit)).toEqual(candidate)
  expect(candidate.sourceValues.find(s=>s.rawValue==='xy')?.coordinateMapping).toEqual(mapping())
  expect(raws).toEqual(before)
})
