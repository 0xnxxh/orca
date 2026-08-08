import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  TERMINAL_AUTHORITY_CONSUMER_PROOF_ALGORITHM,
  TERMINAL_AUTHORITY_CONSUMER_PROOF_CAPABILITY,
  TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION,
  type TerminalAuthorityNamespaceAdmissionIntent,
  type TerminalAuthorityNamespaceAdmissionStart
} from '../../shared/terminal-session-authority-consumer-proof'
import type { TerminalAuthorityNamespace } from '../../shared/terminal-session-authority-identity'
import {
  createTerminalAuthorityConsumerProof,
  createTerminalAuthorityProofEphemeralKeypair,
  type TerminalAuthorityConsumerProofKeypair
} from './terminal-session-authority-consumer-proof'
import {
  TerminalSessionAuthorityConsumerAdmissions,
  type TerminalAuthorityAuthenticatedConsumerTransport,
  type TerminalAuthorityNamespaceAdmissionPreparation
} from './terminal-session-authority-consumer-admission'
import { TerminalSessionAuthorityRegistry } from './terminal-session-authority-registry'
import type { TerminalSessionAuthorityService } from './terminal-session-authority-service'
import {
  terminalAuthorityFloatingLocator,
  terminalAuthorityWorkspaceLocator
} from './terminal-session-authority-workspace-locator'

const directories: string[] = []
const registries: TerminalSessionAuthorityRegistry[] = []

afterEach(async () => {
  await Promise.allSettled(registries.splice(0).map((registry) => registry.close()))
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('TerminalSessionAuthorityConsumerAdmissions', () => {
  it('returns the exact committed grant for an exact request retry', async () => {
    const harness = await oneNamespace()
    const app = createTerminalAuthorityProofEphemeralKeypair()
    const transport = authenticatedTransport('grant-a')
    const start = admissionStart(harness.service.namespace, app, 'process-a', 'request-a')
    const challenge = harness.admissions.issueChallenge(harness.service, start, transport)

    expect(harness.admissions.issueChallenge(harness.service, start, transport)).toBe(challenge)
    const proof = createTerminalAuthorityConsumerProof(challenge, app)
    const prepared = harness.admissions.prepare(harness.service, proof, transport)
    await claimAndCommit(harness.service, prepared)

    expect(harness.admissions.issueChallenge(harness.service, start, transport)).toBe(challenge)
    const replay = harness.admissions.prepare(harness.service, proof, transport)
    expect(replay.grant).toEqual({ ...prepared.grant, replayed: true })
    expect(replay.published).toBe(true)
    expect(() =>
      harness.admissions.issueChallenge(
        harness.service,
        { ...start, candidateSessionNonce: 'changed-session-nonce' },
        transport
      )
    ).toThrow('request changed')
  })

  it('retains no challenge or grant for low-order keys and rejected proofs', async () => {
    const harness = await oneNamespace()
    const transport = authenticatedTransport('grant-a')
    const app = createTerminalAuthorityProofEphemeralKeypair()
    const invalid = {
      ...admissionStart(harness.service.namespace, app, 'process-a', 'request-a'),
      appPublicKeyB64: Buffer.alloc(32).toString('base64')
    }

    expect(() => harness.admissions.issueChallenge(harness.service, invalid, transport)).toThrow(
      'low order'
    )
    const start = admissionStart(harness.service.namespace, app, 'process-a', 'request-a')
    const challenge = harness.admissions.issueChallenge(harness.service, start, transport)
    const proof = createTerminalAuthorityConsumerProof(challenge, app)
    expect(() =>
      harness.admissions.prepare(
        harness.service,
        { ...proof, proofMacB64: Buffer.alloc(32, 7).toString('base64') },
        transport
      )
    ).toThrow('proof was rejected')

    const prepared = harness.admissions.prepare(harness.service, proof, transport)
    await claimAndCommit(harness.service, prepared)
    expect(
      harness.service.activeConsumerIncarnation(
        harness.service.writerAccess,
        prepared.claim.consumer.consumerId
      )
    ).toBe('app-process:process-a')
  })

  it('retains a durable claim but installs no dead-transport retry after cancellation', async () => {
    const harness = await oneNamespace()
    const app = createTerminalAuthorityProofEphemeralKeypair()
    const transport = authenticatedTransport('grant-a')
    const start = admissionStart(harness.service.namespace, app, 'process-a', 'request-a')
    const challenge = harness.admissions.issueChallenge(harness.service, start, transport)
    const prepared = harness.admissions.prepare(
      harness.service,
      createTerminalAuthorityConsumerProof(challenge, app),
      transport
    )
    prepared.admissionSeal.seal()
    harness.admissions.releaseTransport(transport.token)

    await harness.service.claimConsumer(harness.service.writerAccess, {
      consumerId: prepared.claim.consumer.consumerId,
      consumerIncarnationId: prepared.claim.consumer.consumerIncarnationId,
      expectedIncarnationId: prepared.claim.expectedConsumerIncarnationId
    })

    // The transport went away mid-flight, so the seal releases without ever publishing a grant.
    prepared.admissionSeal.abort()
    expect(prepared.published).toBe(false)
    expect(
      harness.service.activeConsumerIncarnation(
        harness.service.writerAccess,
        prepared.claim.consumer.consumerId
      )
    ).toBe(prepared.claim.consumer.consumerIncarnationId)
    expect(() => harness.admissions.issueChallenge(harness.service, start, transport)).toThrow(
      'requires resume'
    )
  })

  it('rejects expired challenges and changed authenticated transports', async () => {
    let now = 1_000
    const harness = await oneNamespace(() => now)
    const app = createTerminalAuthorityProofEphemeralKeypair()
    const transport = authenticatedTransport('grant-a')
    const start = admissionStart(harness.service.namespace, app, 'process-a', 'request-a')
    const challenge = harness.admissions.issueChallenge(harness.service, start, transport)
    const proof = createTerminalAuthorityConsumerProof(challenge, app)

    expect(() =>
      harness.admissions.prepare(harness.service, proof, {
        ...transport,
        token: Object.freeze({})
      })
    ).toThrow('transport changed')
    now = challenge.expiresAtMs
    expect(() => harness.admissions.prepare(harness.service, proof, transport)).toThrow('stale')
  })

  it('retains exact live retries and releases per-principal challenge capacity', async () => {
    let now = 1_000
    const harness = await oneNamespace(() => now)
    const app = createTerminalAuthorityProofEphemeralKeypair()
    const transport = authenticatedTransport('grant-a')
    const start = admissionStart(harness.service.namespace, app, 'process-a', 'request-a')
    const challenge = harness.admissions.issueChallenge(harness.service, start, transport)
    const prepared = harness.admissions.prepare(
      harness.service,
      createTerminalAuthorityConsumerProof(challenge, app),
      transport
    )
    await claimAndCommit(harness.service, prepared)

    now = challenge.expiresAtMs + 1
    expect(harness.admissions.issueChallenge(harness.service, start, transport)).toBe(challenge)
    now = 60 * 60_000
    expect(harness.admissions.issueChallenge(harness.service, start, transport)).toBe(challenge)

    const scoped = authenticatedTransport('grant-b')
    for (let index = 0; index < 64; index += 1) {
      harness.admissions.issueChallenge(
        harness.service,
        admissionStart(
          harness.service.namespace,
          app,
          'process-b',
          `scoped-request:${index}`,
          'explicit-handover'
        ),
        scoped
      )
    }
    expect(() =>
      harness.admissions.issueChallenge(
        harness.service,
        admissionStart(
          harness.service.namespace,
          app,
          'process-b',
          'scoped-request:overflow',
          'explicit-handover'
        ),
        scoped
      )
    ).toThrow('scope capacity')
    harness.admissions.releaseTransport(scoped.token)
    expect(() =>
      harness.admissions.issueChallenge(
        harness.service,
        admissionStart(
          harness.service.namespace,
          app,
          'process-c',
          'scoped-request:released',
          'explicit-handover'
        ),
        authenticatedTransport('grant-c')
      )
    ).not.toThrow()
    harness.admissions.releaseTransport(transport.token)
    expect(() => harness.admissions.issueChallenge(harness.service, start, transport)).toThrow(
      'requires resume'
    )
  })

  it('requires explicit live handover and resume after disconnect', async () => {
    const harness = await oneNamespace()
    const app = createTerminalAuthorityProofEphemeralKeypair()
    const firstTransport = authenticatedTransport('grant-a')
    const first = await prepareAdmission(
      harness,
      app,
      firstTransport,
      'process-a',
      'request-a',
      'first'
    )
    await claimAndCommit(harness.service, first)

    const replacementTransport = authenticatedTransport('grant-b')
    expect(() =>
      harness.admissions.issueChallenge(
        harness.service,
        admissionStart(harness.service.namespace, app, 'process-b', 'request-b', 'resume'),
        replacementTransport
      )
    ).toThrow('requires explicit-handover')
    const replacement = await prepareAdmission(
      harness,
      app,
      replacementTransport,
      'process-b',
      'request-b',
      'explicit-handover'
    )
    await claimAndCommit(harness.service, replacement)

    harness.admissions.releaseTransport(replacementTransport.token)
    const resumed = await prepareAdmission(
      harness,
      app,
      authenticatedTransport('grant-c'),
      'process-c',
      'request-c',
      'resume'
    )
    await claimAndCommit(harness.service, resumed)
    expect(resumed.claim.expectedConsumerIncarnationId).toBe('app-process:process-b')
  })

  it('rejects a late proof after another process wins the CAS', async () => {
    const harness = await oneNamespace()
    const app = createTerminalAuthorityProofEphemeralKeypair()
    const first = await prepareAdmission(
      harness,
      app,
      authenticatedTransport('grant-a'),
      'process-a',
      'request-a',
      'first'
    )
    await claimAndCommit(harness.service, first)
    const staleTransport = authenticatedTransport('grant-b')
    const staleStart = admissionStart(
      harness.service.namespace,
      app,
      'process-b',
      'request-b',
      'explicit-handover'
    )
    const staleChallenge = harness.admissions.issueChallenge(
      harness.service,
      staleStart,
      staleTransport
    )
    const winner = await prepareAdmission(
      harness,
      app,
      authenticatedTransport('grant-c'),
      'process-c',
      'request-c',
      'explicit-handover'
    )
    await claimAndCommit(harness.service, winner)

    expect(() =>
      harness.admissions.prepare(
        harness.service,
        createTerminalAuthorityConsumerProof(staleChallenge, app),
        staleTransport
      )
    ).toThrow('CAS changed')
  })

  it('lets one namespace commit while another namespace proof fails', async () => {
    const harness = await twoNamespaces()
    const app = createTerminalAuthorityProofEphemeralKeypair()
    const transport = authenticatedTransport('grant-a')
    const firstChallenge = harness.admissions.issueChallenge(
      harness.first,
      admissionStart(harness.first.namespace, app, 'process-a', 'request-a'),
      transport
    )
    const second = await prepareAdmission(
      { admissions: harness.admissions, service: harness.second },
      app,
      transport,
      'process-a',
      'request-b',
      'first'
    )

    expect(() =>
      harness.admissions.prepare(
        harness.first,
        {
          ...createTerminalAuthorityConsumerProof(firstChallenge, app),
          proofMacB64: Buffer.alloc(32, 9).toString('base64')
        },
        transport
      )
    ).toThrow('proof was rejected')
    await claimAndCommit(harness.second, second)
    expect(
      harness.second.activeConsumerIncarnation(
        harness.second.writerAccess,
        second.claim.consumer.consumerId
      )
    ).toBe('app-process:process-a')
    expect(
      harness.first.activeConsumerIncarnation(
        harness.first.writerAccess,
        second.claim.consumer.consumerId
      )
    ).toBeNull()
  })
})

async function oneNamespace(now: () => number = Date.now) {
  const directory = freshDirectory()
  const registry = await openRegistry(directory)
  const namespace = (await registry.resolveNamespace(terminalAuthorityWorkspaceLocator(directory)))
    .namespace
  return {
    admissions: new TerminalSessionAuthorityConsumerAdmissions(namespace.authorityHostId, now),
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
    admissions: new TerminalSessionAuthorityConsumerAdmissions(firstNamespace.authorityHostId),
    first: await registry.openNamespace(firstNamespace),
    second: await registry.openNamespace(secondNamespace)
  }
}

async function openRegistry(directory: string): Promise<TerminalSessionAuthorityRegistry> {
  const registry = await TerminalSessionAuthorityRegistry.open({
    directory: path.join(directory, 'authority'),
    authorityHostId: 'host-admission-test',
    ownerToken: 'owner-token-admission-test',
    ownerIncarnationId: 'owner-incarnation-admission-test',
    writerActorId: 'writer-admission-test'
  })
  registries.push(registry)
  return registry
}

async function prepareAdmission(
  harness: Readonly<{
    admissions: TerminalSessionAuthorityConsumerAdmissions
    service: TerminalSessionAuthorityService
  }>,
  app: TerminalAuthorityConsumerProofKeypair,
  transport: TerminalAuthorityAuthenticatedConsumerTransport,
  process: string,
  requestId: string,
  intent: TerminalAuthorityNamespaceAdmissionIntent
): Promise<TerminalAuthorityNamespaceAdmissionPreparation> {
  const start = admissionStart(harness.service.namespace, app, process, requestId, intent)
  const challenge = harness.admissions.issueChallenge(harness.service, start, transport)
  return harness.admissions.prepare(
    harness.service,
    createTerminalAuthorityConsumerProof(challenge, app),
    transport
  )
}

// Exercises the real seal boundary: the service seals, appends, then publishes the grant.
async function claimAndCommit(
  service: TerminalSessionAuthorityService,
  prepared: TerminalAuthorityNamespaceAdmissionPreparation
): Promise<void> {
  await service.commitConsumerAdmission(
    service.writerAccess,
    {
      consumerId: prepared.claim.consumer.consumerId,
      consumerIncarnationId: prepared.claim.consumer.consumerIncarnationId,
      expectedIncarnationId: prepared.claim.expectedConsumerIncarnationId
    },
    prepared.admissionSeal
  )
}

function admissionStart(
  namespace: TerminalAuthorityNamespace,
  app: TerminalAuthorityConsumerProofKeypair,
  process: string,
  requestId: string,
  intent: TerminalAuthorityNamespaceAdmissionIntent = 'first'
): TerminalAuthorityNamespaceAdmissionStart {
  return Object.freeze({
    version: TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION,
    algorithm: TERMINAL_AUTHORITY_CONSUMER_PROOF_ALGORITHM,
    namespace,
    appPublicKeyB64: Buffer.from(app.publicKey).toString('base64'),
    candidateProcessIncarnationId: `app-process:${process}`,
    candidateSessionNonce: `session-nonce:${process}`,
    requestId,
    intent
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

function freshDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'orca-consumer-admission-'))
  directories.push(directory)
  return directory
}
