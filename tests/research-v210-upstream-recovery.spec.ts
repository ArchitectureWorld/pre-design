import { expect, it } from 'vitest'
import { recoverModuleAuthorGroups } from '../src/research-v2/module-group-recovery.ts'

it('reauthors a saved partial prefix whose upstream claim cannot be used instead of repeatedly replaying it', async () => {
  const context = { module: { id: '1.05' }, signal: new AbortController().signal, upstream: [{ moduleId: 'up', claims: [] }],
    resumeExecutionAudit: { reviewReceipts: [], attempts: [{ status: 'completed', classId: 'text', groupId: 'environment:1', structuredOutput: {
      groupId: 'environment:1', evidence: [{ inputRefs: [{ upstream: { moduleId: 'up', claimId: 'absent' } }] }],
    } }] } }
  const before = JSON.stringify(context)
  const result = await recoverModuleAuthorGroups(context as any, {} as any, {} as any)
  expect(result).toEqual({ submissions: [], attempts: [] })
  expect(JSON.stringify(context)).toBe(before)
})
