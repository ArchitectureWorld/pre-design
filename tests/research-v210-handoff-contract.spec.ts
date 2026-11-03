import {describe,expect,it} from 'vitest'
import Ajv from 'ajv'
import {assertObjectJsonSchema} from '@deepseek-ai/dsh-tools'
import {getModuleAuthorGroupSchema,getModuleAuthorGroupVersion,getModuleAuthorExecutionGroupVersion,getModuleAuthorExecutionFieldGroups} from '../src/research-v2/module-author-groups.ts'
import {bindNativeModuleEvidenceSchema} from '../src/research-v2/module-author-projection.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'
const LEGACY_GROUP_VERSION='module-author-field-group-json.v3' as const

const upstream:any=[{moduleId:'preplan.research.01.03',claims:[
 {claimId:'historical-rule',kind:'source',value:'Synthetic historical protection rule'},
 {claimId:'missing-approval',kind:'missing',value:null},
]}]
function native(itemId:string,groupId:string,inputs=upstream,previous:any[]=[]){
 const schema=getModuleAuthorGroupSchema(itemId,groupId,previous,getModuleAuthorExecutionGroupVersion(itemId,previous),undefined,undefined,inputs)
 const bound=bindNativeModuleEvidenceSchema(schema)
 return {schema,bound,validate:new Ajv({strict:false}).compile(bound.properties!.evidence.items!)}
}
const photoTarget={port:'site_use',recordId:'synthetic-photo-A',field:'photoLocation',at:''}
const source=(at:string)=>({target:{...photoTarget,at},kind:'source',source:{path:'synthetic-original-exif.json',quote:'Synthetic quoted EXIF values',valueQuote:'123'}})

describe('native handoff contracts derive identities and source leaves from the professional schema',()=>{
 it('rejects the observed whole-coordinate citation before a native source tool accepts it',()=>{
  const {validate}=native('1.07','site_use:4.1')
  expect(validate(source(''))).toBe(false)
  expect(validate(source('/longitude'))).toBe(false)
  for(const at of ['/x','/y','/crs','/axisOrder'])expect(validate(source(at))).toBe(true)
 })
 it('uses the same frozen external claim identities across modules instead of accepting port names',()=>{
  const {validate}=native('1.07','site_use:4.1')
  const inference=(moduleId:string,claimId:string)=>({target:photoTarget,kind:'inference',rationale:'Synthetic protocol test',inputRefs:[{upstream:{moduleId,claimId}}]})
  expect(validate(inference('policy','historical-rule'))).toBe(false)
  expect(validate(inference('preplan.research.01.03','invented-claim'))).toBe(false)
  expect(validate(inference('preplan.research.01.03','missing-approval'))).toBe(false)
  expect(validate(inference('preplan.research.01.03','historical-rule'))).toBe(true)
 })
 it('retains an actual same-group source field as a local inference basis',()=>{
  const {validate}=native('1.06','local_resources:1.1')
  const inference={target:{port:'local_resources',recordId:'synthetic-resource-A',field:'category',at:''},kind:'inference',
   rationale:'Synthetic same-group classification',inputRefs:[{local:{port:'local_resources',recordId:'synthetic-resource-A',field:'historicalSource',at:''}}]}
  expect(validate(inference)).toBe(true)
  expect(validate({...inference,inputRefs:[{local:{...inference.inputRefs[0].local,port:'environment'}}]})).toBe(false)
 })
 it('preserves a same-field reference to an earlier record slice without overlapping current local branches',()=>{
  const itemId='3.04',first=getModuleAuthorExecutionFieldGroups(itemId)[0]
  const rows=Array.from({length:4},(_,i)=>({recordId:'synthetic-peer-'+i,resultClass:'observation_summary'}))
  const raw=(group:any,version:any):any=>({projectionVersion:version,groupId:group.groupId,
   outputs:{peer_supply:{type:'planning.peer_supply.v1.2',quality:'limited',scope:'Synthetic frozen peers',asOf:'2026-09-26',limitations:[],
    records:rows.filter(row=>!group.recordIds||group.recordIds.includes(row.recordId)).map(row=>({...row,
     ...Object.fromEntries(group.fields.map((field:string)=>[field,{value:null,claimClass:'missing',limitations:['No evidence']}]))}))}},
   evidence:[],limitations:[],stepResults:Object.fromEntries([1,2,3,4].map(n=>['step'+n,{status:'limited',summary:'Synthetic partial study',fieldRefs:[],limitations:['No survey']}]))})
  const previous:any[]=[raw(first,getModuleAuthorGroupVersion(itemId))]
  const plan=getModuleAuthorExecutionFieldGroups(itemId,previous),version=getModuleAuthorExecutionGroupVersion(itemId,previous)
  const prior=raw(plan[1],version),address={port:'peer_supply',recordId:rows[0].recordId,field:'address',at:''}
  prior.outputs.peer_supply.records[0].address={value:'Synthetic literal address',claimClass:'source_conclusion',limitations:[]}
  prior.evidence=[{target:address,kind:'source',source:{path:'synthetic-peer.txt',quote:'Synthetic literal address'}}]
  previous.push(prior)
  const before=hash(previous),{validate}=native(itemId,plan[2].groupId,[],previous)
  const inference=(local:any)=>({target:{...address,recordId:rows[2].recordId},kind:'inference',rationale:'Synthetic cross-record comparison',inputRefs:[{local}]})
  expect(validate(inference(address))).toBe(true)
  expect(validate(inference({...address,recordId:rows[3].recordId}))).toBe(true)
  expect(validate(inference({...address,recordId:rows[1].recordId}))).toBe(false)
  expect(validate(inference({...address,recordId:'invented-peer'}))).toBe(false)
  expect(validate(inference({...address,at:'/invented'}))).toBe(false)
  expect(hash(previous)).toBe(before)
 })
 it('keeps whole-field proposals and inferences distinct from scalar source evidence',()=>{
  const {validate}=native('1.07','site_use:4.1')
  expect(validate({target:photoTarget,kind:'proposal',rationale:'Synthetic coordinate scenario, not a sourced survey'})).toBe(true)
  expect(validate({target:photoTarget,kind:'inference',rationale:'Synthetic inference requires professional checking',inputRefs:[{upstream:{moduleId:'preplan.research.01.03',claimId:'historical-rule'}}]})).toBe(true)
 })
 it('preserves the original contract and frozen inputs while emitting supported native constraints',()=>{
  const before=hash(upstream),{schema,bound}=native('1.07','site_use:4.1')
  expect(()=>assertObjectJsonSchema(bound)).not.toThrow()
  expect(hash(upstream)).toBe(before)
  const original=hash(schema);bindNativeModuleEvidenceSchema(schema);expect(hash(schema)).toBe(original)
 })
 it('preserves legacy request schemas without inventing historical frozen claims',()=>{
  const original=getModuleAuthorGroupSchema('1.05','environment:1',[],LEGACY_GROUP_VERSION)
  expect(original.properties!.projectionVersion.const).toBe(LEGACY_GROUP_VERSION)
  const withNewInputs=getModuleAuthorGroupSchema('1.05','environment:1',[],LEGACY_GROUP_VERSION,undefined,undefined,upstream)
  expect(withNewInputs).toEqual(original)
 })
 it('rejects mismatched upstream identity pairs while preserving each real pair',()=>{
  const inputs:any=[...upstream,{moduleId:'preplan.research.01.02',claims:[{claimId:'boundary-choice',kind:'proposal',value:'Synthetic boundary choice'}]}]
  const {validate}=native('1.07','site_use:4.1',inputs)
  const ref=(moduleId:string,claimId:string)=>({target:photoTarget,kind:'inference',rationale:'Synthetic identity pairing',inputRefs:[{upstream:{moduleId,claimId}}]})
  expect(validate(ref('preplan.research.01.03','boundary-choice'))).toBe(false)
  expect(validate(ref('preplan.research.01.02','historical-rule'))).toBe(false)
  expect(validate(ref('preplan.research.01.02','boundary-choice'))).toBe(true)
 })
 it('keeps hundreds of frozen identities within a bounded native tool payload without accepting cross-module pairs',()=>{
  const inputs:any=Array.from({length:6},(_,module)=>({moduleId:'preplan.research.0'+(module+1)+'.01',
   claims:Array.from({length:100},(_,claim)=>({claimId:'frozen-claim-'+module+'-'+claim,kind:'proposal',value:'Synthetic available basis'}))}))
  const {bound,validate}=native('1.07','site_use:4.1',inputs)
  expect(Buffer.byteLength(JSON.stringify(bound),'utf8')).toBeLessThan(150000)
  const evidence=(moduleId:string,claimId:string)=>({target:photoTarget,kind:'inference',rationale:'Synthetic large identity set',inputRefs:[{upstream:{moduleId,claimId}}]})
  expect(validate(evidence(inputs[0].moduleId,inputs[0].claims[0].claimId))).toBe(true)
  expect(validate(evidence(inputs[0].moduleId,inputs[1].claims[0].claimId))).toBe(false)
 })
 it('constrains operands and weights without excluding inline numeric sources or source IDs',()=>{
  const {validate}=native('1.07','site_use:4.1')
  const calculate=(ref:any)=>({target:{...photoTarget,at:'/x'},kind:'calculation',calculation:{operation:'weighted_mean',operands:[ref],weights:[ref]}})
  expect(validate(calculate({upstream:{moduleId:'policy',claimId:'invented'}}))).toBe(false)
  expect(validate(calculate({upstream:{moduleId:'preplan.research.01.03',claimId:'historical-rule'}}))).toBe(true)
  expect(validate(calculate({local:{...photoTarget,at:'/y'}}))).toBe(true)
  expect(validate(calculate({source:{path:'synthetic-numeric.txt',quote:'10',valueQuote:'10'},value:10}))).toBe(true)
  expect(validate(calculate({sourceId:'synthetic-registered-source'}))).toBe(true)
 })
 it('leaves dynamic array leaves to central checking and correlates fixed field leaf shapes',()=>{
  const {validate}=native('1.06','local_resources:1.1')
  const record={port:'local_resources',recordId:'synthetic-resource-A'}
  expect(validate({target:{...record,field:'resourceId',at:'/x'},kind:'source',source:{path:'synthetic.txt',quote:'A'}})).toBe(false)
  // category is scalar; objects cannot borrow photo-coordinate leaves.
  expect(validate({target:{...record,field:'category',at:''},kind:'source',source:{path:'synthetic.txt',quote:'Synthetic category'}})).toBe(true)
  const environmental=native('1.05','environment:4.2')
  expect(environmental.validate({target:{port:'environment',recordId:'synthetic-env-A',field:'verificationTasks',at:'/97'},kind:'source',source:{path:'synthetic.txt',quote:'Synthetic task'}})).toBe(true)
 })
 it('retains exact photo decimal strings in the native wire rather than replacing them with business numbers',()=>{
  const {schema}=native('1.07','site_use:4.1')
  const field=schema.properties!.outputs.properties!.site_use.properties!.records.items!.properties!.photoLocation
  const check=new Ajv({strict:false}).compile(field)
  const coordinates={value:{x:'123.1234567890123456789',y:'30.9876543210987654321',crs:'EPSG:4326',axisOrder:'xy'},claimClass:'source_conclusion',limitations:[]}
  expect(check(coordinates)).toBe(true)
  expect(check({...coordinates,value:{...coordinates.value,x:123.123456789}})).toBe(false)
 })
 it('does not fall back to arbitrary external identities when no upstream basis is available',()=>{
  const {schema,validate}=native('1.06','local_resources:1.1',[])
  const ref={target:{port:'local_resources',recordId:'synthetic-A',field:'category',at:''},kind:'inference',rationale:'Synthetic missing basis',inputRefs:[{upstream:{moduleId:'invented',claimId:'invented'}}]}
  expect(validate(ref)).toBe(false)
  const field=schema.properties!.outputs.properties!.local_resources.properties!.records.items!.properties!.historicalSource
  expect(new Ajv({strict:false}).compile(field)({value:null,claimClass:'missing',limitations:['No historical original']})).toBe(true)
 })
 it('accepts only actual nonmissing prior evidence leaves without selecting a new basis',()=>{
  const plan=getModuleAuthorExecutionFieldGroups('1.05'),version=getModuleAuthorGroupVersion('1.05')
  const previous:any[]=plan.slice(0,-1).map(group=>({projectionVersion:version,groupId:group.groupId,outputs:{environment:{type:'planning.environment.v1.2',quality:'limited',scope:'Synthetic environmental context',asOf:'2026-09-26',limitations:[],records:[{recordId:'synthetic-env-A',resultClass:'observation_summary',...Object.fromEntries(group.fields.map(field=>[field,{value:null,claimClass:'missing',limitations:['No evidence']}]))}]}},evidence:[],limitations:[],stepResults:Object.fromEntries([1,2,3,4].map(n=>['step'+n,{status:'limited',summary:'Not surveyed',fieldRefs:[],limitations:['No survey']}]))}))
  const address={port:'environment',recordId:'synthetic-env-A',field:'layerType',at:''}
  previous[0].outputs.environment.records[0].layerType={value:'Synthetic visual method',claimClass:'source_conclusion',limitations:[]}
  previous[0].evidence=[{target:address,kind:'source',source:{path:'synthetic.txt',quote:'Synthetic visual method'}}]
  const before=hash(previous),{validate}=native('1.05','environment:4.2',upstream,previous)
  const ref=(local:any)=>({target:{...address,field:'verificationTasks',at:'/0'},kind:'inference',rationale:'Synthetic follow-up',inputRefs:[{local}]})
  expect(validate(ref(address))).toBe(true)
  expect(validate(ref({...address,at:'/invented'}))).toBe(false)
  expect(validate(ref({...address,field:'measuredValue',at:'/value'}))).toBe(false)
  expect(hash(previous)).toBe(before)
 })
})
