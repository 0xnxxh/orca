import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PtyConsumerSessionGrant } from '../shared/pty-consumer-session'
import { RelayDispatcher } from './dispatcher'
import { encodeJsonRpcFrame, MessageType } from './protocol'
import { SshPtyConsumerDeliveryState } from './ssh-pty-consumer-delivery-state'

const grant: Readonly<PtyConsumerSessionGrant> = {
  protocolVersion: 1,
  serverBuildId: 'build-a',
  clientGeneration: 1,
  role: 'session-owner',
  ownerGeneration: 1,
  ownerLease: 'lease-a',
  resumed: false,
  capabilities: { heldProducerPause: { version: 1 } }
}

describe('SSH PTY consumer held pause', () => {
  let dispatcher: RelayDispatcher | null = null

  afterEach(() => {
    dispatcher?.dispose()
    dispatcher = null
  })

  it('awaits a routed physical-worker pause and releases it on detach', async () => {
    const writes: Buffer[] = []
    const setPaused = vi.fn(async () => true)
    dispatcher = new RelayDispatcher(
      (data, onSettled) => {
        writes.push(Buffer.from(data))
        onSettled({ ok: true })
        return true
      },
      { supportsWriteCallback: true }
    )
    const delivery = new SshPtyConsumerDeliveryState(
      dispatcher,
      (clientId) => (clientId === 1 ? grant : null),
      setPaused
    )

    dispatcher.feed(
      encodeJsonRpcFrame(
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'pty.setDeliveryPaused',
          params: {
            id: 'pty-1',
            paused: true,
            clientGeneration: 1,
            ownerGeneration: 1,
            ptyIncarnationId: 'incarnation-1',
            heldPauseToken: 'held-1'
          }
        },
        1,
        0
      )
    )
    await new Promise((resolve) => setImmediate(resolve))

    expect(responseResult(writes[0])).toEqual({ applied: true })
    expect(setPaused).toHaveBeenCalledWith('pty-1', true, undefined, {
      incarnationId: 'incarnation-1',
      token: 'held-1'
    })

    delivery.detach(grant)
    await vi.waitFor(() =>
      expect(setPaused).toHaveBeenLastCalledWith('pty-1', false, undefined, {
        incarnationId: 'incarnation-1',
        token: 'held-1'
      })
    )
  })
})

function responseResult(buffer: Buffer): Record<string, unknown> {
  expect(buffer[0]).toBe(MessageType.Regular)
  const length = buffer.readUInt32BE(9)
  const response = JSON.parse(buffer.subarray(13, 13 + length).toString('utf8'))
  return response.result as Record<string, unknown>
}
