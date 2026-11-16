import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync, crc32 } from 'node:zlib'
import { setTimeout as delay } from 'node:timers/promises'
import JSZip from 'jszip'
import sharp from 'sharp'
import { extractReferenceDocument, MAX_REFERENCE_BYTES } from '../src/layout-library/reference-document.mjs'

const parse = (bytes, filename) => extractReferenceDocument({ bytes, filename })
const status = (code, expression) => error => {
  assert.equal(error.statusCode, code, error.message)
  if (expression) assert.match(error.message, expression)
  return true
}
const wordNamespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const documentXml = body => `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${wordNamespace}"><w:body>${body}</w:body></w:document>`
async function docx(xml = documentXml('<w:p><w:r><w:t>版式参考</w:t></w:r></w:p>'), extras = []) {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>', { createFolders: false })
  zip.file('word/document.xml', xml, { createFolders: false })
  for (const [name, value] of extras) zip.file(name, value, { createFolders: false })
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

function pngChunk(type, data) {
  const name = Buffer.from(type), result = Buffer.alloc(data.length + 12)
  result.writeUInt32BE(data.length)
  name.copy(result, 4)
  data.copy(result, 8)
  result.writeUInt32BE(crc32(Buffer.concat([name, data])), result.length - 4)
  return result
}
function animatedPng({ declaredFrames = 2 } = {}) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(1); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 6
  const animation = Buffer.alloc(8); animation.writeUInt32BE(declaredFrames)
  const frame = sequence => {
    const result = Buffer.alloc(26)
    result.writeUInt32BE(sequence); result.writeUInt32BE(1, 4); result.writeUInt32BE(1, 8)
    result.writeUInt16BE(1, 20); result.writeUInt16BE(10, 22)
    return result
  }
  const second = Buffer.alloc(4); second.writeUInt32BE(2)
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'), pngChunk('IHDR', ihdr), pngChunk('acTL', animation),
    pngChunk('fcTL', frame(0)), pngChunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0, 255]))),
    pngChunk('fcTL', frame(1)), pngChunk('fdAT', Buffer.concat([second, deflateSync(Buffer.from([0, 0, 0, 255, 255]))])),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

// A real PDF with an xref table, text operators and optional embedded raster pages.
function pdf(pages, { encrypted = false } = {}) {
  const objects = [null, null, Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')]
  const add = value => (objects.push(Buffer.isBuffer(value) ? value : Buffer.from(value)), objects.length)
  const stream = (header, data) => Buffer.concat([Buffer.from(`<< ${header} /Length ${data.length} >>\nstream\n`), data, Buffer.from('\nendstream')])
  const pageIds = []
  for (const page of pages) {
    let resources = '/Font << /F1 3 0 R >>', content
    if (page.image) {
      const imageId = add(stream('/Type /XObject /Subtype /Image /Width 64 /Height 32 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode', page.image))
      resources += ` /XObject << /Scan ${imageId} 0 R >>`
      content = Buffer.from('q 320 0 0 160 40 70 cm /Scan Do Q')
    } else if (page.lines) {
      content = Buffer.from(`BT /F1 4 Tf 5 TL 20 280 Td ${page.lines.map((line, index) => `${index ? 'T* ' : ''}(${line}) Tj`).join(' ')} ET`)
    } else {
      content = Buffer.from(`q ${page.tint ?? '0.15 0.3 0.5'} rg 20 20 360 30 re f Q BT /F1 18 Tf 32 240 Td (${page.text ?? ''}) Tj ET`)
    }
    const contentId = add(stream('', content))
    pageIds.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << ${resources} >> /Contents ${contentId} 0 R >>`))
  }
  objects[0] = Buffer.from('<< /Type /Catalog /Pages 2 0 R >>')
  objects[1] = Buffer.from(`<< /Type /Pages /Count ${pages.length} /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] >>`)
  const encryptionId = encrypted ? add(`<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${'00'.repeat(32)}> /U <${'00'.repeat(32)}> /P -4 >>`) : null
  const chunks = [Buffer.from('%PDF-1.4\n%\xff\xff\xff\xff\n', 'latin1')], offsets = [0]
  let length = chunks[0].length
  for (let index = 0; index < objects.length; index++) {
    offsets.push(length)
    const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), objects[index], Buffer.from('\nendobj\n')])
    chunks.push(chunk); length += chunk.length
  }
  const trailerExtra = encrypted ? ` /Encrypt ${encryptionId} 0 R /ID [<${'01'.repeat(16)}> <${'01'.repeat(16)}>]` : ''
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${trailerExtra} >>\nstartxref\n${length}\n%%EOF\n`))
  return Buffer.concat(chunks)
}

function paddedPdf(source, length) {
  // Whitespace between the xref records and trailer is legal and preserves every object offset.
  const insertAt = source.lastIndexOf(Buffer.from('trailer\n')), padding = length - source.length
  assert(insertAt > 0 && padding >= 0)
  const output = Buffer.alloc(length, 0x20)
  source.copy(output, 0, 0, insertAt)
  source.copy(output, insertAt + padding, insertAt)
  return output
}

async function waitForPdfChild(directory, tool) {
  const deadline = performance.now() + 5000
  while (performance.now() < deadline) {
    const children = (await readFile(`/proc/${process.pid}/task/${process.pid}/children`, 'utf8')).trim().split(/\s+/).filter(Boolean)
    for (const child of children) {
      try {
        const command = await readFile(`/proc/${child}/cmdline`, 'utf8')
        if (command.startsWith(`/usr/bin/${tool}\0`) && command.includes(directory)) return Number(child)
      } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    await delay(5)
  }
  throw new Error(`未观察到本测试启动的 ${tool} 子进程`)
}

test('UTF-8、UTF-16 与 GB18030 文本均保留中文内容', async () => {
  const text = '版式参考\n标题与正文'
  const be = Buffer.from(text, 'utf16le').swap16()
  const examples = [
    [Buffer.from(text), 'notes.TXT', text],
    [Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text)]), 'notes.md', text],
    [Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]), 'notes.markdown', text],
    [Buffer.concat([Buffer.from([0xfe, 0xff]), be]), 'notes.txt', text],
    [Buffer.from('Title\nBody', 'utf16le'), 'notes.txt', 'Title\nBody'],
    [Buffer.from('b0e6cabdb2cebfbc', 'hex'), 'notes.txt', '版式参考'],
  ]
  for (const [bytes, filename, expected] of examples) {
    const result = await parse(bytes, filename)
    assert.equal(result.kind, 'text'); assert.equal(result.text, expected)
    assert.deepEqual(result.images, []); assert.match(result.summary, /文字|文本/)
  }
})

test('长文本按字符截断并明确告知读取范围', async () => {
  const result = await parse(Buffer.from('😀'.repeat(24_010)), 'notes.md')
  assert.equal(Array.from(result.text).length, 24_000)
  assert(!result.text.includes('\ufffd'))
  assert.match(result.limitations.join(' '), /24000|24,000/)
  assert.match(result.summary, /截断|前/)
})

test('空文件、超过原件上限、二进制文本与专用导入格式明确拒绝', async () => {
  await assert.rejects(() => parse(Buffer.alloc(0), 'empty.txt'), status(400))
  await assert.rejects(() => parse(Buffer.alloc(MAX_REFERENCE_BYTES + 1), 'large.pdf'), status(413))
  await assert.rejects(() => parse(Buffer.from([0, 1, 2, 3, 4]), 'binary.txt'), status(415))
  await assert.rejects(() => parse(Buffer.from([0xff, 0xff, 0xff]), 'bad.txt'), status(400))
  for (const filename of ['template.json', 'template.pptx', 'program.exe']) {
    await assert.rejects(() => parse(Buffer.from('content'), filename), status(415))
  }
})

test('真实 PDF 可读到 100 MiB 边界，多一个字节明确拒绝', async () => {
  const limit = 100 * 1024 * 1024
  const source = paddedPdf(pdf([{ text: 'hundred-MiB-boundary' }]), limit)
  const result = await parse(source, 'boundary.PDF')
  assert.equal(result.kind, 'pdf'); assert.equal(result.pageCount, 1)
  assert.match(result.text, /hundred-MiB-boundary/)
  assert.equal(result.images.length, 1)
  await assert.rejects(() => parse(Buffer.alloc(limit + 1), 'too-large.pdf'), status(413, /100 MiB/))
})

test('PDF 扩容后其他文件仍限制为 24 MiB', async () => {
  const source = Buffer.alloc(24 * 1024 * 1024 + 1, 0x41)
  for (const filename of ['image.png', 'photo.jpg', 'photo.jpeg', 'image.webp', 'notes.txt', 'notes.md', 'notes.markdown', 'document.docx']) {
    await assert.rejects(() => parse(source, filename), status(413, /24 MiB/))
  }
  const text = await parse(source.subarray(0, 24 * 1024 * 1024), 'boundary.txt')
  assert.equal(text.text.length, 24_000)
})

test('不足四字节的伪 ZIP 仍返回可供接口使用的中文格式错误', async () => {
  for (const bytes of [Buffer.from('P'), Buffer.from('PK'), Buffer.from([0x50, 0x4b, 3])]) {
    await assert.rejects(() => parse(bytes, 'truncated.docx'), status(415, /DOCX/))
  }
})

test('所有格式开始解析前尊重取消并保留原始取消原因', async () => {
  const png = await sharp({ create: { width: 16, height: 12, channels: 3, background: '#314253' } }).png().toBuffer()
  const files = [[Buffer.from('reference text'), 'reference.txt'], [png, 'reference.png'], [await docx(), 'reference.docx'], [pdf([{ text: 'reference' }]), 'reference.pdf']]
  const controller = new AbortController(), reason = new Error('用户取消解析')
  controller.abort(reason)
  for (const [bytes, filename] of files) {
    await assert.rejects(() => extractReferenceDocument({ bytes, filename, signal: controller.signal }), error => error === reason)
  }
})

test('图片、文本和 DOCX 完成时不会返回已取消的解析结果', async () => {
  const png = await sharp({ create: { width: 1600, height: 1000, channels: 3, background: '#314253' } }).png().toBuffer()
  const files = [[Buffer.from('reference text'), 'reference.txt'], [png, 'reference.png'], [await docx(), 'reference.docx']]
  for (const [bytes, filename] of files) {
    const controller = new AbortController(), reason = new Error('停止读取参考')
    const pending = extractReferenceDocument({ bytes, filename, signal: controller.signal })
    controller.abort(reason)
    await assert.rejects(() => pending, error => error === reason)
  }
})

test('PNG 可真实解码，缩小到最长边 1600 并剥离元数据', async () => {
  const source = await sharp({ create: { width: 3200, height: 1000, channels: 4, background: '#416688cc' } }).withMetadata().png().toBuffer()
  assert((await sharp(source).metadata()).exif)
  const result = await parse(source, 'layout.PNG')
  assert.equal(result.kind, 'image'); assert.equal(result.mimeType, 'image/png')
  assert.equal(result.images.length, 1); assert.equal(result.images[0].mimeType, 'image/png')
  assert.equal(result.images[0].width, 1600); assert.equal(result.images[0].height, 500)
  const info = await sharp(result.images[0].data).metadata()
  assert.equal(info.width, 1600); assert.equal(info.height, 500)
  assert.equal(info.exif, undefined); assert.equal(info.icc, undefined)
  assert.equal(result.text, ''); assert.match(result.limitations.join(' '), /缩放/)
})

test('JPEG 读取方向信息后输出可直接使用的图像，WebP 转为模型可用图片', async () => {
  const source = await sharp({ create: { width: 40, height: 20, channels: 3, background: '#4f6172' } }).withMetadata({ orientation: 6 }).jpeg().toBuffer()
  for (const extension of ['jpg', 'jpeg']) {
    const result = await parse(source, `photo.${extension}`)
    assert.equal(result.mimeType, 'image/jpeg')
    assert.equal(result.images[0].width, 20); assert.equal(result.images[0].height, 40)
    assert.equal((await sharp(result.images[0].data).metadata()).orientation, undefined)
  }
  const webp = await sharp({ create: { width: 48, height: 32, channels: 3, background: '#516273' } }).webp().toBuffer()
  const result = await parse(webp, 'image.webp')
  assert.equal(result.mimeType, 'image/webp')
  assert.match(result.images[0].mimeType, /^image\/(jpeg|png)$/)
  assert.equal((await sharp(result.images[0].data).metadata()).width, 48)
})

test('伪装扩展名、截断图片、多帧 PNG 和超像素图片均拒绝', async () => {
  const source = await sharp({ create: { width: 16, height: 12, channels: 3, background: '#314253' } }).png().toBuffer()
  await assert.rejects(() => parse(Buffer.from('not an image'), 'fake.jpg'), status(415))
  await assert.rejects(() => parse(source, 'fake.jpg'), status(415))
  await assert.rejects(() => parse(source, 'fake.txt'), status(415))
  await assert.rejects(() => parse(source.subarray(0, 45), 'broken.png'), status(400))
  await assert.rejects(() => parse(animatedPng(), 'animated.png'), status(400, /单帧|多帧/))
  const oversized = Buffer.from(source)
  oversized.writeUInt32BE(8000, 16); oversized.writeUInt32BE(6000, 20)
  oversized.writeUInt32BE(crc32(oversized.subarray(12, 29)), 29)
  await assert.rejects(() => parse(oversized, 'oversized.png'), status(413))
})

test('PNG 不能通过谎报动画帧数把多帧内容作为静态图片上传', async () => {
  await assert.rejects(() => parse(animatedPng({ declaredFrames: 1 }), 'lying-animation.png'), status(400, /单帧|多帧/))
})

test('真实 31 页 PDF 读取前 30 页，保留第 30 页文字和实际画面', async () => {
  const result = await parse(pdf(Array.from({ length: 31 }, (_, index) => ({ text: `layout-page-${index + 1}`, tint: index === 29 ? '0.9 0.1 0.2' : undefined }))), 'reference.pdf')
  assert.equal(result.kind, 'pdf'); assert.equal(result.mimeType, 'application/pdf')
  assert.equal(result.pageCount, 31)
  assert.deepEqual(result.readPages, Array.from({ length: 30 }, (_, index) => index + 1))
  for (let page = 1; page <= 30; page++) assert.match(result.text, new RegExp(`\\blayout-page-${page}\\b`))
  assert.doesNotMatch(result.text, /\blayout-page-31\b/)
  assert.equal(result.images.length, 30)
  assert.equal(result.pages.length, 30)
  assert.equal(result.pages[29].page, 30)
  assert.match(result.pages[29].text, /layout-page-30/)
  assert.equal(result.pages[29].preview, true)
  for (const [index, image] of result.images.entries()) {
    assert.equal(image.page, index + 1); assert.equal(image.mimeType, 'image/jpeg')
    const info = await sharp(image.data).metadata()
    assert.equal(info.width, image.width); assert.equal(info.height, image.height)
    assert.equal(Math.max(info.width, info.height), 1600)
  }
  const lastPagePixel = await sharp(result.images[29].data).extract({ left: 800, top: 1060, width: 1, height: 1 }).removeAlpha().raw().toBuffer()
  assert(Math.abs(lastPagePixel[0] - 230) <= 5 && Math.abs(lastPagePixel[1] - 26) <= 5 && Math.abs(lastPagePixel[2] - 51) <= 5, '第 30 页应保留它独有的红色标记，不能重复其他页面')
  assert.match(result.limitations.join(' '), /31.*30|30.*31/)
  assert.match(result.summary, /31.*30|30.*31/)
  assert.match(result.summary, /后 1 页未读取/)
})

test('PDF 正文可保留超过 24000 字，达到 96000 字时明确截断', async () => {
  const pages = Array.from({ length: 25 }, (_, index) => ({ lines: Array.from({ length: 50 }, () => `page-${String(index + 1).padStart(2, '0')}: ${'A'.repeat(80)}`) }))
  const result = await parse(pdf(pages), 'dense.pdf')
  assert.equal(result.pageCount, 25); assert.equal(result.images.length, 25)
  assert.equal(Array.from(result.text).length, 96_000)
  assert.match(result.text, /page-20:/)
  assert.match(result.limitations.join(' '), /96000|96,000/)
  assert.match(result.summary, /截断.*96000|96000.*截断/)
})

test('PDF 超过旧 45 秒预算仍可继续，总计超过 5 分钟时明确超时', async context => {
  for (const elapsed of [60_000, 300_001]) {
    let reads = 0
    const now = context.mock.method(Date, 'now', () => 1_000_000 + (reads++ === 0 ? 0 : elapsed))
    try {
      const pending = parse(pdf([{ text: 'timeout-budget' }]), 'timed.pdf')
      if (elapsed < 300_000) {
        const result = await pending
        assert.match(result.text, /timeout-budget/)
        assert.equal(result.images.length, 1)
      } else await assert.rejects(() => pending, status(408, /超时/))
    } finally { now.mock.restore() }
  }
})

test('扫描 PDF 没有文字时仍返回真实页面图像供视觉分析', async () => {
  const scan = await sharp({ create: { width: 64, height: 32, channels: 3, background: '#3a638b' } }).jpeg().toBuffer()
  const result = await parse(pdf([{ image: scan }]), 'scan.pdf')
  assert.equal(result.text, ''); assert.equal(result.pageCount, 1)
  assert.deepEqual(result.readPages, [1]); assert.equal(result.images.length, 1)
  const { channels } = await sharp(result.images[0].data).stats()
  assert(channels.some(channel => channel.min < channel.max), '页面图像应保留嵌入扫描图与白色页面的不同像素')
  assert.match(result.limitations.join(' '), /文字|OCR/)
  assert.match(result.summary, /图像/)
})

test('带加密标记但无需打开密码的PDF正常读取文字和页面', async () => {
  const bytes = await readFile(new URL('./fixtures/pdf-permissions/readable.pdf', import.meta.url))
  const result = await parse(bytes, '可直接打开.pdf')
  assert.equal(result.pageCount, 2); assert.deepEqual(result.readPages, [1, 2])
  assert.match(result.text, /PUBLIC REFERENCE FIRST PAGE/); assert.match(result.text, /PUBLIC REFERENCE SECOND PAGE/)
  assert.equal(result.images.length, 2)
  for (const image of result.images) assert((await sharp(image.data).stats()).channels.some(c => c.min < c.max))
})

test('允许打开但限制复制的PDF仅使用真实页面图像，并记录读取限制', async () => {
  const bytes = await readFile(new URL('./fixtures/pdf-permissions/no-copy.pdf', import.meta.url))
  const result = await parse(bytes, '仅限制复制.pdf')
  assert.equal(result.pageCount, 2); assert.deepEqual(result.readPages, [1, 2])
  assert.equal(result.text, ''); assert.equal(result.images.length, 2)
  assert.match(result.limitations.join(' '), /限制.*(?:提取|复制).*文字|文字.*(?:提取|复制).*限制/)
  assert.match(result.summary, /图像/); assert.doesNotMatch(result.summary, /未检测到/)
})

test('真正需要打开密码的PDF明确报错，不混淆为普通权限标记', async () => {
  const bytes = await readFile(new URL('./fixtures/pdf-permissions/open-password.pdf', import.meta.url))
  await assert.rejects(() => parse(bytes, '需要密码.pdf'), status(400, /需要.*(?:密码|口令)|(?:密码|口令).*才能打开/))
})

test('PDF 成功、损坏与密码失败都清理临时文件且错误不泄漏路径', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reference-document-test-'))
  const previous = process.env.TMPDIR
  process.env.TMPDIR = root
  try {
    await parse(pdf([{ text: 'cleanup-check' }]), 'ok.pdf')
    assert.deepEqual(await readdir(root), [])
    await assert.rejects(() => parse(Buffer.from('%PDF-1.7\nbroken'), 'bad.pdf'), error => {
      status(400)(error); assert(!error.message.includes(root)); return true
    })
    assert.deepEqual(await readdir(root), [])
    await assert.rejects(() => parse(pdf([{ text: 'protected' }], { encrypted: true }), 'locked.pdf'), status(400, /口令|密码/))
    assert.deepEqual(await readdir(root), [])
    await assert.rejects(() => parse(Buffer.from('fake PDF'), 'fake.pdf'), status(415))
  } finally {
    if (previous === undefined) delete process.env.TMPDIR
    else process.env.TMPDIR = previous
    await rm(root, { recursive: true, force: true })
  }
})

test('真实 PDF 渲染启动后取消会终止 Poppler 并清理全部临时文件', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reference-document-cancel-')), previous = process.env.TMPDIR
  const controller = new AbortController(), reason = new Error('用户停止 PDF 解析')
  const source = pdf(Array.from({ length: 30 }, (_, index) => ({ lines: Array.from({ length: 50 }, () => `page-${index + 1}: ${'A'.repeat(80)}`) })))
  process.env.TMPDIR = root
  let pending
  try {
    pending = extractReferenceDocument({ bytes: source, filename: 'cancel.pdf', signal: controller.signal })
    void pending.catch(() => {})
    const child = await waitForPdfChild(root, 'pdftoppm')
    assert((await readdir(root)).length > 0, '取消前应确实存在解析中的临时目录')
    const cancelledAt = performance.now()
    controller.abort(reason)
    await assert.rejects(() => pending, error => error === reason || (error.name === 'AbortError' && error.cause === reason))
    assert(performance.now() - cancelledAt < 2000, '取消应尽快终止解析，不等待剩余页面')
    assert.throws(() => process.kill(child, 0), error => error.code === 'ESRCH', '解析返回时 Poppler 应已退出')
    assert.deepEqual(await readdir(root), [])
    const next = await parse(pdf([{ text: 'next-upload' }]), 'next.pdf')
    assert.match(next.text, /next-upload/)
    assert.deepEqual(await readdir(root), [])
  } finally {
    controller.abort(reason)
    await pending?.catch(() => {})
    if (previous === undefined) delete process.env.TMPDIR
    else process.env.TMPDIR = previous
    await rm(root, { recursive: true, force: true })
  }
})

test('DOCX 提取段落、实体、制表符与换行，明确仅提取文字', async () => {
  const bytes = await docx(documentXml('<w:p><w:r><w:t>建筑 &amp; 城市</w:t></w:r></w:p><w:p><w:r><w:t>指标</w:t><w:tab/><w:t>20</w:t><w:br/><w:t>&#x6807;&#39064;</w:t></w:r></w:p>'))
  const result = await parse(bytes, 'reference.docx')
  assert.equal(result.kind, 'docx')
  assert.equal(result.mimeType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  assert.equal(result.text, '建筑 & 城市\n指标\t20\n标题')
  assert.deepEqual(result.images, [])
  assert.match(result.limitations.join(' '), /仅.*文字|仅.*文本/)
})

test('DOCX 支持合法命名空间别名，但不把属性和字段代码当正文', async () => {
  const xml = `<d:document xmlns:d="${wordNamespace}"><d:body><d:p><d:r><d:instrText>INCLUDETEXT secret.txt</d:instrText><d:t xml:space="preserve">正文 &lt;示例&gt;</d:t></d:r></d:p></d:body></d:document>`
  const result = await parse(await docx(xml), 'alias.docx')
  assert.equal(result.text, '正文 <示例>')
  assert(!result.text.includes('secret.txt'))
})

test('PDF 正文扩容不放宽 DOCX 的 24000 字边界', async () => {
  const result = await parse(await docx(documentXml(`<w:p><w:r><w:t>${'文'.repeat(30_000)}</w:t></w:r></w:p>`)), 'long.docx')
  assert.equal(result.text.length, 24_000)
  assert.match(result.limitations.join(' '), /24000/)
})

test('DOCX 拒绝实体声明、不完整 XML、伪装 ZIP 与路径穿越', async () => {
  const unsafe = [
    `<!DOCTYPE w:document [<!ENTITY ex SYSTEM "file:///etc/passwd">]>${documentXml('<w:p><w:r><w:t>&ex;</w:t></w:r></w:p>')}`,
    documentXml('<w:p><w:r><w:t>broken</w:r></w:p>'),
    documentXml('<w:p><w:r><w:t>&unknown;</w:t></w:r></w:p>'),
    documentXml('<w:p><w:r><w:t>text\u0000binary</w:t></w:r></w:p>'),
  ]
  for (const xml of unsafe) await assert.rejects(() => docx(xml).then(bytes => parse(bytes, 'unsafe.docx')), status(400))
  await assert.rejects(() => parse(Buffer.from('fake ZIP'), 'fake.docx'), status(415))
  const wrongZip = new JSZip(); wrongZip.file('notes.txt', 'not a Word document')
  await assert.rejects(() => wrongZip.generateAsync({ type: 'nodebuffer' }).then(bytes => parse(bytes, 'wrong.docx')), status(400))
  await assert.rejects(() => docx(undefined, [['../outside.txt', 'escape']]).then(bytes => parse(bytes, 'unsafe.docx')), status(400))
})

test('DOCX 对超大单文件、解压总量、条目数量和压缩炸弹设定边界', async () => {
  const largeXml = documentXml(`<w:p><w:r><w:t>${'A'.repeat(5 * 1024 * 1024)}</w:t></w:r></w:p>`)
  await assert.rejects(() => docx(largeXml).then(bytes => parse(bytes, 'bomb.docx')), status(413))
  await assert.rejects(() => docx(undefined, [['word/media/large.bin', Buffer.alloc(17 * 1024 * 1024)]]).then(bytes => parse(bytes, 'large-entry.docx')), status(413))
  const repeated = Buffer.alloc(13 * 1024 * 1024)
  await assert.rejects(() => docx(undefined, [0, 1, 2, 3].map(index => [`word/media/${index}.bin`, repeated])).then(bytes => parse(bytes, 'large-total.docx')), status(413))
  await assert.rejects(() => docx(undefined, Array.from({ length: 1001 }, (_, index) => [`extra/${index}`, 'x'])).then(bytes => parse(bytes, 'many-entries.docx')), status(413))
})

test('DOCX 不能通过伪造 ZIP 未压缩长度绕过实时解压上限', async () => {
  const bytes = await docx(documentXml(`<w:p><w:r><w:t>${'A'.repeat(5 * 1024 * 1024)}</w:t></w:r></w:p>`))
  for (let offset = 0; offset < bytes.length - 46; offset++) {
    if (bytes.readUInt32LE(offset) === 0x02014b50) {
      const nameLength = bytes.readUInt16LE(offset + 28)
      if (bytes.subarray(offset + 46, offset + 46 + nameLength).toString() === 'word/document.xml') {
        bytes.writeUInt32LE(1, offset + 24)
        bytes.writeUInt32LE(1, bytes.readUInt32LE(offset + 42) + 22)
      }
    }
  }
  await assert.rejects(() => parse(bytes, 'lying-size.docx'), status(413))
})
