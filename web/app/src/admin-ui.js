import { DEFAULT_SEARCH_POLICY } from './service-defaults.mjs'

const roleNames = { parent: '父任务', text: '文本生成', web: '网络查询', vision: '图片审查', image: '图像生成', imageLlm: '生图配套 LLM' }
const requiredCapabilities = { parent: ['text', 'tools'], text: ['text', 'tools'], web: ['text', 'tools'], vision: ['text', 'vision'], image: ['image'], imageLlm: ['text', 'tools'] }
const capabilityNames = { text: '文字输入', tools: '工具调用', vision: '图片理解', image: '图像生成' }
const statusNames = { unverified: '待验证', verified: '已验证', unavailable: '不可用' }
const limitNames = { globalConcurrency: '全局并发上限', perUserConcurrency: '每用户并发上限', maxQueuedPerUser: '每用户排队上限', maxDailyJobsPerUser: '每用户每日任务上限' }
const key = model => model ? JSON.stringify([model.provider, model.model]) : ''
const reference = model => model ? { provider: model.provider, model: model.model } : null
const clone = value => JSON.parse(JSON.stringify(value))
const modelName = model => model ? `${model.provider} / ${model.model}` : '未选择'
let nextInstance = 0

export function mountAdminControls({ request, notify = () => {}, container, identity } = {}) {
  if (identity?.role !== 'admin' || !container) return { dispose() {} }
  const document = container.ownerDocument, instance = ++nextInstance
  const create = (tag, className, text) => {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
  }
  const makeButton = (text, action, className = 'pd-admin-button', label = text) => {
    const node = create('button', className, text); node.type = 'button'; node.setAttribute('aria-label', label)
    node.addEventListener('click', action)
    return node
  }
  const labelField = (title, input) => {
    const label = create('label', 'pd-admin-field')
    label.append(create('span', '', title), input)
    return label
  }
  const section = (title, description) => {
    const node = create('section', 'pd-admin-section')
    node.append(create('h3', '', title))
    if (description) node.append(create('p', 'pd-admin-hint', description))
    return node
  }

  let disposed = false, opened = false, draft = null, baseRevision = null, dirty = false, conflict = false
  let loading = false, saving = false, activeTab = 'policy', modelSequence = 0
  const listSequences = { jobs: 0, users: 0 }
  const entry = makeButton('模型管理', open, 'pd-admin-entry')
  entry.setAttribute('aria-haspopup', 'dialog'); entry.setAttribute('aria-expanded', 'false')
  container.append(entry)
  const overlay = create('div', 'pd-admin-overlay'), dialog = create('section', 'pd-admin-dialog')
  dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', `pd-admin-title-${instance}`)
  const header = create('header', 'pd-admin-header'), titles = create('div')
  const title = create('h2', '', '平台模型管理'); title.id = `pd-admin-title-${instance}`
  titles.append(create('p', 'pd-admin-eyebrow', '管理员工作台'), title, create('p', 'pd-admin-hint', '统一设置后续任务使用的模型；已有任务保留其原配置。'))
  const closeButton = makeButton('关闭', close, 'pd-admin-button pd-admin-close', '关闭模型管理')
  header.append(titles, closeButton)
  const tabs = create('nav', 'pd-admin-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', '管理内容')
  const tabButtons = {}, panes = {}, main = create('div', 'pd-admin-content')
  for (const [name, label] of [['policy', '模型策略'], ['jobs', '运行记录'], ['users', '用户账号']]) {
    const tab = makeButton(label, () => switchTab(name), 'pd-admin-tab')
    tab.id = `pd-admin-tab-${instance}-${name}`; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', `pd-admin-pane-${instance}-${name}`)
    const pane = create('div', 'pd-admin-pane'); pane.id = `pd-admin-pane-${instance}-${name}`; pane.setAttribute('role', 'tabpanel'); pane.setAttribute('aria-labelledby', tab.id)
    tabButtons[name] = tab; panes[name] = pane; tabs.append(tab); main.append(pane)
  }
  const notice = create('div', 'pd-admin-notice'); notice.setAttribute('aria-live', 'polite'); notice.hidden = true
  const footer = create('footer', 'pd-admin-footer'), revision = create('span', 'pd-admin-revision')
  revision.dataset.adminRevision = ''; const dirtyText = create('span', 'pd-admin-hint')
  const footerInfo = create('div', 'pd-admin-footer-info'); footerInfo.append(revision, dirtyText)
  const actions = create('div', 'pd-admin-actions')
  const reloadButton = makeButton('重新加载配置', () => loadPolicy(), 'pd-admin-button', '重新加载配置')
  const saveButton = makeButton('保存策略', save, 'pd-admin-button pd-admin-primary')
  actions.append(reloadButton, saveButton); footer.append(footerInfo, actions)
  dialog.append(header, tabs, notice, main, footer); overlay.append(dialog)
  overlay.addEventListener('click', event => { if (event.target === overlay) close() })
  let policyForm = null, editFields = null, routesSection = null

  function setNotice(message = '', isError = false) {
    notice.textContent = message; notice.hidden = !message
    notice.setAttribute('role', isError ? 'alert' : 'status')
    notice.classList.toggle('pd-admin-error', isError)
  }
  function updateState() {
    revision.textContent = baseRevision === null ? '尚未读取配置' : `配置版本 v${baseRevision}`
    dirtyText.textContent = saving ? '正在保存…' : dirty ? '有未保存的修改' : draft ? '修改只影响后续新任务' : ''
    saveButton.disabled = loading || saving || !draft
    reloadButton.disabled = loading || saving
    reloadButton.textContent = conflict ? '重新加载最新配置（丢弃草稿）' : dirty ? '重新加载（丢弃草稿）' : '重新加载配置'
    if (editFields) editFields.disabled = loading || saving
    for (const [name, tab] of Object.entries(tabButtons)) {
      tab.setAttribute('aria-selected', String(activeTab === name)); tab.tabIndex = activeTab === name ? 0 : -1
      panes[name].hidden = activeTab !== name
    }
    actions.hidden = activeTab !== 'policy'
  }
  function changed() { dirty = true; updateState() }
  function open() {
    if (disposed || opened) return
    opened = true; document.body.append(overlay); entry.setAttribute('aria-expanded', 'true')
    document.addEventListener('keydown', onKeyDown); closeButton.focus()
    activeTab = 'policy'; updateState()
    if (!draft || !dirty) void loadPolicy()
  }
  function close() {
    if (!opened) return
    opened = false; overlay.remove(); entry.setAttribute('aria-expanded', 'false')
    document.removeEventListener('keydown', onKeyDown)
    if (!disposed) entry.focus()
  }
  function onKeyDown(event) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const current = Object.values(tabButtons).indexOf(document.activeElement)
      if (current >= 0) {
        const names = Object.keys(tabButtons), index = (current + (event.key === 'ArrowRight' ? 1 : -1) + names.length) % names.length
        event.preventDefault(); switchTab(names[index]); tabButtons[names[index]].focus()
      }
    }
    if (event.key !== 'Tab') return
    const focusable = [...dialog.querySelectorAll('button, input, select, textarea, summary, [tabindex="0"]')].filter(node => {
      const details = node.closest('details')
      return !node.disabled && !node.closest('[hidden]') && !node.closest('fieldset:disabled') && (!details || details.open || node.tagName === 'SUMMARY') && node.tabIndex !== -1
    })
    const first = focusable[0], last = focusable.at(-1)
    if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first?.focus() }
  }
  async function loadPolicy() {
    if (disposed || saving) return
    const sequence = ++modelSequence; loading = true; updateState(); setNotice('正在读取管理员配置…')
    try {
      const received = await request('/admin/models', { method: 'GET' })
      if (disposed || sequence !== modelSequence) return
      draft = clone(received); baseRevision = received.revision; dirty = false; conflict = false
      renderPolicy(); setNotice()
    } catch (error) {
      if (!disposed && sequence === modelSequence) setNotice(error.status === 403 || error.status === 401 ? '管理员会话已失效，请重新登录。' : '配置读取失败，请重新加载。', true)
    } finally { if (!disposed && sequence === modelSequence) { loading = false; updateState() } }
  }
  async function save() {
    if (!draft || loading || saving || disposed) return
    if (!policyForm.reportValidity()) { setNotice('请先检查必填字段与预算格式。', true); return }
    saving = true; updateState(); setNotice('正在保存配置…')
    const body = { expectedRevision: baseRevision, policy: clone(draft) }
    try {
      const received = await request('/admin/models', { method: 'PUT', body })
      if (disposed) return
      draft = clone(received); baseRevision = received.revision; dirty = false; conflict = false
      renderPolicy(); setNotice(`已保存配置版本 v${baseRevision}，后续新任务使用该配置。`)
      notify(`模型策略已保存为 v${baseRevision}`)
    } catch (error) {
      if (disposed) return
      conflict = error.status === 409
      setNotice(conflict ? '配置已被其他管理员更新。当前草稿已保留，请重新加载最新配置后再修改。'
        : error.status === 400 ? `配置未保存：${error.message || '请检查模型、能力和主备分配。'}`
          : error.status === 401 || error.status === 403 ? '管理员会话已失效，当前草稿已保留。' : '保存失败，当前草稿已保留，请稍后重试。', true)
    } finally { if (!disposed) { saving = false; updateState() } }
  }
  function modelFor(value) { return draft.models.find(model => key(model) === value) }
  function compatible(model, role, fallback = false) {
    if (model.status === 'unavailable' || (fallback && model.status !== 'verified')) return false
    return requiredCapabilities[role].every(capability => capability === 'tools' && !fallback && model.status !== 'verified' || model.capabilities[capability])
  }
  function readiness(role) {
    const selected = modelFor(key(draft.routes[role].primary))
    if (!selected) return '未选择主模型'
    if (selected.status !== 'verified') return role === 'image' ? '图像未就绪' : statusNames[selected.status] || '待验证'
    if (!requiredCapabilities[role].every(capability => selected.capabilities[capability])) return '能力待补充'
    if (draft.routes[role].fallbacks.some(candidate => {
      const model = modelFor(key(candidate)); return !model || !compatible(model, role, true)
    })) return '备用待调整'
    if (role === 'image' && [draft.routes.image.primary, ...draft.routes.image.fallbacks].some(model => model?.provider === 'Comfyui-PIC')) {
      if (!selected.imageConfig?.baseURL) return '图像未就绪：缺少服务地址'
      const llm = modelFor(key(draft.routes.imageLlm.primary))
      if (!llm || llm.status !== 'verified' || !llm.capabilities.text || !llm.capabilities.tools) return '图像未就绪：配套 LLM 待验证'
      if (draft.routes.imageLlm.fallbacks.length) return '图像未就绪：请清空配套 LLM 备用链'
    }
    return '已就绪'
  }
  function modelSelect(role, selected, fallback = false, used = new Set()) {
    const select = create('select', 'pd-admin-input'), current = key(selected)
    if (!fallback) { const empty = create('option', '', '暂不选择'); empty.value = ''; select.append(empty) }
    const options = draft.models.filter(model => compatible(model, role, fallback) && (!used.has(key(model)) || key(model) === current))
    if (current && !options.some(model => key(model) === current)) {
      const option = create('option', '', `${modelName(selected)} · 当前配置需调整`); option.value = current; select.append(option)
    }
    for (const model of options) {
      const option = create('option', '', `${modelName(model)} · ${statusNames[model.status]}`); option.value = key(model); select.append(option)
    }
    select.value = current
    return select
  }
  function renderRoutes() {
    const focusedLabel = routesSection.contains(document.activeElement) ? document.activeElement.getAttribute('aria-label') : null
    routesSection.replaceChildren(create('h3', '', '角色与主备顺序'), create('p', 'pd-admin-hint', '主模型可以先登记为待验证；备用只列出已验证且匹配能力的模型，按从上到下的顺序调用。网络查询还需在下方配置独立搜索服务。'))
    const grid = create('div', 'pd-admin-route-grid')
    for (const [role, title] of Object.entries(roleNames)) {
      const route = draft.routes[role], card = create('section', 'pd-admin-route'); card.dataset.adminRole = role
      const heading = create('div', 'pd-admin-row'), state = readiness(role)
      const badge = create('span', `pd-admin-badge ${state === '已就绪' ? 'pd-admin-ready' : 'pd-admin-pending'}`, state)
      heading.append(create('h4', '', title), badge); card.append(heading)
      const primary = modelSelect(role, route.primary); primary.setAttribute('aria-label', `${title}主模型`)
      primary.addEventListener('change', () => {
        route.primary = reference(modelFor(primary.value))
        route.fallbacks = route.primary ? route.fallbacks.filter(item => key(item) !== primary.value) : []
        changed(); renderRoutes()
      })
      card.append(labelField('主模型', primary))
      const list = create('ol', 'pd-admin-fallbacks')
      for (const [index, candidate] of route.fallbacks.entries()) {
        const row = create('li', 'pd-admin-fallback-row'), used = new Set([key(route.primary), ...route.fallbacks.map(key)])
        const select = modelSelect(role, candidate, true, used); select.setAttribute('aria-label', `${title}备用模型 ${index + 1}`)
        select.addEventListener('change', () => { route.fallbacks[index] = reference(modelFor(select.value)); changed(); renderRoutes() })
        const up = makeButton('上移', () => {
          if (!index) return
          ;[route.fallbacks[index - 1], route.fallbacks[index]] = [route.fallbacks[index], route.fallbacks[index - 1]]
          changed(); renderRoutes()
        }, 'pd-admin-icon-button', `${title}备用模型 ${index + 1} 上移`)
        up.disabled = index === 0
        const remove = makeButton('移除', () => { route.fallbacks.splice(index, 1); changed(); renderRoutes() }, 'pd-admin-icon-button', `${title}备用模型 ${index + 1} 移除`)
        row.append(select, up, remove); list.append(row)
      }
      card.append(list)
      const used = new Set([key(route.primary), ...route.fallbacks.map(key)])
      const available = draft.models.filter(model => compatible(model, role, true) && !used.has(key(model)))
      const add = makeButton('添加备用', () => { route.fallbacks.push(reference(available[0])); changed(); renderRoutes() }, 'pd-admin-add', `${title}添加备用`)
      add.disabled = !route.primary || !available.length
      card.append(add)
      if (!available.length) card.append(create('small', 'pd-admin-hint', '暂无其他已验证且匹配能力的备用模型'))
      if (role === 'imageLlm') card.append(create('small', 'pd-admin-hint', 'Flux3 生图当前只使用主选配套 LLM，备用链须留空；提交结果未知时保留收执供核对。'))
      grid.append(card)
    }
    routesSection.append(grid)
    if (focusedLabel) [...routesSection.querySelectorAll('[aria-label]')].find(node => node.getAttribute('aria-label') === focusedLabel)?.focus()
  }
  function inputField(model, property, label, { number = false, required = false, placeholder = '' } = {}) {
    const input = create('input', 'pd-admin-input'); input.type = number ? 'number' : 'text'
    input.value = model[property] ?? ''; input.required = required; input.placeholder = placeholder
    input.setAttribute('aria-label', `${modelName(model)} ${label}`)
    if (number) { input.min = '1'; input.step = '1'; input.max = String(Number.MAX_SAFE_INTEGER) }
    else { input.autocomplete = 'off'; input.spellcheck = false }
    if (property === 'credentialRef') { input.pattern = 'credential:[\\p{L}\\p{N}][\\p{L}\\p{N}_.\\-]{0,127}'; input.title = '仅填写 credential: 开头的凭据标识，不填写密钥。' }
    input.addEventListener('input', () => {
      if (!input.value && !required) delete model[property]
      else model[property] = number ? Number(input.value) : input.value
      changed()
    })
    return labelField(label, input)
  }
  function renderCatalog() {
    const catalog = section(`模型目录 · ${draft.models.length} 项`, '仅在完成真实模型调用与能力验证后选择“已验证”。勾选能力不会代替实际调用验证。凭据栏只填写已登记的引用，禁止填写密钥。')
    for (const model of draft.models) {
      const card = create('details', 'pd-admin-model'); card.dataset.adminModel = key(model)
      const summary = create('summary', 'pd-admin-model-summary')
      const name = create('span'); name.append(create('strong', '', model.model), create('small', 'pd-admin-hint', model.source || model.provider))
      const badge = create('span', `pd-admin-badge ${model.status === 'verified' ? 'pd-admin-ready' : 'pd-admin-pending'}`, statusNames[model.status])
      summary.append(name, badge)
      const fields = create('div', 'pd-admin-model-fields')
      fields.append(inputField(model, 'runtimeProvider', '运行提供方', { required: true }), inputField(model, 'credentialRef', '凭据引用', { placeholder: 'credential:已登记标识' }))
      const status = create('select', 'pd-admin-input'); status.setAttribute('aria-label', `${modelName(model)} 验证状态`)
      for (const [value, label] of Object.entries(statusNames)) { const option = create('option', '', label); option.value = value; status.append(option) }
      status.value = model.status
      status.addEventListener('change', () => {
        model.status = status.value; badge.textContent = statusNames[status.value]
        badge.className = `pd-admin-badge ${status.value === 'verified' ? 'pd-admin-ready' : 'pd-admin-pending'}`
        changed(); renderRoutes()
      })
      fields.append(labelField('验证状态', status), inputField(model, 'contextWindow', '上下文预算', { number: true, required: model.contextWindow !== undefined, placeholder: '由适配器发现' }),
        inputField(model, 'maxOutputTokens', '输出预算', { number: true, required: model.maxOutputTokens !== undefined, placeholder: model.capabilities.image ? '图像后端不适用' : '由适配器发现' }))
      const capabilityGroup = create('fieldset', 'pd-admin-capabilities'); capabilityGroup.append(create('legend', '', '已核对的能力'))
      for (const [capability, label] of Object.entries(capabilityNames)) {
        const checkbox = create('input'); checkbox.type = 'checkbox'; checkbox.checked = model.capabilities[capability]
        checkbox.setAttribute('aria-label', `${modelName(model)} ${label}`)
        checkbox.addEventListener('change', () => { model.capabilities[capability] = checkbox.checked; changed(); renderRoutes() })
        const wrapper = create('label'); wrapper.append(checkbox, create('span', '', label)); capabilityGroup.append(wrapper)
      }
      const declared = Object.entries(model.declaredCapabilities || {}).filter(([, value]) => value).map(([capability]) => capabilityNames[capability]).join('、')
      const hint = create('p', 'pd-admin-hint', `交接声明：${declared || '无明确声明'}；实际验证状态以上方选项为准。`)
      if (model.compat?.maxTokensField) hint.append(create('span', '', ` 兼容字段：${model.compat.maxTokensField}（保持原值）。`))
      if (model.imageConfig?.modelFile) {
        hint.append(create('span', '', ` 模型文件：${model.imageConfig.modelFile}。文生图与参考图编辑使用已登记的工作流版本；填写服务地址不会自动标记为已验证。`))
        const address = create('input', 'pd-admin-input'); address.type = 'url'; address.value = model.imageConfig.baseURL ?? ''; address.placeholder = 'http://主机地址:8188'
        address.setAttribute('aria-label', 'ComfyUI 服务地址'); address.autocomplete = 'off'; address.spellcheck = false
        address.addEventListener('input', () => { if (address.value) model.imageConfig.baseURL = address.value; else delete model.imageConfig.baseURL; changed(); renderRoutes() })
        fields.append(labelField('ComfyUI 服务地址', address))
        hint.append(create('span', '', ` 工作流：${model.imageConfig.textToImageWorkflow ?? '未登记'} / ${model.imageConfig.referenceImageWorkflow ?? '未登记'}。无鉴权服务可留空凭据引用。`))
      }
      card.append(summary, fields, capabilityGroup, hint); catalog.append(card)
    }
    return catalog
  }
  function renderSearch() {
    draft.search ??= { ...DEFAULT_SEARCH_POLICY }
    const search = draft.search, panel = section('独立搜索服务', '直接检索真实网页来源，不额外调用问答模型。配置随任务版本保存；服务地址与凭据引用仅管理员可见。'), grid = create('div', 'pd-admin-limits')
    const provider = create('select', 'pd-admin-input'); provider.setAttribute('aria-label', '搜索服务')
    for (const [id, name] of [['exa', 'Exa（无需密钥）'], ['bing', 'Bing（无需密钥）'], ['ddg', 'DuckDuckGo（无需密钥）'], ['deepseek-search-api', 'DeepSeek Search API']]) {
      const option = create('option', '', name); option.value = id; provider.append(option)
    }
    provider.value = search.provider
    provider.addEventListener('change', () => {
      const { enabled, maxResults, maxQueries, timeoutMs } = search
      draft.search = { enabled, provider: provider.value, maxResults, maxQueries, timeoutMs,
        ...(provider.value === 'deepseek-search-api' ? { baseURL: DEFAULT_SEARCH_POLICY.baseURL } : {}) }
      changed(); panel.replaceWith(renderSearch())
    })
    panel.append(labelField('搜索服务', provider))
    const enabled = create('input'); enabled.type = 'checkbox'; enabled.checked = search.enabled; enabled.setAttribute('aria-label', '启用独立搜索')
    enabled.addEventListener('change', () => { search.enabled = enabled.checked; changed() }); panel.append(labelField('启用独立搜索', enabled))
    for (const [name, label, options] of [
      ...(search.provider === 'deepseek-search-api' ? [
        ['baseURL', '搜索服务地址', { type: 'url', required: true }],
        ['credentialRef', '搜索凭据引用', { type: 'text', placeholder: 'credential:已登记标识' }],
      ] : []),
      ['maxResults', '每次搜索结果上限', { type: 'number', min: 1, max: 50 }],
      ['maxQueries', '每轮搜索次数上限', { type: 'number', min: 1, max: 8 }],
      ['timeoutMs', '搜索超时（毫秒）', { type: 'number', min: 1000, max: 120000 }],
    ]) {
      const input = create('input', 'pd-admin-input'); Object.assign(input, options); input.value = search[name] ?? ''; input.setAttribute('aria-label', label); input.autocomplete = 'off'
      if (options.type === 'number') { input.step = '1'; input.required = true }
      if (name === 'credentialRef') { input.pattern = 'credential:[\\p{L}\\p{N}][\\p{L}\\p{N}_.\\-]{0,127}'; input.title = '只填写凭据引用，不填写密钥。' }
      input.addEventListener('input', () => { if (!input.value && name === 'credentialRef') delete search[name]; else search[name] = options.type === 'number' ? Number(input.value) : input.value; changed() })
      grid.append(labelField(label, input))
    }
    panel.append(grid, create('p', 'pd-admin-hint', ['ddg', 'bing', 'exa'].includes(search.provider)
      ? '通过选定服务检索，无需密钥。验证码、网络失败或不可用时会明确返回状态，不自动换引擎。'
      : '支持 DeepSeek Search API 协议。未启用或凭据缺失时会显示具体原因；不会切换到其他账号或模型代替搜索。'))
    return panel
  }
  function renderPolicy() {
    policyForm = create('form', 'pd-admin-form'); policyForm.addEventListener('submit', event => { event.preventDefault(); void save() })
    policyForm.addEventListener('invalid', event => { const details = event.target.closest('details'); if (details) details.open = true }, true)
    editFields = create('fieldset', 'pd-admin-edit-fields'); editFields.append(create('legend', 'pd-admin-sr-only', '模型策略配置'))
    routesSection = create('section', 'pd-admin-section'); renderRoutes()
    const limits = section('任务限制', '限制由服务端执行；更改后应用于新任务的配置与调度。'), grid = create('div', 'pd-admin-limits')
    for (const [name, label] of Object.entries(limitNames)) {
      const input = create('input', 'pd-admin-input'); input.type = 'number'; input.min = '1'; input.max = String(Number.MAX_SAFE_INTEGER); input.step = '1'; input.required = true
      input.value = draft.limits[name]; input.setAttribute('aria-label', label)
      input.addEventListener('input', () => { draft.limits[name] = Number(input.value); changed() })
      grid.append(labelField(label, input))
    }
    limits.append(grid); editFields.append(routesSection, renderSearch(), renderCatalog(), limits); policyForm.append(editFields)
    panes.policy.replaceChildren(policyForm); updateState()
  }
  function switchTab(name) {
    activeTab = name; updateState()
    if (name !== 'policy') void loadList(name)
  }
  function executionDetails(job) {
    const details = create('details', 'pd-admin-execution'); details.append(create('summary', '', '实际调用记录'))
    const metadata = job.execution_metadata
    const requests = Array.isArray(metadata?.parent?.requests) ? metadata.parent.requests : []
    const executions = Array.isArray(metadata?.executions) ? metadata.executions : []
    const searches = Array.isArray(metadata?.search) ? metadata.search : []
    const images = Array.isArray(metadata?.images) ? metadata.images : []
    if (!requests.length && !executions.length && !searches.length && !images.length) {
      details.append(create('p', 'pd-admin-hint', '实际调用、预算、用量与备用切换：未记录。'))
      return details
    }
    // The current trace producer records request identities, but does not emit budgets,
    // usage receipts or fallback decisions. A policy candidate is not evidence for those.
    details.append(create('p', 'pd-admin-hint', '预算、用量与备用切换：未记录。以下内容仅来自已保存的请求或执行记录。'))
    function callCard(title, actual, evidence) {
      const card = create('section', 'pd-admin-call'); card.append(create('h4', '', title))
      const models = create('div', 'pd-admin-call-model')
      models.append(create('p', '', `实际提供方：${typeof actual?.provider === 'string' ? actual.provider : '未记录'}`),
        create('p', '', `实际模型：${typeof actual?.model === 'string' ? actual.model : '未记录'}`))
      card.append(models, create('p', 'pd-admin-hint', `记录来源：${{ 'request/header': '请求头', 'native-request-header': '原生请求头' }[evidence] || '未记录'}`))
      return card
    }
    for (const [index, request] of requests.entries()) {
      const card = callCard(`父任务请求 ${index + 1}`, request, request.evidence)
      const context = []
      if (typeof request.sessionId === 'string') context.push(`会话 ${request.sessionId}`)
      for (const [name, label] of [['seq', '记录序号'], ['turn', '轮次'], ['step', '步骤']]) {
        if (Number.isFinite(request[name])) context.push(`${label} ${request[name]}`)
      }
      if (typeof request.time === 'number' && Number.isFinite(new Date(request.time).getTime())) context.push(new Date(request.time).toLocaleString('zh-CN'))
      if (context.length) card.append(create('p', 'pd-admin-hint', context.join(' · ')))
      details.append(card)
    }
    if (!requests.length) details.append(create('p', 'pd-admin-hint', '父任务实际请求：未记录。'))
    for (const execution of executions) {
      const role = roleNames[execution.classId] || (execution.classId === 'review' ? '图片审查' : '子任务')
      const card = callCard(`${role}执行`, execution.actual, execution.evidence)
      const status = { running: '执行中', succeeded: '成功', completed: '完成', failed: '失败', cancelled: '已取消', interrupted: '结果待核对' }[execution.status] || '未记录'
      const context = [`执行状态：${status}`]
      if (typeof execution.executionId === 'string') context.push(`执行 ID：${execution.executionId}`)
      if (typeof execution.childId === 'string') context.push(`子任务：${execution.childId}`)
      if (typeof execution.startedAt === 'string' && Number.isFinite(Date.parse(execution.startedAt))) context.push(`开始：${new Date(execution.startedAt).toLocaleString('zh-CN')}`)
      card.append(create('p', 'pd-admin-hint', context.join(' · '))); details.append(card)
    }
    for (const row of searches) {
      const card = create('section', 'pd-admin-call')
      card.append(create('h4', '', '独立搜索'), create('p', '', `服务：${{ exa: 'Exa', bing: 'Bing', ddg: 'DuckDuckGo', 'deepseek-search-api': 'DeepSeek Search API' }[row.provider] ?? '未记录'}`),
        create('p', '', `状态：${{ started: '开始尝试', succeeded: '已返回', failed: '失败' }[row.phase] ?? '未知'}`))
      if (Number.isInteger(row.sourceCount)) card.append(create('p', '', `返回来源：${row.sourceCount} 条`))
      if (row.code) card.append(create('p', 'pd-admin-hint', row.code))
      details.append(card)
    }
    for (const row of images) {
      const card = create('section', 'pd-admin-call'); card.append(create('h4', '', 'Flux3 图像收执'))
      card.append(create('p', '', `状态：${{ completed: '已取得图片', preparing: '准备中', dispatching: '提交中，待核对', submission_unknown: '提交结果未知', submitted: '已提交，待核对', failed: '失败' }[row.state] ?? '待核对'}`))
      if (row.promptId) card.append(create('p', 'pd-admin-hint', `ComfyUI 任务编号：${row.promptId}`))
      if (row.workflow) card.append(create('p', 'pd-admin-hint', `工作流：${row.workflow.workflowId} · ${row.workflow.workflowVersion} · ${row.workflow.workflowSha256}`))
      if (row.output) card.append(create('p', '', `图片：${row.output.width} × ${row.output.height}`))
      if (row.errorCode) card.append(create('p', 'pd-admin-hint', row.errorCode))
      details.append(card)
    }
    return details
  }
  async function loadList(name) {
    const sequence = ++listSequences[name], pane = panes[name]
    pane.replaceChildren(create('p', 'pd-admin-hint', '正在读取…'))
    try {
      const records = await request(`/admin/${name}`, { method: 'GET' })
      if (disposed || sequence !== listSequences[name]) return
      const wrapper = section(name === 'jobs' ? '最近运行记录' : '用户账号', name === 'jobs' ? '实际调用取自执行记录，保存的主备路由仅表示候选配置。最多显示 200 条任务。' : '角色与禁用状态以数据库为准；此窗口不显示访问令牌。')
      wrapper.append(makeButton('刷新列表', () => loadList(name), 'pd-admin-button'))
      if (!Array.isArray(records) || records.length === 0) wrapper.append(create('p', 'pd-admin-hint', '暂无记录。'))
      else if (name === 'users') {
        const table = create('table', 'pd-admin-table'), head = create('thead'), headRow = create('tr')
        for (const label of ['账号', '角色', '状态']) headRow.append(create('th', '', label))
        head.append(headRow); table.append(head)
        const body = create('tbody')
        for (const user of records) {
          const row = create('tr'); row.append(create('td', '', user.id), create('td', '', user.role === 'admin' ? '管理员' : '普通用户'), create('td', '', user.disabled ? '已禁用' : '已启用')); body.append(row)
        }
        table.append(body); wrapper.append(table)
      } else {
        for (const job of records) {
          const card = create('article', 'pd-admin-job'), row = create('div', 'pd-admin-row')
          const status = { queued: '排队中', running: '执行中', completed: '已完成', partial: '部分完成', failed: '失败', cancelled: '已取消', interrupted: '结果待核对', recovered: '已恢复' }[job.status] || String(job.status || '未知')
          row.append(create('strong', '', job.id), create('span', 'pd-admin-badge', status)); card.append(row)
          card.append(create('p', 'pd-admin-hint', `账号：${job.owner_id || '—'} · 类型：${job.kind || '—'} · 配置版本：${job.policy_revision ?? '未记录'}`))
          if (job.created_at) card.append(create('p', 'pd-admin-hint', `创建时间：${new Date(job.created_at).toLocaleString('zh-CN')}`))
          card.append(executionDetails(job))
          if (typeof job.error === 'string' && job.error) card.append(create('p', 'pd-admin-job-error', `任务错误：${job.error}`))
          const details = create('details'), summary = create('summary', '', '查看保存的候选路由（不代表实际调用）'), list = create('ul', 'pd-admin-job-routes')
          for (const [role, label] of Object.entries(roleNames)) {
            const route = job.routes?.[role]
            if (route) list.append(create('li', '', `${label}：${[route.primary, ...(Array.isArray(route.fallbacks) ? route.fallbacks : [])].filter(Boolean).map(modelName).join(' → ') || '未选择'}`))
          }
          details.append(summary, list); card.append(details); wrapper.append(card)
        }
      }
      pane.replaceChildren(wrapper)
    } catch (error) {
      if (disposed || sequence !== listSequences[name]) return
      const message = create('p', 'pd-admin-error', error.status === 403 || error.status === 401 ? '管理员会话已失效，请重新登录。' : '读取失败，请重试。'); message.setAttribute('role', 'alert')
      pane.replaceChildren(message, makeButton('重新读取', () => loadList(name)))
    }
  }
  updateState()
  return { dispose() {
    if (disposed) return
    disposed = true; modelSequence++; listSequences.jobs++; listSequences.users++
    close(); document.removeEventListener('keydown', onKeyDown); overlay.remove(); entry.remove()
  } }
}
