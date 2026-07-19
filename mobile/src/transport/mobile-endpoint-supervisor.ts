import type { MobileRelayEndpoint } from '../../../src/shared/mobile-relay-credential-contract'
import { openAuthenticatedDirectEndpoint } from './mobile-direct-endpoint-probe'
import { RelayReconnectController } from './mobile-relay-reconnect-controller'
import { RelayLeaseRotationTimer } from './mobile-relay-lease-rotation-timer'
import { MobileEndpointHysteresis } from './mobile-endpoint-hysteresis'
import {
  encodeBase64Url,
  isDirectorResolutionFailure,
  persistRelayHost,
  toError
} from './mobile-endpoint-supervisor-support'
import {
  applyResumeConfirmation,
  mobileRelayCredentialNeedsRotation,
  rotateMobileRelayCredential
} from './mobile-relay-credential-rotation'
import type { MobileRelayCredentialBundle } from './mobile-relay-credential-bundle'
import type { MobileRelayRpcSession } from './mobile-relay-rpc-session'
import { resolveMobileRelayEndpoint } from './mobile-relay-resume-director'
import type { RpcClient } from './rpc-client'
import type { StableLogicalRpcClient } from './stable-logical-rpc-client'
import type { HostProfile } from './types'

const DIRECT_PROBE_INTERVAL_MS = 15_000
const DIRECT_OBSERVATION_MS = 30_000
const MINIMUM_DWELL_MS = 60_000
const FAILURE_COOLDOWN_MS = 60_000

export type MobileEndpointSupervisorDependencies = {
  openDirect: (endpoint: string) => RpcClient
  openRelay: (
    relay: MobileRelayEndpoint,
    credential: { token: string; version: number },
    confirmReqId: string
  ) => MobileRelayRpcSession
  resolveRelay: typeof resolveMobileRelayEndpoint
  readBundle: (hostId: string) => Promise<MobileRelayCredentialBundle | null>
  writeBundle: (bundle: MobileRelayCredentialBundle) => Promise<void>
  saveHost: (host: HostProfile) => Promise<void>
  now: () => number
  randomBytes: (length: number) => Uint8Array
  setTimer: typeof setTimeout
  clearTimer: typeof clearTimeout
}

export class MobileEndpointSupervisor {
  private host: HostProfile
  private bundle: MobileRelayCredentialBundle | null = null
  private stopped = false
  private foreground = true
  private operationInFlight = false
  private credentialRotationInFlight = false
  private relayRotationPending = false
  private probeTimer: ReturnType<typeof setTimeout> | null = null
  private unsubscribeState: (() => void) | null = null
  private readonly hysteresis: MobileEndpointHysteresis
  private readonly relayReconnect: RelayReconnectController
  private readonly leaseRotation: RelayLeaseRotationTimer

  constructor(
    private readonly logical: StableLogicalRpcClient,
    host: HostProfile,
    private readonly dependencies: MobileEndpointSupervisorDependencies
  ) {
    this.host = host
    this.hysteresis = new MobileEndpointHysteresis(dependencies.now(), {
      directSuccessesRequired: 3,
      directObservationMs: DIRECT_OBSERVATION_MS,
      failureCooldownMs: FAILURE_COOLDOWN_MS,
      minimumDwellMs: MINIMUM_DWELL_MS
    })
    this.relayReconnect = new RelayReconnectController(dependencies, this.recoverRelay.bind(this))
    this.leaseRotation = new RelayLeaseRotationTimer(dependencies, () => {
      this.relayRotationPending = true
      void this.recoverRelay(true)
    })
  }

  async start(): Promise<void> {
    this.bundle = await this.dependencies.readBundle(this.host.id).catch(() => null)
    if (this.stopped || !this.bundle || !this.host.relay) {
      return
    }
    this.unsubscribeState = this.logical.onStateChange((state) => {
      if (state === 'connected') {
        if (this.logical.getActivePath() !== 'relay') {
          void this.rotateCredentialIfNeeded()
        }
        this.scheduleDirectProbe()
      } else {
        // Why: the direct client enters reconnecting after its first failed
        // dial and may never publish disconnected while its retry loop lives.
        this.relayReconnect.handleStateFailure(this.logical, state)
      }
    })
    if (this.relayReconnect.needsRecovery(this.logical.getState())) {
      // Why: the first direct dial can fail while encrypted relay credentials
      // are still loading, before the supervisor subscribes to state changes.
      await this.recoverRelay()
    } else {
      this.scheduleDirectProbe()
    }
  }

  setForeground(foreground: boolean): void {
    const wasForeground = this.foreground
    this.foreground = foreground
    if (foreground) {
      this.relayReconnect.handleForeground(this.logical, wasForeground, this.relayRotationPending)
      this.scheduleDirectProbe(0)
    } else {
      // Why: background phones must not hold billed relay data splices.
      this.relayReconnect.suspendActiveRelay(this.logical)
      if (this.probeTimer) {
        this.dependencies.clearTimer(this.probeTimer)
        this.probeTimer = null
      }
      this.relayReconnect.clear()
    }
  }

  stop(): void {
    this.stopped = true
    this.unsubscribeState?.()
    this.unsubscribeState = null
    if (this.probeTimer) {
      this.dependencies.clearTimer(this.probeTimer)
      this.probeTimer = null
    }
    this.relayReconnect.clear()
    this.leaseRotation.clear()
  }

  private async recoverRelay(forceReplacement = false): Promise<void> {
    if (
      this.stopped ||
      !this.foreground ||
      this.operationInFlight ||
      !this.bundle ||
      !this.host.relay ||
      (!forceReplacement && this.logical.getState() === 'connected')
    ) {
      return
    }
    // Why: a flapping cellular link fires repeated revival nudges while the relay
    // cell answers overlapping resumes with PEER_DROPPED/LIMIT_EXCEEDED; honoring
    // the backoff window keeps those nudges from re-dialing instantly and churning.
    // Lease rotation (forceReplacement) is a scheduled event, not a failure, so it
    // is exempt.
    if (!forceReplacement && this.relayReconnect.shouldDefer()) {
      return
    }
    this.operationInFlight = true
    let lastError: Error | null = null
    let retryAfterOperation = false
    try {
      const credentials = [this.bundle.current, this.bundle.grace].filter(
        (credential): credential is NonNullable<typeof credential> =>
          Boolean(credential && credential.expiresAt > this.dependencies.now())
      )
      for (const credential of credentials) {
        const result = await this.tryRelayCredential(credential)
        if (result.ok) {
          retryAfterOperation = this.logical.getState() !== 'connected'
          if (!retryAfterOperation) {
            this.relayReconnect.reset()
          }
          return
        }
        lastError = result.error
      }
      if (credentials.length > 0) {
        this.relayReconnect.registerFailure(lastError)
      }
    } finally {
      this.operationInFlight = false
      if (forceReplacement && this.relayRotationPending && !this.stopped) {
        this.leaseRotation.armRetry(5000)
      }
      // Why: the active relay can drop while migration follow-up still owns the mutex.
      if (retryAfterOperation && !this.stopped && this.foreground) {
        void this.recoverRelay()
      }
    }
  }

  private async tryRelayCredential(credential: {
    token: string
    version: number
  }): Promise<{ ok: true } | { ok: false; error: Error }> {
    const first = await this.openAndMigrateRelay(credential)
    if (first.ok) {
      return first
    }
    if (!isDirectorResolutionFailure(first.error) || !this.host.relay) {
      return first
    }
    try {
      const resolved = await this.dependencies.resolveRelay({
        relay: this.host.relay,
        resumeToken: credential.token
      })
      this.host = await persistRelayHost(this.host, resolved, this.dependencies.saveHost)
      return await this.openAndMigrateRelay(credential)
    } catch (error) {
      return { ok: false, error: toError(error) }
    }
  }

  private async openAndMigrateRelay(credential: {
    token: string
    version: number
  }): Promise<{ ok: true } | { ok: false; error: Error }> {
    if (!this.host.relay || !this.bundle) {
      return { ok: false, error: new Error('relay state missing') }
    }
    const session = this.dependencies.openRelay(
      this.host.relay,
      credential,
      `confirm-${encodeBase64Url(this.dependencies.randomBytes(16))}`
    )
    try {
      await this.logical.migrateTo(session, 'relay')
      this.relayReconnect.setActiveSession(session)
      if (!this.foreground) {
        this.relayReconnect.suspendActiveRelay(this.logical)
      }
      this.relayRotationPending = false
      this.hysteresis.recordMigration(this.dependencies.now())
      const confirmation = session.getResumeConfirmation()
      if (confirmation) {
        this.bundle = applyResumeConfirmation(this.bundle, credential.version, confirmation)
        await this.dependencies.writeBundle(this.bundle)
      }
      this.leaseRotation.scheduleFromLease(session.getLeaseExpiresAt())
      this.scheduleDirectProbe()
      return { ok: true }
    } catch (error) {
      return { ok: false, error: session.getFailure() ?? toError(error) }
    }
  }

  private scheduleDirectProbe(delayMs = DIRECT_PROBE_INTERVAL_MS): void {
    if (
      this.stopped ||
      !this.foreground ||
      this.logical.getActivePath() !== 'relay' ||
      this.probeTimer
    ) {
      return
    }
    this.probeTimer = this.dependencies.setTimer(() => {
      this.probeTimer = null
      void this.probeDirect()
    }, delayMs)
  }

  private async probeDirect(): Promise<void> {
    if (
      this.stopped ||
      !this.foreground ||
      this.operationInFlight ||
      !this.hysteresis.canProbe(this.dependencies.now())
    ) {
      this.scheduleDirectProbe()
      return
    }
    this.operationInFlight = true
    let successful: Awaited<ReturnType<typeof openAuthenticatedDirectEndpoint>> = null
    try {
      const openDirect = this.dependencies.openDirect
      successful = await openAuthenticatedDirectEndpoint(this.host, openDirect, 12_000)
      if (!successful) {
        this.hysteresis.recordDirectFailure(this.dependencies.now())
        return
      }
      if (!this.hysteresis.recordDirectSuccess(this.dependencies.now())) {
        successful.client.close()
        return
      }
      await this.logical.migrateTo(successful.client, successful.path)
      successful = null
      this.relayReconnect.resetForDirectConnection()
      this.hysteresis.recordMigration(this.dependencies.now())
      this.leaseRotation.clear()
      this.relayRotationPending = false
      await this.rotateCredentialIfNeeded()
    } finally {
      successful?.client.close()
      this.operationInFlight = false
      // Why: a relay drop or backoff timer can arrive while the direct probe owns the mutex.
      if (this.relayRotationPending || this.logical.getState() !== 'connected') {
        void this.recoverRelay(this.relayRotationPending)
      }
      this.scheduleDirectProbe()
    }
  }

  private async rotateCredentialIfNeeded(): Promise<void> {
    if (
      this.stopped ||
      this.credentialRotationInFlight ||
      !this.bundle ||
      this.logical.getActivePath() === 'relay' ||
      !mobileRelayCredentialNeedsRotation(this.bundle, this.dependencies.now())
    ) {
      return
    }
    this.credentialRotationInFlight = true
    try {
      const result = await rotateMobileRelayCredential({
        client: this.logical,
        bundle: this.bundle,
        writeBundle: this.dependencies.writeBundle,
        randomBytes: this.dependencies.randomBytes
      })
      this.bundle = result.bundle
      this.host = await persistRelayHost(this.host, result.relay, this.dependencies.saveHost)
    } catch {
      // Why: pending material remains durable; the next authenticated direct
      // opportunity must reconcile it before creating another install key.
    } finally {
      this.credentialRotationInFlight = false
    }
  }
}
