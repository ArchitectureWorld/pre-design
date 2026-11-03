import {sha256CanonicalJson} from '../presentation/canonical-json.ts'
import {moduleGroupUsesSourceImages} from './module-image-context.ts'
import {materialCorpusFingerprint,type MaterialCorpus} from '../materials/research-evidence.ts'
import type {ModuleCorpusSlice,PromptCorpusDocument} from './module-prompt-context.ts'
import {getModuleFieldContracts} from './module-contracts.ts'

interface SourceScope {readonly fullSourceContextHash:string;readonly upstreamClaimsAvailable:boolean;readonly omitted:readonly string[];readonly reason:string;readonly environmentVerificationTasksOnly?:true;readonly boundaryWorkingMetadataOnly?:true;readonly photoDateExcerptsOnly?:true;readonly upstreamOutputsInventoryOnly?:true;readonly marketOriginalFieldOnly?:true;readonly peerOriginalFieldOnly?:true;readonly peerSelectionOnly?:true;readonly peerBlindSpotsOnly?:true;readonly upstreamExcludedModuleIds?:readonly string[];readonly peerProductRecordSubsetOnly?:true;readonly selectedPeerIds?:readonly string[];readonly retainedOriginalRecordIndices?:readonly number[]}
const object=(value:unknown):value is Record<string,any>=>!!value&&typeof value==='object'&&!Array.isArray(value)
const peerProductFields=new Set(getModuleFieldContracts('3.05').ports.peer_products.fields.map(field=>field.name).filter(name=>name!=='peerId'))
const environmentalFields=new Set(getModuleFieldContracts('1.05').ports.environment.fields.map(field=>field.name))
const resourceFields=new Set(getModuleFieldContracts('1.06').ports.local_resources.fields.map(field=>field.name))
const policyFields=new Set(getModuleFieldContracts('1.03').ports.planning_conditions.fields.map(field=>field.name))
function outputInventory(outputs:unknown):Record<string,unknown>|undefined {
  if(!object(outputs))return
  const inventory:Record<string,unknown>={}
  for(const [name,port] of Object.entries(outputs)){
    if(!object(port)||!Array.isArray(port.records))return
    const records=[]
    for(const record of port.records){
      if(!object(record)||typeof record.recordId!=='string'||typeof record.resultClass!=='string')return
      const fieldClasses:Record<string,string>={}
      for(const [field,value] of Object.entries(record)){
        if(field==='recordId'||field==='resultClass')continue
        if(!object(value)||typeof value.claimClass!=='string')return
        fieldClasses[field]=value.claimClass
      }
      records.push({recordId:record.recordId,resultClass:record.resultClass,fieldClasses})
    }
    inventory[name]={...port,records}
  }
  return inventory
}
function peerProductRecordContext<T extends {readonly upstream:readonly {readonly itemId:string;readonly moduleId:string}[]}>(sources:T,peerIds:readonly unknown[]|undefined) {
  if(!peerIds?.length||peerIds.some(id=>typeof id!=='string'||!id))return
  const selectedPeerIds=[...new Set(peerIds as readonly string[])]
  if(sources.upstream.filter(row=>row.itemId==='3.04').length!==1)return
  let retainedOriginalRecordIndices:number[]=[]
  const upstream=sources.upstream.map(row=>{
    const published=row as T['upstream'][number]&{readonly outputs?:unknown;readonly claims?:unknown;readonly limitations?:unknown}
    const inventory=outputInventory(published.outputs)
    if(!inventory||!Array.isArray(published.claims)||!Array.isArray(published.limitations))return
    const {outputs,...retained}=published
    if(row.itemId!=='3.04')return {...retained,outputInventory:inventory}
    const port=object(outputs)&&object(outputs.peer_supply)?outputs.peer_supply:undefined
    if(!port||!Array.isArray(port.records)||!Array.isArray(port.limitations))return
    const indices=selectedPeerIds.flatMap(id=>{
      const found=port.records.flatMap((record:unknown,index:number)=>object(record)&&object(record.peerId)&&record.peerId.value===id?[index]:[])
      return found.length===1?found:[]
    })
    if(indices.length!==selectedPeerIds.length||published.claims.some(claim=>!object(claim)||typeof claim.claimId!=='string'||typeof claim.selector!=='string'))return
    const recordIndex=(text:string)=>/^\/outputs\/peer_supply\/records\/(\d+)(?:\/|:|$)/u.exec(text)?.[1]
    const claims=published.claims as Record<string,any>[],byId=new Map(claims.map(claim=>[claim.claimId,claim]))
    if(byId.size!==claims.length)return
    const selected=new Set(indices),kept=new Set(claims.filter(claim=>{
      const index=recordIndex(claim.selector)
      return index===undefined||Number(index)>=port.records.length||selected.has(Number(index))
    }).map(claim=>claim.claimId))
    for(const id of kept){
      const claim=byId.get(id)!
      const references=[...(claim.inputRefs??[]),...(claim.calculation?.operands??[]),...(claim.calculation?.weights??[])]
      for(const ref of references){
        if(!ref.claimId||ref.moduleId!==undefined&&ref.moduleId!==row.moduleId)continue
        if(!byId.has(ref.claimId))return
        kept.add(ref.claimId)
      }
    }
    for(const claim of claims.filter(claim=>kept.has(claim.claimId))){
      const index=recordIndex(claim.selector)
      if(index!==undefined&&Number(index)<port.records.length)selected.add(Number(index))
    }
    retainedOriginalRecordIndices=[...selected].sort((a,b)=>a-b)
    const keepLimitation=(text:unknown)=>{
      if(typeof text!=='string')return true
      // Only compiler-addressed restrictions with a matching published claim
      // kind can follow that claim's scope. Opaque and ancestor restrictions
      // stay verbatim; dependencies have already been added to `kept`.
      const addressed=/^(claim-[a-z0-9]+) \[([a-z_]+)\]: /u.exec(text)
      if(addressed){
        const claim=byId.get(addressed[1])
        const restrictionClass=claim?.kind==='source'?'source_conclusion':claim?.kind
        if(claim&&restrictionClass===addressed[2]&&!kept.has(claim.claimId))return false
      }
      const index=recordIndex(text)
      return index===undefined||Number(index)>=port.records.length||selected.has(Number(index))
    }
    const peerInventory=inventory.peer_supply as Record<string,any>
    return {...retained,claims:claims.filter(claim=>kept.has(claim.claimId)),limitations:published.limitations.filter(keepLimitation),
      outputInventory:{...inventory,peer_supply:{...peerInventory,limitations:port.limitations.filter(keepLimitation),records:peerInventory.records.filter((_:unknown,index:number)=>selected.has(index))}}}
  })
  return upstream.every(row=>row!==undefined)?{upstream,selectedPeerIds,retainedOriginalRecordIndices}:undefined
}
function dateTagSpans(text:string,startOffset:number,paragraph:number) {
  return ['dateTimeOriginal','timeZone'].flatMap(tag=>{
    const match=new RegExp('"'+tag+'"\\s*:\\s*("(?:\\\\.|[^"\\\\])*"|null)').exec(text)
    return match?[{paragraph,startOffset:startOffset+match.index,endOffset:startOffset+match.index+match[0].length,text:match[0]}]:[]
  })
}
function datePromptCorpus(corpus:MaterialCorpus|ModuleCorpusSlice|undefined) {
  if(!corpus)return undefined
  if('originalFingerprint' in corpus){
    const documents:PromptCorpusDocument[]=corpus.documents.flatMap(document=>{
      const paragraphs=document.paragraphs??[]
      if(document.pages||!paragraphs.some(p=>/^\s*\{\s*"kind"\s*:\s*"source-image-metadata\.v1"/u.test(p.text)))return []
      return [{...document,paragraphs:paragraphs.flatMap(p=>dateTagSpans(p.text,p.startOffset,p.paragraph))}]
    })
    if(!documents.length)return undefined
    return {...corpus,documents,selection:{...corpus.selection,method:'photo-date-original-tags.v1',
      boundary:'Only separate exact original DateTimeOriginal/timeZone tag spans and offsets are provided. Other paragraphs, tags and documents are omitted, not inspected or accepted. Complete frozen corpus remains with the validator and independent reviewer.'}}
  }
  const documents=corpus.documents.flatMap(document=>{
    if(!document.image||typeof document.text!=='string')return []
    try{if(JSON.parse(document.text)?.kind!=='source-image-metadata.v1')return []}catch{return []}
    return [{...document,text:dateTagSpans(document.text,0,1).map(s=>s.text).join('\n')}]
  })
  return documents.length?{...corpus,documents,fingerprint:materialCorpusFingerprint({documents,limitations:corpus.limitations})}:undefined
}
/** Prompt scope only. The complete frozen source identity, corpus, validation and reviewer context remain intact. */
export function moduleAuthorGroupSourceContext<T extends {readonly upstream:readonly {readonly itemId:string;readonly moduleId:string}[]}>(
  itemId:string,fields:readonly string[],sources:T,peerIds?:readonly unknown[]):Omit<T,'upstream'> & {readonly upstream:readonly Partial<T['upstream'][number]>[];readonly groupSourceScope?:SourceScope} {
  if(itemId==='1.05'&&fields.length===1&&fields[0]==='verificationTasks'){
    const upstream=sources.upstream.map(row=>{
      const published=row as T['upstream'][number]&{readonly outputs?:unknown;readonly claims?:unknown;readonly limitations?:unknown}
      const inventory=outputInventory(published.outputs)
      if(!inventory||!Array.isArray(published.claims)||!Array.isArray(published.limitations))return
      const {outputs,...retained}=published
      return {...retained,outputInventory:inventory}
    })
    if(upstream.every(row=>row!==undefined)){
      const corpus=(sources as T&{readonly corpus?:MaterialCorpus|ModuleCorpusSlice}).corpus
      const identityCorpus=corpus?{...corpus,documents:corpus.documents.map(({path,contentHash,byteLength})=>({path,contentHash,byteLength}))}:undefined
      return {...sources,...(identityCorpus?{corpus:identityCorpus}:{}),sourceValues:[],upstream,
        groupSourceScope:{fullSourceContextHash:sha256CanonicalJson(sources),upstreamClaimsAvailable:true,upstreamOutputsInventoryOnly:true,
          environmentVerificationTasksOnly:true,omitted:['corpus.source-bodies','sourceValues','upstream.outputs'],
          reason:'本组仅由原生作者选择受限环境核验任务，不重新编写敏感对象、精度、影响或测量事实。保留前组实际字段、上游全部原始claims及全部限制，原件仅列身份；未提供原文或sourceValues不能引用、视为不存在或证明现场状态。核验计划须逐项提交真实decision+proposal及选择rationale；有实际依据的inference须显式引用可用精确地址，missing不是事实证据。不得补造测量值、范围、保护状态、调查完成或许可，不由宿主选择任务或填写证据。完整原件、上游整稿和全部原生回执继续用于中央严格汇合与新独审，本组提交不是研究通过。'}}
    }
    return sources
  }
  if(itemId==='1.02'&&fields.length===1&&fields[0]==='version'){
    const corpus=(sources as T&{readonly corpus?:MaterialCorpus|ModuleCorpusSlice}).corpus
    const identityCorpus=corpus?{...corpus,documents:corpus.documents.map(({path,contentHash,byteLength})=>({path,contentHash,byteLength}))}:undefined
    return {...sources,...(identityCorpus?{corpus:identityCorpus}:{}),sourceValues:[],
      upstream:sources.upstream.map(row=>({itemId:row.itemId,moduleId:row.moduleId,
        ...('limitations' in row?{limitations:row.limitations}:{})})),
      groupSourceScope:{fullSourceContextHash:sha256CanonicalJson(sources),upstreamClaimsAvailable:false,boundaryWorkingMetadataOnly:true,
        omitted:['corpus.source-bodies','sourceValues','upstream.outputs','upstream.claims'],
        reason:'本任务只处理同一冻结记录的工作版本元数据。原件只列身份及原有限制，不提供原文或上游业务claim，库存不能作证据；未提供不表示资料不存在。依据taskContext和冻结记录，由原生作者决定是否建立受限工作版本，并按实际decision提交proposal及真实rationale；不能推定官方版本、批准、生效日期、几何或精度，没有依据仍missing/null。完整原件、上游原稿和拒稿保留给中央严格校验及独立审查，工作标识不等于研究通过。'}}
  }
  if(itemId==='3.05'&&fields.length&&fields.every(field=>peerProductFields.has(field))){
    const scoped=peerProductRecordContext(sources,peerIds)
    if(scoped)return {...sources,upstream:scoped.upstream,groupSourceScope:{fullSourceContextHash:sha256CanonicalJson(sources),upstreamClaimsAvailable:true,upstreamOutputsInventoryOnly:true,
      peerProductRecordSubsetOnly:true,selectedPeerIds:scoped.selectedPeerIds,retainedOriginalRecordIndices:scoped.retainedOriginalRecordIndices,omitted:['upstream.outputs','upstream.unassigned-peer-records'],
      reason:'本组仅处理所列peer_ID的指定产品字段。保留其上游完整原值、claimId、原始selector、来源引用、依赖闭包及对象限制，也保留全部全局限制；不重编号claim selector。只省略无依赖的其他竞品记录，以及可由原claimId和分类精确确认属于被排除claim的编译限制；无法确认归属的限制和祖先限制逐字保留。上游库存不是证据，未提供的claim不得引用或解释为不存在。完整corpus、sourceValues、inputRefs不变，来源不足的事实保持missing/null；分析判断须声明inference及真实inputRefs，不能把分析长文包装成逐字原文。全部原始竞品输出、claims及限制继续用于中央全量校验和独立审查，本组不具有模块验收权限。'}}
  }
  const marketAnchor=itemId==='3.01'&&fields.length===4&&['indicatorId','region','period','indicator'].every(field=>fields.includes(field))
  const marketValues=itemId==='3.01'&&fields.length===2&&['originalValue','normalizedValue'].every(field=>fields.includes(field))
  const marketPrice=itemId==='3.01'&&fields.length===2&&['priceBasis','revisionStatus'].every(field=>fields.includes(field))
  const peerSelection=itemId==='3.04'&&fields.length>0&&fields.every(field=>['selection','selectionReason'].includes(field))
  const peerBlindSpots=itemId==='3.04'&&fields.length>0&&fields.every(field=>field==='blindSpots')
  if((peerSelection||peerBlindSpots)&&sources.upstream.some(row=>row.itemId==='3.01')){
    const upstream=sources.upstream.map(row=>{
      const published=row as T['upstream'][number]&{readonly outputs?:unknown;readonly claims?:unknown;readonly limitations?:unknown}
      const inventory=outputInventory(published.outputs)
      if(!inventory||!Array.isArray(published.claims)||!Array.isArray(published.limitations))return
      if(row.itemId==='3.01')return {itemId:row.itemId,moduleId:row.moduleId,outputInventory:inventory}
      const {outputs,...retained}=published
      return {...retained,outputInventory:inventory}
    })
    if(upstream.every(row=>row!==undefined))return {...sources,upstream,groupSourceScope:{
      fullSourceContextHash:sha256CanonicalJson(sources),upstreamClaimsAvailable:sources.upstream.some(row=>row.itemId!=='3.01'),upstreamOutputsInventoryOnly:true,...(peerSelection?{peerSelectionOnly:true as const}:{peerBlindSpotsOnly:true as const}),
      upstreamExcludedModuleIds:sources.upstream.filter(row=>row.itemId==='3.01').map(row=>row.moduleId),
      omitted:['upstream.outputs','upstream.3.01.claims','upstream.3.01.limitations'],
      reason:peerSelection?'本组只形成已冻结同类项目记录的研究纳入/排除选择与理由。项目及区域约束的完整claims和限制保持；3.01历史宏观统计不能证明具体筛选对象的营业、审批或竞争影响，本作者仅收到其原端口范围、时点、质量、限制和字段分类库存，不得引用未提供的3.01 claim，也不能把省略解释为无市场或无业务限制。原始corpus、sourceValues、inputRefs和前组已验同类字段保持；库存不是新证据，研究选择不能升级未核现场事实。3.01完整原稿、claims、限制及全部冻结输入仍用于中央完整汇合和独立审查。':'本组仅核对已冻结同类项目记录的资料盲点，不重做市场背景或调查覆盖。项目及区域约束的完整claims和限制保持；3.01历史宏观统计不能证明具体同类项目的调查缺口，本作者仅收到其原端口范围、时点、质量、限制和字段分类库存，不得引用未提供的3.01 claim，也不能把省略解释为无市场或无业务限制。原始corpus、sourceValues、inputRefs和前组已验同类字段保持；库存及missing字段不是证据，不能由资料缺口断言现时营业、竞争影响或补全缺失事实。3.01完整原稿、claims、限制及全部冻结输入仍用于中央完整汇合和独立审查。',
    }}
  }
  if(itemId==='3.04'&&fields.length&&fields.every(field=>['address','projectType','status','statusDate','scale','scaleBasis'].includes(field))&&sources.upstream.length){
    const upstream=sources.upstream.map(row=>{
      const inventory=outputInventory((row as T['upstream'][number]&{readonly outputs?:unknown}).outputs)
      return inventory?{itemId:row.itemId,moduleId:row.moduleId,outputInventory:inventory}:undefined
    })
    if(upstream.every(row=>row!==undefined))return {...sources,upstream,groupSourceScope:{
      fullSourceContextHash:sha256CanonicalJson(sources),upstreamClaimsAvailable:false,upstreamOutputsInventoryOnly:true,peerOriginalFieldOnly:true,
      omitted:['upstream.outputs','upstream.claims','upstream.limitations'],
      reason:'本组只核对冻结同类项目记录的地址、类型、状态及其时点或规模口径，保留完整已提供原文、sourceValues、inputRefs及本分片前组实际字段。上游区域角色、历史市场统计不能证明具体项目地址、现时营业状态或规模，不得引用未提供的上游claim。outputInventory保留原端口范围、时点、质量、限制、记录身份和字段分类，库存不是证据，省略内容不表示不存在或无业务限制。原件不足保持missing/null与具体对象限制，不从规划条件或历史统计推演当前事实；名称、主体、地址仍须原文交叉核对。完整冻结上游输出、claims、限制及来源仍用于中央全量校验与独立审查，分片不具有研究验收权限。',
    }}
  }
  if(itemId==='3.01'&&(marketAnchor||marketValues||marketPrice||fields.length===1&&['denominator','formula'].includes(fields[0]))&&sources.upstream.length){
    const upstream=sources.upstream.map(row=>{
      const inventory=outputInventory((row as T['upstream'][number]&{readonly outputs?:unknown}).outputs)
      return inventory?{itemId:row.itemId,moduleId:row.moduleId,outputInventory:inventory}:undefined
    })
    if(upstream.every(row=>row!==undefined))return {...sources,upstream,groupSourceScope:{
      fullSourceContextHash:sha256CanonicalJson(sources),upstreamClaimsAvailable:false,upstreamOutputsInventoryOnly:true,marketOriginalFieldOnly:true,
      omitted:['upstream.outputs','upstream.claims','upstream.limitations'],
      reason:(marketAnchor?'本组仅从统计原文确定指标身份、地区、期间和指标名，保留完整原文、sourceValues、inputRefs；区域规划角色及空间关系稿不能替代统计表或新闻原文的地区、期间和指标名。':marketValues?'本组仅从统计原文确定原始值并按已提供原值和单位归一，保留完整原文、sourceValues、inputRefs和前组作者记录；区域规划角色及空间关系稿不能提供统计数值、来源精度或归一计算依据，不得由其推演当前需求或补缺值。':marketPrice?'本组仅从统计原文、表注和发布说明确定价格基准及修订状态，保留完整原文、sourceValues、inputRefs和前组作者记录；区域规划角色、项目经营假设和空间关系稿不能证明统计价格口径或修订版本，不得猜补基准年、价格指数或修订结论。':'本组仅研究已冻结统计记录的分母或公式，保留完整原文、sourceValues、inputRefs和前组作者记录；区域规划角色及空间关系稿不作为本字段的统计或测算依据。')+'上游仅提供原端口范围、时点、质量、限制和记录分类清单，缺省不表示无业务限制，库存不是证据。不得引用未提供的上游claim，不得从规划角色、缺失几何或历史资料推断当期需求或项目测算；原文不能支持的字段保持missing/null及具体限制。完整原始上游claims、限制、输出和原件仍保留给中央全量校验及独立审查，字段组不具有研究验收权限。',
    }}
  }
  const peerLaterFields=itemId==='3.04'&&fields.length>0&&fields.every(field=>['address','projectType','servedNeeds','relationship','status','statusDate','scale','scaleBasis','selection','selectionReason','discoveryQueries','coverage','blindSpots'].includes(field))
  const environmentalGroup=itemId==='1.05'&&fields.length>0&&fields.every(field=>environmentalFields.has(field))
  const resourceGroup=itemId==='1.06'&&fields.length>0&&fields.every(field=>resourceFields.has(field))
  const policyGroup=itemId==='1.03'&&fields.length>0&&fields.every(field=>policyFields.has(field))
  if((itemId==='1.04'||environmentalGroup||resourceGroup||policyGroup||itemId==='2.01'||itemId==='2.02'||itemId==='2.03'||itemId==='2.04'||itemId==='3.01'||itemId==='3.05'||peerLaterFields||itemId==='1.07'&&moduleGroupUsesSourceImages(itemId,fields))&&sources.upstream.length){
    const upstream=sources.upstream.map(row=>{
      const published=row as T['upstream'][number]&{readonly outputs?:unknown;readonly claims?:unknown;readonly limitations?:unknown}
      const inventory=outputInventory(published.outputs)
      if(!inventory||!Array.isArray(published.claims)||!Array.isArray(published.limitations))return
      const {outputs,...retained}=published
      return {...retained,outputInventory:inventory}
    })
    if(upstream.every(row=>row!==undefined))return {...sources,upstream,groupSourceScope:{
      fullSourceContextHash:sha256CanonicalJson(sources),upstreamClaimsAvailable:true,upstreamOutputsInventoryOnly:true,omitted:['upstream.outputs'],
      reason:(itemId==='2.04'?'本竞品空间字段组复用3.04的同一peer_ID、真实分类和限制，不另造竞品库；上游未核规模、入口、状态仍未核，不能由调查范围或地名补造坐标、OD、距离或时间。':itemId==='3.01'?'本市场背景字段组的历史统计或规划角色不能证明当前消费、客流或经营状态。':itemId==='3.04'?'本同类项目字段组中的需求关系是研究分类；历史市场统计不能证明具体项目当前需求、营业、客流或经营表现，来源不足保持未核。':'')+'本字段组保留上游全部claims（原值、分类、selector、来源与引用）及全部限制，仅省略重复的上游outputs整稿。outputInventory只保留原端口范围/时点/质量、记录身份和字段claimClass，不是新事实或证据；missing状态不得据此补值，省略整稿不表示字段不存在。引用必须使用已提供claim的完整moduleId/claimId。规划适用条件不能证明项目几何包含，道路/水系地名不能证明邻接或连通；相机坐标不能替代地物geometry，各对象现状须绑定其原始拍摄时刻，不能把missing使用属性写成已知事实。来源不足的关系保持未核，不得用摘要或限制抵消正文断言。完整上游整稿、原件和源身份仍保留给中央最终校验及独立审查。',
    }}
    return sources
  }
  if(itemId!=='1.07'||moduleGroupUsesSourceImages(itemId,fields))return sources
  const corpus=(sources as T&{readonly corpus?:MaterialCorpus|ModuleCorpusSlice}).corpus
  const dateCorpus=fields.length===1&&fields[0]==='photoDate'?datePromptCorpus(corpus):undefined
  const scoped=dateCorpus?{...sources,corpus:dateCorpus,sourceValues:[]}:sources
  return {...scoped,upstream:sources.upstream.map(({itemId,moduleId})=>({itemId,moduleId})),groupSourceScope:{
    fullSourceContextHash:sha256CanonicalJson(sources),upstreamClaimsAvailable:false,
    omitted:['upstream.outputs','upstream.claims','upstream.limitations',...(scoped!==sources?['corpus.non-photo-metadata','corpus.non-date-tags','sourceValues']:[])],
    ...(scoped!==sources?{photoDateExcerptsOnly:true as const}:{}),
    reason:'本照片元数据组仅使用冻结原始元数据与前组记录锚点。上游业务稿未送入本组，不得引用未提供的上游claim或把其缺省解释为无业务限制；完整上游保留在宿主最终校验与独立审查。',
  }}
}
