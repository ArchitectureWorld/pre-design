import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { PageVisualFillResult, PageVisualFillService, PageVisualInput } from './page-visual-fill.ts'
import { VisualAgentError } from '../visual/agent.ts'
import { compileClientReportOutline } from './projector/client-outline.ts'

export interface AutomaticVisualDependencies {
  readonly prepareImageQuality?: (input: PageVisualInput, parent: Agent, signal: AbortSignal, assertCurrent: () => void, maxGenerations: number) => Promise<void>
  readonly pageVisualFill: Pick<PageVisualFillService, 'plan' | 'generate' | 'adopt'>
    & Partial<Pick<PageVisualFillService, 'planScenes' | 'generateScene' | 'adoptScene'>>
  readonly input: (projectId: string, revision: number) => Promise<PageVisualInput>
  readonly target: (projectId: string, revision: number) => number
  readonly sync: (projectId: string) => Promise<void>
  readonly assertCurrent: (projectId: string, revision: number, parent: Agent) => void
}

/** Automatic mode owns the complete lifecycle, including adoption and page linking. */
export function createAutomaticVisualCompletion(dependencies: AutomaticVisualDependencies) {
  return async (projectId: string, revision: number, parent: Agent, signal: AbortSignal): Promise<void> => {
    const assertCurrent = () => { signal.throwIfAborted(); dependencies.assertCurrent(projectId, revision, parent) }
    assertCurrent()
    const target = dependencies.target(projectId, revision)
    if (target <= 0 && !dependencies.prepareImageQuality) { await dependencies.sync(projectId); return }
    const initial = await dependencies.input(projectId, revision)
    if (initial.frozenProject.manuscript && dependencies.prepareImageQuality) {
      await dependencies.prepareImageQuality(initial, parent, signal, assertCurrent, Math.max(0, target))
      assertCurrent(); await dependencies.sync(projectId); return
    }
    if (target <= 0) { await dependencies.sync(projectId); return }
    if (initial.frozenProject.manuscript) {
      const service = dependencies.pageVisualFill
      if (!service.planScenes || !service.generateScene || !service.adoptScene) throw new Error('REPORT_SCENE_SERVICE_REQUIRED: 正式文案缺少自动场景补图服务')
      const initialPlan = await service.planScenes(initial), required = initialPlan.requirements.slice(0, target)
      const results: { sceneKey: string; findingId: string; state: string; assetId?: string }[] = []
      const root = join(initial.workspaceRoot, '.pre-design'); await mkdir(root, { recursive: true })
      const save = () => writeFile(join(root, 'visual-delivery.json'), JSON.stringify({ projectId, revision,
        required: required.map(scene => ({ sceneKey: scene.sceneKey, findingId: scene.findingId, title: scene.title, kind: 'concept', bindings: scene.bindings })), results }, null, 2) + '\n')
      await save()
      for (const scene of required) {
        const readCurrentScene = async () => {
          assertCurrent()
          const input = await dependencies.input(projectId, revision), plan = await service.planScenes!(input)
          assertCurrent()
          const current = plan.requirements.find(item => item.sceneKey === scene.sceneKey)
          if (!current || current.contentHash !== scene.contentHash || current.sourceRevision !== scene.sourceRevision
            || current.sourceFingerprint !== scene.sourceFingerprint) throw new Error('REPORT_SCENE_SOURCE_CHANGED: 自动补图过程中场景来源内容变化')
          return { input, plan }
        }
        const { input, plan } = await readCurrentScene()
        const covered = plan.coverage.find(item => item.sceneKey === scene.sceneKey)
        if (covered) { results.push({ sceneKey: scene.sceneKey, findingId: scene.findingId, state: 'covered', assetId: covered.assetId }); await save(); continue }
        results.push({ sceneKey: scene.sceneKey, findingId: scene.findingId, state: 'generating' }); await save()
        try {
          const generationSignal = AbortSignal.any([signal, AbortSignal.timeout(600_000)])
          let generated: PageVisualFillResult
          try {
            generated = await service.generateScene(parent, { ...input, sceneKey: scene.sceneKey,
              signal: generationSignal, beforeStart: assertCurrent, assertCurrent })
          } catch (error) {
            assertCurrent()
            if (!generationSignal.aborted && !(error instanceof VisualAgentError && error.code !== 'visual-not-dispatched')) throw error
            const recovery = await readCurrentScene()
            // One bounded observation of the original paid task; never a replacement attempt.
            generated = await service.generateScene(parent, { ...recovery.input, sceneKey: scene.sceneKey, recoveryOnly: true,
              signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]), assertCurrent })
          }
          assertCurrent()
          const adoption = await readCurrentScene()
          const adopted = generated.status === 'adopted' ? generated : await service.adoptScene({ ...adoption.input, sceneKey: scene.sceneKey, assetId: generated.assetId, signal, assertCurrent })
          assertCurrent()
          results[results.length - 1] = { sceneKey: scene.sceneKey, findingId: scene.findingId, state: adopted.status, assetId: adopted.assetId }
          await dependencies.sync(projectId); await save()
        } catch (error) {
          results[results.length - 1] = { sceneKey: scene.sceneKey, findingId: scene.findingId, state: signal.aborted ? 'interrupted' : 'failed' }
          await save(); throw error
        }
      }
      await dependencies.sync(projectId)
      return
    }
    const required = compileClientReportOutline(initial.frozenProject).filter(f => f.visualRequirement === 'concept').slice(0, target)
    const results: { findingId: string; state: string; assetId?: string }[] = []
    const root = join(initial.workspaceRoot, '.pre-design')
    await mkdir(root, { recursive: true })
    const save = () => writeFile(join(root, 'visual-delivery.json'), JSON.stringify({ projectId, revision,
      required: required.map(f => ({ findingId: f.findingId, title: f.title, kind: f.visualRequirement })), results }, null, 2) + '\n')
    await save()
    for (const finding of required) {
      assertCurrent()
      const input = await dependencies.input(projectId, revision)
      const page = (await dependencies.pageVisualFill.plan(input)).pages.find(p => p.findingId === finding.findingId)
      if (page?.covered) { results.push({ findingId: finding.findingId, state: 'covered' }); await save(); continue }
      results.push({ findingId: finding.findingId, state: 'generating' }); await save()
      try {
        const generated = await dependencies.pageVisualFill.generate(parent, { ...input, findingId: finding.findingId, prompt: finding.visualBrief,
          signal: AbortSignal.any([signal, AbortSignal.timeout(600_000)]), beforeStart: assertCurrent })
        assertCurrent()
        const adopted = await dependencies.pageVisualFill.adopt({ ...input, findingId: finding.findingId, assetId: generated.assetId, signal, assertCurrent })
        assertCurrent()
        results[results.length - 1] = { findingId: finding.findingId, state: adopted.status, assetId: adopted.assetId }
        await dependencies.sync(projectId)
        await save()
      } catch (error) {
        results[results.length - 1] = { findingId: finding.findingId, state: signal.aborted ? 'interrupted' : 'failed' }
        await save()
        // Do not turn a provider error, exhausted budget or uncertain paid task
        // into a new attempt or a false completed report.
        throw error
      }
    }
    await dependencies.sync(projectId)
  }
}
