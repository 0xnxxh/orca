import { describe, expect, it, vi } from 'vitest'
import type {
  TerminalAuthorityOutcome,
  TerminalAuthoritySemanticOutcome
} from '../shared/terminal-session-authority-mutation'
import type { RelayDispatcher, RequestContext } from './dispatcher'
import type { SshPtyConsumerSessionAdapter } from './ssh-pty-consumer-session-adapter'
import { TerminalSessionAuthorityOutcomeDelivery } from './terminal-session-authority-outcome-delivery'

describe('TerminalSessionAuthorityOutcomeDelivery', () => {
  it('settles outcomes without a terminal exit without publishing a frame', async () => {
    const fixture = createFixture()

    await fixture.delivery.publish(outcome([]))

    expect(fixture.publishExit).not.toHaveBeenCalled()
  })

  it('keeps a legacy-only exit unacknowledged after ordered publication', async () => {
    const fixture = createFixture()
    fixture.delivery.installConsumer((_outcome, _effect, attempt) => {
      attempt.markOrderedComplete()
      return true
    })
    let settled = false

    void fixture.delivery.publish(exitOutcome()).then(() => {
      settled = true
    })
    await Promise.resolve()

    expect(settled).toBe(false)
    expect(fixture.publishExit).not.toHaveBeenCalled()
    fixture.delivery.dispose()
  })

  it('settles only an exact ACK from a client that received the negotiated outcome', async () => {
    const fixture = createFixture({ capableClients: [7] })
    let identity: unknown
    fixture.delivery.installConsumer((_outcome, _effect, attempt) => {
      identity = attempt.identity
      attempt.markPublished([7])
      attempt.markOrderedComplete()
      return true
    })
    let settled = false
    const published = fixture.delivery.publish(exitOutcome()).then(() => {
      settled = true
    })
    await Promise.resolve()

    fixture.ack({ authorityOutcome: identity }, 8)
    await Promise.resolve()
    expect(settled).toBe(false)

    fixture.ack({ authorityOutcome: identity }, 7)
    await published
    expect(settled).toBe(true)
  })

  it('replays directly to a negotiated owner when no physical consumer remains', async () => {
    const fixture = createFixture({ capableClients: [3] })
    const published = fixture.delivery.publish(exitOutcome())
    await Promise.resolve()
    const params = fixture.publishExit.mock.calls[0]?.[1]

    expect(params).toMatchObject({
      id: 'pty-1',
      code: 7,
      incarnationId: 'incarnation-1',
      authorityOutcome: { outcomeId: 'outcome-1', sequence: 1 }
    })
    fixture.ack({ authorityOutcome: params?.authorityOutcome }, 3)
    await published
  })

  it('keeps an unwired semantic outcome replayable', async () => {
    const fixture = createFixture()

    await expect(fixture.delivery.publish(semanticOutcome())).rejects.toThrow(
      'semantic outcome delivery is unavailable'
    )
  })
})

function semanticOutcome(): TerminalAuthoritySemanticOutcome {
  return {
    kind: 'semantic',
    sequence: 1,
    outcomeId: 'semantic-1',
    access: {
      namespace: { authorityHostId: 'host-1', namespaceId: 'namespace-1' },
      pane: { paneKey: 'pane-1', paneGenerationId: 'generation-1' },
      binding: binding()
    },
    producerIncarnationId: 'producer-1',
    producerSequence: 1,
    fact: { kind: 'bell' },
    appendedAtRevision: 1,
    byteLength: 1
  }
}

function createFixture(options: { capableClients?: readonly number[] } = {}) {
  const capableClients = new Set(options.capableClients ?? [])
  let ackHandler: ((params: Record<string, unknown>, context: RequestContext) => void) | undefined
  const publishExit = vi.fn(
    (
      _clientId: number,
      _params: Record<string, unknown>,
      onSettled: (result: { ok: true }) => void
    ) => {
      onSettled({ ok: true })
      return true
    }
  )
  const dispatcher = {
    onNotification: (
      _method: string,
      handler: (params: Record<string, unknown>, context: RequestContext) => void
    ) => {
      ackHandler = handler
    },
    onLegacyPtyCapacity: () => () => {},
    onDisposed: () => () => {},
    activeClientIds: () => [...capableClients],
    tryNotifyPtyExitToClient: publishExit
  } as unknown as RelayDispatcher
  const session = {
    onTerminalAuthorityOutcomeDeliveryClient: () => () => {},
    terminalAuthorityOutcomeDelivery: (clientId: number) =>
      capableClients.has(clientId)
        ? { clientGeneration: clientId * 10, ownerGeneration: clientId * 100 }
        : null
  } as unknown as SshPtyConsumerSessionAdapter
  const delivery = new TerminalSessionAuthorityOutcomeDelivery(dispatcher, session)
  return {
    delivery,
    publishExit,
    ack: (params: Record<string, unknown>, clientId: number) =>
      ackHandler?.(params, { clientId } as RequestContext)
  }
}

function exitOutcome(): TerminalAuthorityOutcome {
  return outcome([
    {
      kind: 'binding-retired',
      reason: 'exit',
      binding: binding()
    },
    {
      kind: 'terminal-exited',
      binding: binding(),
      code: 7,
      signal: null
    }
  ])
}

function outcome(effects: TerminalAuthorityOutcome['result']['effects']): TerminalAuthorityOutcome {
  const request = {
    actorId: 'actor-1',
    operationId: 'operation-1',
    baseRevision: 1,
    outcomeId: 'outcome-1',
    change: {
      kind: 'exit' as const,
      pane: { paneKey: 'pane-1', paneGenerationId: 'generation-1' },
      expected: { paneGenerationId: 'generation-1', binding: binding() },
      exit: { code: 7, signal: null }
    }
  }
  return {
    sequence: 1,
    outcomeId: request.outcomeId,
    request,
    result: {
      namespace: { authorityHostId: 'host-1', namespaceId: 'namespace-1' },
      actorId: request.actorId,
      operationId: request.operationId,
      kind: 'exit',
      revision: 2,
      pane: {
        paneKey: 'pane-1',
        paneGenerationId: 'generation-1',
        status: 'exited',
        binding: null,
        lastBinding: binding(),
        revision: 2
      },
      replacementPane: null,
      allocation: null,
      effects
    },
    byteLength: 1
  }
}

function binding() {
  return {
    ownerIncarnationId: 'owner-1',
    physicalPtyId: 'pty-1',
    ptyIncarnationId: 'incarnation-1'
  }
}
