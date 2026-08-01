import type { HostProfile } from './types'

const pendingByHost = new Map<string, Promise<void>>()
const revisionByHost = new Map<string, number>()
const endpointGenerationByHost = new Map<string, number>()
const publishedIdentityByHost = new Map<string, Pick<HostProfile, 'deviceToken' | 'publicKeyB64'>>()

export type HostEndpointPublicationLifecycle = Readonly<{
  generation: number
  profileRevision: number
}>

export function getHostProfilePublicationRevision(hostId: string): number {
  return revisionByHost.get(hostId) ?? 0
}

export function getPublishedHostIdentity(
  hostId: string
): Pick<HostProfile, 'deviceToken' | 'publicKeyB64'> | undefined {
  return publishedIdentityByHost.get(hostId)
}

export function recordDurableHostIdentity(
  host: Pick<HostProfile, 'id' | 'deviceToken' | 'publicKeyB64'>
): void {
  publishedIdentityByHost.set(host.id, {
    deviceToken: host.deviceToken,
    publicKeyB64: host.publicKeyB64
  })
}

export function retireHostProfilePublication(hostId: string): Promise<void> | null {
  revisionByHost.set(hostId, getHostProfilePublicationRevision(hostId) + 1)
  endpointGenerationByHost.set(hostId, (endpointGenerationByHost.get(hostId) ?? 0) + 1)
  publishedIdentityByHost.delete(hostId)
  const pending = pendingByHost.get(hostId) ?? null
  pendingByHost.delete(hostId)
  return pending
}

export function beginHostEndpointPublicationLifecycle(
  hostId: string
): HostEndpointPublicationLifecycle {
  const generation = (endpointGenerationByHost.get(hostId) ?? 0) + 1
  endpointGenerationByHost.set(hostId, generation)
  return { generation, profileRevision: getHostProfilePublicationRevision(hostId) }
}

export function getHostEndpointPublicationLifecycle(
  hostId: string
): HostEndpointPublicationLifecycle {
  return {
    generation: endpointGenerationByHost.get(hostId) ?? 0,
    profileRevision: getHostProfilePublicationRevision(hostId)
  }
}

export function serializeHostProfilePublication<T>(
  hostId: string,
  publish: () => Promise<T>
): Promise<T> {
  const previous = pendingByHost.get(hostId) ?? Promise.resolve()
  const result = previous.then(publish)
  const settled = result.then(
    () => undefined,
    () => undefined
  )
  pendingByHost.set(hostId, settled)
  void settled.then(() => {
    if (pendingByHost.get(hostId) === settled) {
      pendingByHost.delete(hostId)
    }
  })
  return result
}

export function publishHostProfileTransaction(
  host: HostProfile,
  beforeHostSave: (() => Promise<void>) | null,
  saveHost: (host: HostProfile) => Promise<void>
): Promise<void> {
  return serializeHostProfilePublication(host.id, async () => {
    const publicationRevision = getHostProfilePublicationRevision(host.id)
    await beforeHostSave?.()
    requirePublicationRevision(host.id, publicationRevision)
    await saveHost(host)
    requirePublicationRevision(host.id, publicationRevision)
    revisionByHost.set(host.id, publicationRevision + 1)
    recordDurableHostIdentity(host)
  })
}

function requirePublicationRevision(hostId: string, expected: number): void {
  if (getHostProfilePublicationRevision(hostId) !== expected) {
    throw new Error('host profile publication was retired')
  }
}

/** Test-only: reset publication state between module-level storage cases. */
export function resetHostProfilePublicationForTests(): void {
  pendingByHost.clear()
  revisionByHost.clear()
  endpointGenerationByHost.clear()
  publishedIdentityByHost.clear()
}
