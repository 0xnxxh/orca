import { describe, expect, it, vi } from 'vitest'
import {
  TERMINAL_AUTHORITY_CONSUMER_PROOF_ALGORITHM,
  TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION,
  type TerminalAuthorityNamespaceAdmissionChallenge,
  type TerminalAuthorityNamespaceAdmissionGrant,
  type TerminalAuthorityNamespaceAdmissionProof,
  type TerminalAuthorityNamespaceAdmissionStart
} from '../../shared/terminal-session-authority-consumer-proof'
import {
  TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_ALGORITHM,
  TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_VERSION,
  type TerminalAuthorityConsumerRetirementProof
} from '../../shared/terminal-session-authority-consumer-retirement'
import type { TerminalAuthorityNamespace } from '../../shared/terminal-session-authority-identity'
import { TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_VERSION } from '../../shared/terminal-session-authority-consumer-transport'
import {
  TerminalAuthorityAppAdmissionRejectedError,
  type TerminalAuthorityAppAdmissionIntentRequiredError
} from '../session-authority/terminal-authority-app-outcome-host-contract'
import { TerminalAuthorityAppOutcomeHostTransportSlot } from '../session-authority/terminal-authority-app-outcome-host-transport-slot'
import {
  createTerminalAuthorityProofEphemeralKeypair,
  terminalAuthorityAdmissionCas,
  terminalAuthorityHostAppConsumerId,
  terminalAuthorityRetirementCas
} from '../session-authority/terminal-session-authority-consumer-proof'
import {
  DaemonTerminalAuthorityAppHostTransport,
  type DaemonTerminalAuthorityAppClient
} from './daemon-terminal-authority-app-host-transport'
import {
  DAEMON_TERMINAL_AUTHORITY_CONSUMER_CANCEL_REQUEST,
  DAEMON_TERMINAL_AUTHORITY_CONSUMER_CHALLENGE_REQUEST,
  DAEMON_TERMINAL_AUTHORITY_CONSUMER_GRANT_REQUEST,
  DAEMON_TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_CHALLENGE_REQUEST,
  DAEMON_TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_REQUEST,
  DAEMON_TERMINAL_AUTHORITY_CONSUMER_RESOLVE_NAMESPACE_REQUEST
} from './daemon-terminal-authority-consumer-requests'

const HOST_ID = 'authority-host:daemon-test'
const APP_KEYPAIR = createTerminalAuthorityProofEphemeralKeypair()

describe('DaemonTerminalAuthorityAppHostTransport', () => {
  it('keeps proof construction internal and maps the host-required intent', async () => {
    const attempt = admission()
    const client = new FakeClient(async (type, payload) => {
      expect(type).toBe(DAEMON_TERMINAL_AUTHORITY_CONSUMER_CHALLENGE_REQUEST)
      expect(payload).toEqual(attempt.start)
      throw new Error('terminal authority namespace admission requires first')
    })
    const host = await connect(client)

    await expect(host.openNamespace(attempt.request, outcomeTransport())).rejects.toMatchObject({
      requiredIntent: 'first'
    } satisfies Partial<TerminalAuthorityAppAdmissionIntentRequiredError>)
    expect(client.requests).toHaveLength(1)
  })

  it('publishes the pre-grant boundary needed to unlock exact admission', async () => {
    const attempt = admission()
    const boundary = namespaceBoundary(attempt.grant)
    const publishBoundary = vi.fn(async () => {})
    let client!: FakeClient
    client = new FakeClient(async (type, payload) => {
      if (type === DAEMON_TERMINAL_AUTHORITY_CONSUMER_CHALLENGE_REQUEST) {
        expect(payload).toEqual(attempt.start)
        return attempt.challenge
      }
      if (type === DAEMON_TERMINAL_AUTHORITY_CONSUMER_GRANT_REQUEST) {
        assertProofUsesChallenge(payload, attempt.challenge)
        client.emit('terminalAuthorityNamespaceOutcomeBoundary', boundary)
        return attempt.grant
      }
      throw new Error(`unexpected request: ${type}`)
    })
    const host = await connect(client)

    const namespace = await host.openNamespace(attempt.request, {
      publishBoundary,
      publishOutcome: async () => {},
      onFailure: vi.fn()
    })

    expect(namespace.grant).toEqual(attempt.grant)
    expect(publishBoundary).toHaveBeenCalledWith(boundary)
    await namespace.activate?.()
    expect(publishBoundary).toHaveBeenCalledOnce()
  })

  it('resolves the final-host namespace only over the authenticated proof transport', async () => {
    const expected = { authorityHostId: HOST_ID, namespaceId: 'namespace:resolved' }
    const client = new FakeClient(async (type, payload) => {
      expect(type).toBe(DAEMON_TERMINAL_AUTHORITY_CONSUMER_RESOLVE_NAMESPACE_REQUEST)
      expect(payload).toEqual({ worktreeId: 'repo::/workspace' })
      return expected
    })
    const host = await connect(client)

    await expect(host.resolveNamespace('repo::/workspace')).resolves.toEqual(expected)
  })

  it('distinguishes definitive admission rejection from an uncertain response', async () => {
    const attempt = admission()
    const rejectedClient = new FakeClient(async () => {
      throw new Error('terminal authority namespace admission challenge expired')
    })
    const uncertainClient = new FakeClient(async () => {
      throw new Error('connection closed before response')
    })

    await expect(
      (await connect(rejectedClient)).openNamespace(attempt.request, outcomeTransport())
    ).rejects.toBeInstanceOf(TerminalAuthorityAppAdmissionRejectedError)
    await expect(
      (await connect(uncertainClient)).openNamespace(attempt.request, outcomeTransport())
    ).rejects.not.toBeInstanceOf(TerminalAuthorityAppAdmissionRejectedError)
  })

  it('retries an uncertain grant with the exact proof and no synthetic cancellation', async () => {
    const attempt = admission()
    const grantPayloads: unknown[] = []
    let grants = 0
    const client = new FakeClient(async (type, payload) => {
      if (type === DAEMON_TERMINAL_AUTHORITY_CONSUMER_CHALLENGE_REQUEST) {
        return attempt.challenge
      }
      if (type === DAEMON_TERMINAL_AUTHORITY_CONSUMER_GRANT_REQUEST) {
        grantPayloads.push(payload)
        grants += 1
        if (grants === 1) {
          throw new Error('grant response timed out')
        }
        return { ...attempt.grant, replayed: true }
      }
      throw new Error(`unexpected request: ${type}`)
    })
    const host = await connect(client)

    await expect(host.openNamespace(attempt.request, outcomeTransport())).rejects.toThrow(
      'grant response timed out'
    )
    const namespace = await host.openNamespace(attempt.request, outcomeTransport())

    expect(namespace.grant.replayed).toBe(true)
    expect(grantPayloads[0]).toEqual(grantPayloads[1])
    expect(
      client.requests.some(
        (request) => request.type === DAEMON_TERMINAL_AUTHORITY_CONSUMER_CANCEL_REQUEST
      )
    ).toBe(false)
  })

  it('fences one namespace failure without advancing or failing its sibling', async () => {
    const first = admission('namespace:first')
    const second = admission('namespace:second')
    const attempts = new Map<string, ReturnType<typeof admission>>([
      [first.request.requestId, first],
      [second.request.requestId, second]
    ])
    const client = new FakeClient(async (type, payload) => {
      if (type === DAEMON_TERMINAL_AUTHORITY_CONSUMER_CHALLENGE_REQUEST) {
        return attempts.get((payload as TerminalAuthorityNamespaceAdmissionStart).requestId)
          ?.challenge
      }
      if (type === DAEMON_TERMINAL_AUTHORITY_CONSUMER_GRANT_REQUEST) {
        return attempts.get(
          (payload as TerminalAuthorityNamespaceAdmissionProof).challenge.requestId
        )?.grant
      }
      if (type === DAEMON_TERMINAL_AUTHORITY_CONSUMER_CANCEL_REQUEST) {
        return { canceled: true }
      }
      throw new Error(`unexpected request: ${type}`)
    })
    const hostFailure = vi.fn()
    const host = await new DaemonTerminalAuthorityAppHostTransport({
      client,
      authenticatedAuthorityHostId: HOST_ID,
      keypair: APP_KEYPAIR
    }).connect({ onFailure: hostFailure })
    const firstFailure = vi.fn()
    const secondBoundary = vi.fn(async () => {})
    const firstConnection = await host.openNamespace(first.request, outcomeTransport(firstFailure))
    const secondConnection = await host.openNamespace(second.request, {
      publishBoundary: secondBoundary,
      publishOutcome: async () => {},
      onFailure: vi.fn()
    })
    await firstConnection.activate?.()
    await secondConnection.activate?.()

    client.emit(
      'terminalAuthorityNamespaceOutcomeBoundary',
      namespaceBoundary({
        ...first.grant,
        consumer: { ...first.grant.consumer, consumerIncarnationId: 'app-process:wrong' }
      })
    )
    client.emit('terminalAuthorityNamespaceOutcomeBoundary', namespaceBoundary(second.grant))
    await vi.waitFor(() => expect(secondBoundary).toHaveBeenCalledOnce())

    expect(firstFailure).toHaveBeenCalledOnce()
    expect(hostFailure).not.toHaveBeenCalled()
    expect(secondConnection.grant).toEqual(second.grant)
  })

  it('retries a lost retirement acknowledgement with the exact proof', async () => {
    const attempt = retirement()
    const proofs: unknown[] = []
    let completions = 0
    const client = new FakeClient(async (type, payload) => {
      if (type === DAEMON_TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_CHALLENGE_REQUEST) {
        expect(payload).toEqual(attempt.start)
        return attempt.challenge
      }
      if (type === DAEMON_TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_REQUEST) {
        proofs.push(payload)
        completions += 1
        if (completions === 1) {
          throw new Error('retirement response timed out')
        }
        return { ...attempt.result, replayed: true }
      }
      throw new Error(`unexpected request: ${type}`)
    })
    const host = await connect(client)

    await expect(host.retireNamespace(attempt.request)).rejects.toThrow(
      'retirement response timed out'
    )
    await expect(host.retireNamespace(attempt.request)).resolves.toEqual({
      ...attempt.result,
      replayed: true
    })
    expect(proofs).toHaveLength(2)
    expect(proofs[0]).toEqual(proofs[1])
    expect((proofs[0] as TerminalAuthorityConsumerRetirementProof).challenge).toEqual(
      attempt.challenge
    )
  })

  it('rejects retirement before mutation when the daemon did not grant support', async () => {
    const attempt = retirement()
    const client = new FakeClient(async () => {
      throw new Error('unexpected request')
    }, false)
    const host = await connect(client)

    await expect(host.retireNamespace(attempt.request)).rejects.toThrow('unsupported')
    expect(client.requests).toHaveLength(0)
  })
})

class FakeClient implements DaemonTerminalAuthorityAppClient {
  readonly requests: { type: string; payload: unknown }[] = []
  private readonly eventListeners = new Set<(event: unknown) => void>()
  private readonly disconnectedListeners = new Set<() => void>()

  constructor(
    private readonly handleRequest: (type: string, payload: unknown) => Promise<unknown>,
    private readonly retirementSupported = true
  ) {}

  async ensureConnected(): Promise<void> {}

  terminalSessionAuthorityConsumerProofHostId(): string {
    return HOST_ID
  }

  terminalSessionAuthorityConsumerRetirementSupported(): boolean {
    return this.retirementSupported
  }

  async request<T>(type: string, payload: unknown): Promise<T> {
    this.requests.push({ type, payload })
    return (await this.handleRequest(type, payload)) as T
  }

  onEvent(listener: (event: unknown) => void): () => void {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  onDisconnected(listener: () => void): () => void {
    this.disconnectedListeners.add(listener)
    return () => this.disconnectedListeners.delete(listener)
  }

  emit(event: string, payload: unknown): void {
    for (const listener of this.eventListeners) {
      listener({ event, payload })
    }
  }
}

async function connect(client: FakeClient) {
  const slot = new TerminalAuthorityAppOutcomeHostTransportSlot(HOST_ID)
  slot.install(
    new DaemonTerminalAuthorityAppHostTransport({
      client,
      authenticatedAuthorityHostId: HOST_ID,
      keypair: APP_KEYPAIR
    })
  )
  return await slot.connect({ onFailure: vi.fn() })
}

function outcomeTransport(onFailure = vi.fn()) {
  return {
    publishBoundary: async () => {},
    publishOutcome: async () => {},
    onFailure
  }
}

function admission(namespaceId = 'namespace:daemon-test') {
  const namespace: TerminalAuthorityNamespace = Object.freeze({
    authorityHostId: HOST_ID,
    namespaceId
  })
  const request = Object.freeze({
    namespace,
    candidateProcessIncarnationId: 'app-process:daemon-test',
    candidateSessionNonce: `app-session:${namespaceId}`,
    requestId: `app-request:${namespaceId}`,
    intent: 'resume' as const
  })
  const start: TerminalAuthorityNamespaceAdmissionStart = Object.freeze({
    version: TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION,
    algorithm: TERMINAL_AUTHORITY_CONSUMER_PROOF_ALGORITHM,
    ...request,
    appPublicKeyB64: Buffer.from(APP_KEYPAIR.publicKey).toString('base64')
  })
  const host = createTerminalAuthorityProofEphemeralKeypair()
  const challenge: TerminalAuthorityNamespaceAdmissionChallenge = Object.freeze({
    ...start,
    currentAdmissionCas: 'admission-cas:current',
    connectionGrantId: 'daemon-grant:test',
    authenticatedTransportPrincipal: 'daemon-principal:test',
    authenticatedTransportCapability: 'daemon-capability:test',
    hostEphemeralPublicKeyB64: Buffer.from(host.publicKey).toString('base64'),
    expiresAtMs: Date.now() + 30_000
  })
  const consumer = Object.freeze({
    consumerId: terminalAuthorityHostAppConsumerId(HOST_ID, APP_KEYPAIR.publicKey),
    consumerIncarnationId: start.candidateProcessIncarnationId
  })
  const grant: TerminalAuthorityNamespaceAdmissionGrant = Object.freeze({
    version: TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION,
    consumer,
    namespace,
    requestId: start.requestId,
    connectionGrantId: challenge.connectionGrantId,
    admissionCas: terminalAuthorityAdmissionCas(
      namespace,
      consumer.consumerId,
      consumer.consumerIncarnationId
    ),
    replayed: false
  })
  return { request, start, challenge, grant }
}

function retirement(namespaceId = 'namespace:daemon-test') {
  const namespace = Object.freeze({ authorityHostId: HOST_ID, namespaceId })
  const request = Object.freeze({
    namespace,
    candidateProcessIncarnationId: 'app-process:daemon-test',
    candidateSessionNonce: `app-retirement-session:${namespaceId}`,
    requestId: `app-retirement-request:${namespaceId}`
  })
  const start = Object.freeze({
    version: TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_VERSION,
    algorithm: TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_ALGORITHM,
    ...request,
    appPublicKeyB64: Buffer.from(APP_KEYPAIR.publicKey).toString('base64')
  })
  const host = createTerminalAuthorityProofEphemeralKeypair()
  const consumerId = terminalAuthorityHostAppConsumerId(HOST_ID, APP_KEYPAIR.publicKey)
  const currentConsumerIncarnationId = request.candidateProcessIncarnationId
  const challenge = Object.freeze({
    ...start,
    consumerId,
    currentConsumerIncarnationId,
    retirementCas: terminalAuthorityRetirementCas(
      namespace,
      consumerId,
      currentConsumerIncarnationId
    ),
    connectionGrantId: 'daemon-grant:test',
    liveAdmission: null,
    authenticatedTransportPrincipal: 'daemon-principal:test',
    authenticatedTransportCapability: 'daemon-capability:test',
    hostEphemeralPublicKeyB64: Buffer.from(host.publicKey).toString('base64'),
    expiresAtMs: Date.now() + 30_000
  })
  const result = Object.freeze({
    version: TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_VERSION,
    namespace,
    consumerId,
    retiredConsumerIncarnationId: currentConsumerIncarnationId,
    requestId: request.requestId,
    candidateProcessIncarnationId: request.candidateProcessIncarnationId,
    candidateSessionNonce: request.candidateSessionNonce,
    connectionGrantId: challenge.connectionGrantId,
    retirementCas: challenge.retirementCas,
    retired: true as const,
    alreadyAbsent: false,
    replayed: false
  })
  return { request, start, challenge, result }
}

function assertProofUsesChallenge(
  value: unknown,
  challenge: TerminalAuthorityNamespaceAdmissionChallenge
): void {
  expect(value).toMatchObject({
    version: TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION,
    challenge,
    proofMacB64: expect.any(String)
  })
}

function namespaceBoundary(grant: TerminalAuthorityNamespaceAdmissionGrant) {
  return Object.freeze({
    version: TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_VERSION,
    consumer: grant.consumer,
    namespace: grant.namespace,
    acknowledgedSequence: 0,
    outcomeHighWatermark: 0,
    boundaryId: `boundary:${grant.namespace.namespaceId}`,
    consumerStart: 'new-at-tail' as const
  })
}
