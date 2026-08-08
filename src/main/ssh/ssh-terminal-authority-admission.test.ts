import { describe, expect, it } from 'vitest'
import { CURRENT_RELAY_DAEMON_COMPATIBILITY } from '../../shared/relay-daemon-compatibility'
import { SSH_TERMINAL_AUTHORITY_MARKER_VERSION } from '../../shared/ssh-terminal-authority-marker'
import { getRemoteHostPlatform } from './ssh-remote-platform'
import {
  admitSshTerminalAuthority,
  admitSshTerminalAuthorityTakeover,
  SshTerminalAuthorityAdmissionError
} from './ssh-terminal-authority-admission'
import { sshTerminalAuthorityEndpoint } from './ssh-terminal-authority-endpoint'

const host = getRemoteHostPlatform('linux-x64')
const remoteHome = '/home/orca'
const endpoint = sshTerminalAuthorityEndpoint(host, remoteHome)
const marker = {
  markerVersion: SSH_TERMINAL_AUTHORITY_MARKER_VERSION,
  authorityHostId: 'authority-host',
  ownerInstanceId: 'owner-instance',
  ownerPid: 42,
  ownerProcessToken: 'owner-process-token',
  ownerBuildId: '1.2.3+abcdef',
  ownerRelayDir: '/home/orca/.orca-remote/relay-1.2.3+abcdef',
  socketPath: endpoint.socketPath,
  credentialFile: endpoint.credentialFile,
  compatibility: CURRENT_RELAY_DAEMON_COMPATIBILITY,
  revision: 7
} as const

function expectCode(run: () => unknown, code: string): void {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(SshTerminalAuthorityAdmissionError)
    expect((error as SshTerminalAuthorityAdmissionError).code).toBe(code)
    return
  }
  throw new Error(`Expected ${code}`)
}

describe('SSH terminal authority admission', () => {
  it('launches only after a positive absent marker', () => {
    expect(admitSshTerminalAuthority({ status: 'absent' }, host, remoteHome, endpoint)).toEqual({
      kind: 'launch-first-owner'
    })
    expectCode(
      () => admitSshTerminalAuthority({ status: 'inconclusive' }, host, remoteHome, endpoint),
      'discovery-inconclusive'
    )
  })

  it('admits an exact compatible live owner', () => {
    expect(
      admitSshTerminalAuthority({ status: 'available', marker }, host, remoteHome, endpoint)
    ).toMatchObject({
      kind: 'connect-owner',
      marker,
      compatibility: { major: 1, minor: 0 }
    })
  })

  it('rejects path substitution and incompatible owners before connection', () => {
    expectCode(
      () =>
        admitSshTerminalAuthority(
          { status: 'available', marker: { ...marker, socketPath: '/tmp/authority.sock' } },
          host,
          remoteHome,
          endpoint
        ),
      'marker-path-mismatch'
    )
    expectCode(
      () =>
        admitSshTerminalAuthority(
          {
            status: 'available',
            marker: {
              ...marker,
              compatibility: { ...CURRENT_RELAY_DAEMON_COMPATIBILITY, major: 99 }
            }
          },
          host,
          remoteHome,
          endpoint
        ),
      'owner-incompatible'
    )
  })

  it('authorizes takeover only after unchanged-marker exact owner death', () => {
    expect(
      admitSshTerminalAuthorityTakeover({
        expectedMarker: marker,
        rediscovery: { status: 'available', marker },
        ownerProof: 'owner-gone',
        host,
        remoteHome,
        endpoint
      })
    ).toEqual({ ownerProcessToken: marker.ownerProcessToken, revision: marker.revision })

    expectCode(
      () =>
        admitSshTerminalAuthorityTakeover({
          expectedMarker: marker,
          rediscovery: { status: 'available', marker: { ...marker, revision: 8 } },
          ownerProof: 'owner-gone',
          host,
          remoteHome,
          endpoint
        }),
      'owner-state-changed'
    )
    expectCode(
      () =>
        admitSshTerminalAuthorityTakeover({
          expectedMarker: marker,
          rediscovery: { status: 'available', marker },
          ownerProof: 'owner-alive',
          host,
          remoteHome,
          endpoint
        }),
      'owner-still-alive'
    )
    expectCode(
      () =>
        admitSshTerminalAuthorityTakeover({
          expectedMarker: marker,
          rediscovery: { status: 'available', marker },
          ownerProof: 'inspection-failed',
          host,
          remoteHome,
          endpoint
        }),
      'owner-proof-inconclusive'
    )
  })
})
