#!/usr/bin/env node
// Explicit live capability probe through DSH's native LLM and tool runtimes.
// It never writes source configuration or credentials and never retries a request.
import { Context } from '@deepseek-ai/cordis'
import { LlmRuntime, BlockAssembler } from '@deepseek-ai/dsh-llm'
import { apply as installPiAi } from '@deepseek-ai/dsh-llm-pi-ai'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import { parse } from 'yaml'
import { randomUUID, randomInt, createHash } from 'node:crypto'
import { chmod, lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import sharp from 'sharp'

function fail(code) { throw Object.assign(new Error(code), { code }) }
const now = () => new Date().toISOString()
const sha256 = value => createHash('sha256').update(value).digest('hex')

/** Only the explicitly selected model and credential leave the source documents. */
export function selectModelConfiguration(settings, credentials, { provider, model, maxTokens } = {}) {
  const providers = Array.isArray(settings) ? settings.find(row => row.id === 'llm-pi-ai')?.config?.providers : settings?.['llm-pi-ai']?.providers
  const source = providers?.[provider], entry = source?.models?.find(row => row.id === model)
  if (!source || !entry || !source.api || !source.baseURL || !source.apiKeyEnv) fail('MODEL_NOT_CONFIGURED')
  const cap = entry.maxTokens ?? source.defaultMaxTokens
  if (!Number.isSafeInteger(cap) || cap < 1) fail('MODEL_BUDGET_UNKNOWN')
  const budget = maxTokens ?? Math.min(cap, 8192)
  if (!Number.isSafeInteger(budget) || budget < 1 || budget > cap || budget > 8192) fail('MODEL_BUDGET_FORBIDDEN')
  const ref = String(source.apiKeyEnv), bare = ref.replace(/^credential:/u, '')
  const credential = credentials?.refs?.[ref] ?? credentials?.refs?.[bare]
  if (typeof credential !== 'string' || !credential.trim()) fail('MODEL_CREDENTIAL_MISSING')
  const profile = { ...structuredClone(source), models: [structuredClone(entry)], retryPolicy: { mode: 'normal', maxRetries: 0 },
    timeoutMs: Math.min(source.timeoutMs ?? 120000, 120000), streamIdleTimeoutMs: Math.min(source.streamIdleTimeoutMs ?? 120000, 120000) }
  delete profile.modelOverrides
  return { provider, model, protocol: source.api, baseURL: source.baseURL, apiKeyEnv: bare, maxTokens: budget, configuredMaxTokens: cap, profile, credential }
}

function safeError(error, secret) {
  const chain = [], visited = new Set()
  for (let current = error; current && chain.length < 8 && !visited.has(current); current = current.cause) {
    visited.add(current)
    const row = { name: String(current.name ?? 'Error'), message: String(current.message ?? current).split(secret).join('[REDACTED]').replace(/Bearer\s+[^\s"']+/giu, 'Bearer [REDACTED]').slice(0, 1200) }
    for (const field of ['code', 'status', 'statusCode']) if (typeof current[field] === 'string' || typeof current[field] === 'number') row[field] = current[field]
    chain.push(row)
  }
  return chain
}
async function privateWrite(path, value) {
  await writeFile(path, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
  await chmod(path, 0o600)
}

export async function runLiveModelProbe({ settings, credentials, provider, model, maxTokens, vision = false, timeoutMs = 120000 }) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) fail('MODEL_PROBE_TIMEOUT_INVALID')
  process.umask(0o077)
  const selected = selectModelConfiguration(parse(await readFile(settings, 'utf8')), parse(await readFile(credentials, 'utf8')), { provider, model, maxTokens })
  const cache = resolve('.cache')
  await mkdir(cache, { recursive: true, mode: 0o700 })
  if (!(await lstat(cache)).isDirectory()) fail('MODEL_PROBE_CACHE_INVALID')
  const runDirectory = join(cache, `model-live-${now().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`)
  await mkdir(runDirectory, { mode: 0o700 })
  const report = { version: 1, startedAt: now(), provider, model, protocol: selected.protocol, maxTokens: selected.maxTokens, configuredMaxTokens: selected.configuredMaxTokens,
    adapter: '@deepseek-ai/dsh-llm-pi-ai', execution: 'LlmRuntime.stream + ToolRuntime.execute', automaticRetries: 0,
    capabilities: { text: false, tools: false, vision: false }, visionRequested: vision, attempts: [], status: 'running' }
  const save = () => privateWrite(join(runDirectory, 'report.json'), JSON.stringify(report, null, 2).split(selected.credential).join('[REDACTED]') + '\n')
  await save()
  const controller = new AbortController()
  const stop = () => controller.abort(new Error('MODEL_PROBE_CANCELLED'))
  process.once('SIGINT', stop); process.once('SIGTERM', stop)
  const ctx = new Context(), runtime = new LlmRuntime(ctx)
  ctx.provide('systemPrompt', { tools: () => () => {} })
  const tools = new ToolRuntime(ctx)
  ctx.provide('credentials', {
    async resolve(ref) {
      if (String(ref).replace(/^credential:/u, '') !== selected.apiKeyEnv) fail('MODEL_PROBE_CREDENTIAL_FORBIDDEN')
      return { value: selected.credential }
    },
    async readRecord() { return undefined }, async listRecords() { return [] },
    async modifyRecord() { fail('MODEL_PROBE_CREDENTIAL_WRITE_FORBIDDEN') }, async deleteRecord() { fail('MODEL_PROBE_CREDENTIAL_WRITE_FORBIDDEN') },
  })
  let profiles = { [provider]: selected.profile }
  const receipts = []
  tools.register(defineTool({
    name: 'structured_output', description: '提交本次最小能力验证的结构化答案。',
    parameters: { answer: { type: 'string', enum: ['OK'], required: true }, sum: { type: 'integer', enum: [4], required: true } },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args) { const receipt = { accepted: true, answer: args.answer, sum: args.sum }; receipts.push(receipt); return receipt },
  }))

  async function request(purpose, messages, schema = []) {
    const attempt = { purpose, startedAt: now(), state: 'dispatching', provider, model, maxTokens: selected.maxTokens }
    report.attempts.push(attempt)
    await save()
    console.log(JSON.stringify({ event: 'request-started', purpose, provider, model, maxTokens: selected.maxTokens }))
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]), assembler = new BlockAssembler()
    let finishObserved = false
    try {
      for await (const chunk of runtime.stream({ provider, model, messages, tools: schema, maxTokens: selected.maxTokens, signal })) {
        assembler.push(chunk)
        if (chunk.type === 'finish') finishObserved = true
      }
      const content = assembler.blocks(), finish = assembler.finish
      const text = content.filter(row => row.type === 'text').map(row => row.text).join('')
      const calls = content.filter(row => row.type === 'tool-call')
      Object.assign(attempt, { state: 'completed', finishedAt: now(), finish, finishObserved, text: text.slice(0, 1000), usage: assembler.usage,
        calls: calls.map(row => ({ id: row.id, name: row.name, arguments: row.arguments })) })
      await save()
      if (finish.failure) throw Object.assign(new Error(finish.failure.message), { code: finish.failure.code })
      if (!finishObserved || !['stop', 'tool-calls'].includes(finish.kind)) fail('MODEL_PROBE_RESPONSE_INCOMPLETE')
      console.log(JSON.stringify({ event: 'request-completed', purpose, finish: finish.kind, textCharacters: text.length, toolCalls: calls.length }))
      return { attempt, text, calls, signal }
    } catch (error) {
      Object.assign(attempt, { state: 'failed', finishedAt: now(), errors: safeError(error, selected.credential) })
      await save()
      throw error
    }
  }

  try {
    installPiAi(ctx, { providers: { get: () => profiles } })
    const answer = await request('text-and-tool', [{ role: 'user', content: [{ type: 'text', text: '这是最小接口验证。请先用普通文本输出 OK，然后调用一次 structured_output，参数为 answer="OK"、sum=2+2 的结果。不要调用其他工具，不要解释。' }] }], tools.schemas())
    report.capabilities.text = /^OK[.!。！]?$/u.test(answer.text.trim())
    if (answer.calls.length === 1 && answer.calls[0].name === 'structured_output') {
      const call = answer.calls[0]
      const args = typeof call.arguments === 'string' ? JSON.parse(call.arguments) : call.arguments
      const result = await tools.execute({ name: call.name, callId: call.id, arguments: args, signal: answer.signal })
      answer.attempt.toolResult = { isError: result.isError, value: result.value, content: result.content }
      report.capabilities.tools = result.isError === false && receipts.length === 1 && result.value?.answer === 'OK' && result.value?.sum === 4
    }
    await save()
    if (!report.capabilities.text) {
      const text = await request('text-only', [{ role: 'user', content: [{ type: 'text', text: '仅回复两个大写英文字母 OK，不要解释。' }] }])
      report.capabilities.text = /^OK[.!。！]?$/u.test(text.text.trim())
      await save()
    }
    if (vision && report.capabilities.text) {
      profiles = { [provider]: { ...selected.profile, models: [{ ...selected.profile.models[0], input: ['text', 'image'] }] } }
      const attachments = new LocalAttachmentStore(ctx, { dshHome: join(runDirectory, 'attachments-home') })
      const palette = [{ name: 'red', rgb: '#ff0000' }, { name: 'blue', rgb: '#0000ff' }, { name: 'green', rgb: '#00ff00' }, { name: 'yellow', rgb: '#ffff00' }]
      const leftIndex = randomInt(palette.length), rightIndex = (leftIndex + 1 + randomInt(palette.length - 1)) % palette.length
      const left = palette[leftIndex], right = palette[rightIndex]
      const half = await sharp({ create: { width: 16, height: 32, channels: 3, background: right.rgb } }).png().toBuffer()
      const image = await sharp({ create: { width: 32, height: 32, channels: 3, background: left.rgb } }).composite([{ input: half, left: 16, top: 0 }]).png().toBuffer()
      const attachment = await attachments.saveImage({ data: image, mediaType: 'image/png', name: 'geometry-probe.png' })
      await privateWrite(join(runDirectory, 'vision-input.json'), { sha256: sha256(image), width: 32, height: 32, expected: `${left.name}/${right.name}` })
      const result = await request('vision', [{ role: 'user', content: [
        { type: 'text', text: '观察附图的左右两块纯色，按从左到右仅回答英文颜色名称，格式 color/color，不要解释。' }, { type: 'image', attachment },
      ] }])
      report.capabilities.vision = result.text.trim().toLowerCase() === `${left.name}/${right.name}`
      result.attempt.matchesPixels = report.capabilities.vision
      result.attempt.imageSha256 = sha256(image)
    }
    report.status = report.capabilities.text && report.capabilities.tools ? 'verified' : 'capability_not_verified'
  } catch (error) {
    report.status = 'failed'
    report.errors = safeError(error, selected.credential)
  } finally {
    report.finishedAt = now()
    await save()
    await ctx.fiber.dispose()
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop)
  }
  console.log(JSON.stringify({ event: 'probe-finished', report: join(runDirectory, 'report.json'), provider, model, protocol: selected.protocol,
    maxTokens: selected.maxTokens, capabilities: report.capabilities, status: report.status, errors: report.errors }))
  return { report, runDirectory }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: {
    settings: { type: 'string' }, credentials: { type: 'string' }, provider: { type: 'string' }, model: { type: 'string' },
    'max-tokens': { type: 'string' }, 'timeout-ms': { type: 'string', default: '120000' }, vision: { type: 'boolean', default: false }, help: { type: 'boolean' },
  } })
  if (values.help) console.log('Usage: node web/worker/probe-model-live.mjs --settings <yaml> --credentials <yaml> --provider <id> --model <id> [--max-tokens 8192] [--vision] [--timeout-ms 120000]')
  else {
    if (!values.settings || !values.credentials || !values.provider || !values.model) fail('MODEL_PROBE_ARGUMENTS_REQUIRED')
    const result = await runLiveModelProbe({ ...values, maxTokens: values['max-tokens'] === undefined ? undefined : Number(values['max-tokens']), timeoutMs: Number(values['timeout-ms']) })
    if (result.report.status !== 'verified') process.exitCode = 1
  }
}
