import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TerminalAuthorityAuthenticatedNamespacePreparation } from '../main/session-authority/terminal-session-authority-authenticated-consumers'
import type { TerminalAuthorityAuthenticatedConsumerTransport } from '../main/session-authority/terminal-session-authority-consumer-admission'
import {
  createTerminalAuthorityConsumerProof,
  createTerminalAuthorityConsumerRetirementProof,
  createTerminalAuthorityProofEphemeralKeypair,
  terminalAuthorityAdmissionCas,
  terminalAuthorityHostAppConsumerId,
  terminalAuthorityRetirementCas
} from '../main/session-authority/terminal-session-authority-consumer-proof'
import type { TerminalSessionAuthorityPtyLifecycle } from '../main/session-authority/terminal-session-authority-pty-lifecycle'
import type { TerminalAuthorityPolicyConsumerConnection } from '../main/session-authority/terminal-session-authority-policy-consumers'
import {
  TERMINAL_AUTHORITY_CONSUMER_PROOF_ALGORITHM,
  TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION,
  type TerminalAuthorityNamespaceAdmissionProof,
  type TerminalAuthorityNamespaceAdmissionStart
} from '../shared/terminal-session-authority-consumer-proof'
import {
  TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_ALGORITHM,
  TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_VERSION,
  type TerminalAuthorityConsumerRetirementProof,
  type TerminalAuthorityConsumerRetirementStart
} from '../shared/terminal-session-authority-consumer-retirement'
import type { TerminalAuthorityNamespace } from '../shared/terminal-session-authority-identity'
import { RelayDispatcher, type RelayClientSessionIdentity } from './dispatcher'
import { encodeJsonRpcFrame, MessageType } from './protocol'
import { SshPtyConsumerSessionAdapter } from './ssh-pty-consumer-session-adapter'
import {
  SSH_TERMINAL_AUTHORITY_CONSUMER_CHALLENGE_METHOD,
  SSH_TERMINAL_AUTHORITY_CONSUMER_GRANT_METHOD,
  SSH_TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_CHALLENGE_METHOD,
  SSH_TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_METHOD,
  SSH_TERMINAL_AUTHORITY_CONSUMER_RESOLVE_NAMESPACE_METHOD
} from '../main/ssh/ssh-terminal-authority-consumer-methods'

const HOST_ID = 'authority-host:ssh-policy-test'
const NAMESPACE: TerminalAuthorityNamespace = Object.freeze({
  authorityHostId: HOST_ID,
  namespaceId: 'namespace:ssh-policy-test'
})
const APP_KEYPAIR = createTerminalAuthorityProofEphemeralKeypair()
const CONSUMER = Object.freeze({
  consumerId: terminalAuthorityHostAppConsumerId(HOST_ID, APP_KEYPAIR.publicKey),
  consumerIncarnationId: 'app-process:ssh-policy-test'
})
const PRINCIPAL: RelayClientSessionIdentity = Object.freeze({
  principal: 'endpoint-principal:a',
  authenticated: true,
  allowSessionOwner: true,
  authenticationKind: 'endpoint-credential'
})
const dispatchers: RelayDispatcher[] = []

afterEach(() => {
  for (const dispatcher of dispatchers.splice(0)) {
    dispatcher.dispose()
  }
})

describe('SSH terminal authority policy consumers', () => {
  it('derives identity through proof and admits exact mutations only after committed installation', async () => {
    const connection = fakeConnection()
    const lifecycle = fakeLifecycle(connection)
    const { adapter, writes } = createAdapter(lifecycle)

    feedOpen(dispatchers[0]!)
    await waitForWrites(writes, 1)
    expect(responseResult(writes[0])).toMatchObject({
      capabilities: {
        terminalAuthorityExactOperations: { version: 1 },
        terminalAuthorityConsumerProof: { version: 1, authorityHostId: HOST_ID }
      }
    })
    expect(responseResult(writes[0])).not.toHaveProperty(
      'capabilities.terminalAuthorityNamespaceOutcomes'
    )
    expect(adapter.terminalAuthorityExactOperations(1)).toBe(false)

    const proof = await requestProof(dispatchers[0]!, writes)
    feedRequest(dispatchers[0]!, 3, 3, SSH_TERMINAL_AUTHORITY_CONSUMER_GRANT_METHOD, { proof })
    await waitForWrites(writes, 3)

    expect(responseResult(writes[2])).toMatchObject({ consumer: CONSUMER, namespace: NAMESPACE })
    expect(adapter.terminalAuthorityExactOperations(1)).toBe(true)
    expect(lifecycle.prepareAuthenticatedPolicyConsumerNamespace).toHaveBeenCalledOnce()
  })

  it('installs the proof transport before the open-client write settles', async () => {
    const lifecycle = fakeLifecycle(fakeConnection())
    const { writes, heldSettlements } = createAdapter(lifecycle, undefined, 1)

    feedOpen(dispatchers[0]!)
    await waitForWrites(writes, 1)
    feedRequest(dispatchers[0]!, 2, 2, SSH_TERMINAL_AUTHORITY_CONSUMER_RESOLVE_NAMESPACE_METHOD, {
      worktreeId: 'repo::/workspace'
    })
    await waitForWrites(writes, 2)

    expect(responseResult(writes[1])).toEqual(NAMESPACE)
    expect(lifecycle.resolvePolicyConsumerNamespace).toHaveBeenCalledOnce()
    heldSettlements[0]?.({ ok: true })
  })

  it('installs the proof transport before an immediate follow-up request can run', async () => {
    const lifecycle = fakeLifecycle(fakeConnection())
    const { adapter, writes } = createAdapter(lifecycle)

    feedOpen(dispatchers[0]!)
    feedRequest(dispatchers[0]!, 2, 2, SSH_TERMINAL_AUTHORITY_CONSUMER_RESOLVE_NAMESPACE_METHOD, {
      worktreeId: 'repo::/workspace'
    })

    await waitForWrites(writes, 2)

    expect(adapter.hasActiveClient(1)).toBe(true)
    expect(adapter.terminalAuthorityExactOperations(1)).toBe(false)
    expect(responseResult(writes[1])).toEqual(NAMESPACE)
  })

  it('commits before a grant response and never rolls durability back on write failure', async () => {
    const connection = fakeConnection()
    const lifecycle = fakeLifecycle(connection)
    const rollback = lifecycle.rollback
    const commit = lifecycle.commit
    const { adapter, writes } = createAdapter(lifecycle, 3)

    feedOpen(dispatchers[0]!)
    await waitForWrites(writes, 1)
    const proof = await requestProof(dispatchers[0]!, writes)
    feedRequest(dispatchers[0]!, 3, 3, SSH_TERMINAL_AUTHORITY_CONSUMER_GRANT_METHOD, { proof })
    await waitForWrites(writes, 3)
    await vi.waitFor(() => expect(commit).toHaveBeenCalledOnce())

    expect(rollback).not.toHaveBeenCalled()
    expect(adapter.terminalAuthorityExactOperations(1)).toBe(false)
  })

  it('surfaces primary and rollback failures when grant cleanup fails', async () => {
    const connection = fakeConnection()
    const lifecycle = fakeLifecycle(connection)
    const primaryFailure = new Error('grant commit failed')
    const rollbackFailure = new Error('grant rollback failed')
    lifecycle.prepareAuthenticatedPolicyConsumerNamespace.mockImplementationOnce(async (proof) => {
      const preparation = preparationFor(proof, connection, lifecycle.commit, lifecycle.rollback)
      return Object.freeze({
        ...preparation,
        commit: async () => {
          throw primaryFailure
        },
        rollback: async () => {
          throw rollbackFailure
        }
      })
    })
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { writes } = createAdapter(lifecycle)
      feedOpen(dispatchers[0]!)
      await waitForWrites(writes, 1)
      const proof = await requestProof(dispatchers[0]!, writes)
      feedRequest(dispatchers[0]!, 3, 3, SSH_TERMINAL_AUTHORITY_CONSUMER_GRANT_METHOD, { proof })
      await waitForWrites(writes, 3)

      const reported = report.mock.calls.at(-1)?.[1]
      expect(reported).toBeInstanceOf(AggregateError)
      expect((reported as AggregateError).errors).toEqual([primaryFailure, rollbackFailure])
      expect(responsePayload(writes[2])).toHaveProperty('error')
    } finally {
      report.mockRestore()
    }
  })

  it('withholds the grant response until the host commit settles', async () => {
    const connection = fakeConnection()
    const lifecycle = fakeLifecycle(connection)
    const committed = deferred<void>()
    lifecycle.prepareAuthenticatedPolicyConsumerNamespace.mockImplementationOnce(async (proof) => {
      const preparation = preparationFor(proof, connection, lifecycle.commit, lifecycle.rollback)
      return Object.freeze({
        ...preparation,
        commit: async () => {
          await committed.promise
          return await preparation.commit()
        }
      })
    })
    const { writes } = createAdapter(lifecycle)
    feedOpen(dispatchers[0]!)
    await waitForWrites(writes, 1)
    const proof = await requestProof(dispatchers[0]!, writes)

    feedRequest(dispatchers[0]!, 3, 3, SSH_TERMINAL_AUTHORITY_CONSUMER_GRANT_METHOD, { proof })
    await vi.waitFor(() =>
      expect(lifecycle.prepareAuthenticatedPolicyConsumerNamespace).toHaveBeenCalledOnce()
    )
    expect(writes).toHaveLength(2)
    committed.resolve()
    await waitForWrites(writes, 3)
    expect(responseResult(writes[2])).toMatchObject({ consumer: CONSUMER, namespace: NAMESPACE })
  })

  it('resolves namespaces only after the proof transport grant is published', async () => {
    const lifecycle = fakeLifecycle(fakeConnection())
    const { writes } = createAdapter(lifecycle)

    feedRequest(dispatchers[0]!, 1, 1, SSH_TERMINAL_AUTHORITY_CONSUMER_RESOLVE_NAMESPACE_METHOD, {
      worktreeId: 'repo::/workspace'
    })
    await waitForWrites(writes, 1)
    expect(responsePayload(writes[0])).toHaveProperty('error')

    feedOpen(dispatchers[0]!, 2, 2)
    await waitForWrites(writes, 2)
    feedRequest(dispatchers[0]!, 3, 3, SSH_TERMINAL_AUTHORITY_CONSUMER_RESOLVE_NAMESPACE_METHOD, {
      worktreeId: 'repo::/workspace'
    })
    await waitForWrites(writes, 3)

    expect(responseResult(writes[2])).toEqual(NAMESPACE)
    expect(lifecycle.resolvePolicyConsumerNamespace).toHaveBeenCalledWith('repo::/workspace')
  })

  it('retains no authenticated namespace when the client disconnects', async () => {
    const connection = fakeConnection()
    const lifecycle = fakeLifecycle(connection)
    const { adapter, writes } = createAdapter(lifecycle)
    feedOpen(dispatchers[0]!)
    await waitForWrites(writes, 1)
    const proof = await requestProof(dispatchers[0]!, writes)
    feedRequest(dispatchers[0]!, 3, 3, SSH_TERMINAL_AUTHORITY_CONSUMER_GRANT_METHOD, { proof })
    await waitForWrites(writes, 3)
    expect(adapter.terminalAuthorityExactOperations(1)).toBe(true)

    dispatchers[0]!.invalidateClient('peer-closed')

    expect(adapter.terminalAuthorityExactOperations(1)).toBe(false)
    expect(lifecycle.releaseAuthenticatedPolicyConsumerTransport).toHaveBeenCalledOnce()
  })

  it('reports a rollback failure when a client disconnects during a pending commit', async () => {
    const connection = fakeConnection()
    const lifecycle = fakeLifecycle(connection)
    const commitStarted = deferred<void>()
    const releaseCommit = deferred<void>()
    const rollbackFailure = new Error('disconnect rollback failed')
    lifecycle.prepareAuthenticatedPolicyConsumerNamespace.mockImplementationOnce(async (proof) => {
      const preparation = preparationFor(proof, connection, lifecycle.commit, lifecycle.rollback)
      return Object.freeze({
        ...preparation,
        commit: async () => {
          commitStarted.resolve()
          await releaseCommit.promise
          return await preparation.commit()
        },
        rollback: async () => {
          throw rollbackFailure
        }
      })
    })
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { writes } = createAdapter(lifecycle)
      feedOpen(dispatchers[0]!)
      await waitForWrites(writes, 1)
      const proof = await requestProof(dispatchers[0]!, writes)
      feedRequest(dispatchers[0]!, 3, 3, SSH_TERMINAL_AUTHORITY_CONSUMER_GRANT_METHOD, { proof })
      await commitStarted.promise

      dispatchers[0]!.invalidateClient('peer-closed')
      await vi.waitFor(() => expect(report).toHaveBeenCalled())
      expect(
        report.mock.calls.some((call) =>
          (call[1] as AggregateError)?.errors?.includes(rollbackFailure)
        )
      ).toBe(true)

      releaseCommit.resolve()
    } finally {
      releaseCommit.resolve()
      report.mockRestore()
    }
  })

  it('rolls back a preparation that resolves after its client disconnects', async () => {
    const connection = fakeConnection()
    const lifecycle = fakeLifecycle(connection)
    const gate = deferred<void>()
    lifecycle.prepareAuthenticatedPolicyConsumerNamespace.mockImplementationOnce(
      async (proof: TerminalAuthorityNamespaceAdmissionProof) => {
        await gate.promise
        return preparationFor(proof, connection, lifecycle.commit, lifecycle.rollback)
      }
    )
    const { adapter, writes } = createAdapter(lifecycle)
    feedOpen(dispatchers[0]!)
    await waitForWrites(writes, 1)
    const proof = await requestProof(dispatchers[0]!, writes)
    feedRequest(dispatchers[0]!, 3, 3, SSH_TERMINAL_AUTHORITY_CONSUMER_GRANT_METHOD, { proof })
    await vi.waitFor(() =>
      expect(lifecycle.prepareAuthenticatedPolicyConsumerNamespace).toHaveBeenCalledOnce()
    )

    dispatchers[0]!.invalidateClient('peer-closed')
    gate.resolve()

    await vi.waitFor(() => expect(lifecycle.rollback).toHaveBeenCalledOnce())
    expect(lifecycle.commit).not.toHaveBeenCalled()
    expect(adapter.terminalAuthorityExactOperations(1)).toBe(false)
  })

  it('returns an authenticated durable absence without claiming the consumer', async () => {
    const lifecycle = fakeLifecycle(fakeConnection())
    const { writes } = createAdapter(lifecycle)
    feedOpen(dispatchers[0]!)
    await waitForWrites(writes, 1)
    const proof = await requestRetirementProof(dispatchers[0]!, writes)

    feedRequest(dispatchers[0]!, 3, 3, SSH_TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_METHOD, { proof })
    await waitForWrites(writes, 3)

    expect(responseResult(writes[2])).toMatchObject({
      consumerId: CONSUMER.consumerId,
      retired: true,
      alreadyAbsent: true
    })
    expect(lifecycle.retireAuthenticatedPolicyConsumer).toHaveBeenCalledOnce()
    expect(lifecycle.prepareAuthenticatedPolicyConsumerNamespace).not.toHaveBeenCalled()
  })

  it('rejects retirement before mutation when it was not negotiated', async () => {
    const lifecycle = fakeLifecycle(fakeConnection())
    const { writes } = createAdapter(lifecycle)
    feedOpen(dispatchers[0]!, 1, 1, false)
    await waitForWrites(writes, 1)

    feedRequest(
      dispatchers[0]!,
      2,
      2,
      SSH_TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_CHALLENGE_METHOD,
      { start: retirementStart() }
    )
    await waitForWrites(writes, 2)

    expect(responsePayload(writes[1])).toHaveProperty('error')
    expect(lifecycle.issuePolicyConsumerRetirementChallenge).not.toHaveBeenCalled()
  })

  // The proofless owner admission stays for legacy PTY compatibility. This pins the isolation that
  // makes it safe: no client consumer record exists, so no challenge, no claim, and no authority
  // journal mutation are reachable from it.
  it('isolates a proofless owner from every authority admission and mutation seam', async () => {
    const lifecycle = fakeLifecycle(fakeConnection())
    const { adapter, writes } = createAdapter(lifecycle)

    feedRequest(dispatchers[0]!, 1, 1, 'pty.openClient', {
      protocolVersion: 1,
      clientInstanceId: 'client-legacy',
      requestedRole: 'session-owner',
      capabilities: { terminalAuthorityExactOperations: { versions: [1] } }
    })
    await waitForWrites(writes, 1)

    const grant = responseResult(writes[0])
    expect(grant).toMatchObject({ role: 'session-owner' })
    expect(grant.capabilities).not.toHaveProperty('terminalAuthorityConsumerProof')
    expect(adapter.terminalAuthorityPolicyConsumer(1)).toBeNull()
    expect(adapter.terminalAuthorityExactOperations(1)).toBe(false)

    for (const [index, method] of [
      SSH_TERMINAL_AUTHORITY_CONSUMER_RESOLVE_NAMESPACE_METHOD,
      SSH_TERMINAL_AUTHORITY_CONSUMER_CHALLENGE_METHOD,
      SSH_TERMINAL_AUTHORITY_CONSUMER_GRANT_METHOD
    ].entries()) {
      feedRequest(dispatchers[0]!, index + 2, index + 2, method, {
        worktreeId: 'repo::/srv/repo',
        start: admissionStart(),
        proof: { version: TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION }
      })
      await waitForWrites(writes, index + 2)
      expect(responsePayload(writes[index + 1])).toHaveProperty('error')
    }

    expect(lifecycle.resolvePolicyConsumerNamespace).not.toHaveBeenCalled()
    expect(lifecycle.issuePolicyConsumerChallenge).not.toHaveBeenCalled()
    expect(lifecycle.prepareAuthenticatedPolicyConsumerNamespace).not.toHaveBeenCalled()
    expect(lifecycle.commit).not.toHaveBeenCalled()
  })
})

type FakeLifecycle = TerminalSessionAuthorityPtyLifecycle & {
  commit: ReturnType<typeof vi.fn>
  rollback: ReturnType<typeof vi.fn>
  prepareAuthenticatedPolicyConsumerNamespace: ReturnType<typeof vi.fn>
  releaseAuthenticatedPolicyConsumerTransport: ReturnType<typeof vi.fn>
  resolvePolicyConsumerNamespace: ReturnType<typeof vi.fn>
  issuePolicyConsumerRetirementChallenge: ReturnType<typeof vi.fn>
  retireAuthenticatedPolicyConsumer: ReturnType<typeof vi.fn>
}

function fakeLifecycle(connection: TerminalAuthorityPolicyConsumerConnection): FakeLifecycle {
  const hostEphemeral = createTerminalAuthorityProofEphemeralKeypair()
  const commit = vi.fn()
  const rollback = vi.fn(async () => {})
  const retirementHost = createTerminalAuthorityProofEphemeralKeypair()
  const lifecycle = {
    issuePolicyConsumerChallenge: vi.fn(
      async (
        start: TerminalAuthorityNamespaceAdmissionStart,
        transport: TerminalAuthorityAuthenticatedConsumerTransport
      ) => ({
        ...start,
        currentAdmissionCas: terminalAuthorityAdmissionCas(NAMESPACE, CONSUMER.consumerId, null),
        connectionGrantId: transport.connectionGrantId,
        authenticatedTransportPrincipal: transport.principal,
        authenticatedTransportCapability: transport.capability,
        hostEphemeralPublicKeyB64: Buffer.from(hostEphemeral.publicKey).toString('base64'),
        expiresAtMs: Date.now() + 30_000
      })
    ),
    prepareAuthenticatedPolicyConsumerNamespace: vi.fn(
      async (proof: TerminalAuthorityNamespaceAdmissionProof) =>
        preparationFor(proof, connection, commit, rollback)
    ),
    releaseAuthenticatedPolicyConsumerTransport: vi.fn(),
    resolvePolicyConsumerNamespace: vi.fn(async () => NAMESPACE),
    issuePolicyConsumerRetirementChallenge: vi.fn(
      async (
        start: TerminalAuthorityConsumerRetirementStart,
        transport: TerminalAuthorityAuthenticatedConsumerTransport
      ) => ({
        ...start,
        consumerId: CONSUMER.consumerId,
        currentConsumerIncarnationId: null,
        retirementCas: terminalAuthorityRetirementCas(NAMESPACE, CONSUMER.consumerId, null),
        connectionGrantId: transport.connectionGrantId,
        liveAdmission: null,
        authenticatedTransportPrincipal: transport.principal,
        authenticatedTransportCapability: transport.capability,
        hostEphemeralPublicKeyB64: Buffer.from(retirementHost.publicKey).toString('base64'),
        expiresAtMs: Date.now() + 30_000
      })
    ),
    retireAuthenticatedPolicyConsumer: vi.fn(
      async (proof: TerminalAuthorityConsumerRetirementProof) => ({
        version: TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_VERSION,
        namespace: NAMESPACE,
        consumerId: CONSUMER.consumerId,
        retiredConsumerIncarnationId: null,
        requestId: proof.challenge.requestId,
        candidateProcessIncarnationId: proof.challenge.candidateProcessIncarnationId,
        candidateSessionNonce: proof.challenge.candidateSessionNonce,
        connectionGrantId: proof.challenge.connectionGrantId,
        retirementCas: proof.challenge.retirementCas,
        retired: true,
        alreadyAbsent: true,
        replayed: false
      })
    ),
    commit,
    rollback
  }
  return lifecycle as unknown as FakeLifecycle
}

function preparationFor(
  proof: TerminalAuthorityNamespaceAdmissionProof,
  connection: TerminalAuthorityPolicyConsumerConnection,
  commit: ReturnType<typeof vi.fn>,
  rollback: ReturnType<typeof vi.fn>
): TerminalAuthorityAuthenticatedNamespacePreparation {
  const grant = Object.freeze({
    version: TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION,
    consumer: CONSUMER,
    namespace: NAMESPACE,
    requestId: proof.challenge.requestId,
    connectionGrantId: proof.challenge.connectionGrantId,
    admissionCas: terminalAuthorityAdmissionCas(
      NAMESPACE,
      CONSUMER.consumerId,
      CONSUMER.consumerIncarnationId
    ),
    replayed: false
  })
  const session = Object.freeze({ grant, policyConsumer: connection, disconnect: vi.fn() })
  commit.mockImplementation(() => session)
  return Object.freeze({
    grant,
    policyConsumer: connection,
    commit: commit as TerminalAuthorityAuthenticatedNamespacePreparation['commit'],
    rollback: rollback as TerminalAuthorityAuthenticatedNamespacePreparation['rollback']
  })
}

function fakeConnection(): TerminalAuthorityPolicyConsumerConnection {
  return {
    identity: CONSUMER,
    activate: async () => {},
    ensureNamespace: async () => {},
    assertInstalled: () => {},
    acknowledge: async (ack) => ack.sequence,
    retire: async () => 0,
    isInstalled: () => true,
    disconnect: vi.fn()
  }
}

function createAdapter(
  lifecycle: TerminalSessionAuthorityPtyLifecycle,
  failWrite?: number,
  holdWrite?: number
) {
  const writes: Buffer[] = []
  const heldSettlements: ((result: { ok: true } | { ok: false; error: Error }) => void)[] = []
  const dispatcher = new RelayDispatcher(
    (data, settle) => {
      writes.push(Buffer.from(data))
      const writeNumber = writes.length
      if (holdWrite === writeNumber) {
        heldSettlements.push(settle)
        return true
      }
      settle(
        failWrite === writeNumber ? { ok: false, error: new Error('grant failed') } : { ok: true }
      )
      return true
    },
    { supportsWriteCallback: true },
    PRINCIPAL
  )
  dispatchers.push(dispatcher)
  const adapter = new SshPtyConsumerSessionAdapter(dispatcher, 'build-a', undefined, undefined, {
    terminalAuthorityExactOperations: true,
    terminalAuthorityPolicyConsumers: lifecycle,
    terminalAuthorityConsumerProofHostId: HOST_ID
  })
  return { adapter, writes, heldSettlements }
}

async function requestProof(
  dispatcher: RelayDispatcher,
  writes: readonly Buffer[]
): Promise<TerminalAuthorityNamespaceAdmissionProof> {
  const start = admissionStart()
  feedRequest(dispatcher, 2, 2, SSH_TERMINAL_AUTHORITY_CONSUMER_CHALLENGE_METHOD, { start })
  await waitForWrites(writes, 2)
  return createTerminalAuthorityConsumerProof(responseResult(writes[1]) as never, APP_KEYPAIR)
}

async function requestRetirementProof(
  dispatcher: RelayDispatcher,
  writes: readonly Buffer[]
): Promise<TerminalAuthorityConsumerRetirementProof> {
  const start = retirementStart()
  feedRequest(dispatcher, 2, 2, SSH_TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_CHALLENGE_METHOD, {
    start
  })
  await waitForWrites(writes, 2)
  return createTerminalAuthorityConsumerRetirementProof(
    responseResult(writes[1]) as never,
    APP_KEYPAIR
  )
}

function admissionStart(): TerminalAuthorityNamespaceAdmissionStart {
  return Object.freeze({
    version: TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION,
    algorithm: TERMINAL_AUTHORITY_CONSUMER_PROOF_ALGORITHM,
    namespace: NAMESPACE,
    appPublicKeyB64: Buffer.from(APP_KEYPAIR.publicKey).toString('base64'),
    candidateProcessIncarnationId: CONSUMER.consumerIncarnationId,
    candidateSessionNonce: 'app-session:ssh-policy-test',
    requestId: 'app-request:ssh-policy-test',
    intent: 'first'
  })
}

function retirementStart(): TerminalAuthorityConsumerRetirementStart {
  return Object.freeze({
    version: TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_VERSION,
    algorithm: TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_ALGORITHM,
    namespace: NAMESPACE,
    appPublicKeyB64: Buffer.from(APP_KEYPAIR.publicKey).toString('base64'),
    candidateProcessIncarnationId: CONSUMER.consumerIncarnationId,
    candidateSessionNonce: 'app-retirement-session:ssh-policy-test',
    requestId: 'app-retirement-request:ssh-policy-test'
  })
}

function feedOpen(dispatcher: RelayDispatcher, id = 1, sequence = 1, retirement = true): void {
  feedRequest(dispatcher, id, sequence, 'pty.openClient', {
    protocolVersion: 1,
    clientInstanceId: 'client-1',
    requestedRole: 'session-owner',
    capabilities: {
      terminalAuthorityExactOperations: { versions: [1] },
      terminalAuthorityConsumerProof: {
        versions: [1],
        ...(retirement ? { retirementVersions: [1] } : {})
      }
    }
  })
}

function feedRequest(
  dispatcher: RelayDispatcher,
  id: number,
  sequence: number,
  method: string,
  params: Record<string, unknown>
): void {
  dispatcher.feed(encodeJsonRpcFrame({ jsonrpc: '2.0', id, method, params }, sequence, 0))
}

function responseResult(buffer: Buffer): Record<string, unknown> {
  return responsePayload(buffer).result as Record<string, unknown>
}

function responsePayload(buffer: Buffer): Record<string, unknown> {
  expect(buffer[0]).toBe(MessageType.Regular)
  const length = buffer.readUInt32BE(9)
  return JSON.parse(buffer.subarray(13, 13 + length).toString('utf8'))
}

async function waitForWrites(writes: readonly Buffer[], count: number): Promise<void> {
  await vi.waitFor(() => expect(writes).toHaveLength(count))
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((accept) => {
    resolve = accept
  })
  return { promise, resolve }
}
