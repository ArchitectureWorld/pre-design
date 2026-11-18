import {createHash} from 'node:crypto'
import {appendFileSync} from 'node:fs'
const sha=b=>createHash('sha256').update(b).digest('hex')
/** Opt-in isolated trial only. No body, image data or credentials are persisted. */
export function createWireBudgetFetch(config,fetchImpl,record=()=>{},now=Date.now){
 const {url,model,imageSha256,maxBodyBytes,deadlineAt,protocol='openai-completions'}=config
 const parsed=new URL(url)
 if(!['openai-completions','openai-responses'].includes(protocol)||parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.search||parsed.hash||!model||!/^[a-f0-9]{64}$/.test(imageSha256)||!Number.isSafeInteger(maxBodyBytes)||maxBodyBytes<1||maxBodyBytes>800000||!Number.isSafeInteger(deadlineAt)||deadlineAt<=now()||deadlineAt-now()>180000)throw Error('LAYOUT_WIRE_CONFIG')
 let used=0
 return async (input,init)=>{
  if(now()>=deadlineAt)throw Error('LAYOUT_WIRE_DEADLINE')
  if(used)throw Error('LAYOUT_WIRE_BUDGET')
  if(String(input)!==url||init?.method!=='POST'||typeof init.body!=='string')throw Error('LAYOUT_WIRE_SCOPE')
  const bodyBytes=Buffer.byteLength(init.body);if(bodyBytes>maxBodyBytes)throw Error('LAYOUT_WIRE_SIZE')
  const body=JSON.parse(init.body)
  if(body.model!==model||(protocol==='openai-responses'?body.max_output_tokens:(body.max_tokens??body.max_completion_tokens))!==4096)throw Error('LAYOUT_WIRE_MODEL')
  const responses=protocol==='openai-responses'
  const images=(responses?(body.input??[]):(body.messages??[])).flatMap(m=>Array.isArray(m.content)?m.content.filter(c=>c.type===(responses?'input_image':'image_url')):[])
  const imageUrl=responses?images[0]?.image_url:images[0]?.image_url?.url
  if(images.length!==1||typeof imageUrl!=='string'||!imageUrl.startsWith('data:image/jpeg;base64,'))throw Error('LAYOUT_WIRE_IMAGE')
  const image=Buffer.from(imageUrl.slice('data:image/jpeg;base64,'.length),'base64')
  if(sha(image)!==imageSha256)throw Error('LAYOUT_WIRE_IMAGE')
  used++
  record({request:used,bodyBytes,bodySha256:sha(init.body),imageSha256,outputCap:4096})
  try{return await fetchImpl(input,{...init,redirect:'error'})}catch(error){
   const known=new Set(['EAI_AGAIN','ENOTFOUND','ECONNREFUSED','ECONNRESET','ETIMEDOUT','ENETUNREACH','EHOSTUNREACH','EPERM','EACCES','CERT_HAS_EXPIRED','DEPTH_ZERO_SELF_SIGNED_CERT','UNABLE_TO_VERIFY_LEAF_SIGNATURE','ERR_TLS_CERT_ALTNAME_INVALID','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_SOCKET'])
   const raw=error?.cause?.code??error?.code
   record({request:used,transportFailure:{code:known.has(raw)?raw:'UNKNOWN'}})
   throw error
  }
 }
}
export const name='pre-layout-wire-budget'
export function apply(ctx){
 const config=JSON.parse(process.env.PRE_WEB_LAYOUT_WIRE_BUDGET)
 globalThis.fetch=createWireBudgetFetch(config,globalThis.fetch.bind(globalThis),r=>appendFileSync(config.receiptPath,JSON.stringify(r)+'\n',{mode:0o600}))
 ctx.provide('preLayoutWireBudgetReady',true)
}
