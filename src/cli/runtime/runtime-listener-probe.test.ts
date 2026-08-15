import { mkdtempSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { RuntimeMetadata } from '../../shared/runtime-bootstrap'
import { probeRuntimeListener } from './runtime-listener-probe'

const servers = new Set<Server>()
const sockets = new Set<Socket>()
let endpointCount = 0

afterEach(async () => {
  for (const socket of sockets) {
    socket.destroy()
  }
  sockets.clear()
  await Promise.all(
    [...servers].map((server) => new Promise<void>((resolve) => server.close(() => resolve())))
  )
  servers.clear()
})

function metadataFor(endpoint: string): RuntimeMetadata {
  return {
    runtimeId: 'runtime-1',
    pid: process.pid,
    transports: [
      { kind: process.platform === 'win32' ? 'named-pipe' : 'unix', endpoint },
      // Why: the websocket entry must not be picked — it is reachable from
      // anywhere on the network and proves nothing about this profile's owner.
      { kind: 'websocket', endpoint: 'ws://127.0.0.1:1' }
    ],
    authToken: 'token',
    startedAt: Date.now()
  }
}

function nextEndpoint(): string {
  endpointCount += 1
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\orca-probe-${process.pid}-${endpointCount}`
    : join(mkdtempSync(join(tmpdir(), 'orca-probe-')), 'runtime.sock')
}

describe('probeRuntimeListener', () => {
  it('accepts a runtime that is listening but silent', async () => {
    // Why: this is the case the pid could never distinguish — the owner is alive
    // and holding the profile, it just has not answered RPC yet.
    const endpoint = nextEndpoint()
    const server = createServer((socket) => {
      sockets.add(socket)
      socket.once('close', () => sockets.delete(socket))
    })
    servers.add(server)
    await new Promise<void>((resolve) => server.listen(endpoint, resolve))

    await expect(probeRuntimeListener(metadataFor(endpoint))).resolves.toBe(true)
  })

  it('rejects an endpoint nothing is listening on', async () => {
    // Why: a crash leaves the socket path behind. Reading that as an owner is
    // what makes a stale profile refuse serve forever.
    await expect(probeRuntimeListener(metadataFor(nextEndpoint()))).resolves.toBe(false)
  })

  it('rejects metadata with no local transport to probe', async () => {
    const metadata = metadataFor(nextEndpoint())

    await expect(
      probeRuntimeListener({
        ...metadata,
        transports: metadata.transports.filter((transport) => transport.kind === 'websocket')
      })
    ).resolves.toBe(false)
  })
})
