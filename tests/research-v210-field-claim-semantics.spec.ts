import {expect,it} from 'vitest'
import {createHash} from 'node:crypto'
import {materialCorpusFingerprint} from '../src/materials/research-evidence.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'
import {moduleFieldProtocolDiagnostic} from '../src/research-v2/module-field-protocol-diagnostics.ts'
import {moduleRecoveryFeedback} from '../src/research-v2/module-recovery-feedback.ts'
import {assertModuleFieldClaimCoverage,moduleInferenceBasisDiagnostic,verifyModuleSourceValues} from '../src/research-v2/module-claims.ts'

const text='甲原文',document={path:'synthetic.txt',text,contentHash:createHash('sha256').update(text).digest('hex'),byteLength:Buffer.byteLength(text)}
const base={documents:[document],limitations:[]},corpus={...base,fingerprint:materialCorpusFingerprint(base)}
const target=(at:string)=>({port:'peer_supply',recordId:'peer-synthetic',field:'blindSpots',at})
const draft=()=>({groupId:'peer_supply:5.1.3',outputs:{peer_supply:{records:[{recordId:'peer-synthetic',
  blindSpots:{value:[text,'有限资料下的分析判断','资料不能核实当前状态'],claimClass:'source_conclusion',limitations:['Synthetic fixture only']}}]}},
  evidence:[{target:target('/0'),kind:'source',source:{path:document.path,quote:text}},
    {target:target('/1'),kind:'inference',inputRefs:[],rationale:'Author assessment needs its own dependency'},
    {target:target('/2'),kind:'source',source:{path:document.path,quote:text}}]})

it.each(['MODULE_SOURCE_VALUE_TEXT: synthetic','MODULE_CLAIM_CLASS_MISMATCH: synthetic','MODULE_CLAIM_INFERENCE_BASIS: synthetic'])(
  'reports the same class, inference-basis and literal-source conflicts together after %s',error=>{
    const raw=draft(),before=hash(raw),diagnostic=moduleFieldProtocolDiagnostic(error,raw,[],'3.04',corpus,[]) as any
    expect(diagnostic).toMatchObject({scope:'field-protocol-conflicts-only',originalSubmissionHash:before,
      fieldClaimClassConflicts:[{evidenceIndex:1,target:target('/1'),fieldClaimClass:'source_conclusion',evidenceKind:'inference'}],
      fieldInferenceBasisConflicts:[{evidenceIndex:1,target:target('/1'),inputRefCount:0}],
      fieldTextConflicts:[{target:target('/2'),diagnosticCode:'MODULE_SOURCE_VALUE_TEXT'}]})
    expect(diagnostic.fieldInferenceBasisConflicts[0].diagnostic).toContain('at least one valid inputRefs dependency')
    expect(hash(raw)).toBe(before)
  })

it('uses the existing inference rule for numeric leaves without selecting dependencies or business classes',()=>{
  const raw=draft();raw.outputs.peer_supply.records[0].blindSpots={value:[4] as any,claimClass:'agent_inference',limitations:['Scenario is unverified']}
  raw.evidence=[{target:target('/0'),kind:'inference',inputRefs:[{local:target('/0')}] as any,rationale:'Synthetic self dependency is not an approved basis'}]
  const before=hash(raw),diagnostic=moduleFieldProtocolDiagnostic('MODULE_CLAIM_INFERENCE_BASIS: synthetic',raw,[],'3.04') as any
  expect(diagnostic.fieldInferenceBasisConflicts).toMatchObject([{target:target('/0'),inputRefCount:1,
    diagnostic:moduleInferenceBasisDiagnostic(4,raw.evidence[0].inputRefs)}])
  expect(diagnostic.fieldClaimClassConflicts).toBeUndefined()
  expect(hash(raw)).toBe(before)
})

it('does not flag a literal source field as a business class conflict',()=>{
  const raw=draft();raw.outputs.peer_supply.records[0].blindSpots.value=[text];raw.evidence=raw.evidence.slice(0,1)
  expect(moduleFieldProtocolDiagnostic('MODULE_CLAIM_CLASS_MISMATCH: synthetic',raw,[],'3.04',corpus,[])).toBeUndefined()
})

it('keeps all three original strict gates closed after generating read-only diagnostics',()=>{
  const raw=draft(),before=hash(raw)
  moduleFieldProtocolDiagnostic('MODULE_SOURCE_VALUE_TEXT: synthetic',raw,[],'3.04',corpus,[])
  expect(()=>verifyModuleSourceValues(corpus,[{sourceId:'synthetic',path:document.path,contentHash:document.contentHash,quote:text,rawValue:raw.outputs.peer_supply.records[0].blindSpots.value[2]}])).toThrow('MODULE_SOURCE_VALUE_TEXT')
  expect(()=>assertModuleFieldClaimCoverage({value:'Analysis',claimClass:'source_conclusion',claimRefs:['synthetic']},'/outputs/peer_supply/records/0/blindSpots',
    [{claimId:'synthetic',kind:'inference',selector:'/outputs/peer_supply/records/0/blindSpots/value',value:'Analysis'}],['synthetic'])).toThrow('MODULE_CLAIM_CLASS_MISMATCH')
  expect(moduleInferenceBasisDiagnostic('Analysis',[])).toContain('at least one valid inputRefs dependency')
  expect(hash(raw)).toBe(before)
})

it('delivers the complete original conflicts and classification rules during checkpoint recovery without rewriting the draft',()=>{
  const raw=draft(),error='MODULE_SOURCE_VALUE_TEXT: synthetic',audit={reviewReceipts:[],attempts:[{classId:'text',groupId:raw.groupId,status:'failed',structuredOutput:raw,error}]},before=hash(audit)
  const prompt=moduleRecoveryFeedback({module:{id:'3.04'},corpus,upstream:[],resumeExecutionAudit:audit} as any,raw.groupId)
  const diagnostic=JSON.parse(prompt.split('\n').at(-1)!).previousRejection.diagnosticExcerpt
  expect(diagnostic).toMatchObject({originalSubmissionHash:hash(raw),fieldClaimClassConflicts:[{target:target('/1')}],fieldInferenceBasisConflicts:[{target:target('/1')}]})
  expect(prompt).toContain('字段类别与推断依据协议 field-claim-basis.v1')
  expect(prompt).toContain('同一字段的claimClass适用于全部数组叶')
  expect(prompt).toContain('已有且实际具备证据的local或upstream')
  expect(prompt).toContain('不能只换类别')
  expect(hash(audit)).toBe(before)
})
