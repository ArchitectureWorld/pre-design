const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const labels = { queued: '等待执行', running: '执行中', cancelling: '正在取消', cancelled: '已取消', completed: '已完成', partial: '有资料缺口', failed: '未完成', interrupted: '中断，需检查', unreviewed: '未经报告审查', idle: '尚未执行' }
const conditions = { industryPlanning: '涉及产业策划', existingBuildings: '存在既有建筑', externalPartners: '涉及外部合作方', marketing: '需要营销策划' }
const chapters = { opportunity: '机会与背景', site: '场地研究', positioning: '项目定位', products: '产品策划', spatial: '空间策略', launch: '启动实施', operation: '运营策划' }
const stages = { 'production-plan': '制定成果计划', 'production-research': '补充成果研究', 'production-write': '撰写成果脚本', 'production-visuals': '生成图像', 'production-layout': '成果排版', 'production-export': '导出成果', 'production-review': '审查成果', write: '撰写章节正文', review: '审查章节正文', revise: '修订章节正文' }

export function mountPlatform({ request, mutate, getProject, getIdentity, notify, onResearch = () => {}, mountAdmin = () => ({ dispose() {} }) }) {
  const container = document.querySelector('.top-right'), controls = document.createElement('div')
  controls.className = 'platform-controls'
  controls.innerHTML = '<button type="button" data-open="research">研究范围</button><button type="button" data-open="tasks">任务与成果</button><button type="button" data-open="chapters">章节生产</button>'
  container?.prepend(controls)
  let dialog, panelProject, panelKind, ticket = 0, currentIdentity, admin, cache, busy = false, returnFocus
  const selected = new Set(), flags = Object.fromEntries(Object.keys(conditions).map(key => [key, 'unknown']))
  const chapterDrafts = new Map()
  let chapterSelected = 'opportunity', chapterStatus = {}, chapterStage = 'production-plan'
  function close() {
    ticket++; panelProject = null; panelKind = null
    dialog?.close?.(); dialog?.remove(); dialog = undefined; returnFocus?.focus?.()
  }
  const active = id => getProject()?.id === id && panelProject === id && dialog?.isConnected
  function begin(kind, title) {
    const project = getProject()
    if (!project?.id) { notify('请先创建或打开项目。'); return }
    close(); returnFocus = document.activeElement; panelProject = project.id; panelKind = kind
    dialog = document.createElement('dialog'); dialog.className = 'platform-dialog'; dialog.dataset.platformDialog = ''; dialog.setAttribute('aria-label', title)
    dialog.innerHTML = `<div class="platform-heading"><div><span class="platform-eyebrow">${escape(project.name ?? '当前项目')}</span><h2>${escape(title)}</h2></div><button type="button" data-action="close" aria-label="关闭">×</button></div><p class="platform-message" role="status"></p><div class="platform-body">正在读取…</div>`
    document.body.append(dialog)
    if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '')
    dialog.querySelector('[data-action="close"]').onclick = close
    dialog.addEventListener('cancel', event => { event.preventDefault(); close() })
    return project.id
  }
  const message = text => { if (dialog) dialog.querySelector('.platform-message').textContent = text }
  async function perform(fn) {
    if (busy) return
    busy = true
    try { await fn() } catch (error) { message(error.message); notify(error.message) } finally { busy = false }
  }
  function saveSelection() {
    if (panelProject) sessionStorage.setItem(`pre-research-${panelProject}`, JSON.stringify({ moduleIds: [...selected], flags }))
    const count = dialog?.querySelector('[data-selected-count]'); if (count) count.textContent = String(selected.size)
    const run = dialog?.querySelector('[data-action="run-research"]'); if (run) run.disabled = !selected.size
  }
  async function openResearch() {
    const id = begin('research', '选择研究范围'); if (!id) return
    const generation = ticket
    try {
      cache = await request(`/projects/${id}/research`)
      if (!active(id) || generation !== ticket) return
      selected.clear()
      for (const key of Object.keys(conditions)) flags[key] = 'unknown'
      try {
        const saved = JSON.parse(sessionStorage.getItem(`pre-research-${id}`) ?? 'null')
        for (const item of saved?.moduleIds ?? []) if (cache.catalog.modules.some(m => m.id === item)) selected.add(item)
        for (const key of Object.keys(conditions)) if ([true, false, 'unknown'].includes(saved?.flags?.[key])) flags[key] = saved.flags[key]
      } catch { /* An invalid local draft never becomes execution configuration. */ }
      renderResearch(); onResearch(cache)
    } catch (error) { if (active(id)) message(error.message) }
  }
  function renderResearch() {
    const { catalog, plan = {} } = cache, byChapter = new Map()
    for (const module of catalog.modules) {
      const id = module.id.split('.')[0]; if (!byChapter.has(id)) byChapter.set(id, []); byChapter.get(id).push(module)
    }
    const names = new Map((catalog.chapters ?? []).map(c => Array.isArray(c) ? c : [String(c.id), c.title ?? c.name]))
    dialog.querySelector('.platform-body').innerHTML = `<p class="platform-description">只执行明确选中的研究模块。可以先用“待确认”检查范围，执行前须选择四项研究条件；这些选择用于界定研究范围，不能替代现场事实核实。缺少上游成果时会提示补充。</p>
      <p class="platform-description" data-service-status></p>
      <div class="platform-conditions">${Object.entries(conditions).map(([key, label]) => `<label>${label}<select data-condition="${key}"><option value="unknown">待确认</option><option value="true">是</option><option value="false">否</option></select></label>`).join('')}</div>
      <div class="platform-scope-actions"><span>已选 <b data-selected-count>${selected.size}</b> 项 / ${catalog.modules.length} 项</span><button type="button" data-action="check-plan">检查条件与依赖</button><button type="button" data-action="add-dependencies">添加提示的依赖</button><button type="button" data-action="clear-scope">清空选择</button></div>
      <div class="platform-modules">${[...byChapter].map(([id, rows]) => `<section><h3>第 ${escape(id)} 章 · ${escape(names.get(id) ?? '研究模块')}</h3>${rows.map(m => {
        const badge = plan.inactiveModuleIds?.includes(m.id) ? '当前不适用' : plan.pendingModuleIds?.includes(m.id) ? '条件待确认' : plan.blockedModuleIds?.includes(m.id) ? '依赖未满足' : '可选择'
        return `<label class="platform-module"><input type="checkbox" data-module="${escape(m.id)}" ${selected.has(m.id) ? 'checked' : ''}><span><b>${escape(m.id)}</b> ${escape(m.title)}</span><small>${badge}</small></label>`
      }).join('')}</section>`).join('')}</div>
      <div class="platform-footer"><label><input type="checkbox" data-redo> 重做所选模块，保留其他成果</label><button type="button" class="primary-btn" data-action="run-research" ${selected.size ? '' : 'disabled'}>开始所选研究 ↗</button></div>`
    renderServiceStatus()
    for (const input of dialog.querySelectorAll('[data-condition]')) { input.value = String(flags[input.dataset.condition]); input.onchange = () => { flags[input.dataset.condition] = input.value === 'unknown' ? 'unknown' : input.value === 'true'; saveSelection() } }
    for (const input of dialog.querySelectorAll('[data-module]')) input.onchange = () => { input.checked ? selected.add(input.dataset.module) : selected.delete(input.dataset.module); saveSelection() }
    dialog.querySelector('[data-action="clear-scope"]').onclick = () => { selected.clear(); saveSelection(); renderResearch() }
    dialog.querySelector('[data-action="check-plan"]').onclick = () => void perform(checkPlan)
    dialog.querySelector('[data-action="add-dependencies"]').onclick = () => void perform(async () => {
      const result = await checkPlan(); if (!result) return
      for (const id of result.selection?.dependencyModuleIds ?? []) selected.add(id)
      saveSelection(); renderResearch(); message('已将提示的依赖加入选择，请检查范围后提交。')
    })
    dialog.querySelector('[data-action="run-research"]').onclick = () => void perform(async () => {
      const id = panelProject, choice = { moduleIds: [...selected].sort(), flags: { ...flags }, redo: !!dialog.querySelector('[data-redo]').checked }
      if (!choice.moduleIds.length) throw new Error('请至少选择一项研究。')
      if (Object.values(choice.flags).some(value => typeof value !== 'boolean')) throw new Error('请先明确四项研究条件，再开始所选研究。')
      await checkPlan(); if (!active(id)) return
      await mutate('research', choice); if (!active(id)) return
      message('任务已提交，可在“任务与成果”查看进度。')
    })
  }
  function renderServiceStatus() {
    const status = dialog?.querySelector('[data-service-status]'), web = cache?.availability?.web
    if (status) status.textContent = web ? `搜索服务：${web.status === 'ready' || web.search === 'configured' ? '已配置，实际连通以搜索结果为准。' : web.reason ?? '尚未配置，请联系管理员。'} 网页原文读取${web.fetch === 'available' ? '可用' : '尚未就绪'}。` : '搜索服务状态尚未提供。'
  }
  async function checkPlan() {
    if (!selected.size) throw new Error('请先选择需要研究的模块。')
    const id = panelProject, result = await request(`/projects/${id}/research/plan`, { method: 'POST', body: { moduleIds: [...selected].sort(), flags: { ...flags } } })
    if (!active(id)) return
    cache = { ...cache, ...result }
    renderServiceStatus()
    const missing = (result.selection?.dependencyModuleIds ?? []).filter(item => !selected.has(item))
    const unresolved = [...(result.plan?.pendingModuleIds ?? []), ...(result.plan?.blockedModuleIds ?? [])].filter(item => selected.has(item))
    message([missing.length ? `所选范围涉及上游依赖：${missing.join('、')}；请确认是否需要加入，已有有效成果可由后端复用。` : '所选范围已检查。', unresolved.length ? `条件或依赖待补充：${unresolved.join('、')}。` : ''].join(' '))
    return result
  }
  async function openTasks() {
    const id = begin('tasks', '任务与成果'); if (!id) return
    renderTasks()
    try { const artifacts = await request(`/projects/${id}/artifacts`); if (active(id)) renderArtifacts(artifacts) } catch (error) { if (active(id)) message(error.message) }
  }
  function renderTasks() {
    const rows = [...(getProject()?.jobs ?? [])].reverse()
    dialog.querySelector('.platform-body').innerHTML = `<div class="platform-task-list">${rows.map(job => `<article class="platform-task"><div><strong>${escape({ research: '模块研究', report: '成果报告', chat: '项目问询', intake: '资料解读', confirm: '确认提案', annotations: '批注修订' }[job.kind] ?? job.kind)}</strong><span>${escape(labels[job.status] ?? job.status)}</span>${['queued', 'running', 'cancelling'].includes(job.status) ? `<button type="button" data-cancel-job="${escape(job.id)}" ${job.status === 'cancelling' ? 'disabled' : ''}>取消任务</button>` : ''}</div><small>${escape(job.created_at ? new Date(job.created_at).toLocaleString('zh-CN') : '')}</small>${job.error ? `<p>${escape(job.error)}</p>` : ''}${job.result?.limitations?.length ? `<p class="platform-limitation">${escape(job.result.limitations.join('；'))}</p>` : ''}${job.result ? `<details><summary>查看执行结果</summary><pre>${escape(JSON.stringify(job.result, null, 2))}</pre></details>` : ''}</article>`).join('') || '<p>尚未提交任务，请先选择研究范围。</p>'}</div><h3>可下载成果</h3><p class="platform-description">下载保留来源和限制说明。研究生成完成不代表报告已通过审阅。</p><div data-artifacts>正在读取…</div><button type="button" data-action="assemble">汇编所选研究成果</button>`
    for (const button of dialog.querySelectorAll('[data-cancel-job]')) button.onclick = () => void perform(async () => {
      const id = panelProject; button.disabled = true
      await request(`/projects/${id}/jobs/${button.dataset.cancelJob}/cancel`, { method: 'POST', body: {} })
      if (active(id)) message('已请求取消；已保存的成果会保留。')
    })
    dialog.querySelector('[data-action="assemble"]').onclick = () => void perform(async () => {
      const saved = JSON.parse(sessionStorage.getItem(`pre-research-${panelProject}`) ?? 'null')
      if (!saved?.moduleIds?.length) throw new Error('请先在研究范围中选择需要汇编的模块。')
      await mutate('reports', { mode: 'research-summary', moduleIds: saved.moduleIds }); message('已提交成果汇编，只使用已保存结果，不重新运行研究。')
    })
  }
  function renderArtifacts(artifacts) {
    const target = dialog?.querySelector('[data-artifacts]'); if (!target) return
    target.innerHTML = (artifacts ?? []).map(a => `<div class="platform-artifact"><div><strong>${escape(a.filename)}</strong><small>${a.kind === 'generated-concept' ? 'AI 概念图 · ' : ''}${escape(labels[a.status] ?? a.status ?? a.kind)} · ${Math.ceil((a.bytes ?? 0) / 1024)} KB</small></div><div>${/\.(md|txt|json)$/iu.test(a.filename) ? `<button type="button" data-preview-artifact="${escape(a.id)}">预览文字</button> ` : ''}<button type="button" data-artifact="${escape(a.id)}">下载</button></div></div>`).join('') || '<p>暂无成果。完成研究后，可下载原始结果或汇编报告。</p>'
    for (const button of target.querySelectorAll('[data-preview-artifact]')) button.onclick = () => void perform(async () => {
      const id = panelProject, file = await request(`/projects/${id}/artifacts/${button.dataset.previewArtifact}`, { download: true })
      const content = await file.blob.text()
      if (!active(id) || !button.isConnected) return
      let preview = button.closest('.platform-artifact').nextElementSibling
      if (!preview?.hasAttribute('data-preview-content')) { preview = document.createElement('pre'); preview.dataset.previewContent = ''; preview.className = 'platform-artifact-preview'; button.closest('.platform-artifact').after(preview) }
      preview.textContent = content.length > 200000 ? content.slice(0, 200000) + '\n\n预览已截断，请下载完整文件。' : content
    })
    for (const button of target.querySelectorAll('[data-artifact]')) button.onclick = () => void perform(async () => {
      const file = await request(`/projects/${panelProject}/artifacts/${button.dataset.artifact}`, { download: true })
      const url = URL.createObjectURL(file.blob), anchor = document.createElement('a'); anchor.href = url; anchor.download = file.filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
    })
  }
  async function openChapters() {
    const id = begin('chapters', '章节生产'); if (!id) return
    chapterStatus = {}; renderChapters()
    try { await refreshChapters(id) } catch (error) { if (active(id)) message(error.message) }
  }
  function captureChapterDraft() {
    if (!dialog?.querySelector('[data-chapter-message]')) return
    chapterDrafts.set(`${panelProject}:${chapterSelected}`, {
      message: dialog.querySelector('[data-chapter-message]').value,
      feedback: dialog.querySelector('[data-chapter-feedback]').value,
      materialIds: [...dialog.querySelectorAll('[data-chapter-material]:checked')].map(input => input.dataset.chapterMaterial),
    })
  }
  async function refreshChapters(id) {
    const status = await request(`/projects/${id}/chapters`)
    if (!active(id) || panelKind !== 'chapters') return
    captureChapterDraft(); chapterStatus = status; renderChapters()
  }
  function renderChapters() {
    const draft = chapterDrafts.get(`${panelProject}:${chapterSelected}`) ?? { message: '', feedback: '', materialIds: [] }
    const current = chapterStatus.chapters?.find(row => row.chapterId === chapterSelected), materials = (getProject()?.materials ?? []).filter(file => file.image)
    const blockers = current?.readiness?.blockers ?? []
    dialog.querySelector('.platform-body').innerHTML = `<p class="platform-description">本章内容取自当前项目资料和你填写的要求。先保存要求与图片，再依次制定计划、补充研究、撰写、排版、导出和审查；保存要求本身不调用模型。</p>
      <div class="platform-conditions"><label>章节<select data-chapter>${Object.entries(chapters).map(([v, name]) => `<option value="${v}" ${v === chapterSelected ? 'selected' : ''}>${name}</option>`).join('')}</select></label><label>本次操作<select data-chapter-stage>${Object.entries(stages).map(([v, name]) => `<option value="${v}" ${v === chapterStage ? 'selected' : ''}>${name}</option>`).join('')}</select></label></div>
      <p class="platform-description" data-chapter-readiness>${current?.prepared ? '本章要求已保存。' : '本章要求尚未保存。'}${current?.briefReady ? '成果计划已生成。' : ''} ${escape(blockers.map(row => row.message).join('；'))}</p>
      <label class="platform-field">本章要求<textarea data-chapter-message rows="3" maxlength="8000" placeholder="说明受众、希望回答的问题和交付形式；仅填写当前项目的要求。">${escape(draft.message)}</textarea></label>
      <label class="platform-field">补充说明或修改意见<textarea data-chapter-feedback rows="2" maxlength="8000" placeholder="可以注明表达重点、已知限制和需要保留的内容。">${escape(draft.feedback)}</textarea></label>
      <h3>选择本章使用的图片资料</h3><p class="platform-description">仅列出当前项目的真实上传图片。图片的地点、时间和用途须有资料依据。</p>
      <div class="platform-chapter-materials">${materials.map(file => `<label class="platform-module"><input type="checkbox" data-chapter-material="${escape(file.id)}" ${draft.materialIds.includes(file.id) ? 'checked' : ''}><span>${escape(file.filename)}</span><small>${file.image.width} × ${file.image.height}</small></label>`).join('') || '<p>尚无图片，请上传本项目的 PNG、JPEG 或 WebP。</p>'}</div>
      <label class="platform-field">添加图片（每张不超过 10 MB）<input type="file" data-chapter-upload accept="image/png,image/jpeg,image/webp" multiple></label>
      <div class="platform-footer"><button type="button" data-action="prepare-chapter">保存本章要求与图片</button><button type="button" class="primary-btn" data-action="run-chapter">提交所选章节任务 ↗</button></div>`
    dialog.querySelector('[data-chapter]').onchange = event => { captureChapterDraft(); chapterSelected = event.target.value; renderChapters() }
    dialog.querySelector('[data-chapter-stage]').onchange = event => { chapterStage = event.target.value }
    dialog.querySelector('[data-action="prepare-chapter"]').onclick = () => void perform(async () => {
      const id = panelProject; captureChapterDraft(); const input = chapterDrafts.get(`${id}:${chapterSelected}`)
      if (input.message.trim().length < 10) throw new Error('请填写本章的具体要求，至少 10 个字。')
      if (!input.materialIds.length) throw new Error('请至少选择一张属于当前项目的图片资料。')
      await mutate('chapters/prepare', { chapterId: chapterSelected, ...input })
      if (!active(id)) return
      await refreshChapters(id); message('本章要求和图片已保存。满足前置条件后，可提交所选章节任务。')
    })
    dialog.querySelector('[data-chapter-upload]').onchange = event => {
      const files = [...event.target.files], id = panelProject; captureChapterDraft()
      void perform(async () => {
        for (const file of files) {
          if (!active(id)) return
          if (file.size > 10 * 1024 * 1024) throw new Error('单张图片不能超过 10 MB。')
          const content = await new Promise((resolve, reject) => { const reader = new window.FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('图片读取失败')); reader.readAsDataURL(file) })
          if (!active(id)) return
          await mutate('materials', { filename: file.name, content })
        }
        if (active(id)) { renderChapters(); message('图片已上传，请选择用于本章的图片并保存要求。') }
      })
    }
    dialog.querySelector('[data-action="run-chapter"]').onclick = () => void perform(async () => {
      const id = panelProject; captureChapterDraft()
      await mutate('reports', { chapterId: chapterSelected, stage: chapterStage })
      if (active(id)) message('章节任务已提交，请在任务与成果中查看结果。')
    })
  }
  controls.querySelector('[data-open="research"]').onclick = () => void openResearch()
  controls.querySelector('[data-open="tasks"]').onclick = () => void openTasks()
  controls.querySelector('[data-open="chapters"]').onclick = () => void openChapters()
  return {
    openResearch, openTasks,
    async authenticated() {
      try { const identity = await getIdentity(); if (currentIdentity?.id === identity.id && currentIdentity?.role === identity.role) return
        currentIdentity = identity; admin?.dispose(); admin = mountAdmin({ request, notify, container, identity })
      } catch { admin?.dispose(); currentIdentity = null }
    },
    onState(project) { if (panelProject && project?.id !== panelProject) close(); else if (panelKind === 'tasks') { renderTasks(); const id = panelProject; void request(`/projects/${id}/artifacts`).then(a => { if (active(id)) renderArtifacts(a) }).catch(error => message(error.message)) } },
    reset: close,
    dispose() { close(); controls.remove(); admin?.dispose() },
  }
}
