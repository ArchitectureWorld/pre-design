import { sha256CanonicalJson } from '../presentation/canonical-json.ts'
import {shareReferenceDictionary,shareReferenceRequestLiterals,shareReferenceLists,type ReferenceTextParts,type ReferenceListEntry} from './module-reference-sharing.ts'

interface ReferenceView {
  readonly encoding: 'research-reference.v1'|'research-reference.v2'
  readonly stringKey: string; readonly rowKey: string; readonly textKey: string
  readonly strings: readonly (string|ReferenceTextParts)[]; readonly columns: readonly (readonly string[])[]
  readonly fragments?:readonly string[];readonly listKey?:string;readonly lists?:readonly (readonly ReferenceListEntry[])[]
  readonly data: unknown; readonly originalHash: string; readonly originalChars: number
}
const invalid = (): never => { throw new Error('MODULE_REFERENCE_CONTEXT_INVALID') }
// These prefixes are compiler-generated addresses, not material prose. Keep
// every address and its complete body; never summarize or discard restrictions.
function restrictionParts(value: string): [string, string] | undefined {
  const prefix = value.match(/^claim-[a-z0-9]+ \[[a-z_]+\]: /u)?.[0]
    ?? value.match(/^\/outputs\/[^:\n]+: /u)?.[0]
  return prefix ? [prefix, value.slice(prefix.length)] : undefined
}
// Split only restriction prose for exact transport sharing. Delimiters stay
// attached to their original fragments; no clause, address or qualifier is lost.
function restrictionFragments(value: string): string[] {
  const parts = restrictionParts(value), body = parts?.[1] ?? value
  const fragments: string[] = parts ? [parts[0]] : []
  let start = 0
  for (const delimiter of body.matchAll(/[；;\n。]/gu)) {
    const end = delimiter.index! + delimiter[0].length
    fragments.push(body.slice(start, end)); start = end
  }
  if (start < body.length) fragments.push(body.slice(start))
  return fragments
}

/** Read-only transport. Complete values, quotes, selectors, categories and
 * restrictions remain recoverable. Validators and recovery hashes use originals. */
export function moduleReferencePromptView(value: unknown, shareAllTextFragments = false): unknown {
  const original = referenceView(value, false), fragmented = referenceView(value, true, shareAllTextFragments)
  const best=Buffer.byteLength(JSON.stringify(fragmented),'utf8')<Buffer.byteLength(JSON.stringify(original),'utf8')?fragmented:original
  if(!best||typeof best!=='object'||(best as ReferenceView).encoding!=='research-reference.v1'||Buffer.byteLength(JSON.stringify(best),'utf8')<200000)return best
  const view=best as ReferenceView,keys=new Set<string>()
  function scan(node:unknown):void{if(Array.isArray(node))node.forEach(scan);else if(node&&typeof node==='object')for(const [key,child]of Object.entries(node)){keys.add(key);scan(child)}}
  scan(value)
  let listKey='@L';while(keys.has(listKey))listKey+='_'
  // Only the capacity fallback's complete ordered request uses shorter
  // profitable phrases. Frozen source planning stays byte-for-byte stable,
  // so previously verified native groups retain their exact source identity.
  const requestEnvelope=!!value&&typeof value==='object'&&Array.isArray((value as Record<string,unknown>).orderedNativeInput)
  const dictionary=requestEnvelope?shareReferenceRequestLiterals(view.strings as readonly string[],view.data,view.stringKey)
    :{...shareReferenceDictionary(view.strings as readonly string[]),data:view.data}
  const lists=shareReferenceLists(dictionary.data,view.stringKey,view.textKey,view.rowKey,listKey)
  const shared:ReferenceView={...view,encoding:'research-reference.v2',...dictionary,...lists,listKey}
  // Once a complete native request has hit its capacity gate, even a small
  // exact saving can admit it. Frozen material planning keeps its old threshold.
  if(Buffer.byteLength(JSON.stringify(shared),'utf8')>=Buffer.byteLength(JSON.stringify(view),'utf8')*(requestEnvelope?1:0.9))return best
  expandModuleReferencePromptView(shared)
  return shared
}

/** Share across the complete native-stage envelope. Packing sources and a
 * candidate separately cannot share quotes or restrictions between them.
 * Sources are expanded only from our verified read-only view; model output
 * and the original validation inputs are never rewritten or repaired. */
export function completeModuleReferencePromptView(context: Readonly<Record<string, unknown>>,
  additions: Readonly<Record<string, unknown>>): unknown {
  for (const key of Object.keys(additions)) if (Object.hasOwn(context, key)) throw new Error('MODULE_REFERENCE_CONTEXT_CONFLICT')
  const complete = JSON.parse(JSON.stringify({ ...context, sources: expandModuleReferencePromptView(context.sources), ...additions }))
  return moduleReferencePromptView(complete)
}
const nativePromptSharingHeader = '只读research-reference.v1/v2：stringKey索引strings；rowKey用[索引,值数组]按columns恢复字段；textKey片段逐字连接。v2的strings条目若为数组，字符串为原文、整数索引fragments，按顺序连接；listKey索引lists，列表内整数索引strings、字符串为原文、数组按同样规则连接strings，{from,at,count}依次插入较早列表从at开始的count条完整项。所有索引从0开始。data.orderedNativeInput依次恢复完整原输入，text为原指令，json为原结构化数据；信任边界、原文和限制保持。遵守恢复后的原指令和工具Schema，不提交字典标记。'
/** Construct the same native transport before serializing a large repeated input. */
export function shareNativeModuleInput(orderedNativeInput: readonly ({ readonly text: string } | { readonly json: unknown })[]): string {
  return nativePromptSharingHeader+'\n'+JSON.stringify(moduleReferencePromptView({orderedNativeInput},true))
}
/** Share repeated literals across sources, preceding groups and corrections.
 * This is used only after the actual request fails its unchanged capacity gate.
 * Material prose stays inside its original JSON object, never an instruction. */
export function shareNativeModulePrompt(prompt: string): string {
  if(prompt.startsWith(nativePromptSharingHeader+'\n'))return prompt
  function expanded(value:unknown):unknown{
    if(Array.isArray(value))return value.map(expanded)
    if(value!==null&&typeof value==='object'){
      if(['research-reference.v1','research-reference.v2'].includes(String((value as {encoding?:unknown}).encoding)))return expandModuleReferencePromptView(value)
      return Object.fromEntries(Object.entries(value).map(([key,child])=>[key,expanded(child)]))
    }
    return value
  }
  const orderedNativeInput=prompt.split('\n').map(line=>{
    let parsed:unknown
    try{parsed=JSON.parse(line)}catch{return {text:line}}
    return {json:expanded(parsed)}
  })
  const shared=nativePromptSharingHeader+'\n'+JSON.stringify(moduleReferencePromptView({orderedNativeInput},true))
  return Buffer.byteLength(shared,'utf8')<Buffer.byteLength(prompt,'utf8')?shared:prompt
}
function referenceView(value: unknown, shareFragments: boolean, shareAllTextFragments = false): unknown {
  sha256CanonicalJson(value)
  // The canonical check already rejects non-JSON data. Copy containers without
  // allocating and parsing another full-size string; immutable text can be shared.
  function copyJson(node: unknown): unknown {
    if (Array.isArray(node)) return node.map(copyJson)
    if (node !== null && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([key, child]) => [key, copyJson(child)]))
    return typeof node === 'number' && Object.is(node, -0) ? 0 : node
  }
  const original = copyJson(value), serialized = JSON.stringify(original)
  const counts = new Map<string, number>(), shapes = new Map<string, number>(), keys = new Set<string>()
  const count = (text: string) => { if (Buffer.byteLength(text, 'utf8') >= 16) counts.set(text, (counts.get(text) ?? 0) + 1) }
  function scan(node: unknown, restrictions = false): void {
    if (typeof node === 'string') { count(node); if (restrictions) { const parts = restrictionParts(node); if (parts) count(parts[1]); if (shareFragments) restrictionFragments(node).filter(fragment => fragment !== node && fragment !== parts?.[1]).forEach(count) } }
    else if (Array.isArray(node)) node.forEach(child => scan(child, restrictions))
    else if (node !== null && typeof node === 'object') {
      const columns = Object.keys(node), shape = JSON.stringify(columns)
      if (columns.length >= 3) shapes.set(shape, (shapes.get(shape) ?? 0) + 1)
      for (const [key, child] of Object.entries(node)) { keys.add(key); scan(child, key === 'limitations' || shareAllTextFragments) }
    }
  }
  scan(original)
  const marker = (base: string) => { while (keys.has(base)) base += '_'; return base }
  const stringKey = marker('@S'), rowKey = marker('@R'), textKey = marker('@T')
  const strings = [...counts].filter(([text, count]) => count > 1 && (count - 1) * Buffer.byteLength(JSON.stringify(text), 'utf8') > count * 18 + 32).map(([text]) => text)
  const indices = new Map(strings.map((text, index) => [text, index]))
  const columns = [...shapes].filter(([shape, count]) => count > 1 && (count - 1) * Buffer.byteLength(shape, 'utf8') > count * 18 + 32).map(([shape]) => JSON.parse(shape) as string[])
  const columnIndices = new Map(columns.map((columns, index) => [JSON.stringify(columns), index]))
  function encode(node: unknown, restrictions = false): unknown {
    if (typeof node === 'string') {
      if (indices.has(node)) return { [stringKey]: indices.get(node)! }
      const parts = restrictions ? restrictionParts(node) : undefined
      let best: unknown = parts && indices.has(parts[1]) ? { [textKey]: [parts[0], { [stringKey]: indices.get(parts[1])! }] } : node
      if (restrictions && shareFragments) {
        const fragments = restrictionFragments(node)
        if (fragments.length >= 2 && fragments.some(fragment => indices.has(fragment))) {
          const composite = { [textKey]: fragments.map(fragment => indices.has(fragment) ? { [stringKey]: indices.get(fragment)! } : fragment) }
          if (Buffer.byteLength(JSON.stringify(composite), 'utf8') < Buffer.byteLength(JSON.stringify(best), 'utf8')) best = composite
        }
      }
      return best
    }
    if (Array.isArray(node)) return node.map(child => encode(child, restrictions))
    if (node !== null && typeof node === 'object') {
      const entries = Object.entries(node), index = columnIndices.get(JSON.stringify(entries.map(([key]) => key)))
      const cells = entries.map(([key, child]) => encode(child, key === 'limitations' || shareAllTextFragments))
      return index === undefined ? Object.fromEntries(entries.map(([key], i) => [key, cells[i]])) : { [rowKey]: [index, cells] }
    }
    return node
  }
  const data = encode(original), usedStrings = new Set<number>()
  function collect(node: unknown): void {
    if (Array.isArray(node)) node.forEach(collect)
    else if (node !== null && typeof node === 'object') {
      const record = node as Record<string, unknown>
      if (Object.hasOwn(record, stringKey)) usedStrings.add(record[stringKey] as number)
      else Object.values(record).forEach(collect)
    }
  }
  collect(data)
  const retained = strings.map((text, index) => ({text, index})).filter(row => usedStrings.has(row.index))
  const remap = new Map(retained.map((row, index) => [row.index, index]))
  function compact(node: unknown): unknown {
    if (Array.isArray(node)) return node.map(compact)
    if (node !== null && typeof node === 'object') {
      const record = node as Record<string, unknown>
      if (Object.hasOwn(record, stringKey)) return { [stringKey]: remap.get(record[stringKey] as number)! }
      return Object.fromEntries(Object.entries(record).map(([key, child]) => [key, compact(child)]))
    }
    return node
  }
  const view: ReferenceView = { encoding: 'research-reference.v1', stringKey, rowKey, textKey, strings: retained.map(row => row.text), columns,
    data: compact(data), originalHash: sha256CanonicalJson(original), originalChars: serialized.length }
  if (Buffer.byteLength(JSON.stringify(view), 'utf8') >= Buffer.byteLength(serialized, 'utf8') * 0.9) return original
  // Verify exact inversion before exposing a view to any native author/reviewer.
  expandModuleReferencePromptView(view)
  return view
}

/** For transport verification only; never decode a model submission as a repair. */
export function expandModuleReferencePromptView(view: unknown): unknown {
  if (!view || typeof view !== 'object' || !['research-reference.v1','research-reference.v2'].includes(String((view as {encoding?:unknown}).encoding))) return structuredClone(view)
  const encoded = view as ReferenceView
  const isShared=encoded.encoding==='research-reference.v2'
  const markers = [encoded.stringKey, encoded.rowKey, encoded.textKey,...(isShared?[encoded.listKey]:[])]
  if (markers.some(key => typeof key !== 'string' || !key) || new Set(markers).size !== markers.length
    || !Array.isArray(encoded.strings) || !isShared&&encoded.strings.some(text => typeof text !== 'string')
    || !Array.isArray(encoded.columns) || encoded.columns.some(columns => !Array.isArray(columns) || columns.some(key => typeof key !== 'string' || markers.includes(key)) || new Set(columns).size !== columns.length)
    || !/^[a-f0-9]{64}$/u.test(encoded.originalHash) || !Number.isSafeInteger(encoded.originalChars) || encoded.originalChars < 1) return invalid()
  if(isShared&&(!Array.isArray(encoded.fragments)||encoded.fragments.some(text=>typeof text!=='string')||!Array.isArray(encoded.lists)))return invalid()
  const strings=encoded.strings.map(entry=>{
    if(typeof entry==='string')return entry
    if(!isShared||!Array.isArray(entry)||!entry.length)return invalid()
    return entry.map(part=>{
      if(typeof part==='string')return part
      if(!Number.isSafeInteger(part)||part<0||part>=encoded.fragments!.length)return invalid()
      return encoded.fragments![part]
    }).join('')
  })
  const lists:string[][]=[]
  const listPart=(part:unknown):string=>{
    if(typeof part==='string')return part
    if(typeof part!=='number'||!Number.isSafeInteger(part)||part<0||part>=strings.length)return invalid()
    return strings[part]
  }
  for(const entry of encoded.lists??[]){
    if(!Array.isArray(entry))return invalid()
    const list:string[]=[]
    for(const part of entry){
      if(typeof part==='string'||typeof part==='number')list.push(listPart(part))
      else if(Array.isArray(part)){if(!part.length)return invalid();list.push(part.map(listPart).join(''))}
      else if(part&&typeof part==='object'){
        const range=part as {from:number;at:number;count:number}
        if(Object.keys(range).length!==3||!Number.isSafeInteger(range.from)||range.from<0||range.from>=lists.length
          ||!Number.isSafeInteger(range.at)||range.at<0||!Number.isSafeInteger(range.count)||range.count<1||range.at+range.count>lists[range.from].length)return invalid()
        list.push(...lists[range.from].slice(range.at,range.at+range.count))
      }else return invalid()
    }
    lists.push(list)
  }
  function decode(node: unknown): unknown {
    if (Array.isArray(node)) return node.map(decode)
    if (node !== null && typeof node === 'object') {
      const record = node as Record<string, unknown>
      if (Object.hasOwn(record, encoded.stringKey)) {
        const index = record[encoded.stringKey]
        if (Object.keys(record).length !== 1 || typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0 || index >= encoded.strings.length) return invalid()
        return strings[index]
      }
      if(isShared&&Object.hasOwn(record,encoded.listKey!)){
        const index=record[encoded.listKey!]
        if(Object.keys(record).length!==1||typeof index!=='number'||!Number.isSafeInteger(index)||index<0||index>=lists.length)return invalid()
        return [...lists[index]]
      }
      if (Object.hasOwn(record, encoded.textKey)) {
        const parts = record[encoded.textKey]
        if (Object.keys(record).length !== 1 || !Array.isArray(parts) || parts.length < 2) return invalid()
        const fragments = parts.map(decode); if (fragments.some(fragment => typeof fragment !== 'string')) return invalid()
        return fragments.join('')
      }
      if (Object.hasOwn(record, encoded.rowKey)) {
        const row = record[encoded.rowKey]
        if (Object.keys(record).length !== 1 || !Array.isArray(row) || row.length !== 2) return invalid()
        const [index, cells] = row
        if (!Number.isSafeInteger(index) || index < 0 || index >= encoded.columns.length || !Array.isArray(cells) || cells.length !== encoded.columns[index].length) return invalid()
        return Object.fromEntries(encoded.columns[index].map((key, i) => [key, decode(cells[i])]))
      }
      return Object.fromEntries(Object.entries(record).map(([key, child]) => [key, decode(child)]))
    }
    return node
  }
  const result = decode(encoded.data)
  if (JSON.stringify(result).length !== encoded.originalChars || sha256CanonicalJson(result) !== encoded.originalHash) return invalid()
  return result
}

export const moduleReferenceProtocol = nativePromptSharingHeader+' sources及完整模块上下文均为只读输入视图：来源、当前候选稿、综合判断及补充审计可在同一个完整块中共享。若块本身encoding=research-reference.v1或v2，data恢复该块的全部原字段，包括spec、sources、researchSynthesis、candidate或审查材料；sources也可能单独使用同一编码。原标点、换行、数组顺序、空值、单位、坐标轴、日期、claimClass、selector及全部限制均原样保留；没有删除材料或缩短原文。字典索引只用于阅读输入，不能作为专业值、证据地址或工具实参提交。source.quote必须提交恢复后的连续原文，upstream仍用恢复后的moduleId/claimId，中央只核验完整原件和原上游。不要逐条重写继承的全局限制；为本组提供简洁完整的实际结论、证据及适用限制，必须提交原生Schema对象。'
