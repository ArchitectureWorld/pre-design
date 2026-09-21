import { expect, it, vi } from 'vitest'
import { retryDurableWrite } from '../src/state/durable-write.ts'

it('propagates a persistent replacement failure after a bounded wait', async () => {
  const failure = Object.assign(new Error('locked'), { syscall: 'rename', code: 'EPERM' })
  const write = vi.fn(async () => { throw failure })
  await expect(retryDurableWrite(write)).rejects.toBe(failure)
  expect(write.mock.calls.length).toBeGreaterThan(1)
  expect(write.mock.calls.length).toBeLessThan(10)
})

it.each([{ syscall: 'open', code: 'EACCES' }, { syscall: 'rename', code: 'ENOSPC' }, { code: 'INVALID_DATA' }])(
  'does not reinterpret a non-lock failure as a retriable write: %j', async attributes => {
    const failure = Object.assign(new Error('permanent'), attributes), write = vi.fn(async () => { throw failure })
    await expect(retryDurableWrite(write)).rejects.toBe(failure)
    expect(write).toHaveBeenCalledOnce()
  })
