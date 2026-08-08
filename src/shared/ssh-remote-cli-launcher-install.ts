export const SSH_REMOTE_CLI_LAUNCHER_INSTALL_METHOD = 'session.installRemoteCliLauncher' as const
export const SSH_REMOTE_CLI_LAUNCHER_INSTALL_VERSION = 1 as const

const MAX_REMOTE_PATH_LENGTH = 32_768

export type SshRemoteCliLauncherInstallRequest = {
  version: typeof SSH_REMOTE_CLI_LAUNCHER_INSTALL_VERSION
  binDir: string
  relayDir: string
  nodePath: string
  sockPath: string
  credentialFile?: string
}

export type SshRemoteCliLauncherInstallResult = {
  version: typeof SSH_REMOTE_CLI_LAUNCHER_INSTALL_VERSION
  launcherPath: string
  changed: boolean
}

function parseRemotePath(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_REMOTE_PATH_LENGTH ||
    value.includes('\0') ||
    value.includes('\r') ||
    value.includes('\n')
  ) {
    throw new Error(`remote_cli_launcher_invalid_${field}`)
  }
  return value
}

export function parseSshRemoteCliLauncherInstallRequest(
  value: unknown
): SshRemoteCliLauncherInstallRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('remote_cli_launcher_invalid_request')
  }
  const request = value as Record<string, unknown>
  if (request.version !== SSH_REMOTE_CLI_LAUNCHER_INSTALL_VERSION) {
    throw new Error('remote_cli_launcher_incompatible_version')
  }
  const credentialFile =
    request.credentialFile === undefined
      ? undefined
      : parseRemotePath(request.credentialFile, 'credential_file')
  return {
    version: SSH_REMOTE_CLI_LAUNCHER_INSTALL_VERSION,
    binDir: parseRemotePath(request.binDir, 'bin_dir'),
    relayDir: parseRemotePath(request.relayDir, 'relay_dir'),
    nodePath: parseRemotePath(request.nodePath, 'node_path'),
    sockPath: parseRemotePath(request.sockPath, 'socket_path'),
    ...(credentialFile ? { credentialFile } : {})
  }
}

export function parseSshRemoteCliLauncherInstallResult(
  value: unknown
): SshRemoteCliLauncherInstallResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('remote_cli_launcher_invalid_result')
  }
  const result = value as Record<string, unknown>
  if (
    result.version !== SSH_REMOTE_CLI_LAUNCHER_INSTALL_VERSION ||
    typeof result.changed !== 'boolean'
  ) {
    throw new Error('remote_cli_launcher_invalid_result')
  }
  return {
    version: SSH_REMOTE_CLI_LAUNCHER_INSTALL_VERSION,
    launcherPath: parseRemotePath(result.launcherPath, 'result_path'),
    changed: result.changed
  }
}
