import {
  assertAuthorityId,
  type TerminalAuthorityNamespace
} from '../../shared/terminal-session-authority-identity'
import type { TerminalAuthorityConsumerRetirementResult } from '../../shared/terminal-session-authority-consumer-retirement'
import type {
  TerminalAuthorityAppConsumerRetirementRequest,
  TerminalAuthorityAppOutcomeHostTransport,
  TerminalAuthorityAppOutcomeManagerOptions,
  TerminalAuthorityAppOutcomeNamespaceBinding,
  TerminalAuthorityAppResolvedNamespaceBinding
} from './terminal-authority-app-outcome-host-contract'
import { TerminalAuthorityAppOutcomeHost } from './terminal-authority-app-outcome-host'

const MAX_APP_AUTHORITY_HOSTS = 256

export type TerminalAuthorityAppOutcomeHostRegistration = Readonly<{
  authenticatedAuthorityHostId: string
  knownNamespaceIds(): readonly string[]
  admitNamespace(namespace: TerminalAuthorityNamespace): Promise<void>
  bindNamespace(
    namespace: TerminalAuthorityNamespace
  ): Promise<TerminalAuthorityAppOutcomeNamespaceBinding>
  resolveAndAdmitNamespace(worktreeId: string): Promise<TerminalAuthorityNamespace>
  resolveAndBindNamespace(worktreeId: string): Promise<TerminalAuthorityAppResolvedNamespaceBinding>
  retireNamespace(
    request: TerminalAuthorityAppConsumerRetirementRequest
  ): Promise<TerminalAuthorityConsumerRetirementResult>
  dispose(): void
}>

export class TerminalAuthorityAppOutcomeHostManager {
  private readonly hosts = new Map<string, TerminalAuthorityAppOutcomeHost>()

  constructor(
    private readonly processIncarnationId: string,
    private readonly options: TerminalAuthorityAppOutcomeManagerOptions
  ) {
    requireAppProcessIncarnationId(processIncarnationId)
  }

  getProcessIncarnationId(): string {
    return this.processIncarnationId
  }

  installHost(
    transport: TerminalAuthorityAppOutcomeHostTransport
  ): TerminalAuthorityAppOutcomeHostRegistration {
    const hostId = requireAuthenticatedHostId(transport.authenticatedAuthorityHostId)
    if (this.hosts.has(hostId)) {
      throw new Error('terminal authority app outcome host is already installed')
    }
    if (this.hosts.size >= MAX_APP_AUTHORITY_HOSTS) {
      throw new Error('terminal authority app outcome host capacity exceeded')
    }
    const host = new TerminalAuthorityAppOutcomeHost(
      hostId,
      transport,
      this.processIncarnationId,
      this.options,
      () => this.hosts.get(hostId) === host
    )
    this.hosts.set(hostId, host)
    return Object.freeze({
      authenticatedAuthorityHostId: hostId,
      knownNamespaceIds: () => host.knownNamespaceIds(),
      admitNamespace: (namespace) => host.admitNamespace(namespace),
      bindNamespace: (namespace) => host.bindNamespace(namespace),
      resolveAndAdmitNamespace: (worktreeId) => host.resolveAndAdmitNamespace(worktreeId),
      resolveAndBindNamespace: (worktreeId) => host.resolveAndBindNamespace(worktreeId),
      retireNamespace: (request) => host.retireNamespace(request),
      dispose: () => {
        if (this.hosts.get(hostId) === host) {
          this.hosts.delete(hostId)
          host.dispose()
        }
      }
    })
  }

  snapshot(): Readonly<{ hosts: number; namespaces: number }> {
    return Object.freeze({
      hosts: this.hosts.size,
      namespaces: [...this.hosts.values()].reduce((count, host) => count + host.namespaceCount, 0)
    })
  }

  dispose(): void {
    for (const host of this.hosts.values()) {
      host.dispose()
    }
    this.hosts.clear()
  }
}

function requireAuthenticatedHostId(value: string): string {
  assertAuthorityId(value, 'authenticatedAuthorityHostId')
  return value
}

function requireAppProcessIncarnationId(value: string): string {
  assertAuthorityId(value, 'app process incarnation')
  if (!value.startsWith('app-process:')) {
    throw new Error('terminal authority app outcome process incarnation is invalid')
  }
  return value
}
