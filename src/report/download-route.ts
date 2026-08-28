import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'

const CONTENT_TYPES: Readonly<Record<string, string>> = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
})

function send(response: ServerResponse, status: number, message: string): void {
  response.statusCode = status
  response.setHeader('content-type', 'text/plain; charset=utf-8')
  response.end(message)
}

function safeSegment(value: string): boolean {
  return /^[A-Za-z0-9._-]+$/u.test(value) && value !== '.' && value !== '..'
}

export async function handleReportDownload(
  request: IncomingMessage,
  response: ServerResponse,
  packageRoot: string,
): Promise<void> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('allow', 'GET, HEAD')
    send(response, 405, 'Method Not Allowed')
    return
  }
  const rawPath = (request.url ?? '').split('?', 1)[0] ?? ''
  if (/\\|%5c|%2e/iu.test(rawPath)) {
    send(response, 404, 'Not Found')
    return
  }
  let segments: string[]
  try {
    segments = rawPath.split('/').filter(Boolean).map(segment => decodeURIComponent(segment))
  } catch {
    send(response, 404, 'Not Found')
    return
  }
  if (segments[0] !== 'preplan-export' || segments.length < 3 || !safeSegment(segments[1]!)) {
    send(response, 404, 'Not Found')
    return
  }
  const packageId = segments[1]!
  const fileSegments = segments.slice(2)
  if (fileSegments.some(segment => !safeSegment(segment))) {
    send(response, 404, 'Not Found')
    return
  }
  const packageDirectory = resolve(packageRoot, packageId)
  const requested = resolve(packageDirectory, ...fileSegments)
  const boundary = relative(packageDirectory, requested)
  if (boundary === '' || boundary.startsWith(`..${sep}`) || boundary === '..' || isAbsolute(boundary)) {
    send(response, 404, 'Not Found')
    return
  }
  try {
    const info = await stat(requested)
    if (!info.isFile()) throw new Error('not a file')
    response.statusCode = 200
    response.setHeader('content-type', CONTENT_TYPES[extname(requested).toLowerCase()] ?? 'application/octet-stream')
    response.setHeader('content-length', info.size)
    response.setHeader('x-content-type-options', 'nosniff')
    if (request.method === 'HEAD') {
      response.end()
      return
    }
    const stream = createReadStream(requested)
    stream.once('error', () => {
      if (!response.headersSent) send(response, 404, 'Not Found')
      else response.destroy()
    })
    stream.pipe(response)
  } catch {
    if (!response.headersSent) send(response, 404, 'Not Found')
  }
}

export interface ReportDownloadRegistrar {
  register(definition: {
    readonly kind: 'prefix'
    readonly path: '/preplan-export'
    readonly handler: (request: IncomingMessage, response: ServerResponse) => Promise<void>
  }): unknown
}

export function registerReportDownloadRoute(webServer: ReportDownloadRegistrar, packageRoot: string): void {
  webServer.register({
    kind: 'prefix',
    path: '/preplan-export',
    handler: (request, response) => handleReportDownload(request, response, packageRoot),
  })
}
