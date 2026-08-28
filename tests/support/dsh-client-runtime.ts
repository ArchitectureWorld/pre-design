import { Service, type Context } from '@deepseek-ai/cordis'

interface SlotEntry {
  component: unknown
  options: Record<string, unknown>
}

interface RegisterOptions extends Record<string, unknown> {
  children?: Record<string, unknown>
  name: string
}

/**
 * Test adapter for the DSH SlotRegistry contract used by this plugin.
 *
 * The published browser runtime is a DSH ModuleLoader artifact rather than an
 * importable ESM test module. This adapter keeps the real Cordis service and
 * fiber disposal semantics while implementing only the two SlotRegistry
 * operations consumed by the plugin: inject and register.
 */
export class SlotRegistry extends Service {
  private readonly declarations = new Set<string>(['root'])
  private readonly rows = new Map<string, SlotEntry[]>()

  constructor(ctx: Context) {
    super(ctx, 'slots')
  }

  register(options: RegisterOptions, component: unknown): () => void {
    for (const name of Object.keys(options.children ?? {})) this.declarations.add(name)

    const entry: SlotEntry = { component, options }
    const rows = this.rows.get(options.name) ?? []
    rows.push(entry)
    this.rows.set(options.name, rows)

    let disposed = false
    return this.ctx.effect(() => () => {
      if (disposed) return
      disposed = true
      const current = this.rows.get(options.name) ?? []
      this.rows.set(options.name, current.filter(candidate => candidate !== entry))
    }, `test slots.register(${options.name})`)
  }

  inject(name: string, callback: () => (() => void)): () => void {
    if (!this.declarations.has(name)) throw new Error(`slot is not declared: ${name}`)
    return callback()
  }

  entries(name: string): readonly SlotEntry[] {
    return this.rows.get(name) ?? []
  }
}
