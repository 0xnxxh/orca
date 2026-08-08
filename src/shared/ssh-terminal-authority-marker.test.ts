import { describe, expect, it } from 'vitest'
import { CURRENT_RELAY_DAEMON_COMPATIBILITY } from './relay-daemon-compatibility'
import {
  SSH_TERMINAL_AUTHORITY_MARKER_VERSION,
  parseSshTerminalAuthorityMarker,
  parseTerminalAuthorityEndpointIdentity,
  sameTerminalAuthorityEndpointIdentity,
  terminalAuthorityEndpointIdentity,
  type SshTerminalAuthorityMarker
} from './ssh-terminal-authority-marker'

const marker: SshTerminalAuthorityMarker = {
  markerVersion: SSH_TERMINAL_AUTHORITY_MARKER_VERSION,
  authorityHostId: 'authority-host',
  ownerInstanceId: 'owner-instance',
  ownerPid: 42,
  ownerProcessToken: 'owner-process-token',
  ownerBuildId: '1.2.3+abcdef',
  ownerRelayDir: '/home/orca/.orca-remote/relay-v1',
  socketPath: '/home/orca/.orca-remote/relay-v1/relay.sock',
  credentialFile: '/home/orca/.orca-remote/relay-v1/relay.sock.credential',
  compatibility: CURRENT_RELAY_DAEMON_COMPATIBILITY,
  revision: 1
}

describe('SSH terminal authority marker', () => {
  it('accepts a bounded current marker', () => {
    expect(parseSshTerminalAuthorityMarker(marker)).toEqual(marker)
    expect(
      parseSshTerminalAuthorityMarker({
        ...marker,
        registryWriterOwnerToken: 'terminal-authority-owner-v1.proof'
      })
    ).toMatchObject({ registryWriterOwnerToken: 'terminal-authority-owner-v1.proof' })
  })

  it('projects and validates the exact socket endpoint identity', () => {
    const identity = terminalAuthorityEndpointIdentity(marker)
    expect(parseTerminalAuthorityEndpointIdentity(identity)).toEqual(identity)
    expect(sameTerminalAuthorityEndpointIdentity(identity, { ...identity })).toBe(true)
    expect(
      sameTerminalAuthorityEndpointIdentity(identity, {
        ...identity,
        revision: identity.revision + 1
      })
    ).toBe(false)
    expect(parseTerminalAuthorityEndpointIdentity({ ...identity, ownerInstanceId: '' })).toBeNull()
  })

  it.each([
    { ...marker, markerVersion: 2 },
    { ...marker, authorityHostId: '' },
    { ...marker, ownerPid: 0 },
    { ...marker, ownerProcessToken: '' },
    { ...marker, registryWriterOwnerToken: 'x'.repeat(1_025) },
    { ...marker, ownerBuildId: '' },
    { ...marker, ownerRelayDir: 'x'.repeat(4_097) },
    { ...marker, compatibility: { ...CURRENT_RELAY_DAEMON_COMPATIBILITY, major: -1 } },
    { ...marker, revision: 0 }
  ])('rejects malformed marker fields', (value) => {
    expect(parseSshTerminalAuthorityMarker(value)).toBeNull()
  })
})
