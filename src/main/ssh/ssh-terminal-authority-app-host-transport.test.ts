import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  TERMINAL_AUTHORITY_CONSUMER_PROOF_ALGORITHM,
  TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION,
  type TerminalAuthorityNamespaceAdmissionGrant,
  type TerminalAuthorityNamespaceAdmissionProof,
  type TerminalAuthorityNamespaceAdmissionStart
} from '../../shared/terminal-session-authority-consumer-proof'
import {
  TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_ALGORITHM,
  TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_VERSION,
  type TerminalAuthorityConsumerRetirementChallenge,
  type TerminalAuthorityConsumerRetirementProof,
  type TerminalAuthorityConsumerRetirementStart
} from '../../shared/terminal-session-authority-consumer-retirement'
import {
  TERMINAL_AUTHORITY_NAMESPACE_BOUNDARY_ACCEPT_METHOD,
  TERMINAL_AUTHORITY_NAMESPACE_BOUNDARY_NOTIFICATION,
  TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_ACK_METHOD
} from '../../shared/terminal-session-authority-consumer-transport'
import { terminalSessionAuthorityBoundaryId } from '../../shared/terminal-session-authority-boundary-identity'
import { authorityProjection } from '../session-authority/__tests__/terminal-authority-app-projection-fixture'
import {
  TerminalAuthorityAppAdmissionRejectedError,
  type TerminalAuthorityAppAdmissionIntentRequiredError
} from '../session-authority/terminal-authority-app-outcome-host-contract'
import { TerminalAuthorityAppOutcomeHostManager } from '../session-authority/terminal-authority-app-outcome-host-manager'
import { TerminalAuthorityAppOutcomeHostTransportSlot } from '../session-authority/terminal-authority-app-outcome-host-transport-slot'
import { TerminalAuthorityAppProjectionStore } from '../session-authority/terminal-authority-app-projection-store'
import {
  createTerminalAuthorityProofEphemeralKeypair,
  terminalAuthorityAdmissionCas,
  terminalAuthorityHostAppConsumerId,
  terminalAuthorityRetirementCas
} from '../session-authority/terminal-session-authority-consumer-proof'
import {
  FakeSshAuthorityMux,
  SSH_AUTHORITY_APP_KEYPAIR,
  SSH_AUTHORITY_HOST_ID,
  sshAuthorityAdmission,
  sshAuthorityBoundary,
  sshAuthorityOutcomeTransport,
  sshAuthorityRetirement
} from './__tests__/ssh-terminal-authority-app-transport'
import { SshTerminalAuthorityAppHostTransport } from './ssh-terminal-authority-app-host-transport'
import {
  SSH_TERMINAL_AUTHORITY_CONSUMER_CHALLENGE_METHOD,
  SSH_TERMINAL_AUTHORITY_CONSUMER_CANCEL_METHOD,
  SSH_TERMINAL_AUTHORITY_CONSUMER_GRANT_METHOD,
  SSH_TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_CHALLENGE_METHOD,
  SSH_TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_METHOD,
  SSH_TERMINAL_AUTHORITY_CONSUMER_RESOLVE_NAMESPACE_METHOD
} from './ssh-terminal-authority-consumer-methods'

describe('SshTerminalAuthorityAppHostTransport', () => {
  it('constructs proof internally and maps the host-required intent', async () => {
    const attempt = sshAuthorityAdmission()
    const mux = new FakeSshAuthorityMux(async (method, params) => {
      expect(method).toBe(SSH_TERMINAL_AUTHORITY_CONSUMER_CHALLENGE_METHOD)
      expect(params).toEqual({ start: attempt.start })
      throw new Error('terminal authority namespace admission requires first')
    })
    const host = await connect(mux)

    await expect(
      host.openNamespace(attempt.request, sshAuthorityOutcomeTransport())
    ).rejects.toMatchObject({
      requiredIntent: 'first'
    } satisfies Partial<TerminalAuthorityAppAdmissionIntentRequiredError>)
    expect(mux.requests).toHaveLength(1)
  })

  it('publishes the pre-grant boundary needed to unlock exact admission', async () => {
    const attempt = sshAuthorityAdmission()
    const boundary = sshAuthorityBoundary(attempt.grant)
    let mux!: FakeSshAuthorityMux
    mux = new FakeSshAuthorityMux(async (method, params) => {
      if (method === SSH_TERMINAL_AUTHORITY_CONSUMER_CHALLENGE_METHOD) {
        return attempt.challenge
      }
      if (method === SSH_TERMINAL_AUTHORITY_CONSUMER_GRANT_METHOD) {
        expect(params).toMatchObject({ proof: { challenge: attempt.challenge } })
        mux.emit(TERMINAL_AUTHORITY_NAMESPACE_BOUNDARY_NOTIFICATION, { boundary })
        return attempt.grant
      }
      throw new Error(`unexpected request: ${method}`)
    })
    const transport = sshAuthorityOutcomeTransport()
    const host = await connect(mux)

    const namespace = await host.openNamespace(attempt.request, transport)

    expect(transport.publishBoundary).toHaveBeenCalledWith(boundary)
    await namespace.activate?.()
    expect(transport.publishBoundary).toHaveBeenCalledOnce()
  })

  it('resolves the namespace through the authenticated relay connection', async () => {
    const expected = {
      authorityHostId: SSH_AUTHORITY_HOST_ID,
      namespaceId: 'namespace:resolved'
    }
    const mux = new FakeSshAuthorityMux(async (method, params) => {
      expect(method).toBe(SSH_TERMINAL_AUTHORITY_CONSUMER_RESOLVE_NAMESPACE_METHOD)
      expect(params).toEqual({ worktreeId: 'repo::/workspace' })
      return expected
    })

    await expect((await connect(mux)).resolveNamespace('repo::/workspace')).resolves.toEqual(
      expected
    )
  })

  it('maps semantic host rejection without reclassifying transport uncertainty', async () => {
    const attempt = sshAuthorityAdmission()
    const rejected = new FakeSshAuthorityMux(async () => {
      throw new Error('terminal authority namespace admission proof was rejected')
    })
    const uncertain = new FakeSshAuthorityMux(async () => {
      throw new Error('relay response lost')
    })

    await expect(
      (await connect(rejected)).openNamespace(attempt.request, sshAuthorityOutcomeTransport())
    ).rejects.toBeInstanceOf(TerminalAuthorityAppAdmissionRejectedError)
    await expect(
      (await connect(uncertain)).openNamespace(attempt.request, sshAuthorityOutcomeTransport())
    ).rejects.not.toBeInstanceOf(TerminalAuthorityAppAdmissionRejectedError)
  })

  it('retries an uncertain grant with the exact proof and no cancellation', async () => {
    const attempt = sshAuthorityAdmission()
    const proofs: TerminalAuthorityNamespaceAdmissionProof[] = []
    let grants = 0
    const mux = new FakeSshAuthorityMux(async (method, params) => {
      if (method === SSH_TERMINAL_AUTHORITY_CONSUMER_CHALLENGE_METHOD) {
        return attempt.challenge
      }
      if (method === SSH_TERMINAL_AUTHORITY_CONSUMER_GRANT_METHOD) {
        proofs.push(params?.proof as TerminalAuthorityNamespaceAdmissionProof)
        grants += 1
        if (grants === 1) {
          throw new Error('grant response timed out')
        }
        return { ...attempt.grant, replayed: true }
      }
      throw new Error(`unexpected request: ${method}`)
    })
    const host = await connect(mux)

    await expect(
      host.openNamespace(attempt.request, sshAuthorityOutcomeTransport())
    ).rejects.toThrow('grant response timed out')
    const namespace = await host.openNamespace(attempt.request, sshAuthorityOutcomeTransport())

    expect(namespace.grant.replayed).toBe(true)
    expect(proofs[0]).toEqual(proofs[1])
    expect(mux.requests.every((request) => !request.method.includes('cancel'))).toBe(true)
  })

  it('retries a lost cumulative ACK without changing another namespace', async () => {
    const first = sshAuthorityAdmission('namespace:first')
    const second = sshAuthorityAdmission('namespace:second')
    const attempts = new Map<string, ReturnType<typeof sshAuthorityAdmission>>([
      [first.request.requestId, first],
      [second.request.requestId, second]
    ])
    const ackPayloads: unknown[] = []
    let acks = 0
    const mux = new FakeSshAuthorityMux(async (method, params) => {
      if (method === SSH_TERMINAL_AUTHORITY_CONSUMER_CHALLENGE_METHOD) {
        const requestId = (params?.start as { requestId?: unknown } | undefined)?.requestId
        return typeof requestId === 'string' ? attempts.get(requestId)?.challenge : undefined
      }
      if (method === SSH_TERMINAL_AUTHORITY_CONSUMER_GRANT_METHOD) {
        const proof = params?.proof as TerminalAuthorityNamespaceAdmissionProof
        return attempts.get(proof.challenge.requestId)?.grant
      }
      if (method === TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_ACK_METHOD) {
        ackPayloads.push(params)
        acks += 1
        if (acks === 1) {
          throw new Error('ACK response lost')
        }
        return { acknowledgedSequence: 1 }
      }
      throw new Error(`unexpected request: ${method}`)
    })
    const host = await connect(mux)
    const firstConnection = await host.openNamespace(first.request, sshAuthorityOutcomeTransport())
    const secondConnection = await host.openNamespace(
      second.request,
      sshAuthorityOutcomeTransport()
    )
    await firstConnection.activate?.()
    await secondConnection.activate?.()
    const ack = {
      version: 1 as const,
      consumer: first.grant.consumer,
      namespace: first.grant.namespace,
      sequence: 1,
      outcomeId: 'outcome:first:1'
    }

    await expect(firstConnection.acknowledge(ack)).rejects.toThrow('ACK response lost')
    await expect(firstConnection.acknowledge(ack)).resolves.toBe(1)

    expect(ackPayloads[0]).toEqual(ackPayloads[1])
    expect(secondConnection.grant).toEqual(second.grant)
  })

  it('retries a lost retirement acknowledgement with the exact proof', async () => {
    const attempt = sshAuthorityRetirement()
    const proofs: TerminalAuthorityConsumerRetirementProof[] = []
    let completions = 0
    const mux = new FakeSshAuthorityMux(async (method, params) => {
      if (method === SSH_TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_CHALLENGE_METHOD) {
        expect(params).toEqual({ start: attempt.start })
        return attempt.challenge
      }
      if (method === SSH_TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_METHOD) {
        proofs.push(params?.proof as TerminalAuthorityConsumerRetirementProof)
        completions += 1
        if (completions === 1) {
          throw new Error('retirement response timed out')
        }
        return { ...attempt.result, replayed: true }
      }
      throw new Error(`unexpected request: ${method}`)
    })
    const host = await connect(mux)

    await expect(host.retireNamespace(attempt.request)).rejects.toThrow(
      'retirement response timed out'
    )
    await expect(host.retireNamespace(attempt.request)).resolves.toEqual({
      ...attempt.result,
      replayed: true
    })
    expect(proofs[0]).toEqual(proofs[1])
    expect(proofs[0]?.challenge).toEqual(attempt.challenge)
  })

  it('keeps retirement pending across SSH transport replacement without re-admission', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'ssh-authority-retirement-'))
    const store = await TerminalAuthorityAppProjectionStore.open({
      directory,
      databasePath: ':memory:'
    })
    const slot = new TerminalAuthorityAppOutcomeHostTransportSlot(SSH_AUTHORITY_HOST_ID)
    let currentIncarnationId: string | null = 'app-process:ssh-manager-test'
    let admissionGrants = 0
    const secondMux = new FakeSshAuthorityMux(async (method, params) => {
      if (method === SSH_TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_CHALLENGE_METHOD) {
        return retirementChallenge(
          params?.start as TerminalAuthorityConsumerRetirementStart,
          currentIncarnationId,
          'connection-grant:ssh-reconnected'
        )
      }
      if (method === SSH_TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_METHOD) {
        const proof = params?.proof as TerminalAuthorityConsumerRetirementProof | undefined
        if (!proof) {
          throw new Error('replacement retirement proof is unavailable')
        }
        return retirementResult(proof.challenge, true)
      }
      if (method === SSH_TERMINAL_AUTHORITY_CONSUMER_CHALLENGE_METHOD) {
        throw new Error('retiring namespace was re-admitted')
      }
      throw new Error(`unexpected replacement request: ${method}`)
    })
    let replacementLease!: ReturnType<TerminalAuthorityAppOutcomeHostTransportSlot['install']>
    let firstMux!: FakeSshAuthorityMux
    firstMux = new FakeSshAuthorityMux(async (method, params) => {
      if (method === SSH_TERMINAL_AUTHORITY_CONSUMER_CHALLENGE_METHOD) {
        return admissionChallenge(
          params?.start as TerminalAuthorityNamespaceAdmissionStart,
          'connection-grant:ssh-first'
        )
      }
      if (method === SSH_TERMINAL_AUTHORITY_CONSUMER_GRANT_METHOD) {
        admissionGrants += 1
        const grant = admissionGrant(params?.proof as TerminalAuthorityNamespaceAdmissionProof)
        firstMux.emit(TERMINAL_AUTHORITY_NAMESPACE_BOUNDARY_NOTIFICATION, {
          boundary: completeBoundary(grant)
        })
        return grant
      }
      if (method === TERMINAL_AUTHORITY_NAMESPACE_BOUNDARY_ACCEPT_METHOD) {
        return {}
      }
      if (method === SSH_TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_CHALLENGE_METHOD) {
        return retirementChallenge(
          params?.start as TerminalAuthorityConsumerRetirementStart,
          currentIncarnationId,
          'connection-grant:ssh-first'
        )
      }
      if (method === SSH_TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_METHOD) {
        currentIncarnationId = null
        replacementLease = slot.install(sshTransport(secondMux))
        throw new Error('SSH retirement response lost after durable append')
      }
      if (method === SSH_TERMINAL_AUTHORITY_CONSUMER_CANCEL_METHOD) {
        return { canceled: true }
      }
      throw new Error(`unexpected initial request: ${method}`)
    })
    slot.install(sshTransport(firstMux))
    const manager = new TerminalAuthorityAppOutcomeHostManager('app-process:ssh-manager-test', {
      store,
      onProjection: () => {},
      reconnectBaseDelayMs: 1,
      reconnectMaxDelayMs: 1
    })
    const registration = manager.installHost(slot)
    const namespace = {
      authorityHostId: SSH_AUTHORITY_HOST_ID,
      namespaceId: 'namespace:ssh-manager-retirement'
    }
    const request = Object.freeze({
      namespace,
      candidateProcessIncarnationId: 'app-process:ssh-manager-test',
      candidateSessionNonce: 'app-session:ssh-manager-retirement',
      requestId: 'app-retirement-request:ssh-manager'
    })
    try {
      await registration.admitNamespace(namespace)
      await expect(registration.retireNamespace(request)).rejects.toThrow('response lost')
      await expect(
        replacementLease.withCurrent(async (binding) => {
          const result = await registration.retireNamespace(request)
          binding.bindConnectionGeneration()
          return result
        })
      ).resolves.toMatchObject({ retired: true, alreadyAbsent: true, replayed: false })
      expect(admissionGrants).toBe(1)
      expect(currentIncarnationId).toBeNull()
    } finally {
      manager.dispose()
      store.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('rejects retirement before mutation when the relay did not grant support', async () => {
    const attempt = sshAuthorityRetirement()
    const mux = new FakeSshAuthorityMux(async () => {
      throw new Error('unexpected request')
    })
    const host = await connect(mux, false)

    await expect(host.retireNamespace(attempt.request)).rejects.toThrow('unsupported')
    expect(mux.requests).toHaveLength(0)
  })
})

async function connect(mux: FakeSshAuthorityMux, retirementSupported = true) {
  const slot = new TerminalAuthorityAppOutcomeHostTransportSlot(SSH_AUTHORITY_HOST_ID)
  slot.install(
    new SshTerminalAuthorityAppHostTransport({
      mux: mux.asMux(),
      authenticatedAuthorityHostId: SSH_AUTHORITY_HOST_ID,
      keypair: SSH_AUTHORITY_APP_KEYPAIR,
      consumerRetirementSupported: retirementSupported
    })
  )
  return await slot.connect({ onFailure: vi.fn() })
}

function sshTransport(mux: FakeSshAuthorityMux) {
  return new SshTerminalAuthorityAppHostTransport({
    mux: mux.asMux(),
    authenticatedAuthorityHostId: SSH_AUTHORITY_HOST_ID,
    keypair: SSH_AUTHORITY_APP_KEYPAIR,
    consumerRetirementSupported: true
  })
}

function admissionChallenge(
  start: TerminalAuthorityNamespaceAdmissionStart,
  connectionGrantId: string
) {
  const host = createTerminalAuthorityProofEphemeralKeypair()
  return Object.freeze({
    ...start,
    version: TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION,
    algorithm: TERMINAL_AUTHORITY_CONSUMER_PROOF_ALGORITHM,
    currentAdmissionCas: 'admission-cas:ssh-manager-current',
    connectionGrantId,
    authenticatedTransportPrincipal: 'ssh-principal:manager-test',
    authenticatedTransportCapability: 'ssh-capability:manager-test',
    hostEphemeralPublicKeyB64: Buffer.from(host.publicKey).toString('base64'),
    expiresAtMs: Date.now() + 30_000
  })
}

function admissionGrant(
  proof: TerminalAuthorityNamespaceAdmissionProof
): TerminalAuthorityNamespaceAdmissionGrant {
  const challenge = proof.challenge
  const consumer = Object.freeze({
    consumerId: terminalAuthorityHostAppConsumerId(
      challenge.namespace.authorityHostId,
      Uint8Array.from(Buffer.from(challenge.appPublicKeyB64, 'base64'))
    ),
    consumerIncarnationId: challenge.candidateProcessIncarnationId
  })
  return Object.freeze({
    version: TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION,
    consumer,
    namespace: challenge.namespace,
    requestId: challenge.requestId,
    connectionGrantId: challenge.connectionGrantId,
    admissionCas: terminalAuthorityAdmissionCas(
      challenge.namespace,
      consumer.consumerId,
      consumer.consumerIncarnationId
    ),
    replayed: false
  })
}

function completeBoundary(grant: TerminalAuthorityNamespaceAdmissionGrant) {
  const baseProjection = authorityProjection({ namespaceId: grant.namespace.namespaceId })
  const value = Object.freeze({
    version: 1 as const,
    consumer: grant.consumer,
    namespace: grant.namespace,
    acknowledgedSequence: 0,
    outcomeHighWatermark: 0,
    consumerStart: 'new-at-tail' as const,
    projection: Object.freeze({ ...baseProjection, namespace: grant.namespace })
  })
  return Object.freeze({ ...value, boundaryId: terminalSessionAuthorityBoundaryId(value) })
}

function retirementChallenge(
  start: TerminalAuthorityConsumerRetirementStart,
  currentConsumerIncarnationId: string | null,
  connectionGrantId: string
): TerminalAuthorityConsumerRetirementChallenge {
  const host = createTerminalAuthorityProofEphemeralKeypair()
  const consumerId = terminalAuthorityHostAppConsumerId(
    start.namespace.authorityHostId,
    Uint8Array.from(Buffer.from(start.appPublicKeyB64, 'base64'))
  )
  return Object.freeze({
    ...start,
    version: TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_VERSION,
    algorithm: TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_ALGORITHM,
    consumerId,
    currentConsumerIncarnationId,
    retirementCas: terminalAuthorityRetirementCas(
      start.namespace,
      consumerId,
      currentConsumerIncarnationId
    ),
    connectionGrantId,
    liveAdmission: null,
    authenticatedTransportPrincipal: 'ssh-principal:manager-test',
    authenticatedTransportCapability: 'ssh-capability:manager-test',
    hostEphemeralPublicKeyB64: Buffer.from(host.publicKey).toString('base64'),
    expiresAtMs: Date.now() + 30_000
  })
}

function retirementResult(
  challenge: TerminalAuthorityConsumerRetirementChallenge,
  alreadyAbsent: boolean
) {
  return Object.freeze({
    version: TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_VERSION,
    namespace: challenge.namespace,
    consumerId: challenge.consumerId,
    retiredConsumerIncarnationId: challenge.currentConsumerIncarnationId,
    requestId: challenge.requestId,
    candidateProcessIncarnationId: challenge.candidateProcessIncarnationId,
    candidateSessionNonce: challenge.candidateSessionNonce,
    connectionGrantId: challenge.connectionGrantId,
    retirementCas: challenge.retirementCas,
    retired: true as const,
    alreadyAbsent,
    replayed: false
  })
}
