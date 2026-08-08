import { describe, expect, it, vi } from 'vitest'
import type {
  SshChannelMultiplexer,
  SshMultiplexerRequestOptions
} from '../main/ssh/ssh-channel-multiplexer'
import type { RelayDispatcher, RequestContext } from './dispatcher'
import { TerminalAuthorityGateway } from './terminal-authority-gateway'
import {
  TERMINAL_AUTHORITY_NAMESPACE_BOUNDARY_NOTIFICATION,
  TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_NOTIFICATION
} from '../shared/terminal-session-authority-consumer-transport'

type RequestHandler = (params: Record<string, unknown>, context: RequestContext) => Promise<unknown>
type NotificationHandler = (params: Record<string, unknown>, context: RequestContext) => void
type ResponseSettlement =
  | { ok: true }
  | { ok: false; error: Error; responseDelivered?: false }
  | { ok: false; error: Error; responseDelivered: true }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

function harness() {
  const requests = new Map<string, RequestHandler>()
  const notifications = new Map<string, NotificationHandler>()
  let clientDetached: ((clientId: number) => void) | undefined
  let authorityNotification: ((method: string, params: Record<string, unknown>) => void) | undefined
  let authorityDisposed: ((reason: 'shutdown' | 'connection_lost') => void) | undefined
  const dataSettlements: ((result: ResponseSettlement) => void)[] = []
  const dispatcher = {
    onRequest: vi.fn((method: string, handler: RequestHandler) => requests.set(method, handler)),
    onNotification: vi.fn((method: string, handler: NotificationHandler) =>
      notifications.set(method, handler)
    ),
    onClientDetached: vi.fn((handler: (clientId: number) => void) => {
      clientDetached = handler
      return () => {}
    }),
    publishProducerNotification: vi.fn(() => true),
    publishTerminalAuthorityData: vi.fn(
      (
        _clientId: number,
        _params: Record<string, unknown>,
        onSettled: (result: ResponseSettlement) => void
      ) => {
        dataSettlements.push(onSettled)
        return true
      }
    ),
    tryNotifyClient: vi.fn(() => true)
  }
  const mux = {
    request: vi.fn(
      async (
        method: string,
        params?: Record<string, unknown>,
        options?: SshMultiplexerRequestOptions
      ): Promise<Record<string, unknown>> => {
        const result: Record<string, unknown> =
          method === 'pty.spawn'
            ? { id: 'pty-1' }
            : method === 'pty.openClient'
              ? {
                  capabilities: {
                    exactOperations: { version: 1 },
                    ...(typeof params?.capabilities === 'object' &&
                    params.capabilities !== null &&
                    'terminalAuthorityExactOperations' in params.capabilities
                      ? { terminalAuthorityExactOperations: { version: 1 } }
                      : {})
                  }
                }
              : { granted: true }
        options?.beforeResolve?.(result)
        return result
      }
    ),
    notify: vi.fn(() => true),
    onNotification: vi.fn((handler: (method: string, params: Record<string, unknown>) => void) => {
      authorityNotification = handler
      return () => {}
    }),
    onDispose: vi.fn((handler: (reason: 'shutdown' | 'connection_lost') => void) => {
      authorityDisposed = handler
      return () => {}
    }),
    dispose: vi.fn()
  }
  const onFailure = vi.fn()
  const gateway = new TerminalAuthorityGateway(
    dispatcher as unknown as RelayDispatcher,
    mux as unknown as SshChannelMultiplexer,
    onFailure
  )
  const context = (
    clientId: number,
    settle?: (handler: (result: ResponseSettlement) => void) => void,
    prepare?: (handler: () => void) => void
  ) =>
    ({
      clientId,
      isStale: () => false,
      signal: new AbortController().signal,
      sessionIdentity: {
        principal: 'test',
        authenticated: true,
        allowSessionOwner: true,
        authenticationKind: 'endpoint-credential'
      },
      onResponsePrepared: prepare ?? (() => {}),
      onResponseSettled: settle ?? (() => {})
    }) satisfies RequestContext
  const openClient = async (
    clientId: number,
    params: Record<string, unknown> = {}
  ): Promise<unknown> => {
    let prepare: (() => void) | undefined
    let settle: ((result: ResponseSettlement) => void) | undefined
    const result = await requests.get('pty.openClient')?.(
      {
        capabilities: {
          exactOperations: { versions: [1] },
          terminalAuthorityExactOperations: { versions: [1] }
        },
        ...params
      },
      context(
        clientId,
        (handler) => {
          settle = handler
        },
        (handler) => {
          prepare = handler
        }
      )
    )
    prepare?.()
    settle?.({ ok: true })
    return result
  }
  return {
    requests,
    notifications,
    dispatcher,
    mux,
    gateway,
    onFailure,
    context,
    openClient,
    dataSettlements,
    authorityEvent: (method: string, params: Record<string, unknown>) =>
      authorityNotification?.(method, params),
    detachClient: (clientId: number) => clientDetached?.(clientId),
    loseAuthority: () => authorityDisposed?.('connection_lost')
  }
}

describe('terminal authority gateway', () => {
  it('permits authenticated pre-open legacy migration controls only to session owners', async () => {
    const methods = [
      'terminalAuthority.legacyPhysicalWorker.inspect',
      'terminalAuthority.legacyPhysicalWorker.migrationBarrier',
      'terminalAuthority.legacyPhysicalWorker.migrate',
      'terminalAuthority.legacyPhysicalWorker.gcProtection',
      'terminalAuthority.legacyPhysicalWorker.gc'
    ]
    const h = harness()
    for (const method of methods) {
      await expect(h.requests.get(method)?.({}, h.context(1))).resolves.toEqual({ granted: true })
      await expect(
        h.requests.get(method)?.(
          {},
          {
            ...h.context(1),
            sessionIdentity: { ...h.context(1).sessionIdentity, authenticated: false }
          }
        )
      ).rejects.toThrow('not_authenticated')
      await expect(
        h.requests.get(method)?.(
          {},
          {
            ...h.context(1),
            sessionIdentity: { ...h.context(1).sessionIdentity, allowSessionOwner: false }
          }
        )
      ).rejects.toThrow('not_authenticated')
    }
    await h.openClient(1)
    await expect(h.requests.get(methods[0])?.({}, h.context(1))).rejects.toThrow('already_admitted')
  })

  it('admits one downstream owner before forwarding PTY mutations', async () => {
    const h = harness()
    await expect(h.requests.get('pty.spawn')?.({}, h.context(7))).rejects.toThrow(
      'client_not_admitted'
    )

    await h.openClient(7, { clientInstanceId: 'client' })
    h.notifications.get('pty.dataAuthorityExact')?.(
      { id: 'pty-1', terminalSessionAuthorityAccess: { marker: 'access' }, data: 'x' },
      h.context(7)
    )

    expect(h.mux.request).toHaveBeenCalledWith(
      'pty.openClient',
      {
        clientInstanceId: 'client',
        capabilities: {
          exactOperations: { versions: [1] },
          terminalAuthorityExactOperations: { versions: [1] }
        }
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
    expect(h.mux.notify).toHaveBeenCalledWith('pty.dataAuthorityExact', {
      id: 'pty-1',
      terminalSessionAuthorityAccess: { marker: 'access' },
      data: 'x'
    })
  })

  it('forwards namespace outcome notifications without requiring a PTY identity', async () => {
    const h = harness()
    await h.openClient(7)

    h.authorityEvent(TERMINAL_AUTHORITY_NAMESPACE_BOUNDARY_NOTIFICATION, {
      boundary: { version: 1 }
    })
    h.authorityEvent(TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_NOTIFICATION, {
      publication: { version: 1 }
    })

    expect(h.dispatcher.tryNotifyClient).toHaveBeenNthCalledWith(
      1,
      7,
      TERMINAL_AUTHORITY_NAMESPACE_BOUNDARY_NOTIFICATION,
      { boundary: { version: 1 } }
    )
    expect(h.dispatcher.tryNotifyClient).toHaveBeenNthCalledWith(
      2,
      7,
      TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_NOTIFICATION,
      { publication: { version: 1 } }
    )
    expect(h.onFailure).not.toHaveBeenCalled()
  })

  it('rejects omitted exact negotiation before admitting the stable authority client', async () => {
    const h = harness()

    await expect(h.requests.get('pty.openClient')?.({}, h.context(7))).rejects.toThrow(
      'exact_operations_required'
    )

    expect(h.mux.request).not.toHaveBeenCalled()
    expect(h.mux.notify).not.toHaveBeenCalled()
  })

  it('fails closed when the authority omits the requested exact grant', async () => {
    const h = harness()
    h.mux.request.mockResolvedValueOnce({ capabilities: {} })

    await expect(h.openClient(7)).rejects.toThrow('exact_operations_not_granted')
    h.notifications.get('pty.data')?.({ id: 'pty-1', data: 'legacy' }, h.context(7))

    expect(h.mux.notify).not.toHaveBeenCalled()
    expect(h.onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('not_granted') })
    )
  })

  it('rejects legacy mutations after exact authority admission', async () => {
    const h = harness()
    await h.openClient(7)

    await expect(h.requests.get('pty.shutdown')?.({ id: 'pty-1' }, h.context(7))).rejects.toThrow(
      'legacy_mutation_rejected'
    )
    h.notifications.get('pty.data')?.({ id: 'pty-1', data: 'legacy' }, h.context(7))

    expect(h.mux.request).not.toHaveBeenCalledWith(
      'pty.shutdown',
      expect.anything(),
      expect.anything()
    )
    expect(h.mux.notify).not.toHaveBeenCalledWith('pty.data', expect.anything())
    expect(h.onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('legacy mutation') })
    )
  })

  it('forwards all full-binding mutations only after the authority grant', async () => {
    const h = harness()
    await h.openClient(7, {
      capabilities: {
        exactOperations: { versions: [1] },
        terminalAuthorityExactOperations: { versions: [1] }
      }
    })
    const request = {
      id: 'pty-1',
      terminalSessionAuthorityAccess: { marker: 'exact' }
    }

    h.notifications.get('pty.dataAuthorityExact')?.({ ...request, data: 'input' }, h.context(7))
    h.notifications.get('pty.resizeAuthorityExact')?.(
      { ...request, cols: 120, rows: 40 },
      h.context(7)
    )
    await expect(
      h.requests.get('pty.sendSignalAuthorityExact')?.(
        { ...request, signal: 'SIGTERM' },
        h.context(7)
      )
    ).resolves.toEqual({ granted: true })
    await expect(
      h.requests.get('pty.clearBufferAuthorityExact')?.(request, h.context(7))
    ).resolves.toEqual({ granted: true })

    await expect(
      h.requests.get('pty.shutdownAuthorityExact')?.(
        { ...request, immediate: true, keepHistory: false },
        h.context(7)
      )
    ).resolves.toEqual({ granted: true })
    expect(h.mux.notify).toHaveBeenCalledWith('pty.dataAuthorityExact', {
      ...request,
      data: 'input'
    })
    expect(h.mux.notify).toHaveBeenCalledWith('pty.resizeAuthorityExact', {
      ...request,
      cols: 120,
      rows: 40
    })
    expect(h.mux.request).toHaveBeenLastCalledWith(
      'pty.shutdownAuthorityExact',
      { ...request, immediate: true, keepHistory: false },
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
  })

  it('rejects incarnation-only exact mutations after authority admission', async () => {
    const h = harness()
    await h.openClient(7)

    await expect(
      h.requests.get('pty.shutdownExact')?.(
        { id: 'pty-1', incarnationId: 'incarnation-1' },
        h.context(7)
      )
    ).rejects.toThrow('incarnation_mutation_rejected')
    h.notifications.get('pty.dataExact')?.(
      { id: 'pty-1', incarnationId: 'incarnation-1', data: 'blocked' },
      h.context(7)
    )

    expect(h.mux.request).not.toHaveBeenCalledWith(
      'pty.shutdownExact',
      expect.anything(),
      expect.anything()
    )
    expect(h.mux.notify).not.toHaveBeenCalledWith('pty.dataExact', expect.anything())
    expect(h.onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('incarnation mutation') })
    )
  })

  it('rejects authority exact shutdown when the client omitted its offer', async () => {
    const h = harness()
    await expect(
      h.requests.get('pty.openClient')?.(
        { capabilities: { exactOperations: { versions: [1] } } },
        h.context(7)
      )
    ).rejects.toThrow('exact_operations_required')
    expect(h.mux.request).not.toHaveBeenCalled()
  })

  it('holds a saturated PTY outcome until preceding downstream data settles', async () => {
    const h = harness()
    await h.openClient(3)

    h.authorityEvent('pty.data', { id: 'pty-1', data: 'output' })
    h.authorityEvent('pty.exit', { id: 'pty-1', code: 0 })

    expect(h.dispatcher.publishTerminalAuthorityData).toHaveBeenCalledWith(
      3,
      { id: 'pty-1', data: 'output' },
      expect.any(Function)
    )
    expect(h.dispatcher.tryNotifyClient).not.toHaveBeenCalled()

    h.dataSettlements[0]({ ok: true })
    expect(h.dispatcher.tryNotifyClient).toHaveBeenCalledWith(3, 'pty.exit', {
      id: 'pty-1',
      code: 0
    })
  })

  it('holds open-client recovery until the downstream grant is settled', async () => {
    const h = harness()
    h.mux.request.mockImplementationOnce(async () => {
      h.authorityEvent('pty.recoveryComplete', { id: 'pty-1', clientGeneration: 1 })
      return {
        capabilities: {
          exactOperations: { version: 1 },
          terminalAuthorityExactOperations: { version: 1 }
        }
      }
    })
    let prepareResponse: (() => void) | undefined
    let settleResponse: ((result: ResponseSettlement) => void) | undefined

    await h.requests.get('pty.openClient')?.(
      {
        capabilities: {
          exactOperations: { versions: [1] },
          terminalAuthorityExactOperations: { versions: [1] }
        }
      },
      h.context(
        8,
        (handler) => {
          settleResponse = handler
        },
        (handler) => {
          prepareResponse = handler
        }
      )
    )

    prepareResponse?.()
    expect(h.dispatcher.tryNotifyClient).not.toHaveBeenCalled()
    settleResponse?.({ ok: true })
    expect(h.dispatcher.tryNotifyClient).toHaveBeenCalledWith(8, 'pty.recoveryComplete', {
      id: 'pty-1',
      clientGeneration: 1
    })
  })

  it('admits an exact follow-up before the open-client write settles', async () => {
    const h = harness()
    let prepareResponse: (() => void) | undefined
    let settleResponse: ((result: ResponseSettlement) => void) | undefined

    await h.requests.get('pty.openClient')?.(
      {
        capabilities: {
          exactOperations: { versions: [1] },
          terminalAuthorityExactOperations: { versions: [1] }
        }
      },
      h.context(
        17,
        (handler) => {
          settleResponse = handler
        },
        (handler) => {
          prepareResponse = handler
        }
      )
    )
    prepareResponse?.()

    await expect(h.requests.get('pty.attach')?.({ id: 'pty-1' }, h.context(17))).resolves.toEqual({
      granted: true
    })
    expect(h.onFailure).not.toHaveBeenCalled()
    settleResponse?.({ ok: true })
  })

  it('forwards held-producer pause requests to the authority relay', async () => {
    const h = harness()
    await h.openClient(17)
    const params = {
      id: 'pty-1',
      paused: true,
      clientGeneration: 1,
      ownerGeneration: 1,
      ptyIncarnationId: 'incarnation-1',
      heldPauseToken: 'pause-1'
    }

    await expect(h.requests.get('pty.setDeliveryPaused')?.(params, h.context(17))).resolves.toEqual(
      { granted: true }
    )
    expect(h.mux.request).toHaveBeenCalledWith(
      'pty.setDeliveryPaused',
      params,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
  })

  it('rejects a second downstream owner', async () => {
    const h = harness()
    await h.openClient(1)

    await expect(h.openClient(2)).rejects.toThrow('client_already_admitted')
    expect(h.mux.request).toHaveBeenCalledTimes(1)
  })

  it('does not elevate an unproved control-adapter client through the authority socket', async () => {
    const h = harness()
    const unproved: RequestContext = {
      ...h.context(2),
      sessionIdentity: {
        principal: 'unproved:2',
        authenticated: false,
        allowSessionOwner: false,
        authenticationKind: 'unproved'
      }
    }

    await expect(h.requests.get('pty.openClient')?.({}, unproved)).rejects.toThrow(
      'not_authenticated'
    )
    expect(h.mux.request).not.toHaveBeenCalled()
  })

  it('holds spawn output until the downstream response is durably settled', async () => {
    const h = harness()
    await h.openClient(4)
    const upstream = deferred<{ id: string; granted: boolean }>()
    h.mux.request.mockImplementationOnce(async (_method, _params, options) => {
      const result = await upstream.promise
      options?.beforeResolve?.(result)
      return result
    })
    let settleResponse: ((result: ResponseSettlement) => void) | undefined
    const spawn = h.requests.get('pty.spawn')?.(
      {},
      h.context(4, (handler) => {
        settleResponse = handler
      })
    )

    upstream.resolve({ id: 'pty-1', granted: true })
    await spawn
    h.authorityEvent('pty.data', { id: 'pty-1', data: 'early' })
    expect(h.dispatcher.publishTerminalAuthorityData).not.toHaveBeenCalled()

    settleResponse?.({ ok: true })
    expect(h.dispatcher.publishTerminalAuthorityData).toHaveBeenCalledWith(
      4,
      { id: 'pty-1', data: 'early' },
      expect.any(Function)
    )
  })

  it('remembers a failed response while another ordered response remains in flight', async () => {
    const h = harness()
    await h.openClient(6)
    let settleSpawn: ((result: ResponseSettlement) => void) | undefined
    let settleAttach: ((result: ResponseSettlement) => void) | undefined

    await Promise.all([
      h.requests.get('pty.spawn')?.(
        {},
        h.context(6, (handler) => {
          settleSpawn = handler
        })
      ),
      h.requests.get('pty.attach')?.(
        { id: 'pty-1' },
        h.context(6, (handler) => {
          settleAttach = handler
        })
      )
    ])
    h.authorityEvent('pty.data', { id: 'pty-1', data: 'held' })

    settleSpawn?.({ ok: false, error: new Error('response lost') })
    settleAttach?.({ ok: true })

    expect(h.dispatcher.publishTerminalAuthorityData).not.toHaveBeenCalled()
    expect(h.onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('did not reach') })
    )
  })

  it('does not fail the gateway when an authority application error is delivered', async () => {
    const h = harness()
    await h.openClient(16)
    let settleAttach: ((result: ResponseSettlement) => void) | undefined

    await h.requests.get('pty.attach')?.(
      { id: 'pty-1' },
      h.context(16, (handler) => {
        settleAttach = handler
      })
    )
    h.authorityEvent('pty.recoveryComplete', { id: 'pty-1' })

    settleAttach?.({
      ok: false,
      error: new Error('terminal_authority_required'),
      responseDelivered: true
    })

    expect(h.onFailure).not.toHaveBeenCalled()
    expect(h.dispatcher.tryNotifyClient).toHaveBeenCalledWith(16, 'pty.recoveryComplete', {
      id: 'pty-1'
    })
  })

  it('does not hold unrelated output behind an attach response', async () => {
    const h = harness()
    await h.openClient(10)
    let settleAttach: ((result: ResponseSettlement) => void) | undefined

    await h.requests.get('pty.attach')?.(
      { id: 'pty-fenced' },
      h.context(10, (handler) => {
        settleAttach = handler
      })
    )
    h.authorityEvent('pty.data', { id: 'pty-other', data: 'immediate' })
    h.authorityEvent('pty.replay', { id: 'pty-fenced', data: 'ordered' })

    expect(h.dispatcher.publishTerminalAuthorityData).toHaveBeenCalledWith(
      10,
      { id: 'pty-other', data: 'immediate' },
      expect.any(Function)
    )
    expect(h.dispatcher.tryNotifyClient).not.toHaveBeenCalledWith(
      10,
      'pty.replay',
      expect.anything()
    )

    settleAttach?.({ ok: true })
    expect(h.dispatcher.tryNotifyClient).toHaveBeenCalledWith(10, 'pty.replay', {
      id: 'pty-fenced',
      data: 'ordered'
    })
  })

  it('does not charge unrelated output to a response-order buffer', async () => {
    const h = harness()
    await h.openClient(11)

    await h.requests.get('pty.attach')?.(
      { id: 'pty-fenced' },
      h.context(11, () => {})
    )
    h.authorityEvent('pty.data', {
      id: 'pty-other',
      data: 'x'.repeat(1024 * 1024)
    })

    expect(h.dispatcher.publishTerminalAuthorityData).toHaveBeenCalledOnce()
    expect(h.onFailure).not.toHaveBeenCalled()
  })

  it('waits for every in-flight data settlement without blocking another PTY', async () => {
    const h = harness()
    await h.openClient(12)

    h.authorityEvent('pty.data', { id: 'pty-slow', data: 'first' })
    h.authorityEvent('pty.data', { id: 'pty-slow', data: 'second' })
    h.authorityEvent('pty.deliveryCanceled', { id: 'pty-slow' })
    h.authorityEvent('pty.data', { id: 'pty-fast', data: 'unrelated' })

    expect(h.dispatcher.publishTerminalAuthorityData).toHaveBeenCalledTimes(3)
    expect(h.dispatcher.tryNotifyClient).not.toHaveBeenCalled()
    h.dataSettlements[1]({ ok: true })
    expect(h.dispatcher.tryNotifyClient).not.toHaveBeenCalled()
    h.dataSettlements[0]({ ok: true })
    expect(h.dispatcher.tryNotifyClient).toHaveBeenCalledWith(12, 'pty.deliveryCanceled', {
      id: 'pty-slow'
    })
  })

  it('keeps later same-PTY data behind its terminal outcome', async () => {
    const h = harness()
    await h.openClient(13)

    h.authorityEvent('pty.data', { id: 'pty-1', data: 'before' })
    h.authorityEvent('pty.recoveryComplete', { id: 'pty-1' })
    h.authorityEvent('pty.data', { id: 'pty-1', data: 'after' })

    expect(h.dispatcher.publishTerminalAuthorityData).toHaveBeenCalledOnce()
    h.dataSettlements[0]({ ok: true })
    expect(h.dispatcher.tryNotifyClient).toHaveBeenCalledWith(13, 'pty.recoveryComplete', {
      id: 'pty-1'
    })
    expect(h.dispatcher.publishTerminalAuthorityData).toHaveBeenCalledTimes(2)
  })

  it('fails closed when a delivery-order fence exceeds its bounded capacity', async () => {
    const h = harness()
    await h.openClient(14)

    h.authorityEvent('pty.data', { id: 'pty-1', data: 'pending' })
    h.authorityEvent('pty.exit', { id: 'pty-1', code: 0 })
    h.authorityEvent('pty.data', { id: 'pty-1', data: 'x'.repeat(16 * 1024 * 1024) })

    expect(h.onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('bounded capacity') })
    )
  })

  it('closes the authority transport when the downstream client detaches', async () => {
    const h = harness()
    await h.openClient(9)

    h.detachClient(9)

    expect(h.mux.dispose).toHaveBeenCalledWith('connection_lost')
    expect(h.onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('client disconnected') })
    )
    await expect(h.openClient(10)).rejects.toThrow('gateway_unavailable')
  })

  it('fails closed when authority output has no admitted downstream client', () => {
    const h = harness()

    h.authorityEvent('pty.data', { id: 'pty-1', data: 'unowned' })

    expect(h.mux.dispose).toHaveBeenCalledWith('connection_lost')
    expect(h.onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('no admitted client') })
    )
  })

  it('fails the gateway instead of silently dropping an authority event', async () => {
    const h = harness()
    await h.openClient(5)
    h.dispatcher.publishTerminalAuthorityData.mockReturnValueOnce(false)

    h.authorityEvent('pty.data', { id: 'pty-1', data: 'lost' })

    expect(h.onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('data did not reach') })
    )
  })

  it('fails when the local authority connection is lost', () => {
    const h = harness()
    h.loseAuthority()
    expect(h.onFailure).toHaveBeenCalledOnce()
  })
})
