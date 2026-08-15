import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import { hydrateOwnerWorktreeVisibilityDefaults } from './worktree-visibility-owner-settings'

export type SettingsStateSetter = Parameters<StateCreator<AppState, [], []>>[0]
type SettingsStateGetter = Parameters<StateCreator<AppState, [], []>>[1]
const completedOwnerVisibilityDefaultsHydration = Promise.resolve()
const ownerVisibilityDefaultsHydrationByStore = new WeakMap<SettingsStateGetter, Promise<void>>()

export type FetchSettingsOptions = {
  deferOwnerWorktreeVisibilityDefaults?: boolean
}

export function startOwnerWorktreeVisibilityDefaultsHydration(args: {
  settings: GlobalSettings
  deferPublication: boolean
  shouldPublish: () => boolean
  set: SettingsStateSetter
  get: SettingsStateGetter
}): Promise<void> {
  if (args.deferPublication) {
    args.set((state) => ({
      settings: args.settings,
      worktreeVisibilityDefaultsByHost: args.settings.worktreeVisibilityDefaults
        ? {
            ...state.worktreeVisibilityDefaultsByHost,
            [LOCAL_EXECUTION_HOST_ID]: args.settings.worktreeVisibilityDefaults
          }
        : state.worktreeVisibilityDefaultsByHost
    }))
  }
  const hydration = hydrateOwnerWorktreeVisibilityDefaults(
    args.settings,
    args.get().worktreeVisibilityDefaultsByHost
  )
    .then((hydrated) => {
      if (!args.shouldPublish()) {
        return
      }
      args.set((state) => ({
        settings: hydrated.settings,
        worktreeVisibilityDefaultsByHost: {
          ...state.worktreeVisibilityDefaultsByHost,
          ...hydrated.defaultsByHost
        },
        worktreeVisibilityDefaultsSupportedRuntimeEnvironmentId:
          hydrated.supportedRuntimeEnvironmentId,
        worktreeVisibilitySourceDefaultsSupportedRuntimeEnvironmentId:
          hydrated.sourceDefaultsSupportedRuntimeEnvironmentId
      }))
    })
    .catch((err) => console.error('Failed to fetch settings:', err))
  ownerVisibilityDefaultsHydrationByStore.set(args.get, hydration)
  return hydration
}

export function awaitOwnerWorktreeVisibilityDefaultsHydration(
  get: SettingsStateGetter
): Promise<void> {
  return (
    ownerVisibilityDefaultsHydrationByStore.get(get) ?? completedOwnerVisibilityDefaultsHydration
  )
}
