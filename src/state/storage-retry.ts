import { win32 } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type { preplanningDomainSpec } from './domain.ts'

/** Repeat one idempotent publication, never a commit or decision. The JSON
 * backend rolls a failed rename back in memory before rejecting the write. */
export async function retryAtomicStorageWrite<T>(write: () => Promise<T>, platform = process.platform): Promise<T> {
  const delays = [25, 100, 250, 500]
  for (let attempt = 0; ; attempt++) {
    try { return await write() } catch (error) {
      const failure = error as NodeJS.ErrnoException & { dest?: string }
      if (platform !== 'win32' || !failure || failure.syscall !== 'rename'
        || !['EPERM', 'EACCES', 'EBUSY'].includes(failure.code ?? '')
        || typeof failure.dest !== 'string' || win32.basename(failure.dest) !== 'preplanning_agent.json'
        || attempt >= delays.length) throw error
      await setTimeout(delays[attempt])
    }
  }
}

export function withAtomicStorageRetry(domain: Domain<typeof preplanningDomainSpec>): Domain<typeof preplanningDomainSpec> {
  return {
    name: domain.name,
    get global() { return domain.global },
    close: () => domain.close(),
    table(name) {
      const table = domain.table(name)
      return {
        get: key => table.get(key), entries: () => table.entries(), keys: () => table.keys(),
        get size() { return table.size },
        put: (key, value) => retryAtomicStorageWrite(() => table.put(key, value)),
        delete: key => retryAtomicStorageWrite(() => table.delete(key)),
        update: (key, fn) => table.update(key, fn),
      }
    },
  }
}
