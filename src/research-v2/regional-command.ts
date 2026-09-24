import type { CommandDefinition, CommandInvocation } from '@deepseek-ai/dsh-commands'
import { RepositoryError } from '../state/repository.ts'
import { resolveInvocationWorkspaceRoot } from '../presentation/workspace-context.ts'
import { buildRegionalAuditBundle, replayRegionalAuditBundle } from './regional-bundle.ts'
import { runRegionalOd, type RegionalOdOptions } from './regional-od.ts'
import { readRegionalAuditBundle, readRegionalRequestFile, readResearchFile, researchWorkspaceRoot, saveRegionalAuditBundle } from './run-store.ts'

export interface ResearchWorkspaceBinding { readonly root: string; readonly standardProjectId: string }
export interface RegionalCommandDependencies {
  readonly readContext: (sessionId: string) => { readonly project?: { readonly projectId: string; readonly currentRevision: number } }
  readonly resolveBinding: (projectId: string) => ResearchWorkspaceBinding | undefined
  readonly now: () => Date
  /** Test/host injection, never a URL or credential supplied by request JSON. */
  readonly fetch?: RegionalOdOptions['fetch']
}

function parseOptions(raw: string) {
  if (raw.length > 1500) throw new Error('RESEARCH_COMMAND_INVALID')
  let input: string | undefined, verify: string | undefined, online = false
  // Explicit quoted paths support spaces without invoking a shell.
  const tokens = raw.match(/--(?:input|verify)=(?:"[^"\n]*"|'[^'\n]*'|[^\s]+)|--online|\S+/gu) ?? []
  for (const token of tokens) {
    if (token === '--online' && !online) { online = true; continue }
    const match = /^--(input|verify)=(.+)$/u.exec(token)
    if (!match) throw new Error('RESEARCH_COMMAND_INVALID')
    const value = match[2].replace(/^(["'])(.*)\1$/u, '$2')
    if (!value) throw new Error('RESEARCH_COMMAND_INVALID')
    if (match[1] === 'input' && !input) input = value
    else if (match[1] === 'verify' && !verify) verify = value
    else throw new Error('RESEARCH_COMMAND_INVALID')
  }
  if (Boolean(input) === Boolean(verify) || (verify && online)) throw new Error('RESEARCH_COMMAND_INVALID')
  return { input, verify, online }
}

export async function boundResearchContext(invocation: CommandInvocation, dependencies: RegionalCommandDependencies) {
  const sessionId = String(invocation.agent.id)
  const project = dependencies.readContext(sessionId).project
  if (!project) throw new Error('RESEARCH_PROJECT_REQUIRED')
  const binding = dependencies.resolveBinding(project.projectId)
  if (!binding) throw new Error('RESEARCH_WORKSPACE_BINDING_REQUIRED')
  const root = await resolveInvocationWorkspaceRoot(invocation)
  if (!root || await researchWorkspaceRoot(binding.root) !== root) throw new Error('RESEARCH_WORKSPACE_BINDING_MISMATCH')
  const identity: unknown = JSON.parse(await readResearchFile(root, 'project.json'))
  if (!identity || typeof identity !== 'object' || (identity as { projectId?: unknown }).projectId !== binding.standardProjectId) {
    throw new Error('RESEARCH_WORKSPACE_IDENTITY_MISMATCH')
  }
  return { projectId: project.projectId, revision: project.currentRevision, root, standardProjectId: binding.standardProjectId }
}

export function createRegionalOdCommand(dependencies: RegionalCommandDependencies): CommandDefinition {
  return {
    name: 'preplan-research-od',
    description: '计算地域距离、保存独立图表审计包；默认离线，--online才查询公开OSRM；--verify无网络复算',
    input: { hint: '--input=工作区内请求.json [--online] 或 --verify=RUN-…' },
    handler: async invocation => {
      try {
        const options = parseOptions(invocation.rawInput ?? '')
        const signal = (invocation as unknown as { readonly signal?: AbortSignal }).signal
        signal?.throwIfAborted()
        const context = await boundResearchContext(invocation, dependencies)
        const unchanged = async () => {
          signal?.throwIfAborted()
          const latest = await boundResearchContext(invocation, dependencies)
          if (JSON.stringify(latest) !== JSON.stringify(context)) throw new Error('RESEARCH_CONTEXT_CHANGED')
        }
        if (options.verify) {
          const bundle = await readRegionalAuditBundle(context.root, options.verify)
          if (bundle.manifest.projectId !== context.projectId) throw new Error('RESEARCH_PROJECT_MISMATCH')
          const verified = await replayRegionalAuditBundle(bundle)
          await unchanged()
          return { kind: 'success', text: `地域审计包复算通过：${options.verify}\n${JSON.stringify(verified)}\n仅验证保存的数据与计算一致；未独立核验来源真实性，也不授予正式发布资格。` }
        }
        const { request } = await readRegionalRequestFile(context.root, options.input!)
        if (request.projectId !== context.projectId) throw new Error('RESEARCH_PROJECT_MISMATCH')
        const result = await runRegionalOd(request, { allowNetwork: options.online, fetch: dependencies.fetch, now: dependencies.now, signal })
        const bundle = buildRegionalAuditBundle(result)
        // A successful write publishes an immutable research snapshot, NOT an old-workflow approval.
        const saved = await saveRegionalAuditBundle(context.root, bundle, { signal, beforeCommit: unchanged })
        return { kind: 'success', text: [
          `地域分析已保存：${saved.relativePath}/report.html`,
          `快照：${result.snapshotId}；OD记录 ${result.rows.length}；路由请求 ${result.usage.requests}/${result.usage.limit}。`,
          `状态：条件性研究结果；缺失道路距离与时间保留为空，不冒充0；未授予正式发布资格。`,
          `复算：/preplan-research-od --verify=${saved.runId}`,
          '未改变旧57项执行状态、项目修订或工作区身份；本命令不是62项全自动执行器。',
        ].join('\n') }
      } catch (error) {
        const code = error instanceof RepositoryError && error.code === 'session-not-bound'
          ? 'RESEARCH_PROJECT_REQUIRED'
          : error instanceof Error ? error.message : 'RESEARCH_EXECUTION_FAILED'
        // Do not echo parser values, raw provider bodies, credentials or absolute filesystem paths to the chat.
        const safe = /^[A-Z][A-Z0-9_]+$/u.test(code) ? code : 'RESEARCH_EXECUTION_FAILED'
        return { kind: 'error', text: `${safe}：研究未完成或未发布；请检查输入、项目绑定和资料条件。` }
      }
    },
  }
}
