import type { FrozenProjectInput } from './types.ts'
import type { PlanningChapterId, PlanningManuscriptPage,PlanningManuscriptSource } from './manuscript/types.ts'
import { makeSourceIndex } from './manuscript/source.ts'
import { sha256CanonicalJson as hash } from '../presentation/canonical-json.ts'
import { inspectReportQuantities } from './quantity-check.ts'
import { validateTerrainPlan } from './terrain-reference.ts'
import {controlledResearchReady} from '../research-v2/module-progress-review.ts'
import {PLANNING_PURPOSE_INSTRUCTION} from '../research-v2/planning-purpose.ts'
import {inspectPlanningCopy} from './manuscript/validation.ts'

export type ReportRequirementId = 'opportunity' | 'choice' | 'industry' | 'products' | 'spatial' | 'launch' | 'operations'
export interface ReportDeliveryContract {
  readonly version: string
  readonly formats: readonly ['html']
  readonly researchValidityDays: number
  readonly requirements: readonly { readonly id: ReportRequirementId; readonly chapters: readonly PlanningChapterId[]; readonly question: string }[]
}
export const DEFAULT_REPORT_DELIVERY_CONTRACT: ReportDeliveryContract = Object.freeze({
  version: 'complete-planning-html.v3', formats: Object.freeze(['html'] as const), researchValidityDays:90,
  requirements: Object.freeze([
    {id:'opportunity',chapters:['opportunity','site'],question:'为什么做：以区位、资源、市场、客群和竞争证据解释项目机会与场地判断。'},
    {id:'choice',chapters:['positioning'],question:'选择什么：比较实质不同路径，给出推荐定位、取舍理由和成立条件。'},
    {id:'industry',chapters:['products'],question:'产业如何成立：依据本底能力与市场需求比较候选方向，明确主导产业、支撑产业、保留/暂缓/排除理由；展开产业链环节、已有与拟引入主体、能力缺口和项目组合，逐项关联产品、空间载体、运营主体、投入与收入逻辑及分期。不能以体验产品清单或产业口号代替产业规划。非产业开发项目应说明适用性并展开相应公共服务体系，不强套产业产值。'},
    {id:'products',chapters:['products'],question:'具体做什么：逐个定义核心产品、服务对象、体验、载体、规模依据及经营方式。'},
    {id:'spatial',chapters:['spatial'],question:'落在哪里：将产品对应到空间分区、节点、到达、游线、服务和后勤，解释位置选择。'},
    {id:'launch',chapters:['launch'],question:'怎样启动：明确首期项目组合、独立运行体验与后续分期触发条件。'},
    {id:'operations',chapters:['operation'],question:'怎样持续：明确运营职责、收入成本、投资依据和可复算的情景分析。'},
  ].map(row=>Object.freeze({...row,chapters:Object.freeze(row.chapters)})) as ReportDeliveryContract['requirements']),
})
export function reportDeliveryContract(value?: ReportDeliveryContract): ReportDeliveryContract { return value ?? DEFAULT_REPORT_DELIVERY_CONTRACT }
export function assertReportDeliveryContract(value?: ReportDeliveryContract): void {
  if (hash(reportDeliveryContract(value)) !== hash(DEFAULT_REPORT_DELIVERY_CONTRACT)) throw new Error('REPORT_DELIVERY_CONTRACT_CHANGED: 请按当前完整图文 HTML 标准重新生成。')
}
export function deliveryContractPrompt(): string {
  return ['交付目标：面向甲方方案决策的完整横版图文 HTML，含实际图片资源、资料与计算依据入口。',
    PLANNING_PURPOSE_INSTRUCTION,
    ...DEFAULT_REPORT_DELIVERY_CONTRACT.requirements.map(x=>x.question),
    '不能用通用建议或补资料待办代替研究结论和具体方案；章节、页数和文件生成成功不代表完成。',
    '产业规划与产品体系章须分别展开产业选择、产业链与项目组合、具体产品的图文论证。产业项目、产品、空间、运营和分期必须相互对应；既有企业、历史计划、拟引入主体和新增建议分别表述，未有证据不能宣称合作已落地。地形和底图用于空间推敲，不能仅作附图。事实地图和统计图基于真实数据；设计图采用用户保存的模型配置。',
    '空间、启动、运营页面用productRefs关联实际产品页id；每个核心产品必须分别在这三章有明确安排。空间页spatialEvidence写baseRefs（真实底图/地形来源id）、zone、node、access、route、service、logistics、rationale，说明选址与地形依据。其他章节已形成的产品页id在跨章上下文中提供；不能猜造关联。',
    '若来源含terrain.reference，空间页必须用terrainPlan表达实际地形上的方案：sourceId逐字引用terrain来源id；zones按来源中的A1等cellId选择cellIds并关联productRefs；nodes给id/name/cellId/role/productRefs，role含arrival、product、service、logistics；routes给name/kind(visitor或logistics)/nodeIds，表达游览与后勤连接。宿主按真实网格定位、计算坡度并绘图，位置和连线均为拟定方案，不得写成现有设施或已通行道路。结合各网格坡度、水域、资源依据解释取舍，不能只提供地形附图。',
    '数字必须有逐页可核对依据。新增情景量用quantities声明{id,label,value,unit,kind,sourceRefs,rationale}：kind为source、assumption或calculation；假设须解释依据及影响，计算另写operation(sum/difference/product/ratio/min/max)和inputIds，引用同页量id，宿主重新计算；计算不是补造事实。收入成本投资等正文及表格数值必须匹配本页来源或声明的量。',
    '允许自主提出有单位和理由的设计情景假设，包括工作量、单价、人员、服务收入和维护成本；用quantities明确区分假设与事实，复算完整试点的投入和收支，依据及变化影响写入页面notes和计算依据。正文表达方案动作与目标场景；人工确认事项、实施许可及资料限制进入备注，不写成汇报主张或反复免责。禁止把假设客流、金额、产权和审批写成已核事实。',
    '整体回看允许推进的limited保持原记录，相关条件进入对应页面notes及备注汇总。正文以拟议方案表达理想条件下的成果，不把推进许可表述成事实核实或审批通过。按每3个实质模块、跨章及关键前提变化回看；最后整体回看不能替代报告独立内容及逐页验收。',
    `研究审查结果的默认复用期为${DEFAULT_REPORT_DELIVERY_CONTRACT.researchValidityDays}天，超期重新研究；历史原始资料可继续作为明确标注年代的依据，不因此被改写为现状。`,
    '每页图文共同回答具体问题；无关效果图、重复风景图、装饰图和仅标题变化的重复正文不能计作成果。',
    '全部适用研究完成、独立内容审查与实际 HTML 验收通过后，才可报告完整成果完成。未通过时保留草稿并列出具体缺口。'].join('\n')
}
export interface ReportAcceptanceFinding {
  readonly code: string
  readonly requirementId?: ReportRequirementId
  readonly pageId?: string
  readonly message: string
}

/** Structural coverage is necessary, never sufficient for semantic acceptance. */
export function inspectReportCoverage(input: FrozenProjectInput,sourceIndex?:readonly PlanningManuscriptSource[]): ReportAcceptanceFinding[] {
  const findings: ReportAcceptanceFinding[]=[]
  const add=(code:string,message:string,requirementId?:ReportRequirementId,pageId?:string)=>findings.push({code,message,...(requirementId?{requirementId}:{}),...(pageId?{pageId}:{})})
  const research=input.moduleResearch
  if(!research) add('RESEARCH_REQUIRED','完整报告需要绑定当前资料和任务的研究计划与已核验结果。')
  else {
    const expected=[...research.expectedModuleIds].sort(), completed=research.moduleRuns.filter(x=>x.status==='completed').map(x=>x.itemId).sort()
    const controlled=controlledResearchReady({...research,selectedModuleIds:research.expectedModuleIds})
    if(!expected.length||JSON.stringify(expected)!==JSON.stringify(completed)&&!controlled||JSON.stringify(expected)!==JSON.stringify(research.results.map(x=>x.itemId).sort())) add('RESEARCH_INCOMPLETE','研究结果缺失或尚未全部核验。')
  }
  const chapters=input.manuscript?.chapters??[], pages=chapters.flatMap(x=>x.pages)
  const requiredKinds:Partial<Record<ReportRequirementId,string>>={choice:'comparison',products:'product',spatial:'spatial',launch:'delivery',operations:'financial'}
  for(const requirement of DEFAULT_REPORT_DELIVERY_CONTRACT.requirements){
    const selected=chapters.filter(c=>requirement.chapters.includes(c.id)).flatMap(c=>c.pages)
    if(requirement.chapters.some(id=>!chapters.some(c=>c.id===id&&c.pages.length))||!selected.length) add('CONTENT_REQUIRED',requirement.question,requirement.id)
    else if(requiredKinds[requirement.id]&&!selected.some(p=>p.kind===requiredKinds[requirement.id])) add('PROPOSAL_REQUIRED',requirement.question,requirement.id)
  }
  const sources=sourceIndex??makeSourceIndex(input), sourceIds=new Set(sources.map(x=>x.id))
  for(const page of pages){
    if(!page.sourceRefs.length||page.sourceRefs.some(id=>!sourceIds.has(id))) add('SOURCE_UNBOUND','页面必须引用当前来源。',undefined,page.id)
    if(/^(?:后续|下一步|待|建议(?:进一步)?(?:核实|收集|补充|完善))/.test(page.claim)) add('GENERIC_PROPOSAL','页面主张为待办事项，缺少项目判断或具体方案。',undefined,page.id)
  }
  // Complete research and the sources of every authored claim remain mandatory.
  // Background/constraint research is indexed in the evidence appendix; citation
  // of every module in the main pages is not a measure of substantive coverage.
  // The independent requirement review decides whether a key argument is missing.
  // Other chapters may repeat a product card to explain its implementation.
  // Product identity is owned by the products chapter, not every card layout.
  const products=(chapters.find(c=>c.id==='products')?.pages??[]).filter(p=>p.kind==='product'&&p.product),productIds=new Set(products.map(p=>p.id))
  for(const page of pages)if(page.productRefs?.some(ref=>!productIds.has(ref)))add('PRODUCT_REFERENCE_INVALID','关联的产品页不存在。',undefined,page.id)
  for(const product of products)for(const id of ['spatial','launch','operation'] as const){
    if(!chapters.find(c=>c.id===id)?.pages.some(p=>p.productRefs?.includes(product.id)))add('PRODUCT_UNBOUND',`${product.product!.name} 缺少${id}章节的明确安排。`,id==='operation'?'operations':id,product.id)
  }
  const spatialPages=chapters.find(c=>c.id==='spatial')?.pages??[]
  const hasSpatialEvidence=(page:PlanningManuscriptPage)=>{
    const detail=page.spatialEvidence
    return !!detail&&!!detail.baseRefs?.length&&!detail.baseRefs.some(ref=>!sourceIds.has(ref)||!page.sourceRefs.includes(ref))
      &&!['zone','node','access','route','service','logistics','rationale'].some(key=>!String(detail[key as keyof typeof detail]??'').trim())
  }
  const grounded=spatialPages.filter(page=>{
    if(page.kind!=='spatial'||!hasSpatialEvidence(page))return false
    if(input.terrain)try{validateTerrainPlan(page.terrainPlan,input.terrain,page.productRefs??[])}catch{return false}
    return true
  })
  for(const page of spatialPages){
    if(page.kind!=='spatial')continue
    // A route/service diagram may explain the products already located in the
    // chapter's verified terrain plan. Do not force that map onto every page.
    // Explicit but invalid page evidence must never be replaced by this context.
    const sharesPlan=page.terrainPlan===undefined&&page.spatialEvidence===undefined&&page.visual.kind==='diagram'
      &&!!page.visual.diagram?.nodes.length&&!!page.visual.diagram.edges.length&&!!page.productRefs?.length
      &&grounded.some(plan=>plan.id!==page.id&&page.productRefs!.every(ref=>plan.productRefs?.includes(ref)))
    if(input.terrain&&!sharesPlan)try{validateTerrainPlan(page.terrainPlan,input.terrain,page.productRefs??[])}catch(error){add('TERRAIN_PLAN_REQUIRED',error instanceof Error?error.message:'地形上的方案尚未形成。','spatial',page.id)}
    if(!hasSpatialEvidence(page)&&!sharesPlan)add('SPATIAL_EVIDENCE_REQUIRED','空间方案需说明底图地形如何决定分区、节点、到达、游线和后勤。','spatial',page.id)
  }
  findings.push(...inspectReportQuantities(pages,sources))
  if(input.manuscript)findings.push(...inspectPlanningCopy(input.manuscript).map(f=>({code:'CLIENT_COPY',...f})))
  return findings
}
