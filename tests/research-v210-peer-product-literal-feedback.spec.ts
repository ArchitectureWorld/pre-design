import {createHash} from 'node:crypto'
import {describe,it,expect} from 'vitest'
import {materialCorpusFingerprint} from '../src/materials/research-evidence.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'
import {peerCategoricalEvidenceFeedback} from '../src/research-v2/module-field-protocol-diagnostics.ts'
import {moduleRecoveryFeedback} from '../src/research-v2/module-recovery-feedback.ts'

const path='synthetic/product-classification.txt',quote='测试项目计划建设露营基地，未载当前经营状态。'
const base={documents:[{path,text:quote,contentHash:createHash('sha256').update(quote).digest('hex'),byteLength:Buffer.byteLength(quote)}],limitations:[]}
const corpus={...base,fingerprint:materialCorpusFingerprint(base)},groupId='peer_products:2.2.1'
const raw=(field:string,value:unknown)=>({groupId,outputs:{peer_products:{records:[{recordId:'synthetic-peer',
  [field]:{value,claimClass:'source_conclusion',limitations:['Synthetic historical clue, current status unverified']}}]}},
  evidence:[{kind:'source',target:{port:'peer_products',recordId:'synthetic-peer',field,at:''},source:{path,quote}}]})
describe('peer-product classification source feedback',()=>{
  it.each(['status','classificationBasis','productType'])('explains source and inference boundaries for rejected %s without editing the author draft',field=>{
    const draft=raw(field,field==='status'?'unknown':'作者按报道归类为露营主题'),before=hash(draft)
    const feedback=peerCategoricalEvidenceFeedback('MODULE_SOURCE_VALUE_QUOTE: synthetic-rejection',draft)
    expect(feedback).toContain('peer_products');expect(feedback).toContain('classificationBasis')
    expect(feedback).toContain('unknown');expect(feedback).toContain('missing/null')
    expect(feedback).toContain('inputRefs仅支持local或upstream');expect(hash(draft)).toBe(before)
  })
  it('delivers the joint protocol through the existing cold recovery with the original rejected hash',()=>{
    const draft=raw('classificationBasis','作者按报道归类为露营主题')
    const audit={reviewReceipts:[],attempts:[{classId:'text',groupId,status:'failed',error:'MODULE_SOURCE_VALUE_QUOTE: synthetic-rejection',structuredOutput:draft}]},before=hash(audit)
    const feedback=moduleRecoveryFeedback({resumeExecutionAudit:audit,corpus},groupId)
    const previous=JSON.parse(feedback.split('\n').at(-1)!).previousRejection
    expect(feedback).toContain('peer_products');expect(feedback).toContain('分类枚举引用协议')
    expect(previous.diagnosticExcerpt.originalSubmissionHash).toBe(hash(draft));expect(hash(audit)).toBe(before)
  })
  it('covers JSON transport on a live reference rejection without mapping a replacement value',()=>{
    const draft=raw('status','unknown'),wire={outputsJson:JSON.stringify(draft.outputs)},before=hash(wire)
    expect(peerCategoricalEvidenceFeedback('MODULE_PROJECTION_REFERENCE: synthetic-reference',wire)).toContain('peer_products')
    expect(hash(wire)).toBe(before)
  })
  it('does not add classification instructions to missing fields, unrelated product fields or other errors',()=>{
    expect(peerCategoricalEvidenceFeedback('MODULE_SOURCE_VALUE_TEXT: synthetic',raw('status',null))).toBe('')
    expect(peerCategoricalEvidenceFeedback('MODULE_SOURCE_VALUE_TEXT: synthetic',raw('priceUnit','元'))).toBe('')
    expect(peerCategoricalEvidenceFeedback('MODULE_CLAIM_UNIT_MISMATCH: synthetic',raw('status','unknown'))).toBe('')
  })
})
