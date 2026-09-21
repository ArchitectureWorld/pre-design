import { useEffect, useRef, useState } from 'react'
import { AGENT_CLASSES, MAX_CLASS_FALLBACKS, type AgentClassId, type AgentClassView, type CatalogProvider, type ClassFallbacks, type ClassRoutes, type ModelRoute } from '../agent-classes/types.ts'
import { imageToolForRoute } from '../agent-classes/image-tools.ts'

const routeLabel = (route: ModelRoute | null | undefined) => route ? `${route.provider} / ${route.model}` : '尚未选择模型'
const routeValue = (route: ModelRoute | null) => route ? JSON.stringify([route.provider, route.model]) : ''
const inCatalog = (catalog: readonly CatalogProvider[], route: ModelRoute | undefined) => !!route && catalog.some(p => p.available && p.provider === route.provider && p.models.some(m => m.id === route.model))
function CompanionPicker({ label, route, catalog, busy, onChange }: { label: string; route: ModelRoute; catalog: readonly CatalogProvider[]; busy: boolean; onChange: (route: ModelRoute) => void }) {
  if (!imageToolForRoute(route)) return null
  return <label style={{ display: 'grid', gap: 6, width: '100%' }}>{label}（必选）
    <select aria-label={label} required disabled={busy} value={routeValue(route.llm ?? null)} onChange={event => {
      const value = event.target.value ? JSON.parse(event.target.value) as [string, string] : null
      const { llm: _previous, ...base } = route
      onChange({ ...base, ...(value ? { llm: { provider: value[0], model: value[1] } } : {}) })
    }} style={{ padding: 8, borderRadius: 6, width: '100%', background: 'var(--dsh-color-background, Canvas)', color: 'inherit' }}>
      <option value="">请选择支持工具调用的 LLM</option>
      {route.llm && !inCatalog(catalog, route.llm) && <option value={routeValue(route.llm)} disabled>已不可用 · {routeLabel(route.llm)}</option>}
      {catalog.filter(p => p.available).map(p => <optgroup key={p.provider} label={p.name}>
        {p.models.filter(m => !m.imageTool && !imageToolForRoute({ provider: p.provider, model: m.id })).map(m =>
          <option key={m.id} value={routeValue({ provider: p.provider, model: m.id })}>{m.name} · {p.provider} / {m.id}</option>)}
      </optgroup>)}
    </select>
    <small style={{ opacity: 0.7 }}>LLM 负责理解需求并调用 ComfyUI，ComfyUI 负责生成图片。配套模型来自 DSH 设置。</small>
  </label>
}
export async function agentClassRequest(payload: unknown, signal: AbortSignal): Promise<AgentClassView> {
  const response = await fetch('/preplan-agent-classes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error ?? '子 Agent 类配置读取失败。')
  return data
}
interface Props { readonly sessionId?: string; readonly request?: typeof agentClassRequest; readonly onView?: (view: AgentClassView) => void }
export function AgentClassPanel(props: Props) {
  return <AgentClassPanelBody key={props.sessionId ?? 'global'} {...props} />
}
function AgentClassPanelBody({ sessionId, request = agentClassRequest, onView }: Props) {
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
  const load = async (reset = false) => {
    const controller = lifetime.current
    if (!controller || controller.signal.aborted || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    try {
      const data = await request({ action: 'read', sessionId }, controller.signal)
      if (controller.signal.aborted) return
      accept(data, reset)
      setError('')
      if (reset) setMessage('已重新载入配置。')
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '读取失败。')
    } finally { if (!controller.signal.aborted) { inFlight.current = false; setBusy(false) } }
  }
  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    inFlight.current = false
    void load()
    const timer = setInterval(() => void load(), 5000)
    const focus = () => void load()
    window.addEventListener('focus', focus)
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener('focus', focus) }
  }, [sessionId, request, onView])
  const save = async () => {
    const controller = lifetime.current
    if (!view || !controller || inFlight.current) return
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
    && (!route.llm || imageToolForRoute(route.llm) || !inCatalog(view?.catalog ?? [], route.llm)))
  const changeFallbacks = (kind: AgentClassId, rows: readonly ModelRoute[]) => {
    setFallbacks(previous => ({ ...previous, [kind]: rows }))
    dirtyRef.current = true; setDirty(true); setMessage('')
  }
  return <section aria-label="子 Agent 类配置" style={{ padding: 20, display: 'grid', gap: 14, borderTop: '1px solid color-mix(in srgb, currentColor 18%, transparent)' }}>
    <div><strong>子 Agent 类 · 全局设置</strong><p style={{ fontSize: 13, margin: '6px 0', opacity: 0.8 }}>所有前期策划项目共用这些类别配置，模型与 DSH 设置同步。修改仅影响后续新任务，正在执行的任务保留启动时配置。</p></div>
    {error && <div role="alert">{error}</div>}
    {!view && !error && <span>正在读取模型与配置…</span>}
    {view && <>
      {AGENT_CLASSES.map(kind => {
        const selected = draft[kind.id] ?? null
        const backups = fallbacks[kind.id] ?? []
        const effective = selected
        const available = inCatalog(view.catalog, effective ?? undefined) && (!imageToolForRoute(effective) || inCatalog(view.catalog, effective?.llm))
        const selectedInCatalog = !!selected && view.catalog.some(provider => provider.provider === selected.provider && provider.models.some(model => model.id === selected.model))
        return <div key={kind.id} style={{ display: 'grid', gap: 6 }}>
          <label htmlFor={`${sessionId}-${kind.id}`}><strong>{kind.title}</strong> <small style={{ opacity: 0.7 }}>{kind.description}</small></label>
          <select id={`${sessionId}-${kind.id}`} aria-label={`${kind.title}模型`} disabled={busy} value={routeValue(selected)} onChange={event => {
            const value = event.target.value ? JSON.parse(event.target.value) as [string, string] : null
            setDraft(previous => ({ ...previous, [kind.id]: value ? { provider: value[0], model: value[1] } : null }))
            if (backups.length && (!value || backups.some(route => route.provider === value[0] && route.model === value[1]))) {
              changeFallbacks(kind.id, value ? backups.filter(route => route.provider !== value[0] || route.model !== value[1]) : [])
            }
            dirtyRef.current = true; setDirty(true); setMessage('')
          }} style={{ padding: 8, borderRadius: 6, width: '100%', background: 'var(--dsh-color-background, Canvas)', color: 'inherit' }}>
            <option value="">请选择模型</option>
            {selected && !selectedInCatalog && <option value={routeValue(selected)} disabled>已不可用 · {routeLabel(selected)}</option>}
            {view.catalog.filter(provider => provider.models.length > 0).map(provider => <optgroup key={provider.provider} label={`${provider.name} (${provider.provider})${provider.available ? '' : ' · 未启用或不可用'}`}>
              {provider.models.filter(model => kind.id === 'image' || !model.imageTool).map(model => <option key={model.id} disabled={!provider.available} value={routeValue({ provider: provider.provider, model: model.id })}>{model.name} · {model.id}{model.imageTool ? ' · 工具，需配套 LLM' : ''}</option>)}
            </optgroup>)}
          </select>
          {selected && <CompanionPicker label={`${kind.title}配套 LLM`} route={selected} catalog={view.catalog} busy={busy} onChange={route => {
            setDraft(previous => ({ ...previous, [kind.id]: route })); dirtyRef.current = true; setDirty(true); setMessage('')
          }} />}
          {!available && <small style={{ color: '#ba5c20' }}>当前主模型不可用。{backups.length ? '任务将依次检查已配置的备用模型。' : '请检查 DSH 设置或添加备用模型。'}</small>}
          {backups.map((route, index) => <div key={routeValue(route)} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <span>备用 {index + 1}：{routeLabel(route)}{view.catalog.some(p => p.available && p.provider === route.provider && p.models.some(m => m.id === route.model)) ? '' : ' · 已不可用'}</span>
            <button type="button" aria-label={`${kind.title}备用模型${index + 1}上移`} disabled={busy || index === 0} onClick={() => {
              const rows = [...backups]; [rows[index - 1], rows[index]] = [rows[index]!, rows[index - 1]!]; changeFallbacks(kind.id, rows)
            }}>上移</button>
            <button type="button" aria-label={`${kind.title}备用模型${index + 1}下移`} disabled={busy || index === backups.length - 1} onClick={() => {
              const rows = [...backups]; [rows[index], rows[index + 1]] = [rows[index + 1]!, rows[index]!]; changeFallbacks(kind.id, rows)
            }}>下移</button>
            <button type="button" aria-label={`${kind.title}备用模型${index + 1}删除`} disabled={busy} onClick={() => changeFallbacks(kind.id, backups.filter((_, i) => i !== index))}>删除</button>
            <CompanionPicker label={`${kind.title}备用模型${index + 1}配套 LLM`} route={route} catalog={view.catalog} busy={busy}
              onChange={updated => changeFallbacks(kind.id, backups.map((row, i) => i === index ? updated : row))} />
          </div>)}
          {adding === kind.id ? <div style={{ display: 'flex', gap: 8 }}>
            <select aria-label={`${kind.title}选择备用模型`} disabled={busy} value="" onChange={event => {
              if (!event.target.value) return
              const [provider, model] = JSON.parse(event.target.value) as [string, string]
              changeFallbacks(kind.id, [...backups, { provider, model }]); setAdding(undefined)
            }}><option value="">请选择备用模型</option>
              {view.catalog.filter(p => p.available).map(p => <optgroup key={p.provider} label={p.name}>
                {p.models.filter(m => (kind.id === 'image' || !m.imageTool) && ![...(selected ? [selected] : []), ...backups].some(r => r.provider === p.provider && r.model === m.id))
                  .map(m => <option key={m.id} value={routeValue({ provider: p.provider, model: m.id })}>{m.name} · {p.provider} / {m.id}{m.imageTool ? ' · 工具，需配套 LLM' : ''}</option>)}
              </optgroup>)}
            </select><button type="button" onClick={() => setAdding(undefined)}>取消添加</button>
          </div> : <button type="button" aria-label={`${kind.title}添加备用模型`} disabled={busy || !selected || backups.length >= MAX_CLASS_FALLBACKS} onClick={() => setAdding(kind.id)} style={{ justifySelf: 'start' }}>添加备用模型</button>}
          {kind.id === 'review' && <small style={{ opacity: 0.7 }}>请选择支持图片输入的模型；首次审图会执行像素校验，未通过时保留素材缺口。</small>}
          {kind.id === 'image' && <small style={{ opacity: 0.7 }}>普通生图模型直接生成图片；ComfyUI 等工具型选项必须同时配置配套 LLM。</small>}
        </div>
      })}
      <small style={{ opacity: 0.7 }}>主模型连接失败、限流或服务错误且原调用已终止时，按顺序使用备用模型。失败或结果未知的任务会记录问题，流程继续处理其它可执行任务；主动取消仍然生效。</small>
      {view.catalog.some(provider => provider.error) && <details>
        <summary style={{ fontSize: 12, opacity: 0.7 }}>{view.catalog.filter(provider => provider.error).length} 个 Provider 未启用或暂不可用，可在 DSH 设置中管理</summary>
        {view.catalog.filter(provider => provider.error).map(provider => <small style={{ display: 'block' }} key={provider.provider}>{provider.name}：{provider.error}</small>)}
      </details>}
      {conflict && <div role="alert">配置已在其他页面更新。请重新载入后编辑。</div>}
      {missingCompanion && <div role="alert">请为每个 ComfyUI 主选项及备用选项选择可用的配套 LLM 后保存。</div>}
      <div style={{ display: 'flex', gap: 10 }}>
        <button type="button" disabled={!dirty || busy || !!conflict || missingCompanion} onClick={() => void save()}>保存配置</button>
        <button type="button" disabled={busy} onClick={() => void load(true)}>{dirty ? '重新载入（放弃修改）' : '刷新配置'}</button>
      </div>
      {message && <div role="status">{message}</div>}
    </>}
  </section>
}
