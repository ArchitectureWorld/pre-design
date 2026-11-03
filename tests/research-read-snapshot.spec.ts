import { mkdtemp, mkdir, rm, writeFile, stat, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createResearchReadCache, readResearchFile, readResearchAuditBundle } from '../src/research-v2/run-store.ts'

const roots: string[] = []
async function root() { const path = await mkdtemp(join(tmpdir(), 'research-read-cache-')); roots.push(path); return path }
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

it('reuses a verified result only while every input byte still matches, including same-size edits with restored mtime', async () => {
  const directory = await root(), path = join(directory, 'source.json')
  await writeFile(path, '{"n":1}')
  const cache = createResearchReadCache<{ n: number }>()
  let reads = 0
  const load = async () => { reads++; return Object.freeze(JSON.parse(await readResearchFile(directory, 'source.json'))) }
  const first = await cache('one', load)
  expect(await cache('one', load)).toBe(first)
  expect(reads).toBe(1)
  const originalStat = await stat(path)
  await writeFile(path, '{"n":2}'); await utimes(path, originalStat.atime, originalStat.mtime)
  expect(await cache('one', load)).toEqual({ n: 2 })
  expect(reads).toBe(2)
  await rm(path)
  await expect(cache('one', load)).rejects.toThrow()
})

it('does not reuse a bundle if an unexpected file was added', async () => {
  const directory = await root(), runId = 'RUN-11111111-1111-1111-1111-111111111111'
  const folder = join(directory, 'research/runs', runId)
  await mkdir(folder, { recursive: true })
  await writeFile(join(folder, 'manifest.json'), JSON.stringify({ manifestHash: 'test', files: [{ path: 'result.json', sha256: 'test', sizeBytes: 2 }] }))
  await writeFile(join(folder, 'result.json'), '{}')
  const cache = createResearchReadCache<unknown>()
  const load = () => readResearchAuditBundle(directory, runId, () => {})
  await cache('bundle', load)
  await writeFile(join(folder, 'extra.json'), '{}')
  await expect(cache('bundle', load)).rejects.toThrow('BUNDLE_FILE_SET_MISMATCH')
})

it('never caches a failed validation and keeps distinct keys separate', async () => {
  const directory = await root(); await writeFile(join(directory, 'source.json'), '{}')
  const cache = createResearchReadCache<string>(); let calls = 0
  const load = async () => { calls++; await readResearchFile(directory, 'source.json'); if (calls === 1) throw new Error('invalid'); return String(calls) }
  await expect(cache('a', load)).rejects.toThrow('invalid')
  expect(await cache('a', load)).toBe('2')
  expect(await cache('b', load)).toBe('3')
})

it('rejects a source changed during validation instead of publishing a stale cached result', async () => {
  const directory = await root(); await writeFile(join(directory, 'source.json'), '{"n":1}')
  const cache = createResearchReadCache<unknown>()
  await expect(cache('changing', async () => {
    const value = JSON.parse(await readResearchFile(directory, 'source.json'))
    await writeFile(join(directory, 'source.json'), '{"n":2}')
    return value
  })).rejects.toThrow('RESEARCH_READ_SNAPSHOT_CHANGED')
})
