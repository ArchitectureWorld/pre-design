import {z} from 'zod'
import {createHash} from 'node:crypto'

const text=max=>z.string().trim().min(1).max(max)
export const policySourceSchema=z.object({
 url:text(2048),title:text(180),publisher:text(100),publishedDate:text(80),
 scope:text(180),quote:text(1600),summary:text(500),status:text(180),
}).strict()
const normalize=value=>String(value).replace(/\s/gu,'')
const fail=message=>Object.assign(new Error(message),{code:'WORKFLOW_POLICY_INVALID',statusCode:409})

export function officialPolicyUrl(value){
 try{
  const u=new URL(value)
  return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&!u.port
   &&(u.hostname==='gov.cn'||u.hostname.endsWith('.gov.cn'))
 }catch{return false}
}
export function verifiedPolicySources(sources,reads){
 const unique=new Map()
 for(const raw of sources){
  const source=policySourceSchema.parse(raw)
  if(!officialPolicyUrl(source.url))throw fail('政策依据须来自官方原文页面。')
  const read=reads.find(r=>r.url===source.url&&r.contentHash===createHash('sha256').update(r.text).digest('hex'))
  if(!read)throw fail('政策链接缺少本次网页原文读取收执。')
  if(normalize(source.quote).length<12||!normalize(read.text).includes(normalize(source.quote)))throw fail('政策引用与实际读取的原文不匹配。')
  const key=source.url+'\n'+source.quote
  if(unique.has(key))continue
  unique.set(key,{...source,kind:'official_policy',filename:source.title,
   locator:[source.publisher,source.publishedDate,source.scope].join(' · '),
   sourceId:'policy:'+createHash('sha256').update(key).digest('hex'),
   contentHash:read.contentHash,retrievedAt:read.retrievedAt,snapshot:read.text,
  })
 }
 return [...unique.values()]
}
