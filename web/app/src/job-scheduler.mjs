/** One database lease owns this scheduler; reservations and execution state survive the process. */
export function createJobScheduler({ db, getLimits, execute }) {
  const running = new Set()
  let stopped = false, pumpPromise, rerun = false
  async function claim() {
    const limits = await getLimits(), conn = await db.connect()
    try {
      await conn.query('BEGIN')
      await conn.query("SELECT pg_advisory_xact_lock(hashtext(current_database() || ':' || current_schema() || ':job-dispatch'))")
      const count = (await conn.query("SELECT count(*)::int AS n FROM jobs WHERE status IN ('running','cancelling')")).rows[0].n
      if (count >= limits.globalConcurrency) { await conn.query('COMMIT'); return }
      const job = (await conn.query(`SELECT j.* FROM jobs j JOIN projects p ON p.id=j.project_id
        WHERE j.status='queued'
          AND NOT EXISTS(SELECT 1 FROM jobs active WHERE active.project_id=j.project_id AND active.status IN ('running','cancelling'))
          AND (SELECT count(*) FROM jobs active JOIN projects ap ON ap.id=active.project_id
            WHERE ap.owner_id=p.owner_id AND active.status IN ('running','cancelling')) < $1
        ORDER BY j.created_at,j.id LIMIT 1 FOR UPDATE OF j SKIP LOCKED`, [limits.perUserConcurrency])).rows[0]
      if (job) {
        await conn.query("UPDATE jobs SET status='running',started_at=now() WHERE id=$1", [job.id])
        await conn.query("UPDATE job_reservations SET status='consumed' WHERE job_id=$1", [job.id])
      }
      await conn.query('COMMIT'); return job
    } catch (error) { await conn.query('ROLLBACK'); throw error } finally { conn.release() }
  }
  function kick() {
    if (stopped) return pumpPromise
    if (pumpPromise) { rerun = true; return pumpPromise }
    pumpPromise = (async () => {
      while (!stopped) {
        const job = await claim()
        if (!job) break
        const work = execute(job).catch(async () => {
          // An unexpected executor failure must never leave a task eligible for automatic replay.
          await db.query("UPDATE jobs SET status='interrupted',error='任务执行中断，请检查已保存成果后再提交',finished_at=now() WHERE id=$1 AND status IN ('running','cancelling')", [job.id])
        })
        running.add(work)
        work.finally(() => { running.delete(work); void kick() }).catch(() => {})
      }
    })().finally(() => {
      pumpPromise = undefined
      if (rerun && !stopped) { rerun = false; void kick() }
    })
    pumpPromise.catch(() => {})
    return pumpPromise
  }
  async function wait() {
    while (pumpPromise || running.size) {
      if (pumpPromise) await pumpPromise
      if (running.size) await Promise.allSettled([...running])
      if (!stopped) await kick()
    }
  }
  return { kick, wait, stop() { stopped = true } }
}
