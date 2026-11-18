import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto'
import {createWireBudgetFetch} from '../../worker/layout-wire-budget.mjs'
const sha=b=>createHash('sha256').update(b).digest('hex'),image=Buffer.from('test-jpeg'),url='https://example.invalid/v1/chat/completions'
const body=JSON.stringify({model:'test',max_tokens:4096,messages:[{role:'user',content:[{type:'image_url',image_url:{url:'data:image/jpeg;base64,'+image.toString('base64')}}]}]})
const cfg=()=>({url,model:'test',imageSha256:sha(image),maxBodyBytes:800000,deadlineAt:Date.now()+10000})
test('measures actual UTF8 body before send and limits even a failed send to one',async()=>{let calls=0;const records=[];const f=createWireBudgetFetch(cfg(),async()=>{calls++;throw Error('network')},r=>records.push(r));await assert.rejects(f(url,{method:'POST',body}),/network/);await assert.rejects(f(url,{method:'POST',body}),/BUDGET/);assert.equal(calls,1);assert.equal(records[0].bodyBytes,Buffer.byteLength(body));assert.equal(records[0].bodySha256,sha(body));assert.equal(JSON.stringify(records).includes('messages'),false)})
test('rejects altered destination, image, model, cap, oversized or unknown bodies before network',async()=>{for(const [u,b,c] of [[url+'?other',body,{}],[url,body.replace('test"','other"'),{}],[url,body.replace('4096','8192'),{}],[url,body.replace(image.toString('base64'),'Yg=='),{}],[url,body,{maxBodyBytes:10}],[url,new Uint8Array(10),{}]]){let calls=0;const f=createWireBudgetFetch({...cfg(),...c},async()=>calls++);await assert.rejects(f(u,{method:'POST',body:b}));assert.equal(calls,0)}})
test('installed OpenAI serializer reaches the measured fetch boundary without remote network',async()=>{
 const {stream}=await import('../../worker/node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js')
 const records=[];let calls=0
 const guarded=createWireBudgetFetch(cfg(),async(_url,init)=>{calls++;assert.equal(init.redirect,'error');return new Response('data: {"choices":[{"delta":{"content":"{}"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}})},x=>records.push(x))
 const model={id:'test',name:'test',api:'openai-completions',provider:'test',baseUrl:'https://example.invalid/v1',reasoning:false,input:['text','image'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:20000,maxTokens:4096}
 const previousFetch=globalThis.fetch;globalThis.fetch=guarded
 try{const result=await stream(model,{messages:[{role:'user',content:[{type:'image',data:image.toString('base64'),mimeType:'image/jpeg'}],timestamp:0}]},{apiKey:'fake-test-key',maxTokens:4096,maxRetries:0}).result()
 assert.equal(calls,1);assert.equal(records.length,1);assert.equal(result.stopReason,'stop')}finally{globalThis.fetch=previousFetch}
})
test('actual Responses serializer is measured, single image and max_output_tokens enforced',async()=>{
 const {stream}=await import('../../worker/node_modules/@earendil-works/pi-ai/dist/api/openai-responses.js');let calls=0;const records=[]
 const c={...cfg(),protocol:'openai-responses',url:'https://example.invalid/v1/responses'}
 const guarded=createWireBudgetFetch(c,async()=>{calls++;return new Response('{"error":{"message":"test only"}}',{status:400,headers:{'content-type':'application/json'}})},r=>records.push(r))
 const prev=globalThis.fetch;globalThis.fetch=guarded
 try{const model={id:'test',name:'test',api:'openai-responses',provider:'test',baseUrl:'https://example.invalid/v1',reasoning:false,input:['text','image'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:20000,maxTokens:4096};await stream(model,{messages:[{role:'user',content:[{type:'image',data:image.toString('base64'),mimeType:'image/jpeg'}],timestamp:0}]},{apiKey:'fake-test-key',maxTokens:4096,maxRetries:0}).result();assert.equal(calls,1);assert.equal(records.length,1)}finally{globalThis.fetch=prev}
})
test('Responses wrong cap/image and expired deadline cannot send',async()=>{
 const url='https://example.invalid/v1/responses',c={...cfg(),protocol:'openai-responses',url};const base={model:'test',max_output_tokens:4096,input:[{role:'user',content:[{type:'input_image',image_url:'data:image/jpeg;base64,'+image.toString('base64')}]}]}
 for(const patch of [{max_output_tokens:8192},{input:[]},{input:[{role:'user',content:[{type:'input_image',image_url:'https://example.invalid/private'}]}]}]){let n=0;const f=createWireBudgetFetch(c,async()=>n++);await assert.rejects(f(url,{method:'POST',body:JSON.stringify({...base,...patch})}));assert.equal(n,0)}
 let now=0,n=0;const f=createWireBudgetFetch({...c,deadlineAt:10},async()=>n++,()=>{},()=>now);now=10;await assert.rejects(f(url,{method:'POST',body:JSON.stringify(base)}),/DEADLINE/);assert.equal(n,0)
})
test('network diagnostic preserves only known cause code and never arbitrary messages',async()=>{
 for(const [cause,expected] of [[{code:'EAI_AGAIN',message:'secret'},'EAI_AGAIN'],[{code:'CUSTOM_PRIVATE_TOKEN',message:'secret'},'UNKNOWN']]){const records=[],f=createWireBudgetFetch(cfg(),async()=>{throw Object.assign(Error('private URL'),{cause})},r=>records.push(r));await assert.rejects(f(url,{method:'POST',body}));assert.deepEqual(records[1],{request:1,transportFailure:{code:expected}});assert.equal(JSON.stringify(records).includes('secret'),false);assert.equal(JSON.stringify(records).includes('PRIVATE'),false)}
})
