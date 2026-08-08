import { RELAY_REMOTE_DIR } from './relay-protocol'
import { relayEndpointForHost } from './ssh-relay-endpoints'
import { shellEscape } from './ssh-connection-utils'
import { isWindowsRemoteHost, joinRemotePath, type RemoteHostPlatform } from './ssh-remote-platform'
import { powerShellCommand, powerShellLiteral } from './ssh-remote-powershell'

export const TERMINAL_AUTHORITY_DIRECTORY_NAME = 'terminal-authority'
export const TERMINAL_AUTHORITY_SOCKET_NAME = 'authority.sock'
export const TERMINAL_AUTHORITY_ACTIVE_ENDPOINT_MARKER_NAME = 'active-endpoint'

export type SshTerminalAuthorityEndpoint = {
  stateDir: string
  socketPath: string
  credentialFile: string
  activeEndpointMarker: string
  logFile: string
  errorLogFile: string
}

export function sshTerminalAuthorityEndpoint(
  host: RemoteHostPlatform,
  remoteHome: string
): SshTerminalAuthorityEndpoint {
  const stateDir = joinRemotePath(
    host,
    remoteHome,
    RELAY_REMOTE_DIR,
    TERMINAL_AUTHORITY_DIRECTORY_NAME
  )
  return {
    stateDir,
    socketPath: relayEndpointForHost(host, stateDir, TERMINAL_AUTHORITY_SOCKET_NAME),
    credentialFile: joinRemotePath(host, stateDir, 'endpoint.credential'),
    activeEndpointMarker: joinRemotePath(
      host,
      stateDir,
      TERMINAL_AUTHORITY_ACTIVE_ENDPOINT_MARKER_NAME
    ),
    logFile: joinRemotePath(host, stateDir, 'authority.log'),
    errorLogFile: joinRemotePath(host, stateDir, 'authority.err.log')
  }
}

export function sshTerminalAuthorityStateDirectoryCommand(
  host: RemoteHostPlatform,
  stateDir: string
): string {
  if (!isWindowsRemoteHost(host)) {
    return `umask 077; mkdir -p ${shellEscape(stateDir)}; chmod 700 ${shellEscape(stateDir)}`
  }
  return powerShellCommand(
    [
      `$path = ${powerShellLiteral(stateDir)}`,
      '$null = New-Item -ItemType Directory -Force -Path $path',
      '$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name',
      '& icacls.exe $path /inheritance:r /grant:r "${identity}:(OI)(CI)F" | Out-Null'
    ].join('; ')
  )
}
