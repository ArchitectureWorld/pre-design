import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir, realpath, rename, rm } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { isAbsolute, join, parse, resolve, win32 } from 'node:path'
import { parseRegionalOdRequest } from './regional-schema.ts'
import { safeBundlePath, verifyRegionalAuditBundle, type RegionalAuditBundle } from './regional-bundle.ts'

const REQUEST_LIMIT = 2 * 1024 * 1024
const FILE_LIMIT = 64 * 1024 * 1024
const BUNDLE_LIMIT = 160 * 1024 * 1024
const RUN_ID = /^RUN-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u

interface ResearchReadSnapshot {
  files: Map<string, { root: string; relative: string; limit: number; hash: string }>
  bundles: Map<string, { root: string; prefix: string; files: string[] }>
}
const observedReads = new AsyncLocalStorage<ResearchReadSnapshot>()
const textHash = (value: string) => createHash('sha256').update(value).digest('hex')

async function snapshotMatches(snapshot: ResearchReadSnapshot): Promise<boolean> {
  for (const file of snapshot.files.values()) {
    if (textHash(await readResearchFile(file.root, file.relative, file.limit)) !== file.hash) return false
  }
  for (const bundle of snapshot.bundles.values()) {
    if (JSON.stringify(await researchBundleFileNames(bundle.root, bundle.prefix)) !== JSON.stringify(bundle.files)) return false
  }
  return true
}

/** Cache a pure replay, never its freshness checks. Every captured file is read
 * and hashed again, including bundle membership and safe path checks. */
export function createResearchReadCache<T>(): (key: string, replay: () => Promise<T>) => Promise<T> {
  let cached: { key: string; value: T; snapshot: ResearchReadSnapshot } | undefined
  let tail: Promise<unknown> = Promise.resolve()
  return (key, replay) => {
    const pending = tail.catch(() => undefined).then(async () => {
      if (cached?.key === key) {
        let unchanged = false
        try { unchanged = await snapshotMatches(cached.snapshot) } catch { /* Replay reports the precise source error. */ }
        if (unchanged) return cached.value
      }
      cached = undefined
      const snapshot: ResearchReadSnapshot = { files: new Map(), bundles: new Map() }
      const value = await observedReads.run(snapshot, replay)
      if (!snapshot.files.size) return value
      if (!await snapshotMatches(snapshot)) throw new Error('RESEARCH_READ_SNAPSHOT_CHANGED')
      cached = { key, value, snapshot }
      return value
    })
    tail = pending
    return pending
  }
}

function partsOf(path: string): string[] {
  if (typeof path !== 'string' || path.length === 0 || path.length > 1000 || path.includes('\0')
    || isAbsolute(path) || win32.isAbsolute(path) || path.includes(':')) throw new Error('RESEARCH_PATH_INVALID')
  const parts = path.replaceAll('\\', '/').split('/')
  if (parts.some(p => p === '' || p === '.' || p === '..')) throw new Error('RESEARCH_PATH_INVALID')
  return parts
}

/** No symlink components, including ancestors of the supplied workspace root. */
export async function researchWorkspaceRoot(root: string): Promise<string> {
  if (!isAbsolute(root)) throw new Error('RESEARCH_PATH_INVALID')
  const full = resolve(root)
  let cursor = parse(full).root
  for (const part of full.slice(cursor.length).split(/[\\/]/u).filter(Boolean)) {
    cursor = join(cursor, part)
    const info = await lstat(cursor)
    if (info.isSymbolicLink()) throw new Error('RESEARCH_SYMLINK_FORBIDDEN')
    if (!info.isDirectory()) throw new Error('RESEARCH_NOT_DIRECTORY')
  }
  return realpath(full)
}

async function checkedPath(root: string, relative: string, createParents = false): Promise<string> {
  const parts = partsOf(relative)
  let current = root
  for (const part of parts.slice(0, -1)) {
    current = join(current, part)
    if (createParents) {
      try { await mkdir(current) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    }
    const stat = await lstat(current)
    if (stat.isSymbolicLink()) throw new Error('RESEARCH_SYMLINK_FORBIDDEN')
    if (!stat.isDirectory()) throw new Error('RESEARCH_NOT_DIRECTORY')
  }
  return join(current, parts.at(-1)!)
}

export async function readResearchFile(root: string, relative: string, limit = REQUEST_LIMIT): Promise<string> {
  const canonical = await researchWorkspaceRoot(root)
  const path = await checkedPath(canonical, relative)
  const before = await lstat(path)
  if (before.isSymbolicLink()) throw new Error('RESEARCH_SYMLINK_FORBIDDEN')
  if (!before.isFile()) throw new Error('RESEARCH_NOT_FILE')
  if (before.size > limit) throw new Error('RESEARCH_INPUT_TOO_LARGE')
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const opened = await file.stat()
    if (opened.dev !== before.dev || opened.ino !== before.ino || !opened.isFile()) throw new Error('RESEARCH_FILE_CHANGED')
    const buffer = Buffer.alloc(Math.min(limit + 1, opened.size + 1))
    let size = 0
    while (size < buffer.length) {
      const read = await file.read(buffer, size, buffer.length - size, size)
      if (!read.bytesRead) break
      size += read.bytesRead
    }
    const after = await file.stat()
    if (size > limit || after.size > limit) throw new Error('RESEARCH_INPUT_TOO_LARGE')
    if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || size !== opened.size) throw new Error('RESEARCH_FILE_CHANGED')
    await checkedPath(canonical, relative)
    const pathAfter = await lstat(path)
    if (pathAfter.isSymbolicLink() || pathAfter.ino !== opened.ino || pathAfter.dev !== opened.dev) throw new Error('RESEARCH_FILE_CHANGED')
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, size))
    const snapshot = observedReads.getStore()
    if (snapshot) {
      const normalized = partsOf(relative).join('/'), key = canonical + '\0' + normalized, hash = textHash(text)
      const previous = snapshot.files.get(key)
      if (previous && previous.hash !== hash) throw new Error('RESEARCH_READ_SNAPSHOT_CHANGED')
      snapshot.files.set(key, { root: canonical, relative: normalized, limit: Math.max(limit, previous?.limit ?? 0), hash })
    }
    return text
  } finally { await file.close() }
}

export async function readRegionalRequestFile(root: string, relative: string) {
  const text = await readResearchFile(root, relative)
  return { request: parseRegionalOdRequest(JSON.parse(text.replace(/^\uFEFF/u, ''))), relativePath: partsOf(relative).join('/') }
}

export interface StoredResearchManifest { readonly manifestHash:string; readonly files:readonly {readonly path:string;readonly sha256:string;readonly sizeBytes:number}[] }
export interface StoredResearchBundle { readonly manifest:StoredResearchManifest; readonly files:Readonly<Record<string,string>> }
export interface ResearchSaveOptions { readonly signal?:AbortSignal;readonly beforeCommit?:()=>void|Promise<void> }

/** Internal shared I/O. Callers supply their fixed, versioned verifier, never user-supplied code. */
export async function saveResearchAuditBundle<T extends StoredResearchBundle>(root:string,bundle:T,verify:(bundle:T)=>unknown,options:ResearchSaveOptions={}) {
  options.signal?.throwIfAborted()
  verify(bundle)
  if (Object.keys(bundle.files).length > 200 || Object.values(bundle.files).reduce((n, s) => n + Buffer.byteLength(s), 0) > BUNDLE_LIMIT) throw new Error('RESEARCH_BUNDLE_TOO_LARGE')
  const canonical = await researchWorkspaceRoot(root)
  const runId = `RUN-${randomUUID()}`
  const relativePath = `research/runs/${runId}`
  const destination = await checkedPath(canonical, relativePath, true)
  const stageRelative = `research/runs/.pending-${randomUUID()}`
  const stage = await checkedPath(canonical, stageRelative)
  await mkdir(stage)
  const identity = await lstat(stage)
  let published = false
  try {
    for (const [relative, content] of Object.entries({ ...bundle.files, 'manifest.json': JSON.stringify(bundle.manifest, null, 2) + '\n' })) {
      options.signal?.throwIfAborted()
      if (!safeBundlePath(relative) || Buffer.byteLength(content) > FILE_LIMIT) throw new Error('RESEARCH_PATH_INVALID')
      const target = await checkedPath(stage, relative, true)
      const file = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600)
      try { await file.writeFile(content, 'utf8'); await file.sync() } finally { await file.close() }
    }
    await options.beforeCommit?.()
    options.signal?.throwIfAborted()
    await researchWorkspaceRoot(root)
    await checkedPath(canonical, relativePath)
    const current = await lstat(stage)
    if (current.isSymbolicLink() || current.ino !== identity.ino || current.dev !== identity.dev) throw new Error('RESEARCH_FILE_CHANGED')
    // A UUID is generated by this store, never supplied by the caller. Never replace an existing run.
    try { await lstat(destination); throw new Error('RESEARCH_RUN_EXISTS') } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await rename(stage, destination)
    published = true
    return { runId, relativePath, manifestHash: bundle.manifest.manifestHash }
  } finally {
    if (!published) {
      // Cleanup only the directory created above, never a replaced path or outside the checked root.
      try {
        await researchWorkspaceRoot(root); await checkedPath(canonical, stageRelative)
        const current = await lstat(stage)
        if (!current.isSymbolicLink() && current.ino === identity.ino && current.dev === identity.dev) await rm(stage, { recursive: true, force: true })
      } catch { /* Preserve uncertain paths for manual recovery. */ }
    }
  }
}

async function researchBundleFileNames(root: string, prefix: string): Promise<string[]> {
  const canonical = await researchWorkspaceRoot(root), actual: string[] = []
  async function scan(relative: string) {
    const path = await checkedPath(canonical, relative + '/sentinel')
    for (const entry of await readdir(join(path, '..'), { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('RESEARCH_SYMLINK_FORBIDDEN')
      if (entry.isDirectory()) await scan(`${relative}/${entry.name}`)
      else if (entry.isFile()) actual.push(`${relative}/${entry.name}`.slice(prefix.length + 1))
      else throw new Error('RESEARCH_NOT_FILE')
    }
  }
  await scan(prefix)
  return actual.sort()
}

export async function readResearchAuditBundle<T extends StoredResearchBundle>(root:string,runId:string,verify:(bundle:T)=>unknown):Promise<T> {
  if (!RUN_ID.test(runId)) throw new Error('RESEARCH_RUN_ID_INVALID')
  const prefix = `research/runs/${runId}`
  const manifest = JSON.parse(await readResearchFile(root, `${prefix}/manifest.json`)) as StoredResearchManifest
  if (!Array.isArray(manifest.files) || manifest.files.length > 200) throw new Error('BUNDLE_MANIFEST_INVALID')
  const files: Record<string, string> = Object.create(null)
  let total = 0
  for (const entry of manifest.files) {
    if (!safeBundlePath(entry.path) || entry.path === 'manifest.json' || Object.hasOwn(files, entry.path)) throw new Error('BUNDLE_PATH_INVALID')
    const content = await readResearchFile(root, `${prefix}/${entry.path}`, FILE_LIMIT)
    total += Buffer.byteLength(content)
    if (total > BUNDLE_LIMIT) throw new Error('RESEARCH_BUNDLE_TOO_LARGE')
    files[entry.path] = content
  }
  const canonical = await researchWorkspaceRoot(root)
  const actual = await researchBundleFileNames(canonical, prefix)
  const snapshot = observedReads.getStore(), key = canonical + '\0' + prefix
  if (snapshot) {
    const previous = snapshot.bundles.get(key)
    if (previous && JSON.stringify(previous.files) !== JSON.stringify(actual)) throw new Error('RESEARCH_READ_SNAPSHOT_CHANGED')
    snapshot.bundles.set(key, { root: canonical, prefix, files: actual })
  }
  if (JSON.stringify(actual.filter(p => p !== 'manifest.json').sort()) !== JSON.stringify(Object.keys(files).sort())) throw new Error('BUNDLE_FILE_SET_MISMATCH')
  const bundle = { manifest, files } as unknown as T
  verify(bundle)
  return bundle
}

/** Preserve the public regional API and its original semantic verifier. */
export function saveRegionalAuditBundle(root:string,bundle:RegionalAuditBundle,options:ResearchSaveOptions={}) {
  return saveResearchAuditBundle(root,bundle,verifyRegionalAuditBundle,options)
}
export function readRegionalAuditBundle(root:string,runId:string):Promise<RegionalAuditBundle> {
  return readResearchAuditBundle(root,runId,verifyRegionalAuditBundle)
}
