import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, symlink, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'

const receipts = await import('../../worker/image-receipts.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.message.includes('/worker/image-receipts.mjs')) return {}
  throw error
})
const requestId = 'a'.repeat(64), earlierId = 'b'.repeat(64)
const hash = data => createHash('sha256').update(data).digest('hex')
async function fixture(t) {
  assert.equal(typeof receipts.readImageReceipts, 'function', '需实现管理员收据白名单投影')
  assert.equal(typeof receipts.listGeneratedImages, 'function', '需实现已核验生成图片枚举')
  const root = await mkdtemp(join(tmpdir(), 'image-receipts-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const png = await sharp({ create: { width: 32, height: 16, channels: 3, background: '#a3b4c5' } }).png().toBuffer()
  const row = { version: 1, requestId, state: 'completed', mode: 'generate', toolCallId: 'call-a', executionId: 'execution-a', taskId: 'scene-a', attempt: 1,
    promptId: 'prompt-a', createdAt: '2026-11-03T01:00:00.000Z', updatedAt: '2026-11-03T01:05:00.000Z',
    workflow: { workflowId: 'flux3-klein-t2i', workflowVersion: '2026-11-03.1', workflowSha256: 'c'.repeat(64), model: 'flux3-image-klein-bf16.safetensors', mode: 'generate', requestId, seed: 123 },
    output: { path: `.pre-design/image-requests/receipts/${requestId}/output.png`, mediaType: 'image/png', sha256: hash(png), bytes: png.length, width: 32, height: 16 } }
  const save = async (value = row, id = value.requestId) => {
    const path = join(root, `.pre-design/image-requests/receipts/${id}/receipt.json`)
    await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify(value)); return path
  }
  await save(); await writeFile(join(root, row.output.path), png)
  return { root, png, row, save }
}

test('管理员摘要仅保留收据白名单，默认不携带提示词、身份、参考路径和密钥', async t => {
  const f = await fixture(t)
  await f.save({ ...f.row, projectId: 'secret-project', sessionId: 'secret-session', agentId: 'secret-agent', inputHash: 'private-input-hash', prompt: 'private-prompt',
    credentials: { token: 'private-token' }, reference: { path: '/private/source.png' },
    workflow: { ...f.row.workflow, prompt: 'private-workflow-prompt', baseURL: 'http://private-server' },
    output: { ...f.row.output, credentials: 'private-output-secret' },
    cancellation: { promptId: 'prompt-a', cancelled: false, reason: 'running', secret: 'private-cancel-secret' } })
  const result = await receipts.readImageReceipts(f.root)
  assert.equal(result.length, 1)
  assert.equal(result[0].requestId, requestId); assert.equal(result[0].promptId, 'prompt-a')
  assert.deepEqual(result[0].workflow, f.row.workflow)
  assert.deepEqual(result[0].output, { mediaType: 'image/png', sha256: hash(f.png), bytes: f.png.length, width: 32, height: 16 })
  assert.deepEqual(result[0].cancellation, { promptId: 'prompt-a', cancelled: false, reason: 'running' })
  assert.doesNotMatch(JSON.stringify(result), /secret|private|\.pre-design|"path"|"prompt"|inputHash|sessionId|agentId|projectId/)
})

test('未知状态保留真实 promptId 缺失和错误码，不虚构成功或输出', async t => {
  const f = await fixture(t), { output: _output, promptId: _promptId, ...unknown } = f.row
  await f.save({ ...unknown, state: 'submission_unknown', errorCode: 'IMAGE_SUBMISSION_UNKNOWN' })
  const result = await receipts.readImageReceipts(f.root)
  assert.equal(result[0].state, 'submission_unknown')
  assert.equal(result[0].errorCode, 'IMAGE_SUBMISSION_UNKNOWN')
  assert.equal(result[0].promptId, undefined)
  assert.deepEqual(await receipts.listGeneratedImages(f.root), [])
})

test('since 根据更新时间筛选并降序返回，错误时间被拒绝', async t => {
  const f = await fixture(t)
  await f.save({ ...f.row, requestId: earlierId, state: 'submitted', updatedAt: '2026-11-03T01:01:00.000Z' })
  assert.deepEqual((await receipts.readImageReceipts(f.root)).map(row => row.requestId), [requestId, earlierId])
  assert.deepEqual((await receipts.readImageReceipts(f.root, { since: '2026-11-03T01:02:00.000Z' })).map(row => row.requestId), [requestId])
  assert.equal((await receipts.readImageReceipts(f.root, { since: Date.parse('2026-11-03T01:06:00.000Z') })).length, 0)
  await assert.rejects(receipts.readImageReceipts(f.root, { since: 'invalid' }), /IMAGE_RECEIPT_TIME_INVALID/)
})

test('只枚举已完成且全像素、字节数、哈希和尺寸都核验的实际输出', async t => {
  const f = await fixture(t), result = await receipts.listGeneratedImages(f.root)
  assert.deepEqual(result, [{ relative: f.row.output.path, filename: `flux3-${requestId.slice(0, 16)}.png`, sha256: hash(f.png), bytes: f.png.length, width: 32, height: 16, requestId }])
  assert.deepEqual(await readFile(join(f.root, result[0].relative)), f.png)
  assert.equal(JSON.stringify(result).includes(f.root), false)
})

test('记录、目录、输出的符号链接和请求ID伪造均不枚举', async t => {
  for (const variant of ['receipt-link', 'directory-link', 'output-link', 'identity']) await t.test(variant, async t => {
    const f = await fixture(t), record = join(f.root, `.pre-design/image-requests/receipts/${requestId}/receipt.json`)
    if (variant === 'receipt-link') { await writeFile(join(f.root, 'other.json'), JSON.stringify(f.row)); await rm(record); await symlink(join(f.root, 'other.json'), record) }
    if (variant === 'directory-link') { const folder = dirname(record); await rm(folder, { recursive: true }); await mkdir(join(f.root, 'foreign')); await writeFile(join(f.root, 'foreign/receipt.json'), JSON.stringify(f.row)); await symlink(join(f.root, 'foreign'), folder) }
    if (variant === 'output-link') { await writeFile(join(f.root, 'foreign.png'), f.png); await rm(join(f.root, f.row.output.path)); await symlink(join(f.root, 'foreign.png'), join(f.root, f.row.output.path)) }
    if (variant === 'identity') await f.save({ ...f.row, requestId: earlierId }, requestId)
    assert.deepEqual(await receipts.listGeneratedImages(f.root), [])
    if (variant !== 'output-link') assert.deepEqual(await receipts.readImageReceipts(f.root), [])
  })
})

test('output.path 不得绕过固定输出位置，即使任意项目图片哈希相同', async t => {
  for (const path of ['assets/images/foreign.png', `/tmp/${requestId}.png`, `../${requestId}.png`, `.pre-design/image-requests/receipts/${earlierId}/output.png`, `.pre-design/image-requests/receipts/${requestId}/reference.png`]) await t.test(path, async t => {
    const f = await fixture(t)
    await f.save({ ...f.row, output: { ...f.row.output, path } })
    assert.deepEqual(await receipts.listGeneratedImages(f.root), [])
  })
})

test('缺图、哈希或尺寸变化、假PNG及非完成状态均不能下载', async t => {
  for (const variant of ['missing', 'hash', 'width', 'bytes', 'fake-png', 'submitted']) await t.test(variant, async t => {
    const f = await fixture(t), row = structuredClone(f.row)
    if (variant === 'missing') await rm(join(f.root, row.output.path))
    if (variant === 'hash') row.output.sha256 = '0'.repeat(64)
    if (variant === 'width') row.output.width = 64
    if (variant === 'bytes') row.output.bytes++
    if (variant === 'fake-png') { const bytes = Buffer.from('not-a-png'); await writeFile(join(f.root, row.output.path), bytes); row.output.sha256 = hash(bytes); row.output.bytes = bytes.length }
    if (variant === 'submitted') row.state = 'submitted'
    await f.save(row)
    assert.deepEqual(await receipts.listGeneratedImages(f.root), [])
  })
})

test('损坏记录不阻断其他收执，安全字段中的路径和非枚举值被剔除', async t => {
  const f = await fixture(t)
  await f.save({ ...f.row, requestId: earlierId }, earlierId)
  await writeFile(join(f.root, `.pre-design/image-requests/receipts/${earlierId}/receipt.json`), '{broken')
  await f.save({ ...f.row, promptId: '/private/path', workflow: { ...f.row.workflow, workflowId: 'http://private/token' }, cancellation: { promptId: 'prompt-a', cancelled: false, reason: 'private text' } })
  const result = await receipts.readImageReceipts(f.root)
  assert.equal(result.length, 1)
  assert.equal(result[0].promptId, undefined); assert.equal(result[0].workflow.workflowId, undefined); assert.equal(result[0].cancellation.reason, undefined)
  assert.doesNotMatch(JSON.stringify(result), /private/)
})

test('仅扫描最多4096个稳定请求目录，忽略额外目录和任意文件', async t => {
  const f = await fixture(t)
  await rm(join(f.root, '.pre-design/image-requests/receipts'), { recursive: true })
  const root = join(f.root, '.pre-design/image-requests/receipts')
  await mkdir(root, { recursive: true })
  for (let i = 0; i < 4097; i++) await mkdir(join(root, i.toString(16).padStart(64, '0')))
  const first = '0'.repeat(64), last = (4096).toString(16).padStart(64, '0')
  await f.save({ ...f.row, requestId: first }, first)
  await f.save({ ...f.row, requestId: last }, last)
  assert.deepEqual((await receipts.readImageReceipts(f.root)).map(row => row.requestId), [first])
})
