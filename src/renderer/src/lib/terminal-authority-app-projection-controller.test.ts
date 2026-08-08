import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  TERMINAL_AUTHORITY_APP_PROJECTION_VERSION,
  type TerminalAuthorityAppEventKey,
  type TerminalAuthorityAppFactProjection,
  type TerminalAuthorityAppPaneProjection,
  type TerminalAuthorityAppProjectionDelta
} from '../../../shared/terminal-authority-app-projection'

const { applyFact, applyExit } = vi.hoisted(() => ({
  applyFact: vi.fn(() => Promise.resolve(true)),
  applyExit: vi.fn(() => Promise.resolve(true))
}))

vi.mock('./terminal-authority-app-projection-policy', () => ({
  applyTerminalAuthorityAppProjectionFact: applyFact,
  applyTerminalAuthorityAppProjectionExit: applyExit
}))

import { TerminalAuthorityAppProjectionController } from './terminal-authority-app-projection-controller'

beforeEach(() => {
  applyFact.mockReset().mockResolvedValue(true)
  applyExit.mockReset().mockResolvedValue(true)
})

describe('TerminalAuthorityAppProjectionController', () => {
  it('installs the listener before snapshot and coalesces a racing newer delta', async () => {
    const snapshotReady = deferred<unknown>()
    const harness = transportHarness(() => snapshotReady.promise)
    const controller = controllerFor(harness)
    const started = controller.start()
    const newer = row(2, 'title')

    harness.emit(delta([newer]))
    snapshotReady.resolve(snapshot([row(1, 'title')]))
    await started
    await vi.waitFor(() => expect(applyFact).toHaveBeenCalled())

    expect(harness.listenOrder).toEqual(['listen', 'subscribe'])
    expect(controller.snapshotRows()[0]?.latestEvent?.sequence).toBe(2)
    expect(applyFact).toHaveBeenLastCalledWith(newer, newer.facts.title)
    controller.dispose()
  })

  it('reapplies the same event identity safely after renderer restart without ACK authority', async () => {
    const current = row(7, 'title')
    const firstHarness = transportHarness(() => Promise.resolve(snapshot([current])))
    const first = controllerFor(firstHarness, 'renderer-1')
    await first.start()
    await vi.waitFor(() => expect(applyFact).toHaveBeenCalledTimes(1))
    first.dispose()

    const secondHarness = transportHarness(() => Promise.resolve(snapshot([current], 'renderer-2')))
    const second = controllerFor(secondHarness, 'renderer-2')
    await second.start()
    await vi.waitFor(() => expect(applyFact).toHaveBeenCalledTimes(2))

    const calls = applyFact.mock.calls as unknown as readonly [
      TerminalAuthorityAppPaneProjection,
      TerminalAuthorityAppFactProjection
    ][]
    expect(calls.map((call) => call[1].event)).toEqual([
      current.facts.title!.event,
      current.facts.title!.event
    ])
    second.dispose()
  })

  it('retains a failed unmounted policy row and retries when policy becomes available', async () => {
    applyFact.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const errors: string[] = []
    const harness = transportHarness(() => Promise.resolve(snapshot([row(1, 'title')])))
    const controller = controllerFor(harness, 'renderer-1', (error) => errors.push(error.message))
    await controller.start()
    await vi.waitFor(() =>
      expect(errors).toContain('terminal_authority_projection_policy_unavailable')
    )

    controller.retryFailedRows()
    await vi.waitFor(() => expect(applyFact).toHaveBeenCalledTimes(2))
    controller.dispose()
  })

  it('clears bell presentation only after its event-keyed handler settles', async () => {
    const settled = deferred<boolean>()
    applyFact.mockReturnValueOnce(settled.promise)
    const bell = row(3, 'bell')
    const harness = transportHarness(() => Promise.resolve(snapshot([bell])))
    const controller = controllerFor(harness)
    await controller.start()
    await vi.waitFor(() => expect(applyFact).toHaveBeenCalledOnce())
    expect(harness.clearBell).not.toHaveBeenCalled()

    settled.resolve(true)
    await vi.waitFor(() => expect(harness.clearBell).toHaveBeenCalledOnce())
    expect(harness.clearBell).toHaveBeenCalledWith(
      expect.objectContaining({ expectedEvent: bell.facts.bell!.event })
    )
    controller.dispose()
  })

  it('isolates namespaces and applies authoritative deletion deltas', async () => {
    const first = row(1, 'title', 'namespace-a')
    const second = row(1, 'title', 'namespace-b')
    const harness = transportHarness(() => Promise.resolve(snapshot([first, second])))
    const controller = controllerFor(harness)
    await controller.start()
    await vi.waitFor(() => expect(applyFact).toHaveBeenCalledTimes(2))

    harness.emit(
      delta([], [{ consumerId: first.consumerId, namespace: first.namespace, pane: first.pane }])
    )

    expect(controller.snapshotRows()).toEqual([second])
    controller.dispose()
  })

  it('fences a handler callback that settles after teardown', async () => {
    const settled = deferred<boolean>()
    applyFact.mockReturnValueOnce(settled.promise)
    const harness = transportHarness(() => Promise.resolve(snapshot([row(1, 'bell')])))
    const controller = controllerFor(harness)
    await controller.start()
    await vi.waitFor(() => expect(applyFact).toHaveBeenCalledOnce())

    controller.dispose()
    settled.resolve(true)
    await Promise.resolve()
    await Promise.resolve()

    expect(harness.clearBell).not.toHaveBeenCalled()
  })
})

function controllerFor(
  harness: ReturnType<typeof transportHarness>,
  subscriptionIncarnationId = 'renderer-1',
  onError: (error: Error) => void = vi.fn()
) {
  return new TerminalAuthorityAppProjectionController({
    transport: harness.transport,
    subscriptionIncarnationId,
    onError
  })
}

function transportHarness(subscribeResult: () => Promise<unknown>) {
  let listener: ((value: unknown) => void) | null = null
  const listenOrder: string[] = []
  const clearBell = vi.fn(() => Promise.resolve(true))
  return {
    listenOrder,
    clearBell,
    transport: {
      onDelta(next: (value: unknown) => void) {
        listenOrder.push('listen')
        listener = next
        return () => {
          listener = null
        }
      },
      subscribe() {
        listenOrder.push('subscribe')
        return subscribeResult()
      },
      clearBell
    },
    emit(value: unknown) {
      listener?.(value)
    }
  }
}

function snapshot(rows: readonly TerminalAuthorityAppPaneProjection[], incarnation = 'renderer-1') {
  return {
    version: TERMINAL_AUTHORITY_APP_PROJECTION_VERSION,
    subscriptionIncarnationId: incarnation,
    rows
  }
}

function delta(
  rows: readonly TerminalAuthorityAppPaneProjection[],
  deleted: TerminalAuthorityAppProjectionDelta['deleted'] = []
): TerminalAuthorityAppProjectionDelta {
  return {
    version: TERMINAL_AUTHORITY_APP_PROJECTION_VERSION,
    subscriptionIncarnationId: 'renderer-1',
    rows,
    ...(deleted.length ? { deleted } : {})
  }
}

function row(
  sequence: number,
  kind: 'title' | 'bell',
  namespaceId = 'namespace-1'
): TerminalAuthorityAppPaneProjection {
  const namespace = { authorityHostId: 'host-1', namespaceId }
  const event: TerminalAuthorityAppEventKey = {
    consumerId: 'app-profile:test',
    namespace,
    sequence,
    outcomeId: `${kind}-${namespaceId}-${sequence}`
  }
  const binding = {
    ownerIncarnationId: 'owner-1',
    physicalPtyId: `pty-${namespaceId}`,
    ptyIncarnationId: `pty-incarnation-${namespaceId}`
  }
  const fact =
    kind === 'bell'
      ? { kind: 'bell' as const }
      : {
          kind: 'title' as const,
          normalizedTitle: `title-${sequence}`,
          rawTitle: `title-${sequence}`
        }
  return {
    version: TERMINAL_AUTHORITY_APP_PROJECTION_VERSION,
    consumerId: event.consumerId,
    namespace,
    pane: {
      paneKey: 'tab-1:11111111-1111-4111-8111-111111111111',
      paneGenerationId: `pane-generation-${namespaceId}`
    },
    layout: { tabId: 'tab-1', leafId: '11111111-1111-4111-8111-111111111111' },
    binding,
    latestEvent: event,
    topology: {
      status: 'open',
      binding,
      lastBinding: binding,
      authorityRevision: 1,
      ownerStatus: 'reachable'
    },
    attention: {
      event: kind === 'bell' ? event : null,
      pendingBellCount: kind === 'bell' ? 1 : 0,
      updatedAt: sequence
    },
    status: {
      event,
      pane: 'open',
      agent: null,
      attention: kind === 'bell',
      updatedAt: sequence
    },
    facts: {
      [kind]: { event, binding, fact, appliedAt: sequence }
    }
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}
