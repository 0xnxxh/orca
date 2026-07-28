import { useCallback, useMemo } from 'react'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useForceReconnect, useHostClient } from '../transport/client-context'
import { NATIVE_MOBILE_PR_SHELL_OPERATIONS } from '../platform/native-mobile-pr-shell-operations'
import type { HostSourceControlBinding } from './host-source-control-binding'
import { NATIVE_HOST_SOURCE_CONTROL_FEEDBACK } from './native-host-source-control-feedback'

export function useHostSourceControlBinding(
  hostId: string,
  binding: HostSourceControlBinding | undefined
) {
  const insets = useSafeAreaInsets()
  const nativeHost = useHostClient(binding ? undefined : hostId)
  const nativeForceReconnect = useForceReconnect()
  const prShellOperations = useMemo(
    () =>
      binding
        ? {
            ...binding.feedback,
            writeClipboard: binding.writeClipboard,
            openExternal: binding.openExternalUrl
          }
        : NATIVE_MOBILE_PR_SHELL_OPERATIONS,
    [binding]
  )
  const forceReconnect = useCallback(
    async (requestedHostId: string) => {
      if (binding) {
        await binding.reconnect()
        return
      }
      await nativeForceReconnect(requestedHostId)
    },
    [binding, nativeForceReconnect]
  )
  return {
    client: binding ? binding.client : nativeHost.client,
    connState: binding ? binding.connectionState : nativeHost.state,
    forceReconnect,
    feedback: binding?.feedback ?? NATIVE_HOST_SOURCE_CONTROL_FEEDBACK,
    prShellOperations,
    insets
  }
}
