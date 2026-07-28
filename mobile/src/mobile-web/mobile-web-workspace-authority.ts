import { MobileWebBrokerError } from './mobile-web-broker-error'

export type MobileWebHostWorkspaceBinding = {
  workspaceId: string
  repoId: string
}

export class MobileWebWorkspaceAuthority {
  private readonly pageWorkspaceIdByHostId = new Map<string, string>()
  private readonly hostWorkspaceIdByPageId = new Map<string, string>()
  private readonly pageRepoIdByHostId = new Map<string, string>()
  private readonly hostRepoIdByPageId = new Map<string, string>()
  private readonly hostConnectionIdByPageRepoId = new Map<string, string>()
  private nextHandle = 0

  constructor(private readonly randomBytes: (length: number) => Uint8Array) {}

  synchronize(bindings: readonly MobileWebHostWorkspaceBinding[]): void {
    const workspaceIds = new Set(bindings.map((binding) => binding.workspaceId))
    for (const hostWorkspaceId of this.pageWorkspaceIdByHostId.keys()) {
      if (!workspaceIds.has(hostWorkspaceId)) {
        const pageWorkspaceId = this.pageWorkspaceIdByHostId.get(hostWorkspaceId)
        this.pageWorkspaceIdByHostId.delete(hostWorkspaceId)
        if (pageWorkspaceId) {
          this.hostWorkspaceIdByPageId.delete(pageWorkspaceId)
        }
      }
    }
    for (const binding of bindings) {
      this.rememberWorkspace(binding.workspaceId)
      this.rememberRepo(binding.repoId)
    }
  }

  pageWorkspaceId(hostWorkspaceId: string): string {
    const pageWorkspaceId = this.pageWorkspaceIdByHostId.get(hostWorkspaceId)
    if (!pageWorkspaceId) {
      throw new MobileWebBrokerError('not_found')
    }
    return pageWorkspaceId
  }

  pageRepoId(hostRepoId: string): string {
    const pageRepoId = this.pageRepoIdByHostId.get(hostRepoId)
    if (!pageRepoId) {
      throw new MobileWebBrokerError('not_found')
    }
    return pageRepoId
  }

  hostRepoId(pageRepoId: string): string {
    const hostRepoId = this.hostRepoIdByPageId.get(pageRepoId)
    if (!hostRepoId) {
      throw new MobileWebBrokerError('not_found')
    }
    return hostRepoId
  }

  synchronizeRepositories(hostRepoIds: readonly string[]): void {
    const current = new Set(hostRepoIds)
    for (const [hostRepoId, pageRepoId] of this.pageRepoIdByHostId) {
      if (!current.has(hostRepoId)) {
        this.pageRepoIdByHostId.delete(hostRepoId)
        this.hostRepoIdByPageId.delete(pageRepoId)
        this.hostConnectionIdByPageRepoId.delete(pageRepoId)
      }
    }
    hostRepoIds.forEach((hostRepoId) => this.rememberRepo(hostRepoId))
  }

  synchronizeCreationRepositories(
    repositories: readonly { id: string; connectionId?: string | null }[]
  ): void {
    this.synchronizeRepositories(repositories.map((repo) => repo.id))
    this.hostConnectionIdByPageRepoId.clear()
    for (const repo of repositories) {
      if (repo.connectionId) {
        this.hostConnectionIdByPageRepoId.set(this.pageRepoId(repo.id), repo.connectionId)
      }
    }
  }

  hostConnectionId(pageRepoId: string): string {
    const connectionId = this.hostConnectionIdByPageRepoId.get(pageRepoId)
    if (!connectionId) {
      throw new MobileWebBrokerError('not_found')
    }
    return connectionId
  }

  hostWorkspaceId(pageWorkspaceId: string): string {
    const hostWorkspaceId = this.hostWorkspaceIdByPageId.get(pageWorkspaceId)
    if (!hostWorkspaceId) {
      throw new MobileWebBrokerError('not_found')
    }
    return hostWorkspaceId
  }

  registerWorkspace(hostWorkspaceId: string, hostRepoId: string): string {
    this.rememberWorkspace(hostWorkspaceId)
    this.rememberRepo(hostRepoId)
    return this.pageWorkspaceId(hostWorkspaceId)
  }

  clear(): void {
    this.pageWorkspaceIdByHostId.clear()
    this.hostWorkspaceIdByPageId.clear()
    this.pageRepoIdByHostId.clear()
    this.hostRepoIdByPageId.clear()
    this.hostConnectionIdByPageRepoId.clear()
  }

  private rememberWorkspace(hostWorkspaceId: string): void {
    if (this.pageWorkspaceIdByHostId.has(hostWorkspaceId)) {
      return
    }
    const pageWorkspaceId = this.createHandle('workspace')
    this.pageWorkspaceIdByHostId.set(hostWorkspaceId, pageWorkspaceId)
    this.hostWorkspaceIdByPageId.set(pageWorkspaceId, hostWorkspaceId)
  }

  private rememberRepo(hostRepoId: string): void {
    if (!this.pageRepoIdByHostId.has(hostRepoId)) {
      const pageRepoId = this.createHandle('repo')
      this.pageRepoIdByHostId.set(hostRepoId, pageRepoId)
      this.hostRepoIdByPageId.set(pageRepoId, hostRepoId)
    }
  }

  private createHandle(prefix: 'workspace' | 'repo'): string {
    const bytes = this.randomBytes(16)
    if (bytes.byteLength !== 16) {
      throw new MobileWebBrokerError('internal')
    }
    const counter = this.nextHandle.toString(36)
    this.nextHandle += 1
    return `${prefix}_${counter}_${Array.from(bytes, byteToHex).join('')}`
  }
}

function byteToHex(value: number): string {
  return value.toString(16).padStart(2, '0')
}
