import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const path = resolve(root, 'research/v2.0.1/source-audit.html')
let html = await readFile(path, 'utf8')

const title = 'V2.0.1 部署测试能力'
if (!html.includes(title)) {
  const marker = '</p></section><section class="chapter">'
  const markerIndex = html.indexOf(marker)
  if (markerIndex < 0) throw new Error('source audit automatic-policy insertion marker not found')
  const insertAt = markerIndex + '</p></section>'.length
  const section = `<section class="automation-policy"><h3>${title}</h3><p><strong>DSH Workflow 主链已接通：</strong>Automatic 模式在进入专业 Subagent Analyzer 前先执行 WorkflowResearchRuntime；Runtime 从当前 Workspace 自动发现结构化 JSON/GeoJSON 中与 ResearchSpec DataPoint 对应的字段，经 WorkspaceResearchProvider → ResearchProviderRouter → ResearchExecutionService → 独立 Evidence Validator 校验。校验不通过时直接记录 <code>blocked_external</code>，不会先让 LLM 猜测。</p><p><strong>当前真实可执行：</strong>Workspace UTF-8 文本/JSON 等项目资料采集；<strong>字段级 Evidence locator</strong>（JSON Pointer / 文本行范围）；完整源文件 SHA-256 + 片段 SHA-256；官方 <code>web_page</code> 直接抓取 Provider；请求域名与最终重定向域名双重白名单；ResearchProviderRouter；ResearchExecutionService；独立 Evidence Validator。</p><p><strong>结果如何留下证据链：</strong>通过中央质量门后，自动 Proposal 会写入由真实 EvidenceRecord 转换的 <code>evidence_refs</code>；专业综合过程生成 <code>AnalysisTrace</code>，并以 <code>research.trace</code> Audit Event 写入 Project State 审计历史。这样部署测试可以从最终 State 反查 Workflow / DataPoint / Source / Locator / Evidence / AnalysisTrace。</p><p><strong>为什么这样做：</strong>把“采集”和“分析”拆开。Provider/Validator 负责证明数据真实存在、来源允许、字段匹配且证据足够；Subagent 只在验证通过后做专业解释与综合，不能靠自报的 evidenceChecks 获得 <code>auto_pass</code>。</p><p><strong>明确委托而不伪装：</strong>PDF / Office / CAD 等二进制内容仍交给 DSH attachment/material extractor；本 Provider 不做假解析或 OCR。需要登录、验证码或当前授权不足的来源记录 <code>blocked_external/source_access_restricted</code>，不绕过访问控制。</p><p><strong>仍未宣称通用自动化：</strong><code>web_search</code> 通用发现器、来源专用公开 API adapter，以及 PDF/Office/CAD material extractor 的统一 Evidence adapter 仍需继续接入。当前 OfficialWebResearchProvider 能对<strong>已经解析出的官方 URL</strong>做可信抓取和定位，但不会虚构“所有 57 项都已经能自动搜索全网”。外部必需来源尚无可执行发现路径时保持 <code>blocked_external</code>。</p></section>`
  html = `${html.slice(0, insertAt)}${section}${html.slice(insertAt)}`
}

await writeFile(path, html)
console.log('PRE_RESEARCH_DEPLOYMENT_READINESS_AUDIT_PASS')
