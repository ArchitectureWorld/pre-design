export interface PreplanningLauncherProps {
  readonly openPanel: () => void
}

/** Session-level shortcut into the Workspace-scoped Pre panel. */
export function PreplanningLauncher({ openPanel }: PreplanningLauncherProps) {
  return (
    <button
      onClick={openPanel}
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
  )
}
