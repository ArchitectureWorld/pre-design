import {
  preparePresentationMaterials,
  type PreparedPresentationMaterials,
  type PreparePresentationMaterialsInput,
} from './material-registry.ts'
import { scanWorkspaceSourceInbox } from './source-inbox.ts'

export interface PreparedWorkspacePresentationMaterials extends PreparedPresentationMaterials {
  readonly sourceInboxFileCount: number
  readonly sourceInboxRoot?: string
}

/**
 * Adds the user-owned Workspace `原始资料/` inbox to the existing Presentation
 * material pipeline. Existing canonical copies/registry entries remain valid;
 * current inbox files only add or refresh matching stable source keys.
 */
export async function prepareWorkspacePresentationMaterials(
  input: PreparePresentationMaterialsInput,
): Promise<PreparedWorkspacePresentationMaterials> {
  const prepared = await preparePresentationMaterials(input)
  if (input.workspaceRoot === undefined) {
    return Object.freeze({ ...prepared, sourceInboxFileCount: 0 })
  }

  const inbox = await scanWorkspaceSourceInbox(input.workspaceRoot)
  const sources = new Map(prepared.sourceMaterials.map(source => [source.sourceKey, source] as const))
  for (const source of inbox.sourceMaterials) sources.set(source.sourceKey, source)

  const sourceMaterials = [...sources.values()]
    .sort((left, right) => left.sourceKey.localeCompare(right.sourceKey, 'en-US'))
  const materialWarnings = [...prepared.materialWarnings, ...inbox.warnings]

  return Object.freeze({
    ...prepared,
    sourceMaterials: Object.freeze(sourceMaterials),
    materialWarnings: Object.freeze(materialWarnings),
    sourceInboxFileCount: inbox.sourceMaterials.length,
    sourceInboxRoot: inbox.inboxRoot,
  })
}
