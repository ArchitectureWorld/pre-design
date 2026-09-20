import type { EffectiveWorkflowAutomationPolicy } from './types.ts'

const AUTOMATIC_SOURCE_CHECK = '已自动核对现有任务输入、来源和上游结论；未知、假设、冲突及后续验证条件已明确记录，不把自动策划结论当作外部授权或实施批准。'

/** V0.6 contracts contain a professional criterion followed by a human sign-off.
 * Compile that frozen format into V2 runtime rules; never pass the obsolete sign-off to an analyst. */
export function automaticCompletionCriteria(workflowId: string, source: readonly string[] = []): readonly string[] {
  if (source.length !== 2 || !/(?:确认|复核)/u.test(source[1]!)) {
    throw new Error(`unsupported legacy completion criteria for '${workflowId}'`)
  }
  return Object.freeze([source[0]!, AUTOMATIC_SOURCE_CHECK])
}

export function automaticMissingDataPolicy(source: string): string {
  return source
    .replace('最低仅以地区+项目性质建立 provisional 对象，并生成一个最高优先级澄清问题。', '最低以地区和项目性质建立 provisional 对象，其余信息保留 unknown 并形成自动补证任务。')
    .replace('可保留多个候选问题，但 G1 前必须人工选定或改写。', '可保留多个候选问题，系统依据证据选择当前工作假设并显式标记 assumption，用户可随时修改。')
    .replace('用途未定时仅采用内部初步决策最小深度，并把确认设为 G1 前置。', '用途未定时采用内部初步决策最小深度，记录假设并继续自动策划。')
    .replace('未确认时保存多个候选表述，不自动选定。', '保存多个候选表述，依据证据选择当前工作假设并明确标注，允许用户随时修改。')
    .replace('保留为人工审查项', '保留为专项验证任务')
    .replace('法律/财政未确认项保持 pending，作为 G8 前置。', '法律和财政条件未核实的内容保持 pending，形成附条件路径，不声称已获批准或可直接实施。')
}

function normalizedRisk(risk: string): 'L' | 'M' | 'H' {
  const normalized = risk.trim().toUpperCase()
  if (normalized === 'H' || normalized === 'HIGH') return 'H'
  if (normalized === 'M' || normalized === 'MEDIUM') return 'M'
  return 'L'
}

export function effectiveWorkflowAutomationPolicy(risk: string): EffectiveWorkflowAutomationPolicy {
  const level = normalizedRisk(risk)
  const defaults = level === 'H'
    ? { minimumConfidence: 0.88, maxAutomaticAttempts: 5 }
    : level === 'M'
      ? { minimumConfidence: 0.80, maxAutomaticAttempts: 4 }
      : { minimumConfidence: 0.72, maxAutomaticAttempts: 3 }

  return Object.freeze({
    automaticCommitAllowed: true,
    automaticGateAllowed: true,
    humanApprovalRequired: false,
    humanInteractionMode: 'override_only' as const,
    ...defaults,
  })
}
