import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { SSH_TERMINAL_AUTHORITY_MARKER_VERSION } from '../../shared/ssh-terminal-authority-marker'
import { CURRENT_RELAY_DAEMON_COMPATIBILITY } from '../../shared/relay-daemon-compatibility'
import { getRemoteHostPlatform } from './ssh-remote-platform'
import { sshTerminalAuthorityEndpoint } from './ssh-terminal-authority-endpoint'
import {
  parseSshTerminalAuthorityDiscovery,
  parseSshTerminalAuthorityBootstrapRead,
  parseSshTerminalAuthorityOwnerProof,
  SSH_TERMINAL_AUTHORITY_MARKER_MAX_BYTES,
  sshTerminalAuthorityMarkerHasExpectedPaths,
  sshTerminalAuthorityBootstrapReadCommand,
  sshTerminalAuthorityMarkerReadCommand,
  sshTerminalAuthorityOwnerProofCommand
} from './ssh-terminal-authority-discovery'

function decodePowerShellCommand(command: string): string {
  const encoded = command.split(' -EncodedCommand ')[1] ?? ''
  return Buffer.from(encoded, 'base64').toString('utf16le')
}

const linux = getRemoteHostPlatform('linux-x64')
const darwin = getRemoteHostPlatform('darwin-arm64')
const windows = getRemoteHostPlatform('win32-x64')
const endpoint = sshTerminalAuthorityEndpoint(linux, '/home/orca')
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
  revision: 1
} as const

describe('SSH terminal authority discovery', () => {
  it('reads a bounded POSIX marker without following directory-shaped entries', () => {
    const command = sshTerminalAuthorityMarkerReadCommand(linux, endpoint.activeEndpointMarker)
    expect(command).toContain(`-gt ${SSH_TERMINAL_AUTHORITY_MARKER_MAX_BYTES}`)
    expect(command).toContain('[ ! -f "$p" ]')
    expect(command).toContain('ORCA_TERMINAL_AUTHORITY_MARKER_PRESENT')
  })

  it('reads a bounded Windows marker as base64', () => {
    const script = decodePowerShellCommand(
      sshTerminalAuthorityMarkerReadCommand(
        windows,
        'C:/Users/orca/.orca-remote/terminal-authority/active-endpoint'
      )
    )
    expect(script).toContain(`[IO.File]::ReadAllBytes($path)`)
    expect(script).toContain(`${SSH_TERMINAL_AUTHORITY_MARKER_MAX_BYTES}`)
    expect(script).toContain('ORCA_TERMINAL_AUTHORITY_MARKER_PRESENT_BASE64')
  })

  it('combines remote-home and marker discovery in the existing bootstrap round trip', () => {
    expect(sshTerminalAuthorityBootstrapReadCommand(linux)).toContain(
      'ORCA_TERMINAL_AUTHORITY_HOME'
    )
    expect(sshTerminalAuthorityBootstrapReadCommand(linux)).toContain(
      '.orca-remote/terminal-authority/active-endpoint'
    )
    expect(
      parseSshTerminalAuthorityBootstrapRead(
        `ORCA_TERMINAL_AUTHORITY_HOME\n/home/orca user\nORCA_TERMINAL_AUTHORITY_MARKER_ABSENT\n`
      )
    ).toEqual({ rawRemoteHome: '/home/orca user', discovery: { status: 'absent' } })
  })

  it('parses raw and Windows-encoded markers', () => {
    const json = JSON.stringify(marker)
    expect(
      parseSshTerminalAuthorityDiscovery(`ORCA_TERMINAL_AUTHORITY_MARKER_PRESENT\n${json}`)
    ).toEqual({ status: 'available', marker })
    expect(
      parseSshTerminalAuthorityDiscovery(
        `ORCA_TERMINAL_AUTHORITY_MARKER_PRESENT_BASE64\r\n${Buffer.from(json).toString('base64')}\r\n`
      )
    ).toEqual({ status: 'available', marker })
  })

  it('distinguishes absence from invalid or inconclusive reads', () => {
    expect(parseSshTerminalAuthorityDiscovery('ORCA_TERMINAL_AUTHORITY_MARKER_ABSENT\n')).toEqual({
      status: 'absent'
    })
    expect(parseSshTerminalAuthorityDiscovery('ORCA_TERMINAL_AUTHORITY_MARKER_INVALID\n')).toEqual({
      status: 'invalid'
    })
    expect(parseSshTerminalAuthorityDiscovery('unexpected output')).toEqual({
      status: 'inconclusive'
    })
  })

  it('admits only the stable endpoint and one versioned owner directory', () => {
    expect(sshTerminalAuthorityMarkerHasExpectedPaths(marker, linux, '/home/orca', endpoint)).toBe(
      true
    )
    expect(
      sshTerminalAuthorityMarkerHasExpectedPaths(
        { ...marker, ownerRelayDir: '/home/orca/relay-1.2.3+abcdef' },
        linux,
        '/home/orca',
        endpoint
      )
    ).toBe(false)
    expect(
      sshTerminalAuthorityMarkerHasExpectedPaths(
        { ...marker, socketPath: '/home/orca/.orca-remote/relay-1.2.3+abcdef/relay.sock' },
        linux,
        '/home/orca',
        endpoint
      )
    ).toBe(false)
  })

  it('uses PID-reuse-safe process-token proof on every owner host', () => {
    const linuxCommand = sshTerminalAuthorityOwnerProofCommand(linux, marker)
    expect(linuxCommand).toContain('/proc/$pid/cmdline')
    expect(linuxCommand).toContain('--authority-process-token')

    const darwinCommand = sshTerminalAuthorityOwnerProofCommand(darwin, marker)
    expect(darwinCommand).toContain('table=$(command ps -ww -ax -o pid= -o command=')
    expect(darwinCommand).toContain("printf 'OWNER_UNKNOWN\\n'")
    expect(darwinCommand).toContain('valid ? "OWNER_GONE" : "OWNER_UNKNOWN"')
    expect(darwinCommand).not.toContain('command=$(ps -ww -p')

    const windowsScript = decodePowerShellCommand(
      sshTerminalAuthorityOwnerProofCommand(windows, marker)
    )
    expect(windowsScript).toContain('Get-CimInstance Win32_Process')
    expect(windowsScript).toContain('-ErrorAction Stop')
    expect(windowsScript).toContain("catch { 'OWNER_UNKNOWN' }")
    expect(windowsScript).toContain("$owners.Count -eq 0) { 'OWNER_GONE'")
    expect(windowsScript).not.toContain('-ErrorAction SilentlyContinue')
    expect(windowsScript).toContain('--authority-process-token')
    expect(windowsScript).toContain('owner-process-token')
  })

  it('parses only exact positive proof and rejects unusable output', () => {
    expect(parseSshTerminalAuthorityOwnerProof('OWNER_ALIVE\n')).toBe('owner-alive')
    expect(parseSshTerminalAuthorityOwnerProof('OWNER_GONE\n')).toBe('owner-gone')
    expect(parseSshTerminalAuthorityOwnerProof('OWNER_UNKNOWN\n')).toBe('inspection-failed')
    expect(parseSshTerminalAuthorityOwnerProof('')).toBe('inspection-failed')
    expect(parseSshTerminalAuthorityOwnerProof('OWNER_GONE\nunexpected')).toBe('inspection-failed')
  })
})
