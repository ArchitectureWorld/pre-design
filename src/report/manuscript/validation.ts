import type { FrozenProjectInput } from '../types.ts'
import { MATERIAL_EXPLANATION } from './client-copy.ts'
import { makeSourceIndex, manuscriptSourceFingerprint } from './source.ts'
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import { PLANNING_CHAPTER_OUTPUT_SCHEMA } from './prompts.ts'
import { PLANNING_CHAPTER_IDS, PLANNING_MANUSCRIPT_POLICY_VERSION, PLANNING_MANUSCRIPT_SCHEMA_VERSION,
  type PlanningChapterId, type PlanningManuscript, type PlanningManuscriptChapter, type PlanningManuscriptDiagram, type PlanningManuscriptPage, type PlanningManuscriptSource } from './types.ts'

const pageKinds = new Set(['argument', 'evidence', 'comparison', 'product', 'spatial', 'delivery', 'financial'])
const visualKinds = new Set(['source', 'concept', 'diagram', 'none'])
const internalCopy = /本页|本幻灯片|我们将|接下来(?:介绍|讨论|转向)|下一步填写|置信(?:等级|度)|质量(?:守卫|阈值|评估)|任务状态|工作项(?:状态|完成)|质量证据|会议纪要|讨论纪要|已(?:彻底)?剔除旧版|旧版无依据|经讨论|中央Runtime|综合得分|稳健性(?:评分|0[.．])|\b(?:VETO|GRP|PROD)-\d+|\b(?:Workflow|ProposalEnvelope|qualityEvidence|sourceRevision)\b|override\/edit/iu
const administrativeLead = /^(?:(?:目前|当前|现阶段|本阶段)[，,：:]?)?(?:(?:仍?需(?:要)?|尚需|有待|建议)(?:进一步)?(?:明确|补充|核实|确认|填写|收集|完善)|(?:下一步|后续)(?:再|应|需|需要)?(?:明确|补充|核实|确认|填写|收集|完善)|待(?:明确|补充|核实|确认|填写|完善))/u
const emptyScale = /^(?:(?:规模|具体规模)[：:]?)?(?:根据实际情况确定|视实际情况(?:确定|调整)|具体规模待(?:核实|明确|确定|确认)|待(?:核实|明确|确定|确认)|尚未确定)[。！!]?$/u
const sloganWords = /全面|持续|积极|大力|深度|推动|推进|助力|赋能|创新|融合|协同|升级|发展|打造|构建|建设|形成|提升|促进|文旅|产业|区域|城市|乡村|生态|标杆|示范|高质量|新引擎|新格局|新活力|新高地|新动能|品牌|价值|活力|引领|与|和|的|[\s，。；：、！？,.;:!?]/gu
const identifier = /^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/u

function fail(code: string, path: string): never { throw new Error(`${code}: ${path}`) }
function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('MANUSCRIPT_SHAPE', path)
  return value as Record<string, unknown>
}
function text(value: unknown, path: string, code = 'MANUSCRIPT_SHAPE'): string {
  if (typeof value !== 'string' || value.trim() === '') fail(code, path)
  return value.trim()
}
function list(value: unknown, path: string, allowEmpty = false): unknown[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) fail('MANUSCRIPT_SHAPE', path)
  return value
}
type CopyReporter=(path:string,message:string)=>void
function audience(path:string,message:string,report?:CopyReporter):void{
  if(report)report(path,message);else fail('MANUSCRIPT_AUDIENCE',`${path}: ${message}`)
}
function copyText(value: unknown, path: string,report?:CopyReporter): string {
  const result = text(value, path)
  const internal=internalCopy.exec(result),material=MATERIAL_EXPLANATION.exec(result)
  if (internal||material) audience(path,`“${(internal??material)![0]}”属于内部工作或材料说明，请将完整说明移入notes；此字段保留具体的方案主张。`,report)
  return result
}
function copyProposition(value: unknown, path: string,report?:CopyReporter): string {
  const result = copyText(value, path,report)
  if (administrativeLead.test(result)) audience(path,'需要项目判断或具体方案主张，不能用泛化补资料待办代替。',report)
  if (/赋能|标杆|新引擎|新格局|新高地|高质量/u.test(result) && result.replace(sloganWords, '') === '') {
    audience(path,'纯口号缺少具体对象、规划动作或使用价值。',report)
  }
  return result
}

/** A diagram is an authored relationship, never inferred from prose or a visual brief. */
export function validatePlanningDiagram(value: unknown, path = 'visual.diagram',report?:CopyReporter): PlanningManuscriptDiagram {
  const object = (value: unknown, at: string): Record<string, unknown> => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('MANUSCRIPT_DIAGRAM', at)
    return value as Record<string, unknown>
  }
  const label = (value: unknown, at: string, limit?: number): string => {
    const result = text(value, at, 'MANUSCRIPT_DIAGRAM')
    if (MATERIAL_EXPLANATION.test(result)) audience(at,'材料说明应移入notes。',report)
    if ((limit !== undefined && Array.from(result).length > limit) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(result)) fail('MANUSCRIPT_DIAGRAM', at)
    return result
  }
  const row = object(value, path)
  if (!Array.isArray(row.nodes) || row.nodes.length === 0 || row.nodes.length > 12) fail('MANUSCRIPT_DIAGRAM', `${path}.nodes`)
  if (!Array.isArray(row.edges) || row.edges.length > 20) fail('MANUSCRIPT_DIAGRAM', `${path}.edges`)
  const ids = new Set<string>(), cells = new Set<string>()
  const nodes = row.nodes.map((value, index): PlanningManuscriptDiagram['nodes'][number] => {
    const at = `${path}.nodes[${index}]`, node = object(value, at), id = label(node.id, `${at}.id`)
    if (ids.has(id)) fail('MANUSCRIPT_DIAGRAM', `${at}.id`)
    ids.add(id)
    if (typeof node.column !== 'number' || !Number.isInteger(node.column) || node.column < 0 || node.column > 3) fail('MANUSCRIPT_DIAGRAM', `${at}.column`)
    if (typeof node.row !== 'number' || !Number.isInteger(node.row) || node.row < 0 || node.row > 2) fail('MANUSCRIPT_DIAGRAM', `${at}.row`)
    const cell = `${node.column}:${node.row}`
    if (cells.has(cell)) fail('MANUSCRIPT_DIAGRAM', `${at}: overlapping cell`)
    cells.add(cell)
    if (node.tone !== undefined && !['accent', 'neutral', 'muted'].includes(String(node.tone))) fail('MANUSCRIPT_DIAGRAM', `${at}.tone`)
    return { id, label: label(node.label, `${at}.label`, 32), column: node.column, row: node.row,
      ...(node.tone === undefined ? {} : { tone: node.tone as 'accent' | 'neutral' | 'muted' }) }
  })
  const edges = row.edges.map((value, index): PlanningManuscriptDiagram['edges'][number] => {
    const at = `${path}.edges[${index}]`, edge = object(value, at)
    const from = label(edge.from, `${at}.from`), to = label(edge.to, `${at}.to`)
    if (!ids.has(from) || !ids.has(to)) fail('MANUSCRIPT_DIAGRAM', at)
    return { from, to, ...(edge.label === undefined ? {} : { label: label(edge.label, `${at}.label`, 20) }) }
  })
  if(row.presentation===undefined)return { nodes, edges }
  const p=object(row.presentation,`${path}.presentation`)
  if(p.kind==='editorial'){
    if(!['flow','branch','convergence','cycle','matrix'].includes(String(p.topology))||!Array.isArray(p.groups)||!p.groups.length||p.groups.length>4||!Array.isArray(p.primaryNodeIds)||p.primaryNodeIds.some(id=>!ids.has(String(id)))||new Set(p.primaryNodeIds).size!==p.primaryNodeIds.length)fail('MANUSCRIPT_DIAGRAM',`${path}.presentation: choose a topology and 1-4 named semantic groups`)
    const groups=p.groups.map((g:any,i:number)=>{
      if(!Array.isArray(g.nodeIds)||!g.nodeIds.length||g.nodeIds.length>4||g.nodeIds.some((id:any)=>!ids.has(id)))fail('MANUSCRIPT_DIAGRAM',`${path}.groups[${i}]`)
      return {label:label(g.label,`${path}.groups[${i}].label`,10),nodeIds:g.nodeIds as string[]}
    })
    const covered=groups.flatMap(g=>g.nodeIds)
    if(covered.length!==nodes.length||new Set(covered).size!==nodes.length)fail('MANUSCRIPT_DIAGRAM',`${path}.presentation: every node must belong to exactly one group`)
    if(nodes.some(n=>[...n.label].length>12)||edges.some(e=>e.label&&[...e.label].length>8))fail('MANUSCRIPT_DIAGRAM',`${path}.presentation: concise node and relation labels required`)
    return {nodes,edges,presentation:{kind:'editorial',topology:p.topology as import('../diagram-design.ts').EditorialDiagramPresentation['topology'],groups,primaryNodeIds:p.primaryNodeIds as string[]}}
  }
  const invalid=()=>fail('MANUSCRIPT_DIAGRAM',`${path}.presentation: primary-secondary requires 2-4 primary nodes, 1-2 auxiliary nodes between two primary endpoints, and exact coverage of all authored nodes/edges`)
  const sequence=(value:unknown,min:number,max:number):string[]=>{
    if(!Array.isArray(value)||value.length<min||value.length>max||value.some(id=>typeof id!=='string'||!ids.has(id))||new Set(value).size!==value.length)invalid()
    return value as string[]
  }
  if(p.kind!=='primary-secondary')invalid()
  const primaryNodeIds=sequence(p.primaryNodeIds,2,4),secondaryNodeIds=sequence(p.secondaryNodeIds,3,4)
  if(!primaryNodeIds.includes(secondaryNodeIds[0]!)||!primaryNodeIds.includes(secondaryNodeIds.at(-1)!)||secondaryNodeIds.slice(1,-1).some(id=>primaryNodeIds.includes(id)))invalid()
  const all=new Set([...primaryNodeIds,...secondaryNodeIds])
  const links=[primaryNodeIds,secondaryNodeIds].flatMap(list=>list.slice(1).map((to,i)=>JSON.stringify([list[i],to])))
  if(all.size!==nodes.length||links.length!==edges.length||new Set(links).size!==links.length||edges.some(e=>!links.includes(JSON.stringify([e.from,e.to])))||new Set(edges.map(e=>JSON.stringify([e.from,e.to]))).size!==edges.length)invalid()
  if(nodes.some(n=>[...n.label].length>12)||edges.some(e=>e.label&&[...e.label].length>8))invalid()
  return {nodes,edges,presentation:{kind:'primary-secondary',primaryNodeIds,secondaryNodeIds,
    primaryLabel:label(p.primaryLabel,`${path}.presentation.primaryLabel`,10),secondaryLabel:label(p.secondaryLabel,`${path}.presentation.secondaryLabel`,10)}}
}

export function validatePlanningChapter(value: unknown, chapterId: PlanningChapterId, sources: readonly PlanningManuscriptSource[],report?:CopyReporter): PlanningManuscriptChapter {
  const prose=(value:unknown,path:string)=>copyText(value,path,report),proposition=(value:unknown,path:string)=>copyProposition(value,path,report)
  const row = record(value, chapterId)
  if (row.id !== chapterId) fail('MANUSCRIPT_CHAPTER_ID', chapterId)
  const sourceIds = new Set(sources.map(source => source.id))
  const seen = new Set<string>()
  const pages = list(row.pages, `${chapterId}.pages`).map((value, index): PlanningManuscriptPage => {
    const path = `${chapterId}.pages[${index}]`, page = record(value, path)
    const id = text(page.id, `${path}.id`)
    if (!identifier.test(id) || !id.startsWith(`${chapterId}-`) || seen.has(id)) fail('MANUSCRIPT_PAGE_ID', `${path}.id`)
    seen.add(id)
    const kind = text(page.kind, `${path}.kind`)
    if (!pageKinds.has(kind)) fail('MANUSCRIPT_PAGE_KIND', path)
    if (!Array.isArray(page.sourceRefs) || page.sourceRefs.length === 0) {
      fail('MANUSCRIPT_SOURCE', `${path}.sourceRefs`)
    }
    const invalidRefs = page.sourceRefs.flatMap((ref, refIndex) => typeof ref === 'string' && sourceIds.has(ref) ? []
      : [`${path}.sourceRefs[${refIndex}]=${(JSON.stringify(ref) ?? String(ref)).slice(0, 240)}`])
    if (invalidRefs.length) fail('MANUSCRIPT_SOURCE', `${invalidRefs.slice(0, 12).join('; ')}; ${invalidRefs.length} invalid reference(s). Select exact IDs from the supplied sources; do not invent IDs.`)
    const visual = record(page.visual, `${path}.visual`)
    if (!visualKinds.has(String(visual.kind))) fail('MANUSCRIPT_VISUAL', path)
    if (visual.diagram !== undefined && visual.kind !== 'diagram') fail('MANUSCRIPT_DIAGRAM', `${path}.visual.kind`)
    const diagram = visual.diagram === undefined ? undefined : validatePlanningDiagram(visual.diagram, `${path}.visual.diagram`,report)
    if (visual.sourceMaterialKey !== undefined && visual.kind !== 'source') fail('MANUSCRIPT_VISUAL_SOURCE', `${path}.visual.kind`)
    const sourceMaterialKey = visual.sourceMaterialKey === undefined ? undefined : text(visual.sourceMaterialKey, `${path}.visual.sourceMaterialKey`, 'MANUSCRIPT_VISUAL_SOURCE')
    const optionalProduct = page.product === undefined ? undefined : record(page.product, `${path}.product`)
    // Some structured-output models fill an unused optional object with empty
    // strings. Discard only a wholly blank block on a non-product page; a real
    // product or a partially populated block still requires every field.
    const product = kind !== 'product' && optionalProduct !== undefined
      && Object.values(optionalProduct).every(value => typeof value === 'string' && value.trim() === '')
      ? undefined : optionalProduct
    if (kind === 'product' && !product) fail('MANUSCRIPT_PRODUCT', path)
    const productCopy = product === undefined ? undefined : Object.fromEntries(['name', 'audience', 'experience', 'location', 'scale', 'operations']
      .map(key => [key, prose(text(product[key], `${path}.product.${key}`, 'MANUSCRIPT_PRODUCT'), `${path}.product.${key}`)])) as unknown as PlanningManuscriptPage['product']
    if (productCopy && emptyScale.test(productCopy.scale)) fail('MANUSCRIPT_PRODUCT', `${path}.product.scale: 说明场地、人员、时长等限制怎样决定规模，不能只有待定占位。`)
    const table = page.table === undefined ? undefined : record(page.table, `${path}.table`)
    const columns = table === undefined ? undefined : list(table.columns, `${path}.columns`).map((cell, i) => prose(cell, `${path}.columns[${i}]`))
    const rows = table === undefined ? undefined : list(table.rows, `${path}.rows`).map((row, i) => {
      if (!Array.isArray(row) || row.length !== columns!.length) fail('MANUSCRIPT_TABLE', `${path}.rows[${i}]`)
      return row.map((cell, j) => prose(cell, `${path}.rows[${i}][${j}]`))
    })
    const body = list(page.body, `${path}.body`).map((body, i) => prose(body, `${path}.body[${i}]`))
    const delivery: Partial<Pick<PlanningManuscriptPage,'productRefs'|'spatialEvidence'|'quantities'|'terrainPlan'>> = {}
    for(const key of ['productRefs','spatialEvidence','quantities','terrainPlan'] as const) if(page[key]!==undefined){
      const schema=PLANNING_CHAPTER_OUTPUT_SCHEMA.properties!.pages!.items!.properties![key]!
      if(validateJsonSchemaValue(schema,page[key]).length)fail('MANUSCRIPT_SHAPE',`${path}.${key}`)
      Object.assign(delivery,{[key]:page[key]})
    }
    const quantityRefs=delivery.quantities?.flatMap(q=>q.sourceRefs)??[]
    if(quantityRefs.some(ref=>!sourceIds.has(ref)))fail('MANUSCRIPT_SOURCE',`${path}.quantities: 数量引用必须逐字采用本章实际来源。`)
    const statements = body.flatMap(paragraph => paragraph.split(/[。！？；\n]/u).map(text => text.trim()).filter(Boolean))
    if (statements.length && statements.every(statement => administrativeLead.test(statement))) audience(`${path}.body`,'正文只有资料待办，缺少方案内容及依据。',report)
    return { id, kind: kind as PlanningManuscriptPage['kind'], title: proposition(page.title, `${path}.title`), claim: proposition(page.claim, `${path}.claim`),
      ...delivery,
      body, sourceRefs: [...new Set([...(page.sourceRefs as string[]),...quantityRefs])],
      ...(productCopy ? { product: productCopy } : {}), ...(columns ? { table: { columns, rows: rows! } } : {}),
      visual: { kind: visual.kind as PlanningManuscriptPage['visual']['kind'], subject: prose(visual.subject, `${path}.visual.subject`),
        purpose: text(visual.purpose, `${path}.visual.purpose`), caption: prose(visual.caption, `${path}.visual.caption`),
        ...(diagram ? { diagram } : {}), ...(sourceMaterialKey === undefined ? {} : { sourceMaterialKey }) },
      notes: list(page.notes, `${path}.notes`, true).map((note, i) => text(note, `${path}.notes[${i}]`)),
    }
  })
  if (chapterId === 'products' && !pages.some(page => page.kind === 'product')) fail('MANUSCRIPT_PRODUCT', 'products: 产品章必须展开具体产品，不能只写抽象策略。')
  return { id: chapterId, title: proposition(row.title, `${chapterId}.title`), thesis: proposition(row.thesis, `${chapterId}.thesis`), pages }
}

export function validatePlanningManuscript(value: unknown, input: FrozenProjectInput): PlanningManuscript {
  // Full reports have a separate durable whole-report content gate. Preserve
  // native drafts there; copy defects must not consume structural retry slots.
  const report:CopyReporter|undefined=input.deliveryContract?()=>{}:undefined
  const row = record(value, 'manuscript')
  if (row.schemaVersion !== PLANNING_MANUSCRIPT_SCHEMA_VERSION || row.policyVersion !== PLANNING_MANUSCRIPT_POLICY_VERSION) fail('MANUSCRIPT_VERSION', 'manuscript')
  if (row.projectId !== input.projectId || row.sourceRevision !== input.revision || row.sourceFingerprint !== manuscriptSourceFingerprint(input)) fail('MANUSCRIPT_SOURCE_CHANGED', 'manuscript')
  if (typeof row.generatedAt !== 'string' || !Number.isFinite(Date.parse(row.generatedAt))) fail('MANUSCRIPT_SHAPE', 'generatedAt')
  const rows = list(row.chapters, 'chapters')
  if (rows.length !== PLANNING_CHAPTER_IDS.length || rows.some((chapter, index) => record(chapter, 'chapter').id !== PLANNING_CHAPTER_IDS[index])) fail('MANUSCRIPT_CHAPTERS', 'chapters')
  const sources = makeSourceIndex(input)
  const editorial = row.editorial === undefined ? undefined : record(row.editorial, 'editorial')
  if (editorial && (!/^[a-f0-9]{64}$/u.test(String(editorial.draftFingerprint)) || !Number.isFinite(Date.parse(String(editorial.editedAt))))) fail('MANUSCRIPT_SHAPE', 'editorial')
  return { schemaVersion: PLANNING_MANUSCRIPT_SCHEMA_VERSION, policyVersion: PLANNING_MANUSCRIPT_POLICY_VERSION,
    projectId: input.projectId, sourceRevision: input.revision, sourceFingerprint: row.sourceFingerprint,
    generatedAt: row.generatedAt, title: copyText(row.title, 'title',report),
    chapters: rows.map((chapter, index) => validatePlanningChapter(chapter, PLANNING_CHAPTER_IDS[index]!, sources,report)),
    ...(editorial ? { editorial: { version: text(editorial.version, 'editorial.version'), draftFingerprint: String(editorial.draftFingerprint), editedAt: String(editorial.editedAt) } } : {}),
  }
}

/** Copy quality remains a final acceptance condition, collected in one pass. */
export function inspectPlanningCopy(manuscript:PlanningManuscript){
  const findings:{pageId:string;message:string}[]=[]
  const check=(value:string,path:string,pageId:string,claim=false)=>{
    if(typeof value!=='string'||!value.trim())return
    const report:CopyReporter=(at,message)=>findings.push({pageId,message:`${at}: ${message}`})
    ;(claim?copyProposition:copyText)(value,path,report)
  }
  const first=manuscript.chapters[0]?.pages[0]?.id
  if(first)check(manuscript.title,'title',first)
  for(const chapter of manuscript.chapters){
    const pageId=chapter.pages[0]?.id;if(!pageId)continue
    for(const key of ['title','thesis'] as const)check(chapter[key],`${chapter.id}.${key}`,pageId,true)
    for(const page of chapter.pages){
      for(const key of ['title','claim'] as const)check(page[key],`${page.id}.${key}`,page.id,true)
      page.body.forEach((text,i)=>check(text,`${page.id}.body[${i}]`,page.id))
      const statements=page.body.flatMap(p=>p.split(/[。！？；\n]/u).map(s=>s.trim()).filter(Boolean))
      if(statements.length&&statements.every(s=>administrativeLead.test(s)))findings.push({pageId:page.id,message:'正文只有资料待办，缺少方案内容及依据。'})
      for(const [key,value] of Object.entries(page.product??{}))check(value,`${page.id}.product.${key}`,page.id)
      page.table?.columns.forEach((text,i)=>check(text,`${page.id}.columns[${i}]`,page.id))
      page.table?.rows.forEach((row,i)=>row.forEach((text,j)=>check(text,`${page.id}.rows[${i}][${j}]`,page.id)))
      for(const key of ['subject','purpose','caption'] as const)check(page.visual[key],`${page.id}.visual.${key}`,page.id)
      page.visual.diagram?.nodes.forEach(n=>check(n.label,`${page.id}.diagram.${n.id}`,page.id))
      page.visual.diagram?.edges.forEach(e=>{if(e.label)check(e.label,`${page.id}.diagram.${e.from}-${e.to}`,page.id)})
    }
  }
  return findings
}
