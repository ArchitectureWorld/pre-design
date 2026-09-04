import { describe, expect, it } from 'vitest'
import { formatPresentationOperationError } from '../src/presentation/runtime-integration.ts'
import { PresentationStandardProjectError } from '../src/presentation/standard-project-error.ts'

describe('Presentation Workspace migration guidance', () => {
  it('turns the legacy directory guard into a complete one-time recovery instruction', () => {
    const error = new PresentationStandardProjectError(
      'PRE_DESIGN_WORKSPACE_MIGRATION_CONFIRMATION_REQUIRED',
      'preflight',
      "existing standard project is 'C:\\Users\\2899\\.dsh\\presentation-projects\\project-old', explicit --force is required before rebinding to 'D:\\沙潭河'",
      {
        previousDirectoryRoot: 'C:\\Users\\2899\\.dsh\\presentation-projects\\project-old',
        requestedDirectoryRoot: 'D:\\沙潭河',
      },
    )

    const message = formatPresentationOperationError(error)

    expect(message).toContain('PRE_DESIGN_WORKSPACE_MIGRATION_CONFIRMATION_REQUIRED')
    expect(message).toContain('旧版标准项目')
    expect(message).toContain('C:\\Users\\2899\\.dsh\\presentation-projects\\project-old')
    expect(message).toContain('D:\\沙潭河')
    expect(message).toContain('/preplan-presentation-sync --force')
    expect(message).toContain('旧目录不会自动删除')
  })

  it('preserves ordinary error text for unrelated failures', () => {
    expect(formatPresentationOperationError(new Error('schema missing'))).toBe('schema missing')
  })
})
