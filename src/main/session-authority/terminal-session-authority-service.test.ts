import {
  closeSync,
  fsyncSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { TerminalSessionAuthorityChange } from '../../shared/terminal-session-authority-mutation'
import { terminalAuthorityOperationIdentity } from '../../shared/terminal-session-authority-operation-identity'
import type { TerminalAuthorityConsumerAccess } from './terminal-session-authority-access'
import { TerminalSessionAuthorityService } from './terminal-session-authority-service'
import type {
  TerminalAuthorityProjectionChange,
  TerminalSessionAuthorityServiceOptions
} from './terminal-session-authority-service-contract'

const directories: string[] = []
const services: TerminalSessionAuthorityService[] = []

afterEach(async () => {
  await Promise.allSettled(services.splice(0).map((service) => service.close()))
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('TerminalSessionAuthorityService', () => {
  it('linearizes a new producer hold with queue admission after a prior gate resolves', async () => {
    const service = await openService(freshDirectory())
    const consumer = await claim(service, 'consumer-a', null, 'consumer-incarnation-a')
    const firstHold = service.acquireProducerHold(service.writerAccess)
    const pane = { paneKey: 'pane-a', paneGenerationId: 'generation-a' }
    const mutation = mutate(service, consumer, 0, 'create', { kind: 'create', pane })
    let secondHold: Readonly<{ release(): void }> | undefined
    let snapshot: ReturnType<TerminalSessionAuthorityService['snapshotForConsumer']> | undefined

    firstHold.release()
    queueMicrotask(() => {
      secondHold = service.acquireProducerHold(service.writerAccess)
      snapshot = service.snapshotForConsumer(consumer)
    })
    await new Promise<void>((resolve) => setImmediate(resolve))

    await expect(snapshot).resolves.toMatchObject({ outcomeHighWatermark: 1 })
    secondHold?.release()
    await expect(mutation).resolves.toMatchObject({ outcomeSequence: 1 })
  })

  it('snapshots a consumer claim before queueing it', async () => {
    const service = await openService(freshDirectory())
    const input = {
      consumerId: 'consumer-a',
      expectedIncarnationId: null,
      consumerIncarnationId: 'consumer-incarnation-a'
    }
    const claiming = service.claimConsumer(service.writerAccess, input)
    Object.assign(input, {
      consumerId: 'changed-consumer',
      consumerIncarnationId: 'changed-incarnation'
    })
    await expect(claiming).resolves.toMatchObject({
      consumerId: 'consumer-a',
      consumerIncarnationId: 'consumer-incarnation-a'
    })
  })

  it('durably retires only the current consumer incarnation', async () => {
    const directory = freshDirectory()
    const service = await openService(directory)
    const host = await claim(service, 'host-effects', null, 'host-incarnation')
    const device = await claim(service, 'device-a', null, 'device-incarnation')
    const pane = { paneKey: 'pane-a', paneGenerationId: 'generation-a' }
    const created = await mutate(service, host, 0, 'create-before-retire', {
      kind: 'create',
      pane
    })
    await service.acknowledgeOutcomes(host, created.outcomeSequence)

    await expect(
      service.retireConsumer(service.writerAccess, {
        ...device,
        consumerIncarnationId: 'stale-incarnation'
      })
    ).rejects.toMatchObject({ code: 'consumer-conflict' })
    await expect(service.retireConsumer(service.writerAccess, device)).resolves.toBe(true)
    await expect(service.retireConsumer(service.writerAccess, device)).resolves.toBe(false)

    await service.close()
    services.splice(services.indexOf(service), 1)
    const restored = await openService(directory)
    const restoredHost = await claim(
      restored,
      'host-effects',
      'host-incarnation',
      'host-incarnation'
    )
    await expect(restored.snapshotForConsumer(restoredHost)).resolves.toMatchObject({
      acknowledgedSequence: created.outcomeSequence,
      outcomeHighWatermark: created.outcomeSequence
    })
  })

  it('publishes durable projection changes without admitting duplicate or consumer events', async () => {
    const service = await openService(freshDirectory(), { maxObservers: 1 })
    const changes: TerminalAuthorityProjectionChange[] = []
    const subscription = service.subscribeProjection('projection-subscriber', (change) => {
      changes.push(change)
    })
    expect(() => service.observe('over-capacity-observer')).toThrowError(
      expect.objectContaining({ code: 'capacity' })
    )
    const consumer = await claim(service, 'consumer-a', null, 'consumer-incarnation-a')
    expect(changes).toHaveLength(0)

    const pane = { paneKey: 'pane-a', paneGenerationId: 'generation-a' }
    await mutate(service, consumer, 0, 'create', { kind: 'create', pane })
    await mutate(service, consumer, 0, 'create', { kind: 'create', pane })
    expect(changes).toMatchObject([
      { reason: 'mutation', projection: { revision: 1, panes: [{ paneKey: 'pane-a' }] } }
    ])

    service.revokeObserver(subscription)
    const failing = service.subscribeProjection('failing-subscriber', () => {
      throw new Error('subscriber failure')
    })
    await expect(
      mutate(service, consumer, 1, 'close', {
        kind: 'close',
        pane,
        expected: { paneGenerationId: pane.paneGenerationId, binding: null }
      })
    ).resolves.toMatchObject({ result: { revision: 2 } })
    expect(changes).toHaveLength(1)
    service.revokeObserver(failing)
  })

  it('durably prepares and commits an exact PTY allocation with no I/O hot-path writes', async () => {
    const service = await openService(freshDirectory())
    const consumer = await claim(service, 'consumer-a', null, 'consumer-incarnation-a')
    const pane = { paneKey: 'pane-a', paneGenerationId: 'generation-a' }
    await mutate(service, consumer, 0, 'create', { kind: 'create', pane })
    const allocation = {
      allocationId: 'allocation-a',
      pane,
      ownerIncarnationId: 'owner-incarnation-a',
      physicalPtyId: 'pty-a',
      spawnFingerprint: 'spawn-a'
    }
    const prepared = await mutate(service, consumer, 1, 'prepare', {
      kind: 'prepare-allocation',
      allocation,
      expected: { paneGenerationId: pane.paneGenerationId, binding: null }
    })
    expect(prepared.result.allocation).toMatchObject({
      status: 'pending',
      allocationId: 'allocation-a'
    })
    const committed = await mutate(service, consumer, 2, 'commit', {
      kind: 'commit-allocation',
      allocation,
      ptyIncarnationId: 'pty-incarnation-a',
      expected: { paneGenerationId: pane.paneGenerationId, binding: null }
    })
    const binding = committed.result.pane.binding!
    expect(committed.result.allocation).toMatchObject({ status: 'committed', binding })
    expect(service.bindingAuthority(service.writerAccess, pane, binding)).toBe('reachable')

    const log = path.join(serviceDirectory(service), 'authority.log')
    const before = statSync(log).size
    for (let index = 0; index < 1_000; index++) {
      expect(service.bindingAuthority(service.writerAccess, pane, binding)).toBe('reachable')
    }
    expect(statSync(log).size).toBe(before)
    expect(readFileSync(log, 'utf8').trim().split('\n')).toHaveLength(4)
    expect('write' in service || 'resize' in service || 'terminalOutput' in service).toBe(false)
  })

  it('rotates consumer incarnation while retaining ordered outcomes and ACK state', async () => {
    const directory = freshDirectory()
    const first = await openService(directory)
    const original = await claim(first, 'consumer-a', null, 'consumer-incarnation-a')
    const pane = { paneKey: 'pane-a', paneGenerationId: 'generation-a' }
    await mutate(first, original, 0, 'create', { kind: 'create', pane })
    const rotated = await claim(
      first,
      'consumer-a',
      'consumer-incarnation-a',
      'consumer-incarnation-b'
    )
    await expect(first.readOutcomes(original, 0)).rejects.toMatchObject({
      code: 'consumer-conflict'
    })
    const replay = await first.readOutcomes(rotated, 0)
    expect(replay).toMatchObject({ kind: 'entries', entries: [{ sequence: 1 }] })
    expect(await first.snapshotForConsumer(rotated)).toMatchObject({
      acknowledgedSequence: 0,
      outcomeHighWatermark: 1,
      authority: { revision: 1 }
    })
    await first.acknowledgeOutcomes(rotated, 1)
    const log = path.join(serviceDirectory(first), 'authority.log')
    const afterAck = statSync(log).size
    await first.acknowledgeOutcomes(rotated, 1)
    expect(statSync(log).size).toBe(afterAck)
    expect(await first.readOutcomes(rotated, 0)).toMatchObject({
      kind: 'resnapshot-required',
      reason: 'cursor-compacted',
      acknowledgedSequence: 1
    })
  })

  it('fences old consumer reads and ACKs after writer takeover', async () => {
    const directory = freshDirectory()
    const first = await openService(directory, { ownerToken: 'owner-token-a' })
    const original = await claim(first, 'consumer-a', null, 'consumer-incarnation-a')
    const pane = { paneKey: 'pane-a', paneGenerationId: 'generation-a' }
    await mutate(first, original, 0, 'create', { kind: 'create', pane })

    const replacement = await openService(directory, {
      ownerToken: 'owner-token-b',
      takeoverOwnerToken: 'owner-token-a',
      ownerIncarnationId: 'owner-incarnation-b'
    })
    const rotated = await replacement.claimConsumer(replacement.writerAccess, {
      consumerId: 'consumer-a',
      expectedIncarnationId: replacement.activeConsumerIncarnation(
        replacement.writerAccess,
        'consumer-a'
      ),
      consumerIncarnationId: 'consumer-incarnation-b'
    })

    await expect(first.readOutcomes(original, 0)).rejects.toMatchObject({
      code: 'writer-fenced'
    })
    await expect(first.acknowledgeOutcomes(original, 1)).rejects.toMatchObject({
      code: 'writer-fenced'
    })
    await expect(replacement.readOutcomes(rotated, 0)).resolves.toMatchObject({
      kind: 'entries',
      entries: [{ sequence: 1 }]
    })
  })

  it('recovers one synced mutation after its response is lost', async () => {
    const directory = freshDirectory()
    const first = await openService(directory, {
      ownerToken: 'owner-token-a'
    })
    const original = await claim(first, 'consumer-a', null, 'consumer-incarnation-a')
    const pane = { paneKey: 'pane-a', paneGenerationId: 'generation-a' }
    await mutate(first, original, 0, 'create-once', { kind: 'create', pane })

    const replacement = await openService(directory, {
      ownerToken: 'owner-token-b',
      takeoverOwnerToken: 'owner-token-a',
      ownerIncarnationId: 'owner-incarnation-b'
    })
    const consumer = await claim(
      replacement,
      'consumer-a',
      'consumer-incarnation-a',
      'consumer-incarnation-a'
    )
    const replay = await replacement.readOutcomes(consumer, 0)
    expect(replay).toMatchObject({
      kind: 'entries',
      entries: [
        {
          outcomeId: terminalAuthorityOperationIdentity(0, 'create-once').outcomeId,
          sequence: 1
        }
      ]
    })
    const replayed = replay.kind === 'entries' ? replay.entries[0] : null
    if (replayed?.kind === undefined) {
      Object.assign(replayed!.result.pane, { paneKey: 'changed-pane' })
    }
    expect(await replacement.readOutcomes(consumer, 0)).toMatchObject({
      kind: 'entries',
      entries: [{ result: { pane: { paneKey: 'pane-a' } } }]
    })
    const duplicate = await mutate(replacement, consumer, 0, 'create-once', {
      kind: 'create',
      pane
    })
    Object.assign(duplicate.result.pane, { paneKey: 'changed-duplicate-pane' })
    expect((await replacement.snapshotForConsumer(consumer)).authority.panes).toHaveLength(1)
    expect((await replacement.snapshotForConsumer(consumer)).authority.panes[0]?.paneKey).toBe(
      'pane-a'
    )
    expect(replacement.writerAccess.writerEpoch).toBe(2)
  })

  it.each([false, true])(
    'rejects a compacted ACKed operation after restart (checkpoint=%s)',
    async (checkpoint) => {
      const directory = freshDirectory()
      const first = await openService(directory, { ownerToken: 'owner-token-a' })
      const consumer = await claim(first, 'consumer-a', null, 'consumer-incarnation-a')
      const pane = { paneKey: 'pane-a', paneGenerationId: 'generation-a' }
      const request = mutationRequest(first, consumer, 0, 'create-before-response', {
        kind: 'create',
        pane
      })
      const original = await first.mutate(first.writerAccess, request)
      await first.acknowledgeOutcomes(consumer, original.outcomeSequence)
      if (checkpoint) {
        await first.compact(first.writerAccess)
      }

      const replacement = await openService(directory, {
        ownerToken: 'owner-token-b',
        takeoverOwnerToken: 'owner-token-a',
        ownerIncarnationId: 'owner-incarnation-b'
      })
      const resumed = await claim(
        replacement,
        'consumer-a',
        'consumer-incarnation-a',
        'consumer-incarnation-a'
      )
      await expect(replacement.mutate(replacement.writerAccess, request)).rejects.toMatchObject({
        code: 'operation-conflict'
      })
      expect(await replacement.snapshotForConsumer(resumed)).toMatchObject({
        acknowledgedSequence: 1,
        outcomeHighWatermark: 1,
        authority: { revision: 1, panes: [{ paneKey: 'pane-a' }] }
      })
    }
  )

  it('reclaims ACKed operation capacity without admitting old IDs', async () => {
    const service = await openService(freshDirectory(), { maxRetainedOperationEntries: 1 })
    const consumer = await claim(service, 'consumer-a', null, 'consumer-incarnation-a')
    const pane = { paneKey: 'pane-a', paneGenerationId: 'generation-a' }
    const originalRequest = mutationRequest(service, consumer, 0, 'retained-create', {
      kind: 'create',
      pane
    })
    const original = await service.mutate(service.writerAccess, originalRequest)
    await service.acknowledgeOutcomes(consumer, original.outcomeSequence)

    await expect(
      mutate(service, consumer, 1, 'new-close', {
        kind: 'close',
        pane,
        expected: { paneGenerationId: pane.paneGenerationId, binding: null }
      })
    ).resolves.toMatchObject({ result: { revision: 2, kind: 'close' } })
    await expect(service.mutate(service.writerAccess, originalRequest)).rejects.toMatchObject({
      code: 'operation-conflict'
    })
  })

  it.each(['checkpoint-synced', 'checkpoint-renamed', 'log-reset-renamed'] as const)(
    'recovers one state across the %s compaction crash boundary',
    async (crashBoundary) => {
      const directory = freshDirectory()
      const first = await openService(directory, {
        ownerToken: 'owner-token-a'
      })
      const consumer = await claim(first, 'consumer-a', null, 'consumer-incarnation-a')
      const pane = { paneKey: 'pane-a', paneGenerationId: 'generation-a' }
      await mutate(first, consumer, 0, 'create', { kind: 'create', pane })
      await stageCompactionCrashState(directory, first, crashBoundary)

      const replacement = await openService(directory, {
        ownerToken: 'owner-token-b',
        takeoverOwnerToken: 'owner-token-a',
        ownerIncarnationId: 'owner-incarnation-b'
      })
      const resumed = await claim(
        replacement,
        'consumer-a',
        'consumer-incarnation-a',
        'consumer-incarnation-a'
      )
      expect((await replacement.snapshotForConsumer(resumed)).authority.panes).toMatchObject([
        { paneKey: 'pane-a', paneGenerationId: 'generation-a' }
      ])
      expect(await replacement.readOutcomes(resumed, 0)).toMatchObject({
        kind: 'entries',
        entries: [{ outcomeId: terminalAuthorityOperationIdentity(0, 'create').outcomeId }]
      })
    }
  )

  it('marks predecessor bindings and pending spawn intents owner-unreachable after restart', async () => {
    const directory = freshDirectory()
    const first = await openService(directory)
    const consumer = await claim(first, 'consumer-a', null, 'consumer-incarnation-a')
    const pane = { paneKey: 'pane-a', paneGenerationId: 'generation-a' }
    await mutate(first, consumer, 0, 'create', { kind: 'create', pane })
    const allocation = {
      allocationId: 'allocation-a',
      pane,
      ownerIncarnationId: 'owner-incarnation-a',
      physicalPtyId: 'pty-a',
      spawnFingerprint: 'spawn-a'
    }
    await mutate(first, consumer, 1, 'prepare', {
      kind: 'prepare-allocation',
      allocation,
      expected: { paneGenerationId: pane.paneGenerationId, binding: null }
    })
    await first.compact(first.writerAccess)
    await first.close()

    const restarted = await openService(directory, {
      ownerToken: 'owner-token-b',
      ownerIncarnationId: 'owner-incarnation-b'
    })
    const resumed = await claim(
      restarted,
      'consumer-a',
      'consumer-incarnation-a',
      'consumer-incarnation-a'
    )
    await expect(
      mutate(restarted, resumed, 2, 'commit-old-owner', {
        kind: 'commit-allocation',
        allocation,
        ptyIncarnationId: 'pty-incarnation-a',
        expected: { paneGenerationId: pane.paneGenerationId, binding: null }
      })
    ).rejects.toMatchObject({ code: 'allocation-conflict' })
    await expect(
      mutate(restarted, resumed, 2, 'cancel-old-owner', {
        kind: 'cancel-allocation',
        allocation,
        expected: { paneGenerationId: pane.paneGenerationId, binding: null }
      })
    ).rejects.toMatchObject({ code: 'allocation-conflict' })
    expect((await restarted.snapshotForConsumer(resumed)).authority.allocations).toMatchObject([
      { allocationId: 'allocation-a', status: 'pending' }
    ])
  })

  it('does not expose restored binding or allocation state through observer projections', async () => {
    const directory = freshDirectory()
    const first = await openService(directory)
    const consumer = await claim(first, 'consumer-a', null, 'consumer-incarnation-a')
    const { pane, binding } = await createBoundPane(first, consumer)
    await first.compact(first.writerAccess)
    await first.close()

    const legacyWorkerAccess = Object.freeze({
      role: 'legacy-worker-owner' as const,
      accessId: 'restored-binding-legacy-worker-owner'
    })
    const restarted = await openService(directory, {
      ownerToken: 'owner-token-b',
      ownerIncarnationId: 'owner-incarnation-b',
      legacyWorkerAccess
    })
    const changes: string[] = []
    restarted.subscribeProjection('restored-binding-subscription', (change) => {
      changes.push(change.reason)
    })
    const observer = restarted.observe('projection-observer')
    const projection = restarted.snapshotForObserver(observer)
    expect(() =>
      Object.assign(projection.panes[0]!.binding!, { physicalPtyId: 'changed-pty' })
    ).toThrow()
    expect(() =>
      Object.assign(projection.allocations[0]!.binding!, {
        ptyIncarnationId: 'changed-incarnation'
      })
    ).toThrow()
    expect(restarted.bindingAuthority(observer, pane, binding)).toBe('owner-unreachable')
    await restarted.legacy.setOwnerReachable(
      restarted.writerAccess,
      legacyWorkerAccess,
      binding.ownerIncarnationId,
      true
    )
    expect(changes).toEqual(['owner-reachability'])
  })

  it.each(['close', 'supersede'] as const)(
    'drops the retired owner-binding index while replaying %s',
    async (kind) => {
      const directory = freshDirectory()
      const first = await openService(directory)
      const consumer = await claim(first, 'consumer-a', null, 'consumer-incarnation-a')
      const { pane, binding } = await createBoundPane(first, consumer)
      const change: TerminalSessionAuthorityChange =
        kind === 'close'
          ? {
              kind,
              pane,
              expected: { paneGenerationId: pane.paneGenerationId, binding }
            }
          : {
              kind,
              pane,
              replacementPaneGenerationId: 'generation-b',
              expected: { paneGenerationId: pane.paneGenerationId, binding }
            }
      await mutate(first, consumer, 3, `retire-${kind}`, change)
      await first.close()

      const legacyWorkerAccess = Object.freeze({
        role: 'legacy-worker-owner' as const,
        accessId: `retired-${kind}-legacy-worker-owner`
      })
      const restarted = await openService(directory, {
        ownerToken: 'owner-token-b',
        ownerIncarnationId: 'owner-incarnation-b',
        legacyWorkerAccess
      })
      const changes: string[] = []
      restarted.subscribeProjection(`retired-${kind}-subscription`, (change) => {
        changes.push(change.reason)
      })
      await restarted.legacy.setOwnerReachable(
        restarted.writerAccess,
        legacyWorkerAccess,
        binding.ownerIncarnationId,
        true
      )
      expect(changes).toEqual([])
    }
  )

  it.each([
    ['close', false],
    ['supersede', false],
    ['exit', true]
  ] as const)(
    'rejects %s when a predecessor still owns the live binding',
    async (kind, leaveUnreachable) => {
      const directory = freshDirectory()
      const first = await openService(directory)
      const original = await claim(first, 'consumer-a', null, 'consumer-incarnation-a')
      const { pane, binding } = await createBoundPane(first, original)
      await first.close()

      const legacyWorkerAccess = Object.freeze({
        role: 'legacy-worker-owner' as const,
        accessId: `legacy-worker-owner-${kind}`
      })
      const restarted = await openService(directory, {
        ownerToken: 'owner-token-b',
        ownerIncarnationId: 'owner-incarnation-b',
        legacyWorkerAccess
      })
      const resumed = await claim(
        restarted,
        'consumer-a',
        'consumer-incarnation-a',
        'consumer-incarnation-a'
      )
      if (!leaveUnreachable) {
        await restarted.legacy.setOwnerReachable(
          restarted.writerAccess,
          legacyWorkerAccess,
          binding.ownerIncarnationId,
          true
        )
      }
      const change: TerminalSessionAuthorityChange =
        kind === 'close'
          ? {
              kind,
              pane,
              expected: { paneGenerationId: pane.paneGenerationId, binding }
            }
          : kind === 'supersede'
            ? {
                kind,
                pane,
                replacementPaneGenerationId: 'generation-b',
                expected: { paneGenerationId: pane.paneGenerationId, binding }
              }
            : {
                kind,
                pane,
                exit: { code: null, signal: null },
                expected: { paneGenerationId: pane.paneGenerationId, binding }
              }
      await expect(
        mutate(restarted, resumed, 3, `${kind}-old-owner`, change)
      ).rejects.toMatchObject({
        code: 'expectation-mismatch'
      })
    }
  )

  it('accepts a causal exit after the live-worker path marks its owner reachable', async () => {
    const directory = freshDirectory()
    const first = await openService(directory)
    const original = await claim(first, 'consumer-a', null, 'consumer-incarnation-a')
    const { pane, binding } = await createBoundPane(first, original)
    await first.close()

    const legacyWorkerAccess = Object.freeze({
      role: 'legacy-worker-owner' as const,
      accessId: 'legacy-worker-owner-exit'
    })
    const restarted = await openService(directory, {
      ownerToken: 'owner-token-b',
      ownerIncarnationId: 'owner-incarnation-b',
      legacyWorkerAccess
    })
    const resumed = await claim(
      restarted,
      'consumer-a',
      'consumer-incarnation-a',
      'consumer-incarnation-a'
    )
    const changes: string[] = []
    restarted.subscribeProjection('causal-exit-subscription', (change) => {
      changes.push(change.reason)
    })
    await restarted.legacy.setOwnerReachable(
      restarted.writerAccess,
      legacyWorkerAccess,
      binding.ownerIncarnationId,
      true
    )
    const exited = await mutate(restarted, resumed, 3, 'causal-predecessor-exit', {
      kind: 'exit',
      pane,
      exit: { code: 0, signal: null },
      expected: { paneGenerationId: pane.paneGenerationId, binding }
    })
    expect(exited.result).toMatchObject({
      pane: { status: 'exited', binding: null },
      effects: [{ kind: 'binding-retired' }, { kind: 'terminal-exited', code: 0 }]
    })
    await restarted.legacy.setOwnerReachable(
      restarted.writerAccess,
      legacyWorkerAccess,
      binding.ownerIncarnationId,
      false
    )
    expect(changes).toEqual(['owner-reachability', 'mutation'])
  })

  it('fails closed when a checkpoint outcome contains a forged retirement effect', async () => {
    const directory = freshDirectory()
    const first = await openService(directory)
    const consumer = await claim(first, 'consumer-a', null, 'consumer-incarnation-a')
    const { pane, allocation, binding } = await createBoundPane(first, consumer)
    await mutate(first, consumer, 3, 'close', {
      kind: 'close',
      pane,
      expected: { paneGenerationId: pane.paneGenerationId, binding }
    })
    await first.compact(first.writerAccess)
    await first.close()

    const checkpointPath = path.join(serviceDirectory(first), 'authority.checkpoint.json')
    const checkpoint = JSON.parse(readFileSync(checkpointPath, 'utf8'))
    const closeOutcome = checkpoint.snapshot.outcomes.at(-1)
    closeOutcome.result.effects[0].binding = {
      ...allocation,
      ownerIncarnationId: 'forged-owner',
      physicalPtyId: 'forged-pty',
      ptyIncarnationId: 'forged-incarnation'
    }
    closeOutcome.byteLength = outcomeByteLength(closeOutcome)
    writeFileSync(checkpointPath, `${JSON.stringify(checkpoint)}\n`)
    await expect(
      openService(directory, {
        ownerToken: 'owner-token-b',
        ownerIncarnationId: 'owner-incarnation-b'
      })
    ).rejects.toMatchObject({ code: 'record-corrupt' })
  })

  it('bounds and revokes observer access', async () => {
    const service = await openService(freshDirectory(), { maxObservers: 1 })
    const observer = service.observe('observer-a')
    expect(service.snapshotForObserver(observer).revision).toBe(0)
    expect(() => service.observe('observer-b')).toThrowError(
      expect.objectContaining({ code: 'capacity' })
    )
    service.revokeObserver(observer)
    expect(() => service.snapshotForObserver(observer)).toThrowError(
      expect.objectContaining({ code: 'writer-fenced' })
    )
  })
})

async function createBoundPane(
  service: TerminalSessionAuthorityService,
  consumer: TerminalAuthorityConsumerAccess
) {
  const pane = { paneKey: 'pane-a', paneGenerationId: 'generation-a' }
  await mutate(service, consumer, 0, 'create', { kind: 'create', pane })
  const allocation = {
    allocationId: 'allocation-a',
    pane,
    ownerIncarnationId: 'owner-incarnation-a',
    physicalPtyId: 'pty-a',
    spawnFingerprint: 'spawn-a'
  }
  await mutate(service, consumer, 1, 'prepare', {
    kind: 'prepare-allocation',
    allocation,
    expected: { paneGenerationId: pane.paneGenerationId, binding: null }
  })
  const receipt = await mutate(service, consumer, 2, 'commit', {
    kind: 'commit-allocation',
    allocation,
    ptyIncarnationId: 'pty-incarnation-a',
    expected: { paneGenerationId: pane.paneGenerationId, binding: null }
  })
  return { pane, allocation, binding: receipt.result.pane.binding! }
}

async function mutate(
  service: TerminalSessionAuthorityService,
  consumer: TerminalAuthorityConsumerAccess,
  baseRevision: number,
  operationId: string,
  change: TerminalSessionAuthorityChange
) {
  return service.mutate(
    service.writerAccess,
    mutationRequest(service, consumer, baseRevision, operationId, change)
  )
}

function mutationRequest(
  service: TerminalSessionAuthorityService,
  consumer: TerminalAuthorityConsumerAccess,
  baseRevision: number,
  correlationId: string,
  change: TerminalSessionAuthorityChange
) {
  return {
    actorId: service.writerAccess.actorId,
    ...terminalAuthorityOperationIdentity(baseRevision, correlationId),
    baseRevision,
    consumerId: consumer.consumerId,
    change
  }
}

async function claim(
  service: TerminalSessionAuthorityService,
  consumerId: string,
  expectedIncarnationId: string | null,
  consumerIncarnationId: string
): Promise<TerminalAuthorityConsumerAccess> {
  return service.claimConsumer(service.writerAccess, {
    consumerId,
    expectedIncarnationId,
    consumerIncarnationId
  })
}

async function openService(
  directory: string,
  overrides: Partial<TerminalSessionAuthorityServiceOptions> = {}
): Promise<TerminalSessionAuthorityService> {
  const service = await TerminalSessionAuthorityService.open({
    directory: path.join(directory, 'namespace'),
    namespace: { authorityHostId: 'host-a', namespaceId: 'namespace-a' },
    ownerToken: 'owner-token-a',
    ownerIncarnationId: 'owner-incarnation-a',
    writerActorId: 'writer-a',
    ...overrides
  })
  services.push(service)
  return service
}

function freshDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'orca-authority-service-'))
  directories.push(directory)
  return directory
}

function serviceDirectory(_service: TerminalSessionAuthorityService): string {
  return path.join(directories.at(-1)!, 'namespace')
}

function outcomeByteLength(outcome: Record<string, unknown>): number {
  const { byteLength: _byteLength, ...base } = outcome
  return Buffer.byteLength(JSON.stringify(base), 'utf8')
}

async function stageCompactionCrashState(
  directory: string,
  service: TerminalSessionAuthorityService,
  boundary: 'checkpoint-synced' | 'checkpoint-renamed' | 'log-reset-renamed'
): Promise<void> {
  const namespaceDirectory = path.join(directory, 'namespace')
  const logPath = path.join(namespaceDirectory, 'authority.log')
  const previousLog = readFileSync(logPath, 'utf8')
  if (boundary === 'checkpoint-synced') {
    writeSyncedFixture(
      path.join(
        namespaceDirectory,
        `authority.checkpoint.json.${process.pid}.00000000-0000-4000-8000-000000000000.tmp`
      ),
      'durable unpublished checkpoint\n'
    )
    return
  }
  await service.compact(service.writerAccess)
  if (boundary === 'checkpoint-renamed') {
    writeSyncedFixture(logPath, previousLog)
  }
}

function writeSyncedFixture(file: string, contents: string): void {
  const descriptor = openSync(file, 'w', 0o600)
  try {
    writeFileSync(descriptor, contents, 'utf8')
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}
