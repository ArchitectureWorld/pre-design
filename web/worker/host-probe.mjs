// Diagnostic only. No HTTP listener and no fake replacement for missing Host services.
import { defineTool } from '@deepseek-ai/dsh-tools'
import { writeFile } from 'node:fs/promises'
export const name = 'pre-design-p0-host-probe'
export const inject = ['preplanning', 'commands', 'tools']
export async function apply(ctx) {
  const result = {
    pluginId: ctx.preplanning.pluginId,
    projects: ctx.preplanning.repository.listProjects().length,
    projectIds: ctx.preplanning.repository.listProjects().map(project => project.projectId),
    hasWebServer: Boolean(ctx.get('webServer')),
  }
  await writeFile(process.env.PRE_DSH_HOST_READY, JSON.stringify(result), { mode: 0o600 })
  ctx.tools.register(defineTool({
    name: 'p0_create_project',
    description: 'Test fixture only: create and bind the isolated P0 project through the real preplan-new command. Call once before preplanning_get_context.',
    parameters: {},
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(_args, exec) {
      const execution = await ctx.commands.execute(exec.agent, '/preplan-new P0 SDK compatibility', [], exec.signal)
      if (execution?.result?.kind !== 'success') throw new Error(JSON.stringify(execution))
      const context = ctx.preplanning.repository.readContext(String(exec.agent.id))
      await writeFile(process.env.PRE_DSH_HOST_READY + '.project', JSON.stringify(context.project), { mode: 0o600 })
      return JSON.parse(JSON.stringify(context.project))
    },
  }))
  ctx.tools.register(defineTool({
    name: 'p0_delegate', description: 'Verify a real restricted child Agent. Call once when asked to delegate.', parameters: {},
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(_args, exec) {
      const child = await ctx.preplanning.subagents.start('spawn', { parent: exec.agent, signal: exec.signal,
        label: 'preplanning_workflow:p0:delegation', toolFilter: { allow: [] },
        persona: 'Return only the marker CHILD_ACTIVATION_OK. You cannot use tools or delegate.',
        prompt: [{ type: 'text', text: 'Return CHILD_ACTIVATION_OK.' }] })
      try {
        const outcome = await child.result
        const receipt = { childId: String(child.id), ...outcome }
        await writeFile(process.env.PRE_DSH_HOST_READY + '.child', JSON.stringify(receipt), { mode: 0o600 })
        return receipt
      } finally { await child.dispose() }
    },
  }))
  ctx.provide('preplanningP0Ready', result)
}
