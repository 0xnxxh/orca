import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  TerminalAuthorityDurableOutcome,
  TerminalSessionAuthorityChange,
  TerminalSessionAuthoritySemanticFact
} from '../../shared/terminal-session-authority-mutation'
import { terminalAuthorityOperationIdentity } from '../../shared/terminal-session-authority-operation-identity'
import type { TerminalSessionAuthorityPtyAccess } from '../../shared/terminal-session-authority-pty-access'
import type { TerminalAuthorityConsumerAccess } from './terminal-session-authority-access'
import { TerminalSessionAuthorityService } from './terminal-session-authority-service'
import type { TerminalSessionAuthorityServiceOptions } from './terminal-session-authority-service-contract'

const NAMESPACE = { authorityHostId: 'host-materialized', namespaceId: 'namespace-materialized' }
const PRODUCER = 'producer-materialized'
const FACTS: readonly TerminalSessionAuthoritySemanticFact[] = [
  { kind: 'agent-status', payload: { state: 'working', prompt: 'ship it' } },
  { kind: 'title', normalizedTitle: 'Build', rawTitle: ' Build ' },
  { kind: 'bell' },
  { kind: 'agent-working' },
  { kind: 'agent-idle', title: 'Done' },
  { kind: 'agent-exited' },
  { kind: 'command-finished', exitCode: 0 },
  {
    kind: 'pr-link',
    link: {
      url: 'https://github.com/orca/orca/pull/1',
      slug: { owner: 'orca', repo: 'orca', host: 'github.com' },
      number: 1
    }
  },
  { kind: 'command-code-working', prompt: 'fix tests' },
  { kind: 'command-code-done', prompt: 'fix tests' },
  { kind: '2031-subscribe' },
  { kind: '2031-unsubscribe' }
]

const directories: string[] = []
const services: TerminalSessionAuthorityService[] = []

afterEach(async () => {
  await Promise.allSettled(services.splice(0).map((service) => service.close()))
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }))
})

describe('terminal authority materialized outcomes', () => {
  it('preserves every current semantic domain, bounded attention, and exit across restart', async () => {
    const directory = freshDirectory()
    const service = await openService(directory)
    const consumer = await claim(service)
    const access = await bindPty(service, consumer)
    let producerSequence = 0

    for (const fact of FACTS) {
      const outcome = await record(service, access, ++producerSequence, fact)
      expect(
        materialized(service).some((candidate) => candidate.outcomeId === outcome.outcomeId)
      ).toBe(true)
    }
    for (let index = 1; index < 100; index += 1) {
      await record(service, access, ++producerSequence, { kind: 'bell' })
    }
    const exit = await mutate(service, 3, 'exit', {
      kind: 'exit',
      pane: access.pane,
      exit: { code: 0, signal: null },
      expected: { paneGenerationId: access.pane.paneGenerationId, binding: access.binding }
    })
    const beforeRestart = materialized(service)

    expect(semanticKinds(beforeRestart).filter((kind) => kind === 'bell')).toHaveLength(99)
    expect(new Set(semanticKinds(beforeRestart))).toEqual(
      new Set(FACTS.map((fact) => fact.kind).filter((kind) => kind !== '2031-subscribe'))
    )
    expect(beforeRestart.at(-1)).toMatchObject({
      sequence: exit.outcomeSequence,
      result: { effects: [{ kind: 'binding-retired' }, { kind: 'terminal-exited' }] }
    })

    await service.acknowledgeOutcomes(consumer, exit.outcomeSequence)
    await service.compact(service.writerAccess)
    await service.close()
    const restarted = await openService(directory, {
      ownerToken: 'owner-token-restarted',
      ownerIncarnationId: 'owner-incarnation-restarted'
    })
    expect(materialized(restarted)).toEqual(beforeRestart)
  })

  it('replaces a semantic domain and removes a superseded pane generation', async () => {
    const service = await openService(freshDirectory())
    const consumer = await claim(service)
    const access = await bindPty(service, consumer)
    const first = await record(service, access, 1, {
      kind: 'title',
      normalizedTitle: 'First',
      rawTitle: 'First'
    })
    const second = await record(service, access, 2, {
      kind: 'title',
      normalizedTitle: 'Second',
      rawTitle: 'Second'
    })

    expect(materialized(service).map((outcome) => outcome.outcomeId)).not.toContain(first.outcomeId)
    expect(materialized(service).map((outcome) => outcome.outcomeId)).toContain(second.outcomeId)
    await mutate(service, 3, 'supersede', {
      kind: 'supersede',
      pane: access.pane,
      replacementPaneGenerationId: 'generation-b',
      expected: { paneGenerationId: access.pane.paneGenerationId, binding: access.binding }
    })
    expect(materialized(service)).toEqual([])
  })

  it('fails closed when compacted materialized domains reach their bound', async () => {
    const service = await openService(freshDirectory(), { maxRetainedOperationEntries: 3 })
    const consumer = await claim(service)
    const access = await bindPty(service, consumer)
    await service.acknowledgeOutcomes(consumer, 3)
    const facts: readonly TerminalSessionAuthoritySemanticFact[] = [
      { kind: 'title', normalizedTitle: 'Build', rawTitle: 'Build' },
      { kind: 'bell' },
      { kind: 'agent-working' }
    ]
    for (const [index, fact] of facts.entries()) {
      const outcome = await record(service, access, index + 1, fact)
      await service.acknowledgeOutcomes(consumer, outcome.sequence)
    }

    await expect(
      record(service, access, 4, {
        kind: 'pr-link',
        link: {
          url: 'https://github.com/orca/orca/pull/2',
          slug: { owner: 'orca', repo: 'orca', host: 'github.com' },
          number: 2
        }
      })
    ).rejects.toMatchObject({ code: 'capacity' })
  })
})

function materialized(
  service: TerminalSessionAuthorityService
): readonly TerminalAuthorityDurableOutcome[] {
  return service.snapshotForWriter(service.writerAccess).materializedOutcomes ?? []
}

function semanticKinds(outcomes: readonly TerminalAuthorityDurableOutcome[]): string[] {
  return outcomes.flatMap((outcome) => (outcome.kind === 'semantic' ? [outcome.fact.kind] : []))
}

async function record(
  service: TerminalSessionAuthorityService,
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
  _consumer: TerminalAuthorityConsumerAccess
): Promise<TerminalSessionAuthorityPtyAccess> {
  const pane = { paneKey: 'pane-a', paneGenerationId: 'generation-a' }
  const allocation = {
    allocationId: 'allocation-a',
    pane,
    ownerIncarnationId: 'owner-incarnation-a',
    physicalPtyId: 'pty-a',
    spawnFingerprint: 'spawn-a'
  }
  await mutate(service, 0, 'create', { kind: 'create', pane })
  await mutate(service, 1, 'prepare', {
    kind: 'prepare-allocation',
    allocation,
    expected: { paneGenerationId: pane.paneGenerationId, binding: null }
  })
  const committed = await mutate(service, 2, 'commit', {
    kind: 'commit-allocation',
    allocation,
    ptyIncarnationId: 'pty-incarnation-a',
    expected: { paneGenerationId: pane.paneGenerationId, binding: null }
  })
  return { namespace: NAMESPACE, pane, binding: committed.result.pane.binding! }
}

function mutate(
  service: TerminalSessionAuthorityService,
  baseRevision: number,
  operationId: string,
  change: TerminalSessionAuthorityChange
) {
  return service.mutate(service.writerAccess, {
    actorId: service.writerAccess.actorId,
    ...terminalAuthorityOperationIdentity(baseRevision, operationId),
    baseRevision,
    change
  })
}

function claim(service: TerminalSessionAuthorityService): Promise<TerminalAuthorityConsumerAccess> {
  return service.claimConsumer(service.writerAccess, {
    consumerId: 'app-profile:materialized',
    expectedIncarnationId: null,
    consumerIncarnationId: 'app-process:materialized'
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

function freshDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'orca-materialized-outcomes-'))
  directories.push(directory)
  return directory
}
