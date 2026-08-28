import type { ProjectRepository } from '../state/repository.ts'
import type { DynamicQuestionRecord } from '../state/types.ts'
import type { WorkflowRuntime } from './workflow-runtime.ts'

export interface OpenQuestionInput {
  readonly questionId: string
  readonly workflowId: string
  readonly prompt: string
  readonly priority: number
  readonly owner: string
  readonly dueAt?: string
  readonly blockingLevel: 'none' | 'soft' | 'hard'
  readonly evidenceIds?: readonly string[]
}

export class QuestionService {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly runtime: WorkflowRuntime,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async openQuestion(projectId: string, input: OpenQuestionInput): Promise<DynamicQuestionRecord> {
    if (this.projects.listQuestions(projectId).some(row => row.questionId === input.questionId)) {
      throw new Error(`question '${input.questionId}' already exists`)
    }
    const question: DynamicQuestionRecord = {
      questionId: input.questionId,
      projectId,
      workflowId: input.workflowId,
      prompt: input.prompt,
      priority: input.priority,
      owner: input.owner,
      ...(input.dueAt === undefined ? {} : { dueAt: input.dueAt }),
      blockingLevel: input.blockingLevel,
      evidenceIds: input.evidenceIds ?? [],
      status: 'open',
      createdAt: this.now(),
    }
    await this.projects.putQuestion(question)
    if (question.blockingLevel === 'hard' && question.evidenceIds?.length === 0) {
      const run = this.runtime.snapshot(projectId).runs.find(row => row.workflowId === question.workflowId)
      if (run?.status === 'ready' || run?.status === 'running') {
        await this.runtime.transition(projectId, run.workflowId, { to: 'blocked', reason: question.prompt })
      }
    }
    return question
  }

  async resolveQuestion(
    projectId: string,
    questionId: string,
    evidenceIds: readonly string[],
  ): Promise<DynamicQuestionRecord> {
    const question = this.projects.listQuestions(projectId).find(row => row.questionId === questionId)
    if (question === undefined || question.status !== 'open') throw new Error(`open question '${questionId}' not found`)
    if (question.blockingLevel === 'hard' && evidenceIds.length === 0) {
      throw new Error('hard blocking question requires evidence')
    }
    const resolvedAt = this.now()
    const revision = this.projects.listProjects().find(project => project.projectId === projectId)?.currentRevision ?? 0
    const resolved: DynamicQuestionRecord = {
      ...question,
      evidenceIds: [...evidenceIds],
      status: 'resolved',
      resolvedAt,
      resolvedRevision: revision,
    }
    await this.projects.putQuestion(resolved)
    if (question.workflowId !== undefined) {
      const run = this.runtime.snapshot(projectId).runs.find(row => row.workflowId === question.workflowId)
      if (run?.status === 'blocked') await this.runtime.transition(projectId, run.workflowId, { to: 'ready' })
    }
    return resolved
  }

  blockingQuestions(projectId: string): readonly DynamicQuestionRecord[] {
    return this.projects.listQuestions(projectId)
      .filter(question => question.status === 'open' && question.blockingLevel === 'hard')
  }
}
