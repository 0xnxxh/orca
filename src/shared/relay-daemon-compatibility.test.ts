import { describe, expect, it } from 'vitest'
import {
  CURRENT_RELAY_DAEMON_COMPATIBILITY,
  negotiateRelayDaemonCompatibility,
  parseRelayDaemonCompatibilityOffer,
  relayDaemonGrantSatisfiesOffer
} from './relay-daemon-compatibility'
import { TERMINAL_AUTHORITY_TOPOLOGY_STREAM_CAPABILITY } from './terminal-authority-topology-stream-contract'

describe('relay daemon compatibility', () => {
  it('negotiates the newest overlapping minor and shared capabilities', () => {
    const grant = negotiateRelayDaemonCompatibility(
      {
        major: 3,
        minMinor: 1,
        maxMinor: 5,
        capabilities: ['base', 'exact', 'newer'],
        requiredCapabilities: ['base']
      },
      {
        major: 3,
        minMinor: 2,
        maxMinor: 4,
        capabilities: ['base', 'exact', 'client'],
        requiredCapabilities: ['exact']
      }
    )

    expect(grant).toEqual({ major: 3, minor: 4, capabilities: ['base', 'exact'] })
  })

  it.each([
    [
      { major: 1, minMinor: 0, maxMinor: 0, capabilities: ['base'], requiredCapabilities: [] },
      { major: 2, minMinor: 0, maxMinor: 0, capabilities: ['base'], requiredCapabilities: [] }
    ],
    [
      { major: 1, minMinor: 0, maxMinor: 1, capabilities: ['base'], requiredCapabilities: [] },
      { major: 1, minMinor: 2, maxMinor: 3, capabilities: ['base'], requiredCapabilities: [] }
    ],
    [
      {
        major: 1,
        minMinor: 0,
        maxMinor: 0,
        capabilities: ['base'],
        requiredCapabilities: ['base']
      },
      { major: 1, minMinor: 0, maxMinor: 0, capabilities: [], requiredCapabilities: [] }
    ]
  ])('rejects incompatible protocol offers', (server, client) => {
    expect(negotiateRelayDaemonCompatibility(server, client)).toBeNull()
  })

  it('rejects malformed offers before negotiation', () => {
    expect(
      parseRelayDaemonCompatibilityOffer({
        major: 1,
        minMinor: 2,
        maxMinor: 1,
        capabilities: [],
        requiredCapabilities: []
      })
    ).toBeNull()
    expect(
      parseRelayDaemonCompatibilityOffer({
        major: 1,
        minMinor: 0,
        maxMinor: 0,
        capabilities: [],
        requiredCapabilities: ['missing']
      })
    ).toBeNull()
  })

  it('requires every mandatory capability while allowing an optional topology omission', () => {
    expect(
      relayDaemonGrantSatisfiesOffer(
        { major: 1, minor: 0, capabilities: ['relay.rpc.v1'] },
        CURRENT_RELAY_DAEMON_COMPATIBILITY
      )
    ).toBe(false)
    expect(
      relayDaemonGrantSatisfiesOffer(
        {
          major: 1,
          minor: 0,
          capabilities: [
            'relay.rpc.v1',
            'terminal-session.authority.v1',
            'terminal-session.distributed-control.v1',
            'remote-cli.relay-install.v1'
          ]
        },
        CURRENT_RELAY_DAEMON_COMPATIBILITY
      )
    ).toBe(true)
  })

  it('keeps topology optional in both mixed-version directions', () => {
    const withoutTopology = {
      ...CURRENT_RELAY_DAEMON_COMPATIBILITY,
      capabilities: CURRENT_RELAY_DAEMON_COMPATIBILITY.capabilities.filter(
        (capability) => capability !== TERMINAL_AUTHORITY_TOPOLOGY_STREAM_CAPABILITY
      )
    }

    expect(
      negotiateRelayDaemonCompatibility(CURRENT_RELAY_DAEMON_COMPATIBILITY, withoutTopology)
        ?.capabilities
    ).not.toContain(TERMINAL_AUTHORITY_TOPOLOGY_STREAM_CAPABILITY)
    expect(
      negotiateRelayDaemonCompatibility(withoutTopology, CURRENT_RELAY_DAEMON_COMPATIBILITY)
        ?.capabilities
    ).not.toContain(TERMINAL_AUTHORITY_TOPOLOGY_STREAM_CAPABILITY)
  })

  it.each([
    [
      'distributed control fencing',
      ['relay.rpc.v1', 'terminal-session.authority.v1', 'remote-cli.relay-install.v1']
    ],
    [
      'single-channel remote CLI installation',
      ['relay.rpc.v1', 'terminal-session.authority.v1', 'terminal-session.distributed-control.v1']
    ]
  ])('rejects a stable authority that predates %s', (_contract, capabilities) => {
    expect(
      negotiateRelayDaemonCompatibility(
        {
          major: 1,
          minMinor: 0,
          maxMinor: 0,
          capabilities,
          requiredCapabilities: capabilities
        },
        CURRENT_RELAY_DAEMON_COMPATIBILITY
      )
    ).toBeNull()
  })
})
