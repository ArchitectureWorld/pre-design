export type PresentationStandardProjectStage =
  | 'preflight'
  | 'staging'
  | 'writing'
  | 'validation'
  | 'commit'
  | 'cleanup'

export class PresentationStandardProjectError extends Error {
  constructor(
    readonly code: string,
    readonly stage: PresentationStandardProjectStage,
    message: string,
    readonly details?: unknown,
    options?: ErrorOptions,
  ) {
    super(`${code}: ${message}`, options)
    this.name = 'PresentationStandardProjectError'
  }
}

export function asPresentationStandardProjectError(
  error: unknown,
  stage: PresentationStandardProjectStage,
): PresentationStandardProjectError {
  if (error instanceof PresentationStandardProjectError) return error
  const message = error instanceof Error ? error.message : String(error)
  return new PresentationStandardProjectError(
    'PRESENTATION_STANDARD_PROJECT_WRITE_FAILED',
    stage,
    message,
    undefined,
    error instanceof Error ? { cause: error } : undefined,
  )
}
