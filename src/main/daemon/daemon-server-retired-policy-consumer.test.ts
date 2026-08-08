import { afterEach, describe, expect, it, vi } from 'vitest'
import { DaemonServer } from './daemon-server'
import type { DaemonRequest } from './types'
import { DAEMON_TERMINAL_AUTHORITY_CONSUMER_GRANT_REQUEST } from './daemon-terminal-authority-consumer-requests'
import {
  TERMINAL_AUTHORITY_CONSUMER_PROOF_ALGORITHM,
  TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION,
  type TerminalAuthorityNamespaceAdmissionChallenge
} from '../../shared/terminal-session-authority-consumer-proof'
import {
  createTerminalAuthorityConsumerProof,
  createTerminalAuthorityProofEphemeralKeypair
} from '../session-authority/terminal-session-authority-consumer-proof'
import type { TerminalSessionAuthorityPtyOwner } from '../session-authority/terminal-session-authority-pty-owner'

type DaemonServerRouter = {
  routeRequest(clientId: string, request: DaemonRequest): Promise<unknown>
}

type DaemonServerAuthorityState = DaemonServerRouter & {
  releaseAuthenticatedPolicyTransport(client: unknown): void
  clients: Map<string, unknown>
}

const AUTHORITY_HOST_ID = 'authority-host:daemon-rollback-test'
const APP_KEYPAIR = createTerminalAuthorityProofEphemeralKeypair()

describe('dead terminal authority daemon requests', () => {
  let server: DaemonServer

  afterEach(async () => {
    await server?.shutdown()
  })

  it('rejects the retired proofless policy-consumer request before any mutation', async () => {
    server = new DaemonServer({
      socketPath: 'unused-daemon-socket',
      tokenPath: 'unused-daemon-token',
      spawnSubprocess: () => {
        throw new Error('subprocess spawn is not part of this request')
      }
    })

    await expect(
      (server as unknown as DaemonServerRouter).routeRequest('client-1', {
        id: 'retired-policy-consumer-request',
        type: 'retireTerminalAuthorityPolicyConsumer',
        payload: undefined
      } as unknown as DaemonRequest)
    ).rejects.toThrow('terminal authority policy consumer retirement is unsupported')
  })

  it('reports joined primary and rollback failures when transport cleanup fails', async () => {
    const rollbackFailure = new Error('transport rollback failed')
    const rollback = vi.fn(async (): Promise<void> => {
      throw rollbackFailure
    })
    const onFailure = vi.fn()
    server = new DaemonServer({
      socketPath: 'unused-daemon-socket',
      tokenPath: 'unused-daemon-token',
      spawnSubprocess: () => {
        throw new Error('subprocess spawn is not part of this request')
      },
      onTerminalSessionAuthorityFailure: onFailure
    })

    const daemon = server as unknown as DaemonServerAuthorityState
    daemon.releaseAuthenticatedPolicyTransport({
      authorityConsumerTransport: { token: {} },
      authorityPendingPreparations: new Set([
        {
          active: true,
          preparation: { rollback },
          acceptances: { close: vi.fn() }
        }
      ]),
      authorityNamespaceSessions: new Map()
    })

    await vi.waitFor(() => expect(onFailure).toHaveBeenCalledOnce())
    expect(rollback).toHaveBeenCalledOnce()
    const failure = onFailure.mock.calls[0]?.[0]
    expect(failure).toBeInstanceOf(AggregateError)
    expect((failure as AggregateError).errors).toEqual([
      expect.objectContaining({
        message: 'terminal authority consumer transport released during admission'
      }),
      rollbackFailure
    ])
  })

  it('returns joined primary and rollback failures from a grant cleanup failure', async () => {
    const { challenge, proof } = admissionProof()
    const primaryFailure = new Error('grant commit failed')
    const rollbackFailure = new Error('grant rollback failed')
    const preparation = {
      grant: {},
      policyConsumer: {},
      commit: vi.fn(async () => {
        throw primaryFailure
      }),
      rollback: vi.fn(async () => {
        throw rollbackFailure
      })
    }
    const owner = {
      prepareAuthenticatedPolicyConsumerNamespace: vi.fn(async () => preparation),
      releaseAuthenticatedPolicyConsumerTransport: vi.fn()
    } as unknown as TerminalSessionAuthorityPtyOwner
    server = new DaemonServer({
      socketPath: 'unused-daemon-socket',
      tokenPath: 'unused-daemon-token',
      spawnSubprocess: () => {
        throw new Error('subprocess spawn is not part of this request')
      },
      terminalSessionAuthority: { ptyOwner: owner }
    })

    const daemon = server as unknown as DaemonServerAuthorityState
    daemon.clients.set('client-1', {
      clientId: 'client-1',
      controlSocket: { destroy: vi.fn() },
      streamSocket: { destroy: vi.fn() },
      authenticatedPairEstablished: true,
      capabilities: {
        terminalAuthorityConsumerProof: { version: TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION }
      },
      authorityConsumerTransport: {
        connectionGrantId: challenge.connectionGrantId,
        principal: challenge.authenticatedTransportPrincipal,
        capability: challenge.authenticatedTransportCapability,
        token: {}
      },
      authorityPendingPreparations: new Set()
    })

    let failure: unknown
    try {
      await daemon.routeRequest('client-1', {
        id: 'grant-request',
        type: DAEMON_TERMINAL_AUTHORITY_CONSUMER_GRANT_REQUEST,
        payload: proof
      } as DaemonRequest)
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(AggregateError)
    expect((failure as AggregateError).errors).toEqual([primaryFailure, rollbackFailure])
    expect(preparation.rollback).toHaveBeenCalledOnce()
  })
})

function admissionProof(): {
  challenge: TerminalAuthorityNamespaceAdmissionChallenge
  proof: ReturnType<typeof createTerminalAuthorityConsumerProof>
} {
  const hostKeypair = createTerminalAuthorityProofEphemeralKeypair()
  const challenge: TerminalAuthorityNamespaceAdmissionChallenge = Object.freeze({
    version: TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION,
    algorithm: TERMINAL_AUTHORITY_CONSUMER_PROOF_ALGORITHM,
    namespace: Object.freeze({
      authorityHostId: AUTHORITY_HOST_ID,
      namespaceId: 'namespace:daemon-rollback-test'
    }),
    appPublicKeyB64: Buffer.from(APP_KEYPAIR.publicKey).toString('base64'),
    candidateProcessIncarnationId: 'app-process:daemon-rollback-test',
    candidateSessionNonce: 'app-session:daemon-rollback-test',
    requestId: 'app-request:daemon-rollback-test',
    intent: 'first',
    currentAdmissionCas: 'admission-cas:daemon-rollback-test',
    connectionGrantId: 'daemon-grant:daemon-rollback-test',
    authenticatedTransportPrincipal: 'daemon-principal:daemon-rollback-test',
    authenticatedTransportCapability: 'daemon-capability:daemon-rollback-test',
    hostEphemeralPublicKeyB64: Buffer.from(hostKeypair.publicKey).toString('base64'),
    expiresAtMs: Date.now() + 30_000
  })
  return { challenge, proof: createTerminalAuthorityConsumerProof(challenge, APP_KEYPAIR) }
}
