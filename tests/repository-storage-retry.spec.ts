import { afterEach, describe, expect, it, vi } from 'vitest'
import { retryAtomicStorageWrite } from '../src/state/storage-retry.ts'

const locked = () => Object.assign(new Error('file replacement blocked'), {
  code: 'EPERM', syscall: 'rename', dest: 'E:\\isolated\\storages\\preplanning_agent.json',
})
afterEach(() => vi.useRealTimers())
describe('atomic record storage retry', () => {
  it('retries only the same record publication, retaining its result', async () => {
    vi.useFakeTimers()
    const write = vi.fn().mockRejectedValueOnce(locked()).mockRejectedValueOnce(locked()).mockResolvedValue('durable')
    const result = retryAtomicStorageWrite(write, 'win32')
    await vi.runAllTimersAsync()
    expect(await result).toBe('durable'); expect(write).toHaveBeenCalledTimes(3)
  })
  it.each(['permanent', 'other-unit', 'not-rename', 'other-platform'] as const)('does not hide %s errors', async fault => {
    const error = locked()
    if (fault === 'permanent') error.code = 'ENOSPC'
    if (fault === 'other-unit') error.dest = 'E:\\other.json'
    if (fault === 'not-rename') error.syscall = 'open'
    const write = vi.fn().mockRejectedValue(error)
    await expect(retryAtomicStorageWrite(write, fault === 'other-platform' ? 'linux' : 'win32')).rejects.toBe(error)
    expect(write).toHaveBeenCalledTimes(1)
  })
  it('keeps persistent failure visible after a bounded delay', async () => {
    vi.useFakeTimers(); const error = locked(), write = vi.fn().mockRejectedValue(error)
    const result = expect(retryAtomicStorageWrite(write, 'win32')).rejects.toBe(error)
    await vi.runAllTimersAsync(); await result
    expect(write).toHaveBeenCalledTimes(5)
  })
})
