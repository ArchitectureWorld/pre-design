import { readFile, writeFile } from 'node:fs/promises'

async function replaceOnce(path, before, after) {
  const source = await readFile(path, 'utf8')
  const first = source.indexOf(before)
  if (first < 0) throw new Error(`${path}: patch target not found`)
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`${path}: patch target is not unique`)
  await writeFile(path, source.slice(0, first) + after + source.slice(first + before.length))
  console.log(`patched ${path}`)
}

// Sparse content may reuse a real backdrop, but must not consume assets reserved for opening/divider pages.
await replaceOnce(
  'src/report/page-plan.ts',
`  const fallback = (page: ClientPage): string | undefined => {
    const candidates = [
      ...report.assets.filter(asset => asset.chapterId === page.chapterId && asset.role !== 'material'),
      ...report.assets.filter(asset => asset.role === 'hero'),
      ...report.assets.filter(asset => asset.sourceKind === 'ai-concept' && asset.role !== 'material'),
    ]
    const asset = candidates.find(candidate => !usedBackdropIds.has(candidate.assetId)) ?? candidates[0]
    if (asset !== undefined) usedBackdropIds.add(asset.assetId)
    return asset?.assetId
  }`,
`  const fallback = (page: ClientPage, reserve = true): string | undefined => {
    const candidates = [
      ...report.assets.filter(asset => asset.chapterId === page.chapterId && asset.role !== 'material'),
      ...report.assets.filter(asset => asset.role === 'hero'),
      ...report.assets.filter(asset => asset.sourceKind === 'ai-concept' && asset.role !== 'material'),
    ]
    const asset = candidates.find(candidate => !usedBackdropIds.has(candidate.assetId)) ?? candidates[0]
    if (asset !== undefined && reserve) usedBackdropIds.add(asset.assetId)
    return asset?.assetId
  }`,
)
await replaceOnce(
  'src/report/page-plan.ts',
`    if (!isTarget && !isSparseContentPage) return page
    const material = materialConcepts.find(asset => !usedBackdropIds.has(asset.assetId))
    if (material !== undefined) usedBackdropIds.add(material.assetId)
    const backdropAssetId = material?.assetId ?? fallback(page)`,
`    if (!isTarget && !isSparseContentPage) return page
    const material = isTarget
      ? materialConcepts.find(asset => !usedBackdropIds.has(asset.assetId))
      : undefined
    if (material !== undefined) usedBackdropIds.add(material.assetId)
    const backdropAssetId = material?.assetId ?? fallback(page, isTarget)`,
)

// This validator test intentionally injects text-only pages; strip any real backdrop inherited from the source page.
await replaceOnce(
  'tests/report-page-plan.spec.ts',
`    const { analyticalVisual: _analyticalVisual, ...textOnlySource } = source`,
`    const { analyticalVisual: _analyticalVisual, backdropAssetId: _backdropAssetId, ...textOnlySource } = source`,
)

// Golden regression now verifies grounded operational evidence rather than the removed synthetic demand matrix.
await replaceOnce(
  'tests/full-flow-golden.spec.ts',
`    const matrixContent = deck.textObjects.filter(object => object.slideNumber === 28
      && object.y >= 2
      && object.y < 6.4
      && object.fontSize >= 10)
    expect(matrixContent.length, 'PPTX 第28页缺少客群与场景矩阵内容').toBeGreaterThanOrEqual(10)
    expect(matrixContent.filter(object => object.height > 2.45), 'PPTX 第28页仍存在纵向居中的大空白卡').toEqual([])
    for (const label of ['日常休闲', '周末活动', '城市节庆', '周边居民', '城市家庭', '青年客群']) {
      expect(deck.slideTexts[27], \`PPTX 第28页矩阵缺少标签：\${label}\`).toContain(label)
    }
    expect(matrixContent.filter(object => ['高', '中', '低'].includes(object.text.trim())),
      'PPTX 第28页矩阵缺少独立需求强度单元').toHaveLength(9)`,
`    const operationEvidenceContent = deck.textObjects.filter(object => object.slideNumber === 28
      && object.y >= 2
      && object.y < 6.4
      && object.fontSize >= 10)
    expect(operationEvidenceContent.length, 'PPTX 第28页缺少有证据支撑的运营判断').toBeGreaterThanOrEqual(2)
    expect(operationEvidenceContent.filter(object => object.height > 2.45), 'PPTX 第28页仍存在纵向居中的大空白卡').toEqual([])
    expect(deck.slideTexts[27]).toContain('多时段内容组合提升设施与空间使用效率')
    expect(deck.slideTexts[27]).toContain('项目证据 9 支撑对应的客户判断。')
    for (const fabricatedLabel of ['周边居民', '城市家庭', '青年客群']) {
      expect(deck.slideTexts[27], \`PPTX 第28页不得出现无证据客群标签：\${fabricatedLabel}\`).not.toContain(fabricatedLabel)
    }`,
)

console.log('second deployability fix pass completed')
