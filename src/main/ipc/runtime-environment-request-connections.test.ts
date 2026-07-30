import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PairingOffer } from '../../shared/pairing'
import {
  MAIN_THREAD_DIAGNOSTICS_ENV,
  drainRemoteRpcRequestStats
} from '../diagnostics/main-thread-churn-probe'

const { oneShotRequest, dedicatedSubscription, cachedRequest, sharedRequest, sharedSubscription } =
  vi.hoisted(() => ({
    oneShotRequest: vi.fn(),
    dedicatedSubscription: vi.fn(),
    cachedRequest: vi.fn(),
    sharedRequest: vi.fn(),
    sharedSubscription: vi.fn()
  }))

vi.mock('../../shared/remote-runtime-client', () => ({
  sendRemoteRuntimeRequest: oneShotRequest,
  subscribeRemoteRuntimeRequest: dedicatedSubscription
}))

vi.mock('../../shared/remote-runtime-request-connection', () => ({
  RemoteRuntimeRequestConnection: class {
    request = cachedRequest
    close(): void {}
  }
}))

vi.mock('../../shared/remote-runtime-shared-control-connection', () => ({
  RemoteRuntimeSharedControlConnection: class {
    request = sharedRequest
    subscribe = sharedSubscription
    close(): void {}
    getDiagnostics(): null {
      return null
    }
    reconnectNow(): void {}
    retryNow(): boolean {
      return false
    }
  }
}))

import {
  closeAllRemoteRuntimeRequestConnections,
  sendRemoteRuntimeConnectionRequest,
  sendRemoteRuntimeOneShotRequest,
  sendRemoteRuntimeSharedControlRequest,
  subscribeRemoteRuntimeDedicatedRequest,
  subscribeRemoteRuntimeSharedControlRequest
} from './runtime-environment-request-connections'

const pairing: PairingOffer = {
  v: 2,
  endpoint: 'ws://127.0.0.1:6768',
  deviceToken: 'secret',
  publicKeyB64: 'secret'
}

afterEach(() => {
  closeAllRemoteRuntimeRequestConnections()
  drainRemoteRpcRequestStats()
  vi.unstubAllEnvs()
  vi.resetAllMocks()
})

describe('runtime environment RPC diagnostics', () => {
  it('counts each selected outbound transport once, including rejected requests', async () => {
    vi.stubEnv(MAIN_THREAD_DIAGNOSTICS_ENV, '1')
    oneShotRequest.mockResolvedValue({ ok: true })
    cachedRequest.mockRejectedValue(new Error('cached failure'))
    sharedRequest.mockResolvedValue({ ok: true })
    dedicatedSubscription.mockResolvedValue({ requestId: 'dedicated' })
    sharedSubscription.mockResolvedValue({ requestId: 'shared' })

    await sendRemoteRuntimeOneShotRequest(pairing, 'status.get', undefined, 1_000)
    await expect(
      sendRemoteRuntimeConnectionRequest('environment-1', pairing, 'terminal.send', {}, 1_000)
    ).rejects.toThrow('cached failure')
    await sendRemoteRuntimeSharedControlRequest('environment-1', pairing, 'git.status', {}, 1_000)
    await subscribeRemoteRuntimeDedicatedRequest(pairing, 'terminal.multiplex', {}, 1_000, {
      onResponse: vi.fn(),
      onError: vi.fn()
    })
    await subscribeRemoteRuntimeSharedControlRequest(
      'environment-1',
      pairing,
      'clientEvents.subscribe',
      {},
      1_000,
      { onResponse: vi.fn(), onError: vi.fn() }
    )

    expect(drainRemoteRpcRequestStats()).toEqual({
      'status.get': { count: 1 },
      'terminal.send': { count: 1 },
      'git.status': { count: 1 },
      'terminal.multiplex': { count: 1 },
      'clientEvents.subscribe': { count: 1 }
    })
  })
})
