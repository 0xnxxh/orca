import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getAppPath: vi.fn(() => '/project'),
    getPath: vi.fn(() => '/app')
  },
  webContents: {
    fromId: vi.fn(() => null)
  }
}))

import type { BrowserManager } from '../browser/browser-manager'
import { attachAgentBrowserStartupCapability } from './agent-browser-startup-capability'

describe('agent browser startup capability', () => {
  it('attaches one bridge and forwards tab changes to mobile sessions', () => {
    const browserManager = {} as BrowserManager
    const setAgentBrowserBridge = vi.fn()
    const notifyMobileSessionTabsChanged = vi.fn()

    const bridge = attachAgentBrowserStartupCapability(
      { notifyMobileSessionTabsChanged, setAgentBrowserBridge },
      browserManager
    )
    bridge.setActiveTab(42, 'worktree-1')

    expect(setAgentBrowserBridge).toHaveBeenCalledOnce()
    expect(setAgentBrowserBridge).toHaveBeenCalledWith(bridge)
    expect(notifyMobileSessionTabsChanged).toHaveBeenCalledOnce()
    expect(notifyMobileSessionTabsChanged).toHaveBeenCalledWith('worktree-1')
  })
})
