/** Explicit v7 photo-coordinate transport only. Native text and receipt hashes
 * remain immutable; the business contract continues to use finite numbers. */
export const PHOTO_DECIMAL_GROUP_VERSION = 'module-author-field-group.v7' as const
export const NARROW_SPATIAL_GROUP_VERSION = 'module-author-field-group.v8' as const
export function decodePhotoDecimal(value: unknown): number {
  if (typeof value !== 'string' || value.length > 220
    || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(value)
    || !Number.isFinite(Number(value))) throw new Error('MODULE_PHOTO_DECIMAL_WIRE: expected exact finite decimal text')
  return Number(value)
}
export function isPhotoDecimalTarget(raw: { projectionVersion?: unknown; groupId?: unknown }, target: { port?: unknown; field?: unknown; at?: unknown }) {
  return (raw.projectionVersion === PHOTO_DECIMAL_GROUP_VERSION || raw.projectionVersion === NARROW_SPATIAL_GROUP_VERSION) && raw.groupId === 'site_use:4.1'
    && target.port === 'site_use' && target.field === 'photoLocation' && (target.at === '/x' || target.at === '/y')
}
