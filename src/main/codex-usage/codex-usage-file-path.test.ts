import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

let userDataPath = ''

vi.mock('electron', () => ({
  app: { getPath: () => userDataPath }
}))

describe('Codex usage file path', () => {
  const earlyUserDataPath = join('early-root', 'profile')
  const lateUserDataPath = join('late-root', 'profile')

  beforeEach(() => {
    userDataPath = earlyUserDataPath
    vi.resetModules()
  })

  it('keeps the path captured before the Electron app name changes', async () => {
    const { getCodexUsageFilePath, initCodexUsagePath } = await import('./codex-usage-file-path')

    initCodexUsagePath()
    userDataPath = lateUserDataPath

    expect(getCodexUsageFilePath()).toBe(join(earlyUserDataPath, 'orca-codex-usage.json'))
  })

  it('caches the fallback path when startup initialization was skipped', async () => {
    const { getCodexUsageFilePath } = await import('./codex-usage-file-path')

    expect(getCodexUsageFilePath()).toBe(join(earlyUserDataPath, 'orca-codex-usage.json'))
    userDataPath = lateUserDataPath
    expect(getCodexUsageFilePath()).toBe(join(earlyUserDataPath, 'orca-codex-usage.json'))
  })
})
