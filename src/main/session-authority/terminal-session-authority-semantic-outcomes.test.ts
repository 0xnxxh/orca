import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  TerminalAuthoritySemanticOutcome,
  TerminalSessionAuthorityChange,
  TerminalSessionAuthoritySemanticFact
} from '../../shared/terminal-session-authority-mutation'
import type { TerminalSessionAuthorityPtyAccess } from '../../shared/terminal-session-authority-pty-access'
import { terminalAuthorityOperationIdentity } from '../../shared/terminal-session-authority-operation-identity'
import type { TerminalAuthorityConsumerAccess } from './terminal-session-authority-access'
import { TerminalSessionAuthorityService } from './terminal-session-authority-service'
import type { TerminalSessionAuthorityServiceOptions } from './terminal-session-authority-service-contract'

const NAMESPACE = { authorityHostId: 'host-a', namespaceId: 'namespace-a' }
const PRODUCER = 'pty-worker-incarnation-a'
const PR_LINK = {
  url: 'https://github.com/orca/orca/pull/1',
  slug: { owner: 'orca', repo: 'orca', host: 'github.com' },
  number: 1
}

const ALL_FACTS: readonly TerminalSessionAuthoritySemanticFact[] = [
  { kind: 'agent-status', payload: { state: 'working', prompt: 'ship it' } },
  { kind: 'title', normalizedTitle: 'Build', rawTitle: ' Build ' },
  { kind: 'bell' },
  { kind: 'agent-working' },
  { kind: 'agent-idle', title: 'Done' },
  { kind: 'agent-exited' },
  { kind: 'command-finished', exitCode: 0 },
  { kind: 'pr-link', link: PR_LINK },
  { kind: 'command-code-working', prompt: 'fix tests' },
  { kind: 'command-code-done', prompt: 'fix tests' },
  { kind: '2031-subscribe' },
  { kind: '2031-unsubscribe' }
]

const directories: string[] = []
const services: TerminalSessionAuthorityService[] = []

afterEach(async () => {
  await Promise.allSettled(services.splice(0).map((service) => service.close()))
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('namespace terminal outcome journal', () => {
  it('replays one ordered journal independently to two consumers', async () => {
    const service = await openService(freshDirectory())
    const first = await claim(service, 'consumer-a', 'incarnation-a')
    const second = await claim(service, 'consumer-b', 'incarnation-b')
    const access = await bindPty(service, first)
    const semantic = await record(service, first, access, 1, { kind: 'bell' })

    const firstRead = await service.readOutcomes(first, 0)
    const secondRead = await service.readOutcomes(second, 0)
    expect(firstRead).toEqual(secondRead)
    expect(firstRead).toMatchObject({
      kind: 'entries',
      entries: [
        { sequence: 1 },
        { sequence: 2 },
        { sequence: 3 },
        { sequence: semantic.sequence, fact: { kind: 'bell' } }
      ]
    })

    await service.acknowledgeOutcomes(first, semantic.sequence)
    expect(await service.readOutcomes(second, 0)).toEqual(secondRead)
    await service.acknowledgeOutcomes(second, semantic.sequence)
    expect(await service.snapshotForConsumer(first)).toMatchObject({
      acknowledgedSequence: semantic.sequence,
      outcomeHighWatermark: semantic.sequence
    })
    expect(await service.snapshotForConsumer(second)).toMatchObject({
      acknowledgedSequence: semantic.sequence,
      outcomeHighWatermark: semantic.sequence
    })
  })

  it('starts a new stable consumer at the journal tail and preserves a rotated cursor', async () => {
    const service = await openService(freshDirectory())
    const first = await claim(service, 'consumer-a', 'incarnation-a')
    await mutate(service, first, 0, 'create', {
      kind: 'create',
      pane: { paneKey: 'pane-a', paneGenerationId: 'generation-a' }
    })
    const late = await claim(service, 'consumer-b', 'incarnation-b')

    expect(await service.snapshotForConsumer(late)).toMatchObject({
      acknowledgedSequence: 1,
      outcomeHighWatermark: 1
    })
    expect(await service.readOutcomes(late, 1)).toEqual({ kind: 'entries', entries: [] })

    const rotated = await claim(service, 'consumer-a', 'incarnation-a-next', 'incarnation-a')
    expect(await service.snapshotForConsumer(rotated)).toMatchObject({ acknowledgedSequence: 0 })
    await expect(service.readOutcomes(first, 0)).rejects.toMatchObject({
      code: 'consumer-conflict'
    })
  })

  it('rejects a wrong incarnation for read and ACK while duplicate ACKs are idempotent', async () => {
    const directory = freshDirectory()
    const service = await openService(directory)
    const consumer = await claim(service, 'consumer-a', 'incarnation-a')
    await mutate(service, consumer, 0, 'create', {
      kind: 'create',
      pane: { paneKey: 'pane-a', paneGenerationId: 'generation-a' }
    })

    await service.acknowledgeOutcomes(consumer, 1)
    const afterFirstAck = readLog(directory)
    await service.acknowledgeOutcomes(consumer, 1)
    expect(readLog(directory)).toBe(afterFirstAck)

    const stale = { ...consumer, consumerIncarnationId: 'incarnation-stale' }
    await expect(service.readOutcomes(stale, 1)).rejects.toMatchObject({
      code: 'consumer-conflict'
    })
    await expect(service.acknowledgeOutcomes(stale, 1)).rejects.toMatchObject({
      code: 'consumer-conflict'
    })
  })

  it('resumes each durable consumer cursor after authority restart', async () => {
    const directory = freshDirectory()
    const firstService = await openService(directory)
    const first = await claim(firstService, 'consumer-a', 'incarnation-a')
    const second = await claim(firstService, 'consumer-b', 'incarnation-b')
    const access = await bindPty(firstService, first)
    const pending = await record(firstService, first, access, 1, { kind: 'bell' })
    await firstService.acknowledgeOutcomes(first, pending.sequence)
    await secondServiceAckMutations(firstService, second)
    await firstService.compact(firstService.writerAccess)
    await firstService.close()

    const restarted = await openService(directory, { ownerIncarnationId: 'owner-incarnation-b' })
    const resumedFirst = await claim(restarted, 'consumer-a', 'incarnation-a-next', 'incarnation-a')
    const resumedSecond = await claim(
      restarted,
      'consumer-b',
      'incarnation-b-next',
      'incarnation-b'
    )
    expect(await restarted.snapshotForConsumer(resumedFirst)).toMatchObject({
      acknowledgedSequence: pending.sequence,
      outcomeHighWatermark: pending.sequence
    })
    expect(await restarted.snapshotForConsumer(resumedSecond)).toMatchObject({
      acknowledgedSequence: 3,
      outcomeHighWatermark: pending.sequence
    })
    expect(await restarted.readOutcomes(resumedSecond, 3)).toMatchObject({
      kind: 'entries',
      entries: [{ sequence: pending.sequence, fact: { kind: 'bell' } }]
    })
  })

  it('preserves every canonical side-effect payload without a duplicate terminal-exit fact', async () => {
    const service = await openService(freshDirectory())
    const consumer = await claim(service, 'consumer-a', 'incarnation-a')
    const access = await bindPty(service, consumer)

    const appended: TerminalAuthoritySemanticOutcome[] = []
    for (const [index, fact] of ALL_FACTS.entries()) {
      appended.push(await record(service, consumer, access, index + 1, fact))
    }

    expect(appended.map((outcome) => outcome.fact)).toEqual(ALL_FACTS)
    expect(appended.some((outcome) => (outcome.fact as { kind: string }).kind === 'exit')).toBe(
      false
    )
    expect(appended.map((outcome) => outcome.sequence)).toEqual(
      ALL_FACTS.map((_, index) => index + 4)
    )
  })

  it('returns the durable semantic result for a retry and rejects changed payloads', async () => {
    const service = await openService(freshDirectory())
    const consumer = await claim(service, 'consumer-a', 'incarnation-a')
    const access = await bindPty(service, consumer)
    const first = await record(service, consumer, access, 1, { kind: 'bell' })

    await expect(record(service, consumer, access, 1, { kind: 'bell' })).resolves.toEqual(first)
    await expect(
      record(service, consumer, access, 1, { kind: 'command-finished', exitCode: 1 })
    ).rejects.toMatchObject({ code: 'record-corrupt' })
  })

  it('fails closed for producer gaps, compacted retries, and invalid consumer cursors', async () => {
    const service = await openService(freshDirectory())
    const consumer = await claim(service, 'consumer-a', 'incarnation-a')
    const access = await bindPty(service, consumer)

    await expect(record(service, consumer, access, 2, { kind: 'bell' })).rejects.toMatchObject({
      code: 'expectation-mismatch'
    })
    const outcome = await record(service, consumer, access, 1, { kind: 'bell' })
    await service.acknowledgeOutcomes(consumer, outcome.sequence)

    await expect(record(service, consumer, access, 1, { kind: 'bell' })).rejects.toMatchObject({
      code: 'operation-conflict'
    })
    expect(await service.readOutcomes(consumer, outcome.sequence - 1)).toMatchObject({
      kind: 'resnapshot-required',
      reason: 'cursor-compacted',
      acknowledgedSequence: outcome.sequence
    })
    expect(await service.readOutcomes(consumer, outcome.sequence + 1)).toMatchObject({
      kind: 'resnapshot-required',
      reason: 'cursor-ahead'
    })
  })

  it('fails closed when the shared unsettled journal reaches its bound', async () => {
    const service = await openService(freshDirectory(), { maxRetainedOperationEntries: 3 })
    const first = await claim(service, 'consumer-a', 'incarnation-a')
    const second = await claim(service, 'consumer-b', 'incarnation-b')
    const access = await bindPty(service, first)

    await expect(record(service, first, access, 1, { kind: 'bell' })).rejects.toMatchObject({
      code: 'capacity'
    })
    await service.acknowledgeOutcomes(first, 3)
    await expect(record(service, first, access, 1, { kind: 'bell' })).rejects.toMatchObject({
      code: 'capacity'
    })
    await service.acknowledgeOutcomes(second, 3)
    await expect(record(service, first, access, 1, { kind: 'bell' })).resolves.toMatchObject({
      sequence: 4
    })
  })
})

async function secondServiceAckMutations(
  service: TerminalSessionAuthorityService,
  consumer: TerminalAuthorityConsumerAccess
): Promise<void> {
  await service.acknowledgeOutcomes(consumer, 3)
}

async function record(
  service: TerminalSessionAuthorityService,
  _consumer: TerminalAuthorityConsumerAccess,
  access: TerminalSessionAuthorityPtyAccess,
  producerSequence: number,
  fact: TerminalSessionAuthoritySemanticFact
) {
  return service.recordSemanticOutcome(service.writerAccess, {
    access,
    producerIncarnationId: PRODUCER,
    producerSequence,
    fact
  })
}

async function bindPty(
  service: TerminalSessionAuthorityService,
  consumer: TerminalAuthorityConsumerAccess
): Promise<TerminalSessionAuthorityPtyAccess> {
  const pane = { paneKey: 'pane-a', paneGenerationId: 'generation-a' }
  const allocation = {
    allocationId: 'allocation-a',
    pane,
    ownerIncarnationId: 'owner-incarnation-a',
    physicalPtyId: 'pty-a',
    spawnFingerprint: 'spawn-a'
  }
  await mutate(service, consumer, 0, 'create', { kind: 'create', pane })
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
  return { namespace: NAMESPACE, pane, binding: receipt.result.pane.binding! }
}

async function mutate(
  service: TerminalSessionAuthorityService,
  _consumer: TerminalAuthorityConsumerAccess,
  baseRevision: number,
  correlationId: string,
  change: TerminalSessionAuthorityChange
) {
  return service.mutate(service.writerAccess, {
    actorId: service.writerAccess.actorId,
    ...terminalAuthorityOperationIdentity(baseRevision, correlationId),
    baseRevision,
    change
  })
}

async function claim(
  service: TerminalSessionAuthorityService,
  consumerId: string,
  consumerIncarnationId: string,
  expectedIncarnationId: string | null = null
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
    namespace: NAMESPACE,
    ownerToken: 'owner-token-a',
    ownerIncarnationId: 'owner-incarnation-a',
    writerActorId: 'writer-a',
    ...overrides
  })
  services.push(service)
  return service
}

function readLog(directory: string): string {
  return readFileSync(path.join(directory, 'namespace', 'authority.log'), 'utf8')
}

function freshDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'orca-authority-outcomes-'))
  directories.push(directory)
  return directory
}
