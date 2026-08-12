import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserManager } from './browser-manager'

const mocks = vi.hoisted(() => ({
  constructed: vi.fn(),
  nextWebContentsId: 1
}))

vi.mock('electron', () => ({
  BrowserWindow: class {
    private destroyed = false
    readonly webContents = {
      id: mocks.nextWebContentsId++,
      once: vi.fn(),
      on: vi.fn((event: string, listener: () => void) => {
        if (event === 'did-finish-load') {
          listener()
        }
      }),
      removeListener: vi.fn(),
      loadURL: vi.fn(async () => undefined)
    }

    constructor() {
      mocks.constructed()
    }

    isDestroyed(): boolean {
      return this.destroyed
    }

    destroy(): void {
      this.destroyed = true
    }
  }
}))

vi.mock('./browser-session-registry', () => ({
  browserSessionRegistry: {
    getDefaultProfile: vi.fn(() => null),
    getProfile: vi.fn(() => null)
  }
}))

import { OffscreenBrowserBackend } from './offscreen-browser-backend'

describe('OffscreenBrowserBackend deterministic page creation', () => {
  beforeEach(() => {
    mocks.constructed.mockClear()
    mocks.nextWebContentsId = 1
  })

  it('returns the existing page when the same requested identity is retried', async () => {
    const browserManager = {
      registerOffscreenGuest: vi.fn(),
      unregisterGuest: vi.fn()
    } as unknown as BrowserManager
    const backend = new OffscreenBrowserBackend(browserManager)
    const browserPageId = '00000000-0000-4000-8000-000000000001'

    await expect(
      backend.createTab({ url: 'about:blank', worktreeId: 'worktree-1', browserPageId })
    ).resolves.toEqual({ browserPageId })
    await expect(
      backend.createTab({ url: 'about:blank', worktreeId: 'worktree-1', browserPageId })
    ).resolves.toEqual({ browserPageId })

    expect(mocks.constructed).toHaveBeenCalledOnce()
    expect(browserManager.registerOffscreenGuest).toHaveBeenCalledOnce()
  })
})
