import { readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const researchRoot = resolve(root, 'research/v2.0.1')
const files = (await readdir(researchRoot))
  .filter(name => /^workflow-research-specs.*\.json$/u.test(name))
  .sort()

const replacements = new Map([
  ['由项目用户补充或确认真正需要支持的决定、使用场景和决策主体。', '读取当前项目已有的用户陈述，用于补充决策目标、使用场景和决策主体；缺失时保持 unknown/assumption，不形成强制交互节点。'],
  ['获取项目用户的决策确认', '读取当前项目中的决策目标陈述'],
  ['形成决策任务解释并提交人工确认', '形成可执行决策任务并自动进入下游'],
  ['正式材料与当前决策主体陈述冲突时必须保留冲突并要求确认。', '正式材料与当前决策主体陈述冲突时必须保留冲突并标记 evidence_conflict，不静默覆盖。'],
  ['决策问题在委托目标、决策主体或成果用途改变时立即重新确认。', '决策问题在委托目标、决策主体或成果用途改变时自动重算并生成新 Revision。'],
  ['允许保留多个候选决策问题，但在 G1 前必须由实际决策人或授权负责人选定或改写。', '允许保留多个候选决策问题；系统按证据充分度选择当前工作假设并显式标记 assumption，无法消解的来源冲突标记 evidence_conflict；用户可随时 override/edit。'],
  ['在正式范围尚未完整时记录项目用户确认的研究范围、排除项和时间尺度。', '读取当前项目已有的研究范围、排除项和时间尺度陈述；正式范围缺失时保持 provisional。'],
  ['记录项目方确认的研究边界', '读取当前项目中的研究边界陈述'],
  ['按正式边界优先、授权确认次之的规则合并研究范围，并保持 provisional/confirmed 状态。', '按正式边界优先、项目陈述次之的证据等级合并研究范围，并保持 provisional/confirmed 数据状态。'],
  ['由项目发起人补全真实权责关系', '读取当前项目中的权责关系陈述'],
  ['材料记录与项目发起人确认的决策权冲突时必须人工澄清。', '材料记录与项目陈述的决策权冲突时标记 evidence_conflict，不自动覆盖。'],
  ['组织架构、决策人或跨部门关系变化后重新确认。', '组织架构、决策人或跨部门关系变化后自动重算并生成新 Revision。'],
  ['由最终成果使用者或项目发起人确认真实用途、受众和深度。', '读取当前项目已有的成果用途、受众和深度陈述；缺失时保持 unknown/assumption，不形成强制交互节点。'],
  ['确认真实成果用途与使用者', '读取当前项目中的成果用途与使用者陈述'],
  ['成果使用者未确认时保留限制，不假设评审口径。', '成果使用者信息缺失时保留限制，不假设评审口径。'],
  ['用途未定时只采用内部初步决策的最小深度，并把用途确认列为 G1 前置条件。', '用途未定时自动采用内部初步决策的最小深度并标记 assumption；获得新信息后自动重算，用户可随时 override/edit。'],
  ['确认资料可得性、补充责任、已知未上传资料和无法取得事项。', '读取已知资料可得性、补充责任、未上传资料和无法取得事项；缺失信息保持 unknown。'],
  ['确认未上传资料与补充责任', '读取已知未上传资料与补充责任信息'],
  ['按来源权威等级、现行状态和生效时间合并适用条件；冲突项保留并进入人工裁决。', '按来源权威等级、现行状态和生效时间合并适用条件；冲突项保留并标记 evidence_conflict，不静默择一。'],
  ['采用当地/同类指标必须绑定真实来源、可比条件和不确定区间，否则进入 blocked_external/needs_human。', '采用当地/同类指标必须绑定真实来源、可比条件和不确定区间，否则进入 blocked_external/quality_unresolved/evidence_conflict。'],
])

function transform(value) {
  if (typeof value === 'string') return replacements.get(value) ?? value
  if (Array.isArray(value)) return value.map(transform)
  if (value !== null && typeof value === 'object') {
    const output = {}
    for (const [key, item] of Object.entries(value)) output[key] = transform(item)
    return output
  }
  return value
}

for (const name of files) {
  const path = resolve(researchRoot, name)
  const original = JSON.parse(await readFile(path, 'utf8'))
  const document = transform(original)
  for (const workflow of document.workflows ?? []) {
    for (const source of workflow.preferredSources ?? []) {
      if (source.sourceId === 'dsh-user-statement') source.required = false
    }
  }
  const serialized = `${JSON.stringify(document, null, 2)}\n`
  if (/(?:提交人工确认|必须人工澄清|人工(?:确认|审批|审核|复核|澄清|裁决)|blocked_external\/needs_human)/u.test(serialized)) {
    throw new Error(`${name} still contains mandatory-human workflow semantics after correction`)
  }
  await writeFile(path, serialized)
  console.log(`corrected ${name}`)
}
