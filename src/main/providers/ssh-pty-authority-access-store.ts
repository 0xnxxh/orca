import type { TerminalSessionAuthorityPtyAccess } from '../../shared/terminal-session-authority-pty-access'
import {
  parseTerminalSessionAuthorityPtyAccess,
  sameTerminalSessionAuthorityPtyAccess
} from '../../shared/terminal-session-authority-pty-access'

export class SshPtyAuthorityAccessStore {
  private readonly accessByRelayPtyId = new Map<string, TerminalSessionAuthorityPtyAccess>()
  private readonly cutoverRelayPtyIds = new Set<string>()
  private readonly mutationRouteToken = Object.freeze({})

  constructor(private readonly toRelayPtyId: (id: string) => string) {}

  dispose(): void {
    this.accessByRelayPtyId.clear()
    this.cutoverRelayPtyIds.clear()
  }

  recordExit(relayPtyId: string): void {
    this.accessByRelayPtyId.delete(relayPtyId)
  }

  accessForRelayPtyId(relayPtyId: string): TerminalSessionAuthorityPtyAccess | undefined {
    return this.accessByRelayPtyId.get(relayPtyId)
  }

  remember(
    relayPtyId: string,
    value: TerminalSessionAuthorityPtyAccess | undefined,
    ptyIncarnationId: string | undefined
  ): void {
    if (value === undefined) {
      return
    }
    this.cutoverRelayPtyIds.add(relayPtyId)
    const access = parseTerminalSessionAuthorityPtyAccess(value)
    if (
      !access ||
      access.binding.physicalPtyId !== relayPtyId ||
      access.binding.ptyIncarnationId !== ptyIncarnationId
    ) {
      throw new Error('ssh_terminal_authority_access_invalid')
    }
    const current = this.accessByRelayPtyId.get(relayPtyId)
    if (current && !sameTerminalSessionAuthorityPtyAccess(current, access)) {
      throw new Error('ssh_terminal_authority_access_conflict')
    }
    this.accessByRelayPtyId.set(relayPtyId, access)
  }

  expect(relayPtyId: string, value: TerminalSessionAuthorityPtyAccess): void {
    this.cutoverRelayPtyIds.add(relayPtyId)
    const access = parseTerminalSessionAuthorityPtyAccess(value)
    if (!access || access.binding.physicalPtyId !== relayPtyId) {
      throw new Error('ssh_terminal_authority_expected_access_invalid')
    }
  }

  bind(
    id: string,
    access: TerminalSessionAuthorityPtyAccess,
    ptyIncarnationId: string | undefined
  ): boolean {
    const relayPtyId = this.toRelayPtyId(id)
    this.cutoverRelayPtyIds.add(relayPtyId)
    try {
      this.remember(relayPtyId, access, ptyIncarnationId)
      return true
    } catch {
      return false
    }
  }

  markListedProcess(
    id: string,
    access: TerminalSessionAuthorityPtyAccess | undefined,
    ptyIncarnationId: string | undefined
  ): object | undefined {
    const relayPtyId = this.toRelayPtyId(id)
    const wasCutover = this.cutoverRelayPtyIds.has(relayPtyId)
    const current = this.accessByRelayPtyId.get(relayPtyId)
    if (!access && current && current.binding.ptyIncarnationId === ptyIncarnationId) {
      throw new Error('ssh_terminal_authority_access_downgrade')
    }
    if (!access && current) {
      this.accessByRelayPtyId.delete(relayPtyId)
    }
    this.remember(relayPtyId, access, ptyIncarnationId)
    return access || !wasCutover ? this.mutationRouteToken : undefined
  }

  isCutover(id: string): boolean {
    return this.cutoverRelayPtyIds.has(this.toRelayPtyId(id))
  }

  mutationToken(): object {
    return this.mutationRouteToken
  }
}
