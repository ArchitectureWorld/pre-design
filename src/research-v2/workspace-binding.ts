import type { PresentationProjectBindingRecord } from '../presentation/types.ts'
import type { ResearchWorkspaceBinding } from './regional-command.ts'

/** Research consumes original inputs, not the Presentation files being refreshed. */
export function establishedResearchWorkspace(
  binding: PresentationProjectBindingRecord | undefined,
): ResearchWorkspaceBinding | undefined {
  if (!binding) return undefined
  const root = binding.workspaceRoot ?? binding.directoryRoot
  const refreshing = binding.state === 'creating'
    && Number.isInteger(binding.lastExportedPreDesignRevision)
    && binding.lastExportedPreDesignRevision! >= 0
    && Boolean(binding.lastExportedAt)
    && /^[a-f0-9]{64}$/u.test(binding.lastExportedFileHashes['project.json'] ?? '')
  if ((binding.state !== 'ready' && !refreshing) || !root || !binding.presentationProjectId) return undefined
  // Callers still verify the live root/project identity and frozen source hashes.
  // A prior export is not acceptance of either the current export or the research.
  return { root, standardProjectId: binding.presentationProjectId }
}
