const missing = () => { throw Object.assign(new Error('找不到这条批注引用的内容或版本，请重新选择。'), {statusCode:409}) }

// Notes on a published document stay attached to that exact version, including historical drafts.
export async function verifyAnnotationTarget(query, project, anchor, ref) {
  if (ref?.workflowDraftId) {
    const [draft] = await query('SELECT outline_version,document FROM workflow_drafts WHERE project_id=$1 AND id=$2', [project.id, ref.workflowDraftId])
    const block = draft?.document.blocks.find(block => block.id === ref.blockId)
    if (!block || draft.outline_version !== ref.outlineVersion || (ref.itemId && !block.items?.some(item => item.id === ref.itemId))) missing()
    if (ref.visualId || ref.pageId) {
      if (!ref.visualId || !ref.itemId || anchor !== ref.pageId) missing()
      const [deck] = await query('SELECT document FROM workflow_visuals WHERE project_id=$1 AND id=$2 AND draft_id=$3', [project.id, ref.visualId, ref.workflowDraftId])
      if (!deck?.document.pages.some(page => page.id === anchor && page.itemId === ref.itemId && page.blockId === ref.blockId)) missing()
    } else if (anchor !== (ref.itemId ?? ref.blockId)) missing()
    return
  }
  if (ref?.visualId || ref?.itemId || ref?.blockId) missing()
  if (anchor === 'project' && ref) return
  const section = /^outline-(\d{2})-([1-9]\d*)$/.exec(anchor), chapterId = section?.[1] ?? /^chapter-(\d{2})$/.exec(anchor)?.[1]
  if (chapterId) {
    if (!ref?.outlineVersion) missing()
    const [row] = await query('SELECT draft,planning FROM outline_versions WHERE project_id=$1 AND version=$2', [project.id, ref.outlineVersion])
    const chapter = row?.draft.chapters.find(chapter => chapter.id === chapterId)
    if (!chapter || (section && !chapter.tasks[Number(section[2])-1]) || (ref.planningRevision != null && ref.planningRevision !== row.planning?.revision)) missing()
    return
  }
  if (!/^(PS|PA|PD|PR)\d{2}$/.test(anchor) && !project.state.stateObjects?.some(object => object.objectId === anchor))
    throw Object.assign(new Error('批注目标不在本项目中。'), {statusCode:400})
}
