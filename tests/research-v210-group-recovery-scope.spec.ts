import {expect,it} from 'vitest'
import {createHash} from 'node:crypto'
import {moduleAuthorGroupRecoveryFeedback} from '../src/research-v2/native-module-runtime.ts'
import {sha256CanonicalJson} from '../src/presentation/canonical-json.ts'
import {materialCorpusFingerprint} from '../src/materials/research-evidence.ts'

const text='Historical policy vision.'
const original={documents:[{path:'correct-source.txt',text,byteLength:Buffer.byteLength(text),contentHash:createHash('sha256').update(text).digest('hex')},
  {path:'wrong-source.txt',text:'Unrelated statistics.',byteLength:21,contentHash:createHash('sha256').update('Unrelated statistics.').digest('hex')}],limitations:[]}
const corpus={...original,fingerprint:materialCorpusFingerprint(original)}
function rejection(groupId:string,field='policyVision') {
  const target={port:'market_context',recordId:'record-1',field,at:''}
  const raw={projectionVersion:'module-author-field-group.v12',groupId,outputs:{market_context:{records:[{recordId:'record-1',resultClass:'observation_summary',
    [field]:{value:text,claimClass:'source_conclusion',limitations:['Synthetic only']}}]}},
    evidence:[{target,kind:'source',source:{path:'wrong-source.txt',quote:text}}],limitations:['Synthetic only']}
  return {classId:'text',status:'failed',groupId,childId:'synthetic-'+groupId,executionId:'synthetic-execution',
    structuredOutput:raw,error:'MODULE_SOURCE_VALUE_QUOTE: Synthetic wrong source binding'}
}
function feedback(groupId:string,attempts:ReturnType<typeof rejection>[]) {
  return moduleAuthorGroupRecoveryFeedback({resumeExecutionAudit:{attempts,reviewReceipts:[]},corpus}, {groupId,recordIds:['record-1','record-2']})
}
it('delivers the policy part rejection hash and matching original source identity to its native author',()=>{
  const attempt=rejection('market_context:4.2.1'),before=sha256CanonicalJson(attempt)
  const prompt=feedback('market_context:4.2.1',[attempt])
  expect(prompt).toContain(sha256CanonicalJson(attempt.structuredOutput))
  expect(prompt).toContain('correct-source.txt')
  expect(prompt).toContain('wrong-source.txt')
  expect(prompt).toContain('"literalExactMatch":true')
  expect(sha256CanonicalJson(attempt)).toBe(before)
})
it('prefers a formula part own rejection over an older unsplit formula rejection',()=>{
  const old=rejection('market_context:3.2.2','formula'),current=rejection('market_context:3.2.2.1','formula')
  const prompt=feedback('market_context:3.2.2.1',[old,current])
  expect(prompt).toContain(sha256CanonicalJson(current.structuredOutput))
  expect(prompt).not.toContain(sha256CanonicalJson(old.structuredOutput))
})
it('retains an unsplit formula rejection as diagnostics when the new formula part has none',()=>{
  const old=rejection('market_context:3.2.2','formula')
  expect(feedback('market_context:3.2.2.1',[old])).toContain(sha256CanonicalJson(old.structuredOutput))
})
it('does not deliver another policy part rejected candidate to this author',()=>{
  const other=rejection('market_context:4.2.2')
  expect(feedback('market_context:4.2.1',[other])).not.toContain(sha256CanonicalJson(other.structuredOutput))
})
it('delivers the old unsplit numeric rejected hash to new record parts without rewriting it',()=>{
  const old=rejection('market_context:2.1','originalValue'),before=sha256CanonicalJson(old)
  const prompt=feedback('market_context:2.1.1',[old])
  expect(prompt).toContain(sha256CanonicalJson(old.structuredOutput))
  expect(sha256CanonicalJson(old)).toBe(before)
})
it('prefers a numeric part own rejection over the original unsplit numeric rejection',()=>{
  const old=rejection('market_context:2.1','originalValue'),current=rejection('market_context:2.1.1','originalValue')
  const prompt=feedback('market_context:2.1.1',[old,current])
  expect(prompt).toContain(sha256CanonicalJson(current.structuredOutput))
  expect(prompt).not.toContain(sha256CanonicalJson(old.structuredOutput))
})
