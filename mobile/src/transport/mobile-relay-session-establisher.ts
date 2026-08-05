import type { MobileEndpointSupervisorDependencies } from './mobile-endpoint-supervisor-contract'
import {
  dialRelayThroughDirectorFallback,
  encodeBase64Url,
  RelayDialAbortedError,
  toError
} from './mobile-endpoint-supervisor-support'
import { persistResumeConfirmation } from './mobile-relay-credential-rotation'
import type { MobileRelayCredentialBundle } from './mobile-relay-credential-bundle'
import type { RelayReconnectController } from './mobile-relay-reconnect-controller'
import type { StableLogicalRpcClient } from './stable-logical-rpc-client'
import type { MobileRelayEndpoint } from '../../../src/shared/mobile-relay-credential-contract'
import type { HostProfile } from './types'

type EstablishResult = { ok: true } | { ok: false; error: Error }

// Turns one relay credential into the active runtime session: resolve the cell
// assignment if the director rejects the cached one, open the cell socket,
// migrate the logical client onto it, then persist the resume confirmation and
// re-arm the supervisor's timers.
export class MobileRelaySessionEstablisher {
  constructor(
    private readonly args: {
      logical: StableLogicalRpcClient
      controller: RelayReconnectController
      openRelay: MobileEndpointSupervisorDependencies['openRelay']
      randomBytes: (length: number) => Uint8Array
      writeBundle: (bundle: MobileRelayCredentialBundle) => Promise<void>
      isActive: () => boolean
      isForeground: () => boolean
      relay: () => HostProfile['relay']
      resolveRelay: MobileEndpointSupervisorDependencies['resolveRelay']
      persistResolvedRelay: (resolved: MobileRelayEndpoint) => Promise<void>
      bundle: () => MobileRelayCredentialBundle | null
      adoptBundle: (bundle: MobileRelayCredentialBundle) => void
      // Hysteresis stamp + rotation-pending clear + recovery log line.
      recordMigration: () => void
      // Owns the stopped/background null-out so a late resolve never re-arms a stale timer.
      scheduleLease: (expiry: number | null) => void
      scheduleDirectProbe: () => void
      onBookkeepingError: (error: Error) => void
    }
  ) {}

  // One credential attempt: a director-class failure re-resolves the cell
  // assignment, persists it, and dials once more against the authoritative target.
  dial(credential: { token: string; version: number }): Promise<EstablishResult> {
    return dialRelayThroughDirectorFallback({
      resumeToken: credential.token,
      relay: this.args.relay,
      dial: () => this.establish(credential),
      resolveRelay: this.args.resolveRelay,
      persistResolvedRelay: this.args.persistResolvedRelay
    })
  }

  private async establish(credential: {
    token: string
    version: number
  }): Promise<EstablishResult> {
    const { args } = this
    const relay = args.relay()
    const bundle = args.bundle()
    // Why: director resolution and grace fallback can finish after background/stop.
    if (!args.isActive() || !relay || !bundle) {
      return { ok: false, error: new RelayDialAbortedError() }
    }
    const session = args.openRelay(
      relay,
      credential,
      `confirm-${encodeBase64Url(args.randomBytes(16))}`
    )
    try {
      await args.logical.migrateTo(session, 'relay')
    } catch (error) {
      return { ok: false, error: session.getFailure() ?? toError(error) }
    }
    args.controller.setActiveSession(session)
    if (!args.isForeground()) {
      args.controller.suspendActiveRelay(args.logical)
    }
    args.recordMigration()
    try {
      const applied = await persistResumeConfirmation({
        session,
        bundle,
        usedCredentialVersion: credential.version,
        writeBundle: args.writeBundle
      })
      args.adoptBundle(applied.bundle)
      args.scheduleLease(applied.leaseExpiry)
    } catch (error) {
      // Why: the session is live and registered — reporting bookkeeping as a dial
      // failure would book backoff against it and can suspend the healthy session.
      args.onBookkeepingError(toError(error))
    }
    args.scheduleDirectProbe()
    return { ok: true }
  }
}
