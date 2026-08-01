import type { HostClientOpenTicket } from './host-client-open-registry'
import { HostReconnectProfileCache } from './host-reconnect-profile-cache'
import type { HostProfile } from './types'

type HostClientOpenProfileOptions = {
  hostId: string
  cache: HostReconnectProfileCache
  ticket: HostClientOpenTicket
  loadHosts: () => Promise<HostProfile[]>
  onUnavailable: () => void
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
