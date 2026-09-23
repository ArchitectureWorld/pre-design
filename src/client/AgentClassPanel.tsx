import { useEffect, useRef, useState } from 'react'
import { AGENT_CLASSES, MAX_CLASS_FALLBACKS, type AgentClassId, type AgentClassView, type CatalogProvider, type ClassFallbacks, type ClassRoutes, type ModelRoute } from '../agent-classes/types.ts'
import { imageToolForRoute } from '../agent-classes/image-tools.ts'
import { GlassIcon } from './GlassIcon.tsx'
import { GlassAction, GlassHelp } from './GlassControls.tsx'
import { ClassExecutionPanel } from './ClassExecutionPanel.tsx'

const routeLabel = (route: ModelRoute | null | undefined) => route ? `${route.provider} / ${route.model}` : '尚未选择模型'
const routeValue = (route: ModelRoute | null) => route ? JSON.stringify([route.provider, route.model]) : ''
const inCatalog = (catalog: readonly CatalogProvider[], route: ModelRoute | undefined) => !!route && catalog.some(p => p.available && p.provider === route.provider && p.models.some(m => m.id === route.model))
const isToolChoice = (provider: string, model: CatalogProvider['models'][number]) => !!model.imageTool || !!imageToolForRoute({ provider, model: model.id })
const companionAvailable = (catalog: readonly CatalogProvider[], route: ModelRoute | undefined) => inCatalog(catalog, route)
  && !catalog.some(p => p.provider === route?.provider && p.models.some(m => m.id === route.model && isToolChoice(p.provider, m)))
const displayRoute = (catalog: readonly CatalogProvider[], route: ModelRoute) => catalog.find(p => p.provider === route.provider)?.models.find(m => m.id === route.model)?.name ?? route.model
const optionName = (catalog: readonly CatalogProvider[], provider: string, model: CatalogProvider['models'][number]) => {
  const ambiguous = catalog.flatMap(p => p.models).filter(m => m.name === model.name).length > 1
  return `${model.name}${imageToolForRoute({provider, model:model.id}) ? ' · ComfyUI' : ambiguous ? ` · ${provider}` : ''}`
}
function CompanionPicker({ label, route, catalog, busy, onChange }: { label: string; route: ModelRoute; catalog: readonly CatalogProvider[]; busy: boolean; onChange: (route: ModelRoute) => void }) {
  if (!imageToolForRoute(route)) return null
  const invalid = !companionAvailable(catalog, route.llm)
  return <select aria-label={label} title={`${label}（必选，支持工具调用） · ${routeLabel(route.llm)}`} aria-invalid={invalid} required disabled={busy} value={routeValue(route.llm ?? null)} onChange={event => {
      const value = event.target.value ? JSON.parse(event.target.value) as [string, string] : null
      const { llm: _previous, ...base } = route
      onChange({ ...base, ...(value ? { llm: { provider: value[0], model: value[1] } } : {}) })
    }} className="pre-select companion-picker">
      <option value="">选择配套 LLM</option>
      {route.llm && !companionAvailable(catalog, route.llm) && <option value={routeValue(route.llm)} disabled>已不可用 · {routeLabel(route.llm)}</option>}
      {catalog.filter(p => p.available).map(p => <optgroup key={p.provider} label={p.name}>
        {p.models.filter(m => !isToolChoice(p.provider, m)).map(m =>
          <option key={m.id} title={`${p.provider} / ${m.id}`} value={routeValue({ provider: p.provider, model: m.id })}>{optionName(catalog, p.provider, m)}</option>)}
      </optgroup>)}
  </select>
}
export async function agentClassRequest(payload: unknown, signal: AbortSignal): Promise<AgentClassView> {
  const response = await fetch('/preplan-agent-classes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error ?? '子 Agent 类配置读取失败。')
  return data
}
interface Props { readonly sessionId?: string; readonly request?: typeof agentClassRequest; readonly onView?: (view: AgentClassView) => void; readonly onReadError?: (message?: string) => void }
export function AgentClassPanel(props: Props) {
  return <AgentClassPanelBody key={props.sessionId ?? 'global'} {...props} />
}
function AgentClassPanelBody({ sessionId, request = agentClassRequest, onView, onReadError }: Props) {
  const [view, setView] = useState<AgentClassView>()
  const [draft, setDraft] = useState<ClassRoutes>({ image: null, web: null, text: null })
  const [fallbacks, setFallbacks] = useState<ClassFallbacks>({})
  const [adding, setAdding] = useState<AgentClassId>()
  const [baseRevision, setBaseRevision] = useState(0)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const dirtyRef = useRef(false)
  const inFlight = useRef(false)
  const lifetime = useRef<AbortController>()
  const panel = useRef<HTMLElement>(null)
  const readRequest = useRef<AbortController>()
  type ReadResult = { data: AgentClassView } | { error: string }
  const deferredRead = useRef<ReadResult>()
  const refreshAfterSelection = useRef(false)
  // Native select popups close when disabled or when their options change. Focus is
  // deliberately conservative: keep the directory stable until the user leaves it.
  const selectingModel = () => document.activeElement instanceof HTMLSelectElement
    && !!panel.current?.contains(document.activeElement)
  const cancelRead = () => { readRequest.current?.abort(); readRequest.current = undefined }
  const accept = (data: AgentClassView, reset = false) => {
    setView(data)
    onView?.(data)
    if (reset || !dirtyRef.current) {
      setDraft(data.settings.routes)
      setFallbacks(data.settings.fallbacks ?? {})
      if (reset) setAdding(undefined)
      setBaseRevision(data.settings.revision)
      dirtyRef.current = false
      setDirty(false)
    }
  }
  const applyRead = (result: ReadResult, reset = false) => {
    if ('data' in result) {
      accept(result.data, reset)
      onReadError?.(undefined)
      setError('')
      if (reset) setMessage('已重新载入配置。')
    } else { setError(result.error); onReadError?.(result.error) }
  }
  const load = async (reset = false, passive = false) => {
    const owner = lifetime.current
    if (!owner || owner.signal.aborted || inFlight.current) return
    if (passive && selectingModel()) { refreshAfterSelection.current = true; return }
    if (passive && readRequest.current) return
    // Only an explicit reload can preempt another read. Never abort a save here.
    cancelRead()
    const controller = new AbortController()
    readRequest.current = controller
    if (!passive) {
      inFlight.current = true; setBusy(true)
      deferredRead.current = undefined; refreshAfterSelection.current = false
    }
    const current = () => !owner.signal.aborted && !controller.signal.aborted && readRequest.current === controller
    const receive = (result: ReadResult) => {
      if (!current()) return
      if (passive && selectingModel()) {
        deferredRead.current = result; refreshAfterSelection.current = true
      } else applyRead(result, reset)
    }
    try {
      const data = await request({ action: 'read', sessionId }, controller.signal)
      receive({ data })
    } catch (cause) {
      receive({ error: cause instanceof Error ? cause.message : '读取失败。' })
    } finally {
      if (current()) {
        readRequest.current = undefined
        if (!passive) { inFlight.current = false; setBusy(false) }
      }
    }
  }
  const finishSelection = () => {
    const owner = lifetime.current
    // Wait for focus to settle; tabbing directly to the paired LLM is still editing.
    queueMicrotask(() => {
      if (!owner || owner.signal.aborted || inFlight.current || selectingModel()) return
      const result = deferredRead.current
      deferredRead.current = undefined
      if (result) applyRead(result)
      if (refreshAfterSelection.current) {
        refreshAfterSelection.current = false
        void load(false, true)
      }
    })
  }
  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    inFlight.current = false
    void load()
    const timer = setInterval(() => void load(false, true), 5000)
    const focus = () => void load(false, true)
    window.addEventListener('focus', focus)
    return () => {
      controller.abort(); cancelRead(); deferredRead.current = undefined; refreshAfterSelection.current = false
      clearInterval(timer); window.removeEventListener('focus', focus)
    }
  }, [sessionId, request, onView, onReadError])
  const save = async () => {
    const controller = lifetime.current
    if (!view || !controller || controller.signal.aborted || inFlight.current) return
    // Read-only polling must not swallow a user's save or overwrite its response.
    cancelRead(); deferredRead.current = undefined; refreshAfterSelection.current = false
    inFlight.current = true
    setBusy(true)
    setMessage('')
    try {
      const data = await request({ action: 'save', sessionId, revision: baseRevision, routes: draft,
        ...(Object.keys(fallbacks).length ? { fallbacks } : {}) }, controller.signal)
      if (controller.signal.aborted) return
      accept(data, true)
      setError('')
      setMessage('已保存，将用于后续新任务。')
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '保存失败。')
    } finally { if (!controller.signal.aborted) { inFlight.current = false; setBusy(false) } }
  }
  const conflict = dirty && view && view.settings.revision !== baseRevision
  const missingCompanion = [...Object.values(draft), ...Object.values(fallbacks).flat()].some(route => route && imageToolForRoute(route)
    && !companionAvailable(view?.catalog ?? [], route.llm))
  const changeFallbacks = (kind: AgentClassId, rows: readonly ModelRoute[]) => {
    setFallbacks(previous => ({ ...previous, [kind]: rows }))
    dirtyRef.current = true; setDirty(true); setMessage('')
  }
  return <section ref={panel} className="settings" aria-label="子 Agent 类配置" aria-busy={busy} onBlurCapture={finishSelection}>
    <header className="settings-heading"><div><h2>子 Agent</h2><span className="section-scope">全局设置</span></div><div className="settings-tools">{view && !dirty && <GlassAction icon="refresh" label="刷新配置" disabled={busy} onClick={() => void load(true)} />}<GlassHelp label="全局配置说明"><p>所有前期策划项目共用这些类别配置，模型与 DSH 设置同步。修改仅影响后续新任务，正在执行的任务保留启动时配置。</p><p>主模型连接失败、限流或服务错误且原调用已终止时，按顺序使用备用模型。失败或结果未知的任务会记录问题，流程继续处理其它可执行任务；主动取消仍然生效。</p></GlassHelp></div></header>
    {error && <div className="pre-alert" role="alert"><p>{error}</p><button className="pre-button" type="button" disabled={busy} onClick={() => void load()}>重试读取配置</button></div>}
    {!view && !error && <p className="pre-muted" role="status">正在读取模型与配置…</p>}
    {view && <>
      <div className="role-list">{AGENT_CLASSES.map(kind => {
        const selected = draft[kind.id] ?? null
        const backups = fallbacks[kind.id] ?? []
        const available = inCatalog(view.catalog, selected ?? undefined) && (!imageToolForRoute(selected) || companionAvailable(view.catalog, selected?.llm))
        const selectedInCatalog = !!selected && view.catalog.some(provider => provider.provider === selected.provider && provider.models.some(model => model.id === selected.model))
        return <article className="role-card" data-kind={kind.id} key={kind.id}>
          <div className="role-identity"><span className="role-icon"><GlassIcon name={kind.id} /></span><label htmlFor={`${sessionId}-${kind.id}`}>{kind.title}</label><GlassHelp label={`${kind.title}说明`}><p>{kind.description}</p>
                {selected && <p className="route-identifier">{routeLabel(selected)}</p>}
                {kind.id === 'image' && <><p>普通生图模型直接生成图片；ComfyUI / Klein 是生图工具，主选项及每个备用选项必须分别配置配套 LLM。</p><p>配套 LLM 负责理解需求并调用 ComfyUI。地址、工作流、模型文件仍在 DSH 的 ComfyUI 插件设置中管理。</p><p>请选择支持工具调用的 LLM；DSH 目录尚未声明这项能力，目录可见不代表已验证出图。</p></>}
                {kind.id === 'review' && <p>请选择支持图片输入的模型；首次审图会执行像素校验，未通过时保留素材缺口。</p>}
              </GlassHelp></div>
          <div className="model-area">
            <div className="model-controls">
              <div className="route-pair" data-paired={!!imageToolForRoute(selected)}>
              <select className="pre-select" title={routeLabel(selected)} id={`${sessionId}-${kind.id}`} aria-label={`${kind.title}模型`} disabled={busy} value={routeValue(selected)} onChange={event => {
                const value = event.target.value ? JSON.parse(event.target.value) as [string, string] : null
                // Promotion keeps the pair already explicitly configured on that same route.
                // Never infer a companion from the parent session or another Agent class.
                const next = value ? [selected, ...backups].find(route => route?.provider === value[0] && route.model === value[1]) ?? { provider:value[0], model:value[1] } : null
                setDraft(previous => ({ ...previous, [kind.id]: next }))
                if (backups.length && (!value || backups.some(route => route.provider === value[0] && route.model === value[1]))) {
                  changeFallbacks(kind.id, value ? backups.filter(route => route.provider !== value[0] || route.model !== value[1]) : [])
                }
                dirtyRef.current = true; setDirty(true); setMessage('')
              }}>
                <option value="">请选择模型</option>
                {selected && !selectedInCatalog && <option value={routeValue(selected)} disabled>已不可用 · {routeLabel(selected)}</option>}
                {view.catalog.filter(provider => provider.models.length > 0).map(provider => <optgroup key={provider.provider} label={`${provider.name} (${provider.provider})${provider.available ? '' : ' · 未启用或不可用'}`}>
                  {provider.models.filter(model => kind.id === 'image' || !isToolChoice(provider.provider, model)).map(model => <option key={model.id} disabled={!provider.available} value={routeValue({ provider: provider.provider, model: model.id })}>{optionName(view.catalog, provider.provider, model)}</option>)}
                </optgroup>)}
              </select>
              {imageToolForRoute(selected) && <span className="route-link" aria-hidden="true"><GlassIcon name="link" /></span>}
            {selected && <CompanionPicker label={`${kind.title}配套 LLM`} route={selected} catalog={view.catalog} busy={busy} onChange={route => {
              setDraft(previous => ({ ...previous, [kind.id]: route })); dirtyRef.current = true; setDirty(true); setMessage('')
            }} />}
              </div>
              {adding !== kind.id && <GlassAction label={`${kind.title}添加备用模型`} icon="plus" className="add-backup" disabled={busy || !selected || backups.length >= MAX_CLASS_FALLBACKS} onClick={() => setAdding(kind.id)} />}

            </div>

            {!available && <small className="pre-warning">{imageToolForRoute(selected) && inCatalog(view.catalog, selected ?? undefined) ? '请选择可用的配套 LLM。' : selected ? '当前主模型不可用，请检查 DSH 设置。' : '请选择模型。'}</small>}
            {backups.map((route, index) => <div className="fallback-row" key={routeValue(route)}>
              <div className="route-pair" data-paired={!!imageToolForRoute(route)}>
                <span className="fallback-name" title={routeLabel(route)}><span className="fallback-number" title={`备用模型 ${index + 1}`}>{index + 1}</span><span className="fallback-route-name">{displayRoute(view.catalog, route)}{inCatalog(view.catalog, route) ? '' : ' · 已不可用'}</span></span>
                {imageToolForRoute(route) && <span className="route-link" aria-hidden="true"><GlassIcon name="link" /></span>}
              <CompanionPicker label={`${kind.title}备用模型${index + 1}配套 LLM`} route={route} catalog={view.catalog} busy={busy} onChange={updated => changeFallbacks(kind.id, backups.map((row, i) => i === index ? updated : row))} />
              </div>
              <div className="fallback-actions">
                <GlassAction icon="up" label={`${kind.title}备用模型${index + 1}上移`} disabled={busy || index === 0} onClick={() => {
                  const rows = [...backups]; [rows[index - 1], rows[index]] = [rows[index]!, rows[index - 1]!]; changeFallbacks(kind.id, rows)
                }} />
                <GlassAction icon="down" label={`${kind.title}备用模型${index + 1}下移`} disabled={busy || index === backups.length - 1} onClick={() => {
                  const rows = [...backups]; [rows[index], rows[index + 1]] = [rows[index + 1]!, rows[index]!]; changeFallbacks(kind.id, rows)
                }} />
                <GlassAction icon="trash" label={`${kind.title}备用模型${index + 1}删除`} disabled={busy} onClick={() => changeFallbacks(kind.id, backups.filter((_, i) => i !== index))} />
              </div>

            </div>)}
            {adding === kind.id && <div className="fallback-picker">
              <select className="pre-select" aria-label={`${kind.title}选择备用模型`} disabled={busy} value="" onChange={event => {
                if (!event.target.value) return
                const [provider, model] = JSON.parse(event.target.value) as [string, string]
                changeFallbacks(kind.id, [...backups, { provider, model }]); setAdding(undefined)
              }}><option value="">请选择备用模型</option>
                {view.catalog.filter(p => p.available).map(p => <optgroup key={p.provider} label={p.name}>
                  {p.models.filter(m => (kind.id === 'image' || !isToolChoice(p.provider, m)) && ![...(selected ? [selected] : []), ...backups].some(r => r.provider === p.provider && r.model === m.id))
                    .map(m => <option key={m.id} value={routeValue({ provider: p.provider, model: m.id })}>{optionName(view.catalog, p.provider, m)}</option>)}
                </optgroup>)}
              </select><GlassAction icon="close" label="取消添加" onClick={() => setAdding(undefined)} />
            </div>}
          </div>
        </article>
      })}</div>
      {view.catalog.some(provider => provider.error) && <details className="provider-details">
        <summary>{view.catalog.filter(provider => provider.error).length} 个服务不可用</summary>
        {view.catalog.filter(provider => provider.error).map(provider => <small key={provider.provider}>{provider.name}：{provider.error}</small>)}
      </details>}
      {conflict && <div className="pre-alert" role="alert">配置已在其他页面更新。请重新载入后编辑。</div>}
      {missingCompanion && <div className="pre-alert" role="alert">请为每个 ComfyUI 主选项及备用选项选择可用的配套 LLM 后保存。</div>}
      {dirty && <div className="save-bar">
        <span className="save-state" data-dirty={dirty} role="status" title={`当前配置版本 ${view.settings.revision}`}>{dirty ? '未保存' : `v${view.settings.revision}`}</span>
        <button className="pre-button pre-primary" type="button" disabled={!dirty || busy || !!conflict || missingCompanion} onClick={() => void save()}>保存配置</button>
        {dirty ? <button className="pre-button discard-action" type="button" aria-label="重新载入（放弃修改）" disabled={busy} onClick={() => void load(true)}>放弃修改</button> : <GlassAction icon="refresh" label="刷新配置" disabled={busy} onClick={() => void load(true)} />}
      </div>}
      {message && <div className="pre-feedback" role="status">{message}</div>}
      <ClassExecutionPanel projectId={view.projectId} executions={view.executions} />
    </>}
  </section>
}
