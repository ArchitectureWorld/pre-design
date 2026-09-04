import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import type { ContractRegistry } from '../contracts/registry.ts'
import type { WorkflowDescriptor } from '../contracts/types.ts'
import type { ProjectRepository } from '../state/repository.ts'

export interface WorkflowAnalysisCandidate {
  readonly payload: Readonly<Record<string, unknown>>
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
  required: ['payload'],
  properties: {
    payload: {
      type: 'object',
      additionalProperties: true,
    },
  },
}

const ANALYST_PERSONA = [
  '你是前期策划专业工作项分析子 Agent。',
  '你只分析一个已经满足上游依赖的工作项，并返回符合目标 Schema 的候选 State Object。',
  '禁止调用工具，禁止写入 Project State，禁止确认 Gate，禁止修改 Presentation 文件。',
  '资料不足时必须使用目标 Schema 允许的 unknown、空数组、低置信度和明确限制，不得捏造事实。',
].join('\n')

function recordOf(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined
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
    '目标 JSON Schema：',
    JSON.stringify(schema, null, 2),
    '',
    '目标对象结构示例（只允许参考字段结构，禁止复制示例事实）：',
    JSON.stringify(example, null, 2),
    '',
    '本工作项实际可用的上游对象：',
    JSON.stringify(upstream, null, 2),
    '',
    '输出要求：只返回 {"payload": <完整候选对象>}。',
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
      return Object.freeze({ payload: structuredClone(payload) })
    } finally {
      await run.dispose()
    }
  }
}
