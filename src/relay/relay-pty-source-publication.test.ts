import { afterEach, describe, expect, it } from 'vitest'
import {
  RelayDispatcher,
  type RelayClientSessionIdentity,
  type SinkWriteSettlement
} from './dispatcher'
import { encodeJsonRpcFrame, MessageType } from './protocol'
import { RelayPtySourcePublication } from './relay-pty-source-publication'
import { SshPtyConsumerSessionAdapter } from './ssh-pty-consumer-session-adapter'

const endpointIdentity: RelayClientSessionIdentity = {
  principal: 'endpoint-principal',
  authenticated: true,
  allowSessionOwner: true,
  authenticationKind: 'endpoint-credential'
}

function requestFrame(id: number, method: string, params: Record<string, unknown>): Buffer {
  return encodeJsonRpcFrame({ jsonrpc: '2.0', id, method, params }, id, 0)
}

function notification(buffer: Buffer): { method: string; params: Record<string, unknown> } | null {
  if (buffer[0] !== MessageType.Regular) {
    return null
  }
  const length = buffer.readUInt32BE(9)
  const message = JSON.parse(buffer.subarray(13, 13 + length).toString('utf8'))
  return typeof message.method === 'string' && message.id === undefined ? message : null
}

function responseResult(buffer: Buffer): Record<string, unknown> | null {
  if (buffer[0] !== MessageType.Regular) {
    return null
  }
  const length = buffer.readUInt32BE(9)
  const message = JSON.parse(buffer.subarray(13, 13 + length).toString('utf8'))
  return message.id === undefined ? null : (message.result ?? null)
}

async function flushRequests(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve))
}

describe('RelayPtySourcePublication', () => {
  let dispatcher: RelayDispatcher | null = null

  afterEach(() => {
    dispatcher?.dispose()
    dispatcher = null
  })

  async function createHarness(
    windowSu = 4,
    settleSourceImmediately = true,
    highWaterMark?: number
  ) {
    const writes: Buffer[] = []
    const sourceSettlements: ((result: SinkWriteSettlement) => void)[] = []
    dispatcher = new RelayDispatcher(
      (data, onSettled) => {
        writes.push(Buffer.from(data))
        const frame = notification(data)
        if (frame?.method === 'pty.data' || frame?.method === 'pty.exit') {
          sourceSettlements.push(onSettled)
          if (settleSourceImmediately) {
            onSettled({ ok: true })
          }
        } else {
          onSettled({ ok: true })
        }
        return true
      },
      {
        supportsWriteCallback: true,
        ...(highWaterMark
          ? {
              writableLength: () => 0,
              writableHighWaterMark: () => highWaterMark
            }
          : {})
      },
      endpointIdentity
    )
    let publication: RelayPtySourcePublication
    const adapter = new SshPtyConsumerSessionAdapter(dispatcher, 'build-a', undefined, (id) =>
      publication.onCreditAvailable(id)
    )
    publication = new RelayPtySourcePublication(dispatcher, adapter, () => {})
    dispatcher.feed(
      requestFrame(1, 'pty.openClient', {
        protocolVersion: 1,
        clientInstanceId: 'client-1',
        requestedRole: 'session-owner',
        capabilities: { outputFlowControl: { versions: [1], requestedWindowSu: windowSu } }
      })
    )
    await flushRequests()
    const activationSettlements: ((result: SinkWriteSettlement) => void)[] = []
    expect(
      publication.activate('pty-1', 'incarnation-1', {
        clientId: 1,
        isStale: () => false,
        sessionIdentity: endpointIdentity,
        onResponseSettled: (callback) => activationSettlements.push(callback)
      })
    ).toBe('opened')
    activationSettlements[0]({ ok: true })
    return { adapter, publication, sourceSettlements, writes }
  }

  it('commits only from writer settlement and resumes exactly after cumulative ACK', async () => {
    const harness = await createHarness(4, false)
    expect(harness.publication.publish('pty-1', { data: 'abcdefgh' }, false)).toBe(true)
    expect(harness.publication.getDebugSnapshot()).toMatchObject({
      outstandingSourceUnits: 0,
      sendCommitted: 0
    })

    harness.sourceSettlements[0]({ ok: true })
    expect(harness.publication.getDebugSnapshot()).toMatchObject({
      outstandingSourceUnits: 4,
      sendCommitted: 1
    })
    const first = harness.writes.map(notification).find((frame) => frame?.method === 'pty.data')!
    dispatcher!.feed(
      encodeJsonRpcFrame(
        {
          jsonrpc: '2.0',
          method: 'pty.ackData',
          params: {
            acknowledgements: [
              {
                id: 'pty-1',
                clientGeneration: first.params.clientGeneration,
                ownerGeneration: first.params.ownerGeneration,
                deliveryToken: first.params.deliveryToken,
                creditedEndSu: 4
              }
            ]
          }
        },
        2,
        0
      )
    )
    expect(
      harness.writes.map(notification).filter((frame) => frame?.method === 'pty.data')
    ).toHaveLength(2)
    await flushRequests()
  })

  it('slices source frames to the encoded HWM-minus-reserve capacity', async () => {
    const highWaterMark = 4096
    const harness = await createHarness(10_000, true, highWaterMark)
    const payload = '\u0000'.repeat(4000)

    expect(harness.publication.publish('pty-1', { data: payload }, false)).toBe(true)
    for (let turn = 0; turn < 4; turn++) {
      await flushRequests()
    }

    const frames = harness.writes.filter((buffer) => notification(buffer)?.method === 'pty.data')
    expect(frames.length).toBeGreaterThan(1)
    expect(Math.max(...frames.map((buffer) => buffer.length))).toBeLessThanOrEqual(3072)
    expect(
      frames
        .map(notification)
        .map((frame) => frame!.params.data)
        .join('')
    ).toBe(payload)
  })

  it('keeps mixed legacy and V1 clients on distinct frame authority', async () => {
    const harness = await createHarness(8)
    const legacyWrites: Buffer[] = []
    dispatcher!.attachClient(
      (data, onSettled) => {
        legacyWrites.push(Buffer.from(data))
        onSettled({ ok: true })
        return true
      },
      { supportsWriteCallback: true }
    )

    harness.publication.publish('pty-1', { data: 'data' }, false)

    const sourceFrame = harness.writes
      .map(notification)
      .find((frame) => frame?.method === 'pty.data')!
    const oldGrant = harness.writes.map(responseResult).find((result) => result?.ownerLease)!
    const legacyFrame = legacyWrites
      .map(notification)
      .find((frame) => frame?.method === 'pty.data')!
    expect(sourceFrame.params).toMatchObject({
      data: 'data',
      sourceEndSu: 4,
      sourceLengthSu: 4
    })
    expect(legacyFrame.params).toEqual({ id: 'pty-1', data: 'data' })

    dispatcher!.invalidateClient()
    const replacementWrites: Buffer[] = []
    const replacementClientId = dispatcher!.attachClient(
      (data, onSettled) => {
        replacementWrites.push(Buffer.from(data))
        onSettled({ ok: true })
        return true
      },
      { supportsWriteCallback: true },
      endpointIdentity
    )
    dispatcher!.feedClient(
      replacementClientId,
      requestFrame(2, 'pty.openClient', {
        protocolVersion: 1,
        clientInstanceId: 'client-1',
        requestedRole: 'session-owner',
        resume: {
          ownerGeneration: oldGrant.ownerGeneration,
          ownerLease: oldGrant.ownerLease
        },
        capabilities: { outputFlowControl: { versions: [1], requestedWindowSu: 8 } }
      })
    )
    await flushRequests()
    harness.publication.publish('pty-1', { data: 'next' }, false)

    expect(
      replacementWrites.map(notification).filter((frame) => frame?.method === 'pty.data')
    ).toHaveLength(0)
    expect(
      legacyWrites.map(notification).filter((frame) => frame?.method === 'pty.data')
    ).toHaveLength(2)
  })

  it('rolls back a failed source write without advancing the sent window', async () => {
    const harness = await createHarness(4, false)
    harness.publication.publish('pty-1', { data: 'data' }, false)
    harness.sourceSettlements[0]({ ok: false, error: new Error('socket write failed') })

    expect(harness.publication.getDebugSnapshot()).toMatchObject({
      outstandingSourceUnits: 0,
      sendCommitted: 0,
      sendRolledBack: 1
    })
  })

  it('fences idle publication and pumping before the wait continuation', async () => {
    const harness = await createHarness(4)
    harness.publication.publish('pty-1', { data: 'abcdefgh' }, false)
    const firstData = harness.writes
      .map(notification)
      .find((frame) => frame?.method === 'pty.data')!
    const fence = harness.publication.waitForPendingSend('pty-1')

    expect(harness.publication.publish('pty-1', { data: 'ijkl' }, false)).toBe(false)
    dispatcher!.feed(
      encodeJsonRpcFrame(
        {
          jsonrpc: '2.0',
          method: 'pty.ackData',
          params: {
            acknowledgements: [
              {
                id: 'pty-1',
                clientGeneration: firstData.params.clientGeneration,
                ownerGeneration: firstData.params.ownerGeneration,
                deliveryToken: firstData.params.deliveryToken,
                creditedEndSu: 4
              }
            ]
          }
        },
        2,
        0
      )
    )
    expect(
      harness.writes.map(notification).filter((frame) => frame?.method === 'pty.data')
    ).toHaveLength(1)
    expect(await fence).toBe(true)

    expect(
      harness.publication.activate('pty-1', 'incarnation-1', {
        clientId: 1,
        isStale: () => false,
        sessionIdentity: endpointIdentity,
        onResponseSettled: () => {}
      })
    ).toBe('existing')
    expect(
      harness.writes.map(notification).filter((frame) => frame?.method === 'pty.data')
    ).toHaveLength(2)
    await flushRequests()
  })

  it('does not pump an old-token suffix after a successful fenced settlement', async () => {
    const harness = await createHarness(4, false)
    harness.publication.publish('pty-1', { data: 'abcdefgh' }, false)
    const oldData = harness.writes.map(notification).find((frame) => frame?.method === 'pty.data')!
    const oldGrant = harness.writes.map(responseResult).find((result) => result?.ownerLease)!
    const fence = harness.publication.waitForPendingSend('pty-1')

    harness.sourceSettlements[0]({ ok: true })
    expect(await fence).toBe(true)
    expect(
      harness.writes.map(notification).filter((frame) => frame?.method === 'pty.data')
    ).toHaveLength(1)
    dispatcher!.invalidateClient()

    const recoveredWrites: Buffer[] = []
    const recoveredClientId = dispatcher!.attachClient(
      (data, onSettled) => {
        recoveredWrites.push(Buffer.from(data))
        onSettled({ ok: true })
        return true
      },
      { supportsWriteCallback: true },
      endpointIdentity
    )
    dispatcher!.feedClient(
      recoveredClientId,
      requestFrame(2, 'pty.openClient', {
        protocolVersion: 1,
        clientInstanceId: 'client-1',
        requestedRole: 'session-owner',
        resume: {
          ownerGeneration: oldGrant.ownerGeneration,
          ownerLease: oldGrant.ownerLease
        },
        capabilities: { outputFlowControl: { versions: [1], requestedWindowSu: 4 } }
      })
    )
    await flushRequests()
    const activationSettlements: ((result: SinkWriteSettlement) => void)[] = []
    expect(
      harness.publication.activate(
        'pty-1',
        'incarnation-1',
        {
          clientId: recoveredClientId,
          isStale: () => false,
          sessionIdentity: endpointIdentity,
          onResponseSettled: (callback) => activationSettlements.push(callback)
        },
        {
          status: 'checkpoint',
          deliveryToken: String(oldData.params.deliveryToken),
          clientGeneration: Number(oldData.params.clientGeneration),
          ownerGeneration: Number(oldData.params.ownerGeneration),
          ptyIncarnation: 'incarnation-1',
          acceptedSourceEndSu: 4
        }
      )
    ).toMatchObject({ status: 'pending', checkpointSourceEndSu: 4, recoveryEndSu: 8 })
    activationSettlements[0]({ ok: true })

    const replacementData = recoveredWrites
      .map(notification)
      .find((frame) => frame?.method === 'pty.data')!
    expect(replacementData.params).toMatchObject({ data: 'efgh', sourceEndSu: 8 })
    expect(replacementData.params.deliveryToken).not.toBe(oldData.params.deliveryToken)
    expect(
      harness.writes.map(notification).filter((frame) => frame?.method === 'pty.data')
    ).toHaveLength(1)
  })

  it('recovers a receiver-accepted frame after detach rolls back its send', async () => {
    const harness = await createHarness(4, false)
    harness.publication.publish('pty-1', { data: 'data' }, false)
    const oldData = harness.writes.map(notification).find((frame) => frame?.method === 'pty.data')!
    const oldGrant = harness.writes.map(responseResult).find((result) => result?.ownerLease)!
    let fenceSettled = false
    const fence = harness.publication.waitForPendingSend('pty-1').then((result) => {
      fenceSettled = true
      return result
    })
    await Promise.resolve()
    expect(fenceSettled).toBe(false)

    dispatcher!.invalidateClient()
    expect(await fence).toBe(true)
    expect(harness.publication.getDebugSnapshot()).toMatchObject({
      sendCommitted: 0,
      sendRolledBack: 1
    })

    const recoveredWrites: Buffer[] = []
    const recoveredClientId = dispatcher!.attachClient(
      (data, onSettled) => {
        recoveredWrites.push(Buffer.from(data))
        onSettled({ ok: true })
        return true
      },
      { supportsWriteCallback: true },
      endpointIdentity
    )
    dispatcher!.feedClient(
      recoveredClientId,
      requestFrame(2, 'pty.openClient', {
        protocolVersion: 1,
        clientInstanceId: 'client-1',
        requestedRole: 'session-owner',
        resume: {
          ownerGeneration: oldGrant.ownerGeneration,
          ownerLease: oldGrant.ownerLease
        },
        capabilities: { outputFlowControl: { versions: [1], requestedWindowSu: 4 } }
      })
    )
    await flushRequests()
    const activationSettlements: ((result: SinkWriteSettlement) => void)[] = []
    const activation = harness.publication.activate(
      'pty-1',
      'incarnation-1',
      {
        clientId: recoveredClientId,
        isStale: () => false,
        sessionIdentity: endpointIdentity,
        onResponseSettled: (callback) => activationSettlements.push(callback)
      },
      {
        status: 'checkpoint',
        deliveryToken: String(oldData.params.deliveryToken),
        clientGeneration: Number(oldData.params.clientGeneration),
        ownerGeneration: Number(oldData.params.ownerGeneration),
        ptyIncarnation: 'incarnation-1',
        acceptedSourceEndSu: 4
      }
    )
    expect(activation).toMatchObject({
      status: 'pending',
      checkpointSourceEndSu: 4,
      recoveryEndSu: 4
    })
    activationSettlements[0]({ ok: true })
    expect(
      recoveredWrites.map(notification).filter((frame) => frame?.method === 'pty.data')
    ).toHaveLength(0)
    expect(
      recoveredWrites.map(notification).find((frame) => frame?.method === 'pty.recoveryComplete')
        ?.params
    ).toMatchObject({ checkpointSourceEndSu: 4, recoveryEndSu: 4 })
    const beforeLateSettlement = harness.publication.getDebugSnapshot()

    harness.sourceSettlements[0]({ ok: true })

    expect(harness.publication.getDebugSnapshot()).toEqual(beforeLateSettlement)
  })

  it('publishes exit only after preceding source data settles', async () => {
    const harness = await createHarness(4, false)
    harness.publication.publish('pty-1', { data: 'data' }, false)
    expect(
      harness.publication.sealAndPublishExit({
        id: 'pty-1',
        code: 0,
        incarnationId: 'incarnation-1'
      })
    ).toBe(false)

    harness.sourceSettlements[0]({ ok: true })
    expect(
      harness.publication.sealAndPublishExit({
        id: 'pty-1',
        code: 0,
        incarnationId: 'incarnation-1'
      })
    ).toBe(true)
    expect(
      harness.writes
        .map(notification)
        .filter((frame): frame is NonNullable<typeof frame> => frame !== null)
        .map((frame) => frame.method)
    ).toEqual(['pty.data', 'pty.exit'])
  })

  it('keeps gate-off same-build sessions on legacy capability omission', async () => {
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
    new SshPtyConsumerSessionAdapter(dispatcher, 'build-a', undefined, undefined, false)
    dispatcher.feed(
      requestFrame(1, 'pty.openClient', {
        protocolVersion: 1,
        clientInstanceId: 'client-1',
        requestedRole: 'session-owner',
        capabilities: { outputFlowControl: { versions: [1], requestedWindowSu: 4 } }
      })
    )
    await flushRequests()

    expect(
      writes
        .map((buffer) => {
          const length = buffer.readUInt32BE(9)
          return JSON.parse(buffer.subarray(13, 13 + length).toString('utf8')).result
        })
        .find(Boolean)
    ).not.toHaveProperty('capabilities')
  })

  it('settles retained recovery before the fence and publishes later live output after it', async () => {
    const harness = await createHarness(4)
    harness.publication.publish('pty-1', { data: 'abcdefgh' }, false)
    const firstData = harness.writes
      .map(notification)
      .find((frame) => frame?.method === 'pty.data')!
    const firstGrant = harness.writes.map(responseResult).find((result) => result?.ownerLease)!
    dispatcher!.invalidateClient()

    const recoveredWrites: Buffer[] = []
    const recoverySettlements: ((result: SinkWriteSettlement) => void)[] = []
    const recoveredClientId = dispatcher!.attachClient(
      (data, onSettled) => {
        recoveredWrites.push(Buffer.from(data))
        if (notification(data)?.method === 'pty.data') {
          recoverySettlements.push(onSettled)
        } else {
          onSettled({ ok: true })
        }
        return true
      },
      { supportsWriteCallback: true },
      endpointIdentity
    )
    dispatcher!.feedClient(
      recoveredClientId,
      requestFrame(2, 'pty.openClient', {
        protocolVersion: 1,
        clientInstanceId: 'client-1',
        requestedRole: 'session-owner',
        resume: {
          ownerGeneration: firstGrant.ownerGeneration,
          ownerLease: firstGrant.ownerLease
        },
        capabilities: { outputFlowControl: { versions: [1], requestedWindowSu: 4 } }
      })
    )
    await flushRequests()
    const activationSettlements: ((result: SinkWriteSettlement) => void)[] = []
    const activation = harness.publication.activate(
      'pty-1',
      'incarnation-1',
      {
        clientId: recoveredClientId,
        isStale: () => false,
        sessionIdentity: endpointIdentity,
        onResponseSettled: (callback) => activationSettlements.push(callback)
      },
      {
        status: 'checkpoint',
        deliveryToken: String(firstData.params.deliveryToken),
        clientGeneration: Number(firstData.params.clientGeneration),
        ownerGeneration: Number(firstData.params.ownerGeneration),
        ptyIncarnation: 'incarnation-1',
        acceptedSourceEndSu: 4
      }
    )
    expect(activation).toMatchObject({
      status: 'pending',
      checkpointSourceEndSu: 4,
      recoveryEndSu: 8
    })
    activationSettlements[0]({ ok: true })
    harness.publication.publish('pty-1', { data: 'ijkl' }, false)

    expect(
      recoveredWrites.map(notification).filter((frame) => frame?.method === 'pty.recoveryComplete')
    ).toHaveLength(0)
    recoverySettlements[0]({ ok: true })
    const recoveredData = recoveredWrites
      .map(notification)
      .find((frame) => frame?.method === 'pty.data')!
    dispatcher!.feedClient(
      recoveredClientId,
      encodeJsonRpcFrame(
        {
          jsonrpc: '2.0',
          method: 'pty.ackData',
          params: {
            acknowledgements: [
              {
                id: 'pty-1',
                clientGeneration: recoveredData.params.clientGeneration,
                ownerGeneration: recoveredData.params.ownerGeneration,
                deliveryToken: recoveredData.params.deliveryToken,
                creditedEndSu: 8
              }
            ]
          }
        },
        3,
        0
      )
    )

    expect(
      recoveredWrites
        .map(notification)
        .filter((frame): frame is NonNullable<typeof frame> => frame !== null)
        .map((frame) => frame.method)
    ).toEqual(['pty.deliveryCanceled', 'pty.data', 'pty.recoveryComplete', 'pty.data'])
    await flushRequests()
  })
})
