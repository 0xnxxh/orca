import { afterEach, describe, expect, it } from 'vitest'
import { RelayDispatcher, type RelayClientSessionIdentity } from './dispatcher'
import { encodeJsonRpcFrame, MessageType } from './protocol'
import { SshPtyConsumerSessionAdapter } from './ssh-pty-consumer-session-adapter'

const endpointIdentity: RelayClientSessionIdentity = {
  principal: 'endpoint-principal',
  authenticated: true,
  allowSessionOwner: true,
  authenticationKind: 'endpoint-credential'
}

function openFrame(id: number, overrides: Record<string, unknown> = {}): Buffer {
  return encodeJsonRpcFrame(
    {
      jsonrpc: '2.0',
      id,
      method: 'pty.openClient',
      params: {
        protocolVersion: 1,
        clientInstanceId: `client-${id}`,
        requestedRole: 'session-owner',
        ...overrides
      }
    },
    1,
    0
  )
}

function responseResult(buffer: Buffer): Record<string, unknown> {
  expect(buffer[0]).toBe(MessageType.Regular)
  const length = buffer.readUInt32BE(9)
  return JSON.parse(buffer.subarray(13, 13 + length).toString('utf8')).result
}

async function flushRequests(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve))
}

describe('SshPtyConsumerSessionAdapter', () => {
  let dispatcher: RelayDispatcher | null = null

  afterEach(() => {
    dispatcher?.dispose()
    dispatcher = null
  })

  it('does not activate owner authority until the grant write settles', async () => {
    const firstWrites: Buffer[] = []
    const firstSettlements: ((result: { ok: true } | { ok: false; error: Error }) => void)[] = []
    dispatcher = new RelayDispatcher(
      (data, onSettled) => {
        firstWrites.push(Buffer.from(data))
        firstSettlements.push(onSettled)
        return true
      },
      { supportsWriteCallback: true },
      endpointIdentity
    )
    new SshPtyConsumerSessionAdapter(dispatcher, 'build-a')

    dispatcher.feed(openFrame(1))
    await flushRequests()

    const secondWrites: Buffer[] = []
    const secondId = dispatcher.attachClient(
      (data, onSettled) => {
        secondWrites.push(Buffer.from(data))
        onSettled({ ok: true })
        return true
      },
      { supportsWriteCallback: true },
      { ...endpointIdentity, principal: 'competitor' }
    )
    dispatcher.feedClient(secondId, openFrame(2))
    await flushRequests()

    expect(responseResult(firstWrites[0])).toMatchObject({
      role: 'session-owner',
      ownerGeneration: 1
    })
    expect(responseResult(secondWrites[0])).toMatchObject({ role: 'subscriber' })
    firstSettlements[0]({ ok: true })
  })

  it('rolls back owner election when the grant write fails', async () => {
    dispatcher = new RelayDispatcher(
      (_data, onSettled) => {
        onSettled({ ok: false, error: new Error('send failed') })
        return true
      },
      { supportsWriteCallback: true },
      endpointIdentity
    )
    new SshPtyConsumerSessionAdapter(dispatcher, 'build-a')
    dispatcher.feed(openFrame(1))
    await flushRequests()

    const retryWrites: Buffer[] = []
    const retryId = dispatcher.attachClient(
      (data, onSettled) => {
        retryWrites.push(Buffer.from(data))
        onSettled({ ok: true })
        return true
      },
      { supportsWriteCallback: true },
      endpointIdentity
    )
    dispatcher.feedClient(retryId, openFrame(2, { clientInstanceId: 'client-1' }))
    await flushRequests()

    expect(responseResult(retryWrites[0])).toMatchObject({
      role: 'session-owner',
      ownerGeneration: 2
    })
  })

  it('rejects an unproved constructor stream as an owner principal', async () => {
    const writes: Buffer[] = []
    dispatcher = new RelayDispatcher((data, onSettled) => {
      writes.push(Buffer.from(data))
      onSettled({ ok: true })
      return true
    })
    new SshPtyConsumerSessionAdapter(dispatcher, 'build-a')

    dispatcher.feed(openFrame(1))
    await flushRequests()

    const response = JSON.parse(
      writes[0].subarray(13, 13 + writes[0].readUInt32BE(9)).toString('utf8')
    )
    expect(response.error.message).toContain('authentication')
  })

  it('rejects an invalid requested role instead of promoting it to owner', async () => {
    const writes: Buffer[] = []
    dispatcher = new RelayDispatcher(
      (data, onSettled) => {
        writes.push(Buffer.from(data))
        onSettled({ ok: true })
        return true
      },
      { supportsWriteCallback: true },
      endpointIdentity
    )
    new SshPtyConsumerSessionAdapter(dispatcher, 'build-a')

    dispatcher.feed(openFrame(1, { requestedRole: 'administrator' }))
    await flushRequests()

    const response = JSON.parse(
      writes[0].subarray(13, 13 + writes[0].readUInt32BE(9)).toString('utf8')
    )
    expect(response.error.message).toContain('requestedRole')
  })

  it('generation-fences per-PTY delivery pause notifications', async () => {
    const setPaused: { id: string; paused: boolean }[] = []
    dispatcher = new RelayDispatcher(
      (_data, onSettled) => {
        onSettled({ ok: true })
        return true
      },
      { supportsWriteCallback: true },
      endpointIdentity
    )
    new SshPtyConsumerSessionAdapter(dispatcher, 'build-a', (id, paused) => {
      setPaused.push({ id, paused })
    })
    dispatcher.feed(openFrame(1))
    await flushRequests()

    dispatcher.feed(
      encodeJsonRpcFrame(
        {
          jsonrpc: '2.0',
          method: 'pty.setDeliveryPaused',
          params: {
            id: 'pty-1',
            paused: true,
            clientGeneration: 1,
            ownerGeneration: 1
          }
        },
        2,
        0
      )
    )
    dispatcher.feed(
      encodeJsonRpcFrame(
        {
          jsonrpc: '2.0',
          method: 'pty.setDeliveryPaused',
          params: {
            id: 'pty-1',
            paused: false,
            clientGeneration: 99,
            ownerGeneration: 1
          }
        },
        3,
        0
      )
    )

    expect(setPaused).toEqual([{ id: 'pty-1', paused: true }])
  })
})
