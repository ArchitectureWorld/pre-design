import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import { ReportContentReviewService, normalizeChapterReviewObservations } from '../src/report/content-review.ts'
import { expandPlanningSourcePrompt } from '../src/report/manuscript/source-prompt.ts'

it('preserves affirmative native observations without accepting conflicting rejection findings',()=>{
  const raw:any={inputHash:'h',requirementId:'opportunity',pass:true,pageIds:['p1'],evidenceRefs:['s1'],rationale:'通过',findings:[{pageId:'p1',code:'PASS-1.01',reason:'页面通过'}]}
  const result=normalizeChapterReviewObservations(raw,'opportunity',['p1'],['s1'])
  expect(result.findings).toEqual([]);expect(raw.findings).toHaveLength(1)
  expect(()=>normalizeChapterReviewObservations({...raw,findings:[{pageId:'p1',code:'MISSING_EVIDENCE',reason:'缺少依据'}]},'opportunity',['p1'],['s1'])).toThrow('REPORT_CONTENT_REVIEW_INVALID')
  expect(()=>normalizeChapterReviewObservations(raw,'opportunity',['p1','p2'],['s1'])).toThrow('REPORT_CONTENT_REVIEW_INVALID')
})

it.each(['capacity','unfinished','wrong-route','has-output','other-error','repeated-capacity'])('recovers only one verified context-capacity failure: %s', async scenario=>{
  const root=await mkdtemp(join(tmpdir(),'chapter-capacity-')),route={provider:'configured',model:'review-model'}
  const basis=('完整来源与假设，收入与成本均采用同一运营年，单价是假设并保留采购核实备注。'.repeat(4)+'；').repeat(80),sources=Array.from({length:12},(_,i)=>({id:'R-'+i,text:'依据'+i,basis:'来源'+i+'；'+basis}))
  const draft:any={projectId:'p',chapterId:'operation',planHash:'plan',rulesVersion:'rules',chapter:{id:'operation',pages:[{id:'operation-1',body:['收入按同一运营年计算'],notes:['单价为假设'],sourceRefs:['R-0']}]}}
  const brief:any={plan:{chapterId:'operation',pages:[{id:'operation-1'}],sources},approval:{scope:'chapter',planOrigin:'dsh-native'}},before=structuredClone({draft,brief})
  const executions=new Map<string,any>(),events=new Map<string,any[]>();let starts=0,output:any
  const deps:any={classes:{
    begin:async()=>{const e={id:'e'+executions.size,projectId:'p',classId:'review',parentId:'parent',selected:route};executions.set(e.id,e);return e},
    attach:async(id:string,childId:string)=>{executions.get(id).childId=childId},
    finish:async(id:string,status:string)=>{const e=executions.get(id),last=events.get(e.childId)?.at(-1);Object.assign(e,{status,actual:scenario==='wrong-route'?{...route,model:'other'}:route,childStopReason:last?.data?.reason?.kind})},
    execution:(id:string)=>executions.get(id),
  },subagents:{start:async(_:string,request:any)=>{
    const child='child'+starts++,inputHash=request.outputSchema.properties.inputHash.enum[0]
    const expanded=expandPlanningSourcePrompt(request.prompt[0].text)
    expect(expanded).toContain('当前chapter是此次唯一待审正文')
    expect(expanded).toContain('不得为通过而忽略真实成本缺项')
    expect(request.prompt[0].text.length).toBeLessThan(expanded.length*.6)
    expect(expanded).toContain(JSON.stringify({inputHash,requirementId:request.outputSchema.properties.requirementId.enum[0],pagePlan:brief.plan.pages,chapter:draft.chapter,sources}))
    const current:any[]=[{seq:1,type:'turn/start',data:{turn:1}},{seq:2,type:'request/header',data:{header:{config:route}}}]
    const fail=starts===1||scenario==='repeated-capacity'
    if(fail){
      if(scenario==='has-output')current.push({seq:3,type:'tool/call',data:{name:'structured_output',arguments:'{}'}})
      if(scenario!=='unfinished')current.push({seq:4,type:'turn/end',data:{turn:1,reason:{kind:'error',error:{message:scenario==='other-error'?'Connection failed':'Codex error: Your input exceeds the context window of this model. Please adjust your input and try again.'}}}})
    }else{
      output={inputHash,requirementId:request.outputSchema.properties.requirementId.enum[0],pass:true,pageIds:['operation-1'],evidenceRefs:['R-0'],rationale:'同期间测算成立',findings:[]}
      current.push({seq:3,type:'tool/call',data:{turn:1,step:0,name:'structured_output',callId:'c',arguments:JSON.stringify(output)}},{seq:4,type:'tool/result',data:{turn:1,step:0,message:{content:[{type:'tool-result',toolCallId:'c',isError:false}]}}},{seq:5,type:'turn/end',data:{turn:1,reason:{kind:'completed'}}})
    }
    events.set(child,current)
    return{id:child,result:Promise.resolve({stopReason:fail?'error':'completed',structured:fail?undefined:output}),dispose:async()=>{}}
  }},readEvents:async(id:string)=>events.get(id)}
  const invoke=()=>new ReportContentReviewService(deps).prepareChapter(draft,brief,root,{id:'parent'} as any,new AbortController().signal,()=>{})
  try{
    await expect(invoke()).rejects.toThrow('REPORT_CHAPTER_REVIEW_INCOMPLETE')
    const old=structuredClone(executions.get('e0'))
    if(scenario==='capacity'){
      const record:any=await invoke();expect(record.status).toBe('passed');expect(starts).toBe(2)
      expect(record.recoveryAttempts).toHaveLength(1);expect(record.recoveryAttempts[0]).toMatchObject({executionId:'e0',childId:'child0',kind:'context-capacity'})
      expect(executions.get('e0')).toEqual(old);expect(await invoke()).toEqual(record);expect(starts).toBe(2)
    }else if(scenario==='repeated-capacity'){
      await expect(invoke()).rejects.toThrow('REPORT_CHAPTER_REVIEW_INCOMPLETE')
      await expect(invoke()).rejects.toThrow('REPORT_CHAPTER_REVIEW_RECOVERY_REQUIRED');expect(starts).toBe(2)
    }else{
      await expect(invoke()).rejects.toThrow('REPORT_CHAPTER_REVIEW_RECOVERY_REQUIRED');expect(starts).toBe(1)
    }
    expect({draft,brief}).toEqual(before)
  }finally{await rm(root,{recursive:true,force:true})}
})

it.each(['opportunity','site'])('reviews %s independently with only that chapter requirements and pending user review', async chapterId => {
  const root = await mkdtemp(join(tmpdir(), 'chapter-review-'))
  const route = { provider: 'configured', model: 'review-model' }
  let output: any, execution: any
  const deps = { classes: {
    begin: async () => (execution = { id: 'review-execution', projectId: 'p', classId: 'review', parentId: 'parent', selected: route }),
    attach: async (_: string, id: string) => { execution.childId = id },
    finish: async (_: string, status: string) => { Object.assign(execution, { status, actual: route, childStopReason: 'completed' }) },
    execution: () => execution,
  }, subagents: { start: async (_: string, request: any) => {
    expect(request.outputSchema.properties.pageIds.items.enum).toEqual([chapterId+'-resource'])
    expect(request.outputSchema.properties.evidenceRefs.items.enum).toEqual(['R-photo'])
    if(chapterId==='site')expect(request.prompt[0].text).not.toContain('第6页至少两个具体案例')
    output = { inputHash: request.outputSchema.properties.inputHash.enum[0], requirementId: 'opportunity', pass: true,
      pageIds: [chapterId+'-resource'], evidenceRefs: ['R-photo'], rationale: '资源与体验关系具体，实施核实已留在备注。', findings: [] }
    return { id: 'independent-review-child', result: Promise.resolve({ stopReason: 'completed', structured: output }), dispose: async () => {} }
  } }, readEvents: async () => [
    { seq: 1, type: 'turn/start', data: { turn: 1 } }, { seq: 2, type: 'request/header', data: { header: { config: route } } },
    { seq: 3, type: 'tool/call', data: { turn: 1, step: 0, name: 'structured_output', callId: 'review-call', arguments: JSON.stringify(output) } },
    { seq: 4, type: 'tool/result', data: { turn: 1, step: 0, message: { content: [{ type: 'tool-result', toolCallId: 'review-call', isError: false }] } } },
    { seq: 5, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ] }
  try {
    const draft = { scope: 'chapter', projectId: 'p', chapterId, planHash: 'plan', rulesVersion: 'rules', userReview: 'pending',
      chapter: { id: chapterId, pages: [{ id: chapterId+'-resource', body: ['茶园体验'], notes: ['权属人工确认'], sourceRefs: ['R-photo'] }] } }
    const brief = { plan: { chapterId, pages: [{ id: chapterId+'-resource' }], sources: [{ id: 'R-photo', text: '茶园现状', basis: '用户照片' }] } }
    const result = await (new ReportContentReviewService(deps as never) as any).prepareChapter(draft, brief, root, { id: 'parent' }, new AbortController().signal, () => {})
    expect(result).toMatchObject({ scope: 'chapter', status: 'passed', chapterId, userReview: 'pending' })
    expect(result.receipt.childId).toBe('independent-review-child')
    expect(JSON.parse(await readFile(result.path, 'utf8')).receipt.output).toEqual(output)
  } finally { await rm(root, { recursive: true, force: true }) }
})
