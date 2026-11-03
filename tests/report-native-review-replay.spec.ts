import { describe, expect, it } from 'vitest'
import { replayReportReview } from '../src/report/native-review-replay.ts'

const output = { inputHash: 'a'.repeat(64), pass: true }
const route = { provider: 'saved-local', model: 'configured-model' }
function events() { return [
  { seq: 1, type: 'turn/start', data: { turn: 1 } },
  { seq: 2, type: 'request/header', data: { header: { config: route } } },
  { seq: 3, type: 'tool/call', data: { turn: 1, step: 0, name: 'structured_output', callId: 'c', arguments: JSON.stringify(output) } },
  { seq: 4, type: 'tool/result', data: { turn: 1, step: 0, message: { content: [{ type: 'tool-result', toolCallId: 'c', isError: false, content: [] }] } } },
  { seq: 5, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
] }
describe('report review native evidence replay', () => {
  it('accepts a corrected submission after a recorded schema rejection, while keeping duplicate successes invalid',()=>{
    const rows:any[]=events();rows[2].data.arguments=JSON.stringify({invalid:true});rows[3].data.message.content[0].isError=true
    rows.splice(4,0,{seq:5,type:'request/header',data:{header:{config:route}}},
      {seq:6,type:'tool/call',data:{turn:1,step:1,name:'structured_output',callId:'fixed',arguments:JSON.stringify(output)}},
      {seq:7,type:'tool/result',data:{turn:1,step:1,message:{content:[{type:'tool-result',toolCallId:'fixed',isError:false}]}}})
    rows.at(-1).seq=8
    expect(replayReportReview(rows,route,output).callId).toBe('fixed')
    rows[3].data.message.content[0].isError=false
    expect(()=>replayReportReview(rows,route,output)).toThrow('REPORT_REVIEW_NATIVE')
  })
  it('rejects a receipt with a different explicit reasoning effort but permits legacy provider defaults', () => {
    const rows: any[] = events()
    rows[1].data.header.config = { ...route, reasoningEffort: 'low' }
    expect(() => replayReportReview(rows, { ...route, reasoningEffort: 'high' } as any, output)).toThrow('REPORT_REVIEW_NATIVE')
    expect(replayReportReview(rows, route, output).callId).toBe('c')
    expect(replayReportReview(rows, { ...route, reasoningEffort: 'low' } as any, output).callId).toBe('c')
  })
  it('binds actual submission, model, successful result and completed turn', () => {
    expect(replayReportReview(events(), route, output)).toEqual({ callId: 'c', callSeq: 3, resultSeq: 4, terminalSeq: 5 })
  })
  it('rejects a locally edited approval even when its local hash was recomputed', () => {
    expect(() => replayReportReview(events(), route, { ...output, inputHash: 'b'.repeat(64) })).toThrow('REPORT_REVIEW_NATIVE')
  })
  it.each(['wrong-model', 'failed-result', 'unfinished', 'cross-turn', 'later-turn', 'duplicate'])('rejects %s evidence', mode => {
    const rows: any[] = events()
    if (mode === 'wrong-model') rows[1].data.header.config = { ...route, model: 'default' }
    if (mode === 'failed-result') rows[3].data.message.content[0].isError = true
    if (mode === 'unfinished') rows.pop()
    if (mode === 'cross-turn') rows[3].data.turn = 2
    if (mode === 'later-turn') rows.push({ seq: 6, type: 'turn/start', data: { turn: 2 } })
    if (mode === 'duplicate') rows.splice(3, 0, { ...rows[2], seq: 3.5 })
    expect(() => replayReportReview(rows, route, output)).toThrow('REPORT_REVIEW_NATIVE')
  })
})
