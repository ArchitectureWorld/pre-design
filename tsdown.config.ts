import { defineConfig } from 'tsdown'

const PACKAGE_NAME = '@architectureworld/dsh-preplanning-agent'
const hostExternal = /^@deepseek-ai\/(cordis|schemastery)(\/|$)/
const serverExternal = (specifier: string) => hostExternal.test(specifier) || specifier.startsWith('pdfjs-dist/') || specifier === 'sharp'
const clientExternals = new Set([
  'react',
  'react-dom',
  'react/jsx-runtime',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-runtime/client',
])

export default defineConfig([
  {
    name: PACKAGE_NAME,
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    clean: true,
    dts: false,
    deps: {
      neverBundle: serverExternal,
      alwaysBundle: specifier => !serverExternal(specifier),
    },
  },
  {
    name: `${PACKAGE_NAME}/client`,
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2024',
    fixedExtension: false,
    clean: false,
    dts: false,
    sourcemap: true,
    // Keep the full UI, including per-route reasoning controls, within 110 KB.
    minify: true,
    plugins: [{
      name: 'compact-inline-report-styles',
      transform(code, id) {
        if (!/[\\/]client[\\/]glass-(?:session-|inline-)?styles\.ts$/u.test(id)) return
        // Only remove comments and insignificant rule whitespace in these static CSS literals.
        return code.replace(/`([^`]*)`/gsu, (_match, css:string) => JSON.stringify(css.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\s*([{},;])\s*/gu, '$1').replace(/:\s+/gu, ':').replace(/;\}/gu, '}').trim()))
      },
    }],
    deps: {
      neverBundle: specifier => clientExternals.has(specifier),
      alwaysBundle: specifier => !clientExternals.has(specifier),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE_NAME)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
