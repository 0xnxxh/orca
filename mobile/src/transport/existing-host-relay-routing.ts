import { HostProfileSchema, type HostProfile } from './types'
import { loadStoredHostIdentity } from './host-store'
import { readHostDeviceToken } from './host-device-token-store'
import {
  getHostEndpointPublicationLifecycle,
  getHostProfilePublicationRevision,
  getPublishedHostIdentity,
  serializeHostProfilePublication,
  type HostEndpointPublicationLifecycle
} from './host-profile-publication'
import * as hostListLoads from './host-list-load-sharing'
import { saveMobileRelayHostOverlay } from './mobile-relay-host-overlay-store'
import type { MobileRelayCredentialBundle } from './mobile-relay-credential-bundle'

export class MobileRelayUpgradeHostRemovedError extends Error {}
export class MobileRelayUpgradeHostSupersededError extends Error {}
export class MobileRelayUpgradeLifecycleRetiredError extends Error {}

export async function saveExistingHostRelayRouting(
  host: HostProfile,
  beforePublish?: () => Promise<void>,
  endpointLifecycle = getHostEndpointPublicationLifecycle(host.id)
): Promise<void> {
  const validated = HostProfileSchema.parse(host)
  await requireCurrentHostCredential(validated)
  await serializeHostProfilePublication(validated.id, async () => {
    requireCurrentEndpointGeneration(validated.id, endpointLifecycle)
    const existing = await requireCurrentHostMetadata(validated)
    requireCurrentPublication(validated, endpointLifecycle)
    const { endpoints, relayHostId, relay } = validated
    if (!endpoints || !relayHostId || !relay) {
      throw new Error('mobile relay upgrade routing metadata missing')
    }
    // Why: serialize the credential before its routing overlay so neither side can cross a re-pair.
    await beforePublish?.()
    requireCurrentPublication(validated, endpointLifecycle)
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
  endpointLifecycle = getHostEndpointPublicationLifecycle(host.id)
): Promise<void> {
  const validated = HostProfileSchema.parse(host)
  await requireCurrentHostCredential(validated)
  await serializeHostProfilePublication(validated.id, async () => {
    requireCurrentEndpointGeneration(validated.id, endpointLifecycle)
    await requireCurrentHostMetadata(validated)
    if (bundle.hostId !== validated.id || bundle.deviceToken !== validated.deviceToken) {
      throw new MobileRelayUpgradeHostSupersededError('mobile relay credential identity mismatch')
    }
    requireCurrentPublication(validated, endpointLifecycle)
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
  host: HostProfile,
  endpointLifecycle: HostEndpointPublicationLifecycle
): void {
  const publishedIdentity = getPublishedHostIdentity(host.id)
  if (
    publishedIdentity &&
    (publishedIdentity.deviceToken !== host.deviceToken ||
      publishedIdentity.publicKeyB64 !== host.publicKeyB64)
  ) {
    throw new MobileRelayUpgradeHostSupersededError('mobile relay upgrade host was re-paired')
  }
  if (
    getHostProfilePublicationRevision(host.id) !== endpointLifecycle.profileRevision ||
    getHostEndpointPublicationLifecycle(host.id).generation !== endpointLifecycle.generation
  ) {
    throw new MobileRelayUpgradeLifecycleRetiredError('mobile relay endpoint lifecycle was retired')
  }
}

function requireCurrentEndpointGeneration(
  hostId: string,
  endpointLifecycle: HostEndpointPublicationLifecycle
): void {
  if (getHostEndpointPublicationLifecycle(hostId).generation !== endpointLifecycle.generation) {
    throw new MobileRelayUpgradeLifecycleRetiredError('mobile relay endpoint lifecycle was retired')
  }
}
