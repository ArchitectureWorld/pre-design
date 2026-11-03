import { createHash } from 'node:crypto'
import { lstat, readdir, realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from 'sharp'
import { safeProjectPath } from './project-boundary.mjs'
import { readBoundFile } from './research-artifacts.mjs'

const receiptRoot = '.pre-design/image-requests/receipts'
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value)
const token = value => typeof value === 'string' && /^[\p{L}\p{N}_.:@-]{1,256}$/u.test(value)
const positive = value => Number.isSafeInteger(value) && value > 0
const states = new Set(['preparing', 'dispatching', 'submission_unknown', 'submitted', 'completed', 'failed'])
const modes = new Set(['generate', 'edit'])
const mediaTypes = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' }
const cancellationReasons = new Set(['running', 'not-queued', 'still-queued', 'unknown', 'completed'])
function error(code) { return Object.assign(new Error(code), { code }) }
function date(value) {
  const time = typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined
}
async function collect(workspace) {
  const root = await realpath(workspace)
  if (root !== resolve(workspace)) throw error('IMAGE_RECEIPT_SCOPE_INVALID')
  let entries
  try { entries = await readdir(safeProjectPath(root, receiptRoot), { withFileTypes: true }) }
  catch (failure) { if (failure.code === 'ENOENT' || failure.message?.startsWith('WEB_')) return { root, rows: [] }; throw failure }
  const rows = []
  for (const entry of entries.filter(row => row.isDirectory() && hash(row.name)).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 4096)) {
    try {
      const path = `${receiptRoot}/${entry.name}/receipt.json`, info = await lstat(safeProjectPath(root, path))
      if (!info.isFile() || info.size > 128 * 1024) continue
      const bytes = await readBoundFile(root, path)
      if (bytes.length > 128 * 1024) continue
      const row = JSON.parse(bytes.toString('utf8'))
      if (row?.version !== 1 || row.requestId !== entry.name || !states.has(row.state) || !modes.has(row.mode)
        || !date(row.createdAt) || !date(row.updatedAt)) continue
      rows.push(row)
    } catch { /* Missing, replaced, linked or damaged receipts grant no read capability. */ }
  }
  rows.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.requestId.localeCompare(b.requestId))
  return { root, rows }
}
function publicWorkflow(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const result = {}
  for (const key of ['workflowId', 'workflowVersion', 'model']) if (token(value[key])) result[key] = value[key]
  for (const key of ['workflowSha256', 'requestId']) if (hash(value[key])) result[key] = value[key]
  if (modes.has(value.mode)) result.mode = value.mode
  if (Number.isSafeInteger(value.seed) && value.seed >= 0) result.seed = value.seed
  for (const key of ['width', 'height']) if (positive(value[key]) && value[key] <= 8192) result[key] = value[key]
  return result
}
function publicOutput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const result = {}
  if (hash(value.sha256)) result.sha256 = value.sha256
  if (Object.values(mediaTypes).includes(value.mediaType)) result.mediaType = value.mediaType
  for (const key of ['width', 'height', 'bytes']) if (positive(value[key])) result[key] = value[key]
  return result
}

/** Historical request state only; never project prompts, paths, reference content or credentials. */
export async function readImageReceipts(workspace, { since } = {}) {
  const threshold = since === undefined ? 0 : typeof since === 'number' ? since : typeof since === 'string' ? Date.parse(since) : NaN
  if (!Number.isFinite(threshold) || threshold < 0) throw error('IMAGE_RECEIPT_TIME_INVALID')
  const { rows } = await collect(workspace)
  return rows.filter(row => Date.parse(row.updatedAt) >= threshold).map(row => {
    const result = { requestId: row.requestId, state: row.state, mode: row.mode, createdAt: date(row.createdAt), updatedAt: date(row.updatedAt) }
    for (const key of ['toolCallId', 'executionId', 'taskId', 'promptId']) if (token(row[key])) result[key] = row[key]
    if (positive(row.attempt)) result.attempt = row.attempt
    if (typeof row.errorCode === 'string' && /^IMAGE_[A-Z_]{1,80}$/u.test(row.errorCode)) result.errorCode = row.errorCode
    const workflow = publicWorkflow(row.workflow), output = publicOutput(row.output)
    if (workflow) result.workflow = workflow
    if (output) result.output = output
    if (row.cancellation && typeof row.cancellation.cancelled === 'boolean') {
      result.cancellation = { cancelled: row.cancellation.cancelled }
      if (token(row.cancellation.promptId)) result.cancellation.promptId = row.cancellation.promptId
      if (cancellationReasons.has(row.cancellation.reason)) result.cancellation.reason = row.cancellation.reason
    }
    return result
  })
}

/** Enumerate only the exact output path owned by a completed, independently verified receipt. */
export async function listGeneratedImages(workspace) {
  const { root, rows } = await collect(workspace), files = []
  for (const row of rows) {
    if (row.state !== 'completed' || !token(row.promptId)) continue
    const output = row.output, format = Object.keys(mediaTypes).find(format => output?.path === `${receiptRoot}/${row.requestId}/output.${format}`)
    if (!format || !hash(output.sha256) || output.mediaType !== mediaTypes[format] || !positive(output.bytes) || output.bytes > 64 * 1024 * 1024
      || !positive(output.width) || !positive(output.height) || output.width * output.height > 40_000_000) continue
    try {
      const bytes = await readBoundFile(root, output.path)
      if (bytes.length !== output.bytes || createHash('sha256').update(bytes).digest('hex') !== output.sha256) continue
      const image = sharp(bytes, { limitInputPixels: 40_000_000, failOn: 'warning' }), metadata = await image.metadata()
      if (metadata.format !== format || metadata.width !== output.width || metadata.height !== output.height || metadata.pages > 1) continue
      await image.raw().toBuffer()
      files.push({ relative: output.path, filename: `flux3-${row.requestId.slice(0, 16)}.${format}`, sha256: output.sha256, bytes: bytes.length,
        width: metadata.width, height: metadata.height, requestId: row.requestId })
    } catch { /* A stale output is unavailable; never replace it with a reference or another file. */ }
  }
  return files
}
