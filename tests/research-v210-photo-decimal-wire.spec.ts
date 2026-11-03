import {expect,it} from 'vitest'
import {createHash} from 'node:crypto'
import * as api from '../src/research-v2/module-author-groups.ts'
import {materialCorpusFingerprint} from '../src/materials/research-evidence.ts'
import {moduleGroupNumberDiagnostics} from '../src/research-v2/module-group-number-diagnostics.ts'
const latest='module-author-field-group.v7' as const
function fixture(){
  const text='GPSLongitude=114.96884911111111 GPSLatitude=30.844134999999998 crs=EPSG:4326 axisOrder=xy'
  const document={path:'original/photo.jpg',contentHash:createHash('sha256').update(text).digest('hex'),byteLength:Buffer.byteLength(text),text}
  const base={documents:[document],limitations:[]},corpus={...base,fingerprint:materialCorpusFingerprint(base)}
  const raws=api.getModuleAuthorFieldGroups('1.07',latest).map((g,index)=>({projectionVersion:index<3?'module-author-field-group.v6':latest,groupId:g.groupId,
    outputs:{site_use:{type:'planning.site_use.v1.2',quality:'limited',scope:'Photo metadata test',asOf:'2026-09-30',limitations:['No other observations'],
      records:[{recordId:'r1',resultClass:'observation_summary',...Object.fromEntries(g.fields.map(f=>[f,{value:null,claimClass:'missing',limitations:['No source']}]))}]}},
    evidence:[] as any[],limitations:['No other observations'],stepResults:Object.fromEntries([1,2,3,4].map(n=>['step'+n,{status:'limited',summary:'Read original metadata',fieldRefs:[],limitations:['Incomplete other fields']}]))})) as any[]
  const photo=raws[3].outputs.site_use.records[0]
  photo.photoLocation={value:{x:'114.96884911111111',y:'30.844134999999998',crs:'EPSG:4326',axisOrder:'xy'},claimClass:'source_conclusion',limitations:['Camera position only']}
  raws[3].evidence=['x','y','crs','axisOrder'].map(key=>({kind:'source',target:{port:'site_use',recordId:'r1',field:'photoLocation',at:'/'+key},
    source:{path:document.path,quote:text,...(['x','y'].includes(key)?{valueQuote:photo.photoLocation.value[key]}:{})}}))
  return {raws,corpus}
}
it('preserves authored decimal text and exact old native receipts while compiling strict numeric coordinates and replaying the mixed audit',()=>{
  expect(api.MODULE_AUTHOR_GROUP_VERSION).toBe('module-author-field-group.v8')
  const f=fixture(),before=structuredClone(f.raws)
  for(let i=0;i<f.raws.length;i++)expect(api.validateModuleAuthorGroup('1.07',f.raws[i],f.raws.slice(0,i),f.corpus)).toEqual(f.raws[i])
  const candidate=api.compileModuleAuthorGroups('1.07',f.raws,f.corpus)
  expect((candidate.outputs as any).site_use.records[0].photoLocation.value).toEqual({x:Number('114.96884911111111'),y:Number('30.844134999999998'),crs:'EPSG:4326',axisOrder:'xy'})
  const audit=api.createModuleAuthorGroupsAudit('1.07',f.raws.map((raw,i)=>({raw,receipt:{executionId:'e'+i,childId:'c'+i,actualModel:{provider:'test',model:'test'},stopReason:'completed'}})),candidate)
  expect(audit.version).toBe(latest)
  expect(audit.groups.slice(0,3).every(g=>g.raw.projectionVersion==='module-author-field-group.v6')).toBe(true)
  expect(api.replayModuleAuthorGroups('1.07',f.corpus,audit)).toEqual(candidate)
  expect(f.raws).toEqual(before)
  expect(moduleGroupNumberDiagnostics(f.raws[3])).toEqual([])
})
it('rejects numeric wire coercion, altered decimal spellings and stale native versions after the compatible prefix',()=>{
  expect(api.MODULE_AUTHOR_GROUP_VERSION).toBe('module-author-field-group.v8')
  const f=fixture(),original=structuredClone(f.raws)
  for(const value of [114.96884911111111,'NaN',' 114.96884911111111','1e999']){
    const raw=structuredClone(f.raws[3]);raw.outputs.site_use.records[0].photoLocation.value.x=value
    expect(()=>api.validateModuleAuthorGroup('1.07',raw,f.raws.slice(0,3),f.corpus)).toThrow()
  }
  const rounded=structuredClone(f.raws[3]);rounded.outputs.site_use.records[0].photoLocation.value.x='114.96884911'
  expect(()=>api.validateModuleAuthorGroup('1.07',rounded,f.raws.slice(0,3),f.corpus)).toThrow(/MODULE_SOURCE_VALUE_NUMBER/)
  const extraZero=structuredClone(f.raws[3]);extraZero.outputs.site_use.records[0].photoLocation.value.x+='0'
  expect(()=>api.validateModuleAuthorGroup('1.07',extraZero,f.raws.slice(0,3),f.corpus)).toThrow(/MODULE_SOURCE_VALUE_NUMBER/)
  expect(moduleGroupNumberDiagnostics(extraZero)).toHaveLength(1)
  const mixed=structuredClone(f.raws);mixed[4].projectionVersion='module-author-field-group.v6'
  expect(()=>api.compileModuleAuthorGroups('1.07',mixed,f.corpus)).toThrow(/MODULE_GROUP_VERSION_MIXED/)
  expect(f.raws).toEqual(original)
})
