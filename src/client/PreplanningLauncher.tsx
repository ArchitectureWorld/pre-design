import { useState } from 'react'
import { createPortal } from 'react-dom'
import type { DirectStartInput } from './direct-start.ts'
import { PreplanningProjectForm } from './PreplanningProjectForm.tsx'

export interface PreplanningLauncherProps {
  readonly start: (input: DirectStartInput) => Promise<void>
}

export function PreplanningLauncher({ start }: PreplanningLauncherProps) {
  const [open, setOpen] = useState(false)

  return (
    <div style={{ position: 'relative' }}>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(value => !value)}
        style={{
          alignItems: 'center',
          background: 'color-mix(in srgb, var(--dsh-color-accent, #3568d4) 12%, transparent)',
          border: '1px solid color-mix(in srgb, var(--dsh-color-accent, #3568d4) 32%, transparent)',
          borderRadius: 999,
          color: 'inherit',
          cursor: 'pointer',
          display: 'inline-flex',
          fontSize: 12,
          fontWeight: 600,
          lineHeight: '22px',
          padding: '0 10px',
        }}
        type="button"
      >
        前期策划
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <PreplanningProjectForm onClose={() => setOpen(false)} start={start} />,
        document.body,
      )}
    </div>
  )
}
