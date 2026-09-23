import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react'
import { GlassIcon } from './GlassIcon.tsx'

/** Short, icon-led actions keep their complete accessible and hover labels. */
export function GlassAction({ label, icon, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { readonly label: string; readonly icon: string }) {
  return <button {...props} type={props.type ?? 'button'} className={`pre-button icon-action ${className}`} aria-label={label} title={label}><GlassIcon name={icon} /></button>
}

/** Nonmodal help is explicitly available by click/touch/keyboard, not hover only. */
export function GlassHelp({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [placement, setPlacement] = useState({above:false, maxHeight:380})
  const id = useId(), root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])
  const place = () => {
    const rect = trigger.current?.getBoundingClientRect()
    if (!rect) return
    const boundary = root.current?.closest('.appearance-panel,.pre-glass')?.getBoundingClientRect()
    const above = Math.max(0, rect.top - Math.max(0, boundary?.top ?? 0) - 16)
    const below = Math.max(0, Math.min(window.innerHeight, boundary?.bottom ?? window.innerHeight) - rect.bottom - 16)
    setPlacement({above:below < 360 && above > below, maxHeight:Math.max(80, Math.min(380, below < 360 && above > below ? above : below))})
  }
  return <div ref={root} className="pre-help" data-above={placement.above} style={{'--help-max-height':`${placement.maxHeight}px`} as CSSProperties} onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.stopPropagation(); setOpen(false); trigger.current?.focus() }
  }}>
    <button type="button" ref={trigger} className="help-trigger" aria-label={label} title={label} aria-expanded={open} aria-controls={id} onClick={() => { if (!open) place(); setOpen(!open) }}><GlassIcon name="info" /></button>
    {open && <div id={id} className="help-popover" role="region" aria-label={label}>{children}</div>}
  </div>
}
