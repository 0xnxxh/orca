import {
  PairingGetEndpointsResultSchema,
  type DeviceResumeConfirmed,
  type MobileRelayEndpoint
} from '../../../src/shared/mobile-relay-credential-contract'
import { MobileRelayE2eeLink } from './mobile-relay-e2ee-link'
import { MobileRelayRpcStreams } from './mobile-relay-rpc-streams'
import { waitForMobileRelayRpcConnected } from './mobile-relay-rpc-connect-wait'
import { MobileE2EEAuthenticationError } from './mobile-e2ee-v2-physical-channel'
import { isRpcDeliveryUnknown, markRpcDeliveryUnknown } from './rpc-delivery-ambiguity'
import {
  rejectMobileRelayPendingRequests,
  type MobileRelayPendingRequest
} from './mobile-relay-pending-requests'
import { RpcControlProbeFollowUp } from './rpc-control-probe-follow-up'
import { openRpcRequestBudget, resolvePostConnectRequestTimeout } from './rpc-request-budget'
import { isRpcResponse } from './rpc-response-shape'
import type { RpcClient } from './rpc-client'
import type { ConnectionState, RpcResponse } from './types'
import { TimedOutControlRequestIndex } from './timed-out-control-request-index'

const CONTROL_PROBE_TIMEOUT_MS = 8_000
const CONTROL_PROBE_INTERVAL_MS = 20_000

export type MobileRelayRpcSession = RpcClient & {
  getLeaseExpiresAt(): number | null
  getResumeConfirmation(): DeviceResumeConfirmed | null
  getFailure(): Error | null
}

export function connectMobileRelayRpcSession(args: {
  relay: MobileRelayEndpoint
  resumeToken: string
  resumeCredentialVersion: number
  resumeConfirmReqId: string
  deviceToken: string
  desktopPublicKeyB64: string
  requestTimeoutMs?: number
  createSocket?: (url: string) => WebSocket
}): MobileRelayRpcSession {
  const requestTimeoutMs = args.requestTimeoutMs ?? 30_000
  const pending = new Map<string, MobileRelayPendingRequest>()
  const timedOutControlRequestIds = new TimedOutControlRequestIndex()
  const stateListeners = new Set<(state: ConnectionState) => void>()
  let state: ConnectionState = 'connecting'
  let requestCounter = 0
  let controlResponseSequence = 0
  const controlProbeFollowUp = new RpcControlProbeFollowUp<boolean>(
    () => (!closed && state === 'connected' ? true : null),
    probeControlPlane
  )
  let controlProbeTimer: ReturnType<typeof setInterval> | null = null
  let lastConnectedAt: number | null = null
  let leaseExpiresAt: number | null = null
  let resumeConfirmation: DeviceResumeConfirmed | null = null
  let failure: Error | null = null
  let closed = false
  const streams = new MobileRelayRpcStreams({
    nextId,
    sendFrame,
    waitForConnected: () => waitForConnected()
  })

  const link = new MobileRelayE2eeLink({
    endpoint: args.relay,
    credential: args.resumeToken,
    expectedCredentialKind: 'resume',
    deviceToken: args.deviceToken,
    desktopPublicKeyB64: args.desktopPublicKeyB64,
    createSocket: args.createSocket,
    onHello: (hello) => {
      if (
        hello.credentialKind !== 'resume' ||
        hello.acceptedCredentialVersion !== args.resumeCredentialVersion
      ) {
        fail(new Error('relay resume credential version mismatch'))
        return
      }
      leaseExpiresAt = hello.leaseExpiresAt
      publishState('handshaking')
    },
    onAuthenticated: () => void confirmResume(),
    onText: handleText,
    onBinary: handleBinary,
    onError: fail
  })

  const client: MobileRelayRpcSession = {
    async sendRequest(method, params, options) {
      const budget = openRpcRequestBudget(options)
      await waitForConnected(budget.timeoutMs)
      return sendRpc(method, params, resolvePostConnectRequestTimeout(budget, requestTimeoutMs))
    },

    subscribe(method, params, listener, options) {
      if (closed) {
        return () => {}
      }
      return streams.subscribe(method, params, listener, options)
    },

    updateTerminalSubscriptionViewport(terminal, viewport) {
      streams.updateTerminalViewport(terminal, viewport)
    },
    getState: () => state,
    getReconnectAttempt: () => 0,
    getLastConnectedAt: () => lastConnectedAt,
    onStateChange(listener) {
      stateListeners.add(listener)
      return () => stateListeners.delete(listener)
    },
    notifyForeground() {
      startControlProbeTimer()
      probeControlPlane()
    },
    close() {
      if (closed) {
        return
      }
      closed = true
      stopControlProbeTimer()
      timedOutControlRequestIds.clear()
      link.close()
      rejectMobileRelayPendingRequests(pending, new Error('Client closed'))
      streams.clear()
      publishState('disconnected')
    },
    getLeaseExpiresAt: () => leaseExpiresAt,
    getResumeConfirmation: () => resumeConfirmation,
    getFailure: () => failure
  }
  return client

  async function confirmResume(): Promise<void> {
    try {
      const response = await sendRpc(
        'pairing.getEndpoints',
        { resumeConfirmReqId: args.resumeConfirmReqId },
        requestTimeoutMs,
        true
      )
      if (!response.ok) {
        throw new Error(response.error.code)
      }
      const result = PairingGetEndpointsResultSchema.parse(response.result)
      if (!result.resumeConfirmation || result.relay?.relayHostId !== args.relay.relayHostId) {
        throw new Error('relay resume confirmation missing')
      }
      resumeConfirmation = result.resumeConfirmation
      lastConnectedAt = Date.now()
      publishState('connected')
      startControlProbeTimer()
    } catch (error) {
      fail(asError(error))
    }
  }

  function sendRpc(
    method: string,
    params: unknown,
    timeoutMs = requestTimeoutMs,
    beforeConnected = false,
    probeAfterTimeout = true
  ): Promise<RpcResponse> {
    if (closed || (!beforeConnected && state !== 'connected')) {
      return Promise.reject(new Error('relay session not connected'))
    }
    const id = nextId()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        timedOutControlRequestIds.remember(id)
        // Why: the frame was written long ago — the desktop may have processed it.
        const error = markRpcDeliveryUnknown(new Error(`relay RPC timed out: ${method}`))
        reject(error)
        if (probeAfterTimeout) {
          probeControlPlane(true)
        }
      }, timeoutMs)
      pending.set(id, { resolve, reject, timer })
      if (!sendFrame({ id, method, params })) {
        clearTimeout(timer)
        pending.delete(id)
        reject(new Error('relay E2EE channel not ready'))
      }
    })
  }

  function sendFrame(request: { id: string; method: string; params?: unknown }): boolean {
    return link.sendText(JSON.stringify({ ...request, deviceToken: args.deviceToken }))
  }

  function handleText(plaintext: string): void {
    let value: unknown
    try {
      value = JSON.parse(plaintext)
    } catch {
      return
    }
    if (!isRpcResponse(value)) {
      return
    }
    const request = pending.get(value.id)
    if (!value.ok && value.error.code === 'unauthorized') {
      const error = new MobileE2EEAuthenticationError()
      if (request) {
        clearTimeout(request.timer)
        pending.delete(value.id)
        request.reject(error)
      }
      // Why: only the rejected request is definite; concurrent written RPCs may have executed.
      fail(error, new Error(error.message))
      return
    }
    if (
      request ||
      timedOutControlRequestIds.consume(value.id) ||
      streams.isControlResponse(value)
    ) {
      controlResponseSequence += 1
    }
    if (request) {
      clearTimeout(request.timer)
      pending.delete(value.id)
      request.resolve(value)
      return
    }
    streams.handleResponse(value)
  }

  function handleBinary(bytes: Uint8Array): void {
    streams.handleBinary(bytes)
  }

  function probeControlPlane(queueAfterCurrent = false): void {
    if (closed || state !== 'connected') {
      return
    }
    if (!controlProbeFollowUp.begin(true, queueAfterCurrent)) {
      return
    }
    const probeControlResponseSequence = controlResponseSequence
    void sendRpc('status.get', undefined, CONTROL_PROBE_TIMEOUT_MS, false, false).then(
      () => {
        finishControlProbe()
      },
      (error: unknown) => {
        const controlResponded = controlResponseSequence > probeControlResponseSequence
        finishControlProbe()
        if (closed || state !== 'connected') {
          return
        }
        if (!isRpcDeliveryUnknown(error) || !controlResponded) {
          fail(asError(error))
        }
      }
    )
  }

  function startControlProbeTimer(): void {
    if (closed || state !== 'connected' || controlProbeTimer) {
      return
    }
    controlProbeTimer = setInterval(probeControlPlane, CONTROL_PROBE_INTERVAL_MS)
  }

  function stopControlProbeTimer(): void {
    if (controlProbeTimer) {
      clearInterval(controlProbeTimer)
      controlProbeTimer = null
    }
    controlProbeFollowUp.finish()
  }

  function finishControlProbe(): void {
    controlProbeFollowUp.finish(true)
  }

  function waitForConnected(timeoutMs = requestTimeoutMs): Promise<void> {
    return waitForMobileRelayRpcConnected({
      getState: () => state,
      subscribe: (listener) => client.onStateChange(listener),
      timeoutMs
    })
  }

  function publishState(next: ConnectionState): void {
    if (state === next) {
      return
    }
    state = next
    for (const listener of stateListeners) {
      listener(next)
    }
  }

  function fail(error: Error, pendingError = error): void {
    if (closed) {
      return
    }
    closed = true
    stopControlProbeTimer()
    timedOutControlRequestIds.clear()
    failure = error
    link.close()
    rejectMobileRelayPendingRequests(pending, pendingError)
    publishState(error instanceof MobileE2EEAuthenticationError ? 'auth-failed' : 'disconnected')
  }

  function nextId(): string {
    return `relay-rpc-${++requestCounter}-${Date.now()}`
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
