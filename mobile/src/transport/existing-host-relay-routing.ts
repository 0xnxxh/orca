import { HostProfileSchema, type HostProfile } from './types'
import { loadStoredHostIdentity } from './host-store'
import { readHostDeviceToken } from './host-device-token-store'
import {
  getHostEndpointPublicationGeneration,
  getHostProfilePublicationRevision,
  serializeHostProfilePublication
} from './host-profile-publication'
import * as hostListLoads from './host-list-load-sharing'
import { saveMobileRelayHostOverlay } from './mobile-relay-host-overlay-store'
import type { MobileRelayCredentialBundle } from './mobile-relay-credential-bundle'

export class MobileRelayUpgradeHostRemovedError extends Error {}
export class MobileRelayUpgradeHostSupersededError extends Error {}

export async function saveExistingHostRelayRouting(
  host: HostProfile,
  beforePublish?: () => Promise<void>,
  endpointGeneration = getHostEndpointPublicationGeneration(host.id)
): Promise<void> {
  const validated = HostProfileSchema.parse(host)
  const revision = getHostProfilePublicationRevision(validated.id)
  await requireCurrentHostCredential(validated)
  await serializeHostProfilePublication(validated.id, async () => {
    requireCurrentPublication(validated.id, revision, endpointGeneration)
    await requireCurrentHostDeviceToken(validated)
    requireCurrentPublication(validated.id, revision, endpointGeneration)
    const existing = await requireCurrentHostMetadata(validated)
    requireCurrentPublication(validated.id, revision, endpointGeneration)
    const { endpoints, relayHostId, relay } = validated
    if (!endpoints || !relayHostId || !relay) {
      throw new Error('mobile relay upgrade routing metadata missing')
    }
    // Why: serialize the credential before its routing overlay so neither side can cross a re-pair.
    await beforePublish?.()
    requireCurrentPublication(validated.id, revision, endpointGeneration)
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
  writeBundle: (bundle: MobileRelayCredentialBundle) => Promise<void>,
  endpointGeneration = getHostEndpointPublicationGeneration(host.id)
): Promise<void> {
  const validated = HostProfileSchema.parse(host)
  const revision = getHostProfilePublicationRevision(validated.id)
  await requireCurrentHostCredential(validated)
  await serializeHostProfilePublication(validated.id, async () => {
    requireCurrentPublication(validated.id, revision, endpointGeneration)
    await requireCurrentHostDeviceToken(validated)
    requireCurrentPublication(validated.id, revision, endpointGeneration)
    await requireCurrentHostMetadata(validated)
    if (bundle.hostId !== validated.id || bundle.deviceToken !== validated.deviceToken) {
      throw new MobileRelayUpgradeHostSupersededError('mobile relay credential identity mismatch')
    }
    requireCurrentPublication(validated.id, revision, endpointGeneration)
    await writeBundle(bundle)
  })
}

async function requireCurrentHostCredential(host: HostProfile): Promise<void> {
  const existing = await loadStoredHostIdentity(host.id)
  requireMatchingHostMetadata(host, existing)
  await requireCurrentHostDeviceToken(host)
}

async function requireCurrentHostDeviceToken(host: HostProfile): Promise<void> {
  const deviceToken = await readHostDeviceToken(host.id)
  if (!deviceToken) {
    throw new Error('host credential unavailable')
  }
  if (deviceToken !== host.deviceToken) {
    throw new MobileRelayUpgradeHostSupersededError('mobile relay upgrade host was re-paired')
  }
}

async function requireCurrentHostMetadata(
  host: HostProfile
): Promise<Pick<HostProfile, 'endpoint'>> {
  const existing = await loadStoredHostIdentity(host.id)
  requireMatchingHostMetadata(host, existing)
  return existing
}

function requireMatchingHostMetadata(
  host: HostProfile,
  existing: Pick<HostProfile, 'endpoint' | 'publicKeyB64'> | null
): asserts existing is Pick<HostProfile, 'endpoint' | 'publicKeyB64'> {
  if (!existing || existing.publicKeyB64 !== host.publicKeyB64) {
    throw new MobileRelayUpgradeHostRemovedError('mobile relay upgrade host was removed')
  }
}

function requireCurrentPublication(
  hostId: string,
  revision: number,
  endpointGeneration: number
): void {
  if (
    getHostProfilePublicationRevision(hostId) !== revision ||
    getHostEndpointPublicationGeneration(hostId) !== endpointGeneration
  ) {
    throw new MobileRelayUpgradeHostSupersededError('mobile relay upgrade host was re-paired')
  }
}
