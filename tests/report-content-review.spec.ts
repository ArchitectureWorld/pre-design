import { describe,expect,it } from 'vitest'
import { validateReportContentReview } from '../src/report/content-review.ts'
describe('native substantive report review admission',()=>{
  const review=()=>({requirementId:'spatial',pass:true,pageIds:['spatial-plan'],evidenceRefs:['source:1'],rationale:'产品与节点、到达及后勤具有逐项对应，限制保留在方案旁。',findings:[]})
  it('accepts a scoped independent review with real page and evidence references',()=>{
    expect(validateReportContentReview(review(),'spatial',['spatial-plan'],['source:1']).pass).toBe(true)
  })
  it.each([
    {pageIds:[]},{pageIds:['unknown']},{evidenceRefs:['invented']},{evidenceRefs:[]},{rationale:''},
    {pass:true,findings:[{pageId:'spatial-plan',code:'TERRAIN_APPENDIX_ONLY',reason:'地形只作附图，未参与方案。'}]},
  ])('rejects unsupported acceptance %j',change=>{
    expect(()=>validateReportContentReview({...review(),...change},'spatial',['spatial-plan'],['source:1'])).toThrow('REPORT_CONTENT_REVIEW_INVALID')
  })
  it('retains concrete rejection rather than upgrading completed model execution to acceptance',()=>{
    const rejected={...review(),pass:false,findings:[{pageId:'spatial-plan',code:'GENERIC_PROPOSAL',reason:'没有产品空间关系，只有后续核查。'}]}
    expect(validateReportContentReview(rejected,'spatial',['spatial-plan'],['source:1']).pass).toBe(false)
  })
})
