import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  TerminalSessionAuthorityLogEvent,
  TerminalSessionAuthoritySnapshot
} from '../../shared/terminal-session-authority-mutation'
import type { TerminalSessionAuthorityState } from '../../shared/terminal-session-authority-state'
import type { TerminalAuthorityFileStore } from './terminal-session-authority-file-store'
import { TerminalAuthorityMutationPersistence } from './terminal-session-authority-mutation-persistence'
import { TerminalSessionAuthorityRegistry } from './terminal-session-authority-registry'
import type { TerminalSessionAuthorityService } from './terminal-session-authority-service'
import type { TerminalSessionAuthorityOutcomeConsumers } from './terminal-session-authority-outcome-consumers'
import { terminalAuthorityWorkspaceLocator } from './terminal-session-authority-workspace-locator'
import type { TerminalAuthorityConsumerAdmissionSeal } from './terminal-session-authority-consumer-admission-seal'

const directories: string[] = []
const registries: TerminalSessionAuthorityRegistry[] = []

afterEach(async () => {
  await Promise.allSettled(registries.splice(0).map((registry) => registry.close()))
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
  vi.restoreAllMocks()
})

describe('terminal authority consumer admission seal', () => {
  it('publishes nothing while the durable append is still pending', async () => {
    const service = await openService()
    const phases: string[] = []
    const seal = recordingSeal(phases)
    let releaseAppend!: () => void
    const appendGate = new Promise<void>((resolve) => {
      releaseAppend = resolve
    })
    const consumers = outcomeConsumers(service)
    const appendClaim = consumers.appendClaim.bind(consumers)
    vi.spyOn(consumers, 'appendClaim').mockImplementation(async (plan) => {
      phases.push('append:start')
      await appendGate
      await appendClaim(plan)
      phases.push('append:settled')
    })

    const admission = service.commitConsumerAdmission(service.writerAccess, claim(), seal)
    try {
      await vi.waitFor(() => expect(phases).toContain('append:start'))
      // The seal is taken but nothing is published: a racing exact retry can observe no grant yet.
      expect(phases).toEqual(['seal', 'append:start'])
      expect(service.activeConsumerIncarnation(service.writerAccess, claim().consumerId)).toBeNull()
    } finally {
      releaseAppend()
    }
    await admission
    expect(phases).toEqual(['seal', 'append:start', 'append:settled', 'commit'])
  })

  it('aborts the seal and appends nothing when the claim is definitely not durable', async () => {
    const service = await openService()
    const phases: string[] = []
    const consumers = outcomeConsumers(service)
    vi.spyOn(consumers, 'appendClaim').mockRejectedValue(new Error('disk is gone'))

    await expect(
      service.commitConsumerAdmission(service.writerAccess, claim(), recordingSeal(phases))
    ).rejects.toThrow('disk is gone')

    expect(phases).toEqual(['seal', 'abort'])
    expect(service.activeConsumerIncarnation(service.writerAccess, claim().consumerId)).toBeNull()
  })

  it('admits exactly one of two admissions racing the same CAS', async () => {
    const service = await openService()
    const results = await Promise.allSettled([
      service.commitConsumerAdmission(service.writerAccess, claim('incarnation-a')),
      service.commitConsumerAdmission(service.writerAccess, claim('incarnation-b'))
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(service.activeConsumerIncarnation(service.writerAccess, claim().consumerId)).toBe(
      'incarnation-a'
    )
  })

  it('keeps an exact repeat of the live claim durable-write free', async () => {
    const service = await openService()
    await service.commitConsumerAdmission(service.writerAccess, claim())
    const consumers = outcomeConsumers(service)
    const planClaim = vi.spyOn(consumers, 'planClaim')

    await service.commitConsumerAdmission(service.writerAccess, {
      consumerId: claim().consumerId,
      expectedIncarnationId: 'incarnation-a',
      consumerIncarnationId: 'incarnation-a'
    })

    expect((await planClaim.mock.results[0]!.value).event).toBeNull()
  })
})

describe('terminal authority durable append ambiguity', () => {
  it('fences the service instead of unwinding when a write lands but its apply fails', async () => {
    const crashes: number[] = []
    const applied: TerminalSessionAuthorityLogEvent[] = []
    const store = {
      append: async (event: TerminalSessionAuthorityLogEvent) => {
        applied.push(event)
        return event
      },
      shouldCompact: false,
      compact: async () => {},
      assertWriterCurrent: async () => {},
      close: async () => {}
    } as unknown as TerminalAuthorityFileStore
    const state = {
      applyEvent: () => {
        throw new Error('projection apply failed')
      },
      snapshot: () => ({}) as TerminalSessionAuthoritySnapshot
    } as unknown as TerminalSessionAuthorityState
    const persistence = new TerminalAuthorityMutationPersistence(state, store, () =>
      crashes.push(1)
    )

    await expect(
      persistence.append({ kind: 'consumer-claim' } as unknown as TerminalSessionAuthorityLogEvent)
    ).rejects.toThrow('projection apply failed')

    // The record is on disk, so recovery reopens from the log rather than rewinding a landed write.
    expect(applied).toHaveLength(1)
    expect(crashes).toHaveLength(1)
  })

  it('fences the service when compaction fails after the record is durable', async () => {
    const crashes: number[] = []
    const store = {
      append: async (event: TerminalSessionAuthorityLogEvent) => event,
      shouldCompact: true,
      compact: async () => {
        throw new Error('compaction failed')
      },
      assertWriterCurrent: async () => {},
      close: async () => {}
    } as unknown as TerminalAuthorityFileStore
    const state = {
      applyEvent: () => {},
      snapshot: () => ({}) as TerminalSessionAuthoritySnapshot
    } as unknown as TerminalSessionAuthorityState
    const persistence = new TerminalAuthorityMutationPersistence(state, store, () =>
      crashes.push(1)
    )

    await expect(
      persistence.append({ kind: 'consumer-claim' } as unknown as TerminalSessionAuthorityLogEvent)
    ).rejects.toThrow('compaction failed')
    expect(crashes).toHaveLength(1)
  })
})

function recordingSeal(phases: string[]): TerminalAuthorityConsumerAdmissionSeal {
  return Object.freeze({
    seal: () => void phases.push('seal'),
    commit: () => void phases.push('commit'),
    abort: () => void phases.push('abort')
  })
}

function claim(consumerIncarnationId = 'incarnation-a') {
  return {
    consumerId: 'app-profile:seal-test',
    expectedIncarnationId: null,
    consumerIncarnationId
  }
}

function outcomeConsumers(
  service: TerminalSessionAuthorityService
): TerminalSessionAuthorityOutcomeConsumers {
  return (service as unknown as { outcomeConsumers: TerminalSessionAuthorityOutcomeConsumers })
    .outcomeConsumers
}

async function openService(): Promise<TerminalSessionAuthorityService> {
  const directory = mkdtempSync(path.join(tmpdir(), 'orca-admission-seal-'))
  directories.push(directory)
  const registry = await TerminalSessionAuthorityRegistry.open({
    directory: path.join(directory, 'authority'),
    authorityHostId: 'host-a',
    ownerToken: 'owner-token-a',
    ownerIncarnationId: 'owner-a',
    writerActorId: 'owner-a'
  })
  registries.push(registry)
  const resolved = await registry.resolveNamespace(terminalAuthorityWorkspaceLocator(directory))
  return await registry.openNamespace(resolved.namespace)
}
