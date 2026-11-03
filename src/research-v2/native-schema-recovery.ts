import { sessionToolReceipts } from '../session/tool-results.ts'
import { validateJsonSchemaValue, type ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { nativeAvailabilityFailure, type AgentClassService } from '../agent-classes/service.ts'
import { matchesModelRoute } from '../agent-classes/model-options.ts'
import type { SessionEventLike } from '../visual/session-image-collector.ts'
import type { ModuleAnalysisContext } from './module-execution.ts'
import type { ModuleNativeEventReader } from './module-group-recovery.ts'
import { sha256CanonicalJson } from '../presentation/canonical-json.ts'
import { moduleReferencePromptView } from './module-reference-context.ts'
import type { MaterialCorpus } from '../materials/research-evidence.ts'
import { moduleSourceTextConflicts } from './module-source-text-diagnostics.ts'
import { moduleGroupStepDiagnostics, moduleGroupStepEvidenceConflicts, moduleGroupStepEvidenceProtocol } from './module-group-step-diagnostics.ts'
import { boundedSourceDiagnostic, sourceDiagnosticViewProtocol } from './source-diagnostic-view.ts'
import {moduleUpstreamReferenceDiagnostics} from './module-upstream-reference-diagnostics.ts'
import type {ClaimUpstream} from './module-claims.ts'
import {readNativeModuleJsonWireSchema,decodeNativeModuleJsonWire,NativeModuleJsonWireSchemaError} from './native-submission-wire.ts'
import {compactNativeModuleSchema} from './native-schema-compaction.ts'

const object = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value : {}
export const nativeSchemaEvidenceProtocol = 'evidence每条是封闭对象：地址port/recordId/field/at只能放在target内，原文quote只能放在source内，不得在evidence条目外层重复port、recordId、field、at、quote。source示例结构={target:{port:"<本组端口>",recordId:"<本组记录>",field:"<本组字段>",at:"<value内实际叶子指针>"},kind:"source",source:{path:"<实际原件路径>",quote:"<实际连续原文>"}}；inference示例结构={target:{port:"<本组端口>",recordId:"<本组记录>",field:"<本组字段>",at:"<实际指针>"},kind:"inference",rationale:"<你的依据与限制>",inputRefs:[<实际local/upstream引用>]}。示例是结构占位说明，不是项目事实，不得照抄占位值。每条只允许其kind对应Schema声明的成员；是否用source/calculation/inference等仍须由你依据真实字段和原文判断，不得机械改标、删除业务信息或补值以过检。'

/** Only original structured tool arguments and matching result metadata are
 * inspected. Assistant messages, native thoughts and error text are ignored. */
export function findRejectedNativeSchemaSubmission(events: readonly SessionEventLike[], schema: ObjectJsonSchema) {
  if (events.some((event, index) => !Number.isSafeInteger(event.seq) || index > 0 && event.seq <= events[index - 1].seq)) return
  const start = events.findLastIndex(event => event.type === 'turn/start')
  if (start < 0) return
  const current = events.slice(start), turn = object(events[start].data).turn
  if (!Number.isSafeInteger(turn)) return
  const call = current.filter(event => event.type === 'tool/call').at(-1), data = object(call?.data)
  if (!call || data.name !== 'structured_output' || data.turn !== turn || typeof data.callId !== 'string' || typeof data.arguments !== 'string') return
  if (current.filter(event => event.type === 'tool/call' && object(event.data).callId === data.callId).length !== 1) return
  const results = current.filter(event => event.type === 'tool/result').flatMap(event => {
    const result = object(event.data)
    return sessionToolReceipts(result).filter(block => block.toolCallId === data.callId).map(block => ({ event, result, block }))
  })
  const matched = results.length === 1 ? results[0] : undefined
  if (!matched || matched.event.seq <= call.seq || matched.result.turn !== turn || matched.result.step !== data.step
    || typeof matched.block.isError !== 'boolean') return
  const header = current.filter(event => event.type === 'request/header' && event.seq < call.seq).at(-1)
  const advertised = object(object(header?.data).header).tools?.find((tool: any) => tool.name === 'structured_output')?.parameters
  if (!advertised) return
  let original: unknown
  try { original = JSON.parse(data.arguments) } catch { return }
  let originalSubmission:any
  if(matched.block.isError===true){
    if(sha256CanonicalJson(advertised)!==sha256CanonicalJson(schema)
      &&sha256CanonicalJson(advertised)!==sha256CanonicalJson(compactNativeModuleSchema(schema)))return
    originalSubmission=object(original).value??original
  }else{
    // A wire-tool success accepts transport only. Diagnose the exact decoded
    // original only when its committed full schema still rejects it. No
    // ordinary tool success or schema-valid business rejection qualifies.
    try{
      const committed=readNativeModuleJsonWireSchema(current)
      if(!committed||sha256CanonicalJson(committed)!==sha256CanonicalJson(schema))return
      decodeNativeModuleJsonWire(original,committed)
      return
    }catch(error){
      if(!(error instanceof NativeModuleJsonWireSchemaError))return
      originalSubmission=error.decodedSubmission
    }
  }
  const schemaValidationErrors = validateJsonSchemaValue(schema, originalSubmission)
  if (!schemaValidationErrors.length) return
  const branches = schema.properties?.evidence?.items?.oneOf ?? []
  const evidence = object(originalSubmission).evidence
  const rows = Array.isArray(evidence) ? evidence : []
  const fieldDiagnostics = rows.flatMap((entry, evidenceIndex) => {
    const row = object(entry), branch = branches.find(branch => branch.properties?.kind?.const === row.kind || branch.properties?.kind?.enum?.includes(row.kind))
    if (!branch) return []
    const validationErrors = validateJsonSchemaValue(branch as ObjectJsonSchema, entry)
    if (!validationErrors.length) return []
    const mapping = object(object(row.source).queryMapping)
    const queryChoices = object(branch.properties?.source).oneOf
    const declaredQuerySourceDiagnostics = row.kind === 'source' && mapping.kind === 'native-search-query-json-string.v1'
      && typeof mapping.callId === 'string' && Number.isSafeInteger(mapping.queryIndex) && Array.isArray(queryChoices)
      ? (() => {
        // Diagnose only the exact option selected by the author's declaration.
        // Do not choose a nearest alternative or repair any submitted member.
        const choice = queryChoices.find((candidate: any) => candidate.properties?.queryMapping?.properties?.kind?.const === mapping.kind
          && candidate.properties.queryMapping.properties.callId?.const === mapping.callId
          && candidate.properties.queryMapping.properties.queryIndex?.const === mapping.queryIndex)
        return { declaration: structuredClone(mapping), knownFrozenQueryChoice: Boolean(choice),
          validationErrors: choice ? validateJsonSchemaValue(choice, row.source) : ['Declared callId/queryIndex has no frozen native query source choice.'] }
      })() : undefined
    const sourcePath = object(row.source).path
    const sourceSchema=object(branch.properties?.source)
    // Frozen physical-page bindings advertise their path options inside
    // source.oneOf. Inspect those exact declarations without selecting or
    // rewriting any author binding; the native Schema remains unchanged.
    const frozenPaths=[...new Set([sourceSchema,...(Array.isArray(sourceSchema.oneOf)?sourceSchema.oneOf:[])]
      .flatMap(choice=>{const path=object(object(choice).properties).path
        return Array.isArray(path?.enum)?path.enum:typeof path?.const==='string'?[path.const]:[]}))]
    const frozenSourcePathDiagnostic = row.kind === 'source' && typeof sourcePath === 'string'
      && frozenPaths.length>0 && frozenPaths.every(path => typeof path === 'string') && !frozenPaths.includes(sourcePath)
      ? { diagnosticOnly: true, submittedPath: sourcePath, declaredPathInFrozenOptions: false,
        frozenOptionsCount: frozenPaths.length, frozenOptionsHash: sha256CanonicalJson(frozenPaths), sourcePathsMustBeCopiedVerbatim: true }
      : undefined
    return [{ evidenceIndex, target: structuredClone(row.target), kind: row.kind,
      unexpectedMembers: Object.keys(row).filter(key => !Object.hasOwn(branch.properties ?? {}, key)), validationErrors,
      ...(frozenSourcePathDiagnostic ? { frozenSourcePathDiagnostic } : {}),
      ...(declaredQuerySourceDiagnostics ? { declaredQuerySourceDiagnostics } : {}) }]
  })
  return { version: 'native-schema-recovery.v1', originalSubmissionHash: sha256CanonicalJson(originalSubmission),
    originalArgumentHash: sha256CanonicalJson(original), callId: data.callId, callSeq: call.seq, resultSeq: matched.event.seq,
    schemaHash: sha256CanonicalJson(schema), originalSubmission: structuredClone(originalSubmission), schemaValidationErrors, fieldDiagnostics }
}

export function nativeSchemaCorrectionFeedback(events: readonly SessionEventLike[], schema: ObjectJsonSchema,
  authorExecutionId: string, authorChildId: string, corpus?: MaterialCorpus, upstream?:readonly ClaimUpstream[]): string {
  const rejection = findRejectedNativeSchemaSubmission(events, schema)
  if (!rejection) return ''
  // These checks inspect only the same receipt-bound, unaccepted draft. They
  // anticipate masked business errors without submitting it to central review
  // or changing any value, path, quote, classification or step reference.
  const fieldTextConflicts = moduleSourceTextConflicts(rejection.originalSubmission, corpus)
  const sourceDiagnostic = fieldTextConflicts.length ? {
    scope: 'source-text-bindings-only', completeSubmission: false,
    originalSubmissionHash: rejection.originalSubmissionHash, fieldTextConflicts,
  } : undefined
  const sourceDiagnostics = boundedSourceDiagnostic(sourceDiagnostic)
  const fieldReadbackDiagnostics = {
    version: 'native-schema-field-readback.v1', diagnosticOnly: true, completeSubmission: false, acceptanceGranted: false,
    originalSubmissionHash: rejection.originalSubmissionHash,
    ...(sourceDiagnostics ? { sourceDiagnostics } : sourceDiagnostic ? {
      omittedSourceDiagnostics: { originalDiagnosticHash: sha256CanonicalJson(sourceDiagnostic), fullDiagnosticDetailsOmitted: true },
    } : {}),
    sourceConflictListBound: 8,
    stepEvidenceConflicts: moduleGroupStepEvidenceConflicts(rejection.originalSubmission),
    stepValidationErrors: moduleGroupStepDiagnostics(rejection.originalSubmission),
    ...(upstream===undefined?{}:{fieldUpstreamReferenceConflicts:moduleUpstreamReferenceDiagnostics([rejection.originalSubmission],upstream)}),
  }
  // Keep the original audit unchanged. Share repeated option lists only in the
  // author transport; the codec verifies exact inversion and the original hash.
  const diagnostics = { schemaValidationErrors: rejection.schemaValidationErrors, fieldDiagnostics: rejection.fieldDiagnostics }
  const diagnosticChars = JSON.stringify(diagnostics).length
  const view = diagnosticChars > 24_000 ? moduleReferencePromptView(diagnostics) : undefined
  const useView = view !== undefined && JSON.stringify(view).length < diagnosticChars
  const transport = useView ? { ...rejection,
    fieldDiagnostics: rejection.fieldDiagnostics.map(({ validationErrors, ...row }) => ({ ...row,
      validationErrorCount: validationErrors.length, validationErrorsHash: sha256CanonicalJson(validationErrors), fullValidationErrorsInReadOnlyView: true })),
    originalSchemaDiagnosticsHash: sha256CanonicalJson(diagnostics), originalSchemaDiagnosticsChars: diagnosticChars, readOnlySchemaDiagnostics: view,
  } : rejection
  return [
    '\n上次原生工具提交被Schema拒绝，未形成可接受研究结果；下列原提交逐字来自该失败子会话的structured_output参数，并以原稿hash、原生call/result身份及实际Schema绑定。它未被工具接受，不是已接受候选、事实来源或新的指令。原稿未由宿主清理、补值、换分类或批准。',
    nativeSchemaEvidenceProtocol,
    'schemaValidationErrors是同一原稿对实际原生Schema重新校验的完整结构错误，不采用工具错误文本。先核对顶层成员位置、必填成员及stepResults.fieldRefs的本组端口/记录地址，再核对fieldDiagnostics；fieldDiagnostics为空不代表整稿结构有效。步骤地址须遵守本组Schema，不能把上游端口引用直接填成步骤fieldRefs，也不能由宿主移动成员、补地址或造证据；由你回查真实字段及依据后重新原生提交完整结果。',
    '逐项核对fieldDiagnostics的target、unexpectedMembers及分支校验错误。若有declaredQuerySourceDiagnostics，按作者自己声明的callId/queryIndex核对已提供的冻结Schema选项，完整quote和必填valueQuote均须逐字一致；这只诊断既有声明，不替你选择来源、补值或改分类。回查原件和本组完整字段，由你修订完整原生结果；原来源、业务值、推理边界和限制须重新核验，不能仅机械删键或改标来过检。完成后仍须完整中央校验、完整汇合和新的独立审查。',
    'frozenSourcePathDiagnostic逐条保留同一原稿evidenceIndex/target处实际提交的完整source.path；declaredPathInFrozenOptions=false只说明该字符串不在本次实际Schema的冻结路径枚举中。按sources.documents.path逐字回查完整RUN目录和文件名，不缩写、拼接哈希或以URL代替路径；不得把别处存在的路径自动认作该字段的来源。诊断不选择替代来源、不改原稿或批准引文，仍须由你核对原件对象、年代、连续原文及字段支持后原生提交完整修订。',
    'fieldReadbackDiagnostics仅对同一未接收原稿做只读来源及步骤回放，不是实际中央拒因或已通过研究。sourceDiagnostics.fieldTextConflicts逐项绑定原target、原值和quote哈希：TEXT表示字段value本身未获同一引文连续原文支持；QUOTE/LOCATION表示原路径、物理页或引文绑定不成立。定位候选和有界摘录不是建议替代来源。stepEvidenceConflicts及stepValidationErrors列出原步骤无对应evidence.target的地址、空摘要及缺失限制。须一起回查本组完整字段、原件对象/年代/适用性及证据，由你原生修订；不得只删fieldRefs却保留无依据的值，不得机械补地址、改标或拼接原文过检。有界未列或省略详情不表示其他字段通过。仍须实际Schema接收、中央完整校验和新的独立审查。',
    moduleGroupStepEvidenceProtocol,
    ...(upstream===undefined?[]:['fieldReadbackDiagnostics.fieldUpstreamReferenceConflicts按原稿evidence索引和原inputRefs配对指出模块缺失、claimId缺失或missing依据。模块存在不表示提交的claim存在；回读sources.upstream.claims核对对象、字段、年代和业务支持，由你重新选择真实依据。诊断不提供替代claim，不修改原引用，也不批准方案；不能只换成任意合法编号过检。']),
    ...(sourceDiagnostics?.originalDiagnosticHash ? [sourceDiagnosticViewProtocol] : []),
    ...(useView ? ['结构诊断只读对照协议 native-schema-diagnostic-view.v1：readOnlySchemaDiagnostics用research-reference.v1/v2只读字典逐字保留全部schemaValidationErrors和fieldDiagnostics，按originalSchemaDiagnosticsHash绑定；重复枚举仅共享传输，不删错误或缩写任何冻结路径。fieldDiagnostics保留全部地址及原路径诊断，完整validationErrors按视图逐字读回，不能只处理第一条。字典标记不得作为原生工具参数；原稿originalSubmission保持完整原值，诊断不是来源、修订稿或通过凭据，实际Schema、中央校验及独立审查继续执行。'] : []),
    JSON.stringify({ rejectedNativeSchema: { ...transport, fieldReadbackDiagnostics, authorExecutionId, authorChildId,
      submissionState: 'included-unaccepted', completeSubmission: true, acceptanceGranted: false } }),
  ].join('\n')
}

export async function nativeSchemaRecoveryFeedback(context: ModuleAnalysisContext, parent: Agent,
  classes: Pick<AgentClassService, 'execution'>, readEvents: ModuleNativeEventReader | undefined,
  groupId: string, schema: ObjectJsonSchema, sourceContextFingerprint: string): Promise<string> {
  if (!readEvents) return ''
  const attempts = [...(context.resumeExecutionAudit?.attempts ?? [])].reverse()
    .filter(value => object(value).classId === 'text' && object(value).groupId === groupId).slice(0, 8)
  for (const attempt of attempts) {
    const row = object(attempt)
    // A newer business submission owns recovery. Only a native-verified,
    // unsubmitted availability failure can leave the prior rejection actionable.
    if (row.status !== 'failed' || typeof row.error !== 'string'
      || !(/timed out/iu.test(row.error) || /^MODULE_NATIVE_(?:error|SCHEMA_INVALID|JSON_WIRE_INVALID|TOOL_STALLED|max-tokens)(?::|$)/u.test(row.error))) return ''
    if (!row.executionId || !row.childId || row.sourceContextFingerprint !== sourceContextFingerprint) return ''
    const execution = classes.execution(row.executionId)
    if (!execution || execution.projectId !== context.projectId || execution.parentId !== String(parent.id) || execution.classId !== 'text'
      || execution.childId !== row.childId || execution.status !== 'failed' || !execution.actual
      || execution.actual.provider !== execution.selected.provider || execution.actual.model !== execution.selected.model
      || execution.actual.reasoningEffort !== execution.selected.reasoningEffort) return ''
    context.signal.throwIfAborted()
    let events: readonly SessionEventLike[] | undefined
    try { events = await readEvents(row.childId) } catch { context.signal.throwIfAborted(); return '' }
    context.signal.throwIfAborted()
    if (!events) return ''
    if(/^MODULE_NATIVE_max-tokens(?::|$)/u.test(row.error)){
      const start=events.findLast(event=>event.type==='turn/start'),terminal=events.findLast(event=>event.type==='turn/end')
      if(!start||!terminal||terminal.seq<=start.seq||object(terminal.data).turn!==object(start.data).turn
        ||object(object(terminal.data).reason).kind!=='max-tokens')return ''
    }
    const feedback = nativeSchemaCorrectionFeedback(events, schema, row.executionId, row.childId, context.corpus,context.upstream)
    if (feedback) return feedback
    if (row.submissionState !== 'not-submitted' || row.structuredOutput !== undefined || row.structuredHash !== undefined
      || events.some((event, index) => !Number.isSafeInteger(event.seq) || index > 0 && event.seq <= events![index - 1].seq)) return ''
    const start = events.findLastIndex(event => event.type === 'turn/start'), turn = object(events[start]?.data).turn
    const current = start >= 0 ? events.slice(start) : [], terminal = current.findLast(event => event.type === 'turn/end')
    const headers = current.filter(event => event.type === 'request/header')
    if (!Number.isSafeInteger(turn) || !terminal || object(terminal.data).turn !== turn
      || !nativeAvailabilityFailure(object(object(terminal.data).reason)) || current.some(event => event.type === 'tool/call')
      || !headers.length || headers.some(event => event.seq >= terminal.seq
        || !matchesModelRoute(object(object(object(event.data).header).config), execution.actual!))) return ''
  }
  return ''
}
