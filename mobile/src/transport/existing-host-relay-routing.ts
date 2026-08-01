import { HostProfileSchema, type HostProfile } from './types'
import { loadHosts } from './host-store'
import { serializeHostProfilePublication } from './host-profile-publication'
import * as hostListLoads from './host-list-load-sharing'
import { saveMobileRelayHostOverlay } from './mobile-relay-host-overlay-store'

export class MobileRelayUpgradeHostRemovedError extends Error {}
export class MobileRelayUpgradeHostSupersededError extends Error {}

export async function saveExistingHostRelayRouting(
  host: HostProfile,
  beforePublish?: () => Promise<void>
): Promise<void> {
  const validated = HostProfileSchema.parse(host)
  await serializeHostProfilePublication(validated.id, async () => {
    const existing = (await loadHosts()).find(({ id }) => id === validated.id)
    if (!existing || existing.publicKeyB64 !== validated.publicKeyB64) {
      throw new MobileRelayUpgradeHostRemovedError('mobile relay upgrade host was removed')
    }
    if (existing.deviceToken !== validated.deviceToken) {
      throw new MobileRelayUpgradeHostSupersededError('mobile relay upgrade host was re-paired')
    }
    const { endpoints, relayHostId, relay } = validated
    if (!endpoints || !relayHostId || !relay) {
      throw new Error('mobile relay upgrade routing metadata missing')
    }
    // Why: serialize the credential before its routing overlay so neither side can cross a re-pair.
    await beforePublish?.()
    await saveMobileRelayHostOverlay({
      v: 2,
      hostId: validated.id,
      endpoints,
      relayHostId,
      relay
    })
    hostListLoads.dropSharedHostListLoad()
  })
}
