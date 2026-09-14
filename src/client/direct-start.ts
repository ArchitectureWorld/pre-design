export interface DirectStartInput {
  readonly projectName: string
  readonly statement: string
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

export function deriveProjectName(statement: string): string {
  const normalized = oneLine(statement)
  if (normalized.length === 0) return ''
  const withoutPrefix = normalized.replace(/^(?:(?:请|麻烦)(?:帮我)?|帮我)?(?:新建|创建|启动|对)\s*(?:一个)?\s*/u, '')
  const candidate = withoutPrefix
    .split(/(?:并(?:完成|开始|进行)?|然后|进行(?:一个)?前期策划|做(?:一个)?前期策划|[，,。；;])/u, 1)[0]?.trim() ?? ''
  return Array.from(candidate).slice(0, MAX_PROJECT_NAME_LENGTH).join('')
}

export async function startDirectPreplanning(port: DirectStartPort, input: DirectStartInput): Promise<void> {
  const projectName = oneLine(input.projectName)
  const statement = oneLine(input.statement)
  if (projectName.length === 0) throw new Error('请输入项目名称。')
  if (statement.length === 0) throw new Error('请输入项目描述。')

  const execute = async (line: string) => {
    const command = await port.executeCommand(line)
    if (command.kind === 'unmatched') throw new Error(`DSH 未找到 ${line.split(' ', 1)[0]}，请确认前期策划插件已加载。`)
    if (command.kind === 'error') throw new Error(command.text)
    return command
  }

  // The probe only decides whether this Workspace already owns a Pre project.
  // Presentation materialization is intentionally NOT a project-creation prerequisite.
  const probe = await execute('/preplan-presentation-sync --probe')
  const existingWorkspaceProject = probe.text?.includes(WORKSPACE_ATTACHED) === true
  const emptyWorkspace = probe.text?.includes(WORKSPACE_EMPTY) === true
  if (!existingWorkspaceProject) {
    if (probe.text !== undefined && !emptyWorkspace) {
      throw new Error(`无法识别工作区探测结果：${probe.text}`)
    }
    await execute(`/preplan-new ${projectName}`)
  }

  // V2.0.1 is automatic-first. These are internal defaults, not creation-form choices.
  // Advanced/manual commands remain available as an explicit later override.
  await execute(`/preplan-mode automatic ${DEFAULT_AUTOMATIC_VISUAL_BUDGET} ${DEFAULT_AUTOMATIC_REPORT_DEPTH}`)
  await execute('/preplan-run')
}
