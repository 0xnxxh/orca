import type { HostProfile } from './types'

type CachedHostProfile = {
  host: HostProfile
  version: number
  sourceRevision: number
}

export type HostOpenProfile = {
  host: HostProfile | undefined
  version: number
}

export class HostReconnectProfileCache {
  private readonly profiles = new Map<string, CachedHostProfile>()
  private readonly latestVersions = new Map<string, number>()

  prime(host: HostProfile, sourceRevision: number): number {
    const current = this.freshProfile(host.id, sourceRevision)
    const version =
      current && reconnectProfileMatches(current.host, host)
        ? current.version
        : (this.latestVersions.get(host.id) ?? 0) + 1
    this.latestVersions.set(host.id, version)
    this.profiles.set(host.id, { host, version, sourceRevision })
    return version
  }

  reconnectProfile(
    hostId: string,
    currentRevision: number,
    requestedHost?: HostProfile
  ): HostOpenProfile {
    return requestedHost
      ? { host: requestedHost, version: this.prime(requestedHost, currentRevision) }
      : {
          host: this.get(hostId, currentRevision),
          version: this.version(hostId, currentRevision)
        }
  }

  primeLoaded(host: HostProfile, sourceRevision: number, currentRevision: number): number | null {
    if (sourceRevision !== currentRevision) {
      return null
    }
    return this.prime(host, sourceRevision)
  }

  primeLoadedHosts(hosts: HostProfile[], sourceRevision: number, currentRevision: number): void {
    for (const host of hosts) {
      this.primeLoaded(host, sourceRevision, currentRevision)
    }
  }

  primeFromVersion(
    host: HostProfile,
    sourceVersion: number,
    sourceRevision: number
  ): number | null {
    if (this.version(host.id, sourceRevision) !== sourceVersion) {
      return null
    }
    return this.prime(host, sourceRevision)
  }

  publisher(
    hostId: string,
    initialVersion: number,
    getCurrentRevision: () => number
  ): (host: HostProfile) => void {
    let sourceVersion = initialVersion
    return (host) => {
      if (host.id !== hostId) {
        return
      }
      const nextVersion = this.primeFromVersion(host, sourceVersion, getCurrentRevision())
      if (nextVersion !== null) {
        sourceVersion = nextVersion
      }
    }
  }

  get(hostId: string, currentRevision: number): HostProfile | undefined {
    return this.freshProfile(hostId, currentRevision)?.host
  }

  version(hostId: string, currentRevision: number): number {
    this.freshProfile(hostId, currentRevision)
    return this.latestVersions.get(hostId) ?? 0
  }

  delete(hostId: string): void {
    this.profiles.delete(hostId)
  }

  private freshProfile(hostId: string, currentRevision: number): CachedHostProfile | undefined {
    const profile = this.profiles.get(hostId)
    if (!profile || profile.sourceRevision === currentRevision) {
      return profile
    }
    this.profiles.delete(hostId)
    this.latestVersions.set(hostId, (this.latestVersions.get(hostId) ?? 0) + 1)
    return undefined
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
