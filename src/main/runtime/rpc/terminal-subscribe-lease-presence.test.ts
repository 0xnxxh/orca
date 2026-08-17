import { describe, expect, it, vi } from 'vitest'
import type { RuntimeTerminalWait } from '../../../shared/runtime-types'
import type { OrcaRuntimeService } from '../orca-runtime'
import type { RpcRequest } from './core'
import { RpcDispatcher } from './dispatcher'
import { TERMINAL_METHODS } from './methods/terminal'
import { createSubscriptionRegistryDouble } from './subscription-registry-test-double'

const leaseOnlyParams = {
  terminal: 'terminal-1',
  client: { id: 'phone-1', type: 'mobile' },
  capabilities: { terminalBinaryStream: 1, mobileInputLeaseOnly: 1 }
}

const makeRequest = (): RpcRequest => ({
  id: 'req-1',
  authToken: 'tok',
  method: 'terminal.subscribe',
  params: leaseOnlyParams
})

const streamOptions = (connectionId: string) => ({
  connectionId,
  sendBinary: vi.fn(),
  registerBinaryStreamHandler: vi.fn(() => vi.fn())
})

describe('lease-only mobile presence ownership', () => {
  it('does not release the replacement subscriber presence when a superseded subscribe resumes', async () => {
    const registry = createSubscriptionRegistryDouble()
    let releaseFirstSubscribe = (): void => {}
    const handleMobileSubscribe = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            releaseFirstSubscribe = () => resolve(true)
          })
      )
      .mockResolvedValue(true)
    const handleMobileUnsubscribe = vi.fn()
    const runtime = {
      getRuntimeId: () => 'test-runtime',
      registerRemoteTerminalViewSubscriber: () => () => {},
      requestRendererTerminalTabMount: () => false,
      resolveLeafForHandle: vi.fn().mockReturnValue({ ptyId: 'pty-1' }),
      handleMobileSubscribe,
      handleMobileUnsubscribe,
      registerSubscriptionCleanup: vi.fn(registry.registerSubscriptionCleanup),
      registerOwnedSubscriptionCleanup: vi.fn(registry.registerOwnedSubscriptionCleanup),
      cleanupSubscription: vi.fn(registry.cleanupSubscription),
      cleanupSubscriptionIfOwnedByConnection: vi.fn(
        registry.cleanupSubscriptionIfOwnedByConnection
      ),
      waitForTerminal: vi.fn(() => new Promise<RuntimeTerminalWait>(() => {}))
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: TERMINAL_METHODS })

    void dispatcher.dispatchStreaming(makeRequest(), vi.fn(), streamOptions('conn-a'))
    await vi.waitFor(() => expect(handleMobileSubscribe).toHaveBeenCalledTimes(1))

    // Reconnect rebinds the id while the first subscribe is still awaiting.
    void dispatcher.dispatchStreaming(makeRequest(), vi.fn(), streamOptions('conn-b'))
    await vi.waitFor(() => expect(handleMobileSubscribe).toHaveBeenCalledTimes(2))

    // Why a baseline delta: both generations share (ptyId, clientId), so the rebind's
    // own legitimate release is indistinguishable from a stale one by arguments alone.
    const releasesAfterRebind = handleMobileUnsubscribe.mock.calls.length

    releaseFirstSubscribe()
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(handleMobileUnsubscribe.mock.calls.length).toBe(releasesAfterRebind)
  })
})
