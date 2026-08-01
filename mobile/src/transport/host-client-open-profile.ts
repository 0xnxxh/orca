import type { HostClientOpenTicket, HostClientOpenRegistry } from './host-client-open-registry'
import type { HostReconnectProfileCache } from './host-reconnect-profile-cache'
import { dropSharedHostListLoad } from './host-list-load-sharing'
import type { HostProfile } from './types'

type HostClientOpenProfileOptions = {
  hostId: string
  cache: HostReconnectProfileCache
  ticket: HostClientOpenTicket
  loadHosts: () => Promise<HostProfile[]>
  onUnavailable: () => void
}

export function cancelHostClientOpenProfile(
  registry: HostClientOpenRegistry,
  hostId: string
): void {
  registry.cancel(hostId)
  dropSharedHostListLoad()
}

export async function loadHostClientOpenProfile(
  options: HostClientOpenProfileOptions
): Promise<{ host: HostProfile; version: number } | null> {
  const { hostId, cache, ticket } = options
  let loadedHost: HostProfile | undefined
  try {
    loadedHost = (await options.loadHosts()).find(({ id }) => id === hostId)
  } catch {
    if (!ticket.cancelled) {
      options.onUnavailable()
    }
    return null
  }
  if (ticket.cancelled) {
    return null
  }
  if (!loadedHost) {
    options.onUnavailable()
    return null
  }
  return { host: cache.get(hostId) ?? loadedHost, version: cache.version(hostId) }
}
