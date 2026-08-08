import { describe, expect, it } from 'vitest'
import { parseOpenClientParams } from './ssh-pty-open-client-request'

describe('SSH PTY open-client exact capability parsing', () => {
  it('preserves exact and flow-control offers from the transport', () => {
    expect(
      parseOpenClientParams({
        protocolVersion: 1,
        clientInstanceId: 'client-1',
        requestedRole: 'session-owner',
        capabilities: {
          outputFlowControl: { versions: [1], requestedWindowSu: 64 },
          exactOperations: { versions: [1, '2'] },
          terminalAuthorityExactOperations: { versions: [1] },
          terminalAuthorityOutcomeDelivery: { versions: [1] }
        }
      }).capabilities
    ).toEqual({
      outputFlowControl: { versions: [1], requestedWindowSu: 64 },
      exactOperations: { versions: [1, 2] },
      terminalAuthorityExactOperations: { versions: [1] },
      terminalAuthorityOutcomeDelivery: { versions: [1] }
    })
  })

  it('keeps an old client capability-free', () => {
    expect(
      parseOpenClientParams({
        protocolVersion: 1,
        clientInstanceId: 'client-1',
        requestedRole: 'session-owner'
      }).capabilities
    ).toBeUndefined()
  })

  it('does not let the generic owner adapter mint the gateway-owned topology grant', () => {
    expect(
      parseOpenClientParams({
        protocolVersion: 1,
        clientInstanceId: 'client-1',
        requestedRole: 'session-owner',
        capabilities: { terminalAuthorityTopology: { versions: [1] } }
      }).capabilities
    ).toBeUndefined()
  })

  it('drops every terminal-authority offer from a subscriber', () => {
    expect(
      parseOpenClientParams({
        protocolVersion: 1,
        clientInstanceId: 'client-1',
        requestedRole: 'subscriber',
        capabilities: {
          outputFlowControl: { versions: [1], requestedWindowSu: 64 },
          terminalAuthorityExactOperations: { versions: [1] },
          terminalAuthorityOutcomeDelivery: { versions: [1] },
          terminalAuthorityConsumerProof: { versions: [1] },
          terminalAuthorityNamespaceOutcomes: {
            versions: [1],
            consumer: { consumerId: 'app-profile:a', consumerIncarnationId: 'app-process:a' },
            expectedConsumerIncarnationId: null
          }
        }
      }).capabilities
    ).toEqual({ outputFlowControl: { versions: [1], requestedWindowSu: 64 } })
  })

  it('drops a namespace-outcome offer whose consumer identity does not validate', () => {
    expect(
      parseOpenClientParams({
        protocolVersion: 1,
        clientInstanceId: 'client-1',
        requestedRole: 'session-owner',
        capabilities: {
          terminalAuthorityNamespaceOutcomes: {
            versions: [1],
            consumer: { consumerId: 42, consumerIncarnationId: null },
            expectedConsumerIncarnationId: null
          }
        }
      }).capabilities
    ).toBeUndefined()
  })

  it('preserves a validated consumer identity and an absent optional retirement offer', () => {
    expect(
      parseOpenClientParams({
        protocolVersion: 1,
        clientInstanceId: 'client-1',
        requestedRole: 'session-owner',
        capabilities: {
          terminalAuthorityConsumerProof: { versions: [1] },
          terminalAuthorityNamespaceOutcomes: {
            versions: [1],
            consumer: { consumerId: 'app-profile:a', consumerIncarnationId: 'app-process:a' },
            expectedConsumerIncarnationId: null
          }
        }
      }).capabilities
    ).toEqual({
      terminalAuthorityConsumerProof: { versions: [1] },
      terminalAuthorityNamespaceOutcomes: {
        versions: [1],
        consumer: { consumerId: 'app-profile:a', consumerIncarnationId: 'app-process:a' },
        expectedConsumerIncarnationId: null
      }
    })
  })
})
