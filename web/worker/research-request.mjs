import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { validateResearchSelection, researchError } from '../app/src/research-contract.mjs'

/** Preserve the authenticated UI request verbatim as structured user input.
 * This records the clicked action; it adds no generated project facts or approval.
 * Resuming a frozen source keeps that snapshot's original task statement. */
export async function recordResearchRequest(ctx, agent, input, resumeRunIds, context = {}) {
  if (resumeRunIds?.length) return
  const selection = validateResearchSelection(input)
  const identity = value => typeof value === 'string' && /^[A-Za-z0-9._-]{1,128}$/u.test(value)
  const text = JSON.stringify({ operation: 'research', ...selection,
    ...(identity(context.callerUserId) ? {callerUserId:context.callerUserId} : {}), ...(identity(context.jobId) ? {jobId:context.jobId} : {}) })
  const session = agent.session
  if (!session?.append || !session.snapshotEvents) throw researchError('RESEARCH_REQUEST_RECORD_UNAVAILABLE')
  if (session.snapshotEvents().some(event => event.type === 'user/message' && event.data.source?.kind === 'user'
    && event.data.content?.length === 1 && event.data.content[0]?.type === 'text' && event.data.content[0].text === text)) return
  session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }), { surfaceOp: 'append' })
  const persistence = ctx.get?.('sessionPersistence')
  if (persistence?.flush) await persistence.flush()
}
