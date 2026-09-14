import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import { basename, extname, isAbsolute, relative, resolve } from 'node:path'
import { ResearchExecutionService, type ResearchAcquisition, type ResearchExecutionResult } from '../research/execution-service.ts'
import { ProjectStateResearchProvider } from '../research/project-state-provider.ts'
import type { ResearchProvider } from '../research/provider.ts'
import type { ResearchRegistry } from '../research/registry.ts'
import { ResearchProviderRouter } from '../research/router.ts'
import type { ResearchDataPoint } from '../research/types.ts'
import { WorkspaceResearchProvider } from '../research/workspace-provider.ts'
import type { ProjectContext, StateObjectRecord } from '../state/types.ts'

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
  readonly projectContextOf?: (parent: unknown) => Pick<ProjectContext, 'project' | 'stateObjects'> | undefined
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

function assertNotAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
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
  readonly relativePath: string
  readonly depth: number
  readonly value: unknown
}

async function discoverJsonFiles(
  root: string,
  options: { readonly maxFiles: number; readonly maxDepth: number; readonly maxFileBytes: number },
  signal?: AbortSignal,
): Promise<readonly DiscoveredJsonFile[]> {
  assertNotAborted(signal)
  const canonicalRoot = await realpath(root)
  const found: DiscoveredJsonFile[] = []

  async function walk(directory: string, depth: number): Promise<void> {
    assertNotAborted(signal)
    if (found.length >= options.maxFiles || depth > options.maxDepth) return
    const rows = await readdir(directory, { withFileTypes: true })
    rows.sort((left, right) => left.name.localeCompare(right.name))
    for (const row of rows) {
      if (found.length >= options.maxFiles) break
      assertNotAborted(signal)
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

function pointsForSource(registry: ResearchRegistry, workflowId: string, sourceId: string): readonly ResearchDataPoint[] {
  const spec = registry.workflow(workflowId)
  const allowedPointIds = new Set(spec.researchSteps
    .filter(step => step.sourceIds.includes(sourceId))
    .flatMap(step => step.dataPointIds))
  return Object.freeze([...spec.requiredDataPoints, ...spec.optionalDataPoints]
    .filter(point => allowedPointIds.has(point.dataPointId)))
}

export async function planWorkspaceResearchAcquisitions(
  registry: ResearchRegistry,
  workflowId: string,
  rootDir: string,
  options: { readonly maxFiles?: number; readonly maxDepth?: number; readonly maxFileBytes?: number } = {},
  signal?: AbortSignal,
): Promise<readonly ResearchAcquisition[]> {
  const points = pointsForSource(registry, workflowId, 'workspace-project-files')
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

export function planProjectStateResearchAcquisitions(
  registry: ResearchRegistry,
  workflowId: string,
  stateObjects: readonly StateObjectRecord[],
): readonly ResearchAcquisition[] {
  const points = pointsForSource(registry, workflowId, 'project-state-store')
  if (points.length === 0 || stateObjects.length === 0) return Object.freeze([])
  const ordered = [...stateObjects].sort((left, right) => right.revision - left.revision || left.objectId.localeCompare(right.objectId))
  const acquisitions: ResearchAcquisition[] = []
  for (const point of points) {
    const aliases = pointAliases(point)
    for (const state of ordered) {
      const pointer = findPointer(state.value, aliases)
      if (pointer === undefined) continue
      acquisitions.push({
        sourceId: 'project-state-store',
        request: {
          mode: 'project_state',
          workflowId,
          dataPointId: point.dataPointId,
          locator: state.objectId,
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
  private readonly projectContextOf?: (parent: unknown) => Pick<ProjectContext, 'project' | 'stateObjects'> | undefined
  private readonly clock: () => Date

  constructor(
    private readonly registry: ResearchRegistry,
    private readonly options: WorkflowResearchRuntimeOptions = {},
  ) {
    this.workspaceRootOf = options.workspaceRootOf ?? defaultWorkspaceRootOf
    this.projectContextOf = options.projectContextOf
    this.clock = options.clock ?? (() => new Date())
  }

  async collect(parent: unknown, workflowId: string, signal?: AbortSignal): Promise<ResearchExecutionResult> {
    assertNotAborted(signal)
    const root = this.workspaceRootOf(parent)
    const context = this.projectContextOf?.(parent)
    const acquisitions: ResearchAcquisition[] = []
    const providers: ResearchProvider[] = []

    if (root !== undefined) {
      const workspaceOptions = {
        ...(this.options.maxFiles === undefined ? {} : { maxFiles: this.options.maxFiles }),
        ...(this.options.maxDepth === undefined ? {} : { maxDepth: this.options.maxDepth }),
        ...(this.options.maxFileBytes === undefined ? {} : { maxFileBytes: this.options.maxFileBytes }),
      }
      acquisitions.push(...await planWorkspaceResearchAcquisitions(this.registry, workflowId, root, workspaceOptions, signal))
      providers.push(new WorkspaceResearchProvider({
        rootDir: root,
        ...(this.options.maxFileBytes === undefined ? {} : { maxBytes: this.options.maxFileBytes }),
        clock: this.clock,
      }))
    }

    if (context !== undefined) {
      acquisitions.push(...planProjectStateResearchAcquisitions(this.registry, workflowId, context.stateObjects))
      providers.push(new ProjectStateResearchProvider({
        projectId: context.project.projectId,
        stateObjects: context.stateObjects,
        clock: this.clock,
      }))
    }

    const service = new ResearchExecutionService(this.registry, new ResearchProviderRouter(providers))
    return service.execute(workflowId, acquisitions, this.clock().toISOString(), signal)
  }
}
