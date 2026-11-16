import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readdir, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import JSZip from 'jszip'
import sharp from 'sharp'
import { extractReferenceDocument } from '../src/layout-library/reference-document.mjs'
import { referenceByteLimit, MAX_REFERENCE_BYTES } from '../src/layout-library/reference-limits.mjs'

const PptxGenJS = createRequire(import.meta.url)('pptxgenjs')

const parse = bytes => extractReferenceDocument({ bytes, filename: 'synthetic-reference.pptx' })
async function deck({ count = 2, mutate } = {}) {
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'Synthetic parser test'
  pptx.theme = { headFontFace: 'Arial', bodyFontFace: 'Arial', lang: 'en-US' }
  const png = await sharp({ create: { width: 24, height: 12, channels: 3, background: '#25876a' } }).png().toBuffer()
  for (let page = 1; page <= count; page++) {
    const slide = pptx.addSlide()
    slide.background = { color: page === count ? '228844' : 'FFFFFF' }
    slide.addText(`Synthetic page ${page}`, { x: 1, y: 0.5, w: 8, h: 0.6, fontFace: 'Arial', fontSize: 24, color: '172A3A', bold: true })
    slide.addShape(pptx.ShapeType.rect, { x: 1, y: 1.5, w: 2, h: 1, fill: { color: '257A65' }, line: { color: '257A65' } })
    slide.addImage({ data: `image/png;base64,${png.toString('base64')}`, x: 7, y: 2, w: 2, h: 1 })
  }
  const bytes = await pptx.write({ outputType: 'nodebuffer' })
  if (!mutate) return bytes
  const zip = await JSZip.loadAsync(bytes)
  await mutate(zip)
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}
const rejects = (statusCode, pattern) => error => {
  assert.equal(error.statusCode, statusCode, error.message)
  assert.match(error.message, pattern)
  return true
}

// Exercise the real archive validator without ever invoking an office renderer
// for adversarial resource URLs. This test cannot make a resource request.
async function validationResult(bytes) {
  const directory = await mkdtemp(join(tmpdir(), 'pptx-validation-test-'))
  try {
    const source = join(directory, 'input.pptx')
    await writeFile(source, bytes)
    const module = fileURLToPath(new URL('../src/layout-library/reference-pptx.py', import.meta.url))
    const code = `import importlib.util,json,sys\nfrom pathlib import Path\ns=importlib.util.spec_from_file_location('reference_pptx',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\ntry:\n m.validate_package(Path(sys.argv[2]));print(json.dumps({'valid':True}))\nexcept m.Reject as e:\n print(json.dumps({'error':str(e),'statusCode':e.status},ensure_ascii=False))`
    const { stdout } = await promisify(execFile)('/usr/bin/python3', ['-c', code, module, source], { timeout: 30_000 })
    return JSON.parse(stdout)
  } finally { await rm(directory, { recursive: true, force: true }) }
}

test('PPTX 原生结构保留真实页序、元素几何、主题与源文件证据，并生成真实预览', { timeout: 90_000 }, async () => {
  const bytes = await deck({ mutate: async zip => {
    const xml = await zip.file('ppt/presentation.xml').async('string')
    const ids = xml.match(/<p:sldId\b[^>]*\/>/g)
    zip.file('ppt/presentation.xml', xml.replace(/(<p:sldIdLst>)[\s\S]*?(<\/p:sldIdLst>)/, `$1${ids.reverse().join('')}$2`))
  } })
  const result = await parse(bytes)
  assert.equal(result.kind, 'pptx')
  assert.equal(result.pageCount, 2)
  assert.deepEqual(result.readPages, [1, 2])
  assert.equal(result.images.length, 2)
  assert.equal(result.structure.schema, 'pre-design.pptx-structure.v1')
  assert.equal(result.structure.provenance.sourceSha256, createHash('sha256').update(bytes).digest('hex'))
  assert.equal(result.structure.provenance.upstream.license, 'MIT')
  assert.equal(result.structure.slides[0].part, 'ppt/slides/slide2.xml')
  assert.match(result.structure.slides[0].text, /Synthetic page 2/)
  assert.match(result.structure.slides[1].text, /Synthetic page 1/)
  assert.equal(result.structure.canvas.width, 1280)
  assert.equal(result.structure.canvas.height, 720)
  assert(result.structure.themes.length >= 1)
  assert(result.structure.masters.length >= 1)
  assert(result.structure.layouts.length >= 1)
  const title = result.structure.slides[0].shapes.find(shape => shape.text?.includes('Synthetic page 2'))
  assert.equal(title.x, 96)
  assert.equal(title.y, 48)
  assert.equal(title.width, 768)
  assert(title.runs.some(run => run.fontSize === 24 && run.fontFace === 'Arial'))
  const picture = result.structure.slides[0].shapes.find(shape => shape.kind === 'pic')
  assert.equal(picture.x, 672)
  assert.equal(picture.image.sha256.length, 64)
  assert.equal(result.pages[0].page, 1)
  assert.equal(result.pages[0].preview, true)
  for (const image of result.images) {
    const metadata = await sharp(image.data).metadata()
    assert.equal(metadata.format, 'jpeg')
    assert.equal(metadata.width, image.width)
    assert.equal(metadata.height, image.height)
  }
  const pixels = await sharp(result.images[0].data).raw().toBuffer({ resolveWithObject: true })
  const i = (Math.floor(pixels.info.height * .9) * pixels.info.width + Math.floor(pixels.info.width * .9)) * pixels.info.channels
  assert(pixels.data[i + 1] > pixels.data[i] + 50, '第 1 张真实预览必须对应换序后的绿色末页')
})

test('PPTX 预览从全篇抽样而非只读前 30 页，结构页序完整', { timeout: 120_000 }, async () => {
  const result = await parse(await deck({ count: 41 }))
  assert.equal(result.pageCount, 41)
  assert.equal(result.images.length, 30)
  assert.equal(result.readPages[0], 1)
  assert.equal(result.readPages.at(-1), 41)
  assert.equal(new Set(result.readPages).size, 30)
  assert.equal(result.structure.slides.length, 41)
  assert.equal(result.pages.length, 41)
  assert.match(result.limitations.join(' '), /抽样/)
  assert.match(result.structure.slides.at(-1).text, /Synthetic page 41/)
  assert(Buffer.byteLength(JSON.stringify({ structure: result.structure, pages: result.pages })) <= 4 * 1024 * 1024)
})

test('PPTX 文件额度容纳大参考稿且不扩大其他格式额度', () => {
  assert(referenceByteLimit('large.pptx') >= 515_207_915)
  assert(MAX_REFERENCE_BYTES >= referenceByteLimit('large.pptx'))
  assert.equal(referenceByteLimit('normal.docx'), 24 * 1024 * 1024)
})

test('PPTX 拒绝伪装、路径穿越、实体、宏、失效继承和 CRC 损坏', { timeout: 60_000 }, async () => {
  await assert.rejects(() => parse(Buffer.from('fake pptx')), rejects(415, /PPTX/))
  await assert.rejects(() => parse(Buffer.from('PK\x03\x04broken')), rejects(400, /PPTX|压缩包/))
  const mutations = [
    [zip => zip.file('../outside.txt', 'bad', { createFolders: false }), /路径/],
    [zip => zip.file('ppt/vbaProject.bin', 'macro'), /宏|活动/],
    [async zip => zip.file('ppt/slides/slide1.xml', `<!DOCTYPE s [<!ENTITY x SYSTEM "file:///etc/passwd">]>${await zip.file('ppt/slides/slide1.xml').async('string')}`), /DOCTYPE|ENTITY|实体/],
    [async zip => zip.file('ppt/slides/_rels/slide1.xml.rels', (await zip.file('ppt/slides/_rels/slide1.xml.rels').async('string')).replace(/Target="[^\"]*slideLayout1.xml"/, 'Target="../slideLayouts/missing.xml"')), /关系|版式|结构/],
  ]
  for (const [mutate, pattern] of mutations) await assert.rejects(() => deck({ mutate }).then(parse), rejects(400, pattern))
  const damaged = await deck()
  const zip = await JSZip.loadAsync(damaged)
  const stored = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' })
  const textAt = stored.indexOf(Buffer.from('Synthetic page 1'))
  assert(textAt > 0)
  stored[textAt] = 88
  await assert.rejects(() => parse(stored), rejects(400, /CRC|校验|损坏/))
})

test('PPTX 外部关系不下载，预览移除外链并明确记录限制', { timeout: 90_000 }, async () => {
  const bytes = await deck({ mutate: async zip => {
    const path = 'ppt/slides/_rels/slide1.xml.rels'
    zip.file(path, (await zip.file(path).async('string')).replace('</Relationships>', '<Relationship Id="rIdExternal" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://127.0.0.1:9/private-image.png" TargetMode="External"/></Relationships>'))
  } })
  const result = await parse(bytes)
  assert.equal(result.images.length, 2)
  assert.match(result.limitations.join(' '), /外部|外链/)
  assert.equal(result.structure.provenance.externalRelationships, 1)
})

test('PPTX 解析尊重预先取消，保留取消原因', async () => {
  const controller = new AbortController(), reason = new Error('cancel synthetic parse')
  controller.abort(reason)
  await assert.rejects(() => extractReferenceDocument({ bytes: Buffer.from('anything'), filename: 'x.pptx', signal: controller.signal }), error => error === reason)
})

test('PPTX 分组按子坐标比例展开，旋转分组后代明确标为近似', { timeout: 90_000 }, async () => {
  const bytes = await deck({ count: 1, mutate: async zip => {
    const path = 'ppt/slides/slide1.xml'
    const group = (id, rotation) => `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${id}" name="Synthetic group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm rot="${rotation}"><a:off x="914400" y="914400"/><a:ext cx="1828800" cy="914400"/><a:chOff x="0" y="0"/><a:chExt cx="914400" cy="914400"/></a:xfrm></p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="${id + 1}" name="Child"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="457200" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:sp></p:grpSp>`
    zip.file(path, (await zip.file(path).async('string')).replace('</p:spTree>', `${group(700, 0)}${group(710, 5400000)}</p:spTree>`))
  } })
  const result = await parse(bytes)
  const shapes = result.structure.slides[0].shapes
  const child = shapes.find(shape => shape.id === '701')
  assert.deepEqual([child.x, child.y, child.width, child.height], [96, 96, 96, 48])
  assert.equal(child.groupId, '700')
  assert.equal(child.geometryStatus, 'native-frame')
  assert.equal(shapes.find(shape => shape.id === '711').geometryStatus, 'approximate')
  assert(result.structure.warnings.some(warning => warning.code === 'group-transform'))
})

test('PPTX 运行中取消会清理该解析的私有临时目录', { timeout: 90_000 }, async () => {
  const bytes = await deck({ count: 41 })
  const before = new Set((await readdir(tmpdir())).filter(name => name.startsWith('layout-reference-pptx-')))
  const controller = new AbortController(), reason = new Error('cancel running native parse')
  const pending = extractReferenceDocument({ bytes, filename: 'synthetic.pptx', signal: controller.signal })
  const timer = setTimeout(() => controller.abort(reason), 100)
  try { await assert.rejects(() => pending, error => error === reason) }
  finally { clearTimeout(timer) }
  const after = (await readdir(tmpdir())).filter(name => name.startsWith('layout-reference-pptx-') && !before.has(name))
  assert.deepEqual(after, [])
})

test('PPTX 缺少真实渲染运行时时明确报错，不以空预览假装完成', { timeout: 90_000 }, async () => {
  const previous = process.env.PRE_LAYOUT_OFFICE_BINARY
  process.env.PRE_LAYOUT_OFFICE_BINARY = '/does-not-exist/pre-design-soffice'
  try { await assert.rejects(() => deck({ count: 1 }).then(parse), rejects(503, /LibreOffice/)) }
  finally {
    if (previous === undefined) delete process.env.PRE_LAYOUT_OFFICE_BINARY
    else process.env.PRE_LAYOUT_OFFICE_BINARY = previous
  }
})

test('PPTX 对 VML 直接资源地址、嵌套 SVG 和 UTF-16 实体同样执行安全检查', { timeout: 90_000 }, async () => {
  const unsafe = [
    ['ppt/media/unsafe.vml', '<xml xmlns:v="urn:schemas-microsoft-com:vml"><v:shape><v:imagedata src="https://127.0.0.1:9/image.png"/></v:shape></xml>'],
    ['ppt/media/nested.svg', `<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64')}"/></svg>`],
    ['ppt/custom.xml', Buffer.concat([Buffer.from([255, 254]), Buffer.from('<!DOCTYPE data [<!ENTITY unsafe "x">]><data>&unsafe;</data>', 'utf16le')])],
  ]
  for (const [name, value] of unsafe) {
    await assert.rejects(() => deck({ count: 1, mutate: zip => zip.file(name, value) }).then(parse), rejects(400, /外部|SVG|ENTITY|实体/))
  }
})

test('PPTX 对声明过大的单项及过深 XML 在渲染前拒绝', async () => {
  const bytes = await deck({ count: 1 })
  const zip = await JSZip.loadAsync(bytes)
  zip.file('ppt/media/large.bin', 'x')
  const damaged = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' })
  for (let offset = 0; offset + 46 <= damaged.length; offset++) {
    if (damaged.readUInt32LE(offset) === 0x02014b50) {
      const length = damaged.readUInt16LE(offset + 28)
      if (damaged.subarray(offset + 46, offset + 46 + length).toString() === 'ppt/media/large.bin') damaged.writeUInt32LE(97 * 1024 * 1024, offset + 24)
    }
  }
  await assert.rejects(() => parse(damaged), rejects(413, /上限/))
  await assert.rejects(() => deck({ count: 1, mutate: archive => archive.file('ppt/deep.xml', '<x>'.repeat(140) + '</x>'.repeat(140)) }).then(parse), rejects(413, /嵌套|上限/))
})

test('PPTX 验证根据 OPC 媒体类型检查隐藏 SVG，并检查实体解码后的 CSS 资源', async () => {
  const mutations = [
    async zip => {
      zip.file('ppt/media/vector.blob', '<!--comment--><svg xmlns="http://www.w3.org/2000/svg"><image href="https://127.0.0.1:9/image.png"/></svg>')
      const types = await zip.file('[Content_Types].xml').async('string')
      zip.file('[Content_Types].xml', types.replace('</Types>', '<Override PartName="/ppt/media/vector.blob" ContentType="image/svg+xml"/></Types>'))
    },
    zip => zip.file('ppt/media/style.svg', '<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill:u&#114;l(https://127.0.0.1:9/image.svg)"/></svg>'),
    zip => zip.file('ppt/media/fill.svg', '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="u&#114;l(https://127.0.0.1:9/image.svg)"/></svg>'),
    zip => zip.file('ppt/media/css.svg', '<svg xmlns="http://www.w3.org/2000/svg"><style>@im&#112;ort "https://127.0.0.1:9/style.css";</style></svg>'),
  ]
  for (const mutate of mutations) {
    const result = await validationResult(await deck({ count: 1, mutate }))
    assert.equal(result.statusCode, 400, JSON.stringify(result))
    assert.match(result.error, /外部|样式|SVG/)
  }
})
