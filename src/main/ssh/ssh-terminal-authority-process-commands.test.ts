import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { getRemoteHostPlatform } from './ssh-remote-platform'
import { sshTerminalAuthorityEndpoint } from './ssh-terminal-authority-endpoint'
import {
  AUTHORITY_READY_INTERVAL_MS,
  AUTHORITY_READY_TIMEOUT_MS,
  sshTerminalAuthorityConnectCommand,
  sshTerminalAuthorityLaunchCommand,
  sshTerminalAuthorityReadyCommand
} from './ssh-terminal-authority-process-commands'

function decodePowerShellCommand(command: string): string {
  const encoded = command.match(/-EncodedCommand\s+([A-Za-z0-9+/=]+)/)?.[1] ?? ''
  return Buffer.from(encoded, 'base64').toString('utf16le')
}

describe('SSH terminal authority process commands', () => {
  it('connects through the exact owner build and stable POSIX endpoint', () => {
    const host = getRemoteHostPlatform('linux-x64')
    const endpoint = sshTerminalAuthorityEndpoint(host, '/home/orca user')
    const command = sshTerminalAuthorityConnectCommand({
      host,
      nodePath: '/opt/node bin/node',
      ownerRelayDir: '/home/orca user/.orca-remote/relay-1.2.3+abcdef',
      endpoint,
      expectedOwner: {
        authorityHostId: 'authority host',
        ownerInstanceId: 'owner instance',
        revision: 7
      }
    })

    expect(command).toContain("cd '/home/orca user/.orca-remote/relay-1.2.3+abcdef'")
    expect(command).toContain("'/opt/node bin/node'")
    expect(command).toContain(
      "--sock-path '/home/orca user/.orca-remote/terminal-authority/authority.sock'"
    )
    expect(command).toContain('--credential-file')
    expect(command).toContain("--authority-expect-host-id 'authority host'")
    expect(command).toContain("--authority-expect-owner-instance 'owner instance'")
    expect(command).toContain('--authority-expect-revision 7')
  })

  it('connects to the exact authority owner on Windows', () => {
    const host = getRemoteHostPlatform('win32-x64')
    const endpoint = sshTerminalAuthorityEndpoint(host, 'C:/Users/Orca User')
    const command = sshTerminalAuthorityConnectCommand({
      host,
      nodePath: 'C:/Program Files/nodejs/node.exe',
      ownerRelayDir: 'C:/Users/Orca User/.orca-remote/relay-1.2.3+abcdef',
      endpoint,
      expectedOwner: {
        authorityHostId: 'windows-host',
        ownerInstanceId: 'windows-owner',
        revision: 11
      }
    })
    const script = decodePowerShellCommand(command)

    expect(script).toContain("--authority-expect-host-id 'windows-host'")
    expect(script).toContain("--authority-expect-owner-instance 'windows-owner'")
    expect(script).toContain('--authority-expect-revision 11')
  })

  it('launches a first POSIX owner with stable state and no takeover claim', () => {
    const host = getRemoteHostPlatform('linux-x64')
    const endpoint = sshTerminalAuthorityEndpoint(host, '/home/orca')
    const command = sshTerminalAuthorityLaunchCommand({
      host,
      nodePath: '/usr/bin/node',
      relayDir: '/home/orca/.orca-remote/relay-1.2.3+abcdef',
      endpoint,
      processToken: 'new-owner-process-token',
      graceTimeSeconds: 300
    })

    expect(command).toContain("'--terminal-authority'")
    expect(command).toContain("'--authority-process-token' 'new-owner-process-token'")
    expect(command).toContain("'--authority-marker-path'")
    expect(command).not.toContain('--authority-takeover-token')
  })

  it('carries exact prior owner identity on takeover', () => {
    const host = getRemoteHostPlatform('linux-x64')
    const endpoint = sshTerminalAuthorityEndpoint(host, '/home/orca')
    const command = sshTerminalAuthorityLaunchCommand({
      host,
      nodePath: '/usr/bin/node',
      relayDir: '/home/orca/.orca-remote/relay-2.0.0+fedcba',
      endpoint,
      processToken: 'replacement-process-token',
      graceTimeSeconds: 300,
      takeover: { ownerProcessToken: 'prior-process-token', revision: 9 }
    })

    expect(command).toContain("'--authority-takeover-token' 'prior-process-token'")
    expect(command).toContain("'--authority-takeover-revision' '9'")
  })

  it('uses an owner-scoped WMI launch and stable named pipe on Windows', () => {
    const host = getRemoteHostPlatform('win32-x64')
    const endpoint = sshTerminalAuthorityEndpoint(host, 'C:/Users/Orca User')
    const command = sshTerminalAuthorityLaunchCommand({
      host,
      nodePath: 'C:/Program Files/nodejs/node.exe',
      relayDir: 'C:/Users/Orca User/.orca-remote/relay-2.0.0+fedcba',
      endpoint,
      processToken: 'windows-owner-process-token',
      graceTimeSeconds: 600
    })
    const script = decodePowerShellCommand(command)

    expect(script).toContain('Invoke-CimMethod -ClassName Win32_Process')
    expect(script).toContain('--terminal-authority')
    expect(script).toContain(endpoint.socketPath)
    expect(script).toContain(endpoint.activeEndpointMarker)
  })

  it('probes POSIX readiness on the stable socket with the shared ready budget', () => {
    const host = getRemoteHostPlatform('linux-x64')
    const endpoint = sshTerminalAuthorityEndpoint(host, '/home/orca user')
    const command = sshTerminalAuthorityReadyCommand({
      host,
      nodePath: '/opt/node bin/node',
      relayDir: '/home/orca user/.orca-remote/relay-1.2.3+abcdef',
      socketPath: endpoint.socketPath
    })

    expect(command).toContain("'/opt/node bin/node' -e ")
    expect(command).toContain(`'${endpoint.socketPath}'`)
    expect(command.endsWith(` ${AUTHORITY_READY_TIMEOUT_MS} ${AUTHORITY_READY_INTERVAL_MS}`)).toBe(
      true
    )
  })

  it('probes Windows readiness on the stable named pipe', () => {
    const host = getRemoteHostPlatform('win32-x64')
    const endpoint = sshTerminalAuthorityEndpoint(host, 'C:\\Users\\orca user')
    const decoded = decodePowerShellCommand(
      sshTerminalAuthorityReadyCommand({
        host,
        nodePath: 'C:\\Program Files\\node\\node.exe',
        relayDir: 'C:\\Users\\orca user\\.orca-remote\\relay-1.2.3+abcdef',
        socketPath: endpoint.socketPath
      })
    )

    expect(endpoint.socketPath.startsWith('\\\\.\\pipe\\')).toBe(true)
    expect(decoded).toContain(endpoint.socketPath)
    expect(decoded).toContain(String(AUTHORITY_READY_TIMEOUT_MS))
    expect(decoded).toContain(String(AUTHORITY_READY_INTERVAL_MS))
  })
})
