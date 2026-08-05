import { useEffect } from 'react'
import { useAppStore } from '@/store'
import { startProviderNativeTabTitleSync } from '@/lib/provider-native-tab-title-sync'

export function ProviderNativeTabTitleSyncGate(): null {
  useEffect(
    () =>
      startProviderNativeTabTitleSync({
        getState: useAppStore.getState,
        subscribe: useAppStore.subscribe,
        listSessions: (args) => window.api.aiVault.listSessions(args)
      }),
    []
  )
  return null
}
