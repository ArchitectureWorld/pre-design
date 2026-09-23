/** UI preferences only. Never send these values to the model-route API. */
export type GlassTheme = 'a' | 'b' | 'c' | 'd'
export interface GlassAppearance {
  theme: GlassTheme
  refraction: number
  blur: number
  gloss: number
  lift: number
  motion: boolean
}
export const APPEARANCE_KEY = 'pre-design:glass-appearance:v1'
export const GLASS_THEMES = [
  { id: 'a', label: 'A · 浅色克制' },
  { id: 'b', label: 'B · 浅色强液态' },
  { id: 'c', label: 'C · 深色克制' },
  { id: 'd', label: 'D · 深色强液态' },
] as const
export const isStrongGlass = (theme: GlassTheme) => theme === 'b' || theme === 'd'
export const isDarkGlass = (theme: GlassTheme) => theme === 'c' || theme === 'd'
export function themeAppearance(theme: GlassTheme = 'c'): GlassAppearance {
  return { theme, ...(isStrongGlass(theme)
    ? { refraction: 82, blur: 15, gloss: 100, lift: 96 }
    : { refraction: 36, blur: 21, gloss: 86, lift: 72 }), motion: true }
}
export function restoreAppearance(raw: string | null): GlassAppearance {
  try {
    const value = JSON.parse(raw ?? 'null') as Partial<GlassAppearance> | null
    if (!value || !GLASS_THEMES.some(theme => theme.id === value.theme)) return themeAppearance()
    const result = themeAppearance(value.theme)
    for (const key of ['blur', 'refraction', 'gloss', 'lift'] as const) {
      const n = value[key]
      if (typeof n === 'number' && Number.isFinite(n)) result[key] = Math.max(0, Math.min(key === 'blur' ? 36 : 100, n))
    }
    if (typeof value.motion === 'boolean') result.motion = value.motion
    return result
  } catch { return themeAppearance() }
}
