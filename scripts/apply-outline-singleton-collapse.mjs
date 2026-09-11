import { readFile, writeFile } from 'node:fs/promises'

async function replaceOnce(path, before, after) {
  const source = await readFile(path, 'utf8')
  const first = source.indexOf(before)
  if (first < 0) throw new Error(`${path}: patch target not found`)
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`${path}: patch target is not unique`)
  await writeFile(path, source.slice(0, first) + after + source.slice(first + before.length))
  console.log(`patched ${path}`)
}

// A report subject is a grouping-only node. When it has exactly one finding/page,
// keeping topic -> subject -> page creates a meaningless one-child hierarchy.
// Collapse only that structural singleton; preserve chapters and branching subjects.
await replaceOnce(
  'src/presentation/standard-project-adapter.ts',
`    for (const [subjectOrder, [sectionKey, subjectFindings]] of orderedSubjects.entries()) {
      const subjectNodeId = ledger.resolve('outlineNode', \`section:\${topic.key}:\${sectionKey}\`) as OutlineNodeId
      subjectNodes.push({
        outlineNodeId: subjectNodeId,
        parentOutlineNodeId: topicNodeId,
        kind: 'section',
        title: normalizeString(subjectFindings[0]!.sectionTitle, 'finding.sectionTitle'),
        summary: distinctStrings(subjectFindings.map(finding => finding.keyMessage)).join('；'),
        order: subjectOrder,
        sourceRefs: [sourceRef(frozenProject, subjectFindings.flatMap(finding => finding.objectIds))],
      })
      const orderedFindings = [...subjectFindings].sort((left, right) => left.order - right.order || left.findingId.localeCompare(right.findingId))
      for (const [findingOrder, finding] of orderedFindings.entries()) {`,
`    for (const [subjectOrder, [sectionKey, subjectFindings]] of orderedSubjects.entries()) {
      const orderedFindings = [...subjectFindings].sort((left, right) => left.order - right.order || left.findingId.localeCompare(right.findingId))
      let findingParentOutlineNodeId: OutlineNodeId = topicNodeId
      if (orderedFindings.length > 1) {
        const subjectNodeId = ledger.resolve('outlineNode', \`section:\${topic.key}:\${sectionKey}\`) as OutlineNodeId
        subjectNodes.push({
          outlineNodeId: subjectNodeId,
          parentOutlineNodeId: topicNodeId,
          kind: 'section',
          title: normalizeString(subjectFindings[0]!.sectionTitle, 'finding.sectionTitle'),
          summary: distinctStrings(subjectFindings.map(finding => finding.keyMessage)).join('；'),
          order: subjectOrder,
          sourceRefs: [sourceRef(frozenProject, subjectFindings.flatMap(finding => finding.objectIds))],
        })
        findingParentOutlineNodeId = subjectNodeId
      }
      for (const [findingOrder, finding] of orderedFindings.entries()) {`,
)

await replaceOnce(
  'src/presentation/standard-project-adapter.ts',
`          parentOutlineNodeId: subjectNodeId,
          kind: 'section',
          title: normalizeString(finding.title, 'finding.title'),
          summary: normalizeString(finding.keyMessage, 'finding.keyMessage'),
          order: findingOrder,`,
`          parentOutlineNodeId: findingParentOutlineNodeId,
          kind: 'section',
          title: normalizeString(finding.title, 'finding.title'),
          summary: normalizeString(finding.keyMessage, 'finding.keyMessage'),
          order: orderedFindings.length > 1 ? findingOrder : subjectOrder,`,
)

await replaceOnce(
  'tests/presentation-standard-outline-content.spec.ts',
`  it('assigns unique sibling order and global page order across multiple report subjects', async () => {
    planner.compile.mockReturnValue([
      finding({ findingId: 'detail-b', sectionKey: 'conditions', sectionTitle: '实施条件' }),
      finding(),
      finding({ findingId: 'detail-a' }),
    ])
    const build = await buildPresentationStandardProject({ frozenProject: createStandardFrozenProject() })
    const outline = build.documents['outline.json'] as any
    const manifest = build.documents['pages/manifest.json'] as any
    const parents = new Map(outline.nodes.map((node: any) => [node.outlineNodeId, node.parentOutlineNodeId]))
    expect(manifest.pages.map((page: any) => page.order)).toEqual([0, 1, 2])
    for (const page of manifest.pages) {
      const subjectId = parents.get(page.outlineNodeId)
      const chapterId = parents.get(subjectId)
      expect(parents.get(chapterId)).toBeNull()
    }
    for (const parentId of new Set(outline.nodes.map((node: any) => node.parentOutlineNodeId))) {
      const siblings = outline.nodes.filter((node: any) => node.parentOutlineNodeId === parentId)
      expect(new Set(siblings.map((node: any) => node.order)).size).toBe(siblings.length)
    }
  })`,
`  it('collapses singleton report subjects while preserving branching subjects and sibling order', async () => {
    planner.compile.mockReturnValue([
      finding({ findingId: 'detail-b', sectionKey: 'conditions', sectionTitle: '实施条件' }),
      finding(),
      finding({ findingId: 'detail-a' }),
    ])
    const build = await buildPresentationStandardProject({ frozenProject: createStandardFrozenProject() })
    const outline = build.documents['outline.json'] as any
    const manifest = build.documents['pages/manifest.json'] as any
    const byId = new Map<string, any>(outline.nodes.map((node: any) => [String(node.outlineNodeId), node] as [string, any]))
    const topicId = build.stableIds['outlineNode:topic:project_brief']
    const singletonLeafId = build.stableIds['outlineNode:finding:detail-b']
    const singletonSubjectId = build.stableIds['outlineNode:section:project_brief:conditions']
    const branchingSubjectId = build.stableIds['outlineNode:section:project_brief:project-task']
    const primaryLeafId = build.stableIds['outlineNode:finding:pre-design:project-brief']
    const siblingLeafId = build.stableIds['outlineNode:finding:detail-a']

    expect(manifest.pages.map((page: any) => page.order)).toEqual([0, 1, 2])
    expect(byId.get(singletonLeafId)?.parentOutlineNodeId).toBe(topicId)
    expect(byId.has(singletonSubjectId)).toBe(false)
    expect(byId.get(branchingSubjectId)?.parentOutlineNodeId).toBe(topicId)
    expect(byId.get(primaryLeafId)?.parentOutlineNodeId).toBe(branchingSubjectId)
    expect(byId.get(siblingLeafId)?.parentOutlineNodeId).toBe(branchingSubjectId)

    for (const parentId of new Set(outline.nodes.map((node: any) => node.parentOutlineNodeId))) {
      const siblings = outline.nodes.filter((node: any) => node.parentOutlineNodeId === parentId)
      expect(new Set(siblings.map((node: any) => node.order)).size).toBe(siblings.length)
    }
  })`,
)

console.log('outline singleton collapse patch completed')
