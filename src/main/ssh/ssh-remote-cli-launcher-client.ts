import {
  SSH_REMOTE_CLI_LAUNCHER_INSTALL_METHOD,
  SSH_REMOTE_CLI_LAUNCHER_INSTALL_VERSION,
  parseSshRemoteCliLauncherInstallResult
} from '../../shared/ssh-remote-cli-launcher-install'
import type { SshChannelMultiplexer } from './ssh-channel-multiplexer'
import {
  isWindowsRemoteHost,
  joinRemotePath,
  normalizeWindowsRemotePath,
  type RemoteHostPlatform
} from './ssh-remote-platform'

export type SshRemoteCliLauncherEnvironment = {
  binDir: string
  relayDir: string
  nodePath: string
  sockPath: string
  credentialFile?: string
  hostPlatform: RemoteHostPlatform
}

export async function installSshRemoteCliLauncher(
  mux: Pick<SshChannelMultiplexer, 'request'>,
  env: SshRemoteCliLauncherEnvironment
): Promise<void> {
  const { binDir, relayDir, nodePath, sockPath, credentialFile, hostPlatform } = env
  const result = parseSshRemoteCliLauncherInstallResult(
    await mux.request(
      SSH_REMOTE_CLI_LAUNCHER_INSTALL_METHOD,
      {
        version: SSH_REMOTE_CLI_LAUNCHER_INSTALL_VERSION,
        binDir,
        relayDir,
        nodePath,
        sockPath,
        ...(credentialFile ? { credentialFile } : {})
      },
      { timeoutMs: 60_000 }
    )
  )
  const expectedPath = joinRemotePath(
    hostPlatform,
    binDir,
    isWindowsRemoteHost(hostPlatform) ? 'orca.exe' : 'orca'
  )
  const normalize = isWindowsRemoteHost(hostPlatform)
    ? normalizeWindowsRemotePath
    : (value: string): string => value
  if (normalize(result.launcherPath) !== normalize(expectedPath)) {
    throw new Error('remote_cli_launcher_invalid_result_path')
  }
}
