import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import type { ProjectRepository } from '../state/repository.ts'
import { fallbacksSchema, routesSchema } from './domain.ts'
import { modelRoute, type AgentClassService } from './service.ts'
import type { ModelRoute } from './types.ts'

const requestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('read'), sessionId: z.string().min(1).max(300).optional() }).strict(),
  z.object({ action: z.literal('save'), sessionId: z.string().min(1).max(300).optional(), revision: z.number().int().nonnegative(), routes: routesSchema, fallbacks: fallbacksSchema.optional() }).strict(),
])
interface Dependencies {
  readonly routeForSession?: (sessionId: string) => ModelRoute | undefined
  readonly classes: AgentClassService
  readonly repository: Pick<ProjectRepository, 'readContext'>
  readonly sessions: { get(id: string): { requestHeader?(): { config?: unknown } | undefined } | undefined }
}
export interface AgentClassRegistrar {
  register(definition: { readonly kind: 'exact'; readonly path: '/preplan-agent-classes'; readonly handler: (request: IncomingMessage, response: ServerResponse) => Promise<void> }): unknown
}
function send(response: ServerResponse, status: number, data: unknown) {
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(JSON.stringify(data))
}
export async function handleAgentClasses(request: IncomingMessage, response: ServerResponse, deps: Dependencies): Promise<void> {
  if (request.method !== 'POST') { response.setHeader('allow', 'POST'); send(response, 405, { error: '仅支持 POST。' }); return }
  const origin = request.headers.origin
  const protocol = (request.socket as { encrypted?: boolean }).encrypted ? 'https' : 'http'
  if (origin !== `${protocol}://${request.headers.host}` || request.headers['sec-fetch-site'] === 'cross-site') {
    send(response, 403, { error: '请求来源不匹配。' }); return
  }
  if (!request.headers['content-type']?.startsWith('application/json')) { send(response, 415, { error: '请使用 JSON。' }); return }
  let payload: z.infer<typeof requestSchema>
  try {
    const chunks: Buffer[] = []
    let bytes = 0
    for await (const chunk of request) {
      const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      bytes += part.length
      if (bytes > 65536) throw new Error('body limit')
      chunks.push(part)
    }
    payload = requestSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
  } catch { send(response, 400, { error: '配置请求格式无效。' }); return }
  const session = payload.sessionId ? deps.sessions.get(payload.sessionId) : undefined
  if (payload.sessionId && !session) { send(response, 404, { error: '当前会话不存在。' }); return }
  let projectId: string | undefined
  if (payload.sessionId) {
    try { projectId = deps.repository.readContext(payload.sessionId).project.projectId }
    catch { /* Global configuration remains available before a project is opened. */ }
  }
  try {
    if (payload.action === 'save') {
      if (payload.fallbacks === undefined) await deps.classes.save(payload.revision, payload.routes)
      else await deps.classes.save(payload.revision, payload.routes, payload.fallbacks)
    }
    send(response, 200, await deps.classes.view(projectId, (payload.sessionId ? deps.routeForSession?.(payload.sessionId) : undefined) ?? modelRoute(session?.requestHeader?.()?.config)))
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    const invalid = /^(MODEL_ROUTE_DUPLICATE|MODEL_PRIMARY_REQUIRED):/u.test(message)
    const known = invalid || /^(CONFIG_CONFLICT|MODEL_UNAVAILABLE):/u.test(message)
    send(response, invalid ? 400 : known ? 409 : 500, { error: known ? message : '子 Agent 配置操作失败，请检查 DSH 服务。' })
  }
}
export function registerAgentClassRoute(server: AgentClassRegistrar, deps: Dependencies): void {
  server.register({ kind: 'exact', path: '/preplan-agent-classes', handler: (request, response) => handleAgentClasses(request, response, deps) })
}
