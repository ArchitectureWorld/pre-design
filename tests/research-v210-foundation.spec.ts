import { readFileSync, existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandDefinition } from '@deepseek-ai/dsh-commands'
import { registerPreplanningCommands } from '../src/commands/register.ts'

const implementation = new URL('../src/research-v2/index.ts', import.meta.url)

describe('Pre 2.1.0 approved research foundation', () => {
  it('provides the executable research foundation, not just an HTML plan', () => {
    expect(existsSync(implementation)).toBe(true)
  })
  it('registers a read-only research-plan command through the real DSH entry', () => {
    const definitions: CommandDefinition[] = []
    registerPreplanningCommands({ commands: { register: (d: CommandDefinition) => definitions.push(d) } } as unknown as Context, {
      repository: {}, gateway: {}, governance: {}, runtime: {}, automation: {}, gates: {}, revisions: {}, coordinator: {},
      visual: {}, boundaries: {}, reports: {}, registry: {}, createId: () => 'test', now: () => '2026-09-24T00:00:00Z',
    } as never)
    expect(definitions.some(d => d.name === 'preplan-research-plan')).toBe(true)
  })
  it('versions the development package separately from retained business contracts', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    expect(pkg.version).toBe('2.1.0')
    expect(pkg.files).toContain('contracts/v0.6/**')
  })
})
