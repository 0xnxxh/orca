import { describe, expect, it } from 'vitest'
import {
  SSH_REMOTE_CLI_LAUNCHER_INSTALL_VERSION,
  parseSshRemoteCliLauncherInstallRequest,
  parseSshRemoteCliLauncherInstallResult
} from './ssh-remote-cli-launcher-install'

describe('SSH remote CLI launcher install protocol', () => {
  it('parses a bounded cross-platform request', () => {
    expect(
      parseSshRemoteCliLauncherInstallRequest({
        version: SSH_REMOTE_CLI_LAUNCHER_INSTALL_VERSION,
        binDir: 'C:\\Users\\me user\\.orca-relay\\bin',
        relayDir: 'C:\\Users\\me user\\.orca-relay\\relay',
        nodePath: 'C:\\Program Files\\nodejs\\node.exe',
        sockPath: '\\\\.\\pipe\\orca-relay',
        credentialFile: 'C:\\Users\\me user\\.orca-relay\\relay.credential'
      })
    ).toEqual({
      version: 1,
      binDir: 'C:\\Users\\me user\\.orca-relay\\bin',
      relayDir: 'C:\\Users\\me user\\.orca-relay\\relay',
      nodePath: 'C:\\Program Files\\nodejs\\node.exe',
      sockPath: '\\\\.\\pipe\\orca-relay',
      credentialFile: 'C:\\Users\\me user\\.orca-relay\\relay.credential'
    })
  })

  it.each([
    [{ version: 2 }, 'remote_cli_launcher_incompatible_version'],
    [
      {
        version: 1,
        binDir: '/tmp/bin\nignored',
        relayDir: '/tmp/relay',
        nodePath: '/usr/bin/node',
        sockPath: '/tmp/relay.sock'
      },
      'remote_cli_launcher_invalid_bin_dir'
    ]
  ])('rejects malformed request %#', (request, error) => {
    expect(() => parseSshRemoteCliLauncherInstallRequest(request)).toThrow(error)
  })

  it('rejects an unacknowledged install result', () => {
    expect(() =>
      parseSshRemoteCliLauncherInstallResult({
        version: 1,
        launcherPath: '/home/me/.orca-relay/bin/orca'
      })
    ).toThrow('remote_cli_launcher_invalid_result')
  })
})
