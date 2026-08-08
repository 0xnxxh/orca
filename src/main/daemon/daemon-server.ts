/* eslint-disable max-lines -- Why: one class owns the daemon socket protocol, routing, stream fanout, and session lifecycle. */
import { createServer, type Server, type Socket } from 'node:net'
import { createHash, randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { writeFileSync, chmodSync, unlinkSync } from 'node:fs'
import { StringDecoder } from 'node:string_decoder'
import { encodeNdjson, createNdjsonParser } from './ndjson'
import { TerminalHost, type TerminalHostOptions } from './terminal-host'
import { DaemonStreamDataBatcher } from './daemon-stream-data-batcher'
import {
  BackgroundTransientFactRelay,
  BACKGROUND_STREAM_DROP_ENABLED
} from './daemon-background-transient-facts'
import { extractHiddenStartupRendererQueryData } from '../../shared/terminal-reply-query-extraction'
import {
  recordDaemonStreamBacklogEvent,
  startDaemonStreamBacklogProbe
} from './daemon-stream-backlog-probe'
import { readCurrentProcessMacSystemResolverHealth } from '../network/macos-system-resolver-health'
import type { SubprocessHandle } from './session'
import { checkPtySpawnHealth } from './pty-subprocess'
import { createNoopDaemonFileLog, type DaemonFileLog } from './daemon-file-log'
import { isTuiAgent } from '../../shared/tui-agent-config'
import { parsePtyStartupIngressIntent } from '../../shared/pty-startup-ingress'
import { unlinkOwnedDaemonPidFile, unlinkOwnedDaemonTokenFile } from './daemon-spawner'
import {
  getDaemonSocketBindPath,
  publishDaemonSocketPath,
  readDaemonEndpointOwnershipState,
  unlinkOwnedDaemonSocketPath,
  type DaemonSocketIdentity
} from './daemon-endpoint-ownership'
import {
  CLEAN_DISCONNECT_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
  NOTIFY_PREFIX,
  SessionNotFoundError,
  TerminalAttachCanceledError,
  type HelloMessage,
  type DaemonRequest,
  type DaemonTransientFact
} from './types'
import {
  supportsExactHeldProducerPause,
  supportsPtyStreamBinding,
  supportsTerminalSessionAuthority
} from './daemon-protocol-version'
import { isPtyStreamBindingNonce } from '../../shared/pty-stream-binding-protocol'
import { isPtyIncarnationId } from '../../shared/pty-incarnation'
import { isPtyHeldProducerPauseToken } from '../providers/pty-provider-contract'
import {
  isAgentSessionExecutionClaim,
  isAgentSessionSurfaceBinding
} from '../../shared/agent-session-host-authority'
import { TerminalHistorySeedTransferRegistry } from './terminal-history-seed-transfer-registry'
import {
  parseTerminalSessionAuthorityPtyAccess,
  type TerminalSessionAuthorityPtyAccess
} from '../../shared/terminal-session-authority-pty-access'
import type { TerminalSessionAuthorityPtyOwner } from '../session-authority/terminal-session-authority-pty-owner'
import type {
  TerminalAuthorityPolicyConsumerConnection,
  TerminalAuthorityPolicyConsumerResolver,
  TerminalAuthorityPolicyConsumerSource
} from '../session-authority/terminal-session-authority-policy-consumers'
import type {
  TerminalAuthorityAuthenticatedNamespacePreparation,
  TerminalAuthorityAuthenticatedNamespaceSession
} from '../session-authority/terminal-session-authority-authenticated-consumers'
import type { TerminalAuthorityAuthenticatedConsumerTransport } from '../session-authority/terminal-session-authority-consumer-admission'
import { joinTerminalAuthorityRollbackFailure } from '../session-authority/terminal-session-authority-consumer-rollback-failure'
import { TerminalSessionAuthorityBoundaryAcceptances } from '../session-authority/terminal-session-authority-boundary-acceptance'
import {
  parseTerminalAuthorityNamespaceBoundaryAcceptance,
  parseTerminalAuthorityNamespaceOutcomeAck,
  sameTerminalAuthorityPolicyConsumer,
  type TerminalAuthorityNamespaceOutcomeBoundary,
  type TerminalAuthorityNamespaceOutcomePublication,
  type TerminalAuthorityPolicyConsumerIdentity
} from '../../shared/terminal-session-authority-consumer-transport'
import {
  parseDaemonHelloCapabilities,
  sameDaemonHelloCapabilities,
  TERMINAL_SESSION_AUTHORITY_HELLO_CAPABILITY,
  type DaemonHelloCapabilities,
  type DaemonTerminalAuthorityConsumerProofGrant
} from './daemon-hello-protocol'
import {
  TERMINAL_AUTHORITY_CONSUMER_PROOF_CAPABILITY,
  TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION,
  parseTerminalAuthorityNamespaceAdmissionCancellation,
  parseTerminalAuthorityNamespaceAdmissionProof
} from '../../shared/terminal-session-authority-consumer-proof'
import {
  TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_VERSION,
  parseTerminalAuthorityConsumerRetirementProof,
  parseTerminalAuthorityConsumerRetirementStart
} from '../../shared/terminal-session-authority-consumer-retirement'
import {
  DAEMON_TERMINAL_AUTHORITY_CONSUMER_CHALLENGE_REQUEST,
  DAEMON_TERMINAL_AUTHORITY_CONSUMER_CANCEL_REQUEST,
  DAEMON_TERMINAL_AUTHORITY_CONSUMER_GRANT_REQUEST,
  DAEMON_TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_CHALLENGE_REQUEST,
  DAEMON_TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_REQUEST,
  DAEMON_TERMINAL_AUTHORITY_CONSUMER_RESOLVE_NAMESPACE_REQUEST
} from './daemon-terminal-authority-consumer-requests'
import { terminalAuthorityHostAppConsumerId } from '../session-authority/terminal-session-authority-consumer-proof'

export type TerminalSessionAuthorityCapabilityReadiness = Readonly<{
  hostEffectConsumerInstalled(): boolean
}>

export type DaemonServerOptions = {
  socketPath: string
  tokenPath: string
  pidPath?: string
  launchNonce?: string
  startedAtMs?: number
  publishEndpointOwnership?: () => void
  /** Reported in the hello so a repaired PID record can carry the real owner's metadata. */
  entryPath?: string
  appVersion?: string
  spawnerExecPath?: string
  /** Direct-construction seam for protocol fixture tests; production never overrides it. */
  protocolVersion?: number
  onIdleShutdown?: () => void
  onRpcShutdown?: () => void
  /** Direct-construction-only controls; production uses the compiled initial-adoption timeout. */
  initialAdoptionTestConfig?: {
    timeoutMs: number
    clock: {
      setTimeout(callback: () => void, delayMs: number): unknown
      clearTimeout(handle: unknown): void
      now(): number
    }
  }
  ptySpawnHealthCheck?: () => Promise<void>
  preparePtySpawn?: () => Promise<void>
  // Why: login-session death detection (#7936) probes on PTY-exit bursts and fresh app connections.
  onPtySessionExit?: (sessionId: string) => void
  onAuthenticatedClientPair?: () => void
  log?: DaemonFileLog
  spawnSubprocess: (opts: {
    sessionId: string
    cols: number
    rows: number
    cwd?: string
    env?: Record<string, string>
    command?: string
    shellOverride?: string
  }) => SubprocessHandle
  terminalSessionAuthority?: TerminalHostOptions['terminalSessionAuthority']
  terminalSessionAuthorityCapabilityReadiness?: TerminalSessionAuthorityCapabilityReadiness
  onTerminalSessionAuthorityFailure?: TerminalHostOptions['onTerminalSessionAuthorityFailure']
}

function isDaemonConsumerProofGrant(
  capability: DaemonHelloCapabilities['terminalAuthorityConsumerProof']
): capability is DaemonTerminalAuthorityConsumerProofGrant {
  return Boolean(capability && 'version' in capability)
}

function authorityNamespaceKey(namespace: TerminalSessionAuthorityPtyAccess['namespace']): string {
  return JSON.stringify([namespace.authorityHostId, namespace.namespaceId])
}

function sameAuthorityNamespace(
  left: TerminalSessionAuthorityPtyAccess['namespace'],
  right: TerminalSessionAuthorityPtyAccess['namespace']
): boolean {
  return left.authorityHostId === right.authorityHostId && left.namespaceId === right.namespaceId
}

type ConnectedClient = {
  clientId: string
  controlSocket: Socket
  streamSocket: Socket | null
  authenticatedPairEstablished: boolean
  capabilities?: DaemonHelloCapabilities
  authorityConsumerTransport?: TerminalAuthorityAuthenticatedConsumerTransport
  authorityNamespaceSessions?: Map<string, AuthenticatedAuthorityNamespaceSession>
  authorityPendingPreparations?: Set<AuthenticatedAuthorityNamespacePreparation>
}

type AuthenticatedAuthorityNamespaceSession = Readonly<{
  session: TerminalAuthorityAuthenticatedNamespaceSession
  acceptances: TerminalSessionAuthorityBoundaryAcceptances
}>

type AuthenticatedAuthorityNamespacePreparation = {
  active: boolean
  preparation: TerminalAuthorityAuthenticatedNamespacePreparation | null
  acceptances: TerminalSessionAuthorityBoundaryAcceptances
  requestId: string
  namespace: TerminalSessionAuthorityPtyAccess['namespace']
  connectionGrantId: string
  consumer: TerminalAuthorityPolicyConsumerIdentity
}

type PendingPtySpawnPreparation = {
  canceled: boolean
  // Why: preparations are keyed by sessionId, but a control-socket close must
  // cancel only the disconnecting client's preps, not another client's (F4).
  clientId: string
}

type PendingShutdownReply = {
  start: () => void
}

type HeldProducerPauseLease = {
  sessionId: string
  incarnationId: string
  token: string
}

type HeldProducerPausePayload =
  | { mode: 'legacy' }
  | { mode: 'invalid' }
  | ({ mode: 'exact' } & HeldProducerPauseLease)

function parseHeldProducerPausePayload(payload: {
  sessionId: string
  incarnationId?: string
  heldPauseToken?: string
}): HeldProducerPausePayload {
  if (payload.incarnationId === undefined && payload.heldPauseToken === undefined) {
    return { mode: 'legacy' }
  }
  if (
    !isPtyIncarnationId(payload.incarnationId) ||
    !isPtyHeldProducerPauseToken(payload.heldPauseToken)
  ) {
    return { mode: 'invalid' }
  }
  return {
    mode: 'exact',
    sessionId: payload.sessionId,
    incarnationId: payload.incarnationId,
    token: payload.heldPauseToken
  }
}

function heldProducerPauseLeaseKey(lease: HeldProducerPauseLease): string {
  return JSON.stringify([lease.sessionId, lease.incarnationId, lease.token])
}

function hasTerminalSessionAuthorityCreateMetadata(payload: {
  terminalSessionAuthorityVersion?: unknown
  terminalSessionAuthorityOperationId?: unknown
  terminalSessionAuthorityAccess?: unknown
  worktreeId?: unknown
  paneKey?: unknown
  paneGeneration?: unknown
}): boolean {
  return (
    payload.terminalSessionAuthorityVersion !== undefined ||
    payload.terminalSessionAuthorityOperationId !== undefined ||
    payload.terminalSessionAuthorityAccess !== undefined ||
    payload.worktreeId !== undefined ||
    payload.paneKey !== undefined ||
    payload.paneGeneration !== undefined
  )
}

export class DaemonServer {
  // Why: survive long enough to adopt a first client pair, but don't orphan forever if the parent crashes first.
  private static readonly INITIAL_ADOPTION_TIMEOUT_MS = 2 * 60 * 1000
  private static readonly SHUTDOWN_REPLY_FLUSH_TIMEOUT_MS = 1_000
  private static readonly ENDPOINT_OWNERSHIP_POLL_MS = 30 * 1000
  private static readonly ENDPOINT_OWNERSHIP_LOSS_CONFIRMATIONS = 2
  private server: Server | null = null
  private token: string
  private host: TerminalHost
  private socketPath: string
  private tokenPath: string
  private pidPath: string | null
  private launchNonce: string | null
  private startedAtMs: number | null
  private publishEndpointOwnership: () => void
  private entryPath: string | null
  private appVersion: string | null
  private spawnerExecPath: string | null
  private ownedSocketIdentity: DaemonSocketIdentity | null = null
  private endpointOwnershipTimer: ReturnType<typeof setInterval> | null = null
  private endpointOwnershipLossStreak = 0
  private protocolVersion: number
  private onIdleShutdown: () => void
  private onRpcShutdown: () => void
  private onAuthenticatedClientPair: () => void
  private ptySpawnHealthCheck: () => Promise<void>
  private preparePtySpawn: () => Promise<void>
  private log: DaemonFileLog
  private transportSockets = new Set<Socket>()
  private createOrAttachInFlight = 0
  private idleShutdownState: 'running' | 'idle-shutdown-pending' | 'shutting-down' = 'running'
  private initialAdoptionTimer: unknown | null = null
  private initialAdoptionDeadlineMs: number | null = null
  private retirementRequested = false
  private shutdownPromise: Promise<void> | null = null
  private ordinaryShutdownServerClose: Promise<void> | null = null
  private pendingShutdownReplies = new Map<string, PendingShutdownReply>()
  private initialAdoptionTimeoutMs: number
  private lifecycleClock: NonNullable<DaemonServerOptions['initialAdoptionTestConfig']>['clock']

  private clients = new Map<string, ConnectedClient>()
  private streamDataBatcher = new DaemonStreamDataBatcher(
    (clientId) => this.clients.get(clientId),
    {
      isSessionDroppable: (sessionId) =>
        BACKGROUND_STREAM_DROP_ENABLED && this.transientFactRelay.isBackgrounded(sessionId),
      salvageDroppedData: (dropped) => {
        if (!dropped.includes('\x1b')) {
          return ''
        }
        const extracted = extractHiddenStartupRendererQueryData(dropped, '')
        return (
          extracted.statelessQueryData + extracted.statefulQueryData + extracted.oscColorQueryData
        )
      }
    }
  )
  private transientFactRelay = new BackgroundTransientFactRelay((sessionId, fact) => {
    this.enqueueLegacyTransientFact(sessionId, fact)
  })
  private streamClientIdBySessionId = new Map<string, string>()
  private lastInputAtBySessionId = new Map<string, number>()
  private pendingPtySpawnPreparations = new Map<string, Set<PendingPtySpawnPreparation>>()
  private pendingAuthoritySemanticOutcomes = new Set<Promise<boolean>>()
  private heldProducerPauseLeasesByClient = new Map<string, Map<string, HeldProducerPauseLease>>()
  private historySeedTransfers = new TerminalHistorySeedTransferRegistry()
  private stopStreamBacklogProbe: () => void = () => {}
  private readonly terminalSessionAuthorityEnabled: boolean
  private readonly terminalSessionAuthorityPtyOwner: TerminalSessionAuthorityPtyOwner | null
  private readonly terminalSessionAuthorityHostId: string | null
  private readonly removeTerminalSessionAuthorityHostEffectApplier: () => void
  private readonly terminalSessionAuthorityCapabilityReadiness:
    | TerminalSessionAuthorityCapabilityReadiness
    | undefined
  private readonly onTerminalSessionAuthorityFailure:
    | NonNullable<DaemonServerOptions['onTerminalSessionAuthorityFailure']>
    | undefined

  // Why: bypass batching within this window so keystroke echo/redraws skip the daemon's fixed batch delay.
  private static readonly INTERACTIVE_OUTPUT_WINDOW_MS = 100
  private static readonly INTERACTIVE_OUTPUT_MAX_CHARS = 1024

  constructor(opts: DaemonServerOptions) {
    this.socketPath = opts.socketPath
    this.tokenPath = opts.tokenPath
    this.pidPath = opts.pidPath ?? null
    this.protocolVersion = opts.protocolVersion ?? PROTOCOL_VERSION
    this.launchNonce =
      opts.launchNonce ??
      (this.protocolVersion >= CLEAN_DISCONNECT_PROTOCOL_VERSION ? randomUUID() : null)
    this.startedAtMs =
      opts.startedAtMs ??
      (this.protocolVersion >= CLEAN_DISCONNECT_PROTOCOL_VERSION
        ? Date.now() - process.uptime() * 1000
        : null)
    this.publishEndpointOwnership = opts.publishEndpointOwnership ?? (() => {})
    this.entryPath = opts.entryPath ?? null
    this.appVersion = opts.appVersion ?? null
    this.spawnerExecPath = opts.spawnerExecPath ?? null
    this.onIdleShutdown = opts.onIdleShutdown ?? (() => {})
    this.onRpcShutdown = opts.onRpcShutdown ?? (() => {})
    this.initialAdoptionTimeoutMs =
      opts.initialAdoptionTestConfig?.timeoutMs ?? DaemonServer.INITIAL_ADOPTION_TIMEOUT_MS
    this.lifecycleClock = opts.initialAdoptionTestConfig?.clock ?? {
      setTimeout: (callback, delayMs) => {
        const timer = setTimeout(callback, delayMs)
        timer.unref()
        return timer
      },
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      now: () => Date.now()
    }
    this.token = randomUUID()
    this.terminalSessionAuthorityEnabled = opts.terminalSessionAuthority !== undefined
    this.terminalSessionAuthorityPtyOwner = opts.terminalSessionAuthority?.ptyOwner ?? null
    this.terminalSessionAuthorityHostId = opts.terminalSessionAuthority?.authorityHostId ?? null
    this.terminalSessionAuthorityCapabilityReadiness =
      opts.terminalSessionAuthorityCapabilityReadiness
    this.onTerminalSessionAuthorityFailure = opts.onTerminalSessionAuthorityFailure
    this.onAuthenticatedClientPair = opts.onAuthenticatedClientPair ?? (() => {})
    this.host = new TerminalHost({
      spawnSubprocess: opts.spawnSubprocess,
      ...(opts.onPtySessionExit ? { onSessionReaped: opts.onPtySessionExit } : {}),
      ...(opts.terminalSessionAuthority
        ? { terminalSessionAuthority: opts.terminalSessionAuthority }
        : {}),
      ...(opts.onTerminalSessionAuthorityFailure
        ? { onTerminalSessionAuthorityFailure: opts.onTerminalSessionAuthorityFailure }
        : {})
    })
    const installHostEffectApplier = this.terminalSessionAuthorityPtyOwner?.installHostEffectApplier
    this.removeTerminalSessionAuthorityHostEffectApplier = installHostEffectApplier
      ? installHostEffectApplier.call(this.terminalSessionAuthorityPtyOwner, {
          ensureBindingRetired: (access, reason) =>
            this.host.ensureAuthorityBindingRetired(access, reason)
        })
      : () => {}
    this.ptySpawnHealthCheck = opts.ptySpawnHealthCheck ?? checkPtySpawnHealth
    this.preparePtySpawn = opts.preparePtySpawn ?? (() => Promise.resolve())
    this.stopStreamBacklogProbe = startDaemonStreamBacklogProbe(() => ({
      clients: Array.from(this.clients.values(), (client) => ({
        clientId: client.clientId,
        socketBufferedBytes: client.streamSocket?.writableLength ?? 0,
        batcherQueuedChars: this.streamDataBatcher.queuedCharsForClient(client.clientId)
      })),
      backgroundedSessionIdSuffixes: this.transientFactRelay.backgroundedSessionIdSuffixes()
    }))
    this.log = opts.log ?? createNoopDaemonFileLog()
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((socket) => this.handleConnection(socket))
      const onListenError = (err: Error): void => {
        reject(err)
      }

      this.server.once('error', onListenError)

      // Why: bind a private name and hard-link it into place, so libuv's close-time unlink
      // can only ever remove our own bind name — never a replacement daemon's endpoint.
      const bindPath =
        process.platform === 'win32' ? this.socketPath : getDaemonSocketBindPath(this.socketPath)

      this.server.listen(bindPath, () => {
        // Why: drop the startup error listener after bind so it doesn't retain this closure.
        this.server?.off('error', onListenError)
        try {
          // Why: tighten the mode on the private bind name so the endpoint is never reachable
          // at the canonical path with default permissions, even briefly.
          chmodSync(bindPath, 0o600)
        } catch {
          // Best-effort on platforms that support it
        }
        let publishedOwnership = false
        try {
          // Why: the exclusive link is the endpoint claim, and the PID/nonce record must
          // exist before the token makes this listener adoptable.
          this.ownedSocketIdentity = publishDaemonSocketPath(bindPath, this.socketPath)
          this.publishEndpointOwnership()
          publishedOwnership = true
          writeFileSync(this.tokenPath, this.token, { mode: 0o600 })
        } catch (error) {
          // Why: roll back only a record we actually wrote. Losing the endpoint claim means
          // the record at that path belongs to the incumbent daemon, and even the ownership-
          // checked unlink briefly renames it aside — enough to strand a live daemon's record.
          if (publishedOwnership && this.pidPath && this.launchNonce) {
            unlinkOwnedDaemonPidFile(this.pidPath, process.pid, this.launchNonce)
          }
          unlinkOwnedDaemonSocketPath(this.socketPath, this.ownedSocketIdentity)
          this.ownedSocketIdentity = null
          const server = this.server
          this.server = null
          // Why: settle before close — an already-accepted connection defers the close
          // callback indefinitely, and start() has no timeout of its own.
          reject(error)
          server?.close()
          if (process.platform !== 'win32') {
            try {
              unlinkSync(bindPath)
            } catch {
              // Already consumed by a successful link, or never created.
            }
          }
          return
        }
        if (this.protocolVersion >= CLEAN_DISCONNECT_PROTOCOL_VERSION) {
          // Why: a parent crash before the first full client pair must not leave an empty daemon alive forever.
          this.armInitialAdoptionTimeout()
        }
        this.startEndpointOwnershipWatch()
        resolve()
      })
    })
  }

  async shutdown(): Promise<void> {
    if (this.shutdownPromise) {
      return this.shutdownPromise
    }
    const serverClose = this.beginOrdinaryShutdownFence()
    this.shutdownPromise = this.finishOrdinaryShutdown(serverClose)
    return this.shutdownPromise
  }

  private beginOrdinaryShutdownFence(): Promise<void> {
    this.idleShutdownState = 'shutting-down'
    this.cancelInitialAdoptionTimer()
    this.ordinaryShutdownServerClose ??= this.beginServerClose()
    return this.ordinaryShutdownServerClose
  }

  private async finishOrdinaryShutdown(serverClose: Promise<void>): Promise<void> {
    this.unlinkOwnedEndpointArtifacts()
    await this.disposeDaemonResources()
    await serverClose
  }

  private async finishRpcShutdown(serverClose: Promise<void>): Promise<void> {
    await this.finishOrdinaryShutdown(serverClose)
    this.onRpcShutdown()
  }

  private unlinkOwnedEndpointArtifacts(): void {
    // Why: ownership checks prevent removing a late replacement's token, PID record or endpoint.
    unlinkOwnedDaemonTokenFile(this.tokenPath, this.token)
    if (this.pidPath && this.launchNonce) {
      unlinkOwnedDaemonPidFile(this.pidPath, process.pid, this.launchNonce)
    }
    // Why: we bound a private name, so libuv unlinks nothing at the canonical path — this
    // is the only removal of our endpoint, and it is skipped once someone else owns it.
    unlinkOwnedDaemonSocketPath(this.socketPath, this.ownedSocketIdentity)
    this.ownedSocketIdentity = null
  }

  private startEndpointOwnershipWatch(): void {
    if (process.platform === 'win32' || !this.ownedSocketIdentity) {
      return
    }
    this.endpointOwnershipTimer = setInterval(
      () => this.checkEndpointOwnership(),
      DaemonServer.ENDPOINT_OWNERSHIP_POLL_MS
    )
    // Why: a liveness poll must never be the reason the process cannot exit.
    this.endpointOwnershipTimer.unref()
  }

  private stopEndpointOwnershipWatch(): void {
    if (this.endpointOwnershipTimer === null) {
      return
    }
    clearInterval(this.endpointOwnershipTimer)
    this.endpointOwnershipTimer = null
  }

  /**
   * Retires a daemon that no longer owns the canonical endpoint.
   *
   * Why: a daemon whose endpoint name was taken over keeps hosting PTYs that no client can
   * reach through the socket, which reads to the user as terminals that acknowledge input and
   * never run it. Retirement drains rather than kills: live sessions finish, and the process
   * exits once idle instead of surviving as an unreachable orphan.
   */
  private checkEndpointOwnership(): void {
    if (process.platform === 'win32' || !this.ownedSocketIdentity || this.shutdownPromise) {
      return
    }
    const state = readDaemonEndpointOwnershipState(this.socketPath, this.ownedSocketIdentity)
    if (state === 'owned') {
      this.endpointOwnershipLossStreak = 0
      return
    }
    if (state === 'indeterminate') {
      // Why: an inconclusive stat proves nothing. Retiring on EACCES or EIO would take down a
      // daemon that is still serving every terminal on the machine. Reset the streak too, so
      // the confirmations we act on are consecutive rather than merely cumulative.
      this.endpointOwnershipLossStreak = 0
      return
    }
    this.endpointOwnershipLossStreak++
    // Why: a replacement publishes by unlink-then-link, so a single observation can land in
    // that gap. Require the loss to persist before acting on it.
    if (this.endpointOwnershipLossStreak < DaemonServer.ENDPOINT_OWNERSHIP_LOSS_CONFIRMATIONS) {
      return
    }
    if (this.retirementRequested) {
      return
    }
    this.log.log('endpoint-ownership-lost', { socketPath: this.socketPath })
    console.warn(
      '[daemon] Endpoint ownership lost to another daemon — retiring once existing sessions end'
    )
    this.ownedSocketIdentity = null
    this.retirementRequested = true
    this.reevaluateIdleShutdown()
  }

  private async disposeDaemonResources(): Promise<void> {
    this.stopEndpointOwnershipWatch()
    this.stopStreamBacklogProbe()
    this.transientFactRelay.dispose()
    this.cancelAllPendingPtySpawnPreparations()
    await Promise.allSettled(this.pendingAuthoritySemanticOutcomes)
    let hostDisposeError: unknown
    try {
      await this.host.dispose()
    } catch (err) {
      // Why: an unreapable child must not block daemon exit — post-exit it reparents to init anyway.
      this.log.log('shutdown-dispose-failed', {
        error: err instanceof Error ? err.message : String(err)
      })
      hostDisposeError = err
    }
    this.removeTerminalSessionAuthorityHostEffectApplier()
    this.streamDataBatcher.clear()
    this.historySeedTransfers.dispose()
    this.pendingShutdownReplies.clear()
    this.heldProducerPauseLeasesByClient.clear()
    this.pendingAuthoritySemanticOutcomes.clear()

    for (const [, client] of this.clients) {
      this.releaseAuthenticatedPolicyTransport(client)
      client.controlSocket.destroy()
      client.streamSocket?.destroy()
    }
    this.clients.clear()
    for (const socket of this.transportSockets) {
      socket.destroy()
    }
    this.transportSockets.clear()
    if (hostDisposeError && this.terminalSessionAuthorityEnabled) {
      throw hostDisposeError
    }
  }

  private beginServerClose(): Promise<void> {
    const server = this.server
    this.server = null
    if (!server) {
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      // Why: close synchronously before any awaited cleanup so no new transport enters after the empty proof.
      server.close(() => {
        // Why: libuv unlinks the path this server bound, which is our private bind name and
        // is already gone. The canonical endpoint is removed by unlinkOwnedEndpointArtifacts,
        // under an ownership check, so closing late cannot delete a replacement's endpoint.
        resolve()
      })
    })
  }

  private isIdle(): boolean {
    return (
      this.transportSockets.size === 0 &&
      this.clients.size === 0 &&
      this.createOrAttachInFlight === 0 &&
      this.host.listSessions().length === 0
    )
  }

  private reevaluateIdleShutdown(): void {
    if (this.idleShutdownState !== 'running') {
      return
    }
    if (this.retirementRequested) {
      this.cancelInitialAdoptionTimer()
      if (this.isIdle()) {
        this.beginIdleShutdown()
      }
      return
    }
    if (!this.isIdle() || this.initialAdoptionDeadlineMs === null) {
      this.cancelInitialAdoptionTimer()
      return
    }
    if (this.initialAdoptionTimer !== null) {
      return
    }
    const remainingMs = Math.max(0, this.initialAdoptionDeadlineMs - this.lifecycleClock.now())
    if (remainingMs === 0) {
      this.initialAdoptionDeadlineMs = null
      this.retirementRequested = true
      this.beginIdleShutdown()
      return
    }
    this.initialAdoptionTimer = this.lifecycleClock.setTimeout(() => {
      this.initialAdoptionTimer = null
      this.initialAdoptionDeadlineMs = null
      this.retirementRequested = true
      this.beginIdleShutdown()
    }, remainingMs)
  }

  private armInitialAdoptionTimeout(): void {
    this.initialAdoptionDeadlineMs = this.lifecycleClock.now() + this.initialAdoptionTimeoutMs
    this.reevaluateIdleShutdown()
  }

  private cancelInitialAdoptionTimer(): void {
    if (this.initialAdoptionTimer === null) {
      return
    }
    this.lifecycleClock.clearTimeout(this.initialAdoptionTimer)
    this.initialAdoptionTimer = null
  }

  private beginIdleShutdown(): void {
    this.initialAdoptionTimer = null
    if (this.idleShutdownState !== 'running') {
      return
    }
    this.idleShutdownState = 'idle-shutdown-pending'
    if (!this.isIdle()) {
      // Why: work admitted before the fence wins; clear pending state to keep it usable.
      this.idleShutdownState = 'running'
      this.reevaluateIdleShutdown()
      return
    }

    this.idleShutdownState = 'shutting-down'
    // beginServerClose() runs synchronously up to server.close() before any yield to a racing connection.
    const serverClose = this.beginServerClose()
    this.shutdownPromise = this.finishIdleShutdown(serverClose)
  }

  private async finishIdleShutdown(serverClose: Promise<void>): Promise<void> {
    this.unlinkOwnedEndpointArtifacts()
    await this.disposeDaemonResources()
    await serverClose
    this.onIdleShutdown()
  }

  private handleConnection(socket: Socket): void {
    this.cancelInitialAdoptionTimer()
    this.transportSockets.add(socket)
    const removeTransport = (): void => {
      this.transportSockets.delete(socket)
      this.reevaluateIdleShutdown()
    }
    socket.once('close', removeTransport)
    socket.on('error', () => socket.destroy())

    if (this.idleShutdownState !== 'running') {
      // Why: a connection accepted just before close() gets an explicit retry signal instead of dying mid-auth.
      socket.end(
        encodeNdjson({
          type: 'hello',
          ok: false,
          error: 'Daemon temporarily unavailable; reconnect',
          retryable: true
        })
      )
      return
    }
    // Why: keep UTF-8 sequences intact across socket chunks before NDJSON parsing.
    const decoder = new StringDecoder('utf8')
    const parser = createNdjsonParser(
      (msg) => {
        void this.handleFirstMessage(socket, msg, parser).catch((error) => {
          this.log.log('client-hello-rejected', {
            reason: error instanceof Error ? error.message : String(error)
          })
          socket.destroy()
        })
      },
      () => {
        socket.destroy()
      }
    )

    socket.on('data', (chunk) => parser.feed(decoder.write(chunk)))
  }

  private async handleFirstMessage(
    socket: Socket,
    msg: unknown,
    _parser: ReturnType<typeof createNdjsonParser>
  ): Promise<void> {
    const hello = msg as HelloMessage
    if (hello.type !== 'hello') {
      this.log.log('client-hello-rejected', { reason: 'expected-hello' })
      socket.write(encodeNdjson({ type: 'hello', ok: false, error: 'Expected hello' }))
      socket.destroy()
      return
    }

    if (hello.version !== this.protocolVersion) {
      this.log.log('client-hello-rejected', {
        reason: 'protocol-mismatch',
        clientVersion: hello.version
      })
      socket.write(
        encodeNdjson({
          type: 'hello',
          ok: false,
          error: 'Protocol version mismatch'
        })
      )
      socket.destroy()
      return
    }

    if (hello.token !== this.token) {
      this.log.log('client-hello-rejected', {
        reason: 'invalid-token',
        role: hello.role
      })
      socket.write(encodeNdjson({ type: 'hello', ok: false, error: 'Invalid token' }))
      socket.destroy()
      return
    }

    const capabilities = this.negotiateHelloCapabilities(hello.capabilities)
    const existingControl = hello.role === 'stream' ? this.clients.get(hello.clientId) : undefined
    const capabilitiesMatchControl =
      existingControl === undefined ||
      sameDaemonHelloCapabilities(existingControl.capabilities ?? {}, capabilities)

    this.log.log('client-hello-accepted', {
      role: hello.role,
      clientId: hello.clientId
    })
    const response = encodeNdjson({
      type: 'hello',
      ok: true,
      ...(capabilities.terminalSessionAuthority !== undefined ||
      capabilities.terminalAuthorityConsumerProof !== undefined
        ? { capabilities }
        : {}),
      ...(this.launchNonce && this.startedAtMs
        ? {
            daemonIdentity: {
              pid: process.pid,
              startedAtMs: this.startedAtMs,
              launchNonce: this.launchNonce,
              ...(this.entryPath ? { entryPath: this.entryPath } : {}),
              ...(this.appVersion ? { appVersion: this.appVersion } : {}),
              ...(this.spawnerExecPath ? { spawnerExecPath: this.spawnerExecPath } : {})
            }
          }
        : {})
    })

    if (hello.role === 'stream' && (!existingControl || !capabilitiesMatchControl)) {
      socket.end(response)
      return
    }
    if (hello.role === 'control') {
      socket.write(response)
      const previous = this.clients.get(hello.clientId)
      if (previous) {
        this.releaseHeldProducerPausesForClient(hello.clientId)
      }
      const client: ConnectedClient = {
        clientId: hello.clientId,
        controlSocket: socket,
        streamSocket: null,
        authenticatedPairEstablished: false,
        capabilities
      }
      this.clients.set(hello.clientId, client)
      this.setupControlSocket(socket, hello.clientId)
      if (previous) {
        // Why: reconnect reuses clientId before stale close fires; cancel the old owner's preflight at handoff.
        this.cancelPendingPtySpawnPreparationsForClient(hello.clientId)
        this.historySeedTransfers.clearOwner(hello.clientId)
        this.recordFullyAuthenticatedDisconnect(previous.authenticatedPairEstablished)
        this.releaseAuthenticatedPolicyTransport(previous)
        // Why: tear down the old sockets after installing the new owner so a stale close can't delete the replacement.
        previous.streamSocket?.destroy()
        previous.controlSocket.destroy()
      }
    } else if (hello.role === 'stream') {
      const client = this.clients.get(hello.clientId)
      if (!client) {
        // Why: a stream socket is meaningless without its control socket; drop the orphan.
        socket.destroy()
        return
      }
      this.setupStreamSocket(socket, client)
      client.authenticatedPairEstablished = true
      if (isDaemonConsumerProofGrant(client.capabilities?.terminalAuthorityConsumerProof)) {
        this.installAuthenticatedPolicyTransport(client)
      }
      socket.write(response)
      // Why: one-shot health probes authenticate only a control socket; they are not fresh app activity.
      this.onAuthenticatedClientPair()
      // A complete app connection (unlike a probe) re-owns the endpoint and cancels pending retirement.
      this.initialAdoptionDeadlineMs = null
      this.retirementRequested = false
      this.cancelInitialAdoptionTimer()
    }
  }

  private negotiateHelloCapabilities(requested: unknown): DaemonHelloCapabilities {
    const parsed = parseDaemonHelloCapabilities(requested)
    if (
      parsed.terminalSessionAuthority !== TERMINAL_SESSION_AUTHORITY_HELLO_CAPABILITY ||
      !this.terminalSessionAuthorityAdmissionReady()
    ) {
      return {}
    }
    const proof = parsed.terminalAuthorityConsumerProof
    if (proof) {
      if (
        'versions' in proof &&
        proof.versions.includes(TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION) &&
        this.terminalSessionAuthorityHostId
      ) {
        return {
          terminalSessionAuthority: TERMINAL_SESSION_AUTHORITY_HELLO_CAPABILITY,
          terminalAuthorityConsumerProof: {
            version: TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION,
            authorityHostId: this.terminalSessionAuthorityHostId,
            ...(proof.retirementVersions?.includes(TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_VERSION)
              ? { retirementVersion: TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_VERSION }
              : {})
          }
        }
      }
      return {}
    }
    // Why a proofless peer negotiates nothing: it would otherwise name its own consumer identity, and
    // a client-chosen label must never reach a durable authority claim. It stays on the legacy path.
    return {}
  }

  private terminalSessionAuthorityAdmissionReady(): boolean {
    if (
      !supportsTerminalSessionAuthority(this.protocolVersion) ||
      !this.terminalSessionAuthorityEnabled ||
      !this.terminalSessionAuthorityCapabilityReadiness
    ) {
      return false
    }
    try {
      return this.terminalSessionAuthorityCapabilityReadiness.hostEffectConsumerInstalled()
    } catch {
      return false
    }
  }

  private assertAuthorityPolicyAdmission(
    client: ConnectedClient | undefined,
    value: unknown
  ): TerminalAuthorityPolicyConsumerConnection {
    const access = parseTerminalSessionAuthorityPtyAccess(value)
    const authenticated = access
      ? client?.authorityNamespaceSessions?.get(authorityNamespaceKey(access.namespace))
      : undefined
    if (
      access &&
      authenticated &&
      client?.authenticatedPairEstablished &&
      client.streamSocket &&
      authenticated.session.policyConsumer.isInstalled(access.namespace)
    ) {
      authenticated.session.policyConsumer.assertInstalled(access.namespace)
      return authenticated.session.policyConsumer
    }
    throw new Error('terminal session authority policy admission is unavailable')
  }

  private installAuthenticatedPolicyTransport(client: ConnectedClient): void {
    this.releaseAuthenticatedPolicyTransport(client)
    const token = Object.freeze({})
    client.authorityConsumerTransport = Object.freeze({
      connectionGrantId: randomUUID(),
      principal: `daemon-token:v1:${createHash('sha256').update(this.token).digest('base64url')}`,
      capability: TERMINAL_AUTHORITY_CONSUMER_PROOF_CAPABILITY,
      token
    })
    client.authorityNamespaceSessions = new Map()
    client.authorityPendingPreparations = new Set()
  }

  private releaseAuthenticatedPolicyTransport(client: ConnectedClient): void {
    const transport = client.authorityConsumerTransport
    client.authorityConsumerTransport = undefined
    for (const pending of client.authorityPendingPreparations ?? []) {
      pending.active = false
      pending.acceptances.close()
      const preparation = pending.preparation
      if (preparation) {
        const cause = new Error('terminal authority consumer transport released during admission')
        void joinTerminalAuthorityRollbackFailure(cause, () => preparation.rollback()).catch(
          (failure) => {
            if (failure !== cause) {
              this.reportTerminalSessionAuthorityFailure(failure)
            }
          }
        )
      }
    }
    client.authorityPendingPreparations?.clear()
    for (const installed of client.authorityNamespaceSessions?.values() ?? []) {
      installed.acceptances.close()
      installed.session.disconnect()
    }
    client.authorityNamespaceSessions?.clear()
    client.authorityPendingPreparations = undefined
    client.authorityNamespaceSessions = undefined
    if (transport) {
      this.terminalSessionAuthorityPtyOwner?.releaseAuthenticatedPolicyConsumerTransport(
        transport.token
      )
    }
  }

  private reportTerminalSessionAuthorityFailure(error: unknown): void {
    const failure = error instanceof Error ? error : new Error(String(error))
    const causes =
      failure instanceof AggregateError
        ? failure.errors.map((cause) => (cause instanceof Error ? cause.message : String(cause)))
        : undefined
    this.log.log('terminal-session-authority-rollback-failed', {
      error: failure.message,
      ...(causes ? { causes } : {})
    })
    this.onTerminalSessionAuthorityFailure?.(failure)
  }

  private requireAuthenticatedConsumerTransport(
    client: ConnectedClient | undefined
  ): TerminalAuthorityAuthenticatedConsumerTransport {
    const capability = client?.capabilities?.terminalAuthorityConsumerProof
    const transport = client?.authorityConsumerTransport
    if (
      !client?.authenticatedPairEstablished ||
      !client.streamSocket ||
      !isDaemonConsumerProofGrant(capability) ||
      !transport
    ) {
      throw new Error('terminal authority consumer proof transport is unavailable')
    }
    return transport
  }

  private requireAuthenticatedConsumerRetirementTransport(
    client: ConnectedClient | undefined
  ): TerminalAuthorityAuthenticatedConsumerTransport {
    const capability = client?.capabilities?.terminalAuthorityConsumerProof
    if (
      !isDaemonConsumerProofGrant(capability) ||
      capability.retirementVersion !== TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_VERSION
    ) {
      throw new Error('terminal authority consumer retirement is unsupported')
    }
    return this.requireAuthenticatedConsumerTransport(client)
  }

  private authenticatedPolicyConsumerResolver(
    client: ConnectedClient
  ): TerminalAuthorityPolicyConsumerResolver {
    const transport = this.requireAuthenticatedConsumerTransport(client)
    return Object.freeze({
      forNamespace: (namespace: TerminalSessionAuthorityPtyAccess['namespace']) => {
        if (
          this.clients.get(client.clientId) !== client ||
          client.authorityConsumerTransport?.token !== transport.token
        ) {
          throw new Error('terminal authority consumer proof transport is stale')
        }
        const installed = client.authorityNamespaceSessions?.get(authorityNamespaceKey(namespace))
        if (!installed) {
          throw new Error('terminal authority namespace consumer is not installed')
        }
        installed.session.policyConsumer.assertInstalled(namespace)
        return installed.session.policyConsumer
      }
    })
  }

  private publishAuthenticatedAuthorityEvent(
    client: ConnectedClient,
    namespaceId: string,
    event: 'terminalAuthorityNamespaceOutcomeBoundary' | 'terminalAuthorityNamespaceOutcome',
    payload:
      | TerminalAuthorityNamespaceOutcomeBoundary
      | TerminalAuthorityNamespaceOutcomePublication
  ): Promise<void> {
    this.requireAuthenticatedConsumerTransport(client)
    const sessionId = `authority-outcomes:${namespaceId}`
    return event === 'terminalAuthorityNamespaceOutcomeBoundary'
      ? this.streamDataBatcher.enqueueSettledControlEvent(client.clientId, sessionId, {
          type: 'event',
          event,
          sessionId,
          payload: payload as TerminalAuthorityNamespaceOutcomeBoundary
        })
      : this.streamDataBatcher.enqueueSettledControlEvent(client.clientId, sessionId, {
          type: 'event',
          event,
          sessionId,
          payload: payload as TerminalAuthorityNamespaceOutcomePublication
        })
  }

  private failAuthenticatedAuthorityNamespace(
    client: ConnectedClient,
    namespace: TerminalSessionAuthorityPtyAccess['namespace'],
    _error: Error
  ): void {
    const key = authorityNamespaceKey(namespace)
    const installed = client.authorityNamespaceSessions?.get(key)
    if (!installed) {
      return
    }
    client.authorityNamespaceSessions?.delete(key)
    installed.acceptances.close()
    installed.session.disconnect()
  }

  private setupControlSocket(socket: Socket, clientId: string): void {
    // Why: decode as a UTF-8 stream so emoji/Unicode split across chunks isn't corrupted.
    const decoder = new StringDecoder('utf8')
    const parser = createNdjsonParser(
      (msg) => this.handleRequest(socket, clientId, msg as DaemonRequest),
      () => {} // Ignore parse errors
    )

    // Remove the initial data listener and replace with the RPC parser
    socket.removeAllListeners('data')
    socket.on('data', (chunk) => parser.feed(decoder.write(chunk)))

    socket.on('close', () => {
      const client = this.clients.get(clientId)
      if (client?.controlSocket !== socket) {
        return
      }
      // Why: a client that disconnects mid-preflight would otherwise still create
      // its daemon PTY, orphaning a durable, unattached session — cancel its preps (F4).
      this.cancelPendingPtySpawnPreparationsForClient(clientId)
      this.historySeedTransfers.clearOwner(clientId)
      this.releaseHeldProducerPausesForClient(clientId)
      this.releaseAuthenticatedPolicyTransport(client)
      const wasFullyAuthenticated = client.authenticatedPairEstablished
      this.streamDataBatcher.clear(clientId)
      client.streamSocket?.destroy()
      this.clients.delete(clientId)
      this.recordFullyAuthenticatedDisconnect(wasFullyAuthenticated)
      this.reevaluateIdleShutdown()
    })
  }

  private recordFullyAuthenticatedDisconnect(wasFullyAuthenticated: boolean): void {
    if (
      !wasFullyAuthenticated ||
      [...this.clients.values()].some((remaining) => remaining.authenticatedPairEstablished) ||
      this.idleShutdownState !== 'running'
    ) {
      return
    }
    // Why: once the last full client is gone, incomplete transports may block retirement but never erase it.
    this.retirementRequested = true
  }

  private setupStreamSocket(socket: Socket, client: ConnectedClient): void {
    const previous = client.streamSocket
    socket.removeAllListeners('data')
    client.streamSocket = socket
    // Why: 'drain' is the wake-up for the batcher's shallow-gate held bulk.
    socket.on('drain', () => {
      this.streamDataBatcher.flush(client.clientId)
    })

    const cleanup = (): void => {
      socket.removeListener('close', cleanup)
      socket.removeListener('error', cleanup)
      if (this.clients.get(client.clientId) !== client || client.streamSocket !== socket) {
        return
      }
      // Why: a preflight that outlives its output channel would create an unattached daemon PTY.
      this.cancelPendingPtySpawnPreparationsForClient(client.clientId)
      this.streamDataBatcher.clear(client.clientId)
      this.releaseHeldProducerPausesForClient(client.clientId)
      this.releaseAuthenticatedPolicyTransport(client)
      client.streamSocket = null
    }

    socket.on('close', cleanup)
    socket.on('error', cleanup)

    if (previous && previous !== socket) {
      // Why: replacing a stream socket must not leave the old channel alive and untracked.
      previous.destroy()
    }
  }

  private async handleRequest(
    socket: Socket,
    clientId: string,
    request: DaemonRequest
  ): Promise<void> {
    const isNotify = request.id.startsWith(NOTIFY_PREFIX)

    try {
      const result = await this.routeRequest(clientId, request)
      if (!isNotify) {
        const pendingShutdown = this.pendingShutdownReplies.get(
          this.shutdownReplyKey(clientId, request.id)
        )
        socket.write(encodeNdjson({ id: request.id, ok: true, payload: result }), () => {
          pendingShutdown?.start()
        })
      }
    } catch (err) {
      if (!isNotify) {
        socket.write(
          encodeNdjson({
            id: request.id,
            ok: false,
            error: err instanceof Error ? err.message : String(err)
          })
        )
      }
    }
  }

  private shutdownReplyKey(clientId: string, requestId: string): string {
    return `${clientId}\u0000${requestId}`
  }

  private deferShutdownUntilReply(
    clientId: string,
    requestId: string,
    socket: Socket,
    finish: () => Promise<void>
  ): void {
    const key = this.shutdownReplyKey(clientId, requestId)
    let started = false
    let timer: ReturnType<typeof setTimeout>
    const start = (): void => {
      if (started) {
        return
      }
      started = true
      clearTimeout(timer)
      socket.off('close', start)
      socket.off('error', start)
      this.pendingShutdownReplies.delete(key)
      if (!this.shutdownPromise) {
        this.shutdownPromise = finish()
      }
    }
    // Why: a non-reading peer must not pin a fenced daemon by holding its ack behind permanent socket backpressure.
    timer = setTimeout(start, DaemonServer.SHUTDOWN_REPLY_FLUSH_TIMEOUT_MS)
    timer.unref()
    socket.once('close', start)
    socket.once('error', start)
    this.pendingShutdownReplies.set(key, { start })
  }

  private async preparePtySpawnUnlessCanceled(sessionId: string, clientId: string): Promise<void> {
    const preparation: PendingPtySpawnPreparation = {
      canceled: false,
      clientId
    }
    const pending = this.pendingPtySpawnPreparations.get(sessionId) ?? new Set()
    pending.add(preparation)
    this.pendingPtySpawnPreparations.set(sessionId, pending)
    try {
      // Why: register before the async probe so a concurrent close can cancel this creation before a subprocess exists.
      await this.preparePtySpawn()
      if (preparation.canceled) {
        throw new TerminalAttachCanceledError(sessionId)
      }
    } finally {
      pending.delete(preparation)
      if (pending.size === 0) {
        this.pendingPtySpawnPreparations.delete(sessionId)
      }
    }
  }

  private cancelPendingPtySpawnPreparations(sessionId: string): boolean {
    const pending = this.pendingPtySpawnPreparations.get(sessionId)
    if (!pending) {
      return false
    }
    for (const preparation of pending) {
      preparation.canceled = true
    }
    return true
  }

  private cancelAllPendingPtySpawnPreparations(): void {
    for (const sessionId of this.pendingPtySpawnPreparations.keys()) {
      this.cancelPendingPtySpawnPreparations(sessionId)
    }
  }

  private cancelPendingPtySpawnPreparationsForClient(clientId: string): void {
    for (const pending of this.pendingPtySpawnPreparations.values()) {
      for (const preparation of pending) {
        if (preparation.clientId === clientId) {
          preparation.canceled = true
        }
      }
    }
  }

  private rememberHeldProducerPause(clientId: string, lease: HeldProducerPauseLease): void {
    const leases = this.heldProducerPauseLeasesByClient.get(clientId) ?? new Map()
    leases.set(heldProducerPauseLeaseKey(lease), lease)
    this.heldProducerPauseLeasesByClient.set(clientId, leases)
  }

  private forgetHeldProducerPause(clientId: string, lease: HeldProducerPauseLease): void {
    const leases = this.heldProducerPauseLeasesByClient.get(clientId)
    if (!leases) {
      return
    }
    leases.delete(heldProducerPauseLeaseKey(lease))
    if (leases.size === 0) {
      this.heldProducerPauseLeasesByClient.delete(clientId)
    }
  }

  private releaseHeldProducerPausesForClient(clientId: string): void {
    const leases = this.heldProducerPauseLeasesByClient.get(clientId)
    this.heldProducerPauseLeasesByClient.delete(clientId)
    if (!leases) {
      return
    }
    const releasedSessions = new Set<string>()
    for (const lease of leases.values()) {
      const sessionKey = JSON.stringify([lease.sessionId, lease.incarnationId])
      if (releasedSessions.has(sessionKey)) {
        continue
      }
      releasedSessions.add(sessionKey)
      this.host.releaseExactHeldProducerPauses(lease.sessionId, lease.incarnationId, clientId)
    }
  }

  private forgetHeldProducerPausesForSession(sessionId: string, incarnationId: string): void {
    for (const [clientId, leases] of this.heldProducerPauseLeasesByClient) {
      for (const [key, lease] of leases) {
        if (lease.sessionId === sessionId && lease.incarnationId === incarnationId) {
          leases.delete(key)
        }
      }
      if (leases.size === 0) {
        this.heldProducerPauseLeasesByClient.delete(clientId)
      }
    }
  }

  private enqueueLegacyTransientFact(
    sessionId: string,
    fact: DaemonTransientFact,
    exactClientId?: string
  ): void {
    const clientId = exactClientId ?? this.streamClientIdBySessionId.get(sessionId)
    if (!clientId) {
      return
    }
    this.streamDataBatcher.enqueueControlEvent(clientId, sessionId, {
      type: 'event',
      event: 'transientFact',
      sessionId,
      payload: fact
    })
  }

  private recordAuthorityTransientFact(
    sessionId: string,
    access: TerminalSessionAuthorityPtyAccess,
    fact: DaemonTransientFact
  ): void {
    const recording = this.host.recordSemanticOutcomeExact(sessionId, access, fact)
    this.pendingAuthoritySemanticOutcomes.add(recording)
    void recording.then(
      () => this.pendingAuthoritySemanticOutcomes.delete(recording),
      (error) => {
        this.pendingAuthoritySemanticOutcomes.delete(recording)
        this.log.log('terminal-session-authority-semantic-outcome-failed', {
          sessionId,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    )
  }

  private async routeRequest(clientId: string, request: DaemonRequest): Promise<unknown> {
    const client = this.clients.get(clientId)

    switch (request.type) {
      case DAEMON_TERMINAL_AUTHORITY_CONSUMER_RESOLVE_NAMESPACE_REQUEST: {
        this.requireAuthenticatedConsumerTransport(client)
        const owner = this.terminalSessionAuthorityPtyOwner
        const worktreeId = request.payload.worktreeId
        if (!owner || typeof worktreeId !== 'string') {
          throw new Error('terminal authority consumer namespace resolution is unavailable')
        }
        return await owner.resolvePolicyConsumerNamespace(worktreeId)
      }

      case DAEMON_TERMINAL_AUTHORITY_CONSUMER_CHALLENGE_REQUEST: {
        const transport = this.requireAuthenticatedConsumerTransport(client)
        const owner = this.terminalSessionAuthorityPtyOwner
        if (!owner) {
          throw new Error('terminal authority consumer proof is unavailable')
        }
        return await owner.issuePolicyConsumerChallenge(request.payload, transport)
      }

      case DAEMON_TERMINAL_AUTHORITY_CONSUMER_GRANT_REQUEST: {
        const transport = this.requireAuthenticatedConsumerTransport(client)
        const owner = this.terminalSessionAuthorityPtyOwner
        const proof = parseTerminalAuthorityNamespaceAdmissionProof(request.payload)
        if (!owner || !proof || !client) {
          throw new Error('terminal authority consumer proof is unavailable')
        }
        const namespace = proof.challenge.namespace
        const acceptances = new TerminalSessionAuthorityBoundaryAcceptances()
        const pending: AuthenticatedAuthorityNamespacePreparation = {
          active: true,
          preparation: null,
          acceptances,
          requestId: proof.challenge.requestId,
          namespace: Object.freeze({ ...namespace }),
          connectionGrantId: proof.challenge.connectionGrantId,
          consumer: Object.freeze({
            consumerId: terminalAuthorityHostAppConsumerId(
              namespace.authorityHostId,
              Uint8Array.from(Buffer.from(proof.challenge.appPublicKeyB64, 'base64'))
            ),
            consumerIncarnationId: proof.challenge.candidateProcessIncarnationId
          })
        }
        client.authorityPendingPreparations?.add(pending)
        try {
          pending.preparation = await owner.prepareAuthenticatedPolicyConsumerNamespace(
            proof,
            transport,
            {
              publishBoundary: async (boundary) => {
                const accepted = acceptances.wait(boundary)
                try {
                  await this.publishAuthenticatedAuthorityEvent(
                    client,
                    namespace.namespaceId,
                    'terminalAuthorityNamespaceOutcomeBoundary',
                    boundary
                  )
                  await accepted
                } catch (error) {
                  acceptances.close(error instanceof Error ? error : new Error(String(error)))
                  throw error
                }
              },
              publishOutcome: (publication) =>
                this.publishAuthenticatedAuthorityEvent(
                  client,
                  namespace.namespaceId,
                  'terminalAuthorityNamespaceOutcome',
                  publication
                ),
              onFailure: (error) =>
                this.failAuthenticatedAuthorityNamespace(client, namespace, error)
            }
          )
        } catch (error) {
          pending.active = false
          client.authorityPendingPreparations?.delete(pending)
          acceptances.close()
          throw error
        }
        if (
          !pending.active ||
          this.clients.get(clientId) !== client ||
          client.authorityConsumerTransport?.token !== transport.token
        ) {
          pending.active = false
          client.authorityPendingPreparations?.delete(pending)
          acceptances.close()
          await pending.preparation.rollback()
          throw new Error('terminal authority consumer proof transport is unavailable')
        }
        const preparation = pending.preparation
        try {
          const session = await preparation.commit()
          if (
            !pending.active ||
            this.clients.get(clientId) !== client ||
            client.authorityConsumerTransport?.token !== transport.token
          ) {
            session.disconnect()
            throw new Error('terminal authority consumer proof transport is unavailable')
          }
          const key = authorityNamespaceKey(namespace)
          const existing = client.authorityNamespaceSessions?.get(key)
          if (existing?.session === session) {
            acceptances.close()
          } else {
            existing?.acceptances.close()
            existing?.session.disconnect()
            client.authorityNamespaceSessions?.set(key, Object.freeze({ session, acceptances }))
          }
          return preparation.grant
        } catch (error) {
          acceptances.close()
          return await joinTerminalAuthorityRollbackFailure(error, () => preparation.rollback())
        } finally {
          client.authorityPendingPreparations?.delete(pending)
          pending.active = false
        }
      }

      case DAEMON_TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_CHALLENGE_REQUEST: {
        const transport = this.requireAuthenticatedConsumerRetirementTransport(client)
        const owner = this.terminalSessionAuthorityPtyOwner
        const start = parseTerminalAuthorityConsumerRetirementStart(request.payload)
        if (!owner || !start) {
          throw new Error('terminal authority consumer retirement is unavailable')
        }
        return await owner.issuePolicyConsumerRetirementChallenge(start, transport)
      }

      case DAEMON_TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_REQUEST: {
        const transport = this.requireAuthenticatedConsumerRetirementTransport(client)
        const owner = this.terminalSessionAuthorityPtyOwner
        const proof = parseTerminalAuthorityConsumerRetirementProof(request.payload)
        if (!owner || !proof || !client) {
          throw new Error('terminal authority consumer retirement is unavailable')
        }
        const result = await owner.retireAuthenticatedPolicyConsumer(proof, transport)
        const key = authorityNamespaceKey(result.namespace)
        const installed = client.authorityNamespaceSessions?.get(key)
        if (installed?.session.grant.consumer.consumerId === result.consumerId) {
          client.authorityNamespaceSessions?.delete(key)
          installed.acceptances.close()
          installed.session.disconnect()
        }
        return result
      }

      case DAEMON_TERMINAL_AUTHORITY_CONSUMER_CANCEL_REQUEST: {
        const transport = this.requireAuthenticatedConsumerTransport(client)
        const cancellation = parseTerminalAuthorityNamespaceAdmissionCancellation(request.payload)
        if (
          !client ||
          !cancellation ||
          cancellation.connectionGrantId !== transport.connectionGrantId
        ) {
          throw new Error('terminal authority namespace cancellation is unauthorized')
        }
        let canceled = false
        for (const pending of client.authorityPendingPreparations ?? []) {
          if (
            sameAuthorityNamespace(pending.namespace, cancellation.namespace) &&
            pending.requestId === cancellation.requestId &&
            pending.connectionGrantId === cancellation.connectionGrantId &&
            sameTerminalAuthorityPolicyConsumer(pending.consumer, cancellation.consumer)
          ) {
            client.authorityPendingPreparations?.delete(pending)
            pending.active = false
            pending.acceptances.close()
            await pending.preparation?.rollback()
            canceled = true
          }
        }
        const key = authorityNamespaceKey(cancellation.namespace)
        const installed = client.authorityNamespaceSessions?.get(key)
        if (
          installed &&
          installed.session.grant.requestId === cancellation.requestId &&
          sameTerminalAuthorityPolicyConsumer(
            installed.session.grant.consumer,
            cancellation.consumer
          )
        ) {
          client.authorityNamespaceSessions?.delete(key)
          installed.acceptances.close()
          installed.session.disconnect()
          canceled = true
        }
        return { canceled }
      }

      case 'acceptTerminalAuthorityNamespaceBoundary': {
        const acceptance = parseTerminalAuthorityNamespaceBoundaryAcceptance(request.payload)
        const authenticated = acceptance
          ? client?.authorityNamespaceSessions?.get(authorityNamespaceKey(acceptance.namespace))
          : undefined
        const pending = acceptance
          ? [...(client?.authorityPendingPreparations ?? [])].find(
              (entry) =>
                entry.active &&
                sameAuthorityNamespace(entry.namespace, acceptance.namespace) &&
                sameTerminalAuthorityPolicyConsumer(entry.consumer, acceptance.consumer)
            )
          : undefined
        if (
          acceptance &&
          (pending ||
            (authenticated &&
              sameTerminalAuthorityPolicyConsumer(
                authenticated.session.policyConsumer.identity,
                acceptance.consumer
              )))
        ) {
          ;(pending?.acceptances ?? authenticated!.acceptances).accept(acceptance)
          return { acceptedBoundaryId: acceptance.boundaryId }
        }
        throw new Error('terminal authority namespace boundary acceptance is unauthorized')
      }

      case 'ackTerminalAuthorityNamespaceOutcome': {
        const ack = parseTerminalAuthorityNamespaceOutcomeAck(request.payload)
        const authenticated = ack
          ? client?.authorityNamespaceSessions?.get(authorityNamespaceKey(ack.namespace))
          : undefined
        if (
          ack &&
          authenticated &&
          sameTerminalAuthorityPolicyConsumer(
            authenticated.session.policyConsumer.identity,
            ack.consumer
          )
        ) {
          return {
            acknowledgedSequence: await authenticated.session.policyConsumer.acknowledge(ack)
          }
        }
        throw new Error('terminal authority namespace outcome ACK is unauthorized')
      }

      case 'retireTerminalAuthorityPolicyConsumer': {
        throw new Error('terminal authority policy consumer retirement is unsupported')
      }

      case 'startHistorySeedTransfer': {
        if (!client?.authenticatedPairEstablished || client.streamSocket === null) {
          throw new Error('Daemon client connection is incomplete; reconnect')
        }
        const transferId = this.historySeedTransfers.start(clientId, request.payload)
        return { transferId }
      }

      case 'appendHistorySeedTransfer':
        this.historySeedTransfers.append(
          clientId,
          request.payload.transferId,
          request.payload.index,
          request.payload.data
        )
        return {}

      case 'finishHistorySeedTransfer':
        this.historySeedTransfers.finish(clientId, request.payload.transferId)
        return {}

      case 'abortHistorySeedTransfer':
        this.historySeedTransfers.abort(clientId, request.payload.transferId)
        return {}

      case 'createOrAttach': {
        if (this.idleShutdownState !== 'running') {
          throw new Error('Daemon temporarily unavailable; reconnect')
        }
        if (!client?.authenticatedPairEstablished || client.streamSocket === null) {
          // Why: a control-only replacement can't own terminal admission or erase the prior client's retirement request.
          throw new Error('Daemon client connection is incomplete; reconnect')
        }
        const p = request.payload
        // Why proof is the only admission: a durable authority claim must resolve through an
        // authenticated grant, never a consumer label the client picked for itself.
        const authorityConsumer: TerminalAuthorityPolicyConsumerSource | null =
          isDaemonConsumerProofGrant(client.capabilities?.terminalAuthorityConsumerProof) &&
          client.authorityConsumerTransport !== undefined &&
          this.terminalSessionAuthorityAdmissionReady()
            ? this.authenticatedPolicyConsumerResolver(client)
            : null
        const authorityAdmitted = authorityConsumer !== null
        if (hasTerminalSessionAuthorityCreateMetadata(p) && !authorityAdmitted) {
          throw new Error('terminal_session_authority_unavailable')
        }
        this.createOrAttachInFlight++
        const attachOnly = p.attachOnly === true
        const streamBindingNonce =
          supportsPtyStreamBinding(this.protocolVersion) &&
          isPtyStreamBindingNonce(p.streamBindingNonce)
            ? p.streamBindingNonce
            : null
        let routedSessionId = p.sessionId
        let streamAuthorityAccess: TerminalSessionAuthorityPtyAccess | null | undefined
        const routeTransientFact = (fact: DaemonTransientFact): void => {
          const capturedAccess = streamAuthorityAccess
          if (capturedAccess === undefined) {
            throw new Error('terminal_session_authority_semantic_route_missing')
          }
          if (capturedAccess) {
            this.recordAuthorityTransientFact(routedSessionId, capturedAccess, fact)
          } else {
            this.enqueueLegacyTransientFact(routedSessionId, fact, clientId)
          }
        }
        let result: Awaited<ReturnType<TerminalHost['createOrAttach']>>
        try {
          if (
            p.agentSessionEnsure !== undefined &&
            (!isAgentSessionExecutionClaim(p.agentSessionEnsure.claim) ||
              !isAgentSessionSurfaceBinding(p.agentSessionEnsure.surface))
          ) {
            throw new Error('agent_session_identity_required')
          }
          if (!attachOnly) {
            await this.preparePtySpawnUnlessCanceled(p.sessionId, clientId)
          }
          if (p.historySeed !== undefined && p.historySeedTransferId !== undefined) {
            throw new Error('Multiple terminal history seed sources')
          }
          const historySeedChunks =
            p.historySeedTransferId !== undefined
              ? this.historySeedTransfers.take(clientId, p.historySeedTransferId)
              : p.historySeed !== undefined
                ? [p.historySeed]
                : undefined
          result = await this.host.createOrAttach({
            sessionId: p.sessionId,
            cols: p.cols,
            rows: p.rows,
            cwd: p.cwd,
            env: p.env,
            envToDelete: p.envToDelete,
            command: p.command,
            startupCommandDelivery: p.startupCommandDelivery,
            ...(attachOnly ? { attachOnly: true } : {}),
            // Why: RPC payloads are untrusted JSON; persist only the allowlisted routing enum, never arbitrary identity.
            ...(isTuiAgent(p.launchAgent) ? { launchAgent: p.launchAgent } : {}),
            shellOverride: p.shellOverride,
            terminalWindowsWslDistro: p.terminalWindowsWslDistro,
            terminalWindowsPowerShellImplementation: p.terminalWindowsPowerShellImplementation,
            shellReadySupported: p.shellReadySupported,
            historySeedChunks,
            startupIngress: parsePtyStartupIngressIntent(p.startupIngress),
            ...(p.shellReadyTimeoutMs !== undefined
              ? { shellReadyTimeoutMs: p.shellReadyTimeoutMs }
              : {}),
            ...(p.agentSessionEnsure ? { agentSessionEnsure: p.agentSessionEnsure } : {}),
            ...(p.terminalSessionAuthorityVersion !== undefined
              ? { terminalSessionAuthorityVersion: p.terminalSessionAuthorityVersion }
              : {}),
            ...(p.terminalSessionAuthorityOperationId !== undefined
              ? { terminalSessionAuthorityOperationId: p.terminalSessionAuthorityOperationId }
              : {}),
            ...(p.worktreeId !== undefined ? { worktreeId: p.worktreeId } : {}),
            ...(p.paneKey !== undefined ? { paneKey: p.paneKey } : {}),
            ...(p.paneGeneration !== undefined ? { paneGeneration: p.paneGeneration } : {}),
            ...(p.terminalSessionAuthorityAccess !== undefined
              ? { terminalSessionAuthorityAccess: p.terminalSessionAuthorityAccess }
              : {}),
            ...(authorityAdmitted ? { terminalSessionAuthorityNegotiated: true as const } : {}),
            ...(authorityAdmitted
              ? {
                  terminalSessionAuthorityPolicyConsumer: authorityConsumer!
                }
              : {}),
            onSessionResolved: (sessionId) => {
              routedSessionId = sessionId
            },
            streamClient: {
              onAuthorityAccess: (access) => {
                streamAuthorityAccess = access
              },
              onIncarnation: (incarnationId) => {
                this.streamClientIdBySessionId.set(routedSessionId, clientId)
                this.streamDataBatcher.refreshSessionDroppability(routedSessionId)
                if (streamBindingNonce) {
                  this.streamDataBatcher.establishSessionSource(clientId, routedSessionId, {
                    incarnationId,
                    streamBindingNonce
                  })
                }
                if (this.transientFactRelay.isBackgrounded(routedSessionId)) {
                  this.streamDataBatcher.enqueueControlEvent(clientId, routedSessionId, {
                    type: 'event',
                    event: 'sessionBackgroundMarker',
                    sessionId: routedSessionId,
                    payload: { background: true }
                  })
                }
              },
              onData: (data, rawLength = data.length, transformed = false, seq) => {
                this.transientFactRelay.onSessionData(routedSessionId, data, routeTransientFact)
                const lastInputAt = this.lastInputAtBySessionId.get(routedSessionId)
                const isInteractiveOutput =
                  data.length <= DaemonServer.INTERACTIVE_OUTPUT_MAX_CHARS &&
                  lastInputAt !== undefined &&
                  performance.now() - lastInputAt <= DaemonServer.INTERACTIVE_OUTPUT_WINDOW_MS
                this.streamDataBatcher.enqueue(clientId, routedSessionId, data, {
                  flushImmediately: isInteractiveOutput,
                  flushMaxChars: DaemonServer.INTERACTIVE_OUTPUT_MAX_CHARS,
                  rawLength,
                  transformed,
                  seq
                })
              },
              onExit: (code, incarnationId) => {
                // Why: exit tears down renderer handlers, so it must ride the ordered queue behind final output.
                this.log.log('session-exited', {
                  sessionId: routedSessionId,
                  code
                })
                this.streamDataBatcher.enqueueControlEvent(clientId, routedSessionId, {
                  type: 'event',
                  event: 'exit',
                  sessionId: routedSessionId,
                  payload: { code, incarnationId }
                })
                this.streamDataBatcher.flush(clientId)
                recordDaemonStreamBacklogEvent('sessionExit', {
                  sessionIdSuffix: routedSessionId.slice(-10)
                })
                this.transientFactRelay.onSessionExit(routedSessionId)
                this.forgetHeldProducerPausesForSession(routedSessionId, incarnationId)
                this.streamDataBatcher.refreshSessionDroppability(routedSessionId)
                this.streamClientIdBySessionId.delete(routedSessionId)
                this.lastInputAtBySessionId.delete(routedSessionId)
                this.reevaluateIdleShutdown()
              }
            }
          })
        } finally {
          this.createOrAttachInFlight--
          this.reevaluateIdleShutdown()
        }
        routedSessionId = result.agentSessionEnsure?.owner.ptyId ?? p.sessionId
        this.log.log(result.isNew ? 'session-created' : 'session-attached', {
          sessionId: routedSessionId,
          pid: result.pid
        })
        return {
          isNew: result.isNew,
          snapshot: result.snapshot,
          pid: result.pid,
          shellState: result.shellState,
          incarnationId: result.incarnationId,
          ...(streamBindingNonce ? { streamBindingNonce } : {}),
          ...(result.launchAgent ? { launchAgent: result.launchAgent } : {}),
          wslDistro: result.wslDistro,
          ...(result.historySeeded !== undefined ? { historySeeded: result.historySeeded } : {}),
          ...(result.agentSessionEnsure ? { agentSessionEnsure: result.agentSessionEnsure } : {}),
          ...(result.terminalSessionAuthorityAccess
            ? { terminalSessionAuthorityAccess: result.terminalSessionAuthorityAccess }
            : {})
        }
      }

      case 'cancelCreateOrAttach':
        this.cancelPendingPtySpawnPreparations(request.payload.sessionId)
        return {}

      case 'closeStartupQueryAuthority':
        return {
          appliedSeq: this.host.closeStartupQueryAuthority(request.payload.sessionId)
        }

      case 'write':
        try {
          this.lastInputAtBySessionId.set(request.payload.sessionId, performance.now())
          this.host.write(request.payload.sessionId, request.payload.data)
        } catch (err) {
          this.lastInputAtBySessionId.delete(request.payload.sessionId)
          if (err instanceof SessionNotFoundError) {
            this.sendExitEvent(client, request.payload.sessionId, -1)
          }
          throw err
        }
        return {}

      case 'writeExact': {
        const accepted =
          typeof request.payload.data === 'string' &&
          this.host.writeExact(
            request.payload.sessionId,
            request.payload.incarnationId,
            request.payload.data
          )
        if (accepted) {
          this.lastInputAtBySessionId.set(request.payload.sessionId, performance.now())
        }
        return { accepted }
      }

      case 'writeAuthorityExact': {
        this.assertAuthorityPolicyAdmission(client, request.payload.authorityAccess)
        const accepted =
          typeof request.payload.data === 'string' &&
          this.host.writeAuthorityExact(
            request.payload.sessionId,
            request.payload.authorityAccess,
            request.payload.data
          )
        if (accepted) {
          this.lastInputAtBySessionId.set(request.payload.sessionId, performance.now())
        }
        return { accepted }
      }

      case 'resize':
        try {
          this.host.resize(request.payload.sessionId, request.payload.cols, request.payload.rows)
        } catch (err) {
          if (err instanceof SessionNotFoundError) {
            this.sendExitEvent(client, request.payload.sessionId, -1)
          }
          throw err
        }
        return {}

      case 'resizeExact':
        return {
          accepted: this.host.resizeExact(
            request.payload.sessionId,
            request.payload.incarnationId,
            request.payload.cols,
            request.payload.rows
          )
        }

      case 'resizeAuthorityExact':
        this.assertAuthorityPolicyAdmission(client, request.payload.authorityAccess)
        return {
          accepted: this.host.resizeAuthorityExact(
            request.payload.sessionId,
            request.payload.authorityAccess,
            request.payload.cols,
            request.payload.rows
          )
        }

      case 'pausePty':
        if (supportsExactHeldProducerPause(this.protocolVersion)) {
          const pause = parseHeldProducerPausePayload(request.payload)
          if (pause.mode === 'invalid') {
            return { accepted: false }
          }
          if (pause.mode === 'exact') {
            if (!client?.authenticatedPairEstablished || client.streamSocket === null) {
              return { accepted: false }
            }
            const accepted = this.host.acquireExactHeldProducerPause(
              pause.sessionId,
              pause.incarnationId,
              clientId,
              pause.token
            )
            if (accepted) {
              this.rememberHeldProducerPause(clientId, pause)
            }
            return { accepted }
          }
        }
        this.host.pauseProducer(request.payload.sessionId)
        return {}

      case 'resumePty':
        if (supportsExactHeldProducerPause(this.protocolVersion)) {
          const pause = parseHeldProducerPausePayload(request.payload)
          if (pause.mode === 'invalid') {
            return { accepted: false }
          }
          if (pause.mode === 'exact') {
            const accepted = this.host.releaseExactHeldProducerPause(
              pause.sessionId,
              pause.incarnationId,
              clientId,
              pause.token
            )
            if (accepted) {
              this.forgetHeldProducerPause(clientId, pause)
            }
            return { accepted }
          }
        }
        this.host.resumeProducer(request.payload.sessionId)
        return {}

      case 'setSessionBackground': {
        const sessionId = request.payload.sessionId
        const background = request.payload.background === true
        recordDaemonStreamBacklogEvent('setSessionBackground', {
          sessionIdSuffix: sessionId.slice(-10),
          background
        })
        const backgroundChanged = this.transientFactRelay.setSessionBackground(
          sessionId,
          background
        )
        this.streamDataBatcher.refreshSessionDroppability(sessionId)
        if (!backgroundChanged) {
          return {}
        }
        if (background) {
          // Seed the fresh relay tracker with the emulator's dangling escape so a handoff-split sequence still parses.
          this.transientFactRelay.seedSessionScanState(
            sessionId,
            this.host.getPartialEscapeTailAnsi(sessionId)
          )
        }
        const streamClientId = this.streamClientIdBySessionId.get(sessionId)
        if (!streamClientId) {
          // Not attached yet — the attach-time marker covers the handoff.
          return {}
        }
        // Reveal intentionally keeps the queued tail: main needs those bytes, and the normal flush/drain delivers them in order ahead of the marker.
        const mode2031State = this.transientFactRelay.getMode2031ReplyScanState(sessionId)
        const scanSeedAnsi = background
          ? ''
          : mode2031State.pendingSubscribe
            ? mode2031State.tail
            : this.host.getPartialEscapeTailAnsi(sessionId)
        this.streamDataBatcher.enqueueControlEvent(streamClientId, sessionId, {
          type: 'event',
          event: 'sessionBackgroundMarker',
          sessionId,
          payload: {
            background,
            ...(scanSeedAnsi.length > 0 ? { scanSeedAnsi } : {}),
            ...(mode2031State.pendingSubscribe ? { mode2031PendingSubscribe: true as const } : {})
          }
        })
        return {}
      }

      case 'kill': {
        const canceledPendingSpawn = this.cancelPendingPtySpawnPreparations(
          request.payload.sessionId
        )
        this.lastInputAtBySessionId.delete(request.payload.sessionId)
        const attribution = {
          sessionId: request.payload.sessionId,
          immediate: request.payload.immediate === true,
          // Daemon control identity, not the paired-device bearer credential.
          clientId
        }
        try {
          await this.host.kill(request.payload.sessionId, {
            immediate: request.payload.immediate
          })
        } catch (error) {
          // Why: a kill that wins before session registration already canceled the pending spawn, so its intent is done.
          if (!(canceledPendingSpawn && error instanceof SessionNotFoundError)) {
            this.log.log('session-kill-failed', attribution)
            throw error
          }
        }
        this.log.log('session-killed', attribution)
        return {}
      }

      case 'killExact': {
        const accepted = await this.host.killExact(
          request.payload.sessionId,
          request.payload.incarnationId,
          { immediate: request.payload.immediate }
        )
        if (accepted) {
          this.lastInputAtBySessionId.delete(request.payload.sessionId)
        }
        return { accepted }
      }

      case 'killAuthorityExact': {
        const policyConsumer = this.assertAuthorityPolicyAdmission(
          client,
          request.payload.authorityAccess
        )
        const accepted = await this.host.killAuthorityExact(
          request.payload.sessionId,
          request.payload.authorityAccess,
          policyConsumer,
          { immediate: request.payload.immediate }
        )
        if (accepted) {
          this.lastInputAtBySessionId.delete(request.payload.sessionId)
        }
        return { accepted }
      }

      case 'signal':
        this.host.signal(request.payload.sessionId, request.payload.signal)
        return {}

      case 'signalExact':
        return {
          accepted: this.host.signalExact(
            request.payload.sessionId,
            request.payload.incarnationId,
            request.payload.signal
          )
        }

      case 'signalAuthorityExact':
        this.assertAuthorityPolicyAdmission(client, request.payload.authorityAccess)
        return {
          accepted: this.host.signalAuthorityExact(
            request.payload.sessionId,
            request.payload.authorityAccess,
            request.payload.signal
          )
        }

      case 'detach':
        // Note: detach token handling simplified — full impl would track tokens per client
        this.log.log('session-detached', {
          sessionId: request.payload.sessionId
        })
        return {}

      case 'getCwd':
        return { cwd: await this.host.getCwd(request.payload.sessionId) }

      case 'getForegroundProcess':
        return {
          foregroundProcess: this.host.getForegroundProcess(request.payload.sessionId)
        }

      case 'inspectProcess':
        return this.host.inspectProcess(request.payload.sessionId)

      case 'confirmForegroundProcess':
        return {
          foregroundProcess: await this.host.confirmForegroundProcess(request.payload.sessionId)
        }

      case 'clearScrollback':
        this.host.clearScrollback(request.payload.sessionId)
        return {}

      case 'clearBufferExact':
        return {
          accepted: this.host.clearScrollbackExact(
            request.payload.sessionId,
            request.payload.incarnationId
          )
        }

      case 'clearBufferAuthorityExact':
        this.assertAuthorityPolicyAdmission(client, request.payload.authorityAccess)
        return {
          accepted: this.host.clearScrollbackAuthorityExact(
            request.payload.sessionId,
            request.payload.authorityAccess
          )
        }

      case 'listSessions':
        return { sessions: this.host.listSessions() }

      case 'shutdownIfIdle': {
        const authenticatedClient = this.clients.get(clientId)
        const retiring =
          authenticatedClient !== undefined &&
          authenticatedClient.streamSocket !== null &&
          this.clients.size === 1 &&
          this.createOrAttachInFlight === 0 &&
          this.host.listSessions().length === 0 &&
          [...this.transportSockets].every(
            (transport) =>
              transport === authenticatedClient.controlSocket ||
              transport === authenticatedClient.streamSocket
          )
        if (!retiring) {
          return { retiring: false }
        }
        this.idleShutdownState = 'shutting-down'
        this.initialAdoptionDeadlineMs = null
        this.retirementRequested = false
        this.cancelInitialAdoptionTimer()
        // Why: close before acknowledging retirement so no new terminal races between the empty proof and disposal.
        const serverClose = this.beginServerClose()
        this.deferShutdownUntilReply(clientId, request.id, authenticatedClient.controlSocket, () =>
          this.finishIdleShutdown(serverClose)
        )
        return { retiring: true }
      }

      case 'getSnapshot': {
        const snapshotStart = performance.now()
        const requestedScrollbackRows = request.payload.scrollbackRows
        const scrollbackRows =
          typeof requestedScrollbackRows === 'number' && Number.isFinite(requestedScrollbackRows)
            ? Math.max(0, Math.min(50_000, Math.floor(requestedScrollbackRows)))
            : undefined
        const snapshot = this.host.getSnapshot(request.payload.sessionId, {
          scrollbackRows
        })
        const snapshotMs = performance.now() - snapshotStart
        if (snapshotMs >= 25) {
          // Serialize stalls block the daemon's single thread; surface them to attribute field typing stalls (issue #5096 family).
          recordDaemonStreamBacklogEvent('slowGetSnapshot', {
            sessionIdSuffix: request.payload.sessionId.slice(-10),
            snapshotMs: Math.round(snapshotMs)
          })
        }
        return { snapshot }
      }

      case 'getSize':
        return { size: this.host.getAppliedSize(request.payload.sessionId) }

      case 'takePendingOutput':
        // Why no await: with includeSnapshot, drain+serialize must share one sync turn or cold restore replays doubled PTY bytes.
        return this.host.takePendingOutput(
          request.payload.sessionId,
          request.payload.includeSnapshot === true,
          { teardownSnapshot: request.payload.teardownSnapshot === true }
        )

      case 'ping':
        return { pong: true }

      case 'systemResolverHealth':
        return { health: await readCurrentProcessMacSystemResolverHealth() }

      case 'ptySpawnHealth':
        await this.ptySpawnHealthCheck()
        return { healthy: true }

      case 'shutdown': {
        this.log.log('shutdown', {
          reason: 'rpc',
          killSessions: request.payload.killSessions === true
        })
        const serverClose = this.beginOrdinaryShutdownFence()
        if (request.payload.killSessions) {
          try {
            await this.host.dispose()
          } catch (err) {
            // Why: shutdown must always self-terminate; failed owners stay retryable for the follow-up shutdown() below.
            this.log.log('shutdown-dispose-failed', {
              error: err instanceof Error ? err.message : String(err)
            })
          }
        }
        const controlSocket = this.clients.get(clientId)?.controlSocket
        if (controlSocket) {
          this.deferShutdownUntilReply(clientId, request.id, controlSocket, () =>
            this.finishRpcShutdown(serverClose)
          )
        } else if (!this.shutdownPromise) {
          this.shutdownPromise = this.finishRpcShutdown(serverClose)
        }
        return {}
      }
    }
    throw new Error(`Unknown request type: ${(request as { type: string }).type}`)
  }

  private sendExitEvent(
    client: ConnectedClient | undefined,
    sessionId: string,
    code: number
  ): void {
    if (!client?.streamSocket) {
      return
    }
    // Why: write/resize don't wait for replies, so this synthetic exit is the renderer's only signal to clear stale pane bindings.
    this.streamDataBatcher.enqueueControlEvent(client.clientId, sessionId, {
      type: 'event',
      event: 'exit',
      sessionId,
      payload: { code }
    })
    this.streamDataBatcher.flush(client.clientId)
  }
}
