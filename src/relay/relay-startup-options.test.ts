import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { parseRelayStartupOptions } from './relay-startup-options'

const argv = (...args: string[]): string[] => ['node', 'relay.js', ...args]

describe('relay startup options', () => {
  it('uses the legacy role and working-directory socket by default', () => {
    expect(parseRelayStartupOptions(argv(), 'relay-home')).toMatchObject({
      connectMode: false,
      terminalAuthority: false,
      controlAdapter: false,
      sockPath: join('relay-home', 'relay.sock')
    })
  })

  it('parses a complete terminal authority owner claim', () => {
    expect(
      parseRelayStartupOptions(
        argv(
          '--detached',
          '--terminal-authority',
          '--authority-state-dir',
          'state',
          '--authority-marker-path',
          'marker',
          '--authority-process-token',
          'new-owner',
          '--authority-takeover-token',
          'old-owner',
          '--authority-takeover-revision',
          '7'
        )
      )
    ).toMatchObject({
      detached: true,
      terminalAuthority: true,
      controlAdapter: false,
      authorityOwner: {
        stateDir: 'state',
        markerPath: 'marker',
        processToken: 'new-owner',
        takeover: { ownerProcessToken: 'old-owner', revision: 7 }
      }
    })
  })

  it('parses the PTY-blocking control-adapter role', () => {
    expect(parseRelayStartupOptions(argv('--detached', '--control-adapter'))).toMatchObject({
      detached: true,
      terminalAuthority: false,
      controlAdapter: true
    })
  })

  it('parses one complete local authority gateway binding', () => {
    expect(
      parseRelayStartupOptions(
        argv(
          '--control-adapter',
          '--authority-gateway-marker-path',
          'active-endpoint',
          '--authority-gateway-host-id',
          'authority-host',
          '--authority-gateway-owner-instance',
          'owner-instance',
          '--authority-gateway-revision',
          '9'
        )
      )
    ).toMatchObject({
      controlAdapter: true,
      authorityGateway: {
        markerPath: 'active-endpoint',
        authorityHostId: 'authority-host',
        ownerInstanceId: 'owner-instance',
        revision: 9
      }
    })
  })

  it('parses one exact authority expectation in connect mode', () => {
    expect(
      parseRelayStartupOptions(
        argv(
          '--connect',
          '--authority-expect-host-id',
          'authority-host',
          '--authority-expect-owner-instance',
          'owner-instance',
          '--authority-expect-revision',
          '9'
        )
      )
    ).toMatchObject({
      connectMode: true,
      authorityConnectExpectation: {
        authorityHostId: 'authority-host',
        ownerInstanceId: 'owner-instance',
        revision: 9
      }
    })
  })

  it('parses launch-fence ownership for connect and detached control modes', () => {
    expect(
      parseRelayStartupOptions(
        argv('--connect', '--release-launch-gc-claim-owner', 'gc-owner-token-0001')
      )
    ).toMatchObject({
      launchFence: { gcClaimOwnerToken: 'gc-owner-token-0001' }
    })
    expect(
      parseRelayStartupOptions(
        argv(
          '--detached',
          '--control-adapter',
          '--release-launch-install-lock',
          '--release-launch-install-lock-owner',
          'install-owner-token-0001'
        )
      )
    ).toMatchObject({
      launchFence: {
        releaseInstallLock: true,
        installLockOwnerToken: 'install-owner-token-0001'
      }
    })
  })

  it.each([
    ['missing owner claim', argv('--terminal-authority')],
    ['partial owner claim', argv('--terminal-authority', '--authority-state-dir', 'state')],
    [
      'owner claim outside authority mode',
      argv(
        '--authority-state-dir',
        'state',
        '--authority-marker-path',
        'marker',
        '--authority-process-token',
        'owner'
      )
    ],
    [
      'partial takeover',
      argv(
        '--terminal-authority',
        '--authority-state-dir',
        'state',
        '--authority-marker-path',
        'marker',
        '--authority-process-token',
        'owner',
        '--authority-takeover-token',
        'old-owner'
      )
    ],
    [
      'invalid takeover revision',
      argv(
        '--terminal-authority',
        '--authority-state-dir',
        'state',
        '--authority-marker-path',
        'marker',
        '--authority-process-token',
        'owner',
        '--authority-takeover-token',
        'old-owner',
        '--authority-takeover-revision',
        '0'
      )
    ],
    [
      'conflicting relay roles',
      argv(
        '--terminal-authority',
        '--control-adapter',
        '--authority-state-dir',
        'state',
        '--authority-marker-path',
        'marker',
        '--authority-process-token',
        'owner'
      )
    ],
    [
      'partial gateway binding',
      argv(
        '--control-adapter',
        '--authority-gateway-marker-path',
        'active-endpoint',
        '--authority-gateway-host-id',
        'authority-host',
        '--authority-gateway-owner-instance',
        'owner-instance'
      )
    ],
    [
      'gateway binding without host identity',
      argv(
        '--control-adapter',
        '--authority-gateway-marker-path',
        'active-endpoint',
        '--authority-gateway-owner-instance',
        'owner-instance',
        '--authority-gateway-revision',
        '9'
      )
    ],
    [
      'gateway binding outside control mode',
      argv(
        '--authority-gateway-marker-path',
        'active-endpoint',
        '--authority-gateway-host-id',
        'authority-host',
        '--authority-gateway-owner-instance',
        'owner-instance',
        '--authority-gateway-revision',
        '9'
      )
    ],
    [
      'partial authority connect expectation',
      argv(
        '--connect',
        '--authority-expect-host-id',
        'authority-host',
        '--authority-expect-owner-instance',
        'owner-instance'
      )
    ],
    [
      'authority expectation outside connect mode',
      argv(
        '--authority-expect-host-id',
        'authority-host',
        '--authority-expect-owner-instance',
        'owner-instance',
        '--authority-expect-revision',
        '9'
      )
    ],
    [
      'malformed authority expectation revision',
      argv(
        '--connect',
        '--authority-expect-host-id',
        'authority-host',
        '--authority-expect-owner-instance',
        'owner-instance',
        '--authority-expect-revision',
        '9junk'
      )
    ],
    ['launch fence outside a live control path', argv('--release-launch-install-lock')],
    ['install fence without owner identity', argv('--connect', '--release-launch-install-lock')],
    ['malformed launch GC owner', argv('--connect', '--release-launch-gc-claim-owner', '../claim')]
  ])('rejects %s', (_name, args) => {
    expect(() => parseRelayStartupOptions(args)).toThrow()
  })
})
