import { describe, expect, it, vi } from 'vitest'
import {
  SSH_REMOTE_CLI_LAUNCHER_INSTALL_METHOD,
  SSH_REMOTE_CLI_LAUNCHER_INSTALL_VERSION
} from '../../shared/ssh-remote-cli-launcher-install'
import { installSshRemoteCliLauncher } from './ssh-remote-cli-launcher-client'
import { getRemoteHostPlatform } from './ssh-remote-platform'

describe('SSH remote CLI launcher client', () => {
  it('installs over the existing relay channel without requiring a raw SSH connection', async () => {
    const request = vi.fn().mockResolvedValue({
      version: SSH_REMOTE_CLI_LAUNCHER_INSTALL_VERSION,
      launcherPath: 'C:\\Users\\me\\.orca-relay\\bin\\orca.exe',
      changed: true
    })

    await installSshRemoteCliLauncher(
      { request },
      {
        binDir: 'C:/Users/me/.orca-relay/bin',
        relayDir: 'C:/Users/me/.orca-remote/relay-v1',
        nodePath: 'C:/Program Files/nodejs/node.exe',
        sockPath: '\\\\.\\pipe\\orca-relay-123',
        credentialFile: 'C:/Users/me/.orca-remote/relay-v1/relay.credential',
        hostPlatform: getRemoteHostPlatform('win32-x64')
      }
    )

    expect(request).toHaveBeenCalledOnce()
    expect(request).toHaveBeenCalledWith(
      SSH_REMOTE_CLI_LAUNCHER_INSTALL_METHOD,
      {
        version: SSH_REMOTE_CLI_LAUNCHER_INSTALL_VERSION,
        binDir: 'C:/Users/me/.orca-relay/bin',
        relayDir: 'C:/Users/me/.orca-remote/relay-v1',
        nodePath: 'C:/Program Files/nodejs/node.exe',
        sockPath: '\\\\.\\pipe\\orca-relay-123',
        credentialFile: 'C:/Users/me/.orca-remote/relay-v1/relay.credential'
      },
      { timeoutMs: 60_000 }
    )
  })

  it('fails closed when the relay does not acknowledge the exact launcher path', async () => {
    const request = vi.fn().mockResolvedValue({
      version: SSH_REMOTE_CLI_LAUNCHER_INSTALL_VERSION,
      launcherPath: '/tmp/unrelated/orca',
      changed: true
    })

    await expect(
      installSshRemoteCliLauncher(
        { request },
        {
          binDir: '/home/me/.orca-relay/bin',
          relayDir: '/home/me/.orca-remote/relay-v1',
          nodePath: '/usr/bin/node',
          sockPath: '/home/me/.orca-remote/relay-v1/relay.sock',
          hostPlatform: getRemoteHostPlatform('linux-x64')
        }
      )
    ).rejects.toThrow('remote_cli_launcher_invalid_result_path')
  })
})
