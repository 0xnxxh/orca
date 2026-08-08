import { createServer, Socket, type Server } from 'node:net'
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CURRENT_RELAY_DAEMON_COMPATIBILITY } from '../shared/relay-daemon-compatibility'
import {
  terminalAuthorityEndpointIdentity,
  type SshTerminalAuthorityMarker
} from '../shared/ssh-terminal-authority-marker'
import { setupDaemonHandshake } from './relay-handshake'
import { relayTestSocketPath } from './relay-test-socket-path'
import {
  connectTerminalAuthorityGateway,
  createTerminalAuthoritySocketMultiplexer
} from './terminal-authority-gateway-connection'

const CREDENTIAL = 'abcdefghijklmnopqrstuvwxyzABCDEFGH123456789'

describe('terminal authority gateway connection', () => {
  let directory: string | null = null
  let server: Server | null = null
  const sockets = new Set<Socket>()

  afterEach(async () => {
    for (const socket of sockets) {
      socket.destroy()
    }
    sockets.clear()
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()))
      server = null
    }
    if (directory) {
      rmSync(directory, { recursive: true, force: true })
      directory = null
    }
  })

  function fixture(): {
    marker: SshTerminalAuthorityMarker
    markerPath: string
    credentialPath: string
  } {
    directory = mkdtempSync(join(tmpdir(), 'orca-authority-gateway-'))
    const socketPath = relayTestSocketPath(directory)
    const markerPath = join(directory, 'active-endpoint')
    const credentialPath = join(directory, 'endpoint.credential')
    const marker: SshTerminalAuthorityMarker = {
      markerVersion: 1,
      authorityHostId: 'authority-host',
      ownerInstanceId: 'owner-instance',
      ownerPid: process.pid,
      ownerProcessToken: 'owner-process-token-1234',
      ownerBuildId: 'owner-build',
      ownerRelayDir: directory,
      socketPath,
      credentialFile: credentialPath,
      compatibility: CURRENT_RELAY_DAEMON_COMPATIBILITY,
      revision: 4
    }
    writeFileSync(markerPath, JSON.stringify(marker), { mode: 0o600 })
    writeFileSync(credentialPath, CREDENTIAL, { mode: 0o600 })
    return { marker, markerPath, credentialPath }
  }

  function expectation(marker: SshTerminalAuthorityMarker, markerPath: string) {
    return {
      markerPath,
      authorityHostId: marker.authorityHostId,
      ownerInstanceId: marker.ownerInstanceId,
      revision: marker.revision
    }
  }

  async function listen(
    marker: SshTerminalAuthorityMarker,
    credential = CREDENTIAL,
    endpointMarker = marker
  ): Promise<void> {
    server = createServer((socket) => {
      sockets.add(socket)
      socket.once('close', () => sockets.delete(socket))
      setupDaemonHandshake(socket, {
        launchVersion: marker.ownerBuildId,
        endpointCredential: credential,
        authorityIdentity: terminalAuthorityEndpointIdentity(endpointMarker),
        onAccepted: () => {}
      })
    })
    await new Promise<void>((resolve, reject) => {
      server?.once('error', reject)
      server?.listen(marker.socketPath, resolve)
    })
  }

  it('connects different compatible gateway and owner builds over the local endpoint', async () => {
    const { marker, markerPath } = fixture()
    await listen(marker)

    const connection = await connectTerminalAuthorityGateway(
      expectation(marker, markerPath),
      'gateway-build'
    )

    expect(connection.marker).toEqual(marker)
    expect(connection.compatibility).toEqual(
      expect.objectContaining({
        capabilities: expect.arrayContaining(['terminal-session.authority-topology-stream.v1'])
      })
    )
    connection.mux.dispose('shutdown')
  })

  it('fails closed when the admitted owner marker changed before connection', async () => {
    const { marker, markerPath } = fixture()

    await expect(
      connectTerminalAuthorityGateway(
        { ...expectation(marker, markerPath), ownerInstanceId: 'superseded-owner' },
        'gateway-build'
      )
    ).rejects.toThrow('owner changed')
  })

  it('rejects a socket that cannot prove the marker credential', async () => {
    const { marker, markerPath } = fixture()
    await listen(marker, 'different-credential-abcdefghijklmnopqrstuvwxyz')

    await expect(
      connectTerminalAuthorityGateway(expectation(marker, markerPath), 'gateway-build')
    ).rejects.toThrow('handshake')
  })

  it('rejects a same-build socket owned by a different authority incarnation', async () => {
    const { marker, markerPath } = fixture()
    await listen(marker, CREDENTIAL, {
      ...marker,
      ownerInstanceId: 'replacement-owner',
      revision: marker.revision + 1
    })

    await expect(
      connectTerminalAuthorityGateway(expectation(marker, markerPath), 'gateway-build')
    ).rejects.toThrow('handshake')
  })

  it('fails closed when the admitted authority host identity changes', async () => {
    const { marker, markerPath } = fixture()

    await expect(
      connectTerminalAuthorityGateway(
        { ...expectation(marker, markerPath), authorityHostId: 'different-host' },
        'gateway-build'
      )
    ).rejects.toThrow('owner changed')
  })

  it.runIf(process.platform !== 'win32')(
    'rejects a credential readable by another local principal',
    async () => {
      const { marker, markerPath, credentialPath } = fixture()
      chmodSync(credentialPath, 0o644)

      await expect(
        connectTerminalAuthorityGateway(expectation(marker, markerPath), 'gateway-build')
      ).rejects.toThrow('permissions')
    }
  )

  it.runIf(process.platform !== 'win32')('does not follow a marker symlink', async () => {
    const { marker, markerPath } = fixture()
    const symlinkPath = join(directory!, 'active-endpoint-link')
    symlinkSync(markerPath, symlinkPath)

    await expect(
      connectTerminalAuthorityGateway(expectation(marker, symlinkPath), 'gateway-build')
    ).rejects.toThrow('marker is unavailable')
  })

  it('turns a post-handshake socket error into connection loss', () => {
    const socket = new Socket()
    const mux = createTerminalAuthoritySocketMultiplexer(socket, Buffer.alloc(0))
    const disposed = vi.fn()
    mux.onDispose(disposed)

    expect(() => socket.emit('error', new Error('connection reset'))).not.toThrow()
    expect(disposed).toHaveBeenCalledWith('connection_lost')
  })
})
