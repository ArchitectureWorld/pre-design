import { useEffect, useId, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { PRE_DESIGN_VERSION } from '../version.ts'
import { APPEARANCE_KEY, GLASS_THEMES, isDarkGlass, isStrongGlass, restoreAppearance, themeAppearance, type GlassAppearance } from './glass-appearance.ts'
import { installGlassOptics } from './glass-optics.ts'
import { GLASS_STYLES } from './glass-styles.ts'
import { INLINE_GLASS_STYLES } from './glass-inline-styles.ts'
import { GlassAction, GlassHelp } from './GlassControls.tsx'
import { GlassIcon } from './GlassIcon.tsx'

export function LiquidGlassShell({ children }: { readonly children: ReactNode }) {
  const [appearance, setAppearance] = useState<GlassAppearance>(() => {
    try { return restoreAppearance(localStorage.getItem(APPEARANCE_KEY)) } catch { return themeAppearance() }
  })
  const [open, setOpen] = useState(false), [grid, setGrid] = useState(false)
  const [persisted, setPersisted] = useState(true)
  const root = useRef<HTMLDivElement>(null), toggle = useRef<HTMLButtonElement>(null), close = useRef<HTMLButtonElement>(null)
  const unique = `pre-glass-${useId().replace(/[^a-zA-Z0-9-]/g, '')}`
  const optics = useRef<ReturnType<typeof installGlassOptics>>()
  const initial = useRef(appearance)
  useEffect(() => {
    if (!root.current) return
    optics.current = installGlassOptics(root.current, unique, initial.current)
    return () => { optics.current?.destroy(); optics.current = undefined }
  }, [unique])
  useEffect(() => {
    optics.current?.sync(appearance)
    if (!appearance.motion) root.current?.querySelectorAll<HTMLElement>('.pre-button').forEach(button => { button.style.removeProperty('--px'); button.style.removeProperty('--py') })
    try { localStorage.setItem(APPEARANCE_KEY, JSON.stringify(appearance)); setPersisted(true) } catch { setPersisted(false) }
  }, [appearance])
  useEffect(() => { if (open) close.current?.focus() }, [open])
  const dismiss = () => { setOpen(false); toggle.current?.focus() }
  const highlight = (event: MouseEvent<HTMLDivElement>) => {
    if (!appearance.motion || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const button = event.target instanceof Element ? event.target.closest<HTMLElement>('.pre-button') : null
    if (!button || !root.current?.contains(button)) return
    const bounds = button.getBoundingClientRect()
    if (!bounds.width || !bounds.height) return
    button.style.setProperty('--px', `${Math.max(0, Math.min(100, (event.clientX - bounds.left) / bounds.width * 100))}%`)
    button.style.setProperty('--py', `${Math.max(0, Math.min(100, (event.clientY - bounds.top) / bounds.height * 100))}%`)
  }
  const strong = isStrongGlass(appearance.theme)
  const style = { '--blur': `${appearance.blur}px`, '--gloss': appearance.gloss / 100, '--lift': `${(strong ? 9 : 6) + appearance.lift * .17}px`, '--hover': `${-(strong ? 8 : 4) * appearance.lift / 100}px` } as CSSProperties
  return <div className="pre-glass" ref={root} onMouseMove={highlight} style={style} data-theme={isDarkGlass(appearance.theme) ? 'dark' : 'light'} data-depth={strong ? 'strong' : 'restrained'} data-treatment={appearance.theme} data-motion={appearance.motion ? 'on' : 'off'} data-grid={grid ? 'on' : 'off'}>
    <style>{GLASS_STYLES}{INLINE_GLASS_STYLES}</style>
    <div className="pre-stage"><div className="pre-ambient" aria-hidden="true" />
      <div className="workspace">
        <header className="titlebar">
          <div className="brand"><span className="brand-mark" aria-hidden="true" /><strong>Pre-Design DSH</strong></div>
          <div className="theme-switch" role="group" aria-label="液态玻璃主题">
            {GLASS_THEMES.map(theme => <button key={theme.id} type="button" aria-label={theme.label} title={theme.label} aria-pressed={appearance.theme === theme.id} onClick={() => setAppearance({ ...themeAppearance(theme.id), motion: appearance.motion })}><b>{theme.id.toUpperCase()}</b></button>)}
          </div>
          <button ref={toggle} className="pre-button icon-action appearance-trigger" type="button" aria-label="外观" title="外观" aria-expanded={open} aria-controls={`${unique}-appearance`} onClick={() => open ? dismiss() : setOpen(true)}><GlassIcon name="settings" /></button>
        </header>
        <div className="workspace-body">{children}</div>
        {open && <section className="appearance-panel" role="region" aria-label="外观设置" id={`${unique}-appearance`} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); dismiss() } }}>
          <header className="appearance-heading"><strong>外观</strong><button className="pre-button icon-action" type="button" ref={close} aria-label="关闭外观设置" title="关闭外观设置" onClick={dismiss}><GlassIcon name="close" /></button></header>
          <div className="appearance-context"><span>液态玻璃</span><GlassHelp label="外观说明"><p>只调整本界面，不改变模型配置或正在执行的任务。C 与 A、D 与 B 使用相同面板参数。</p><p>折射为屏幕空间视觉模拟，不是物理折射率；不支持时保留磨砂与厚度效果，文字不参与扭曲。</p></GlassHelp></div>
          {([{ key: 'refraction', label: '折射强度', max: 100 }, { key: 'blur', label: '磨砂程度', max: 36 }, { key: 'gloss', label: '亮面高光', max: 100 }, { key: 'lift', label: '悬浮层次', max: 100 }] as const).map(({ key, label, max }) => <div key={key} className="appearance-row"><span><label htmlFor={`${unique}-${key}`}>{label}</label><output htmlFor={`${unique}-${key}`}>{appearance[key]}{key === 'blur' ? ' px' : '%'}</output></span><input id={`${unique}-${key}`} aria-label={label} type="range" min="0" max={max} value={appearance[key]} onChange={event => setAppearance(previous => ({ ...previous, [key]: Number(event.target.value) }))} /></div>)}
          <label className="appearance-motion">动态光影<input type="checkbox" checked={appearance.motion} onChange={event => setAppearance(previous => ({ ...previous, motion: event.target.checked }))} /></label>
          <div className="appearance-footer"><button className="pre-button" type="button" aria-pressed={grid} onClick={() => setGrid(!grid)}>折射观察网格</button><GlassAction icon="refresh" label="还原外观" onClick={() => setAppearance(themeAppearance(appearance.theme))} /></div>
          {!persisted && <p className="pre-warning" role="status">浏览器未允许保存外观，本次调整仍然有效。</p>}
        </section>}
        <footer className="workspace-footer"><span>Pre {PRE_DESIGN_VERSION} · Project Format 0.1.0</span></footer>
      </div>
    </div>
  </div>
}
