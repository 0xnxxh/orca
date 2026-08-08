import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SshTerminalAuthorityMarker } from '../../shared/ssh-terminal-authority-marker'
import type { SshConnection } from './ssh-connection'
import { readSshLegacyPriorRelayEndpoint } from './ssh-legacy-migration-prior-relay-endpoint'
import { getRemoteHostPlatform } from './ssh-remote-platform'

const execCommand = vi.hoisted(() => vi.fn())
vi.mock('./ssh-relay-exec-command', () => ({ execCommand }))

const MARKER = Object.freeze({
  markerVersion: 1,
  authorityHostId: 'authority-host-a',
  ownerInstanceId: 'owner-prior',
  ownerPid: 4_321,
  ownerProcessToken: 'prior-process-token',
  ownerBuildId: '0.1.0+abc',
  ownerRelayDir: '/home/u/.orca-relay/relay-0.1.0+abc',
  socketPath: '/home/u/.orca-relay/terminal-authority/authority.sock',
  credentialFile: '/home/u/.orca-relay/terminal-authority/endpoint.credential',
  compatibility: { major: 1, minMinor: 0, maxMinor: 0, capabilities: [], requiredCapabilities: [] },
  revision: 6
})

function input(overrides: Partial<Parameters<typeof readSshLegacyPriorRelayEndpoint>[0]> = {}) {
  return {
    connection: {} as SshConnection,
    hostPlatform: getRemoteHostPlatform('linux-x64'),
    nodePath: '/usr/bin/node',
    marker: MARKER,
    signal: new AbortController().signal,
    ...overrides
  }
}

function response(value: unknown): string {
  return `ORCA_LEGACY_PRIOR_RELAY ${JSON.stringify(value)}`
}

describe('prior relay reachability', () => {
  beforeEach(() => {
    execCommand.mockReset()
  })

  it('observes the endpoint identity of a reachable POSIX relay', async () => {
    execCommand.mockResolvedValue(
      response({
        endpoint: { device: '2049', inode: '77', changedAtNs: '1700000000000000000' },
        liveness: 'alive'
      })
    )
    await expect(readSshLegacyPriorRelayEndpoint(input())).resolves.toEqual({
      kind: 'observed',
      endpoint: {
        kind: 'unix-socket',
        device: '2049',
        inode: '77',
        changedAtNs: '1700000000000000000'
      }
    })
  })

  it('sends one bounded observation that names the recorded socket and pid', async () => {
    execCommand.mockResolvedValue(response({ endpoint: null, liveness: 'gone' }))
    await readSshLegacyPriorRelayEndpoint(input())
    expect(execCommand).toHaveBeenCalledTimes(1)
    const [, command, options] = execCommand.mock.calls[0]
    expect(command).toContain(MARKER.socketPath)
    expect(command).toContain('4321')
    expect(options.timeoutMs).toBeLessThanOrEqual(10_000)
  })

  it('reports unknown when the recorded process is not observably alive', async () => {
    execCommand.mockResolvedValue(
      response({ endpoint: { device: '1', inode: '2', changedAtNs: '3' }, liveness: 'gone' })
    )
    const result = await readSshLegacyPriorRelayEndpoint(input())
    expect(result.kind).toBe('unknown')
  })

  it('reports unknown when the endpoint is absent rather than assuming it died', async () => {
    execCommand.mockResolvedValue(response({ endpoint: null, liveness: 'alive' }))
    const result = await readSshLegacyPriorRelayEndpoint(input())
    expect(result).toEqual({
      kind: 'unknown',
      reason: 'prior relay endpoint identity is not observable'
    })
  })

  it.each([
    ['no sentinel', 'unrelated output'],
    ['malformed payload', 'ORCA_LEGACY_PRIOR_RELAY not-json']
  ])('reports unknown for %s', async (_label, output) => {
    execCommand.mockResolvedValue(output)
    expect((await readSshLegacyPriorRelayEndpoint(input())).kind).toBe('unknown')
  })

  it('reports unknown when the observation itself fails', async () => {
    execCommand.mockRejectedValue(new Error('channel closed'))
    const result = await readSshLegacyPriorRelayEndpoint(input())
    expect(result).toEqual({
      kind: 'unknown',
      reason: 'prior relay observation failed: channel closed'
    })
  })

  it('never observes once the attempt is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await readSshLegacyPriorRelayEndpoint(input({ signal: controller.signal }))
    expect(result.kind).toBe('unknown')
    expect(execCommand).not.toHaveBeenCalled()
  })

  it('discards an observation that lands after the attempt aborted', async () => {
    const controller = new AbortController()
    execCommand.mockImplementation(async () => {
      controller.abort()
      return response({
        endpoint: { device: '1', inode: '2', changedAtNs: '3' },
        liveness: 'alive'
      })
    })
    const result = await readSshLegacyPriorRelayEndpoint(input({ signal: controller.signal }))
    expect(result.kind).toBe('unknown')
  })

  it('derives the Windows endpoint from the record once the relay is reachable', async () => {
    execCommand.mockResolvedValue(response({ endpoint: null, liveness: 'alive' }))
    const windowsMarker = {
      ...MARKER,
      socketPath: '\\\\.\\pipe\\orca-relay-0123456789abcdef0123'
    } as SshTerminalAuthorityMarker
    await expect(
      readSshLegacyPriorRelayEndpoint(
        input({ hostPlatform: getRemoteHostPlatform('win32-x64'), marker: windowsMarker })
      )
    ).resolves.toEqual({
      kind: 'observed',
      endpoint: {
        kind: 'windows-named-pipe',
        pipeName: '\\\\.\\pipe\\orca-relay-0123456789abcdef0123',
        processCreationMarker: 'prior-process-token'
      }
    })
  })
})
