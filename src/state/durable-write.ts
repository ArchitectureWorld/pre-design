import { setTimeout } from 'node:timers/promises'

/** Retry only an identical durable write, never a transaction or model dispatch.
 * Windows readers can briefly deny atomic replacement. The domain commits its
 * in-memory state only after persistence succeeds; callers retain their queue,
 * record key and value across these bounded retries.
 */
export async function retryDurableWrite<T>(write: () => Promise<T>): Promise<T> {
  const delays = [25, 50, 100, 200, 400, 800]
  for (let attempt = 0; ; attempt++) {
    try { return await write() }
    catch (error) {
      const io = error as NodeJS.ErrnoException
      const delay = delays[attempt]
      if (io?.syscall !== 'rename' || !['EPERM', 'EBUSY', 'EACCES'].includes(io.code ?? '') || delay === undefined) throw error
      await setTimeout(delay)
    }
  }
}
