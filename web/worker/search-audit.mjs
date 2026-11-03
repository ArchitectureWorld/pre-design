import { readBoundFile } from './research-artifacts.mjs'

export async function readSearchAudit(privateRoot, projectId, { since } = {}) {
  if (!privateRoot || !/^[A-Za-z0-9-]{1,100}$/u.test(projectId)) return []
  const threshold = since === undefined ? 0 : typeof since === 'number' ? since : Date.parse(since)
  if (!Number.isFinite(threshold) || threshold < 0) throw new Error('TRACE_TIME_INVALID')
  let bytes
  try { bytes = await readBoundFile(privateRoot, `${projectId}/search-audit.jsonl`) }
  catch (error) { if (error.code === 'ENOENT') return []; throw error }
  return bytes.toString('utf8').split('\n').flatMap(line => {
    let row
    try { row = JSON.parse(line) } catch { return [] }
    if (!row || !['started', 'succeeded', 'failed'].includes(row.phase) || !Number.isFinite(Date.parse(row.at)) || Date.parse(row.at) < threshold
      || typeof row.id !== 'string' || !/^[a-f0-9-]{36}$/u.test(row.id) || !['deepseek-search-api', 'ddg', 'bing', 'exa'].includes(row.provider)) return []
    return [{ id: row.id, at: row.at, phase: row.phase, provider: row.provider,
      ...Object.fromEntries(['maxResults', 'sourceCount', 'durationMs'].filter(key => Number.isSafeInteger(row[key]) && row[key] >= 0).map(key => [key, row[key]])),
      ...(typeof row.truncated === 'boolean' ? { truncated: row.truncated } : {}),
      ...(typeof row.code === 'string' && /^[A-Z_]{1,80}$/u.test(row.code) ? { code: row.code } : {}) }]
  }).slice(-1000)
}
