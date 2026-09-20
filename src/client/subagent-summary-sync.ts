interface SummarySyncPort {
  readonly list: {
    getSnapshot(): { readonly byId: Readonly<Record<string, { readonly origin?: 'subagent'; readonly running: boolean }>> }
    subscribe(listener: () => void): () => void
  }
  refresh(): Promise<void>
}

/**
 * Reconcile DSH's durable child summaries when live projection updates lag.
 * Uses the public list API: never opens a child, dispatches an LLM, or writes
 * usage values. The host remains the authority for usage, timing and titles.
 */
export function installSubagentSummarySync(sessions: SummarySyncPort): () => void {
  let previous = new Map<string, boolean>()
  let disposed = false
  let inFlight = false
  let trailing = false
  let failures = 0
  let debounce: ReturnType<typeof setTimeout> | undefined
  let interval: ReturnType<typeof setInterval> | undefined

  const schedule = (delay = 250) => {
    if (disposed) return
    if (inFlight) { trailing = true; return }
    if (debounce !== undefined) return
    debounce = setTimeout(() => {
      debounce = undefined
      void refresh()
    }, delay)
  }
  const refresh = async () => {
    if (disposed) return
    if (inFlight) { trailing = true; return }
    inFlight = true
    let failed = false
    try {
      await sessions.refresh()
      failures = 0
    } catch {
      // Keep last reported values. Retry transient failures even after the
      // final child settles, but never create an unbounded idle retry loop.
      failed = true
      failures += 1
    } finally {
      inFlight = false
      if (trailing) { trailing = false; schedule() }
      else if (failed && failures <= 2) schedule(1000 * 2 ** (failures - 1))
    }
  }
  const observe = () => {
    if (disposed) return
    const next = new Map(Object.entries(sessions.list.getSnapshot().byId)
      .filter(([, row]) => row.origin === 'subagent')
      .map(([id, row]) => [id, row.running] as const))
    const changed = next.size !== previous.size
      || [...next].some(([id, running]) => previous.get(id) !== running)
    previous = next
    if (changed) { failures = 0; schedule() }
    const active = [...next.values()].some(Boolean)
    if (active && interval === undefined) interval = setInterval(schedule, 15_000)
    if (!active && interval !== undefined) { clearInterval(interval); interval = undefined }
  }
  const unsubscribe = sessions.list.subscribe(observe)
  observe()
  return () => {
    disposed = true
    unsubscribe()
    if (debounce !== undefined) clearTimeout(debounce)
    if (interval !== undefined) clearInterval(interval)
  }
}
