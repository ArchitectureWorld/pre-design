import { afterEach, describe, expect, it, vi } from 'vitest'
import { installSubagentSummarySync } from '../src/client/subagent-summary-sync.ts'

afterEach(() => vi.useRealTimers())

function fixture() {
  vi.useFakeTimers()
  let rows: Record<string, { id: string; origin?: 'subagent'; running: boolean }> = {}
  const listeners = new Set<() => void>()
  const refresh = vi.fn(async () => { listeners.forEach(listener => listener()) })
  const stop = installSubagentSummarySync({
    list: {
      getSnapshot: () => ({ byId: rows }),
      subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    },
    refresh,
  })
  return {
    refresh, stop, listeners,
    rows(next: typeof rows) { rows = next; listeners.forEach(listener => listener()) },
  }
}

describe('subagent summary reconciliation', () => {
  it('recovers missed usage/timing updates when a child settles without rerunning it', async () => {
    const f = fixture()
    f.rows({ child: { id: 'child', origin: 'subagent', running: true } })
    await vi.advanceTimersByTimeAsync(250)
    expect(f.refresh).toHaveBeenCalledTimes(1)
    // Status reaches the browser while the projection control frame is lost.
    f.rows({ child: { id: 'child', origin: 'subagent', running: false } })
    await vi.advanceTimersByTimeAsync(250)
    expect(f.refresh).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(f.refresh).toHaveBeenCalledTimes(2)
    f.stop()
  })

  it('refreshes active children every 15 seconds and batches concurrent lifecycle updates', async () => {
    const f = fixture()
    f.rows({ a: { id: 'a', origin: 'subagent', running: true } })
    f.rows({ a: { id: 'a', origin: 'subagent', running: true }, b: { id: 'b', origin: 'subagent', running: true } })
    await vi.advanceTimersByTimeAsync(250)
    expect(f.refresh).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(f.refresh).toHaveBeenCalledTimes(2)
    f.stop()
  })

  it('queues one trailing refresh when completion races an in-flight list request', async () => {
    const f = fixture()
    let resolve!: () => void
    f.refresh.mockImplementationOnce(() => new Promise<void>(done => { resolve = done }))
    f.rows({ child: { id: 'child', origin: 'subagent', running: true } })
    await vi.advanceTimersByTimeAsync(250)
    f.rows({ child: { id: 'child', origin: 'subagent', running: false } })
    await vi.advanceTimersByTimeAsync(250)
    expect(f.refresh).toHaveBeenCalledTimes(1)
    resolve()
    await vi.advanceTimersByTimeAsync(250)
    expect(f.refresh).toHaveBeenCalledTimes(2)
    f.stop()
  })

  it('does not turn list notifications or ordinary parent activity into a polling loop', async () => {
    const f = fixture()
    f.rows({ parent: { id: 'parent', running: true } })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(f.refresh).not.toHaveBeenCalled()
    f.rows({ child: { id: 'child', origin: 'subagent', running: false } })
    await vi.advanceTimersByTimeAsync(250)
    f.listeners.forEach(listener => listener())
    await vi.advanceTimersByTimeAsync(60_000)
    expect(f.refresh).toHaveBeenCalledTimes(1)
    f.stop()
  })

  it('handles an unavailable host without an unhandled rejection and recovers on subsequent activity', async () => {
    const f = fixture()
    f.refresh.mockRejectedValueOnce(new Error('offline'))
    f.rows({ child: { id: 'child', origin: 'subagent', running: true } })
    await vi.advanceTimersByTimeAsync(250)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(f.refresh).toHaveBeenCalledTimes(3)
    f.stop()
  })

  it('unsubscribes and cancels pending and in-flight trailing work on plugin disposal', async () => {
    const f = fixture()
    let resolve!: () => void
    f.refresh.mockImplementationOnce(() => new Promise<void>(done => { resolve = done }))
    f.rows({ child: { id: 'child', origin: 'subagent', running: true } })
    await vi.advanceTimersByTimeAsync(250)
    f.rows({ child: { id: 'child', origin: 'subagent', running: false } })
    f.stop()
    resolve()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(f.refresh).toHaveBeenCalledTimes(1)
    expect(f.listeners.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('retries a failed final read twice at most, even when no child is running', async () => {
    const f = fixture()
    f.refresh.mockRejectedValue(new Error('offline'))
    f.rows({ child: { id: 'child', origin: 'subagent', running: false } })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(f.refresh).toHaveBeenCalledTimes(3)
    expect(vi.getTimerCount()).toBe(0)
    f.stop()
  })

  it('recovers an idle completed child after the final read transiently fails', async () => {
    const f = fixture()
    f.refresh.mockRejectedValueOnce(new Error('offline'))
    f.rows({ child: { id: 'child', origin: 'subagent', running: false } })
    await vi.advanceTimersByTimeAsync(1250)
    expect(f.refresh).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(f.refresh).toHaveBeenCalledTimes(2)
    f.stop()
  })
})
