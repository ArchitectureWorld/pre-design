export interface DirectStartInput {
  readonly projectName: string
  readonly statement: string
  readonly mode?: 'manual' | 'automatic'
  readonly reportDepth?: 'standard' | 'extended'
  readonly visualBudget?: number
}

export interface DirectStartPort {
  readonly executeCommand: (
    line: string,
  ) => Promise<
    | { readonly kind: 'success'; readonly text?: string }
    | { readonly kind: 'error'; readonly text: string }
    | { readonly kind: 'unmatched' }
  >
  readonly prompt: (
    text: string,
  ) => Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }>
}

const MAX_PROJECT_NAME_LENGTH = 48
const WORKSPACE_EMPTY = 'PRE_DESIGN_WORKSPACE_EMPTY'
const WORKSPACE_ATTACHED = 'PRE_DESIGN_WORKSPACE_PROJECT_ATTACHED'

function oneLine(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

export function deriveProjectName(statement: string): string {
  const normalized = oneLine(statement)
  if (normalized.length === 0) return ''
  const withoutPrefix = normalized.replace(/^(?:(?:请|麻烦)(?:帮我)?|帮我)?(?:新建|创建|启动)\s*(?:一个)?\s*/u, '')
  const candidate = withoutPrefix.split(/(?:并(?:完成|开始|进行)?|然后|[，,。；;])/u, 1)[0]?.trim() ?? ''
  return Array.from(candidate).slice(0, MAX_PROJECT_NAME_LENGTH).join('')
}

export function buildDirectUsePrompt(input: DirectStartInput): string {
  const projectName = oneLine(input.projectName)
  const statement = oneLine(input.statement)
  if (projectName.length === 0) throw new Error('请输入项目名称。')
  if (statement.length === 0) throw new Error('请输入项目描述。')
  return [
    `请在当前已绑定的前期策划项目“${projectName}”中完成 v0.6 工作项 01-01 项目身份校准。`,
    `用户原始陈述：${statement}`,
    '严格按当前前期策划系统提示执行：先调用 preplanning_get_context，再根据返回的 projectId/revision 生成一个合法的 PS01 ProposalEnvelope，并将 JSON 对象传给 preplanning_apply_commands。',
    '不要搜索工作区、文件系统或网页中的合同；不要读取合同文件。未知事实使用 unknown、空数组或显式 assumptions，不得捏造。',
    '提案进入 pending_review 后立即停止，不得代替用户确认 Gate；请清楚报告 proposalId 并提示用户在状态卡点击“人工确认提案”。',
  ].join('\n')
}

export async function startDirectPreplanning(port: DirectStartPort, input: DirectStartInput): Promise<void> {
  const projectName = oneLine(input.projectName)
  const prompt = buildDirectUsePrompt({ projectName, statement: input.statement })
  const execute = async (line: string) => {
    const command = await port.executeCommand(line)
    if (command.kind === 'unmatched') throw new Error(`DSH 未找到 ${line.split(' ', 1)[0]}，请确认前期策划插件已加载。`)
    if (command.kind === 'error') throw new Error(command.text)
    return command
  }

  const probe = await execute('/preplan-presentation-sync --probe')
  const existingWorkspaceProject = probe.text?.includes(WORKSPACE_ATTACHED) === true
  const emptyWorkspace = probe.text?.includes(WORKSPACE_EMPTY) === true
  if (!existingWorkspaceProject) {
    if (probe.text !== undefined && !emptyWorkspace) {
      throw new Error(`无法识别工作区探测结果：${probe.text}`)
    }
    await execute(`/preplan-new ${projectName}`)
  }

  try {
    await execute('/preplan-presentation-sync')
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    throw new Error(`前期策划项目已创建或恢复，但 Presentation 标准项目初始化失败：${message}。请修正后直接执行 /preplan-presentation-sync 重试。`)
  }
  if (input.mode !== undefined) {
    const visualBudget = input.visualBudget ?? 8
    if (!Number.isInteger(visualBudget) || visualBudget < 0 || visualBudget > 20) {
      throw new Error('概念图预算上限必须是 0 至 20 的整数。')
    }
    await execute(`/preplan-mode ${input.mode} ${visualBudget} ${input.reportDepth ?? 'standard'}`)
    await execute('/preplan-run')
    return
  }
  const accepted = await port.prompt(prompt)
  if (!accepted.ok) throw new Error(accepted.message)
}
