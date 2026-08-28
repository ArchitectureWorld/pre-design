export function PreplanningBadge() {
  return (
    <span
      aria-label="前期策划插件已加载"
      style={{
        alignItems: 'center',
        background: 'color-mix(in srgb, var(--dsh-color-accent, #3568d4) 12%, transparent)',
        border: '1px solid color-mix(in srgb, var(--dsh-color-accent, #3568d4) 28%, transparent)',
        borderRadius: 999,
        display: 'inline-flex',
        fontSize: 12,
        gap: 6,
        lineHeight: '20px',
        padding: '0 9px',
      }}
    >
      <strong style={{ fontWeight: 600 }}>前期策划</strong>
      <span style={{ opacity: 0.68 }}>已加载</span>
    </span>
  )
}
