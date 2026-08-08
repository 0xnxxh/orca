import {
  matchesPtyExactOperationIdentity,
  PTY_EXACT_OPERATION_PROTOCOL_VERSION
} from '../../shared/pty-exact-operation-protocol'
import {
  PTY_CLEAR_BUFFER_AUTHORITY_EXACT_METHOD,
  PTY_DATA_AUTHORITY_EXACT_METHOD,
  PTY_RESIZE_AUTHORITY_EXACT_METHOD,
  PTY_SEND_SIGNAL_AUTHORITY_EXACT_METHOD,
  PTY_SHUTDOWN_AUTHORITY_EXACT_METHOD,
  TERMINAL_AUTHORITY_EXACT_OPERATIONS_VERSION
} from '../../shared/terminal-authority-exact-operation-protocol'
import type { TerminalSessionAuthorityPtyAccess } from '../../shared/terminal-session-authority-pty-access'
import {
  parseTerminalSessionAuthorityPtyAccess,
  sameTerminalSessionAuthorityPtyAccess
} from '../../shared/terminal-session-authority-pty-access'
import type { SshChannelMultiplexer } from '../ssh/ssh-channel-multiplexer'
import type { PtyMutationMode } from './pty-provider-contract'
import { SshPtyAuthorityAccessStore } from './ssh-pty-authority-access-store'
import { sshRelayDeadlineOptions } from './ssh-relay-request-deadline'
import type { SshPtyShutdownOptions } from './ssh-pty-shutdown-operation'

type OperationCapability = Readonly<{ version: 1; isCurrentProviderGeneration: () => boolean }>
export type SshPtyExactOperationCapability = OperationCapability
export type SshPtyAuthorityExactOperationCapability = OperationCapability

type SshPtyAuthorityRoutingOptions = Readonly<{
  mux: SshChannelMultiplexer
  legacyCapability?: SshPtyExactOperationCapability
  authorityCapability?: SshPtyAuthorityExactOperationCapability
  livePtyIds: Set<string>
  toRelayPtyId: (id: string) => string
  getPtyIncarnation: (relayPtyId: string) => string | undefined
}>

type AuthorityRoute = Readonly<{ relayPtyId: string; access: TerminalSessionAuthorityPtyAccess }>
type AuthorityRequestMethod =
  | typeof PTY_SEND_SIGNAL_AUTHORITY_EXACT_METHOD
  | typeof PTY_CLEAR_BUFFER_AUTHORITY_EXACT_METHOD

export class SshPtyAuthorityRouting {
  private readonly accessStore: SshPtyAuthorityAccessStore

  constructor(private readonly options: SshPtyAuthorityRoutingOptions) {
    this.accessStore = new SshPtyAuthorityAccessStore(options.toRelayPtyId)
  }

  dispose = (): void => this.accessStore.dispose()
  recordExit = (relayPtyId: string): void => this.accessStore.recordExit(relayPtyId)
  accessForRelayPtyId = (relayPtyId: string): TerminalSessionAuthorityPtyAccess | undefined =>
    this.accessStore.accessForRelayPtyId(relayPtyId)

  resolvePhysicalPtyId(id: string): string | null {
    try {
      return this.options.toRelayPtyId(id)
    } catch {
      return null
    }
  }

  rememberAccess(
    relayPtyId: string,
    value: TerminalSessionAuthorityPtyAccess | undefined,
    ptyIncarnationId: string | undefined
  ): void {
    this.accessStore.remember(relayPtyId, value, ptyIncarnationId)
  }

  expectAccess(relayPtyId: string, value: TerminalSessionAuthorityPtyAccess): void {
    this.accessStore.expect(relayPtyId, value)
  }

  mutationMode = (id: string): PtyMutationMode =>
    !this.isCutover(id) ? 'legacy' : this.currentAuthorityRoute(id) ? 'exact' : 'unavailable'

  writeExact(id: string, incarnationId: string, data: string): boolean {
    const relayPtyId = this.currentLegacyRoute(id, incarnationId)
    return Boolean(
      relayPtyId &&
      this.options.mux.notify('pty.dataExact', { id: relayPtyId, incarnationId, data })
    )
  }

  resizeExact(id: string, incarnationId: string, cols: number, rows: number): boolean {
    const relayPtyId = this.currentLegacyRoute(id, incarnationId)
    return Boolean(
      relayPtyId &&
      this.options.mux.notify('pty.resizeExact', { id: relayPtyId, incarnationId, cols, rows })
    )
  }

  async killExact(
    id: string,
    incarnationId: string,
    options: SshPtyShutdownOptions
  ): Promise<boolean> {
    const relayPtyId = this.currentLegacyRoute(id, incarnationId)
    if (!relayPtyId) {
      return false
    }
    const accepted = await this.requestAccepted(
      'pty.shutdownExact',
      {
        id: relayPtyId,
        incarnationId,
        immediate: options.immediate === true,
        keepHistory: options.keepHistory === true
      },
      options.deadlineMs
    )
    if (accepted && this.currentLegacyRoute(id, incarnationId) === relayPtyId) {
      this.options.livePtyIds.delete(id)
    }
    return accepted
  }

  sendSignalExact = (id: string, incarnationId: string, signal: string): Promise<boolean> =>
    this.requestLegacyAccepted(id, incarnationId, 'pty.sendSignalExact', { signal })
  clearBufferExact = (id: string, incarnationId: string): Promise<boolean> =>
    this.requestLegacyAccepted(id, incarnationId, 'pty.clearBufferExact')

  writeAuthorityExact = (
    id: string,
    access: TerminalSessionAuthorityPtyAccess,
    data: string
  ): boolean => this.notifyAuthority(id, access, PTY_DATA_AUTHORITY_EXACT_METHOD, { data })

  resizeAuthorityExact = (
    id: string,
    access: TerminalSessionAuthorityPtyAccess,
    cols: number,
    rows: number
  ): boolean => this.notifyAuthority(id, access, PTY_RESIZE_AUTHORITY_EXACT_METHOD, { cols, rows })

  async killAuthorityExact(
    id: string,
    access: TerminalSessionAuthorityPtyAccess,
    options: SshPtyShutdownOptions
  ): Promise<boolean> {
    const route = this.currentAuthorityRoute(id, access)
    if (!route) {
      return false
    }
    return await this.requestAccepted(
      PTY_SHUTDOWN_AUTHORITY_EXACT_METHOD,
      this.authorityParams(route, {
        immediate: options.immediate === true,
        keepHistory: options.keepHistory === true
      }),
      options.deadlineMs
    )
  }

  sendSignalAuthorityExact = (
    id: string,
    access: TerminalSessionAuthorityPtyAccess,
    signal: string
  ): Promise<boolean> =>
    this.requestAuthorityAccepted(id, access, PTY_SEND_SIGNAL_AUTHORITY_EXACT_METHOD, {
      signal
    })

  clearBufferAuthorityExact = (
    id: string,
    access: TerminalSessionAuthorityPtyAccess
  ): Promise<boolean> =>
    this.requestAuthorityAccepted(id, access, PTY_CLEAR_BUFFER_AUTHORITY_EXACT_METHOD)

  mutationToken = (id: string): object | null => {
    if (this.isCutover(id)) {
      const capability = this.options.authorityCapability
      if (
        !this.options.livePtyIds.has(id) ||
        (capability !== undefined &&
          (capability.version !== TERMINAL_AUTHORITY_EXACT_OPERATIONS_VERSION ||
            !capability.isCurrentProviderGeneration()))
      ) {
        return null
      }
      const relayPtyId = this.options.toRelayPtyId(id)
      return this.accessStore.accessForRelayPtyId(relayPtyId)
        ? this.accessStore.mutationToken()
        : null
    }
    const capability = this.options.legacyCapability
    if (
      !this.options.livePtyIds.has(id) ||
      (capability !== undefined &&
        (capability.version !== PTY_EXACT_OPERATION_PROTOCOL_VERSION ||
          !capability.isCurrentProviderGeneration()))
    ) {
      return null
    }
    return this.accessStore.mutationToken()
  }

  bindAccess(
    id: string,
    access: TerminalSessionAuthorityPtyAccess,
    ptyIncarnationId: string | undefined
  ): boolean {
    return this.accessStore.bind(id, access, ptyIncarnationId)
  }

  markListedProcess(
    id: string,
    access: TerminalSessionAuthorityPtyAccess | undefined,
    ptyIncarnationId: string | undefined
  ): object | undefined {
    return this.accessStore.markListedProcess(id, access, ptyIncarnationId)
  }

  private currentLegacyRoute(id: string, incarnationId: string): string | null {
    const capability = this.options.legacyCapability
    if (
      this.isCutover(id) ||
      capability?.version !== PTY_EXACT_OPERATION_PROTOCOL_VERSION ||
      !capability.isCurrentProviderGeneration() ||
      !this.options.livePtyIds.has(id)
    ) {
      return null
    }
    const relayPtyId = this.options.toRelayPtyId(id)
    return matchesPtyExactOperationIdentity(
      this.options.getPtyIncarnation(relayPtyId),
      incarnationId
    )
      ? relayPtyId
      : null
  }

  private currentAuthorityRoute(
    id: string,
    requestedAccess?: TerminalSessionAuthorityPtyAccess
  ): AuthorityRoute | null {
    const capability = this.options.authorityCapability
    if (
      capability?.version !== TERMINAL_AUTHORITY_EXACT_OPERATIONS_VERSION ||
      !capability.isCurrentProviderGeneration() ||
      !this.options.livePtyIds.has(id)
    ) {
      return null
    }
    const relayPtyId = this.options.toRelayPtyId(id)
    const access = this.accessStore.accessForRelayPtyId(relayPtyId)
    const requested = requestedAccess && parseTerminalSessionAuthorityPtyAccess(requestedAccess)
    if (
      !access ||
      (requestedAccess !== undefined && !requested) ||
      (requested && !sameTerminalSessionAuthorityPtyAccess(access, requested))
    ) {
      return null
    }
    return { relayPtyId, access: requested ?? access }
  }

  private isCutover = (id: string): boolean => this.accessStore.isCutover(id)

  private notifyAuthority(
    id: string,
    access: TerminalSessionAuthorityPtyAccess,
    method: typeof PTY_DATA_AUTHORITY_EXACT_METHOD | typeof PTY_RESIZE_AUTHORITY_EXACT_METHOD,
    params: Record<string, unknown>
  ): boolean {
    const route = this.currentAuthorityRoute(id, access)
    return Boolean(route && this.options.mux.notify(method, this.authorityParams(route, params)))
  }

  private async requestAuthorityAccepted(
    id: string,
    access: TerminalSessionAuthorityPtyAccess,
    method: AuthorityRequestMethod,
    params: Record<string, unknown> = {}
  ): Promise<boolean> {
    const route = this.currentAuthorityRoute(id, access)
    return route ? await this.requestAccepted(method, this.authorityParams(route, params)) : false
  }

  private authorityParams(
    route: AuthorityRoute,
    params: Record<string, unknown>
  ): Record<string, unknown> {
    return { id: route.relayPtyId, terminalSessionAuthorityAccess: route.access, ...params }
  }

  private async requestLegacyAccepted(
    id: string,
    incarnationId: string,
    method: 'pty.sendSignalExact' | 'pty.clearBufferExact',
    params: Record<string, unknown> = {}
  ): Promise<boolean> {
    const relayPtyId = this.currentLegacyRoute(id, incarnationId)
    return relayPtyId
      ? await this.requestAccepted(method, { id: relayPtyId, incarnationId, ...params })
      : false
  }

  private async requestAccepted(
    method: string,
    params: Record<string, unknown>,
    deadlineMs?: number
  ): Promise<boolean> {
    const deadline = sshRelayDeadlineOptions(deadlineMs)
    const result = (await (deadline
      ? this.options.mux.request(method, params, deadline)
      : this.options.mux.request(method, params))) as { accepted?: unknown } | null
    return result?.accepted === true
  }
}
