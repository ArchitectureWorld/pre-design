import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync, crc32 } from 'node:zlib'
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
    } else {
      content = Buffer.from(`q 0.15 0.3 0.5 rg 20 20 360 30 re f Q BT /F1 18 Tf 32 240 Td (${page.text ?? ''}) Tj ET`)
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

test('不足四字节的伪 ZIP 仍返回可供接口使用的中文格式错误', async () => {
  for (const bytes of [Buffer.from('P'), Buffer.from('PK'), Buffer.from([0x50, 0x4b, 3])]) {
    await assert.rejects(() => parse(bytes, 'truncated.docx'), status(415, /DOCX/))
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

test('真实 PDF 只读取前四页文字与图像，并保留真实总页数', async () => {
  const result = await parse(pdf(Array.from({ length: 6 }, (_, index) => ({ text: `layout-page-${index + 1}` }))), 'reference.pdf')
  assert.equal(result.kind, 'pdf'); assert.equal(result.mimeType, 'application/pdf')
  assert.equal(result.pageCount, 6); assert.deepEqual(result.readPages, [1, 2, 3, 4])
  assert.match(result.text, /layout-page-1/); assert.match(result.text, /layout-page-4/)
  assert.doesNotMatch(result.text, /layout-page-[56]/)
  assert.equal(result.images.length, 4)
  for (const [index, image] of result.images.entries()) {
    assert.equal(image.page, index + 1); assert.equal(image.mimeType, 'image/jpeg')
    const info = await sharp(image.data).metadata()
    assert.equal(info.width, image.width); assert.equal(info.height, image.height)
    assert.equal(Math.max(info.width, info.height), 1600)
  }
  assert.match(result.limitations.join(' '), /6.*4|4.*6/)
  assert.match(result.summary, /6.*4|4.*6/)
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
