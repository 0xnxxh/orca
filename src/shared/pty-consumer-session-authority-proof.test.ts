import { describe, expect, it } from 'vitest'
import {
  PTY_CONSUMER_SESSION_PROTOCOL_VERSION,
  PtyConsumerSession,
  type PtyConsumerAuthentication,
  type PtyConsumerSessionHello
} from './pty-consumer-session'
import { TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION } from './terminal-session-authority-consumer-proof'
import { TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_VERSION } from './terminal-session-authority-consumer-transport'

const AUTHORITY_HOST_ID = 'authority-host:ssh-proof-test'

describe('PTY consumer authority proof negotiation', () => {
  it('grants proof admission only when both current peers negotiate it', () => {
    const session = proofHost()

    const admission = session.admit(proofClient(), authentication('connection:new-new'))

    expect(admission.grant.protocolVersion).toBe(PTY_CONSUMER_SESSION_PROTOCOL_VERSION)
    expect(admission.grant.capabilities?.terminalAuthorityConsumerProof).toEqual({
      version: TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION,
      authorityHostId: AUTHORITY_HOST_ID
    })
  })

  it('keeps a new client on omission behavior with an older host', () => {
    const session = new PtyConsumerSession({ serverBuildId: 'relay-build' })

    const admission = session.admit(proofClient(), authentication('connection:new-old'))

    expect(admission.grant.capabilities?.terminalAuthorityConsumerProof).toBeUndefined()
  })

  it('keeps an older client on omission behavior with a new host', () => {
    const session = proofHost()

    const admission = session.admit(
      {
        clientInstanceId: 'client:old-new',
        requestedRole: 'session-owner'
      },
      authentication('connection:old-new')
    )

    expect(admission.grant.capabilities?.terminalAuthorityConsumerProof).toBeUndefined()
  })

  it('never falls back from an offered proof to a client-supplied legacy consumer', () => {
    const client = proofClient()
    client.capabilities = {
      ...client.capabilities,
      terminalAuthorityConsumerProof: { versions: [2] },
      terminalAuthorityNamespaceOutcomes: {
        versions: [TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_VERSION],
        consumer: {
          consumerId: 'app-profile:client-supplied',
          consumerIncarnationId: 'app-process:client-supplied'
        },
        expectedConsumerIncarnationId: null
      }
    }
    const host = new PtyConsumerSession({
      serverBuildId: 'relay-build',
      terminalAuthorityConsumerProof: {
        versions: [TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION],
        authorityHostId: AUTHORITY_HOST_ID
      },
      terminalAuthorityNamespaceOutcomes: {
        versions: [TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_VERSION]
      }
    })

    const admission = host.admit(client, authentication('connection:proof-downgrade'))

    expect(admission.grant.capabilities?.terminalAuthorityConsumerProof).toBeUndefined()
    expect(admission.grant.capabilities?.terminalAuthorityNamespaceOutcomes).toBeUndefined()
  })

  it('rejects an invalid proof capability without allocating an owner grant', () => {
    const session = proofHost()
    const hello = proofClient()
    hello.capabilities!.terminalAuthorityConsumerProof!.versions = Array.from(
      { length: 9 },
      (_, index) => index + 1
    )

    expect(() => session.admit(hello, authentication('connection:invalid'))).toThrow(
      'terminalAuthorityConsumerProof.versions'
    )
    expect(session.activeGrant('connection:invalid')).toBeNull()
  })
})

function proofHost(): PtyConsumerSession {
  return new PtyConsumerSession({
    serverBuildId: 'relay-build',
    terminalAuthorityConsumerProof: {
      versions: [TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION],
      authorityHostId: AUTHORITY_HOST_ID
    }
  })
}

function proofClient(): PtyConsumerSessionHello {
  return {
    clientInstanceId: 'client:new',
    requestedRole: 'session-owner',
    capabilities: {
      terminalAuthorityConsumerProof: {
        versions: [TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION]
      }
    }
  }
}

function authentication(connectionId: string): PtyConsumerAuthentication {
  return {
    connectionId,
    principal: 'ssh-endpoint:authenticated',
    authenticated: true,
    allowSessionOwner: true
  }
}
