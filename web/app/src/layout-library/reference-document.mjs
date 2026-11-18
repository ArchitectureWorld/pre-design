import { createHash } from 'node:crypto'
import { parsePdfImageInventory } from './pdf-image-inventory.mjs'
import { execFile } from 'node:child_process'
import { mkdtemp, writeFile, readFile, readdir, stat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { promisify } from 'node:util'
import { crc32 } from 'node:zlib'
import JSZip from 'jszip'
import sharp from 'sharp'
import { extractPptxReference } from './reference-pptx.mjs'
import { MAX_REFERENCE_PDF_PAGES, PDF_REFERENCE_TEXT_CHARACTERS, PDF_PARSE_TIMEOUT_MS, referenceByteLimit, referenceLimitLabel } from './reference-limits.mjs'

export { MAX_REFERENCE_BYTES } from './reference-limits.mjs'
const MAX_TEXT_CHARACTERS = 24_000
const MAX_IMAGE_PIXELS = 40_000_000
const MAX_IMAGE_EDGE = 1600
const MAX_PDF_PREVIEW_BYTES = 12 * 1024 * 1024
const MAX_ZIP_ENTRIES = 1000
const MAX_ZIP_ENTRY_BYTES = 16 * 1024 * 1024
const MAX_ZIP_TOTAL_BYTES = 48 * 1024 * 1024
const MAX_DOCUMENT_XML_BYTES = 4 * 1024 * 1024
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const runFile = promisify(execFile)
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode })
const imageFormats = { '.png': 'png', '.jpg': 'jpeg', '.jpeg': 'jpeg', '.webp': 'webp' }
const textExtensions = new Set(['.txt', '.md', '.markdown'])
const wordNamespaces = new Set(['http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'http://purl.oclc.org/ooxml/wordprocessingml/main'])

function identifyMagic(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg'
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp'
  if (bytes.toString('ascii', 0, 5) === '%PDF-') return 'pdf'
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && [0x0403, 0x0605, 0x0807].includes(bytes.readUInt16LE(2))) return 'zip'
  return null
}

function decodeText(bytes, { xml = false } = {}) {
  let encoding
  if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le'
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be'
  else if (bytes.length >= 4 && bytes.length % 2 === 0) {
    // BOM-less UTF-16 is recognizable when an ASCII run supplies alternating NULs.
    const sampleLength = Math.min(bytes.length, 512)
    let even = 0, odd = 0
    for (let index = 0; index < sampleLength; index++) {
      if (bytes[index] === 0) index % 2 ? odd++ : even++
    }
    if (odd > sampleLength / 8 && even < odd / 4) encoding = 'utf-16le'
    else if (even > sampleLength / 8 && odd < even / 4) encoding = 'utf-16be'
  }
  try {
    if (encoding) return new TextDecoder(encoding, { fatal: true }).decode(bytes)
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
    catch (error) {
      if (xml) throw error
      return new TextDecoder('gb18030', { fatal: true }).decode(bytes)
    }
  } catch {
    throw fail(xml ? 'DOCX 正文 XML 编码损坏。' : '文本编码无法识别，请使用 UTF-8、UTF-16 或 GB18030。')
  }
}

function boundedText(value, limitations, maxCharacters = MAX_TEXT_CHARACTERS) {
  const normalized = value.replace(/^\ufeff/, '').replace(/\r\n?/g, '\n').replace(/\f/g, '\n').trim()
  let end = 0, characters = 0
  for (const character of normalized) {
    if (characters === maxCharacters) break
    end += character.length
    characters++
  }
  const truncated = end < normalized.length
  if (truncated) limitations.push(`文字超过 ${maxCharacters} 字，仅保留前 ${maxCharacters} 字，后续文字未读取。`)
  return { text: normalized.slice(0, end), characters, truncated }
}

function extractText(bytes, extension) {
  const text = decodeText(bytes)
  if (/[\u0000-\u0008\u000b\u000e-\u001f\u007f]/u.test(text)) throw fail('文件包含二进制内容，不能作为文字参考读取。', 415)
  const limitations = [], content = boundedText(text, limitations)
  if (!content.text) throw fail('参考文件没有可读取的文字。')
  return {
    kind: 'text', mimeType: extension === '.txt' ? 'text/plain' : 'text/markdown', text: content.text,
    images: [], limitations,
    summary: `已读取${content.truncated ? '前 ' : ' '}${content.characters} 字文本${content.truncated ? '，超出部分已截断' : ''}。`,
  }
}

function inspectPngFrames(bytes) {
  let offset = 8, ended = false, animated = false, frameCount = 0
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8)
    if (offset + 12 + length > bytes.length) throw fail('PNG 图片损坏或不完整。')
    if (offset === 8 && (type !== 'IHDR' || length !== 13)) throw fail('PNG 图片头损坏。')
    if (type === 'IHDR' && length === 13 && bytes.readUInt32BE(offset + 8) * bytes.readUInt32BE(offset + 12) > MAX_IMAGE_PIXELS) {
      throw fail('图片超过 4000 万像素，请缩小后上传。', 413)
    }
    if (type === 'acTL') {
      if (length !== 8 || animated || bytes.readUInt32BE(offset + 8) === 0) throw fail('PNG 动画信息损坏。')
      animated = true
      if (bytes.readUInt32BE(offset + 8) > 1) throw fail('仅支持单帧图片，请上传静态 PNG、JPEG 或 WebP。')
    }
    if (type === 'fcTL' || type === 'fdAT') {
      if (!animated) throw fail('PNG 动画信息损坏。')
      if (type === 'fcTL' && ++frameCount > 1) throw fail('仅支持单帧图片，请上传静态 PNG、JPEG 或 WebP。')
    }
    offset += length + 12
    if (type === 'IEND') { ended = length === 0 && offset === bytes.length; break }
  }
  if (!ended || (animated && frameCount !== 1)) throw fail('PNG 图片损坏或不完整。')
}

function rejectJpegMultipicture(bytes) {
  let offset = 2
  while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
    while (bytes[offset] === 0xff) offset++
    const marker = bytes[offset++]
    if (marker === 0xda || marker === 0xd9) break
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue
    if (offset + 2 > bytes.length) break
    const length = bytes.readUInt16BE(offset)
    if (length < 2 || offset + length > bytes.length) break
    if (marker === 0xe2 && bytes.toString('ascii', offset + 2, offset + 6) === 'MPF\0') throw fail('仅支持单帧 JPEG，请拆分多图文件后上传。')
    offset += length
  }
}

async function normalizeImage(bytes, expectedFormat) {
  if (expectedFormat === 'png') inspectPngFrames(bytes)
  if (expectedFormat === 'jpeg') rejectJpegMultipicture(bytes)
  if (expectedFormat === 'webp' && (bytes.length < 12 || bytes.readUInt32LE(4) + 8 !== bytes.length)) throw fail('WebP 图片损坏或不完整。')
  try {
    const image = sharp(bytes, { animated: true, limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'error' })
    const metadata = await image.metadata()
    if (metadata.format !== expectedFormat || !metadata.width || !metadata.height) throw fail('图片内容与扩展名不符。', 415)
    if ((metadata.pages ?? 1) !== 1) throw fail('仅支持单帧图片，请上传静态 PNG、JPEG 或 WebP。')
    if (metadata.width * metadata.height > MAX_IMAGE_PIXELS) throw fail('图片超过 4000 万像素，请缩小后上传。', 413)
    // Re-encoding forces a complete decode, applies EXIF orientation and drops metadata.
    const outputFormat = expectedFormat === 'png' || metadata.hasAlpha ? 'png' : 'jpeg'
    let pipeline = image.rotate().resize({ width: MAX_IMAGE_EDGE, height: MAX_IMAGE_EDGE, fit: 'inside', withoutEnlargement: true })
    pipeline = outputFormat === 'png' ? pipeline.png() : pipeline.jpeg({ quality: 90 })
    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true })
    return {
      image: { data, mimeType: `image/${outputFormat}`, width: info.width, height: info.height },
      resized: Math.max(metadata.width, metadata.height) > MAX_IMAGE_EDGE,
    }
  } catch (error) {
    if (error.statusCode) throw error
    if (/pixel limit|exceeds.*pixel/i.test(error.message)) throw fail('图片超过 4000 万像素，请缩小后上传。', 413)
    throw fail('图片损坏或无法完整解码，请重新导出后上传。')
  }
}

async function extractImage(bytes, format) {
  const { image, resized } = await normalizeImage(bytes, format)
  const limitations = ['图片未进行 OCR，已提供图像供视觉分析。']
  if (resized) limitations.push(`图像已缩放至最长边 ${MAX_IMAGE_EDGE} 像素，细小文字可能需要单独补充。`)
  return {
    kind: 'image', mimeType: `image/${format}`, text: '', images: [image], limitations,
    summary: `已读取 1 张图片，提供 ${image.width}×${image.height} 像素的图像供视觉分析${resized ? '（已缩放）' : ''}。`,
  }
}

function pdfTimeRemaining(deadline, limit = PDF_PARSE_TIMEOUT_MS) {
  const timeout = Math.min(limit, deadline - Date.now())
  if (timeout <= 0) throw fail('PDF 解析超时，请精简页面后重试。', 408)
  return timeout
}

async function runPdfTool(tool, args, { deadline, maxBuffer, timeoutMs = PDF_PARSE_TIMEOUT_MS, signal }) {
  signal?.throwIfAborted()
  const timeout = pdfTimeRemaining(deadline, timeoutMs)
  let closed
  try {
    const pending = runFile(`/usr/bin/${tool}`, args, {
      encoding: 'buffer', timeout, maxBuffer, killSignal: 'SIGKILL', windowsHide: true,
      env: { ...process.env, LC_ALL: 'C' }, signal,
    })
    if (pending.child) closed = new Promise(resolve => pending.child.once('close', resolve))
    const { stdout } = await pending
    signal?.throwIfAborted()
    return stdout
  } catch (error) {
    if (error?.name === 'AbortError' || (signal?.aborted && error === signal.reason)) throw error
    signal?.throwIfAborted()
    if (error.code === 'ENOENT') throw fail('当前服务器缺少 PDF 解析工具。', 503)
    if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw fail('PDF 解析内容超过处理上限，请精简参考页。', 413)
    if (error.killed || error.signal === 'SIGKILL') throw fail('PDF 解析超时，请精简页面后重试。', 408)
    const detail = String(error.stderr ?? '')
    if (tool === 'pdftotext' && /Copying of text .*not allowed|text extraction.*not allowed/i.test(detail)) {
      throw Object.assign(fail('PDF 限制提取文字。'), { code: 'PDF_TEXT_RESTRICTED' })
    }
    if (/password/i.test(detail)) throw fail('打开此 PDF 需要密码，请上传无需密码即可打开的副本。')
    if (/encrypted|permission/i.test(detail)) throw fail('PDF 页面读取受到权限限制，请上传可正常读取的副本。')
    throw fail('PDF 损坏或无法读取，请重新导出后上传。')
  } finally {
    // AbortError can arrive before process exit. Wait before deleting files or releasing the upload queue.
    await closed
  }
}

async function extractPdf(bytes, signal, startPage = 1) {
  signal?.throwIfAborted()
  const directory = await mkdtemp(join(tmpdir(), 'layout-reference-'))
  try {
    signal?.throwIfAborted()
    const input = join(directory, 'input.pdf'), deadline = Date.now() + PDF_PARSE_TIMEOUT_MS
    await writeFile(input, bytes, { mode: 0o600, flag: 'wx', signal })
    const info = (await runPdfTool('pdfinfo', ['-enc', 'UTF-8', input], { deadline, maxBuffer: 1024 * 1024, timeoutMs: 30_000, signal })).toString('utf8')
    // pdfinfo already opened the file without a password. An encryption flag can
    // describe owner permissions; it does not mean an open password is required.
    const permissions = /^Encrypted:([^\r\n]*)/im.exec(info)?.[1] ?? ''
    let textRestricted = /\bcopy:\s*no\b/i.test(permissions)
    const pageCount = Number(/^Pages:\s+(\d+)\s*$/m.exec(info)?.[1])
    if (!Number.isSafeInteger(pageCount) || pageCount < 1) throw fail('PDF 没有可读取的页面。')
    if (startPage > pageCount) throw fail('PDF 起始页超过文件总页数。')
    const endPage = Math.min(pageCount, startPage + MAX_REFERENCE_PDF_PAGES - 1), count = endPage - startPage + 1
    const readPages = Array.from({ length: count }, (_, index) => startPage + index)
    let rawText = ''
    if (!textRestricted) {
      try {
        rawText = (await runPdfTool('pdftotext', ['-f', String(startPage), '-l', String(endPage), '-layout', '-enc', 'UTF-8', input, '-'], { deadline, maxBuffer: 2 * 1024 * 1024, timeoutMs: 120_000, signal })).toString('utf8')
      } catch (error) {
        if (error.code !== 'PDF_TEXT_RESTRICTED') throw error
        textRestricted = true
      }
    }
    const limitations = []
    if (textRestricted) limitations.push('PDF 设置了文字复制限制，未提取文字；已提供页面图像供视觉分析。')
    if (pageCount > count) limitations.push(startPage === 1
      ? `PDF 共 ${pageCount} 页，仅读取前 ${count} 页，后 ${pageCount - count} 页未读取。`
      : `PDF 共 ${pageCount} 页，本批仅读取第 ${startPage}–${endPage} 页；其余 ${pageCount - count} 页不在本批读取范围内。`)
    const content = boundedText(rawText.replace(/[\u0000-\u0008\u000b\u000e-\u001f\u007f]/gu, ''), limitations, PDF_REFERENCE_TEXT_CHARACTERS)
    // Render the selected range in one process so a large source PDF is opened only once.
    // The fixed page count and pixel edge bound temporary output; only one preview is read at a time.
    await runPdfTool('pdftoppm', ['-f', String(startPage), '-l', String(endPage), '-scale-to', String(MAX_IMAGE_EDGE), '-jpeg', '-jpegopt', 'quality=90', input, join(directory, 'page')], { deadline, maxBuffer: 1024 * 1024, signal })
    signal?.throwIfAborted()
    const previews = new Map()
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const match = /^page-(\d+)\.jpg$/.exec(entry.name)
      if (!match) continue
      const page = Number(match[1])
      if (!entry.isFile() || previews.has(page) || !readPages.includes(page)) throw fail('PDF 页面图像生成异常，请重新导出后上传。')
      previews.set(page, join(directory, entry.name))
    }
    if (previews.size !== count) throw fail('PDF 页面图像生成不完整，请重新导出后上传。')
    const images = []
    for (const page of readPages) {
      signal?.throwIfAborted()
      pdfTimeRemaining(deadline)
      const path = previews.get(page), file = await stat(path)
      if (file.size > MAX_PDF_PREVIEW_BYTES) throw fail('PDF 页面图像超过处理上限，请精简参考页。', 413)
      const preview = await readFile(path, { signal })
      const { image } = await normalizeImage(preview, 'jpeg')
      images.push({ ...image, page })
    }
    signal?.throwIfAborted()
    pdfTimeRemaining(deadline)
    if (!content.text && !textRestricted) limitations.push('未提取到 PDF 文字，已提供页面图像供视觉分析；本模块不进行 OCR。')
    const sourceSha256=createHash('sha256').update(bytes).digest('hex')
    let nativeInventory
    try{
      const listing=(await runPdfTool('pdfimages',['-f',String(startPage),'-l',String(endPage),'-list',input],{deadline,maxBuffer:1024*1024,timeoutMs:30000,signal})).toString('utf8')
      nativeInventory=parsePdfImageInventory(listing,{sourceSha256,readPages})
    }catch(error){
      signal?.throwIfAborted()
      if(error?.name==='AbortError'||error.statusCode===408)throw error
      limitations.push('本批原生图像目录未能核验；仍可查看页面，但不推断图像对象或装饰身份。')
    }
    const textPages = rawText.split('\f')
    const pages = images.map(image => ({
      nativeImageInventory:{status:nativeInventory?'available':'unavailable',sourceSha256,objects:nativeInventory?.objects.filter(o=>o.page===image.page)??[]},
      page: image.page, kind: 'pdf-page', width: image.width, height: image.height, unit: 'preview-px', preview: true,
      text: (textPages[image.page - startPage] ?? '').replace(/[\u0000-\u0008\u000b\u000e-\u001f\u007f]/gu, '').trim().slice(0, 2000),
    }))
    return {
      kind: 'pdf', mimeType: 'application/pdf', text: content.text, images, pageCount, readPages, pages, limitations,
      summary: (startPage === 1 ? `PDF 共 ${pageCount} 页，已读取${pageCount > count ? '前 ' : ' '}${count} 页并生成 ${count} 张页面图像${pageCount > count ? `，后 ${pageCount - count} 页未读取` : ''}。` : `PDF 共 ${pageCount} 页，本批已读取第 ${startPage}–${endPage} 页并生成 ${count} 张页面图像，其余 ${pageCount - count} 页不在本批读取范围内。`) + `${textRestricted ? 'PDF 限制文字提取，已改用页面图像分析。' : !content.text ? '未检测到可提取文字，将使用页面图像分析。' : content.truncated ? `文字已截断至前 ${PDF_REFERENCE_TEXT_CHARACTERS} 字。` : ''}`,
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

function safeZipName(name) {
  return name && !/^[\\/]|^[A-Za-z]:|[\\\u0000]/u.test(name) && !name.split('/').some(part => part === '..' || part === '.')
}

// Inspect the central directory before JSZip allocates an object for each entry.
// No archive entry is extracted to the filesystem, and only the two XML parts are inflated.
function inspectZip(bytes) {
  let end = -1
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset--) {
    if (bytes.readUInt32LE(offset) === 0x06054b50 && offset + 22 + bytes.readUInt16LE(offset + 20) === bytes.length) { end = offset; break }
  }
  if (end < 0) throw fail('DOCX 压缩包损坏或不完整。')
  const count = bytes.readUInt16LE(end + 10), size = bytes.readUInt32LE(end + 12), start = bytes.readUInt32LE(end + 16)
  if (count > MAX_ZIP_ENTRIES) throw fail('DOCX 压缩包条目过多，超过处理上限。', 413)
  if (bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6) || bytes.readUInt16LE(end + 8) !== count || start + size !== end || !count) throw fail('不支持分卷、ZIP64 或损坏的 DOCX 压缩包。')
  let offset = start, total = 0, actualCount = 0
  const names = new Set()
  while (offset < end) {
    if (++actualCount > MAX_ZIP_ENTRIES) throw fail('DOCX 压缩包条目过多，超过处理上限。', 413)
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50) throw fail('DOCX 压缩包目录损坏。')
    const compressed = bytes.readUInt32LE(offset + 20), expanded = bytes.readUInt32LE(offset + 24)
    const nameLength = bytes.readUInt16LE(offset + 28), extraLength = bytes.readUInt16LE(offset + 30), commentLength = bytes.readUInt16LE(offset + 32)
    const next = offset + 46 + nameLength + extraLength + commentLength
    if (next > end || bytes.readUInt32LE(offset + 42) >= start || compressed > bytes.length) throw fail('DOCX 压缩包条目损坏。')
    const name = bytes.toString('utf8', offset + 46, offset + 46 + nameLength)
    if (!safeZipName(name) || names.has(name)) throw fail('DOCX 包含不安全或重复的文件路径。')
    names.add(name)
    if (bytes.readUInt16LE(offset + 8) & 1) throw fail('DOCX 受口令保护，请解除保护后上传。')
    if (![0, 8].includes(bytes.readUInt16LE(offset + 10))) throw fail('DOCX 使用了不支持的压缩方式。')
    total += expanded
    if (expanded > MAX_ZIP_ENTRY_BYTES || total > MAX_ZIP_TOTAL_BYTES || (name === 'word/document.xml' && expanded > MAX_DOCUMENT_XML_BYTES)) throw fail('DOCX 解压后超过处理上限，请精简文档。', 413)
    offset = next
  }
  if (actualCount !== count) throw fail('DOCX 压缩包条目数量损坏。')
}

async function readZipXml(entry, limit) {
  if (!entry || entry.dir) throw fail('DOCX 缺少必要的文档结构。')
  if ((entry._data?.uncompressedSize ?? 0) > limit) throw fail('DOCX 正文 XML 超过处理上限。', 413)
  let data
  try {
    data = await new Promise((resolve, reject) => {
      const stream = entry.nodeStream(), chunks = []
      let length = 0
      stream.on('data', chunk => {
        length += chunk.length
        if (length > limit) {
          reject(fail('DOCX 正文 XML 解压后超过处理上限。', 413))
          stream.destroy()
          return
        }
        chunks.push(chunk)
      })
      stream.on('error', reject)
      stream.on('end', () => resolve(Buffer.concat(chunks, length)))
    })
  } catch (error) {
    if (error.statusCode) throw error
    throw fail('DOCX 正文解压失败，文件可能已损坏。')
  }
  if (typeof entry._data?.crc32 === 'number' && crc32(data) !== (entry._data.crc32 >>> 0)) throw fail('DOCX 正文校验失败，文件可能已损坏。')
  const xml = decodeText(data, { xml: true })
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(xml)) throw fail('DOCX 正文包含非法的 XML 控制字符。')
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw fail('DOCX 不允许包含 DOCTYPE 或 ENTITY 定义。')
  return xml
}

function decodeXmlEntities(value) {
  return value.replace(/&(?:([^;\s&<]*);)?/gu, (_, entity) => {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
    if (Object.hasOwn(named, entity)) return named[entity]
    const number = /^#x[\da-f]+$/i.test(entity ?? '') ? parseInt(entity.slice(2), 16) : /^#\d+$/.test(entity ?? '') ? Number(entity.slice(1)) : NaN
    if (!Number.isSafeInteger(number) || number <= 0 || number > 0x10ffff || (number >= 0xd800 && number <= 0xdfff) || (number < 32 && ![9, 10, 13].includes(number))) throw fail('DOCX 正文包含无效的 XML 实体。')
    return String.fromCodePoint(number)
  })
}

function wordText(xml) {
  const tokens = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<\/?(?:[^<>"']|"[^"]*"|'[^']*')*>|[^<]+/gu
  const stack = [], output = []
  let position = 0, rootSeen = false, rootClosed = false
  for (const match of xml.matchAll(tokens)) {
    if (match.index !== position) throw fail('DOCX 正文 XML 不完整。')
    const token = match[0]
    position += token.length
    if (token.startsWith('<!--') || token.startsWith('<?')) continue
    const parent = stack.at(-1)
    if (!token.startsWith('<') || token.startsWith('<![CDATA[')) {
      const value = token.startsWith('<![CDATA[') ? token.slice(9, -3) : decodeXmlEntities(token)
      if (!parent && value.trim()) throw fail('DOCX 正文 XML 结构损坏。')
      if (parent?.word && parent.local === 't') output.push(value)
      continue
    }
    if (token.startsWith('</')) {
      const close = /^<\/([A-Za-z_][\w:.-]*)\s*>$/u.exec(token)
      if (!close || !parent || close[1] !== parent.name) throw fail('DOCX 正文 XML 标签不匹配。')
      if (parent.word && ['p', 'tr'].includes(parent.local)) output.push('\n')
      if (parent.word && parent.local === 'tc') output.push('\t')
      stack.pop()
      if (!stack.length) rootClosed = true
      continue
    }
    const open = /^<([A-Za-z_][\w:.-]*)([\s\S]*?)(\/?)>$/u.exec(token)
    if (!open || rootClosed) throw fail('DOCX 正文 XML 结构损坏。')
    const [, name, attributes, selfClosing] = open, namespace = { ...(parent?.namespace ?? {}) }
    const attributePattern = /\s+([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/gy
    const attributeNames = new Set()
    let attributeEnd = 0, attribute
    while ((attribute = attributePattern.exec(attributes))) {
      const attributeName = attribute[1], value = decodeXmlEntities(attribute[2] ?? attribute[3])
      if (attributeNames.has(attributeName)) throw fail('DOCX 正文 XML 属性重复。')
      attributeNames.add(attributeName)
      if (attributeName === 'xmlns') namespace[''] = value
      else if (attributeName.startsWith('xmlns:')) namespace[attributeName.slice(6)] = value
      attributeEnd = attributePattern.lastIndex
    }
    if (attributes.slice(attributeEnd).trim()) throw fail('DOCX 正文 XML 属性损坏。')
    const parts = name.split(':')
    if (parts.length > 2 || (parts.length === 2 && !namespace[parts[0]])) throw fail('DOCX 正文 XML 命名空间损坏。')
    const prefix = parts.length === 2 ? parts[0] : '', local = parts.at(-1), word = wordNamespaces.has(namespace[prefix])
    if (!rootSeen) {
      if (local !== 'document' || !word) throw fail('DOCX 缺少有效的 Word 正文结构。')
      rootSeen = true
    }
    if (word && local === 'tab') output.push('\t')
    if (word && ['br', 'cr'].includes(local)) output.push('\n')
    if (selfClosing) {
      if (word && local === 'p') output.push('\n')
      if (!stack.length) rootClosed = true
    } else {
      if (stack.length >= 128) throw fail('DOCX 正文嵌套过深，超过处理上限。', 413)
      stack.push({ name, local, word, namespace })
    }
  }
  if (position !== xml.length || !rootSeen || !rootClosed || stack.length) throw fail('DOCX 正文 XML 不完整。')
  return output.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')
}

async function extractDocx(bytes) {
  inspectZip(bytes)
  let zip
  try { zip = await JSZip.loadAsync(bytes, { checkCRC32: false, createFolders: false }) }
  catch { throw fail('DOCX 压缩包损坏或无法读取。') }
  const entries = Object.values(zip.files)
  if (entries.length > MAX_ZIP_ENTRIES) throw fail('DOCX 压缩包条目过多，超过处理上限。', 413)
  if (entries.some(entry => !safeZipName(entry.unsafeOriginalName ?? entry.name))) throw fail('DOCX 包含不安全的文件路径。')
  const types = await readZipXml(zip.file('[Content_Types].xml'), 1024 * 1024)
  if (!types.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml')) throw fail('文件不是受支持的 DOCX 文档。')
  const xml = await readZipXml(zip.file('word/document.xml'), MAX_DOCUMENT_XML_BYTES)
  const limitations = ['DOCX 仅提取正文文字；未读取图片、页眉页脚、批注或页面排版，不能据此识别原稿视觉风格。']
  const content = boundedText(wordText(xml), limitations)
  if (!content.text) throw fail('DOCX 正文没有可读取的文字，请导出为 PDF 或图片后上传。')
  return {
    kind: 'docx', mimeType: DOCX_MIME, text: content.text, images: [], limitations,
    summary: `已从 DOCX 提取${content.truncated ? '前 ' : ' '}${content.characters} 字正文，仅提取文字${content.truncated ? '，超出部分已截断' : ''}。`,
  }
}

/** Read untrusted reference bytes without retaining originals or executing document content. */
export async function extractReferenceDocument({ bytes, filename, signal, pdfStartPage = 1, pptxStartPage } = {}) {
  signal?.throwIfAborted()
  if (!(bytes instanceof Uint8Array) || typeof filename !== 'string' || !filename.trim()) throw fail('缺少有效的参考文件与文件名。')
  if (!bytes.byteLength) throw fail('参考文件为空。')
  if (bytes.byteLength > referenceByteLimit(filename)) throw fail(`参考原件上限为 ${referenceLimitLabel(filename)}，请精简后上传。`, 413)
  const input = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const extension = extname(filename).toLowerCase(), magic = identifyMagic(input)
  if (!Number.isSafeInteger(pdfStartPage) || pdfStartPage < 1) throw fail('PDF 起始页必须是正整数。')
  if (extension !== '.pdf' && pdfStartPage !== 1) throw fail('分页续读仅支持 PDF 文件。')
  if (pptxStartPage !== undefined && (extension !== '.pptx' || !Number.isSafeInteger(pptxStartPage) || pptxStartPage < 1)) throw fail(extension !== '.pptx' ? '分页续读参数仅支持 PPTX 文件。' : 'PPTX 起始页必须是正整数。')
  let result
  if (imageFormats[extension]) {
    if (magic !== imageFormats[extension]) throw fail('图片内容与扩展名不符，请上传有效的 PNG、JPEG 或 WebP。', 415)
    result = await extractImage(input, magic)
  } else if (extension === '.pdf') {
    if (magic !== 'pdf') throw fail('文件内容不是有效的 PDF。', 415)
    result = await extractPdf(input, signal, pdfStartPage)
  } else if (extension === '.docx') {
    if (magic !== 'zip') throw fail('文件内容不是有效的 DOCX。', 415)
    result = await extractDocx(input)
  } else if (extension === '.pptx') {
    if (magic !== 'zip') throw fail('文件内容不是有效的 PPTX。', 415)
    result = await extractPptxReference(input, { signal, pptxStartPage })
  } else if (textExtensions.has(extension)) {
    if (magic) throw fail('文件内容与文字文件扩展名不符。', 415)
    result = await extractText(input, extension)
  } else throw fail('参考文档支持 PDF、PPTX、PNG、JPG、JPEG、WebP、TXT、Markdown 和 DOCX；JSON 请使用专用导入。', 415)
  signal?.throwIfAborted()
  return result
}
