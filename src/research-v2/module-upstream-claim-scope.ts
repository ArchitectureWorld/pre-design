import type {ClaimUpstream} from './module-claims.ts'
import type {ModuleAnalysisContext,ModuleInputReference} from './module-execution.ts'

/** The same declared-port boundary used by complete validation and replay.
 * Original upstream results and their background outputs remain unchanged. */
export function moduleScopedUpstream<T extends ClaimUpstream>(upstream:readonly T[],
 inputRefs:readonly Pick<ModuleInputReference,'moduleId'|'selector'>[]):T[]{
 return upstream.map(row=>({...row,claims:row.claims.filter(claim=>inputRefs.some(ref=>
  ref.moduleId===row.moduleId&&claim.selector.startsWith(ref.selector+'/')))}))
}
export function moduleInputClaimScopePrompt(context:Pick<ModuleAnalysisContext,'inputRefs'>){
 const selectors=[...new Map(context.inputRefs.map(({moduleId,selector})=>[JSON.stringify([moduleId,selector]),{moduleId,selector}])).values()]
 return {selectors,rule:'upstream引用仅限sources.upstream内moduleId匹配本表且claim.selector以本表selector加/开头的非missing声明。完整上游其他端口保留作背景，但不能作为本模块inputRefs或计算operands/weights；看得到声明不等于本模块接收了该端口。核对原字段含义、适用限制和实际支持，不得猜造地址或为过检改写结论。'}
}
