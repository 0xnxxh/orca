import type { SshChannelMultiplexer } from '../ssh/ssh-channel-multiplexer'
import type { IPtyProvider, PtyProcessInfo, PtySpawnOptions, PtySpawnResult } from './types'
import { toAppSshPtyId, toRelaySshPtyId } from './ssh-pty-id'
import { createSshPtyAppliedSizeReader } from './ssh-pty-applied-size'
import type {
  RemoteCliBridgeEnv,
  SshPtyDataCallback,
  SshPtyDeliveryPauseAdapter,
  SshPtyExpectedIdentity,
  SshPtyExitCallback,
  SshPtyReplayCallback
} from './ssh-pty-provider-contract'
import { SshPtyProviderOutputState } from './ssh-pty-provider-output-state'
import type { PtySourceRecoveryRequest, SshPtyAttachResult } from './ssh-pty-session-reattach'
import { SshPtySpawnExitRaceTracker } from './ssh-pty-spawn-exit-race'
import { SshAgentSessionCapabilities } from './ssh-agent-session-capabilities'
import type { PtyProcessInspection } from './pty-process-inspection'
import { shutdownSshPty, type SshPtyShutdownOptions } from './ssh-pty-shutdown-operation'
import type { TerminalSessionAuthorityPtyAccess } from '../../shared/terminal-session-authority-pty-access'
import {
  SshPtyAuthorityRouting,
  type SshPtyAuthorityExactOperationCapability,
  type SshPtyExactOperationCapability
} from './ssh-pty-authority-routing'
import { SshPtyLiveMembership } from './ssh-pty-live-membership'
import { SshPtyProcessInventory } from './ssh-pty-process-inventory'
import { SshPtySessionLifecycle } from './ssh-pty-session-lifecycle'
import {
  SshPtyHeldProducerPause,
  type SshPtyHeldProducerPauseCapability
} from './ssh-pty-held-producer-pause'
import type { TerminalAuthorityAppNamespaceAdmission } from '../session-authority/terminal-authority-app-outcome-host-contract'

/** Remote PTY provider that proxies IPtyProvider operations through the relay. */
export class SshPtyProvider implements IPtyProvider {
  private mux: SshChannelMultiplexer
  private connectionId: string
  private livePtyIds = new SshPtyLiveMembership()
  readonly getAppliedSize: NonNullable<IPtyProvider['getAppliedSize']>
  private readonly agentSessionCapabilities: SshAgentSessionCapabilities
  private spawnExitRaces = new SshPtySpawnExitRaceTracker()
  private readonly outputState: SshPtyProviderOutputState
  private readonly authorityRouting: SshPtyAuthorityRouting
  private readonly processInventory: SshPtyProcessInventory
  private readonly sessionLifecycle: SshPtySessionLifecycle
  private readonly heldProducerPause: SshPtyHeldProducerPause

  constructor(
    connectionId: string,
    mux: SshChannelMultiplexer,
    remoteCliBridgeEnv?: RemoteCliBridgeEnv,
    readonly providerGeneration = 1,
    exactOperationCapability?: SshPtyExactOperationCapability,
    authorityOutcomeDelivery = false,
    authorityExactOperationCapability?: SshPtyAuthorityExactOperationCapability,
    heldProducerPauseCapability?: SshPtyHeldProducerPauseCapability,
    terminalAuthorityAppAdmission?: TerminalAuthorityAppNamespaceAdmission
  ) {
    this.connectionId = connectionId
    this.mux = mux
    this.agentSessionCapabilities = new SshAgentSessionCapabilities(mux)
    this.getAppliedSize = createSshPtyAppliedSizeReader(mux, connectionId)
    this.authorityRouting = new SshPtyAuthorityRouting({
      mux,
      legacyCapability: exactOperationCapability,
      authorityCapability: authorityExactOperationCapability,
      livePtyIds: this.livePtyIds,
      toRelayPtyId: this.toRelayPtyId,
      getPtyIncarnation: (relayPtyId) => this.outputState.getPtyIncarnation(relayPtyId)
    })
    this.outputState = new SshPtyProviderOutputState(providerGeneration, {
      mux,
      toAppPtyId: (id) => this.toAppPtyId(id),
      livePtyIds: this.livePtyIds,
      authorityOutcomeDelivery,
      getTerminalSessionAuthorityAccess: (relayPtyId) =>
        this.authorityRouting.accessForRelayPtyId(relayPtyId),
      recordExit: (relayPtyId, incarnationId) => {
        this.spawnExitRaces.recordExit(relayPtyId, incarnationId)
        this.authorityRouting.recordExit(relayPtyId)
      }
    })
    this.heldProducerPause = new SshPtyHeldProducerPause({
      mux,
      capability: heldProducerPauseCapability,
      toRelayPtyId: this.toRelayPtyId,
      getPtyIncarnation: (relayPtyId) => this.outputState.getPtyIncarnation(relayPtyId)
    })
    this.processInventory = new SshPtyProcessInventory({
      mux,
      livePtyIds: this.livePtyIds,
      outputState: this.outputState,
      authorityRouting: this.authorityRouting,
      toAppPtyId: this.toAppPtyId,
      toRelayPtyId: this.toRelayPtyId
    })
    this.sessionLifecycle = new SshPtySessionLifecycle({
      mux,
      connectionId,
      remoteCliBridgeEnv,
      livePtyIds: this.livePtyIds,
      outputState: this.outputState,
      exitRaceTracker: this.spawnExitRaces,
      capabilities: this.agentSessionCapabilities,
      toRelayPtyId: this.toRelayPtyId,
      toAppPtyId: this.toAppPtyId,
      rememberAuthorityAccess: (relayPtyId, access) =>
        this.authorityRouting.rememberAccess(
          relayPtyId,
          access,
          this.outputState.getPtyIncarnation(relayPtyId)
        ),
      expectAuthorityAccess: (relayPtyId, access) =>
        this.authorityRouting.expectAccess(relayPtyId, access),
      terminalAuthorityAppAdmission
    })
  }

  dispose(): void {
    this.outputState.dispose()
    this.livePtyIds.clear()
    this.authorityRouting.dispose()
  }

  getConnectionId = (): string => this.connectionId

  canProvideAuthoritativeBufferSnapshot = (_id: string): boolean => false

  private toRelayPtyId = (id: string): string => toRelaySshPtyId(this.connectionId, id)

  private toAppPtyId = (id: string): string => toAppSshPtyId(this.connectionId, id)

  resolveTerminalSessionAuthorityPhysicalPtyId(id: string): string | null {
    return this.authorityRouting.resolvePhysicalPtyId(id)
  }

  getTerminalSessionAuthorityAccess(id: string): TerminalSessionAuthorityPtyAccess | null {
    const relayPtyId = this.authorityRouting.resolvePhysicalPtyId(id)
    return relayPtyId ? (this.authorityRouting.accessForRelayPtyId(relayPtyId) ?? null) : null
  }

  async spawn(opts: PtySpawnOptions): Promise<PtySpawnResult> {
    return await this.sessionLifecycle.spawn(opts)
  }

  async supportsAgentSessionClaims(options: { signal?: AbortSignal } = {}): Promise<boolean> {
    return await this.agentSessionCapabilities.supportsClaims(options)
  }

  providesAgentSessionOwnerListings(_ptyId: string): boolean {
    return this.agentSessionCapabilities.providesOwnerListings()
  }

  async supportsAgentSessionCreateOperations(
    options: { signal?: AbortSignal } = {}
  ): Promise<boolean> {
    return await this.agentSessionCapabilities.supportsCreateOperations(options)
  }

  async attach(id: string): Promise<void> {
    await this.sessionLifecycle.attach(id)
  }

  async attachForReconnect(
    id: string,
    expected?: SshPtyExpectedIdentity,
    sourceRecovery?: PtySourceRecoveryRequest
  ): Promise<SshPtyAttachResult> {
    return await this.sessionLifecycle.attachForReconnect(id, expected, sourceRecovery)
  }

  write(id: string, data: string): void {
    if (this.authorityRouting.mutationMode(id) !== 'legacy') {
      return
    }
    this.mux.notify('pty.data', { id: this.toRelayPtyId(id), data })
  }

  resize(id: string, cols: number, rows: number): void {
    if (this.authorityRouting.mutationMode(id) !== 'legacy') {
      return
    }
    this.mux.notify('pty.resize', { id: this.toRelayPtyId(id), cols, rows })
  }

  async shutdown(id: string, opts: SshPtyShutdownOptions): Promise<void> {
    if (this.authorityRouting.mutationMode(id) !== 'legacy') {
      throw new Error('terminal_authority_exact_operation_required')
    }
    await shutdownSshPty({ mux: this.mux, relayPtyId: this.toRelayPtyId(id), options: opts })
    this.livePtyIds.delete(id)
  }

  supportsExactPtyOperations = (id: string): boolean =>
    this.authorityRouting.mutationMode(id) === 'exact'
  getPtyMutationMode = (id: string): 'legacy' | 'exact' | 'unavailable' =>
    this.authorityRouting.mutationMode(id)
  killExact: NonNullable<IPtyProvider['killExact']> = (...args) =>
    this.authorityRouting.killExact(...args)
  writeExact: NonNullable<IPtyProvider['writeExact']> = (...args) =>
    this.authorityRouting.writeExact(...args)
  resizeExact: NonNullable<IPtyProvider['resizeExact']> = (...args) =>
    this.authorityRouting.resizeExact(...args)
  sendSignalExact: NonNullable<IPtyProvider['sendSignalExact']> = (...args) =>
    this.authorityRouting.sendSignalExact(...args)
  clearBufferExact: NonNullable<IPtyProvider['clearBufferExact']> = (...args) =>
    this.authorityRouting.clearBufferExact(...args)
  writeAuthorityExact: NonNullable<IPtyProvider['writeAuthorityExact']> = (...args) =>
    this.authorityRouting.writeAuthorityExact(...args)
  resizeAuthorityExact: NonNullable<IPtyProvider['resizeAuthorityExact']> = (...args) =>
    this.authorityRouting.resizeAuthorityExact(...args)
  killAuthorityExact: NonNullable<IPtyProvider['killAuthorityExact']> = (...args) =>
    this.authorityRouting.killAuthorityExact(...args)
  sendSignalAuthorityExact: NonNullable<IPtyProvider['sendSignalAuthorityExact']> = (...args) =>
    this.authorityRouting.sendSignalAuthorityExact(...args)
  clearBufferAuthorityExact: NonNullable<IPtyProvider['clearBufferAuthorityExact']> = (...args) =>
    this.authorityRouting.clearBufferAuthorityExact(...args)

  async sendSignal(id: string, signal: string): Promise<void> {
    if (this.authorityRouting.mutationMode(id) !== 'legacy') {
      throw new Error('terminal_authority_exact_operation_required')
    }
    await this.mux.request('pty.sendSignal', { id: this.toRelayPtyId(id), signal })
  }

  async getCwd(id: string): Promise<string> {
    const result = await this.mux.request('pty.getCwd', { id: this.toRelayPtyId(id) })
    return result as string
  }

  async getInitialCwd(id: string): Promise<string> {
    const result = await this.mux.request('pty.getInitialCwd', { id: this.toRelayPtyId(id) })
    return result as string
  }

  async clearBuffer(id: string): Promise<void> {
    if (this.authorityRouting.mutationMode(id) !== 'legacy') {
      throw new Error('terminal_authority_exact_operation_required')
    }
    await this.mux.request('pty.clearBuffer', { id: this.toRelayPtyId(id) })
  }

  async closeStartupQueryAuthority(id: string): Promise<number> {
    const result = (await this.mux.request('pty.closeStartupQueryAuthority', {
      id: this.toRelayPtyId(id)
    })) as { appliedSeq?: number }
    return result.appliedSeq ?? 0
  }

  acknowledgeDataEvent(id: string, charCount: number): void {
    this.mux.notify('pty.ackData', { id: this.toRelayPtyId(id), charCount })
  }

  async hasChildProcesses(id: string): Promise<boolean> {
    const result = await this.mux.request('pty.hasChildProcesses', { id: this.toRelayPtyId(id) })
    return result as boolean
  }

  async getForegroundProcess(id: string): Promise<string | null> {
    const result = await this.mux.request('pty.getForegroundProcess', { id: this.toRelayPtyId(id) })
    return result as string | null
  }

  async inspectProcess(id: string): Promise<PtyProcessInspection> {
    return (await this.mux.request('pty.inspectProcess', {
      id: this.toRelayPtyId(id)
    })) as PtyProcessInspection
  }

  async serialize(ids: string[]): Promise<string> {
    const result = await this.mux.request('pty.serialize', {
      ids: ids.map((id) => this.toRelayPtyId(id))
    })
    return result as string
  }

  async revive(state: string): Promise<void> {
    await this.mux.request('pty.revive', { state })
  }

  async listProcesses(opts?: { deadlineMs?: number }): Promise<PtyProcessInfo[]> {
    return await this.processInventory.list(opts?.deadlineMs)
  }

  hasPty = (id: string): boolean => this.livePtyIds.has(id)
  getPtyMutationRouteToken = (id: string): object | null => this.authorityRouting.mutationToken(id)

  bindTerminalSessionAuthorityAccess(
    id: string,
    authorityAccess: TerminalSessionAuthorityPtyAccess
  ): boolean {
    const relayPtyId = this.toRelayPtyId(id)
    return this.authorityRouting.bindAccess(
      id,
      authorityAccess,
      this.outputState.getPtyIncarnation(relayPtyId)
    )
  }

  async getDefaultShell(): Promise<string> {
    const result = await this.mux.request('pty.getDefaultShell')
    return result as string
  }

  async getProfiles(): Promise<{ name: string; path: string }[]> {
    const result = await this.mux.request('pty.getProfiles')
    return result as { name: string; path: string }[]
  }

  onData = (callback: SshPtyDataCallback): (() => void) => this.outputState.onData(callback)
  onRejectedData = (callback: SshPtyDataCallback): (() => void) =>
    this.outputState.onRejectedData(callback)
  onReplay = (callback: SshPtyReplayCallback): (() => void) => this.outputState.onReplay(callback)
  onExit = (callback: SshPtyExitCallback): (() => void) => this.outputState.onExit(callback)

  setPtyDeliveryPauseAdapter(adapter: SshPtyDeliveryPauseAdapter | null): void {
    this.outputState.setDeliveryPauseAdapter(adapter)
  }

  hasPtyDeliveryPauseAdapter(): boolean {
    return this.outputState.hasDeliveryPauseAdapter()
  }

  pauseProducer = (id: string): void => this.outputState.pause(this.toRelayPtyId(id))
  resumeProducer = (id: string): void => this.outputState.resume(this.toRelayPtyId(id))

  supportsExactHeldProducerPause: NonNullable<IPtyProvider['supportsExactHeldProducerPause']> = (
    ...args
  ) => this.heldProducerPause.supports(...args)
  acquireExactHeldProducerPause: NonNullable<IPtyProvider['acquireExactHeldProducerPause']> = (
    ...args
  ) => this.heldProducerPause.acquire(...args)
  releaseExactHeldProducerPause: NonNullable<IPtyProvider['releaseExactHeldProducerPause']> = (
    ...args
  ) => this.heldProducerPause.release(...args)

  closeOutputIntake(reason: string): void {
    this.mux.dispose('connection_lost')
    console.error('[ssh-pty-provider] closed after bounded output intake failure', { reason })
  }
}
