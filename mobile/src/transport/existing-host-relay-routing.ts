import { HostProfileSchema, type HostProfile } from './types'
import { mutateStoredHosts } from './host-store'
import * as hostListLoads from './host-list-load-sharing'
import { saveMobileRelayHostOverlay } from './mobile-relay-host-overlay-store'

export class MobileRelayUpgradeHostRemovedError extends Error {}

export async function saveExistingHostRelayRouting(host: HostProfile): Promise<void> {
  const validated = HostProfileSchema.parse(host)
  await mutateStoredHosts((hosts) => {
    const existing = hosts.find(({ id }) => id === validated.id)
    if (!existing || existing.publicKeyB64 !== validated.publicKeyB64) {
      throw new MobileRelayUpgradeHostRemovedError('mobile relay upgrade host was removed')
    }
    return hosts
  })
  if (!validated.endpoints || !validated.relayHostId || !validated.relay) {
    throw new Error('mobile relay upgrade routing metadata missing')
  }
  await saveMobileRelayHostOverlay({
    v: 2,
    hostId: validated.id,
    endpoints: validated.endpoints,
    relayHostId: validated.relayHostId,
    relay: validated.relay
  })
  hostListLoads.dropSharedHostListLoad()
}
