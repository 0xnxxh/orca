import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TERMINAL_AUTHORITY_CONSUMER_PROOF_CAPABILITY } from '../../shared/terminal-session-authority-consumer-proof'
import {
  TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_ALGORITHM,
  TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_VERSION,
  type TerminalAuthorityConsumerRetirementStart
} from '../../shared/terminal-session-authority-consumer-retirement'
import type { TerminalAuthorityNamespace } from '../../shared/terminal-session-authority-identity'
import type { TerminalAuthorityAuthenticatedConsumerTransport } from './terminal-session-authority-consumer-admission'
import type { TerminalAuthorityAdmissionLiveGrant } from './terminal-session-authority-consumer-admission-state'
import {
  createTerminalAuthorityConsumerRetirementProof,
  createTerminalAuthorityProofEphemeralKeypair,
  terminalAuthorityHostAppConsumerId,
  type TerminalAuthorityConsumerProofKeypair
} from './terminal-session-authority-consumer-proof'
import { TerminalSessionAuthorityConsumerRetirements } from './terminal-session-authority-consumer-retirement'
import { TerminalSessionAuthorityConsumerRetirementState } from './terminal-session-authority-consumer-retirement-state'
import { TerminalSessionAuthorityRegistry } from './terminal-session-authority-registry'
import type { TerminalSessionAuthorityService } from './terminal-session-authority-service'
import {
  terminalAuthorityFloatingLocator,
  terminalAuthorityWorkspaceLocator
} from './terminal-session-authority-workspace-locator'

const HOST_ID = 'authority-host:consumer-retirement-test'
const directories: string[] = []
const registries: TerminalSessionAuthorityRegistry[] = []

afterEach(async () => {
  await Promise.allSettled(registries.splice(0).map((registry) => registry.close()))
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('TerminalSessionAuthorityConsumerRetirements', () => {
  it('durably retires a live grant and replays the exact result after a lost response', async () => {
    const harness = await oneNamespace()
    const app = createTerminalAuthorityProofEphemeralKeypair()
    const transport = authenticatedTransport('connection-grant:a')
    const consumerId = await claim(harness.service, app, 'app-process:first')
    const liveGrant = admissionGrant(transport, 'app-process:first')
    const start = retirementStart(harness.service.namespace, app, 'retire-request:a')
    const challenge = harness.retirements.issueChallenge(
      harness.service,
      start,
      transport,
      liveGrant
    )
    expect(challenge.liveAdmission).toEqual({
      requestId: liveGrant.requestId,
      processIncarnationId: liveGrant.processIncarnationId,
      sessionNonce: liveGrant.sessionNonce
    })
    const proof = createTerminalAuthorityConsumerRetirementProof(challenge, app)
    const first = await harness.retirements.complete(harness.service, proof, transport, liveGrant)

    expect(first).toMatchObject({ retired: true, alreadyAbsent: false, replayed: false })
    expect(
      harness.service.activeConsumerIncarnation(harness.service.writerAccess, consumerId)
    ).toBeNull()
    expect(harness.retirements.issueChallenge(harness.service, start, transport, null)).toBe(
      challenge
    )
    await expect(
      harness.retirements.complete(harness.service, proof, transport, null)
    ).resolves.toEqual({ ...first, replayed: true })
  })

  it('keeps the consumer and exact challenge when durability fails before append', async () => {
    const harness = await oneNamespace()
    const app = createTerminalAuthorityProofEphemeralKeypair()
    const transport = authenticatedTransport('connection-grant:a')
    const consumerId = await claim(harness.service, app, 'app-process:first')
    const start = retirementStart(harness.service.namespace, app, 'retire-request:a')
    const challenge = harness.retirements.issueChallenge(harness.service, start, transport, null)
    const proof = createTerminalAuthorityConsumerRetirementProof(challenge, app)
    const retire = vi.spyOn(harness.service, 'retireConsumerIdentity')
    retire.mockRejectedValueOnce(new Error('append failed'))

    await expect(
      harness.retirements.complete(harness.service, proof, transport, null)
    ).rejects.toThrow('append failed')
    expect(
      harness.service.activeConsumerIncarnation(harness.service.writerAccess, consumerId)
    ).toBe('app-process:first')
    expect(harness.retirements.issueChallenge(harness.service, start, transport, null)).toBe(
      challenge
    )
    retire.mockRestore()
    await expect(
      harness.retirements.complete(harness.service, proof, transport, null)
    ).resolves.toMatchObject({ retired: true, alreadyAbsent: false })
  })

  it('rejects a challenge at its exact expiry boundary', async () => {
    let now = 1_000
    const harness = await oneNamespace(() => now)
    const app = createTerminalAuthorityProofEphemeralKeypair()
    const transport = authenticatedTransport('connection-grant:a')
    const consumerId = await claim(harness.service, app, 'app-process:first')
    const start = retirementStart(harness.service.namespace, app, 'retire-request:expiry')
    const challenge = harness.retirements.issueChallenge(harness.service, start, transport, null)

    now = challenge.expiresAtMs
    await expect(
      harness.retirements.complete(
        harness.service,
        createTerminalAuthorityConsumerRetirementProof(challenge, app),
        transport,
        null
      )
    ).rejects.toThrow('stale')
    expect(
      harness.service.activeConsumerIncarnation(harness.service.writerAccess, consumerId)
    ).toBe('app-process:first')
  })

  it('serializes concurrent duplicates into one durable retirement and one replay', async () => {
    const harness = await oneNamespace()
    const app = createTerminalAuthorityProofEphemeralKeypair()
    const transport = authenticatedTransport('connection-grant:a')
    await claim(harness.service, app, 'app-process:first')
    const start = retirementStart(harness.service.namespace, app, 'retire-request:duplicate')
    const challenge = harness.retirements.issueChallenge(harness.service, start, transport, null)
    const proof = createTerminalAuthorityConsumerRetirementProof(challenge, app)
    const entered = deferred<void>()
    const release = deferred<void>()
    const original = harness.service.retireConsumerIdentity.bind(harness.service)
    const retire = vi
      .spyOn(harness.service, 'retireConsumerIdentity')
      .mockImplementation(async (...args) => {
        entered.resolve()
        await release.promise
        return await original(...args)
      })

    const first = harness.retirements.complete(harness.service, proof, transport, null)
    await entered.promise
    const duplicate = harness.retirements.complete(harness.service, proof, transport, null)
    release.resolve()

    await expect(first).resolves.toMatchObject({ replayed: false })
    await expect(duplicate).resolves.toMatchObject({ replayed: true })
    expect(retire).toHaveBeenCalledOnce()
  })

  it('does not retain a replay when its transport is released during durability', async () => {
    const harness = await oneNamespace()
    const app = createTerminalAuthorityProofEphemeralKeypair()
    const transport = authenticatedTransport('connection-grant:a')
    const consumerId = await claim(harness.service, app, 'app-process:first')
    const start = retirementStart(harness.service.namespace, app, 'retire-request:release')
    const challenge = harness.retirements.issueChallenge(harness.service, start, transport, null)
    const entered = deferred<void>()
    const release = deferred<void>()
    const original = harness.service.retireConsumerIdentity.bind(harness.service)
    vi.spyOn(harness.service, 'retireConsumerIdentity').mockImplementation(async (...args) => {
      entered.resolve()
      await release.promise
      return await original(...args)
    })

    const completion = harness.retirements.complete(
      harness.service,
      createTerminalAuthorityConsumerRetirementProof(challenge, app),
      transport,
      null
    )
    await entered.promise
    harness.retirements.releaseTransport(transport.token)
    release.resolve()

    await expect(completion).resolves.toMatchObject({ retired: true, replayed: false })
    expect(
      harness.service.activeConsumerIncarnation(harness.service.writerAccess, consumerId)
    ).toBeNull()
    expect(harness.retirements.issueChallenge(harness.service, start, transport, null)).not.toBe(
      challenge
    )
  })

  it('reserves retry capacity until an in-flight released transport settles', async () => {
    const harness = await oneNamespace()
    const app = createTerminalAuthorityProofEphemeralKeypair()
    const transport = authenticatedTransport('connection-grant:reserved')
    const start = retirementStart(harness.service.namespace, app, 'retire-request:reserved')
    const challenge = harness.retirements.issueChallenge(harness.service, start, transport, null)
    const state = new TerminalSessionAuthorityConsumerRetirementState()
    state.rememberChallenge('reserved', {
      challenge,
      startDigest: 'digest:reserved',
      secretKey: new Uint8Array(32),
      transportToken: transport.token,
      scopeKey: 'scope:reserved'
    })
    const reservation = state.reserveReplay('reserved', transport.token)
    state.releaseTransport(transport.token)
    for (let index = 0; index < 1_023; index += 1) {
      state.rememberChallenge(`fill:${index}`, {
        challenge,
        startDigest: `digest:${index}`,
        secretKey: new Uint8Array(32),
        transportToken: Object.freeze({}),
        scopeKey: `scope:${index}`
      })
    }

    expect(() =>
      state.rememberChallenge('overflow', {
        challenge,
        startDigest: 'digest:overflow',
        secretKey: new Uint8Array(32),
        transportToken: Object.freeze({}),
        scopeKey: 'scope:overflow'
      })
    ).toThrow('retry capacity')
    state.releaseReplayReservation('reserved', reservation)
    expect(() =>
      state.rememberChallenge('released-slot', {
        challenge,
        startDigest: 'digest:released-slot',
        secretKey: new Uint8Array(32),
        transportToken: Object.freeze({}),
        scopeKey: 'scope:released-slot'
      })
    ).not.toThrow()
  })

  it('rejects changed proof, transport, and live admission without retiring', async () => {
    const harness = await oneNamespace()
    const app = createTerminalAuthorityProofEphemeralKeypair()
    const transport = authenticatedTransport('connection-grant:a')
    const consumerId = await claim(harness.service, app, 'app-process:first')
    const liveGrant = admissionGrant(transport, 'app-process:first')
    const start = retirementStart(harness.service.namespace, app, 'retire-request:a')
    const challenge = harness.retirements.issueChallenge(
      harness.service,
      start,
      transport,
      liveGrant
    )
    const proof = createTerminalAuthorityConsumerRetirementProof(challenge, app)

    await expect(
      harness.retirements.complete(harness.service, proof, { ...transport, token: {} }, liveGrant)
    ).rejects.toThrow('transport changed')
    await expect(
      harness.retirements.complete(harness.service, proof, transport, null)
    ).rejects.toThrow('live admission changed')
    await expect(
      harness.retirements.complete(
        harness.service,
        { ...proof, proofMacB64: Buffer.alloc(32, 7).toString('base64') },
        transport,
        liveGrant
      )
    ).rejects.toThrow('proof was rejected')
    expect(
      harness.service.activeConsumerIncarnation(harness.service.writerAccess, consumerId)
    ).toBe('app-process:first')
  })

  it('retires one namespace without advancing or removing another namespace', async () => {
    const harness = await twoNamespaces()
    const app = createTerminalAuthorityProofEphemeralKeypair()
    const transport = authenticatedTransport('connection-grant:a')
    const consumerId = await claim(harness.first, app, 'app-process:first')
    await claim(harness.second, app, 'app-process:first')
    const start = retirementStart(harness.first.namespace, app, 'retire-request:first')
    const challenge = harness.retirements.issueChallenge(harness.first, start, transport, null)

    await harness.retirements.complete(
      harness.first,
      createTerminalAuthorityConsumerRetirementProof(challenge, app),
      transport,
      null
    )

    expect(
      harness.first.activeConsumerIncarnation(harness.first.writerAccess, consumerId)
    ).toBeNull()
    expect(harness.second.activeConsumerIncarnation(harness.second.writerAccess, consumerId)).toBe(
      'app-process:first'
    )
    expect(() =>
      harness.retirements.issueChallenge(
        harness.second,
        {
          ...retirementStart(harness.second.namespace, app, 'retire-request:second'),
          namespace: harness.first.namespace
        },
        transport,
        null
      )
    ).toThrow('targets another namespace')
  })

  it('authenticates durable absence after restart without re-claiming the consumer', async () => {
    const directory = freshDirectory()
    let registry = await openRegistry(directory)
    const namespace = (
      await registry.resolveNamespace(terminalAuthorityWorkspaceLocator(directory))
    ).namespace
    let service = await registry.openNamespace(namespace)
    const app = createTerminalAuthorityProofEphemeralKeypair()
    const transport = authenticatedTransport('connection-grant:first')
    const consumerId = await claim(service, app, 'app-process:first')
    const retirements = new TerminalSessionAuthorityConsumerRetirements(HOST_ID)
    const firstStart = retirementStart(namespace, app, 'retire-request:first')
    const firstChallenge = retirements.issueChallenge(service, firstStart, transport, null)
    await retirements.complete(
      service,
      createTerminalAuthorityConsumerRetirementProof(firstChallenge, app),
      transport,
      null
    )
    await registry.close()
    registries.splice(registries.indexOf(registry), 1)

    registry = await openRegistry(directory)
    service = await registry.openNamespace(namespace)
    const resumedTransport = authenticatedTransport('connection-grant:resumed')
    const resumedRetirements = new TerminalSessionAuthorityConsumerRetirements(HOST_ID)
    const resumedStart = retirementStart(namespace, app, 'retire-request:resumed')
    const resumedChallenge = resumedRetirements.issueChallenge(
      service,
      resumedStart,
      resumedTransport,
      null
    )
    expect(resumedChallenge.currentConsumerIncarnationId).toBeNull()
    await expect(
      resumedRetirements.complete(
        service,
        createTerminalAuthorityConsumerRetirementProof(resumedChallenge, app),
        resumedTransport,
        null
      )
    ).resolves.toMatchObject({ retired: true, alreadyAbsent: true, replayed: false })
    expect(service.activeConsumerIncarnation(service.writerAccess, consumerId)).toBeNull()
  })
})

async function oneNamespace(now: () => number = Date.now) {
  const directory = freshDirectory()
  const registry = await openRegistry(directory)
  const namespace = (await registry.resolveNamespace(terminalAuthorityWorkspaceLocator(directory)))
    .namespace
  return {
    retirements: new TerminalSessionAuthorityConsumerRetirements(HOST_ID, now),
    service: await registry.openNamespace(namespace)
  }
}

async function twoNamespaces() {
  const directory = freshDirectory()
  const registry = await openRegistry(directory)
  const firstNamespace = (
    await registry.resolveNamespace(terminalAuthorityWorkspaceLocator(directory))
  ).namespace
  const secondNamespace = (await registry.resolveNamespace(terminalAuthorityFloatingLocator()))
    .namespace
  return {
    retirements: new TerminalSessionAuthorityConsumerRetirements(HOST_ID),
    first: await registry.openNamespace(firstNamespace),
    second: await registry.openNamespace(secondNamespace)
  }
}

async function claim(
  service: TerminalSessionAuthorityService,
  app: TerminalAuthorityConsumerProofKeypair,
  incarnationId: string
): Promise<string> {
  const consumerId = terminalAuthorityHostAppConsumerId(HOST_ID, app.publicKey)
  await service.claimConsumer(service.writerAccess, {
    consumerId,
    expectedIncarnationId: null,
    consumerIncarnationId: incarnationId
  })
  return consumerId
}

function retirementStart(
  namespace: TerminalAuthorityNamespace,
  app: TerminalAuthorityConsumerProofKeypair,
  requestId: string
): TerminalAuthorityConsumerRetirementStart {
  return Object.freeze({
    version: TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_VERSION,
    algorithm: TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_ALGORITHM,
    namespace,
    appPublicKeyB64: Buffer.from(app.publicKey).toString('base64'),
    candidateProcessIncarnationId: 'app-process:retirement',
    candidateSessionNonce: 'app-session:retirement',
    requestId
  })
}

function admissionGrant(
  transport: TerminalAuthorityAuthenticatedConsumerTransport,
  processIncarnationId: string
): TerminalAuthorityAdmissionLiveGrant {
  return Object.freeze({
    connectionGrantId: transport.connectionGrantId,
    requestId: 'admission-request:first',
    processIncarnationId,
    sessionNonce: 'admission-session:first',
    transportToken: transport.token,
    requestKey: 'admission-request-key:first'
  })
}

function authenticatedTransport(
  connectionGrantId: string
): TerminalAuthorityAuthenticatedConsumerTransport {
  return Object.freeze({
    connectionGrantId,
    principal: 'daemon-token:test',
    capability: TERMINAL_AUTHORITY_CONSUMER_PROOF_CAPABILITY,
    token: Object.freeze({})
  })
}

async function openRegistry(directory: string): Promise<TerminalSessionAuthorityRegistry> {
  const registry = await TerminalSessionAuthorityRegistry.open({
    directory: path.join(directory, 'authority'),
    authorityHostId: HOST_ID,
    ownerToken: 'owner-token-consumer-retirement-test',
    ownerIncarnationId: 'owner-incarnation-consumer-retirement-test',
    writerActorId: 'writer-consumer-retirement-test'
  })
  registries.push(registry)
  return registry
}

function freshDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'orca-consumer-retirement-'))
  directories.push(directory)
  return directory
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}
