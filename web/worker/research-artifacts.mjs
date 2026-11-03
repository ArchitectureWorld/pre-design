import { constants } from 'node:fs'
import { mkdir, open, readdir, realpath, lstat, writeFile } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { safeProjectPath } from './project-boundary.mjs'
import { publicBusinessData, researchError, validateReportSelection } from '../app/src/research-contract.mjs'

const runPattern = /^RUN-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u
const fileLimit = 64 * 1024 * 1024
const idOf = path => createHash('sha256').update(path).digest('hex')
async function canonicalRoot(workspace) {
  const root = await realpath(workspace)
  if (root !== resolve(workspace)) throw researchError('ARTIFACT_SCOPE_INVALID', '项目目录已改变。', 409)
  return root
}
async function entries(root, relative) {
  try { return await readdir(safeProjectPath(root, relative), { withFileTypes: true }) }
  catch (error) { if (error.code === 'ENOENT' || error.message?.startsWith('WEB_')) return []; throw error }
}
async function artifactFiles(workspace) {
  const root = await canonicalRoot(workspace), files = []
  const add = async (relative, kind) => {
    try {
      const info = await lstat(safeProjectPath(root, relative))
      if (info.isFile() && info.size <= fileLimit) files.push({ relative, mtime: info.mtimeMs, id: idOf(relative), filename: basename(relative), kind, bytes: info.size, status: 'available' })
    } catch (error) { if (error.code !== 'ENOENT' && !error.message?.startsWith('WEB_')) throw error }
  }
  for (const row of (await entries(root, 'research/runs')).slice(0, 4096)) {
    if (!row.isDirectory() || !runPattern.test(row.name)) continue
    await add(`research/runs/${row.name}/result.json`, 'research-result')
    await add(`research/runs/${row.name}/run.json`, 'research-status')
  }
  const walk = async (folder, depth = 0) => {
    if (depth > 6 || files.length > 4096) return
    for (const row of await entries(root, folder)) {
      if (row.isSymbolicLink() || row.name.startsWith('.')) continue
      const relative = `${folder}/${row.name}`
      if (row.isDirectory()) await walk(relative, depth + 1)
      else if (row.isFile() && ['.md','.html','.pdf','.pptx'].includes(extname(row.name).toLowerCase())) await add(relative, folder.startsWith('.pre-design/web-reports') ? 'research-summary' : 'chapter-report')
    }
  }
  await walk('.pre-design/report-chapters')
  // Native chapter production keeps immutable, versioned exports here.
  // Its JSON receipts remain private; only rendered documents are enumerated.
  await walk('.pre-design/chapter-productions')
  await walk('.pre-design/web-reports')
  await add('.pre-design/report-manuscript.md', 'manuscript')
  const { listGeneratedImages } = await import('./image-receipts.mjs')
  for (const image of await listGeneratedImages(root)) {
    const info = await lstat(safeProjectPath(root, image.relative))
    files.push({ relative: image.relative, mtime: info.mtimeMs, id: idOf(image.relative), filename: image.filename,
      kind: 'generated-concept', bytes: image.bytes, status: 'unreviewed', sha256: image.sha256, width: image.width, height: image.height })
  }
  return files.sort((a, b) => b.mtime - a.mtime || a.id.localeCompare(b.id))
}
export async function listProjectArtifacts(workspace) {
  return (await artifactFiles(workspace)).map(({ relative: _relative, mtime: _mtime, ...row }) => ({ ...row,
    ...(row.kind === 'research-summary' ? { status: 'unreviewed', limitations: ['选定研究成果的汇编，未经报告审查。'] }
      : row.kind === 'generated-concept' ? { status: 'unreviewed', limitations: ['AI 生成的概念图，未经图片审查，不代表现场现状或建设承诺。'] } : {}) }))
}
export async function readBoundFile(workspace, relative) {
  const path = safeProjectPath(workspace, relative), before = await lstat(path)
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const actual = await file.stat()
    if (!actual.isFile() || before.ino !== actual.ino || before.dev !== actual.dev || actual.size > fileLimit) throw researchError('ARTIFACT_CHANGED')
    const data = Buffer.alloc(actual.size + 1)
    let length = 0
    while (length < data.length) { const { bytesRead } = await file.read(data, length, data.length - length, length); if (!bytesRead) break; length += bytesRead }
    const after = await file.stat()
    if (length !== actual.size || after.size !== actual.size || after.mtimeMs !== actual.mtimeMs || safeProjectPath(workspace, relative) !== path) throw researchError('ARTIFACT_CHANGED')
    return data.subarray(0, length)
  } finally { await file.close() }
}
export async function readProjectArtifact(workspace, id) {
  const entry = (await artifactFiles(workspace)).find(row => row.id === id)
  if (!entry) throw researchError('ARTIFACT_NOT_FOUND', '成果不存在。', 404)
  let data = await readBoundFile(workspace, entry.relative)
  if (entry.kind === 'generated-concept' && createHash('sha256').update(data).digest('hex') !== entry.sha256) throw researchError('ARTIFACT_CHANGED')
  const extension = extname(entry.filename).toLowerCase()
  if (extension === '.json') data = Buffer.from(JSON.stringify(publicBusinessData(JSON.parse(data.toString('utf8')), [workspace]), null, 2))
  else if (['.md','.html'].includes(extension)) data = Buffer.from(publicBusinessData(data.toString('utf8'), [workspace]))
  const types = { '.json':'application/json; charset=utf-8', '.md':'text/markdown; charset=utf-8', '.html':'text/html; charset=utf-8', '.pdf':'application/pdf', '.pptx':'application/vnd.openxmlformats-officedocument.presentationml.presentation', '.png':'image/png', '.jpeg':'image/jpeg', '.webp':'image/webp' }
  return { filename: entry.filename, contentType: types[extension] ?? 'application/octet-stream', data }
}
export async function researchCheckpoints(workspace, projectId) {
  const rows = []
  for (const file of await artifactFiles(workspace)) {
    if (file.kind !== 'research-status') continue
    try {
      const state = JSON.parse((await readBoundFile(workspace, file.relative)).toString('utf8'))
      if (state.projectId === projectId && state.methodVersion === 'planning-modules-62.v1') rows.push({ ...state, manifestRunId: file.relative.split('/')[2] })
    } catch { /* Damaged history is never a resumable checkpoint. */ }
  }
  return rows
}
export async function createResearchSummary(workspace, input, projectId) {
  const selection = validateReportSelection(input)
  if (selection.mode !== 'research-summary') throw researchError('REPORT_SELECTION_INVALID')
  const chosen = new Map()
  for (const file of await artifactFiles(workspace)) {
    if (file.kind !== 'research-result') continue
    const row = JSON.parse((await readBoundFile(workspace, file.relative)).toString('utf8'))
    if (row.projectId !== projectId || !selection.moduleIds.includes(row.itemId) || chosen.has(row.itemId)) continue
    chosen.set(row.itemId, { ...row, bundleRunId: file.relative.split('/')[2] })
  }
  const missing = selection.moduleIds.filter(id => !chosen.has(id))
  if (missing.length) throw researchError('REPORT_MODULE_RESULTS_MISSING', `REPORT_MODULE_RESULTS_MISSING: ${missing.join(', ')}`, 409, { missingModuleIds: missing })
  const lines = ['# 选定模块研究成果汇编', '', '状态：未经报告审查。本文仅汇集已保存的研究结果，不代表完整项目研究或正式报告已经完成。', '']
  for (const id of selection.moduleIds) {
    const row = publicBusinessData(chosen.get(id), [workspace])
    lines.push(`## 模块 ${id}`, '', `来源审计包：${row.bundleRunId}`, '', '### 已保存研究内容', '', '```json', JSON.stringify(row.outputs, null, 2), '```', '',
      '### 来源与限制', '', '```json', JSON.stringify({ claims: row.claims ?? [], sourceValues: row.sourceValues ?? [], limitations: row.limitations ?? [], review: row.execution?.reviewReceipts?.at(-1) ?? null }, null, 2), '```', '')
  }
  const root = await canonicalRoot(workspace)
  for (const folder of ['.pre-design', '.pre-design/web-reports']) {
    try { await mkdir(join(root, folder), { mode: 0o700 }) } catch (error) { if (error.code !== 'EEXIST') throw error }
    safeProjectPath(root, folder)
  }
  const relative = `.pre-design/web-reports/research-summary-${randomUUID()}.md`
  await writeFile(join(root, relative), lines.join('\n'), { flag: 'wx', mode: 0o600 })
  const artifact = (await listProjectArtifacts(root)).find(row => row.id === idOf(relative))
  return { status: 'unreviewed', selectedModuleIds: selection.moduleIds, artifacts: [artifact], limitations: ['未经报告审查；原模块及其他研究成果均已保留。'] }
}
