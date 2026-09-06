import { realpath } from 'node:fs/promises'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContractRegistry } from '../contracts/registry.ts'
import type { ProjectRepository } from '../state/repository.ts'
import type { FrozenProjectInput } from '../report/types.ts'
import type { PresentationStandardProjectService } from './standard-project-service.ts'
import type { PageVisualFillService, StudioVisualInput, StudioVisualResult } from './page-visual-fill.ts'
import { sha256CanonicalJson } from './canonical-json.ts'

export const DESIGN_VISUAL_PROTOCOL = 'pre-design.page-visual.v1' as const
export interface DesignVisualInput {
  readonly runId: string
  readonly studioProjectId: string
  readonly pageId: string
  readonly sourceStateHash: string
  readonly requestId: string
  readonly prompt: string
  readonly style?: string
}
export interface ResolvedDesignVisualContext {
  readonly preDesignProjectId: string
  readonly studioProjectId: string
  readonly pageId: string
  readonly workspaceRoot: string
  readonly studioProjectRevision: number
  readonly sourceStateHash: string
  readonly sourceObjectIds: readonly string[]
  readonly title: string
  readonly keyMessage: string
  readonly grant: { readonly runId: string; readonly sessionId: string; readonly allowVisualGeneration: boolean; readonly allowApply: boolean; readonly expiresAt: string }
}
export interface TrustedStudioVisualResolver {
  readonly protocol: typeof DESIGN_VISUAL_PROTOCOL
  resolve(input: Pick<DesignVisualInput, 'runId' | 'studioProjectId' | 'pageId' | 'sourceStateHash'> & {
    readonly parent: Agent
    readonly operation: 'inspect' | 'generate' | 'adopt'
    /** Host-only identity, filled only after checking the durable candidate and target. */
    readonly candidate?: { readonly requestId: string; readonly assetId: string }
  }): Promise<ResolvedDesignVisualContext>
}
export interface DesignVisualBridge {
  readonly protocol: typeof DESIGN_VISUAL_PROTOCOL
  bindStudioResolver(resolver: TrustedStudioVisualResolver): () => void
  inspect(parent: Agent, input: DesignVisualInput, signal?: AbortSignal): Promise<ResolvedDesignVisualContext>
  generate(parent: Agent, input: DesignVisualInput, signal?: AbortSignal): Promise<StudioVisualResult>
  adopt(parent: Agent, input: DesignVisualInput & { readonly assetId: string }, signal?: AbortSignal): Promise<StudioVisualResult>
}
interface Dependencies {
  readonly repository: Pick<ProjectRepository, 'readContext'>
  readonly registry: Pick<ContractRegistry, 'workflows'>
  readonly standardProjects: Pick<PresentationStandardProjectService, 'findByPreDesignProjectId'>
  readonly source: (projectId: string, revision: number) => FrozenProjectInput | Promise<FrozenProjectInput>
  readonly pageVisualFill: PageVisualFillService
  readonly now?: () => string
}
function fail(code: string): never { throw new Error(`DESIGN_VISUAL_${code}: 当前汇报页面或宿主授权不可用`) }
function text(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0 && value === value.trim() && !/[\u0000-\u001f]/u.test(value) }

/** A frozen host capability. Only Studio's server can own the resolver; model JSON carries no authority. */
export function createDesignVisualBridge(dependencies: Dependencies): DesignVisualBridge {
  let owner: { resolver: TrustedStudioVisualResolver } | undefined
  async function resolveContext(parent: Agent, input: DesignVisualInput, operation: 'inspect' | 'generate' | 'adopt', signal?: AbortSignal,
    candidate?: { requestId: string; assetId: string }): Promise<{ context: ResolvedDesignVisualContext; fill: StudioVisualInput }> {
    signal?.throwIfAborted()
    for (const key of Object.keys(input)) if (!['runId', 'studioProjectId', 'pageId', 'sourceStateHash', 'requestId', 'prompt', 'style', ...(operation === 'inspect' || operation === 'adopt' ? ['assetId'] : [])].includes(key)) fail('INPUT')
    if (![input.runId, input.studioProjectId, input.pageId, input.requestId, input.prompt].every(text)
      || !/^[a-f0-9]{64}$/u.test(input.sourceStateHash) || (input.style !== undefined && !text(input.style))) fail('INPUT')
    const active = owner
    if (!active) fail('RESOLVER_UNAVAILABLE')
    if (!parent || !text(String(parent.id ?? '')) || String(parent.session?.id ?? '') !== String(parent.id)) fail('SESSION')
    const sessionId = String(parent.id)
    const pre = dependencies.repository.readContext(sessionId)
    const context = structuredClone(await active.resolver.resolve({ parent, operation, runId: input.runId,
      studioProjectId: input.studioProjectId, pageId: input.pageId, sourceStateHash: input.sourceStateHash, ...(candidate ? { candidate } : {}) }))
    signal?.throwIfAborted()
    if (owner !== active) fail('RESOLVER_UNAVAILABLE')
    if (context.preDesignProjectId !== pre.project.projectId || context.studioProjectId !== input.studioProjectId || context.pageId !== input.pageId
      || context.sourceStateHash !== input.sourceStateHash || !Number.isInteger(context.studioProjectRevision) || context.studioProjectRevision < 0
      || !text(context.title) || !text(context.keyMessage)) fail('CONTEXT')
    const grant = context.grant
    if (!grant || grant.runId !== input.runId || grant.sessionId !== sessionId || !(Date.parse(grant.expiresAt) > Date.parse(dependencies.now?.() ?? new Date().toISOString()))
      || (operation === 'generate' && grant.allowVisualGeneration !== true) || (operation === 'adopt' && grant.allowApply !== true)) fail('GRANT')
    const binding = dependencies.standardProjects.findByPreDesignProjectId(pre.project.projectId)
    const root = binding?.workspaceRoot ?? binding?.directoryRoot
    if (!binding || binding.state !== 'ready' || binding.preDesignProjectId !== context.preDesignProjectId || binding.presentationProjectId !== context.studioProjectId
      || !root || !text(context.workspaceRoot) || await realpath(root) !== await realpath(context.workspaceRoot)) fail('BINDING')
    const frozen = await dependencies.source(pre.project.projectId, pre.project.currentRevision)
    if (frozen.projectId !== pre.project.projectId || frozen.revision !== pre.project.currentRevision
      || dependencies.repository.readContext(sessionId).project.currentRevision !== frozen.revision) fail('CONTEXT')
    if (!Array.isArray(context.sourceObjectIds) || !context.sourceObjectIds.length || !context.sourceObjectIds.every(text)) fail('SOURCE_REQUIRED')
    const sourceObjectIds = [...new Set(context.sourceObjectIds)].sort()
    const sources = sourceObjectIds.map(id => frozen.stateObjects.find(object => object.objectId === id))
    if (sources.some(source => !source)) fail('SOURCE_REQUIRED')
    const anchor = sources.find(source => source && dependencies.registry.workflows().some(workflow => workflow.targetObjectId === source.objectId
      && workflow.chapterId === source.chapterId && workflow.workItemId === source.workItemId))
    if (!anchor?.workItemId) fail('SOURCE_REQUIRED')
    return { context: { ...context, sourceObjectIds }, fill: { frozenProject: frozen, workspaceRoot: root,
      target: { kind: 'studio_current_page', preDesignProjectId: frozen.projectId, studioProjectId: context.studioProjectId,
        pageId: context.pageId, sourceStateHash: context.sourceStateHash, sourceObjectIds }, requestId: input.requestId,
      title: context.title, keyMessage: context.keyMessage, chapterId: anchor.chapterId, workItemId: anchor.workItemId,
      prompt: input.prompt, style: input.style, signal } }
  }
  const unchanged = (before: StudioVisualInput, after: StudioVisualInput) => {
    if (sha256CanonicalJson(before.target) !== sha256CanonicalJson(after.target) || before.frozenProject.revision !== after.frozenProject.revision) fail('CONTEXT')
  }
  return Object.freeze({ protocol: DESIGN_VISUAL_PROTOCOL,
    bindStudioResolver(resolver: TrustedStudioVisualResolver) {
      if (!resolver || resolver.protocol !== DESIGN_VISUAL_PROTOCOL || typeof resolver.resolve !== 'function') fail('RESOLVER_UNAVAILABLE')
      if (owner) fail('RESOLVER_BOUND')
      const bound = { resolver }; owner = bound
      return () => { if (owner === bound) owner = undefined }
    },
    async inspect(parent: Agent, input: DesignVisualInput, signal?: AbortSignal) { return (await resolveContext(parent, input, 'inspect', signal)).context },
    async generate(parent: Agent, input: DesignVisualInput, signal?: AbortSignal) {
      const validated = await resolveContext(parent, input, 'generate', signal)
      let result: StudioVisualResult
      try { result = await dependencies.pageVisualFill.generateStudioPage(parent, validated.fill) }
      catch (error) { signal?.throwIfAborted(); throw error }
      unchanged(validated.fill, (await resolveContext(parent, input, 'generate', signal)).fill)
      return result
    },
    async adopt(parent: Agent, input: DesignVisualInput & { assetId: string }, signal?: AbortSignal) {
      const validated = await resolveContext(parent, input, 'inspect', signal)
      const result = await dependencies.pageVisualFill.adoptStudioPage({ ...validated.fill, assetId: input.assetId }, async candidate => {
        unchanged(validated.fill, (await resolveContext(parent, input, 'adopt', signal, candidate)).fill)
      })
      unchanged(validated.fill, (await resolveContext(parent, input, 'adopt', signal, { requestId: result.requestId, assetId: result.assetId })).fill)
      return result
    },
  })
}
