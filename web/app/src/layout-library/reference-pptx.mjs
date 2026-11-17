import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, readFile, readdir, stat, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import sharp from 'sharp'
import {runPptMasterImport} from './ppt-master-adapter.mjs'
import { PPTX_PARSE_TIMEOUT_MS } from './reference-limits.mjs'

const adapter = fileURLToPath(new URL('./reference-pptx.py', import.meta.url))
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode })
const MAX_OUTPUT = 8 * 1024 * 1024
const MAX_PREVIEW_BYTES = 12 * 1024 * 1024
const MAX_IMAGE_EDGE = 1600

// Each tool receives only fixed flags and private, generated paths. Killing the
// process group also reaps LibreOffice's wrapper/worker on timeout or cancellation.
async function runTool(command, args, { signal, deadline, maxOutput = MAX_OUTPUT, label }) {
  signal?.throwIfAborted()
  const timeout = deadline - Date.now()
  if (timeout <= 0) throw fail('PPTX 解析超时，请精简参考页面后重试。', 408)
  return new Promise((resolve, reject) => {
    let child, timer, failure, length = 0, stderrLength = 0
    const output = [], errors = []
    const terminate = reason => {
      failure ??= reason
      if (!child?.pid) return
      try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGKILL') }
      catch (error) { if (error.code !== 'ESRCH') child.kill('SIGKILL') }
    }
    const abort = () => terminate(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    try {
      child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true, env: { ...process.env, LC_ALL: 'C.UTF-8' } })
    } catch (error) { reject(error); return }
    signal?.addEventListener('abort', abort, { once: true })
    timer = setTimeout(() => terminate(fail('PPTX 解析超时，请精简参考页面后重试。', 408)), timeout)
    timer.unref?.()
    child.stdout.on('data', chunk => {
      length += chunk.length
      if (length > maxOutput) terminate(fail('PPTX 解析输出超过处理上限，请精简参考文件。', 413))
      else output.push(chunk)
    })
    child.stderr.on('data', chunk => {
      stderrLength += chunk.length
      if (stderrLength <= 64 * 1024) errors.push(chunk)
    })
    child.on('error', error => {
      failure ??= error.code === 'ENOENT'
        ? fail(`当前服务器缺少 ${label}，请安装 Python 3.10+、LibreOffice Impress 和 Poppler。`, 503)
        : fail(`无法启动 ${label}。`, 503)
    })
    child.on('close', code => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      const stdout = Buffer.concat(output, Math.min(length, maxOutput)), stderr = Buffer.concat(errors).toString('utf8')
      if (failure) { reject(failure); return }
      if (code !== 0) { reject(Object.assign(fail(`PPTX ${label}未成功完成，请检查文件或运行环境。`), { stdout, stderr })); return }
      resolve(stdout)
    })
    if (signal?.aborted) abort()
  })
}

/** Native OOXML facts and genuine, bounded page previews. No model inference. */
export async function extractPptxReference(bytes, { signal } = {}) {
  signal?.throwIfAborted()
  const directory = await mkdtemp(join(tmpdir(), 'layout-reference-pptx-'))
  const deadline = Date.now() + PPTX_PARSE_TIMEOUT_MS
  try {
    const input = join(directory, 'source.pptx'), preview = join(directory, 'preview.pptx')
    await writeFile(input, bytes, { mode: 0o600, flag: 'wx', signal })
    let parsed
    try {
      // The pinned upstream importer is the canonical PPTX design parser.
      // The legacy bounded reader remains only as a compatibility facts adapter
      // until Reference Bundle V3 persists the full native artifact workspace.
      const upstream = await runPptMasterImport({sourcePath:input,workspace:join(directory,'ppt-master-import'),signal,timeoutMs:PPTX_PARSE_TIMEOUT_MS})
      const raw = await runTool(process.env.PRE_LAYOUT_PYTHON_BINARY || '/usr/bin/python3', [adapter, input, preview], { signal, deadline, label: 'PPTX 结构解析器' })
      parsed = JSON.parse(raw.toString('utf8'))
    } catch (error) {
      if (signal?.aborted) throw signal.reason
      if (error.stdout) {
        let payload
        try { payload = JSON.parse(error.stdout.toString('utf8')) } catch {}
        if (payload?.error) throw fail(payload.error, [400, 413, 415].includes(payload.statusCode) ? payload.statusCode : 400)
      }
      if (error instanceof SyntaxError) throw fail('PPTX 结构解析返回了无效结果。')
      throw error
    }
    if (!parsed?.structure || !Array.isArray(parsed.readPages) || !parsed.readPages.length || parsed.readPages.length > 30) throw fail('PPTX 结构或预览页码不完整。')
    signal?.throwIfAborted()
    const profile = join(directory, 'office-profile')
    await mkdir(join(profile, 'user'), { recursive: true })
    await writeFile(join(profile, 'user', 'registrymodifications.xcu'), '<?xml version="1.0" encoding="UTF-8"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item></oor:items>', { mode: 0o600 })
    await runTool(process.env.PRE_LAYOUT_OFFICE_BINARY || 'soffice', [
      `-env:UserInstallation=${pathToFileURL(profile).href}`, '--headless', '--nologo', '--nodefault', '--nolockcheck', '--nofirststartwizard',
      '--convert-to', 'pdf:impress_pdf_Export', '--outdir', directory, preview,
    ], { signal, deadline, maxOutput: 1024 * 1024, label: 'LibreOffice Impress' })
    const pdf = join(directory, 'preview.pdf')
    try {
      const file = await stat(pdf)
      if (!file.isFile() || !file.size || file.size > 256 * 1024 * 1024) throw fail('PPTX 页面预览超出处理上限。', 413)
    } catch (error) {
      if (error.statusCode) throw error
      throw fail('PPTX 未能生成真实页面预览，请检查 LibreOffice Impress 或另存为标准 PPTX。')
    }
    const info = (await runTool('/usr/bin/pdfinfo', [pdf], { signal, deadline, maxOutput: 1024 * 1024, label: 'Poppler pdfinfo' })).toString('utf8')
    const renderedCount = Number(/^Pages:\s+(\d+)\s*$/m.exec(info)?.[1])
    if (renderedCount !== parsed.readPages.length) throw fail('PPTX 预览页面数量与原始页序不一致，已停止返回可能错配的预览。')
    await runTool('/usr/bin/pdftoppm', ['-f', '1', '-l', String(renderedCount), '-scale-to', String(MAX_IMAGE_EDGE), '-jpeg', '-jpegopt', 'quality=88', pdf, join(directory, 'page')], { signal, deadline, maxOutput: 1024 * 1024, label: 'Poppler pdftoppm' })
    const files = new Map()
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const match = /^page-(\d+)\.jpg$/.exec(entry.name)
      if (!match) continue
      const page = Number(match[1])
      if (!entry.isFile() || page < 1 || page > renderedCount || files.has(page)) throw fail('PPTX 预览文件生成异常。')
      files.set(page, join(directory, entry.name))
    }
    if (files.size !== renderedCount) throw fail('PPTX 页面预览生成不完整。')
    const images = []
    for (let page = 1; page <= renderedCount; page++) {
      signal?.throwIfAborted()
      const path = files.get(page)
      if ((await stat(path)).size > MAX_PREVIEW_BYTES) throw fail('PPTX 单页预览超过处理上限。', 413)
      const source = await readFile(path, { signal })
      const { data, info: imageInfo } = await sharp(source, { limitInputPixels: 40_000_000, failOn: 'error' }).rotate().resize({ width: MAX_IMAGE_EDGE, height: MAX_IMAGE_EDGE, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer({ resolveWithObject: true })
      images.push({ data, mimeType: 'image/jpeg', width: imageInfo.width, height: imageInfo.height, page: parsed.readPages[page - 1] })
    }
    signal?.throwIfAborted()
    const limitations = parsed.structure.warnings.map(warning => warning.message)
    parsed.structure.pptMaster = {
      revision: upstream.upstream.revision,
      source: upstream.source,
      slideSize: upstream.manifest.slideSize,
      theme: upstream.manifest.theme,
      masters: upstream.manifest.masters,
      layouts: upstream.manifest.layouts,
      slides: upstream.manifest.slides,
      nativeStructure: upstream.nativeStructure,
      inheritance: upstream.inheritance,
      authoringSummary: upstream.authoringSummary,
      conversionReport: upstream.conversionReport,
      artifactInventory: upstream.artifacts,
      receiptHash: upstream.receiptHash,
    }
    const sampled = parsed.pageCount > images.length
    if (sampled) limitations.unshift(`PPTX 共 ${parsed.pageCount} 页，已读取全篇页序与有界原生结构；从全篇均匀抽样 ${images.length} 页生成预览，其余页未作视觉读取。`)
    return {
      kind: 'pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      text: parsed.text, images, pageCount: parsed.pageCount, readPages: parsed.readPages,
      structure: parsed.structure, pages: parsed.pages, limitations,
      summary: `PPTX 共 ${parsed.pageCount} 页，已读取原生结构并${sampled ? '从全篇抽样' : '生成'} ${images.length} 张真实页面预览${parsed.structure.limits.truncated ? '；结构详情已按上限截断' : ''}。`,
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
