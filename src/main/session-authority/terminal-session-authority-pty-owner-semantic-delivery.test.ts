import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../shared/constants'
import type { TerminalAuthorityDurableOutcome } from '../../shared/terminal-session-authority-mutation'
import { TerminalSessionAuthorityHostRuntime } from './terminal-session-authority-host-runtime'
import type { TerminalAuthorityPolicyConsumerConnection } from './terminal-session-authority-policy-consumers'
import type { TerminalSessionAuthorityService } from './terminal-session-authority-service'
import type { TerminalAuthorityAuthenticatedNamespaceSession } from './terminal-session-authority-authenticated-consumers'
import { admitAuthenticatedPolicyConsumer } from './__tests__/authenticated-policy-consumer-admission'

const directories: string[] = []
const admissions = new WeakMap<
  TerminalSessionAuthorityHostRuntime,
  TerminalAuthorityAuthenticatedNamespaceSession
>()

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('TerminalSessionAuthorityPtyOwner semantic delivery', () => {
  it('serializes durable facts without waiting for consumer settlement', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'orca-authority-semantic-owner-'))
    directories.push(directory)
    let settleSemantic: () => void = () => undefined
    const semanticSettlement = new Promise<void>((resolve) => {
      settleSemantic = resolve
    })
    const published: TerminalAuthorityDurableOutcome[] = []
    const runtime = await openRuntime(directory, async (outcome) => {
      published.push(outcome)
      if (outcome.kind === 'semantic') {
        await semanticSettlement
      }
    })
    const preparation = await runtime.ptyOwner.prepareSpawn(
      {
        terminalSessionAuthorityVersion: 1,
        worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
        paneKey: 'pane-a',
        paneGeneration: 1
      },
      'pty-a',
      policyFor(runtime),
      'spawn-a'
    )
    expect(preparation.kind).toBe('spawn')
    if (preparation.kind !== 'spawn') {
      throw new Error('expected a fresh authority allocation')
    }
    const access = await runtime.ptyOwner.commitSpawn(preparation.prepared, 'pty-incarnation-a')
    await vi.waitFor(async () => {
      const snapshot = await preparation.prepared.runtime.service.snapshotForConsumer(
        await testConsumer(runtime, preparation.prepared.runtime.service)
      )
      expect(snapshot.acknowledgedSequence).toBe(snapshot.outcomeHighWatermark)
    }, 5_000)

    await expect(
      Promise.all([
        runtime.ptyOwner.recordSemanticOutcome('pty-a', access, { kind: 'bell' }),
        runtime.ptyOwner.recordSemanticOutcome('pty-a', access, {
          kind: 'command-finished',
          exitCode: 17
        })
      ])
    ).resolves.toEqual([true, true])

    const pending = await preparation.prepared.runtime.service.snapshotForConsumer(
      await testConsumer(runtime, preparation.prepared.runtime.service)
    )
    expect(pending.outcomeHighWatermark - pending.acknowledgedSequence).toBe(2)
    const read = await preparation.prepared.runtime.service.readOutcomes(
      await testConsumer(runtime, preparation.prepared.runtime.service),
      pending.acknowledgedSequence
    )
    expect(read).toMatchObject({
      kind: 'entries',
      entries: [
        { kind: 'semantic', producerSequence: 1, fact: { kind: 'bell' } },
        {
          kind: 'semantic',
          producerSequence: 2,
          fact: { kind: 'command-finished', exitCode: 17 }
        }
      ]
    })

    settleSemantic()
    await vi.waitFor(async () => {
      const snapshot = await preparation.prepared.runtime.service.snapshotForConsumer(
        await testConsumer(runtime, preparation.prepared.runtime.service)
      )
      expect(snapshot.acknowledgedSequence).toBe(snapshot.outcomeHighWatermark)
    }, 5_000)
    expect(
      published.filter((outcome) => outcome.kind === 'semantic').map((outcome) => outcome.fact)
    ).toEqual([{ kind: 'bell' }, { kind: 'command-finished', exitCode: 17 }])
    await runtime.close()
  })
})

async function openRuntime(
  directory: string,
  publish: (outcome: TerminalAuthorityDurableOutcome) => Promise<void>
): Promise<TerminalSessionAuthorityHostRuntime> {
  const ids = ['host-a', 'owner-nonce-a', 'owner-a']
  let index = 0
  const runtime = await TerminalSessionAuthorityHostRuntime.open({
    directory,
    processIdentity: {
      pid: 99_999,
      platform: 'legacy',
      startedAtMs: 1_700_000_000_000
    },
    createId: () => ids[index++] ?? `id-${index}`
  })
  runtime.ptyOwner.installHostEffectApplier({ ensureBindingRetired: async () => {} })
  let session!: TerminalAuthorityAuthenticatedNamespaceSession
  const admitted = await admitAuthenticatedPolicyConsumer(runtime.ptyOwner, {
    namespace: await runtime.ptyOwner.resolvePolicyConsumerNamespace(FLOATING_TERMINAL_WORKTREE_ID),
    processIncarnationId: 'semantic-test',
    requestId: 'semantic-request',
    outcomeTransport: {
      publishBoundary: async () => {},
      publishOutcome: async (publication) => {
        const outcomes = publication.outcomes ?? [publication.outcome]
        for (const outcome of outcomes) {
          await publish(outcome)
        }
        const tail = outcomes.at(-1)!
        await session.policyConsumer.acknowledge({
          version: 1,
          consumer: publication.consumer,
          namespace: publication.namespace,
          sequence: tail.sequence,
          outcomeId: tail.outcomeId
        })
      }
    }
  })
  session = admitted.session
  admissions.set(runtime, session)
  return runtime
}

function policyFor(
  runtime: TerminalSessionAuthorityHostRuntime
): TerminalAuthorityPolicyConsumerConnection {
  const session = admissions.get(runtime)
  if (!session) {
    throw new Error('test policy consumer is unavailable')
  }
  return session.policyConsumer
}

function admittedConsumer(
  runtime: TerminalSessionAuthorityHostRuntime
): Readonly<{ consumerId: string; consumerIncarnationId: string }> {
  const session = admissions.get(runtime)
  if (!session) {
    throw new Error('test policy consumer is unavailable')
  }
  return session.grant.consumer
}

// Why the claim repeats the active incarnation: it is the read-only handle the assertion needs, and an
// exact repeat of the live claim appends nothing.
async function testConsumer(
  runtime: TerminalSessionAuthorityHostRuntime,
  service: TerminalSessionAuthorityService
): ReturnType<typeof service.claimConsumer> {
  const consumer = admittedConsumer(runtime)
  return service.claimConsumer(service.writerAccess, {
    consumerId: consumer.consumerId,
    expectedIncarnationId: consumer.consumerIncarnationId,
    consumerIncarnationId: consumer.consumerIncarnationId
  })
}
