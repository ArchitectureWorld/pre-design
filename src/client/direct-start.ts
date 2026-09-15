export interface DirectStartInput {
  readonly workspacePath: string
}

export interface DirectStartPort {
  readonly executeCommand: (
    line: string,
  ) => Promise<
    | { readonly kind: 'success'; readonly text?: string }
    | { readonly kind: 'error'; readonly text: string }
    | { readonly kind: 'unmatched' }
  >
}

const MAX_PROJECT_NAME_LENGTH = 48
const WORKSPACE_EMPTY = 'PRE_DESIGN_WORKSPACE_EMPTY'
const WORKSPACE_ATTACHED = 'PRE_DESIGN_WORKSPACE_PROJECT_ATTACHED'
const DEFAULT_AUTOMATIC_VISUAL_BUDGET = 20
const DEFAULT_AUTOMATIC_REPORT_DEPTH = 'standard'

function oneLine(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

/**
 * Derive the default Pre display/project name from the DSH Workspace directory.
 * Workspace identity itself remains the canonical path/project.json binding.
 */
export function deriveWorkspaceProjectName(workspacePath: string): string {
  const normalized = workspacePath.trim().replace(/[\\/]+$/u, '')
  if (normalized.length === 0) return ''
  const candidate = normalized.split(/[\\/]/u).filter(Boolean).at(-1) ?? ''
  return Array.from(oneLine(candidate)).slice(0, MAX_PROJECT_NAME_LENGTH).join('')
}

export async function startDirectPreplanning(port: DirectStartPort, input: DirectStartInput): Promise<void> {
  const workspacePath = input.workspacePath.trim()
  if (workspacePath.length === 0) throw new Error('未检测到当前 DSH 工作区。')
  const projectName = deriveWorkspaceProjectName(workspacePath)
  if (projectName.length === 0) throw new Error('无法从当前 DSH 工作区识别项目名称。')

  const execute = async (line: string) => {
    const command = await port.executeCommand(line)
    if (command.kind === 'unmatched') throw new Error(`DSH 未找到 ${line.split(' ', 1)[0]}，请确认前期策划插件已加载。`)
    if (command.kind === 'error') throw new Error(command.text)
    return command
  }

  // Probe only decides whether this Workspace already owns a Pre project.
  // Presentation materialization is intentionally not a project-creation prerequisite.
  const probe = await execute('/preplan-presentation-sync --probe')
  const existingWorkspaceProject = probe.text?.includes(WORKSPACE_ATTACHED) === true
  const emptyWorkspace = probe.text?.includes(WORKSPACE_EMPTY) === true
  if (!existingWorkspaceProject) {
    if (probe.text !== undefined && !emptyWorkspace) {
      throw new Error(`无法识别工作区探测结果：${probe.text}`)
    }
    await execute(`/preplan-new ${projectName}`)
  }

  // V2.0.1 is automatic-first. These remain internal defaults, not UI choices.
  await execute(`/preplan-mode automatic ${DEFAULT_AUTOMATIC_VISUAL_BUDGET} ${DEFAULT_AUTOMATIC_REPORT_DEPTH}`)
  await execute('/preplan-run')
}
