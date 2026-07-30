import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

let userDataPath = ''

vi.mock('electron', () => ({
  app: { getPath: () => userDataPath }
}))

describe('Claude usage file path', () => {
  const earlyUserDataPath = join('early-root', 'profile')
  const lateUserDataPath = join('late-root', 'profile')

  beforeEach(() => {
    userDataPath = earlyUserDataPath
    vi.resetModules()
  })

  it('keeps the path captured before the Electron app name changes', async () => {
    const { getClaudeUsageFilePath, initClaudeUsagePath } = await import('./claude-usage-file-path')

    initClaudeUsagePath()
    userDataPath = lateUserDataPath

    expect(getClaudeUsageFilePath()).toBe(join(earlyUserDataPath, 'orca-claude-usage.json'))
  })

  it('caches the fallback path when startup initialization was skipped', async () => {
    const { getClaudeUsageFilePath } = await import('./claude-usage-file-path')

    expect(getClaudeUsageFilePath()).toBe(join(earlyUserDataPath, 'orca-claude-usage.json'))
    userDataPath = lateUserDataPath
    expect(getClaudeUsageFilePath()).toBe(join(earlyUserDataPath, 'orca-claude-usage.json'))
  })
})
