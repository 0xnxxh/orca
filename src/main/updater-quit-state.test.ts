import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('updater quit state', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('is fail-closed until an update install marks the shared state', async () => {
    const {
      clearUpdateInstallQuitInProgress,
      isQuittingForUpdate,
      markUpdateInstallQuitInProgress
    } = await import('./updater-quit-state')

    expect(isQuittingForUpdate()).toBe(false)
    markUpdateInstallQuitInProgress()
    expect(isQuittingForUpdate()).toBe(true)
    clearUpdateInstallQuitInProgress()
    expect(isQuittingForUpdate()).toBe(false)
  })
})
