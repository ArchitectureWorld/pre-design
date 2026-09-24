import type { CommandDefinition } from '@deepseek-ai/dsh-commands'
import { loadPlanningCatalog, requireModule } from './catalog.ts'
import { candidateDeliverables, projectResearchPlan } from './planning.ts'
import { CONDITION_FIELDS, type ResearchFlags } from './types.ts'

export function createResearchPlanCommand(): CommandDefinition {
  return {
    name:'preplan-research-plan',description:'只读检查新62项研究计划、条件依赖和候选成果；不执行研究或修改项目',
    input:{hint:'[--industryPlanning=true|false|unknown] [--existingBuildings=...] [--externalPartners=...] [--marketing=...] [--item=2.03] [--json]'},
    handler: async invocation => {
      try {
        const signal = (invocation as unknown as {signal?:AbortSignal}).signal
        signal?.throwIfAborted()
        const raw = (invocation.rawInput ?? '').trim(), flags: ResearchFlags = {}, seen = new Set<string>()
        let json = false, item: string | undefined
        if (raw.length > 2000) throw new Error('CONDITION_INVALID: input too long')
        for (const token of raw ? raw.split(/\s+/u) : []) {
          if (token === '--json' && !json) {json=true;continue}
          const match = /^--([a-zA-Z]+)=(.+)$/.exec(token)
          if (!match || seen.has(match[1])) throw new Error(`CONDITION_INVALID: ${token}`)
          const [,key,value] = match; seen.add(key)
          if (key === 'item') {item=value;continue}
          if (!(CONDITION_FIELDS as readonly string[]).includes(key) || !['true','false','unknown'].includes(value)) throw new Error(`CONDITION_INVALID: ${token}`)
          flags[key as keyof ResearchFlags] = value === 'unknown' ? 'unknown' : value === 'true'
        }
        const c = loadPlanningCatalog(), p = projectResearchPlan(c,flags)
        if (item) {
          const mod = requireModule(c,item), detail = {execution:'planning_only',catalogHash:c.hash,module:mod,
            requires:c.edges.filter(e => e.target === item),selected:p.edges.filter(e => e.target === item),
            unresolved:p.unresolved.filter(e => e.target === item),deliverables:candidateDeliverables(c,item)}
          return {kind:'success',text:json ? JSON.stringify(detail,null,2) : `研究计划（只读） ${item} ${mod.title}\n${JSON.stringify(detail,null,2)}\n候选成果尚未生成；不改变旧57项执行状态。`}
        }
        if (json) return {kind:'success',text:JSON.stringify(p,null,2)}
        return {kind:'success',text:[
          '研究计划（只读） · v1.2规格 / Pre 2.1.0开发入口',
          `已启用 ${p.activeModuleIds.length} 项；不适用 ${p.inactiveModuleIds.length} 项；待判定 ${p.pendingModuleIds.length} 项。`,
          `条件未闭合或受其影响 ${p.blockedModuleIds.length} 项；可排定 ${p.waves.length} 轮依赖层级（不是模型执行轮次）。`,
          ...CONDITION_FIELDS.map(f => `${f}: ${p.flags[f] === 'unknown' ? '待判定' : p.flags[f]}`),
          `计划摘要 SHA-256: ${p.hash}`,
          '未填条件保持未知，不默认跳过。--item=2.03 查看子项；--json 输出机器可读计划。',
          '本入口不取数、不调用模型、不生成图像、不写项目。现有57项执行器仍保留，62项自动执行接入尚未启用。',
        ].join('\n')}
      } catch(error) {return {kind:'error',text:error instanceof Error ? error.message : 'RESEARCH_PLAN_FAILED'}}
    },
  }
}
