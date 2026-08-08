import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { RelayDeviceBinding } from './relay/relay-revoke-outbox'
import { RelayRevokeOutbox } from './relay/relay-revoke-outbox'
import { loadOrCreateE2EEKeypair, type E2EEKeypair } from './e2ee-keypair'
import {
  E2EEIdentityResetCoordinator,
  type E2EEIdentityResetAuthorityTarget,
  type E2EEIdentityResetDependencies
} from './e2ee-identity-reset'
import type { TerminalAuthorityConsumerRetirementResult } from '../../shared/terminal-session-authority-consumer-retirement'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('E2EEIdentityResetCoordinator', () => {
  it('retires hosts, acknowledges Relay revocation, then publishes a successor', async () => {
    const userDataPath = createTemporaryDirectory()
    let current = loadOrCreateE2EEKeypair(userDataPath)
    const outbox = new RelayRevokeOutbox(userDataPath)
    const events: string[] = []
    const binding = relayBinding('relay-device')
    const authority = authorityTarget('host-a', ['namespace-a'], events)
    const dependencies = createDependencies({
      userDataPath,
      current: () => current,
      authorities: () => [authority],
      bindings: () => [binding],
      outbox,
      events,
      onSuccessorPublished: (keypair) => {
        current = keypair
        events.push('successor-published')
      }
    })
    const coordinator = new E2EEIdentityResetCoordinator(dependencies)

    const result = await coordinator.run()

    expect(result.phase).toBe('re-enrollment')
    expect(result.successorPublicKeyB64).not.toBe(result.transactionId)
    expect(current.publicKeyB64).toBe(result.successorPublicKeyB64)
    expect(coordinator.status()).toEqual({ inProgress: false, record: null })
    expect(events).toEqual([
      'freeze',
      'retire:host-a:namespace-a',
      'relay-revoke',
      'relay-ack',
      'close-transports',
      'remove-credentials',
      'successor-published',
      're-enrollment',
      'unfreeze'
    ])
    expect(outbox.listPending()).toEqual([])
  })

  it('keeps the predecessor and durable phase when a host is unreachable', async () => {
    const userDataPath = createTemporaryDirectory()
    const predecessor = loadOrCreateE2EEKeypair(userDataPath)
    const requestIds: string[] = []
    let attempt = 0
    const authority = authorityTarget(
      'host-offline',
      ['namespace-a'],
      [],
      async (_namespaceId, request) => {
        requestIds.push(request.requestId)
        attempt += 1
        throw new Error('host unreachable')
      }
    )
    const coordinator = new E2EEIdentityResetCoordinator(
      createDependencies({
        userDataPath,
        current: () => predecessor,
        authorities: () => [authority]
      })
    )

    await expect(coordinator.run()).rejects.toThrow('host unreachable')
    await expect(coordinator.run()).rejects.toThrow('host unreachable')

    expect(attempt).toBe(2)
    expect(requestIds[0]).toBe(requestIds[1])
    expect(coordinator.status().record?.phase).toBe('retiring-hosts')
    expect(loadOrCreateE2EEKeypair(userDataPath).publicKeyB64).toBe(predecessor.publicKeyB64)
  })

  it('does not rotate when Relay acknowledgement fails', async () => {
    const userDataPath = createTemporaryDirectory()
    const predecessor = loadOrCreateE2EEKeypair(userDataPath)
    const outbox = new RelayRevokeOutbox(userDataPath)
    const coordinator = new E2EEIdentityResetCoordinator(
      createDependencies({
        userDataPath,
        current: () => predecessor,
        outbox,
        bindings: () => [relayBinding('relay-device')],
        awaitRelayRevocations: async () => {
          throw new Error('relay unavailable')
        }
      })
    )

    await expect(coordinator.run()).rejects.toThrow('relay unavailable')

    expect(coordinator.status().record?.phase).toBe('revoking-relay')
    expect(outbox.listPending()).toHaveLength(1)
    expect(loadOrCreateE2EEKeypair(userDataPath).publicKeyB64).toBe(predecessor.publicKeyB64)
  })

  it('resumes after a crash between successor publication and acknowledgement', async () => {
    const userDataPath = createTemporaryDirectory()
    let current = loadOrCreateE2EEKeypair(userDataPath)
    let crash = true
    const coordinator = new E2EEIdentityResetCoordinator(
      createDependencies({
        userDataPath,
        current: () => current,
        onSuccessorPublished: (keypair) => {
          current = keypair
          if (crash) {
            crash = false
            throw new Error('crash cut')
          }
        }
      })
    )

    await expect(coordinator.run()).rejects.toThrow('crash cut')
    expect(coordinator.status().record?.phase).toBe('successor-published')
    const successorPublicKeyB64 = loadOrCreateE2EEKeypair(userDataPath).publicKeyB64

    const result = await coordinator.run()

    expect(result.successorPublicKeyB64).toBe(successorPublicKeyB64)
    expect(coordinator.status().record).toBeNull()
  })
})

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'orca-e2ee-reset-'))
  temporaryDirectories.push(directory)
  return directory
}

function relayBinding(relayDeviceId: string): RelayDeviceBinding {
  return {
    relayHostId: 'relay-host',
    relayDeviceId,
    ownerIdentityKey: 'owner-identity'
  }
}

function authorityTarget(
  authorityHostId: string,
  namespaceIds: readonly string[],
  events: string[],
  retireNamespace?: E2EEIdentityResetAuthorityTarget['retireNamespace']
): E2EEIdentityResetAuthorityTarget {
  return {
    target: { authorityHostId, namespaceIds },
    retireNamespace:
      retireNamespace ??
      (async (namespaceId, request) => {
        events.push(`retire:${authorityHostId}:${namespaceId}`)
        return retirementResult(request)
      })
  }
}

function createDependencies(options: {
  userDataPath: string
  current: () => E2EEKeypair | null
  authorities?: () => readonly E2EEIdentityResetAuthorityTarget[]
  bindings?: () => readonly RelayDeviceBinding[]
  outbox?: RelayRevokeOutbox
  events?: string[]
  onSuccessorPublished?: (keypair: E2EEKeypair) => void | Promise<void>
  awaitRelayRevocations?: E2EEIdentityResetDependencies['awaitRelayRevocations']
}): E2EEIdentityResetDependencies {
  const events = options.events ?? []
  const outbox = options.outbox ?? new RelayRevokeOutbox(options.userDataPath)
  return {
    userDataPath: options.userDataPath,
    currentKeypair: options.current,
    listAuthorityTargets: options.authorities ?? (() => []),
    freezeAuthorityAdmissions: () => events.push('freeze'),
    unfreezeAuthorityAdmissions: () => events.push('unfreeze'),
    closeLiveTransports: async () => {
      events.push('close-transports')
    },
    listRelayBindings: options.bindings ?? (() => []),
    enqueueRelayRevoke: (binding) => {
      events.push('relay-revoke')
      return outbox.enqueue(binding)
    },
    awaitRelayRevocations:
      options.awaitRelayRevocations ??
      (async (items) => {
        events.push('relay-ack')
        for (const item of items) {
          outbox.remove(item.reqId)
        }
      }),
    removeLocalCredentials: () => {
      events.push('remove-credentials')
    },
    onSuccessorPublished: options.onSuccessorPublished ?? (() => {}),
    onReEnrollment: () => {
      events.push('re-enrollment')
    }
  }
}

function retirementResult(
  request: Parameters<E2EEIdentityResetAuthorityTarget['retireNamespace']>[1]
): TerminalAuthorityConsumerRetirementResult {
  return {
    version: 1,
    namespace: request.namespace,
    consumerId: 'consumer-id',
    retiredConsumerIncarnationId: null,
    requestId: request.requestId,
    candidateProcessIncarnationId: request.candidateProcessIncarnationId,
    candidateSessionNonce: request.candidateSessionNonce,
    connectionGrantId: 'grant-id',
    retirementCas: 'retirement-cas',
    retired: true,
    alreadyAbsent: true,
    replayed: false
  }
}
