import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect, type Socket } from 'node:net'
import { DaemonClient } from './client'
import { DaemonServer, type DaemonServerOptions } from './daemon-server'
import { encodeNdjson } from './ndjson'
import { getDaemonSocketPath } from './daemon-spawner'
import type { DaemonHelloCapabilities, HelloResponse } from './daemon-hello-protocol'
import { PROTOCOL_VERSION } from './types'
import type { TerminalSessionAuthorityPtyOwner } from '../session-authority/terminal-session-authority-pty-owner'
import type { TerminalAuthorityPolicyConsumerClaim } from '../../shared/terminal-session-authority-consumer-transport'

type Readiness = { host: boolean }

const servers: DaemonServer[] = []
const clients: DaemonClient[] = []
const directories: string[] = []
const POLICY_CLAIM: TerminalAuthorityPolicyConsumerClaim = Object.freeze({
  version: 1,
  consumer: Object.freeze({
    consumerId: 'app-profile:daemon-capability-test',
    consumerIncarnationId: 'app-process:daemon-capability-test'
  }),
  expectedConsumerIncarnationId: null
})

afterEach(async () => {
  for (const client of clients.splice(0)) {
    client.disconnect()
  }
  for (const server of servers.splice(0)) {
    await server.shutdown()
  }
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('daemon terminal session authority capability', () => {
  it.each([
    { host: true, authority: true, expected: true },
    { host: false, authority: true, expected: false },
    { host: true, authority: false, expected: false }
  ])('echoes only with host=$host authority=$authority', async ({ host, authority, expected }) => {
    const readiness = { host }
    const harness = await startServer(readiness, { authority })
    const client = new DaemonClient({
      ...harness,
      terminalSessionAuthorityConsumerProofReady: () => true
    })
    clients.push(client)

    await client.ensureConnected()

    expect(client.supportsTerminalSessionAuthority()).toBe(expected)
  })

  it.each([34, 35])('does not echo to a version-only v%s client', async (protocolVersion) => {
    const harness = await startServer({ host: true }, { authority: true, protocolVersion })
    const response = await exchangeVersionOnlyHello(harness, protocolVersion)

    expect(response.ok).toBe(true)
    expect(response.capabilities).toBeUndefined()
  })

  it('does not downgrade an unnegotiated proof offer to a client-supplied consumer', async () => {
    const harness = await startServer({ host: true }, { authority: true })
    const response = await exchangeHelloCapabilities(harness, {
      terminalSessionAuthority: 1,
      terminalAuthorityConsumerProof: { versions: [2] },
      terminalAuthorityNamespaceOutcomes: POLICY_CLAIM
    } as DaemonHelloCapabilities)

    expect(response.ok).toBe(true)
    expect(response.capabilities).toBeUndefined()
  })

  it('negotiates no authority for a proofless peer that names its own consumer', async () => {
    const harness = await startServer({ host: true }, { authority: true })
    const response = await exchangeHelloCapabilities(harness, {
      terminalSessionAuthority: 1,
      terminalAuthorityNamespaceOutcomes: POLICY_CLAIM
    } as DaemonHelloCapabilities)

    expect(response.ok).toBe(true)
    expect(response.capabilities).toBeUndefined()
  })

  it('refuses authority create metadata from a proofless peer before any spawn preparation', async () => {
    const preparePtySpawn = vi.fn(async () => undefined)
    const spawnSubprocess = vi.fn(() => {
      throw new Error('spawn must not run')
    })
    const harness = await startServer(
      { host: true },
      { authority: true, preparePtySpawn, spawnSubprocess }
    )
    const client = new DaemonClient({ ...harness })
    clients.push(client)
    await client.ensureConnected()

    expect(client.supportsTerminalSessionAuthority()).toBe(false)
    await expect(client.request('createOrAttach', authorityCreatePayload())).rejects.toThrow(
      'terminal_session_authority_unavailable'
    )
    expect(preparePtySpawn).not.toHaveBeenCalled()
    expect(spawnSubprocess).not.toHaveBeenCalled()
  })

  it('rejects authority metadata before spawn preparation when capability was not negotiated', async () => {
    const preparePtySpawn = vi.fn(async () => undefined)
    const spawnSubprocess = vi.fn(() => {
      throw new Error('spawn must not run')
    })
    const harness = await startServer(
      { host: false },
      { authority: true, preparePtySpawn, spawnSubprocess }
    )
    const client = new DaemonClient({
      ...harness,
      terminalSessionAuthorityConsumerProofReady: () => true
    })
    clients.push(client)
    await client.ensureConnected()

    await expect(client.request('createOrAttach', authorityCreatePayload())).rejects.toThrow(
      'terminal_session_authority_unavailable'
    )
    expect(preparePtySpawn).not.toHaveBeenCalled()
    expect(spawnSubprocess).not.toHaveBeenCalled()
  })

  it('fails before spawn preparation when host effects become unavailable', async () => {
    const readiness = { host: true }
    const preparePtySpawn = vi.fn(async () => undefined)
    const spawnSubprocess = vi.fn(() => {
      throw new Error('spawn must not run')
    })
    const harness = await startServer(readiness, {
      authority: true,
      preparePtySpawn,
      spawnSubprocess
    })
    const client = new DaemonClient({
      ...harness,
      terminalSessionAuthorityConsumerProofReady: () => true
    })
    clients.push(client)
    await client.ensureConnected()
    expect(client.supportsTerminalSessionAuthority()).toBe(true)
    readiness.host = false

    await expect(client.request('createOrAttach', authorityCreatePayload())).rejects.toThrow(
      'terminal_session_authority_unavailable'
    )
    expect(preparePtySpawn).not.toHaveBeenCalled()
    expect(spawnSubprocess).not.toHaveBeenCalled()
  })
})

async function startServer(
  readiness: Readiness,
  options: {
    authority: boolean
    protocolVersion?: number
    preparePtySpawn?: DaemonServerOptions['preparePtySpawn']
    spawnSubprocess?: DaemonServerOptions['spawnSubprocess']
  }
): Promise<{ socketPath: string; tokenPath: string; protocolVersion?: number }> {
  const directory = mkdtempSync(join(tmpdir(), 'daemon-authority-capability-'))
  directories.push(directory)
  const socketPath = getDaemonSocketPath(directory)
  const tokenPath = join(directory, 'daemon.token')
  const server = new DaemonServer({
    socketPath,
    tokenPath,
    ...(options.protocolVersion !== undefined ? { protocolVersion: options.protocolVersion } : {}),
    spawnSubprocess:
      options.spawnSubprocess ??
      (() => {
        throw new Error('unexpected spawn')
      }),
    ...(options.preparePtySpawn ? { preparePtySpawn: options.preparePtySpawn } : {}),
    ...(options.authority ? { terminalSessionAuthority: authorityComponents() } : {}),
    terminalSessionAuthorityCapabilityReadiness: {
      hostEffectConsumerInstalled: () => readiness.host
    }
  })
  servers.push(server)
  await server.start()
  return {
    socketPath,
    tokenPath,
    ...(options.protocolVersion !== undefined ? { protocolVersion: options.protocolVersion } : {})
  }
}

function authorityComponents(): NonNullable<DaemonServerOptions['terminalSessionAuthority']> {
  return {
    authorityHostId: 'authority-host:daemon-capability-test',
    ptyOwner: {
      releaseAuthenticatedPolicyConsumerTransport: () => {}
    } as unknown as TerminalSessionAuthorityPtyOwner
  }
}

async function exchangeHelloCapabilities(
  harness: { socketPath: string; tokenPath: string; protocolVersion?: number },
  capabilities: DaemonHelloCapabilities
): Promise<HelloResponse> {
  const socket = await connectSocket(harness.socketPath)
  try {
    const response = readHelloResponse(socket)
    socket.write(
      encodeNdjson({
        type: 'hello',
        version: harness.protocolVersion ?? PROTOCOL_VERSION,
        token: readFileSync(harness.tokenPath, 'utf8').trim(),
        clientId: 'capability-client',
        role: 'control',
        capabilities
      })
    )
    return await response
  } finally {
    socket.destroy()
  }
}

function authorityCreatePayload(): Record<string, unknown> {
  return {
    sessionId: 'authority-session',
    cols: 80,
    rows: 24,
    terminalSessionAuthorityVersion: 1,
    terminalSessionAuthorityOperationId: 'operation-a',
    worktreeId: 'repo::/srv/repo',
    paneKey: 'pane-a',
    paneGeneration: 1
  }
}

async function exchangeVersionOnlyHello(
  harness: { socketPath: string; tokenPath: string },
  protocolVersion: number
): Promise<HelloResponse> {
  const socket = await connectSocket(harness.socketPath)
  try {
    const response = readHelloResponse(socket)
    socket.write(
      encodeNdjson({
        type: 'hello',
        version: protocolVersion,
        token: readFileSync(harness.tokenPath, 'utf8').trim(),
        clientId: 'version-only-client',
        role: 'control'
      })
    )
    return await response
  } finally {
    socket.destroy()
  }
}

function connectSocket(socketPath: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath)
    socket.once('connect', () => resolve(socket))
    socket.once('error', reject)
  })
}

function readHelloResponse(socket: Socket): Promise<HelloResponse> {
  return new Promise((resolve, reject) => {
    let buffer = ''
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      const newline = buffer.indexOf('\n')
      if (newline !== -1) {
        resolve(JSON.parse(buffer.slice(0, newline)) as HelloResponse)
      }
    })
    socket.once('error', reject)
  })
}
