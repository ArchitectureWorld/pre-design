import { existsSync } from 'node:fs'
import { win32 } from 'node:path'

export interface BrowserExecutableResolutionOptions {
  readonly platform?: NodeJS.Platform
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly exists?: (path: string) => boolean
}

const WINDOWS_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
] as const

const MACOS_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
] as const

const LINUX_CANDIDATES = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/microsoft-edge',
  '/usr/bin/microsoft-edge-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
] as const

function candidatesFor(platform: NodeJS.Platform): readonly string[] {
  if (platform === 'win32') return WINDOWS_CANDIDATES
  if (platform === 'darwin') return MACOS_CANDIDATES
  return LINUX_CANDIDATES
}

function fallbackCommand(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'msedge' : 'google-chrome'
}

function configuredValue(
  requested: string | undefined,
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  for (const candidate of [
    requested,
    env.PREPLANNING_BROWSER_EXECUTABLE,
    env.PREPLAN_BROWSER_EXECUTABLE,
  ]) {
    const normalized = candidate?.trim()
    if (normalized !== undefined && normalized !== '') return normalized
  }
  return undefined
}

export function resolveBrowserExecutable(
  requested?: string,
  options: BrowserExecutableResolutionOptions = {},
): string {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const exists = options.exists ?? existsSync
  const configured = configuredValue(requested, env)

  if (configured !== undefined) {
    const foreignWindowsPath = platform !== 'win32' && win32.isAbsolute(configured)
    if (!foreignWindowsPath) return configured
  }

  return candidatesFor(platform).find(candidate => exists(candidate))
    ?? fallbackCommand(platform)
}
