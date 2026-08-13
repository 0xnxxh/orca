import { expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../../../shared/types'
import { createTestStore } from './store-test-helpers'

it('does not overwrite a settings write with an older owner hydration', async () => {
  let resolveSettingsRead!: (settings: GlobalSettings) => void
  const settingsRead = new Promise<GlobalSettings>((resolve) => (resolveSettingsRead = resolve))
  vi.stubGlobal('window', {
    api: {
      settings: {
        get: vi.fn().mockReturnValue(settingsRead),
        set: vi.fn().mockResolvedValue({ pluginSystemEnabled: true })
      },
      runtimeEnvironments: { list: vi.fn().mockResolvedValue([]) }
    }
  })
  const store = createTestStore()
  const hydration = store.getState().fetchSettings()

  await store.getState().updateSettingsOrThrow({ pluginSystemEnabled: true })
  resolveSettingsRead({ pluginSystemEnabled: false } as GlobalSettings)
  await hydration

  expect(store.getState().settings?.pluginSystemEnabled).toBe(true)
})
