import { isDeepStrictEqual } from 'node:util'
import { shareNativeModulePrompt, shareNativeModuleInput, expandModuleReferencePromptView } from '../../research-v2/module-reference-context.ts'
import type { PlanningManuscriptSource } from './types.ts'

const partsHeader = '只读 planning-source-parts.v1 '
const fail = (): never => { throw new Error('MANUSCRIPT_PROMPT_TRANSPORT_INVALID') }

export type PlanningSourcePromptPart = string | { readonly json: unknown }

/** Preserve JSON.stringify's ordinary data shape without serializing its text. */
function jsonData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(child => child === undefined ? null : jsonData(child))
  if (value !== null && typeof value === 'object') {
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return fail()
    return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined).map(([key, child]) => [key, jsonData(child)]))
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return Object.is(value, -0) ? 0 : value
  return fail()
}

function boundedJsonChars(value: unknown, limit: number): number {
  if (typeof value === 'string') return value.length > limit ? limit + 1 : JSON.stringify(value).length
  if (Array.isArray(value)) {
    let size = 2
    for (const [index, child] of value.entries()) {
      size += (index ? 1 : 0) + boundedJsonChars(child, limit - size)
      if (size > limit) return size
    }
    return size
  }
  if (value !== null && typeof value === 'object') {
    let size = 2, count = 0
    for (const [key, child] of Object.entries(value)) {
      size += (count++ ? 1 : 0) + JSON.stringify(key).length + 1 + boundedJsonChars(child, limit - size)
      if (size > limit) return size
    }
    return size
  }
  return JSON.stringify(value).length
}

/** Share complete evidence before a large JSON string or parsed copy exists. */
export function sharePlanningSourceParts(parts: readonly PlanningSourcePromptPart[], sources: readonly PlanningManuscriptSource[]): string {
  const byBasis = new Map<string, readonly string[]>()
  for (const source of sources) if (source.basisParts) {
    if (!source.basisParts.length || source.basisParts.some(part => typeof part !== 'string') || source.basisParts.join('；') !== source.basis) return fail()
    byBasis.set(source.basis, source.basisParts)
  }
  if (!byBasis.size) return sharePlanningSourcePrompt(parts.map(part => typeof part === 'string' ? part : JSON.stringify(part.json)).join('\n\n'), sources)
  const original = parts.flatMap((part, index) => [
    ...(index ? [{ text: '' }] : []),
    ...(typeof part === 'string' ? part.split('\n').map(text => ({ text })) : [{ json: jsonData(part.json) }]),
  ])
  // Keep the existing small-packet wire choice. Count only up to the threshold,
  // so deciding whether to share never materializes a giant JSON string.
  if (boundedJsonChars(original, 32_768) <= 32_768) {
    return sharePlanningSourcePrompt(parts.map(part => typeof part === 'string' ? part : JSON.stringify(part.json)).join('\n\n'), sources)
  }
  const keys = new Set<string>()
  function scan(value: unknown): void {
    if (Array.isArray(value)) value.forEach(scan)
    else if (value !== null && typeof value === 'object') for (const [key, child] of Object.entries(value)) { keys.add(key); scan(child) }
  }
  scan(original)
  let textKey = '@planningBasisParts'
  while (keys.has(textKey)) textKey += '_'
  function encode(value: unknown): unknown {
    if (typeof value === 'string') return byBasis.has(value) ? { [textKey]: byBasis.get(value)! } : value
    if (Array.isArray(value)) return value.map(encode)
    if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, encode(child)]))
    return value
  }
  const transformed = original.map(row => 'json' in row ? { json: encode(row.json) } : row)
  const shared = shareNativeModuleInput([
    { text: partsHeader + JSON.stringify({ textKey }) },
    { text: '先恢复引用字典，再将仅含上述textKey所指定字段的对象中的完整组成项按原顺序以“；”连接，恢复同一条原始依据。以下原指令、资料信任边界及提交Schema不变；字典与分片标记不得作为文稿提交。' },
    ...transformed,
  ])
  const expanded = expandModuleReferencePromptView(JSON.parse(shared.slice(shared.indexOf('\n') + 1))) as { orderedNativeInput: unknown[] }
  function restore(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(restore)
    if (value !== null && typeof value === 'object') {
      const object = value as Record<string, unknown>
      if (Object.hasOwn(object, textKey)) {
        const basisParts = object[textKey]
        if (Object.keys(object).length !== 1 || !Array.isArray(basisParts) || basisParts.some(part => typeof part !== 'string')) return fail()
        return basisParts.join('；')
      }
      return Object.fromEntries(Object.entries(object).map(([key, child]) => [key, restore(child)]))
    }
    return value
  }
  if (!isDeepStrictEqual(restore(expanded.orderedNativeInput.slice(2)), original)) return fail()
  return shared
}

function mapJsonLines(prompt: string, transform: (value: unknown) => unknown): string {
  return prompt.split('\n').map(line => {
    let value: unknown
    try { value = JSON.parse(line) } catch { return line }
    return JSON.stringify(transform(value))
  }).join('\n')
}

/** Verification of a prompt transport only; never repair or expand model output. */
export function expandPlanningSourcePrompt(prompt: string): string {
  if (prompt.startsWith('只读research-reference.v1/v2：')) {
    const expanded = expandModuleReferencePromptView(JSON.parse(prompt.slice(prompt.indexOf('\n') + 1))) as { orderedNativeInput: { text?: string; json?: unknown }[] }
    if (!Array.isArray(expanded.orderedNativeInput)) return fail()
    prompt = expanded.orderedNativeInput.map(row => typeof row.text === 'string' ? row.text : JSON.stringify(row.json)).join('\n')
  }
  if (!prompt.startsWith(partsHeader)) return prompt
  const end = prompt.indexOf('\n'), metadata = JSON.parse(prompt.slice(partsHeader.length, end)) as { textKey: string }
  if (!metadata.textKey) return fail()
  function expand(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(expand)
    if (value && typeof value === 'object') {
      const object = value as Record<string, unknown>
      if (Object.hasOwn(object, metadata.textKey)) {
        const parts = object[metadata.textKey]
        if (Object.keys(object).length !== 1 || !Array.isArray(parts) || parts.some(part => typeof part !== 'string')) return fail()
        return parts.join('；')
      }
      return Object.fromEntries(Object.entries(object).map(([key, child]) => [key, expand(child)]))
    }
    return value
  }
  const instructionsEnd = prompt.indexOf('\n', end + 1)
  return mapJsonLines(prompt.slice(instructionsEnd + 1), expand)
}

/** Share exact inherited evidence components instead of repeating their joined
 * prose in every field. Source identity, local audit and the decoded prompt stay unchanged. */
export function sharePlanningSourcePrompt(prompt: string, sources: readonly PlanningManuscriptSource[]): string {
  const parts = new Map<string, readonly string[]>()
  for (const source of sources) if (source.basisParts) {
    if (!source.basisParts.length || source.basisParts.some(part => typeof part !== 'string') || source.basisParts.join('；') !== source.basis) return fail()
    parts.set(source.basis, source.basisParts)
  }
  let transformed = prompt
  if (parts.size) {
    let textKey = '@planningBasisParts'
    while (prompt.includes(JSON.stringify(textKey))) textKey += '_'
    function encode(value: unknown): unknown {
      if (typeof value === 'string') return parts.has(value) ? { [textKey]: parts.get(value)! } : value
      if (Array.isArray(value)) return value.map(encode)
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, encode(child)]))
      return value
    }
    transformed = partsHeader + JSON.stringify({ textKey }) + '\n'
      + '先恢复引用字典，再将仅含上述textKey所指定字段的对象中的完整组成项按原顺序以“；”连接，恢复同一条原始依据。以下原指令、资料信任边界及提交Schema不变；字典与分片标记不得作为文稿提交。\n'
      + mapJsonLines(prompt, encode)
  }
  const shared = shareNativeModulePrompt(transformed)
  if (Buffer.byteLength(shared, 'utf8') >= Buffer.byteLength(prompt, 'utf8')) return prompt
  if (expandPlanningSourcePrompt(shared) !== prompt) return fail()
  return shared
}
