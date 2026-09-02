import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { registerPreplanningCommands } from '../../src/commands/register.ts'
import { ContractRegistry } from '../../src/contracts/registry.ts'
import { GovernanceRepository } from '../../src/governance/repository.ts'
import { SiteBoundaryAssetStore } from '../../src/governance/site-boundary-asset-store.ts'
import { SiteBoundaryService, type SiteBoundaryExecutionContext } from '../../src/governance/site-boundary-service.ts'
import { PREPLANNING_SYSTEM_PROMPT } from '../../src/prompts/preplanning-system.ts'
import { ProposalGateway } from '../../src/proposals/gateway.ts'
import { registerReportDownloadRoute } from '../../src/report/download-route.ts'
import { ReportPackageService } from '../../src/report/package-service.ts'
import { createFrozenProjectInput, loadClientProjectProfile } from '../../src/report/source.ts'
import { AutomationService } from '../../src/runtime/automation-service.ts'
import { AutomationCoordinator } from '../../src/runtime/coordinator.ts'
import { GateService } from '../../src/runtime/gate-service.ts'
import { QuestionService } from '../../src/runtime/question-service.ts'
import { RevisionService } from '../../src/runtime/revision-service.ts'
import { WorkflowRuntime } from '../../src/runtime/workflow-runtime.ts'
import { ProjectRepository } from '../../src/state/repository.ts'
import { registerPreplanningTools } from '../../src/tools/register.ts'
import { VisualAgentService } from '../../src/visual/agent.ts'
import { VisualAssetStore } from '../../src/visual/asset-store.ts'
import { SessionImageCollector } from '../../src/visual/session-image-collector.ts'

interface SyntheticFixtureConfig {
  readonly fixtureRoot?: string
}

export const SYNTHETIC_BOUNDARY_FIXTURE_MARKER = 'synthetic-boundary-fixture-v1'
export const name = 'preplanning-agent'
export const inject = [
  'attachments', 'commands', 'llm', 'sessions', 'storage', 'storageDomain', 'subagents', 'systemPrompt', 'tools', 'webServer',
]
export const Config: z<SyntheticFixtureConfig> = z.object({ fixtureRoot: z.string().min(1) })

function syntheticContext(context: SiteBoundaryExecutionContext): SiteBoundaryExecutionContext {
  return { actor: context.actor, channel: 'synthetic_fixture' }
}

function contractRoot(): URL {
  const packaged = new URL('../contracts/v0.6/', import.meta.url)
  return existsSync(fileURLToPath(packaged)) ? packaged : new URL('../../contracts/v0.6/', import.meta.url)
}

export async function apply(ctx: Context, config: SyntheticFixtureConfig = {}): Promise<void> {
  const now = () => new Date().toISOString()
  const fixtureRoot = config.fixtureRoot?.trim() || join(homedir(), '.dsh', 'preplanning-agent', 'synthetic-fixture')
  const registry = await ContractRegistry.open(contractRoot())
  const repository = await ProjectRepository.open(ctx.storage.domain)
  const governance = await GovernanceRepository.open(ctx.storage.domain)
  const runtime = new WorkflowRuntime(registry, governance, now)
  const automation = new AutomationService(governance, registry, now)
  const gates = new GateService(registry, governance, runtime, automation, now)
  const revisions = new RevisionService(registry, runtime)
  const questions = new QuestionService(repository, runtime, now)
  const coordinator = new AutomationCoordinator(runtime)
  const gateway = new ProposalGateway(repository, registry, now, governance)
  const visualAssetRoot = join(fixtureRoot, 'visual-assets')
  const visualStore = new VisualAssetStore(visualAssetRoot)
  const siteBoundaryAssets = new SiteBoundaryAssetStore(visualAssetRoot, {
    readImage: (ref, signal) => ctx.attachments.readImage(ref, signal),
  }, now)
  const boundaries = new SiteBoundaryService(governance, siteBoundaryAssets, now, () => `boundary-${randomUUID()}`)
  const syntheticBoundaries = {
    registerImageAttachment: (...args: Parameters<SiteBoundaryService['registerImageAttachment']>) =>
      boundaries.registerImageAttachment(args[0], args[1], syntheticContext(args[2])),
    registerLegacyAsset: (...args: Parameters<SiteBoundaryService['registerLegacyAsset']>) =>
      boundaries.registerLegacyAsset(args[0], args[1], syntheticContext(args[2])),
    registerGeometry: (...args: Parameters<SiteBoundaryService['registerGeometry']>) =>
      boundaries.registerGeometry(args[0], args[1], syntheticContext(args[2])),
    confirm: (...args: Parameters<SiteBoundaryService['confirm']>) =>
      boundaries.confirm(args[0], args[1], args[2], args[3], syntheticContext(args[4])),
  }
  const visualCollector = new SessionImageCollector({
    sessions: { get: id => ctx.sessions.get(id as never) },
    attachments: { readImage: (ref, signal) => ctx.attachments.readImage(ref as never, signal) },
    waitForEvent: (childId, signal) => new Promise<void>((resolve, reject) => {
      let dispose: () => unknown = () => undefined
      const cleanup = () => {
        signal.removeEventListener('abort', onAbort)
        dispose()
      }
      const onAbort = () => {
        cleanup()
        reject(signal.reason ?? new Error('visual image collection aborted'))
      }
      dispose = ctx.on('session/event', session => {
        if (String(session.id) !== childId) return
        cleanup()
        resolve()
      })
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) onAbort()
    }),
  })
  const visual = new VisualAgentService({
    governance,
    llm: ctx.llm,
    subagents: ctx.subagents,
    collector: visualCollector,
    store: visualStore,
    now,
  })
  const reportPackageRoot = join(fixtureRoot, 'report-packages')
  const clientProfileRoot = join(fixtureRoot, 'client-profiles')
  const reports = new ReportPackageService({
    governance,
    boundaryIntegrity: boundaries,
    packageRoot: reportPackageRoot,
    browserExecutable: 'msedge',
    source: async (projectId, revision) => createFrozenProjectInput(projectId, revision, {
      repository, governance, registry, visualStore,
    }),
    profile: async (projectId, input) => loadClientProjectProfile(clientProfileRoot, projectId, input),
    createId: () => `report-${randomUUID()}`,
    now,
  })
  registerReportDownloadRoute(ctx.webServer, reportPackageRoot)
  ctx.effect(() => async () => {
    await governance.close()
    await repository.close()
  })
  registerPreplanningCommands(ctx, {
    repository,
    gateway,
    governance,
    runtime,
    automation,
    gates,
    revisions,
    coordinator,
    visual,
    boundaries: syntheticBoundaries as unknown as SiteBoundaryService,
    reports,
    registry,
    createId: () => `preplan-${randomUUID()}`,
    now,
  })
  registerPreplanningTools(ctx, { repository, gateway, governance, runtime, registry })
  ctx.systemPrompt.section({ name: 'preplanning-agent', order: 120, text: PREPLANNING_SYSTEM_PROMPT })
  ctx.provide('preplanning', Object.freeze({
    pluginId: 'preplanning-agent' as const,
    contractVersion: '0.6.0' as const,
    repository,
    governance,
    gateway,
    registry,
    runtime,
    automation,
    gates,
    revisions,
    questions,
    coordinator,
    visual,
    siteBoundaryAssets,
    reports,
  }))
}
