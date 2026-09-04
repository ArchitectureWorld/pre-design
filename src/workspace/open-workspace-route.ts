import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isAbsolute, win32 } from 'node:path'

interface SessionLookup {
  get(id: string): { readonly header: { readonly cwd?: string } } | undefined
}

interface OpenWorkspaceOptions {
  readonly sessions: SessionLookup
  readonly openDirectory?: (path: string) => Promise<void>
}

interface NativeOpenOptions {
  readonly platform?: NodeJS.Platform
  readonly windowsDirectory?: string
  readonly run?: (command: string, args: readonly string[]) => Promise<void>
}

function send(response: ServerResponse, status: number, message = ''): void {
  response.statusCode = status
  if (message !== '') response.setHeader('content-type', 'text/plain; charset=utf-8')
  response.end(message)
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  let body = ''
  for await (const chunk of request) {
    body += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
    if (Buffer.byteLength(body, 'utf8') > 4096) throw new Error('request body is too large')
  }
  return JSON.parse(body)
}

function runDetached(command: string, args: readonly string[]): Promise<void> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, [...args], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    })
    child.once('error', rejectRun)
    child.once('spawn', () => {
      child.unref()
      resolveRun()
    })
  })
}

export async function openWorkspaceInNewWindow(
  path: string,
  options: NativeOpenOptions = {},
): Promise<void> {
  const platform = options.platform ?? process.platform
  const run = options.run ?? runDetached
  if (platform === 'win32') {
    const windowsDirectory = options.windowsDirectory ?? process.env.SystemRoot ?? 'C:\\Windows'
    await run(win32.join(windowsDirectory, 'explorer.exe'), [`/n,${path}`])
    return
  }
  if (platform === 'darwin') {
    await run('open', [path])
    return
  }
  if (platform === 'linux') {
    await run('xdg-open', [path])
    return
  }
  throw new Error(`unsupported platform: ${platform}`)
}

export async function handleWorkspaceOpen(
  request: IncomingMessage,
  response: ServerResponse,
  options: OpenWorkspaceOptions,
): Promise<void> {
  if (request.method !== 'POST') {
    response.setHeader('allow', 'POST')
    send(response, 405, 'Method Not Allowed')
    return
  }
  let payload: unknown
  try {
    payload = await readJson(request)
  } catch {
    send(response, 400, 'Invalid request')
    return
  }
  if (
    payload === null
    || typeof payload !== 'object'
    || Array.isArray(payload)
    || Object.keys(payload).length !== 1
    || typeof Reflect.get(payload, 'sessionId') !== 'string'
    || Reflect.get(payload, 'sessionId').trim() === ''
  ) {
    send(response, 400, 'Invalid request')
    return
  }
  const session = options.sessions.get(Reflect.get(payload, 'sessionId'))
  const workspace = session?.header.cwd?.trim()
  if (workspace === undefined || workspace === '' || !isAbsolute(workspace)) {
    send(response, 404, 'Workspace not found')
    return
  }
  try {
    const info = await stat(workspace)
    if (!info.isDirectory()) throw new Error('Workspace is not a directory')
    await (options.openDirectory ?? openWorkspaceInNewWindow)(workspace)
    send(response, 204)
  } catch {
    send(response, 500, 'Workspace could not be opened')
  }
}

export interface WorkspaceOpenRegistrar {
  register(definition: {
    readonly kind: 'exact'
    readonly path: '/preplan-open-workspace'
    readonly handler: (request: IncomingMessage, response: ServerResponse) => Promise<void>
  }): unknown
}

export function registerWorkspaceOpenRoute(
  webServer: WorkspaceOpenRegistrar,
  sessions: SessionLookup,
): void {
  webServer.register({
    kind: 'exact',
    path: '/preplan-open-workspace',
    handler: (request, response) => handleWorkspaceOpen(request, response, { sessions }),
  })
}
