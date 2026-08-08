import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TerminalAuthorityNamespaceOutcomeBoundary } from '../../shared/terminal-session-authority-consumer-transport'
import { DaemonClient } from './client'
import { DaemonServer } from './daemon-server'
import { getDaemonSocketPath } from './daemon-spawner'
import { DaemonTerminalAuthorityAppHostTransport } from './daemon-terminal-authority-app-host-transport'
import {
  DAEMON_TERMINAL_AUTHORITY_CONSUMER_GRANT_REQUEST,
  DAEMON_TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_REQUEST
} from './daemon-terminal-authority-consumer-requests'
import { TerminalAuthorityAppOutcomeHostManager } from '../session-authority/terminal-authority-app-outcome-host-manager'
import {
  TerminalAuthorityAppOutcomeHostTransportSlot,
  type TerminalAuthorityAppOutcomeHostTransportLease
} from '../session-authority/terminal-authority-app-outcome-host-transport-slot'
import type { TerminalAuthorityAppOutcomeNamespaceConnection } from '../session-authority/terminal-authority-app-outcome-host-contract'
import { TerminalAuthorityAppProjectionStore } from '../session-authority/terminal-authority-app-projection-store'
import {
  createTerminalAuthorityProofEphemeralKeypair,
  terminalAuthorityHostAppConsumerId
} from '../session-authority/terminal-session-authority-consumer-proof'
import { TerminalSessionAuthorityPtyOwner } from '../session-authority/terminal-session-authority-pty-owner'
import { TerminalSessionAuthorityRegistry } from '../session-authority/terminal-session-authority-registry'
import type { TerminalSessionAuthorityService } from '../session-authority/terminal-session-authority-service'
import { terminalAuthorityWorkspaceLocator } from '../session-authority/terminal-session-authority-workspace-locator'

const resources: AuthorityHarness[] = []

afterEach(async () => {
  for (const harness of resources.splice(0)) {
    harness.manager?.dispose()
    harness.transportLease?.dispose()
    harness.store?.close()
    harness.client?.disconnect()
    harness.guardian.disconnect()
    await harness.server.shutdown()
    harness.owner.dispose()
    await harness.registry.close()
    rmSync(harness.directory, { recursive: true, force: true })
  }
})

describe('daemon authenticated terminal authority admission', () => {
  it('accepts the first boundary before grant and resumes the retained cursor after app restart', async () => {
    const harness = await startHarness()
    const keypair = createTerminalAuthorityProofEphemeralKeypair()
    const consumerId = terminalAuthorityHostAppConsumerId(
      harness.service.namespace.authorityHostId,
      keypair.publicKey
    )
    await connectApp(harness, keypair, 'app-process:first')

    expect(activeIncarnation(harness.service, consumerId)).toBe('app-process:first')
    expect(await consumerSnapshot(harness.service, consumerId, 'app-process:first')).toMatchObject({
      acknowledgedSequence: 0,
      outcomeHighWatermark: 0
    })

    harness.manager?.dispose()
    harness.manager = null
    harness.client?.disconnect()
    harness.client = null
    harness.store?.close()
    harness.store = null

    expect(activeIncarnation(harness.service, consumerId)).toBe('app-process:first')
    await connectApp(harness, keypair, 'app-process:second')

    expect(activeIncarnation(harness.service, consumerId)).toBe('app-process:second')
    expect(await consumerSnapshot(harness.service, consumerId, 'app-process:second')).toMatchObject(
      { acknowledgedSequence: 0, outcomeHighWatermark: 0 }
    )
  })

  it('rolls back a first claim when the app disconnects during boundary acceptance', async () => {
    const harness = await startHarness()
    const keypair = createTerminalAuthorityProofEphemeralKeypair()
    const consumerId = terminalAuthorityHostAppConsumerId(
      harness.service.namespace.authorityHostId,
      keypair.publicKey
    )
    const client = new DaemonClient({
      socketPath: harness.socketPath,
      tokenPath: harness.tokenPath,
      terminalSessionAuthorityConsumerProofReady: () => true
    })
    harness.client = client
    const host = await new DaemonTerminalAuthorityAppHostTransport({
      client,
      authenticatedAuthorityHostId: harness.service.namespace.authorityHostId,
      keypair
    }).connect({ onFailure: () => {} })
    const boundaryStarted = deferred<TerminalAuthorityNamespaceOutcomeBoundary>()
    const releaseBoundary = deferred<void>()
    let provisional: TerminalAuthorityAppOutcomeNamespaceConnection | null = null
    const opening = host.openNamespace(
      {
        namespace: harness.service.namespace,
        candidateProcessIncarnationId: 'app-process:disconnecting',
        candidateSessionNonce: 'app-session:disconnecting',
        requestId: 'app-request:disconnecting',
        intent: 'first'
      },
      {
        publishBoundary: async (boundary) => {
          boundaryStarted.resolve(boundary)
          await releaseBoundary.promise
          await provisional?.acceptBoundary(boundaryAcceptance(boundary))
        },
        publishOutcome: async () => {}
      },
      (connection) => {
        provisional = connection
      }
    )
    await within(boundaryStarted.promise, 3_000, () => 'boundary was not published')

    client.disconnect()
    releaseBoundary.resolve()

    await expect(within(opening, 3_000, () => 'opening did not settle')).rejects.toThrow()
    expect(activeIncarnation(harness.service, consumerId)).toBeNull()
  })

  it('keeps the handover claim durable when the app disconnects mid-claim', async () => {
    const harness = await startHarness()
    const keypair = createTerminalAuthorityProofEphemeralKeypair()
    await connectApp(harness, keypair, 'app-process:incumbent')
    const consumerId = terminalAuthorityHostAppConsumerId(
      harness.service.namespace.authorityHostId,
      keypair.publicKey
    )
    const candidateClient = new DaemonClient({
      socketPath: harness.socketPath,
      tokenPath: harness.tokenPath,
      terminalSessionAuthorityConsumerProofReady: () => true
    })
    const candidateStore = await TerminalAuthorityAppProjectionStore.open({
      directory: path.join(harness.directory, 'candidate-projection')
    })
    const candidateManager = new TerminalAuthorityAppOutcomeHostManager('app-process:candidate', {
      store: candidateStore,
      onProjection: () => {},
      onError: () => {},
      connectTimeoutMs: 1_000,
      acknowledgeTimeoutMs: 1_000
    })
    const candidateSlot = new TerminalAuthorityAppOutcomeHostTransportSlot(
      harness.service.namespace.authorityHostId
    )
    const candidateTransportLease = candidateSlot.install(
      new DaemonTerminalAuthorityAppHostTransport({
        client: candidateClient,
        authenticatedAuthorityHostId: harness.service.namespace.authorityHostId,
        keypair
      })
    )
    const candidateRegistration = candidateManager.installHost(candidateSlot)
    const commitConsumerAdmission = harness.service.commitConsumerAdmission.bind(harness.service)
    const claimReturned = deferred<void>()
    const releaseClaim = deferred<void>()
    const interleaving: string[] = []
    vi.spyOn(harness.service, 'commitConsumerAdmission').mockImplementation(
      async (writer, input, seal) => {
        const consumer = await commitConsumerAdmission(writer, input, seal)
        if (input.consumerIncarnationId === 'app-process:candidate') {
          interleaving.push('claim-returned')
          claimReturned.resolve()
          await releaseClaim.promise
          interleaving.push('claim-released')
        }
        return consumer
      }
    )

    try {
      const opening = candidateRegistration.resolveAndAdmitNamespace(harness.worktreeId)
      await within(claimReturned.promise, 3_000, () => 'candidate claim was not returned')
      expect(activeIncarnation(harness.service, consumerId)).toBe('app-process:candidate')

      const disconnected = deferred<void>()
      const candidateClientId = (candidateClient as unknown as { clientId: string }).clientId
      const releaseAuthenticatedPolicyTransport = (
        harness.server as unknown as {
          releaseAuthenticatedPolicyTransport(client: { clientId: string }): void
        }
      ).releaseAuthenticatedPolicyTransport.bind(harness.server)
      const releaseSpy = vi
        .spyOn(
          harness.server as unknown as {
            releaseAuthenticatedPolicyTransport(client: { clientId: string }): void
          },
          'releaseAuthenticatedPolicyTransport'
        )
        .mockImplementation((client: { clientId: string }) => {
          if (client.clientId === candidateClientId) {
            interleaving.push('transport-released')
            disconnected.resolve()
          }
          releaseAuthenticatedPolicyTransport(client)
        })
      candidateClient.disconnect()
      await within(disconnected.promise, 3_000, () => 'candidate disconnect was not observed')
      expect(interleaving).toEqual(['claim-returned', 'transport-released'])
      expect(activeIncarnation(harness.service, consumerId)).toBe('app-process:candidate')

      releaseClaim.resolve()
      await expect(
        within(opening, 3_000, () => 'candidate admission did not settle')
      ).rejects.toThrow()
      // The claim and its grant settled together, so the disconnect releases live state and leaves
      // the durable record on the candidate for a fresh proof to resume.
      expect(activeIncarnation(harness.service, consumerId)).toBe('app-process:candidate')
      expect(interleaving.slice(0, 3)).toEqual([
        'claim-returned',
        'transport-released',
        'claim-released'
      ])
      releaseSpy.mockRestore()
    } finally {
      releaseClaim.resolve()
      candidateManager.dispose()
      candidateTransportLease.dispose()
      candidateStore.close()
      candidateClient.disconnect()
    }
  })

  it('durably retires one authenticated namespace and replays its exact acknowledgement', async () => {
    const harness = await startHarness()
    const keypair = createTerminalAuthorityProofEphemeralKeypair()
    const consumerId = terminalAuthorityHostAppConsumerId(
      harness.service.namespace.authorityHostId,
      keypair.publicKey
    )
    const registration = await connectApp(harness, keypair, 'app-process:retiring')
    const request = Object.freeze({
      namespace: harness.service.namespace,
      candidateProcessIncarnationId: 'app-process:retiring',
      candidateSessionNonce: 'app-session:retiring',
      requestId: 'app-retirement:daemon-integration'
    })

    expect(harness.client?.terminalSessionAuthorityConsumerRetirementSupported()).toBe(true)
    await expect(registration.retireNamespace(request)).resolves.toMatchObject({
      consumerId,
      retired: true,
      alreadyAbsent: false,
      replayed: false
    })
    expect(activeIncarnation(harness.service, consumerId)).toBeNull()
    await expect(registration.retireNamespace(request)).resolves.toMatchObject({
      consumerId,
      retired: true,
      alreadyAbsent: false,
      replayed: true
    })
  })

  it('retries after a lost durable response without re-claiming on daemon reconnect', async () => {
    const harness = await startHarness()
    const keypair = createTerminalAuthorityProofEphemeralKeypair()
    const consumerId = terminalAuthorityHostAppConsumerId(
      harness.service.namespace.authorityHostId,
      keypair.publicKey
    )
    const registration = await connectApp(harness, keypair, 'app-process:lost-retirement')
    const client = harness.client!
    const originalRequest = client.request.bind(client)
    const requestTypes: string[] = []
    let loseResponse = true
    vi.spyOn(client, 'request').mockImplementation(async (type, payload, timeoutMs) => {
      const result = await originalRequest(type, payload, timeoutMs)
      requestTypes.push(type)
      if (type === DAEMON_TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_REQUEST && loseResponse) {
        loseResponse = false
        const socket = (
          client as unknown as { controlSocket: Readonly<{ destroy(): void }> | null }
        ).controlSocket
        socket?.destroy()
        throw new Error('daemon retirement response lost after durable append')
      }
      return result
    })
    const request = Object.freeze({
      namespace: harness.service.namespace,
      candidateProcessIncarnationId: 'app-process:lost-retirement',
      candidateSessionNonce: 'app-session:lost-retirement',
      requestId: 'app-retirement:lost-daemon-response'
    })

    await expect(registration.retireNamespace(request)).rejects.toThrow('response lost')
    expect(activeIncarnation(harness.service, consumerId)).toBeNull()
    await vi.waitFor(() => expect(client.isConnected()).toBe(false))
    await expect(registration.retireNamespace(request)).resolves.toMatchObject({
      consumerId,
      retired: true,
      alreadyAbsent: true,
      replayed: false
    })
    expect(activeIncarnation(harness.service, consumerId)).toBeNull()
    expect(requestTypes).not.toContain(DAEMON_TERMINAL_AUTHORITY_CONSUMER_GRANT_REQUEST)
  })
})

type AuthorityHarness = {
  directory: string
  worktreeId: string
  registry: TerminalSessionAuthorityRegistry
  owner: TerminalSessionAuthorityPtyOwner
  service: TerminalSessionAuthorityService
  server: DaemonServer
  socketPath: string
  tokenPath: string
  guardian: DaemonClient
  client: DaemonClient | null
  manager: TerminalAuthorityAppOutcomeHostManager | null
  store: TerminalAuthorityAppProjectionStore | null
  transportLease: TerminalAuthorityAppOutcomeHostTransportLease | null
}

async function startHarness(): Promise<AuthorityHarness> {
  const directory = mkdtempSync(path.join(tmpdir(), 'daemon-authority-admission-'))
  const authorityHostId = 'authority-host:daemon-admission-integration'
  const registry = await TerminalSessionAuthorityRegistry.open({
    directory: path.join(directory, 'authority'),
    authorityHostId,
    ownerToken: 'owner-token:daemon-admission-integration',
    ownerIncarnationId: 'owner-incarnation:daemon-admission-integration',
    writerActorId: 'writer:daemon-admission-integration'
  })
  const namespace = (await registry.resolveNamespace(terminalAuthorityWorkspaceLocator(directory)))
    .namespace
  const service = await registry.openNamespace(namespace)
  const owner = new TerminalSessionAuthorityPtyOwner({
    registry,
    ownerIncarnationId: 'owner-incarnation:daemon-admission-integration'
  })
  const socketPath = getDaemonSocketPath(directory)
  const tokenPath = path.join(directory, 'daemon.token')
  const server = new DaemonServer({
    socketPath,
    tokenPath,
    spawnSubprocess: () => {
      throw new Error('unexpected subprocess spawn')
    },
    terminalSessionAuthority: { authorityHostId, ptyOwner: owner },
    terminalSessionAuthorityCapabilityReadiness: {
      hostEffectConsumerInstalled: () => owner.hostEffectConsumerInstalled()
    }
  })
  await owner.start()
  await server.start()
  const guardian = new DaemonClient({ socketPath, tokenPath })
  await guardian.ensureConnected()
  const harness: AuthorityHarness = {
    directory,
    worktreeId: `repo::${directory}`,
    registry,
    owner,
    service,
    server,
    socketPath,
    tokenPath,
    guardian,
    client: null,
    manager: null,
    store: null,
    transportLease: null
  }
  resources.push(harness)
  return harness
}

async function connectApp(
  harness: AuthorityHarness,
  keypair: ReturnType<typeof createTerminalAuthorityProofEphemeralKeypair>,
  processIncarnationId: string
) {
  const client = new DaemonClient({
    socketPath: harness.socketPath,
    tokenPath: harness.tokenPath,
    terminalSessionAuthorityConsumerProofReady: () => true
  })
  const store = await TerminalAuthorityAppProjectionStore.open({
    directory: path.join(harness.directory, 'projection')
  })
  const errors: Error[] = []
  const manager = new TerminalAuthorityAppOutcomeHostManager(processIncarnationId, {
    store,
    onProjection: () => {},
    onError: (error) => errors.push(error),
    connectTimeoutMs: 1_000,
    acknowledgeTimeoutMs: 1_000
  })
  harness.transportLease?.dispose()
  const slot = new TerminalAuthorityAppOutcomeHostTransportSlot(
    harness.service.namespace.authorityHostId
  )
  const transportLease = slot.install(
    new DaemonTerminalAuthorityAppHostTransport({
      client,
      authenticatedAuthorityHostId: harness.service.namespace.authorityHostId,
      keypair
    })
  )
  const registration = manager.installHost(slot)
  harness.client = client
  harness.store = store
  harness.manager = manager
  harness.transportLease = transportLease
  await within(
    registration.resolveAndAdmitNamespace(harness.worktreeId),
    3_000,
    () => errors.map((error) => error.message).join(' | ') || 'no app outcome error'
  )
  return registration
}

function activeIncarnation(
  service: TerminalSessionAuthorityService,
  consumerId: string
): string | null {
  return service.activeConsumerIncarnation(service.writerAccess, consumerId)
}

function consumerSnapshot(
  service: TerminalSessionAuthorityService,
  consumerId: string,
  consumerIncarnationId: string
) {
  return service.snapshotForConsumer({
    role: 'consumer',
    serviceInstanceId: service.writerAccess.serviceInstanceId,
    consumerId,
    consumerIncarnationId
  })
}

function within<T>(pending: Promise<T>, timeoutMs: number, detail: () => string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`daemon authority admission timed out: ${detail()}`)),
      timeoutMs
    )
    void pending.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

function boundaryAcceptance(boundary: TerminalAuthorityNamespaceOutcomeBoundary) {
  if (!boundary.boundaryId) {
    throw new Error('daemon authority boundary identity is unavailable')
  }
  return {
    version: boundary.version,
    consumer: boundary.consumer,
    namespace: boundary.namespace,
    boundaryId: boundary.boundaryId,
    acknowledgedSequence: boundary.acknowledgedSequence,
    outcomeHighWatermark: boundary.outcomeHighWatermark
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}
