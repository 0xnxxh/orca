import type { HostProfile } from './types'

type CachedHostProfile = {
  host: HostProfile
  version: number
}

export type HostOpenProfile = {
  host: HostProfile | undefined
  version: number
}

export class HostReconnectProfileCache {
  private readonly profiles = new Map<string, CachedHostProfile>()
  private readonly latestVersions = new Map<string, number>()

  prime(host: HostProfile): number {
    const current = this.profiles.get(host.id)
    const version =
      current && reconnectProfileMatches(current.host, host)
        ? current.version
        : (this.latestVersions.get(host.id) ?? 0) + 1
    this.latestVersions.set(host.id, version)
    this.profiles.set(host.id, { host, version })
    return version
  }

  primeFromVersion(host: HostProfile, sourceVersion: number): number | null {
    if (this.version(host.id) !== sourceVersion) {
      return null
    }
    return this.prime(host)
  }

  publisher(hostId: string, initialVersion: number): (host: HostProfile) => void {
    let sourceVersion = initialVersion
    return (host) => {
      if (host.id !== hostId) {
        return
      }
      const nextVersion = this.primeFromVersion(host, sourceVersion)
      if (nextVersion !== null) {
        sourceVersion = nextVersion
      }
    }
  }

  get(hostId: string): HostProfile | undefined {
    return this.profiles.get(hostId)?.host
  }

  version(hostId: string): number {
    return this.latestVersions.get(hostId) ?? 0
  }

  delete(hostId: string): void {
    this.profiles.delete(hostId)
  }
}

function reconnectProfileMatches(left: HostProfile, right: HostProfile): boolean {
  return (
    left.endpoint === right.endpoint &&
    left.deviceToken === right.deviceToken &&
    left.publicKeyB64 === right.publicKeyB64 &&
    left.relayHostId === right.relayHostId &&
    JSON.stringify(left.endpoints ?? null) === JSON.stringify(right.endpoints ?? null) &&
    JSON.stringify(left.relay ?? null) === JSON.stringify(right.relay ?? null)
  )
}
