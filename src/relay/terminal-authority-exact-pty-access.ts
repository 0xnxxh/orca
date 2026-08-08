import type { TerminalSessionAuthorityRegistry } from '../main/session-authority/terminal-session-authority-registry'
import type { TerminalAuthorityManagedPty } from '../main/session-authority/terminal-session-authority-pty-lifecycle'
import {
  TerminalSessionAuthorityError,
  type TerminalBindingAuthority
} from '../shared/terminal-session-authority-mutation'
import {
  sameTerminalSessionAuthorityPtyAccess,
  type TerminalSessionAuthorityPtyAccess
} from '../shared/terminal-session-authority-pty-access'

export type TerminalAuthorityExactPtyOwner =
  | 'current-owner'
  | 'current-owner-closed'
  | 'imported-owner'
  | 'imported-owner-closed'
  | 'exited'
  | 'unreachable'
  | 'unknown'

export type TerminalAuthorityExactPtyAccessResolver = Readonly<{
  classify: (access: TerminalSessionAuthorityPtyAccess) => Promise<TerminalAuthorityExactPtyOwner>
}>

export class RegistryTerminalAuthorityExactPtyAccessResolver implements TerminalAuthorityExactPtyAccessResolver {
  constructor(
    private readonly registry: TerminalSessionAuthorityRegistry,
    private readonly currentOwnerIncarnationId: string
  ) {}

  async classify(
    access: TerminalSessionAuthorityPtyAccess
  ): Promise<TerminalAuthorityExactPtyOwner> {
    let authority: TerminalBindingAuthority
    try {
      const service = await this.registry.openNamespace(access.namespace)
      authority = service.bindingAuthority(service.writerAccess, access.pane, access.binding)
    } catch (error) {
      if (error instanceof TerminalSessionAuthorityError && error.code === 'expectation-mismatch') {
        return 'unknown'
      }
      throw error
    }
    if (authority === 'owner-unreachable') {
      return 'unreachable'
    }
    if (authority === 'exited') {
      return 'exited'
    }
    if (authority === 'closed') {
      return access.binding.ownerIncarnationId === this.currentOwnerIncarnationId
        ? 'current-owner-closed'
        : 'imported-owner-closed'
    }
    if (authority !== 'reachable') {
      return 'unknown'
    }
    return access.binding.ownerIncarnationId === this.currentOwnerIncarnationId
      ? 'current-owner'
      : 'imported-owner'
  }
}

export function terminalAuthorityAccessForManagedPty(
  managed: TerminalAuthorityManagedPty
): TerminalSessionAuthorityPtyAccess {
  return Object.freeze({
    namespace: Object.freeze({ ...managed.runtime.service.namespace }),
    pane: Object.freeze({ ...managed.pane }),
    binding: Object.freeze({ ...managed.binding })
  })
}

export function managedPtyMatchesTerminalAuthorityAccess(
  managed: TerminalAuthorityManagedPty,
  access: TerminalSessionAuthorityPtyAccess
): boolean {
  return sameTerminalSessionAuthorityPtyAccess(
    terminalAuthorityAccessForManagedPty(managed),
    access
  )
}
