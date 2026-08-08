import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  TerminalAuthorityNamespaceOutcomeAck,
  TerminalAuthorityNamespaceOutcomeBoundary,
  TerminalAuthorityNamespaceOutcomePublication,
  TerminalAuthorityPolicyConsumerIdentity
} from '../../shared/terminal-session-authority-consumer-transport'
import { terminalAuthorityOperationIdentity } from '../../shared/terminal-session-authority-operation-identity'
import {
  TerminalSessionAuthorityPolicyConsumers,
  type TerminalAuthorityPolicyConsumerConnection
} from './terminal-session-authority-policy-consumers'
import { TerminalSessionAuthorityRegistry } from './terminal-session-authority-registry'
import type { TerminalSessionAuthorityService } from './terminal-session-authority-service'
import {
  terminalAuthorityFloatingLocator,
  terminalAuthorityWorkspaceLocator
} from './terminal-session-authority-workspace-locator'

const directories: string[] = []
const registries: TerminalSessionAuthorityRegistry[] = []
const managers: TerminalSessionAuthorityPolicyConsumers[] = []

afterEach(async () => {
  for (const manager of managers.splice(0)) {
    manager.dispose()
  }
  await Promise.allSettled(registries.splice(0).map((registry) => registry.close()))
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('TerminalSessionAuthorityPolicyConsumers', () => {
  it('releases a disconnected snapshot hold and replays the retained cursor on reconnect', async () => {
    const { manager, service } = await oneNamespace()
    const boundaryStarted = deferred<void>()
    const releaseBoundary = deferred<void>()
    let firstStart: TerminalAuthorityNamespaceOutcomeBoundary['consumerStart']
    const first = await manager.connect(claim(identity('profile-a', 'process-a')), {
      publishBoundary: async (boundary) => {
        firstStart = boundary.consumerStart
        boundaryStarted.resolve()
        await releaseBoundary.promise
      },
      publishOutcome: async () => {}
    })
    await first.activate()
    const firstInstallation = installNamespace(first, service)
    await boundaryStarted.promise
    expect(firstStart).toBe('new-at-tail')

    const firstMutation = createPane(service, 'pane-a', 'create-a')
    await expectPending(firstMutation)
    first.disconnect()
    await expect(firstMutation).resolves.toBe(1)
    releaseBoundary.resolve()
    await expect(firstInstallation).rejects.toThrow('stale')

    const replayed: TerminalAuthorityNamespaceOutcomePublication[] = []
    const resumed: TerminalAuthorityNamespaceOutcomeBoundary[] = []
    const second = await manager.connect(claim(identity('profile-a', 'process-b')), {
      publishBoundary: async (boundary) => {
        resumed.push(boundary)
      },
      publishOutcome: async (publication) => {
        replayed.push(publication)
      }
    })
    await second.activate()
    await installNamespace(second, service)
    expect(resumed[0]).toMatchObject({
      consumerStart: 'new-at-tail',
      acknowledgedSequence: 1,
      outcomeHighWatermark: 1
    })
    expect(replayed).toHaveLength(0)
    await createPane(service, 'pane-b', 'create-b')
    await waitForLength(replayed, 1)
    second.disconnect()

    const finalReplay: number[] = []
    const finalAcked = deferred<void>()
    let finalConnection!: Awaited<ReturnType<typeof manager.connect>>
    finalConnection = await manager.connect(
      claim(identity('profile-a', 'process-c'), 'app-process:process-b'),
      {
        publishBoundary: async () => {},
        publishOutcome: async (publication) => {
          finalReplay.push(
            ...(publication.outcomes ?? [publication.outcome]).map((outcome) => outcome.sequence)
          )
          await finalConnection.acknowledge(ackFor(publication))
          finalAcked.resolve()
        }
      }
    )
    await finalConnection.activate()
    await installNamespace(finalConnection, service)
    await vi.waitFor(() => expect(finalReplay).toEqual([2]), { timeout: 5_000 })
    await finalAcked.promise
    await expect(second.acknowledge(ackFor(replayed[0]!))).rejects.toThrow('stale')
    await expect(cursor(service, finalConnection.identity)).resolves.toMatchObject({
      acknowledgedSequence: 2,
      outcomeHighWatermark: 2
    })
  })

  it('fences a same-incarnation transport replacement without deleting the replacement', async () => {
    const { manager, service } = await oneNamespace()
    const consumer = identity('profile-a', 'process-a')
    const first = await manager.connect(claim(consumer), quietTransport())
    await first.activate()
    await installNamespace(first, service)
    const outcomes: TerminalAuthorityNamespaceOutcomePublication[] = []
    const replacement = await manager.connect(claim(consumer), {
      publishBoundary: async () => {},
      publishOutcome: async (publication) => {
        outcomes.push(publication)
      }
    })
    await replacement.activate()
    await installNamespace(replacement, service)

    expect(first.isInstalled(service.namespace)).toBe(false)
    expect(() => first.assertInstalled(service.namespace)).toThrow('not installed')
    first.disconnect()
    await createPane(service, 'pane-a', 'replacement-survives')
    await waitForLength(outcomes, 1)
    expect(replacement.isInstalled(service.namespace)).toBe(true)
  })

  it('keeps the incumbent claimed when a prepared handover never receives its grant', async () => {
    const { manager, service } = await oneNamespace()
    const incumbentIdentity = identity('profile-a', 'process-a')
    const incumbent = await manager.connect(claim(incumbentIdentity), quietTransport())
    await incumbent.activate()
    await installNamespace(incumbent, service)
    const stale = await manager.connect(
      claim(identity('profile-a', 'stale-process'), 'app-process:wrong-predecessor'),
      quietTransport()
    )
    await stale.activate()
    await expect(installNamespace(stale, service)).rejects.toMatchObject({
      code: 'consumer-conflict'
    })
    stale.disconnect()
    const replacement = await manager.connect(
      claim(identity('profile-a', 'process-b'), incumbentIdentity.consumerIncarnationId),
      quietTransport()
    )
    await replacement.activate()
    const preparation = await replacement.prepareNamespace?.(service)
    expect(preparation).toBeDefined()
    expect(
      service.activeConsumerIncarnation(service.writerAccess, incumbentIdentity.consumerId)
    ).toBe(incumbentIdentity.consumerIncarnationId)
    await preparation!.rollback()
    replacement.disconnect()
    expect(
      service.activeConsumerIncarnation(service.writerAccess, incumbentIdentity.consumerId)
    ).toBe(incumbentIdentity.consumerIncarnationId)
    expect(incumbent.isInstalled(service.namespace)).toBe(true)
    await expect(createPane(service, 'pane-a', 'incumbent-remains')).resolves.toBe(1)
  })

  it('keeps a handover claim durable when the transport drops mid-commit', async () => {
    const { manager, service } = await oneNamespace()
    const incumbentIdentity = identity('profile-a', 'process-a')
    const incumbent = await manager.connect(claim(incumbentIdentity), quietTransport())
    await incumbent.activate()
    await installNamespace(incumbent, service)

    const candidateIdentity = identity('profile-a', 'process-b')
    const candidate = await manager.connect(
      claim(candidateIdentity, incumbentIdentity.consumerIncarnationId),
      quietTransport()
    )
    await candidate.activate()
    const preparation = await candidate.prepareNamespace?.(service)
    expect(preparation).toBeDefined()

    const commitConsumerAdmission = service.commitConsumerAdmission.bind(service)
    const claimReturned = deferred<void>()
    const releaseClaim = deferred<void>()
    const interleaving: string[] = []
    vi.spyOn(service, 'commitConsumerAdmission').mockImplementation(async (writer, input, seal) => {
      const consumer = await commitConsumerAdmission(writer, input, seal)
      if (input.consumerIncarnationId === candidateIdentity.consumerIncarnationId) {
        interleaving.push('claim-returned')
        claimReturned.resolve()
        await releaseClaim.promise
        interleaving.push('claim-released')
      }
      return consumer
    })

    const committing = preparation!.commit()
    await claimReturned.promise
    candidate.disconnect()
    interleaving.push('transport-disconnected')
    const rollingBack = preparation!.rollback()
    releaseClaim.resolve()

    await expect(committing).rejects.toThrow('stale')
    await rollingBack
    expect(interleaving).toEqual(['claim-returned', 'transport-disconnected', 'claim-released'])
    // The claim settled with its grant inside one serialized operation, so the disconnect tears the
    // live state down and leaves the durable record standing rather than rewinding it.
    expect(
      service.activeConsumerIncarnation(service.writerAccess, candidateIdentity.consumerId)
    ).toBe(candidateIdentity.consumerIncarnationId)
    expect(candidate.isInstalled(service.namespace)).toBe(false)
    expect(incumbent.isInstalled(service.namespace)).toBe(false)

    // Recovery is a fresh admission against the claimed incarnation, not a compensating write.
    const resumed = await manager.connect(
      claim(candidateIdentity, candidateIdentity.consumerIncarnationId),
      quietTransport()
    )
    await resumed.activate()
    await installNamespace(resumed, service)
    expect(resumed.isInstalled(service.namespace)).toBe(true)
  })

  it('installs a new floating namespace without disturbing an existing folder namespace', async () => {
    const { directory, registry, manager, service: folder } = await oneNamespace()
    const boundaries: TerminalAuthorityNamespaceOutcomeBoundary[] = []
    const outcomes: TerminalAuthorityNamespaceOutcomePublication[] = []
    const connection = await manager.connect(claim(identity('profile-a', 'process-a')), {
      publishBoundary: async (boundary) => {
        boundaries.push(boundary)
      },
      publishOutcome: async (publication) => {
        outcomes.push(publication)
      }
    })
    await connection.activate()
    await installNamespace(connection, folder)
    await waitForLength(boundaries, 1)

    const floatingNamespace = (await registry.resolveNamespace(terminalAuthorityFloatingLocator()))
      .namespace
    const floating = await registry.openNamespace(floatingNamespace)
    await installNamespace(connection, floating)
    await waitForLength(boundaries, 2)
    expect(connection.isInstalled(folder.namespace)).toBe(true)
    expect(connection.isInstalled(floating.namespace)).toBe(true)
    expect(directory).toContain(path.sep)

    await Promise.all([
      createPane(folder, 'folder-pane', 'folder-mutation'),
      createPane(floating, 'floating-pane', 'floating-mutation')
    ])
    await waitForLength(outcomes, 2)
    expect(new Set(outcomes.map((item) => item.namespace.namespaceId)).size).toBe(2)
  })

  it('keeps namespace handover independent and accepts an exact namespace retry', async () => {
    const harness = await twoNamespaces()
    const incumbentIdentity = identity('profile-a', 'process-a')
    const incumbent = await harness.manager.connect(claim(incumbentIdentity), quietTransport())
    await incumbent.activate()
    await Promise.all([
      installNamespace(incumbent, harness.first),
      installNamespace(incumbent, harness.second)
    ])

    const candidate = identity('profile-a', 'process-b')
    const secondClaim = vi
      .spyOn(harness.second, 'commitConsumerAdmission')
      .mockImplementationOnce(async () => {
        expect(
          harness.first.activeConsumerIncarnation(harness.first.writerAccess, candidate.consumerId)
        ).toBe(candidate.consumerIncarnationId)
        throw new Error('second namespace claim failed')
      })
    const partial = await harness.manager.connect(
      claim(candidate, incumbentIdentity.consumerIncarnationId),
      quietTransport()
    )
    await partial.activate()
    await installNamespace(partial, harness.first)
    await expect(installNamespace(partial, harness.second)).rejects.toThrow(
      'second namespace claim failed'
    )
    secondClaim.mockRestore()

    expect(
      harness.first.activeConsumerIncarnation(harness.first.writerAccess, candidate.consumerId)
    ).toBe(candidate.consumerIncarnationId)
    expect(
      harness.second.activeConsumerIncarnation(harness.second.writerAccess, candidate.consumerId)
    ).toBe(incumbentIdentity.consumerIncarnationId)
    expect(partial.isInstalled(harness.first.namespace)).toBe(true)
    expect(partial.isInstalled(harness.second.namespace)).toBe(false)
    expect(incumbent.isInstalled(harness.first.namespace)).toBe(false)
    expect(incumbent.isInstalled(harness.second.namespace)).toBe(true)
    await expect(
      Promise.all([
        createPane(harness.first, 'pane-after-handover-a', 'partial-a'),
        createPane(harness.second, 'pane-after-failure-b', 'partial-b')
      ])
    ).resolves.toEqual([1, 1])

    await installNamespace(partial, harness.second)
    expect(partial.isInstalled(harness.first.namespace)).toBe(true)
    expect(partial.isInstalled(harness.second.namespace)).toBe(true)
    expect(incumbent.isInstalled(harness.second.namespace)).toBe(false)
    expect(
      harness.second.activeConsumerIncarnation(harness.second.writerAccess, candidate.consumerId)
    ).toBe(candidate.consumerIncarnationId)
  })

  it('does not advance another device or namespace cursor', async () => {
    const { manager, first, second } = await twoNamespaces()
    const publications = new Map<string, TerminalAuthorityNamespaceOutcomePublication>()
    const connect = async (consumer: TerminalAuthorityPolicyConsumerIdentity) => {
      const connection = await manager.connect(claim(consumer), {
        publishBoundary: async () => {},
        publishOutcome: async (publication) => {
          publications.set(publicationKey(publication), publication)
        }
      })
      await connection.activate()
      await Promise.all([installNamespace(connection, first), installNamespace(connection, second)])
      return connection
    }
    const app = await connect(identity('profile-a', 'process-a'))
    const device = await connect(identity('device-a', 'device-process-a', 'paired-device'))
    await Promise.all([
      createPane(first, 'pane-a', 'isolation-a'),
      createPane(second, 'pane-b', 'isolation-b')
    ])
    await vi.waitFor(() => expect(publications.size).toBe(4), { timeout: 5_000 })

    const appFirst = publications.get(keyFor(app.identity, first))!
    await app.acknowledge(ackFor(appFirst))
    await expect(cursor(first, app.identity)).resolves.toMatchObject({ acknowledgedSequence: 1 })
    await expect(cursor(second, app.identity)).resolves.toMatchObject({ acknowledgedSequence: 0 })
    await expect(cursor(first, device.identity)).resolves.toMatchObject({
      acknowledgedSequence: 0
    })
    await expect(cursor(second, device.identity)).resolves.toMatchObject({
      acknowledgedSequence: 0
    })
  })

  it('releases the producer after boundary, read, publish, and ACK failures', async () => {
    await proveBoundaryFailureReleasesHold()
    await proveReadFailureReleasesHold()
    await provePublishFailureReleasesHold()
    await proveAckFailureReleasesHold()
  })

  it('releases the producer when snapshot preparation fails', async () => {
    const { manager, service } = await oneNamespace()
    const snapshot = vi
      .spyOn(service, 'snapshotForConsumerClaim')
      .mockRejectedValueOnce(new Error('snapshot failed'))
    const connection = await manager.connect(
      claim(identity('profile-a', 'process-a')),
      quietTransport()
    )
    await connection.activate()
    await expect(installNamespace(connection, service)).rejects.toThrow('snapshot failed')
    snapshot.mockRestore()
    await expect(createPane(service, 'pane-a', 'after-snapshot-failure')).resolves.toBe(1)
  })
})

async function proveBoundaryFailureReleasesHold(): Promise<void> {
  const { manager, service } = await oneNamespace()
  const started = deferred<void>()
  const reject = deferred<void>()
  const connection = await manager.connect(claim(identity('boundary', 'process-a')), {
    publishBoundary: async () => {
      started.resolve()
      await reject.promise
      throw new Error('boundary failed')
    },
    publishOutcome: async () => {}
  })
  await connection.activate()
  const installation = installNamespace(connection, service)
  await started.promise
  const mutation = createPane(service, 'boundary-pane', 'boundary-failure')
  await expectPending(mutation)
  reject.resolve()
  await expect(installation).rejects.toThrow('boundary failed')
  await expect(mutation).resolves.toBe(1)
}

async function proveReadFailureReleasesHold(): Promise<void> {
  const { manager, service } = await returningConsumer('read')
  const started = deferred<void>()
  const reject = deferred<void>()
  vi.spyOn(service, 'readOutcomes').mockImplementationOnce(async () => {
    started.resolve()
    await reject.promise
    throw new Error('read failed')
  })
  const failure = deferred<void>()
  const connection = await manager.connect(
    claim(identity('read', 'process-b'), 'app-process:process-a'),
    {
      publishBoundary: async () => {},
      publishOutcome: async () => {},
      onFailure: () => failure.resolve()
    }
  )
  await connection.activate()
  await installNamespace(connection, service)
  await started.promise
  const mutation = createPane(service, 'read-pane-b', 'read-failure')
  await expectPending(mutation)
  reject.resolve()
  await failure.promise
  await expect(mutation).resolves.toBe(2)
}

async function provePublishFailureReleasesHold(): Promise<void> {
  const { manager, service } = await returningConsumer('publish')
  const started = deferred<void>()
  const reject = deferred<void>()
  const failure = deferred<void>()
  const connection = await manager.connect(
    claim(identity('publish', 'process-b'), 'app-process:process-a'),
    {
      publishBoundary: async () => {},
      publishOutcome: async () => {
        started.resolve()
        await reject.promise
        throw new Error('publish failed')
      },
      onFailure: () => failure.resolve()
    }
  )
  await connection.activate()
  await installNamespace(connection, service)
  await started.promise
  const mutation = createPane(service, 'publish-pane-b', 'publish-failure')
  await expectPending(mutation)
  reject.resolve()
  await failure.promise
  await expect(mutation).resolves.toBe(2)
}

async function proveAckFailureReleasesHold(): Promise<void> {
  const { manager, service } = await returningConsumer('ack')
  const published = deferred<TerminalAuthorityNamespaceOutcomePublication>()
  const connection = await manager.connect(
    claim(identity('ack', 'process-b'), 'app-process:process-a'),
    {
      publishBoundary: async () => {},
      publishOutcome: async (publication) => published.resolve(publication)
    }
  )
  await connection.activate()
  await installNamespace(connection, service)
  const publication = await published.promise
  const mutation = createPane(service, 'ack-pane-b', 'ack-failure')
  await expectPending(mutation)
  vi.spyOn(service, 'acknowledgeOutcomes').mockRejectedValueOnce(new Error('ACK failed'))
  await expect(connection.acknowledge(ackFor(publication))).rejects.toThrow('ACK failed')
  await expect(mutation).resolves.toBe(2)
}

async function returningConsumer(profile: string) {
  const harness = await oneNamespace()
  const consumer = identity(profile, 'process-a')
  await harness.service.claimConsumer(harness.service.writerAccess, {
    consumerId: consumer.consumerId,
    expectedIncarnationId: null,
    consumerIncarnationId: consumer.consumerIncarnationId
  })
  await createPane(harness.service, `${profile}-pane-a`, `${profile}-seed`)
  return harness
}

async function oneNamespace() {
  const directory = freshDirectory()
  const registry = await openRegistry(directory)
  const namespace = (await registry.resolveNamespace(terminalAuthorityWorkspaceLocator(directory)))
    .namespace
  const service = await registry.openNamespace(namespace)
  const manager = new TerminalSessionAuthorityPolicyConsumers()
  managers.push(manager)
  return { directory, registry, manager, service }
}

async function twoNamespaces() {
  const harness = await oneNamespace()
  const namespace = (await harness.registry.resolveNamespace(terminalAuthorityFloatingLocator()))
    .namespace
  const second = await harness.registry.openNamespace(namespace)
  return { ...harness, first: harness.service, second }
}

async function openRegistry(directory: string): Promise<TerminalSessionAuthorityRegistry> {
  const registry = await TerminalSessionAuthorityRegistry.open({
    directory: path.join(directory, 'authority'),
    authorityHostId: 'host-policy-test',
    ownerToken: 'owner-token-policy-test',
    ownerIncarnationId: 'owner-incarnation-policy-test',
    writerActorId: 'writer-policy-test'
  })
  registries.push(registry)
  return registry
}

async function createPane(
  service: TerminalSessionAuthorityService,
  paneKey: string,
  correlationId: string
): Promise<number> {
  const revision = service.snapshotForWriter(service.writerAccess).revision
  const receipt = await service.mutate(service.writerAccess, {
    actorId: service.writerAccess.actorId,
    ...terminalAuthorityOperationIdentity(revision, correlationId),
    baseRevision: revision,
    change: {
      kind: 'create',
      pane: { paneKey, paneGenerationId: `${paneKey}-generation` }
    }
  })
  return receipt.outcomeSequence
}

function cursor(
  service: TerminalSessionAuthorityService,
  consumer: TerminalAuthorityPolicyConsumerIdentity
) {
  return service.snapshotForConsumer({
    role: 'consumer',
    serviceInstanceId: service.writerAccess.serviceInstanceId,
    consumerId: consumer.consumerId,
    consumerIncarnationId: consumer.consumerIncarnationId
  })
}

function identity(
  profile: string,
  process: string,
  kind: 'app-profile' | 'paired-device' = 'app-profile'
): TerminalAuthorityPolicyConsumerIdentity {
  return Object.freeze({
    consumerId: `${kind}:${profile}`,
    consumerIncarnationId: `${kind === 'app-profile' ? 'app-process' : 'device-process'}:${process}`
  })
}

function claim(
  consumer: TerminalAuthorityPolicyConsumerIdentity,
  expectedConsumerIncarnationId: string | null = null
) {
  return Object.freeze({ version: 1 as const, consumer, expectedConsumerIncarnationId })
}

function quietTransport() {
  return Object.freeze({ publishBoundary: async () => {}, publishOutcome: async () => {} })
}

function ackFor(
  publication: TerminalAuthorityNamespaceOutcomePublication
): TerminalAuthorityNamespaceOutcomeAck {
  const outcome = (publication.outcomes ?? [publication.outcome]).at(-1)!
  return Object.freeze({
    version: 1,
    consumer: publication.consumer,
    namespace: publication.namespace,
    sequence: outcome.sequence,
    outcomeId: outcome.outcomeId
  })
}

function publicationKey(publication: TerminalAuthorityNamespaceOutcomePublication): string {
  return JSON.stringify([publication.consumer.consumerId, publication.namespace.namespaceId])
}

function keyFor(
  consumer: TerminalAuthorityPolicyConsumerIdentity,
  service: TerminalSessionAuthorityService
): string {
  return JSON.stringify([consumer.consumerId, service.namespace.namespaceId])
}

async function waitForLength(values: readonly unknown[], length: number): Promise<void> {
  await vi.waitFor(() => expect(values).toHaveLength(length), { timeout: 5_000 })
}

async function expectPending(promise: Promise<unknown>): Promise<void> {
  let settled = false
  void promise.then(
    () => {
      settled = true
    },
    () => {
      settled = true
    }
  )
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(settled).toBe(false)
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

function freshDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'orca-policy-consumers-'))
  directories.push(directory)
  return directory
}

// Installation now runs the same staged prepare/commit an authenticated admission drives; the
// connection's own ensureNamespace only asserts, so it can never claim on its own.
async function installNamespace(
  connection: TerminalAuthorityPolicyConsumerConnection,
  service: TerminalSessionAuthorityService
): Promise<void> {
  const preparation = await connection.prepareNamespace!(service)
  await preparation.commit()
}
