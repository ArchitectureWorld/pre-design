import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { isAbsolute, join, win32 } from 'node:path'

interface SessionLookup {
  get(id: string): { readonly header: { readonly cwd?: string } } | undefined
}

export interface WorkspaceLookup {
  list(): readonly { readonly path: string; readonly sessionIds: readonly string[] }[]
}

interface OpenWorkspaceOptions {
  readonly sessions: SessionLookup
  readonly workspaceRegistry?: WorkspaceLookup
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

function runToExit(command: string, args: readonly string[]): Promise<void> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, [...args], { windowsHide: true, stdio: 'ignore', signal: AbortSignal.timeout(20_000) })
    child.once('error', rejectRun)
    child.once('exit', code => code === 0 ? resolveRun() : rejectRun(new Error(`interactive Explorer launcher exited with ${code}`)))
  })
}

function encodedPowerShell(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

function interactiveExplorerCommand(path: string, windowsDirectory: string): [string, string[]] {
  const id = randomUUID()
  const taskName = `PreplanOpen-${id}`
  const resultPath = join(tmpdir(), `preplan-open-${id}.json`)
  const target = Buffer.from(path, 'utf8').toString('base64')
  const result = Buffer.from(resultPath, 'utf8').toString('base64')
  const interactiveScript = `
$ErrorActionPreference = 'Stop'
$target = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${target}'))
$resultPath = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${result}'))
try {
  if ((Get-Process -Id $PID).SessionId -eq 0) { throw 'No interactive desktop session' }
  $shell = New-Object -ComObject Shell.Application
  function MatchingWindows {
    @($shell.Windows() | ForEach-Object { try { if ($_.Document.Folder.Self.Path -ieq $target) { [long]$_.HWND } } catch {} })
  }
  $before = @(MatchingWindows)
  Start-Process -FilePath (Join-Path $env:SystemRoot 'explorer.exe') -ArgumentList ('/n,"' + $target + '"')
  $found = $false
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    Start-Sleep -Milliseconds 250
    if (@(MatchingWindows | Where-Object { $_ -notin $before }).Count -gt 0) { $found = $true; break }
  }
  if (-not $found) { throw 'No new Explorer window appeared' }
  @{ opened = $true } | ConvertTo-Json -Compress | Set-Content -LiteralPath $resultPath -Encoding utf8
} catch {
  @{ opened = $false } | ConvertTo-Json -Compress | Set-Content -LiteralPath $resultPath -Encoding utf8
  exit 1
}`
  const powershell = win32.join(windowsDirectory, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const actionArguments = `-NoProfile -NonInteractive -EncodedCommand ${encodedPowerShell(interactiveScript)}`
  const controllerScript = `
$ErrorActionPreference = 'Stop'
$taskName = '${taskName}'
$resultPath = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${result}'))
$action = New-ScheduledTaskAction -Execute '${powershell}' -Argument '${actionArguments}'
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principal -Force | Out-Null
try {
  Start-ScheduledTask -TaskName $taskName
  for ($attempt = 0; $attempt -lt 120; $attempt++) {
    if (Test-Path -LiteralPath $resultPath) { break }
    Start-Sleep -Milliseconds 100
  }
  if (-not (Test-Path -LiteralPath $resultPath)) { throw 'Interactive Explorer did not respond' }
  $outcome = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json
  if (-not $outcome.opened) { throw 'Interactive Explorer did not open a window' }
} finally {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $resultPath -Force -ErrorAction SilentlyContinue
}`
  return [powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodedPowerShell(controllerScript)]]
}

export async function openWorkspaceInNewWindow(
  path: string,
  options: NativeOpenOptions = {},
): Promise<void> {
  const platform = options.platform ?? process.platform
  const run = options.run ?? runDetached
  if (platform === 'win32') {
    const windowsDirectory = options.windowsDirectory ?? process.env.SystemRoot ?? 'C:\\Windows'
    const [command, args] = interactiveExplorerCommand(path, windowsDirectory)
    await (options.run ?? runToExit)(command, args)
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
  const sessionId = Reflect.get(payload, 'sessionId') as string
  const session = options.sessions.get(sessionId)
  const workspace = session?.header.cwd?.trim()
    || options.workspaceRegistry?.list().find(item => item.sessionIds.includes(sessionId))?.path.trim()
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
  workspaceRegistry: WorkspaceLookup,
): void {
  webServer.register({
    kind: 'exact',
    path: '/preplan-open-workspace',
    handler: (request, response) => handleWorkspaceOpen(request, response, { sessions, workspaceRegistry }),
  })
}
