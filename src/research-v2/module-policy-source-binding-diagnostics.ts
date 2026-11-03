import type {MaterialCorpus} from '../materials/research-evidence.ts'
import {sha256CanonicalJson} from '../presentation/canonical-json.ts'
import {moduleSourceTextConflicts} from './module-source-text-diagnostics.ts'

export const policySourceRecordBindingProtocol='文件记录来源归属协议 policy-source-record-binding.v1：每条原生记录及每个source字段分别回查实际文件的对象、标题、年代、发布事项和连续原文。sourceRecordBindingReadback对照原稿声明的source.path/page与同一拒稿引文在冻结原件中的实际位置；differentSourceIdentityObserved表示位置身份不同，仅修订quote的空白不能解决绑定到另一份文件的错误。原始审计、原回执和原件保持不变，不要求新稿保留错误的source.path；由你核对文件归属及字段语义后原生修订完整证据绑定。actualQuoteLocations仅是实际匹配位置，不是推荐来源、认可的替代绑定或通过状态；不能机械互换路径、只按顺序/工作编号配对、改变字段分类或扩写业务值过检。发布机构、网页发布时间、文件发布日与施行日各自承担证据责任，两个文件即使来自同一门户也不能混用。保留真实工作documentId的决策理由及证据，未知事实保持missing/null和具体限制。宿主不填专业值、替代引文或来源绑定；原生完整修订、中央严格校验、完整汇合及新的独立审查继续执行。'

/** Only original rejected identities and observed quote locations are organized.
 * The author still chooses and submits every business value and source binding. */
export function modulePolicySourceBindingFeedback(itemId:string|undefined,groupId:string|undefined,submitted:unknown,corpus?:MaterialCorpus):string {
  if(itemId!=='1.03'||groupId!=='planning_conditions:1'||!corpus||!submitted||typeof submitted!=='object'||Array.isArray(submitted)
    ||(submitted as {groupId?:unknown}).groupId!==groupId)return ''
  const observed=moduleSourceTextConflicts(submitted,corpus).filter(conflict=>conflict.diagnosticCode==='MODULE_SOURCE_VALUE_QUOTE'
    &&conflict.target.port==='planning_conditions'&&['documentId','documentNumber','issuer','publishedDate'].includes(conflict.target.field)
    &&conflict.quoteLocationMatches?.some(location=>location.path!==conflict.path||location.page!==conflict.page))
  if(!observed.length)return ''
  const conflicts=observed.slice(0,24).map(conflict=>{const locations=conflict.quoteLocationMatches??[];return {target:structuredClone(conflict.target),
    declaredSource:{path:conflict.path,contentHash:conflict.contentHash,...(conflict.page===undefined?{}:{page:conflict.page})},
    quoteHash:conflict.quoteHash,rawValueHash:conflict.rawValueHash,differentSourceIdentityObserved:true,
    actualQuoteLocations:structuredClone(locations.slice(0,4)),
    quoteLocationsTruncated:conflict.quoteLocationMatchesTruncated||locations.length>4}})
  return policySourceRecordBindingProtocol+'\n'+JSON.stringify({sourceRecordBindingReadback:{version:'policy-source-record-binding-readback.v1',
    originalSubmissionHash:sha256CanonicalJson(submitted),completeSubmission:false,sourceBindingsApproved:false,
    conflicts,conflictsTruncated:observed.length>24,boundary:'Original target and source identities only. Quote locations are diagnostics, not selected evidence, replacement values or accepted bindings. Recheck the actual document before a complete native revision; unchanged validation and independent review remain required.'}})
}
