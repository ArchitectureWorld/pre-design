import {it,expect} from 'vitest'
import * as contract from '../src/report/chapter-production-contract.ts'
import { chapterLiveSchemaFeedback } from '../src/report/chapter-schema-feedback.ts'

it('gives live field diagnostics after a rejected call without requiring the child to finish',()=>{
 const output={pages:[{pageId:'p1',assetIds:['used-up'],row:0.5,extra:'x'}]}
 const events:any=[{type:'tool/call',data:{name:'structured_output',callId:'c1',arguments:JSON.stringify(output)}},
  {type:'tool/result',data:{error:{code:'INVALID_ARGS'},message:{source:{callId:'c1'}}}}]
 const schema:any={type:'object',properties:{pages:{type:'array',items:{oneOf:[{type:'object',required:['pageId','overlays'],additionalProperties:false,
  properties:{pageId:{const:'p1'},assetIds:{type:'array',minItems:2,items:{type:'string',enum:['available']}},row:{type:'integer'}}},
  {type:'object',properties:{pageId:{const:'p2'}}}]}}}}
 const feedback=chapterLiveSchemaFeedback(events,schema)
 for(const term of ['value.pages[0].overlays','value.pages[0].extra','value.pages[0].assetIds 至少 2','value.pages[0].assetIds[0]','value.pages[0].row'])expect(feedback).toContain(term)
 expect(feedback).not.toContain(JSON.stringify(output))
 expect(chapterLiveSchemaFeedback(events.slice(0,1),schema)).toBeUndefined()
 expect(chapterLiveSchemaFeedback([events[0],{type:'tool/result',data:{}}],schema)).toBeUndefined()
 expect(chapterLiveSchemaFeedback([events[0],{...events[1],data:{...events[1].data,message:{source:{callId:'other'}}}}],schema)).toBeUndefined()
})

it('reports malformed page entries and respects the last submitted call',()=>{
 const schema:any={type:'object',properties:{pages:{type:'array',items:{oneOf:[{type:'object',properties:{pageId:{const:'p1'}}}]}}}}
 const call={type:'tool/call',data:{name:'structured_output',arguments:JSON.stringify({pages:['p1']})}}
 const error={type:'tool/result',data:{error:{code:'INVALID_ARGS'}}}
 expect(chapterLiveSchemaFeedback([call,error] as any,schema)).toContain('value.pages[0] 必须是页面对象')
 expect(chapterLiveSchemaFeedback([call,error,call] as any,schema)).toBeUndefined()
})

it('recovers precise schema feedback from an actually rejected native structured call',()=>{
 const recover=(contract as any).chapterSchemaRecoveryFeedback
 expect(typeof recover).toBe('function')
 const output={pages:[{pageId:'products-one',composition:{figures:[]}}]}
 const events:any=[
  {type:'tool/call',data:{name:'structured_output',arguments:JSON.stringify(output)}},
  {type:'tool/result',data:{error:{code:'INVALID_ARGS'}}},
  {type:'turn/end',data:{reason:{kind:'completed'}}},
 ]
 const schema:any={type:'object',properties:{pages:{type:'array',items:{oneOf:[
  {type:'object',required:['pageId','overlays','protectedAreas'],properties:{pageId:{const:'products-one'},composition:{type:'object',required:['figures','bodies','sequences'],properties:{}}}},
  {type:'object',required:['other'],properties:{pageId:{const:'products-two'}}},
 ]}}}}
 const feedback=recover(events,schema)
 for(const field of ['pages[0].overlays','pages[0].protectedAreas','pages[0].composition.bodies','pages[0].composition.sequences'])expect(feedback).toContain(field)
 expect(feedback).toContain(JSON.stringify(output))
 expect(feedback).not.toContain('pages[0].other')
 expect(recover(events.slice(0,2),schema)).toBeUndefined()
 expect(recover([events[0],{type:'tool/result',data:{}},events[2]],schema)).toBeUndefined()
 expect(recover([...events.slice(0,2),{type:'turn/end',data:{reason:{kind:'cancelled'}}}],schema)).toBeUndefined()
})
it('explains graph capacity and row constraints instead of an opaque oneOf rejection',()=>{
 const output={nodes:[{row:2},{row:0},{row:1}]}
 const events:any=[{type:'tool/call',data:{name:'structured_output',arguments:JSON.stringify(output)}},
  {type:'tool/result',data:{error:{code:'INVALID_ARGS'}}},{type:'turn/end',data:{reason:{kind:'completed'}}}]
 const feedback=contract.chapterSchemaRecoveryFeedback(events,{type:'object',properties:{nodes:{type:'array',maxItems:2,items:{type:'object',properties:{row:{type:'integer',enum:[0,1]}}}}}} as any)
 expect(feedback).toContain('value.nodes 最多 2 项')
 expect(feedback).toContain('value.nodes[0].row 必须取 [0,1]')
})
it('recovers the last full native layout as input when a later tool correction only contains one page',()=>{
 const full={pages:[{pageId:'p1'},{pageId:'p2'}]},partial={pages:[{pageId:'p2'}]}
 const events:any=[
  {type:'tool/call',data:{name:'structured_output',callId:'full-call',arguments:JSON.stringify(full)}},
  {type:'tool/result',data:{error:{code:'INVALID_ARGS'}}},
  {type:'tool/call',data:{name:'structured_output',arguments:JSON.stringify(partial)}},
  {type:'turn/end',data:{reason:{kind:'completed'}}},
 ]
 expect(contract.completeNativeLayoutSubmission(events,['p1','p2'])).toEqual({output:full,callId:'full-call'})
 expect(contract.completeNativeLayoutSubmission(events,['p2','p1'])).toBeUndefined()
 expect(contract.completeNativeLayoutSubmission(events.slice(0,-1),['p1','p2'])).toBeUndefined()
 const exhausted=[...events.slice(0,-1),{type:'turn/end',data:{reason:{kind:'max-tokens'}}}]
 expect(contract.completeNativeLayoutSubmission(exhausted,['p1','p2'])).toEqual({output:full,callId:'full-call'})
})
