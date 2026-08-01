import { HostProfileSchema, type HostProfile } from './types'
import { loadStoredHostCredentialIdentity } from './host-store'
import { serializeHostProfilePublication } from './host-profile-publication'
import * as hostListLoads from './host-list-load-sharing'
import { saveMobileRelayHostOverlay } from './mobile-relay-host-overlay-store'
import type { MobileRelayCredentialBundle } from './mobile-relay-credential-bundle'

export class MobileRelayUpgradeHostRemovedError extends Error {}
export class MobileRelayUpgradeHostSupersededError extends Error {}

export async function saveExistingHostRelayRouting(
  host: HostProfile,
  beforePublish?: () => Promise<void>
): Promise<void> {
  const validated = HostProfileSchema.parse(host)
  await serializeHostProfilePublication(validated.id, async () => {
    const existing = await requireCurrentHostIdentity(validated)
    const { endpoints, relayHostId, relay } = validated
    if (!endpoints || !relayHostId || !relay) {
      throw new Error('mobile relay upgrade routing metadata missing')
    }
    // Why: serialize the credential before its routing overlay so neither side can cross a re-pair.
    await beforePublish?.()
    await saveMobileRelayHostOverlay({
      v: 2,
      hostId: validated.id,
      endpoints: endpoints.map((endpoint) =>
        endpoint.id === 'direct-primary' && endpoint.kind !== 'relay'
          ? { ...endpoint, url: existing.endpoint }
          : endpoint
      ),
      relayHostId,
      relay
    })
    hostListLoads.dropSharedHostListLoad()
  })
}

export async function writeExistingHostRelayCredentialBundle(
  host: HostProfile,
  bundle: MobileRelayCredentialBundle,
  writeBundle: (bundle: MobileRelayCredentialBundle) => Promise<void>
): Promise<void> {
  const validated = HostProfileSchema.parse(host)
  await serializeHostProfilePublication(validated.id, async () => {
    await requireCurrentHostIdentity(validated)
    if (bundle.hostId !== validated.id || bundle.deviceToken !== validated.deviceToken) {
      throw new MobileRelayUpgradeHostSupersededError('mobile relay credential identity mismatch')
    }
    await writeBundle(bundle)
  })
}

async function requireCurrentHostIdentity(
  host: HostProfile
): Promise<Pick<HostProfile, 'endpoint'>> {
  const existing = await loadStoredHostCredentialIdentity(host.id)
  if (!existing || existing.publicKeyB64 !== host.publicKeyB64) {
    throw new MobileRelayUpgradeHostRemovedError('mobile relay upgrade host was removed')
  }
  if (existing.deviceToken !== host.deviceToken) {
    throw new MobileRelayUpgradeHostSupersededError('mobile relay upgrade host was re-paired')
  }
  return existing
}
