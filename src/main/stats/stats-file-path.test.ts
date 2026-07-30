import { beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'

let userDataPath = ''

vi.mock('electron', () => ({
  app: { getPath: () => userDataPath }
}))

describe('stats file path', () => {
  beforeEach(() => {
    userDataPath = '/early-user-data'
    vi.resetModules()
  })

  it('keeps the path captured before the Electron app name changes', async () => {
    const { getStatsFilePath, initStatsPath } = await import('./stats-file-path')

    initStatsPath()
    userDataPath = '/late-user-data'

    expect(getStatsFilePath()).toBe(join('/early-user-data', 'orca-stats.json'))
  })

  it('caches the fallback path when startup initialization was skipped', async () => {
    const { getStatsFilePath } = await import('./stats-file-path')

    expect(getStatsFilePath()).toBe(join('/early-user-data', 'orca-stats.json'))
    userDataPath = '/late-user-data'
    expect(getStatsFilePath()).toBe(join('/early-user-data', 'orca-stats.json'))
  })
})
