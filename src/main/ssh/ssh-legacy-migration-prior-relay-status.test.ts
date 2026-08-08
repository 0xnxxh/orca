import { describe, expect, it } from 'vitest'
import type { SshTerminalAuthorityMarker } from '../../shared/ssh-terminal-authority-marker'
import { getRemoteHostPlatform } from './ssh-remote-platform'
import {
  resolveSshLegacyPriorRelayStatus,
  sshLegacyPriorRelayWindowsEndpoint,
  sshLegacyPriorRelayWorkerDescriptor
} from './ssh-legacy-migration-prior-relay-status'

const OWNER = Object.freeze({
  authorityHostId: 'authority-host-a',
  ownerInstanceId: 'owner-new',
  revision: 7
})

function marker(overrides: Partial<SshTerminalAuthorityMarker> = {}): SshTerminalAuthorityMarker {
  return {
    markerVersion: 1,
    authorityHostId: 'authority-host-a',
    ownerInstanceId: 'owner-prior',
    ownerPid: 4_321,
    ownerProcessToken: 'prior-process-token',
    ownerBuildId: '0.1.0+abc',
    ownerRelayDir: '/home/u/.orca-relay/relay-0.1.0+abc',
    socketPath: '/home/u/.orca-relay/terminal-authority/authority.sock',
    credentialFile: '/home/u/.orca-relay/terminal-authority/endpoint.credential',
    compatibility: {
      major: 1,
      minMinor: 0,
      maxMinor: 0,
      capabilities: [],
      requiredCapabilities: []
    },
    revision: 6,
    ...overrides
  }
}

const POSIX_ENDPOINT = Object.freeze({
  kind: 'unix-socket' as const,
  device: '2049',
  inode: '77',
  changedAtNs: '1700000000000000000'
})

describe('recorded prior relay status', () => {
  it('reports no prior owner when nothing was recorded', () => {
    expect(
      resolveSshLegacyPriorRelayStatus({ discovery: { status: 'absent' }, owner: OWNER })
    ).toEqual({ kind: 'none' })
  })

  it.each(['invalid', 'inconclusive'] as const)('treats %s evidence as unknown', (status) => {
    const resolved = resolveSshLegacyPriorRelayStatus({ discovery: { status }, owner: OWNER })
    expect(resolved.kind).toBe('unknown')
  })

  it('reports adoption when the recorded owner is the attached owner', () => {
    const discovery = {
      status: 'available' as const,
      marker: marker({ ownerInstanceId: OWNER.ownerInstanceId, revision: OWNER.revision })
    }
    expect(resolveSshLegacyPriorRelayStatus({ discovery, owner: OWNER })).toEqual({
      kind: 'adopted'
    })
  })

  it('refuses to classify a same-owner record at a different revision', () => {
    const discovery = {
      status: 'available' as const,
      marker: marker({ ownerInstanceId: OWNER.ownerInstanceId, revision: OWNER.revision - 1 })
    }
    expect(resolveSshLegacyPriorRelayStatus({ discovery, owner: OWNER }).kind).toBe('unknown')
  })

  it('refuses a record minted by a different authority host', () => {
    const discovery = {
      status: 'available' as const,
      marker: marker({ authorityHostId: 'authority-host-b' })
    }
    expect(resolveSshLegacyPriorRelayStatus({ discovery, owner: OWNER }).kind).toBe('unknown')
  })

  it('reports a superseded prior owner', () => {
    const discovery = { status: 'available' as const, marker: marker() }
    expect(resolveSshLegacyPriorRelayStatus({ discovery, owner: OWNER })).toEqual({
      kind: 'superseded',
      marker: discovery.marker
    })
  })
})

describe('prior relay worker descriptor', () => {
  it('derives a POSIX descriptor whose private state is isolated inside the legacy relay dir', () => {
    const descriptor = sshLegacyPriorRelayWorkerDescriptor({
      marker: marker(),
      hostPlatform: getRemoteHostPlatform('linux-x64'),
      clientInstanceId: 'client-a',
      expectedEndpoint: POSIX_ENDPOINT
    })
    expect(descriptor.platform).toBe('linux')
    expect(descriptor.workerId).toBe('owner-prior')
    expect(descriptor.ownerIncarnationId).toBe('prior-process-token')
    expect(descriptor.process).toEqual({ pid: 4_321, birthMarker: 'prior-process-token' })
    expect(descriptor.expectedEndpoint).toBe(POSIX_ENDPOINT)
    expect(descriptor.privateStateDirectory).toBe(
      '/home/u/.orca-relay/relay-0.1.0+abc/.orca-legacy-cutover'
    )
    expect(descriptor).toMatchObject({
      publicSocketPath: '/home/u/.orca-relay/terminal-authority/authority.sock',
      privateSocketPath: '/home/u/.orca-relay/relay-0.1.0+abc/.orca-legacy-cutover/authority.sock',
      privateCredentialFile:
        '/home/u/.orca-relay/relay-0.1.0+abc/.orca-legacy-cutover/endpoint.credential'
    })
  })

  it('keeps the route id stable for one recorded owner and distinct across revisions', () => {
    const host = getRemoteHostPlatform('linux-x64')
    const args = {
      hostPlatform: host,
      clientInstanceId: 'client-a',
      expectedEndpoint: POSIX_ENDPOINT
    }
    const first = sshLegacyPriorRelayWorkerDescriptor({ marker: marker(), ...args })
    const same = sshLegacyPriorRelayWorkerDescriptor({ marker: marker(), ...args })
    const later = sshLegacyPriorRelayWorkerDescriptor({
      marker: marker({ revision: 9 }),
      ...args
    })
    expect(first.routeId).toBe(same.routeId)
    expect(first.routeId).not.toBe(later.routeId)
  })

  it('derives a Windows descriptor from the recorded pipe and process token', () => {
    const windowsMarker = marker({
      ownerRelayDir: 'C:/Users/u/.orca-relay/relay-0.1.0+abc',
      socketPath: '\\\\.\\pipe\\orca-relay-0123456789abcdef0123',
      credentialFile: 'C:/Users/u/.orca-relay/terminal-authority/endpoint.credential'
    })
    const descriptor = sshLegacyPriorRelayWorkerDescriptor({
      marker: windowsMarker,
      hostPlatform: getRemoteHostPlatform('win32-x64'),
      clientInstanceId: 'client-a',
      expectedEndpoint: sshLegacyPriorRelayWindowsEndpoint(windowsMarker)
    })
    expect(descriptor.platform).toBe('win32')
    expect(descriptor).toMatchObject({
      pipeName: '\\\\.\\pipe\\orca-relay-0123456789abcdef0123',
      expectedEndpoint: {
        kind: 'windows-named-pipe',
        pipeName: '\\\\.\\pipe\\orca-relay-0123456789abcdef0123',
        processCreationMarker: 'prior-process-token'
      }
    })
    expect(descriptor.privateStateDirectory.endsWith('.orca-legacy-cutover')).toBe(true)
  })

  it('rejects a record whose identity fields are unusable', () => {
    expect(() =>
      sshLegacyPriorRelayWorkerDescriptor({
        marker: marker({ ownerRelayDir: 'relay\ndir' }),
        hostPlatform: getRemoteHostPlatform('linux-x64'),
        clientInstanceId: 'client-a',
        expectedEndpoint: POSIX_ENDPOINT
      })
    ).toThrow()
  })
})
