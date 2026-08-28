import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const packageFile = (path: string): string => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@deepseek-ai\/cordis$/,
        replacement: packageFile('./node_modules/@deepseek-ai/cordis/lib/index.js'),
      },
      {
        find: /^@deepseek-ai\/dsh-client-ui-slots$/,
        replacement: packageFile('./node_modules/@deepseek-ai/dsh-client-ui-slots/lib/index.js'),
      },
    ],
  },
})
