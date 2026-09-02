import { describe, expect, it } from 'vitest'
import { resolveBrowserExecutable } from '../src/report/browser-executable.ts'

const windowsEdge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

describe('resolveBrowserExecutable', () => {
  it('honors an explicitly configured executable', () => {
    expect(resolveBrowserExecutable('/opt/browser/custom-chrome', {
      platform: 'linux',
      env: {},
      exists: () => false,
    })).toBe('/opt/browser/custom-chrome')
  })

  it('replaces a foreign Windows executable with an installed Linux browser', () => {
    expect(resolveBrowserExecutable(windowsEdge, {
      platform: 'linux',
      env: {},
      exists: path => path === '/usr/bin/google-chrome',
    })).toBe('/usr/bin/google-chrome')
  })

  it('uses the environment override when no executable was supplied', () => {
    expect(resolveBrowserExecutable(undefined, {
      platform: 'linux',
      env: { PREPLANNING_BROWSER_EXECUTABLE: '/srv/chrome' },
      exists: () => false,
    })).toBe('/srv/chrome')
  })

  it('returns a PATH command when no platform candidate exists', () => {
    expect(resolveBrowserExecutable(undefined, {
      platform: 'linux',
      env: {},
      exists: () => false,
    })).toBe('google-chrome')
  })
})
