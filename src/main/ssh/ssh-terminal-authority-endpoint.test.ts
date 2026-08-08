import { describe, expect, it } from 'vitest'
import { getRemoteHostPlatform } from './ssh-remote-platform'
import {
  TERMINAL_AUTHORITY_SOCKET_NAME,
  sshTerminalAuthorityEndpoint,
  sshTerminalAuthorityStateDirectoryCommand
} from './ssh-terminal-authority-endpoint'

function decodePowerShellCommand(command: string): string {
  const encoded = command.match(/-EncodedCommand\s+([A-Za-z0-9+/=]+)/)?.[1] ?? ''
  return Buffer.from(encoded, 'base64').toString('utf16le')
}

describe('SSH terminal authority endpoint', () => {
  it('is stable across relay build directories and SSH target aliases on POSIX', () => {
    const host = getRemoteHostPlatform('linux-x64')
    const first = sshTerminalAuthorityEndpoint(host, '/home/orca user')
    const second = sshTerminalAuthorityEndpoint(host, '/home/orca user')

    expect(first).toEqual(second)
    expect(first.socketPath).toBe(
      `/home/orca user/.orca-remote/terminal-authority/${TERMINAL_AUTHORITY_SOCKET_NAME}`
    )
    expect(first.socketPath).not.toContain('relay-v')
  })

  it('uses one deterministic named pipe and host-local state directory on Windows', () => {
    const host = getRemoteHostPlatform('win32-x64')
    const endpoint = sshTerminalAuthorityEndpoint(host, 'C:\\Users\\Orca User')

    expect(endpoint.socketPath).toMatch(/^\\\\\.\\pipe\\orca-relay-[0-9a-f]{20}$/)
    expect(endpoint.stateDir).toBe('C:/Users/Orca User/.orca-remote/terminal-authority')
    expect(endpoint.credentialFile).toBe(
      'C:/Users/Orca User/.orca-remote/terminal-authority/endpoint.credential'
    )
  })

  it('keeps different remote accounts isolated', () => {
    const host = getRemoteHostPlatform('win32-x64')
    const alice = sshTerminalAuthorityEndpoint(host, 'C:\\Users\\alice')
    const bob = sshTerminalAuthorityEndpoint(host, 'C:\\Users\\bob')

    expect(alice.socketPath).not.toBe(bob.socketPath)
    expect(alice.stateDir).not.toBe(bob.stateDir)
  })

  it('creates the stable state directory with owner-only access', () => {
    expect(sshTerminalAuthorityStateDirectoryCommand(hostFor('linux'), '/home/orca dir')).toContain(
      "chmod 700 '/home/orca dir'"
    )
    const windowsCommand = sshTerminalAuthorityStateDirectoryCommand(
      hostFor('windows'),
      'C:/Users/orca/.orca-remote/terminal-authority'
    )
    const windowsScript = decodePowerShellCommand(windowsCommand)
    expect(windowsScript).toContain('/inheritance:r')
    expect(windowsScript).toContain('(OI)(CI)F')
  })
})

function hostFor(platform: 'linux' | 'windows') {
  return getRemoteHostPlatform(platform === 'linux' ? 'linux-x64' : 'win32-x64')
}
