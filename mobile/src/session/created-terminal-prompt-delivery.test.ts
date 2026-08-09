import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { deliverCreatedTerminalPrompt } from './created-terminal-prompt-delivery'

describe('deliverCreatedTerminalPrompt', () => {
  it('delivers a prompt without reporting into a superseding route', async () => {
    let resolveRequest: (response: RpcResponse) => void = () => {}
    const sendRequest = vi.fn<RpcClient['sendRequest']>(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve
        })
    )
    const onDelivered = vi.fn()
    const onSuccess = vi.fn()
    const showToast = vi.fn()
    let report = true

    deliverCreatedTerminalPrompt({
      client: { sendRequest } as RpcClient,
      terminal: 'terminal-1',
      text: 'Review this',
      deviceToken: null,
      onDelivered,
      shouldReport: () => report,
      onSuccess,
      onError: vi.fn(),
      showToast
    })
    report = false
    resolveRequest({ id: 'rpc-1', ok: true, result: {}, _meta: { runtimeId: 'runtime-1' } })
    await vi.waitFor(() => expect(onDelivered).toHaveBeenCalledOnce())

    expect(onSuccess).not.toHaveBeenCalled()
    expect(showToast).not.toHaveBeenCalled()
  })
})
