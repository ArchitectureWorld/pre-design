import {expect,it} from 'vitest'
import {moduleRecoveryFeedback} from '../src/research-v2/module-recovery-feedback.ts'
import {materialCorpusFingerprint} from '../src/materials/research-evidence.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'

const quote='少谭河水库是生态旅游区的重要组成部分。'
function fixture(){
  const doc={path:'原始资料/水文化.pdf',contentHash:hash('original PDF bytes'),byteLength:1000,pages:[{page:21,text:'狮子岩留有古寨遗迹。'},{page:27,text:quote}]}
  const corpus={documents:[doc],limitations:[],fingerprint:''};corpus.fingerprint=materialCorpusFingerprint(corpus)
  const records=[{recordId:'water',resultClass:'observation_summary',historicalSource:{value:quote,claimClass:'source_conclusion',limitations:[]}},
    {recordId:'rock',resultClass:'observation_summary',historicalSource:{value:'虚构史料',claimClass:'source_conclusion',limitations:[]}}]
  const target=(recordId:string)=>({port:'local_resources',recordId,field:'historicalSource',at:''})
  const raw={projectionVersion:'module-author-field-group-json.v3',groupId:'local_resources:1.1',outputs:{local_resources:{type:'planning.local_resources.v1.2',quality:'limited',scope:'source fixture',asOf:'2026-09-26',records,limitations:[]}},
    evidence:[{kind:'source',target:target('water'),source:{path:doc.path,page:27,quote}},{kind:'source',target:target('rock'),source:{path:doc.path,page:21,quote:'狮子岩留有古寨遗迹。'}}],limitations:[]}
  return {corpus,raw,target}
}
function feedback(f:ReturnType<typeof fixture>){
  const attempt={classId:'text',groupId:f.raw.groupId,status:'failed',error:'MODULE_SOURCE_VALUE_TEXT: rock',executionId:'research-2',childId:'child-2',structuredOutput:f.raw,structuredHash:hash(f.raw)}
  const prompt=moduleRecoveryFeedback({module:{id:'1.06'} as never,corpus:f.corpus,resumeExecutionAudit:{attempts:[attempt],reviewReceipts:[]}},f.raw.groupId)
  const value=JSON.parse(prompt.split('\n').find(line=>line.startsWith('{"previousRejection":'))!).previousRejection
  return {prompt,value}
}
it('reminds the next native correction of the exact source binding already fixed in its latest rejected draft',()=>{
  const f=fixture(),before=hash({raw:f.raw,corpus:f.corpus}),{prompt,value}=feedback(f)
  expect(value.sourceBindingProgress).toMatchObject({version:'source-binding-progress.v1',scope:'literal-source-bindings-only',originalSubmissionHash:hash(f.raw),
    verifiedBindingCount:1,truncated:false,bindings:[{target:f.target('water'),path:f.corpus.documents[0].path,page:27,quoteHash:hash(quote),valueHash:hash(quote)}]})
  expect(value.rejectedSubmission.accepted).toBe(false)
  expect(prompt).toContain('保持已经核验的path/page/quote与字段值绑定')
  expect(hash({raw:f.raw,corpus:f.corpus})).toBe(before)
})
it('does not preserve a once-correct binding after its frozen source text changes',()=>{
  const f=fixture();f.corpus.documents[0].pages[1].text='新材料没有该原文';f.corpus.fingerprint=materialCorpusFingerprint(f.corpus)
  expect(feedback(f).value.sourceBindingProgress).toBeUndefined()
})
it('does not call a duplicate owner or a misclassified proposal a verified source binding',()=>{
  const duplicate=fixture();duplicate.raw.evidence.push(structuredClone(duplicate.raw.evidence[0]))
  expect(feedback(duplicate).value.sourceBindingProgress).toBeUndefined()
  const proposal=fixture();proposal.raw.outputs.local_resources.records[0].historicalSource.claimClass='proposal'
  expect(feedback(proposal).value.sourceBindingProgress).toBeUndefined()
})
it('bounds the reminder without treating unlisted bindings as accepted module research',()=>{
  const f=fixture(),record=f.raw.outputs.local_resources.records[0],evidence=f.raw.evidence[0]
  f.raw.outputs.local_resources.records=Array.from({length:10},(_,i)=>({...structuredClone(record),recordId:'water-'+i}))
  f.raw.evidence=Array.from({length:10},(_,i)=>({...structuredClone(evidence),target:f.target('water-'+i)}))
  const value=feedback(f).value
  expect(value.sourceBindingProgress).toMatchObject({verifiedBindingCount:10,truncated:true})
  expect(value.sourceBindingProgress.bindings).toHaveLength(8)
  expect(value.rejectedSubmission.accepted).toBe(false)
})
