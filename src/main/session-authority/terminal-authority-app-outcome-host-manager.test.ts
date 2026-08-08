import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  authorityProjection,
  boundary,
  semanticPublication
} from './__tests__/terminal-authority-app-projection-fixture'
import type { TerminalAuthorityNamespace } from '../../shared/terminal-session-authority-identity'
import type {
  TerminalAuthorityNamespaceOutcomeBoundary,
  TerminalAuthorityNamespaceOutcomePublication,
  TerminalAuthorityPolicyConsumerIdentity
} from '../../shared/terminal-session-authority-consumer-transport'
import type { TerminalAuthorityPolicyOutcomeTransport } from './terminal-session-authority-policy-consumers'
import { TerminalAuthorityAppOutcomeHostManager } from './terminal-authority-app-outcome-host-manager'
import {
  TerminalAuthorityAppAdmissionIntentRequiredError,
  type TerminalAuthorityAppConsumerRetirementRequest,
  type TerminalAuthorityAppNamespaceAdmissionRequest,
  type TerminalAuthorityAppOutcomeHostTransport
} from './terminal-authority-app-outcome-host-contract'
import { TerminalAuthorityAppProjectionStore } from './terminal-authority-app-projection-store'
import { terminalSessionAuthorityBoundaryId } from '../../shared/terminal-session-authority-boundary-identity'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe('TerminalAuthorityAppOutcomeHostManager', () => {
  it('connects hosts lazily and fences a physical failure to its authenticated host', async () => {
    const store = await memoryStore()
    const first = hostHarness('host-1')
    const second = hostHarness('host-2')
    const manager = new TerminalAuthorityAppOutcomeHostManager('app-process:test-process', {
      store,
      onProjection: () => {},
      reconnectBaseDelayMs: 1,
      reconnectMaxDelayMs: 1
    })
    const firstRegistration = manager.installHost(first.transport)
    const secondRegistration = manager.installHost(second.transport)
    expect(first.connectHost).not.toHaveBeenCalled()
    expect(second.connectHost).not.toHaveBeenCalled()

    await Promise.all([
      firstRegistration.admitNamespace(namespace('host-1', 'one')),
      secondRegistration.admitNamespace(namespace('host-2', 'one'))
    ])
    const firstRequest = first.openNamespace.mock.calls.at(-1)?.[0]
    const secondRequest = second.openNamespace.mock.calls.at(-1)?.[0]
    expect(firstRequest?.candidateProcessIncarnationId).toBe('app-process:test-process')
    expect(secondRequest?.candidateProcessIncarnationId).toBe('app-process:test-process')
    expect(firstRequest?.candidateSessionNonce).not.toBe(secondRequest?.candidateSessionNonce)
    expect(firstRequest).not.toHaveProperty('consumer')
    expect(firstRequest).not.toHaveProperty('appPublicKeyB64')
    first.failHost(new Error('host one disconnected'))
    await vi.waitFor(() => expect(first.connectHost).toHaveBeenCalledTimes(2))

    expect(second.connectHost).toHaveBeenCalledTimes(1)
    await second.publish(publication('host-2', 'one', 1))
    expect(second.acknowledge).toHaveBeenCalledWith(expect.objectContaining({ sequence: 1 }))
    manager.dispose()
    store.close()
  })

  it('retries one namespace without rolling back sibling namespace grants', async () => {
    const store = await memoryStore()
    const host = hostHarness('host-1')
    const manager = new TerminalAuthorityAppOutcomeHostManager('app-process:test-process', {
      store,
      onProjection: () => {},
      reconnectBaseDelayMs: 1,
      reconnectMaxDelayMs: 1
    })
    const registration = manager.installHost(host.transport)
    const first = namespace('host-1', 'one')
    const second = namespace('host-1', 'two')
    await Promise.all([registration.admitNamespace(first), registration.admitNamespace(second)])

    host.failNamespace(first, new Error('namespace one failed'))
    await vi.waitFor(() => expect(host.openCount(first)).toBe(2))
    expect(host.openCount(second)).toBe(1)
    expect(host.connectHost).toHaveBeenCalledTimes(1)

    await host.publish(publication('host-1', 'two', 1))
    expect(host.acknowledge).toHaveBeenCalledWith(
      expect.objectContaining({ namespace: second, sequence: 1 })
    )
    manager.dispose()
    store.close()
  })

  it('waits for the replacement host generation before re-admitting an existing namespace', async () => {
    const store = await memoryStore()
    const host = hostHarness('host-1', { blockHostReconnect: true })
    const manager = new TerminalAuthorityAppOutcomeHostManager('app-process:test-process', {
      store,
      onProjection: () => {},
      reconnectBaseDelayMs: 1,
      reconnectMaxDelayMs: 1
    })
    const registration = manager.installHost(host.transport)
    const target = namespace('host-1', 'one')
    await registration.admitNamespace(target)

    host.failHost(new Error('host transport replaced'))
    await vi.waitFor(() => expect(host.connectHost).toHaveBeenCalledTimes(2))

    let admitted = false
    const waiting = registration.admitNamespace(target).then(() => {
      admitted = true
    })
    await Promise.resolve()
    expect(admitted).toBe(false)

    host.releaseHostReconnect()
    await waiting
    expect(host.openCount(target)).toBe(2)
    manager.dispose()
    store.close()
  })

  it('rejects caller namespace aliases and duplicate authenticated host installs', async () => {
    const store = await memoryStore()
    const host = hostHarness('host-1')
    const manager = new TerminalAuthorityAppOutcomeHostManager('app-process:test-process', {
      store,
      onProjection: () => {}
    })
    const registration = manager.installHost(host.transport)

    expect(() => manager.installHost(host.transport)).toThrow('already installed')
    await expect(registration.admitNamespace(namespace('host-2', 'one'))).rejects.toThrow(
      'another host'
    )
    expect(host.connectHost).not.toHaveBeenCalled()
    manager.dispose()
    store.close()
  })

  it('resolves a final-host namespace before admitting its independent consumer session', async () => {
    const store = await memoryStore()
    const host = hostHarness('host-1')
    const manager = new TerminalAuthorityAppOutcomeHostManager('app-process:test-process', {
      store,
      onProjection: () => {}
    })
    const registration = manager.installHost(host.transport)

    await expect(registration.resolveAndAdmitNamespace('repo::/workspace')).resolves.toEqual(
      namespace('host-1', 'resolved')
    )
    expect(host.resolveNamespace).toHaveBeenCalledWith('repo::/workspace')
    expect(host.openNamespace).toHaveBeenCalledWith(
      expect.objectContaining({ namespace: namespace('host-1', 'resolved') }),
      expect.any(Object),
      expect.any(Function)
    )
    manager.dispose()
    store.close()
  })

  it('keeps a lost-response retirement pending without re-admitting that namespace', async () => {
    const store = await memoryStore()
    const host = hostHarness('host-1')
    const manager = new TerminalAuthorityAppOutcomeHostManager('app-process:test-process', {
      store,
      onProjection: () => {},
      reconnectBaseDelayMs: 1,
      reconnectMaxDelayMs: 1
    })
    const registration = manager.installHost(host.transport)
    const retiring = namespace('host-1', 'retiring')
    const sibling = namespace('host-1', 'sibling')
    await Promise.all([registration.admitNamespace(retiring), registration.admitNamespace(sibling)])
    const request = retirementRequest(retiring)
    host.retireNamespace.mockImplementationOnce(async () => {
      host.failHost(new Error('retirement response lost after append'))
      throw new Error('retirement response lost after append')
    })

    await expect(registration.retireNamespace(request)).rejects.toThrow('response lost')
    await vi.waitFor(() => expect(host.openCount(sibling)).toBe(2))
    expect(host.openCount(retiring)).toBe(1)
    await expect(registration.admitNamespace(retiring)).rejects.toThrow('retirement is pending')
    await expect(
      registration.retireNamespace({ ...request, requestId: 'retirement-request:changed' })
    ).rejects.toThrow('request changed')

    await expect(registration.retireNamespace(request)).resolves.toMatchObject({
      namespace: retiring,
      retired: true
    })
    expect(host.retireNamespace).toHaveBeenCalledTimes(2)
    expect(host.openCount(retiring)).toBe(1)
    manager.dispose()
    store.close()
  })
})

function hostHarness(hostId: string, options: Readonly<{ blockHostReconnect?: boolean }> = {}) {
  const sinks = new Map<string, TerminalAuthorityPolicyOutcomeTransport>()
  const principals = new Map<string, TerminalAuthorityPolicyConsumerIdentity>()
  const claimed = new Set<string>()
  const opens = new Map<string, number>()
  const reconnectGate = deferred<void>()
  let hostFailure: ((error: unknown) => void) | null = null
  const acceptBoundary = vi.fn(async (acceptance) => {
    claimed.add(namespaceKey(acceptance.namespace))
  })
  const acknowledge = vi.fn(async (ack) => ack.sequence)
  const resolveNamespace = vi.fn(async () => namespace(hostId, 'resolved'))
  const retireNamespace = vi.fn(async (request: TerminalAuthorityAppConsumerRetirementRequest) =>
    retirementResult(request)
  )
  const openNamespace = vi.fn(
    async (
      request: TerminalAuthorityAppNamespaceAdmissionRequest,
      sink: TerminalAuthorityPolicyOutcomeTransport
    ) => {
      const requiredIntent = claimed.has(namespaceKey(request.namespace)) ? 'resume' : 'first'
      if (request.intent !== requiredIntent) {
        throw new TerminalAuthorityAppAdmissionIntentRequiredError(requiredIntent)
      }
      const target = request.namespace
      const principal = Object.freeze({
        consumerId: `app-profile:v1:derived-${hostId}`,
        consumerIncarnationId: request.candidateProcessIncarnationId
      })
      const key = namespaceKey(target)
      opens.set(key, (opens.get(key) ?? 0) + 1)
      sinks.set(key, sink)
      principals.set(key, principal)
      return {
        expectedConsumer: principal,
        grant: Object.freeze({
          version: 1 as const,
          consumer: principal,
          namespace: target,
          requestId: request.requestId,
          connectionGrantId: `connection-grant:${request.requestId}`,
          admissionCas: 'admission-cas-after',
          replayed: false
        }),
        activate: async () =>
          sink.publishBoundary(hostBoundary(target, principal, claimed.has(key))),
        acceptBoundary,
        acknowledge,
        retire: vi.fn(),
        disconnect: () => {
          if (sinks.get(key) === sink) {
            sinks.delete(key)
          }
        }
      }
    }
  )
  const connectHost = vi.fn(async (lifecycle: Readonly<{ onFailure(error: unknown): void }>) => {
    if (options.blockHostReconnect && connectHost.mock.calls.length > 1) {
      await reconnectGate.promise
    }
    hostFailure = lifecycle.onFailure
    return {
      authenticatedAuthorityHostId: hostId,
      resolveNamespace,
      openNamespace,
      retireNamespace,
      disconnect: () => {}
    }
  })
  const transport: TerminalAuthorityAppOutcomeHostTransport = {
    authenticatedAuthorityHostId: hostId,
    connect: connectHost
  }
  return {
    transport,
    connectHost,
    openNamespace,
    resolveNamespace,
    retireNamespace,
    acknowledge,
    openCount: (target: TerminalAuthorityNamespace) => opens.get(namespaceKey(target)) ?? 0,
    publish(value: TerminalAuthorityNamespaceOutcomePublication) {
      const sink = sinks.get(namespaceKey(value.namespace))
      if (!sink) {
        throw new Error('namespace sink unavailable')
      }
      return sink.publishOutcome({
        ...value,
        consumer: principals.get(namespaceKey(value.namespace))!
      })
    },
    failNamespace(target: TerminalAuthorityNamespace, error: Error) {
      const sink = sinks.get(namespaceKey(target))
      if (!sink) {
        throw new Error('namespace sink unavailable')
      }
      sink.onFailure?.(error)
    },
    failHost(error: Error) {
      if (!hostFailure) {
        throw new Error('host sink unavailable')
      }
      hostFailure(error)
    },
    releaseHostReconnect() {
      reconnectGate.resolve()
    }
  }
}

function retirementRequest(namespace: TerminalAuthorityNamespace) {
  return Object.freeze({
    namespace,
    candidateProcessIncarnationId: 'app-process:test-process',
    candidateSessionNonce: `retirement-session:${namespace.namespaceId}`,
    requestId: `retirement-request:${namespace.namespaceId}`
  })
}

function retirementResult(request: TerminalAuthorityAppConsumerRetirementRequest) {
  return Object.freeze({
    version: 1 as const,
    namespace: request.namespace,
    consumerId: `app-profile:v1:derived-${request.namespace.authorityHostId}`,
    retiredConsumerIncarnationId: request.candidateProcessIncarnationId,
    requestId: request.requestId,
    candidateProcessIncarnationId: request.candidateProcessIncarnationId,
    candidateSessionNonce: request.candidateSessionNonce,
    connectionGrantId: 'connection-grant:retirement',
    retirementCas: 'retirement-cas:result',
    retired: true as const,
    alreadyAbsent: false,
    replayed: false
  })
}

function hostBoundary(
  target: TerminalAuthorityNamespace,
  consumer: TerminalAuthorityPolicyConsumerIdentity,
  resumed: boolean
): TerminalAuthorityNamespaceOutcomeBoundary {
  const candidate = boundary(0, { namespaceId: target.namespaceId })
  const projection = Object.freeze({
    ...authorityProjection({ namespaceId: target.namespaceId }),
    namespace: target
  })
  const unsigned = {
    ...candidate,
    boundaryId: undefined,
    consumer,
    namespace: target,
    projection,
    consumerStart: resumed ? ('resume' as const) : ('new-at-tail' as const)
  }
  const { boundaryId: _boundaryId, ...value } = unsigned
  return Object.freeze({ ...value, boundaryId: terminalSessionAuthorityBoundaryId(value) })
}

function publication(
  hostId: string,
  namespaceId: string,
  sequence: number
): TerminalAuthorityNamespaceOutcomePublication {
  const candidate = semanticPublication(sequence, { kind: 'bell' }, { namespaceId })
  if (candidate.outcome.kind !== 'semantic') {
    throw new Error('semantic fixture returned a mutation outcome')
  }
  const target = namespace(hostId, namespaceId)
  const outcome = Object.freeze({
    ...candidate.outcome,
    access: Object.freeze({ ...candidate.outcome.access, namespace: target })
  })
  return Object.freeze({ ...candidate, namespace: target, outcome })
}

function namespace(authorityHostId: string, namespaceId: string): TerminalAuthorityNamespace {
  return Object.freeze({ authorityHostId, namespaceId })
}

function namespaceKey(value: TerminalAuthorityNamespace): string {
  return JSON.stringify([value.authorityHostId, value.namespaceId])
}

async function memoryStore(): Promise<TerminalAuthorityAppProjectionStore> {
  const directory = await mkdtemp(path.join(tmpdir(), 'orca-app-host-manager-'))
  directories.push(directory)
  return TerminalAuthorityAppProjectionStore.open({ directory, databasePath: ':memory:' })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}
