import type { HostScreenHostState, HostScreenIdentity } from './host-screen-host-state'

export function webHostScreenHostState(identity: HostScreenIdentity): HostScreenHostState {
  return {
    cachedWorkspaces() {
      return null
    },
    cacheWorkspaces() {},
    cacheRepositories() {},
    async loadPinnedWorkspaceIds() {
      return new Set()
    },
    async savePinnedWorkspaceIds() {},
    async loadIdentity() {
      return identity
    },
    async recordConnected() {}
  }
}
