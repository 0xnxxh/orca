import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CURRENT_RELAY_DAEMON_COMPATIBILITY } from '../../shared/relay-daemon-compatibility'
import { SSH_TERMINAL_AUTHORITY_MARKER_VERSION } from '../../shared/ssh-terminal-authority-marker'
import type { MultiplexerTransport } from './ssh-channel-multiplexer'
import type { SshConnection } from './ssh-connection'
import { getRemoteHostPlatform } from './ssh-remote-platform'
import { execCommand, waitForSentinel } from './ssh-relay-deploy-helpers'
import { ensureRelayEndpointCredential } from './ssh-relay-endpoint-credential'
import type * as SshTerminalAuthorityDiscoveryModule from './ssh-terminal-authority-discovery'
import {
  discoverSshTerminalAuthority,
  proveSshTerminalAuthorityOwner,
  type SshTerminalAuthorityDiscovery
} from './ssh-terminal-authority-discovery'
import { sshTerminalAuthorityEndpoint } from './ssh-terminal-authority-endpoint'
import { establishSshTerminalAuthority } from './ssh-terminal-authority-process'

vi.mock('./ssh-relay-deploy-helpers', () => ({
  execCommand: vi.fn(),
  waitForSentinel: vi.fn()
}))

vi.mock('./ssh-relay-endpoint-credential', () => ({
  ensureRelayEndpointCredential: vi.fn()
}))

vi.mock('./ssh-terminal-authority-discovery', async (importOriginal) => {
  const original = await importOriginal<typeof SshTerminalAuthorityDiscoveryModule>()
  return {
    ...original,
    discoverSshTerminalAuthority: vi.fn(),
    proveSshTerminalAuthorityOwner: vi.fn()
  }
})

const host = getRemoteHostPlatform('linux-x64')
const remoteHome = '/home/orca'
const relayDir = '/home/orca/.orca-remote/relay-2.0.0+abcdef'
const endpoint = sshTerminalAuthorityEndpoint(host, remoteHome)
const marker = {
  markerVersion: SSH_TERMINAL_AUTHORITY_MARKER_VERSION,
  authorityHostId: 'authority-host',
  ownerInstanceId: 'owner-instance',
  ownerPid: 42,
  ownerProcessToken: 'owner-process-token',
  ownerBuildId: '1.0.0+abcdef',
  ownerRelayDir: '/home/orca/.orca-remote/relay-1.0.0+abcdef',
  socketPath: endpoint.socketPath,
  credentialFile: endpoint.credentialFile,
  compatibility: CURRENT_RELAY_DAEMON_COMPATIBILITY,
  revision: 4
} as const

function channel(options?: { closesWithoutClient?: boolean }) {
  const stream = new EventEmitter()
  const result = Object.assign(stream, {
    stderr: new EventEmitter(),
    close: vi.fn(() => queueMicrotask(() => stream.emit('close')))
  })
  if (options?.closesWithoutClient) {
    setTimeout(() => stream.emit('close'), 0)
  }
  return result
}

function transport(): MultiplexerTransport {
  return {
    write: vi.fn(),
    onData: vi.fn(),
    onClose: vi.fn(),
    close: vi.fn()
  }
}

function connection(): SshConnection {
  return { exec: vi.fn() } as unknown as SshConnection
}

function options(
  conn: SshConnection,
  discovery: SshTerminalAuthorityDiscovery = { status: 'available', marker }
) {
  return {
    conn,
    host,
    remoteHome,
    relayDir,
    nodePath: '/usr/bin/node',
    endpoint,
    discovery,
    graceTimeSeconds: 300
  }
}

describe('SSH terminal authority process lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(execCommand).mockResolvedValue('READY')
    vi.mocked(ensureRelayEndpointCredential).mockResolvedValue()
  })

  it('connects a compatible owner without topology writes or launch probes', async () => {
    const conn = connection()
    const ownerChannel = channel()
    const ownerTransport = transport()
    vi.mocked(conn.exec).mockResolvedValue(ownerChannel as never)
    vi.mocked(waitForSentinel).mockResolvedValue(ownerTransport)

    const result = await establishSshTerminalAuthority(options(conn))

    expect(result.authorityHostId).toBe(marker.authorityHostId)
    expect(result.ownerInstanceId).toBe(marker.ownerInstanceId)
    expect(result.revision).toBe(marker.revision)
    expect(result.ownerBuildId).toBe(marker.ownerBuildId)
    expect(conn.exec).toHaveBeenCalledTimes(1)
    expect(ownerChannel.close).toHaveBeenCalledOnce()
    expect(execCommand).not.toHaveBeenCalled()
    expect(ensureRelayEndpointCredential).not.toHaveBeenCalled()
  })

  it('confirms the owner launch channel closed before opening the readiness probe', async () => {
    const conn = connection()
    const launchChannel = channel()
    const probeChannel = channel()
    vi.mocked(conn.exec)
      .mockResolvedValueOnce(launchChannel as never)
      .mockResolvedValueOnce(probeChannel as never)
    vi.mocked(discoverSshTerminalAuthority).mockResolvedValue({ status: 'available', marker })
    vi.mocked(waitForSentinel).mockResolvedValue(transport())

    const establishing = establishSshTerminalAuthority(options(conn, { status: 'absent' }))
    await vi.waitFor(() => expect(conn.exec).toHaveBeenCalledOnce())

    expect(execCommand).toHaveBeenCalledOnce()
    launchChannel.emit('close')
    await establishing

    expect(execCommand).toHaveBeenCalledTimes(2)
    expect(conn.exec).toHaveBeenCalledTimes(2)
  })

  it('does not take over a live owner whose endpoint temporarily refuses', async () => {
    const conn = connection()
    vi.mocked(conn.exec).mockResolvedValue(channel() as never)
    vi.mocked(waitForSentinel).mockRejectedValue(new Error('endpoint refused'))
    vi.mocked(discoverSshTerminalAuthority).mockResolvedValue({
      status: 'available',
      marker
    })
    vi.mocked(proveSshTerminalAuthorityOwner).mockResolvedValue('owner-alive')

    await expect(establishSshTerminalAuthority(options(conn))).rejects.toMatchObject({
      code: 'owner-still-alive'
    })
    expect(conn.exec).toHaveBeenCalledTimes(1)
    expect(ensureRelayEndpointCredential).not.toHaveBeenCalled()
  })

  it('does not take over when owner inspection fails', async () => {
    const conn = connection()
    vi.mocked(conn.exec).mockResolvedValue(channel() as never)
    vi.mocked(waitForSentinel).mockRejectedValue(new Error('endpoint refused'))
    vi.mocked(discoverSshTerminalAuthority).mockResolvedValue({
      status: 'available',
      marker
    })
    vi.mocked(proveSshTerminalAuthorityOwner).mockResolvedValue('inspection-failed')

    await expect(establishSshTerminalAuthority(options(conn))).rejects.toMatchObject({
      code: 'owner-proof-inconclusive'
    })
    expect(conn.exec).toHaveBeenCalledTimes(1)
    expect(ensureRelayEndpointCredential).not.toHaveBeenCalled()
  })

  it('checks the unchanged marker before probing process death', async () => {
    const conn = connection()
    vi.mocked(conn.exec).mockResolvedValue(channel() as never)
    vi.mocked(waitForSentinel).mockRejectedValue(new Error('old endpoint refused'))
    vi.mocked(discoverSshTerminalAuthority).mockResolvedValue({
      status: 'available',
      marker: { ...marker, revision: marker.revision + 1 }
    })

    await expect(establishSshTerminalAuthority(options(conn))).rejects.toMatchObject({
      code: 'owner-state-changed'
    })
    expect(proveSshTerminalAuthorityOwner).not.toHaveBeenCalled()
  })

  it('launches a replacement only after exact owner death and reconnects through its marker', async () => {
    const conn = connection()
    const refusedChannel = channel()
    const launchChannel = channel({ closesWithoutClient: true })
    const replacementChannel = channel()
    const replacementTransport = transport()
    const replacementMarker = {
      ...marker,
      ownerInstanceId: 'replacement-instance',
      ownerPid: 99,
      ownerProcessToken: 'replacement-token',
      ownerBuildId: '2.0.0+abcdef',
      ownerRelayDir: relayDir,
      revision: marker.revision + 1
    }
    vi.mocked(conn.exec)
      .mockResolvedValueOnce(refusedChannel as never)
      .mockResolvedValueOnce(launchChannel as never)
      .mockResolvedValueOnce(replacementChannel as never)
    vi.mocked(waitForSentinel)
      .mockRejectedValueOnce(new Error('owner exited'))
      .mockResolvedValueOnce(replacementTransport)
    vi.mocked(discoverSshTerminalAuthority)
      .mockResolvedValueOnce({ status: 'available', marker })
      .mockResolvedValueOnce({ status: 'available', marker: replacementMarker })
    vi.mocked(proveSshTerminalAuthorityOwner).mockResolvedValue('owner-gone')

    const result = await establishSshTerminalAuthority(options(conn))

    expect(result.ownerInstanceId).toBe(replacementMarker.ownerInstanceId)
    expect(result.revision).toBe(replacementMarker.revision)
    expect(ensureRelayEndpointCredential).toHaveBeenCalledOnce()
    const launchCommand = vi.mocked(conn.exec).mock.calls[1]?.[0] ?? ''
    expect(launchCommand).toContain("'--authority-takeover-token' 'owner-process-token'")
    expect(launchCommand).toContain("'--authority-takeover-revision' '4'")
    expect(launchChannel.close).not.toHaveBeenCalled()
  })

  it('fails closed instead of launching when bootstrap discovery is inconclusive', async () => {
    const conn = connection()
    await expect(
      establishSshTerminalAuthority(options(conn, { status: 'inconclusive' }))
    ).rejects.toMatchObject({ code: 'discovery-inconclusive' })
    expect(conn.exec).not.toHaveBeenCalled()
  })
})
