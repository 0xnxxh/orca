import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

let userDataPath = ''

vi.mock('electron', () => ({
  app: { getPath: () => userDataPath }
}))

describe('OpenCode usage file path', () => {
  const earlyUserDataPath = join('early-root', 'profile')
  const lateUserDataPath = join('late-root', 'profile')

  beforeEach(() => {
    userDataPath = earlyUserDataPath
    vi.resetModules()
  })

  it('keeps the path captured before the Electron app name changes', async () => {
    const { getOpenCodeUsageFilePath, initOpenCodeUsagePath } =
      await import('./opencode-usage-file-path')

    initOpenCodeUsagePath()
    userDataPath = lateUserDataPath

    expect(getOpenCodeUsageFilePath()).toBe(join(earlyUserDataPath, 'orca-opencode-usage.json'))
  })

  it('caches the fallback path when startup initialization was skipped', async () => {
    const { getOpenCodeUsageFilePath } = await import('./opencode-usage-file-path')

    expect(getOpenCodeUsageFilePath()).toBe(join(earlyUserDataPath, 'orca-opencode-usage.json'))
    userDataPath = lateUserDataPath
    expect(getOpenCodeUsageFilePath()).toBe(join(earlyUserDataPath, 'orca-opencode-usage.json'))
  })
})
