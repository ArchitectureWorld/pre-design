import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { afterEach, describe, expect, it } from 'vitest'
import { ContractRegistry } from '../src/contracts/registry.ts'
import { GovernanceRepository } from '../src/governance/repository.ts'
import { QuestionService } from '../src/runtime/question-service.ts'
import { WorkflowRuntime } from '../src/runtime/workflow-runtime.ts'
import { ProjectRepository } from '../src/state/repository.ts'

const roots: string[] = []
const contexts: Context[] = []
const contractRoot = new URL('../contracts/v0.6/', import.meta.url)

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('QuestionService', () => {
  it('persists hard blockers, blocks their workflow, and requires evidence to resolve', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-preplanning-questions-'))
    roots.push(root)
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root })
    await ctx.plugin(StorageDomain, { backend: 'json' })
    const projects = await ProjectRepository.open(ctx.storage.domain)
    await projects.createProject({
      projectId: 'project-1',
      name: '问题闭环项目',
      sessionId: 'session-1',
      createdAt: '2026-08-28T08:00:00.000Z',
      actor: { actorId: 'user-1', name: '策划负责人', role: 'decision_owner' },
    })
    const governance = await GovernanceRepository.open(ctx.storage.domain)
    const registry = await ContractRegistry.open(contractRoot)
    const runtime = new WorkflowRuntime(registry, governance, () => '2026-08-28T08:10:00.000Z')
    await runtime.initializeProject('project-1')
    const questions = new QuestionService(projects, runtime, () => '2026-08-28T08:10:00.000Z')

    const opened = await questions.openQuestion('project-1', {
      questionId: 'question-boundary-file',
      workflowId: 'preplan.wf.01.01',
      prompt: '请补充正式项目任务书。',
      priority: 100,
      owner: '甲方项目负责人',
      blockingLevel: 'hard',
    })
    expect(opened.status).toBe('open')
    expect(questions.blockingQuestions('project-1')).toEqual([
      expect.objectContaining({ questionId: 'question-boundary-file', blockingLevel: 'hard' }),
    ])
    expect(runtime.snapshot('project-1').runs[0]?.status).toBe('blocked')

    await expect(questions.resolveQuestion('project-1', opened.questionId, []))
      .rejects.toThrow('hard blocking question requires evidence')
    await questions.resolveQuestion('project-1', opened.questionId, ['evidence-task-brief-v1'])
    expect(questions.blockingQuestions('project-1')).toEqual([])
    expect(runtime.snapshot('project-1').runs[0]?.status).toBe('ready')
  })
})
