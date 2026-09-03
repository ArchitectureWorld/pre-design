import {
  PRE_DESIGN_VERSION,
  PRESENTATION_PROJECT_FORMAT_VERSION,
} from '../version.ts'

export function VersionFooter() {
  return (
    <small
      aria-label="前期策划版本"
      style={{
        fontSize: 10,
        justifySelf: 'center',
        letterSpacing: '0.02em',
        opacity: 0.5,
        textAlign: 'center',
      }}
    >
      Pre {PRE_DESIGN_VERSION} · Project Format {PRESENTATION_PROJECT_FORMAT_VERSION}
    </small>
  )
}
