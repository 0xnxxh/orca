import type { HostProfile } from './types'

const pendingByHost = new Map<string, Promise<void>>()
const revisionByHost = new Map<string, number>()
const endpointGenerationByHost = new Map<string, number>()

export type HostEndpointPublicationLifecycle = Readonly<{
  generation: number
  profileRevision: number
}>

export function getHostProfilePublicationRevision(hostId: string): number {
  return revisionByHost.get(hostId) ?? 0
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
  revisionByHost.set(host.id, getHostProfilePublicationRevision(host.id) + 1)
  return serializeHostProfilePublication(host.id, async () => {
    await beforeHostSave?.()
    await saveHost(host)
  })
}
