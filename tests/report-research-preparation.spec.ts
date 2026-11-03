import { expect,it } from 'vitest'
import { ensureReportResearch } from '../src/report/research-preparation.ts'
it('starts the complete research plan automatically when no selection exists',async()=>{
  let ready=false
  const result=await ensureReportResearch({load:async()=>ready?{status:'ready',research:{fingerprint:'new'},selection:{}}:{status:'not_requested'},
    start:async (flags:unknown)=>{expect(flags).toBeUndefined();ready=true},wait:async()=>{} } as any,new AbortController().signal)
  expect(result.status).toBe('ready')
})
it('does not count a failed or partial background run as completed research',async()=>{
  const load={status:'not_ready',selection:{flags:{marketing:false},expectedModuleIds:['1.01']}}
  await expect(ensureReportResearch({load:async()=>load,start:async()=>{},wait:async()=>{}} as any,new AbortController().signal)).rejects.toThrow('REPORT_MODULES_INCOMPLETE')
})
it('preserves selected research conditions and refuses obsolete sources',async()=>{
  const flags={marketing:false},load={status:'not_ready',selection:{flags,expectedModuleIds:['1.01']}}
  let calls=0
  await expect(ensureReportResearch({load:async()=>{if(calls++)throw new Error('REPORT_MODULE_SOURCE_CHANGED');return load},start:async (actual:unknown)=>expect(actual).toEqual(flags),wait:async()=>{}} as any,new AbortController().signal)).rejects.toThrow('REPORT_MODULE_SOURCE_CHANGED')
})

it('refuses incomplete research before any automatic model work in controlled Web report generation', async () => {
  let starts = 0
  await expect(ensureReportResearch({ load: async () => ({ status: 'not_requested' }), start: async () => { starts++ }, wait: async () => {} }, new AbortController().signal, { allowStart: false })).rejects.toThrow('REPORT_MODULES_REQUIRED')
  expect(starts).toBe(0)
})
