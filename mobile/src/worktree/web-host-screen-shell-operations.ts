import type { MobileWebBridgeClient } from '../../../src/mobile-web/src/mobile-web-bridge-client'
import type { HostScreenShellOperations } from './host-screen-shell-operations'

export function webHostScreenShellOperations(
  client: MobileWebBridgeClient | null,
  navigateFromHostList: (target: string) => void
): HostScreenShellOperations {
  const requireClient = (): MobileWebBridgeClient => {
    if (!client) {
      throw new Error('Native shell channel unavailable')
    }
    return client
  }

  return {
    leaveHost() {
      void requireClient().navigationRoute({ destination: 'hostPicker' })
    },
    navigateFromHostList,
    reconnect() {
      return client
        ? client.navigationReconnect().then(() => undefined)
        : Promise.reject(new Error('Native shell channel unavailable'))
    },
    repairPairing() {
      void requireClient().navigationRoute({ destination: 'pairingRepair' })
    },
    removeHost() {
      return client
        ? client.navigationRemoveHost({ confirmation: 'remove-paired-host' }).then(() => undefined)
        : Promise.reject(new Error('Native shell channel unavailable'))
    }
  }
}
