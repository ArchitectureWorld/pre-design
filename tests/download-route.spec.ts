import { createServer } from 'node:http'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { handleReportDownload } from '../src/report/download-route.ts'

const roots: string[] = []
const servers: ReturnType<typeof createServer>[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>(resolve => server.close(() => resolve()))
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('report download route', () => {
  it('serves known artifacts read-only and rejects encoded traversal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-download-'))
    roots.push(root)
    await mkdir(join(root, 'package-1'), { recursive: true })
    await writeFile(join(root, 'package-1', 'report.pdf'), Buffer.from('%PDF-1.7'))
    const server = createServer((req, res) => { void handleReportDownload(req, res, root) })
    servers.push(server)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('server did not listen')
    const base = `http://127.0.0.1:${address.port}`

    const found = await fetch(`${base}/preplan-export/package-1/report.pdf`)
    const traversal = await fetch(`${base}/preplan-export/package-1/%2e%2e/settings.yaml`)
    const post = await fetch(`${base}/preplan-export/package-1/report.pdf`, { method: 'POST' })

    expect(found.status).toBe(200)
    expect(found.headers.get('content-type')).toBe('application/pdf')
    expect(traversal.status).toBe(404)
    expect(post.status).toBe(405)
  })
})
