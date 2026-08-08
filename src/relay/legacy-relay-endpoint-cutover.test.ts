import { createConnection, createServer, type Socket } from 'node:net'
import { access, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { LegacyRelayBrokerConnectionEvidence } from './legacy-relay-broker-connection-proof'
import { relocatePosixLegacyRelaySocket } from './legacy-relay-posix-cutover'
import { inspectUnixEndpoint } from './legacy-relay-unix-socket-inspection'
import {
  inspectWindowsLegacyRelayPipe,
  sealWindowsLegacyRelayPipe,
  type WindowsLegacyRelayCutoverDependencies
} from './legacy-relay-windows-cutover'

const cleanupPaths: string[] = []
const WINDOWS_BIRTH_MARKER = '638900000000000000'

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  )
})

describe.skipIf(process.platform === 'win32')('POSIX legacy relay socket cutover', () => {
  it('atomically relocates a live socket and seals its credential idempotently', async () => {
    const root = await temporaryDirectory()
    const publicSocketPath = join(root, 'relay.sock')
    const publicCredentialFile = join(root, 'relay.credential')
    const privateStateDirectory = join(root, 'authority', 'legacy')
    const privateSocketPath = join(privateStateDirectory, 'worker.sock')
    const privateCredentialFile = join(privateStateDirectory, 'worker.credential')
    await writeFile(publicCredentialFile, 'A'.repeat(43), { mode: 0o600 })
    const server = createServer((socket) => socket.on('data', (data) => socket.write(data)))
    await listen(server, publicSocketPath)
    const broker = await connect(publicSocketPath)
    const expectedEndpointIdentity = await inspectUnixEndpoint(publicSocketPath)

    try {
      const proof = await relocatePosixLegacyRelaySocket({
        publicSocketPath,
        privateSocketPath,
        publicCredentialFile,
        privateCredentialFile,
        privateStateDirectory,
        expectedEndpointIdentity,
        brokerEvidence: posixBrokerEvidence(expectedEndpointIdentity),
        launchExclusion: testLaunchExclusion(),
        sealedAtMs: 123
      })
      expect((await stat(publicSocketPath)).isDirectory()).toBe(true)
      expect((await stat(publicCredentialFile)).isDirectory()).toBe(true)
      expect(await readFile(privateCredentialFile, 'utf8')).toBe('A'.repeat(43))
      expect((await stat(privateStateDirectory)).mode & 0o777).toBe(0o700)
      expect((await stat(privateCredentialFile)).mode & 0o777).toBe(0o600)
      const relocatedIdentity = await inspectUnixEndpoint(privateSocketPath)
      expect(relocatedIdentity).toMatchObject({
        device: expectedEndpointIdentity.device,
        inode: expectedEndpointIdentity.inode
      })
      expect(proof).toMatchObject({
        kind: 'posix-relocated',
        privateSocketPath,
        privateCredentialFile,
        endpointIdentity: relocatedIdentity,
        sealedAtMs: 123
      })

      const replacement = await connect(privateSocketPath)
      await expect(roundTrip(replacement, 'still-live')).resolves.toBe('still-live')
      replacement.destroy()
      const legacyCredentialTemp = `${publicCredentialFile}.old-client.tmp`
      await writeFile(legacyCredentialTemp, 'old-client-credential')
      await expect(rename(legacyCredentialTemp, publicCredentialFile)).rejects.toThrow()
      await rm(legacyCredentialTemp, { force: true })
      await expect(rm(publicSocketPath, { force: true })).rejects.toThrow()
      const parallelRelay = createServer()
      await expect(listen(parallelRelay, publicSocketPath)).rejects.toThrow()
      expect(parallelRelay.listening).toBe(false)
      await expect(
        relocatePosixLegacyRelaySocket({
          publicSocketPath,
          privateSocketPath,
          publicCredentialFile,
          privateCredentialFile,
          privateStateDirectory,
          expectedEndpointIdentity,
          brokerEvidence: posixBrokerEvidence(expectedEndpointIdentity),
          launchExclusion: testLaunchExclusion(),
          sealedAtMs: 123
        })
      ).resolves.toEqual(proof)
    } finally {
      broker.destroy()
      await closeServer(server)
    }
  })

  it('restores the public credential when socket relocation fails before commit', async () => {
    const root = await temporaryDirectory()
    const publicSocketPath = join(root, 'relay.sock')
    const publicCredentialFile = join(root, 'relay.credential')
    const privateStateDirectory = join(root, 'authority')
    const privateSocketPath = join(privateStateDirectory, 'worker.sock')
    const privateCredentialFile = join(privateStateDirectory, 'worker.credential')
    await writeFile(publicCredentialFile, 'B'.repeat(43), { mode: 0o600 })
    const server = createServer()
    await listen(server, publicSocketPath)
    const expectedEndpointIdentity = await inspectUnixEndpoint(publicSocketPath)
    let rejectSocketMove = true
    try {
      await expect(
        relocatePosixLegacyRelaySocket(
          {
            publicSocketPath,
            privateSocketPath,
            publicCredentialFile,
            privateCredentialFile,
            privateStateDirectory,
            expectedEndpointIdentity,
            brokerEvidence: posixBrokerEvidence(expectedEndpointIdentity),
            launchExclusion: testLaunchExclusion()
          },
          {
            renamePath: async (from, to) => {
              if (from === publicSocketPath && rejectSocketMove) {
                rejectSocketMove = false
                throw new Error('injected socket rename failure')
              }
              await rename(from, to)
            }
          }
        )
      ).rejects.toThrow('injected socket rename failure')
      expect(await readFile(publicCredentialFile, 'utf8')).toBe('B'.repeat(43))
      await expect(access(privateCredentialFile)).rejects.toThrow()
      await expect(access(publicSocketPath)).resolves.toBeUndefined()
    } finally {
      await closeServer(server)
    }
  })
})

describe('Windows legacy relay pipe cutover', () => {
  const pipeName = '\\\\.\\pipe\\orca-relay-0123456789abcdef0123'
  const relayProcess = Object.freeze({ pid: 77, birthMarker: WINDOWS_BIRTH_MARKER })
  const paths = Object.freeze({
    activePipeMarkerPath: 'C:\\orca\\relay\\.windows-active-pipe-relay.sock',
    privateActivePipeMarkerPath: 'C:\\orca\\authority\\legacy\\active-pipe',
    publicCredentialFile: 'C:\\orca\\relay\\relay.credential',
    privateCredentialFile: 'C:\\orca\\authority\\legacy\\worker.credential',
    privateStateDirectory: 'C:\\orca\\authority\\legacy'
  })
  const brokerEvidence: LegacyRelayBrokerConnectionEvidence = Object.freeze({
    brokerConnectionIdentity: 'broker:owner:1',
    brokerClientCount: 1,
    acceptedConnectionCount: 5,
    quiescenceSamples: 2,
    endpointIdentity: Object.freeze({
      kind: 'windows-named-pipe',
      pipeName,
      processCreationMarker: relayProcess.birthMarker
    }),
    graceConfiguration: Object.freeze({
      capabilityVersion: 1,
      configuredGraceMs: 0,
      acknowledged: true
    }),
    connectionProof: Object.freeze({
      method: 'windows-pipe-process',
      listenerIdentity: '77:windows:638900000000000000',
      brokerConnectionIdentity: 'broker:owner:1',
      acceptedServerConnections: 1
    })
  })

  it('binds the exact named pipe to the process creation marker', async () => {
    await expect(
      inspectWindowsLegacyRelayPipe(pipeName, relayProcess, async () => relayProcess.birthMarker)
    ).resolves.toMatchObject({
      method: 'windows-pipe-process',
      acceptedServerConnections: 1,
      endpointIdentity: {
        pipeName,
        processCreationMarker: relayProcess.birthMarker
      }
    })
    await expect(
      inspectWindowsLegacyRelayPipe(pipeName, relayProcess, async () => 'reused-pid')
    ).rejects.toThrow('process identity is stale')
  })

  it('seals the credential and fences active-pipe marker reuse idempotently', async () => {
    const harness = windowsFileHarness(
      new Map([
        [paths.activePipeMarkerPath, pipeName],
        [paths.publicCredentialFile, 'C'.repeat(43)]
      ])
    )
    const request = {
      ...paths,
      pipeName,
      relayProcess,
      brokerEvidence,
      launchExclusion: testLaunchExclusion(),
      sealedAtMs: 456
    }
    const proof = await sealWindowsLegacyRelayPipe(request, harness.dependencies)

    expect(harness.files.get(paths.privateActivePipeMarkerPath)).toBe(pipeName)
    expect(harness.files.get(paths.privateCredentialFile)).toBe('C'.repeat(43))
    expect(harness.fences.has(paths.activePipeMarkerPath)).toBe(true)
    expect(harness.fences.has(paths.publicCredentialFile)).toBe(true)
    expect(harness.writeLikeLegacyClient(paths.activePipeMarkerPath, pipeName)).toBe(false)
    expect(harness.writeLikeLegacyClient(paths.publicCredentialFile, 'new-credential')).toBe(false)
    expect(harness.sealed).toEqual([paths.privateCredentialFile, paths.privateActivePipeMarkerPath])
    expect(proof).toMatchObject({
      kind: 'windows-sealed',
      originalPipeName: pipeName,
      activePipeMarkerIgnored: true,
      sealedAtMs: 456
    })
    await expect(sealWindowsLegacyRelayPipe(request, harness.dependencies)).resolves.toEqual(proof)
  })

  it('rejects a reused marker without moving the credential', async () => {
    const harness = windowsFileHarness(
      new Map([
        [paths.activePipeMarkerPath, '\\\\.\\pipe\\orca-relay-ffffffffffffffffffff'],
        [paths.publicCredentialFile, 'D'.repeat(43)]
      ])
    )
    await expect(
      sealWindowsLegacyRelayPipe(
        {
          ...paths,
          pipeName,
          relayProcess,
          brokerEvidence,
          launchExclusion: testLaunchExclusion()
        },
        harness.dependencies
      )
    ).rejects.toThrow('active-pipe marker was reused')
    expect(harness.files.get(paths.publicCredentialFile)).toBe('D'.repeat(43))
    expect(harness.files.has(paths.privateCredentialFile)).toBe(false)
  })

  it('restores the credential when marker fencing fails before commit', async () => {
    const harness = windowsFileHarness(
      new Map([
        [paths.activePipeMarkerPath, pipeName],
        [paths.publicCredentialFile, 'E'.repeat(43)]
      ]),
      { failMoveFrom: paths.activePipeMarkerPath }
    )
    await expect(
      sealWindowsLegacyRelayPipe(
        {
          ...paths,
          pipeName,
          relayProcess,
          brokerEvidence,
          launchExclusion: testLaunchExclusion()
        },
        harness.dependencies
      )
    ).rejects.toThrow('marker fence failed')
    expect(harness.files.get(paths.publicCredentialFile)).toBe('E'.repeat(43))
    expect(harness.files.has(paths.privateCredentialFile)).toBe(false)
  })
})

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'orca-legacy-cutover-'))
  cleanupPaths.push(path)
  return path
}

async function listen(server: ReturnType<typeof createServer>, socketPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, () => {
      server.off('error', reject)
      resolve()
    })
  })
}

async function connect(socketPath: string): Promise<Socket> {
  return await new Promise<Socket>((resolve, reject) => {
    const socket = createConnection(socketPath)
    socket.once('error', reject)
    socket.once('connect', () => {
      socket.off('error', reject)
      resolve(socket)
    })
  })
}

async function roundTrip(socket: Socket, value: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    socket.once('error', reject)
    socket.once('data', (data) => resolve(data.toString()))
    socket.write(value)
  })
}

async function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()))
}

function windowsFileHarness(
  initial: Map<string, string>,
  options: Readonly<{ failMoveFrom?: string }> = {}
): {
  files: Map<string, string>
  fences: Map<string, string>
  sealed: string[]
  writeLikeLegacyClient: (path: string, value: string) => boolean
  dependencies: WindowsLegacyRelayCutoverDependencies & {
    renamePath: NonNullable<WindowsLegacyRelayCutoverDependencies['renamePath']>
  }
} {
  const files = new Map(initial)
  const fences = new Map<string, string>()
  const sealed: string[] = []
  return {
    files,
    fences,
    sealed,
    writeLikeLegacyClient: (path, value) => {
      if (fences.has(path)) {
        return false
      }
      files.set(path, value)
      return true
    },
    dependencies: {
      queryProcessCreationMarker: async () => WINDOWS_BIRTH_MARKER,
      ensurePrivateDirectory: async () => {},
      readFileSnapshot: async (path) => {
        const content = files.get(path)
        return content === undefined ? null : { content }
      },
      renamePath: async (from, to) => {
        if (from === options.failMoveFrom) {
          throw new Error('marker fence failed')
        }
        const content = files.get(from)
        if (content === undefined || files.has(to) || fences.has(to)) {
          throw new Error('invalid memory rename')
        }
        files.delete(from)
        files.set(to, content)
      },
      sealPrivateFile: async (path) => {
        sealed.push(path)
      },
      inspectPublicFence: async (path, identity) => {
        const expected = JSON.stringify(identity)
        const actual = fences.get(path)
        if (actual !== undefined && actual !== expected) {
          throw new Error('memory fence identity changed')
        }
        return actual === expected
      },
      installPublicFence: async (path, identity) => {
        const expected = JSON.stringify(identity)
        const actual = fences.get(path)
        if (files.has(path) || (actual !== undefined && actual !== expected)) {
          throw new Error('memory fence target occupied')
        }
        fences.set(path, expected)
      },
      removePublicFence: async (path, identity) => {
        if (fences.get(path) !== JSON.stringify(identity)) {
          throw new Error('memory fence identity changed')
        }
        fences.delete(path)
      }
    }
  }
}

function testLaunchExclusion(): {
  runExclusive: <T>(operation: () => Promise<T>) => Promise<T>
} {
  let held = false
  return {
    runExclusive: async (operation) => {
      if (held) {
        throw new Error('test launch exclusion reentered')
      }
      held = true
      try {
        return await operation()
      } finally {
        held = false
      }
    }
  }
}

function posixBrokerEvidence(
  endpointIdentity: LegacyRelayBrokerConnectionEvidence['endpointIdentity']
): LegacyRelayBrokerConnectionEvidence {
  return Object.freeze({
    brokerConnectionIdentity: 'broker:owner:1',
    brokerClientCount: 1,
    acceptedConnectionCount: 3,
    quiescenceSamples: 2,
    endpointIdentity,
    graceConfiguration: Object.freeze({
      capabilityVersion: 1,
      configuredGraceMs: 0,
      acknowledged: true
    }),
    connectionProof: Object.freeze({
      method: 'darwin-lsof-unix',
      listenerIdentity: '99:unix:1:2',
      brokerConnectionIdentity: 'broker:owner:1',
      acceptedServerConnections: 1
    })
  })
}
