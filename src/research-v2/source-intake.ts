import { parse } from 'parse5'
import { z } from 'zod'
import { sha256CanonicalJson } from '../presentation/canonical-json.ts'
import { sha256Bytes } from './regional-od.ts'
import { evidenceClasses, readJsonPointer } from './regional-schema.ts'
import { readResearchFile } from './run-store.ts'
import { freeze } from './graph.ts'

export const sourceIdentifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u)
export const sourceText = (max: number) => z.string().trim().min(1).max(max)
export const evidenceSelectorSchema = z.discriminatedUnion('type', [
  z.object({ type:z.literal('json-pointer'), pointer:sourceText(500).startsWith('/') }).strict(),
  z.object({ type:z.literal('text-quote'), quote:sourceText(2000) }).strict(),
])
const sourceMetaSchema = z.object({
  sourceId:sourceIdentifier,label:sourceText(200),locator:sourceText(1000),
  observedAt:z.string().datetime({offset:true}),retrievedAt:z.string().datetime({offset:true}),
  claimClass:z.enum(evidenceClasses),rights:sourceText(500),
  mediaType:z.enum(['application/json','application/geo+json','text/plain','text/html']),
})
export const workspaceSourceDescriptorSchema=sourceMetaSchema.extend({path:sourceText(1000)}).strict()
export const sourceCaptureSchema = sourceMetaSchema.extend({
  schemaVersion:z.literal('research-source-capture.v1'),content:z.string().min(1).max(1024*1024),
  sha256:z.string().regex(/^[a-f0-9]{64}$/u),
  intake:z.object({method:z.literal('bounded-workspace-read.v1'),relativePath:sourceText(1000)}).strict().optional(),
}).strict()
export type SourceCapture = z.infer<typeof sourceCaptureSchema>
export type EvidenceSelector = z.infer<typeof evidenceSelectorSchema>
export type SourceMetadata = z.infer<typeof sourceMetaSchema>
export interface BoundEvidence {
  readonly sourceId:string; readonly sourceHash:string; readonly selector:EvidenceSelector;
  readonly claimClass:SourceCapture['claimClass']; readonly observedAt:string;
  readonly independentlyVerified:false; readonly extractionMethod:string;
}

function validateLocator(locator:string):void {
  if(locator.startsWith('workspace:') && locator.length>10 && !/[\x00-\x1f]/u.test(locator))return
  let url:URL
  try{url=new URL(locator)}catch{throw new Error('SOURCE_LOCATOR_INVALID')}
  if(url.protocol!=='https:'||url.username||url.password||url.hash||/[?&](?:key|token|secret|authorization|access_token|signature|sig)=/iu.test(locator))throw new Error('SOURCE_LOCATOR_INVALID')
  // A locator is provenance only. No URL is fetched by intake or replay.
}
export function createSourceCapture(metadata:unknown,content:string):SourceCapture {
  const meta=sourceMetaSchema.parse(metadata)
  const capture=sourceCaptureSchema.parse({...meta,schemaVersion:'research-source-capture.v1',content,sha256:sha256Bytes(content)})
  verifySourceCapture(capture)
  return freeze(capture)
}
export function verifySourceCapture(input:unknown):SourceCapture {
  const capture=sourceCaptureSchema.parse(input)
  if(Buffer.byteLength(capture.content,'utf8')>1024*1024)throw new Error('SOURCE_TOO_LARGE')
  validateLocator(capture.locator)
  if(sha256Bytes(capture.content)!==capture.sha256)throw new Error('SOURCE_HASH_MISMATCH')
  if(capture.mediaType.includes('json')){try{JSON.parse(capture.content.replace(/^\uFEFF/u, ''))}catch{throw new Error('SOURCE_JSON_INVALID')}}
  return capture
}

/** Deterministic parsed text, not a claim of browser/CSS visibility. Scripts are never executed. */
export function capturedText(capture:SourceCapture):string {
  if(capture.mediaType==='text/plain')return capture.content
  if(capture.mediaType!=='text/html')throw new Error('SOURCE_SELECTOR_MEDIA_MISMATCH')
  const parts:string[]=[]
  const visit=(node:any):void=>{
    if(['script','style','template','head','noscript'].includes(node.tagName))return
    if(node.nodeName==='#text')parts.push(node.value)
    for(const child of node.childNodes??[])visit(child)
    if(['p','div','li','h1','h2','h3','br','tr','section','article'].includes(node.tagName))parts.push('\n')
  }
  visit(parse(capture.content))
  return parts.join('').replace(/\r\n?/gu,'\n')
}
export function assertSourceValue(input:unknown,rawSelector:unknown,expected:unknown):BoundEvidence {
  const capture=verifySourceCapture(input),selector=evidenceSelectorSchema.parse(rawSelector)
  if(capture.claimClass==='missing')throw new Error('SOURCE_EVIDENCE_MISSING')
  let selected:unknown
  if(selector.type==='json-pointer'){
    if(!capture.mediaType.includes('json'))throw new Error('SOURCE_SELECTOR_MEDIA_MISMATCH')
    selected=readJsonPointer(JSON.parse(capture.content.replace(/^\uFEFF/u, '')),selector.pointer)
  }else{
    const text=capturedText(capture),start=text.indexOf(selector.quote)
    if(start<0)throw new Error('SOURCE_QUOTE_MISSING')
    if(text.indexOf(selector.quote,start+1)>=0)throw new Error('SOURCE_QUOTE_AMBIGUOUS')
    selected=selector.quote
  }
  if(sha256CanonicalJson(selected)!==sha256CanonicalJson(expected))throw new Error('SOURCE_VALUE_MISMATCH')
  return freeze({sourceId:capture.sourceId,sourceHash:capture.sha256,selector,claimClass:capture.claimClass,
    observedAt:capture.observedAt,independentlyVerified:false as const,
    extractionMethod:selector.type==='json-pointer'?'json-pointer/exact-value':'parse5-or-utf8/unique-exact-quote'})
}
export async function captureWorkspaceSource(root:string,descriptor:SourceMetadata&{readonly path:string}):Promise<SourceCapture> {
  const capture=createSourceCapture(descriptor,await readResearchFile(root,descriptor.path,1024*1024))
  return freeze({...capture,intake:{method:'bounded-workspace-read.v1' as const,relativePath:descriptor.path.replaceAll('\\','/')}})
}
