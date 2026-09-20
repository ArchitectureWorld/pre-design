import { createServer } from 'node:http'
import { afterEach, expect, it, vi } from 'vitest'
import { handleAgentClasses } from '../src/agent-classes/route.ts'
const servers: ReturnType<typeof createServer>[] = []
afterEach(async () => { for (const server of servers.splice(0)) await new Promise<void>(resolve => server.close(() => resolve())) })
async function fixture() {
  let projectId = 'p'
  const classes = { view: vi.fn(async (project?: string) => ({ projectId: project, settings: { revision: 0 } })), save: vi.fn(async (_revision, _routes) => {}) }
  const server = createServer((request, response) => void handleAgentClasses(request, response, { classes, sessions: { get: (id: string) => id === 's' ? {} : undefined }, repository: { readContext: () => ({ project: { projectId } }) } } as never))
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  const origin = `http://127.0.0.1:${address.port}`
  const post = (body: unknown, source = origin) => fetch(`${origin}/preplan-agent-classes`, { method: 'POST', headers: { origin: source, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { classes, post, rebind: () => { projectId = 'other' } }
}
const save = { action: 'save', sessionId: 's', revision: 0, routes: { image: null, web: null, text: null } }
it('rejects cross-origin requests, unknown sessions and caller-supplied project scope', async () => {
  const h = await fixture()
  expect((await h.post(save, 'https://other.example')).status).toBe(403)
  expect((await h.post({ ...save, sessionId: 'missing' })).status).toBe(404)
  expect((await h.post({ ...save, projectId: 'other' })).status).toBe(400)
  expect((await h.post({ ...save, routes: { ...save.routes, arbitrary: null } })).status).toBe(400)
  expect(h.classes.save).not.toHaveBeenCalled()
  expect((await h.post(save)).status).toBe(200)
  expect(h.classes.save).toHaveBeenCalledWith(0, save.routes)
})
it('saves global config without any project, keeps history project-scoped and adapter errors private', async () => {
  const h = await fixture()
  const response = await h.post({ ...save, sessionId: undefined })
  expect(response.status).toBe(200)
  expect(await response.json()).not.toHaveProperty('projectId')
  h.rebind()
  const other = await h.post({ action: 'read', sessionId: 's' })
  expect(await other.json()).toHaveProperty('projectId', 'other')
  h.classes.view.mockRejectedValue(new Error('Bearer sensitive-test-value'))
  const read = await h.post({ action: 'read', sessionId: 's' })
  expect(read.status).toBe(500)
  expect(await read.text()).not.toContain('sensitive-test-value')
})
it('accepts ordered fallback lists while preserving the legacy save signature when omitted', async () => {
  const h = await fixture()
  const fallbacks = { text: [{ provider: 'p', model: 'b' }] }
  expect((await h.post({ ...save, fallbacks })).status).toBe(200)
  expect(h.classes.save).toHaveBeenCalledWith(0, save.routes, fallbacks)
  expect((await h.post({ ...save, fallbacks: { unknown: [] } })).status).toBe(400)
})
