import type { Context } from '@deepseek-ai/cordis'
import type { CommandDefinition, CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { ContractRegistry } from '../contracts/registry.ts'
import type { GovernanceRepository } from '../governance/repository.ts'
import type { GateDecisionRecord } from '../governance/types.ts'
import type { ProposalGateway } from '../proposals/gateway.ts'
import type { ReportPackageService } from '../report/package-service.ts'
import type { AutomationService } from '../runtime/automation-service.ts'
import type { AutomationCoordinator } from '../runtime/coordinator.ts'
import type { GateService } from '../runtime/gate-service.ts'
import type { RevisionService } from '../runtime/revision-service.ts'
import type { WorkflowRuntime } from '../runtime/workflow-runtime.ts'
import type { ProjectRepository } from '../state/repository.ts'
import type { VisualAgentService } from '../visual/agent.ts'
import { buildPreplanningStatus, formatPreplanningStatus } from '../session/events.ts'

export interface CommandDependencies {
  readonly repository: ProjectRepository
  readonly gateway: ProposalGateway
  readonly governance: GovernanceRepository
  readonly runtime: WorkflowRuntime
  readonly automation: AutomationService
  readonly gates: GateService
  readonly revisions: RevisionService
  readonly coordinator: AutomationCoordinator
  readonly visual: VisualAgentService
  readonly reports: ReportPackageService
  readonly registry: ContractRegistry
  readonly createId: () => string
  readonly now: () => string
}

function actorOf(invocation: CommandInvocation) {
  return { actorId: `dsh-user:${String(invocation.agent.id)}`, name: 'DSH 用户', role: 'decision_owner' }
}

function guarded(handler: (invocation: CommandInvocation) => Promise<CommandResult>): CommandDefinition['handler'] {
  return async (invocation) => {
    try {
      return await handler(invocation)
    } catch (error) {
      return { kind: 'error', text: error instanceof Error ? error.message : '前期策划操作失败' }
    }
  }
}

function successWithStatus(
  text: string,
  context: ReturnType<ProjectRepository['readContext']>,
  dependencies: Pick<CommandDependencies, 'governance' | 'runtime'>,
): CommandResult {
  return { kind: 'success', text: `${text}\n${formatPreplanningStatus(buildPreplanningStatus(context, dependencies))}` }
}

export function registerPreplanningCommands(ctx: Context, dependencies: CommandDependencies): void {
  const { repository, gateway, governance, runtime } = dependencies
  const definitions: CommandDefinition[] = [
    {
      name: 'preplan-new',
      description: '新建并绑定一个前期策划项目',
      input: { hint: '<项目名称>' },
      handler: guarded(async (invocation) => {
        const name = invocation.rawInput.trim()
        if (name.length === 0) return { kind: 'error', text: '请输入项目名称。' }
        const project = await repository.createProject({
          projectId: dependencies.createId(),
          name,
          sessionId: String(invocation.agent.id),
          createdAt: dependencies.now(),
          actor: actorOf(invocation),
        })
        await runtime.initializeProject(project.projectId)
        await governance.createPolicy({
          projectId: project.projectId,
          mode: 'manual',
          reportDepth: 'standard',
          updatedAt: dependencies.now(),
        })
        return successWithStatus(
          `已创建项目“${project.name}”（${project.projectId}）。`,
          repository.readContext(String(invocation.agent.id)),
          dependencies,
        )
      }),
    },
    {
      name: 'preplan-open',
      description: '将当前会话绑定到已有前期策划项目',
      input: { hint: '<projectId>' },
      handler: guarded(async (invocation) => {
        const projectId = invocation.rawInput.trim()
        if (projectId.length === 0) return { kind: 'error', text: '请输入 projectId。' }
        await repository.bindSession(String(invocation.agent.id), projectId, dependencies.now())
        const context = repository.readContext(String(invocation.agent.id))
        return successWithStatus(`已打开项目“${context.project.name}”。`, context, dependencies)
      }),
    },
    {
      name: 'preplan-list',
      description: '列出已持久化的前期策划项目',
      handler: guarded(async () => {
        const projects = repository.listProjects()
        return {
          kind: 'success',
          text: projects.length === 0
            ? '暂无前期策划项目。'
            : `项目列表：\n${projects.map(project => `- ${project.name}（${project.projectId}）· revision ${project.currentRevision}`).join('\n')}`,
        }
      }),
    },
    {
      name: 'preplan-status',
      description: '显示当前会话绑定项目的前期策划状态',
      handler: guarded(async (invocation) => {
        const context = repository.readContext(String(invocation.agent.id))
        const pending = context.proposals.filter(proposal => proposal.status === 'pending_review').length
        const open = context.questions.filter(question => question.status === 'open').length
        return successWithStatus(
          `${context.project.name}：revision ${context.project.currentRevision}，待确认 ${pending} 项，开放问题 ${open} 项。`,
          context,
          dependencies,
        )
      }),
    },
    {
      name: 'preplan-confirm',
      description: '以自然人决策责任人身份确认待审提案',
      input: { hint: '<proposalId>' },
      handler: guarded(async (invocation) => {
        const proposalId = invocation.rawInput.trim()
        if (proposalId.length === 0) return { kind: 'error', text: '请输入 proposalId。' }
        const before = repository.readContext(String(invocation.agent.id))
        const proposal = before.proposals.find(row => row.proposalId === proposalId)
        const result = await gateway.confirmProposal(proposalId, actorOf(invocation), String(invocation.agent.id))
        const workflowId = (proposal?.envelope as { readonly workflow_id?: unknown } | undefined)?.workflow_id
        if (typeof workflowId === 'string') {
          const run = runtime.snapshot(result.projectId).runs.find(row => row.workflowId === workflowId)
          if (run?.status === 'pending_review') {
            await runtime.transition(result.projectId, workflowId, {
              to: 'confirmed', proposalId, revision: result.revision,
            })
          }
        }
        return successWithStatus(
          `已确认提案 ${result.proposalId}，当前 revision ${result.revision}。`,
          repository.readContext(String(invocation.agent.id)),
          dependencies,
        )
      }),
    },
    {
      name: 'preplan-mode',
      description: '切换人工确认或经责任人授权的全自动模式',
      input: { hint: '<manual|automatic> [概念图预算0-20] [standard|extended]' },
      handler: guarded(async (invocation) => {
        const [mode, rawBudget, rawDepth] = invocation.rawInput.trim().split(/\s+/u)
        if (mode !== 'manual' && mode !== 'automatic') {
          return { kind: 'error', text: '请输入 manual 或 automatic。' }
        }
        const context = repository.readContext(String(invocation.agent.id))
        const governed = governance.readProject(context.project.projectId)
        const visualBudget = rawBudget === undefined ? 20 : Number(rawBudget)
        if (!Number.isInteger(visualBudget) || visualBudget < 0 || visualBudget > 20) {
          return { kind: 'error', text: '概念图预算必须是 0 至 20 的整数。' }
        }
        const reportDepth = rawDepth ?? governed.policy?.reportDepth ?? 'standard'
        if (reportDepth !== 'standard' && reportDepth !== 'extended') {
          return { kind: 'error', text: '报告深度请输入 standard 或 extended。' }
        }
        const visualPolicyId = governed.policy?.visualPolicyId ?? `${context.project.projectId}:visual-policy`
        await governance.putVisualPolicy({
          policyId: visualPolicyId,
          projectId: context.project.projectId,
          enabled: visualBudget > 0,
          targetConceptImages: visualBudget,
          maxAttemptsPerTask: 3,
          allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
          minWidth: 1024,
          minHeight: 768,
          projectGenerationBudget: visualBudget,
          updatedAt: dependencies.now(),
        })
        if (mode === 'automatic') {
          const authorization = await dependencies.automation.authorize(context.project.projectId, {
            baseRevision: context.project.currentRevision,
            workflowIds: dependencies.registry.workflows().map(row => row.workflowId),
            gateIds: dependencies.registry.gates().map(row => row.gateId),
            maxImages: visualBudget,
            maxModelTurns: 120,
            stopOnBlocking: true,
            reportDepth,
          }, actorOf(invocation))
          await governance.putPolicy({
            projectId: context.project.projectId,
            mode: 'automatic',
            reportDepth,
            visualPolicyId,
            automationAuthorizationId: authorization.authorizationId,
            updatedAt: dependencies.now(),
          })
          return {
            kind: 'success',
            text: `已切换为全自动模式；授权 ${authorization.authorizationId} 覆盖 57 个工作项、8 个 Gate，最多 ${visualBudget} 张概念图和 120 个模型轮次。`,
          }
        }
        const active = governed.authorizations.find(row => row.status === 'active')
        if (active !== undefined) {
          await dependencies.automation.revoke(
            context.project.projectId,
            active.authorizationId,
            actorOf(invocation),
            'DSH 用户切换为人工确认模式',
          )
        } else {
          await governance.putPolicy({
            projectId: context.project.projectId,
            mode: 'manual',
            reportDepth,
            visualPolicyId,
            updatedAt: dependencies.now(),
          })
        }
        if (active !== undefined) {
          await governance.putPolicy({
            projectId: context.project.projectId,
            mode: 'manual',
            reportDepth,
            visualPolicyId,
            updatedAt: dependencies.now(),
          })
        }
        return { kind: 'success', text: '已切换为人工确认模式。' }
      }),
    },
    {
      name: 'preplan-run',
      description: '从当前就绪工作项开始或继续运行前期策划',
      handler: guarded(async (invocation) => {
        const context = repository.readContext(String(invocation.agent.id))
        await dependencies.coordinator.start(invocation.agent, context.project.projectId)
        return { kind: 'success', text: `项目“${context.project.name}”已开始继续前期策划。` }
      }),
    },
    {
      name: 'preplan-pause',
      description: '在当前模型轮次结束后暂停前期策划自动推进',
      handler: guarded(async (invocation) => {
        const context = repository.readContext(String(invocation.agent.id))
        await dependencies.coordinator.pause(context.project.projectId)
        return { kind: 'success', text: `项目“${context.project.name}”将在当前轮次结束后暂停。` }
      }),
    },
    {
      name: 'preplan-gate',
      description: '由当前自然人决策责任人确认一个章节 Gate',
      input: { hint: '<G1-G8> <approved|approved_with_conditions|returned|blocked> [原因]' },
      handler: guarded(async (invocation) => {
        const [gateId, rawDecision, ...reasonParts] = invocation.rawInput.trim().split(/\s+/u)
        const decisions: readonly GateDecisionRecord['decision'][] = [
          'approved', 'approved_with_conditions', 'returned', 'blocked',
        ]
        if (gateId === undefined || rawDecision === undefined || !decisions.includes(rawDecision as GateDecisionRecord['decision'])) {
          return { kind: 'error', text: '请输入 Gate、决定和可选原因。' }
        }
        const context = repository.readContext(String(invocation.agent.id))
        const record = await dependencies.gates.decideGate(context.project.projectId, gateId, {
          source: 'human_review',
          decision: rawDecision as GateDecisionRecord['decision'],
          actor: actorOf(invocation),
          ...(reasonParts.length === 0 ? {} : { reason: reasonParts.join(' ') }),
        })
        return { kind: 'success', text: `Gate ${record.gateId} 已记录为 ${record.decision}。` }
      }),
    },
    {
      name: 'preplan-revise',
      description: '按对象依赖图最小范围重开需要修订的下游工作项',
      input: { hint: '<objectId[,objectId...]> <修订原因>' },
      handler: guarded(async (invocation) => {
        const [rawObjects, ...reasonParts] = invocation.rawInput.trim().split(/\s+/u)
        const objectIds = rawObjects?.split(',').map(value => value.trim()).filter(Boolean) ?? []
        const reason = reasonParts.join(' ').trim()
        if (objectIds.length === 0 || reason.length === 0) return { kind: 'error', text: '请输入对象 ID 和修订原因。' }
        const context = repository.readContext(String(invocation.agent.id))
        const affected = await dependencies.revisions.reopen(context.project.projectId, objectIds, {
          requestId: dependencies.createId(), reason, actor: actorOf(invocation),
        })
        return { kind: 'success', text: `已重开 ${affected.length} 个下游对象：${affected.join('、') || '无'}。` }
      }),
    },
    {
      name: 'preplan-visual',
      description: '通过固定 Gemini 项目级子 Agent 生成一张概念表现候选图',
      input: { hint: '<taskId> <章节ID> <工作项ID> <生图要求>' },
      handler: guarded(async (invocation) => {
        const [taskId, chapterId, workItemId, ...promptParts] = invocation.rawInput.trim().split(/\s+/u)
        const prompt = promptParts.join(' ').trim()
        if (taskId === undefined || !/^[A-Za-z0-9._-]+$/u.test(taskId)
          || chapterId === undefined || !/^\d{2}$/u.test(chapterId)
          || workItemId === undefined || !/^\d{2}-\d{2}$/u.test(workItemId)
          || prompt.length === 0) {
          return { kind: 'error', text: '请输入 taskId、两位章节 ID、工作项 ID 和完整生图要求。' }
        }
        const context = repository.readContext(String(invocation.agent.id))
        const asset = await dependencies.visual.generate(invocation.agent, {
          taskId,
          projectId: context.project.projectId,
          chapterId,
          workItemId,
          kind: 'concept',
          required: true,
          prompt,
        })
        return {
          kind: 'success',
          text: `概念表现候选图 ${asset.assetId} 已由 antigravity / gemini-3.1-flash-image 生成；请人工核对后使用 /preplan-visual-adopt ${asset.assetId} 采用。`,
        }
      }),
    },
    {
      name: 'preplan-visual-adopt',
      description: '由当前自然人决策责任人采用已通过质量检查的概念表现图',
      input: { hint: '<assetId>' },
      handler: guarded(async (invocation) => {
        const assetId = invocation.rawInput.trim()
        if (!/^[A-Za-z0-9._-]+$/u.test(assetId)) return { kind: 'error', text: '请输入合法 assetId。' }
        const context = repository.readContext(String(invocation.agent.id))
        const asset = await dependencies.visual.adopt(
          context.project.projectId,
          assetId,
          context.project.currentRevision,
        )
        return { kind: 'success', text: `已采用概念表现图 ${asset.assetId}，绑定 Revision ${asset.adoptedRevision}。` }
      }),
    },
    {
      name: 'preplan-export',
      description: '生成并下载同一 Revision 的甲方汇报成果',
      handler: guarded(async (invocation) => {
        const context = repository.readContext(String(invocation.agent.id))
        const manifest = await dependencies.reports.publish(
          context.project.projectId,
          context.project.currentRevision,
        )
        const links = manifest.artifacts.map(artifact =>
          `- ${artifact.format.toUpperCase()}：/preplan-export/${manifest.packageId}/${artifact.fileName}`,
        )
        return {
          kind: 'success',
          text: `已原子发布 Revision ${manifest.sourceRevision} 的甲方汇报成果：\n${links.join('\n')}`,
        }
      }),
    },
  ]
  for (const definition of definitions) ctx.commands.register(definition)
}
