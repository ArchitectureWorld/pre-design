import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import type { ContractRegistry } from '../contracts/registry.ts'
import type { WorkflowDescriptor } from '../contracts/types.ts'
import type { ProjectRepository } from '../state/repository.ts'
import type { WorkflowQualityEvidence } from './workflow-quality.ts'

export interface WorkflowAnalysisCandidate {
  readonly payload: Readonly<Record<string, unknown>>
  /** Analyzer-produced evidence is required by the automatic executor; optional keeps legacy/manual callers source-compatible. */
  readonly qualityEvidence?: WorkflowQualityEvidence
}

interface DshSubagentWorkflowAnalyzerDependencies {
  readonly subagents: Pick<SubagentRuntime, 'getProvider' | 'start'>
  readonly repository: Pick<ProjectRepository, 'readContext'>
  readonly registry: Pick<ContractRegistry, 'stateSchema' | 'stateExample'>
  readonly timeoutMs?: number
}

const ANALYSIS_OUTPUT_SCHEMA: ObjectJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['payload', 'qualityEvidence'],
  properties: {
    payload: {
      type: 'object',
      additionalProperties: true,
    },
    qualityEvidence: {
      type: 'object',
      additionalProperties: false,
      required: ['completionChecks', 'evidenceChecks', 'assumptions', 'blockers', 'confidence'],
      properties: {
        completionChecks: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['criterion', 'status', 'rationale'],
            properties: {
              criterion: { type: 'string' },
              status: { type: 'string', enum: ['pass', 'gap', 'block'] },
              rationale: { type: 'string' },
            },
          },
        },
        evidenceChecks: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['policy', 'status', 'rationale'],
            properties: {
              policy: { type: 'string' },
              status: { type: 'string', enum: ['pass', 'gap', 'block'] },
              rationale: { type: 'string' },
            },
          },
        },
        assumptions: { type: 'array', items: { type: 'string' } },
        blockers: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['code', 'kind', 'message'],
            properties: {
              code: { type: 'string' },
              kind: { type: 'string', enum: ['external', 'quality', 'conflict'] },
              message: { type: 'string' },
            },
          },
        },
        confidence: { type: 'number' },
      },
    },
  },
}

const ANALYST_PERSONA = [
  '你是前期策划专业工作项分析子 Agent。',
  '你只分析一个已经满足上游依赖的工作项，并返回符合目标 Schema 的候选 State Object。',
  '你必须逐条核对 Contract 的完成条件与证据规则，并返回结构化 qualityEvidence；不能只做 Schema 填充。',
  '禁止调用工具，禁止写入 Project State，禁止确认 Gate，禁止修改 Presentation 文件。',
  'Contract 中列出的原子工具是专业方法依赖提示；当前没有工具权限时，不得伪装已经执行，缺少必要工具结果必须显式记录 blocker 或 gap。',
  '资料不足时必须使用目标 Schema 允许的 unknown、空数组、低置信度和明确限制，不得捏造事实、评分、比例、排名、趋势或金额。',
].join('\n')

function recordOf(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined
}

function qualityEvidenceOf(value: unknown, workflowId: string): WorkflowQualityEvidence {
  const record = recordOf(value)
  if (record === undefined
    || !Array.isArray(record.completionChecks)
    || !Array.isArray(record.evidenceChecks)
    || !Array.isArray(record.assumptions)
    || !Array.isArray(record.blockers)
    || typeof record.confidence !== 'number'
    || !Number.isFinite(record.confidence)
    || record.confidence < 0
    || record.confidence > 1) {
    throw new Error(`workflow '${workflowId}' returned no structured quality evidence`)
  }
  return structuredClone(record) as unknown as WorkflowQualityEvidence
}

function analysisPrompt(
  project: { readonly projectId: string; readonly name: string; readonly currentRevision: number },
  descriptor: WorkflowDescriptor,
  schema: Readonly<Record<string, unknown>>,
  example: Readonly<Record<string, unknown>>,
  upstream: readonly {
    readonly objectId: string
    readonly revision: number
    readonly value: unknown
  }[],
): string {
  return [
    `项目：${project.name}（${project.projectId}）`,
    `当前 Revision：${project.currentRevision}`,
    `唯一工作流：${descriptor.workflowId}`,
    `目标对象：${descriptor.targetObjectId}`,
    `任务：${descriptor.title}`,
    `目的：${descriptor.purpose}`,
    `缺失资料策略：${descriptor.missingDataPolicy}`,
    '',
    '完成条件（必须逐条检查）：',
    JSON.stringify(descriptor.completionCriteria ?? [], null, 2),
    '',
    '证据规则（必须逐条检查）：',
    JSON.stringify(descriptor.evidencePolicy ?? [], null, 2),
    '',
    '禁止动作：',
    JSON.stringify(descriptor.forbiddenActions ?? [], null, 2),
    '',
    '允许的原子工具/方法依赖（仅作为方法约束；当前子 Agent 无工具权限）：',
    JSON.stringify(descriptor.atomicToolIds, null, 2),
    '',
    '目标 JSON Schema：',
    JSON.stringify(schema, null, 2),
    '',
    '目标对象结构示例（只允许参考字段结构，禁止复制示例事实）：',
    JSON.stringify(example, null, 2),
    '',
    '本工作项实际可用的上游对象：',
    JSON.stringify(upstream, null, 2),
    '',
    '输出要求：只返回结构化对象 {"payload": <完整候选对象>, "qualityEvidence": {...}}。',
    'qualityEvidence.completionChecks 必须逐条对应上面的完成条件；evidenceChecks 必须逐条对应上面的证据规则；不得省略未通过项。',
    'qualityEvidence.blockers.kind 只能是 external、quality、conflict；资料/工具由外部才能补齐用 external，模型可自行修订用 quality，证据互相矛盾需裁决用 conflict。',
    'confidence 必须在 0 到 1 之间，并反映当前证据对本工作项结论的真实支持程度。',
    '候选对象中的 object_id、project_id、chapter_id、work_item_id、状态、Revision、时间、创建者、source_snapshot 和 approval 元数据将由中央提交服务覆盖。',
    '不得输出解释性 Markdown，不得处理其他工作项。',
  ].join('\n')
}

export class DshSubagentWorkflowAnalyzer {
  private readonly timeoutMs: number

  constructor(private readonly dependencies: DshSubagentWorkflowAnalyzerDependencies) {
    this.timeoutMs = dependencies.timeoutMs ?? 300_000
  }

  available(): boolean {
    return this.dependencies.subagents.getProvider('spawn') !== undefined
  }

  async analyze(
    parent: Agent,
    projectId: string,
    descriptor: WorkflowDescriptor,
    signal: AbortSignal = AbortSignal.timeout(this.timeoutMs),
  ): Promise<WorkflowAnalysisCandidate> {
    if (!this.available()) throw new Error("subagent provider 'spawn' is unavailable")
    const context = this.dependencies.repository.readContext(String(parent.id))
    if (context.project.projectId !== projectId) {
      throw new Error(`parent Session is bound to '${context.project.projectId}', not '${projectId}'`)
    }
    const stateByObject = new Map(context.stateObjects.map(record => [record.objectId, record]))
    const upstream = descriptor.requiredUpstream
      .filter(objectId => objectId !== 'ProjectSeed')
      .map((objectId) => {
        const record = stateByObject.get(objectId)
        if (record === undefined) {
          throw new Error(`required upstream object '${objectId}' is unavailable`)
        }
        return {
          objectId,
          revision: record.revision,
          value: record.value,
        }
      })
    const prompt = analysisPrompt(
      context.project,
      descriptor,
      this.dependencies.registry.stateSchema(descriptor.targetObjectId),
      this.dependencies.registry.stateExample(descriptor.targetObjectId),
      upstream,
    )
    const run = await this.dependencies.subagents.start('spawn', {
      parent,
      prompt: [{ type: 'text', text: prompt }],
      signal,
      outputSchema: ANALYSIS_OUTPUT_SCHEMA,
      maxDepth: 1,
      toolFilter: { allow: [] },
      persona: ANALYST_PERSONA,
      label: `preplanning_workflow:${projectId}:${descriptor.workflowId}`,
    })
    try {
      const result = await run.result
      if (result.stopReason !== 'completed') {
        throw new Error(result.diagnostic
          ?? `workflow analysis ended with ${result.stopReason}`)
      }
      const structured = recordOf(result.structured)
      const payload = recordOf(structured?.payload)
      if (payload === undefined) {
        throw new Error(`workflow '${descriptor.workflowId}' returned no structured payload`)
      }
      const qualityEvidence = qualityEvidenceOf(structured?.qualityEvidence, descriptor.workflowId)
      return Object.freeze({
        payload: structuredClone(payload),
        qualityEvidence,
      })
    } finally {
      await run.dispose()
    }
  }
}
