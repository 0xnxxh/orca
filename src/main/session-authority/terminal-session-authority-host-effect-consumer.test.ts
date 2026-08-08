import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TerminalSessionAuthorityPtyAccess } from '../../shared/terminal-session-authority-pty-access'
import { TERMINAL_SESSION_AUTHORITY_SPAWN_VERSION } from '../../shared/terminal-session-authority-wire'
import { terminalAuthorityOperationIdentity } from '../../shared/terminal-session-authority-operation-identity'
import {
  TerminalSessionAuthorityHostEffectConsumer,
  terminalAuthorityHostEffectConsumerId
} from './terminal-session-authority-host-effect-consumer'
import { TerminalSessionAuthorityHostEffectApplierSlot } from './terminal-session-authority-host-effect-applier'
import { TerminalSessionAuthorityPtyLifecycle } from './terminal-session-authority-pty-lifecycle'
import { TerminalSessionAuthorityRegistry } from './terminal-session-authority-registry'
import { terminalAuthorityWorkspaceLocator } from './terminal-session-authority-workspace-locator'
import type { TerminalAuthorityPolicyConsumerConnection } from './terminal-session-authority-policy-consumers'
import { createTerminalAuthorityProofEphemeralKeypair } from './terminal-session-authority-consumer-proof'
import { admitAuthenticatedPolicyConsumer } from './__tests__/authenticated-policy-consumer-admission'

const directories: string[] = []
const registries: TerminalSessionAuthorityRegistry[] = []
const policyConnections = new WeakMap<
  TerminalSessionAuthorityPtyLifecycle,
  TerminalAuthorityPolicyConsumerConnection
>()
const registryRoots = new WeakMap<TerminalSessionAuthorityRegistry, string>()

afterEach(async () => {
  await Promise.allSettled(registries.splice(0).map((registry) => registry.close()))
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('TerminalSessionAuthorityHostEffectConsumer', () => {
  it('replays a durable binding retirement after authority restart', async () => {
    const root = freshDirectory()
    const firstRegistry = await openRegistry(root, 'owner-token-a', 'owner-a')
    const first = await lifecycle(firstRegistry, 'owner-a')
    const failedAttempts: TerminalSessionAuthorityPtyAccess[] = []
    first.installHostEffectApplier({
      ensureBindingRetired: async (access) => {
        failedAttempts.push(access)
        throw new Error('lost physical shutdown response')
      }
    })
    const managed = await spawnManaged(first, root)
    await first.closePty(managed, policyFor(first))
    await vi.waitFor(() => expect(failedAttempts).toHaveLength(1))
    await firstRegistry.close()

    const secondRegistry = await openRegistry(root, 'owner-token-b', 'owner-b')
    const second = await lifecycle(secondRegistry, 'owner-b', 'owner-a')
    const replayed: Readonly<{ access: TerminalSessionAuthorityPtyAccess; reason: string }>[] = []
    second.installHostEffectApplier({
      ensureBindingRetired: async (access, reason) => void replayed.push({ access, reason })
    })
    await second.start()
    await vi.waitFor(() => expect(replayed).toHaveLength(1))

    expect(replayed[0]).toEqual({
      access: failedAttempts[0],
      reason: 'close'
    })
    await expectHostEffectsCaughtUp(secondRegistry, root, 'owner-b')
  })

  it('serializes concurrent retries and ACKs only after an accepted exact shutdown', async () => {
    const root = freshDirectory()
    const registry = await openRegistry(root, 'owner-token-a', 'owner-a')
    const authority = await lifecycle(registry, 'owner-a')
    const attempts: TerminalSessionAuthorityPtyAccess[] = []
    let active = 0
    let maximumActive = 0
    let releaseFirst!: () => void
    const firstAttempt = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    authority.installHostEffectApplier({
      ensureBindingRetired: async (access) => {
        attempts.push(access)
        active += 1
        maximumActive = Math.max(maximumActive, active)
        if (attempts.length === 1) {
          await firstAttempt
          active -= 1
          throw new Error('shutdown accepted but response was lost')
        }
        active -= 1
      }
    })
    const managed = await spawnManaged(authority, root)
    await authority.closePty(managed, policyFor(authority))
    await vi.waitFor(() => expect(attempts).toHaveLength(1))

    authority.requestHostEffectDelivery()
    authority.requestHostEffectDelivery()
    authority.requestHostEffectDelivery()
    releaseFirst()
    await vi.waitFor(() => expect(attempts).toHaveLength(2))

    expect(maximumActive).toBe(1)
    expect(attempts[1]).toEqual(attempts[0])
    await expectHostEffectsCaughtUp(registry, root, 'owner-a')
  })

  it('cumulatively ACKs one replay page only after every effect settles', async () => {
    const root = freshDirectory()
    const registry = await openRegistry(root, 'owner-token-a', 'owner-a')
    const namespace = (await registry.resolveNamespace(terminalAuthorityWorkspaceLocator(root)))
      .namespace
    const service = await registry.openNamespace(namespace)
    const consumerId = terminalAuthorityHostEffectConsumerId('host-a')
    await service.claimConsumer(service.writerAccess, {
      consumerId,
      expectedIncarnationId: null,
      consumerIncarnationId: 'owner-a'
    })
    for (let index = 0; index < 12; index += 1) {
      const revision = service.snapshotForWriter(service.writerAccess).revision
      await service.mutate(service.writerAccess, {
        actorId: service.writerAccess.actorId,
        ...terminalAuthorityOperationIdentity(revision, `page-outcome-${index}`),
        baseRevision: revision,
        change: {
          kind: 'create',
          pane: {
            paneKey: `pane-${index}`,
            paneGenerationId: `generation-${index}`
          }
        }
      })
    }
    const acknowledgements = vi.spyOn(service, 'acknowledgeOutcomes')
    const applier = new TerminalSessionAuthorityHostEffectApplierSlot()
    applier.install({ ensureBindingRetired: async () => {} })
    const effects = new TerminalSessionAuthorityHostEffectConsumer(registry, 'owner-a', applier)
    await effects.start()
    await vi.waitFor(async () => {
      const consumer = await service.claimConsumer(service.writerAccess, {
        consumerId,
        expectedIncarnationId: 'owner-a',
        consumerIncarnationId: 'owner-a'
      })
      expect((await service.snapshotForConsumer(consumer)).acknowledgedSequence).toBe(12)
    })
    expect(acknowledgements).toHaveBeenCalledTimes(1)
    expect(acknowledgements.mock.calls[0]?.[1]).toBe(12)
    effects.dispose()
  })
})

// The app keypair is the consumer identity, so restarts reuse it to resume the same durable consumer.
const appKeypair = createTerminalAuthorityProofEphemeralKeypair()

async function lifecycle(
  registry: TerminalSessionAuthorityRegistry,
  ownerIncarnationId: string,
  expectedOwnerIncarnationId: string | null = null
): Promise<TerminalSessionAuthorityPtyLifecycle> {
  const lifecycle = new TerminalSessionAuthorityPtyLifecycle(registry, ownerIncarnationId)
  const root = registryRoots.get(registry)
  if (!root) {
    throw new Error('test registry root is unavailable')
  }
  const admitted = await admitAuthenticatedPolicyConsumer(lifecycle, {
    namespace: await lifecycle.resolvePolicyConsumerNamespace(`repo::${root}`),
    appKeypair,
    processIncarnationId: ownerIncarnationId,
    requestId: `request-${ownerIncarnationId}`,
    intent: expectedOwnerIncarnationId === null ? 'first' : 'resume'
  })
  policyConnections.set(lifecycle, admitted.session.policyConsumer)
  return lifecycle
}

async function spawnManaged(lifecycle: TerminalSessionAuthorityPtyLifecycle, root: string) {
  const prepared = await lifecycle.prepareSpawn(spawnParams(root), 'pty-1', policyFor(lifecycle))
  if (prepared.kind !== 'spawn') {
    throw new Error('expected a fresh allocation')
  }
  return await lifecycle.commitSpawn(prepared, 'incarnation-1')
}

function policyFor(
  lifecycle: TerminalSessionAuthorityPtyLifecycle
): TerminalAuthorityPolicyConsumerConnection {
  const connection = policyConnections.get(lifecycle)
  if (!connection) {
    throw new Error('test policy consumer is unavailable')
  }
  return connection
}

async function expectHostEffectsCaughtUp(
  registry: TerminalSessionAuthorityRegistry,
  root: string,
  consumerIncarnationId: string
): Promise<void> {
  const namespace = registry.namespaceForLocator(terminalAuthorityWorkspaceLocator(root))
  if (!namespace) {
    throw new Error('expected authority namespace')
  }
  const service = await registry.openNamespace(namespace)
  const consumer = await service.claimConsumer(service.writerAccess, {
    consumerId: terminalAuthorityHostEffectConsumerId('host-a'),
    expectedIncarnationId: consumerIncarnationId,
    consumerIncarnationId
  })
  await vi.waitFor(async () => {
    const snapshot = await service.snapshotForConsumer(consumer)
    expect(snapshot.acknowledgedSequence).toBe(snapshot.outcomeHighWatermark)
  })
}

async function openRegistry(
  root: string,
  ownerToken: string,
  ownerIncarnationId: string
): Promise<TerminalSessionAuthorityRegistry> {
  const registry = await TerminalSessionAuthorityRegistry.open({
    directory: path.join(root, 'authority'),
    authorityHostId: 'host-a',
    ownerToken,
    ownerIncarnationId,
    writerActorId: ownerIncarnationId
  })
  registries.push(registry)
  registryRoots.set(registry, root)
  return registry
}

function spawnParams(root: string): Record<string, unknown> {
  return {
    terminalSessionAuthorityVersion: TERMINAL_SESSION_AUTHORITY_SPAWN_VERSION,
    paneKey: 'pane-a',
    paneGeneration: 1,
    worktreeId: `repo::${root}`,
    cols: 80,
    rows: 24,
    cwd: root,
    env: { TERM: 'xterm-256color' }
  }
}

function freshDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'orca-host-effect-consumer-'))
  directories.push(directory)
  return directory
}
