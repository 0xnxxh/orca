import type { RuntimeStatus } from '../../shared/runtime-types'
import type { PairingOffer } from '../../shared/pairing'
import { describeRuntimeCompatBlock, evaluateRuntimeCompat } from '../../shared/protocol-compat'
import {
  MIN_COMPATIBLE_RUNTIME_SERVER_VERSION,
  RUNTIME_PROTOCOL_VERSION
} from '../../shared/protocol-version'
import {
  getEnvironmentRuntimeCompat,
  markEnvironmentUsed,
  recordEnvironmentRuntimeCompat
} from './environments'
import type { sendWebSocketRequest } from './websocket-transport'
import { RuntimeClientError, RuntimeRpcFailureError } from './types'

/**
 * Keeps a remote runtime's protocol-compatibility verdict for one CLI process.
 *
 * Verifying it used to cost a second full WebSocket connection (and a second E2EE authentication) on
 * every command. A verdict is now saved against the runtime's `runtimeId`, which is minted per runtime
 * launch, so a saved verdict proves the same verified process is still answering; a restarted or upgraded
 * runtime answers under a different id, which retires the verdict for the next command.
 */
export class RemoteRuntimeCompatGate {
  private checked = false
  private trustedRuntimeId: string | null = null

  constructor(
    private readonly userDataPath: string,
    private readonly environmentSelector: string | null
  ) {}

  /** Verifies compatibility before a remote call, reusing a saved verdict instead of reconnecting. */
  async ensure(
    pairing: PairingOffer,
    timeoutMs: number,
    send: typeof sendWebSocketRequest
  ): Promise<void> {
    if (this.checked || this.adoptSavedVerdict()) {
      return
    }
    const response = await send<RuntimeStatus>(pairing, 'status.get', undefined, timeoutMs)
    if (response.ok === false) {
      throw new RuntimeRpcFailureError(response)
    }
    this.noteVerifiedStatus(response.result, response._meta.runtimeId)
  }

  /** Records a status the caller obtained anyway, so the next command can skip the preflight. */
  noteVerifiedStatus(status: RuntimeStatus, runtimeId: string): void {
    this.assertCompatible(status)
    this.checked = true
    this.trustedRuntimeId = runtimeId
    if (!this.environmentSelector) {
      return
    }
    try {
      recordEnvironmentRuntimeCompat(this.userDataPath, this.environmentSelector, {
        runtimeId,
        ...(status.appVersion ? { appVersion: status.appVersion } : {}),
        clientProtocolVersion: RUNTIME_PROTOCOL_VERSION,
        minCompatibleServerProtocolVersion: MIN_COMPATIBLE_RUNTIME_SERVER_VERSION
      })
    } catch {
      // Why: the verdict is an optimization; failing to cache it must not fail the command.
    }
  }

  /** Reacts to whichever runtime actually answered, retiring a verdict that belonged to another one. */
  noteRespondingRuntimeId(runtimeId: string): void {
    if (this.trustedRuntimeId && this.trustedRuntimeId !== runtimeId) {
      this.trustedRuntimeId = null
      this.checked = false
    }
    if (this.environmentSelector) {
      markEnvironmentUsed(this.userDataPath, this.environmentSelector, { runtimeId })
    }
  }

  assertCompatible(status: RuntimeStatus): void {
    const verdict = evaluateRuntimeCompat({
      clientProtocolVersion: RUNTIME_PROTOCOL_VERSION,
      minCompatibleServerProtocolVersion: MIN_COMPATIBLE_RUNTIME_SERVER_VERSION,
      serverProtocolVersion: status.runtimeProtocolVersion ?? status.protocolVersion,
      serverMinCompatibleClientProtocolVersion:
        status.minCompatibleRuntimeClientVersion ?? status.minCompatibleMobileVersion
    })
    if (verdict.kind === 'blocked') {
      throw new RuntimeClientError('incompatible_runtime', describeRuntimeCompatBlock(verdict))
    }
  }

  private adoptSavedVerdict(): boolean {
    if (!this.environmentSelector) {
      return false
    }
    try {
      const compat = getEnvironmentRuntimeCompat(this.userDataPath, this.environmentSelector)
      // Why: a client update can change either bound, so a verdict from an older CLI is not reusable.
      if (
        !compat ||
        compat.clientProtocolVersion !== RUNTIME_PROTOCOL_VERSION ||
        compat.minCompatibleServerProtocolVersion !== MIN_COMPATIBLE_RUNTIME_SERVER_VERSION
      ) {
        return false
      }
      this.trustedRuntimeId = compat.runtimeId
      this.checked = true
      return true
    } catch {
      // Why: an unreadable record must fall back to the preflight, never skip it.
      return false
    }
  }
}
