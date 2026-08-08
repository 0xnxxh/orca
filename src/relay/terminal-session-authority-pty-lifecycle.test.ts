import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TerminalSessionAuthorityRegistry } from '../main/session-authority/terminal-session-authority-registry'
import { terminalAuthorityWorkspaceLocator } from '../main/session-authority/terminal-session-authority-workspace-locator'
import {
  TERMINAL_SESSION_AUTHORITY_ATTACH_VERSION,
  TERMINAL_SESSION_AUTHORITY_SPAWN_VERSION
} from '../shared/terminal-session-authority-wire'
import { TerminalSessionAuthorityPtyLifecycle } from '../main/session-authority/terminal-session-authority-pty-lifecycle'
import type { TerminalSessionAuthorityService } from '../main/session-authority/terminal-session-authority-service'
import type { TerminalAuthorityDurableOutcome } from '../shared/terminal-session-authority-mutation'
import type { TerminalAuthorityPolicyConsumerConnection } from '../main/session-authority/terminal-session-authority-policy-consumers'
import {
  createTerminalAuthorityProofEphemeralKeypair,
  terminalAuthorityHostAppConsumerId
} from '../main/session-authority/terminal-session-authority-consumer-proof'
import { admitAuthenticatedPolicyConsumer } from '../main/session-authority/__tests__/authenticated-policy-consumer-admission'

// One app keypair for the whole file: the consumer id is derived from it, so every admission here
// resumes the same durable consumer exactly as one app process would across restarts.
const APP_KEYPAIR = createTerminalAuthorityProofEphemeralKeypair()
let nextAdmissionRequest = 0

const directories: string[] = []
const registries: TerminalSessionAuthorityRegistry[] = []
const children: ChildProcessWithoutNullStreams[] = []
const policyConnections = new WeakMap<
  TerminalSessionAuthorityPtyLifecycle,
  TerminalAuthorityPolicyConsumerConnection
>()
const registryRoots = new WeakMap<TerminalSessionAuthorityRegistry, string>()
const lifecycleRoots = new WeakMap<TerminalSessionAuthorityPtyLifecycle, string>()

function rememberLifecycleRoot(
  registry: TerminalSessionAuthorityRegistry,
  lifecycle: TerminalSessionAuthorityPtyLifecycle
): void {
  const root = registryRoots.get(registry)
  if (!root) {
    throw new Error('test registry root is unavailable')
  }
  lifecycleRoots.set(lifecycle, root)
}

async function namespaceForLifecycle(lifecycle: TerminalSessionAuthorityPtyLifecycle) {
  const root = lifecycleRoots.get(lifecycle)
  if (!root) {
    throw new Error('test lifecycle root is unavailable')
  }
  return await lifecycle.resolvePolicyConsumerNamespace(`repo::${root}`)
}
async function createLifecycle(
  registry: TerminalSessionAuthorityRegistry,
  ownerIncarnationId: string
): Promise<TerminalSessionAuthorityPtyLifecycle> {
  const lifecycle = new TerminalSessionAuthorityPtyLifecycle(registry, ownerIncarnationId)
  lifecycle.installHostEffectApplier({ ensureBindingRetired: async () => {} })
  rememberLifecycleRoot(registry, lifecycle)
  const admitted = await admitAuthenticatedPolicyConsumer(lifecycle, {
    namespace: await namespaceForLifecycle(lifecycle),
    appKeypair: APP_KEYPAIR,
    processIncarnationId: ownerIncarnationId,
    requestId: `lifecycle-request-${++nextAdmissionRequest}`
  })
  policyConnections.set(lifecycle, admitted.session.policyConsumer)
  return lifecycle
}

afterEach(async () => {
  await Promise.all(children.splice(0).map(stopChild))
  await Promise.allSettled(registries.splice(0).map((registry) => registry.close()))
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('TerminalSessionAuthorityPtyLifecycle', () => {
  it('prepares, commits, and adopts one exact PTY across operation and geometry retries', async () => {
    const root = freshDirectory()
    const registry = await openRegistry(root, 'owner-token-a', 'owner-a')
    const lifecycle = await createLifecycle(registry, 'owner-a')
    const params = spawnParams(root, 7)

    const prepared = await lifecycle.prepareSpawn(params, 'pty-1', policyFor(lifecycle))
    expect(prepared.kind).toBe('spawn')
    if (prepared.kind !== 'spawn') {
      throw new Error('expected a fresh allocation')
    }
    const managed = await lifecycle.commitSpawn(prepared, 'incarnation-1')
    expect(managed.binding).toEqual({
      ownerIncarnationId: 'owner-a',
      physicalPtyId: 'pty-1',
      ptyIncarnationId: 'incarnation-1'
    })

    const replay = await lifecycle.prepareSpawn(
      {
        ...params,
        cols: 132,
        rows: 44,
        agentSessionCreateOperationId: '1720000000000-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      },
      'pty-2',
      policyFor(lifecycle)
    )
    expect(replay).toMatchObject({ kind: 'adopt', binding: managed.binding })
  })

  it('records physical exit as a later outcome after an idempotent durable close', async () => {
    const root = freshDirectory()
    const registry = await openRegistry(root, 'owner-token-a', 'owner-a')
    const published: unknown[] = []
    const lifecycle = new TerminalSessionAuthorityPtyLifecycle(registry, 'owner-a')
    lifecycle.installHostEffectApplier({ ensureBindingRetired: async () => {} })
    rememberLifecycleRoot(registry, lifecycle)
    await connectTestPolicyConsumer(lifecycle, 'owner-a', async (outcome) => {
      published.push(outcome)
    })
    const prepared = await lifecycle.prepareSpawn(
      spawnParams(root, 1),
      'pty-1',
      policyFor(lifecycle)
    )
    if (prepared.kind !== 'spawn') {
      throw new Error('expected a fresh allocation')
    }
    const managed = await lifecycle.commitSpawn(prepared, 'incarnation-1')

    await lifecycle.closeExactPtyAccess(
      {
        namespace: managed.runtime.service.namespace,
        pane: managed.pane,
        binding: managed.binding
      },
      policyFor(lifecycle)
    )
    await lifecycle.closePty(managed, policyFor(lifecycle))
    expect(
      managed.runtime.service.bindingAuthority(
        managed.runtime.service.writerAccess,
        managed.pane,
        managed.binding
      )
    ).toBe('closed')

    await lifecycle.recordExit(managed, 137)
    await lifecycle.recordExit(managed, 137)
    expect(
      managed.runtime.service.bindingAuthority(
        managed.runtime.service.writerAccess,
        managed.pane,
        managed.binding
      )
    ).toBe('exited')
    await vi.waitFor(() =>
      expect(
        published.filter(
          (outcome) =>
            typeof outcome === 'object' &&
            outcome !== null &&
            'result' in outcome &&
            (outcome.result as { effects: { kind: string }[] }).effects.some(
              (effect) => effect.kind === 'terminal-exited'
            )
        )
      ).toHaveLength(1)
    )
  })

  it('never supersedes an owner-unreachable predecessor binding', async () => {
    const root = freshDirectory()
    const firstRegistry = await openRegistry(root, 'owner-token-a', 'owner-a')
    const first = await createLifecycle(firstRegistry, 'owner-a')
    const prepared = await first.prepareSpawn(spawnParams(root, 1), 'pty-1', policyFor(first))
    if (prepared.kind !== 'spawn') {
      throw new Error('expected a fresh allocation')
    }
    await first.commitSpawn(prepared, 'incarnation-1')
    await firstRegistry.close()

    const secondRegistry = await openRegistry(root, 'owner-token-b', 'owner-b')
    const second = await createLifecycle(secondRegistry, 'owner-b')
    await expect(
      second.prepareSpawn(spawnParams(root, 1), 'pty-2', policyFor(second))
    ).rejects.toMatchObject({
      code: 'writer-fenced'
    })
    await expect(
      second.prepareSpawn(spawnParams(root, 2), 'pty-2', policyFor(second))
    ).rejects.toMatchObject({
      code: 'writer-fenced'
    })
    const namespace = secondRegistry.namespaceForLocator(terminalAuthorityWorkspaceLocator(root))
    if (!namespace) {
      throw new Error('expected authority namespace')
    }
    const service = await secondRegistry.openNamespace(namespace)
    const observer = service.observe('supersede-observer')
    expect(service.snapshotForObserver(observer).panes).toMatchObject([
      {
        paneGenerationId: 'renderer:1',
        status: 'open',
        ownerStatus: 'owner-unreachable',
        binding: { physicalPtyId: 'pty-1', ptyIncarnationId: 'incarnation-1' }
      }
    ])
  })

  it('never cancels a predecessor pending allocation to admit a newer generation', async () => {
    const root = freshDirectory()
    const firstRegistry = await openRegistry(root, 'owner-token-a', 'owner-a')
    const first = await createLifecycle(firstRegistry, 'owner-a')
    expect(await first.prepareSpawn(spawnParams(root, 1), 'pty-1', policyFor(first))).toMatchObject(
      { kind: 'spawn' }
    )
    await firstRegistry.close()

    const secondRegistry = await openRegistry(root, 'owner-token-b', 'owner-b')
    const second = await createLifecycle(secondRegistry, 'owner-b')
    await expect(
      second.prepareSpawn(spawnParams(root, 2), 'pty-2', policyFor(second))
    ).rejects.toMatchObject({
      code: 'writer-fenced'
    })
  })

  it('keeps a legacy lease unknown when no durable namespace or binding exists', async () => {
    const root = freshDirectory()
    const registry = await openRegistry(root, 'owner-token-a', 'owner-a')
    // No consumer is admitted here on purpose: the probe must not register a namespace by itself.
    const lifecycle = new TerminalSessionAuthorityPtyLifecycle(registry, 'owner-a')
    lifecycle.installHostEffectApplier({ ensureBindingRetired: async () => {} })
    const params = attachParams(root, 'pty-legacy', 'incarnation-legacy', 1)

    expect(await lifecycle.missingPtyState(params, 'pty-legacy')).toEqual({ kind: 'unknown' })
    expect(registry.registeredNamespaces()).toHaveLength(0)

    await registry.resolveNamespace(terminalAuthorityWorkspaceLocator(root))
    expect(await lifecycle.missingPtyState(params, 'pty-legacy')).toEqual({ kind: 'unknown' })
  })

  it('returns the exact owner binding for a reachable missing PTY', async () => {
    const root = freshDirectory()
    const registry = await openRegistry(root, 'owner-token-a', 'owner-a')
    const lifecycle = await createLifecycle(registry, 'owner-a')
    const prepared = await lifecycle.prepareSpawn(
      spawnParams(root, 0),
      'pty-legacy',
      policyFor(lifecycle)
    )
    if (prepared.kind !== 'spawn') {
      throw new Error('expected a fresh allocation')
    }
    await lifecycle.commitSpawn(prepared, 'incarnation-legacy')

    await expect(
      lifecycle.missingPtyState(
        attachParams(root, 'pty-legacy', 'incarnation-legacy', 0),
        'pty-legacy'
      )
    ).resolves.toMatchObject({
      kind: 'reachable-record',
      pane: { paneKey: 'pane-a', paneGenerationId: 'renderer:0' },
      binding: {
        ownerIncarnationId: 'owner-a',
        physicalPtyId: 'pty-legacy',
        ptyIncarnationId: 'incarnation-legacy'
      }
    })
  })

  it('keeps an unreachable predecessor live until its owner publishes a causal exit', async () => {
    const root = freshDirectory()
    const firstRegistry = await openRegistry(root, 'owner-token-a', 'owner-a')
    const first = await createLifecycle(firstRegistry, 'owner-a')
    const prepared = await first.prepareSpawn(spawnParams(root, 1), 'pty-1', policyFor(first))
    if (prepared.kind !== 'spawn') {
      throw new Error('expected a fresh allocation')
    }
    await first.commitSpawn(prepared, 'incarnation-1')

    const replacementRegistry = await openRegistry(
      root,
      'owner-token-b',
      'owner-b',
      'owner-token-a'
    )
    const replacement = await createLifecycle(replacementRegistry, 'owner-b')
    expect(
      await replacement.missingPtyState(attachParams(root, 'pty-1', 'incarnation-1', 1), 'pty-1')
    ).toMatchObject({
      kind: 'unreachable-predecessor',
      pane: { paneGenerationId: 'renderer:1' },
      binding: { physicalPtyId: 'pty-1', ptyIncarnationId: 'incarnation-1' }
    })

    const namespace = replacementRegistry.namespaceForLocator(
      terminalAuthorityWorkspaceLocator(root)
    )
    if (!namespace) {
      throw new Error('expected authority namespace')
    }
    const service = await replacementRegistry.openNamespace(namespace)
    const observer = service.observe('test-observer')
    expect(service.snapshotForObserver(observer).panes).toMatchObject([
      {
        paneGenerationId: 'renderer:1',
        status: 'open',
        ownerStatus: 'owner-unreachable',
        binding: { physicalPtyId: 'pty-1', ptyIncarnationId: 'incarnation-1' }
      }
    ])
  })

  it('requires exact pane generation even when the binding is already retired', async () => {
    const root = freshDirectory()
    const registry = await openRegistry(root, 'owner-token-a', 'owner-a')
    const lifecycle = await createLifecycle(registry, 'owner-a')
    const prepared = await lifecycle.prepareSpawn(
      spawnParams(root, 1),
      'pty-1',
      policyFor(lifecycle)
    )
    if (prepared.kind !== 'spawn') {
      throw new Error('expected a fresh allocation')
    }
    const managed = await lifecycle.commitSpawn(prepared, 'incarnation-1')
    await lifecycle.recordExit(managed, 0)

    expect(
      await lifecycle.missingPtyState(attachParams(root, 'pty-1', 'incarnation-1'), 'pty-1')
    ).toEqual({ kind: 'unknown' })
    expect(
      await lifecycle.missingPtyState(attachParams(root, 'pty-1', 'incarnation-1', 1), 'pty-1')
    ).toEqual({ kind: 'retired' })
  })

  it('restores exact authority state after an abrupt child-process owner crash', async () => {
    const root = freshDirectory()
    const child = await startCrashOwner(root)
    children.push(child)
    const exited = once(child, 'exit')
    child.kill()
    await exited

    const registry = await openRegistry(root, 'owner-token-b', 'owner-b', 'owner-token-a')
    const lifecycle = await createLifecycle(registry, 'owner-b')
    expect(
      await lifecycle.missingPtyState(
        attachParams(root, 'pty-child', 'incarnation-child', 1),
        'pty-child'
      )
    ).toMatchObject({
      kind: 'unreachable-predecessor',
      pane: { paneGenerationId: 'renderer:1' },
      binding: { physicalPtyId: 'pty-child', ptyIncarnationId: 'incarnation-child' }
    })
  })

  it('keeps repeated binding reachability checks off the durable mutation path', async () => {
    const root = freshDirectory()
    const registry = await openRegistry(root, 'owner-token-a', 'owner-a')
    const lifecycle = await createLifecycle(registry, 'owner-a')
    const prepared = await lifecycle.prepareSpawn(
      spawnParams(root, 1),
      'pty-1',
      policyFor(lifecycle)
    )
    if (prepared.kind !== 'spawn') {
      throw new Error('expected a fresh allocation')
    }
    const managed = await lifecycle.commitSpawn(prepared, 'incarnation-1')
    const namespace = registry.namespaceForLocator(terminalAuthorityWorkspaceLocator(root))
    if (!namespace) {
      throw new Error('expected authority namespace')
    }
    const service = await registry.openNamespace(namespace)
    const observer = service.observe('performance-observer')
    const beforeRevision = service.snapshotForObserver(observer).revision

    for (let index = 0; index < 20_000; index++) {
      if (!lifecycle.bindingIsReachable(managed)) {
        throw new Error('binding unexpectedly became unreachable')
      }
    }

    expect(service.snapshotForObserver(observer).revision).toBe(beforeRevision)
  })

  it('keeps a rejected terminal outcome unacknowledged without rejecting durable exit', async () => {
    const root = freshDirectory()
    const registry = await openRegistry(root, 'owner-token-a', 'owner-a')
    let rejectExit = false
    const publishedExitSequences: number[] = []
    const lifecycle = new TerminalSessionAuthorityPtyLifecycle(registry, 'owner-a')
    lifecycle.installHostEffectApplier({ ensureBindingRetired: async () => {} })
    rememberLifecycleRoot(registry, lifecycle)
    const publish = async (outcome: TerminalAuthorityDurableOutcome): Promise<void> => {
      if (
        outcome.kind !== 'semantic' &&
        outcome.result.effects.some((effect) => effect.kind === 'terminal-exited')
      ) {
        if (rejectExit) {
          throw new Error('downstream unavailable')
        }
        publishedExitSequences.push(outcome.sequence)
      }
    }
    await connectTestPolicyConsumer(lifecycle, 'owner-a', publish)
    const prepared = await lifecycle.prepareSpawn(
      spawnParams(root, 1),
      'pty-1',
      policyFor(lifecycle)
    )
    if (prepared.kind !== 'spawn') {
      throw new Error('expected a fresh allocation')
    }
    const managed = await lifecycle.commitSpawn(prepared, 'incarnation-1')
    rejectExit = true

    await lifecycle.recordExit(managed, 0)
    let beforeRetry = await consumerSnapshot(managed.runtime.service, 'owner-a')
    await vi.waitFor(async () => {
      beforeRetry = await consumerSnapshot(managed.runtime.service, 'owner-a')
      expect(beforeRetry.acknowledgedSequence).toBeLessThan(beforeRetry.outcomeHighWatermark)
    })
    expect(beforeRetry.acknowledgedSequence).toBeLessThan(beforeRetry.outcomeHighWatermark)

    rejectExit = false
    await connectTestPolicyConsumer(lifecycle, 'owner-a', publish, managed.runtime.service)
    await vi.waitFor(async () => {
      const afterRetry = await consumerSnapshot(managed.runtime.service, 'owner-a')
      expect(afterRetry.acknowledgedSequence).toBe(afterRetry.outcomeHighWatermark)
    })
    expect(publishedExitSequences).toEqual([beforeRetry.outcomeHighWatermark])
  })

  it('replays an unacknowledged terminal outcome after authority restart', async () => {
    const root = freshDirectory()
    const firstRegistry = await openRegistry(root, 'owner-token-a', 'owner-a')
    const first = new TerminalSessionAuthorityPtyLifecycle(firstRegistry, 'owner-a')
    first.installHostEffectApplier({ ensureBindingRetired: async () => {} })
    rememberLifecycleRoot(firstRegistry, first)
    await connectTestPolicyConsumer(first, 'owner-a', async (outcome) => {
      if (
        outcome.kind !== 'semantic' &&
        outcome.result.effects.some((effect) => effect.kind === 'terminal-exited')
      ) {
        throw new Error('crash before downstream settlement')
      }
    })
    const prepared = await first.prepareSpawn(spawnParams(root, 1), 'pty-1', policyFor(first))
    if (prepared.kind !== 'spawn') {
      throw new Error('expected a fresh allocation')
    }
    const managed = await first.commitSpawn(prepared, 'incarnation-1')
    await first.recordExit(managed, 17)
    await vi.waitFor(async () => {
      const snapshot = await consumerSnapshot(managed.runtime.service, 'owner-a')
      expect(snapshot.acknowledgedSequence).toBeLessThan(snapshot.outcomeHighWatermark)
    })
    first.dispose()
    await firstRegistry.close()

    const replayed: number[] = []
    const secondRegistry = await openRegistry(root, 'owner-token-b', 'owner-b')
    const second = new TerminalSessionAuthorityPtyLifecycle(secondRegistry, 'owner-b')
    second.installHostEffectApplier({ ensureBindingRetired: async () => {} })
    rememberLifecycleRoot(secondRegistry, second)
    const namespace = secondRegistry.namespaceForLocator(terminalAuthorityWorkspaceLocator(root))
    if (!namespace) {
      throw new Error('expected authority namespace')
    }
    const secondService = await secondRegistry.openNamespace(namespace)
    await connectTestPolicyConsumer(
      second,
      'owner-b',
      async (outcome) => {
        if (
          outcome.kind !== 'semantic' &&
          outcome.result.effects.some((effect) => effect.kind === 'terminal-exited')
        ) {
          replayed.push(outcome.sequence)
        }
      },
      secondService
    )
    await second.missingPtyState(attachParams(root, 'pty-1', 'incarnation-1', 1), 'pty-1')
    await vi.waitFor(() => expect(replayed).toHaveLength(1))

    const snapshot = await consumerSnapshot(secondService, 'owner-b')
    expect(snapshot.acknowledgedSequence).toBe(snapshot.outcomeHighWatermark)
  })
})

async function connectTestPolicyConsumer(
  lifecycle: TerminalSessionAuthorityPtyLifecycle,
  incarnation: string,
  publish: (outcome: TerminalAuthorityDurableOutcome) => Promise<void>,
  service?: TerminalSessionAuthorityService
): Promise<TerminalAuthorityPolicyConsumerConnection> {
  let connection!: TerminalAuthorityPolicyConsumerConnection
  const admitted = await admitAuthenticatedPolicyConsumer(lifecycle, {
    namespace: service?.namespace ?? (await namespaceForLifecycle(lifecycle)),
    appKeypair: APP_KEYPAIR,
    processIncarnationId: incarnation,
    requestId: `lifecycle-request-${++nextAdmissionRequest}`,
    outcomeTransport: {
      publishBoundary: async () => {},
      publishOutcome: async (publication) => {
        const outcomes = publication.outcomes ?? [publication.outcome]
        for (const outcome of outcomes) {
          await publish(outcome)
        }
        const tail = outcomes.at(-1)!
        await connection.acknowledge({
          version: 1,
          consumer: publication.consumer,
          namespace: publication.namespace,
          sequence: tail.sequence,
          outcomeId: tail.outcomeId
        })
      }
    }
  })
  connection = admitted.session.policyConsumer
  policyConnections.set(lifecycle, connection)
  return connection
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

async function consumerSnapshot(
  service: TerminalSessionAuthorityService,
  incarnation: string
): ReturnType<TerminalSessionAuthorityService['snapshotForConsumer']> {
  const identity = testConsumerIdentity(incarnation)
  const consumer = await service.claimConsumer(service.writerAccess, {
    consumerId: identity.consumerId,
    expectedIncarnationId: identity.consumerIncarnationId,
    consumerIncarnationId: identity.consumerIncarnationId
  })
  return await service.snapshotForConsumer(consumer)
}

function testConsumerIdentity(incarnation: string) {
  return Object.freeze({
    consumerId: terminalAuthorityHostAppConsumerId('host-a', APP_KEYPAIR.publicKey),
    consumerIncarnationId: `app-process:${incarnation}`
  })
}

async function openRegistry(
  root: string,
  ownerToken: string,
  ownerIncarnationId: string,
  takeoverOwnerToken?: string
): Promise<TerminalSessionAuthorityRegistry> {
  const registry = await TerminalSessionAuthorityRegistry.open({
    directory: path.join(root, 'authority'),
    authorityHostId: 'host-a',
    ownerToken,
    ...(takeoverOwnerToken ? { takeoverOwnerToken } : {}),
    ownerIncarnationId,
    writerActorId: ownerIncarnationId
  })
  registries.push(registry)
  registryRoots.set(registry, root)
  return registry
}

function attachParams(
  workspacePath: string,
  physicalPtyId: string,
  ptyIncarnationId: string,
  paneGeneration?: number
): Record<string, unknown> {
  return {
    terminalSessionAuthorityAttachVersion: TERMINAL_SESSION_AUTHORITY_ATTACH_VERSION,
    expectedWorktreeId: `repo::${workspacePath}`,
    expectedPaneKey: 'pane-a',
    expectedPtyIncarnationId: ptyIncarnationId,
    ...(paneGeneration === undefined ? {} : { expectedPaneGeneration: paneGeneration }),
    id: physicalPtyId
  }
}

function spawnParams(workspacePath: string, paneGeneration: number): Record<string, unknown> {
  return {
    terminalSessionAuthorityVersion: TERMINAL_SESSION_AUTHORITY_SPAWN_VERSION,
    paneKey: 'pane-a',
    paneGeneration,
    worktreeId: `repo::${workspacePath}`,
    cols: 80,
    rows: 24,
    cwd: workspacePath,
    env: { TERM: 'xterm-256color' }
  }
}

function freshDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'orca-pty-authority-'))
  directories.push(directory)
  return directory
}

async function startCrashOwner(root: string): Promise<ChildProcessWithoutNullStreams> {
  const entry = path.join(root, 'authority-crash-owner.ts')
  const bundle = path.join(root, 'authority-crash-owner.cjs')
  const registryModule = path.resolve(
    'src/main/session-authority/terminal-session-authority-registry.ts'
  )
  const lifecycleModule = path.resolve(
    'src/main/session-authority/terminal-session-authority-pty-lifecycle.ts'
  )
  const admissionModule = path.resolve(
    'src/main/session-authority/__tests__/authenticated-policy-consumer-admission.ts'
  )
  writeFileSync(
    entry,
    `import path from 'node:path'
import { TerminalSessionAuthorityRegistry } from ${JSON.stringify(registryModule)}
import { TerminalSessionAuthorityPtyLifecycle } from ${JSON.stringify(lifecycleModule)}
import { admitAuthenticatedPolicyConsumer } from ${JSON.stringify(admissionModule)}
void (async () => {
  const root = process.argv[2]
  const registry = await TerminalSessionAuthorityRegistry.open({
    directory: path.join(root, 'authority'), authorityHostId: 'host-a',
    ownerToken: 'owner-token-a', ownerIncarnationId: 'owner-a', writerActorId: 'owner-a'
  })
  const lifecycle = new TerminalSessionAuthorityPtyLifecycle(registry, 'owner-a')
  lifecycle.installHostEffectApplier({ ensureBindingRetired: async () => {} })
  const admitted = await admitAuthenticatedPolicyConsumer(lifecycle, {
    namespace: await lifecycle.resolvePolicyConsumerNamespace('repo::' + root),
    processIncarnationId: 'crash-test',
    requestId: 'crash-request'
  })
  const connection = admitted.session.policyConsumer
  const prepared = await lifecycle.prepareSpawn({
    terminalSessionAuthorityVersion: 1, paneKey: 'pane-a', paneGeneration: 1,
    worktreeId: 'repo::' + root, cols: 80, rows: 24, cwd: root, env: { TERM: 'xterm' }
  }, 'pty-child', connection)
  if (prepared.kind !== 'spawn') throw new Error('expected spawn')
  await lifecycle.commitSpawn(prepared, 'incarnation-child')
  process.stdout.write('READY\\n')
  setInterval(() => {}, 1_000)
})().catch((error) => {
  process.stderr.write(String(error) + String.fromCharCode(10))
  process.exit(1)
})
`,
    'utf8'
  )
  await build({ entryPoints: [entry], outfile: bundle, bundle: true, platform: 'node' })
  const child = spawn(process.execPath, [bundle, root], { stdio: ['pipe', 'pipe', 'pipe'] })
  await waitForReady(child)
  return child
}

function waitForReady(child: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolve, reject) => {
    let output = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      output += chunk
      if (output.includes('READY\n')) {
        resolve()
      }
    })
    child.once('exit', (code) => reject(new Error(`authority child exited before ready: ${code}`)))
  })
}

async function stopChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return
  }
  const exited = once(child, 'exit')
  child.kill()
  await exited
}
