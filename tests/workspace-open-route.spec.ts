import { createServer, type RequestListener } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  handleWorkspaceOpen,
  openWorkspaceInNewWindow,
} from '../src/workspace/open-workspace-route.ts'

const roots: string[] = []
const servers: ReturnType<typeof createServer>[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  for (const server of servers.splice(0)) {
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function listen(handler: RequestListener): Promise<string> {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('server did not listen')
  return `http://127.0.0.1:${address.port}/preplan-open-workspace`
}

describe('direct Workspace folder route', () => {
  it('opens only the Workspace resolved from the current Host session', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'preplan-open-workspace-'))
    roots.push(workspace)
    const opened: string[] = []
    const url = await listen((request, response) => {
      void handleWorkspaceOpen(request, response, {
        sessions: {
          get: id => id === 'session-1' ? { header: { cwd: workspace } } : undefined,
        },
        openDirectory: async path => { opened.push(path) },
      })
    })

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'session-1' }),
    })

    expect(response.status).toBe(204)
    expect(opened).toEqual([workspace])
  })

  it('opens the registered Workspace for a session absent from the live SessionStore', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'preplan-open-workspace-'))
    roots.push(workspace)
    const openDirectory = vi.fn(async () => undefined)
    const url = await listen((request, response) => {
      void handleWorkspaceOpen(request, response, {
        sessions: { get: () => undefined },
        workspaceRegistry: {
          list: () => [{ path: workspace, sessionIds: ['session-stored'] }],
        },
        openDirectory,
      })
    })

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'session-stored' }),
    })

    expect(response.status).toBe(204)
    expect(openDirectory).toHaveBeenCalledExactlyOnceWith(workspace)
  })

  it('rejects an unrecognized session even when Workspaces are registered', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'preplan-open-workspace-'))
    roots.push(workspace)
    const openDirectory = vi.fn(async () => undefined)
    const url = await listen((request, response) => {
      void handleWorkspaceOpen(request, response, {
        sessions: { get: () => undefined },
        workspaceRegistry: {
          list: () => [{ path: workspace, sessionIds: ['session-stored'] }],
        },
        openDirectory,
      })
    })

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'session-unknown' }),
    })

    expect(response.status).toBe(404)
    expect(openDirectory).not.toHaveBeenCalled()
  })

  it('rejects caller-supplied paths instead of exposing an arbitrary local opener', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'preplan-open-workspace-'))
    roots.push(workspace)
    const openDirectory = vi.fn(async () => undefined)
    const url = await listen((request, response) => {
      void handleWorkspaceOpen(request, response, {
        sessions: { get: () => ({ header: { cwd: workspace } }) },
        openDirectory,
      })
    })

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'session-1', path: 'C:\\Windows' }),
    })

    expect(response.status).toBe(400)
    expect(openDirectory).not.toHaveBeenCalled()
  })

  it('uses an interactive desktop launcher instead of starting Explorer in the DSH service session', async () => {
    const run = vi.fn(async () => undefined)

    await openWorkspaceInNewWindow('D:\\少潭河', {
      platform: 'win32',
      windowsDirectory: 'C:\\Windows',
      run,
    })

    expect(run).toHaveBeenCalledOnce()
    const [command, args] = run.mock.calls[0] as unknown as [string, string[]]
    expect(command).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    expect(args.slice(0, 3)).toEqual(['-NoProfile', '-NonInteractive', '-EncodedCommand'])
    expect(args[3]).not.toContain('D:\\少潭河')
  })

  it('does not report an opened folder when the interactive launcher fails', async () => {
    await expect(openWorkspaceInNewWindow('D:\\少潭河', {
      platform: 'win32',
      windowsDirectory: 'C:\\Windows',
      run: async () => { throw new Error('No visible Explorer window') },
    })).rejects.toThrow('No visible Explorer window')
  })
})
