import type { HostProfile } from './types'

const pendingByHost = new Map<string, Promise<void>>()

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
    await beforeHostSave?.()
    await saveHost(host)
  })
}
