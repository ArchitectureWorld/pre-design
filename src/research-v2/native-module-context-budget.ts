import type {ObjectJsonSchema} from '@deepseek-ai/dsh-tools'
import {compactNativeModuleSchema} from './native-schema-compaction.ts'
import {moduleReferencePromptView} from './module-reference-context.ts'
import {prepareNativeModuleJsonWire} from './native-submission-wire.ts'

export interface NativeModuleModelLimits {
  readonly contextWindow?: number
  readonly outputTokenLimit?: number
}

const positive = (value: number | undefined): value is number => Number.isSafeInteger(value) && value! > 0
const systemReserveTokens = 8192
const sourcePlanningReserveTokens = 32768
const imageReserveTokens = 8192
type PromptBlock = { readonly type: string; readonly text?: string }
const blockTokens = (blocks: readonly PromptBlock[]) => blocks.reduce((total, block) =>
  total + (block.type === 'image' ? imageReserveTokens : Buffer.byteLength(block.text ?? '', 'utf8')), 0)

export class NativeModuleContextBudgetError extends Error {
  constructor(detail: string) { super(`MODULE_MODEL_CONTEXT_BUDGET_EXCEEDED: ${detail}`) }
}

/** Catalog limits are tokens. UTF-8 bytes conservatively bound text tokens;
 * three bytes per UTF-16 code unit bound the slicer's character allocation.
 * Complete tool schema bytes are reserved before source selection.
 * Half the remaining input stays available for preceding groups,
 * the complete review candidate and corrections. Actual calls are checked too.
 * Unknown routes retain the existing bounded slice, never an invented limit. */
export function allocateModuleMaterialChars(limits: readonly NativeModuleModelLimits[], fixedContext: string,
  blocks: readonly PromptBlock[] = [], toolSchema = ''): number | undefined {
  const known = limits.filter(limit => positive(limit.contextWindow) && positive(limit.outputTokenLimit))
  if (!known.length) return undefined
  const capacities = known.map(limit => {
    const available = limit.contextWindow! - limit.outputTokenLimit! - Buffer.byteLength(fixedContext, 'utf8')
      - Buffer.byteLength(toolSchema, 'utf8') - blockTokens(blocks) - sourcePlanningReserveTokens
    if (available < 6) throw new NativeModuleContextBudgetError('configured output and fixed module context leave no source capacity')
    return Math.floor(available / 6)
  })
  const capacity = Math.min(...capacities)
  return known.length < limits.length && capacity >= 48000 ? undefined : capacity
}

/** Capacity retry; source selection and per-call admission stay independent. */
export function allocateModuleMaterialCharsForEquivalentSchemas(limits: readonly NativeModuleModelLimits[], fixedContext: string,
  blocks: readonly PromptBlock[], schemas: readonly ObjectJsonSchema[]): number | undefined {
  const largest=schemas.map(schema=>JSON.stringify(compactNativeModuleSchema(schema))).reduce((a,b)=>Buffer.byteLength(a,'utf8')>=Buffer.byteLength(b,'utf8')?a:b,'')
  return allocateModuleMaterialChars(limits,fixedContext,blocks,largest)
}

/** Last planning retry uses the same lossless complete-request codec as native
 * admission. Only transport bytes change; the original half-input allocation,
 * schema, image and correction reserves and unknown-route policy stay intact. */
export function allocateModuleMaterialCharsForSharedInput(limits: readonly NativeModuleModelLimits[], fixedInput: Readonly<Record<string,unknown>>,
  blocks: readonly PromptBlock[], schemas: readonly ObjectJsonSchema[]): number | undefined {
  const packet={orderedNativeInput:[{json:JSON.parse(JSON.stringify(fixedInput))}]}
  const fixedContext=JSON.stringify(moduleReferencePromptView(packet,true))
  return allocateModuleMaterialCharsForEquivalentSchemas(limits,fixedContext,blocks,schemas)
}

/** Last fallback reserves each complete hash-bound original schema in the
 * same lossless JSON transport used by actual requests. Keep the smaller
 * authorized allowance and the unchanged half-input and image reserves. */
export function allocateModuleMaterialCharsForSubmissionWire(limits:readonly NativeModuleModelLimits[],fixedInput:Readonly<Record<string,unknown>>,
 blocks:readonly PromptBlock[],schemas:readonly ObjectJsonSchema[]):number|undefined{
 const capacities=schemas.map(schema=>{
  const wire=prepareNativeModuleJsonWire(JSON.stringify(fixedInput),schema)
  return allocateModuleMaterialChars(limits,wire.prompt,blocks,JSON.stringify(wire.schema))
 }).filter((capacity):capacity is number=>capacity!==undefined)
 return capacities.length?Math.min(...capacities):undefined
}

/** The exact selected route is resolved again before every author, correction,
 * fallback and review. This estimate includes the complete tool schema and
 * image blocks; it does not set or reduce the provider's output/effort defaults. */
export function assertNativeModuleContext(limits: NativeModuleModelLimits, prompt: string, schema: string,
  blocks: readonly PromptBlock[]) {
  if (!positive(limits.contextWindow)) return undefined
  const outputReservedTokens = positive(limits.outputTokenLimit) ? limits.outputTokenLimit : Math.ceil(limits.contextWindow / 4)
  const estimatedInputTokens = Buffer.byteLength(prompt, 'utf8') + Buffer.byteLength(schema, 'utf8') + systemReserveTokens
    + blockTokens(blocks)
  if (estimatedInputTokens + outputReservedTokens > limits.contextWindow) {
    throw new NativeModuleContextBudgetError(`estimated input ${estimatedInputTokens} tokens plus reserved output ${outputReservedTokens} exceed route context ${limits.contextWindow}; split the task or supply a narrower complete source context`)
  }
  return { estimator: 'utf8-byte-upper-bound.v1', contextWindow: limits.contextWindow, outputReservedTokens,
    outputLimitKnown: positive(limits.outputTokenLimit), estimatedInputTokens }
}

/** A byte upper bound exceeding a token window does not prove exhaustion.
 * After a complete native synthesis and all lossless transport fallbacks, the
 * original provider may admit the independent review using its own tokenizer.
 * This records uncertainty; it never grants review acceptance or changes limits. */
export function nativeProviderReviewContext(limits:NativeModuleModelLimits,prompt:string,schema:string,blocks:readonly PromptBlock[]){
  if(!positive(limits.contextWindow)||!positive(limits.outputTokenLimit)
    ||limits.outputTokenLimit+systemReserveTokens>=limits.contextWindow)
    throw new NativeModuleContextBudgetError('configured output and system reservation leave no review input capacity')
  return {estimator:'utf8-byte-upper-bound.v1',contextWindow:limits.contextWindow,outputReservedTokens:limits.outputTokenLimit,
    outputLimitKnown:true,estimatedInputTokens:Buffer.byteLength(prompt,'utf8')+Buffer.byteLength(schema,'utf8')+systemReserveTokens+blockTokens(blocks),
    admission:'native-provider' as const,actualTokenCountKnown:false as const}
}
