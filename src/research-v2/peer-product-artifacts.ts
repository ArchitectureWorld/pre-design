import { createHash } from 'node:crypto'
import { sha256CanonicalJson as hash } from '../presentation/canonical-json.ts'
import { getModuleFieldContracts } from './module-contracts.ts'
import { moduleReferencePromptView, expandModuleReferencePromptView } from './module-reference-context.ts'
import type { ModuleClaim, ModuleSourceValue } from './module-claims.ts'

interface Candidate { readonly outputs: Record<string, unknown>; readonly claims: readonly ModuleClaim[]; readonly sourceValues?: readonly ModuleSourceValue[]; readonly steps?: unknown }
interface Field { value: unknown; claimClass: string; claimRefs: string[]; limitations: string[]; notApplicableReason?: string }
type Row = Record<string, Field> & { recordId: string }
export interface PeerProductArtifactAudit {
  readonly version: 'native-peer-product-artifacts.v1'; readonly candidateHash: string; readonly publicationGranted: false
  readonly cells: readonly { recordId: string; field: string; selector: string; value: unknown; claimClass: string;
    claimRefs: readonly string[]; sourceIds: readonly string[]; unresolvedRefs: readonly unknown[]; limitations: readonly string[] }[]
  readonly artifacts: readonly { artifactId: string; state: 'produced_limited' | 'omitted'; reason: string;
    renditions: readonly { path: string; sha256: string }[] }[]
  readonly files: Readonly<Record<string, string>>
}
const escape = (value: unknown): string => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;')
  .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;')
const bytesHash = (value: string) => createHash('sha256').update(value).digest('hex')
const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n'
const page = (title: string, content: string, candidateHash: string) => '<!doctype html><html lang="zh-CN"><meta charset="utf-8">'
  + '<meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escape(title)+'</title>'
  + '<style>body{font:15px/1.6 sans-serif;color:#172b32;background:#fff;margin:24px}table{border-collapse:collapse}th,td{border:1px solid #ccd4d8;padding:10px;vertical-align:top;min-width:140px;max-width:400px;overflow-wrap:anywhere}th{background:#eef3f3}small{display:block;color:#5a666d}.scroll{overflow:auto}</style>'
  + '<h1>'+escape(title)+'</h1><p>冻结原生作者字段的研究视图。未核、研究选择与来源陈述保留原分类；生成图表不代表研究或发布通过。</p>'
  + '<p>快照 '+escape(candidateHash)+'</p><div class="scroll">'+content+'</div></html>\n'

/** Renditions of the centrally checked native candidate; no business authoring,
 * synthetic inventory, classification, prices or denominators. */
export function buildPeerProductArtifacts(candidate: Candidate): PeerProductArtifactAudit {
  const port = candidate.outputs.peer_products as { records: Row[] }
  if (!port || !Array.isArray(port.records)) throw new Error('MODULE_PEER_ARTIFACT_INPUT_INVALID')
  const rows = port.records, fields = getModuleFieldContracts('3.05').ports.peer_products.fields
  const candidateHash = hash(candidate), claims = new Map(candidate.claims.map(claim => [claim.claimId, claim]))
  const sources = new Map((candidate.sourceValues ?? []).map(source => [source.sourceId, source]))
  const cells: PeerProductArtifactAudit['cells'][number][] = []
  for (const [index, row] of rows.entries()) for (const field of fields) {
    const value = row[field.name]
    if (!value || !Array.isArray(value.claimRefs)) throw new Error('MODULE_PEER_ARTIFACT_INPUT_INVALID')
    const sourceIds = new Set<string>(), seen = new Set<string>(), unresolvedRefs: unknown[] = []
    const visit = (id: string) => {
      if (seen.has(id)) return
      seen.add(id)
      const claim = claims.get(id)
      if (!claim) { unresolvedRefs.push({ claimId: id }); return }
      if (claim.sourceId) { if (sources.has(claim.sourceId)) sourceIds.add(claim.sourceId); else unresolvedRefs.push({ sourceId: claim.sourceId }) }
      for (const ref of [...(claim.inputRefs ?? []), ...(claim.calculation?.operands ?? []), ...(claim.calculation?.weights ?? [])]) {
        if ('sourceId' in ref) { if (sources.has(ref.sourceId)) sourceIds.add(ref.sourceId); else unresolvedRefs.push(ref) }
        else if ('claimId' in ref) { if (ref.moduleId) unresolvedRefs.push(ref); else visit(ref.claimId) }
      }
    }
    value.claimRefs.forEach(visit)
    cells.push({ recordId: row.recordId, field: field.name, selector: `/outputs/peer_products/records/${index}/${field.name}/value`,
      value: structuredClone(value.value), claimClass: value.claimClass, claimRefs: [...value.claimRefs], sourceIds: [...sourceIds],
      unresolvedRefs, limitations: [...value.limitations, ...(value.notApplicableReason ? [value.notApplicableReason] : [])] })
  }
  const display = (field: Field) => field.value === null ? field.claimClass === 'missing' ? '未核' : 'N/A'
    : typeof field.value === 'string' ? field.value : JSON.stringify(field.value)
  const table = '<table><thead><tr><th>记录ID</th>'+fields.map(field=>'<th>'+escape(field.sourceLabel)+'</th>').join('')+'</tr></thead><tbody>'
    + rows.map((row,index)=>'<tr><th>'+escape(row.recordId)+'</th>'+fields.map((field,fieldIndex)=>{
      const cell=cells[index*fields.length+fieldIndex], value=row[field.name]
      return '<td data-selector="'+escape(cell.selector)+'" data-claim-refs="'+escape(json(cell.claimRefs).trim())+'">'
        + escape(display(value))+'<small>'+escape(value.claimClass)+'</small><small>'+cell.limitations.map(escape).join('；')+'</small>'
        + '<small>'+cell.claimRefs.map(escape).join('、')+'</small></td>'
    }).join('')+'</tr>').join('')+'</tbody></table>'
  const files: Record<string,string> = {
    'items/3.05/peer-offers.json': json(port),
    'items/3.05/analysis-trace.json': json({ candidateHash, cells, claims: candidate.claims, sourceValues: candidate.sourceValues ?? [] }),
    'items/3.05/TAB-3.05.html': page('竞品定位—业态—价格矩阵',table,candidateHash),
  }
  const artifact = (artifactId: string, paths: string[], reason: string): PeerProductArtifactAudit['artifacts'][number] => ({
    artifactId, state: paths.length ? 'produced_limited' : 'omitted', reason,
    renditions: paths.map(path=>({path,sha256:bytesHash(files[path])})),
  })
  const formats = [...new Set(rows.flatMap(row=>typeof row.formatId.value === 'string' && row.formatId.value.trim() ? [row.formatId.value] : []))]
  const peerIds = [...new Set(rows.flatMap(row=>typeof row.peerId.value === 'string' ? [row.peerId.value] : []))]
  if (formats.length) {
    const matrix = '<table><thead><tr><th>peer_ID / 原生分类</th>'+formats.map(format=>'<th>'+escape(format)+'</th>').join('')+'</tr></thead><tbody>'
      + peerIds.map(id=>'<tr><th>'+escape(id)+'</th>'+formats.map(format=>{
        const matches=rows.map((row,index)=>({row,index})).filter(({row})=>row.peerId.value===id&&row.formatId.value===format)
        return '<td>'+ (matches.length ? matches.map(({row,index})=>'<div data-record-id="'+escape(row.recordId)+'" data-selector="/outputs/peer_products/records/'+index+'/coreProduct/value">'
          +escape(display(row.coreProduct))+'<small>状态：'+escape(display(row.status))+'；分类：'+escape(row.formatId.claimClass)+'</small><small>'
          +[...row.coreProduct.limitations,...row.status.limitations,...row.classificationBasis.limitations].map(escape).join('；')+'</small></div>').join('')
          : '未核<small>此冻结记录集中没有可对应条目，不表示无供给或零占比。</small>')+'</td>'
      }).join('')+'</tr>').join('')+'</tbody></table>'
    files['items/3.05/FIG-3.05-01.html']=page('竞品产品与业态组合图',matrix,candidateHash)
  }
  return { version: 'native-peer-product-artifacts.v1', candidateHash, publicationGranted: false, cells,
    artifacts: [artifact('TAB-3.05',['items/3.05/peer-offers.json','items/3.05/analysis-trace.json','items/3.05/TAB-3.05.html'],'原生字段逐格展示，缺失及来源分类保留；尚待独立审查。'),
      artifact('FIG-3.05-01',formats.length?['items/3.05/FIG-3.05-01.html']:[],formats.length?'仅原生作者声明的业态分类与状态，不计算营业比例；分类及对象对应仍须独审。':'原生候选未提供可对应的业态分类，不能编造统一分类或配比。'),
      artifact('FIG-3.05-02',[],'尚未执行有依据的同规格价格篮子与区间计算；不从缺失价格生成图或补成交均价。')], files }
}

export function verifyPeerProductArtifacts(candidate: Candidate, audit: unknown): void {
  if (hash(buildPeerProductArtifacts(candidate)) !== hash(audit)) throw new Error('MODULE_PEER_ARTIFACT_MISMATCH')
}

interface PeerProductReviewContext {
  readonly authorGroupsHash: string; readonly authorGroupStates: readonly unknown[]
  readonly candidateHash: string; readonly candidate: unknown; readonly peerProductArtifacts: PeerProductArtifactAudit
}
interface PeerProductReviewView {
  readonly encoding: 'native-peer-review-context.v1'; readonly originalHash: string; readonly data: unknown
}
const reviewContextInvalid = (): never => { throw new Error('MODULE_PEER_REVIEW_CONTEXT_INVALID') }
function originalGroupStepText(value: PeerProductReviewContext, step: unknown) {
  if (![1, 2, 3, 4].includes(step as number) || !value.authorGroupStates.length) return undefined
  const entries = value.authorGroupStates.map(state => {
    const group = state as { groupId?: unknown; steps?: readonly { step: number; summary: string; limitations: readonly string[] }[];
      stepResults?: Record<string, { summary: string; limitations: readonly string[] }> }
    const entry = Array.isArray(group.steps) ? group.steps.find(entry => entry.step === step) : group.stepResults?.['step'+String(step)]
    if (typeof group.groupId !== 'string' || typeof entry?.summary !== 'string' || !Array.isArray(entry.limitations)
      || entry.limitations.some((limit: unknown) => typeof limit !== 'string')) return undefined
    return { ...entry, groupId: group.groupId }
  })
  if (entries.some(entry => !entry)) return undefined
  return { summary: entries.map(entry => `[${entry!.groupId}] ${entry!.summary}`).join('\n'),
    limitations: [...new Set(entries.flatMap(entry => entry!.limitations))] }
}
function reviewCandidateSteps(value: PeerProductReviewContext, restore: boolean): unknown {
  const candidate = value.candidate as Candidate
  if (!Array.isArray(candidate.steps)) return candidate
  return { ...candidate, steps: candidate.steps.map((step: Record<string, unknown>) => {
    const original = originalGroupStepText(value, step.step), result = { ...step }
    for (const field of ['summary', 'limitations'] as const) {
      const encoding = field === 'summary' ? 'native-group-step-summary.v1' : 'native-group-step-limits.v1'
      if (!restore) {
        if (original && json(step[field]) === json(original[field])) result[field] = { encoding, step: step.step }
      } else if (step[field] && typeof step[field] === 'object' && !Array.isArray(step[field])) {
        const descriptor = step[field] as { encoding?: string; step?: unknown }
        if (!original || Object.keys(descriptor).length !== 2 || descriptor.encoding !== encoding || descriptor.step !== step.step) return reviewContextInvalid()
        result[field] = original[field]
      }
    }
    return result
  }) }
}

/** Exact review transport only. Pretty JSON renditions duplicate the candidate
 * and trace as escaped strings. Expose their full parsed values to the shared
 * dictionary and declare the exact formatter; HTML stays literal. Nothing in
 * the candidate, archived files, review schema or their binding hashes changes. */
export function peerProductReviewPromptView(value: PeerProductReviewContext): PeerProductReviewView {
  const candidate = value.candidate as Candidate
  const files = Object.fromEntries(Object.entries(value.peerProductArtifacts.files).map(([path, content]) => {
    if (path.endsWith('.json')) {
      try {
        const parsed: unknown = JSON.parse(content)
        if (path === 'items/3.05/peer-offers.json' && json(candidate.outputs.peer_products) === content) {
          return [path, { encoding: 'json-pretty-2-newline-ref.v1', pointer: '/candidate/outputs/peer_products' }]
        }
        if (path === 'items/3.05/analysis-trace.json' && json({ candidateHash: value.candidateHash,
          cells: value.peerProductArtifacts.cells, claims: candidate.claims, sourceValues: candidate.sourceValues ?? [] }) === content) {
          return [path, { encoding: 'json-pretty-2-newline-template.v1', entries: [
            ['candidateHash', { pointer: '/candidateHash' }], ['cells', { pointer: '/peerProductArtifacts/cells' }],
            ['claims', { pointer: '/candidate/claims' }], ['sourceValues', candidate.sourceValues === undefined ? { value: [] } : { pointer: '/candidate/sourceValues' }],
          ] }]
        }
        if (json(parsed) === content) return [path, { encoding: 'json-pretty-2-newline.v1', value: parsed }]
      } catch { /* Preserve arbitrary file bytes without reinterpretation. */ }
    }
    return [path, content]
  }))
  const view: PeerProductReviewView = { encoding: 'native-peer-review-context.v1', originalHash: hash(value),
    data: moduleReferencePromptView({ ...value, candidate: reviewCandidateSteps(value, false), peerProductArtifacts: { ...value.peerProductArtifacts, files } }) }
  expandPeerProductReviewPromptView(view)
  return view
}

/** Evidence/replay helper, never a way to repair a model submission. */
export function expandPeerProductReviewPromptView(view: PeerProductReviewView): PeerProductReviewContext {
  if (view?.encoding !== 'native-peer-review-context.v1' || !/^[a-f0-9]{64}$/u.test(view.originalHash)) return reviewContextInvalid()
  const decoded = expandModuleReferencePromptView(view.data) as PeerProductReviewContext
  const restored = { ...decoded, candidate: reviewCandidateSteps(decoded, true) }
  if (!restored?.peerProductArtifacts?.files || typeof restored.peerProductArtifacts.files !== 'object') return reviewContextInvalid()
  const referenceValue = (pointer: unknown): unknown => {
    if (typeof pointer !== 'string' || !['/candidate/outputs/peer_products', '/candidateHash', '/peerProductArtifacts/cells', '/candidate/claims', '/candidate/sourceValues'].includes(pointer)) return reviewContextInvalid()
    let current: unknown = restored
    for (const key of pointer.slice(1).split('/')) {
      if (!current || typeof current !== 'object' || !Object.hasOwn(current, key)) return reviewContextInvalid()
      current = (current as Record<string, unknown>)[key]
    }
    return current
  }
  const files = Object.fromEntries(Object.entries(restored.peerProductArtifacts.files).map(([path, content]) => {
    if (typeof content === 'string') return [path, content]
    const encoded = content as { encoding?: string; value?: unknown; pointer?: unknown; entries?: unknown }
    if (!path.endsWith('.json') || !encoded || Object.keys(encoded).length !== 2) return reviewContextInvalid()
    if (encoded.encoding === 'json-pretty-2-newline.v1' && Object.hasOwn(encoded, 'value')) return [path, json(encoded.value)]
    if (encoded.encoding === 'json-pretty-2-newline-ref.v1') return [path, json(referenceValue(encoded.pointer))]
    if (encoded.encoding === 'json-pretty-2-newline-template.v1' && Array.isArray(encoded.entries)) {
      const names = new Set<string>()
      const entries = encoded.entries.map(entry => {
        if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || names.has(entry[0])) return reviewContextInvalid()
        names.add(entry[0])
        const cell = entry[1] as { pointer?: unknown; value?: unknown }
        if (!cell || typeof cell !== 'object' || Object.keys(cell).length !== 1) return reviewContextInvalid()
        if (Object.hasOwn(cell, 'pointer')) return [entry[0], referenceValue(cell.pointer)]
        if (Object.hasOwn(cell, 'value')) return [entry[0], cell.value]
        return reviewContextInvalid()
      })
      return [path, json(Object.fromEntries(entries))]
    }
    return reviewContextInvalid()
  }))
  const result = { ...restored, peerProductArtifacts: { ...restored.peerProductArtifacts, files } }
  if (hash(result) !== view.originalHash) return reviewContextInvalid()
  return result
}

export const peerProductReviewContextProtocol = 'native-peer-review-context.v1是完整候选、全部作者组状态和实际图件的无损只读输入，data按research-reference.v1的stringKey/rowKey/textKey规则恢复全部字段（未编码时直接读取）。candidate.steps内native-group-step-summary.v1按authorGroupStates原顺序读取该step的完整原生summary，逐组加[groupId]和一个空格，用换行连接；native-group-step-limits.v1按同一原顺序收集该step的全部原生limitations，保留首次出现顺序去重。v4状态读取stepResults.step1至step4，v3状态读取steps内同编号原项；全部原项均已提供，不可跳过任何组。仅peerProductArtifacts.files内的JSON文件使用以下精确格式：json-pretty-2-newline.v1读取完整value；json-pretty-2-newline-ref.v1的pointer按JSON Pointer读取恢复后整个审核包中的同一个完整对象；json-pretty-2-newline-template.v1按entries顺序组装键值对象，每项的pointer同样读取完整对象，value直接取原值。三种格式的逐字文件内容均为JSON.stringify(得到的完整对象,null,2)+一个换行；其他文件包括实际HTML均为完整原字符串。同一对象只共享传输位置，不缩写字段或限制。必须核验全部candidate、authorGroupStates、单元格、JSON数据及HTML，并对照原candidateHash、authorGroupsHash、图件renditions.sha256和原peerProductArtifactsHash；编码或生成文件不代表QA通过，不得省略限制、缺失或omitted图件。originalHash绑定恢复后的完整审核包，不是专业证据。回传绑定原实际图件包的peerProductArtifactsHash，不回传传输视图的hash。'
export const peerProductArtifactReviewProtocol = 'peerProductArtifacts是程序从本次完整原生候选原值生成的实际HTML、数据与逐格trace，candidateHash须对应本候选；核验实际files和单元格selector→claimRefs→原始来源，不能把文件存在、hash或内部工作ID当作业务真实性、产品级依据、四步完成或发布通过。未核单元格不是0，未出现组合不证明无供给，研究分类不证明营业。omitted图件仍缺失；价格/分母/产品原始记录及检索充分性须独立核验。回传本次peerProductArtifactsHash，不得使用旧候选图件。'
