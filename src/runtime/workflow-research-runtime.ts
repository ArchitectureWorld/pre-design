import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import { basename, extname, isAbsolute, relative, resolve } from 'node:path'
import { ResearchExecutionService, type ResearchExecutionResult } from '../research/execution-service.ts'
import type { ResearchRegistry } from '../research/registry.ts'
import { ResearchProviderRouter } from '../research/router.ts'
import { WorkspaceResearchProvider } from '../research/workspace-provider.ts'
import type { ResearchAcquisition } from '../research/execution-service.ts'
import type { ResearchDataPoint } from '../research/types.ts'

const DEFAULT_MAX_FILES = 64
const DEFAULT_MAX_DEPTH = 4
const DEFAULT_MAX_FILE_BYTES = 4 * 1024 * 1024
const SKIP_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'lib', 'build', '.next', '.cache'])
const JSON_EXTENSIONS = new Set(['.json', '.geojson'])
const PREFERRED_FILE_NAMES = new Map([
  ['pre-design.research.json', 0],
  ['research.json', 1],
  ['project.json', 2],
])

export interface WorkflowResearchRuntimeOptions {
  readonly workspaceRootOf?: (parent: unknown) => string | undefined
  readonly clock?: () => Date
  readonly maxFiles?: number
  readonly maxDepth?: number
  readonly maxFileBytes?: number
}

function defaultWorkspaceRootOf(parent: unknown): string | undefined {
  const candidate = parent as { readonly session?: { readonly header?: { readonly cwd?: unknown } } }
  const cwd = candidate.session?.header?.cwd
  return typeof cwd === 'string' && cwd.trim() !== '' ? cwd.trim() : undefined
}

function normalizedKey(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase().replace(/[\s_-]+/gu, '')
}

function pointerEscape(value: string): string {
  return value.replace(/~/gu, '~0').replace(/\//gu, '~1')
}

function pointAliases(point: ResearchDataPoint): ReadonlySet<string> {
  return new Set([
    normalizedKey(point.dataPointId),
    normalizedKey(point.dataPointId.replace(/-/gu, '_')),
    normalizedKey(point.label),
  ])
}

function findPointer(value: unknown, aliases: ReadonlySet<string>, path: readonly string[] = []): string | undefined {
  if (value === null || typeof value !== 'object') return undefined
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findPointer(value[index], aliases, [...path, String(index)])
      if (found !== undefined) return found
    }
    return undefined
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (aliases.has(normalizedKey(key))) return `/${[...path, key].map(pointerEscape).join('/')}`
    const found = findPointer(child, aliases, [...path, key])
    if (found !== undefined) return found
  }
  return undefined
}

function inside(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

interface DiscoveredJsonFile {
  readonly absolutePath: string
  readonly relativePath: string
  readonly depth: number
  readonly value: unknown
}

async function discoverJsonFiles(
  root: string,
  options: { readonly maxFiles: number; readonly maxDepth: number; readonly maxFileBytes: number },
  signal?: AbortSignal,
): Promise<readonly DiscoveredJsonFile[]> {
  const canonicalRoot = await realpath(root)
  const found: DiscoveredJsonFile[] = []

  async function walk(directory: string, depth: number): Promise<void> {
    if (signal?.aborted === true || found.length >= options.maxFiles || depth > options.maxDepth) return
    const rows = await readdir(directory, { withFileTypes: true })
    rows.sort((left, right) => left.name.localeCompare(right.name))
    for (const row of rows) {
      if (found.length >= options.maxFiles) break
      if (signal?.aborted === true) throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
      const requested = resolve(directory, row.name)
      if (row.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(row.name) && depth < options.maxDepth) await walk(requested, depth + 1)
        continue
      }
      if (!row.isFile() || !JSON_EXTENSIONS.has(extname(row.name).toLowerCase())) continue
      const target = await realpath(requested)
      if (!inside(canonicalRoot, target)) continue
      const fileStat = await stat(target)
      if (!fileStat.isFile() || fileStat.size > options.maxFileBytes) continue
      let value: unknown
      try {
        value = JSON.parse(await readFile(target, 'utf8'))
      } catch {
        continue
      }
      found.push({
        absolutePath: target,
        relativePath: relative(canonicalRoot, target).split('\\').join('/'),
        depth,
        value,
      })
    }
  }

  await walk(canonicalRoot, 0)
  return Object.freeze(found.sort((left, right) => {
    const leftPriority = PREFERRED_FILE_NAMES.get(basename(left.relativePath).toLowerCase()) ?? 100
    const rightPriority = PREFERRED_FILE_NAMES.get(basename(right.relativePath).toLowerCase()) ?? 100
    return leftPriority - rightPriority || left.depth - right.depth || left.relativePath.localeCompare(right.relativePath)
  }))
}

export async function planWorkspaceResearchAcquisitions(
  registry: ResearchRegistry,
  workflowId: string,
  rootDir: string,
  options: { readonly maxFiles?: number; readonly maxDepth?: number; readonly maxFileBytes?: number } = {},
  signal?: AbortSignal,
): Promise<readonly ResearchAcquisition[]> {
  const spec = registry.workflow(workflowId)
  const allowedPointIds = new Set(spec.researchSteps
    .filter(step => step.sourceIds.includes('workspace-project-files'))
    .flatMap(step => step.dataPointIds))
  const points = [...spec.requiredDataPoints, ...spec.optionalDataPoints]
    .filter(point => allowedPointIds.has(point.dataPointId))
  if (points.length === 0) return Object.freeze([])

  const files = await discoverJsonFiles(rootDir, {
    maxFiles: Math.max(1, Math.min(256, Math.trunc(options.maxFiles ?? DEFAULT_MAX_FILES))),
    maxDepth: Math.max(0, Math.min(8, Math.trunc(options.maxDepth ?? DEFAULT_MAX_DEPTH))),
    maxFileBytes: Math.max(1024, Math.trunc(options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES)),
  }, signal)

  const acquisitions: ResearchAcquisition[] = []
  for (const point of points) {
    const aliases = pointAliases(point)
    for (const file of files) {
      const pointer = findPointer(file.value, aliases)
      if (pointer === undefined) continue
      acquisitions.push({
        sourceId: 'workspace-project-files',
        request: {
          mode: 'workspace_file',
          workflowId,
          dataPointId: point.dataPointId,
          locator: file.relativePath,
          selector: { type: 'json_pointer', pointer },
        },
      })
      break
    }
  }
  return Object.freeze(acquisitions)
}

export class WorkflowResearchRuntime {
  private readonly workspaceRootOf: (parent: unknown) => string | undefined
  private readonly clock: () => Date

  constructor(
    private readonly registry: ResearchRegistry,
    private readonly options: WorkflowResearchRuntimeOptions = {},
  ) {
    this.workspaceRootOf = options.workspaceRootOf ?? defaultWorkspaceRootOf
    this.clock = options.clock ?? (() => new Date())
  }

  async collect(parent: unknown, workflowId: string, signal?: AbortSignal): Promise<ResearchExecutionResult> {
    const root = this.workspaceRootOf(parent)
    if (root === undefined) {
      return new ResearchExecutionService(this.registry, new ResearchProviderRouter([]))
        .execute(workflowId, [], this.clock().toISOString(), signal)
    }
    const acquisitions = await planWorkspaceResearchAcquisitions(this.registry, workflowId, root, {
      maxFiles: this.options.maxFiles,
      maxDepth: this.options.maxDepth,
      maxFileBytes: this.options.maxFileBytes,
    }, signal)
    const workspace = new WorkspaceResearchProvider({ rootDir: root, maxBytes: this.options.maxFileBytes, clock: this.clock })
    const service = new ResearchExecutionService(this.registry, new ResearchProviderRouter([workspace]))
    return service.execute(workflowId, acquisitions, this.clock().toISOString(), signal)
  }
}
