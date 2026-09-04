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

  it('uses the Windows Explorer new-window switch', async () => {
    const run = vi.fn(async () => undefined)

    await openWorkspaceInNewWindow('D:\\少潭河', {
      platform: 'win32',
      windowsDirectory: 'C:\\Windows',
      run,
    })

    expect(run).toHaveBeenCalledWith(
      'C:\\Windows\\explorer.exe',
      ['/n,D:\\少潭河'],
    )
  })
})
