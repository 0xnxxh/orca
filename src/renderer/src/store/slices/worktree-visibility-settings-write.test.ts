import { expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../../../shared/types'
import type { AppState } from '../types'
import { markRuntimeEnvironmentCompatible } from '@/runtime/runtime-rpc-client'
import { createTestStore } from './store-test-helpers'
import { persistVisibilityAwareSettings } from './worktree-visibility-settings-write'

it('preserves the active runtime default during unrelated local settings writes', async () => {
  const currentSettings = {
    activeRuntimeEnvironmentId: 'env-1',
    worktreeVisibilityDefaults: { external: 'show' }
  } as GlobalSettings
  let state = {
    settings: currentSettings,
    worktreeVisibilityDefaultsByHost: { 'runtime:env-1': { external: 'show' } }
  } as unknown as AppState
  vi.stubGlobal('window', {
    api: {
      settings: {
        set: vi.fn().mockResolvedValue({
          pluginSystemEnabled: true,
          worktreeVisibilityDefaults: { external: 'hide' }
        })
      }
    }
  })

  await persistVisibilityAwareSettings({
    normalizedUpdates: { pluginSystemEnabled: true },
    currentSettings,
    supportedRuntimeEnvironmentId: 'env-1',
    set: (updater) => {
      state = { ...state, ...updater(state) }
    }
  })

  expect(state.settings?.worktreeVisibilityDefaults).toEqual({ external: 'show' })
})

it('reclassifies worktrees after changing the host visibility default', async () => {
  vi.stubGlobal('window', {
    api: {
      settings: {
        set: vi.fn().mockResolvedValue({ worktreeVisibilityDefaults: { external: 'show' } })
      }
    }
  })
  const store = createTestStore()
  const fetchAllWorktrees = vi.fn().mockResolvedValue(undefined)
  store.setState({ fetchAllWorktrees })

  await store.getState().updateSettings({ worktreeVisibilityDefaults: { external: 'show' } })

  expect(fetchAllWorktrees).toHaveBeenCalledOnce()
})

it('does not restore a stale owner after its visibility write resolves', async () => {
  markRuntimeEnvironmentCompatible('env-a')
  let resolveUpdate!: (value: unknown) => void
  const update = new Promise((resolve) => (resolveUpdate = resolve))
  vi.stubGlobal('window', {
    api: {
      runtimeEnvironments: {
        call: vi.fn().mockReturnValue(update)
      }
    }
  })
  const currentSettings = {
    activeRuntimeEnvironmentId: 'env-a',
    worktreeVisibilityDefaults: { external: 'hide' }
  } as GlobalSettings
  let state = {
    settings: currentSettings,
    worktreeVisibilityDefaultsByHost: {}
  } as unknown as AppState
  const write = persistVisibilityAwareSettings({
    normalizedUpdates: { worktreeVisibilityDefaults: { external: 'show' } },
    currentSettings,
    supportedRuntimeEnvironmentId: 'env-a',
    set: (updater) => {
      state = { ...state, ...updater(state) }
    }
  })
  state = { ...state, settings: { activeRuntimeEnvironmentId: 'env-b' } as GlobalSettings }
  resolveUpdate({
    ok: true,
    result: { settings: { worktreeVisibilityDefaults: { external: 'show' } } },
    _meta: { runtimeId: 'runtime-a' }
  })
  await write

  expect(state.settings?.activeRuntimeEnvironmentId).toBe('env-b')
  expect(state.worktreeVisibilityDefaultsByHost['runtime:env-a']).toEqual({ external: 'show' })
})

it('rejects source-default writes before contacting an older runtime host', async () => {
  const runtimeCall = vi.fn()
  vi.stubGlobal('window', { api: { runtimeEnvironments: { call: runtimeCall } } })
  const currentSettings = {
    activeRuntimeEnvironmentId: 'env-a',
    worktreeVisibilityDefaults: { external: 'hide' }
  } as GlobalSettings

  await expect(
    persistVisibilityAwareSettings({
      normalizedUpdates: {
        worktreeVisibilityDefaults: {
          external: 'hide',
          customSources: [{ id: 'team', rootPath: '/srv/team' }]
        }
      },
      currentSettings,
      supportedRuntimeEnvironmentId: 'env-a',
      sourceDefaultsSupportedRuntimeEnvironmentId: null,
      set: vi.fn()
    })
  ).rejects.toThrow('Update this server to configure source defaults.')
  expect(runtimeCall).not.toHaveBeenCalled()
})
