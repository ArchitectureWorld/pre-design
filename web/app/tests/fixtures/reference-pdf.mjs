// Synthetic PDF bytes for upload integration tests.
export function pdf(pages, { encrypted = false } = {}) {
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
