import { readFile, writeFile } from 'node:fs/promises'

async function patchFile(path, patches) {
  let content = await readFile(path, 'utf8')
  for (const [before, after] of patches) {
    if (!content.includes(before)) {
      throw new Error(`PATCH_ANCHOR_MISSING: ${path}\n${before.slice(0, 240)}`)
    }
    content = content.replace(before, after)
  }
  await writeFile(path, content, 'utf8')
}

await patchFile('src/presentation/workspace-write-transaction.ts', [[
`  if (journal?.phase === 'validated') {
    await rm(transactionRoot, { recursive: true, force: true })
    return Object.freeze({ status: 'recovered', operationId: journal.operationId })
  }
`,
`  if (owner === undefined && journal === undefined) {
    throw new PresentationStandardProjectError(
      'WORKSPACE_RECOVERY_FAILED',
      'cleanup',
      'existing transaction directory is not owned by pre-design; refusing to claim or delete it',
      { transactionRoot },
    )
  }
  if (journal?.phase === 'validated') {
    await rm(transactionRoot, { recursive: true, force: true })
    return Object.freeze({ status: 'recovered', operationId: journal.operationId })
  }
`,
]])

await patchFile('tests/helpers/shared-workspace-fixture.ts', [[
`  await writeFile(
    join(root, 'assets', 'future-component', 'unknown.bin'),
    Buffer.from([102, 85, 68, 51, 34, 17, 255, 0]),
  )
}
`,
`  const externalAsset = Buffer.from([102, 85, 68, 51, 34, 17, 255, 0])
  const externalAssetPath = join(root, 'assets', 'future-component', 'unknown.bin')
  await writeFile(externalAssetPath, externalAsset)
  const assetManifestPath = join(root, 'assets', 'manifest.json')
  const assetManifest = await readJson<{
    projectId: string
    assets: Record<string, unknown>[]
  }>(assetManifestPath)
  assetManifest.assets.push({
    assetId: 'asset_00000000-0000-7000-8000-000000000099',
    displayName: 'Report Studio future component fixture',
    mediaType: 'other',
    category: 'other',
    semanticRole: 'report_studio_future_component',
    relativePath: 'assets/future-component/unknown.bin',
    mimeType: 'application/octet-stream',
    sizeBytes: externalAsset.byteLength,
    sha256: createHash('sha256').update(externalAsset).digest('hex'),
    metadata: {},
    adoptionStatus: 'adopted',
    origin: {
      type: 'human_added',
      sourceMaterialIds: [],
      parentAssetIds: [],
      method: 'created by Presentation/Report Studio compatibility fixture',
      sourceTool: { name: 'report-studio', version: '0.2.0-beta.1' },
    },
    createdAt: FIXED_CREATED_AT,
    adoptedAt: FIXED_CREATED_AT,
    retiredAt: null,
  })
  await writeJson(assetManifestPath, assetManifest)
}
`,
]])

await patchFile('src/presentation/workspace-project-writer.ts', [
[
`import {
  lstat,
  mkdir,
  readFile,
  rm,
} from 'node:fs/promises'
`,
`import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  rm,
} from 'node:fs/promises'
`,
],
[
`import {
  isAbsolute,
  join,
  resolve,
  win32,
} from 'node:path'
`,
`import {
  dirname,
  isAbsolute,
  join,
  resolve,
  win32,
} from 'node:path'
`,
],
[
`  PRE_DESIGN_REQUIRED_DIRECTORIES,
  PRESENTATION_LAYOUTS_ROOT,
  managedPathSetFromBuild,
  normalizePreDesignManagedPath,
  readExistingPreDesignManagedPathSet,
} from './workspace-managed-paths.ts'
`,
`  PRE_DESIGN_FIXED_MANAGED_PATHS,
  PRE_DESIGN_REQUIRED_DIRECTORIES,
  PRESENTATION_LAYOUTS_ROOT,
  managedPathSetFromBuild,
  normalizePreDesignManagedPath,
  readExistingPreDesignManagedPathSet,
  type PreDesignManagedPathSet,
} from './workspace-managed-paths.ts'
`,
],
[
`function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function stripAdditiveObjectKeys(existing: unknown, candidate: unknown): unknown {
`,
`function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

const MANIFEST_COLLECTIONS = Object.freeze({
  'source-materials/manifest.json': {
    collectionKey: 'materials',
    idKey: 'sourceMaterialId',
  },
  'assets/manifest.json': {
    collectionKey: 'assets',
    idKey: 'assetId',
  },
} as const)

type ManagedManifestPath = keyof typeof MANIFEST_COLLECTIONS

function manifestCollection(relativePath: string) {
  return Object.hasOwn(MANIFEST_COLLECTIONS, relativePath)
    ? MANIFEST_COLLECTIONS[relativePath as ManagedManifestPath]
    : undefined
}

function managedRecordPath(value: unknown): string | undefined {
  if (!isRecord(value) || typeof value.relativePath !== 'string') return undefined
  return normalizePreDesignManagedPath(value.relativePath)
}

function restrictExistingManagedPaths(
  discovered: PreDesignManagedPathSet,
  expectedHashes: Readonly<Record<string, string>> | undefined,
): PreDesignManagedPathSet {
  if (expectedHashes === undefined) return discovered
  const owned = new Set<string>(PRE_DESIGN_FIXED_MANAGED_PATHS)
  for (const relativePath of Object.keys(expectedHashes)) {
    owned.add(normalizePreDesignManagedPath(relativePath))
  }
  const retain = (relativePath: string) => owned.has(relativePath)
  return Object.freeze({
    all: Object.freeze(discovered.all.filter(retain)),
    canonicalJson: Object.freeze(discovered.canonicalJson.filter(retain)),
    payloadFiles: Object.freeze(discovered.payloadFiles.filter(retain)),
    manifestErrors: discovered.manifestErrors,
  })
}

function ownedManifestProjection(
  value: unknown,
  relativePath: string,
  ownedPaths: ReadonlySet<string>,
): unknown {
  const descriptor = manifestCollection(relativePath)
  if (descriptor === undefined || !isRecord(value)) return value
  const rows = value[descriptor.collectionKey]
  if (!Array.isArray(rows)) return value
  return {
    ...value,
    [descriptor.collectionKey]: rows.filter((row) => {
      const path = managedRecordPath(row)
      return path === undefined || ownedPaths.has(path)
    }),
  }
}

function mergeExternalManifestRecords(input: {
  readonly existing: unknown
  readonly candidate: unknown
  readonly merged: unknown
  readonly relativePath: string
  readonly ownedExistingPaths: ReadonlySet<string>
  readonly candidateManagedPaths: ReadonlySet<string>
}): { readonly document: unknown; readonly externalPayloadPaths: readonly string[] } {
  const descriptor = manifestCollection(input.relativePath)
  if (descriptor === undefined
    || !isRecord(input.existing)
    || !isRecord(input.candidate)
    || !isRecord(input.merged)) {
    return { document: input.merged, externalPayloadPaths: [] }
  }
  const existingRows = input.existing[descriptor.collectionKey]
  const candidateRows = input.candidate[descriptor.collectionKey]
  if (!Array.isArray(existingRows) || !Array.isArray(candidateRows)) {
    return { document: input.merged, externalPayloadPaths: [] }
  }

  const candidateIds = new Set(candidateRows.flatMap((row) => {
    if (!isRecord(row)) return []
    const id = row[descriptor.idKey]
    return typeof id === 'string' ? [id] : []
  }))
  const externalRows: unknown[] = []
  const externalPayloadPaths: string[] = []
  for (const row of existingRows) {
    const path = managedRecordPath(row)
    if (path === undefined || input.ownedExistingPaths.has(path)) continue
    const id = isRecord(row) ? row[descriptor.idKey] : undefined
    if (input.candidateManagedPaths.has(path)
      || (typeof id === 'string' && candidateIds.has(id))) {
      throw new PresentationStandardProjectError(
        'EXTERNAL_PATH_MODIFICATION_FORBIDDEN',
        'preflight',
        `candidate attempts to claim externally owned manifest record '${path}'`,
        { relativePath: input.relativePath, path, id },
      )
    }
    externalRows.push(row)
    externalPayloadPaths.push(path)
  }
  return {
    document: {
      ...input.merged,
      [descriptor.collectionKey]: [...candidateRows, ...externalRows],
    },
    externalPayloadPaths: Object.freeze(externalPayloadPaths),
  }
}

function stripAdditiveObjectKeys(existing: unknown, candidate: unknown): unknown {
`,
],
[
`async function classifyExternalChanges(input: {
  readonly root: string
  readonly candidateRoot: string
  readonly allowedPaths: ReadonlySet<string>
  readonly canonicalPaths: ReadonlySet<string>
  readonly actualHashes: Readonly<Record<string, string>>
  readonly expectedHashes?: Readonly<Record<string, string>>
  readonly confirmExternalChanges: boolean
}): Promise<void> {
`,
`async function classifyExternalChanges(input: {
  readonly root: string
  readonly candidateRoot: string
  readonly allowedPaths: ReadonlySet<string>
  readonly canonicalPaths: ReadonlySet<string>
  readonly ownedExistingPaths: ReadonlySet<string>
  readonly actualHashes: Readonly<Record<string, string>>
  readonly expectedHashes?: Readonly<Record<string, string>>
  readonly confirmExternalChanges: boolean
}): Promise<void> {
`,
],
[
`      if (existing !== undefined
        && candidate !== undefined
        && sha256CanonicalDocument(stripAdditiveObjectKeys(existing, candidate)) === expected) {
        continue
      }
`,
`      const ownedExisting = ownedManifestProjection(
        existing,
        relativePath,
        input.ownedExistingPaths,
      )
      if (existing !== undefined
        && candidate !== undefined
        && sha256CanonicalDocument(stripAdditiveObjectKeys(ownedExisting, candidate)) === expected) {
        continue
      }
`,
],
[
`async function preserveCompatibleJsonExtensions(input: {
  readonly root: string
  readonly candidateRoot: string
  readonly canonicalPaths: readonly string[]
}): Promise<void> {
  const contract = await getPresentationStandardContract()
  for (const relativePath of input.canonicalPaths) {
`,
`async function preserveCompatibleJsonExtensions(input: {
  readonly root: string
  readonly candidateRoot: string
  readonly canonicalPaths: readonly string[]
  readonly ownedExistingPaths: ReadonlySet<string>
  readonly candidateManagedPaths: ReadonlySet<string>
}): Promise<void> {
  const contract = await getPresentationStandardContract()
  const externalPayloadPaths = new Set<string>()
  for (const relativePath of input.canonicalPaths) {
`,
],
[
`    const merged = mergeCompatibleObjectKeys(existing, candidate)
    const documentValidation = await contract.validateDocument(merged as CanonicalDocument)
`,
`    const mergedBase = mergeCompatibleObjectKeys(existing, candidate)
    const mergedResult = mergeExternalManifestRecords({
      existing,
      candidate,
      merged: mergedBase,
      relativePath,
      ownedExistingPaths: input.ownedExistingPaths,
      candidateManagedPaths: input.candidateManagedPaths,
    })
    const merged = mergedResult.document
    for (const path of mergedResult.externalPayloadPaths) externalPayloadPaths.add(path)
    const documentValidation = await contract.validateDocument(merged as CanonicalDocument)
`,
],
[
`    await writeCanonicalJsonAtomically(candidatePath, merged)
  }
  const validation = await contract.validateProject(input.candidateRoot)
`,
`    await writeCanonicalJsonAtomically(candidatePath, merged)
  }
  for (const relativePath of [...externalPayloadPaths].sort((left, right) => left.localeCompare(right))) {
    const source = workspacePath(input.root, relativePath)
    const target = workspacePath(input.candidateRoot, relativePath)
    const info = await lstat(source)
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new PresentationStandardProjectError(
        'CONTRACT_VALIDATION_FAILED',
        'validation',
        `externally owned manifest payload '${relativePath}' is not a regular file`,
        { relativePath },
      )
    }
    if (await exists(target)) {
      throw new PresentationStandardProjectError(
        'EXTERNAL_PATH_MODIFICATION_FORBIDDEN',
        'validation',
        `candidate staging path collides with externally owned payload '${relativePath}'`,
        { relativePath },
      )
    }
    await mkdir(dirname(target), { recursive: true })
    await copyFile(source, target)
  }
  const validation = await contract.validateProject(input.candidateRoot)
`,
],
[
`  await assertWorkspaceRoot(directoryRoot)
  managedPathSetFromBuild(input.build)

  const transaction = await acquirePresentationWorkspaceTransaction(
`,
`  await assertWorkspaceRoot(directoryRoot)
  const candidatePaths = managedPathSetFromBuild(input.build)

  const transaction = await acquirePresentationWorkspaceTransaction(
`,
],
[
`    const existingProjectId = await assertWorkspaceProjectId(directoryRoot, input.build.projectId)
    const existingPaths = await readExistingPreDesignManagedPathSet(directoryRoot)
    if (existingPaths.manifestErrors.length > 0
`,
`    const existingProjectId = await assertWorkspaceProjectId(directoryRoot, input.build.projectId)
    const discoveredExistingPaths = await readExistingPreDesignManagedPathSet(directoryRoot)
    const existingPaths = restrictExistingManagedPaths(
      discoveredExistingPaths,
      input.expectedExistingFileHashes,
    )
    if (discoveredExistingPaths.manifestErrors.length > 0
`,
],
[
`        { errors: existingPaths.manifestErrors },
`,
`        { errors: discoveredExistingPaths.manifestErrors },
`,
],
[
`    const hadManagedEntries = existingPaths.all.length > 0
`,
`    const hadManagedEntries = discoveredExistingPaths.all.length > 0
`,
],
[
`    const candidateRoot = prepared.directoryRoot
    const candidatePaths = managedPathSetFromBuild(input.build)
    const allowedPaths = new Set([...existingPaths.all, ...candidatePaths.all])
    const canonicalPaths = new Set(candidatePaths.canonicalJson)
    const actualHashes = await collectExactHashes(directoryRoot, existingPaths.all)

    await classifyExternalChanges({
`,
`    const candidateRoot = prepared.directoryRoot
    const ownedProjectionHashes = await collectExactHashes(candidateRoot, candidatePaths.all)
    const allowedPaths = new Set([...existingPaths.all, ...candidatePaths.all])
    const canonicalPaths = new Set(candidatePaths.canonicalJson)
    const ownedExistingPathSet = new Set(existingPaths.all)
    const candidateManagedPathSet = new Set(candidatePaths.all)
    const actualHashes = await collectExactHashes(directoryRoot, existingPaths.all)

    await classifyExternalChanges({
`,
],
[
`      allowedPaths,
      canonicalPaths,
      actualHashes,
`,
`      allowedPaths,
      canonicalPaths,
      ownedExistingPaths: ownedExistingPathSet,
      actualHashes,
`,
],
[
`    await preserveCompatibleJsonExtensions({
      root: directoryRoot,
      candidateRoot,
      canonicalPaths: candidatePaths.canonicalJson,
    })
`,
`    await preserveCompatibleJsonExtensions({
      root: directoryRoot,
      candidateRoot,
      canonicalPaths: candidatePaths.canonicalJson,
      ownedExistingPaths: ownedExistingPathSet,
      candidateManagedPaths: candidateManagedPathSet,
    })
`,
],
[
`        fileHashes: actualHashes,
`,
`        fileHashes: ownedProjectionHashes,
`,
],
[
`    const finalPaths = await readExistingPreDesignManagedPathSet(directoryRoot)
    const fileHashes = await collectExactHashes(directoryRoot, finalPaths.all)
    await transaction.markValidated()
`,
`    await transaction.markValidated()
`,
],
[
`      fileHashes,
`,
`      fileHashes: ownedProjectionHashes,
`,
],
])

console.log('SHARED_WORKSPACE_SAFETY_PATCH_APPLIED')
